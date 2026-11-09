import { expect } from "chai";
import { ethers, network } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { FlashBorrower, HeniumDexPair, HookToken, NoReturnToken, TrickyBurnToken } from "../../typechain-types";
import { DEAD, E18, MINIMUM_LIQUIDITY, amountOut, burnPart, dexFixture, directSwap, reservesFor, sqrt, type Erc20Like } from "../helpers/dex";

describe("HeniumDexFactory", () => {
  it("creates one pair per token pair, sorted, findable both ways", async () => {
    const ctx = await loadFixture(dexFixture);
    const [a, b] = [await ctx.henium.getAddress(), await ctx.egg.getAddress()];
    const [t0, t1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
    await expect(ctx.factory.createPair(b, a)).to.emit(ctx.factory, "PairCreated").withArgs(t0, t1, ethers.isAddress, 1n);
    const pairAddr = await ctx.factory.getPair(a, b);
    expect(await ctx.factory.getPair(b, a)).to.equal(pairAddr);
    expect(await ctx.factory.allPairs(0)).to.equal(pairAddr);
    expect(await ctx.factory.allPairsLength()).to.equal(1n);
    const pair = await ethers.getContractAt("HeniumDexPair", pairAddr);
    expect(await pair.token0()).to.equal(t0);
    expect(await pair.token1()).to.equal(t1);
    expect(await pair.factory()).to.equal(await ctx.factory.getAddress());
    expect(await pair.name()).to.equal("Henium DEX LP");
    expect(await pair.symbol()).to.equal("HDEX-LP");
    expect(await pair.MINIMUM_LIQUIDITY()).to.equal(MINIMUM_LIQUIDITY);
    expect(await pair.DEAD()).to.equal(DEAD);
    // CREATE2 with salt keccak256(token0, token1): the address is predictable off chain (nothing on chain relies on it)
    const F = await ethers.getContractFactory("HeniumDexPair");
    const init = ethers.concat([F.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [t0, t1])]);
    const salt = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [t0, t1]));
    expect(ethers.getCreate2Address(await ctx.factory.getAddress(), salt, ethers.keccak256(init))).to.equal(pairAddr);
  });

  it("rejects identical tokens, the zero address, duplicates and non-contracts", async () => {
    const ctx = await loadFixture(dexFixture);
    const h = await ctx.henium.getAddress();
    await expect(ctx.factory.createPair(h, h)).to.be.revertedWithCustomError(ctx.factory, "IdenticalAddresses");
    await expect(ctx.factory.createPair(h, ethers.ZeroAddress)).to.be.revertedWithCustomError(ctx.factory, "ZeroAddress");
    await ctx.factory.createPair(h, await ctx.weth.getAddress());
    await expect(ctx.factory.createPair(await ctx.weth.getAddress(), h))
      .to.be.revertedWithCustomError(ctx.factory, "PairExists")
      .withArgs(await ctx.factory.getPair(h, await ctx.weth.getAddress()));
    // an EOA "token", whichever side it sorts to
    const lowEoa = "0x0000000000000000000000000000000000000001";
    const highEoa = "0xffffffffffffffffffffffffffffffffffffffff";
    await expect(ctx.factory.createPair(h, lowEoa)).to.be.revertedWithCustomError(ctx.factory, "NotAContract").withArgs(lowEoa);
    await expect(ctx.factory.createPair(h, highEoa))
      .to.be.revertedWithCustomError(ctx.factory, "NotAContract")
      .withArgs(ethers.getAddress(highEoa));
  });
});

