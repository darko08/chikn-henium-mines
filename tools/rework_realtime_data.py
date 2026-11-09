"""Economy v4: real-time economy (a game day is a real day), contract-aligned HENIUM schedule, re-paced mining."""
import re
p = 'src/js/data.js'
s = open(p).read()
def sub(a, b):
    global s
    assert a in s, 'missing: ' + a[:90]
    s = s.replace(a, b, 1)

# ---- zones: how much of its own ore a dig inside the zone needs (start of the zone; grows 12% per depth) ----
for zid, old, new in [('stone', 'dig: 45 }', 'dig: 0 }'), ('coal', 'dig: 160,', 'dig: 5e6,'), ('copper', 'dig: 420,', 'dig: 6e6,'),
                      ('iron', 'dig: 900,', 'dig: 2e6,'), ('henium', 'dig: 260,', 'dig: 8e5,'), ('rare', 'dig: 70,', 'dig: 1.5e5,'), ('core', 'dig: 900,', 'dig: 3e6,')]:
    i = s.index("{ id: '%s'," % zid)
    j = s.index(old, i)
    s = s[:j] + new + s[j + len(old):]

# ---- floors: costs grow 45% per level (was 30%), so floors keep improving for months instead of maxing out in a day ----
sub("D.floorCost = (z, lv) => { // cost to go from lv -> lv+1\n  const k = pow(1.3, lv - 1), c = {};",
    "D.floorCost = (z, lv) => { // cost to go from lv -> lv+1; grows 45% a level, so floors keep improving for months\n  const k = pow(1.45, lv - 1), c = {};")

# ---- digging: real time. Costs are a day or two of the production a player has at that depth; timers set the pace ----
s = re.sub(r"// Cost to dig from depth d to d\+1\..*?\nD\.digTime = \(d\) => Math\.round\(20 \* pow\(1\.19, d - 1\)\);\n",
"""// Cost to dig from depth d to d+1, sized to the production a player has at that depth (all times are real time).
// The first depths are cheap so the first session ends deeper; after that every dig costs a day or two of output.
D.digCost = (d) => {
  const z = D.zoneOf(d), c = {};
  const early = [300, 3000, 250e3, 3e6];                    // 1→2, 2→3, 3→4, 4→5
  c.stone = Math.ceil(d <= 4 ? early[d - 1] : 15e6 * pow(1.08, d - 5));
  if (z.res !== 'stone') c[z.res] = Math.ceil(z.dig * pow(1.12, d - z.from));
  if (d >= 11) c.copperIngot = Math.ceil(2000 * pow(1.1, d - 11));
  if (d >= 16) c.ironIngot = Math.ceil(2000 * pow(1.1, d - 16));
  if (d >= 21) c.machinePart = Math.ceil(100 * pow(1.1, d - 21));
  if (d >= 21) c.henium = Math.ceil(2 * pow(1.18, d - 21));
  if (d >= 31) c.alloy = Math.ceil(100 * pow(1.1, d - 31));
  if (d >= 41) c.circuit = Math.ceil(40 * pow(1.1, d - 41));
  return c;
};
// Digging takes real time: a minute for the first depth, hours on day one, then days. From depth 15 every dig takes
// 8 days of digging work; a machine on the deepest floor works faster (G.digSpeed), so later digs go quicker.
// Paced to the 6-month journey: Henium Vein (21) around month 3, the Core Zone (41) around month 6.
D.digTime = (d) => {
  const early = [60, 600, 4 * 3600, 12 * 3600];             // 1→2, 2→3, 3→4, 4→5
  return d <= 4 ? early[d - 1] : Math.round(86400 * Math.min(8, 1.5 + 0.65 * (d - 5)));
};
""", s, count=1, flags=re.S)
assert 'D.digTime = (d) => {' in s

