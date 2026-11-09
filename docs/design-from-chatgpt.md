# Chikn Henium Mines: design extracted from the ChatGPT conversation

**Source.** The shared ChatGPT chat (about 440 messages, mostly voice mode, Croatian/Serbian plus English, 8–9 Nov 2026). The flat text export is roughly newest-first, so I rebuilt the real order from the share's message tree (`share-stream.txt`, no branches). "Latest" below means latest in time. Nearly every number is a ChatGPT placeholder ("illustrative, for simulation"). The user gave ideas, not numbers.

## 1. Concept and core loop

- **User's pitch:** a farm with mining shafts, each holding a number of Chikn NFT chickens that dig ore. "Hash devices" turn the ore into **HENIUM**, "the chickens' bitcoin" and the game's engine. Each new shaft must be "extremely expensive and hard", so players keep grinding.
- **Final framing:** an idle/management mining-industry strategy game. The screen is a vertical mine cross-section. You hire chickens, open shafts, build machines, process ore, and grow from company to guild to empire. It must be fun with no NFT, token or real money.
- **Loop:** mine → crush → separate → smelt/refine → craft components → build/upgrade machines → unlock a deeper zone. Surplus is sold or given to the guild.
- **The user's own mockup** (800×500 PNG, sent after he rejected ChatGPT's first concept image), as ChatGPT described it:
  - three side-by-side mining bays, each with a plaque (ore type, rate) and **Hire Hen** / **Picks** buttons
  - a darker lower layer with a locked tunnel and **Dig deeper**
  - top HUD: **ORE, HENIUM VAULT, HASH POWER** and a progress bar
  - action strip: **UPGRADE, UPGRADE, SHIP TO VAULT, GUARD**
  - warm hand-painted cartoon art with sky/cloud side borders

  Prototype v0.2 (§4) was built to match it.
- **Menus:** Mines, Factories, Crafting, Chikn NFT, Guild, Market, Expeditions, Events, Battle.

## 2. User's explicit wishes vs ChatGPT's suggestions

**What the user said:**
1. Henium is the scarce main asset, "like bitcoin", with a **total supply**. The game must last long ("we'll play with the numbers").
2. Use **EGG** (each Chikn NFT lays EGG daily) and **FEED** from the existing Chikn ecosystem. EGG is "far too inflationary", so make it deflationary: players should **burn EGG to get Henium**. Henium must be liquid and worth holding.
3. Constant tension: **PvP and PvE attacks**, so careless players can lose chickens, ore or Henium.
4. Chikn holders are the kick-start, but the game should also attract **new buyers**. It should be addictive and competitive.
5. Henium should be a **real token on Robinhood Chain**, with EGG/FEED moved over from Avalanche. He wanted an **EGG→Henium exchange** and "some kind of **index**" of value across EGG, Henium and crafted devices. Neither was designed; ChatGPT rejected a fixed EGG/Henium rate.
6. **Graphics are "very important"**: beautiful, simple, playable, addictive. He supplied his own mockup and asked for "the mockup and all the graphics".
7. He liked crafting mining devices and machines. He asked for factories, a crafting tree for **all** resources, and retention ideas for 2–6 months.
8. He asked whether a player could run **only an egg farm**. **This was never answered.**
9. He gave full permission repeatedly ("finish the whole game", "don't wait").

**ChatGPT's own suggestions, never explicitly approved:** guilds, seasons and prestige; no NFT loss through inactivity; server-authoritative multiplayer; Henium transfer-limited and blockchain deferred; a 2,500-miner NFT collection. It also warned repeatedly that the Chikn brand needs the rights holders' permission (it reported Chikn entered "Legacy Mode" in Sept 2026; unverified).

## 3. Resources (Economy Spec 1.0, latest)

| Resource | Rarity | Use | Source |
|---|---|---|---|
| Stone | Common | construction, supports, repairs | mine |
| Coal | Common | energy, smelting | mine |
| Iron Ore | Common | ingots, machines, rails | mine |
| Copper Ore | Uncommon | wire, sensors, electronics | mine |
| Rare Earth | Rare | advanced tech, research | deep mine, exploration |
| Henium (ore → refined) | Very rare | end-game tech, legendary machines | veins, guild expeditions |
| FEED | Common | worker upkeep, expeditions | farming, missions, market |
| EGG | currency | trades, upgrades, repairs, research | capped rewards (§6) |
| Energy | produced | runs facilities | power plants |

