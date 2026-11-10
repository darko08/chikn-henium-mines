// Core Hopper — all game data: items, buildings, recipes, planets, goals, story and star upgrades.
// A tiny planet has a conveyor belt around it. Every building sits on the belt: it takes what it needs from items
// riding past and puts its own products back on. Mining digs the planet deeper, layer by layer, down to the core.
(() => {
const CH = (window.CH = window.CH || {});
const D = (CH.D = {});

// ---------- items ----------
D.items = {
  stone:       { name: 'Stone',        color: '#a7adbb', kind: 'ore',  shape: 'rock' },
  copperOre:   { name: 'Copper Ore',   color: '#e8834a', kind: 'ore',  shape: 'rock' },
  ironOre:     { name: 'Iron Ore',     color: '#8299c4', kind: 'ore',  shape: 'rock' },
  coal:        { name: 'Coal',         color: '#3b3d4d', kind: 'ore',  shape: 'rock' },
  crystal:     { name: 'Crystal',      color: '#62f2ff', kind: 'ore',  shape: 'gem' },
  brick:       { name: 'Brick',        color: '#cf5b40', kind: 'part', shape: 'brick' },
  copperPlate: { name: 'Copper Plate', color: '#f2a05e', kind: 'part', shape: 'plate' },
  ironPlate:   { name: 'Iron Plate',   color: '#b3c2e0', kind: 'part', shape: 'plate' },
  gear:        { name: 'Gear',         color: '#dfe4ef', kind: 'part', shape: 'gear' },
  wire:        { name: 'Wire',         color: '#ffbd73', kind: 'part', shape: 'coil' },
  circuit:     { name: 'Circuit',      color: '#4fd68f', kind: 'part', shape: 'chip' },
  fuel:        { name: 'Fuel Cell',    color: '#ffd84d', kind: 'part', shape: 'cell' },
};
D.itemOrder = Object.keys(D.items);

// ---------- buildings ----------
// t: seconds per item (drill) or per recipe at Lv. 1; kit: what it costs to craft one in the Workshop
D.buildings = {
  drill: { name: 'Drill', color: '#ffb84d', t: 2.0, kit: { stone: 15 },
    desc: 'Digs ore out of the planet and puts it on the belt. Every piece it mines digs the planet a little deeper.' },
  dock: { name: 'Dock', color: '#62b8ff', kit: { stone: 10 },
    desc: 'Takes items off the belt into your storage. Set it to keep only parts, so ore rides on to your machines.' },
  furnace: { name: 'Furnace', color: '#ff7a45', kit: { stone: 25 },
    desc: 'Bakes Stone into Bricks and smelts ore into plates.',
    recipes: [{ in: { stone: 2 }, out: { brick: 1 }, t: 2.0 }, { in: { copperOre: 1 }, out: { copperPlate: 1 }, t: 1.6 }, { in: { ironOre: 1 }, out: { ironPlate: 1 }, t: 1.6 }] },
  press: { name: 'Press', color: '#9fb2d9', kit: { brick: 15, ironPlate: 10 },
    desc: 'Stamps Iron Plates into Gears and draws Copper Plates into Wire.',
    recipes: [{ in: { ironPlate: 2 }, out: { gear: 1 }, t: 2.0 }, { in: { copperPlate: 1 }, out: { wire: 2 }, t: 1.5 }] },
  assembler: { name: 'Assembler', color: '#3fd0b0', kit: { ironPlate: 20, gear: 10 },
    desc: 'Builds Circuits from Wire and Iron Plates.',
    recipes: [{ in: { wire: 3, ironPlate: 1 }, out: { circuit: 1 }, t: 3.0 }] },
  feeder: { name: 'Feeder', color: '#c58cff', t: 1.0, kit: { brick: 10, gear: 5 },
    desc: 'Puts items from your storage back on the belt, one a second. Pick which item.' },
  refinery: { name: 'Refinery', color: '#ffd84d', kit: { brick: 20, gear: 10, circuit: 5 },
    desc: 'Refines Coal and Crystal into Fuel Cells for the rocket.',
    recipes: [{ in: { coal: 2, crystal: 1 }, out: { fuel: 1 }, t: 3.5 }] },
};
D.buildOrder = ['drill', 'dock', 'furnace', 'press', 'feeder', 'assembler', 'refinery'];
D.maxLv = 5;
D.speed = (lv) => 1 + 0.5 * (lv - 1); // Lv. 5 works three times as fast
D.upCost = (type, lv) => {
  if (lv >= D.maxLv) return null;
  if (type === 'drill') return { brick: 6 * lv, ironPlate: 4 * lv, ...(lv >= 3 ? { gear: 3 * lv } : {}) };
  if (type === 'dock') return { brick: 5 * lv, ...(lv >= 2 ? { ironPlate: 3 * lv } : {}) };
  return { ironPlate: 6 * lv, gear: 3 * lv, ...(lv >= 2 ? { circuit: 2 * (lv - 1) } : {}) };
};
D.dockSpeed = (lv) => 2.5 * D.speed(lv); // items a Dock can take per second

// ---------- the belt ----------
D.belt = { speed: 1.0, gap: 0.22 }; // slots per second; the smallest gap between two items (in slots)

// ---------- planets ----------
const P0 = {
  name: 'Cinder', sub: 'A small rocky world', slots: 12,
  pal: { bg: '#0b0e26', surface: '#8f5c45', crust: '#b0704f', mantle: '#c95a33', deep: '#5d2f80', core: '#ffd36b', belt: '#272b47', glow: '#ff9a5a' },
  layers: [
    { id: 'crust', name: 'Crust', at: 0, ores: ['stone', 'copperOre'] },
    { id: 'mantle', name: 'Mantle', at: 250, ores: ['ironOre', 'coal'] },
    { id: 'deep', name: 'Deep Rock', at: 700, ores: ['crystal'] },
  ],
  core: 1300,
  rocket: [
    { id: 'hull', name: 'Hull', need: { ironPlate: 40, brick: 40 } },
    { id: 'engine', name: 'Engine', need: { gear: 25, circuit: 15 } },
    { id: 'tank', name: 'Fuel tank', need: { fuel: 12 } },
  ],
};
const P1 = {
  name: 'Frost', sub: 'Ice over iron', slots: 14,
  pal: { bg: '#071526', surface: '#7fa9c9', crust: '#9cc6e0', mantle: '#4d78a8', deep: '#2d3f86', core: '#9ff7ff', belt: '#22324a', glow: '#7fe0ff' },
  layers: [
    { id: 'crust', name: 'Ice Crust', at: 0, ores: ['stone', 'ironOre'] },
    { id: 'mantle', name: 'Frozen Mantle', at: 450, ores: ['copperOre', 'coal'] },
    { id: 'deep', name: 'Blue Deep', at: 1250, ores: ['crystal'] },
  ],
  core: 2300,
  rocket: [
    { id: 'hull', name: 'Hull', need: { ironPlate: 80, brick: 60 } },
    { id: 'engine', name: 'Engine', need: { gear: 50, circuit: 30 } },
    { id: 'tank', name: 'Fuel tank', need: { fuel: 25 } },
  ],
};
D.planets = [P0, P1];
const NAMES = ['Bloom', 'Ember', 'Hollow', 'Glass', 'Rust', 'Murmur', 'Halo', 'Ash', 'Velvet', 'Quill'];
const PALS = [
  { bg: '#0d1a12', surface: '#5e9a5a', crust: '#74b56a', mantle: '#8a6a3d', deep: '#5a2f6e', core: '#c8ff7a', belt: '#24352a', glow: '#9cff8a' },
  { bg: '#1a0c0c', surface: '#9b3b2a', crust: '#c4532f', mantle: '#ff7a2f', deep: '#5c1d2e', core: '#ffe08a', belt: '#3a2324', glow: '#ff7a45' },
  { bg: '#0f0f18', surface: '#6b6e86', crust: '#81849e', mantle: '#4b4e68', deep: '#2b2d44', core: '#e6e6ff', belt: '#2a2b3b', glow: '#c9c9ff' },
];
// worlds after the hand-made ones: same rules, bigger numbers
D.planet = (i) => {
  if (i < D.planets.length) return D.planets[i];
  const k = i - D.planets.length + 1, m = Math.pow(1.6, k);
  return {
    name: NAMES[(i - D.planets.length) % NAMES.length], sub: `World ${i + 1}`, slots: Math.min(20, 14 + k),
    pal: PALS[(i - D.planets.length) % PALS.length],
    layers: [
      { id: 'crust', name: 'Crust', at: 0, ores: ['stone', i % 2 ? 'ironOre' : 'copperOre'] },
      { id: 'mantle', name: 'Mantle', at: Math.round(450 * m), ores: [i % 2 ? 'copperOre' : 'ironOre', 'coal'] },
      { id: 'deep', name: 'Deep Rock', at: Math.round(1250 * m), ores: ['crystal'] },
    ],
    core: Math.round(2300 * m),
    rocket: P1.rocket.map((r) => ({ ...r, need: Object.fromEntries(Object.entries(r.need).map(([t, n]) => [t, Math.round(n * m)])) })),
  };
};

// ---------- goals: the guided path on the first world, then the same big steps on every world ----------
const count = (S, t) => S.slots.filter((s) => s && s.t === t).length;
const got = (S, t) => S.got[t] || 0;
const rocketPct = (S) => CH.rocketPct ? CH.rocketPct(S) : 0;
D.goalsFirst = [
  { text: 'Tap the planet to dig by hand', n: 5, p: (S) => S.stats.taps, hint: 'Pip digs a little Stone with every tap.', rew: { stone: 10 } },
  { text: 'Place a Drill on an empty slot', n: 1, p: (S) => count(S, 'drill'), hint: 'Open Build, pick the Drill, then tap a glowing slot on the ring.' },
  { text: 'Place the Dock clockwise after the Drill', n: 1, p: (S) => Object.values(S.got).reduce((a, b) => a + b, 0) - (S.stats.taps || 0) > 0 ? 1 : 0, hint: 'The belt runs clockwise. Put the Dock on a slot clockwise from the Drill: when the ore reaches it, it goes into your storage.', rew: { kit: 'drill' } },
  { text: 'Collect 40 Stone', n: 40, p: (S) => got(S, 'stone'), hint: 'Two Drills dig twice as fast. Craft more in the Workshop.' },
  { text: 'Craft a Furnace and put it between a Drill and the Dock', n: 1, p: (S) => count(S, 'furnace'), hint: 'Workshop → Furnace. It takes Stone from the belt and bakes Bricks.', rew: { stone: 20 } },
  { text: 'Collect 15 Bricks', n: 15, p: (S) => got(S, 'brick'), hint: 'Set the Dock to "Parts only" so Stone rides past it to the Furnace.' },
  { text: 'Dig down to the Mantle', n: 250, p: (S) => S.dug, hint: 'Every piece of ore your Drills mine digs the planet deeper.' },
  { text: 'Collect 20 Iron Plates', n: 20, p: (S) => got(S, 'ironPlate'), hint: 'Tap a Drill to switch it to Iron Ore. The Furnace smelts it into plates.', rew: { brick: 10 } },
  { text: 'Craft a Press and make 15 Gears', n: 15, p: (S) => got(S, 'gear'), hint: 'The Press stamps 2 Iron Plates into a Gear, and Copper Plates into Wire.' },
  { text: 'Make 5 Circuits', n: 5, p: (S) => got(S, 'circuit'), hint: 'The Assembler needs 3 Wire and 1 Iron Plate per Circuit. Mine Copper Ore for the Wire.', rew: { kit: 'drill' } },
  { text: 'Dig down to Deep Rock', n: 700, p: (S) => S.dug, hint: 'More Drills, faster digging. Upgrade them for even more.' },
  { text: 'Make 3 Fuel Cells', n: 3, p: (S) => got(S, 'fuel'), hint: 'The Refinery needs 2 Coal and 1 Crystal per Fuel Cell.' },
  { text: 'Finish the rocket', n: 100, p: rocketPct, hint: 'Open Rocket and deliver parts from your storage.' },
  { text: 'Reach the core and launch', n: 1, p: (S) => (S.launched ? 1 : 0), hint: 'When the core is open and the rocket is ready, launch!' },
];
D.goalsNext = [
  { text: 'Set up your ring', n: 3, p: (S) => S.slots.filter(Boolean).length, hint: 'A Drill, a Furnace and a Dock make a good start.' },
  { text: 'Dig down to the Mantle', n: 1, p: (S) => (S.dug >= CH.P().layers[1].at ? 1 : 0), hint: 'Every piece of ore digs the planet deeper.' },
  { text: 'Dig down to Deep Rock', n: 1, p: (S) => (S.dug >= CH.P().layers[2].at ? 1 : 0), hint: 'Upgrade your Drills to dig faster.' },
  { text: 'Finish the rocket', n: 100, p: rocketPct, hint: 'Open Rocket and deliver parts from your storage.' },
  { text: 'Reach the core and launch', n: 1, p: (S) => (S.launched ? 1 : 0), hint: 'When the core is open and the rocket is ready, launch!' },
];

// ---------- story ----------
// each beat fires once per world; "at" is a dig depth, "on" an event
D.who = { mother: { name: 'Mother', color: '#9fd8ff' }, pip: { name: 'Pip', color: '#ffd36b' }, log: { name: 'Found log', color: '#c9a6ff' } };
D.story = {
  0: [
    { on: 'start', lines: [
      ['mother', 'Pip. Wake up. You have been asleep for a very long time.'],
      ['pip', 'Mother? Why is the sky so dark?'],
      ['mother', 'The stars are going out, one by one. Every small world like this one hides a Star Core in its heart.'],
      ['mother', 'Dig down to it, build a rocket, and bring the core home. One star will shine again.'],
      ['mother', 'Start small. Tap the ground.'],
    ] },
    { on: 'firstDock', lines: [['mother', 'Good. The belt runs clockwise around the whole world. Whatever a building makes rides on to the next one.']] },
    { at: 120, log: 1, lines: [['log', 'A metal tag in the rubble, scratched by hand: "Day 3. The cores are warm, like they are alive. — H."'], ['pip', 'Mother, who is H?'], ['mother', '…Keep digging, Pip.']] },
    { at: 250, lines: [['mother', 'The Mantle. Iron and Coal. Now you can build real machines.']] },
    { at: 500, log: 2, lines: [['log', '"Day 19. Mother says not to listen to the cores. I listen anyway. They all hum the same song." — H.']] },
    { at: 700, lines: [['mother', 'Crystal. It burns brighter than Coal. Your rocket will need it.']] },
    { at: 1000, log: 3, lines: [['log', '"Day 40. I know where the stars went. I am not coming back. Don\'t let her—" The rest is burned away.'], ['pip', 'Don\'t let her… what?'], ['mother', 'Old robots break, Pip. So do their words.']] },
    { on: 'core', lines: [['mother', 'There it is. The Star Core. Once the rocket lifts it out, this world will crumble. Be ready.']] },
    { on: 'launch', lines: [['pip', 'It is… singing.'], ['mother', 'Then the first star shines again. Next world, Pip.']] },
  ],
  1: [
    { on: 'start', lines: [['mother', 'Frost. Ice over iron. The Copper is deeper here, so plan your belt.'], ['pip', 'Mother, the song is louder here.'], ['mother', 'It is the wind, Pip.']] },
    { at: 300, log: 4, lines: [['log', 'Frozen into the ice: "Day 61. She counts the cores. She never says what they are for." — H.']] },
    { at: 1250, lines: [['mother', 'Blue Deep. Careful. Ice remembers.']] },
    { at: 1800, log: 5, lines: [['log', '"Day 77. A star is not a lamp. It is a door." — H.'], ['pip', 'A door to where?']] },
    { on: 'core', lines: [['mother', 'The core. Lift it, Pip. Don\'t listen to it.']] },
    { on: 'launch', lines: [['pip', 'Two stars now.'], ['mother', 'Two doors… two lamps. Two lamps, Pip.']] },
  ],
  more: [
    { on: 'start', lines: [['mother', 'Another world. Same song. Dig, Pip.']] },
    { on: 'core', lines: [['mother', 'The core is open. Launch when you are ready.']] },
    { on: 'launch', lines: [['pip', 'Another star.'], ['mother', 'Another star.']] },
  ],
};

// ---------- the star map: permanent upgrades bought with Star Cores ----------
D.ups = [
  { id: 'headStart', name: 'Head Start', desc: 'Begin every world with 2 extra Drills and a Furnace.', cost: 1 },
  { id: 'quickBelt', name: 'Quick Belt', desc: 'The belt runs 30% faster on every world.', cost: 1 },
  { id: 'longNap', name: 'Long Nap', desc: 'Your factory keeps working for 8 hours while you are away, instead of 3.', cost: 1 },
  { id: 'overclock', name: 'Overclock', desc: 'Every building works 25% faster.', cost: 2 },
  { id: 'wideRing', name: 'Wide Ring', desc: 'Every world has 2 more slots on its ring.', cost: 2 },
];

// ---------- comets: a little loot every few hours ----------
D.comet = { every: [2 * 3600, 4 * 3600], stays: 15 * 60 };

D.fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : String(Math.floor(n)));
D.time = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(x).padStart(2, '0')}s` : `${x}s`; };
})();