# ---- factories: real-time recipes (minutes to an hour), costs and build times for a months-long game ----
for a, b in [
  ("build: { stone: 400 },\n    recipes: [{ id: 'crush', name: 'Crush Stone', in: { stone: 100 }, out: { crushedOre: 60 }, t: 10 }] },",
   "build: { stone: 50e3 },\n    recipes: [{ id: 'crush', name: 'Crush Stone', in: { stone: 100 }, out: { crushedOre: 60 }, t: 120 }] },"),
  ("build: { stone: 1200, coal: 400 },\n    recipes: [{ id: 'separate', name: 'Separate Ore', in: { crushedOre: 120 }, out: { copper: 26, iron: 20, heniumOre: 4, rareEarth: 1 }, t: 14 }] },",
   "build: { stone: 5e6, coal: 50e3 },\n    recipes: [{ id: 'separate', name: 'Separate Ore', in: { crushedOre: 120 }, out: { copper: 26, iron: 20, heniumOre: 4, rareEarth: 1 }, t: 300 }] },"),
  ("build: { stone: 2000, coal: 900 },", "build: { stone: 20e6, coal: 3e6 },"),
  ("in: { copper: 60, coal: 30 }, out: { copperIngot: 30 }, t: 14 },", "in: { copper: 60, coal: 30 }, out: { copperIngot: 30 }, t: 600 },"),
  ("in: { iron: 60, coal: 30 }, out: { ironIngot: 30 }, t: 17 }] },", "in: { iron: 60, coal: 30 }, out: { ironIngot: 30 }, t: 720 }] },"),
  ("build: { stone: 4000, copperIngot: 80, coal: 1500 },", "build: { stone: 40e6, copperIngot: 3000, coal: 10e6 },"),
  ("in: { ironIngot: 20, copperIngot: 10 }, out: { components: 6 }, t: 18 },", "in: { ironIngot: 20, copperIngot: 10 }, out: { components: 6 }, t: 1200 },"),
  ("in: { ironIngot: 30, coal: 40 }, out: { machinePart: 5 }, t: 22 }] },", "in: { ironIngot: 30, coal: 40 }, out: { machinePart: 5 }, t: 1800 }] },"),
  ("build: { ironIngot: 250, components: 40, copper: 4000 },", "build: { ironIngot: 8000, components: 600, copper: 30e6 },"),
  ("in: { copperIngot: 20, ironIngot: 20, rareEarth: 2 }, out: { alloy: 6 }, t: 26 },", "in: { copperIngot: 20, ironIngot: 20, rareEarth: 2 }, out: { alloy: 6 }, t: 2700 },"),
  ("in: { copperIngot: 15, components: 4, rareEarth: 3 }, out: { circuit: 4 }, t: 30 }] },", "in: { copperIngot: 15, components: 4, rareEarth: 3 }, out: { circuit: 4 }, t: 3600 }] },"),
  ("build: { machinePart: 50, alloy: 25, iron: 10000 },", "build: { machinePart: 800, alloy: 200, iron: 20e6 },"),
  ("out: { henium: 10 }, t: 36 }] },", "out: { henium: 10 }, t: 3600 }] },"),
  ("build: { stone: 1500 },\n    recipes: [{ id: 'feed', name: 'Mill FEED', in: { crushedOre: 40, stone: 80 }, out: { feed: 2 }, t: 30 }] },",
   "build: { stone: 500e3 },\n    recipes: [{ id: 'feed', name: 'Mill FEED', in: { crushedOre: 40, stone: 80 }, out: { feed: 2 }, t: 1800 }] },"),
]:
    sub(a, b)
s = re.sub(r"D\.factoryUpCost = \(f, lv\) => \{.*?\n\};\nD\.buildTime = .*?\n",
"""D.factoryUpCost = (f, lv) => { // lv -> lv+1: ores ×2.1 a level, materials ×1.6, and better materials from Lv. 2 on
  const c = {};
  for (const r in f.build) c[r] = Math.ceil(f.build[r] * pow(D.res[r].cat === 'raw' ? 2.1 : 1.6, lv));
  const need = (r, v) => { c[r] = Math.max(c[r] || 0, Math.ceil(v)); };
  if (lv >= 2) need('components', 200 * pow(1.5, lv - 2));
  if (lv >= 4) need('machinePart', 150 * pow(1.5, lv - 4));
  if (lv >= 5) need('henium', 10 * pow(1.7, lv - 5));
  if (lv >= 6) need('alloy', 150 * pow(1.5, lv - 6));
  if (lv >= 8) need('circuit', 60 * pow(1.5, lv - 8));
  return c;
};
D.buildTime = (lv) => Math.round(300 * pow(2.3, lv - 1)); // real time to build level lv: 5 min, 12 min, 26 min … Lv. 10 ≈ 6 days
""", s, count=1, flags=re.S)
assert 'pow(2.3, lv - 1)' in s

