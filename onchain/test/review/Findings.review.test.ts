import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type {
  GameResourceToken,
  HeniumDexRouter,
  HeniumEmission,
  HeniumGameVault,
  HeniumToken,
  ResourceBridge,
  StipendWETH9,
} from "../../typechain-types";
import { Category, DOMAIN_NAMES, domainFor, signClaim, signRelease, signWithdrawal } from "../../scripts/lib/vouchers";
import { E18, amountOut, dexFixture, reservesFor } from "../helpers/dex";

/**
 * SECURITY REVIEW — confirmations of the Low / Informational findings, and of one property the original suite never
 * exercised (the router's receive() under the 2,300-gas stipend of canonical WETH9). These tests document current
 * behaviour: they PASS while the reported behaviour exists.
 */
const DAY = 86_400n;
const FAR = 2n ** 64n;

describe("REVIEW findings", () => {
  // ------------------------------------------------------------------------------------------------------------------
  // L-1  Router: a pair whose reserves were set by sync() while it has no LP supply is treated as priced.
  // ------------------------------------------------------------------------------------------------------------------
  describe("L-1 router first liquidity on a pre-synced, supply-less pair", () => {
    /** The deploy script's order: the pair is created in one transaction, seeded in later ones. */
    async function createdNotSeeded() {
      const ctx = await dexFixture();
      await ctx.factory.createPair(await ctx.henium.getAddress(), await ctx.weth.getAddress());
      const pair = await ctx.pairOf(ctx.henium, ctx.weth);
      return { ...ctx, pair };
    }

    it("1 wei + sync() blocks router liquidity for the pair (DoS); a direct mint still works", async () => {
      const ctx = await loadFixture(createdNotSeeded);
      const { router, pair, henium, mallory, lp } = ctx;
      const H = await henium.getAddress();
      await henium.connect(mallory).transfer(await pair.getAddress(), 1n);
      await pair.connect(mallory).sync(); // reserves (1, 0), totalSupply 0
      const d = await ctx.deadline();
      await expect(
        router.connect(lp).addLiquidityETH(H, 10_000n * E18, 0n, 0n, lp.address, d, { value: 4n * E18 }),
      ).to.be.revertedWithCustomError(router, "InsufficientLiquidity");
      await expect(
        router.connect(lp).addLiquidity(H, await ctx.weth.getAddress(), 10_000n * E18, 4n * E18, 0n, 0n, lp.address, d),
      ).to.be.revertedWithCustomError(router, "InsufficientLiquidity");
      // recovery needs a non-router path: transfer both sides and call mint() directly
      await henium.connect(lp).transfer(await pair.getAddress(), 10_000n * E18);
      await ctx.weth.connect(lp).transfer(await pair.getAddress(), 4n * E18);
      await pair.mint(lp.address);
      expect(await pair.totalSupply()).to.be.greaterThan(0n);
    });

    it("a donation + sync() sets the price a zero-minimum first deposit accepts: the seeder's ETH is taken", async () => {
      const ctx = await loadFixture(createdNotSeeded);
      const { router, pair, henium, weth, mallory, lp } = ctx;
      const H = await henium.getAddress();
      const P = await pair.getAddress();

      // attacker: 1 wei HENIUM + 1 WETH, then sync() -> "price" 1 HENIUM-wei = 1 ETH, LP supply still 0
      const attackerWethBefore = await weth.balanceOf(mallory.address);
      await henium.connect(mallory).transfer(P, 1n);
      await weth.connect(mallory).transfer(P, 1n * E18);
      await pair.connect(mallory).sync();

      // seeder: exactly the call scripts/lib/deploy-all.ts makes for HENIUM/WETH (minimums 0)
      const d = await ctx.deadline();
      const ethBefore = await ethers.provider.getBalance(lp.address);
      const tx = await router.connect(lp).addLiquidityETH(H, 10_000n * E18, 0n, 0n, lp.address, d, { value: 4n * E18 });
      const rc = (await tx.wait())!;
      const ethSpent = ethBefore - (await ethers.provider.getBalance(lp.address)) - rc.gasUsed * rc.gasPrice;
      expect(ethSpent).to.equal(4n * E18); // all 4 ETH went in ...
      const [rH] = await reservesFor(pair, H);
      expect(rH).to.equal(5n); // ... next to 4 wei of HENIUM (+ the attacker's 1 wei)

      // attacker: sell a few wei of HENIUM for almost all of the pool's WETH
      const [rIn, rOut] = await reservesFor(pair, H);
      const amountIn = 1_000_000n;
      const out = amountOut(amountIn, rIn, rOut);
      await henium.connect(mallory).transfer(P, amountIn);
      const heniumIs0 = (await pair.token0()) === H;
      await pair.connect(mallory).swap(heniumIs0 ? 0n : out, heniumIs0 ? out : 0n, mallory.address, "0x");
      const profit = (await weth.balanceOf(mallory.address)) - attackerWethBefore;
      expect(profit).to.be.greaterThan((39n * E18) / 10n); // > 3.9 ETH of the seeder's 4 ETH

      // what the seeder's LP position is still worth: a few wei of HENIUM and a dust of WETH
      const lpBal = await pair.balanceOf(lp.address);
      const [, rW] = await reservesFor(pair, H);
      expect((lpBal * rW) / (await pair.totalSupply())).to.be.lessThan(E18 / 10n);
    });

    it("with real minimums the same attack only makes the seeding revert", async () => {
      const ctx = await loadFixture(createdNotSeeded);
      const { router, pair, henium, weth, mallory, lp } = ctx;
      const H = await henium.getAddress();
      await henium.connect(mallory).transfer(await pair.getAddress(), 1n);
      await weth.connect(mallory).transfer(await pair.getAddress(), 1n * E18);
      await pair.connect(mallory).sync();
      const d = await ctx.deadline();
      await expect(
        router.connect(lp).addLiquidityETH(H, 10_000n * E18, 9_900n * E18, (4n * E18 * 99n) / 100n, lp.address, d, { value: 4n * E18 }),
      ).to.be.revertedWithCustomError(router, "InsufficientAAmount");
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  // L-2  Fixed daily windows: a leaked key can spend two days' limits within two seconds.
  // ------------------------------------------------------------------------------------------------------------------
  describe("L-2 fixed-window rate limits allow a 2x burst across a window boundary", () => {
    async function emissionFixture() {
      const [admin, signer, alice] = await ethers.getSigners();
      const token = (await ethers.deployContract("HeniumToken", [admin.address])) as unknown as HeniumToken;
      const genesisTime = BigInt(await time.latest()) + 100n;
      const emission = (await ethers.deployContract("HeniumEmission", [
        await token.getAddress(),
        admin.address,
        genesisTime,
        7_200n * E18,
        1_458n,
        0n,
        ethers.ZeroAddress,
      ])) as unknown as HeniumEmission;
      await token.grantRole(await token.MINTER_ROLE(), await emission.getAddress());
      await emission.grantRole(await emission.SIGNER_ROLE(), signer.address);
      const { chainId } = await ethers.provider.getNetwork();
      const domain = await domainFor(emission, DOMAIN_NAMES.emission, chainId);
      return { token, emission, genesisTime, domain, admin, signer, alice };
    }

    it("HeniumEmission: global limit L, but 2L minted within 2 seconds around an emission-day boundary", async () => {
      const { token, emission, genesisTime, domain, signer, alice } = await loadFixture(emissionFixture);
      const L = 1_000n * E18;
      await emission.setGlobalDailyLimit(L);
      // let unclaimed budget accumulate for 10 days (a leaked key can mint it, within the limit)
      const boundary = genesisTime + 10n * DAY;
      let nonce = 0n;
      const claim = async (at: bigint) => {
        const v = { account: alice.address, category: Category.REFINERY, amount: L, nonce: nonce++, deadline: FAR };
        await time.setNextBlockTimestamp(at);
        await emission.claim(v, await signClaim(signer, domain, v));
      };
      await claim(boundary - 1n); // last second of day 9
      await claim(boundary); // first second of day 10
      expect(await token.balanceOf(alice.address)).to.equal(2n * L);
    });

    it("ResourceBridge and HeniumGameVault: the same with UTC days", async () => {
      const [admin, signer, alice] = await ethers.getSigners();
      const bridge = (await ethers.deployContract("ResourceBridge", [admin.address])) as unknown as ResourceBridge;
      await bridge.grantRole(await bridge.SIGNER_ROLE(), signer.address);
      const stone = (await ethers.deployContract("GameResourceToken", ["Stone", "STONE", await bridge.getAddress()])) as unknown as GameResourceToken;
      const CAP = 1_000n * E18;
      await bridge.registerToken(await stone.getAddress(), CAP);
      const token = (await ethers.deployContract("HeniumToken", [admin.address])) as unknown as HeniumToken;
      await token.grantRole(await token.MINTER_ROLE(), admin.address);
      const vault = (await ethers.deployContract("HeniumGameVault", [await token.getAddress(), admin.address])) as unknown as HeniumGameVault;
      await vault.grantRole(await vault.SIGNER_ROLE(), signer.address);
      await token.mint(await vault.getAddress(), 10_000n * E18);
      await vault.setDailyReleaseCap(CAP);
      const { chainId } = await ethers.provider.getNetwork();
      const bDomain = await domainFor(bridge, DOMAIN_NAMES.bridge, chainId);
      const vDomain = await domainFor(vault, DOMAIN_NAMES.vault, chainId);

      const nextUtcMidnight = ((BigInt(await time.latest()) + 60n) / DAY + 1n) * DAY; // at least a minute ahead
      let n = 0n;
      for (const at of [nextUtcMidnight - 2n, nextUtcMidnight]) {
        const w = { account: alice.address, token: await stone.getAddress(), amount: CAP, nonce: n, deadline: FAR };
        const r = { account: alice.address, amount: CAP, nonce: n++, deadline: FAR };
        const ws = await signWithdrawal(signer, bDomain, w);
        const rs = await signRelease(signer, vDomain, r);
        await time.setNextBlockTimestamp(at);
        await bridge.withdraw(w, ws);
        await vault.release(r, rs);
      }
      expect(await stone.balanceOf(alice.address)).to.equal(2n * CAP);
      expect(await token.balanceOf(alice.address)).to.equal(2n * CAP);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  // I-1  Emission limits ignore what was claimed earlier the same day while they were off (the vault counts it).
  // ------------------------------------------------------------------------------------------------------------------
  it("I-1 enabling an emission limit mid-incident does not count that day's earlier claims; the vault's cap does", async () => {
    const [admin, signer, alice] = await ethers.getSigners();
    const token = (await ethers.deployContract("HeniumToken", [admin.address])) as unknown as HeniumToken;
    const genesisTime = BigInt(await time.latest()) + 100n;
    const emission = (await ethers.deployContract("HeniumEmission", [
      await token.getAddress(),
      admin.address,
      genesisTime,
      7_200n * E18,
      1_458n,
      0n,
      ethers.ZeroAddress,
    ])) as unknown as HeniumEmission;
    await token.grantRole(await token.MINTER_ROLE(), await emission.getAddress());
    await emission.grantRole(await emission.SIGNER_ROLE(), signer.address);
    const { chainId } = await ethers.provider.getNetwork();
    const domain = await domainFor(emission, DOMAIN_NAMES.emission, chainId);
    await time.increaseTo(genesisTime + 5n * DAY + 10n);
    let nonce = 0n;
    const claim = async (amount: bigint) => {
      const v = { account: alice.address, category: Category.REFINERY, amount, nonce: nonce++, deadline: FAR };
      return emission.claim(v, await signClaim(signer, domain, v));
    };
    await claim(20_000n * E18); // leaked key, limits off (the deploy default)
    await emission.setGlobalDailyLimit(1_000n * E18); // incident response, same emission day
    await emission.setAccountDailyLimit(1_000n * E18);
    expect(await emission.globalClaimedToday()).to.equal(0n);
    await claim(1_000n * E18); // still allowed: today's 20,000 are not counted
    expect(await token.balanceOf(alice.address)).to.equal(21_000n * E18);

    // the vault, by contrast, always tracks (moved to the middle of a UTC day so both releases share it)
    await time.increaseTo((BigInt(await time.latest()) / DAY + 1n) * DAY + DAY / 2n);
    const vault = (await ethers.deployContract("HeniumGameVault", [await token.getAddress(), admin.address])) as unknown as HeniumGameVault;
    await vault.grantRole(await vault.SIGNER_ROLE(), signer.address);
    await token.connect(alice).transfer(await vault.getAddress(), 5_000n * E18);
    const vDomain = await domainFor(vault, DOMAIN_NAMES.vault, chainId);
    const r1 = { account: alice.address, amount: 2_000n * E18, nonce: 1n, deadline: FAR };
    await vault.release(r1, await signRelease(signer, vDomain, r1));
    await vault.setDailyReleaseCap(1_000n * E18);
    const r2 = { account: alice.address, amount: 1n, nonce: 2n, deadline: FAR };
    await expect(vault.release(r2, await signRelease(signer, vDomain, r2))).to.be.revertedWithCustomError(vault, "DailyReleaseCapExceeded");
  });

  // ------------------------------------------------------------------------------------------------------------------
  // I-2  Re-granting a revoked signer key revives every voucher it signed that has not expired.
  // ------------------------------------------------------------------------------------------------------------------
  it("I-2 a revoked key's unexpired vouchers come back to life if the key is ever re-granted", async () => {
    const [admin, signer, alice] = await ethers.getSigners();
    const token = (await ethers.deployContract("HeniumToken", [admin.address])) as unknown as HeniumToken;
    await token.grantRole(await token.MINTER_ROLE(), admin.address);
    const vault = (await ethers.deployContract("HeniumGameVault", [await token.getAddress(), admin.address])) as unknown as HeniumGameVault;
    const ROLE = await vault.SIGNER_ROLE();
    await vault.grantRole(ROLE, signer.address);
    await token.mint(await vault.getAddress(), 100n * E18);
    const { chainId } = await ethers.provider.getNetwork();
    const domain = await domainFor(vault, DOMAIN_NAMES.vault, chainId);
    const r = { account: alice.address, amount: 100n * E18, nonce: 7n, deadline: FAR };
    const sig = await signRelease(signer, domain, r);
    await vault.revokeRole(ROLE, signer.address);
    await expect(vault.release(r, sig)).to.be.revertedWithCustomError(vault, "InvalidSigner");
    // ... the server treats the voucher as dead and refunds the player in game ... then the key is re-granted
    await vault.grantRole(ROLE, signer.address);
    await vault.release(r, sig); // double spend: refunded in game AND paid on chain
    expect(await token.balanceOf(alice.address)).to.equal(100n * E18);
  });

  // ------------------------------------------------------------------------------------------------------------------
  // I-3  Deregistering a resource token does not kill outstanding withdrawal vouchers for good.
  // ------------------------------------------------------------------------------------------------------------------
  it("I-3 deregister + re-register revives outstanding withdrawal vouchers for that token", async () => {
    const [admin, signer, alice] = await ethers.getSigners();
    const bridge = (await ethers.deployContract("ResourceBridge", [admin.address])) as unknown as ResourceBridge;
    await bridge.grantRole(await bridge.SIGNER_ROLE(), signer.address);
    const stone = (await ethers.deployContract("GameResourceToken", ["Stone", "STONE", await bridge.getAddress()])) as unknown as GameResourceToken;
    await bridge.registerToken(await stone.getAddress(), 0n);
    const { chainId } = await ethers.provider.getNetwork();
    const domain = await domainFor(bridge, DOMAIN_NAMES.bridge, chainId);
    const w = { account: alice.address, token: await stone.getAddress(), amount: 5n * E18, nonce: 1n, deadline: FAR };
    const sig = await signWithdrawal(signer, domain, w);
    await bridge.deregisterToken(await stone.getAddress());
    await expect(bridge.withdraw(w, sig)).to.be.revertedWithCustomError(bridge, "TokenNotRegistered");
    await bridge.registerToken(await stone.getAddress(), 0n);
    await bridge.withdraw(w, sig);
    expect(await stone.balanceOf(alice.address)).to.equal(5n * E18);
  });

  // ------------------------------------------------------------------------------------------------------------------
  // Soundness: the router works with a WETH that pays out with the 2,300-gas stipend (canonical WETH9 / WAVAX).
  // ------------------------------------------------------------------------------------------------------------------
  it("SOUND router receive() fits canonical WETH9's 2,300-gas transfer (removeLiquidityETH, ...ForETH, ...ForExactETH)", async () => {
    const ctx = await dexFixture();
    const sweth = (await ethers.deployContract("StipendWETH9")) as unknown as StipendWETH9;
    const router = (await ethers.deployContract("HeniumDexRouter", [await ctx.factory.getAddress(), await sweth.getAddress()])) as unknown as HeniumDexRouter;
    const R = await router.getAddress();
    const H = await ctx.henium.getAddress();
    await ctx.henium.connect(ctx.lp).approve(R, ethers.MaxUint256);
    const d = await ctx.deadline();
    await router.connect(ctx.lp).addLiquidityETH(H, 10_000n * E18, 0n, 0n, ctx.lp.address, d, { value: 4n * E18 });
    const pair = await ctx.pairOf(H, await sweth.getAddress());
    await ctx.henium.connect(ctx.trader).approve(R, ethers.MaxUint256);
    await router.connect(ctx.trader).swapExactTokensForETH(10n * E18, 0n, [H, await sweth.getAddress()], ctx.trader.address, d);
    await router.connect(ctx.trader).swapTokensForExactETH(E18 / 1000n, ethers.MaxUint256, [H, await sweth.getAddress()], ctx.trader.address, d);
    await pair.connect(ctx.lp).approve(R, ethers.MaxUint256);
    const lp = await pair.balanceOf(ctx.lp.address);
    await router.connect(ctx.lp).removeLiquidityETH(H, lp / 2n, 0n, 0n, ctx.lp.address, d);
    expect(await ethers.provider.getBalance(R)).to.equal(0n);
  });
});
