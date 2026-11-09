// Regression checks for bugs found during review and for the core economy rules.
// usage: node test/regress.mjs <html>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [html] = process.argv.slice(2);
const errors = [], fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const G_OFFLINE_H = 8;
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + html);
await page.waitForTimeout(600);
await page.click('text=Load Showcase');
await page.waitForTimeout(600);

// 1. opening the rental market several times must not multiply rentals or charges
for (let i = 0; i < 3; i++) {
  await page.click('button.act[data-a="hire"]'); await page.waitForTimeout(150);
  await page.click('.modal > .x'); await page.waitForTimeout(150);
}
await page.click('button.act[data-a="hire"]'); await page.waitForTimeout(200);
const before = await page.evaluate(() => {
  const o = G.rentMarket().offers.find((x) => !x.free);
  return { n: G.S.chikns.length, egg: G.S.res.egg, id: o.id, cost: G.D.rentCost(o.price, 7) };
});
await page.click(`[data-rent="${before.id}"]`); await page.waitForTimeout(400);
const after = await page.evaluate(() => ({ n: G.S.chikns.length, egg: G.S.res.egg, last: G.S.chikns[G.S.chikns.length - 1] }));
check(after.n - before.n === 1 && after.last.own === false && after.last.rent && Math.abs(after.last.rent.left - 7 * 86400) < 5, `one click rents exactly one Chikn for 7 days (got ${after.n - before.n})`);
check(Math.round(before.egg - after.egg) === before.cost, `renting charges ${before.cost} EGG once (charged ${Math.round(before.egg - after.egg)})`);
await page.click('.modal > .x'); await page.waitForTimeout(200);

// 2. the top-bar exchange dialog must convert exactly once per click (EGG -> FEED)
for (let i = 0; i < 3; i++) {
  await page.click('.pill .plus >> nth=1'); await page.waitForTimeout(150);
  await page.click('.modal > .x'); await page.waitForTimeout(150);
}
const f0 = await page.evaluate(() => G.S.res.feed);
await page.click('.pill .plus >> nth=1'); await page.waitForTimeout(150);
await page.click('[data-x="e2f"][data-q="1"]'); await page.waitForTimeout(200);
const f1 = await page.evaluate(() => G.S.res.feed);
check(Math.abs(f1 - f0 - 1) < 0.05, `burn EGG for 1 FEED gives exactly 1 (got ${(f1 - f0).toFixed(2)})`);
await page.click('.modal > .x'); await page.waitForTimeout(150);

// 3. number formatting
const f = await page.evaluate(() => [G.fmt(15600), G.fmt(540225), G.fmt(9999), G.fmt(2.4e6)]);
check(f.join('|') === '15.6K|540K|9,999|2.4M', `G.fmt formats K/M correctly (${f.join(', ')})`);

// 4. HENIUM supply: the world's supply follows the clock (like the contract), rewards are paid out of it, nothing pays
//    HENIUM once 21M are mined, EGG can't mint HENIUM
const sup = await page.evaluate(() => {
  const W = G.S.world, m0 = W.mined, p0 = W.paid, h0 = G.S.res.henium;
  G.give({ henium: 5 });
  const r = { mined: W.mined - m0, paid: W.paid - p0, got: G.S.res.henium - h0 };
  const saved = W.mined; W.mined = G.D.supply.cap;
  const out = G.recipeOut(G.D.factoryById('refinery'), G.D.factoryById('refinery').recipes[0]);
  r.capGive = G.give({ henium: 5 }).henium;
  W.mined = saved;
  return { ...r, capOut: out.henium, e2h: G.act.exchange('e2h', 1).ok, share: G.refShare() };
});
check(sup.got === 5 && Math.abs(sup.paid - 5) < 1e-9 && sup.mined === 0, `a HENIUM reward is paid out of the schedule (paid +${sup.paid}, supply +${sup.mined})`);
check(sup.capOut === 0 && sup.capGive === 0, `nothing pays HENIUM once 21M are mined (refinery ${sup.capOut}, reward ${sup.capGive})`);
check(sup.e2h === false, 'EGG cannot be turned into newly minted HENIUM');
check(sup.share > 0 && sup.share < 1, `refinery earns a share of world emission (${(sup.share * 100).toFixed(1)}%)`);

