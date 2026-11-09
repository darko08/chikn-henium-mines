import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { HeniumDexRouter, RejectingCaller } from "../../typechain-types";
import { DEAD, E18, MINIMUM_LIQUIDITY, amountIn, amountOut, burnPart, dexFixture, reservesFor, sqrt, type Erc20Like } from "../helpers/dex";

describe("HeniumDexRouter", () => {
  async function routerFixture() {
    const ctx = await dexFixture();
    const { router, lp } = ctx;
    const d = await ctx.deadline();
    const H = await ctx.henium.getAddress();
    await router.connect(lp).addLiquidityETH(H, 10_000n * E18, 0n, 0n, lp.address, d, { value: 4n * E18 });
    const heniumWeth = await ctx.pairOf(ctx.henium, ctx.weth);
    const eggHenium = await ctx.addLiquidity(ctx.egg, ctx.henium, 10_000n * E18, 2_500n * E18);
    const stoneHenium = await ctx.addLiquidity(ctx.stone, ctx.henium, 100_000_000n * E18, 4_000n * E18);
    const addr = {
      H,
      W: await ctx.weth.getAddress(),
      EGG: await ctx.egg.getAddress(),
      STONE: await ctx.stone.getAddress(),
      router: await router.getAddress(),
    };
    return { ...ctx, heniumWeth, eggHenium, stoneHenium, addr };
  }

  /** ETH received by `who` from the transaction `send()` starts (gas paid by `who` added back). The balance is read
   *  before `send` is called, so the transaction cannot race the first read. */
  const ethDelta = async (who: string, send: () => Promise<{ wait: () => Promise<{ gasUsed: bigint; gasPrice: bigint; from: string } | null> }>) => {
    const before = await ethers.provider.getBalance(who);
    const receipt = (await (await send()).wait())!;
    const gas = receipt.from.toLowerCase() === who.toLowerCase() ? receipt.gasUsed * receipt.gasPrice : 0n;
    return (await ethers.provider.getBalance(who)) + gas - before;
  };

  describe("setup", () => {
    it("stores factory and WETH, and rejects zero addresses", async () => {
      const ctx = await loadFixture(routerFixture);
      expect(await ctx.router.factory()).to.equal(await ctx.factory.getAddress());
      expect(await ctx.router.WETH()).to.equal(ctx.addr.W);
      const F = await ethers.getContractFactory("HeniumDexRouter");
      await expect(F.deploy(ethers.ZeroAddress, ctx.addr.W)).to.be.revertedWithCustomError(F, "ZeroAddress");
      await expect(F.deploy(await ctx.factory.getAddress(), ethers.ZeroAddress)).to.be.revertedWithCustomError(F, "ZeroAddress");
    });

    it("accepts ETH only from WETH", async () => {
      const ctx = await loadFixture(routerFixture);
      await expect(ctx.alice.sendTransaction({ to: ctx.addr.router, value: 1n })).to.be.revertedWithCustomError(ctx.router, "OnlyWETH");
    });
  });

  describe("quotes", () => {
    it("implements the fee formula with exact integer rounding", async () => {
      const { router } = await loadFixture(routerFixture);
      expect(await router.getAmountOut(1_000n, 100_000n, 100_000n)).to.equal(amountOut(1_000n, 100_000n, 100_000n));
      expect(await router.getAmountOut(E18, 5n * E18, 10n * E18)).to.equal((E18 * 9970n * 10n * E18) / (5n * E18 * 10000n + E18 * 9970n));
      expect(await router.getAmountIn(E18, 5n * E18, 10n * E18)).to.equal((5n * E18 * E18 * 10000n) / ((9n * E18) * 9970n) + 1n);
      expect(await router.quote(3n, 10n, 20n)).to.equal(6n);
    });

    it("rejects degenerate inputs", async () => {
      const { router } = await loadFixture(routerFixture);
      await expect(router.getAmountOut(0n, 1n, 1n)).to.be.revertedWithCustomError(router, "ZeroInputAmount");
      await expect(router.getAmountOut(1n, 0n, 1n)).to.be.revertedWithCustomError(router, "InsufficientLiquidity");
      await expect(router.getAmountOut(1n, 1n, 0n)).to.be.revertedWithCustomError(router, "InsufficientLiquidity");
      await expect(router.getAmountIn(0n, 1n, 1n)).to.be.revertedWithCustomError(router, "ZeroOutputAmount");
      await expect(router.getAmountIn(1n, 0n, 10n)).to.be.revertedWithCustomError(router, "InsufficientLiquidity");
      await expect(router.getAmountIn(10n, 10n, 10n)).to.be.revertedWithCustomError(router, "InsufficientLiquidity");
      await expect(router.quote(0n, 1n, 1n)).to.be.revertedWithCustomError(router, "ZeroAmount");
      await expect(router.quote(1n, 0n, 1n)).to.be.revertedWithCustomError(router, "InsufficientLiquidity");
      await expect(router.quote(1n, 1n, 0n)).to.be.revertedWithCustomError(router, "InsufficientLiquidity");
    });

    it("chains quotes along multi-hop paths and validates paths", async () => {
      const ctx = await loadFixture(routerFixture);
      const { router, addr } = ctx;
      const path = [addr.STONE, addr.H, addr.W];
      const amounts = await router.getAmountsOut(1_000_000n * E18, path);
      const [s1, h1] = await reservesFor(ctx.stoneHenium, addr.STONE);
      const [h2, w2] = await reservesFor(ctx.heniumWeth, addr.H);
      expect(amounts[1]).to.equal(amountOut(1_000_000n * E18, s1, h1));
      expect(amounts[2]).to.equal(amountOut(amounts[1], h2, w2));
      const back = await router.getAmountsIn(amounts[2], path);
      expect(back[2]).to.equal(amounts[2]);
      expect(back[1]).to.equal(amountIn(amounts[2], h2, w2));
      expect(back[0]).to.equal(amountIn(back[1], s1, h1));
      expect(back[0]).to.be.lessThanOrEqual(1_000_000n * E18 + 2n);
      await expect(router.getAmountsOut(1n, [addr.H])).to.be.revertedWithCustomError(router, "InvalidPath");
      await expect(router.getAmountsIn(1n, [])).to.be.revertedWithCustomError(router, "InvalidPath");
      await expect(router.getAmountsOut(1n, [addr.STONE, addr.W]))
        .to.be.revertedWithCustomError(router, "PairNotFound")
        .withArgs(addr.STONE, addr.W);
      const [ra, rb] = await router.getReserves(addr.W, addr.H);
      const [rh, rw] = await reservesFor(ctx.heniumWeth, addr.H);
      expect([ra, rb]).to.deep.equal([rw, rh]);
    });
  });

  describe("liquidity", () => {
    it("addLiquidity creates the pair on first use and mints sqrt(a*b) - MINIMUM_LIQUIDITY", async () => {
      const ctx = await loadFixture(dexFixture);
      const [a, b] = [await ctx.stone.getAddress(), await ctx.egg.getAddress()];
      const args = [a, b, 9n * E18, 4n * E18, 0n, 0n, ctx.lp.address, await ctx.deadline()] as const;
      const [amountA, amountB, liquidity] = await ctx.router.connect(ctx.lp).addLiquidity.staticCall(...args);
      expect([amountA, amountB, liquidity]).to.deep.equal([9n * E18, 4n * E18, 6n * E18 - MINIMUM_LIQUIDITY]);
      await expect(ctx.router.connect(ctx.lp).addLiquidity(...args)).to.emit(ctx.factory, "PairCreated");
      const pair = await ctx.pairOf(a, b);
      expect(await pair.balanceOf(ctx.lp.address)).to.equal(sqrt(36n * E18 * E18) - MINIMUM_LIQUIDITY);
    });

    it("adds in the current ratio, honouring minimums on both sides", async () => {
      const ctx = await loadFixture(routerFixture);
      const { router, addr, alice } = ctx;
      const d = await ctx.deadline();
      const [rEgg, rH] = await reservesFor(ctx.eggHenium, addr.EGG);
      // B side too generous: uses the optimal B
      const bOpt = (1_000n * E18 * rH) / rEgg;
      let r = await router.connect(alice).addLiquidity.staticCall(addr.EGG, addr.H, 1_000n * E18, 10_000n * E18, 0n, 0n, alice.address, d);
      expect([r[0], r[1]]).to.deep.equal([1_000n * E18, bOpt]);
      await expect(router.connect(alice).addLiquidity(addr.EGG, addr.H, 1_000n * E18, 10_000n * E18, 0n, bOpt + 1n, alice.address, d))
        .to.be.revertedWithCustomError(router, "InsufficientBAmount")
        .withArgs(bOpt, bOpt + 1n);
      // B side short: uses the optimal A
      const aOpt = (100n * E18 * rEgg) / rH;
      r = await router.connect(alice).addLiquidity.staticCall(addr.EGG, addr.H, 10_000n * E18, 100n * E18, 0n, 0n, alice.address, d);
      expect([r[0], r[1]]).to.deep.equal([aOpt, 100n * E18]);
      await expect(router.connect(alice).addLiquidity(addr.EGG, addr.H, 10_000n * E18, 100n * E18, aOpt + 1n, 0n, alice.address, d))
        .to.be.revertedWithCustomError(router, "InsufficientAAmount")
        .withArgs(aOpt, aOpt + 1n);
      await router.connect(alice).addLiquidity(addr.EGG, addr.H, 10_000n * E18, 100n * E18, aOpt, 100n * E18, alice.address, d);
      expect(await ctx.eggHenium.balanceOf(alice.address)).to.equal(r[2]);
    });

    it("addLiquidityETH wraps exactly what is needed and refunds the rest", async () => {
      const ctx = await loadFixture(routerFixture);
      const { router, addr, alice } = ctx;
      const d = await ctx.deadline();
      const [rH, rW] = await reservesFor(ctx.heniumWeth, addr.H);
      const ethNeeded = (100n * E18 * rW) / rH;
      const spent = -(await ethDelta(alice.address, () => router.connect(alice).addLiquidityETH(addr.H, 100n * E18, 0n, 0n, alice.address, d, { value: 5n * E18 })));
      expect(spent).to.equal(ethNeeded);
      expect(await ethers.provider.getBalance(addr.router)).to.equal(0n);
      expect(await ctx.weth.balanceOf(addr.router)).to.equal(0n);
      // a 5 ETH budget but a 5 ETH minimum: the ratio only needs ~0.04 ETH, so the minimum is violated
      await expect(
        router.connect(alice).addLiquidityETH(addr.H, 100n * E18, 0n, 5n * E18, alice.address, d, { value: 5n * E18 }),
      ).to.be.revertedWithCustomError(router, "InsufficientBAmount");
    });

    it("reverts when an ETH refund cannot be delivered", async () => {
      const ctx = await loadFixture(routerFixture);
      const caller = (await ethers.deployContract("RejectingCaller")) as unknown as RejectingCaller;
      const cAddr = await caller.getAddress();
      await ctx.henium.transfer(cAddr, 100n * E18);
      await caller.execute(ctx.addr.H, 0n, ctx.henium.interface.encodeFunctionData("approve", [ctx.addr.router, ethers.MaxUint256]));
      const data = ctx.router.interface.encodeFunctionData("addLiquidityETH", [ctx.addr.H, 10n * E18, 0n, 0n, cAddr, await ctx.deadline()]);
      await expect(caller.execute(ctx.addr.router, 1n * E18, data, { value: 1n * E18 })).to.be.revertedWithCustomError(ctx.router, "ETHTransferFailed");
    });

    it("removeLiquidity returns the pro-rata share, in the caller's token order, honouring minimums", async () => {
      const ctx = await loadFixture(routerFixture);
      const { router, addr, lp } = ctx;
      const pair = ctx.eggHenium;
      await pair.connect(lp).approve(addr.router, ethers.MaxUint256);
      const liquidity = (await pair.balanceOf(lp.address)) / 4n;
      const supply = await pair.totalSupply();
      const [rEgg, rH] = await reservesFor(pair, addr.EGG);
      const eggOut = (liquidity * rEgg) / supply;
      const hOut = (liquidity * rH) / supply;
      const d = await ctx.deadline();
      // ask in reverse order (HENIUM first): amounts come back in that order
      const simulated = await router.connect(lp).removeLiquidity.staticCall(addr.H, addr.EGG, liquidity, 0n, 0n, lp.address, d);
      expect([...simulated]).to.deep.equal([hOut, eggOut]);
      await expect(router.connect(lp).removeLiquidity(addr.EGG, addr.H, liquidity, eggOut + 1n, 0n, lp.address, d))
        .to.be.revertedWithCustomError(router, "InsufficientAAmount")
        .withArgs(eggOut, eggOut + 1n);
      await expect(router.connect(lp).removeLiquidity(addr.EGG, addr.H, liquidity, 0n, hOut + 1n, lp.address, d))
        .to.be.revertedWithCustomError(router, "InsufficientBAmount")
        .withArgs(hOut, hOut + 1n);
      const before = await ctx.egg.balanceOf(ctx.carol.address);
      await router.connect(lp).removeLiquidity(addr.EGG, addr.H, liquidity, eggOut, hOut, ctx.carol.address, d);
      expect((await ctx.egg.balanceOf(ctx.carol.address)) - before).to.equal(eggOut);
      await expect(router.connect(lp).removeLiquidity(addr.EGG, addr.W, 1n, 0n, 0n, lp.address, d)).to.be.revertedWithCustomError(router, "PairNotFound");
    });

    it("removeLiquidityETH pays the WETH side as native ETH", async () => {
      const ctx = await loadFixture(routerFixture);
      const { router, addr, lp, bob } = ctx;
      const pair = ctx.heniumWeth;
      await pair.connect(lp).approve(addr.router, ethers.MaxUint256);
      const liquidity = (await pair.balanceOf(lp.address)) / 2n;
      const supply = await pair.totalSupply();
      const [rH, rW] = await reservesFor(pair, addr.H);
      const ethShare = (liquidity * rW) / supply;
      const hShare = (liquidity * rH) / supply;
      const d = await ctx.deadline();
      await expect(router.connect(lp).removeLiquidityETH(addr.H, liquidity, hShare + 1n, 0n, bob.address, d))
        .to.be.revertedWithCustomError(router, "InsufficientAAmount")
        .withArgs(hShare, hShare + 1n);
      await expect(router.connect(lp).removeLiquidityETH(addr.H, liquidity, 0n, ethShare + 1n, bob.address, d))
        .to.be.revertedWithCustomError(router, "InsufficientBAmount")
        .withArgs(ethShare, ethShare + 1n);
      const ethBefore = await ethers.provider.getBalance(bob.address); // bob sends nothing: an exact delta
      const hBefore = await ctx.henium.balanceOf(bob.address);
      await router.connect(lp).removeLiquidityETH(addr.H, liquidity, hShare, ethShare, bob.address, d);
      expect((await ethers.provider.getBalance(bob.address)) - ethBefore).to.equal(ethShare);
      expect((await ctx.henium.balanceOf(bob.address)) - hBefore).to.equal(hShare);
      expect(await ctx.weth.balanceOf(addr.router)).to.equal(0n);
      expect(await ethers.provider.getBalance(addr.router)).to.equal(0n);
      const past = BigInt(await time.latest());
      await expect(router.connect(lp).removeLiquidityETH(addr.H, 1n, 0n, 0n, bob.address, past))
        .to.be.revertedWithCustomError(router, "Expired")
        .withArgs(past);
    });
  });

  describe("swaps", () => {
    it("swapExactTokensForTokens pays exactly the quote, honours amountOutMin and the deadline", async () => {
      const ctx = await loadFixture(routerFixture);
      const { router, addr, trader } = ctx;
      const path = [addr.EGG, addr.H];
      const quoted = await router.getAmountsOut(100n * E18, path);
      const d = await ctx.deadline();
      await expect(router.connect(trader).swapExactTokensForTokens(100n * E18, quoted[1] + 1n, path, trader.address, d))
        .to.be.revertedWithCustomError(router, "InsufficientOutputAmount")
        .withArgs(quoted[1], quoted[1] + 1n);
      const past = BigInt(await time.latest());
      await expect(router.connect(trader).swapExactTokensForTokens(100n * E18, 0n, path, trader.address, past))
        .to.be.revertedWithCustomError(router, "Expired")
        .withArgs(past);
      const before = await ctx.henium.balanceOf(ctx.carol.address);
      const simulated = await router.connect(trader).swapExactTokensForTokens.staticCall(100n * E18, quoted[1], path, ctx.carol.address, d);
      expect([...simulated]).to.deep.equal([...quoted]);
      await router.connect(trader).swapExactTokensForTokens(100n * E18, quoted[1], path, ctx.carol.address, d);
      expect((await ctx.henium.balanceOf(ctx.carol.address)) - before).to.equal(quoted[1]);
      // the EGG stand-in is not burnable: its 0.10% went to 0x…dEaD
      expect(await ctx.egg.balanceOf(DEAD)).to.equal(burnPart(100n * E18));
      await expect(router.connect(trader).swapExactTokensForTokens(1n, 0n, [addr.EGG], trader.address, d)).to.be.revertedWithCustomError(
        router,
        "InvalidPath",
      );
      // ETH variants: empty paths, and a lone WETH
      await expect(router.connect(trader).swapExactETHForTokens(0n, [], trader.address, d, { value: 1n })).to.be.revertedWithCustomError(router, "InvalidPath");
      await expect(router.connect(trader).swapExactETHForTokens(0n, [addr.W], trader.address, d, { value: 1n })).to.be.revertedWithCustomError(router, "InvalidPath");
      await expect(router.connect(trader).swapETHForExactTokens(1n, [], trader.address, d, { value: 1n })).to.be.revertedWithCustomError(router, "InvalidPath");
      await expect(router.connect(trader).swapExactTokensForETH(1n, 0n, [], trader.address, d)).to.be.revertedWithCustomError(router, "InvalidPath");
      await expect(router.connect(trader).swapTokensForExactETH(1n, 1n, [], trader.address, d)).to.be.revertedWithCustomError(router, "InvalidPath");
    });

    it("swapTokensForExactTokens pays exactly amountOut for the quoted input, honouring amountInMax", async () => {
      const ctx = await loadFixture(routerFixture);
      const { router, addr, trader } = ctx;
      const path = [addr.H, addr.EGG];
      const want = 123n * E18;
      const quoted = await router.getAmountsIn(want, path);
      const d = await ctx.deadline();
      await expect(router.connect(trader).swapTokensForExactTokens(want, quoted[0] - 1n, path, trader.address, d))
        .to.be.revertedWithCustomError(router, "ExcessiveInputAmount")
        .withArgs(quoted[0], quoted[0] - 1n);
      const eggBefore = await ctx.egg.balanceOf(trader.address);
      const hBefore = await ctx.henium.balanceOf(trader.address);
      const supply = await ctx.henium.totalSupply();
      await router.connect(trader).swapTokensForExactTokens(want, quoted[0], path, trader.address, d);
      expect((await ctx.egg.balanceOf(trader.address)) - eggBefore).to.equal(want);
      expect(hBefore - (await ctx.henium.balanceOf(trader.address))).to.equal(quoted[0]);
      expect(supply - (await ctx.henium.totalSupply())).to.equal(burnPart(quoted[0])); // HENIUM input burned
    });

    it("sells HENIUM and EGG for ETH (swapExactTokensForETH), exactly at the quote", async () => {
      const ctx = await loadFixture(routerFixture);
      const { router, addr, trader } = ctx;
      const d = await ctx.deadline();
      for (const path of [
        [addr.H, addr.W],
        [addr.EGG, addr.H, addr.W],
      ]) {
        const quoted = await router.getAmountsOut(50n * E18, path);
        const got = await ethDelta(trader.address, () => router.connect(trader).swapExactTokensForETH(50n * E18, quoted.at(-1)!, path, trader.address, d));
        expect(got).to.equal(quoted.at(-1)!);
      }
      await expect(router.connect(trader).swapExactTokensForETH(1n * E18, 0n, [addr.H, addr.EGG], trader.address, d)).to.be.revertedWithCustomError(
        router,
        "InvalidPath",
      );
      await expect(router.connect(trader).swapExactTokensForETH(1n * E18, 10n * E18, [addr.H, addr.W], trader.address, d)).to.be.revertedWithCustomError(
        router,
        "InsufficientOutputAmount",
      );
      expect(await ethers.provider.getBalance(addr.router)).to.equal(0n);
    });

    it("swapTokensForExactETH pays exactly the requested ETH", async () => {
      const ctx = await loadFixture(routerFixture);
      const { router, addr, trader } = ctx;
      const d = await ctx.deadline();
      const path = [addr.STONE, addr.H, addr.W];
      const want = E18 / 100n;
      const quoted = await router.getAmountsIn(want, path);
      await expect(router.connect(trader).swapTokensForExactETH(want, quoted[0] - 1n, path, trader.address, d)).to.be.revertedWithCustomError(
        router,
        "ExcessiveInputAmount",
      );
      await expect(router.connect(trader).swapTokensForExactETH(want, quoted[0], [addr.STONE, addr.H], trader.address, d)).to.be.revertedWithCustomError(
        router,
        "InvalidPath",
      );
      const got = await ethDelta(trader.address, () => router.connect(trader).swapTokensForExactETH(want, quoted[0], path, trader.address, d));
      expect(got).to.equal(want);
    });

    it("swapExactETHForTokens and swapETHForExactTokens (with refund)", async () => {
      const ctx = await loadFixture(routerFixture);
      const { router, addr, trader } = ctx;
      const d = await ctx.deadline();
      const path = [addr.W, addr.H, addr.STONE];
      const quoted = await router.getAmountsOut(E18 / 10n, path);
      const before = await ctx.stone.balanceOf(trader.address);
      await expect(router.connect(trader).swapExactETHForTokens(quoted[2] + 1n, path, trader.address, d, { value: E18 / 10n })).to.be.revertedWithCustomError(
        router,
        "InsufficientOutputAmount",
      );
      await expect(router.connect(trader).swapExactETHForTokens(0n, [addr.H, addr.W], trader.address, d, { value: 1n })).to.be.revertedWithCustomError(
        router,
        "InvalidPath",
      );
      await router.connect(trader).swapExactETHForTokens(quoted[2], path, trader.address, d, { value: E18 / 10n });
      expect((await ctx.stone.balanceOf(trader.address)) - before).to.equal(quoted[2]);
      // WETH input: its 0.10% went to 0x…dEaD (WETH9 cannot burn)
      expect(await ctx.weth.balanceOf(DEAD)).to.equal(burnPart(E18 / 10n));

      const want = 1_000n * E18;
      const need = (await router.getAmountsIn(want, [addr.W, addr.H]))[0];
      await expect(router.connect(trader).swapETHForExactTokens(want, [addr.W, addr.H], trader.address, d, { value: need - 1n }))
        .to.be.revertedWithCustomError(router, "ExcessiveInputAmount")
        .withArgs(need, need - 1n);
      await expect(router.connect(trader).swapETHForExactTokens(want, [addr.H, addr.W], trader.address, d, { value: need })).to.be.revertedWithCustomError(
        router,
        "InvalidPath",
      );
      const hBefore = await ctx.henium.balanceOf(trader.address);
      const spent = -(await ethDelta(trader.address, () => router.connect(trader).swapETHForExactTokens(want, [addr.W, addr.H], trader.address, d, { value: need + E18 })));
      expect(spent).to.equal(need); // the extra 1 ETH came back
      expect((await ctx.henium.balanceOf(trader.address)) - hBefore).to.equal(want);
      // exact value: nothing to refund
      const need2 = (await router.getAmountsIn(want, [addr.W, addr.H]))[0];
      await router.connect(trader).swapETHForExactTokens(want, [addr.W, addr.H], trader.address, d, { value: need2 });
    });

    it("reverts swapETHForExactTokens when the refund cannot be delivered", async () => {
      const ctx = await loadFixture(routerFixture);
      const caller = (await ethers.deployContract("RejectingCaller")) as unknown as RejectingCaller;
      const want = 10n * E18;
      const need = (await ctx.router.getAmountsIn(want, [ctx.addr.W, ctx.addr.H]))[0];
      const data = ctx.router.interface.encodeFunctionData("swapETHForExactTokens", [want, [ctx.addr.W, ctx.addr.H], ctx.alice.address, await ctx.deadline()]);
      await expect(caller.execute(ctx.addr.router, need + 1n, data, { value: need + 1n })).to.be.revertedWithCustomError(ctx.router, "ETHTransferFailed");
    });

    it("routes any resource -> HENIUM -> anything: Stone -> HENIUM -> ETH, burning each hop's input fee", async () => {
      const ctx = await loadFixture(routerFixture);
      const { router, addr, trader } = ctx;
      const path = [addr.STONE, addr.H, addr.W];
      const amount = 2_000_000n * E18;
      const quoted = await router.getAmountsOut(amount, path);
      const stoneSupply = await ctx.stone.totalSupply();
      const hSupply = await ctx.henium.totalSupply();
      const d = await ctx.deadline();
      const got = await ethDelta(trader.address, () => router.connect(trader).swapExactTokensForETH(amount, quoted[2], path, trader.address, d));
      expect(got).to.equal(quoted[2]);
      expect(stoneSupply - (await ctx.stone.totalSupply())).to.equal(burnPart(amount)); // hop 1 input: Stone
      expect(hSupply - (await ctx.henium.totalSupply())).to.equal(burnPart(quoted[1])); // hop 2 input: HENIUM
      // Stone -> HENIUM -> mEGG (token out), and a 3-hop path through an extra mEGG/WETH pool
      await ctx.addLiquidity(ctx.egg, ctx.weth, 10_000n * E18, 1n * E18);
      for (const p of [
        [addr.STONE, addr.H, addr.EGG],
        [addr.STONE, addr.H, addr.EGG, addr.W],
      ]) {
        const q = await router.getAmountsOut(amount, p);
        const out = (await ethers.getContractAt("IERC20", p.at(-1)!)) as unknown as Erc20Like;
        const before = await out.balanceOf(ctx.carol.address);
        await router.connect(trader).swapExactTokensForTokens(amount, q.at(-1)!, p, ctx.carol.address, await ctx.deadline());
        expect((await out.balanceOf(ctx.carol.address)) - before).to.equal(q.at(-1)!);
      }
    });
  });

  describe("deadlines", () => {
    it("every liquidity and swap entry point rejects an expired deadline", async () => {
      const ctx = await loadFixture(routerFixture);
      const { router, addr, trader } = ctx;
      const past = BigInt(await time.latest());
      const to = trader.address;
      const r = router.connect(trader);
      const calls = [
        r.addLiquidity(addr.EGG, addr.H, 1n, 1n, 0n, 0n, to, past),
        r.addLiquidityETH(addr.H, 1n, 0n, 0n, to, past, { value: 1n }),
        r.removeLiquidity(addr.EGG, addr.H, 1n, 0n, 0n, to, past),
        r.removeLiquidityETH(addr.H, 1n, 0n, 0n, to, past),
        r.swapExactTokensForTokens(1n, 0n, [addr.EGG, addr.H], to, past),
        r.swapTokensForExactTokens(1n, 1n, [addr.EGG, addr.H], to, past),
        r.swapExactETHForTokens(0n, [addr.W, addr.H], to, past, { value: 1n }),
        r.swapTokensForExactETH(1n, 1n, [addr.H, addr.W], to, past),
        r.swapExactTokensForETH(1n, 0n, [addr.H, addr.W], to, past),
        r.swapETHForExactTokens(1n, [addr.W, addr.H], to, past, { value: 1n }),
      ];
      for (const c of calls) await expect(c).to.be.revertedWithCustomError(router, "Expired").withArgs(past);
    });
  });

  describe("economics", () => {
    it("k never decreases and LPs earn the 0.20% fee: one LP share is worth more after trading", async () => {
      const ctx = await loadFixture(routerFixture);
      const { router, addr, trader } = ctx;
      const pair = ctx.eggHenium;
      const value = async () => {
        const [r0, r1] = await pair.getReserves();
        return { k: r0 * r1, supply: await pair.totalSupply() };
      };
      const start = await value();
      let prevK = start.k;
      const d = await ctx.deadline();
      for (let i = 0; i < 20; i++) {
        const path = i % 2 === 0 ? [addr.EGG, addr.H] : [addr.H, addr.EGG];
        await router.connect(trader).swapExactTokensForTokens(300n * E18, 0n, path, trader.address, d);
        const { k } = await value();
        expect(k).to.be.greaterThanOrEqual(prevK);
        prevK = k;
      }
      const end = await value();
      expect(end.supply).to.equal(start.supply);
      // sqrt(k) per LP share grew: compare k_end * s_start^2 > k_start * s_end^2
      expect(end.k * start.supply ** 2n).to.be.greaterThan(start.k * end.supply ** 2n);

      // the LP withdraws more "geometric value" than was deposited
      await pair.connect(ctx.lp).approve(addr.router, ethers.MaxUint256);
      const lpBal = await pair.balanceOf(ctx.lp.address);
      const [eggOut, hOut] = await router.connect(ctx.lp).removeLiquidity.staticCall(addr.EGG, addr.H, lpBal, 0n, 0n, ctx.lp.address, d);
      expect(eggOut * hOut).to.be.greaterThan(10_000n * E18 * 2_500n * E18 * (lpBal * lpBal) / (start.supply * start.supply));
    });
  });
});
