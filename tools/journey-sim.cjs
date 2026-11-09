// Simulates a real player in real time: a few short sessions a day, offline progress in between (the game's own
// G.offline, capped exactly like in the browser), and prints when each milestone is reached.
// usage: node tools/journey-sim.cjs [days=60] [sessionsPerDay=3] [sessionMinutes=15] [--weekly] [--rates] [--quiet] [--full]
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const DAYS = +(args[0] || 60), SESS = +(args[1] || 3), MIN = +(args[2] || 15), STEP = 5;

// ---------- simulated clock: Date.now() and new Date() inside the game follow the simulation ----------
let simNow = Date.UTC(2026, 10, 10, 7, 0, 0);
class SimDate extends Date { constructor(...a) { if (a.length) super(...a); else super(simNow); } static now() { return simNow; } }
const ctx = { window: {}, console, Math, Date: SimDate, JSON, Object, Array, Number, String, Set, Map, isFinite, isNaN, parseInt, parseFloat,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['data', 'state', 'systems', 'farm', 'dex']) vm.runInContext(fs.readFileSync(path.join(root, 'src/js', f + '.js'), 'utf8'), ctx);
const G = ctx.G, D = G.D;
const realTick = G.tick;
G.tick = (dt, off) => { simNow += dt * 1000; realTick(dt, off); };
G.S = G.newState('fresh');
const S = G.S;
const day0 = simNow;
const dayNo = () => (simNow - day0) / 86400e3;
const marks = [], seen = new Set();
const mark = (k, extra = '') => { if (seen.has(k)) return; seen.add(k); marks.push([dayNo(), k, extra]); };
let heniumEarned = 0;
G.on('res', () => {});