- **Intermediates:** Iron Ingot, Copper Component, Machine Part, Rare Alloy, Henium Core, plus the §5.2 tree.
- Stone and Coal never convert into Henium.
- Ordinary resources stay off-chain.

## 4. Mine depths and zones

| Depth | GDD (00:39) | Rulebook + Asset Bible (latest) | Danger |
|---|---|---|---|
| 1–5 | Stone, Coal | Stone | low |
| 6–10 | Copper | Coal | low |
| 11–20 | Iron | 11–15 Copper, 16–20 Iron | medium |
| 21–30 | Henium Veins | Henium Vein | high |
| 31–40 | Rare Earth | Rare Earth | very high |
| 41+ | Core Zone (megaprojects, bosses) | Core | extreme |

- Deeper levels need more resources, crafted gear, stability and research, not only payment.
- Henium veins are the **daily treasure hunt**: they appear randomly (verifiable), hold finite ore and need expeditions.
- In the first concept, shafts 1–6 hold 5, 10, 20, 40, 80 and 160 chickens.

**Prototype v0.2 idle loop** (mirrors the mockup; ore 26 and "1 hen · picks 1 · 0.8 ore/s" probably come from it):

| Floor | Topsoil | Greystone | Coal Seam | Copper Vein | Iron Depth | Henium Vein | Rare Earth | Core |
|---|---|---|---|---|---|---|---|---|
| Dig cost (ore) | 0 | 120 | 300 | 650 | 1,200 | 2,500 | 5,000 | 10,000 |
| Base ore/s | 0.8 | 1.1 | 1.5 | 2 | 2.8 | 3.5 | 4.2 | 5 |

- Rate = `base[depth] × hens × pickLevel × 0.8`.
- Start: 100 EGG, 26 ore, 1 hen, pick 1, stability 100%.
- Actions: **Hire hen** `20 × hens` EGG; **Picks** 25 ore (+1); **Upgrade** 30 ore (+10% stability); **Skip** 10 EGG (+20 ore); **Guard** 300 ore (blocks the next cave-in).
- Unlock bonuses: Coal +20, Copper +15, Iron +15.
- Side drops per 2 s tick: coal 25% from depth 3, copper 12% from depth 4, iron 8% from depth 5.

## 5. Production, machines and crafting

### 5.1 Recipes (Economy Spec 1.0, latest)

| Recipe | Facility | Inputs | Output | Energy | Time | Workers |
|---|---|---|---|---|---|---|
| Ore crushing | Crusher | 10 Iron Ore + 1 Coal | 9 Crushed Ore + 1 waste | 2 | 60 s | 1 |
| Iron smelting | Smelter | 10 Iron Ore + 3 Coal | 7 Iron Ingot | 5 | 180 s | 2 |
| Copper components | Component Factory | 8 Copper Ore + 1 Coal | 5 Copper Component | 4 | 180 s | 2 |
| Machine parts | Machine Factory | 4 Iron Ingot + 2 Copper Comp. | 3 Machine Part | 8 | 300 s | 3 |
| Rare alloy | Advanced Refinery | 6 Rare Earth + 4 Coal | 2 Rare Alloy | 15 | 600 s | 4 |
| Henium core | Henium Lab | 1 Henium + 5 Rare Alloy | 1 Henium Core | 50 | 3,600 s | 5 |

- Output = `floor(base × machine × worker × technology × condition)`.
- All bonuses combined are capped at **+50%**; the worker bonus at **+10%**.
- A job starts only after its inputs, workers, machine and energy are reserved.
- Offline progress is capped at **8 h**.

### 5.2 Detailed industrial tree (Crafting v1.0 / Industrial Economy v1.0 workbook)

**Crusher, separator, smelter.**
- Crusher: 500 raw ore → 450 crushed + 50 waste; 30 min, 100 Coal, 2 workers.
- Separator: 450 crushed → 300 Common + 100 Industrial + 30 Rare Concentrate + 20 waste. Capacity by level 500/650/800/1,000/1,500.
- Smelter capacity by level: 200/500/1,000.

