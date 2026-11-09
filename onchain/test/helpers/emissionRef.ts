/**
 * Independent JS reference for the HENIUM schedule. The contract computes the cumulative emission in closed
 * form per epoch; this reference sums day by day, so the two implementations share no code.
 */
export const DAY = 86_400n;
export const MAX_HALVINGS = 64n;

export function refDaily(day: bigint, initial: bigint, interval: bigint): bigint {
  const epoch = day / interval;
  return epoch >= MAX_HALVINGS ? 0n : initial >> epoch;
}

/** Prefix sums: prefix[d] = sum of refDaily(0..d). Covers the whole schedule plus `extra` days. */
export function buildPrefix(initial: bigint, interval: bigint, extra = 10n): bigint[] {
  const last = MAX_HALVINGS * interval + extra;
  const prefix: bigint[] = new Array(Number(last) + 1);
  let total = 0n;
  for (let d = 0n; d <= last; d++) {
    total += refDaily(d, initial, interval);
    prefix[Number(d)] = total;
  }
  return prefix;
}

/** Cumulative emission for days 0..day using a prefix table (clamped to the end of the schedule). */
export function refCumulative(prefix: bigint[], day: bigint): bigint {
  const i = day >= BigInt(prefix.length) ? prefix.length - 1 : Number(day);
  return prefix[i];
}

export const BPS = 10_000n;
export const SHARES = [7_000n, 2_000n, 1_000n] as const; // REFINERY, WAR, HUNT