// ---------- the player's policy: a sensible, engaged player (not a perfect optimiser) ----------
const open = () => D.zones.filter((z) => G.zoneOpen(z));
const digNeed = () => (S.depth < D.maxDepth ? D.digCost(S.depth) : {});
// keep what the next dig needs, and from depth 33 save up for the Guild License the Core Zone requires
const licenseSave = () => (S.depth >= 33 && !S.guild.license ? D.licenseCost : {});
const reserve = (r) => (S.dig ? 0 : (digNeed()[r] || 0)) + (licenseSave()[r] || 0);
const canSpend = (cost) => Object.entries(cost).every(([r, v]) => (S.res[r] || 0) - v >= reserve(r));
const makes = {}; // resource -> [factory, recipe]
for (const f of D.factories) for (const rec of f.recipes) for (const r in rec.out) if (!makes[r]) makes[r] = [f, rec];
function wanted() { // what the economy needs most right now, in priority order
  const need = digNeed(), list = [];
  for (const r of ['circuit', 'alloy', 'machinePart', 'components', 'ironIngot', 'copperIngot']) if (need[r] && S.res[r] < need[r] * 1.5) list.push(r);
  // materials a missing building or the next factory upgrade needs
  for (const f of D.factories) {
    const st = S.factories[f.id];
    const c = !st.lv ? (S.depth >= f.reqDepth ? f.build : null) : st.lv < D.factoryMaxLv ? D.factoryUpCost(f, st.lv) : null;
    if (c) for (const r of ['components', 'machinePart', 'alloy', 'circuit', 'copperIngot', 'ironIngot']) if (c[r] && S.res[r] < c[r] && !list.includes(r)) list.push(r);
  }
  if (S.factories.refinery.lv > 0) list.push('henium');
  list.push('feed');
  for (const r of ['copperIngot', 'ironIngot', 'machinePart', 'components', 'alloy', 'circuit', 'crushedOre']) if (!list.includes(r)) list.push(r);
  return list;
}
function manageFactories() {
  for (const f of D.factories) {
    const st = S.factories[f.id];
    if (!st.lv && !st.con && S.depth >= f.reqDepth && canSpend(f.build) && G.act.build(f.id).ok) mark('build ' + f.id);
  }
  // keep the queue full with repeating jobs for what is needed most (repeat keeps factories busy while offline)
  for (const r of wanted()) {
    if (S.jobs.length >= G.jobSlots()) break;
    const mk = makes[r];
    if (!mk) continue;
    const [f, rec] = mk;
    if (S.factories[f.id].lv < 1 || S.factories[f.id].con || S.jobs.some((j) => j.r === rec.id)) continue;
    if (canSpend(G.recipeIn(rec))) G.act.queue(f.id, rec.id, true);
  }
  // upgrades with what is left over after the next dig is covered
  for (const f of D.factories) {
    const st = S.factories[f.id];
    if (st.lv > 0 && !st.con && st.lv < D.factoryMaxLv && canSpend(D.factoryUpCost(f, st.lv)) && G.act.upgradeFactory(f.id).ok) mark(`${f.id} Lv${st.con ? st.con.to : st.lv + 1}`);
  }
}
function manageFloors() {
  // upgrade a floor when the upgrade pays for itself within a few hours of that floor's output
  for (let guard = 0; guard < 40; guard++) {
    let did = false;
    for (const z of open()) {
      const fc = D.floorCost(z, S.zones[z.id].lv), rate = Math.max(1e-6, G.zoneRate(z));
      if ((fc[z.res] || 0) <= rate * 4 * 3600 && canSpend(fc) && G.act.upgradeZone(z.id).ok) did = true;
    }
    if (!did) break;
  }
}
function manageUpgrades() {
  for (const id of ['slots', 'craft', 'eff', 'waste', 'energy']) {
    const u = D.fUpgrades.find((x) => x.id === id);
    if (S.fup[id] < u.max && canSpend(D.fUpCost(u, S.fup[id])) && S.res.henium - (D.fUpCost(u, S.fup[id]).henium || 0) > 20) G.act.fUpgrade(id);
  }
}
function manageMachines() {
  for (const m of D.machines.slice().reverse()) {
    if (S.player.lv >= m.lv && !S.machines.some((x) => x.type === m.id) && !S.crafts.some((c) => c.type === m.id) && canSpend(m.cost)) {
      if (G.act.craft(m.id).ok) { mark('craft ' + m.id); break; }
    }
  }
  const deepest = D.zoneOf(S.depth);
  if (G.zoneOpen(deepest) && S.machines.length) {
    const dig = (m) => { const d = D.machineById(m.type); return (d.zones && d.zones.includes(deepest.id) ? d.zoneSpeed : d.speed) * (0.5 + m.lv / 20); };
    const best = S.machines.slice().sort((a, b) => dig(b) - dig(a))[0];
    if (best.zone !== deepest.id) G.act.deploy(best.id, deepest.id);
  }
  for (const m of S.machines) if (m.lv < D.machineMaxLv && canSpend(D.machineUpCost(D.machineById(m.type), m.lv))) G.act.upgradeMachine(m.id);
  const zones = open().slice().reverse();
  for (const m of S.machines.filter((x) => !x.zone)) { const z = zones.find((zz) => !G.machineOn(zz.id)); if (z) G.act.deploy(m.id, z.id); }
  for (const m of S.machines) if (m.zone && m.dur < 40) G.act.service(m.id);
}
function manageFarm() {
  if (S.nest >= 1) G.act.collectNest();
  if (S.chikns.length >= G.coopCap() && S.farm.coopLv < D.farm.coopMax && canSpend(D.farm.coopCost(S.farm.coopLv))) G.act.upgradeCoop();
  // rent Chikns from other holders (Chikn NFTs are a fixed collection): the free starter first, then the best bonus per EGG,
  // 30 days with auto-renew, while the EGG reserve and three days of FEED upkeep stay covered
  if (S.chikns.length < G.coopCap()) {
    const val = (o) => D.rarity(o.rarity).pct / Math.max(0.1, o.price);
    const o = G.rentMarket().offers.slice().sort((a, b) => (b.free - a.free) || val(b) - val(a))[0];
    const cost = o ? (o.free ? 0 : D.rentCost(o.price, 30)) : Infinity;
    if (o && (o.free || (S.res.egg - cost >= reserve('egg') + 10 && S.res.feed >= 3 * (G.upkeepPerDay() + D.farm.upkeep(o.kg))))) {
      if (G.act.rent(o.id, 30, true).ok) mark('chikns ' + S.chikns.length);
    }
  }
  const keep = 3 * G.upkeepPerDay();
  for (const c of S.chikns.filter((x) => !x.rent).sort((a, b) => a.kg - b.kg)) if (S.res.feed - G.feedCost(c) > keep) G.act.feed(c.id, 1);
}
function manageOther() {
  G.questList().forEach((q) => q.done && G.act.claimQuest(q.id));
  G.missions().forEach((m) => m.done && !m.claimed && G.act.claimMission(m.id));
  for (let lv = 1; lv <= S.season.lv; lv++) if (!S.season.claimed.includes(lv)) G.act.claimSeason(lv);
  S.exps.filter((e) => e.done).forEach((e) => G.act.claimExp(e.id));
  if (!S.exps.length && G.idleChikns().length) {
    const site = D.expeditions.filter((e) => S.player.lv >= e.lv).pop();
    if (site) G.act.startExp(site.id, G.idleChikns().map((c) => c.id));
  }
  if (S.player.lv >= D.rules.specLv && !S.spec) G.act.chooseSpec('miner');
  const h = S.hazard;
  if (h) {
    if (h.type === 'collapse') G.act.hazard('clear');
    else if (h.type === 'supply') G.act.hazard('open');
    else if (h.type === 'creature') G.act.hazard('fight');
    else if (h.type === 'bandits') G.act.hazard(G.winChance(G.squadPower(), h.power) > 0.5 ? 'fight' : 'pay');
  }
  const i = S.battle.cleared;
  if (D.stages[i] && G.winChance(G.squadPower(), D.stages[i].power) > 0.7 && !((S.battle.cd[i] || 0) > simNow)) G.act.fight(i);
  if (S.battle.tickets > 0 && G.squad().length) G.act.pvp(0);
  if (S.depth >= 30 && !S.guild.license) { if (S.guild.lv >= D.rules.licenseGuildLv) G.act.buyLicense(); }
}
function useDex() {
  // trade surplus ore for whatever is missing for the next dig (never sells HENIUM)
  if (S.dig) return;
  const need = digNeed();
  for (const r of G.missing(need)) {
    if (r === 'henium' || !G.dexRoute('stone', r)) continue;
    const want = need[r] - S.res[r], spend = Math.min(S.res.stone * 0.3, want * G.spot(r, 'stone') * 1.15);
    if (spend > 1 && G.act.swap('stone', r, spend).ok) mark('dex for ' + r);
  }
}
function act() {
  const before = S.res.henium;
  if (!S.dig && S.depth < D.maxDepth && G.act.dig().ok) mark('digging to ' + S.dig.to);
  manageFloors(); manageFactories(); manageUpgrades(); manageMachines(); manageFarm(); manageOther(); useDex();
  if (S.res.henium > before) heniumEarned += S.res.henium - before;
  // taps: spend the pickaxe energy on the newest floor
  const z = open().slice(-1)[0];
  for (let k = 0; k < Math.floor(S.tapEnergy || 0) && z; k++) if (!G.act.tap(z.id).ok) break;
}
let lastDepth = S.depth;
const pollDepth = () => { while (lastDepth < S.depth) { lastDepth++; mark('depth ' + lastDepth); } };

