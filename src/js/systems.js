// Player actions (G.act.*) and background systems (G.sys.*). Actions return {ok, msg, ...}.
// Rule numbers (hazards, battle, expeditions, guild, timings...) come from D.rules in data.js.
(() => {
const G = window.G, D = G.D, R = D.rules;
const ok = (extra) => Object.assign({ ok: true }, extra);
const fail = (msg) => ({ ok: false, msg });
const lack = (cost) => fail('Not enough ' + G.missing(cost).map((r) => D.res[r].name).join(', '));
const now = () => G.now(); // the game clock (moves faster in test mode)
G.sys = {}; G.act = {};

// ---------- mine ----------
G.tapYield = (z) => Math.max(1, G.zoneRate(z) * R.tap.share + z.base * R.tap.base * Math.sqrt(Math.max(1, G.S.zones[z.id].lv)));
G.act.tap = (zid) => {
  const S = G.S, z = D.zoneById(zid);
  if (!G.zoneOpen(z)) return fail('This floor is locked');
  const h = S.hazard;
  if (h && h.type === 'collapse' && h.zone === zid) return fail('Cave-in! Clear the rubble first.');
  // tapping costs pickaxe energy, which refills slowly: tapping helps, but cannot replace real production
  if (S.tapEnergy < 1) return fail(`Your Chikns are catching their breath: tap energy refills 1 every ${Math.round(1 / R.tap.regen)}s.`);
  S.tapEnergy -= 1;
  let amt = G.tapYield(z), rich = false;
  if (h && h.type === 'richvein' && h.zone === zid) { amt *= R.rich.mult; rich = true; h.taps = (h.taps || 0) + 1; if (h.taps >= R.rich.taps) G.sys.clearHazard(); }
  S.res[z.res] += amt; G.stat('mined', amt); G.stat('taps');
  if (S.stats.taps % 10 === 0) G.addXP(2);
  return ok({ amt, res: z.res, rich });
};
G.act.select = (zid) => { G.S.sel = zid; return ok(); };
G.act.upgradeZone = (zid) => {
  const S = G.S, z = D.zoneById(zid), st = S.zones[zid];
  if (!G.zoneOpen(z)) return fail('This floor is locked');
  const cost = D.floorCost(z, st.lv);
  if (!G.pay(cost)) return lack(cost);
  st.lv++; G.stat('upgrades'); G.addXP(3 + st.lv / 3);
  return ok({ lv: st.lv, milestone: [10, 25, 50, 100].includes(st.lv) });
};
G.digGate = (d) => {
  const z = D.zoneOf(d), S = G.S;
  if (z.from !== d || !z.gate) return null;
  const g = z.gate;
  if (g.factory && S.factories[g.factory].lv < 1) return `Build the ${D.factoryById(g.factory).name} to break into the ${z.name}`;
  if (g.machine && !S.machines.length) return `Craft your first machine to break into the ${z.name}`;
  if (g.refineryLv && S.factories.refinery.lv < g.refineryLv) return `Requires Henium Refinery Lv. ${g.refineryLv} & Guild License`;
  if (g.license && !S.guild.license) return 'Requires a Guild License';
  return null;
};
// a working machine on the deepest floor digs faster: half of its speed bonus (Heavy Drill Lv. 10: ×1.75)
G.digSpeed = () => { const m = G.machineOn(D.zoneOf(G.S.depth).id); return m && G.machineStats(m).working ? 1 + (G.machineStats(m).speed - 1) * 0.5 : 1; };
G.act.dig = () => {
  const S = G.S;
  if (S.dig) return fail(`Already digging to depth ${S.dig.to}`);
  if (S.depth >= D.maxDepth) return fail('You reached the bottom of the world!');
  const gate = G.digGate(S.depth + 1);
  if (gate) return fail(gate);
  const cost = D.digCost(S.depth);
  if (!G.pay(cost)) return lack(cost);
  S.dig = { t: 0, dur: D.digTime(S.depth + 1), to: S.depth + 1 };
  return ok({ started: true, to: S.dig.to, dur: S.dig.dur });
};
G.sys.finishDig = (offline) => {
  const S = G.S, to = S.dig.to;
  S.dig = null; S.depth = to;
  const z = D.zoneOf(S.depth);
  let newZone = null;
  if (S.zones[z.id].lv === 0) { S.zones[z.id].lv = 1; newZone = z; S.sel = z.id; }
  G.addXP(8 + S.depth * 3);
  if (!offline) G.emit('dug', { depth: S.depth, newZone });
};
G.act.speedDig = () => {
  const S = G.S;
  if (!S.dig) return fail('Nothing is being dug');
  const c = 2 * G.speedCost((S.dig.dur - S.dig.t) / G.digSpeed());
  if (!G.pay({ henium: c })) return fail(`Finishing the dig now costs ${c} HENIUM`);
  S.dig.t = S.dig.dur; G.sys.finishDig();
  return ok();
};

// ---------- factories ----------
G.act.build = (fid) => {
  const S = G.S, f = D.factoryById(fid), st = S.factories[fid];
  if (st.lv > 0 || st.con) return fail('Already built');
  if (S.depth < f.reqDepth) return fail(`Reach depth ${f.reqDepth} to build the ${f.name}`);
  if (!G.pay(f.build)) return lack(f.build);
  st.con = { t: 0, dur: D.buildTime(1), to: 1 };
  return ok({ started: true });
};
G.act.upgradeFactory = (fid) => {
  const S = G.S, f = D.factoryById(fid), st = S.factories[fid];
  if (st.con) return fail('Construction already in progress');
  if (st.lv < 1) return fail('Build it first');
  if (st.lv >= D.factoryMaxLv) return fail('Max level');
  const cost = D.factoryUpCost(f, st.lv);
  if (!G.pay(cost)) return lack(cost);
  st.con = { t: 0, dur: D.buildTime(st.lv + 1), to: st.lv + 1 };
  return ok({ started: true });
};
G.sys.finishBuild = (f, offline) => {
  const st = G.S.factories[f.id], from = st.lv, to = st.con.to;
  st.lv = to; st.con = null;
  G.addXP(to === 1 ? 60 : 30 * to);
  if (!offline) G.emit('built', { f, lv: to, from, tierUp: from === 0 || D.tier(to) > D.tier(from) });
};
G.act.speedBuild = (fid) => {
  const st = G.S.factories[fid];
  if (!st || !st.con) return fail('Nothing is under construction');
  const c = 2 * G.speedCost(st.con.dur - st.con.t);
  if (!G.pay({ henium: c })) return fail(`Finishing construction now costs ${c} HENIUM`);
  st.con.t = st.con.dur; G.sys.finishBuild(D.factoryById(fid));
  return ok();
};
G.act.setRecipe = (fid, rid) => { G.S.factories[fid].recipe = rid; return ok(); };
G.act.queue = (fid, rid, repeat = false) => {
  const S = G.S, f = D.factoryById(fid), st = S.factories[fid];
  if (st.lv < 1) return fail(`Build the ${f.name} first`);
  if (st.con) return fail(`The ${f.name} is under construction`);
  if (S.jobs.length >= G.jobSlots()) return fail('Production queue is full');
  const rec = f.recipes.find((r) => r.id === (rid || st.recipe)) || f.recipes[0];
  const cost = G.recipeIn(rec);
  const feed = fid === 'feedmill' ? G.recipeOut(f, rec).feed : 0;
  if (feed && S.farm.milled + G.queuedFeed() + feed > G.millQuota()) return fail(`Today's FEED quota is used up (${Math.round(S.farm.milled + G.queuedFeed())}/${G.millQuota()}). Upgrade the Feed Mill for a bigger share.`);
  if (!G.pay(cost)) return lack(cost);
  S.jobs.push({ id: S.nextId++, f: fid, r: rec.id, t: 0, dur: G.jobDur(f, rec), repeat: !!repeat, paid: cost, feed });
  return ok();
};
G.sys.finishJob = (j, offline) => {
  const S = G.S, f = D.factoryById(j.f), rec = f.recipes.find((r) => r.id === j.r);
  const out = G.recipeOut(f, rec);
  G.give(out);
  const units = Object.values(rec.in).reduce((a, b) => a + b, 0);
  G.stat('processed', units);
  if (out.copperIngot || out.ironIngot) G.stat('ingots', (out.copperIngot || 0) + (out.ironIngot || 0));
  if (out.henium) G.stat('refined', out.henium); // G.give already counted it toward the world supply
  if (j.f === 'feedmill') S.farm.milled += out.feed || 0;
  G.addXP(1 + units / 500); // factories run all day (and offline): a little XP per batch
  S.jobs.splice(S.jobs.indexOf(j), 1);
  if (j.repeat) {
    const cost = G.recipeIn(rec);
    const feed = j.f === 'feedmill' ? G.recipeOut(f, rec).feed : 0;
    const quotaOk = !feed || S.farm.milled + G.queuedFeed() + feed <= G.millQuota();
    if (quotaOk && S.jobs.length < G.jobSlots() && G.pay(cost)) S.jobs.push({ id: S.nextId++, f: j.f, r: j.r, t: 0, dur: G.jobDur(f, rec), repeat: true, paid: cost, feed });
    else if (!quotaOk) { if (!offline) G.emit('note', { text: 'Feed Mill: daily FEED quota reached. It resumes tomorrow.', icon: 'res/feed' }); }
    else if (!offline) G.emit('note', { text: `${f.name}: repeat stopped (not enough materials)`, icon: G.bImg(f.id, G.S.factories[f.id].lv), bad: true });
  }
  if (!offline) G.emit('jobDone', { j, out, f }); // after re-queueing, so screens never show a stale idle factory
};
G.speedCost = (rem) => Math.max(1, Math.ceil(rem / 600)); // 1 HENIUM per 10 minutes left
G.canRush = (j) => !!j && j.f !== 'refinery'; // refinery batches pay HENIUM for refining time, so they can't be rushed
G.act.speedJob = (id) => {
  const j = G.S.jobs.find((x) => x.id === id);
  if (!j) return fail('Job not found');
  if (!G.canRush(j)) return fail('Refinery batches can\'t be rushed: they pay your share of the HENIUM emission for the time they run.');
  const c = G.speedCost(j.dur - j.t);
  if (!G.pay({ henium: c })) return fail(`Speed-up costs ${c} HENIUM`);
  j.t = j.dur; G.sys.finishJob(j);
  return ok();
};
G.act.cancelJob = (id) => {
  const S = G.S, j = S.jobs.find((x) => x.id === id);
  if (!j) return fail('Job not found');
  G.give(j.paid || {}, j.t > 0 ? R.refund : 1, true); // a refund, never a mint
  S.jobs.splice(S.jobs.indexOf(j), 1);
  return ok();
};
G.act.toggleRepeat = (id) => { const j = G.S.jobs.find((x) => x.id === id); if (j) j.repeat = !j.repeat; return ok(); };
G.act.fUpgrade = (uid) => {
  const S = G.S, u = D.fUpgrades.find((x) => x.id === uid), lv = S.fup[uid];
  if (lv >= u.max) return fail('Max level');
  const cost = D.fUpCost(u, lv);
  if (!G.pay(cost)) return lack(cost);
  S.fup[uid]++; G.addXP(25);
  if (uid === 'craft') S.craftSlots++;
  return ok();
};

// ---------- crafting & machines ----------
G.act.craft = (mid) => {
  const S = G.S, m = D.machineById(mid);
  if (S.player.lv < m.lv) return fail(`Requires player Lv. ${m.lv}`);
  if (S.crafts.length >= S.craftSlots) return fail('Crafting queue is full');
  if (!G.pay(m.cost)) return lack(m.cost);
  S.crafts.push({ id: S.nextId++, type: mid, t: 0, dur: m.t / (1 + G.bonus('craft')) });
  return ok();
};
G.sys.finishCraft = (c, offline) => {
  const S = G.S;
  S.crafts.splice(S.crafts.indexOf(c), 1);
  const m = { id: S.nextId++, type: c.type, lv: 1, dur: 100, zone: null };
  S.machines.push(m);
  G.stat('crafted'); G.addXP(40 + 30 * D.machines.findIndex((x) => x.id === c.type));
  if (!offline) G.emit('craftDone', m);
};
G.act.speedCraft = (id) => {
  const c = G.S.crafts.find((x) => x.id === id);
  if (!c) return fail('Not found');
  const cost = G.speedCost(c.dur - c.t);
  if (!G.pay({ henium: cost })) return fail(`Speed-up costs ${cost} HENIUM`);
  G.sys.finishCraft(c);
  return ok();
};
G.act.deploy = (id, zid) => {
  const S = G.S, m = S.machines.find((x) => x.id === id);
  if (!m) return fail('Machine not found');
  if (zid) {
    const z = D.zoneById(zid);
    if (!G.zoneOpen(z)) return fail('That floor is locked');
    const other = G.machineOn(zid);
    if (other && other !== m) other.zone = null;
  }
  m.zone = zid || null; m.off = false;
  return ok();
};
G.act.upgradeMachine = (id) => {
  const m = G.S.machines.find((x) => x.id === id);
  if (!m) return fail('Machine not found');
  if (m.lv >= D.machineMaxLv) return fail('Max level');
  const cost = D.machineUpCost(D.machineById(m.type), m.lv);
  if (!G.pay(cost)) return lack(cost);
  m.lv++; G.addXP(15 * m.lv);
  return ok({ lv: m.lv });
};
G.act.service = (id) => {
  const m = G.S.machines.find((x) => x.id === id);
  if (!m) return fail('Machine not found');
  if (m.dur >= 99.5) return fail('Already in perfect shape');
  const cost = D.machineServiceCost(m.dur);
  if (!G.pay(cost)) return lack(cost);
  m.dur = 100; m.off = false;
  return ok();
};

// ---------- chikns ----------
G.rollRarity = (w) => {
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return D.rarities[i].id; }
  return 'common';
};
// a Chikn joins your coop: one you own (bought or won) or one you rent (extra: { own: false, rent, kg, name, num })
G.newChikn = (rarity, role, extra = {}) => {
  const S = G.S;
  const c = Object.assign({ id: S.nextId++, name: G.pick(D.names), num: G.randInt(1000, 9999), role: role || G.pick(Object.keys(D.roles)), rarity, lv: 1,
    kg: D.rarity(rarity).kg0, status: 'idle', until: 0, own: true }, extra);
  G.syncLv(c);
  S.chikns.push(c);
  if (S.squad.length < G.squadSlots()) { S.squad.push(c.id); c.status = 'squad'; }
  return c;
};
// ---------- Chikn NFT rentals: rent from other holders, or rent yours out for passive EGG ----------
const hex4 = () => Math.floor(Math.random() * 65536).toString(16).padStart(4, '0');
G.wallet = () => `0x${hex4()}…${hex4()}`;                                   // a simulated holder's wallet
G.rentPrice = (c) => D.rentPrice(c.rarity, c.kg || G.kgStart(c));            // fair EGG a day for this Chikn now
G.rentOffer = (free) => {
  const S = G.S, rarity = free ? free.rarity : G.rollRarity(D.rent.weights), R = D.rarity(rarity);
  const kg = free ? R.kg0 : Math.round(R.kg0 + (R.kgMax - R.kg0) * D.rent.heavy * Math.random());
  return { id: S.nextId++, rarity, role: free ? free.role : G.pick(Object.keys(D.roles)), kg, name: G.pick(D.names), num: G.randInt(1000, 9999),
    owner: G.wallet(), price: free ? 0 : Math.round(D.rentPrice(rarity, kg) * G.rand(0.85, 1.15) * 100) / 100, free: !!free };
};
// the rental market: D.rent.offers offers, new ones every farm day; a new player's first rental is free
G.rentMarket = () => {
  const S = G.S;
  if (!S.rentMk || S.rentMk.day !== S.farm.day) S.rentMk = { day: S.farm.day, offers: Array.from({ length: D.rent.offers }, () => G.rentOffer()) };
  const free = S.stats.hired === 0;
  if (free && !S.rentMk.offers.some((o) => o.free)) S.rentMk.offers.unshift(G.rentOffer(D.rent.free));
  if (!free) S.rentMk.offers = S.rentMk.offers.filter((o) => !o.free);
  return S.rentMk;
};
G.rentDays = (o, days) => (o.free ? D.rent.free.days : days);
G.act.rent = (oid, days = 7, auto = true) => {
  const S = G.S, mk = G.rentMarket(), o = mk.offers.find((x) => x.id === oid);
  if (!o) return fail('That offer is gone: another player rented it');
  days = G.rentDays(o, days);
  if (!o.free && !D.rent.days.includes(days)) return fail('Pick how many days to rent');
  if (S.chikns.length >= G.coopCap()) return fail(`The coop is full (${S.chikns.length}/${G.coopCap()}). Upgrade it on the Farm.`);
  const cost = o.free ? 0 : D.rentCost(o.price, days);
  if (S.res.egg < cost) return fail(`Not enough EGG: renting ${o.name} for ${days} day${days === 1 ? '' : 's'} costs ${cost} EGG`);
  S.res.egg -= cost; S.stats.rentPaid = (S.stats.rentPaid || 0) + cost; S.stats.eggBurned += cost * D.rent.fee;
  mk.offers = mk.offers.filter((x) => x !== o);
  const c = G.newChikn(o.rarity, o.role, { own: false, kg: o.kg, name: o.name, num: o.num,
    rent: { left: days * 86400, days, price: o.price, owner: o.owner, auto: !!auto && !o.free } });
  G.stat('hired'); G.addXP(20); G.emit('res');
  return ok({ c, cost, days, free: o.free });
};
G.act.extendRent = (cid, days = 7) => {
  const S = G.S, c = G.chikn(S, cid);
  if (!c || !c.rent) return fail('That Chikn is not rented');
  if (!D.rent.days.includes(days)) return fail('Pick how many days to add');
  const price = c.rent.price || G.rentPrice(c), cost = D.rentCost(price, days); // a free starter is extended at the market price
  if (S.res.egg < cost) return fail(`Not enough EGG: ${days} more day${days === 1 ? '' : 's'} cost ${cost} EGG`);
  S.res.egg -= cost; S.stats.rentPaid = (S.stats.rentPaid || 0) + cost; S.stats.eggBurned += cost * D.rent.fee;
  c.rent.price = price; c.rent.left += days * 86400; c.rent.days = days;
  G.emit('res');
  return ok({ cost, left: c.rent.left });
};
G.act.autoRenew = (cid) => {
  const c = G.chikn(G.S, cid);
  if (!c || !c.rent) return fail('That Chikn is not rented');
  c.rent.auto = !c.rent.auto;
  return ok({ auto: c.rent.auto });
};
// buy a Chikn NFT from another holder (the collection stays at 22,000): Rare or better
G.act.buyNft = () => {
  const S = G.S, b = D.buyNft;
  if (S.chikns.length >= G.coopCap()) return fail(`The coop is full (${S.chikns.length}/${G.coopCap()}). Upgrade it on the Farm.`);
  if (!G.pay(b.cost)) return lack(b.cost);
  const c = G.newChikn(G.rollRarity(b.weights), null, { own: true, seller: G.wallet() });
  G.stat('hired'); G.addXP(20);
  return ok({ c });
};
// list one of your own Chikns for rent: it keeps working for you until a renter takes it
G.act.listRent = (cid, days = 7, k = 1) => {
  const S = G.S, c = G.chikn(S, cid);
  if (!c) return fail('Chikn not found');
  if (c.own === false) return fail(`${c.name} is rented: only its owner can rent it out`);
  if (c.lease) return fail(`${c.name} is already ${c.lease.left == null ? 'listed' : 'rented out'}`);
  if (c.status === 'exp' || c.status === 'injured') return fail(`${c.name} is ${c.status === 'exp' ? 'on an expedition' : 'recovering'}: list it when it is back`);
  if (!D.rent.days.includes(days)) return fail('Pick how many days to rent it out');
  const price = Math.round(G.rentPrice(c) * (D.rent.priceK.includes(k) ? k : 1) * 100) / 100;
  c.lease = { price, days, left: null, renter: null, earned: 0, k };
  return ok({ price });
};
G.act.cancelRent = (cid) => {
  const c = G.chikn(G.S, cid);
  if (!c || !c.lease) return fail('That Chikn is not listed');
  if (c.lease.left != null) return fail(`${c.name} is rented out: it comes back when the rental ends`);
  delete c.lease;
  return ok();
};
G.rentWait = (c) => D.rent.wait * Math.pow(c.lease.price / Math.max(1e-9, G.rentPrice(c)), D.rent.elastic); // mean wait for a renter (s)
G.rentIncome = () => G.S.chikns.reduce((s, c) => s + (c.lease && c.lease.left != null ? c.lease.price * (1 - D.rent.fee) : 0), 0); // EGG a day
G.rentSpend = () => G.S.chikns.reduce((s, c) => s + (c.rent ? c.rent.price : 0), 0);   // EGG a day your rentals cost
// rentals run on game time (also while you are away): rented Chikns go home, renters take your listings, rent is paid
G.sys.rentTick = (dt, offline) => {
  const S = G.S, fee = D.rent.fee;
  for (const c of [...S.chikns]) {
    if (c.rent) {
      c.rent.left -= dt;
      if (c.rent.left > 0) continue;
      const cost = D.rentCost(c.rent.price || G.rentPrice(c), c.rent.days);
      if (c.rent.auto && S.res.egg >= cost) {
        S.res.egg -= cost; S.stats.rentPaid = (S.stats.rentPaid || 0) + cost; S.stats.eggBurned += cost * fee;
        c.rent.left += c.rent.days * 86400;
        G.emit('note', { text: `${c.name}'s rental renewed for ${c.rent.days} day${c.rent.days === 1 ? '' : 's'} (−${cost} EGG)`, icon: 'res/egg' });
      } else if (c.status !== 'exp') {
        S.chikns.splice(S.chikns.indexOf(c), 1); S.squad = S.squad.filter((id) => id !== c.id);
        G.emit('note', { text: `${c.name}'s rental ended: the Chikn went back to its owner${c.rent.auto ? ' (not enough EGG to renew)' : ''}.`, icon: 'ui/chikns', bad: true });
        G.emit('rentEnd', c);
      }
      continue;
    }
    const L = c.lease;
    if (!L) continue;
    if (L.left == null) { // listed: does a renter take it in this slice of time?
      if (c.status === 'exp' || c.status === 'injured') continue;
      if (Math.random() < 1 - Math.exp(-dt / G.rentWait(c))) {
        L.left = L.days * 86400; L.renter = G.wallet();
        S.squad = S.squad.filter((id) => id !== c.id); c.status = 'away';
        G.emit('note', { text: `${c.name} was rented for ${L.days} day${L.days === 1 ? '' : 's'}: +${G.fmt(L.price * (1 - fee), 2)} EGG a day for you`, icon: 'res/egg', good: true });
      }
      continue;
    }
    const t = Math.min(dt, L.left), got = L.price * (1 - fee) * t / 86400; // rent arrives continuously, minus the fee
    S.res.egg += got; L.earned += got; S.stats.rentEarned = (S.stats.rentEarned || 0) + got; S.stats.eggBurned += L.price * fee * t / 86400;
    L.left -= t;
    if (L.left <= 0) {
      c.status = 'idle';
      G.emit('note', { text: `${c.name} is back from a rental and earned you ${G.fmt(L.earned, 1)} EGG`, icon: 'res/egg', good: true });
      delete c.lease;
    }
  }
};
G.act.toggleSquad = (cid) => {
  const S = G.S, c = G.chikn(S, cid);
  if (!c) return fail('Not found');
  if (c.status === 'squad') { S.squad = S.squad.filter((x) => x !== cid); c.status = 'idle'; return ok(); }
  if (c.status !== 'idle') return fail(c.status === 'exp' ? 'This Chikn is on an expedition' : 'This Chikn is recovering');
  if (S.squad.length >= G.squadSlots()) return fail('Squad is full. Remove a Chikn first.');
  S.squad.push(cid); c.status = 'squad';
  return ok();
};
// feeding (G.act.feed, G.feedCost) lives in farm.js: Chikns gain weight, and level follows weight
G.act.collectNest = () => {
  const n = Math.floor(G.S.nest);
  if (n < 1) return fail('The nest is empty');
  G.S.res.egg += n; G.S.nest -= n;
  return ok({ n });
};
G.act.collectAll = () => {
  const S = G.S, got = {};
  const add = (rew) => { for (const r in rew) got[r] = (got[r] || 0) + rew[r]; };
  let things = 0;
  const n = Math.floor(S.nest);
  if (n >= 1) { S.res.egg += n; S.nest -= n; add({ egg: n }); things++; }
  const injured = [];
  for (const e of S.exps.filter((x) => x.done)) { const r = G.act.claimExp(e.id); if (r.ok) { add(r.rew); things++; injured.push(...r.injured); } }
  for (const m of G.missions()) if (m.done && !m.claimed) { const r = G.act.claimMission(m.id); if (r.ok) { add(m.r); things++; } }
  if (!things) return fail('Nothing to collect yet');
  return ok({ got, things, injured });
};

// ---------- guild ----------
G.donation = (i) => {
  const d = D.donations[i], k = 1 + G.S.guild.proj * 0.6;
  return { res: d.res, amt: Math.ceil(d.amt * k), pts: Math.round(d.pts * k * (G.specIs('gleader') ? 1.25 : 1)) };
};
G.act.donate = (i) => {
  const S = G.S, d = G.donation(i), cost = { [d.res]: d.amt };
  if (!D.guildProjects[S.guild.proj]) return fail('All guild projects are complete!');
  if (!G.pay(cost)) return lack(cost);
  S.guild.pts += d.pts; S.guild.contrib += d.pts; G.addXP(d.pts / 4);
  G.sys.guildCheck();
  return ok({ pts: d.pts });
};
G.sys.guildTick = (dt, offline) => {
  const g = G.S.guild, p = D.guildProjects[g.proj];
  if (!p) return;
  g.pts += p.need * R.memberRate * dt;
  G.sys.guildCheck(offline);
};
// HENIUM paid when guild project i (0-based) completes; the Guild screen and the wiki show the same number
G.guildProjectReward = (i) => R.projHenium(i);
G.sys.guildCheck = (offline) => {
  const g = G.S.guild, i = g.proj, p = D.guildProjects[i];
  if (!p || g.pts < p.need) return;
  const bonus = Math.round(p.bonus * (G.specIs('gleader') ? 1.25 : 1)), hen = G.guildProjectReward(i);
  g.pts -= p.need; g.bonus += bonus; g.proj++; g.lv++;
  g.members = Math.min(g.max, g.members + G.randInt(2, 6));
  G.give({ henium: hen });
  if (!offline) G.emit('note', { text: `Guild project "${p.name}" complete! +${bonus}% mining for everyone, +${hen} HENIUM for you`, icon: 'ui/guild', good: true });
};
G.act.expandZone = () => {
  const g = G.S.guild, cost = D.guildZoneCost(g.zoneLv);
  if (!G.pay(cost)) return lack(cost);
  g.zoneLv++; G.addXP(50);
  return ok({ lv: g.zoneLv });
};
G.act.buyLicense = () => {
  const g = G.S.guild;
  if (g.license) return fail('You already hold a Guild License');
  if (g.lv < R.licenseGuildLv) return fail(`Your guild must reach Lv. ${R.licenseGuildLv}`);
  if (!G.pay(D.licenseCost)) return lack(D.licenseCost);
  g.license = true; G.addXP(120);
  return ok();
};

// ---------- market ----------
// Trader discount on fees: Trader Chikns in the Mining Team lower it by their bonus (down to 30% of the fee), the Trader
// specialization halves it. dex.js applies it to every DEX swap (G.dexFee).
G.feeK = () => (G.specIs('trader') ? 0.5 : 1) * Math.max(0.3, 1 - G.bonus('trade'));
G.price = (item, side) => G.S.market.p[item] * (side === 'buy' ? 1 + D.buySpread * G.feeK() : 1 - D.sellFee * G.feeK());
// The old fixed-price market now trades on the DEX: selling goods only moves existing HENIUM, it never mints any.
G.act.trade = (item, qty, side) => {
  qty = Math.floor(qty);
  if (!(qty > 0)) return fail('Choose an amount');
  const p = G.poolFor(item, 'henium');
  if (!p) return fail('This item is not traded');
  if (side !== 'buy') { const r = G.act.swap(item, 'henium', qty); return r.ok ? ok({ tot: r.out }) : r; }
  const rIn = p.a === 'henium' ? p.ra : p.rb, rOut = p.a === 'henium' ? p.rb : p.ra;
  if (qty >= rOut) return fail('Not enough liquidity in the pool');
  const tot = rIn * qty / ((rOut - qty) * (1 - G.dexFee())) * (1 + 1e-9); // HENIUM in for exactly qty out (one hop)
  const r = G.act.swap('henium', item, tot);
  return r.ok ? ok({ tot }) : r;
};
G.sys.marketDrift = () => {
  const M = G.S.market;
  for (const k in D.market) {
    const base = D.market[k];
    let p = M.p[k] * (1 + (Math.random() - 0.5) * 0.07);
    p += (base - p) * 0.08;
    p = Math.min(base * (1 + D.priceBand), Math.max(base * (1 - D.priceBand), p));
    M.p[k] = p;
    (M.hist[k] = M.hist[k] || []).push(p);
    if (M.hist[k].length > 40) M.hist[k].shift();
  }
};
G.exRate = () => {
  const t = G.specIs('trader') ? 0.1 : 0;
  return { h2e: 0, e2h: D.exchange.eggPerHenium * (1 - t), e2f: D.exchange.eggPerFeed };
};
G.act.exchange = (kind, qty) => {
  const S = G.S, x = G.exRate();
  qty = Math.floor(qty);
  if (!(qty > 0)) return fail('Choose an amount');
  if (kind === 'h2e') return fail('EGG is only laid by Chikns. HENIUM cannot be turned back into EGG.');
  if (kind === 'e2h') return fail('Trade EGG for HENIUM on the DEX: HENIUM can only be minted by refining, guild wars and monster hunts.');
  if (kind !== 'e2f') return fail('Unknown exchange');
  const c = { egg: qty * x.e2f };
  if (!G.pay(c)) return lack(c);
  S.res.feed += qty; S.stats.eggBurned += c.egg;
  G.emit('res');
  return ok();
};

// ---------- expeditions ----------
G.expSite = (id) => (id === 'vein' ? D.veinExpedition : D.expeditions.find((e) => e.id === id));
G.idleChikns = () => G.S.chikns.filter((c) => c.status === 'idle');
G.act.startExp = (siteId, ids) => {
  const S = G.S, site = G.expSite(siteId);
  if (!site) return fail('Unknown expedition site');
  if (site.event && !(G.liveEvent() && G.liveEvent().id === 'vein')) return fail('This event has ended');
  if (S.player.lv < site.lv) return fail(`Requires player Lv. ${site.lv}`);
  if (S.exps.some((e) => e.site === siteId)) return fail('A team is already exploring there');
  ids = (ids || []).filter((id) => { const c = G.chikn(S, id); return c && c.status === 'idle'; }).slice(0, site.slots);
  if (!ids.length) return fail('Pick at least one idle Chikn (not in your squad)');
  const short = ids.map((id) => G.chikn(S, id)).find((c) => c.rent && c.rent.left < site.t && !c.rent.auto);
  if (short) return fail(`${short.name}'s rental ends before this expedition returns: extend the rental or turn on auto-renew`);
  ids.forEach((id) => (G.chikn(S, id).status = 'exp'));
  S.exps.push({ id: S.nextId++, site: siteId, ids, t: 0, dur: site.t, done: false });
  return ok();
};
// A team's odds on an expedition: loot multiplier k, injury risk per Chikn, explore bonus (the Expeditions screen previews it)
G.expOdds = (site, team) => {
  const X = R.exp;
  const explore = team.reduce((s, c) => s + (c.role === 'explorer' ? G.chiknPct(c) / 100 : c.role === 'leader' ? G.chiknPct(c) / 200 : 0), 0) + (G.specIs('explor') ? X.specLoot : 0);
  const safety = team.reduce((s, c) => s + (c.role === 'medic' ? G.chiknPct(c) / 100 : 0), 0);
  const power = team.reduce((s, c) => s + G.chiknPower(c), 0);
  return { n: team.length, power, explore, safety,
    k: (X.base + X.per * team.length + Math.min(X.powCap, power / X.powDiv)) * (1 + explore),
    risk: site.risk * Math.max(X.riskMin, 1 - safety) * (G.specIs('explor') ? X.specRisk : 1) };
};
G.act.claimExp = (id) => {
  const S = G.S, e = S.exps.find((x) => x.id === id);
  if (!e) return fail('Not found');
  if (!e.done) return fail('Still exploring');
  const site = G.expSite(e.site), team = e.ids.map((cid) => G.chikn(S, cid)).filter(Boolean), X = R.exp;
  const o = G.expOdds(site, team);
  const rew = {};
  for (const r in site.r) { const [a, b] = site.r[r]; rew[r] = Math.max(1, Math.round(G.rand(a, b) * o.k)); }
  if (Math.random() < X.feed + o.explore * X.feedExp) rew.feed = (rew.feed || 0) + G.randInt(X.feedAmt[0], X.feedAmt[1]);
  const injured = [];
  for (const c of team) {
    if (Math.random() < o.risk) { c.status = 'injured'; c.until = now() + R.injuredSec * 1000; injured.push(c); } else c.status = 'idle';
  }
  G.give(rew); G.stat('exps'); G.addXP(25 + site.t / 600);
  S.exps.splice(S.exps.indexOf(e), 1);
  for (const c of team) if (c.rent && c.rent.left <= 0) G.sys.rentTick(0); // a rental that ran out on the way ends now
  return ok({ rew, injured, site });
};

// ---------- battle ----------
G.squadPower = () => Math.round(G.squad().reduce((s, c) => s + G.chiknPower(c), 0) * (1 + G.bonus('battle') + (G.specIs('cmdr') ? 0.25 : 0)));
G.winChance = (P, E) => Math.max(R.win.min, Math.min(R.win.max, R.win.base + (P - E) / (R.win.div * E)));
const script = (win) => {
  let a = 100, b = 100;
  const rounds = [];
  while (a > 0 && b > 0 && rounds.length < 14) {
    const hit = win ? G.rand(14, 30) : G.rand(6, 17);
    b = Math.max(0, b - hit); rounds.push({ who: 'me', dmg: Math.round(hit), a, b });
    if (b <= 0) break;
    const back = win ? G.rand(4, 14) : G.rand(14, 30);
    a = Math.max(0, a - back); rounds.push({ who: 'foe', dmg: Math.round(back), a, b });
  }
  if (win && b > 0) rounds.push({ who: 'me', dmg: Math.round(b), a, b: 0 });
  if (!win && a > 0) rounds.push({ who: 'foe', dmg: Math.round(a), a: 0, b });
  return rounds;
};
G.act.fight = (i) => {
  const S = G.S, st = D.stages[i];
  if (!st) return fail('Unknown stage');
  if (i > S.battle.cleared) return fail('Clear the previous stage first');
  if ((S.battle.cd[i] || 0) > now()) return fail(`Your squad is resting (${G.fmtTime(((S.battle.cd[i]) - now()) / 1000)})`);
  if (!G.squad().length) return fail('Your squad is empty. Assign Chikns first.');
  const P = G.squadPower(), E = st.power, chance = G.winChance(P, E), win = Math.random() < chance;
  const first = win && i === S.battle.cleared;
  let rew = null;
  if (win) {
    rew = G.scale(st.r, first ? 2 : 1);
    if (first && st.first) for (const k in st.first) rew[k] = (rew[k] || 0) + st.first[k];
    G.give(rew); S.hunt = (S.hunt || 0) + R.pveHunt(i);
    if (first) S.battle.cleared++;
    G.stat('wins'); G.addXP(20 + i * 15); S.battle.cd[i] = now() + R.rest.win * 1000;
  } else { G.addXP(5); S.battle.cd[i] = now() + R.rest.lose * 1000; }
  return ok({ win, chance, P, E, rounds: script(win), rew, first, foe: st.name, mon: st.mon });
};
G.rivals = () => {
  const B = G.S.battle;
  if (!B.rivals || !B.rivals.length) {
    const P = Math.max(R.rivals.min, G.squadPower()), [lo, hi] = R.rivals.power;
    B.rivals = D.rivals.slice().sort(() => Math.random() - 0.5).slice(0, R.rivals.n).map((name) => ({ name, power: Math.round(P * G.rand(lo, hi)), lv: G.randInt(R.rivals.lv[0], R.rivals.lv[1]) }));
  }
  return B.rivals;
};
G.act.pvp = (idx) => {
  const S = G.S, B = S.battle, rv = G.rivals()[idx];
  if (!rv) return fail('Unknown rival');
  if (B.tickets <= 0) return fail('No battle tickets left. They refill over time.');
  if (!G.squad().length) return fail('Your squad is empty. Assign Chikns first.');
  B.tickets--;
  const P = G.squadPower(), chance = G.winChance(P, rv.power), win = Math.random() < chance;
  let rew = null, pts;
  if (win) { pts = G.randInt(R.pvp.pts[0], R.pvp.pts[1]); rew = { ...R.pvp.loot(S.depth), henium: R.pvp.henium }; G.give(rew); S.guild.warPts += pts; S.guild.contrib += pts; G.stat('wins'); G.addXP(35); }
  else { pts = -R.pvp.lose; S.guild.warPts = Math.max(0, S.guild.warPts - R.pvp.lose); G.addXP(8); }
  B.rivals = null;
  return ok({ win, chance, P, E: rv.power, rounds: script(win), rew, pts, foe: rv.name, mon: 'rival' });
};

// ---------- missions, quests, season ----------
// a mission's reward at a depth (D.missions[].r is a function of depth, see D.bundle)
G.missionReward = (m, depth = G.S.depth) => (typeof m.r === 'function' ? m.r(depth) : m.r);
G.missions = () => {
  const S = G.S, day = S.daily.day;
  const h = [...day].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  const rot = R.rotating[h % R.rotating.length];
  const ids = D.missions.filter((m) => !R.rotating.includes(m.id)).map((m) => m.id).concat(rot);
  return ids.map((id) => {
    const m = D.missions.find((x) => x.id === id), n = m.n(S.player.lv), cur = Math.min(n, S.daily.prog[m.stat] || 0);
    return { ...m, n, r: G.missionReward(m), cur, done: cur >= n, claimed: !!S.daily.claimed[id], label: m.text(n) };
  });
};
G.act.claimMission = (id) => {
  const m = G.missions().find((x) => x.id === id);
  if (!m || !m.done) return fail('Mission not complete yet');
  if (m.claimed) return fail('Already claimed');
  G.give(m.r); G.S.daily.claimed[id] = true; G.addXP(30);
  return ok({ rew: m.r });
};
G.questList = () => D.quests.filter((q) => !G.S.quests.done.includes(q.id)).slice(0, 3).map((q) => {
  const [c, t] = q.p(G.S);
  return { ...q, cur: Math.min(c, t), target: t, done: c >= t };
});
G.act.claimQuest = (id) => {
  const q = G.questList().find((x) => x.id === id);
  if (!q || !q.done) return fail('Quest not complete yet');
  G.give(q.r); G.S.quests.done.push(id); G.addXP(40);
  return ok({ rew: q.r });
};
G.act.claimSeason = (lv) => {
  const s = G.S.season;
  if (!Number.isInteger(lv) || lv < 1 || lv > D.seasonMax) return fail('Unknown reward');
  if (lv > s.lv) return fail(`Reach season level ${lv} first`);
  if (s.claimed.includes(lv)) return fail('Already claimed');
  const r = D.seasonReward(lv, G.S.depth);
  if (r.chikn && G.S.chikns.length >= G.coopCap()) {
    return fail(`Your coop is full (${G.S.chikns.length}/${G.coopCap()}). Upgrade the Coop on the Farm, then claim your ${D.rarity(r.chikn).name} Chikn.`);
  }
  s.claimed.push(lv);
  if (r.chikn) { const c = G.newChikn(r.chikn, null, { own: true }); return ok({ c }); } // from the game's treasury of Chikn NFTs
  G.give(r);
  return ok({ rew: r });
};
G.act.chooseSpec = (id) => {
  if (G.S.spec) return fail('Specialization already chosen');
  if (G.S.player.lv < R.specLv) return fail(`Unlocks at player Lv. ${R.specLv}`);
  G.S.spec = id;
  return ok();
};

// ---------- live events & hazards ----------
G.sys.liveTick = () => {
  const S = G.S, L = S.live, t = now();
  if (L.id && t >= L.until) { const e = D.liveEvents.find((x) => x.id === L.id); L.id = null; G.emit('note', { text: `${e ? e.name.replace('!', '') : 'Event'} has ended.`, icon: 'ui/events' }); G.emit('liveEnd', e); }
  if (!L.id && t >= L.next) {
    const pool = D.liveEvents.filter((e) => !e.minDepth || S.depth >= e.minDepth);
    const e = G.pick(pool);
    L.id = e.id; L.until = t + e.dur * 1000; L.next = L.until + G.rand(R.liveGap[0], R.liveGap[1]) * 1000;
    G.emit('live', e);
  }
};
G.sys.hazardTick = () => {
  const S = G.S, t = now(), H = S.hazard;
  if (H) { if (H.until && t >= H.until) G.sys.clearHazard(true); return; }
  if (t < S.hazardNext) return;
  S.hazardNext = t + G.rand(R.hazardGap[0], R.hazardGap[1]) * 1000;
  if (G.speed() > 10) return; // test speed: no hazards you couldn't react to in time
  const open = D.zones.filter((z) => G.zoneOpen(z));
  if (!open.length) return;
  let types = S.player.lv < R.hazardLv ? ['richvein', 'supply'] : ['richvein', 'supply', 'creature', 'bandits', 'collapse'];
  const ev = G.liveEvent();
  let type = ev && ev.id === 'collapse' && Math.random() < R.collapseEvent ? 'collapse' : G.pick(types);
  if (type === 'collapse' && Math.random() < Math.min(R.medicCap, G.bonus('safety'))) type = 'richvein';
  if (type === 'bandits') { if (t < (S.banditNext || 0)) type = G.pick(types.filter((x) => x !== 'bandits')); else S.banditNext = t + R.bandits.gap * 1000; }
  const heniumOpen = G.zoneOpen(D.zoneById('henium'));
  const zone = type === 'collapse' && ev && ev.id === 'collapse' && heniumOpen ? 'henium' : G.pick(open).id;
  const P = Math.max(R.hazardMin, G.squadPower()), d = S.depth, C = R.creature, B = R.bandits;
  const h = { type, zone, at: t };
  if (type === 'collapse') { h.until = t + R.collapse.sec * 1000; h.cost = { stone: R.collapse.stone(d) }; }
  if (type === 'richvein') h.until = t + R.rich.sec * 1000;
  if (type === 'supply') { h.until = t + R.supply.sec * 1000; h.reward = { ...R.supply.loot(d), feed: R.supply.feed(d) }; }
  if (type === 'creature') { h.until = t + C.sec * 1000; h.power = Math.round(P * G.rand(C.power[0], C.power[1])); h.mon = G.pick(C.mons); h.reward = { ...C.loot(d), feed: C.feed(d) }; }
  if (type === 'bandits') { h.until = t + B.sec * 1000; h.power = Math.round(P * G.rand(B.power[0], B.power[1])); h.toll = { egg: B.toll(d) }; }
  S.hazard = h;
  G.emit('hazard', h);
};
// raiders go after your HENIUM once you hold a meaningful stash: defend it (Guardians, squad power) or lose a share
G.sys.stealHenium = (share) => {
  const S = G.S;
  if (S.res.henium <= R.bandits.keep) return 0;
  const hl = Math.round(S.res.henium * share * 100) / 100;
  S.res.henium -= hl;
  return hl;
};
G.sys.clearHazard = (expired) => {
  const S = G.S, h = S.hazard;
  S.hazard = null;
  if (expired && h && h.type === 'bandits') {
    const r = D.zoneById(h.zone).res, loss = Math.floor(S.res[r] * R.bandits.ignore[0]), hl = G.sys.stealHenium(R.bandits.ignore[1]);
    S.res[r] -= loss;
    G.emit('note', { text: `Bandits raided the ${D.zoneById(h.zone).name} and stole ${G.fmt(loss)} ${D.res[r].name}${hl ? ` and ${G.fmt(hl, 2)} HENIUM` : ''}!`, icon: 'ui/battle', bad: true });
  }
  G.emit('hazardEnd', h);
};
G.act.hazard = (choice) => {
  const S = G.S, h = S.hazard;
  if (!h) return fail('Nothing to deal with right now');
  const P = Math.max(1, G.squadPower());
  if (h.type === 'collapse') {
    if (!G.pay(h.cost)) return lack(h.cost);
    G.sys.clearHazard(); G.addXP(10);
    return ok({ msg: 'Rubble cleared. The floor is back to work!' });
  }
  if (h.type === 'supply') { G.give(h.reward); G.sys.clearHazard(); return ok({ rew: h.reward, msg: 'Supply crate opened!' }); }
  if (h.type === 'creature') {
    const win = Math.random() < G.winChance(P, h.power);
    G.sys.clearHazard();
    if (win) { G.give(h.reward); G.stat('wins'); S.hunt = (S.hunt || 0) + R.creature.hunt; G.addXP(20); return ok({ win, rew: h.reward, msg: 'Creature defeated!' }); }
    return ok({ win, msg: 'The creature escaped into the dark...' });
  }
  if (h.type === 'bandits') {
    if (choice === 'pay') { if (!G.pay(h.toll)) return lack(h.toll); G.sys.clearHazard(); return ok({ msg: 'You paid the toll. The bandits left.' }); }
    const win = Math.random() < G.winChance(P, h.power);
    const r = D.zoneById(h.zone).res;
    S.hazard = null; G.emit('hazardEnd', h);
    if (win) { const rew = { ...R.bandits.win.loot(S.depth), henium: R.bandits.win.henium }; G.give(rew); G.stat('wins'); S.hunt = (S.hunt || 0) + R.bandits.win.hunt; G.addXP(25); return ok({ win, rew, msg: 'Bandits defeated! You took their loot.' }); }
    const loss = Math.floor(S.res[r] * R.bandits.lose[0]); S.res[r] -= loss;
    const hl = G.sys.stealHenium(R.bandits.lose[1]);
    return ok({ win, msg: `Your squad was beaten. Bandits stole ${G.fmt(loss)} ${D.res[r].name}${hl ? ` and ${G.fmt(hl, 2)} HENIUM` : ''}.` });
  }
  if (h.type === 'richvein') return ok({ msg: 'Tap the glowing floor!' });
  return fail('Unknown hazard');
};

// daily HENIUM payouts for fighters (game-day rollover): shares of the war and hunt pools of the emission
G.on('farmDay', (day, offline) => {
  const S = G.S, war = Math.round(G.warPerDay() * 100) / 100;
  const hunt = Math.round(G.huntPerDay() * 100) / 100;
  if (war > 0) G.give({ henium: war });
  if (hunt > 0) G.give({ henium: hunt });
  // while away the payouts land in the "while you were away" summary instead of one toast per day
  if (!offline && (war > 0 || hunt > 0)) G.emit('note', { text: `Daily payout: +${G.fmt(war + hunt, 2)} HENIUM (guild wars ${G.fmt(war, 2)}, monster hunts ${G.fmt(hunt, 2)})`, icon: 'res/henium', good: true });
  S.guild.warPts = Math.round(S.guild.warPts * (1 - R.warDecay));
  S.hunt = Math.floor((S.hunt || 0) * R.huntKeep);
  S.world.war = Math.round(S.world.war * (1 + R.worldWar));
  S.world.hunt = Math.round((S.world.hunt || D.supply.worldHunt0) * (1 + R.worldHunt));
});
// level-up rewards
G.on('levelUp', (lv) => G.give({ feed: R.levelFeed(lv) }));
})();
