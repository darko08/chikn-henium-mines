import { strict as assert } from "assert";
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { FlashBorrower, HeniumDexPair, NoReturnToken, TrickyBurnToken } from "../../typechain-types";
import { E18, amountOut, dexFixture, type Erc20Like, type Signer } from "../helpers/dex";
import { Prng } from "../helpers/prng";

/**
 * SECURITY REVIEW — adversarial fuzz of HeniumDexPair, driven directly (no router), so that every call can be
 * hostile: arbitrary outputs around and above the quote, inputs on both sides at once, "flash-loan" style swaps
 * (output and input in the same token), real flash swaps with random repayments, unbalanced direct mints, direct
 * burns, donations followed by skim/sync, a token whose burn() misbehaves in four ways (switched at random), a
 * token that returns no value from transfer, WETH9's silent fallback, and time jumps.
 *
 * After every call that SUCCEEDS:
 *   - reserves == balances on every pair;
 *   - swaps: reserve0 * reserve1 never decreases, and the 0.20% LP fee was collected on the post-burn reserves:
 *       (r0' * 10000 - in0 * 20) * (r1' * 10000 - in1 * 20) >= r0 * r1 * 10000^2;
 *   - every operation: the value of one LP share, sqrt(k) / totalSupply, never decreases.
 * Failed calls are allowed (most hostile calls must fail); their stray input is skimmed back.
 */
const SEED = process.env.REVIEW_SEED ? Number(process.env.REVIEW_SEED) : 0xa11ce5;
const STEPS = 400;