// ---------- the calendar ----------
const hours = Array.from({ length: SESS }, (_, i) => (SESS === 1 ? 20 : 8 + Math.round(i * 14 / (SESS - 1))));
const t0 = Date.now();
const weekly = [];
for (let d = 0; d < DAYS; d++) {
  for (const h of hours) {
    const start = day0 + d * 86400e3 + (h - 7) * 3600e3;
    const gap = (start - simNow) / 1000;
    if (gap > 0) { G.offline(gap); simNow = start; S.last = simNow; }
    pollDepth();
    for (let s = 0; s < MIN * 60; s += STEP) { G.tick(STEP); act(); pollDepth(); }
  }
  if ((d + 1) % 7 === 0 || d === DAYS - 1) weekly.push({ day: d + 1, depth: S.depth, floors: open().map((z) => z.short + ':' + S.zones[z.id].lv).join(' '),
    fac: D.factories.filter((f) => S.factories[f.id].lv).map((f) => f.id.slice(0, 4) + S.factories[f.id].lv).join(' '),
    henium: S.res.henium.toFixed(1), egg: Math.floor(S.res.egg), feed: Math.floor(S.res.feed), chikns: S.chikns.length, lv: S.player.lv,
    stoneH: Math.round(G.zoneRate(D.zones[0]) * 3600), perDay: Object.fromEntries(Object.entries(G.rates()).filter(([k]) => k !== 'egg').map(([k, v]) => [k, v * 86400])), ref: G.refPerDay().toFixed(1), war: G.warPerDay().toFixed(1), hunt: G.huntPerDay().toFixed(1), stage: S.battle.cleared, season: S.season.lv });
  if (S.depth >= D.maxDepth && !flags.has('--full')) break;
}