# ---- machines: real-time crafts, costs and coal use ----
for a, b in [
  ("energy: 240,  wear: 2.6, cap: 120,  t: 15,\n    cost: { stone: 600, copper: 60, coal: 150 } },",
   "energy: 5000,  wear: 2.6, cap: 120,  t: 600,\n    cost: { stone: 200e3, copper: 5000, coal: 50e3 } },"),
  ("energy: 520,  wear: 2.2, cap: 260,  t: 30,\n    cost: { copperIngot: 40, ironIngot: 30, coal: 400 } },",
   "energy: 12000, wear: 2.2, cap: 260,  t: 3600,\n    cost: { copperIngot: 2000, ironIngot: 1500, coal: 2e6 } },"),
  ("energy: 1000, wear: 1.8, cap: 500,  t: 60,\n    cost: { stone: 1500, coal: 800, copper: 500, iron: 1000, rareEarth: 25, machinePart: 10 } },",
   "energy: 30000, wear: 1.8, cap: 500,  t: 14400,\n    cost: { stone: 30e6, coal: 10e6, copper: 2e6, iron: 1e6, rareEarth: 2000, machinePart: 150 } },"),
  ("energy: 700,  wear: 1.4, cap: 200,  t: 75, rare: 0.06,\n    cost: { circuit: 12, alloy: 10, copperIngot: 120 } },",
   "energy: 20000, wear: 1.4, cap: 200,  t: 28800, rare: 0.06,\n    cost: { circuit: 120, alloy: 150, copperIngot: 10e3 } },"),
  ("energy: 2000, wear: 1.2, cap: 1500, t: 110,\n    cost: { machinePart: 60, components: 60, alloy: 30 } },",
   "energy: 60000, wear: 1.2, cap: 1500, t: 57600,\n    cost: { machinePart: 600, components: 1200, alloy: 400 } },"),
  ("energy: 3000, wear: 1.0, cap: 900,  t: 160,", "energy: 100000, wear: 1.0, cap: 900,  t: 129600,"),
  ("cost: { circuit: 40, alloy: 60, heniumOre: 2000, henium: 120 } },", "cost: { circuit: 300, alloy: 800, heniumOre: 3e6, henium: 120 } },"),
]:
    sub(a, b)
sub("D.machineUpCost = (m, lv) => { const i = D.machines.indexOf(m); const c = { machinePart: Math.ceil(3 * lv * (1 + i * 0.6)), ironIngot: Math.ceil(20 * lv * (1 + i * 0.4)) }; if (lv >= 5) c.alloy = Math.ceil(2 * (lv - 3) * (1 + i * 0.5)); return c; };",
    "D.machineUpCost = (m, lv) => { const i = D.machines.indexOf(m); const c = { machinePart: Math.ceil(30 * lv * (1 + i * 0.6)), ironIngot: Math.ceil(300 * lv * (1 + i * 0.4)) }; if (lv >= 5) c.alloy = Math.ceil(20 * (lv - 3) * (1 + i * 0.5)); return c; };")
sub("D.machineServiceCost = (dur) => { const miss = 100 - dur; return { machinePart: Math.max(1, Math.ceil(miss / 25)), coal: Math.ceil(miss * 12) }; };",
    "D.machineServiceCost = (dur) => { const miss = 100 - dur; return { machinePart: Math.max(1, Math.ceil(miss / 10)), coal: Math.ceil(miss * 20000) }; };")

