# Chikn Henium Mines — playable prototype

A browser idle / mining-tycoon game built from the Chikn Henium Mines mockups. Everything (code, styles and all
art) is packed into one file: **`dist/chikn-henium-mines.html`** — open it in any modern browser (desktop or phone).
The in-game **Wiki** explains every rule; a standalone copy is built to `dist/chikn-wiki.html`.

## Screens
- **Mines** — tap floors, upgrade them, dig deeper through 7 zones (Stone → Coal → Copper → Iron → Henium Vein →
  Rare Earth → Core). Digging is expensive and takes time; below depth 21 it also costs HENIUM. The surface base
  shows every building in its current look and the headquarters grows every 5 depth levels.
- **Factories** — Ore Crusher → Ore Separator → Smelter → Iron Forge → Advanced Factory → Henium Refinery, plus the
  Feed Mill. Construction and upgrades take time and get much pricier per level. **Every building has 10 looks,
  one per level**, each grander than the last (wood → stone → iron → brass → gold → crystal → legendary palace).
- **Crafting** — six machine tiers; deploy them on floors (they burn Coal and wear down while you play).
- **Chikn NFT** — Chikn NFTs are a fixed collection of 22,000 (never minted in the game): rent Chikns from other
  holders for EGG a day, buy one from another holder, or rent your own out for passive EGG income. 10 roles × 6
  rarities, a Mining Team, and a Chikn's level follows its weight.
- **Farm** — every Chikn lays about 1 EGG per day; fatten them with scarce FEED to lay more (diminishing returns).
  Chikns eat FEED daily to keep their weight. Coop capacity, Feed Mill daily quota, egg nest.
- **Guild**, **Expeditions**, **Battle** (PvE monsters, PvP guild wars), **Events** (Season pass, missions,
  live events, the 6-month journey), random hazards (cave-ins, bandits, creatures, rich veins, supply drops).
- **DEX** — constant-product AMM pools: swap any resource for any other (routed through HENIUM); sell EGG and
  HENIUM for ETH (simulated). A third of every fee is burned.
- **Wiki** — in-game encyclopedia generated from the live game data (tables, formulas, all building looks).

## Tokenomics in one paragraph
EGG is scarce: only Chikns lay it, ~1 per Chikn per day. FEED is scarce: a small daily mill quota, or burned EGG.
HENIUM works like bitcoin: 21M cap, 7,200 a day for the whole world, halving every 1,458 days (~4 years, the same
schedule as the `HeniumEmission` contract in `onchain/`), split 70% to
refiners (by share of world refinery power), 20% to guild-war fighters and 10% to monster hunters. Nothing else mints
HENIUM. It is spent on deep digging, high building levels, buying Chikn NFTs, the guild license and speed-ups, and burned
on every DEX trade — so it gets scarcer and more valuable over time.

## Prototype notes
- HENIUM, EGG, FEED, ETH, NFTs, other players, guilds and the DEX liquidity are **simulated locally** — no blockchain,
  wallet or server, no real money. A real version needs smart contracts, audits and legal review, and permission
  from the owners of the Chikn brand.
- Everything runs in **real time**: a farm day is 24 hours, factory jobs take minutes to hours, upgrades minutes to
  two weeks, and deep digs about a week. Away from the game, floors mine for up to 8 hours; factories, construction,
  digs, the farm and the daily HENIUM payouts keep running for up to 60 days. A realistic player reaches the Henium
  Vein (depth 21) after ~3 months and the Core Zone (depth 41) after ~5–6 months (`tools/journey-sim.cjs`).
- Art was generated with Runway from the mockups (sheets in `assets/raw`, cut sprites in `assets/sprites`,
  optimised WebP in `assets/web`).
- Settings → **Showcase save** jumps to the mockup state (Lv. 27, depth 27).
- Settings → **Test speed** (×1, ×10, ×60, ×600, ×3600) makes game time run faster for testing, and **Skip ahead**
  (+1 h, +8 h, +1 day, +7 days) jumps forward as if you had played the whole time. Hazards pause above ×10.

## Build & test
```
python3 -I tools/build_assets.py      # only after changing art: re-cut and compress images
node build.mjs                         # -> dist/chikn-henium-mines.html
node test/regress.mjs "$PWD/dist/chikn-henium-mines.html"
node test/smoke.mjs "$PWD/dist/chikn-henium-mines.html" /tmp/shots mines,factories,crafting,chikns,farm,guild,dex,expeditions,battle,events,wiki
node tools/journey-sim.cjs 200 3 15 --weekly   # real-time journey: 200 days, 3 sessions of 15 min a day
```
Source: `src/js/data.js` (all numbers & formulas), `state.js` (state, production, tick, HENIUM emission), `systems.js`
(player actions), `farm.js` (weight, eggs, FEED), `dex.js` (AMM), `ui.js` (shared UI), `view-*.js` (one per screen),
`src/css/*.css`. Developer guide: `docs/VIEW-GUIDE.md`. Original design notes: `docs/design-from-chatgpt.md`.