**Recipes by chain** (inputs → output, minutes):
- **Stone:** 100 Crushed → 80 Gravel (5); 100 Concentrate → 50 Blocks (15); 50 Blocks + 10 Iron Rods → 20 Reinforced Blocks (30); 50 Gravel + 10 Industrial Coal → 40 Concrete (20).
- **Coal:** 100 Crushed → 80 Industrial Coal (10) or 65 Pure Coal (15); 100 Pure → 60 Coke (30); 20 Coke + 10 Copper Plates → 5 Energy Cells (45).
- **Copper:** 100 Concentrate + 30 Coal → 50 Ingots (45); 20 Ingots → 40 Wire (20); 30 Ingots → 20 Plates (30); 20 Wire + 10 Plates → 5 Circuit Boards (60); 10 Boards + 5 RE Components → 3 Advanced Circuits (120).
- **Iron:** 100 Concentrate + 40 Coal → 60 Ingots (60); 20 Ingots → 15 Plates or 20 Rods (25); 10 Plates + 10 Rods → 8 Gears (40); 20 Ingots + 10 Coke → 12 Steel Components (60); 20 Steel + 10 Copper Plates → 5 Heavy Components (120).
- **Rare Earth:** 100 Crushed → 40 Concentrate (60); 50 Concentrate + 20 Coal → 20 Purified (120); 10 Purified + 10 Rods → 8 Magnets (90); 10 Purified + 5 Advanced Circuits → 3 Advanced Processors (180); 5 Processors + 5 Magnets → 1 Quantum Module (240).
- **Henium:** 100 Crushed Henium Ore → 25 Concentrate (120); 20 Concentrate + 40 Industrial Coal + 5 Purified RE → 10 Feedstock (180); 10 Feedstock + 2 Advanced Processors → **10 Henium** (240), **only while the global emission budget remains**.

### 5.3 Machines (Industrial Economy v1.0)

| Machine | Unlock lvl | Build cost | Workers | Cap./cycle | Cycle min | Energy |
|---|---|---|---|---|---|---|
| Basic Drill | 1 | Stone 100, Iron 50, EGG 100 | 1 | 100 | 60 | 10 |
| Improved Drill | 5 | Stone 200, Iron 150, Copper 50, EGG 300 | 1 | 150 | 60 | 15 |
| Heavy Drill | 10 | Stone 500, Iron 400, Copper 150, EGG 800 | 2 | 250 | 60 | 30 |
| Ore Crusher | 12 | Stone 2,000, Iron 1,500, Copper 400, EGG 2,500 | 2 | 500 | 30 | 100 |
| Ore Separator | 15 | Stone 1,000, Iron 800, Copper 700, EGG 1,500 | 2 | 500 | 45 | 80 |
| Ore Recycler | 16 | Iron 400, Copper 200, Stone 300 | 1 | 100 | 60 | 30 |
| Smelter | 18 | Stone 500, Iron 1,000, Copper 300, EGG 2,000 | 2 | 200 | 60 | 120 |
| Industrial Generator | 18 | Iron 500, Copper 300, Coal 200 | 1 | +100 energy/h | 60 | 0 |
| Deep Scanner | 20 | Iron 500, Copper 500, RE 100, EGG 3,000 | 1 | 1 scan | 60 | 20 |
| Iron Foundry | 22 | Stone 800, Iron 1,200, Copper 300, EGG 2,500 | 2 | 300 | 60 | 100 |
| Advanced Processor | 25 | Iron 1,000, Copper 1,000, RE 300, EGG 5,000 | 2 | 100 | 120 | 150 |
| Henium Refinery | 30 | Iron Comp. 3,000, Copper Comp. 2,000, RE 500, Coal 2,000, EGG 10,000 (12 h build) | 3 | 10 | 240 | 250 |

**Earlier voice recipes (made right after the user praised machine crafting):**
- Improved Drill L5: 300 Stone, 120 Coal, 80 Iron, 40 Copper. 20–30 min; FEED or EGG can speed it up.
- Heavy Drill L10: 1,500 Stone, 800 Coal, 1,000 Iron, 500 Copper, 25 Rare Earth, 2,000 EGG. 2 h; digs about 2.5× faster; reaches depths 11–20. Upgrades: Turbo Motor, Reinforced Head, Depth Sensor.
- Legendary Henium Drill: 500 Iron Components, 200 RE Components, 50,000 EGG, 25 Henium.