// 5. DEX: a swap pays out what was quoted, burns part of the fee, and routes ore -> HENIUM -> material
const dx = await page.evaluate(() => {
  const q = G.dexQuote('egg', 'henium', 10), h0 = G.S.res.henium, b0 = G.S.dex.burned.egg;
  const r = G.act.swap('egg', 'henium', 10, q.out * 0.99);
  const q2 = G.dexQuote('stone', 'alloy', 5000);
  return { ok: r.ok, got: G.S.res.henium - h0, quoted: q.out, burned: G.S.dex.burned.egg - b0, route: q2 && q2.route.join(' ') };
});
check(dx.ok && Math.abs(dx.got - dx.quoted) < 1e-9, `DEX swap pays the quoted amount (${dx.got.toFixed(4)} HENIUM)`);
check(dx.burned > 0, 'DEX swap burns part of the fee');
check(dx.route === 'stone→henium henium→alloy', `router goes through HENIUM (${dx.route})`);

// 6. invalid calls are rejected
const v = await page.evaluate(() => [G.act.claimSeason(0).ok, G.act.claimSeason(-10).ok, G.act.claimSeason(2.5).ok, G.act.startExp('nope', []).ok, G.act.swap('egg', 'egg', 1).ok, G.act.swap('egg', 'henium', 1e12).ok]);
check(v.every((x) => x === false), `invalid season/expedition/swap calls are rejected (${v.join(', ')})`);

// 7. every screen renders
for (const view of ['mines', 'factories', 'crafting', 'chikns', 'farm', 'guild', 'dex', 'expeditions', 'battle', 'events', 'wiki']) {
  const exists = await page.$(`.nav-btn[data-view="${view}"]`);
  if (!exists) { check(false, `${view} nav button exists`); continue; }
  await page.click(`.nav-btn[data-view="${view}"]`); await page.waitForTimeout(300);
  const n = await page.evaluate((v) => (G.ui.views[v] && G.ui.cur === v ? document.getElementById('view').children.length : 0), view);
  check(n > 0, `${view} renders`);
}

// 9. EGG is only laid by Chikns: no reward table pays EGG (quests, missions at every depth, stages, expeditions, the
//    season track, hazard and fight loot), and daily missions pay at most ~6 FEED a day
const eggs = await page.evaluate(() => {
  const D = G.D, R = D.rules, bad = [], scan = (name, rew) => { if (rew && typeof rew === 'object' && 'egg' in rew) bad.push(name); };
  const mr = (m, d) => (typeof m.r === 'function' ? m.r(d) : m.r);
  D.quests.forEach((q) => scan('quest ' + q.id, q.r));
  for (let d = 1; d <= D.maxDepth; d++) D.missions.forEach((m) => scan(`mission ${m.id}@${d}`, mr(m, d)));
  D.stages.forEach((s) => { scan('stage ' + s.name, s.r); scan('first clear ' + s.name, s.first); });
  D.expeditions.concat(D.veinExpedition ? [D.veinExpedition] : []).forEach((e) => scan('expedition ' + e.id, e.r));
  for (let l = 1; l <= 40; l++) scan('season ' + l, D.seasonReward(l));
  for (let d = 1; d <= D.maxDepth; d++) [['crate', R.supply.loot], ['creature', R.creature.loot], ['bandits', R.bandits.win.loot], ['pvp', R.pvp.loot]].forEach(([n, f]) => scan(`${n}@${d}`, f(d)));
  const feed = (m) => mr(m, 20).feed || 0, rot = D.missions.filter((m) => R.rotating.includes(m.id));
  const missionFeed = D.missions.filter((m) => !R.rotating.includes(m.id)).reduce((s, m) => s + feed(m), 0) + Math.max(0, ...rot.map(feed));
  return { bad, missionFeed };
});
check(eggs.bad.length === 0, `no reward table pays EGG${eggs.bad.length ? ': ' + eggs.bad.slice(0, 8).join(', ') : ''}`);
check(eggs.missionFeed <= 6, `daily missions pay at most 6 FEED a day (${eggs.missionFeed})`);

