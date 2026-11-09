import { strict as assert } from "assert";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { E18, amountIn, amountOut, dexFixture, reservesFor, type Erc20Like } from "../helpers/dex";
import { Prng } from "../helpers/prng";

/**
 * The pair's k-check (on post-burn balances)
 *     (b0*10000 - in0*20) * (b1*10000 - in1*20) >= r0 * r1 * 10000^2
 * accepts exactly the router's quotes  out = in*9970*rOut / (rIn*10000 + in*9970).  Proof in HeniumDexLibrary.sol;
 * this file checks it numerically: first in pure BigInt arithmetic over many random cases, then on chain.
 */
const MAX112 = 2n ** 112n - 1n;
const burn = (x: bigint) => (x * 10n) / 10000n;

/** The pair's check for a swap of `inp` (token in) for `out` (token out), with the burn applied. */
function pairAccepts(rIn: bigint, rOut: bigint, inp: bigint, out: bigint): boolean {
  if (out >= rOut) return false;
  const bIn = rIn + inp - burn(inp);
  const bOut = rOut - out;
  return (bIn * 10000n - inp * 20n) * (bOut * 10000n) >= rIn * rOut * 10000n ** 2n;
}

describe("Fee math: k-check <-> router formula", () => {
  it("holds for 20,000 random (reserves, input) cases in pure arithmetic", () => {
    const rng = new Prng(0xc0ffee);
    let tight = 0;
    for (let i = 0; i < 20_000; i++) {
      const rIn = rng.logRange(1_000n, MAX112);
      const rOut = rng.logRange(1_000n, MAX112);
      const inp = rng.logRange(1n, rIn * 4n > MAX112 - rIn ? MAX112 - rIn : rIn * 4n);
      const out = amountOut(inp, rIn, rOut);
      // (plain asserts: chai is too slow for 100k checks)
      // Lemma: the post-burn, post-LP-fee balance is at least rIn*10000 + in*9970
      const bIn = rIn + inp - burn(inp);
      assert.ok(bIn * 10000n - inp * 20n >= rIn * 10000n + inp * 9970n, `lemma rIn=${rIn} in=${inp}`);
      // every quote passes the pair's check
      assert.ok(pairAccepts(rIn, rOut, inp, out), `quote rejected rIn=${rIn} rOut=${rOut} in=${inp}`);
      // the bound is tight when the burn has no rounding (in a multiple of 1000)
      const exact = inp - (inp % 1000n);
      if (exact > 0n) {
        const o = amountOut(exact, rIn, rOut);
        if (o + 1n < rOut) {
          assert.ok(!pairAccepts(rIn, rOut, exact, o + 1n), `out+1 accepted rIn=${rIn} rOut=${rOut} in=${exact}`);
          tight++;
        }
      }
      // exact-output quotes: getAmountIn(out) always buys at least `out`
      const want = rng.logRange(1n, rOut - 1n);
      const need = amountIn(want, rIn, rOut);
      if (need <= MAX112 - rIn) {
        assert.ok(amountOut(need, rIn, rOut) >= want, `getAmountIn too small rIn=${rIn} rOut=${rOut} out=${want}`);
        assert.ok(pairAccepts(rIn, rOut, need, want), `exact-out rejected rIn=${rIn} rOut=${rOut} out=${want}`);
      }
    }
    expect(tight).to.be.greaterThan(10_000);
  });

  it("holds on chain: random swaps at exactly the quote pass, quote + 1 fails when the burn is exact", async () => {
    const ctx = await loadFixture(dexFixture);
    const pair = await ctx.addLiquidity(ctx.egg, ctx.henium, 37_000_000n * E18 + 12_345n, 9_999n * E18 + 77n);
    const tokens = [ctx.egg, ctx.henium] as unknown as Erc20Like[];
    const rng = new Prng(42);
    for (let i = 0; i < 60; i++) {
      const tokenIn = tokens[rng.int(2)];
      const inAddr = await tokenIn.getAddress();
      const [rIn, rOut] = await reservesFor(pair, inAddr);
      let inp = rng.logRange(rIn / 10n ** 9n, rIn / 3n); // large enough for a non-zero output
      if (i % 2 === 0) inp -= inp % 1000n; // exact burn: tight bound
      const out = amountOut(inp, rIn, rOut);
      const zeroForOne = (await pair.token0()) === inAddr;
      await tokenIn.connect(ctx.trader).transfer(await pair.getAddress(), inp);
      if (inp % 1000n === 0n) {
        const tooMuch = out + 1n;
        await expect(
          pair.connect(ctx.trader).swap.staticCall(zeroForOne ? 0n : tooMuch, zeroForOne ? tooMuch : 0n, ctx.trader.address, "0x"),
        ).to.be.revertedWithCustomError(pair, "K");
      }
      await pair.connect(ctx.trader).swap(zeroForOne ? 0n : out, zeroForOne ? out : 0n, ctx.trader.address, "0x");
      const [nIn, nOut] = await reservesFor(pair, inAddr);
      expect(nIn).to.equal(rIn + inp - burn(inp));
      expect(nOut).to.equal(rOut - out);
      expect(nIn * nOut).to.be.greaterThan(rIn * rOut);
    }
  });

  it("documents the effective fee: 0.10% burned, 0.20% kept by LPs", () => {
    // On a deep pool a tiny trade's output is ~ in * price * 0.997; the input that stays is in * 0.999.
    const rIn = 10n ** 30n;
    const rOut = 10n ** 30n;
    const inp = 10n ** 18n;
    const out = amountOut(inp, rIn, rOut);
    expect(Number(out) / Number(inp)).to.be.closeTo(0.997, 1e-9);
    expect(Number(inp - burn(inp)) / Number(inp)).to.equal(0.999);
  });
});
