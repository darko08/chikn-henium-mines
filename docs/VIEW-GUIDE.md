# Writing a screen ("view") for Chikn Henium Mines

The game is a single-file browser idle/tycoon game. `node build.mjs <out.html>` inlines `src/css/*.css`,
`src/js/*.js` and every image in `assets/web/**` (as data URIs) into one HTML file.

## Read these first (core, do NOT edit)
- `src/js/data.js` — all static data & formulas (`G.D`): resources, zones, factories+recipes, machines, roles,
  rarities, hires, guild projects/donations, market prices, expeditions, battle stages, missions, quests,
  journey (6-month roadmap), live events, HENIUM supply/halvings, reward bundles `D.bundle(depth, k)` and the rule
  numbers `D.rules` (hazards, battle, expeditions, guild, timings; see "Economy rules" below).
- `src/js/state.js` — state shape (`G.S`), formatting (`G.fmt`, `G.fmtFull`, `G.fmtRes`, `G.fmtTime`),
  cost helpers (`G.has`, `G.pay`, `G.give`, `G.scale`), bonuses (`G.bonus(type)`, `G.chiknPct`, `G.chiknPower`,
  `G.chiknEgg`, `G.squad()`, `G.squadSlots()`), rates, factory helpers (`G.factorySpeed`, `G.recipeIn`,
  `G.recipeOut`, `G.jobSlots`, `G.activeJob`), HENIUM supply (`G.epoch`, `G.halving`, `G.nextHalving`).
- `src/js/systems.js` — every player action `G.act.*` (each returns `{ok, msg, ...}`) and helpers
  (`G.missions()`, `G.missionReward(m, depth)`, `G.questList()`, `G.rivals()`, `G.squadPower()`, `G.winChance()`,
  `G.expSite()`, `G.expOdds(site, team)`, `G.idleChikns()`, `G.donation(i)`, `G.guildProjectReward(i)`, `G.feeK()`,
  `G.exRate()`, `G.speedCost(sec)`, `G.canRush(job)`, `G.feedCost(c)`).
- `src/js/ui.js` — UI framework. `src/js/view-mines.js` + `src/css/mines.css` are the reference screen.
- `src/css/base.css` — design tokens and shared components.

## Registering a view
```js
(() => {
const G = window.G, D = G.D, ui = G.ui, esc = ui.esc;
ui.views.factories = {
  render(el) { el.innerHTML = `...`; },   // full render; called on navigation and after every action
  update() { /* optional, called 4x per second; keep it cheap */ },
};
})();
```
Nav ids: `mines factories crafting chikns farm guild dex expeditions battle events wiki` (`market` is an alias of `dex`).

## Interaction conventions
- Buttons call actions declaratively: `ui.btn(label, 'actionName', [args], 'green sm', costObjOrNull)`
  renders `<button data-a="actionName" data-args='[..]' data-need="...">`. Clicking runs `G.act.actionName(...args)`,
  toasts the error message on failure, plays a sound and re-renders the current view.
- Custom flows: `ui.handlers.myUniqueName = (el, event, ...args) => {...}` and use `data-a="myUniqueName"`.
  Prefix handler names with your view (e.g. `fxPickRecipe`) to avoid collisions.
- `data-need="res:amount,..."` (from `ui.need(cost)`) greys a button when unaffordable (auto-refreshed).
- Live values: `data-b="binder:arg"` elements are refreshed 4x/s. Built-in binders: `res:<res>`, `job:<id>`,
  `craft:<id>`, `exp:<id>` (on a `.bar`), `until:<timestamp ms>`, `dur:<machineId>` (bar), `nest`, `xp`, `lv`,
  `zrate:<zoneId>`, `depth`. Add your own with `ui.binders.name = (el, arg) => {...}`.
- Helpers: `ui.icon(res, size)`, `ui.img(key, cls, alt)`, `ui.cost(cost)`, `ui.rew(rew)`, `ui.bar(pct, cls, text, attrs)`,
  `ui.btn(...)`, `ui.chiknCard(c, {sel, cls, attrs, noStatus})`, `ui.modal({title, html, hero, wide, actions:[{label, cls, fn}]})`,
  `ui.toast(text, 'good'|'bad'|'purple', iconKey)`, `ui.float(html, x, y)`, `ui.sparks(x, y, color)`, `ui.centerOf(el)`,
  `ui.reveal(chikn)` (new-chikn reveal modal), `ui.go(viewId)`, `ui.render()`, `G.sfx('ok'|'err'|'coin'|'win'|'lose'|'up'|'hire')`.