// 10. HENIUM follows the fixed emission of the contract: 7,200 a day, halving every 1,458 days. The world supply is the
//     schedule at the world clock; what the player earns is a small part of it
const em = await page.evaluate(() => {
  const S = G.S, D = G.D, E = G.emission(), m0 = S.world.mined, h0 = S.res.henium, t0 = S.worldT;
  for (let i = 0; i < 20 * 144; i++) G.tick(600); // 20 days in 10-minute steps
  G.ui.closeModal();
  const H = D.supply.halvingDays;
  return { grown: S.world.mined - m0, expect: 20 * E, earned: S.res.henium - h0, days: (S.worldT - t0) / 86400,
    sched: Math.abs(S.world.mined - D.cumEmission(S.worldT / 86400)) < 1e-6, epochSame: G.emission() === E,
    epoch1: D.cumEmission(H) === D.supply.daily * H, epoch2: Math.abs(D.cumEmission(2 * H) - 1.5 * D.supply.daily * H) < 1e-6,
    capped: D.cumEmission(1e7) <= D.supply.cap };
});
check(em.sched && Math.abs(em.days - 20) < 1e-6, 'world supply = the emission schedule at the world clock');
check(em.epochSame && Math.abs(em.grown / em.expect - 1) <= 0.01, `20 days mint 20 × emission (${em.grown.toFixed(1)} vs ${em.expect})`);
check(em.epoch1 && em.epoch2 && em.capped, 'schedule matches the contract: 7,200/day, halving every 1,458 days, never above 21M');
check(em.earned > 0 && em.earned < em.grown * 0.25, `the player earns a small share of it (${em.earned.toFixed(1)} of ${em.grown.toFixed(0)})`);

// 11. hunt pool is a real share; creatures add hunt points; refinery batches can't be rushed; guild project reward
const hs = await page.evaluate(() => {
  const S = G.S, D = G.D, out = {};
  S.hunt = 300;
  out.share = Math.abs(G.huntPerDay() - G.emission() * D.supply.split.boss * 300 / (300 + S.world.hunt)) < 1e-9 && S.world.hunt >= D.supply.worldHunt0;
  const rnd = Math.random; Math.random = () => 0; // a sure win
  S.hazard = { type: 'creature', zone: 'stone', at: Date.now(), until: Date.now() + 60e3, power: 1, mon: 'bat', reward: { stone: 10, feed: 1 } };
  const h0 = S.hunt, r = G.act.hazard('fight');
  Math.random = rnd;
  out.creature = r.ok && r.win && S.hunt - h0 === D.rules.creature.hunt;
  if (!S.jobs.some((j) => j.f === 'refinery')) S.jobs.push({ id: 9999, f: 'refinery', r: 'refine', t: 1, dur: 36, repeat: false, paid: {} });
  const rj = S.jobs.find((j) => j.f === 'refinery'), hb = S.res.henium;
  out.rush = G.act.speedJob(rj.id).ok === false && S.res.henium === hb;
  const g = S.guild, i = g.proj, p = D.guildProjects[i], hen0 = S.res.henium;
  if (p) { g.pts = p.need; G.sys.guildCheck(true); out.proj = Math.abs(S.res.henium - hen0 - G.guildProjectReward(i)) < 1e-9 && G.guildProjectReward(i) === D.rules.projHenium(i); } else out.proj = true;
  return out;
});
check(hs.share, 'monster-hunt payout = emission × hunt split × your points ÷ (yours + world hunt points)');
check(hs.creature, 'beating a creature adds hunt points');
check(hs.rush, 'refinery batches cannot be rushed with HENIUM');
check(hs.proj, 'a finished guild project pays G.guildProjectReward(i)');

