"""One-off: timed digging & construction, Feed Mill quota, coop cap, scarce EGG rewards (state.js + systems.js)."""
import re
def patch(path, pairs, regex_pairs=()):
    s = open(path).read()
    for a, b in pairs:
        assert a in s, f'{path}: missing {a[:80]!r}'
        s = s.replace(a, b, 1)
    for pat, rep in regex_pairs:
        s2 = re.sub(pat, rep, s, count=1, flags=re.S)
        assert s2 != s, f'{path}: regex did not match {pat[:60]!r}'
        s = s2
    open(path, 'w').write(s)

patch('src/js/state.js', [
  ("res: Object.assign(allRes(), { egg: 1500, feed: 120, henium: 5 }),", "res: Object.assign(allRes(), { egg: 30, feed: 40, henium: 5 }),"),
  ("[f.id, { lv: 0, recipe: f.recipes[0].id }]", "[f.id, { lv: 0, recipe: f.recipes[0].id, con: null }]"),
  ("chikns: [], squad: [], nest: 0,", "chikns: [], squad: [], nest: 0, farm: { coopLv: 1, day: 0, dayT: 0, milled: 0, hungry: false }, dig: null,"),
  ("egg: 1250000, feed: 348000, henium: 1842.75,", "egg: 1250, feed: 348, henium: 1842.75,"),
  ("  S.squad = S.chikns.slice(0, 3).map((c) => c.id);", "  S.chikns.forEach((c) => { G.ensureKg(c); G.syncLv(c); });\n  S.squad = S.chikns.slice(0, 3).map((c) => c.id);"),
  ("  S.craftSlots = 5; S.fup.craft = 2; // \"Crafting Queue (2/5)\" as in the mockup",
   "  S.craftSlots = 5; S.fup.craft = 2; // \"Crafting Queue (2/5)\" as in the mockup\n"
   "  S.farm = { coopLv: 4, day: 41, dayT: 120, milled: 2, hungry: false };\n"
   "  S.factories.feedmill.lv = 3; S.nest = 6;\n"
   "  S.factories.advanced.con = { t: 40, dur: D.buildTime(3), to: 3 };   // an upgrade under construction\n"
   "  S.dig = { t: 600, dur: D.digTime(28), to: 28 };                      // digging towards depth 28"),
  ("  // nest\n  S.nest = Math.min(S.nest + G.eggRate() * dt, G.eggRate() * 4 * 3600 + 50);",
   "  // farm: eggs, FEED upkeep, hunger\n  G.farmTick(dt, offline);\n"
   "  // construction and digging timers\n"
   "  for (const f of D.factories) { const st = S.factories[f.id]; if (st.con) { st.con.t += dt; if (st.con.t >= st.con.dur) G.sys.finishBuild(f, offline); } }\n"
   "  if (S.dig) { S.dig.t += dt * G.digSpeed(); if (S.dig.t >= S.dig.dur) G.sys.finishDig(offline); }"),
  ("    seen.add(j.f);\n", "    seen.add(j.f);\n    if (S.factories[j.f].con) continue; // paused while the building is under construction\n"),
  ("    return merge(G.newState(), saved);",
   "    const S = merge(G.newState(), saved);\n    for (const id in S.factories) if (S.factories[id].con === undefined) S.factories[id].con = null;\n"
   "    S.chikns.forEach((c) => { G.ensureKg(c); G.syncLv(c); });\n    return S;"),
])