**Factories:** Stone Workshop, Coal Power Plant, Copper Smelter, Iron Forge, Advanced Factory and Henium Refinery. Each has five levels: Basic, Improved, Industrial, Advanced, Legendary.

### 5.4 Upgrades and durability

| Upgrade (Spec 1.0) | EGG | Material | Effect |
|---|---|---|---|
| L1→2 | 2,500 | 100 Iron Ingot | +10% capacity, +2% efficiency |
| L2→3 | 6,000 | 40 Machine Part | +12% capacity, +3% efficiency |
| L3→4 | 12,000 | 80 Copper Component | +15% capacity, +3% efficiency |
| L4→5 | 25,000 | 25 Rare Alloy | +18% capacity, +4% efficiency |

- **Durability** drops per work cycle, **never from inactivity**.
- A repair costs 2 Machine Parts + 100 EGG and restores 25 durability.
- Low durability slows or stops output; machines are never destroyed.
- Without Coal (energy), production slows and costs more but does not stop.

## 6. Economy

### 6.1 How the roles evolved

- **Early:** EGG is burned for Mining Licences (pricier with depth), temporary **Hash Power** and ore processing. FEED keeps chickens productive. Henium is a capped reserve asset for machines, rights and territories.
- **ChatGPT's "Model B: Mining + Conversion":** each week a fixed Henium allocation from a reserve inside the cap is split pro rata among EGG burners. A public **Henium Vault** shows mined and remaining supply.
- **Latest (Spec 1.0, "locked" for v1.0):** EGG is an **off-chain in-game currency**, FEED a consumable, and Henium a **scarce end-game crafting material**, transfer-limited at launch. Blockchain is out of scope. This departs from the user's on-chain vision; he never objected or approved.

### 6.2 Faucets, sinks and supply (Spec 1.0)

**Faucets.**
- 1,000 EGG for a new account; 500 EGG after the tutorial.
- Daily tasks: average **≤50 EGG/player/day**, not for just logging in.
- Weekly missions: up to 3 × 150 EGG.
- A fixed season pool, mostly cosmetics.
- Capped exploration drops.

**Sinks.**
- Upgrades, construction and repairs.
- Research: T1 = 20 Copper Components + 1,500 EGG; T2 = 10 Rare Alloy + 7,000 EGG.
- Guild factory: 500 Iron Ingots + 200 Copper Components + 50,000 EGG.
- Guild expedition: 100 FEED + 10,000 EGG.
- Founding a company (5,000 EGG) or a guild (25,000 EGG).
- The market fee.

**Other numbers.**
- FEED upkeep: **2 FEED/day per 5 assigned workers**. Running out removes boosts only.
- Daily test model: 1,000 players × (50 in − 65 out) = **−15,000 EGG/day**.
- Henium supply was **never fixed**. The only figure is an illustrative **global emission cap of 100,000 per year** (600,000 over 6 years). Refinery output stops when the budget is used, and upgrades never raise the cap.

### 6.3 Market rules

- **Order types:** instant buy/sell, limit orders, auctions (with a deposit) and contracts.
- **Matching:** price-time priority; the resting order sets the price.
- **Escrow:** the buyer escrows EGG, the seller escrows goods, and settlement is atomic.
- **Fee:** **2% of gross**, paid by the seller, none on unfilled orders. **Half is burned**, half goes to a maintenance treasury. Example: 100 Iron Ore × 5 EGG = 500, so the fee is 10 and the seller gets 490.
- **Protection:** self-trade blocking, rate limits, wash-trade detection, circuit breakers.
- **Illustrative prices (EGG):**
  - draft ask/bid: Iron Ore 5/4, Coal 2/1, Copper Ore 8/6, Stone 1/1, Rare Earth 30/24, FEED 3/2
  - v1.0 prototype fixed prices: Stone 0.2, Coal 0.5, Copper/Iron 1, RE 8, Henium 100, ingots 2–2.5, Circuit 5, Processor 15

### 6.4 Inflation controls

- Weekly net EGG change around **±1% of circulating supply** (investigate beyond ±2% for 2 weeks).
- Alert if a resource stock grows **more than 10% a week** without demand, or one guild holds **more than 35%** of it.
- NPC trading share **under 20%** (alarm at 30%).
- If monetized, sell only cosmetics.

## 7. NPC / economic simulation

**Planned but never run.** No findings exist; it was the first item of ChatGPT's final plan.

