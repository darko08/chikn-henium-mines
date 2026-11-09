"""One-off: make EGG scarce (laid by chikns), make digging and building upgrades hard, add the Farm config."""
import re, math
p = 'src/js/data.js'
s = open(p).read()
def sub(a, b, count=1):
    global s
    assert a in s, 'missing: ' + a[:70]
    s = s.replace(a, b, count)

# ---- digging: expensive, with timer; no EGG ----
s = re.sub(r"D\.digCost = \(d\) => \{.*?\n\};", """D.digCost = (d) => {
  const z = D.zoneOf(d), c = {};
  c.stone = Math.ceil(400 * pow(1.3, d - 1));
  if (z.res !== 'stone') c[z.res] = Math.ceil(z.dig * 3 * pow(1.4, d - z.from));
  if (d >= 11) c.copperIngot = Math.ceil(20 * pow(1.22, d - 11));
  if (d >= 16) c.ironIngot = Math.ceil(30 * pow(1.22, d - 16));
  if (d >= 21) c.machinePart = Math.ceil(4 * pow(1.2, d - 21));
  if (d >= 31) c.alloy = Math.ceil(6 * pow(1.2, d - 31));
  if (d >= 41) c.circuit = Math.ceil(5 * pow(1.2, d - 41));
  return c;
};
// Digging takes time: depth 2 ~20s, depth 10 ~1.5min, depth 20 ~9min, depth 30 ~50min, depth 40 ~5h, depth 50 ~1 day.
D.digTime = (d) => Math.round(20 * pow(1.19, d - 1));""", s, flags=re.S)
sub("const k = pow(1.25, lv - 1), c = {};", "const k = pow(1.27, lv - 1), c = {};")

# ---- factories: no EGG, steeper upgrades that need better materials, construction time, 5 looks ----
for a, b in [("build: { stone: 300, egg: 150 }", "build: { stone: 400 }"),
             ("build: { stone: 900, coal: 300, egg: 400 }", "build: { stone: 1200, coal: 400 }"),
             ("build: { stone: 1600, coal: 700, egg: 800 }", "build: { stone: 2000, coal: 900 }"),
             ("build: { stone: 3000, copperIngot: 60, egg: 1500 }", "build: { stone: 4000, copperIngot: 80, coal: 1500 }"),
             ("build: { ironIngot: 200, components: 30, egg: 4000 }", "build: { ironIngot: 250, components: 40, copper: 4000 }"),
             ("build: { machinePart: 40, alloy: 20, egg: 10000 }", "build: { machinePart: 50, alloy: 25, iron: 10000 }")]:
    sub(a, b)
sub("""    recipes: [{ id: 'refine', name: 'Refine Henium', in: { heniumOre: 100, coal: 200, rareEarth: 4 }, out: { henium: 10 }, t: 36 }] },
];""", """    recipes: [{ id: 'refine', name: 'Refine Henium', in: { heniumOre: 100, coal: 200, rareEarth: 4 }, out: { henium: 10 }, t: 36 }] },
  { id: 'feedmill', name: 'Feed Mill', desc: 'Grinds mineral FEED · daily quota', reqDepth: 4, accent: '#e8c28a',
    build: { stone: 1500 },
    recipes: [{ id: 'feed', name: 'Mill FEED', in: { crushedOre: 40, stone: 80 }, out: { feed: 2 }, t: 30 }] },
];""")
s = re.sub(r"D\.factoryUpCost = .*?\n", """D.factoryUpCost = (f, lv) => { // lv -> lv+1: every level is much pricier and needs better materials
  const c = {}, k = pow(1.85, lv);
  for (const r in f.build) c[r] = Math.ceil(f.build[r] * k);
  if (lv >= 2) c.components = Math.ceil(5 * pow(1.6, lv - 2));
  if (lv >= 4) c.machinePart = Math.ceil(6 * pow(1.6, lv - 4));
  if (lv >= 5) c.henium = Math.ceil(10 * pow(1.7, lv - 5));
  if (lv >= 6) c.alloy = Math.ceil(8 * pow(1.55, lv - 6));
  if (lv >= 8) c.circuit = Math.ceil(6 * pow(1.5, lv - 8));
  return c;
};
D.buildTime = (lv) => Math.round(30 * pow(1.75, lv - 1)); // seconds to build level lv: 30s, 53s, 1.5min … Lv.10 ~1.3h
D.tier = (lv) => Math.min(5, Math.max(1, Math.ceil(lv / 2)));  // 5 looks per building: Lv.1-2, 3-4, 5-6, 7-8, 9-10
D.hqTier = (depth) => Math.min(5, 1 + Math.floor((depth - 1) / 10)); // HQ grows every 10 depth levels
""", s, count=1)
for uid, h, e in [('eff', 4, 3), ('waste', 6, 5), ('energy', 5, 4), ('slots', 15, 12), ('craft', 12, 10)]:
    s = re.sub(r"(\{ id: '%s'.*?base: \{ henium: %d, egg: )\d+( \} \})" % (uid, h), r"\g<1>%d\2" % e, s)

