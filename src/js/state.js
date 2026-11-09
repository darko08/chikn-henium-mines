// Game state, persistence, formatting, bonuses, production rates and the simulation tick.
(() => {
const G = window.G, D = G.D, R = D.rules;
const SAVE_KEY = 'chikn-henium-mines-v2'; // v2: real-time economy (old saves from the fast prototype are not loaded)
// the game clock: real time plus whatever test speed / time skips added (S.clockOff, saved with the game)
const now = () => Date.now() + ((G.S && G.S.clockOff) || 0);
G.now = now;
G.speed = () => (G.S && G.S.settings && G.S.settings.speed) || 1; // test speed: game seconds per real second

// ---------- formatting ----------
const units = [[1e12, 1e12, 'T'], [1e9, 1e9, 'B'], [1e6, 1e6, 'M'], [1e4, 1e3, 'K']]; // [threshold, divisor, suffix]
G.fmt = (n, dec = 0) => {
  if (n == null || !isFinite(n)) return '0';
  const a = Math.abs(n);
  for (const [th, v, s] of units) if (a >= th) { const x = n / v; return (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1)).replace(/\.0$/, '') + s; }
  if (dec && a < 1000) return n.toFixed(dec).replace(/\.?0+$/, '') || '0';
  return Math.floor(n).toLocaleString('en-US');
};
G.fmtFull = (n, dec = 0) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
G.fmtRes = (r, n) => (r === 'eth' ? (n || 0).toFixed(4) : r === 'henium' ? (Math.abs(n) >= 1e5 ? G.fmt(n) : G.fmtFull(Math.floor(n * 100) / 100, 2)) : (Math.abs(n) >= 1e7 ? G.fmt(n) : G.fmtFull(Math.floor(n))));
G.fmtTime = (s) => {
  s = Math.max(0, Math.ceil(s));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(x).padStart(2, '0')}s`;
  return `${x}s`;
};
G.dayKey = () => new Date(now()).toISOString().slice(0, 10);
// a journey month, once reached, stays reached (S.journey), even if the goal later slips (war points decay every day)
D.journey.forEach((j, i) => { const raw = j.done; j.done = (S) => { if (S && S.journey && S.journey[i]) return true; const d = !!raw(S); if (d && S && S.journey) S.journey[i] = true; return d; }; });
G.rand = (a, b) => a + Math.random() * (b - a);
G.randInt = (a, b) => Math.floor(G.rand(a, b + 1));
G.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------- events ----------
const handlers = {};
G.on = (e, fn) => (handlers[e] = handlers[e] || []).push(fn);
G.emit = (e, ...a) => (handlers[e] || []).forEach((fn) => { try { fn(...a); } catch (err) { console.error(err); } }); // all arguments reach the handlers

// ---------- state ----------
const allRes = () => Object.fromEntries(Object.keys(D.res).map((k) => [k, 0]));
G.newState = (kind = 'fresh') => {
  const S = {
    v: 1, kind, created: now(), last: now(), nextId: 1,
    player: { name: 'MineMaster', lv: 1, xp: 0 }, spec: null,
    res: Object.assign(allRes(), { egg: 30, feed: 40, henium: 5 }),
    depth: 1, sel: 'stone',
    zones: Object.fromEntries(D.zones.map((z) => [z.id, { lv: z.id === 'stone' ? 1 : 0 }])),
    factories: Object.fromEntries(D.factories.map((f) => [f.id, { lv: 0, recipe: f.recipes[0].id, con: null }])),
    jobs: [], fup: { eff: 0, waste: 0, energy: 0, slots: 0, craft: 0 },
    machines: [], crafts: [], craftSlots: 3,
    chikns: [], squad: [], nest: 0, farm: { coopLv: 1, day: 0, dayT: 0, milled: 0, hungry: false }, dig: null,
    guild: { name: 'Henium Raiders', members: 142, max: 200, lv: 3, proj: 0, pts: 0, contrib: 0, zoneLv: 1, license: false, warPts: 0, bonus: 0 },
    market: { p: { ...D.market }, hist: Object.fromEntries(Object.keys(D.market).map((k) => [k, [D.market[k]]])), log: [], t: 0 },
    exps: [],
    battle: { cleared: 0, cd: {}, tickets: D.pvpTickets, tt: 0 },
    season: { lv: 1, xp: 0, claimed: [], ends: now() + (23 * 24 + 14) * 3600e3 },
    daily: { day: G.dayKey(), prog: {}, claimed: {} },
    quests: { done: [] },
    stats: { mined: 0, processed: 0, crafted: 0, refined: 0, taps: 0, hired: 0, wins: 0, exps: 0, upgrades: 0, ingots: 0, eggBurned: 0, feeBurned: 0, rentEarned: 0, rentPaid: 0 },
    world: { mined: 0, war: D.supply.worldWar0, hunt: D.supply.worldHunt0, paid: 0 }, worldT: Math.max(0, (now() - D.supply.genesis) / 1000),
    hunt: 0, tapEnergy: D.rules.tap.energyMax,
    live: { id: null, until: 0, next: now() + 75e3 },
    hazard: null, hazardNext: now() + 100e3,
    notes: [], settings: { sound: true, speed: 1 }, saveT: 0, clockOff: 0, journey: [],
  };
  S.world.mined = D.cumEmission(S.worldT / 86400);
  G.dexInit(S);
  if (kind === 'showcase') showcase(S);
  return S;
};

function showcase(S) {
  Object.assign(S.player, { lv: 27, xp: 4200 });
  S.spec = 'miner';
  Object.assign(S.res, { egg: 1250, feed: 348, henium: 1842.75, stone: 240e6, coal: 110e6, copper: 54e6, iron: 81e6,
    heniumOre: 1.85e6, rareEarth: 14600, crushedOre: 82500, copperIngot: 41200, ironIngot: 37600, components: 4200, machinePart: 2600, alloy: 1800, circuit: 900 });
  S.depth = 27; S.sel = 'henium';
  Object.assign(S.zones, { stone: { lv: 18 }, coal: { lv: 15 }, copper: { lv: 12 }, iron: { lv: 10 }, henium: { lv: 6 } });
  const fl = { crusher: 3, separator: 3, smelter: 3, forge: 3, advanced: 2, refinery: 2 };
  for (const id in fl) S.factories[id].lv = fl[id];
  S.machines = [
    { id: 1, type: 'heavy', lv: 10, dur: 72, zone: 'henium' },
    { id: 2, type: 'improved', lv: 5, dur: 88, zone: 'iron' },
    { id: 3, type: 'basic', lv: 4, dur: 64, zone: 'coal' },
  ];
  const mk = (role, rarity, lv, name) => ({ id: S.nextId++, name, num: G.randInt(1000, 9999), role, rarity, lv, status: 'idle', until: 0, own: true });
  S.nextId = 10;
  S.chikns = [mk('miner', 'legendary', 10, 'Goldie'), mk('engineer', 'rare', 8, 'Gizmo'), mk('miner', 'epic', 1, 'Rocky'),
    mk('guardian', 'epic', 12, 'Flint'), mk('explorer', 'rare', 10, 'Juniper'), mk('operator', 'uncommon', 9, 'Tinker'),
    mk('scientist', 'rare', 8, 'Nova'), mk('medic', 'uncommon', 7, 'Hazel'), mk('trader', 'common', 6, 'Coco'),
    mk('leader', 'legendary', 11, 'Henrietta'), mk('crafter', 'common', 5, 'Biscuit'), mk('explorer', 'uncommon', 6, 'Pip')];
  S.chikns.forEach((c) => G.ensureKg(c));
  S.squad = S.chikns.slice(0, 3).map((c) => c.id);
  S.squad.forEach((id) => (G.chikn(S, id).status = 'squad'));
  // rentals: one Chikn rented from another holder, one of yours rented out (passive EGG), one listed for rent
  const rented = mk('miner', 'epic', 1, 'Pebbles'); rented.own = false; G.ensureKg(rented); rented.kg += 60; G.syncLv(rented);
  rented.rent = { left: 3.4 * 86400, days: 7, price: 1.5, owner: '0x8f3a…c21d', auto: true };
  S.chikns.push(rented);
  const pip = S.chikns.find((c) => c.name === 'Pip'); pip.status = 'away';
  pip.lease = { price: 0.85, days: 7, left: 2.2 * 86400, renter: '0x51be…07a9', earned: 3.6, k: 1 };
  const biscuit = S.chikns.find((c) => c.name === 'Biscuit');
  biscuit.lease = { price: 0.62, days: 3, left: null, renter: null, earned: 0, k: 1 };
  S.jobs = [
    { id: 1, f: 'smelter', r: 'smeltCopper', t: 200, dur: 485, repeat: true },
    { id: 2, f: 'forge', r: 'parts', t: 600, dur: 1458, repeat: true },
    { id: 3, f: 'refinery', r: 'refine', t: 1200, dur: 3600, repeat: true },
  ];
  S.crafts = [{ id: 4, type: 'scanner', t: 7200, dur: 28800 }, { id: 5, type: 'improved', t: 900, dur: 3600 }];
  S.craftSlots = 5; S.fup.craft = 2; // "Crafting Queue (2/5)" as in the mockup
  S.farm = { coopLv: 4, day: 41, dayT: 30000, milled: 2, hungry: false };
  S.factories.feedmill.lv = 3; S.nest = 6;
  S.factories.advanced.con = { t: 600, dur: D.buildTime(3), to: 3 };  // an upgrade under construction
  S.dig = { t: 86400 * 2.5, dur: D.digTime(28), to: 28 };            // digging towards depth 28
  Object.assign(S.guild, { lv: 7, proj: 4, bonus: 36, pts: Math.round(D.guildProjects[4].need * 0.4), contrib: 5200, zoneLv: 3, warPts: 180 }); // Lv. 7 = 4 projects done (+36% mining)
  Object.assign(S.season, { lv: 27, xp: 4200 });
  S.battle.cleared = 4;
  Object.assign(S.stats, { mined: 4.2e6, processed: 260000, crafted: 6, refined: 24, taps: 900, hired: 12, wins: 22, exps: 9, upgrades: 230, ingots: 12000 });
  S.daily.prog = { mined: 3200, processed: 2000 };
  S.quests.done = D.quests.slice(0, D.quests.findIndex((q) => q.id === 'refinery')).map((q) => q.id);
  S.live = { id: 'vein', until: now() + 9 * 3600e3, next: now() + 20 * 3600e3 };
}

G.chikn = (S, id) => S.chikns.find((c) => c.id === id);

// ---------- persistence ----------
function merge(def, saved) {
  if (Array.isArray(def) || typeof def !== 'object' || def === null) return saved === undefined ? def : saved;
  const out = { ...def };
  for (const k in saved) out[k] = k in def ? merge(def[k], saved[k]) : saved[k];
  return out;
}
G.save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(G.S)); } catch (e) { /* storage blocked */ } };
G.load = () => {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const S = merge(G.newState(), saved);
    for (const id in S.factories) if (S.factories[id].con === undefined) S.factories[id].con = null;
    S.chikns.forEach((c) => { G.ensureKg(c); if (c.own === undefined) c.own = true; }); // Chikns hired before rentals are yours
    // saves from before the world clock and the world hunt pool
    if (!(typeof S.worldT === 'number' && S.worldT >= 0)) S.worldT = Math.max(0, (now() - D.supply.genesis) / 1000);
    if (!(typeof S.world.hunt === 'number' && S.world.hunt > 0)) S.world.hunt = D.supply.worldHunt0;
    if (!(typeof S.world.paid === 'number')) S.world.paid = 0;
    S.world.mined = D.cumEmission(S.worldT / 86400);
    // a supply crate or creature saved while rewards still paid EGG: re-roll its loot with today's rules
    const H = S.hazard, HR = H && (H.type === 'creature' ? R.creature : H.type === 'supply' ? R.supply : null);
    if (HR && H.reward && 'egg' in H.reward) H.reward = { ...HR.loot(S.depth), feed: HR.feed(S.depth) };
    return S;
  } catch (e) { return null; }
};
G.wipe = () => { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } };

// ---------- costs ----------
G.has = (cost, k = 1) => Object.keys(cost).every((r) => G.S.res[r] + 1e-9 >= cost[r] * k);
G.pay = (cost, k = 1) => { if (!G.has(cost, k)) return false; for (const r in cost) G.S.res[r] -= cost[r] * k; G.emit('res'); return true; };
// transfer=true for HENIUM that only changes hands (refunds, trades). Any other HENIUM is newly minted: it is part of the
// world's scheduled emission (S.world.mined follows the schedule exactly, so whatever you earn the rest of the world does
// not), and nothing is paid once all 21M are mined. Returns what was given.
G.give = (rew, k = 1, transfer = false) => {
  const S = G.S, got = {};
  for (const r in rew) {
    if (!(r in S.res)) continue;
    let v = rew[r] * k;
    if (r === 'henium' && v > 0 && !transfer && S.world) {
      if (S.world.mined >= D.supply.cap) v = 0;
      S.world.paid = (S.world.paid || 0) + v;
    }
    S.res[r] += v; got[r] = v;
  }
  G.emit('res');
  return got;
};
G.scale = (cost, k) => Object.fromEntries(Object.entries(cost).map(([r, v]) => [r, Math.ceil(v * k)]));
G.missing = (cost) => Object.keys(cost).filter((r) => G.S.res[r] + 1e-9 < cost[r]);
G.stat = (name, n = 1) => {
  const S = G.S;
  S.stats[name] = (S.stats[name] || 0) + n;
  S.daily.prog[name] = (S.daily.prog[name] || 0) + n;
};

// ---------- bonuses ----------
G.chiknPct = (c) => D.rarity(c.rarity).pct * (1 + 0.06 * (c.lv - 1));
G.chiknPower = (c) => Math.round(D.rarity(c.rarity).power * (1 + 0.12 * (c.lv - 1)) * (c.role === 'guardian' ? 1.8 : 1));
G.squad = () => G.S.squad.map((id) => G.chikn(G.S, id)).filter(Boolean);
G.squadSlots = () => D.squadSlots(G.S.player.lv);
G.bonus = (type) => { // fraction, e.g. 0.42
  let b = 0;
  for (const c of G.squad()) {
    const role = D.roles[c.role].bonus;
    if (role === type) b += G.chiknPct(c) / 100;
    else if (role === 'all' && ['mine', 'factory', 'machine', 'refine', 'craft', 'explore'].includes(type)) b += G.chiknPct(c) / 200;
  }
  return b;
};
G.specIs = (id) => !!G.S && G.S.spec === id;
G.liveEvent = () => (G.S.live.id && now() < G.S.live.until ? D.liveEvents.find((e) => e.id === G.S.live.id) : null);
G.mineMult = (zid) => {
  const S = G.S;
  let m = 1 + G.bonus('mine') + S.guild.bonus / 100 + (G.specIs('miner') ? 0.15 : 0);
  const ev = G.liveEvent();
  if (ev && ev.mult && (!ev.zone || ev.zone === zid)) m *= ev.mult;
  if (S.hazard && S.hazard.type === 'collapse' && S.hazard.zone === zid) m = 0;
  return m;
};
G.machineOn = (zid) => G.S.machines.find((m) => m.zone === zid);
G.machineStats = (m) => {
  const def = D.machineById(m.type);
  // def.speed / def.cap are the values at Lv. 10 (Heavy Drill Lv. 10 = 2.5x, +500/h as in the mockup)
  const base = def.zones && def.zones.includes(m.zone) ? def.zoneSpeed : def.speed;
  const lvK = 0.5 + m.lv / 20;
  const speed = 1 + (base - 1) * lvK * (1 + G.bonus('machine') / 2);
  return { def, speed, cap: def.cap * lvK, energy: def.energy * (1 - 0.04 * G.S.fup.energy), rare: def.rare || 0, working: m.dur > 0 && !m.off };
};
G.zoneOpen = (z) => G.S.depth >= z.from && G.S.zones[z.id].lv > 0;
G.zoneDug = (z) => Math.max(0, Math.min(G.S.depth, z.to) - z.from + 1);
G.zoneRate = (z) => { // main resource per second
  const S = G.S;
  if (!G.zoneOpen(z)) return 0;
  let r = D.floorRate(z, S.zones[z.id].lv, G.zoneDug(z));
  const m = G.machineOn(z.id);
  if (m) { const ms = G.machineStats(m); if (ms.working) r = r * ms.speed + ms.cap / 3600; }
  r *= G.mineMult(z.id);
  if (z.res === 'heniumOre') r *= 1 + R.guildZone.heniumOre * (S.guild.zoneLv - 1);
  if (z.res === 'rareEarth') r *= 1 + R.guildZone.rareEarth * (S.guild.zoneLv - 1);
  return r;
};
G.zoneOutputs = (z) => { // {res: perSec}
  const r = G.zoneRate(z), out = { [z.res]: r };
  if (z.extra) for (const k in z.extra) out[k] = (out[k] || 0) + r * z.extra[k];
  const m = G.machineOn(z.id);
  if (m && r > 0) { const ms = G.machineStats(m); if (ms.working && ms.rare) out.rareEarth = (out.rareEarth || 0) + r * ms.rare; }
  return out;
};
// EGG laying (G.chiknEgg, G.eggRate, G.eggsPerDay) lives in farm.js
G.rates = () => { // gross mining per second by resource
  const out = {};
  for (const z of D.zones) { const o = G.zoneOutputs(z); for (const k in o) out[k] = (out[k] || 0) + o[k]; }
  out.egg = (out.egg || 0) + G.eggRate();
  return out;
};
G.coalUse = () => G.S.machines.filter((m) => m.zone && m.dur > 0).reduce((s, m) => s + G.machineStats(m).energy, 0) / 3600;

// factory helpers
G.factorySpeed = (f) => { // time multiplier (< 1 is faster)
  const S = G.S, lv = S.factories[f.id].lv;
  let k = D.factorySpeed(lv) / (1 + 0.05 * S.fup.eff + G.bonus('factory') + (G.specIs('indus') ? 0.15 : 0));
  return k;
};
G.recipeIn = (rec) => G.scale(rec.in, 1 - 0.03 * G.S.fup.waste);
G.recipeOut = (f, rec) => {
  const S = G.S;
  let k = D.factoryYield(S.factories[f.id].lv) * (G.specIs('indus') ? 1.1 : 1);
  if (f.id === 'refinery') {
    const dur = (G.S.jobs.find((j) => j.f === 'refinery' && j.r === rec.id) || {}).dur || rec.t;
    return { henium: Math.round(G.refPerDay() * dur / D.farm.day * 100) / 100 };
  }
  return Object.fromEntries(Object.entries(rec.out).map(([r, v]) => [r, r === 'henium' ? Math.round(v * k * 100) / 100 : Math.max(1, Math.round(v * k))]));
};
G.jobSlots = () => 3 + G.S.fup.slots;
// jobs that take a queue slot: the Feed Mill is capped by its daily quota instead, so it never blocks (or is blocked by) the queue
G.slotJobs = () => G.S.jobs.filter((j) => j.f !== 'feedmill').length;
G.queueFull = (fid) => fid !== 'feedmill' && G.slotJobs() >= G.jobSlots();
G.jobDur = (f, rec) => rec.t * (f.id === 'refinery' ? 1 : G.factorySpeed(f)); // refinery batches have a fixed length
// building art: 10 looks per building, one per level; the HQ gets a new look every 5 depth levels
// falls back to the highest look that exists, so a missing image never shows as a blank
const tierKey = (id, t) => { for (let n = t; n >= 1; n--) { const k = 'tier/' + id + '-' + n; if (!G.ASSETS || G.ASSETS[k]) return k; } return 'tier/' + id + '-1'; };
G.bImg = (fid, lv) => tierKey(fid, D.tier(Math.max(1, lv || 1)));
G.hqImg = () => tierKey('hq', D.hqTier(G.S.depth));
G.coopImg = () => tierKey('coop', D.tier(G.S.farm.coopLv));
G.worldDays = () => (G.S.worldT || 0) / 86400;                          // days since the game's launch (world clock)
G.epoch = () => Math.floor(G.worldDays() / D.supply.halvingDays);
G.halving = () => (G.S.world.mined >= D.supply.cap ? 0 : Math.pow(0.5, G.epoch())); // 0 once all 21M are mined
G.nextHalving = () => D.cumEmission((G.epoch() + 1) * D.supply.halvingDays);        // world supply at the next halving
G.nextHalvingDate = () => new Date(D.supply.genesis + (G.epoch() + 1) * D.supply.halvingDays * 86400e3).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
G.nextHalvingIn = () => ((G.epoch() + 1) * D.supply.halvingDays - G.worldDays()) * 86400; // seconds to the next halving
// HENIUM emission: the world mints D.supply.daily per game day; you earn a share of it by refining (work),
// by guild wars (fighting other guilds) and by hunting monsters. Shares shrink as the world grows.
G.emission = () => D.supply.daily * G.halving();                         // whole world, per game day
G.myRefPower = () => D.refPower(G.S.factories.refinery.lv) * (1 + G.bonus('refine') + R.guildZone.refine * (G.S.guild.zoneLv - 1) + (G.specIs('miner') ? 0.05 : 0));
G.worldRefPower = () => D.supply.worldPower0 * Math.pow(1 + D.supply.worldGrowth, G.worldDays());
G.refShare = () => { const m = G.myRefPower(); return m > 0 ? m / (m + G.worldRefPower()) : 0; };
G.refPerDay = () => G.emission() * D.supply.split.refinery * G.refShare();  // HENIUM/day if the refinery never stops
G.warShare = () => { const w = G.S.guild.warPts; return w > 0 ? w / (w + G.S.world.war) : 0; };
G.warPerDay = () => G.emission() * D.supply.split.war * G.warShare();
G.huntShare = () => { const h = G.S.hunt || 0; return h > 0 ? h / (h + (G.S.world.hunt || D.supply.worldHunt0)) : 0; };
G.huntPerDay = () => G.emission() * D.supply.split.boss * G.huntShare();
G.activeJob = (fid) => G.S.jobs.find((j) => j.f === fid);

// ---------- xp & levels ----------
G.addXP = (n) => {
  const S = G.S, p = S.player;
  n = Math.round(n);
  if (n <= 0) return;
  p.xp += n;
  while (p.xp >= D.xpNeed(p.lv)) { p.xp -= D.xpNeed(p.lv); p.lv++; G.emit('levelUp', p.lv); }
  const s = S.season;
  if (s.lv < D.seasonMax) {
    s.xp += n;
    while (s.lv < D.seasonMax && s.xp >= D.seasonNeed(s.lv)) { s.xp -= D.seasonNeed(s.lv); s.lv++; G.emit('seasonUp', s.lv); }
  }
};

// ---------- simulation ----------
// mineK (0..1) is the share of dt the floors mine: offline mining stops after the offline cap (G.offline)
G.tick = (dt, offline = false, mineK = 1) => {
  const S = G.S;
  if (!(dt > 0)) return;
  // mining
  if (mineK > 0) for (const z of D.zones) {
    const o = G.zoneOutputs(z);
    for (const r in o) { const a = o[r] * dt * mineK; S.res[r] += a; if (r === z.res) G.stat('mined', a); }
  }
  // machines: coal and wear
  const coalPer = {};
  for (const m of S.machines) {
    if (!m.zone || m.dur <= 0 || mineK <= 0) { m.off = false; continue; }
    const ms = G.machineStats(m), need = ms.energy / 3600 * dt * mineK;
    // a machine that ran dry waits for 10 minutes' worth of Coal before it restarts, so it can't flicker on and off
    const enough = m.off ? S.res.coal >= Math.max(need, ms.energy / 6) : S.res.coal >= need;
    if (enough) { S.res.coal -= need; if (m.off) m.offT = 0; m.off = false; }
    else { if (!m.off) { if (!offline) G.emit('noCoal', m); else G.logAway('coal', `${D.machineById(m.type).name} ran out of Coal and stopped`); } m.off = true; continue; }
    coalPer[m.id] = need;
    if (offline) continue; // machines only wear while you play
    const wear = ms.def.wear / 60 * dt * (1 - Math.min(0.6, G.bonus('machine') * 0.5));
    const before = m.dur;
    m.dur = Math.max(0, m.dur - wear);
    if (before > 0 && m.dur === 0 && !offline) G.emit('broken', m);
  }
  // tap energy refills over time
  S.tapEnergy = Math.min(D.rules.tap.energyMax, (S.tapEnergy ?? D.rules.tap.energyMax) + D.rules.tap.regen * dt);
  // farm: eggs, FEED upkeep, hunger
  G.farmTick(dt, offline);
  // Chikn NFT rentals: rented Chikns go home, renters take your listings, rent arrives (also while you are away)
  G.sys.rentTick(dt, offline);
  // construction and digging timers
  for (const f of D.factories) { const st = S.factories[f.id]; if (st.con) { st.con.t += dt; if (st.con.t >= st.con.dur) G.sys.finishBuild(f, offline); } }
  if (S.dig) { S.dig.t += dt * G.digSpeed(); if (S.dig.t >= S.dig.dur) G.sys.finishDig(offline); }
  // factories (one active job per factory, in queue order)
  const seen = new Set();
  for (const j of [...S.jobs]) {
    if (seen.has(j.f)) continue;
    seen.add(j.f);
    if (S.factories[j.f].con) continue; // paused while the building is under construction
    // a long tick can finish several batches: the leftover time carries into the next job of the same factory
    let job = j, guard = 0;
    job.t += dt;
    while (job && job.t >= job.dur && guard++ < 2000) {
      const over = job.t - job.dur;
      G.sys.finishJob(job, offline);
      job = G.activeJob(j.f);
      if (job) job.t += over;
    }
  }
  // crafting (all slots run in parallel)
  for (const c of [...S.crafts]) { c.t += dt; if (c.t >= c.dur) G.sys.finishCraft(c, offline); }
  // expeditions
  for (const e of S.exps) if (!e.done) { e.t += dt; if (e.t >= e.dur) { e.done = true; if (!offline) G.emit('expDone', e); } }
  for (const c of S.chikns) if (c.status === 'injured' && now() >= c.until) { c.status = 'idle'; if (!offline) G.emit('note', { text: `${c.name} has recovered and is ready to work again.`, icon: 'chikn/' + c.role, good: true }); }
  // pvp tickets
  if (S.battle.tickets < D.pvpTickets) { // a long (offline) tick can refill several tickets
    S.battle.tt += dt;
    while (S.battle.tt >= D.pvpTicketTime && S.battle.tickets < D.pvpTickets) { S.battle.tt -= D.pvpTicketTime; S.battle.tickets++; }
  }
  if (S.battle.tickets >= D.pvpTickets) S.battle.tt = 0;
  // market drift
  S.market.t += dt;
  if (S.market.t >= 8) { S.market.t = 0; G.sys.marketDrift(); }
  // guild members contribute over time
  G.sys.guildTick(dt, offline);
  // the world clock runs on: the world's supply follows the HENIUM schedule exactly (what you earn is part of it)
  S.worldT = (S.worldT || 0) + dt;
  const slice = G.emission() * dt / D.farm.day;
  S.world.mined = D.cumEmission(S.worldT / 86400);
  G.dexTick(dt, slice);
  if (!offline) {
    G.sys.liveTick();
    G.sys.hazardTick();
    if (S.daily.day !== G.dayKey()) S.daily = { day: G.dayKey(), prog: {}, claimed: {} };
    if (now() > S.season.ends) G.sys.seasonEnd();
  }
  S.last = now();
};

// Test tool: skip ahead `sec` seconds as if you played the whole time (floors mine all along, no 8 h cap), quietly
// (no hazards pop up while skipping). The clock moves with it, so every timer stays consistent.
G.warp = (sec) => {
  const S = G.S, before = { ...S.res }, step = 60, n = Math.ceil(sec / step), a = awaySnap(S), log = [];
  G.offLog = log;
  G.sys.awayHazard();
  try { for (let i = 0; i < n; i++) { const dt = Math.min(step, sec - i * step); S.clockOff = (S.clockOff || 0) + dt * 1000; G.tick(dt, true, 1); } } finally { G.offLog = null; }
  const gains = {}, spent = {};
  for (const r in S.res) { const d = S.res[r] - before[r]; if (d > 0.5 || (r === 'henium' && d > 0.005)) gains[r] = d; else if (d < -0.5) spent[r] = -d; }
  return Object.assign(G.awayReport(a, awaySnap(S), sec, sec), { gains, spent, log, warp: true });
};
G.offLog = null;
G.logAway = (kind, text) => { if (G.offLog && !G.offLog.some((x) => x.text === text)) G.offLog.push({ kind, text }); };
// what changed while you were away, for the "Welcome back" report
const awaySnap = (S) => ({ res: { ...S.res }, laid: S.farm.laid || 0, lost: S.farm.lost || 0, war: S.guild.warPts, hunt: S.hunt || 0, rent: S.stats.rentEarned || 0,
  expsDone: S.exps.filter((e) => e.done).length, hungry: !!S.farm.hungry, kg: S.chikns.filter((c) => c.own !== false).reduce((s, c) => s + (c.kg || 0), 0),
  names: S.chikns.map((c) => c.name + '#' + c.id) });
G.awayReport = (a, b, total, mineSec) => ({ sec: total, mineSec, eggsLaid: b.laid - a.laid, eggsLost: b.lost - a.lost, feedUsed: Math.max(0, a.res.feed - b.res.feed),
  hungry: b.hungry, hungryNew: b.hungry && !a.hungry, kgLost: Math.max(0, a.kg - b.kg), expsBack: b.expsDone - a.expsDone, war: [a.war, b.war], hunt: [a.hunt, b.hunt],
  rent: b.rent - a.rent, left: a.names.filter((n) => !b.names.includes(n)).map((n) => n.split('#')[0]) });
G.offline = (sec) => {
  const S = G.S;
  if (!(sec >= 30)) return null;
  const mineSec = Math.min(sec, R.offlineH * 3600);       // the floors mine for at most offlineH hours while you are away
  const total = Math.min(sec, 60 * 86400);                // timers, factories, the farm and the world run the whole time
  const before = { ...S.res }, a = awaySnap(S);
  const steps = Math.min(600, Math.max(1, Math.ceil(total / 60)));
  const dt = total / steps;
  let mined = 0;
  let log = [];
  G.offLog = log;
  G.sys.awayHazard();
  try {
    for (let i = 0; i < steps; i++) {
      const m = Math.max(0, Math.min(dt, mineSec - mined));
      mined += m;
      G.tick(dt, true, m / dt);
    }
  } finally { G.offLog = null; }
  const gains = {}, spent = {};
  for (const r in S.res) { const d = S.res[r] - before[r]; if (d > 0.5 || (r === 'henium' && d > 0.005)) gains[r] = d; else if (d < -0.5) spent[r] = -d; }
  return Object.assign(G.awayReport(a, awaySnap(S), total, mineSec), { gains, spent, log });
};
})();
