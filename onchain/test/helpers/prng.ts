/**
 * Deterministic PRNG for property tests (mulberry32, public domain). A fixed seed makes every run identical,
 * so a failing sequence can be replayed exactly.
 */
export class Prng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** BigInt in [0, maxExclusive) (256 random bits reduced mod max). */
  bigint(maxExclusive: bigint): bigint {
    let x = 0n;
    for (let i = 0; i < 8; i++) x = (x << 32n) | BigInt(Math.floor(this.next() * 4294967296));
    return x % maxExclusive;
  }

  /** BigInt in [lo, hi] inclusive. */
  range(lo: bigint, hi: bigint): bigint {
    return lo + this.bigint(hi - lo + 1n);
  }

  /** Log-uniform BigInt in [lo, hi]: good for amounts spanning many orders of magnitude. */
  logRange(lo: bigint, hi: bigint): bigint {
    const a = Math.log(Number(lo));
    const b = Math.log(Number(hi));
    const x = BigInt(Math.floor(Math.exp(a + (b - a) * this.next())));
    return x < lo ? lo : x > hi ? hi : x;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
}