describe("REVIEW: HeniumDexPair adversarial fuzz (direct calls, hostile tokens)", () => {
  async function fixture() {
    const ctx = await dexFixture();
    const tricky = (await ethers.deployContract("TrickyBurnToken")) as unknown as TrickyBurnToken;
    const noret = (await ethers.deployContract("NoReturnToken")) as unknown as NoReturnToken;
    const borrower = (await ethers.deployContract("FlashBorrower")) as unknown as FlashBorrower;
    const actors = [ctx.alice, ctx.bob, ctx.carol, ctx.trader, ctx.mallory];
    for (const s of [ctx.lp, ...actors]) {
      await tricky.mint(s.address, 10n ** 30n);
      await noret.mint(s.address, 10n ** 30n);
    }
    const B = await borrower.getAddress();
    await ctx.henium.transfer(B, 50_000n * E18);
    await ctx.egg.mint(B, 10n ** 30n);
    await tricky.mint(B, 10n ** 30n);
    await ctx.weth.connect(ctx.trader).transfer(B, 500n * E18);

    const createAndSeed = async (a: Erc20Like, b: Erc20Like, amountA: bigint, amountB: bigint) => {
      await ctx.factory.createPair(await a.getAddress(), await b.getAddress());
      const pair = await ctx.pairOf(a, b);
      await a.connect(ctx.lp).transfer(await pair.getAddress(), amountA);
      await b.connect(ctx.lp).transfer(await pair.getAddress(), amountB);
      await pair.mint(ctx.lp.address);
      return pair;
    };
    const T = tricky as unknown as Erc20Like;
    const N = noret as unknown as Erc20Like;
    const pools: { pair: HeniumDexPair; tokens: [Erc20Like, Erc20Like]; flashable: boolean }[] = [];
    const p1 = await createAndSeed(ctx.henium, ctx.egg, 20_000n * E18, 80_000n * E18);
    const p2 = await createAndSeed(T, ctx.weth, 1_000_000n * E18, 300n * E18);
    const p3 = await createAndSeed(N, ctx.stone, 5_000_000n * E18, 900_000_000n * E18);
    for (const p of [p1, p2, p3]) {
      const t0 = await p.token0();
      const all = [ctx.henium, ctx.egg, T, ctx.weth, N, ctx.stone] as Erc20Like[];
      const byAddr = async (x: string) => {
        for (const t of all) if ((await t.getAddress()) === x) return t;
        throw new Error("unknown token");
      };
      pools.push({ pair: p, tokens: [await byAddr(t0), await byAddr(await p.token1())], flashable: p !== p3 });
    }
    return { ...ctx, tricky, noret, borrower, actors, pools };
  }

  it(`keeps k, reserve/balance sync and LP share value over ${STEPS} hostile operations (seed ${SEED.toString(16)})`, async () => {
    const ctx = await loadFixture(fixture);
    const rng = new Prng(SEED);
    const counts: Record<string, number> = {};
    const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

    type Snap = { r0: bigint; r1: bigint; s: bigint };
    const snap = async (p: HeniumDexPair): Promise<Snap> => {
      const [r0, r1] = await p.getReserves();
      return { r0, r1, s: await p.totalSupply() };
    };
    const assertSynced = async (op: string) => {
      for (const { pair, tokens } of ctx.pools) {
        const [r0, r1] = await pair.getReserves();
        const pa = await pair.getAddress();
        assert.equal(await tokens[0].balanceOf(pa), r0, `${op}: reserve0 != balance0`);
        assert.equal(await tokens[1].balanceOf(pa), r1, `${op}: reserve1 != balance1`);
      }
    };
    const assertShareValue = (op: string, a: Snap, b: Snap) => {
      // sqrt(k')/s' >= sqrt(k)/s  <=>  k' * s^2 >= k * s'^2
      assert.ok(b.r0 * b.r1 * a.s * a.s >= a.r0 * a.r1 * b.s * b.s, `${op}: LP share value fell`);
    };
    /** Returns stray tokens left in a pair by a failed call, so that reserves == balances again. */
    const cleanUp = async (pair: HeniumDexPair, who: Signer) => {
      await pair.connect(who).skim(who.address);
    };

    const swapOp = async (who: Signer, flash: boolean) => {
      const pool = rng.pick(ctx.pools.filter((p) => !flash || p.flashable));
      const { pair, tokens } = pool;
      const pa = await pair.getAddress();
      const before = await snap(pair);
      const r = [before.r0, before.r1];
      const kind = rng.int(4); // 0: in side 0 -> out side 1; 1: in 1 -> out 0; 2: both in -> one out; 3: same-token "loan"
      const inAmt = [0n, 0n];
      const out = [0n, 0n];
      const side = rng.int(2);
      if (kind === 0 || kind === 1) {
        const i = kind;
        inAmt[i] = rng.logRange(1n, r[i] / 3n + 1n);
        const q = amountOut(inAmt[i], r[i], r[1 - i]);
        const factors = [0n, 5_000n, 9_000n, 9_990n, 9_999n, 10_000n, 10_000n, 10_000n, 10_001n, 10_100n];
        out[1 - i] = (q * rng.pick(factors)) / 10_000n + BigInt(rng.int(5)) - 2n;
      } else if (kind === 2) {
        inAmt[0] = rng.logRange(1n, r[0] / 5n + 1n);
        inAmt[1] = rng.logRange(1n, r[1] / 5n + 1n);
        // output on one side: roughly what the other side's input buys, plus some of its own input back
        const q = amountOut(inAmt[1 - side], r[1 - side], r[side]);
        out[side] = (q * BigInt(9_000 + rng.int(1_200))) / 10_000n + (inAmt[side] * BigInt(rng.int(10_000))) / 10_000n;
      } else {
        // take out X of a token and put back X * (1 + f) of the same token
        const x = rng.logRange(1n, r[side] / 3n + 1n);
        out[side] = x;
        inAmt[side] = x + (x * BigInt(rng.int(60))) / 10_000n + BigInt(rng.int(3));
      }
      for (const i of [0, 1]) if (out[i] < 0n) out[i] = 0n;
      for (const i of [0, 1]) if (out[i] >= r[i]) out[i] = r[i] - 1n;
      if (out[0] === 0n && out[1] === 0n) out[1 - side] = 1n;
      if (pool.tokens[0] === (ctx.tricky as unknown as Erc20Like) || pool.tokens[1] === (ctx.tricky as unknown as Erc20Like)) {
        await ctx.tricky.setMode(rng.pick([0, 0, 1, 2, 3, 4]));
      }

      let ok = true;
      let receipt;
      if (flash) {
        // the borrower receives the outputs first, then repays inAmt[] from its own funds inside the callback
        // (for a same-token loan the repayment includes the principal it just received)
        try {
          const tx = await ctx.borrower.flash(pair, out[0], out[1], 0, inAmt[0], inAmt[1]);
          receipt = await tx.wait();
        } catch {
          ok = false;
        }
      } else {
        // a same-token "loan" without a callback: the input must already be there
        for (const i of [0, 1]) if (inAmt[i] > 0n) await tokens[i].connect(who).transfer(pa, inAmt[i]);
        try {
          const tx = await pair.connect(who).swap(out[0], out[1], rng.pick(ctx.actors).address, "0x");
          receipt = await tx.wait();
        } catch {
          ok = false;
          await cleanUp(pair, who);
        }
      }
      const op = `${flash ? "flash" : "swap"}#${kind}`;
      bump(`${op}:${ok ? "ok" : "rejected"}`);
      await assertSynced(op);
      const after = await snap(pair);
      if (!ok) {
        assert.deepEqual(after, before, `${op}: a failed call changed the reserves`);
        return;
      }
      assert.ok(after.r0 * after.r1 >= before.r0 * before.r1, `${op}: k decreased`);
      assertShareValue(op, before, after);
      const ev = receipt!.logs.map((l) => (l.address === pa ? pair.interface.parseLog(l) : null)).find((l) => l?.name === "Swap")!;
      const [in0, in1] = [ev.args.amount0In as bigint, ev.args.amount1In as bigint];
      assert.ok(
        (after.r0 * 10_000n - in0 * 20n) * (after.r1 * 10_000n - in1 * 20n) >= before.r0 * before.r1 * 10n ** 8n,
        `${op}: LP fee not collected`,
      );
    };

    const mintOp = async (who: Signer) => {
      const { pair, tokens } = rng.pick(ctx.pools);
      const pa = await pair.getAddress();
      const before = await snap(pair);
      const a0 = rng.logRange(1n, before.r0 / 4n + 1n);
      // sometimes balanced, sometimes very unbalanced
      const a1 = rng.next() < 0.5 ? (a0 * before.r1) / before.r0 + BigInt(rng.int(3)) : rng.logRange(1n, before.r1 / 4n + 1n);
      await tokens[0].connect(who).transfer(pa, a0);
      if (a1 > 0n) await tokens[1].connect(who).transfer(pa, a1);
      let ok = true;
      try {
        await (await pair.connect(who).mint(who.address)).wait();
      } catch {
        ok = false;
        await cleanUp(pair, who);
      }
      bump(`mint:${ok ? "ok" : "rejected"}`);
      await assertSynced("mint");
      assertShareValue("mint", before, await snap(pair));
    };

    const burnOp = async (who: Signer) => {
      const { pair } = rng.pick(ctx.pools);
      const bal = await pair.balanceOf(who.address);
      if (bal === 0n) return;
      const before = await snap(pair);
      const liq = (bal * BigInt(1 + rng.int(100))) / 100n;
      if ((liq * before.r0) / before.s === 0n || (liq * before.r1) / before.s === 0n) return; // would revert, LP stuck
      await pair.connect(who).transfer(await pair.getAddress(), liq);
      await (await pair.connect(who).burn(who.address)).wait();
      bump("burn:ok");
      await assertSynced("burn");
      assertShareValue("burn", before, await snap(pair));
    };

    const donateOp = async (who: Signer) => {
      const { pair, tokens } = rng.pick(ctx.pools);
      const before = await snap(pair);
      const i = rng.int(2);
      const amt = rng.logRange(1n, (i === 0 ? before.r0 : before.r1) / 50n + 1n);
      await tokens[i].connect(who).transfer(await pair.getAddress(), amt);
      if (rng.next() < 0.5) {
        await pair.connect(who).skim(who.address);
        bump("skim");
      } else {
        await pair.connect(who).sync();
        bump("sync");
      }
      await assertSynced("donate");
      assertShareValue("donate", before, await snap(pair));
    };

    // LPs for burnOp: give every actor a position in every pool
    for (const who of ctx.actors) {
      for (const { pair, tokens } of ctx.pools) {
        const [r0, r1] = await pair.getReserves();
        await tokens[0].connect(who).transfer(await pair.getAddress(), r0 / 100n);
        await tokens[1].connect(who).transfer(await pair.getAddress(), r1 / 100n + 1n);
        await pair.connect(who).mint(who.address);
      }
    }

    for (let step = 0; step < STEPS; step++) {
      const who = rng.pick(ctx.actors);
      const x = rng.next();
      if (x < 0.45) await swapOp(who, false);
      else if (x < 0.65) await swapOp(who, true);
      else if (x < 0.77) await mintOp(who);
      else if (x < 0.87) await burnOp(who);
      else if (x < 0.95) await donateOp(who);
      else await time.increase(1 + rng.int(3_600));
    }

    // the run really exercised accepted and rejected variants of each hostile swap shape
    for (const k of ["swap#0", "swap#1", "swap#2", "swap#3", "flash#0", "flash#1", "flash#2", "flash#3"]) {
      expect(counts[`${k}:ok`] ?? 0, `${k} never succeeded`).to.be.greaterThan(0);
      expect(counts[`${k}:rejected`] ?? 0, `${k} was never rejected`).to.be.greaterThan(0);
    }
    for (const k of ["mint:ok", "burn:ok", "skim", "sync"]) expect(counts[k] ?? 0, `${k} never ran`).to.be.greaterThan(0);
  });
});