describe("HeniumDexPair", () => {
  async function pairFixture() {
    const ctx = await dexFixture();
    const pair = await ctx.addLiquidity(ctx.stone, ctx.henium, 1_000_000n * E18, 4_000n * E18);
    return { ...ctx, pair };
  }

  describe("mint", () => {
    it("first deposit: sqrt(a*b) - MINIMUM_LIQUIDITY, with 1,000 LP locked at 0x…dEaD", async () => {
      const ctx = await loadFixture(dexFixture);
      await ctx.factory.createPair(await ctx.egg.getAddress(), await ctx.henium.getAddress());
      const pair = await ctx.pairOf(ctx.egg, ctx.henium);
      const [a, b] = [10_000n * E18, 2_500n * E18];
      await ctx.egg.connect(ctx.lp).transfer(await pair.getAddress(), a);
      await ctx.henium.connect(ctx.lp).transfer(await pair.getAddress(), b);
      const expected = sqrt(a * b) - MINIMUM_LIQUIDITY;
      const [amount0, amount1] = (await pair.token0()) === (await ctx.egg.getAddress()) ? [a, b] : [b, a];
      await expect(pair.mint(ctx.lp.address))
        .to.emit(pair, "Mint")
        .withArgs(ctx.deployer.address, amount0, amount1)
        .and.to.emit(pair, "Sync")
        .withArgs(amount0, amount1);
      expect(await pair.balanceOf(ctx.lp.address)).to.equal(expected);
      expect(await pair.balanceOf(DEAD)).to.equal(MINIMUM_LIQUIDITY);
      expect(await pair.totalSupply()).to.equal(sqrt(a * b));
      const [r0, r1] = await pair.getReserves();
      expect([r0, r1]).to.deep.equal([amount0, amount1]);
    });

    it("refuses a first deposit too small to lock MINIMUM_LIQUIDITY", async () => {
      const ctx = await loadFixture(dexFixture);
      await ctx.factory.createPair(await ctx.egg.getAddress(), await ctx.henium.getAddress());
      const pair = await ctx.pairOf(ctx.egg, ctx.henium);
      await ctx.egg.transfer(await pair.getAddress(), 1_000n);
      await ctx.henium.transfer(await pair.getAddress(), 1_000n); // sqrt = 1,000: nothing left for the LP
      await expect(pair.mint(ctx.lp.address)).to.be.revertedWithCustomError(pair, "InsufficientLiquidityMinted");
      await ctx.henium.transfer(await pair.getAddress(), 1_001n); // sqrt(1000 * 2001) = 1414 -> 414 LP
      await pair.mint(ctx.lp.address);
      expect(await pair.balanceOf(ctx.lp.address)).to.equal(414n);
      expect(await pair.balanceOf(DEAD)).to.equal(MINIMUM_LIQUIDITY);
    });

    it("later deposits mint pro rata; an unbalanced deposit donates its excess to existing LPs", async () => {
      const ctx = await loadFixture(pairFixture);
      const { pair } = ctx;
      const supply = await pair.totalSupply();
      const [rS, rH] = await reservesFor(pair, await ctx.stone.getAddress());
      // 10% more of both: 10% more LP
      await ctx.stone.connect(ctx.alice).transfer(await pair.getAddress(), rS / 10n);
      await ctx.henium.connect(ctx.alice).transfer(await pair.getAddress(), rH / 10n);
      await pair.mint(ctx.alice.address);
      expect(await pair.balanceOf(ctx.alice.address)).to.equal(supply / 10n);
      // unbalanced: 10% Stone but 20% HENIUM -> still 10% of the (new) supply
      const supply2 = await pair.totalSupply();
      const [rS2, rH2] = await reservesFor(pair, await ctx.stone.getAddress());
      await ctx.stone.connect(ctx.bob).transfer(await pair.getAddress(), rS2 / 10n);
      await ctx.henium.connect(ctx.bob).transfer(await pair.getAddress(), rH2 / 5n);
      await pair.mint(ctx.bob.address);
      expect(await pair.balanceOf(ctx.bob.address)).to.equal((rS2 / 10n) * supply2 / rS2);
      // nothing sent: nothing minted
      await expect(pair.mint(ctx.bob.address)).to.be.revertedWithCustomError(pair, "InsufficientLiquidityMinted");
    });
  });

  describe("burn", () => {
    it("returns the pro-rata share of both balances", async () => {
      const ctx = await loadFixture(pairFixture);
      const { pair } = ctx;
      const lpBal = await pair.balanceOf(ctx.lp.address);
      const supply = await pair.totalSupply();
      const [b0, b1] = await pair.getReserves();
      const half = lpBal / 2n;
      await pair.connect(ctx.lp).transfer(await pair.getAddress(), half);
      const t0 = await ethers.getContractAt("IERC20", await pair.token0());
      const before0 = await t0.balanceOf(ctx.carol.address);
      await expect(pair.burn(ctx.carol.address))
        .to.emit(pair, "Burn")
        .withArgs(ctx.deployer.address, (half * b0) / supply, (half * b1) / supply, ctx.carol.address);
      expect((await t0.balanceOf(ctx.carol.address)) - before0).to.equal((half * b0) / supply);
      expect(await pair.totalSupply()).to.equal(supply - half);
    });

    it("rejects burning nothing, or so little that one side rounds to zero", async () => {
      const ctx = await loadFixture(dexFixture);
      const pair = await ctx.addLiquidity(ctx.egg, ctx.henium, 10n ** 30n, 1_000_000n); // supply = 1e18
      await expect(pair.burn(ctx.lp.address)).to.be.revertedWithCustomError(pair, "InsufficientLiquidityBurned");
      await pair.connect(ctx.lp).transfer(await pair.getAddress(), 1n); // 1 wei of LP = 1e-12 wei of HENIUM -> 0
      await expect(pair.burn(ctx.lp.address)).to.be.revertedWithCustomError(pair, "InsufficientLiquidityBurned");
    });
  });

  describe("swap", () => {
    it("pays exactly the router formula and burns 0.10% of a HENIUM input (totalSupply goes down)", async () => {
      const ctx = await loadFixture(pairFixture);
      const { pair } = ctx;
      const amount = 100n * E18;
      const supply = await ctx.henium.totalSupply();
      const [rIn, rOut] = await reservesFor(pair, await ctx.henium.getAddress());
      const out = amountOut(amount, rIn, rOut);
      const before = await ctx.stone.balanceOf(ctx.carol.address);
      await ctx.henium.connect(ctx.alice).transfer(await pair.getAddress(), amount);
      const heniumIs0 = (await pair.token0()) === (await ctx.henium.getAddress());
      await expect(pair.connect(ctx.alice).swap(heniumIs0 ? 0n : out, heniumIs0 ? out : 0n, ctx.carol.address, "0x"))
        .to.emit(pair, "Swap")
        .withArgs(ctx.alice.address, heniumIs0 ? amount : 0n, heniumIs0 ? 0n : amount, heniumIs0 ? 0n : out, heniumIs0 ? out : 0n, ctx.carol.address)
        .and.to.emit(pair, "FeeBurned")
        .withArgs(await ctx.henium.getAddress(), burnPart(amount))
        .and.to.emit(ctx.henium, "Transfer")
        .withArgs(await pair.getAddress(), ethers.ZeroAddress, burnPart(amount));
      expect((await ctx.stone.balanceOf(ctx.carol.address)) - before).to.equal(out);
      expect(await ctx.henium.totalSupply()).to.equal(supply - burnPart(amount));
      const [newIn, newOut] = await reservesFor(pair, await ctx.henium.getAddress());
      expect(newIn).to.equal(rIn + amount - burnPart(amount));
      expect(newOut).to.equal(rOut - out);
      expect(newIn * newOut).to.be.greaterThan(rIn * rOut); // k grew
    });

    it("burns a resource-token input too (GameResourceToken is burnable)", async () => {
      const ctx = await loadFixture(pairFixture);
      const supply = await ctx.stone.totalSupply();
      await directSwap(ctx.pair, ctx.stone as unknown as Erc20Like, 12_345n * E18, ctx.alice, ctx.alice.address);
      expect(await ctx.stone.totalSupply()).to.equal(supply - burnPart(12_345n * E18));
      expect(await ctx.stone.balanceOf(DEAD)).to.equal(0n);
    });

    it("sends the fee of a non-burnable token (MockERC20 / EGG stand-in) to 0x…dEaD", async () => {
      const ctx = await loadFixture(dexFixture);
      const pair = await ctx.addLiquidity(ctx.egg, ctx.henium, 10_000n * E18, 2_500n * E18);
      const supply = await ctx.egg.totalSupply();
      const amount = 777n * E18;
      await directSwap(pair, ctx.egg as unknown as Erc20Like, amount, ctx.alice, ctx.alice.address);
      expect(await ctx.egg.balanceOf(DEAD)).to.equal(burnPart(amount));
      expect(await ctx.egg.totalSupply()).to.equal(supply); // nothing burned: it is parked at dEaD forever
    });

    it("detects canonical WETH9's silent fallback on burn() and sends the WETH fee to 0x…dEaD", async () => {
      const ctx = await loadFixture(dexFixture);
      const pair = await ctx.addLiquidity(ctx.henium, ctx.weth, 10_000n * E18, 4n * E18);
      const amount = 1n * E18;
      // WETH9 has no burn(), but its payable fallback accepts the call and does nothing
      await expect(ctx.alice.sendTransaction({ to: await ctx.weth.getAddress(), data: ctx.henium.interface.encodeFunctionData("burn", [1n]) })).to
        .not.be.reverted;
      await ctx.weth.connect(ctx.alice).transfer(await pair.getAddress(), amount);
      const [rIn, rOut] = await reservesFor(pair, await ctx.weth.getAddress());
      const out = amountOut(amount, rIn, rOut);
      const wethIs0 = (await pair.token0()) === (await ctx.weth.getAddress());
      await expect(pair.swap(wethIs0 ? 0n : out, wethIs0 ? out : 0n, ctx.alice.address, "0x"))
        .to.emit(pair, "FeeBurned")
        .withArgs(await ctx.weth.getAddress(), burnPart(amount));
      expect(await ctx.weth.balanceOf(DEAD)).to.equal(burnPart(amount));
      expect((await reservesFor(pair, await ctx.weth.getAddress()))[0]).to.equal(rIn + amount - burnPart(amount));
    });

    it("never trusts burn(): no-op, partial, over-burning and fully-refusing tokens", async () => {
      const ctx = await loadFixture(dexFixture);
      const tricky = (await ethers.deployContract("TrickyBurnToken")) as unknown as TrickyBurnToken;
      await tricky.mint(ctx.lp.address, 10n ** 30n);
      await tricky.connect(ctx.lp).approve(await ctx.router.getAddress(), ethers.MaxUint256);
      const pair = await ctx.addLiquidity(tricky as unknown as Erc20Like, ctx.henium, 1_000_000n * E18, 1_000n * E18);
      const T = tricky as unknown as Erc20Like;
      const amount = 10_000n * E18;
      const fee = burnPart(amount);

      await tricky.setMode(1); // NOOP: returns success, burns nothing -> rest goes to dEaD
      await directSwap(pair, T, amount, ctx.lp, ctx.lp.address);
      expect(await tricky.balanceOf(DEAD)).to.equal(fee);

      await tricky.setMode(2); // PARTIAL: burns half -> the other half goes to dEaD
      const supply = await tricky.totalSupply();
      await directSwap(pair, T, amount, ctx.lp, ctx.lp.address);
      expect(supply - (await tricky.totalSupply())).to.equal(fee / 2n);
      expect(await tricky.balanceOf(DEAD)).to.equal(fee + (fee - fee / 2n));

      await tricky.setMode(3); // OVERBURN: wipes the pool's balance -> the k-check on real balances fails
      await expect(directSwap(pair, T, amount, ctx.lp, ctx.lp.address)).to.be.revertedWithCustomError(pair, "K");
      await pair.skim(ctx.lp.address); // the transfer before the failed swap stayed in the pair as a donation

      await tricky.setMode(4); // REVERT_ALL: neither burn nor dEaD works -> the fee stays with LPs, swap still works
      const [rIn, rOut] = await reservesFor(pair, await tricky.getAddress());
      const tx = await tricky.connect(ctx.lp).transfer(await pair.getAddress(), amount);
      await tx.wait();
      const out = amountOut(amount, rIn, rOut);
      const trickyIs0 = (await pair.token0()) === (await tricky.getAddress());
      await expect(pair.swap(trickyIs0 ? 0n : out, trickyIs0 ? out : 0n, ctx.lp.address, "0x")).to.not.emit(pair, "FeeBurned");
      expect((await reservesFor(pair, await tricky.getAddress()))[0]).to.equal(rIn + amount);
    });

    it("works with tokens that return nothing (USDT-style) and parks their fee at 0x…dEaD", async () => {
      const ctx = await loadFixture(dexFixture);
      const usdt = (await ethers.deployContract("NoReturnToken")) as unknown as NoReturnToken;
      await usdt.mint(ctx.lp.address, 10n ** 30n);
      await usdt.connect(ctx.lp).approve(await ctx.router.getAddress(), ethers.MaxUint256);
      const pair = await ctx.addLiquidity(usdt as unknown as Erc20Like, ctx.henium, 1_000_000n * E18, 1_000n * E18);
      await directSwap(pair, usdt as unknown as Erc20Like, 5_000n * E18, ctx.lp, ctx.lp.address);
      expect(await usdt.balanceOf(DEAD)).to.equal(burnPart(5_000n * E18));
      // and as the output token
      const henBefore = await usdt.balanceOf(ctx.bob.address);
      await directSwap(pair, ctx.henium as unknown as Erc20Like, 10n * E18, ctx.alice, ctx.bob.address);
      expect(await usdt.balanceOf(ctx.bob.address)).to.be.greaterThan(henBefore);
    });

    it("burns nothing on dust inputs below 1,000 wei", async () => {
      const ctx = await loadFixture(pairFixture);
      const supply = await ctx.henium.totalSupply();
      await directSwap(ctx.pair, ctx.henium as unknown as Erc20Like, 999_999n, ctx.alice, ctx.alice.address);
      expect(await ctx.henium.totalSupply()).to.equal(supply - 999n);
      const supply2 = await ctx.henium.totalSupply();
      await directSwap(ctx.pair, ctx.henium as unknown as Erc20Like, 999n, ctx.alice, ctx.alice.address, 1n);
      expect(await ctx.henium.totalSupply()).to.equal(supply2);
    });

    it("enforces the k-check: out + 1 fails when the burn has no rounding", async () => {
      const ctx = await loadFixture(pairFixture);
      const amount = 1_000n * E18; // a multiple of 1,000 wei: the burn is exact, the bound is tight
      const [rIn, rOut] = await reservesFor(ctx.pair, await ctx.henium.getAddress());
      const out = amountOut(amount, rIn, rOut);
      await expect(
        directSwap(ctx.pair, ctx.henium as unknown as Erc20Like, amount, ctx.alice, ctx.alice.address, out + 1n),
      ).to.be.revertedWithCustomError(ctx.pair, "K");
      await directSwap(ctx.pair, ctx.henium as unknown as Erc20Like, amount, ctx.alice, ctx.alice.address, out);
    });

    it("validates outputs, recipients and inputs", async () => {
      const ctx = await loadFixture(pairFixture);
      const { pair } = ctx;
      const [r0, r1] = await pair.getReserves();
      await expect(pair.swap(0n, 0n, ctx.alice.address, "0x")).to.be.revertedWithCustomError(pair, "InsufficientOutputAmount");
      await expect(pair.swap(r0, 0n, ctx.alice.address, "0x")).to.be.revertedWithCustomError(pair, "InsufficientLiquidity");
      await expect(pair.swap(0n, r1, ctx.alice.address, "0x")).to.be.revertedWithCustomError(pair, "InsufficientLiquidity");
      await expect(pair.swap(1n, 0n, await pair.token0(), "0x")).to.be.revertedWithCustomError(pair, "InvalidTo");
      await expect(pair.swap(1n, 0n, await pair.token1(), "0x")).to.be.revertedWithCustomError(pair, "InvalidTo");
      await expect(pair.swap(1n, 0n, ctx.alice.address, "0x")).to.be.revertedWithCustomError(pair, "InsufficientInputAmount");
    });
  });

  describe("skim / sync", () => {
    it("skim returns donations without moving the price; sync adopts them", async () => {
      const ctx = await loadFixture(pairFixture);
      const { pair } = ctx;
      const [r0, r1] = await pair.getReserves();
      const t0 = (await ethers.getContractAt("IERC20", await pair.token0())) as unknown as Erc20Like;
      await t0.connect(ctx.alice).transfer(await pair.getAddress(), 5n * E18);
      const before = await t0.balanceOf(ctx.carol.address);
      await pair.skim(ctx.carol.address);
      expect((await t0.balanceOf(ctx.carol.address)) - before).to.equal(5n * E18);
      const [s0, s1] = await pair.getReserves();
      expect([s0, s1]).to.deep.equal([r0, r1]);

      await t0.connect(ctx.alice).transfer(await pair.getAddress(), 7n * E18);
      await expect(pair.sync()).to.emit(pair, "Sync").withArgs(r0 + 7n * E18, r1);
    });

    it("refuses balances above 2^112 (mint, swap and sync)", async () => {
      const ctx = await loadFixture(dexFixture);
      const pair = await ctx.addLiquidity(ctx.egg, ctx.henium, 1_000n * E18, 1_000n * E18);
      // 2^113: still above 2^112 after the swap path removes its 0.10% fee
      const huge = 2n ** 113n;
      await ctx.egg.mint(await pair.getAddress(), huge);
      await expect(pair.sync()).to.be.revertedWithCustomError(pair, "Overflow");
      await expect(pair.mint(ctx.lp.address)).to.be.revertedWithCustomError(pair, "Overflow");
      const eggIs0 = (await pair.token0()) === (await ctx.egg.getAddress());
      await expect(pair.swap(eggIs0 ? 0n : 1n, eggIs0 ? 1n : 0n, ctx.alice.address, "0x")).to.be.revertedWithCustomError(pair, "Overflow");
      await pair.skim(ctx.alice.address); // the donation can be recovered
      await pair.sync();
    });
  });

  describe("both token sides", () => {
    type Mintable = Erc20Like & { mint(to: string, v: bigint): Promise<unknown> };

    /** A pool of two freely mintable mocks, seeded with `amount0` of token0 and `amount1` of token1. */
    async function mockPool(ctx: Awaited<ReturnType<typeof dexFixture>>, amount0: bigint, amount1: bigint) {
      const x = (await ethers.deployContract("MockERC20", ["X", "X", 18])) as unknown as Mintable;
      const y = (await ethers.deployContract("MockERC20", ["Y", "Y", 18])) as unknown as Mintable;
      await ctx.factory.createPair(await x.getAddress(), await y.getAddress());
      const pair = await ctx.pairOf(x, y);
      const [t0, t1] = (await pair.token0()) === (await x.getAddress()) ? [x, y] : [y, x];
      await t0.mint(await pair.getAddress(), amount0);
      await t1.mint(await pair.getAddress(), amount1);
      await pair.mint(ctx.lp.address);
      return { pair, t0, t1 };
    }

    it("guards uint112 overflow on either token (mint, swap, sync)", async () => {
      const ctx = await loadFixture(dexFixture);
      const { pair, t0, t1 } = await mockPool(ctx, 1_000n * E18, 1_000n * E18);
      for (const [donated, is0] of [
        [t1, false],
        [t0, true],
      ] as const) {
        await donated.mint(await pair.getAddress(), 2n ** 113n);
        await expect(pair.mint(ctx.lp.address)).to.be.revertedWithCustomError(pair, "Overflow");
        await expect(pair.sync()).to.be.revertedWithCustomError(pair, "Overflow");
        // take 1 wei of the other token, paying with the donation
        await expect(pair.swap(is0 ? 0n : 1n, is0 ? 1n : 0n, ctx.alice.address, "0x")).to.be.revertedWithCustomError(pair, "Overflow");
        await pair.skim(ctx.alice.address);
      }
    });

    it("rejects a burn that rounds either side to zero", async () => {
      const ctx = await loadFixture(dexFixture);
      for (const [a0, a1] of [
        [1_000_000n, 10n ** 30n],
        [10n ** 30n, 1_000_000n],
      ]) {
        const { pair } = await mockPool(ctx, a0, a1); // LP supply = 1e18; 1 wei of LP = 1e-12 wei of the small side
        await pair.connect(ctx.lp).transfer(await pair.getAddress(), 1n);
        await expect(pair.burn(ctx.lp.address)).to.be.revertedWithCustomError(pair, "InsufficientLiquidityBurned");
      }
    });

    it("fails the k-check when either token removes more than asked", async () => {
      const ctx = await loadFixture(dexFixture);
      const a = (await ethers.deployContract("TrickyBurnToken")) as unknown as TrickyBurnToken;
      const b = (await ethers.deployContract("TrickyBurnToken")) as unknown as TrickyBurnToken;
      await ctx.factory.createPair(await a.getAddress(), await b.getAddress());
      const pair = await ctx.pairOf(await a.getAddress(), await b.getAddress());
      for (const t of [a, b]) await t.mint(await pair.getAddress(), 1_000_000n * E18);
      await pair.mint(ctx.lp.address);
      for (const t of [a, b]) {
        const tIs0 = (await pair.token0()) === (await t.getAddress());
        await t.setMode(3); // OVERBURN
        await t.mint(await pair.getAddress(), 1_000n * E18);
        const out = amountOut(1_000n * E18, 1_000_000n * E18, 1_000_000n * E18);
        await expect(pair.swap(tIs0 ? 0n : out, tIs0 ? out : 0n, ctx.alice.address, "0x")).to.be.revertedWithCustomError(pair, "K");
        await t.setMode(0);
        await pair.skim(ctx.alice.address);
      }
    });
  });

  describe("TWAP accumulators", () => {
    const Q112 = 2n ** 112n;

    it("accumulate reserve1/reserve0 (UQ112x112) times the seconds since the last update", async () => {
      const ctx = await loadFixture(pairFixture);
      const { pair } = ctx;
      const [r0, r1, tLast] = await pair.getReserves();
      expect(await pair.price0CumulativeLast()).to.equal(0n); // the first mint had no previous reserves
      await time.setNextBlockTimestamp(BigInt(tLast) + 100n);
      await pair.sync();
      expect(await pair.price0CumulativeLast()).to.equal(((r1 * Q112) / r0) * 100n);
      expect(await pair.price1CumulativeLast()).to.equal(((r0 * Q112) / r1) * 100n);
      // a swap at +250 s accumulates the pre-swap reserves for 150 s
      await time.setNextBlockTimestamp(BigInt(tLast) + 249n);
      await ctx.henium.connect(ctx.alice).transfer(await pair.getAddress(), 50n * E18);
      const [rIn, rOut] = await reservesFor(pair, await ctx.henium.getAddress());
      const out = amountOut(50n * E18, rIn, rOut);
      const heniumIs0 = (await pair.token0()) === (await ctx.henium.getAddress());
      await time.setNextBlockTimestamp(BigInt(tLast) + 250n);
      await pair.swap(heniumIs0 ? 0n : out, heniumIs0 ? out : 0n, ctx.alice.address, "0x");
      expect(await pair.price0CumulativeLast()).to.equal(((r1 * Q112) / r0) * 250n);
      const [, , t2] = await pair.getReserves();
      expect(BigInt(t2)).to.equal(BigInt(tLast) + 250n);
    });

    it("updates once per block and survives the uint32 timestamp wrap-around", async () => {
      const ctx = await loadFixture(pairFixture);
      const { pair } = ctx;
      const [r0, r1] = await pair.getReserves();
      const p = (r1 * Q112) / r0;
      // jump to just before 2^32 seconds (year 2106)
      const nearWrap = 2n ** 32n - 10n;
      await time.setNextBlockTimestamp(nearWrap);
      await pair.sync();
      const acc = await pair.price0CumulativeLast();
      await time.setNextBlockTimestamp(2n ** 32n + 20n); // uint32(ts) wrapped to 20
      await pair.sync();
      expect((await pair.getReserves())[2]).to.equal(20n);
      expect((await pair.price0CumulativeLast()) - acc).to.equal(p * 30n);

      // two updates in the same block: the second adds nothing
      await network.provider.send("evm_setAutomine", [false]);
      try {
        const acc2 = await pair.price0CumulativeLast();
        const tx1 = await pair.sync({ gasLimit: 200_000 });
        const tx2 = await pair.sync({ gasLimit: 200_000 });
        await network.provider.send("evm_setNextBlockTimestamp", [Number(2n ** 32n + 25n)]);
        await network.provider.send("evm_mine");
        await tx1.wait();
        await tx2.wait();
        expect((await pair.price0CumulativeLast()) - acc2).to.equal(p * 5n);
      } finally {
        await network.provider.send("evm_setAutomine", [true]);
      }
    });
  });

  describe("flash swaps and reentrancy", () => {
    async function flashFixture() {
      const ctx = await pairFixture();
      const borrower = (await ethers.deployContract("FlashBorrower")) as unknown as FlashBorrower;
      await ctx.henium.transfer(await borrower.getAddress(), 1_000n * E18); // to pay fees
      await ctx.stone.transfer(await borrower.getAddress(), 1_000_000n * E18);
      return { ...ctx, borrower };
    }

    it("lends optimistically and requires repayment plus the 0.30% fee", async () => {
      const ctx = await loadFixture(flashFixture);
      const { pair, borrower } = ctx;
      const heniumIs0 = (await pair.token0()) === (await ctx.henium.getAddress());
      const borrow = 100n * E18;
      // repaying in the same token needs in*9970 >= out*10000 (plus the burn rounding): ~0.3009%
      const repay = (borrow * 10_000n) / 9_970n + 1n;
      const supply = await ctx.henium.totalSupply();
      await borrower.flash(pair, heniumIs0 ? borrow : 0n, heniumIs0 ? 0n : borrow, 0, heniumIs0 ? repay : 0n, heniumIs0 ? 0n : repay);
      expect(await borrower.lastSender()).to.equal(await borrower.getAddress()); // msg.sender of swap()
      expect(await borrower.lastAmount0()).to.equal(heniumIs0 ? borrow : 0n);
      expect(await ctx.henium.totalSupply()).to.equal(supply - burnPart(repay)); // the fee burn applies to the repayment
      // repaying too little fails the k-check
      const short = (borrow * 10_000n) / 9_970n - 1n;
      await expect(
        borrower.flash(pair, heniumIs0 ? borrow : 0n, heniumIs0 ? 0n : borrow, 0, heniumIs0 ? short : 0n, heniumIs0 ? 0n : short),
      ).to.be.revertedWithCustomError(pair, "K");
    });

    it("blocks re-entering swap / mint / burn / skim / sync from the callback", async () => {
      const ctx = await loadFixture(flashFixture);
      const { pair, borrower } = ctx;
      for (const mode of [1, 2, 3, 4, 5]) {
        await expect(borrower.flash(pair, 1n * E18, 0n, mode, 0n, 0n), `mode ${mode}`).to.be.revertedWithCustomError(
          pair,
          "ReentrancyGuardReentrantCall",
        );
      }
    });

    it("blocks a malicious token that re-enters from transfer(), and one that re-enters from burn()", async () => {
      const ctx = await loadFixture(dexFixture);
      const hook = (await ethers.deployContract("HookToken")) as unknown as HookToken;
      await hook.mint(ctx.lp.address, 10n ** 30n);
      await hook.connect(ctx.lp).approve(await ctx.router.getAddress(), ethers.MaxUint256);
      const pair = (await ctx.addLiquidity(hook as unknown as Erc20Like, ctx.henium, 1_000_000n * E18, 1_000n * E18)) as HeniumDexPair;
      const H = hook as unknown as Erc20Like;
      const pairAddr = await pair.getAddress();
      const syncData = pair.interface.encodeFunctionData("sync");
      const reentrantSelector = pair.interface.getError("ReentrancyGuardReentrantCall")!.selector;

      // 1. hook in transfer() (fires when the pair pays HOOK out), bubbling: the whole swap reverts
      await hook.arm(1, pairAddr, syncData, true);
      await expect(directSwap(pair, ctx.henium as unknown as Erc20Like, 10n * E18, ctx.alice, ctx.alice.address)).to.be.revertedWithCustomError(
        pair,
        "ReentrancyGuardReentrantCall",
      );

      // 2. hook in burn() (fires during the fee burn of a HOOK input), not bubbling: the re-entrant call fails,
      //    the swap completes, the state stays consistent
      await hook.arm(2, pairAddr, pair.interface.encodeFunctionData("swap", [1n, 1n, ctx.mallory.address, "0x"]), false);
      await directSwap(pair, H, 1_000n * E18, ctx.lp, ctx.lp.address);
      expect(await hook.hookCalled()).to.equal(true);
      expect(await hook.hookSucceeded()).to.equal(false);
      expect((await hook.hookReturnData()).slice(0, 10)).to.equal(reentrantSelector);
      const [r0, r1] = await pair.getReserves();
      const b0 = await (await ethers.getContractAt("IERC20", await pair.token0())).balanceOf(pairAddr);
      const b1 = await (await ethers.getContractAt("IERC20", await pair.token1())).balanceOf(pairAddr);
      expect([r0, r1]).to.deep.equal([b0, b1]);

      // 3. hook in burn(), bubbling: burn() reverts inside try/catch -> the fee goes to 0x…dEaD instead
      await hook.arm(2, pairAddr, syncData, true);
      const deadBefore = await hook.balanceOf(DEAD);
      await directSwap(pair, H, 1_000n * E18, ctx.lp, ctx.lp.address);
      expect((await hook.balanceOf(DEAD)) - deadBefore).to.equal(burnPart(1_000n * E18));
    });
  });

  describe("LP token", () => {
    it("supports EIP-2612 permit", async () => {
      const ctx = await loadFixture(pairFixture);
      const { pair } = ctx;
      const { chainId } = await ethers.provider.getNetwork();
      const deadline = BigInt(await time.latest()) + 600n;
      const domain = { name: "Henium DEX LP", version: "1", chainId, verifyingContract: await pair.getAddress() };
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
        await ctx.lp.signTypedData(domain, types, { owner: ctx.lp.address, spender: ctx.bob.address, value: 9n, nonce: 0n, deadline }),
      );
      await pair.permit(ctx.lp.address, ctx.bob.address, 9n, deadline, sig.v, sig.r, sig.s);
      expect(await pair.allowance(ctx.lp.address, ctx.bob.address)).to.equal(9n);
    });
  });
});
