"""One-off: HENIUM scarcity (world daily emission shared by work & fights), fewer faucets, more sinks, DEX hook-up."""
import re
def patch(path, pairs):
    s = open(path).read()
    for a, b in pairs:
        assert a in s, f'{path}: missing {a[:90]!r}'
        s = s.replace(a, b, 1)
    open(path, 'w').write(s)

patch('src/js/data.js', [
  # world emission: like bitcoin, a fixed budget per day shared by everyone, halving as supply is mined
  ("D.supply = { cap: 21e6, start: 8.4e6, npcRate: 12, halvings: [10.5e6, 15.75e6, 18.375e6, 19.6875e6, 20.34375e6] };",
   """D.supply = {
  cap: 21e6, start: 8.4e6, halvings: [10.5e6, 15.75e6, 18.375e6, 19.6875e6, 20.34375e6],
  daily: 7200,              // HENIUM the whole world can mint per game day (epoch 1), halves every epoch
  split: { refinery: 0.7, war: 0.2, boss: 0.1 },  // refiners, guild-war fighters, monster hunters
  worldPower0: 900,         // refinery power of all other players at launch
  worldGrowth: 0.004,       // the world builds ~0.4% more refinery power every game day
  worldWar0: 4000,          // war points of the other guilds
};
D.refPower = (lv) => (lv > 0 ? Math.round(10 * pow(1.6, lv - 1)) : 0); // refinery power by level"""),
  # HENIUM sinks: deep digging and high-level buildings need HENIUM
  ("  if (d >= 31) c.alloy = Math.ceil(8 * pow(1.25, d - 31));",
   "  if (d >= 21) c.henium = Math.ceil(2 * pow(1.25, d - 21));\n  if (d >= 31) c.alloy = Math.ceil(8 * pow(1.25, d - 31));"),
  ("  if (lv >= 5) c.henium = Math.ceil(10 * pow(1.7, lv - 5));", "  if (lv >= 5) c.henium = Math.ceil(25 * pow(1.9, lv - 5));"),
  ("premium:  { name: 'Premium Hire',  cost: { henium: 40 },", "premium:  { name: 'Premium Hire',  cost: { henium: 60 },"),
  # fewer free HENIUM faucets
  ("  if (lv % 5 === 0) return { henium: 10 + lv * 2 };", "  if (lv % 5 === 0) return { henium: 3 + Math.floor(lv / 5) };"),
  ("r: { heniumOre: [80, 200], rareEarth: [6, 16], henium: [3, 8] } },", "r: { heniumOre: [80, 200], rareEarth: [6, 16], henium: [1, 2] } },"),
  ("r: { henium: [12, 32], alloy: [6, 16], circuit: [3, 8], egg: [20, 45] } },", "r: { henium: [2, 6], alloy: [6, 16], circuit: [3, 8], egg: [20, 45] } },"),
  ("r: { heniumOre: [150, 320], rareEarth: [4, 10], henium: [4, 10] }, event: true };", "r: { heniumOre: [150, 320], rareEarth: [4, 10], henium: [1, 3] }, event: true };"),
  ("text: () => 'Craft 1 machine',             stat: 'crafted',   n: () => 1, r: { henium: 5 } },", "text: () => 'Craft 1 machine',             stat: 'crafted',   n: () => 1, r: { feed: 6 } },"),
  # bosses: HENIUM only for the first kill (plus the daily monster-hunter pool); repeat kills give materials
  ("{ name: 'Crystal Spider',    mon: 'spider', power: 900,  r: { henium: 8, rareEarth: 10, egg: 20 } },", "{ name: 'Crystal Spider',    mon: 'spider', power: 900,  r: { rareEarth: 10, egg: 6 }, first: { henium: 15 } },"),
  ("{ name: 'Henium Golem',      mon: 'hgolem', power: 1600,  r: { henium: 20, alloy: 8 } },", "{ name: 'Henium Golem',      mon: 'hgolem', power: 1600,  r: { heniumOre: 300, alloy: 8 }, first: { henium: 40 } },"),
  ("{ name: 'Core Wraith',       mon: 'wraith', power: 2800,  r: { henium: 45, circuit: 8 } },", "{ name: 'Core Wraith',       mon: 'wraith', power: 2800,  r: { heniumOre: 600, circuit: 8 }, first: { henium: 90 } },"),
  ("{ name: 'Ancient Rock King', mon: 'king',   power: 5000, r: { henium: 110, alloy: 30 } },", "{ name: 'Ancient Rock King', mon: 'king',   power: 5000, r: { heniumOre: 1200, alloy: 30 }, first: { henium: 200 } },"),
])