// 12. Trader specialization lowers the DEX fee (quotes and swaps); the burn stays a third of the fee actually paid
const tr = await page.evaluate(() => {
  const S = G.S, spec = S.spec, out = {};
  S.spec = null; const f0 = G.dexFee(), q0 = G.dexQuote('egg', 'henium', 20);
  S.spec = 'trader'; const f1 = G.dexFee(), q1 = G.dexQuote('egg', 'henium', 20);
  const b0 = S.dex.burned.egg, r = G.act.swap('egg', 'henium', 20, q1.out * 0.99), burned = S.dex.burned.egg - b0;
  S.spec = spec;
  return { f0, f1, fee0: q0.feeIn, fee1: q1.feeIn, out0: q0.out, out1: q1.out, ok: r.ok, burnOk: Math.abs(burned - q1.steps[0].fee / 3) < 1e-9 };
});
check(tr.f1 < tr.f0 && tr.fee1 < tr.fee0 && tr.out1 > tr.out0, `Trader specialization lowers the DEX fee (${(tr.f0 * 100).toFixed(3)}% → ${(tr.f1 * 100).toFixed(3)}%)`);
check(tr.ok && tr.burnOk, 'a discounted swap burns a third of the fee actually paid');

// 13. a season Chikn can't be claimed into a full coop (and nothing is marked claimed)
const sc = await page.evaluate(() => {
  const S = G.S, keep = S.chikns.slice(), lv0 = S.season.lv, cl0 = S.season.claimed.slice();
  S.season.lv = Math.max(lv0, 10); S.season.claimed = cl0.filter((l) => l !== 10);
  while (S.chikns.length < G.coopCap()) S.chikns.push({ id: 90000 + S.chikns.length, name: 'Filler', num: 1, role: 'miner', rarity: 'common', lv: 1, kg: 100, status: 'idle', until: 0 });
  const n0 = S.chikns.length, r = G.act.claimSeason(10);
  const res = { ok: r.ok, msg: r.msg || '', grew: S.chikns.length !== n0, claimed: S.season.claimed.includes(10) };
  S.chikns.pop(); const r2 = G.act.claimSeason(10); res.okWithRoom = r2.ok && !!r2.c;
  S.chikns = keep; S.squad = S.squad.filter((id) => keep.some((c) => c.id === id)); S.season.lv = lv0; S.season.claimed = cl0;
  return res;
});
check(!sc.ok && /coop/i.test(sc.msg) && !sc.grew && !sc.claimed, `season Chikn claim fails when the coop is full ("${sc.msg}")`);
check(sc.okWithRoom, 'the same season Chikn can be claimed once the coop has room');

// 8. progress survives a page reload (the save must load even though G.S is not set yet at boot)
const depthBefore = await page.evaluate(() => { G.S.res.stone = 4242; G.save(); return G.S.depth; });
await page.reload(); await page.waitForTimeout(900);
const reloaded = await page.evaluate(() => ({ depth: G.S.depth, stone: Math.round(G.S.res.stone), kind: G.S.kind }));
check(reloaded.depth === depthBefore && reloaded.kind === 'showcase' && reloaded.stone >= 4242, `progress survives a reload (depth ${reloaded.depth}, kind ${reloaded.kind})`);