- The "Hire Chikn" dialog already exists: any element with `data-a="hire"` opens it.

## Images — `G.img(key)` returns a data URI
- `res/<resource id>` for every resource in `D.res` (egg, feed, henium, stone, coal, copper, iron, heniumOre,
  rareEarth, crushedOre, copperIngot, ironIngot, components, machinePart, alloy, circuit)
- `chikn/<role>`: miner engineer operator guardian leader scientist crafter trader explorer medic
- `factory/<id>`: crusher separator smelter forge advanced refinery
- `machine/<id>`: basic improved heavy scanner rig extractor
- `monster/<mon>`: bat beast crab golem spider hgolem wraith king
- `prop/<name>`: cart cartStone cartCoal cartCopper cartIron cartHenium cartRare lift lantern chest crate flag headframe rubble hq sign
- `ui/<name>`: mines factories crafting chikns guild market expeditions battle events bell settings trophy lock energy timer gift logo
- `bg/<name>`: surface map arena hall floor-stone floor-coal floor-copper floor-iron floor-henium floor-rare floor-core

## Look & feel (match the mockups)
Dark navy panels with gold borders (`.panel`, `.panel-h` headings in Lilita One), chunky glossy buttons
(`.btn` + `green gold purple red gray`, sizes `sm lg`), rounded progress bars (`.bar` + `green blue purple gold red`),
big painted icons, cards (`.card`, `.list-row`, `.tag`), tabs (`.tabs > .tab.on`). Put your CSS in your own file
(`src/css/<view>.css`) and prefix every class with a short view prefix (e.g. `.fx-`, `.cr-`) so nothing collides.
Layouts must work from 390px wide (phone; nav moves to the bottom under 900px) up to 1600px+, with no horizontal page scroll.

## Testing
```
node build.mjs /tmp/<you>.html
node test/smoke.mjs /tmp/<you>.html /tmp/<you>-shots <view1>,<view2>
node test/smoke.mjs /tmp/<you>.html /tmp/<you>-shots-m <view1>,<view2> --mobile
```
The smoke test loads the "Showcase" save (player Lv. 27, depth 27, lots of resources, 12 chikns, 3 jobs running),
opens each view, saves screenshots (`<view>.png`) and prints JS errors. Look at the screenshots (Read the PNGs)
and iterate until the screen looks polished and there are no errors. You can also drive more interactions with
your own Playwright snippets (Chromium is preinstalled; `require('playwright')`).

