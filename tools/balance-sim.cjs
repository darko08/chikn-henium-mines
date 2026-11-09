// Simulates an active player on a fresh save and prints when each milestone is reached.
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const ctx = { window: {}, console, Math, Date, JSON, Object, Array, Number, String, Set, isFinite, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['data', 'state', 'systems', 'farm', 'dex']) vm.runInContext(fs.readFileSync(path.join(root, 'src/js', f + '.js'), 'utf8'), ctx);
const G = ctx.G, D = G.D;
G.S = G.newState('fresh');
const S = G.S, marks = {}, log = (k) => { if (!marks[k]) marks[k] = t; };
const HOURS = +(process.argv[2] || 4), TAPS = +(process.argv[3] || 2);
let t = 0;
const zoneOrder = () => D.zones.filter((z) => G.zoneOpen(z));
for (t = 0; t < HOURS * 3600; t++) {
  G.tick(1);
  if (t < 3600) for (let i = 0; i < TAPS; i++) G.act.tap(zoneOrder().slice(-1)[0].id);
  if (t % 2) continue;
  if (S.stats.hired === 0) G.act.hire('standard');
  G.questList().forEach((q) => q.done && G.act.claimQuest(q.id));
  G.missions().forEach((m) => m.done && !m.claimed && G.act.claimMission(m.id));
  if (S.nest >= 1) G.act.collectNest();
  S.exps.filter((e) => e.done).forEach((e) => G.act.claimExp(e.id));
  for (const f of D.factories) if (!S.factories[f.id].lv && S.depth >= f.reqDepth) { if (G.act.build(f.id).ok) log('build ' + f.id); }
  for (const f of D.factories) {
    if (!S.factories[f.id].lv || G.activeJob(f.id)) continue;
    const recs = f.recipes;
    // pick the recipe whose main output we have least of (a sensible player keeps materials balanced)
    const rec = recs.slice().sort((x, y) => { const ox = Object.keys(x.out)[0], oy = Object.keys(y.out)[0]; return (S.res[ox] || 0) - (S.res[oy] || 0); })[0];
    const need = G.recipeIn(rec), dcost = D.digCost(S.depth);
    if (f.id === 'feedmill' || Object.keys(need).every((k) => S.res[k] - need[k] >= (dcost[k] || 0) * 1.2)) G.act.queue(f.id, rec.id, false);
  }
  for (const m of D.machines.slice().reverse()) {
    if (S.player.lv >= m.lv && !S.machines.some((x) => x.type === m.id) && !S.crafts.some((c) => c.type === m.id)) { if (G.act.craft(m.id).ok) { log('craft ' + m.id); break; } }
  }
  const spare = S.machines.filter((m) => !m.zone).sort((a, b) => D.machines.findIndex((x) => x.id === b.type) - D.machines.findIndex((x) => x.id === a.type));
  for (const m of spare) { const z = zoneOrder().reverse().find((z) => !G.machineOn(z.id)) || zoneOrder().slice(-1)[0]; G.act.deploy(m.id, z.id); }
  S.machines.filter((m) => m.zone && m.dur < 30).forEach((m) => G.act.service(m.id));
  if (S.player.lv >= 8 && !S.spec) G.act.chooseSpec('miner');
  if (S.factories.refinery.lv >= 1 && S.depth >= 38 && S.factories.refinery.lv < 5) G.act.upgradeFactory('refinery');
  if (S.depth >= 38 && !S.guild.license) { if (S.guild.lv >= 5) G.act.buyLicense(); else G.act.donate(4); }
  const r = G.act.dig();
  if (r.ok) { log('depth ' + S.depth); continue; }
  // upgrade the cheapest open floor (deeper floors first on ties)
  // invest in a floor when it pays back within ~3 minutes of that floor's own output
  for (const z of zoneOrder()) {
    const fc = D.floorCost(z, S.zones[z.id].lv), rate = Math.max(0.01, G.zoneRate(z));
    if ((fc[z.res] || 0) <= rate * 180 && G.act.upgradeZone(z.id).ok) break;
  }
  // use the DEX to unblock the next dig: trade the most plentiful ore for whatever is missing
  if (t % 30 === 0 && !S.dig) {
    const need = D.digCost(S.depth);
    for (const r of G.missing(need)) {
      if (r === 'henium' || !G.dexRoute('stone', r)) continue;
      const want = need[r] - S.res[r], spend = Math.min(S.res.stone * 0.3, want * G.spot(r, 'stone') * 1.15);
      if (spend > 0 && G.act.swap('stone', r, spend).ok) log('dex ' + r);
    }
  }
  if (t % 600 === 0 && G.idleChikns().length && !S.exps.length) G.act.startExp('shaft', G.idleChikns().map((c) => c.id));
  if (S.res.egg > 30 && S.res.feed > 25) G.act.hire('standard');
  if (S.chikns.length >= G.coopCap()) G.act.upgradeCoop();
  for (const c of S.chikns) if (S.res.feed > 3 * G.upkeepPerDay() + G.feedCost(c)) G.act.feed(c.id);
  for (const f of D.factories) { if (S.factories[f.id].lv > 0 && !S.factories[f.id].con && S.factories[f.id].lv < 4 && f.id !== 'refinery') G.act.upgradeFactory(f.id); }


}
const fmtT = (s) => `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
const keys = Object.keys(marks).filter((k) => /depth (3|6|11|16|21|26|31|36|41|46|50)$/.test(k) || k.startsWith('build') || k.startsWith('craft') || k.startsWith('dex'));
for (const k of keys) console.log(k.padEnd(18), fmtT(marks[k]));
console.log(`after ${HOURS}h: depth ${S.depth}, player Lv ${S.player.lv}, henium ${S.res.henium.toFixed(1)}, egg ${Math.round(S.res.egg)}, chikns ${S.chikns.length}`);
console.log('floors', JSON.stringify(Object.fromEntries(Object.entries(S.zones).map(([k, v]) => [k, v.lv]))));
const gate = S.depth < 50 ? G.digGate(S.depth + 1) : null; console.log('next dig cost', JSON.stringify(D.digCost(S.depth)), 'gate', gate);
console.log('dig in progress', JSON.stringify(S.dig), 'missing for next dig', JSON.stringify(G.missing(D.digCost(S.depth))));
console.log('res', JSON.stringify(Object.fromEntries(['stone', 'coal', 'copper', 'iron', 'copperIngot', 'ironIngot', 'components', 'machinePart', 'crushedOre', 'feed', 'egg'].map((k) => [k, Math.round(S.res[k])]))));
console.log('factories', JSON.stringify(Object.fromEntries(Object.entries(S.factories).map(([k, v]) => [k, v.lv + (v.con ? '+con' : '')]))), 'jobs', S.jobs.map((j) => j.f + ':' + j.r).join(' '));
console.log('rates/s', JSON.stringify(Object.fromEntries(Object.entries(G.rates()).map(([k, v]) => [k, +v.toFixed(2)]))));
console.log('HENIUM: share', (G.refShare() * 100).toFixed(2) + '%', 'refinery/day', G.refPerDay().toFixed(1), 'war/day', G.warPerDay().toFixed(1), 'emission/day', G.emission(), 'world mined', Math.round(S.world.mined), 'epoch', G.epoch() + 1);
console.log('DEX volume', Math.round(S.dex.volume), 'H, NPC treasury', Math.round(S.dex.npc.henium), 'burned', JSON.stringify(S.dex.burned));
console.log('DEX: EGG in HENIUM', G.spot('egg', 'henium').toFixed(3), 'HENIUM in ETH', G.spot('henium', 'eth').toFixed(5), '1000 stone ->', G.dexQuote('stone', 'henium', 1000).out.toFixed(3), 'H; 10 EGG -> ETH', G.dexQuote('egg', 'eth', 10).out.toFixed(5));