# ---- the farm: a farm day is a real day (1 EGG per Chikn per day, like the NFTs) ----
sub("  day: 300,                                   // seconds per farm day in this prototype (the real game would use 86,400)",
    "  day: 86400,                                 // a farm day is a real day: each Chikn lays about 1 EGG a day")
sub("coopCost: (lv) => ({ stone: Math.ceil(2000 * pow(2.1, lv - 1)), copper: Math.ceil(400 * pow(2.1, lv - 1)), egg: Math.ceil(20 * pow(1.8, lv - 1)) }),",
    "coopCost: (lv) => ({ stone: Math.ceil(2e6 * pow(2.1, lv - 1)), copper: Math.ceil(4e5 * pow(2.1, lv - 1)), egg: Math.ceil(20 * pow(1.8, lv - 1)) }),")

# ---- season: odd levels pay an ore & material bundle for YOUR depth (not the season level) ----
sub("""D.seasonReward = (lv) => {
  if (lv === D.seasonMax) return { chikn: 'mythic' };
  if (lv % 10 === 0) return { chikn: 'legendary' };
  if (lv % 5 === 0) return { henium: 3 + Math.floor(lv / 5) };
  return lv % 2 ? D.bundle(lv, 0.25) : { feed: Math.ceil(lv / 3) };
};""", """D.seasonReward = (lv, depth) => {
  if (lv === D.seasonMax) return { chikn: 'mythic' };
  if (lv % 10 === 0) return { chikn: 'legendary' };
  if (lv % 5 === 0) return { henium: 3 + Math.floor(lv / 5) };
  return lv % 2 ? D.bundle(depth || lv, 0.15) : { feed: Math.ceil(lv / 3) };
};""")

# ---- market reference prices: components and machine parts were worth less than their inputs ----
sub("crushedOre: 0.0009, copperIngot: 0.012, ironIngot: 0.018, components: 0.07, machinePart: 0.11, alloy: 0.16, circuit: 0.28 };",
    "crushedOre: 0.0009, copperIngot: 0.012, ironIngot: 0.018, components: 0.1, machinePart: 0.14, alloy: 0.16, circuit: 0.28 };")

# ---- HENIUM: the same schedule as the HeniumEmission contract. 7,200 a day for the whole world, halving every 1,458 days
# (≈ 4 years, like bitcoin: 10.5M in the first epoch, never more than 21M), counted from the game's launch ----
s = re.sub(r"// HENIUM works like bitcoin:.*?\n\};\nD\.refPower", """// HENIUM works like bitcoin, on the same schedule as the HeniumEmission contract: the whole world can mint 7,200 a day,
// halving every 1,458 days (≈ 4 years): 10.5M in the first epoch and never more than 21M. The clock starts at launch.
D.supply = {
  cap: 21e6, daily: 7200, halvingDays: 1458, genesis: Date.UTC(2026, 10, 1),
  split: { refinery: 0.7, war: 0.2, boss: 0.1 },  // refiners, guild-war fighters, monster hunters
  worldPower0: 6700,        // refinery power of all other players at launch (a Lv. 1 refinery earns ~5 HENIUM a day)
  worldGrowth: 0.004,       // the world builds ~0.4% more refinery power every day
  worldWar0: 600e3,         // war points of all other guild fighters
  worldHunt0: 25e3,         // hunt points of all other monster hunters
};
// HENIUM minted by the whole world after `days` days (closed form per epoch, like the contract's cumulativeEmission)
D.cumEmission = (days) => {
  const H = D.supply.halvingDays, e = Math.floor(Math.max(0, days) / H);
  const full = D.supply.daily * H * 2 * (1 - Math.pow(0.5, e));
  return Math.min(D.supply.cap, full + (Math.max(0, days) - e * H) * D.supply.daily * Math.pow(0.5, e));
};
D.supply.halvings = Array.from({ length: 6 }, (_, i) => D.cumEmission((i + 1) * D.supply.halvingDays)); // world supply at each halving
D.refPower""", s, count=1, flags=re.S)
assert 'D.cumEmission' in s

