"""Economy v4 (state.js): world clock + contract HENIUM schedule, offline split (8h mining cap, real-time timers),
factory jobs carry leftover time (no lost batches), test-speed support, new save key."""
import re
p = 'src/js/state.js'
s = open(p).read()
def sub(a, b):
    global s
    assert a in s, 'missing: ' + a[:90]
    s = s.replace(a, b, 1)

sub("const SAVE_KEY = 'chikn-henium-mines-v1';", "const SAVE_KEY = 'chikn-henium-mines-v2'; // v2: real-time economy (old saves from the fast prototype are not loaded)")
sub("    world: { mined: D.supply.start, war: D.supply.worldWar0, hunt: D.supply.worldHunt0, debt: 0 }, hunt: 0, tapEnergy: D.rules.tap.energyMax,",
    "    world: { mined: 0, war: D.supply.worldWar0, hunt: D.supply.worldHunt0, paid: 0 }, worldT: Math.max(0, (now() - D.supply.genesis) / 1000),\n    hunt: 0, tapEnergy: D.rules.tap.energyMax,")
sub("  G.dexInit(S);\n  if (kind === 'showcase') showcase(S);",
    "  S.world.mined = D.cumEmission(S.worldT / 86400);\n  G.dexInit(S);\n  if (kind === 'showcase') showcase(S);")
# showcase: amounts that fit the real-time economy at depth 27
sub("Object.assign(S.res, { egg: 1250, feed: 348, henium: 1842.75, stone: 2.4e6, coal: 1.1e6, copper: 540000, iron: 812000,\n    heniumOre: 18500, rareEarth: 14600, crushedOre: 8250, copperIngot: 4120, ironIngot: 3760, components: 420, machinePart: 260, alloy: 180, circuit: 90 });",
    "Object.assign(S.res, { egg: 1250, feed: 348, henium: 1842.75, stone: 240e6, coal: 110e6, copper: 54e6, iron: 81e6,\n    heniumOre: 1.85e6, rareEarth: 14600, crushedOre: 82500, copperIngot: 41200, ironIngot: 37600, components: 4200, machinePart: 2600, alloy: 1800, circuit: 900 });")
sub("""    { id: 1, f: 'smelter', r: 'smeltCopper', t: 4, dur: 11.3, repeat: true },
    { id: 2, f: 'forge', r: 'parts', t: 6, dur: 17.8, repeat: true },
    { id: 3, f: 'refinery', r: 'refine', t: 12, dur: 32.4, repeat: true },""",
"""    { id: 1, f: 'smelter', r: 'smeltCopper', t: 200, dur: 485, repeat: true },
    { id: 2, f: 'forge', r: 'parts', t: 600, dur: 1458, repeat: true },
    { id: 3, f: 'refinery', r: 'refine', t: 1200, dur: 3600, repeat: true },""")
sub("  S.crafts = [{ id: 4, type: 'scanner', t: 20, dur: 75 }, { id: 5, type: 'improved', t: 8, dur: 30 }];",
    "  S.crafts = [{ id: 4, type: 'scanner', t: 7200, dur: 28800 }, { id: 5, type: 'improved', t: 900, dur: 3600 }];")
sub("  S.farm = { coopLv: 4, day: 41, dayT: 120, milled: 2, hungry: false };", "  S.farm = { coopLv: 4, day: 41, dayT: 30000, milled: 2, hungry: false };")
sub("  S.factories.advanced.con = { t: 40, dur: D.buildTime(3), to: 3 };   // an upgrade under construction",
    "  S.factories.advanced.con = { t: 600, dur: D.buildTime(3), to: 3 };  // an upgrade under construction")
sub("  S.dig = { t: 600, dur: D.digTime(28), to: 28 };                      // digging towards depth 28",
    "  S.dig = { t: 86400 * 2.5, dur: D.digTime(27), to: 28 };            // digging towards depth 28")
sub("  S.live = { id: 'vein', until: now() + 9 * 60e3, next: now() + 12 * 60e3 };", "  S.live = { id: 'vein', until: now() + 9 * 3600e3, next: now() + 20 * 3600e3 };")
# load: migrate world fields
sub("""    if (!(typeof S.world.debt === 'number' && S.world.debt >= 0)) S.world.debt = 0;
    if (!(typeof S.world.hunt === 'number' && S.world.hunt > 0)) S.world.hunt = D.supply.worldHunt0;""",
"""    if (!(typeof S.worldT === 'number' && S.worldT >= 0)) S.worldT = Math.max(0, (now() - D.supply.genesis) / 1000);
    if (!(typeof S.world.hunt === 'number' && S.world.hunt > 0)) S.world.hunt = D.supply.worldHunt0;
    if (!(typeof S.world.paid === 'number')) S.world.paid = 0;
    S.world.mined = D.cumEmission(S.worldT / 86400);""")
# give: HENIUM paid to the player is part of the world's scheduled emission (the schedule is the supply)
sub("""// transfer=true for HENIUM that only changes hands (refunds, trades). Any other HENIUM is newly minted: it is capped by
// what is left of the 21M, counts as mined at once and goes on the world's debt, so the rest of the world mints that much
// less (G.tick). Every HENIUM a player earns therefore comes out of the fixed daily emission. Returns what was given.""",
"""// transfer=true for HENIUM that only changes hands (refunds, trades). Any other HENIUM is newly minted: it is part of the
// world's scheduled emission (S.world.mined follows the schedule exactly, so whatever you earn the rest of the world does
// not), and nothing is paid once all 21M are mined. Returns what was given.""")
sub("""    if (r === 'henium' && v > 0 && !transfer && S.world) {
      v = Math.min(v, Math.max(0, D.supply.cap - S.world.mined));
      S.world.mined += v;
      S.world.debt = (S.world.debt || 0) + v;
    }""", """    if (r === 'henium' && v > 0 && !transfer && S.world) {
      if (S.world.mined >= D.supply.cap) v = 0;
      S.world.paid = (S.world.paid || 0) + v;
    }""")