patch('src/js/systems.js', [
  # coop capacity for hires, kg for new chikns
  ("  const c = { id: S.nextId++, name: G.pick(D.names), num: G.randInt(1000, 9999), role: role || G.pick(Object.keys(D.roles)), rarity, lv: 1, status: 'idle', until: 0 };",
   "  const c = { id: S.nextId++, name: G.pick(D.names), num: G.randInt(1000, 9999), role: role || G.pick(Object.keys(D.roles)), rarity, lv: 1, kg: D.rarity(rarity).kg0, status: 'idle', until: 0 };"),
  ("  const free = kind === 'standard' && S.stats.hired === 0;\n",
   "  const free = kind === 'standard' && S.stats.hired === 0;\n  if (S.chikns.length >= G.coopCap()) return fail(`The coop is full (${S.chikns.length}/${G.coopCap()}). Upgrade it on the Farm.`);\n"),
  # feed mill quota and construction pause when queueing
  ("  if (st.lv < 1) return fail(`Build the ${f.name} first`);\n  if (S.jobs.length >= G.jobSlots()) return fail('Production queue is full');",
   "  if (st.lv < 1) return fail(`Build the ${f.name} first`);\n  if (st.con) return fail(`The ${f.name} is under construction`);\n  if (S.jobs.length >= G.jobSlots()) return fail('Production queue is full');"),
  ("  const cost = G.recipeIn(rec);\n  if (!G.pay(cost)) return lack(cost);\n  S.jobs.push({ id: S.nextId++, f: fid, r: rec.id, t: 0, dur: rec.t * G.factorySpeed(f), repeat: !!repeat, paid: cost });",
   "  const cost = G.recipeIn(rec);\n  const feed = fid === 'feedmill' ? G.recipeOut(f, rec).feed : 0;\n"
   "  if (feed && S.farm.milled + G.queuedFeed() + feed > G.millQuota()) return fail(`Today's FEED quota is used up (${Math.round(S.farm.milled + G.queuedFeed())}/${G.millQuota()}). Upgrade the Feed Mill for a bigger share.`);\n"
   "  if (!G.pay(cost)) return lack(cost);\n  S.jobs.push({ id: S.nextId++, f: fid, r: rec.id, t: 0, dur: rec.t * G.factorySpeed(f), repeat: !!repeat, paid: cost, feed });"),
  ("  if (out.henium) G.stat('refined', out.henium); // G.give already counted it toward the world supply",
   "  if (out.henium) G.stat('refined', out.henium); // G.give already counted it toward the world supply\n  if (j.f === 'feedmill') S.farm.milled += out.feed || 0;"),
  ("    if (S.jobs.length < G.jobSlots() && G.pay(cost)) S.jobs.push({ id: S.nextId++, f: j.f, r: j.r, t: 0, dur: rec.t * G.factorySpeed(f), repeat: true, paid: cost });",
   "    const feed = j.f === 'feedmill' ? G.recipeOut(f, rec).feed : 0;\n"
   "    const quotaOk = !feed || S.farm.milled + G.queuedFeed() + feed <= G.millQuota();\n"
   "    if (quotaOk && S.jobs.length < G.jobSlots() && G.pay(cost)) S.jobs.push({ id: S.nextId++, f: j.f, r: j.r, t: 0, dur: rec.t * G.factorySpeed(f), repeat: true, paid: cost, feed });\n"
   "    else if (!quotaOk) { if (!offline) G.emit('note', { text: 'Feed Mill: daily FEED quota reached. It resumes tomorrow.', icon: 'res/feed' }); }"),
  # EGG can no longer be minted from HENIUM
  ("  return { h2e: D.exchange.heniumToEgg * (1 + t), e2h: D.exchange.eggPerHenium * (1 - t), e2f: D.exchange.eggPerFeed };",
   "  return { h2e: 0, e2h: D.exchange.eggPerHenium * (1 - t), e2f: D.exchange.eggPerFeed };"),
  ("  if (kind === 'h2e') { if (!G.pay({ henium: qty })) return fail('Not enough HENIUM'); S.res.egg += qty * x.h2e; }",
   "  if (kind === 'h2e') return fail('EGG is only laid by Chikns. HENIUM cannot be turned back into EGG.');"),
  # scarce EGG/FEED rewards
  ("rew = { henium: G.randInt(2, 6), egg: G.randInt(800, 2000) };", "rew = { henium: G.randInt(2, 6), egg: G.randInt(4, 10) };"),
  ("h.reward = { egg: Math.round(200 + S.depth * 70), feed: Math.round(20 + S.depth * 4) };", "h.reward = { egg: 1 + Math.floor(S.depth / 8), feed: 2 + Math.floor(S.depth / 6) };"),
  ("h.reward = { egg: Math.round(300 + S.depth * 90), feed: Math.round(30 + S.depth * 5) };", "h.reward = { egg: 1 + Math.floor(S.depth / 6), feed: 2 + Math.floor(S.depth / 5) };"),
  ("h.toll = { egg: Math.round(300 + S.depth * 120) };", "h.toll = { egg: 2 + Math.floor(S.depth / 4) };"),
  ("if (Math.random() < 0.15 + explore * 0.2) rew.feed = (rew.feed || 0) + G.randInt(40, 160);", "if (Math.random() < 0.15 + explore * 0.2) rew.feed = (rew.feed || 0) + G.randInt(2, 8);"),
  ("G.on('levelUp', (lv) => G.give({ egg: 250 * lv, feed: 25 * lv }));", "G.on('levelUp', (lv) => G.give({ henium: lv, feed: 2 + Math.floor(lv / 3) }));"),
], regex_pairs=[
  # timed digging
  (r"G\.act\.dig = \(\) => \{.*?\n\};\n",
   """G.digSpeed = () => { const m = G.machineOn(D.zoneOf(G.S.depth).id); return m && G.machineStats(m).working ? G.machineStats(m).speed : 1; };
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
"""),
  # timed construction
  (r"G\.act\.build = \(fid\) => \{.*?\n\};\nG\.act\.upgradeFactory = \(fid\) => \{.*?\n\};\n",
   """G.act.build = (fid) => {
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
"""),
])
print('state.js and systems.js reworked')