- **Scenarios:** 1k, 10k and 100k active players over 6 years.
  - 20–60% of players specialize.
  - Churn of 30%, 50% and 70%.
  - Shocks: mining supply −40%, demand +60%, a guild monopolizes an input.
  - Abuse tests: wash trades, alt accounts, race conditions.
- **Inputs:**
  - 60 min/day and 20 production cycles per player
  - 100 ore per player per day, 240 active days per year
  - 200 resource units produced vs 190 consumed per player per day
  - EGG: 50 in, 65 out
- **Measured per resource:** output, consumption, stock, price, number of suppliers, concentration.
- **NPC traders are a backstop only:** at most 20% of daily volume, prices within **±15% of the 7-day weighted average**, and a finite funded pool that never creates EGG.
- **Toy model in prototype v1.0 (JS), per year:**
  - `avg = active × (1 − churn/2)`
  - `ore = avg × 120`
  - `henium = avg × (0.02 for years 1–3, 0.05 for year 4, 0.08 for years 5–6)`
  - `cost = avg × 35`
  - `active ×= 1 − 0.22 × churn`

  It is labelled uncalibrated.

## 8. Other systems

**Worker classes** (latest per-class numbers, from the Industrial workbook):

| Class | Bonus | Limit |
|---|---|---|
| Miner | +10% mining | assigned site, diminishing returns |
| Engineer | −10% cycle time | never below 50% of base |
| Transporter | +15% carrying | no resource generation |
| Guardian | −10% event loss | PvE only |
| Explorer | +10% discovery | never raises the Henium cap |
| Scientist | +5% yield | capped |
| Crafter | −5% materials | never discounts Henium |
| Trader | −10% market fee | fee floor |
| Leader | +3% guild contribution | non-stacking |

- Crafting v1.0 had larger bonuses (Miner +15%).
- The Rulebook adds active skills: Deep Cut, Overclock, Express Route, Brace, Vein Scan.
- NFT stats: Mining Power, Efficiency, Capacity, Durability, Discovery.
- Basic workers are free for everyone.

**NFT collection.**
- 2,500 "Chikn Miners".
- Rarity split: Common 40%, Uncommon 30%, Rare 18%, Epic 9%, Legendary 3%. The art also has a MYTHIC badge.
- Rarity is mostly cosmetic. A superseded idea gave Legendary +60% output.

**Progression.**
- XP to the next level = **level × 100**.
- Unlocks by level:
  - 3 Coal; 5 Improved Drill and market; 7 Copper; 8 companies
  - 10 Heavy Drill and contracts; 12 Crusher; 15 Separator and joining a guild
  - 18 Smelter; 20 Scanner and founding a guild; 22 Foundry
  - 25 Advanced Processor; 27 Rare Earth; 30 Henium Refinery; 35 Automation
  - 40 Legendary Machinery; 45 Deep Henium Expeditions; 50 "Industrial Empire" and prestige

**Companies.** Level 8, 5,000 EGG; shares in basis points (at most 10,000); two approvers above min(10,000 EGG, 10% of treasury).

**Guilds.**
- Join at level 15; found at level 20 for 25,000 EGG; up to 50 members.
- Shared factory output: **70% by contribution, 20% stockpile, 10% market**.
- Contribution = 1 point per EGG of materials + 1 point per 10 min of labour, with seasonal decay.
- Megaproject example: 1,000,000 Stone, 500,000 Coal, 100,000 Iron, 20,000 Copper.

**Seasons.**
- Each season lasts **28 days**.
- Leagues: Mining, Industrial, Logistics, Exploration, Energy, Trading, Guild.
- Scores use efficiency, not raw volume. Rewards are cosmetics, titles and blueprints.

**Missions.**
- Mine 500 Stone → 20 EGG.
- Process 100 Ore → 15 EGG.

**Expeditions.**
- Timed PvE runs: Forgotten Tunnel (30 min), Crystal Survey (2 h).
- Prototype cost: 50 EGG, from level 3; 5–12% chance of 1 Henium deep down.

**Threats.** PvE: cave-ins, pests, disease, machine faults, bandits. PvP: raids steal part of **unprotected** ore. No NFT or total loss through inactivity; maximum losses are shown before opting in.

**Territory, battle, prestige.** Territories are capped-extraction seasonal licences. Battle is only a menu item, with no rules. Prestige restarts a mine for status, with **no extra Henium**.

