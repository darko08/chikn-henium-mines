// Egg farm: Chikn weight (kg), daily egg laying, FEED upkeep and hunger, feeding, coop capacity, Feed Mill quota.
// Every Chikn lays about 1 EGG per farm day; heavier Chikns lay more with diminishing returns (D.farm.eggsAt).
// FEED is the brake: Chikns eat it every day to keep their weight, so the FEED supply caps total egg output.
(() => {
const G = window.G, D = G.D, F = D.farm;
const fail = (msg) => ({ ok: false, msg });

G.kgStart = (c) => D.rarity(c.rarity).kg0;
G.kgCap = (c) => Math.round(D.rarity(c.rarity).kgMax * (G.specIs('farmer') ? 1.25 : 1));
// a Chikn's level follows its weight: heavier = stronger bonus, more battle power
G.syncLv = (c) => {
  const a = G.kgStart(c), b = G.kgCap(c);
  c.lv = Math.max(1, Math.min(D.chiknMaxLv, 1 + Math.floor(29 * (c.kg - a) / Math.max(1, b - a))));
};
G.ensureKg = (c) => {
  if (c.kg > 0) return;
  const R = D.rarity(c.rarity);
  c.kg = Math.round(R.kg0 + (R.kgMax - R.kg0) * ((c.lv || 1) - 1) / 29);
};
G.chiknEgg = (c) => F.eggsAt(c.kg || G.kgStart(c));                 // EGG per farm day
// a Chikn you rented out lays and eats at its renter's farm, not yours
const home = () => G.S.chikns.filter((c) => c.status !== 'away');
G.eggsPerDay = () => home().reduce((s, c) => s + G.chiknEgg(c), 0);
G.eggRate = () => G.eggsPerDay() / F.day;                              // EGG per second
G.upkeepPerDay = () => home().reduce((s, c) => s + F.upkeep(c.kg || G.kgStart(c)), 0);
G.nestCap = () => Math.max(2, G.eggsPerDay() * F.nestDays * (G.specIs('farmer') ? 2 : 1));
G.feedCost = (c) => Math.max(1, Math.ceil(F.step * F.feedPerKg(c.kg) * (G.specIs('farmer') ? 0.8 : 1) *
  (G.liveEvent() && G.liveEvent().id === 'feast' ? 0.7 : 1)));
G.coopCap = () => F.coop(G.S.farm.coopLv);
G.millQuota = () => F.millQuota(Math.max(1, G.S.factories.feedmill.lv));
G.queuedFeed = () => G.S.jobs.filter((j) => j.f === 'feedmill').reduce((s, j) => s + (j.feed || 0), 0);
G.feedDaysLeft = () => { const u = G.upkeepPerDay(); return u > 0 ? G.S.res.feed / u : Infinity; };
G.farmDayLeft = () => F.day - G.S.farm.dayT;                           // seconds until the next farm day

G.farmTick = (dt, offline) => {
  const S = G.S, fm = S.farm;
  fm.dayT += dt;
  while (fm.dayT >= F.day) { fm.dayT -= F.day; fm.day++; fm.milled = 0; G.emit('farmDay', fm.day, offline); } // also while away: daily payouts and decay must not be skipped
  // eggs go into the nest up to its capacity; the rest is lost (counted, so the player can be told). The nest never
  // shrinks on its own: a smaller capacity (lighter or fewer Chikns) only stops new eggs.
  const add = G.eggRate() * dt, room = Math.max(0, G.nestCap() - S.nest), laid = Math.min(add, room);
  S.nest += laid; fm.laid = (fm.laid || 0) + laid; if (add > laid) fm.lost = (fm.lost || 0) + (add - laid);
  if (add > laid && !fm.fullSaid) { fm.fullSaid = true; if (!offline) G.emit('nestFull'); }
  const need = G.upkeepPerDay() * dt / F.day;
  if (S.res.feed >= need) { S.res.feed -= need; fm.hungry = false; return; }
  S.res.feed = 0;
  if (!fm.hungry && !offline) G.emit('hungry');
  fm.hungry = true;
  for (const c of home()) {
    if (c.rent) continue; // a rented Chikn never loses weight at your farm: the NFT goes back to its owner unchanged
    const a = G.kgStart(c);
    c.kg = Math.max(a, c.kg - ((c.kg - a) * F.hunger + D.rules.hungerFlat) * dt / F.day);
    G.syncLv(c);
  }
};

// Feeding (replaces the old level-up): +10 kg per feeding; each kg costs more FEED the heavier the Chikn is.
G.act.feed = (cid, times = 1) => {
  const S = G.S, c = G.chikn(S, cid);
  if (!c) return fail('Chikn not found');
  if (c.rent) return fail(`${c.name} is rented: only its owner can fatten it`);
  if (c.status === 'away') return fail(`${c.name} is rented out: feed it when it is back`);
  let done = 0, spent = 0;
  for (let i = 0; i < times; i++) {
    if (c.kg >= G.kgCap(c)) break;
    const cost = G.feedCost(c);
    if (S.res.feed < cost) break;
    S.res.feed -= cost; spent += cost;
    c.kg = Math.min(G.kgCap(c), c.kg + F.step);
    done++;
  }
  if (!done) return fail(c.kg >= G.kgCap(c) ? `${c.name} is already at max weight` : `Not enough FEED (needs ${G.feedCost(c)})`);
  G.syncLv(c); G.addXP(4 * done); G.emit('res');
  return { ok: true, kg: c.kg, lv: c.lv, done, spent };
};
G.act.upgradeCoop = () => {
  const fm = G.S.farm;
  if (fm.coopLv >= F.coopMax) return fail('The coop is already at max level');
  const cost = F.coopCost(fm.coopLv);
  if (!G.pay(cost)) return fail('Not enough ' + G.missing(cost).map((r) => D.res[r].name).join(', '));
  fm.coopLv++; G.addXP(40);
  return { ok: true, lv: fm.coopLv };
};
})();
