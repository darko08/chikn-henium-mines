import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { GameResourceToken, ResourceBridge } from "../typechain-types";
import { DOMAIN_NAMES, WITHDRAWAL_TYPES, type WithdrawalVoucher, domainFor, signWithdrawal } from "../scripts/lib/vouchers";
import { RESOURCES } from "../scripts/lib/deploy-all";

const E18 = 10n ** 18n;
const FAR = 2n ** 64n;
const DAY = 86_400n;
const PLAYER = ethers.id("player:bob#7");

type Signer = Awaited<ReturnType<typeof ethers.getSigners>>[number];

describe("GameResourceToken + ResourceBridge", () => {
  async function fixture() {
    const [admin, signer, pauser, alice, bob, relayer, mallory] = await ethers.getSigners();
    const bridge = (await ethers.deployContract("ResourceBridge", [admin.address])) as unknown as ResourceBridge;
    await bridge.grantRole(await bridge.SIGNER_ROLE(), signer.address);
    await bridge.grantRole(await bridge.PAUSER_ROLE(), pauser.address);
    const tokens: Record<string, GameResourceToken> = {};
    for (const r of RESOURCES) {
      const t = (await ethers.deployContract("GameResourceToken", [
        `Henium Mines ${r.name}`,
        r.symbol,
        await bridge.getAddress(),
      ])) as unknown as GameResourceToken;
      await bridge.registerToken(await t.getAddress(), 0n);
      tokens[r.id] = t;
    }
    const { chainId } = await ethers.provider.getNetwork();
    const domain = await domainFor(bridge, DOMAIN_NAMES.bridge, chainId);
    return { bridge, tokens, domain, chainId, admin, signer, pauser, alice, bob, relayer, mallory };
  }
  type Ctx = Awaited<ReturnType<typeof fixture>>;

  let nonceSeq = 1n;
  const voucherFor = async (account: Signer, token: GameResourceToken, amount: bigint, extra: Partial<WithdrawalVoucher> = {}) => ({
    account: account.address,
    token: await token.getAddress(),
    amount,
    nonce: nonceSeq++,
    deadline: FAR,
    ...extra,
  });
  async function withdrawAs(ctx: Ctx, v: WithdrawalVoucher, signer: Signer = ctx.signer) {
    return ctx.bridge.connect(ctx.relayer).withdraw(v, await signWithdrawal(signer, ctx.domain, v));
  }

  describe("GameResourceToken", () => {
    it("is an 18-decimal ERC-20 named after the game resource, mintable only by its bridge", async () => {
      const ctx = await loadFixture(fixture);
      const stone = ctx.tokens.stone;
      expect(await stone.name()).to.equal("Henium Mines Stone");
      expect(await stone.symbol()).to.equal("STONE");
      expect(await stone.decimals()).to.equal(18);
      expect(await stone.bridge()).to.equal(await ctx.bridge.getAddress());
      for (const who of [ctx.admin, ctx.signer, ctx.alice]) {
        await expect(stone.connect(who).mint(who.address, 1n)).to.be.revertedWithCustomError(stone, "OnlyBridge").withArgs(who.address);
      }
    });

    it("cannot be deployed without a bridge", async () => {
      const F = await ethers.getContractFactory("GameResourceToken");
      await expect(F.deploy("X", "X", ethers.ZeroAddress)).to.be.revertedWithCustomError(F, "ZeroBridge");
    });

    it("is burnable by holders and supports permit", async () => {
      const ctx = await loadFixture(fixture);
      const coal = ctx.tokens.coal;
      await withdrawAs(ctx, await voucherFor(ctx.alice, coal, 100n * E18));
      await coal.connect(ctx.alice).burn(30n * E18);
      expect(await coal.totalSupply()).to.equal(70n * E18);
      const deadline = BigInt(await time.latest()) + 600n;
      const domain = { name: "Henium Mines Coal", version: "1", chainId: ctx.chainId, verifyingContract: await coal.getAddress() };
      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const sig = ethers.Signature.from(
        await ctx.alice.signTypedData(domain, types, { owner: ctx.alice.address, spender: ctx.bob.address, value: 5n, nonce: 0n, deadline }),
      );
      await coal.permit(ctx.alice.address, ctx.bob.address, 5n, deadline, sig.v, sig.r, sig.s);
      expect(await coal.allowance(ctx.alice.address, ctx.bob.address)).to.equal(5n);
    });
  });

  describe("registration", () => {
    it("registers all 13 game resources", async () => {
      const ctx = await loadFixture(fixture);
      const list = await ctx.bridge.registeredTokens();
      expect(list.length).to.equal(13);
      for (const r of RESOURCES) {
        expect(await ctx.bridge.isRegistered(await ctx.tokens[r.id].getAddress())).to.equal(true);
      }
      expect(RESOURCES.map((r) => r.name)).to.deep.equal([
        "Stone", "Coal", "Copper", "Iron", "Henium Ore", "Rare Earth", "Crushed Ore",
        "Copper Ingot", "Iron Ingot", "Components", "Machine Part", "Alloy", "Circuit",
      ]);
    });

    it("is admin-only and accepts only tokens minted by this bridge, once", async () => {
      const ctx = await loadFixture(fixture);
      const otherBridge = await ethers.deployContract("ResourceBridge", [ctx.admin.address]);
      const foreign = await ethers.deployContract("GameResourceToken", ["Foreign", "F", await otherBridge.getAddress()]);
      const fresh = await ethers.deployContract("GameResourceToken", ["Fresh", "FR", await ctx.bridge.getAddress()]);
      await expect(ctx.bridge.connect(ctx.alice).registerToken(await fresh.getAddress(), 0n)).to.be.revertedWithCustomError(
        ctx.bridge,
        "AccessControlUnauthorizedAccount",
      );
      await expect(ctx.bridge.registerToken(await foreign.getAddress(), 0n))
        .to.be.revertedWithCustomError(ctx.bridge, "WrongBridge")
        .withArgs(await foreign.getAddress(), await otherBridge.getAddress());
      await expect(ctx.bridge.registerToken(ethers.ZeroAddress, 0n)).to.be.revertedWithCustomError(ctx.bridge, "ZeroAddress");
      await expect(ctx.bridge.registerToken(await fresh.getAddress(), 5n))
        .to.emit(ctx.bridge, "TokenRegistered")
        .withArgs(await fresh.getAddress(), 5n);
      expect(await ctx.bridge.dailyMintCap(await fresh.getAddress())).to.equal(5n);
      await expect(ctx.bridge.registerToken(await fresh.getAddress(), 0n))
        .to.be.revertedWithCustomError(ctx.bridge, "TokenAlreadyRegistered")
        .withArgs(await fresh.getAddress());
    });

    it("deregisters a token in both directions", async () => {
      const ctx = await loadFixture(fixture);
      const iron = ctx.tokens.iron;
      await withdrawAs(ctx, await voucherFor(ctx.alice, iron, 10n));
      await expect(ctx.bridge.connect(ctx.alice).deregisterToken(await iron.getAddress())).to.be.revertedWithCustomError(
        ctx.bridge,
        "AccessControlUnauthorizedAccount",
      );
      await expect(ctx.bridge.deregisterToken(await iron.getAddress())).to.emit(ctx.bridge, "TokenDeregistered").withArgs(await iron.getAddress());
      expect(await ctx.bridge.isRegistered(await iron.getAddress())).to.equal(false);
      expect((await ctx.bridge.registeredTokens()).length).to.equal(12);
      await expect(withdrawAs(ctx, await voucherFor(ctx.alice, iron, 1n)))
        .to.be.revertedWithCustomError(ctx.bridge, "TokenNotRegistered")
        .withArgs(await iron.getAddress());
      await iron.connect(ctx.alice).approve(await ctx.bridge.getAddress(), 10n);
      await expect(ctx.bridge.connect(ctx.alice).deposit(await iron.getAddress(), 10n, PLAYER)).to.be.revertedWithCustomError(
        ctx.bridge,
        "TokenNotRegistered",
      );
      await expect(ctx.bridge.deregisterToken(await iron.getAddress())).to.be.revertedWithCustomError(ctx.bridge, "TokenNotRegistered");
      // holders keep their tokens and can still trade or burn them
      await iron.connect(ctx.alice).burn(10n);
    });
  });

  describe("withdraw (game -> chain)", () => {
    it("mints on a valid voucher, submitted by anyone", async () => {
      const ctx = await loadFixture(fixture);
      const stone = ctx.tokens.stone;
      const v = await voucherFor(ctx.bob, stone, 1_000_000n * E18);
      await expect(withdrawAs(ctx, v))
        .to.emit(ctx.bridge, "Withdrawn")
        .withArgs(ctx.bob.address, await stone.getAddress(), v.nonce, v.amount, ctx.signer.address)
        .and.to.emit(stone, "Transfer")
        .withArgs(ethers.ZeroAddress, ctx.bob.address, v.amount);
      expect(await stone.balanceOf(ctx.bob.address)).to.equal(v.amount);
      expect(await stone.balanceOf(ctx.relayer.address)).to.equal(0n);
    });

    it("rejects unregistered tokens, replays, expired vouchers, bad signers and swapped tokens", async () => {
      const ctx = await loadFixture(fixture);
      const stray = await ethers.deployContract("GameResourceToken", ["Stray", "S", await ctx.bridge.getAddress()]);
      await expect(withdrawAs(ctx, await voucherFor(ctx.bob, stray as unknown as GameResourceToken, 1n)))
        .to.be.revertedWithCustomError(ctx.bridge, "TokenNotRegistered")
        .withArgs(await stray.getAddress());

      const v = await voucherFor(ctx.bob, ctx.tokens.alloy, 3n * E18);
      const sig = await signWithdrawal(ctx.signer, ctx.domain, v);
      await ctx.bridge.withdraw(v, sig);
      await expect(ctx.bridge.withdraw(v, sig)).to.be.revertedWithCustomError(ctx.bridge, "NonceAlreadyUsed").withArgs(ctx.bob.address, v.nonce);

      // the same signature cannot be pointed at a more valuable token
      const fresh = await voucherFor(ctx.bob, ctx.tokens.alloy, 3n * E18);
      const freshSig = await signWithdrawal(ctx.signer, ctx.domain, fresh);
      const swapped = { ...fresh, token: await ctx.tokens.circuit.getAddress() };
      await expect(ctx.bridge.withdraw(swapped, freshSig))
        .to.be.revertedWithCustomError(ctx.bridge, "InvalidSigner")
        .withArgs(ethers.verifyTypedData(ctx.domain, WITHDRAWAL_TYPES, swapped, freshSig));

      const now = BigInt(await time.latest());
      await expect(withdrawAs(ctx, await voucherFor(ctx.bob, ctx.tokens.alloy, 1n, { deadline: now }))).to.be.revertedWithCustomError(
        ctx.bridge,
        "VoucherExpired",
      );
      await expect(withdrawAs(ctx, await voucherFor(ctx.bob, ctx.tokens.alloy, 1n), ctx.mallory))
        .to.be.revertedWithCustomError(ctx.bridge, "InvalidSigner")
        .withArgs(ctx.mallory.address);
      await expect(withdrawAs(ctx, await voucherFor(ctx.bob, ctx.tokens.alloy, 0n))).to.be.revertedWithCustomError(ctx.bridge, "ZeroAmount");
      const z = { ...(await voucherFor(ctx.bob, ctx.tokens.alloy, 1n)), account: ethers.ZeroAddress };
      await expect(ctx.bridge.withdraw(z, await signWithdrawal(ctx.signer, ctx.domain, z))).to.be.revertedWithCustomError(ctx.bridge, "ZeroAddress");
    });

    it("enforces each token's optional daily mint cap, per UTC day and per token", async () => {
      const ctx = await loadFixture(fixture);
      const copper = ctx.tokens.copper;
      const addr = await copper.getAddress();
      expect(await ctx.bridge.mintRemainingToday(addr)).to.equal(ethers.MaxUint256);
      await expect(ctx.bridge.connect(ctx.alice).setDailyMintCap(addr, 1n)).to.be.revertedWithCustomError(ctx.bridge, "AccessControlUnauthorizedAccount");
      await expect(ctx.bridge.setDailyMintCap(ctx.alice.address, 1n))
        .to.be.revertedWithCustomError(ctx.bridge, "TokenNotRegistered")
        .withArgs(ctx.alice.address);
      await expect(ctx.bridge.setDailyMintCap(addr, 1_000n * E18)).to.emit(ctx.bridge, "DailyMintCapSet").withArgs(addr, 0n, 1_000n * E18);

      const dayStart = (BigInt(await time.latest()) / DAY + 1n) * DAY;
      await time.setNextBlockTimestamp(dayStart);
      await withdrawAs(ctx, await voucherFor(ctx.alice, copper, 700n * E18));
      expect(await ctx.bridge.mintedToday(addr)).to.equal(700n * E18);
      expect(await ctx.bridge.mintRemainingToday(addr)).to.equal(300n * E18);
      await expect(withdrawAs(ctx, await voucherFor(ctx.bob, copper, 301n * E18)))
        .to.be.revertedWithCustomError(ctx.bridge, "DailyMintCapExceeded")
        .withArgs(addr, 301n * E18, 300n * E18);
      await withdrawAs(ctx, await voucherFor(ctx.bob, copper, 300n * E18));
      // other tokens are not affected
      await withdrawAs(ctx, await voucherFor(ctx.bob, ctx.tokens.iron, 5_000n * E18));
      // lowering the cap below today's mints
      await ctx.bridge.setDailyMintCap(addr, 10n * E18);
      expect(await ctx.bridge.mintRemainingToday(addr)).to.equal(0n);
      await expect(withdrawAs(ctx, await voucherFor(ctx.bob, copper, 1n)))
        .to.be.revertedWithCustomError(ctx.bridge, "DailyMintCapExceeded")
        .withArgs(addr, 1n, 0n);
      // next UTC day
      await time.increaseTo(dayStart + DAY);
      expect(await ctx.bridge.mintedToday(addr)).to.equal(0n);
      expect(await ctx.bridge.mintRemainingToday(addr)).to.equal(10n * E18);
      await withdrawAs(ctx, await voucherFor(ctx.bob, copper, 10n * E18));
      expect(await ctx.bridge.mintedToday(addr)).to.equal(10n * E18);
    });

    it("refuses an absurd uncapped daily total instead of wrapping its counter", async () => {
      const ctx = await loadFixture(fixture);
      await expect(withdrawAs(ctx, await voucherFor(ctx.bob, ctx.tokens.stone, 2n ** 192n))).to.be.revertedWithCustomError(
        ctx.bridge,
        "SafeCastOverflowedUintDowncast",
      );
    });
  });

  describe("deposit (chain -> game)", () => {
    it("burns the tokens (with an allowance) and emits the event the server listens to", async () => {
      const ctx = await loadFixture(fixture);
      const circuit = ctx.tokens.circuit;
      await withdrawAs(ctx, await voucherFor(ctx.bob, circuit, 50n * E18));
      const bridgeAddr = await ctx.bridge.getAddress();
      await expect(ctx.bridge.connect(ctx.bob).deposit(await circuit.getAddress(), 20n * E18, PLAYER))
        .to.be.revertedWithCustomError(circuit, "ERC20InsufficientAllowance")
        .withArgs(bridgeAddr, 0n, 20n * E18);
      await circuit.connect(ctx.bob).approve(bridgeAddr, 20n * E18);
      await expect(ctx.bridge.connect(ctx.bob).deposit(await circuit.getAddress(), 20n * E18, PLAYER))
        .to.emit(ctx.bridge, "Deposited")
        .withArgs(ctx.bob.address, await circuit.getAddress(), PLAYER, 20n * E18)
        .and.to.emit(circuit, "Transfer")
        .withArgs(ctx.bob.address, ethers.ZeroAddress, 20n * E18);
      expect(await circuit.totalSupply()).to.equal(30n * E18);
      expect(await circuit.balanceOf(ctx.bob.address)).to.equal(30n * E18);
    });

    it("rejects zero amounts, a zero player id and unregistered tokens", async () => {
      const ctx = await loadFixture(fixture);
      const t = await ctx.tokens.coal.getAddress();
      await expect(ctx.bridge.connect(ctx.bob).deposit(t, 0n, PLAYER)).to.be.revertedWithCustomError(ctx.bridge, "ZeroAmount");
      await expect(ctx.bridge.connect(ctx.bob).deposit(t, 1n, ethers.ZeroHash)).to.be.revertedWithCustomError(ctx.bridge, "ZeroPlayerId");
      await expect(ctx.bridge.connect(ctx.bob).deposit(ctx.alice.address, 1n, PLAYER)).to.be.revertedWithCustomError(ctx.bridge, "TokenNotRegistered");
    });
  });

  describe("pause and helpers", () => {
    it("PAUSER_ROLE stops withdrawals and deposits", async () => {
      const ctx = await loadFixture(fixture);
      const stone = ctx.tokens.stone;
      await withdrawAs(ctx, await voucherFor(ctx.bob, stone, 10n));
      await expect(ctx.bridge.connect(ctx.bob).pause()).to.be.revertedWithCustomError(ctx.bridge, "AccessControlUnauthorizedAccount");
      await ctx.bridge.connect(ctx.pauser).pause();
      await expect(withdrawAs(ctx, await voucherFor(ctx.bob, stone, 1n))).to.be.revertedWithCustomError(ctx.bridge, "EnforcedPause");
      await stone.connect(ctx.bob).approve(await ctx.bridge.getAddress(), 10n);
      await expect(ctx.bridge.connect(ctx.bob).deposit(await stone.getAddress(), 10n, PLAYER)).to.be.revertedWithCustomError(
        ctx.bridge,
        "EnforcedPause",
      );
      await ctx.bridge.connect(ctx.pauser).unpause();
      await ctx.bridge.connect(ctx.bob).deposit(await stone.getAddress(), 10n, PLAYER);
    });

    it("exposes the EIP-712 digest, type hash and domain", async () => {
      const ctx = await loadFixture(fixture);
      const v = await voucherFor(ctx.bob, ctx.tokens.stone, 1n);
      expect(await ctx.bridge.hashWithdrawal(v)).to.equal(ethers.TypedDataEncoder.hash(ctx.domain, WITHDRAWAL_TYPES, v));
      expect(await ctx.bridge.DOMAIN_SEPARATOR()).to.equal(ethers.TypedDataEncoder.hashDomain(ctx.domain));
      expect(await ctx.bridge.WITHDRAWAL_TYPEHASH()).to.equal(
        ethers.id("Withdrawal(address account,address token,uint256 amount,uint256 nonce,uint256 deadline)"),
      );
    });

    it("rejects a zero admin", async () => {
      const F = await ethers.getContractFactory("ResourceBridge");
      await expect(F.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(F, "ZeroAddress");
    });
  });
});
