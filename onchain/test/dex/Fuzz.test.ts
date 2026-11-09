import { strict as assert } from "assert";
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { HeniumDexPair } from "../../typechain-types";
import { DEAD, E18, burnPart, dexFixture, type Erc20Like, type Signer } from "../helpers/dex";
import { Prng } from "../helpers/prng";

/**
 * Property test with a fixed seed: hundreds of random swaps (exact in / exact out, single and multi-hop, ETH in and
 * out), liquidity adds and removes, donations followed by skim or sync, and time jumps. After every step it checks:
 *  - every pair's reserves equal its token balances;
 *  - k never decreases on swaps / donations, and the value of one LP share, sqrt(k) / totalSupply, never decreases;
 *  - router outputs equal the router's own quotes, to the wei;
 *  - burns: HENIUM and Stone totalSupply fell by exactly 0.10% of every swap input in those tokens; the EGG
 *    stand-in and WETH (not burnable) sent exactly that much to 0x…dEaD;
 *  - TWAP accumulators never go down; the router never keeps tokens or ETH; HENIUM stays under the cap.
 */
const SEED = 0x5eed_c41c;
const STEPS = 300;

describe("DEX property test (fixed-seed fuzz)", () => {
  async function fuzzFixture() {
    const ctx = await dexFixture();
    const d = await ctx.deadline();
    const H = await ctx.henium.getAddress();
    await ctx.router.connect(ctx.lp).addLiquidityETH(H, 10_000n * E18, 0n, 0n, ctx.lp.address, d, { value: 4n * E18 });
    await ctx.addLiquidity(ctx.egg, ctx.henium, 10_000n * E18, 2_500n * E18);
    await ctx.addLiquidity(ctx.stone, ctx.henium, 100_000_000n * E18, 4_000n * E18);
    return ctx;
  }

  it(`keeps every invariant over ${STEPS} random operations (seed ${SEED.toString(16)})`, async () => {
    const ctx = await loadFixture(fuzzFixture);
    const { router, henium, weth, egg, stone } = ctx;
    const rng = new Prng(SEED);
    const sink = ctx.mallory; // receives outputs and never sends a transaction: its balance deltas are exact
    const actors: Signer[] = [ctx.alice, ctx.bob, ctx.carol, ctx.trader, ctx.lp];
    const A = {
      H: await henium.getAddress(),
      W: await weth.getAddress(),
      EGG: await egg.getAddress(),
      STONE: await stone.getAddress(),
      router: await router.getAddress(),
    };
    const tokenOf: Record<string, Erc20Like> = {
      [A.H]: henium as unknown as Erc20Like,
      [A.W]: weth as unknown as Erc20Like,
      [A.EGG]: egg as unknown as Erc20Like,
      [A.STONE]: stone as unknown as Erc20Like,
    };
    const POOLS: [string, string][] = [
      [A.H, A.W],
      [A.EGG, A.H],
      [A.STONE, A.H],
    ];
    const pairs: HeniumDexPair[] = [];
    for (const [a, b] of POOLS) pairs.push(await ctx.pairOf(a, b));
    for (const p of pairs) for (const s of actors) await p.connect(s).approve(A.router, ethers.MaxUint256);
    const pairOf = (a: string, b: string) => pairs[POOLS.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a))];
    const PATHS = [
      [A.EGG, A.H],
      [A.H, A.EGG],
      [A.STONE, A.H],
      [A.H, A.STONE],
      [A.H, A.W],
      [A.W, A.H],
      [A.STONE, A.H, A.W],
      [A.W, A.H, A.STONE],
      [A.EGG, A.H, A.STONE],
      [A.STONE, A.H, A.EGG],
      [A.EGG, A.H, A.W],
    ];

    // --- burn bookkeeping ---------------------------------------------------------------------------------------
    const supply0 = { H: await henium.totalSupply(), STONE: await stone.totalSupply() };
    const burned = { H: 0n, STONE: 0n, EGG: 0n, W: 0n };
    const recordBurns = (path: string[], amounts: readonly bigint[]) => {
      for (let i = 0; i < path.length - 1; i++) {
        const b = burnPart(amounts[i]);
        if (path[i] === A.H) burned.H += b;
        else if (path[i] === A.STONE) burned.STONE += b;
        else if (path[i] === A.EGG) burned.EGG += b;
        else burned.W += b;
      }
    };

    // --- invariant checks ----------------------------------------------------------------------------------------
    type Snap = { k: bigint; s: bigint; p0: bigint; p1: bigint };
    const snap = async (p: HeniumDexPair): Promise<Snap> => {
      const [r0, r1] = await p.getReserves();
      return { k: r0 * r1, s: await p.totalSupply(), p0: await p.price0CumulativeLast(), p1: await p.price1CumulativeLast() };
    };
    let prev: Snap[] = [];
    for (const p of pairs) prev.push(await snap(p));

    const counts: Record<string, number> = {};
    const check = async (op: string, kMustGrow: boolean) => {
      counts[op] = (counts[op] ?? 0) + 1;
      const next: Snap[] = [];
      for (let i = 0; i < pairs.length; i++) {
        const p = pairs[i];
        const [r0, r1] = await p.getReserves();
        const t0 = tokenOf[await p.token0()];
        const t1 = tokenOf[await p.token1()];
        const pa = await p.getAddress();
        assert.equal(await t0.balanceOf(pa), r0, `${op}: reserve0 != balance0 (pool ${i})`);
        assert.equal(await t1.balanceOf(pa), r1, `${op}: reserve1 != balance1 (pool ${i})`);
        const n = await snap(p);
        // one LP share never loses value: k' * s^2 >= k * s'^2
        assert.ok(n.k * prev[i].s ** 2n >= prev[i].k * n.s ** 2n, `${op}: LP share value fell (pool ${i})`);
        if (kMustGrow) assert.ok(n.k >= prev[i].k, `${op}: k decreased (pool ${i})`);
        assert.ok(n.p0 >= prev[i].p0 && n.p1 >= prev[i].p1, `${op}: TWAP accumulator went down (pool ${i})`);
        next.push(n);
      }
      prev = next;
      assert.equal(await henium.totalSupply(), supply0.H - burned.H, `${op}: HENIUM burn mismatch`);
      assert.equal(await stone.totalSupply(), supply0.STONE - burned.STONE, `${op}: Stone burn mismatch`);
      assert.equal(await egg.balanceOf(DEAD), burned.EGG, `${op}: EGG at dEaD mismatch`);
      assert.equal(await weth.balanceOf(DEAD), burned.W, `${op}: WETH at dEaD mismatch`);
      assert.equal(await ethers.provider.getBalance(A.router), 0n, `${op}: router kept ETH`);
      for (const t of Object.values(tokenOf)) assert.equal(await t.balanceOf(A.router), 0n, `${op}: router kept tokens`);
      assert.ok((await henium.totalSupply()) <= 21_000_000n * E18);
    };

    const sinkBalance = async (token: string, eth: boolean) =>
      eth ? ethers.provider.getBalance(sink.address) : tokenOf[token].balanceOf(sink.address);

    // --- operations ------------------------------------------------------------------------------------------------
    const swapExactIn = async (who: Signer) => {
      const path = rng.pick(PATHS);
      const [rIn] = await reservesOf(pairOf(path[0], path[1]), path[0]);
      const amount = rng.logRange(rIn / 10n ** 7n + 1n, rIn / 5n);
      const quoted = [...(await router.getAmountsOut(amount, path))];
      if (quoted.at(-1)! === 0n) return check("skip", true);
      const ethIn = path[0] === A.W && rng.next() < 0.5;
      const ethOut = path.at(-1) === A.W && rng.next() < 0.5;
      const out = path.at(-1)!;
      const before = await sinkBalance(out, ethOut);
      const d = await ctx.deadline();
      const min = quoted.at(-1)!;
      if (ethIn) await router.connect(who).swapExactETHForTokens(min, path, sink.address, d, { value: amount });
      else if (ethOut) await router.connect(who).swapExactTokensForETH(amount, min, path, sink.address, d);
      else await router.connect(who).swapExactTokensForTokens(amount, min, path, sink.address, d);
      assert.equal((await sinkBalance(out, ethOut)) - before, min, "exact-in output != quote");
      recordBurns(path, quoted);
      await check(ethIn ? "swapExactETHForTokens" : ethOut ? "swapExactTokensForETH" : "swapExactTokensForTokens", true);
    };

    const swapExactOut = async (who: Signer) => {
      const path = rng.pick(PATHS);
      const [, rOut] = await reservesOf(pairOf(path.at(-2)!, path.at(-1)!), path.at(-2)!);
      const want = rng.logRange(rOut / 10n ** 7n + 1n, rOut / 5n);
      let quoted: bigint[];
      try {
        quoted = [...(await router.getAmountsIn(want, path))];
      } catch {
        return check("skip", true); // an intermediate hop cannot provide that much
      }
      const ethIn = path[0] === A.W && rng.next() < 0.5;
      const ethOut = path.at(-1) === A.W && rng.next() < 0.5;
      const out = path.at(-1)!;
      if (!ethIn && (await tokenOf[path[0]].balanceOf(who.address)) < quoted[0]) return check("skip", true);
      const before = await sinkBalance(out, ethOut);
      const d = await ctx.deadline();
      if (ethIn) await router.connect(who).swapETHForExactTokens(want, path, sink.address, d, { value: quoted[0] + rng.bigint(E18) });
      else if (ethOut) await router.connect(who).swapTokensForExactETH(want, quoted[0], path, sink.address, d);
      else await router.connect(who).swapTokensForExactTokens(want, quoted[0], path, sink.address, d);
      assert.equal((await sinkBalance(out, ethOut)) - before, want, "exact-out output != requested");
      recordBurns(path, quoted);
      await check(ethIn ? "swapETHForExactTokens" : ethOut ? "swapTokensForExactETH" : "swapTokensForExactTokens", true);
    };

    const addLiquidity = async (who: Signer) => {
      const i = rng.int(POOLS.length);
      const [a, b] = POOLS[i];
      const pair = pairs[i];
      const [rA, rB] = await reservesOf(pair, a);
      const amountA = rng.logRange(rA / 10n ** 6n + 1n, rA / 2n);
      const bOpt = (amountA * rB) / rA;
      if (bOpt === 0n || (await tokenOf[a].balanceOf(who.address)) < amountA || (await tokenOf[b].balanceOf(who.address)) < bOpt * 2n) {
        return check("skip", true);
      }
      const supply = await pair.totalSupply();
      const expected = [(amountA * supply) / rA, (bOpt * supply) / rB].reduce((x, y) => (x < y ? x : y));
      if (expected === 0n) return check("skip", true);
      const lpBefore = await pair.balanceOf(who.address);
      const d = await ctx.deadline();
      if (b === A.W && rng.next() < 0.5) {
        await router.connect(who).addLiquidityETH(a, amountA, 0n, 0n, who.address, d, { value: bOpt + rng.bigint(E18) + 1n });
        await check("addLiquidityETH", true);
      } else {
        await router.connect(who).addLiquidity(a, b, amountA, bOpt + rng.bigint(bOpt + 1n), 0n, 0n, who.address, d);
        await check("addLiquidity", true);
      }
      assert.equal((await pair.balanceOf(who.address)) - lpBefore, expected, "LP minted != formula");
    };

    const removeLiquidity = async (who: Signer) => {
      const i = rng.int(POOLS.length);
      const [a, b] = POOLS[i];
      const pair = pairs[i];
      const lpBal = await pair.balanceOf(who.address);
      if (lpBal === 0n) return check("skip", true);
      const liquidity = (lpBal * BigInt(1 + rng.int(100))) / 100n;
      const supply = await pair.totalSupply();
      const [rA, rB] = await reservesOf(pair, a);
      const expA = (liquidity * rA) / supply;
      const expB = (liquidity * rB) / supply;
      if (expA === 0n || expB === 0n) return check("skip", true);
      const d = await ctx.deadline();
      const ethOut = b === A.W && rng.next() < 0.5;
      const beforeA = await sinkBalance(a, false);
      const beforeB = await sinkBalance(b, ethOut);
      if (ethOut) await router.connect(who).removeLiquidityETH(a, liquidity, expA, expB, sink.address, d);
      else await router.connect(who).removeLiquidity(a, b, liquidity, expA, expB, sink.address, d);
      assert.equal((await sinkBalance(a, false)) - beforeA, expA, "removed A != pro rata");
      assert.equal((await sinkBalance(b, ethOut)) - beforeB, expB, "removed B != pro rata");
      await check(ethOut ? "removeLiquidityETH" : "removeLiquidity", false);
    };

    const donate = async (who: Signer) => {
      const i = rng.int(POOLS.length);
      const pair = pairs[i];
      const token = POOLS[i][rng.int(2)];
      const [r] = await reservesOf(pair, token);
      const amount = rng.logRange(1n, r / 100n + 1n);
      await tokenOf[token].connect(who).transfer(await pair.getAddress(), amount);
      if (rng.next() < 0.5) {
        const before = await sinkBalance(token, false);
        await pair.connect(who).skim(sink.address);
        assert.equal((await sinkBalance(token, false)) - before, amount, "skim did not return the donation");
        await check("skim", true);
      } else {
        await pair.connect(who).sync();
        await check("sync", true);
      }
    };

    async function reservesOf(pair: HeniumDexPair, tokenIn: string): Promise<[bigint, bigint]> {
      const [r0, r1] = await pair.getReserves();
      return (await pair.token0()) === tokenIn ? [r0, r1] : [r1, r0];
    }

    for (let step = 0; step < STEPS; step++) {
      const who = rng.pick(actors);
      const x = rng.next();
      if (x < 0.4) await swapExactIn(who);
      else if (x < 0.6) await swapExactOut(who);
      else if (x < 0.75) await addLiquidity(who);
      else if (x < 0.87) await removeLiquidity(who);
      else if (x < 0.93) await donate(who);
      else {
        await time.increase(1 + rng.int(7_200));
        await check("time", true);
      }
    }

    // the run exercised every operation, and the fee burns really happened
    for (const op of ["swapExactTokensForTokens", "swapTokensForExactTokens", "swapExactETHForTokens", "swapExactTokensForETH",
      "swapETHForExactTokens", "swapTokensForExactETH", "addLiquidity", "addLiquidityETH", "removeLiquidity",
      "removeLiquidityETH", "skim", "sync", "time"]) {
      expect(counts[op] ?? 0, `operation ${op} never ran`).to.be.greaterThan(0);
    }
    expect(burned.H).to.be.greaterThan(0n);
    expect(burned.STONE).to.be.greaterThan(0n);
    expect(burned.EGG).to.be.greaterThan(0n);
    expect(burned.W).to.be.greaterThan(0n);
  });
});
