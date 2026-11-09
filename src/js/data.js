// Static game data and balance formulas. Everything tunable lives here.
window.G = window.G || {};
(() => {
const G = window.G;
const D = G.D = {};
const pow = Math.pow;

// cat: cur = currency, raw = mined, mat = processed material
D.res = {
  egg:         { name: 'EGG',          cat: 'cur', color: '#ffd27a' },
  feed:        { name: 'FEED',         cat: 'cur', color: '#e8c28a' },
  henium:      { name: 'HENIUM',       cat: 'cur', color: '#c77dff', dec: 2 },
  stone:       { name: 'Stone',        cat: 'raw', color: '#c3c8d6' },
  coal:        { name: 'Coal',         cat: 'raw', color: '#7c8296' },
  copper:      { name: 'Copper',       cat: 'raw', color: '#ff9a3c' },
  iron:        { name: 'Iron',         cat: 'raw', color: '#dfe5ef' },
  heniumOre:   { name: 'Henium Ore',   cat: 'raw', color: '#d58bff' },
  rareEarth:   { name: 'Rare Earth',   cat: 'raw', color: '#6fd8ff' },
  crushedOre:  { name: 'Crushed Ore',  cat: 'mat', color: '#b9a99a' },
  copperIngot: { name: 'Copper Ingot', cat: 'mat', color: '#ffad5c' },
  ironIngot:   { name: 'Iron Ingot',   cat: 'mat', color: '#d7dde8' },
  components:  { name: 'Components',   cat: 'mat', color: '#9fb3d1' },
  machinePart: { name: 'Machine Part', cat: 'mat', color: '#8fa1bd' },
  alloy:       { name: 'Alloy',        cat: 'mat', color: '#b98aff' },
  circuit:     { name: 'Circuit',      cat: 'mat', color: '#5fe08a' },
};
D.topRes = ['stone', 'coal', 'copper', 'iron', 'heniumOre', 'rareEarth'];            // mined ores (rates on the Mines screen)
D.barRes = ['stone', 'crushedOre', 'coal', 'copper', 'iron', 'heniumOre', 'rareEarth']; // the top bar: ores + Crushed Ore
D.shortName = { heniumOre: 'H. Ore', crushedOre: 'Crushed', copperIngot: 'Cu Ingot', ironIngot: 'Fe Ingot', machinePart: 'Parts' };

// Mine zones (vertical floors). base = units/sec at floor level 1.
D.zones = [
  { id: 'stone',  name: 'Stone Zone',      short: 'Stone',      res: 'stone',     from: 1,  to: 5,  base: 2.0,  tint: '#7d8399', glow: '#c9cfdf',
    up: { stone: 40 }, dig: 0 },
  { id: 'coal',   name: 'Coal Zone',       short: 'Coal',       res: 'coal',      from: 6,  to: 10, base: 1.5,  tint: '#3c3f4c', glow: '#8b93ad',
    up: { coal: 45, stone: 60 }, dig: 5e6, gate: { factory: 'crusher' } },
  { id: 'copper', name: 'Copper Zone',     short: 'Copper',     res: 'copper',    from: 11, to: 15, base: 1.1,  tint: '#8a4a1c', glow: '#ff9a3c',
    up: { copper: 45, coal: 60 }, dig: 6e6, gate: { factory: 'smelter' } },
  { id: 'iron',   name: 'Iron Zone',       short: 'Iron',       res: 'iron',      from: 16, to: 20, base: 0.9,  tint: '#56607a', glow: '#cfe0ff',
    up: { iron: 45, copperIngot: 4 }, dig: 2e6, gate: { machine: true } },
  { id: 'henium', name: 'Henium Vein',     short: 'Henium',     res: 'heniumOre', from: 21, to: 30, base: 0.32, tint: '#5a1d8f', glow: '#c77dff',
    up: { heniumOre: 18, ironIngot: 6 }, dig: 8e5, gate: { factory: 'forge' } },
  { id: 'rare',   name: 'Rare Earth Zone', short: 'Rare Earth', res: 'rareEarth', from: 31, to: 40, base: 0.07, tint: '#1b4f9e', glow: '#6fd8ff',
    up: { rareEarth: 6, alloy: 2 }, dig: 1.5e5, gate: { factory: 'refinery' } },
  { id: 'core',   name: 'Core Zone',       short: 'Core',       res: 'heniumOre', extra: { rareEarth: 0.18 }, from: 41, to: 50, base: 1.1, tint: '#7a1a8c', glow: '#ff7df0',
    up: { heniumOre: 120, circuit: 3 }, dig: 3e6, gate: { refineryLv: 5, license: true } },
];
D.maxDepth = 50;
D.zoneOf = (d) => D.zones.find((z) => d >= z.from && d <= z.to) || D.zones[D.zones.length - 1];
D.zoneById = (id) => D.zones.find((z) => z.id === id);

// Floor production at a given floor level and dug depth inside the zone.
D.floorRate = (z, lv, dug) => {
  if (lv <= 0) return 0;
  const milestones = [10, 25, 50, 100].filter((m) => lv >= m).length;
  return z.base * lv * (1 + 0.22 * (dug - 1)) * pow(2, milestones);
};
D.floorCost = (z, lv) => { // cost to go from lv -> lv+1; grows 45% a level, so floors keep improving for months
  const k = pow(1.45, lv - 1), c = {};
  for (const r in z.up) c[r] = Math.ceil(z.up[r] * k);
  return c;
};
// Cost to dig from depth d to d+1, sized to the production a player has at that depth (all times are real time).
// The first depths are cheap so the first session ends deeper; after that every dig costs a day or two of output.
D.digCost = (d) => {
  const z = D.zoneOf(d), c = {};
  const early = [200, 1500, 250e3, 3e6];                    // 1→2, 2→3, 3→4, 4→5
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
D.digTime = (d) => { // d = the depth being dug TO (G.act.dig uses D.digTime(depth + 1); D.digCost takes the depth dug FROM)
  const early = [30, 300, 4 * 3600, 12 * 3600];             // 1→2, 2→3, 3→4, 4→5
  return d <= 5 ? early[Math.max(0, d - 2)] : Math.round(86400 * Math.min(8, 1.5 + 0.65 * (d - 5)));
};
// Reward bundle for progress d (a depth; season levels count as depths): k × the dig cost at that depth of the zone's ore
// plus the newest material digging needs there (Stone in the Coal Zone), so rewards grow with you and help the next dig.
// Missions, the season track, hazards and fights pay these. EGG is never a reward: only Chikns lay it.
D.bundle = (d, k) => {
  d = Math.max(1, Math.min(D.maxDepth, Math.round(d) || 1));
  const z = D.zoneOf(d), c = D.digCost(d), out = {};
  const mat = ['circuit', 'alloy', 'machinePart', 'ironIngot', 'copperIngot'].find((r) => c[r]) || 'stone';
  for (const r of [z.res, mat]) if (c[r] && !out[r]) out[r] = Math.max(1, Math.round(c[r] * k));
  return out;
};

// Factories: reqDepth to build; recipes run in the production queue. t = seconds at Lv 1.
D.factories = [
  { id: 'crusher', name: 'Ore Crusher', desc: 'Crushes raw ore', reqDepth: 3, accent: '#f5b800',
    build: { stone: 50e3 },
    recipes: [{ id: 'crush', name: 'Crush Stone', in: { stone: 100 }, out: { crushedOre: 60 }, t: 120 }] },
  { id: 'separator', name: 'Ore Separator', desc: 'Sorts & concentrates', reqDepth: 6, accent: '#7aa7ff',
    build: { stone: 5e6, coal: 50e3 },
    recipes: [{ id: 'separate', name: 'Separate Ore', in: { crushedOre: 120 }, out: { copper: 26, iron: 20, heniumOre: 4, rareEarth: 1 }, t: 300 }] },
  { id: 'smelter', name: 'Smelter', desc: 'Melts ore to ingots', reqDepth: 9, accent: '#ff7a2f',
    build: { stone: 20e6, coal: 3e6 },
    recipes: [
      { id: 'smeltCopper', name: 'Copper Ingot', in: { copper: 60, coal: 30 }, out: { copperIngot: 30 }, t: 600 },
      { id: 'smeltIron', name: 'Iron Ingot', in: { iron: 60, coal: 30 }, out: { ironIngot: 30 }, t: 720 }] },
  { id: 'forge', name: 'Iron Forge', desc: 'Creates components', reqDepth: 14, accent: '#ffb347', upG: 1.8,
    build: { stone: 40e6, copperIngot: 3000, coal: 10e6 },
    recipes: [
      { id: 'gears', name: 'Components', in: { ironIngot: 20, copperIngot: 10 }, out: { components: 6 }, t: 1200 },
      { id: 'parts', name: 'Machine Part', in: { ironIngot: 30, coal: 40 }, out: { machinePart: 5 }, t: 1800 }] },
  { id: 'advanced', name: 'Advanced Factory', desc: 'High-tech assembly', reqDepth: 19, accent: '#5fd0ff', upG: 1.75,
    build: { ironIngot: 8000, components: 600, copper: 30e6 },
    recipes: [
      { id: 'alloy', name: 'Alloy', in: { copperIngot: 20, ironIngot: 20, rareEarth: 2 }, out: { alloy: 6 }, t: 2700 },
      { id: 'circuit', name: 'Circuit', in: { copperIngot: 15, components: 4, rareEarth: 3 }, out: { circuit: 4 }, t: 3600 }] },
  { id: 'refinery', name: 'Henium Refinery', desc: 'Processes Henium ore', reqDepth: 21, accent: '#c77dff', upG: 1.75,
    build: { machinePart: 800, alloy: 200, iron: 20e6 },
    recipes: [{ id: 'refine', name: 'Refine Henium', in: { heniumOre: 100, coal: 200, rareEarth: 4 }, out: { henium: 10 }, t: 3600 }] },
  { id: 'feedmill', name: 'Feed Mill', desc: 'Grinds mineral FEED · daily quota', reqDepth: 4, accent: '#e8c28a',
    build: { stone: 500e3 },
    recipes: [{ id: 'feed', name: 'Mill FEED', in: { crushedOre: 40, stone: 80 }, out: { feed: 2 }, t: 1800 }] },
];
D.factoryById = (id) => D.factories.find((f) => f.id === id);
D.factoryMaxLv = 10;
// lv -> lv+1: ores ×1.9 a level (f.upG for the buildings that cost the deeper ores), materials ×1.5, and better materials
// from Lv. 2 on. Sized so the last levels take weeks of a late-game mine's output, not years (×2.6 made Lv. 10 of the
// Smelter, Forge, Advanced Factory and Refinery cost 1–7 years of ore, and the Forge stuck at Lv. 5 starved everything)
D.factoryUpCost = (f, lv) => {
  const c = {}, k = f.id === 'refinery' ? 1.5 : 1, g = f.upG || 1.9; // the refinery (the HENIUM engine) needs 1.5× the materials
  for (const r in f.build) c[r] = Math.ceil(f.build[r] * (D.res[r].cat === 'raw' ? pow(g, lv) : k * pow(1.5, lv)));
  const need = (r, v) => { c[r] = Math.max(c[r] || 0, Math.ceil(v)); };
  if (lv >= 4) need('components', 200 * pow(1.5, lv - 4));  // Components and Machine Parts come from the Iron Forge (depth 14)
  if (lv >= 5) need('machinePart', 150 * pow(1.5, lv - 5));
  if (lv >= 5) need('henium', 10 * pow(1.7, lv - 5));
  if (f.id === 'refinery') need('henium', 15 * pow(1.8, lv - 1)); // every refinery upgrade costs HENIUM: 15, 27, 49 … 1,700
  if (lv >= 6) need('alloy', 150 * pow(1.5, lv - 6));
  if (lv >= 8) need('circuit', 60 * pow(1.5, lv - 8));
  return c;
};
D.buildTime = (lv) => Math.round(300 * pow(2.5, lv - 1)); // real time to build level lv: 5 min, 12 min, 31 min … Lv. 10 ≈ 13 days
D.tier = (lv) => Math.min(10, Math.max(1, Math.round(lv)));      // every level has its own, richer look (10 per building)
D.hqTier = (depth) => Math.min(10, 1 + Math.floor((depth - 1) / 5)); // HQ gets a new look every 5 depth levels
D.factorySpeed = (lv) => pow(0.9, lv - 1);            // time multiplier
D.factoryYield = (lv) => 1 + 0.15 * (lv - 1);         // output multiplier
// Global factory upgrades (Factory Upgrades panel)
D.fUpgrades = [
  { id: 'eff',    name: 'Efficiency', desc: '+5% factory speed',       max: 6, per: 5,  base: { henium: 4, egg: 3 } },
  { id: 'waste',  name: 'Waste',      desc: '−3% recipe inputs',       max: 5, per: 3,  base: { henium: 6, egg: 5 } },
  { id: 'energy', name: 'Energy Use', desc: '−4% machine coal use',    max: 5, per: 4,  base: { henium: 5, egg: 4 } },
  { id: 'slots',  name: 'Queue Slot', desc: '+1 production queue slot', max: 3, per: 1,  base: { henium: 15, egg: 12 } },
  { id: 'craft',  name: 'Craft Slot', desc: '+1 crafting queue slot',   max: 2, per: 1,  base: { henium: 12, egg: 10 } },
];
D.fUpCost = (u, lv) => { const c = {}; for (const r in u.base) c[r] = Math.ceil(u.base[r] * pow(2.2, lv)); return c; };

// Machines (crafted). lv = player level required. energy = coal/h, wear = %/min, cap = flat ore/h added.
D.machines = [
  { id: 'basic',     name: 'Basic Drill',      lv: 1,  speed: 1.3, energy: 5000,  wear: 2.6, cap: 120,  t: 600,
    cost: { stone: 200e3, copper: 5000, coal: 50e3 } },
  { id: 'improved',  name: 'Improved Drill',   lv: 5,  speed: 1.7, energy: 12000, wear: 2.2, cap: 260,  t: 3600,
    cost: { copperIngot: 2000, ironIngot: 1500, coal: 2e6 } },
  { id: 'heavy',     name: 'Heavy Drill',      lv: 10, speed: 2.5, energy: 30000, wear: 1.8, cap: 500,  t: 14400,
    cost: { stone: 30e6, coal: 10e6, copper: 2e6, iron: 1e6, rareEarth: 2000, machinePart: 150 } },
  { id: 'scanner',   name: 'Deep Scanner',     lv: 16, speed: 1.6, energy: 20000, wear: 1.4, cap: 200,  t: 28800, rare: 0.06,
    cost: { circuit: 120, alloy: 150, copperIngot: 10e3 } },
  { id: 'rig',       name: 'Auto Mining Rig',  lv: 22, speed: 3.2, energy: 60000, wear: 1.2, cap: 1500, t: 57600,
    cost: { machinePart: 600, components: 1200, alloy: 400 } },
  { id: 'extractor', name: 'Henium Extractor', lv: 28, speed: 2.0, energy: 100000, wear: 1.0, cap: 900,  t: 129600,
    zones: ['henium', 'core'], zoneSpeed: 4.5,
    cost: { circuit: 300, alloy: 800, heniumOre: 3e6, henium: 120 } },
];
D.machineById = (id) => D.machines.find((m) => m.id === id);
D.machineMaxLv = 10;
D.machineUpCost = (m, lv) => { const i = D.machines.indexOf(m); const c = { machinePart: Math.ceil(30 * lv * (1 + i * 0.6)), ironIngot: Math.ceil(300 * lv * (1 + i * 0.4)) }; if (lv >= 5) c.alloy = Math.ceil(20 * (lv - 3) * (1 + i * 0.5)); return c; };
// servicing: Coal, plus Machine Parts once you can make them (the Iron Forge opens at depth 14): early drills need Stone instead
D.machineServiceCost = (dur, tier = 3) => { const miss = 100 - dur;
  return tier <= 2 ? { stone: Math.ceil(miss * 30000), coal: Math.ceil(miss * 5000) } : { machinePart: Math.max(1, Math.ceil(miss / 10)), coal: Math.ceil(miss * 20000) }; };
D.machineTier = (type) => { const i = D.machines.findIndex((m) => m.id === type); return i < 0 ? 3 : i + 1; }; // basic 1, improved 2, heavy 3 …

// Chikns
D.roles = {
  miner:     { name: 'Miner',     bonus: 'mine',    label: 'Mining Output',     hat: '#f5b800' },
  engineer:  { name: 'Engineer',  bonus: 'machine', label: 'Machine Speed',     hat: '#3a8dff' },
  operator:  { name: 'Operator',  bonus: 'factory', label: 'Factory Speed',     hat: '#ff8a3d' },
  guardian:  { name: 'Guardian',  bonus: 'battle',  label: 'Battle Power',      hat: '#9aa6bd' },
  leader:    { name: 'Leader',    bonus: 'all',     label: 'All Bonuses',       hat: '#ffcf33' },
  scientist: { name: 'Scientist', bonus: 'refine',  label: 'Refinery Yield',    hat: '#9b5cff' },
  crafter:   { name: 'Crafter',   bonus: 'craft',   label: 'Crafting Speed',    hat: '#c9772f' },
  trader:    { name: 'Trader',    bonus: 'trade',   label: 'DEX Fee Discount',  hat: '#2b2b3a' },
  explorer:  { name: 'Explorer',  bonus: 'explore', label: 'Expedition Loot',   hat: '#5f9e4a' },
  medic:     { name: 'Medic',     bonus: 'safety',  label: 'Hazard Safety',     hat: '#f4f4f8' },
};
D.rarities = [
  { id: 'common',    name: 'Common',    color: '#a3abbd', pct: 5,  kg0: 100, kgMax: 300, power: 10, w: 52 },
  { id: 'uncommon',  name: 'Uncommon',  color: '#46d160', pct: 9,  kg0: 110, kgMax: 380, power: 18, w: 27 },
  { id: 'rare',      name: 'Rare',      color: '#3d9bff', pct: 15, kg0: 120, kgMax: 460, power: 30, w: 13.5 },
  { id: 'epic',      name: 'Epic',      color: '#b456ff', pct: 25, kg0: 135, kgMax: 560, power: 48, w: 5.6 },
  { id: 'legendary', name: 'Legendary', color: '#ffb627', pct: 40, kg0: 150, kgMax: 700, power: 75, w: 1.7 },
  { id: 'mythic',    name: 'Mythic',    color: '#ff4d8d', pct: 60, kg0: 175, kgMax: 900, power: 120, w: 0.2 },
];
D.rarity = (id) => D.rarities.find((r) => r.id === id);
// Chikn NFTs are a fixed collection of 22,000: the game never mints one. You OWN some (c.own: your wallet, bought or won)
// and RENT more from other holders for EGG a day (c.rent). Holders list their own Chikns for rent and earn passive EGG
// while somebody else uses them (c.lease). A rental never changes the NFT: rented Chikns can't be fattened and don't
// lose weight, and a Chikn you rent out comes back exactly as it left.
D.nftSupply = 22000;
D.rent = {
  days: [1, 3, 7, 30],                                    // rental lengths
  disc: { 1: 1, 3: 0.95, 7: 0.9, 30: 0.8 },               // price per day by length: longer rentals are cheaper per day
  base: { common: 0.6, uncommon: 0.75, rare: 0.95, epic: 1.3, legendary: 2, mythic: 3.2 }, // fair EGG a day at start weight
  fee: 0.1,                                               // market fee on every rent: burned
  offers: 6,                                              // offers on the rental market; new ones every farm day
  weights: [52, 27, 13.5, 5.6, 1.7, 0.2],                 // rarity mix of the offers
  heavy: 0.5,                                             // offered Chikns weigh between start weight and halfway to max
  wait: 2 * 3600,                                         // average wait for a renter when you list at the market price
  elastic: 3,                                             // the wait grows with (your price ÷ market price)^elastic
  priceK: [0.8, 1, 1.2, 1.5],                             // price choices when you list a Chikn: −20%, market, +20%, +50%
  free: { rarity: 'uncommon', role: 'miner', days: 7 },   // a new player's first rental is free
};
D.rentPrice = (rarity, kg) => D.rent.base[rarity] * Math.pow(kg / D.rarity(rarity).kg0, 0.6); // fair EGG a day
D.rentCost = (price, days) => Math.max(1, Math.ceil(price * days * (D.rent.disc[days] || 1)));  // whole EGG for a rental
D.buyNft = { name: 'Buy a Chikn NFT', cost: { henium: 60 }, weights: [0, 0, 70, 22, 7, 1] }; // from another holder: Rare+
D.chiknMaxLv = 30;
D.names = ['Clucky', 'Nugget', 'Henrietta', 'Pecky', 'Drumstick', 'Goldie', 'Feathers', 'Rocky', 'Sparky', 'Ruby', 'Pip', 'Biscuit',
  'Waffles', 'Scramble', 'Omelette', 'Yolko', 'Sunny', 'Pebbles', 'Cobalt', 'Ember', 'Gizmo', 'Dusty', 'Tinker', 'Boomer', 'Coco',
  'Maple', 'Juniper', 'Ziggy', 'Blaze', 'Flint', 'Quartz', 'Nova', 'Bolt', 'Crumble', 'Mocha', 'Hazel', 'Rusty', 'Opal'];
D.squadSlots = (lv) => 3 + (lv >= 15 ? 1 : 0) + (lv >= 30 ? 1 : 0);

// Egg farm: every Chikn lays about 1 EGG per day; heavier Chikns lay more (with diminishing returns).
// Chikns eat FEED every day to keep their weight; without FEED they slowly lose weight.
D.farm = {
  day: 86400,                                 // a farm day is a real day: each Chikn lays about 1 EGG a day
  eggsAt: (kg) => Math.pow(kg / 100, 0.6),    // eggs per day: 100kg = 1, 200kg = 1.5, 400kg = 2.3, 800kg = 3.5
  upkeep: (kg) => kg / 200,                   // FEED eaten per day: 100kg = 0.5
  hunger: 0.02,                               // share of extra weight lost per hungry day
  feedPerKg: (kg) => 0.5 * kg / 100,          // FEED needed per extra kg at this weight
  step: 10,                                   // kg added by one feeding
  nestDays: 2,                                // the nest holds this many days of eggs
  coop: (lv) => 6 + 3 * (lv - 1),             // how many Chikns the coop houses
  coopMax: 10,
  coopCost: (lv) => ({ stone: Math.ceil(2e6 * pow(2.1, lv - 1)), copper: Math.ceil(4e5 * pow(2.1, lv - 1)), egg: Math.ceil(20 * pow(1.8, lv - 1)) }),
  millQuota: (lv) => 4 + 3 * (lv - 1),        // FEED the Feed Mill may grind per day (your share of the world pool)
};

// Player progression
D.xpNeed = (lv) => 140 + 180 * lv;       // 5,000 at Lv. 27 (matches the mockup)
D.seasonNeed = (lv) => 950 + 150 * lv;
D.seasonMax = 40;
// odd levels: an ore & material bundle as if the season level were your depth; even levels: a little FEED
D.seasonReward = (lv, depth) => {
  if (lv === D.seasonMax) return { chikn: 'mythic' };
  if (lv % 10 === 0) return { chikn: 'legendary' };
  if (lv % 5 === 0) return { henium: 3 + Math.floor(lv / 5) };
  return lv % 2 ? D.bundle(depth || lv, 0.15) : { feed: Math.ceil(lv / 3) };
};
D.specs = [
  { id: 'miner',  name: 'Miner',        desc: '+15% resource yield from every floor.' },
  { id: 'indus',  name: 'Industrialist', desc: '+15% factory speed and +10% factory output.' },
  { id: 'trader', name: 'Trader',       desc: 'DEX swap fees halved (stacks with Trader Chikns).' },
  { id: 'explor', name: 'Explorer',     desc: '+30% expedition loot and fewer injuries.' },
  { id: 'cmdr',   name: 'Commander',    desc: '+25% squad battle power and raid defense.' },
  { id: 'farmer', name: 'Egg Farmer',   desc: 'Chikns need 20% less FEED per kg, can grow 25% heavier, and the nest holds twice as many eggs.' },
  { id: 'gleader', name: 'Guild Leader', desc: '+25% guild contribution points and project rewards.' },
];

// Market: base prices in HENIUM. Prices drift around these.
D.market = { stone: 0.0004, coal: 0.001, copper: 0.0025, iron: 0.0032, heniumOre: 0.06, rareEarth: 0.095,
  crushedOre: 0.0009, copperIngot: 0.012, ironIngot: 0.018, components: 0.1, machinePart: 0.14, alloy: 0.16, circuit: 0.28 };
D.buySpread = 0.03;   // buyers pay 3% over the market price
D.sellFee = 0.02;     // sellers pay a 2% fee, half of it is burned
D.priceBand = 0.15;   // prices stay within ±15% of the reference price
D.exchange = { eggPerHenium: 5, eggPerFeed: 2 }; // EGG can only be burned for FEED (EGG → HENIUM goes through the DEX); nothing mints EGG

// HENIUM works like bitcoin, on the same schedule as the HeniumEmission contract: the whole world can mint 7,200 a day,
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
D.refPower = (lv) => (lv > 0 ? Math.round(10 * pow(1.6, lv - 1)) : 0); // refinery power by level

// Guild
D.guildProjects = [
  { name: 'Expansion Shaft',  need: 1200,  bonus: 10 },
  { name: 'Ore Rail Network', need: 2600,  bonus: 8 },
  { name: 'Deep Core Lift',   need: 5200,  bonus: 8 },
  { name: 'Henium Beacon',    need: 9800,  bonus: 10 },
  { name: 'Guild Citadel',    need: 18000, bonus: 12 },
];
D.donations = [ // pts per unit
  { res: 'stone', amt: 2e6, pts: 20 }, { res: 'coal', amt: 1e6, pts: 22 }, { res: 'copperIngot', amt: 500, pts: 40 },
  { res: 'ironIngot', amt: 500, pts: 55 }, { res: 'egg', amt: 5, pts: 45 }, { res: 'henium', amt: 10, pts: 110 },
];
D.guildZoneCost = (lv) => ({ henium: Math.ceil(20 * pow(1.8, lv)), alloy: Math.ceil(80 * pow(1.6, lv)), egg: Math.ceil(10 * pow(1.7, lv)) });
D.licenseCost = { henium: 250, egg: 60 };
D.rivals = ['Crystal Claws', 'Deep Diggers', 'Golden Yolks', 'Ember Hens', 'Rock Raiders', 'Coop Kings', 'Feather Forge', 'Quartz Quackers'];

// Expeditions. r = [min,max] rewards (ores & materials; never EGG); risk = injury chance per chikn.
D.expeditions = [
  { id: 'shaft',  name: 'Abandoned Shaft',     risk: 0.05, riskName: 'Low',     t: 1800,  slots: 1, lv: 1,  x: 49, y: 44,
    r: { stone: [200e3, 500e3], coal: [50e3, 150e3], crushedOre: [10e3, 30e3] } },
  { id: 'cavern', name: 'Crystal Cavern',      risk: 0.12, riskName: 'Medium',  t: 7200, slots: 2, lv: 5,  x: 9,  y: 49,
    r: { copper: [100e3, 300e3], iron: [80e3, 200e3], rareEarth: [50, 150], copperIngot: [300, 800] } },
  { id: 'lava',   name: 'Lava Tubes',          risk: 0.2,  riskName: 'High',    t: 14400, slots: 2, lv: 11, x: 62, y: 70,
    r: { coal: [1e6, 3e6], ironIngot: [1000, 3000], machinePart: [20, 60], components: [30, 90] } },
  { id: 'field',  name: 'Henium Field',        risk: 0.24, riskName: 'High',    t: 28800, slots: 3, lv: 17, x: 90, y: 45,
    r: { heniumOre: [50e3, 150e3], rareEarth: [200, 600], henium: [1, 2] } },
  { id: 'ruins',  name: 'Ancient Chikn Ruins', risk: 0.34, riskName: 'Extreme', t: 43200, slots: 3, lv: 24, x: 67, y: 24,
    r: { henium: [2, 6], alloy: [50, 150], circuit: [15, 40], machinePart: [100, 250] } },
];
D.veinExpedition = { id: 'vein', name: 'Henium Vein (Depth 29)', risk: 0.18, riskName: 'Medium', t: 7200, slots: 2, lv: 1, x: 84, y: 76,
  r: { heniumOre: [100e3, 300e3], rareEarth: [100, 300], henium: [1, 3] }, event: true };

// Battle: PvE stages (power = enemy power). r = loot per win (ores & materials; never EGG), first = one-time bounty.
D.stages = [
  { name: 'Cave Bats',         mon: 'bat',    power: 40,    r: { stone: 600e3, coal: 100e3 } },
  { name: 'Coal Beast',        mon: 'beast',  power: 110,   r: { coal: 600e3, crushedOre: 15e3 } },
  { name: 'Copper Crab',       mon: 'crab',   power: 240,   r: { copperIngot: 600, copper: 300e3 } },
  { name: 'Iron Golem',        mon: 'golem',  power: 480,   r: { ironIngot: 1200, machinePart: 40, components: 40 } },
  { name: 'Crystal Spider',    mon: 'spider', power: 900,  r: { rareEarth: 300, alloy: 20 }, first: { henium: 15 } },
  { name: 'Henium Golem',      mon: 'hgolem', power: 1600,  r: { heniumOre: 300e3, alloy: 80 }, first: { henium: 40 } },
  { name: 'Core Wraith',       mon: 'wraith', power: 2800,  r: { heniumOre: 600e3, circuit: 30 }, first: { henium: 90 } },
  { name: 'Ancient Rock King', mon: 'king',   power: 5000, r: { heniumOre: 1.2e6, alloy: 200 }, first: { henium: 200 } },
];
D.pvpTicketTime = 7200; // a battle ticket refills every 2 hours
D.pvpTickets = 3;

// Daily missions: the target n scales with player level, the reward r(depth) with your depth (an ore & material
// bundle, see D.bundle). Only three missions pay FEED (3 + 2 + 1), so they add at most 6 FEED a day.
D.missions = [
  { id: 'mine',     text: (n) => `Mine ${G.fmt(n)} ore`,       stat: 'mined',     n: (lv) => Math.max(500, Math.round(lv * 200 / 100) * 100), r: (d) => D.bundle(d, 0.1) },
  { id: 'process',  text: (n) => `Process ${G.fmt(n)} ore`,    stat: 'processed', n: (lv) => Math.max(200, Math.round(lv * 80 / 50) * 50),    r: (d) => ({ ...D.bundle(d, 0.06), feed: 3 }) },
  { id: 'craft',    text: () => 'Craft 1 machine',             stat: 'crafted',   n: () => 1, r: (d) => ({ ...D.bundle(d, 0.1), feed: 2 }) },
  { id: 'battle',   text: (n) => `Win ${n} battles`,           stat: 'wins',      n: () => 2, r: (d) => D.bundle(d, 0.12) },
  { id: 'exp',      text: () => 'Complete 1 expedition',       stat: 'exps',      n: () => 1, r: (d) => ({ ...D.bundle(d, 0.08), feed: 1 }) },
  { id: 'upgrade',  text: (n) => `Upgrade floors ${n} times`,  stat: 'upgrades',  n: () => 5, r: (d) => D.bundle(d, 0.08) },
  { id: 'tap',      text: (n) => `Tap the mine ${n} times`,    stat: 'taps',      n: () => 40, r: (d) => D.bundle(d, 0.05) },
];

// Story quests (shown three at a time). p(S) -> [current, target]. Rewards: ores & materials for the next steps, a
// little FEED and, at the big milestones, HENIUM (paid out of the world's emission like every HENIUM reward). Never EGG.
const built = (S, id) => (S.factories[id] && S.factories[id].lv > 0 ? 1 : 0);
D.quests = [
  { id: 'tap10',     text: 'Tap the Stone Zone 10 times',  p: (S) => [S.stats.taps, 10],              r: { stone: 150000 } },
  { id: 'stone3',    text: 'Upgrade Stone Zone to Lv. 3',  p: (S) => [S.zones.stone.lv, 3],          r: { stone: 300000 } },
  { id: 'depth3',    text: 'Dig to depth 3',               p: (S) => [S.depth, 3],                    r: { stone: 400000, feed: 4 } },
  { id: 'hire1',     text: 'Rent your first Chikn',        p: (S) => [S.stats.hired, 1],              r: { feed: 5 } },
  { id: 'crusher',   text: 'Build the Ore Crusher',        p: (S) => [built(S, 'crusher'), 1],        r: { stone: 800000 } },
  { id: 'depth6',    text: 'Reach the Coal Zone (depth 6)', p: (S) => [S.depth, 6],                   r: { henium: 3 } },
  { id: 'process300', text: 'Process 300 ore in factories', p: (S) => [S.stats.processed, 300],       r: { crushedOre: 200000, coal: 300000 } },
  { id: 'separator', text: 'Build the Ore Separator',      p: (S) => [built(S, 'separator'), 1],      r: { coal: 500000, feed: 5 } },
  { id: 'smelter',   text: 'Build the Smelter',            p: (S) => [built(S, 'smelter'), 1],        r: { copper: 300000, coal: 600000 } },
  { id: 'drill',     text: 'Craft a Basic Drill',          p: (S) => [S.stats.crafted, 1],            r: { copperIngot: 400, coal: 600000 } },
  { id: 'deploy',    text: 'Deploy a machine on a floor',  p: (S) => [S.machines.some((m) => m.zone) ? 1 : 0, 1], r: { coal: 1000000, feed: 5 } },
  { id: 'depth11',   text: 'Reach the Copper Zone (depth 11)', p: (S) => [S.depth, 11],               r: { henium: 5 } },
  { id: 'ingots',    text: 'Smelt 150 ingots',             p: (S) => [S.stats.ingots, 150],           r: { copperIngot: 800, ironIngot: 600 } },
  { id: 'battle1',   text: 'Win your first battle',        p: (S) => [S.stats.wins, 1],               r: { ironIngot: 800, copper: 800000 } },
  { id: 'forge',     text: 'Build the Iron Forge',         p: (S) => [built(S, 'forge'), 1],          r: { ironIngot: 1200, feed: 6 } },
  { id: 'exp1',      text: 'Complete an expedition',       p: (S) => [S.stats.exps, 1],               r: { components: 200, iron: 1000000 } },
  { id: 'depth16',   text: 'Reach the Iron Zone (depth 16)', p: (S) => [S.depth, 16],                 r: { henium: 8 } },
  { id: 'guild1',    text: 'Contribute to the guild project', p: (S) => [S.guild.contrib > 0 ? 1 : 0, 1], r: { machinePart: 160, ironIngot: 1200 } },
  { id: 'advanced',  text: 'Build the Advanced Factory',   p: (S) => [built(S, 'advanced'), 1],       r: { henium: 10 } },
  { id: 'depth21',   text: 'Reach the Henium Vein (depth 21)', p: (S) => [S.depth, 21],               r: { henium: 12 } },
  { id: 'refinery',  text: 'Build the Henium Refinery',    p: (S) => [built(S, 'refinery'), 1],       r: { heniumOre: 800000, coal: 3000000, rareEarth: 800 } },
  { id: 'refine100', text: 'Refine 100 Henium',            p: (S) => [Math.floor(S.stats.refined), 100], r: { henium: 25 } },
  { id: 'heavy',     text: 'Craft a Heavy Drill',          p: (S) => [S.machines.some((m) => m.type === 'heavy') ? 1 : 0, 1], r: { machinePart: 500, feed: 8 } },
  { id: 'depth30',   text: 'Reach depth 30',               p: (S) => [S.depth, 30],                   r: { henium: 40 } },
  { id: 'license',   text: 'Buy a Guild License',          p: (S) => [S.guild.license ? 1 : 0, 1],    r: { alloy: 800, circuit: 300 } },
  { id: 'ref5',      text: 'Upgrade the Refinery to Lv. 5', p: (S) => [S.factories.refinery.lv, 5],    r: { henium: 60 } },
  { id: 'depth41',   text: 'Break into the Core Zone (depth 41)', p: (S) => [S.depth, 41],            r: { henium: 100 } },
  { id: 'depth50',   text: 'Reach depth 50 — Mining Empire!', p: (S) => [S.depth, 50],                r: { henium: 250 } },
];

// Six-month journey from the roadmap
D.journey = [
  { name: 'The Beginning',    goal: 'Stable mine',       items: ['First mines (Depth 1–5)', 'Gather Stone & Coal', 'Build basic buildings', 'Learn core mechanics'], done: (S) => S.depth >= 6, prog: (S) => [S.depth, 6, 'depth'] },
  { name: 'Build & Produce',  goal: 'Active production', items: ['Unlock core factories', 'Start resource production', 'Craft first machines', 'Contribute to your guild'], done: (S) => S.stats.crafted >= 1 && built(S, 'smelter'), prog: (S) => [(S.stats.crafted >= 1 ? 1 : 0) + (built(S, 'smelter') ? 1 : 0), 2, 'of: a crafted machine, the Smelter'] },
  { name: 'Specialize',       goal: 'Specialization',    items: ['Deeper mines (Depth 11–20)', 'Choose a specialization', 'Advanced equipment', 'First large guild project'], done: (S) => !!S.spec && S.depth >= 20, prog: (S) => [Math.min(S.depth, 20), 20, `depth${S.spec ? '' : ' · and choose a specialization'}`] },
  { name: 'Expand Territory', goal: 'Territory control', items: ['Guild competitions (PvE/PvP)', 'Rare Earth production', 'World events & expeditions'], done: (S) => S.guild.warPts >= 300, prog: (S) => [S.guild.warPts, 300, 'war points'] },
  { name: 'The Henium Rush',  goal: 'Henium yield',      items: ['Unlock Henium zones (21–30)', 'Limited Henium vein events', 'Defend against raids', 'Advanced tech'], done: (S) => S.stats.refined >= 500, prog: (S) => [Math.floor(S.stats.refined), 500, 'HENIUM refined'] },
  { name: 'Mining Empire',    goal: 'Empire status',     items: ['Core Zone (Depth 41+)', 'Guild wars & world rankings', 'Max out your buildings', 'Rent out your Chikns'], done: (S) => S.depth >= 50, prog: (S) => [S.depth, 50, 'depth'] },
];

// Live events rotate; hazards pop up at random.
D.liveEvents = [
  { id: 'vein',     name: 'Henium Vein Discovered!', desc: 'Depth 29 — limited quantity. Henium Vein output ×1.5 and a special expedition.', dur: 36000, zone: 'henium', mult: 1.5, minDepth: 21 },
  { id: 'comp',     name: 'Guild Mining Competition', desc: 'All guilds race to mine the most: every floor mines +20% while it lasts.', dur: 54000, mult: 1.2 },
  { id: 'collapse', name: 'Cave Collapse Warning',   desc: 'Increased cave-in risk in depths 21–30!', dur: 28800, minDepth: 21 },
  { id: 'rush',     name: 'Copper Rush',             desc: 'Copper Zone output ×2.', dur: 21600, zone: 'copper', mult: 2, minDepth: 11 },
  { id: 'feast',    name: 'Feed Festival',           desc: 'Fattening Chikns costs 30% less FEED.', dur: 36000 },
  { id: 'stoneday', name: 'Stone Surge',             desc: 'Stone Zone output ×2.', dur: 18000, zone: 'stone', mult: 2 },
];
D.hazards = ['collapse', 'bandits', 'creature', 'richvein', 'supply'];

// Rule numbers the code uses outside the tables above. systems.js, state.js, farm.js and dex.js read them from here and
// the wiki shows them live (view-wiki.js: const RULE = D.rules), so a change here changes the game and its docs.
// Times in seconds; d = the player's depth; loot = an ore & material bundle (D.bundle), never EGG.
D.rules = {
  specLv: 8,                                        // G.act.chooseSpec: player level that unlocks the specialization
  hazardLv: 4, hazardGap: [300, 900], hazardMin: 40, // G.sys.hazardTick: hostile hazards from this player level; gap while playing (s); min. squad power
  collapse: { sec: 90, stone: (d) => Math.round(D.digCost(Math.max(5, d)).stone * 0.002) },
  rich: { sec: 25, mult: 10, taps: 8 },
  supply: { sec: 60, loot: (d) => D.bundle(d, 0.08), feed: (d) => 1 + Math.floor(d / 25) },
  creature: { sec: 60, power: [0.5, 0.9], loot: (d) => D.bundle(d, 0.12), feed: () => 0, hunt: 1, mons: ['bat', 'beast', 'crab', 'spider'] },
  bandits: { sec: 45, power: [0.6, 1.2], toll: (d) => 1 + Math.floor(d / 10), ignore: [0.05, 0.02], lose: [0.08, 0.03], keep: 20,
    gap: 8 * 3600, // at most one raid per 8 h: hazards come every few minutes you play, raids must not scale with time online
    win: { loot: (d) => D.bundle(d, 0.15), henium: 1, hunt: 2 } }, // ignore/lose: [share of the floor's ore, share of your HENIUM]
  medicCap: 0.8, collapseEvent: 0.6,                // Medic cave-in save chance cap; share of cave-ins during a Collapse Warning
  tap: { share: 0.6, base: 1.5, energyMax: 40, regen: 1 / 3 }, // G.tapYield; tapping costs 1 energy, +1 every 3 s
  liveGap: [6 * 3600, 14 * 3600], seasonDays: 30,
  levelFeed: (lv) => 1 + Math.floor(lv / 10),       // FEED paid at every player level-up (systems.js 'levelUp')
  injuredSec: 7200,
  exp: { base: 0.7, per: 0.15, powCap: 0.6, powDiv: 900, feed: 0.15, feedExp: 0.2, feedAmt: [1, 3], riskMin: 0.2, specRisk: 0.6, specLoot: 0.3 },
  rest: { win: 1800, lose: 900 },                   // PvE stage cooldown after a fight (seconds)
  win: { base: 0.5, div: 1.6, min: 0.05, max: 0.97 }, // G.winChance = base + (P − E) ÷ (div × E), clamped to [min, max]
  pveHunt: (i) => i + 1,                            // hunt points for a win on PvE stage i (0-based)
  rivals: { n: 4, power: [0.7, 1.35], min: 60, lv: [3, 9] },
  pvp: { pts: [20, 40], lose: 10, henium: 1, loot: (d) => D.bundle(d, 0.05) },
  warDecay: 0.15, worldWar: 0.003, worldHunt: 0.003, huntKeep: 0.5, // daily: your war points cool, the world's war & hunt points grow
  projHenium: (i) => 5 + 5 * (i + 1),               // G.guildProjectReward: HENIUM paid when guild project i (0-based) completes
  memberRate: 2.3e-6, licenseGuildLv: 5,              // project points guildmates add per second (× need); guild level for the License
  guildZone: { heniumOre: 0.08, rareEarth: 0.05, refine: 0.08 }, // bonus per guild zone level above 1 (ore output, refinery power)
  refund: 0.5, offlineH: 8, hungerFlat: 0.2,        // cancelled started job; offline progress cap (hours); kg a hungry Chikn loses per day
  mm: { noise: 0.04 },                              // dex.js npcRound: the fair-price target is randomised by ±4%
  rotating: ['battle', 'exp', 'upgrade', 'tap'],    // daily missions: one of these joins the fixed ones each day
};

D.chiknLines = ['Deeper we go!', 'Dig deeper!', 'Build factories!', 'Refine Henium!', 'Grow your empire!', 'Bawk! Shiny ore!', 'Henium or bust!', 'Mind the cave-ins!'];
})();