// tokenomics audit: offline progress, dig pacing and value chains
const au = await page.evaluate(() => {
  const D = G.D, keep = G.S, out = {}, fresh = () => (G.S = G.newState('fresh'));
  // (a) a long time away finishes many factory batches, not one per tick
  let S = fresh(); S.depth = 3; S.factories.crusher.lv = 1; S.res.stone = 5e6;
  G.act.queue('crusher', 'crush', true);
  const dur = S.jobs[0].dur, c0 = S.res.crushedOre; G.offline(10 * 86400);
  out.batches = (S.res.crushedOre - c0) / 60; out.batchesWant = 10 * 86400 / dur;
  // (b) floors mine for at most 8 h while away, timers (a dig) keep running
  S = fresh(); const rate = G.zoneRate(D.zones[0]), s0 = S.res.stone;
  S.dig = { t: 0, dur: 86400, to: 2 }; const r = G.offline(2 * 86400);
  out.mined = (S.res.stone - s0) / (rate * D.rules.offlineH * 3600); out.dug = S.depth === 2 && !S.dig; out.mineSec = r.mineSec;
  // (c) farm days roll over while away: daily payouts and decay are not skipped
  S = fresh(); S.guild.warPts = 1000; const day0 = S.farm.day; G.offline(3 * 86400 + 60);
  out.days = S.farm.day - day0; out.decay = S.guild.warPts < 1000 * 0.9;
  // (d) PvP tickets refill while away
  S = fresh(); S.battle.tickets = 0; G.offline(3 * D.pvpTicketTime + 60); out.tickets = S.battle.tickets;
  G.S = keep;
  // (e) the first digs are quick, every later one takes at least as long (D.digTime takes the depth dug TO)
  out.firstDig = D.digTime(2);
  out.monotone = Array.from({ length: D.maxDepth - 2 }, (_, i) => D.digTime(i + 3) >= D.digTime(i + 2)).every(Boolean);
  // (f) season rewards follow the player's depth, not the season level
  out.season = JSON.stringify(D.seasonReward(1, 30)) === JSON.stringify(D.bundle(30, 0.15));
  // (g) crafting never destroys value at the reference prices
  out.lossy = [];
  for (const f of D.factories) for (const rec of f.recipes) {
    const val = (o) => Object.entries(o).reduce((s, [k, v]) => (k in D.market ? s + v * D.market[k] : NaN), 0);
    const vi = val(rec.in), vo = val(rec.out);
    if (isFinite(vi) && isFinite(vo) && vo < vi) out.lossy.push(`${rec.id} ${vo.toFixed(3)} < ${vi.toFixed(3)}`);
  }
  // (i) bandits raid at most once every R.bandits.gap seconds (hazards come every few minutes while you play)
  S = fresh(); S.player.lv = 99; const pick = G.pick; G.pick = (a) => (a.includes('bandits') ? 'bandits' : a[0]);
  S.hazardNext = 0; G.sys.hazardTick(); const first = S.hazard && S.hazard.type;
  S.hazard = null; S.hazardNext = 0; G.sys.hazardTick(); const second = S.hazard && S.hazard.type;
  S.hazard = null; S.hazardNext = 0; S.banditNext = Date.now() - 1; G.sys.hazardTick(); const later = S.hazard && S.hazard.type;
  G.pick = pick; G.S = keep; out.raids = [first, second, later].join(' ');
  // (h) floors don't max out in a day: deep levels cost more than a day of that floor's own output
  const z = D.zones[0]; out.floor40 = D.floorCost(z, 40).stone / (D.floorRate(z, 40, 5) * 86400);
  // (j) the last building level costs weeks of a late-game mine's output, not years
  const late = { stone: 180e6, coal: 90e6, copper: 90e6, iron: 95e6, heniumOre: 85e6, rareEarth: 20e6 }; // per day, from tools/journey-sim.cjs
  out.lv10 = D.factories.map((f) => [f.id, Math.max(...Object.entries(D.factoryUpCost(f, D.factoryMaxLv - 1)).filter(([r]) => late[r]).map(([r, v]) => v / late[r]))]);
  return out;
});
check(au.lv10.every(([, d]) => d < 60), `Lv. 10 of every building costs < 60 days of late-game ore (${au.lv10.map(([f, d]) => f + ' ' + d.toFixed(0) + 'd').join(', ')})`);
check(au.batches >= au.batchesWant * 0.95, `10 days away finish ~all factory batches (${Math.round(au.batches)} of ${Math.round(au.batchesWant)})`);
check(Math.abs(au.mined - 1) < 0.05 && au.mineSec === G_OFFLINE_H * 3600 && au.dug, `away: floors mine ${G_OFFLINE_H} h (×${au.mined.toFixed(2)}), a 1-day dig still finishes in 2 days`);
check(au.days === 3 && au.decay, `3 days away roll 3 farm days with daily payouts and decay (${au.days})`);
check(au.tickets >= 3, `PvP tickets refill while away (${au.tickets})`);
check(au.firstDig === 30 && au.monotone, `first dig takes 30 s and digs never get shorter (${au.firstDig} s)`);
check(au.season, 'season rewards scale with the player\'s depth');
check(au.lossy.length === 0, `no recipe destroys value at reference prices${au.lossy.length ? ': ' + au.lossy.join(', ') : ''}`);
check(au.raids === 'bandits richvein bandits', `bandits raid at most once per ${8} h (${au.raids})`);
check(au.floor40 > 1, `a Lv 40 floor upgrade costs more than a day of its own output (${au.floor40.toFixed(1)} days)`);