# ---- guild, expeditions, battles, events: real time and real-time-sized rewards ----
for a, b in [
  ("{ res: 'stone', amt: 2000, pts: 20 }, { res: 'coal', amt: 1000, pts: 22 }, { res: 'copperIngot', amt: 100, pts: 40 },",
   "{ res: 'stone', amt: 2e6, pts: 20 }, { res: 'coal', amt: 1e6, pts: 22 }, { res: 'copperIngot', amt: 500, pts: 40 },"),
  ("{ res: 'ironIngot', amt: 100, pts: 55 },", "{ res: 'ironIngot', amt: 500, pts: 55 },"),
  ("alloy: Math.ceil(8 * pow(1.6, lv)),", "alloy: Math.ceil(80 * pow(1.6, lv)),"),
  ("t: 60,  slots: 1, lv: 1,  x: 49, y: 44,\n    r: { stone: [500, 1100], coal: [120, 320], crushedOre: [40, 120] } },",
   "t: 1800,  slots: 1, lv: 1,  x: 49, y: 44,\n    r: { stone: [200e3, 500e3], coal: [50e3, 150e3], crushedOre: [10e3, 30e3] } },"),
  ("t: 150, slots: 2, lv: 5,  x: 9,  y: 49,\n    r: { copper: [200, 500], iron: [150, 380], rareEarth: [2, 6], copperIngot: [6, 16] } },",
   "t: 7200, slots: 2, lv: 5,  x: 9,  y: 49,\n    r: { copper: [100e3, 300e3], iron: [80e3, 200e3], rareEarth: [50, 150], copperIngot: [300, 800] } },"),
  ("t: 240, slots: 2, lv: 11, x: 62, y: 70,\n    r: { coal: [900, 2200], ironIngot: [30, 80], machinePart: [2, 6], components: [3, 8] } },",
   "t: 14400, slots: 2, lv: 11, x: 62, y: 70,\n    r: { coal: [1e6, 3e6], ironIngot: [1000, 3000], machinePart: [20, 60], components: [30, 90] } },"),
  ("t: 300, slots: 3, lv: 17, x: 90, y: 45,\n    r: { heniumOre: [80, 200], rareEarth: [6, 16], henium: [1, 2] } },",
   "t: 28800, slots: 3, lv: 17, x: 90, y: 45,\n    r: { heniumOre: [50e3, 150e3], rareEarth: [200, 600], henium: [1, 2] } },"),
  ("t: 480, slots: 3, lv: 24, x: 67, y: 24,\n    r: { henium: [2, 6], alloy: [6, 16], circuit: [3, 8], machinePart: [8, 20] } },",
   "t: 43200, slots: 3, lv: 24, x: 67, y: 24,\n    r: { henium: [2, 6], alloy: [50, 150], circuit: [15, 40], machinePart: [100, 250] } },"),
  ("t: 120, slots: 2, lv: 1, x: 84, y: 76,\n  r: { heniumOre: [150, 320], rareEarth: [4, 10], henium: [1, 3] }, event: true };",
   "t: 7200, slots: 2, lv: 1, x: 84, y: 76,\n  r: { heniumOre: [100e3, 300e3], rareEarth: [100, 300], henium: [1, 3] }, event: true };"),
  ("power: 40,    r: { stone: 600, coal: 100 } },", "power: 40,    r: { stone: 600e3, coal: 100e3 } },"),
  ("power: 110,   r: { coal: 600, crushedOre: 150 } },", "power: 110,   r: { coal: 600e3, crushedOre: 15e3 } },"),
  ("power: 240,   r: { copperIngot: 30, copper: 300 } },", "power: 240,   r: { copperIngot: 600, copper: 300e3 } },"),
  ("power: 480,   r: { ironIngot: 60, machinePart: 4, components: 4 } },", "power: 480,   r: { ironIngot: 1200, machinePart: 40, components: 40 } },"),
  ("power: 900,  r: { rareEarth: 10, alloy: 2 }, first: { henium: 15 } },", "power: 900,  r: { rareEarth: 300, alloy: 20 }, first: { henium: 15 } },"),
  ("power: 1600,  r: { heniumOre: 300, alloy: 8 }, first: { henium: 40 } },", "power: 1600,  r: { heniumOre: 300e3, alloy: 80 }, first: { henium: 40 } },"),
  ("power: 2800,  r: { heniumOre: 600, circuit: 8 }, first: { henium: 90 } },", "power: 2800,  r: { heniumOre: 600e3, circuit: 30 }, first: { henium: 90 } },"),
  ("power: 5000, r: { heniumOre: 1200, alloy: 30 }, first: { henium: 200 } },", "power: 5000, r: { heniumOre: 1.2e6, alloy: 200 }, first: { henium: 200 } },"),
  ("D.pvpTicketTime = 180;", "D.pvpTicketTime = 7200; // a battle ticket refills every 2 hours"),
  ("dur: 600, zone: 'henium', mult: 1.5, minDepth: 18 },", "dur: 36000, zone: 'henium', mult: 1.5, minDepth: 18 },"),
  ("desc: 'Top guilds earn exclusive machines! All mining +20%.', dur: 900, mult: 1.2 },", "desc: 'Top guilds earn exclusive machines! All mining +20%.', dur: 54000, mult: 1.2 },"),
  ("dur: 480, minDepth: 21 },", "dur: 28800, minDepth: 21 },"),
  ("desc: 'Copper Zone output ×2.', dur: 360, zone: 'copper', mult: 2, minDepth: 11 },", "desc: 'Copper Zone output ×2.', dur: 21600, zone: 'copper', mult: 2, minDepth: 11 },"),
  ("desc: 'Fattening Chikns costs 30% less FEED.', dur: 600 },", "desc: 'Fattening Chikns costs 30% less FEED.', dur: 36000 },"),
  ("desc: 'Stone Zone output ×2.', dur: 300, zone: 'stone', mult: 2 },", "desc: 'Stone Zone output ×2.', dur: 18000, zone: 'stone', mult: 2 },"),
  ("  collapse: { sec: 90, stone: (d) => Math.round(150 + d * 45) },", "  collapse: { sec: 90, stone: (d) => Math.round(D.digCost(Math.max(5, d)).stone * 0.002) },"),
  ("  liveGap: [150, 300], seasonDays: 30,", "  liveGap: [6 * 3600, 14 * 3600], seasonDays: 30,"),
  ("  levelFeed: (lv) => 2 + Math.floor(lv / 5),        // FEED paid at every player level-up (systems.js 'levelUp')",
   "  levelFeed: (lv) => 1 + Math.floor(lv / 10),       // FEED paid at every player level-up (systems.js 'levelUp')"),
  ("  injuredSec: 150,", "  injuredSec: 7200,"),
  ("  rest: { win: 40, lose: 20 },                      // PvE stage cooldown after a fight", "  rest: { win: 1800, lose: 900 },                   // PvE stage cooldown after a fight (seconds)"),
  ("  memberRate: 0.00022, licenseGuildLv: 5,", "  memberRate: 2.3e-6, licenseGuildLv: 5,   "),
]:
    sub(a, b)
# quest rewards were sized for the old fast economy: scale ore & material amounts (HENIUM and FEED stay)
qs, qe = s.index('D.quests = ['), s.index('// Six-month journey')
qpart = s[qs:qe]
def scale_q(m):
    body = m.group(1)
    def one(mm):
        k, v = mm.group(1), float(mm.group(2))
        if k in ('henium', 'feed'): return mm.group(0)
        f = 1000 if k in ('stone', 'coal', 'copper', 'iron', 'heniumOre', 'crushedOre') else 20
        return f"{k}: {int(v * f)}"
    return 'r: { ' + re.sub(r"(\w+): (\d+(?:\.\d+)?)", one, body) + ' }'
qpart = re.sub(r"r: \{ ([^}]*) \}", scale_q, qpart)
s = s[:qs] + qpart + s[qe:]
open(p, 'w').write(s)
print('data.js: real-time economy written')