**Six-month arc:** M1 Stone/Coal, M2 Industry, M3 Copper/Iron, M4 Guilds & Territories, M5 Henium veins, M6 Core Zone and guild boss.

## 9. Code and data artefacts

- **Python (python-docx/openpyxl)** generated the DOCX and XLSX files. Every table here comes from their data.
- **12 single-file HTML/CSS/JS prototypes** (plus one HTML blueprint document) with Croatian UI, `localStorage` saves and JSON export.
  - The best reference is v0.2 (§4).
  - v1.0 has tabs Mine/Industry/Exploration/Guild/Market/6-year economy and floors 0 to −3.
- **Economy Engine 0.1:** Node.js 20 (Express, JWT, bcrypt) with PostgreSQL 16.
  - Tables: players, wallets (1,000 EGG default), ledger, market orders, trades, companies, guilds, contracts, recipes, production jobs, audit logs.
  - Fee = `gross × 200 / 10000` (floor).
  - Its seed recipes differ from Spec 1.0: smelting 300 s / 20 energy.

## 10. Art style and image prompts

**Direction.**
- Warm "premium colourful 3D cartoon" / hand-painted style.
- The vertical mine is the hero of the screen.
- Helmeted chicken workers, timber supports, lanterns, ore carts.
- **Henium is a purple/magenta glow**, used only for rare and end-game elements.
- Zone colours: Stone grey, Coal charcoal, Copper orange, Iron steel-blue, Rare Earth cyan.
- UI: dark graphite with gold borders.

**Characters.**
- One shared anatomy: big head, short body.
- Classes are told apart by gear: pickaxe, wrench, cart, shield, scanner, ledger, cape.

**Animations and assets.**
- Timings: idle 2–4 s loop; mining swing 0.7–1.1 s; machine cycle 2–5 s.
- Asset naming: `CHM_[CATEGORY]_[NAME]_[VARIANT]_[STATE]_[VERSION]`.
- Machines get 3–5 visual levels.
- Text is never baked into art.

**Image prompts (1536×1024):**
1. Six-month roadmap.
2. A screen "closely following the uploaded reference layout" (HUD and buttons as in §1).
3. Three screens: mine; Crusher → Separator → Smelter → Refinery; guild hub.
4. Main UI with an 8-resource HUD and left navigation.
5. Character sheet: "not humans in chicken costumes".
6. Main mine with five geology-coloured levels.
7. Ten classes with COMMON–MYTHIC badges.

All prompts forbid fake crypto price charts.

## 11. Latest state

**Last deliverables:** Economy & Tokenomics Spec 1.0 (DOCX), Balance Model 1.0 (XLSX) and Economy Engine 0.1.

**ChatGPT's final plan:**
1. NPC simulation.
2. Finish the production economy: costs, wages, machines, all tied to the mine.
3. Finish the market: auctions, price history, anti-manipulation.
4. Companies and guilds with shares and voting.
5. Server-authoritative security.

Numbers are to be tuned only after simulation.

**The user's final message:** "Why don't you continue? Why do always waiting for me to tell you".

**Still open:**
- Henium cap.
- EGG→Henium conversion.
- The "index".
- The egg-farm playstyle.
- Chain and migration choices.
- Chikn IP rights.
- Battle rules.

## 12. Contradictions (latest version wins)

| Topic | Earlier | Latest |
|---|---|---|
| Henium | on-chain capped token (user's wish) | off-chain end-game material, transfer-limited |
| EGG source | laid daily by chickens; burned for licences, Hash Power, conversion | capped rewards (~50/day); fee half-burned |
| Zones 6–20 | Copper 6–10, Iron 11–20 (GDD) | Coal 6–10, Copper 11–15, Iron 16–20 (Rulebook) |
| Market fee | 2.5% (workbook) | 2% |
| Class bonuses | Miner +15% (Crafting v1.0) | +10%, all bonuses capped at +50% |
| Rarity power | Legendary +60% output | mostly cosmetic |
| Upgrades | +15/30/45/60% capacity | Spec 1.0 EGG + material table |
| Advanced Factory cost | text: 20,000 Stone, 8,000 Iron, 5,000 Copper, 1,000 RE, 2,000 Coal | same message's widget: 3,000 Iron, 2,000 Copper, 300 RE |