patch('src/js/state.js', [
  ("    world: { mined: D.supply.start },", "    world: { mined: D.supply.start, war: D.supply.worldWar0 }, hunt: 0,"),
  ("  if (kind === 'showcase') showcase(S);", "  G.dexInit(S);\n  if (kind === 'showcase') showcase(S);"),
  ("G.nextHalving = () => D.supply.halvings.find((h) => G.S.world.mined < h) || D.supply.cap;",
   """G.nextHalving = () => D.supply.halvings.find((h) => G.S.world.mined < h) || D.supply.cap;
// HENIUM emission: the world mints D.supply.daily per game day; you earn a share of it by refining (work),
// by guild wars (fighting other guilds) and by hunting monsters. Shares shrink as the world grows.
G.emission = () => D.supply.daily * G.halving();                         // whole world, per game day
G.myRefPower = () => D.refPower(G.S.factories.refinery.lv) * (1 + G.bonus('refine') + 0.08 * (G.S.guild.zoneLv - 1) + (G.specIs('miner') ? 0.05 : 0));
G.worldRefPower = () => D.supply.worldPower0 * Math.pow(1 + D.supply.worldGrowth, G.S.farm ? G.S.farm.day : 0);
G.refShare = () => { const m = G.myRefPower(); return m > 0 ? m / (m + G.worldRefPower()) : 0; };
G.refPerDay = () => G.emission() * D.supply.split.refinery * G.refShare();  // HENIUM/day if the refinery never stops
G.warShare = () => { const w = G.S.guild.warPts; return w > 0 ? w / (w + G.S.world.war) : 0; };
G.warPerDay = () => G.emission() * D.supply.split.war * G.warShare();"""),
  # refinery output = your share of the world's emission for the job's duration
  ("  if (f.id === 'refinery') k *= (1 + G.bonus('refine')) * G.halving();\n  return Object.fromEntries(",
   "  if (f.id === 'refinery') {\n    const dur = (G.S.jobs.find((j) => j.f === 'refinery' && j.r === rec.id) || {}).dur || rec.t;\n    return { henium: Math.round(G.refPerDay() * dur / D.farm.day * 100) / 100 };\n  }\n  return Object.fromEntries("),
  # the rest of the world mints what you don't
  ("  S.world.mined = Math.min(D.supply.cap, S.world.mined + D.supply.npcRate * dt);",
   "  S.world.mined = Math.min(D.supply.cap, S.world.mined + G.emission() * (1 - D.supply.split.refinery * G.refShare()) * dt / D.farm.day);\n  G.dexTick(dt);"),
])

patch('src/js/systems.js', [
  # guild project payout smaller
  ("  G.give({ henium: 10 + 10 * g.proj });", "  G.give({ henium: 5 + 5 * g.proj });"),
  # EGG -> HENIUM goes through the DEX now (no minting)
  ("  else if (kind === 'e2h') {\n    if (S.world.mined + qty > D.supply.cap) return fail('All 21M HENIUM have been mined');",
   "  else if (kind === 'e2h') {\n    return fail('Trade EGG for HENIUM on the DEX: HENIUM can only be minted by refining, guild wars and monster hunts.');\n    // eslint-disable-next-line no-unreachable\n    if (S.world.mined + qty > D.supply.cap) return fail('All 21M HENIUM have been mined');"),
  # level-ups: FEED only
  ("G.on('levelUp', (lv) => G.give({ henium: lv, feed: 2 + Math.floor(lv / 3) }));", "G.on('levelUp', (lv) => G.give({ feed: 3 + Math.floor(lv / 2) }));"),
])

# PvE: first clear pays the stage's HENIUM bounty
s = open('src/js/systems.js').read()
a = "    rew = G.scale(st.r, first ? 2 : 1); G.give(rew);"
assert a in s
s = s.replace(a, "    rew = G.scale(st.r, first ? 2 : 1);\n    if (first && st.first) for (const k in st.first) rew[k] = (rew[k] || 0) + st.first[k];\n    G.give(rew); S.hunt = (S.hunt || 0) + 1 + i;")
# PvP: 1 HENIUM per win, the rest comes from the daily war payout
a = "if (win) { pts = G.randInt(20, 40); rew = { henium: G.randInt(2, 6), egg: G.randInt(4, 10) };"
assert a in s
s = s.replace(a, "if (win) { pts = G.randInt(20, 40); rew = { henium: 1, egg: G.randInt(2, 5) };")
# daily payouts from the war and monster-hunt pools; war points cool down so guilds must keep fighting
s = s.replace("// level-up rewards", """// daily HENIUM payouts for fighters (game-day rollover)
G.on('farmDay', () => {
  const S = G.S, war = Math.round(G.warPerDay() * 100) / 100;
  const hunt = Math.round(G.emission() * D.supply.split.boss * Math.min(1, (S.hunt || 0) / 400) * 100) / 100;
  if (war > 0) G.give({ henium: war });
  if (hunt > 0) G.give({ henium: hunt });
  if (war > 0 || hunt > 0) G.emit('note', { text: `Daily payout: +${G.fmt(war + hunt, 2)} HENIUM (guild wars ${G.fmt(war, 2)}, monster hunts ${G.fmt(hunt, 2)})`, icon: 'res/henium', good: true });
  S.guild.warPts = Math.round(S.guild.warPts * 0.85);
  S.hunt = Math.floor((S.hunt || 0) * 0.5);
  S.world.war = Math.round(S.world.war * 1.003);
});
// level-up rewards""", 1)
open('src/js/systems.js', 'w').write(s)

# build: include dex.js
s = open('build.mjs').read()
a = "const JS = ['data', 'state', 'systems', 'farm', 'ui',"
assert a in s
s = s.replace(a, "const JS = ['data', 'state', 'systems', 'farm', 'dex', 'ui',")
open('build.mjs', 'w').write(s)
print('henium rework applied')