## Economy v2 (scarce EGG, Egg Farm, timed digging & construction) — read this too
- **EGG is scarce**: only Chikns lay it, about 1 EGG per *farm day* each (`D.farm.day` = 86,400 s: a real day).
  Show EGG as small whole numbers; never "EGG/h". Per-Chikn: `G.chiknEgg(c)` = eggs per day; totals `G.eggsPerDay()`.
  **No reward ever pays EGG**: quests, daily missions, PvE stages, expeditions, the season track, supply crates,
  creatures, bandit and PvP wins pay ores & materials (`D.bundle`), a little FEED or HENIUM. The DEX only moves existing
  EGG. EGG can be burned for FEED (`G.act.exchange('e2f', qty)`, rate `G.exRate().e2f`); EGG → HENIUM goes through the
  DEX (`e2h` is refused), and HENIUM can **not** be turned into EGG (`h2e` was removed — don't show it).
  EGG sinks: hires, coop upgrades, bandit tolls, guild donations/zone/License, global factory upgrades, burning for FEED.
- **FEED is scarce**: the Feed Mill's daily quota is the main source. Other FEED is small on purpose: level-ups pay
  `D.rules.levelFeed(lv)` (2 + lv/5), daily missions at most 6 a day in total, even season levels `ceil(lv/3)`, a few
  one-time quests, and 1–4 now and then from expeditions, supply crates and creatures.
- **Rewards scale with progress**: `D.bundle(d, k)` = k × the dig cost at depth d of that zone's ore plus the newest
  material digging needs there (Stone in the Coal Zone). Daily missions: `D.missions[].r` is a function of depth, use
  `G.missionReward(m)` (or the resolved `r` from `G.missions()`); season odd levels use the season level as the depth.
  Season rewards can be bundles of two resources — show every entry, not just the first.
- **Chikn weight** (`src/js/farm.js`): every Chikn has `c.kg`; start `G.kgStart(c)`, max `G.kgCap(c)` (by rarity).
  Its level `c.lv` now follows its weight (`G.syncLv`). `G.act.feed(id, times=1)` adds `D.farm.step` (10) kg per feeding for
  `G.feedCost(c)` FEED each (cost rises with weight); returns `{ok, kg, lv, done, spent}`. Eggs/day = `D.farm.eggsAt(kg)`
  (100 kg = 1, 200 kg = 1.5, 400 kg = 2.3, 800 kg = 3.5). Upkeep: Chikns eat `G.upkeepPerDay()` FEED per day in total;
  without FEED they get hungry (`G.S.farm.hungry`) and slowly lose weight. `G.feedDaysLeft()` = days of FEED left.
- **Nest**: `G.S.nest` (fractional eggs), cap `G.nestCap()`; `G.act.collectNest()`.
- **Coop**: houses `G.coopCap()` Chikns (hiring and claiming a season Chikn fail when full); `G.S.farm.coopLv` (1..`D.farm.coopMax`), upgrade with
  `G.act.upgradeCoop()`, cost `D.farm.coopCost(lv)`. Art: `G.img(G.coopImg())`.
- **Feed Mill** is a 7th factory (`D.factoryById('feedmill')`, recipe `feed`): it grinds FEED, limited by a daily quota
  `G.millQuota()` (grows with its level); used today `G.S.farm.milled` + queued `G.queuedFeed()`. Day counter `G.S.farm.day`,
  time to next day `G.farmDayLeft()` (binder `data-b="farmday"`). Specialization `farmer` exists (`G.specIs('farmer')`).
- **Building art changes with EVERY level**: 10 looks per building, each richer than the last (wood → stone → iron → brass →
  gold → crystal → legendary). Use `G.img(G.bImg(factoryId, lv))` (unbuilt → use lv 1 and dim it). Keys: `tier/<id>-1..10`
  for crusher separator smelter forge advanced refinery feedmill coop hq. The HQ: `G.img(G.hqImg())` (new look every 5 depth).
  `D.tier(lv)` = lv. Every upgrade is a new look — celebrate each one (before → after). Higher-level art is also drawn bigger,
  so let building images keep their natural size ratio (don't force every level into the same box height).
- **Construction takes time**: `G.act.build(fid)` / `G.act.upgradeFactory(fid)` now *start* construction
  (`G.S.factories[fid].con = {t, dur, to}`), duration `D.buildTime(lv)` (30 s … ~1.3 h). While under construction the
  factory's jobs pause and it can't take new jobs. Progress bar binder: `data-b="con:<fid>"` on a `.bar`. Finish now for
  HENIUM: `G.act.speedBuild(fid)` (cost `2 * G.speedCost(secondsLeft)`). Upgrades get much pricier per level and need
  better materials (`D.factoryUpCost(f, lv)` — components, machine parts, HENIUM, alloy, circuits at higher levels).
- **Digging takes time**: `G.act.dig()` starts a dig (`G.S.dig = {t, dur, to}`, `D.digTime(depth)`), a working machine on
  the deepest zone speeds it up (`G.digSpeed()`); binder `data-b="dig"`; finish now: `G.act.speedDig()`. The Stone part of
  `D.digCost(d)` is 400 × 1.38^min(d−1, 29) × 1.25^max(0, d−30): steep down to depth 30, then gentler, so the last digs
  cost hundreds of millions of Stone, not billions.
- Events you can listen to (`G.on(name, fn)`): `built` ({f, lv, from, tierUp}), `dug` ({depth, newZone}), `farmDay`, `hungry`.

## Tokenomics v3: scarce HENIUM, DEX, simulated ETH (src/js/dex.js + state.js)
- **HENIUM is minted only by work and fighting.** The whole world mints exactly `G.emission()` HENIUM per game day
  (`D.supply.daily` × halving; 21M cap). Halvings follow the **world clock** like the contract: `G.S.worldT` = seconds since
  `D.supply.genesis`, `G.epoch()` = ⌊days ÷ `D.supply.halvingDays`⌋, and `G.S.world.mined` = `D.cumEmission(days)`.
  The emission is split `D.supply.split` = 70% refiners, 20% guild-war fighters, 10% monster hunters.
  - **Every HENIUM a player receives comes out of that emission.** The world's supply is the schedule itself, so whatever
    `G.give(rew)` pays (refining, quests, the season track, war/hunt payouts, bounties, expeditions, guild projects,
    PvP/bandit loot) is HENIUM the rest of the world doesn't get; it is tracked in `G.S.world.paid`. Nothing pays HENIUM
    once 21M are mined. Refunds and trades pass `transfer = true`. `G.give` returns what it actually gave.
  - Refining = your share of world refinery power: `G.myRefPower()` / (`G.myRefPower()` + `G.worldRefPower()`) = `G.refShare()`;
    `G.refPerDay()` = HENIUM/day while the refinery runs non-stop; power per level `D.refPower(lv)`. The world's power grows
    every day (difficulty rises), so shares shrink unless you keep upgrading.
  - Refinery batches have a fixed length and **can't be rushed** (`G.canRush(job)` is false; don't offer a speed-up).
  - Guild wars: `G.warShare()`, `G.warPerDay()`, paid at every game-day rollover from your war points (which cool down
    `D.rules.warDecay` = 15%/day; the other guilds' `G.S.world.war` grows `D.rules.worldWar` a day).
  - Monster hunts are a real share too: PvE wins (`D.rules.pveHunt(i)` = stage number), creatures (+1) and bandits (+2)
    add hunt points `G.S.hunt`; `G.huntShare()` = yours ÷ (yours + `G.S.world.hunt`, which starts at
    `D.supply.worldHunt0` and grows `D.rules.worldHunt` a day); `G.huntPerDay()` = emission × `split.boss` × share. Your
    points halve every day (`D.rules.huntKeep`). First clears of stages pay a one-time HENIUM bounty (`st.first`).
  - Guild projects pay `G.guildProjectReward(i)` HENIUM (project i, 0-based) — always show that number.
  - No more HENIUM from level-ups, missions or EGG minting. HENIUM sinks: digging below depth 21, building levels 5+,
    premium hires, guild license/zone, speed-ups, and a burn on every DEX trade.
- **DEX** = constant-product AMM pools (x·y=k). Pools: every resource/HENIUM, EGG/HENIUM, HENIUM/ETH, EGG/ETH
  (`G.dexPools()` → `{id: {a, b, ra, rb, hist[]}}`, price of a in b = `rb/ra`, `G.poolPrice(p)`, `G.poolTVL(p)` in HENIUM).
  - `G.spot(x, y)` = price of 1 x in y; `G.dexTokens()`; `G.dexRoute(from, to)` (direct, or via HENIUM).
  - `G.dexQuote(from, to, amount)` → `{out, impact (0..1), feeIn (in `from` token), rate, route: ['egg→henium', …], steps}` (no state change).
  - `G.act.swap(from, to, amount, minOut)` → `{ok, out}`; fee per hop `G.dexFee()` = `D.dex.fee` (0.3%) × `G.feeK()`: Trader
    Chikns in the Mining Team lower it by their bonus (to no less than 30%), the Trader specialization halves it. Quotes
    carry the effective rate (`q.fee`); a third of the fee actually paid is burned (`G.S.dex.burned.henium/.egg`). Show
    `G.dexFee()`, not the flat 0.3%. The old `G.act.trade` now trades through the DEX.
  - NPC market makers move pools toward fair prices every `D.dex.tick` s (`G.fairPrice(p)`); HENIUM's fair value rises each
    halving (`G.henValueK()`). They trade only with what they own: HENIUM entering a pool comes from their treasury
    `G.S.dex.npc.henium` (refilled by `D.dex.npcBuy` of what the rest of the world mints), so selling goods can never create HENIUM.
    Ores/materials are priced at `D.market[r] × D.dex.oreValueK`. Pools also include FEED/HENIUM. History: `G.S.dex.log`,
    volume `G.S.dex.volume`. `G.huntPerDay()` gives the monster-hunt payout.
- **ETH** (`G.S.res.eth`, icon `res/eth`, `D.res.eth.cat === 'ext'`) is simulated: players can sell EGG and HENIUM for ETH on
  the DEX; `G.act.withdrawEth()` explains that real withdrawals need the on-chain version (it returns ok:false with a message).
- New icons: `ui/dex`, `ui/wiki`, `res/eth`. Nav ids now: mines factories crafting chikns farm guild dex expeditions battle events wiki
  (the old `market` view is replaced by `dex`).

## Economy rules (`D.rules`)
Every rule number the code uses outside the data tables lives in `D.rules` (data.js): the specialization level, the
free first hire, hazard timings, costs and loot, the tap yield, rich veins, expedition loot and injury odds, PvE rest
times and hunt points, rivals, PvP points and loot, war/hunt decay and world growth, the guild member rate, License
level and project HENIUM, refunds, offline hours, hunger, market-maker noise and the rotating missions. systems.js,
state.js, farm.js and dex.js read them from there, and the wiki shows them live (`const RULE = D.rules`). In a view,
read these values (e.g. `D.rules.specLv`, `D.rules.pvp.pts`, `D.rules.refund`) instead of hard-coding a number, so the
screen stays right when the balance changes. Loot entries are functions of the player's depth (`D.rules.supply.loot(d)`).