# HENIUM schedule by the world clock
sub("""G.epoch = () => D.supply.halvings.filter((h) => G.S.world.mined >= h).length;
G.halving = () => (G.S.world.mined >= D.supply.cap ? 0 : Math.pow(0.5, G.epoch())); // 0 once all 21M are mined
G.nextHalving = () => D.supply.halvings.find((h) => G.S.world.mined < h) || D.supply.cap;""",
"""G.worldDays = () => (G.S.worldT || 0) / 86400;                          // days since the game's launch (world clock)
G.epoch = () => Math.floor(G.worldDays() / D.supply.halvingDays);
G.halving = () => (G.S.world.mined >= D.supply.cap ? 0 : Math.pow(0.5, G.epoch())); // 0 once all 21M are mined
G.nextHalving = () => D.cumEmission((G.epoch() + 1) * D.supply.halvingDays);        // world supply at the next halving
G.nextHalvingIn = () => ((G.epoch() + 1) * D.supply.halvingDays - G.worldDays()) * 86400; // seconds to the next halving""")
sub("G.worldRefPower = () => D.supply.worldPower0 * Math.pow(1 + D.supply.worldGrowth, G.S.farm ? G.S.farm.day : 0);",
    "G.worldRefPower = () => D.supply.worldPower0 * Math.pow(1 + D.supply.worldGrowth, G.worldDays());")
# tick: mineK (0..1) scales mining and machine coal; world clock; schedule-based supply; factory jobs carry leftover time
sub("G.tick = (dt, offline = false) => {\n  const S = G.S;\n  if (!(dt > 0)) return;\n  // mining\n  for (const z of D.zones) {\n    const o = G.zoneOutputs(z);\n    for (const r in o) { const a = o[r] * dt; S.res[r] += a; if (r === z.res) G.stat('mined', a); }\n  }",
    "// mineK (0..1) is the share of dt the floors mine: offline mining stops after the offline cap (G.offline)\nG.tick = (dt, offline = false, mineK = 1) => {\n  const S = G.S;\n  if (!(dt > 0)) return;\n  // mining\n  if (mineK > 0) for (const z of D.zones) {\n    const o = G.zoneOutputs(z);\n    for (const r in o) { const a = o[r] * dt * mineK; S.res[r] += a; if (r === z.res) G.stat('mined', a); }\n  }")
sub("    if (!m.zone || m.dur <= 0) { m.off = false; continue; }\n    const ms = G.machineStats(m), need = ms.energy / 3600 * dt;",
    "    if (!m.zone || m.dur <= 0 || mineK <= 0) { m.off = false; continue; }\n    const ms = G.machineStats(m), need = ms.energy / 3600 * dt * mineK;")
sub("""    const f = D.factoryById(j.f);
    j.t += dt;
    if (j.t >= j.dur) G.sys.finishJob(j, offline);
  }""", """    // a long tick can finish several batches: the leftover time carries into the next job of the same factory
    let job = j, guard = 0;
    job.t += dt;
    while (job && job.t >= job.dur && guard++ < 2000) {
      const over = job.t - job.dur;
      G.sys.finishJob(job, offline);
      job = G.activeJob(j.f);
      if (job) job.t += over;
    }
  }""")
sub("""  const W = S.world, slice = G.emission() * dt / D.farm.day, repay = Math.min(slice, Math.max(0, W.debt || 0));
  W.debt = (W.debt || 0) - repay;
  W.mined = Math.min(D.supply.cap, W.mined + slice - repay);
  G.dexTick(dt, slice - repay);""", """  // the world clock runs on: the world's supply follows the HENIUM schedule exactly (what you earn is part of it)
  S.worldT = (S.worldT || 0) + dt;
  const slice = G.emission() * dt / D.farm.day;
  S.world.mined = D.cumEmission(S.worldT / 86400);
  G.dexTick(dt, slice);""")
# offline: mining is capped (the idle-income cap), everything that is a timer runs the whole time away
s = re.sub(r"G\.offline = \(sec\) => \{.*?\n\};\n", """G.offline = (sec) => {
  const S = G.S;
  if (!(sec >= 30)) return null;
  const mineSec = Math.min(sec, R.offlineH * 3600);       // the floors mine for at most offlineH hours while you are away
  const total = Math.min(sec, 60 * 86400);                // timers, factories, the farm and the world run the whole time
  const before = { ...S.res };
  const steps = Math.min(600, Math.max(1, Math.ceil(total / 60)));
  const dt = total / steps;
  let mined = 0;
  for (let i = 0; i < steps; i++) {
    const m = Math.max(0, Math.min(dt, mineSec - mined));
    mined += m;
    G.tick(dt, true, m / dt);
  }
  const gains = {};
  for (const r in S.res) { const d = S.res[r] - before[r]; if (d > 0.5) gains[r] = d; }
  return { sec: total, mineSec, gains };
};
""", s, count=1, flags=re.S)
open(p, 'w').write(s)
print('state.js: world clock, offline split, job carry-over')