// Chikn NFT rentals: rented Chikns go home, auto-renew pays, listings get rented and pay passive EGG (also offline),
// rented Chikns can't be fattened or sublet, and the collection is never minted from
const rt = await page.evaluate(() => {
  const keep = G.S, out = {}, S = (G.S = G.newState('fresh'));
  const offer = () => G.rentMarket().offers.find((o) => !o.free);
  S.res.egg = 500; S.stats.hired = 1; S.farm.coopLv = 5;
  let o = offer(); G.act.rent(o.id, 1, false); const a = S.chikns[S.chikns.length - 1];
  o = offer(); G.act.rent(o.id, 1, true); const b = S.chikns[S.chikns.length - 1];
  const egg0 = S.res.egg; G.offline(1.5 * 86400);
  out.home = !S.chikns.includes(a); out.renewed = S.chikns.includes(b) && b.rent.left > 0 && S.res.egg < egg0;
  out.noFatten = G.act.feed(b.id).ok === false; out.noSublet = G.act.listRent(b.id, 7, 1).ok === false;
  const mine = G.newChikn('rare', 'miner', { own: true }); const r = G.act.listRent(mine.id, 3, 1);
  const e1 = S.res.egg; G.offline(4 * 86400);
  out.listed = r.ok; out.earned = mine.lease ? -1 : S.stats.rentEarned; out.back = mine.status === 'idle' && !mine.lease;
  out.expect = r.price * 3 * (1 - G.D.rent.fee);
  G.S = keep;
  // test speed: the game clock runs k times faster and every timer follows it
  const t0 = G.now(), d0 = G.S.farm.dayT; G.S.settings.speed = 1; const w = G.warp(3600);
  out.warp = Math.abs((G.now() - t0) / 1000 - 3600) < 1 && Math.abs(((G.S.farm.dayT - d0 + 86400) % 86400) - 3600) < 1 && w.sec === 3600;
  return out;
});
check(rt.home && rt.renewed, `a rental ends and the Chikn goes home; auto-renew extends it and charges EGG (${rt.home}, ${rt.renewed})`);
check(rt.noFatten && rt.noSublet, 'rented Chikns cannot be fattened or rented out again');
check(rt.listed && rt.back && Math.abs(rt.earned - rt.expect) < 0.05, `your Chikn rented out earns ${rt.earned.toFixed(2)} EGG over 3 days while away (expected ${rt.expect.toFixed(2)}) and comes back`);
check(rt.warp, 'skipping 1 h moves the game clock and every timer by 1 h');

// tapping is limited by energy (no infinite clicking)
const tap = await page.evaluate(() => {
  G.S.tapEnergy = G.D.rules.tap.energyMax; let n = 0;
  for (let i = 0; i < 200; i++) if (G.act.tap('stone').ok) n++;
  return { n, max: G.D.rules.tap.energyMax, after: G.act.tap('stone').ok };
});
check(tap.n === tap.max && tap.after === false, `tapping stops when energy runs out (${tap.n} taps from ${tap.max} energy)`);

check(errors.length === 0, 'no JS errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