// ---------- report ----------
const fmtD = (x) => (x < 1 ? `${(x * 24).toFixed(1)}h` : `day ${x.toFixed(1)}`);
if (!flags.has('--quiet')) {
  const show = marks.filter(([, k]) => /^depth (2|3|6|11|16|21|26|31|36|41|46|50)$/.test(k) || /^build /.test(k) || /^craft /.test(k) || /refinery Lv(5|10)/.test(k) || /^chikns (2|5|10)$/.test(k));
  for (const [x, k] of show) console.log(fmtD(x).padEnd(10), k);
}
const big = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : n.toFixed(0));
if (flags.has('--rates')) for (const w of weekly) console.log(`day ${String(w.day).padStart(3)} output/day: ${Object.entries(w.perDay).map(([k, v]) => k + ' ' + big(v)).join(', ')}`);
if (flags.has('--weekly')) for (const w of weekly) console.log(`day ${String(w.day).padStart(3)}: depth ${String(w.depth).padStart(2)} | Lv ${w.lv} | stone ${w.stoneH}/h | ${w.floors} | ${w.fac} | H ${w.henium} (+${w.ref}/${w.war}/${w.hunt} a day) EGG ${w.egg} FEED ${w.feed} chikns ${w.chikns} stage ${w.stage} season ${w.season}`);
console.log(`end (${dayNo().toFixed(1)} days, ${SESS}×${MIN} min/day): depth ${S.depth}, player Lv ${S.player.lv}, HENIUM ${S.res.henium.toFixed(1)}, EGG ${Math.floor(S.res.egg)}, FEED ${Math.floor(S.res.feed)}, chikns ${S.chikns.length}`);
console.log(`world mined ${Math.round(S.world.mined).toLocaleString()} HENIUM; sim took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log('next dig:', S.depth < D.maxDepth ? JSON.stringify({ gate: G.digGate(S.depth + 1), missing: G.missing(D.digCost(S.depth)), digging: !!S.dig }) : 'done',
  '| refinery Lv', S.factories.refinery.lv, S.factories.refinery.con ? '(building)' : '', '| license', S.guild.license, 'guild Lv', S.guild.lv,
  '| next refinery upgrade needs', JSON.stringify(S.factories.refinery.lv < 10 ? G.missing(D.factoryUpCost(D.factoryById('refinery'), S.factories.refinery.lv)) : []));
