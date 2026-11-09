// DEX: constant-product AMM pools (x * y = k), like Uniswap v2.
// Every resource, EGG and FEED trades against HENIUM; HENIUM and EGG also trade against ETH (ETH is simulated in
// this prototype: no wallet, chain or real money). Any token can be swapped for any other: the router goes through
// HENIUM when there is no direct pool. A third of every fee is burned, so trading makes HENIUM and EGG scarcer.
// Trader Chikns in the Mining Team and the Trader specialization lower the fee (G.feeK in systems.js, G.dexFee here).
//
// The rest of the world is simulated by NPC market makers. They can only trade with what they own: HENIUM that
// enters a pool comes out of their treasury, HENIUM that leaves a pool goes into it, and the treasury is refilled
// only by the world's daily emission. So selling ore can never create HENIUM — the 21M cap holds.
(() => {
const G = window.G, D = G.D;
const fail = (msg) => ({ ok: false, msg });

D.res.eth = { name: 'ETH', cat: 'ext', color: '#8aa0ff', dec: 4 };
D.dex = {
  fee: 0.003,              // 0.3% per hop, paid in the token you sell (before Trader discounts: G.dexFee)
  burnShare: 1 / 3,        // a third of each fee is burned (HENIUM, EGG, or the token sold)
  tick: 6,                 // seconds between NPC market-maker rounds
  depth: { raw: 4000, mat: 2500, egg: 2500, feed: 1200, eth: 12000 }, // starting HENIUM on the HENIUM side of each pool
  oreValueK: 1e-4,         // ores and materials are cheap next to HENIUM (× the reference prices in D.market): a mine makes millions a day
  eggInHenium: 0.25,       // fair EGG price in HENIUM at launch
  feedInHenium: 0.4,       // fair FEED price in HENIUM at launch (FEED is scarce)
  heniumInEth: 0.0004,     // fair HENIUM price in ETH at launch (rises with every halving)
  treasury0: 6000,         // HENIUM the other players keep for trading at launch
  npcBuy: 0.04,            // share of the world's daily HENIUM emission other players bring to the market
  maxMove: 0.25,           // NPC traders close at most 25% of the gap to the fair price per round
  perTick: 0.015,          // and spend at most 1.5% of their HENIUM treasury per pool per round
};

const pid = (a, b) => a + '/' + b;
G.dexInit = (S) => {
  const P = {};
  const add = (a, b, priceAinB, depthB) => { P[pid(a, b)] = { a, b, ra: depthB / priceAinB, rb: depthB, hist: [priceAinB] }; };
  for (const r in D.market) add(r, 'henium', D.market[r] * D.dex.oreValueK, D.res[r].cat === 'raw' ? D.dex.depth.raw : D.dex.depth.mat);
  add('egg', 'henium', D.dex.eggInHenium, D.dex.depth.egg);
  add('feed', 'henium', D.dex.feedInHenium, D.dex.depth.feed);
  add('henium', 'eth', D.dex.heniumInEth, D.dex.depth.eth * D.dex.heniumInEth);
  add('egg', 'eth', D.dex.eggInHenium * D.dex.heniumInEth, D.dex.depth.egg * D.dex.heniumInEth);
  S.dex = { pools: P, log: [], burned: { henium: 0, egg: 0 }, volume: 0, t: 0, npc: { henium: D.dex.treasury0 } };
  return S.dex;
};
G.dexPools = () => G.S.dex.pools;
G.poolFor = (x, y) => G.S.dex.pools[pid(x, y)] || G.S.dex.pools[pid(y, x)] || null;
G.dexTokens = () => [...new Set(Object.values(G.S.dex.pools).flatMap((p) => [p.a, p.b]))];
// price of one unit of x, expressed in y (spot, before fees and impact)
G.spot = (x, y) => {
  if (x === y) return 1;
  const p = G.poolFor(x, y);
  if (p) return p.a === x ? p.rb / p.ra : p.ra / p.rb;
  if (x !== 'henium' && y !== 'henium' && G.poolFor(x, 'henium') && G.poolFor('henium', y)) return G.spot(x, 'henium') * G.spot('henium', y);
  return 0;
};
G.dexRoute = (from, to) => {
  if (from === to) return null;
  if (G.poolFor(from, to)) return [[from, to]];
  if (from !== 'henium' && to !== 'henium' && G.poolFor(from, 'henium') && G.poolFor('henium', to)) return [[from, 'henium'], ['henium', to]];
  return null;
};
// the fee you pay per hop: the pool fee × your Trader discount (Trader Chikns in the Mining Team, Trader specialization)
G.dexFee = () => D.dex.fee * (G.feeK ? G.feeK() : 1);
// one hop on reserves (rIn, rOut) at fee rate f -> amount out, the fee and the part of the fee that is burned
const hop = (rIn, rOut, amt, f) => {
  const fee = amt * f, inAF = amt - fee;
  return { out: rOut * inAF / (rIn + inAF), fee, burn: fee * D.dex.burnShare, inAF };
};
// Simulate a swap without changing anything.
G.dexQuote = (from, to, amt) => {
  const route = G.dexRoute(from, to);
  if (!route || !(amt > 0)) return null;
  let x = amt, fees = 0;
  const spot = G.spot(from, to), f = G.dexFee();
  const steps = [];
  for (const [i, o] of route) {
    const p = G.poolFor(i, o), rIn = p.a === i ? p.ra : p.rb, rOut = p.a === i ? p.rb : p.ra;
    const h = hop(rIn, rOut, x, f);
    steps.push({ p, i, o, amtIn: x, ...h });
    fees += h.fee * G.spot(i, from);
    x = h.out;
  }
  const ideal = amt * spot * Math.pow(1 - f, route.length);
  return { from, to, amt, out: x, route: route.map(([i, o]) => i + '→' + o), steps, spot, fee: f,
    impact: ideal > 0 ? Math.max(0, 1 - x / ideal) : 0, feeIn: fees, rate: x / amt };
};
// Execute a swap. minOut protects against the price moving (slippage).
G.act.swap = (from, to, amt, minOut = 0) => {
  const S = G.S;
  amt = +amt;
  if (!(amt > 0)) return fail('Enter an amount');
  if (from === to) return fail('Pick two different tokens');
  if ((S.res[from] || 0) + 1e-9 < amt) return fail(`Not enough ${D.res[from] ? D.res[from].name : from}`);
  const q = G.dexQuote(from, to, amt);
  if (!q) return fail('No pool for this pair');
  if (q.out < minOut) return fail('Price moved: you would receive less than your minimum. Try again.');
  for (const s of q.steps) {
    const p = s.p, aIn = p.a === s.i;
    // the burned third of the fee leaves the system; the rest stays in the pool for liquidity providers
    const keep = s.amtIn - s.burn;
    if (aIn) { p.ra += keep; p.rb -= s.out; } else { p.rb += keep; p.ra -= s.out; }
    burnToken(s.i, s.burn);
    p.hist.push(p.rb / p.ra);
    if (p.hist.length > 60) p.hist.shift();
  }
  S.res[from] -= amt;
  S.res[to] = (S.res[to] || 0) + q.out;
  const value = amt * G.spot(from, 'henium');
  S.dex.volume += value;
  S.dex.log.unshift({ t: G.now(), from, to, amt, out: q.out, value });
  S.dex.log.length = Math.min(S.dex.log.length, 40);
  G.emit('res');
  return { ok: true, out: q.out, q };
};
function burnToken(tok, amt) {
  const S = G.S;
  if (!(amt > 0)) return;
  if (tok === 'henium') { S.dex.burned.henium += amt; S.stats.feeBurned = (S.stats.feeBurned || 0) + amt; }
  else if (tok === 'egg') { S.dex.burned.egg += amt; S.stats.eggBurned = (S.stats.eggBurned || 0) + amt; }
  // other tokens: the burned part simply leaves the economy
}

// fair prices the NPC market makers steer towards; HENIUM gets more valuable after every halving
G.henValueK = (epoch = G.epoch()) => 1 + 0.6 * epoch;
G.fairPrice = (p) => {
  const k = G.henValueK();
  if (p.b === 'henium' && p.a === 'egg') return D.dex.eggInHenium / k;
  if (p.b === 'henium' && p.a === 'feed') return D.dex.feedInHenium / k;
  if (p.b === 'henium') return D.market[p.a] * D.dex.oreValueK / k;
  if (p.a === 'henium' && p.b === 'eth') return D.dex.heniumInEth * k;
  if (p.a === 'egg' && p.b === 'eth') return D.dex.eggInHenium * D.dex.heniumInEth;
  return p.rb / p.ra;
};
// One round of NPC market making: every pool trades part of the way towards a noisy fair price.
// The trade keeps x*y=k (it is a real swap), and its HENIUM side is paid from / paid into the NPC treasury.
function npcRound() {
  const X = G.S.dex;
  for (const p of Object.values(X.pools)) {
    const cur = p.rb / p.ra, target = G.fairPrice(p) * (1 + (Math.random() - 0.5) * 2 * D.rules.mm.noise);
    const next = cur + (target - cur) * D.dex.maxMove, k = p.ra * p.rb;
    const ra = Math.sqrt(k / next), rb = Math.sqrt(k * next);
    const hSide = p.b === 'henium' ? 'rb' : p.a === 'henium' ? 'ra' : null;
    if (!hSide) { p.ra = ra; p.rb = rb; }                  // EGG/ETH: both sides come from the outside world
    else {
      const before = p[hSide], after = hSide === 'rb' ? rb : ra, need = after - before;
      if (need <= 0) { p.ra = ra; p.rb = rb; X.npc.henium -= need; }   // NPCs take HENIUM out of the pool
      else {
        const spend = Math.min(need, Math.max(0, X.npc.henium) * D.dex.perTick);  // ...or pay it in, if they can
        if (spend > 0) {
          const h = before + spend, other = k / h;
          if (hSide === 'rb') { p.rb = h; p.ra = other; } else { p.ra = h; p.rb = other; }
          X.npc.henium -= spend;
        }
      }
    }
    p.hist.push(p.rb / p.ra);
    if (p.hist.length > 60) p.hist.shift();
  }
}
// worldMint = HENIUM the rest of the world minted this tick (G.tick passes it; the emission minus what was paid to you)
G.dexTick = (dt, worldMint) => {
  const X = G.S.dex;
  if (!X.npc) X.npc = { henium: D.dex.treasury0 };
  // other players bring part of what they mint to the market
  X.npc.henium += D.dex.npcBuy * (worldMint != null ? Math.max(0, worldMint) : G.emission() * dt / D.farm.day);
  X.t += dt;
  let rounds = 0;
  while (X.t >= D.dex.tick && rounds < 40) { X.t -= D.dex.tick; rounds++; npcRound(); }
  if (rounds >= 40) X.t = 0;
};
G.poolPrice = (p) => p.rb / p.ra;
G.poolTVL = (p) => p.rb * G.spot(p.b, 'henium') * 2; // total value locked, in HENIUM
G.act.withdrawEth = () => fail('Prototype: real ETH withdrawals need the on-chain version (smart contracts, wallet connect, audits, legal checks). ETH here is simulated.');
})();