# ---- machines: no EGG ----
s = re.sub(r"(cost: \{[^}]*?), egg: \d+ \}", r"\1 }", s)
sub("cost: { stone: 450, copper: 40 }", "cost: { stone: 600, copper: 60, coal: 150 }")
s = re.sub(r"D\.machineUpCost = .*?\n", "D.machineUpCost = (m, lv) => { const i = D.machines.indexOf(m); const c = { machinePart: Math.ceil(3 * lv * (1 + i * 0.6)), ironIngot: Math.ceil(20 * lv * (1 + i * 0.4)) }; if (lv >= 5) c.alloy = Math.ceil(2 * (lv - 3) * (1 + i * 0.5)); return c; };\n", s, count=1)
s = re.sub(r"D\.machineServiceCost = .*?\n", "D.machineServiceCost = (dur) => { const miss = 100 - dur; return { machinePart: Math.max(1, Math.ceil(miss / 25)), coal: Math.ceil(miss * 12) }; };\n", s, count=1)

# ---- chikns: weight instead of EGG/h; hiring costs real EGG ----
for rid, kg0, kgm in [('common', 100, 300), ('uncommon', 110, 380), ('rare', 120, 460), ('epic', 135, 560), ('legendary', 150, 700), ('mythic', 175, 900)]:
    s = re.sub(r"(\{ id: '%s',.*?)egg: \d+,\s*" % rid, r"\1kg0: %d, kgMax: %d, " % (kg0, kgm), s, count=1)
sub("cost: { egg: 1500, feed: 40 }", "cost: { egg: 25, feed: 20 }")
sub("premium:  { name: 'Premium Hire',  cost: { henium: 30 },", "premium:  { name: 'Premium Hire',  cost: { henium: 40 },")
sub("return lv % 2 ? { egg: 400 * lv } : { feed: 60 * lv };", "return lv % 2 ? { egg: 2 * lv } : { feed: 3 * lv };")
sub("{ res: 'egg', amt: 5000, pts: 45 }", "{ res: 'egg', amt: 5, pts: 45 }")
sub("egg: Math.ceil(10000 * pow(1.7, lv))", "egg: Math.ceil(10 * pow(1.7, lv))")
sub("D.licenseCost = { henium: 250, egg: 60000 };", "D.licenseCost = { henium: 250, egg: 60 };")
sub("D.exchange = { heniumToEgg: 900, eggPerHenium: 1150, eggPerFeed: 4 };", "D.exchange = { eggPerHenium: 5, eggPerFeed: 3 }; // EGG can only be burned, never minted by trading")

# ---- rewards: EGG and FEED become rare ----
def scale_egg(m):
    return 'egg: %d' % max(1, math.ceil(int(m.group(1)) / 200))
def scale_range(m):
    return 'egg: [%d, %d]' % (max(1, math.ceil(int(m.group(1)) / 200)), max(1, math.ceil(int(m.group(2)) / 200)))
start = s.index('D.expeditions = [')
end = s.index('// Six-month journey')
mid = s[start:end]
mid = re.sub(r"egg: \[(\d+), (\d+)\]", scale_range, mid)
mid = re.sub(r"egg: (\d+)", scale_egg, mid)
mid = re.sub(r"feed: (\d+) \}", lambda m: 'feed: %d }' % max(2, math.ceil(int(m.group(1)) / 10)), mid)
s = s[:start] + mid + s[end:]

# ---- farm config & farmer specialization ----
sub("  { id: 'gleader', name: 'Guild Leader',", "  { id: 'farmer', name: 'Egg Farmer',   desc: 'Chikns need 20% less FEED per kg, can grow 25% heavier, and the nest holds twice as many eggs.' },\n  { id: 'gleader', name: 'Guild Leader',")
sub("// Player progression", """// Egg farm: every Chikn lays about 1 EGG per day; heavier Chikns lay more (with diminishing returns).
// Chikns eat FEED every day to keep their weight; without FEED they slowly lose weight.
D.farm = {
  day: 300,                                   // seconds per farm day in this prototype (the real game would use 86,400)
  eggsAt: (kg) => Math.pow(kg / 100, 0.6),    // eggs per day: 100kg = 1, 200kg = 1.5, 400kg = 2.3, 800kg = 3.5
  upkeep: (kg) => kg / 200,                   // FEED eaten per day: 100kg = 0.5
  hunger: 0.02,                               // share of extra weight lost per hungry day
  feedPerKg: (kg) => 0.5 * kg / 100,          // FEED needed per extra kg at this weight
  step: 10,                                   // kg added by one feeding
  nestDays: 2,                                // the nest holds this many days of eggs
  coop: (lv) => 6 + 3 * (lv - 1),             // how many Chikns the coop houses
  coopMax: 10,
  coopCost: (lv) => ({ stone: Math.ceil(2000 * pow(2.1, lv - 1)), copper: Math.ceil(400 * pow(2.1, lv - 1)), egg: Math.ceil(20 * pow(1.8, lv - 1)) }),
  millQuota: (lv) => 4 + 3 * (lv - 1),        // FEED the Feed Mill may grind per day (your share of the world pool)
};

// Player progression""")
open(p, 'w').write(s)
print('data.js reworked')
