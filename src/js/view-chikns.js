// Chikn NFT screen: flock stats (coop, squad, eggs per day, nest, rent income), renting & buying NFTs (limited by the
// coop), rentals (Chikns you rent, yours rented out for passive EGG), the Mining Team
// (squad slots), roster grid with filters and sorting, a detail modal per Chikn (weight, eggs per day, feeding,
// squad toggle) and the rarity & role guides. Level follows weight; EGG is laid per farm day.
(() => {
const G = window.G, D = G.D, ui = G.ui, esc = ui.esc, F = D.farm;
const RANK = Object.fromEntries(D.rarities.map((r, i) => [r.id, i]));
const FILTERS = [['all', 'All'], ['squad', 'Squad'], ['idle', 'Idle'], ['exp', 'Expedition'], ['injured', 'Recovering'], ['rented', 'Rented'], ['away', 'Rented out']];
const inFilter = (c, f) => f === 'all' || (f === 'rented' ? !!c.rent : c.status === f);
const SORTS = [['rarity', 'Rarity'], ['level', 'Level'], ['weight', 'Weight']];
const BONUS_TYPES = [...new Set(Object.values(D.roles).map((r) => r.bonus))].filter((b) => b !== 'all');
const bonusLabel = (t) => Object.values(D.roles).find((r) => r.bonus === t).label;
const MAX_SLOTS = D.squadSlots(999);
const unlockLv = (i) => { for (let lv = 1; lv < 999; lv++) if (D.squadSlots(lv) > i) return lv; return 999; };
const odds = (w, i) => {
  const t = w.reduce((a, b) => a + b, 0), p = t ? w[i] / t * 100 : 0;
  return p ? (p < 10 ? p.toFixed(1).replace(/\.0$/, '') : Math.round(p)) + '%' : '—';
};
const num = (n) => (Math.abs(n) < 1e6 ? G.fmtFull(Math.round(n)) : G.fmt(n)); // exact digits until it gets long
const kgOf = (c) => c.kg || G.kgStart(c);
const fmtKg = (v) => G.fmtFull(Math.round(v)) + ' kg';
const fmtEgg = (v) => G.fmt(v, 1); // eggs per farm day, one decimal
const cmp = {
  rarity: (a, b) => RANK[b.rarity] - RANK[a.rarity] || b.lv - a.lv || a.id - b.id,
  level: (a, b) => b.lv - a.lv || RANK[b.rarity] - RANK[a.rarity] || a.id - b.id,
  weight: (a, b) => kgOf(b) - kgOf(a) || RANK[b.rarity] - RANK[a.rarity] || a.id - b.id,
};
let filter = 'all', sort = 'rarity', sig = '', openId = null;

const roster = () => G.S.chikns.filter((c) => inFilter(c, filter)).sort(cmp[sort]);
const sigOf = () => {
  const S = G.S;
  return S.chikns.map((c) => c.id + c.status + c.lv + ':' + Math.floor(kgOf(c) / 10) + (c.rent ? 'r' + (c.rent.auto ? 1 : 0) + Math.floor(c.rent.left / 86400) : '')
    + (c.lease ? 'l' + (c.lease.left == null ? 'w' : Math.floor(c.lease.left / 86400)) : '')).join() + '|' + S.squad.join() + '|' + G.squadSlots() + '|' + G.coopCap() + '|' + (S.farm.hungry ? 1 : 0);
};
const cardAttrs = (c) => `data-a="ckOpen" data-args='[${c.id}]' title="${esc(c.name)}: tap for details" data-kg="${fmtKg(kgOf(c))}"`;
const coopFull = () => G.S.chikns.length >= G.coopCap();
// Up to n feedings (stops at max weight); every feeding adds D.farm.step kg and costs more FEED the heavier the Chikn is.
const feedPlan = (c, n) => {
  const cap = G.kgCap(c);
  let w = kgOf(c), cost = 0, k = 0;
  while (k < n && w < cap) { cost += G.feedCost({ ...c, kg: w }); w = Math.min(cap, w + F.step); k++; }
  return { k, cost, kg: w };
};
const atKg = (c, w) => { const x = { ...c, kg: w }; G.syncLv(x); return x; }; // the Chikn at another weight (level follows weight)
// The weight at which the Chikn reaches its next level (null at max level / max weight).
const nextLvKg = (c) => { const cap = G.kgCap(c); for (let w = Math.floor(kgOf(c)) + 1; w <= cap; w++) if (atKg(c, w).lv > c.lv) return w; return null; };

ui.binders.ckNest = (el) => { const i = el.firstElementChild; if (i) i.style.width = Math.min(100, G.S.nest / G.nestCap() * 100) + '%'; };
ui.binders.ckNestV = (el) => { el.textContent = `${Math.floor(G.S.nest)} / ${Math.floor(G.nestCap())}`; };
ui.binders.ckNestBtn = (el) => { el.classList.toggle('cant', G.S.nest < 1); };
// weight bar in the detail modal (Chikns slowly lose weight while the flock is hungry)
ui.binders.ckKg = (el, id) => {
  const c = G.chikn(G.S, +id);
  if (!c) return;
  const a = G.kgStart(c), b = G.kgCap(c), w = kgOf(c);
  const i = el.querySelector('i'), t = el.querySelector('b');
  if (i) i.style.width = Math.min(100, (w - a) / Math.max(1, b - a) * 100) + '%';
  if (t) t.textContent = `${Math.round(w)} / ${b} kg`;
};

function headHTML() {
  const S = G.S, free = S.stats.hired === 0, n = S.chikns.length, cap = G.coopCap(), full = n >= cap;
  const acq = (a, cls, art, name, line) => `<button class="btn ${cls} ck-hire-btn ${full ? 'cant' : ''}" data-a="${full ? 'ckCoopFull' : a}" ${full ? 'title="The coop is full: upgrade it on the Farm"' : ''}>
      ${ui.img('chikn/' + art, 'ck-hire-art', '')}<span class="ck-hire-t"><span class="ck-hire-n">${name}</span><span class="ck-hire-c">${full ? 'Coop full' : line}</span></span></button>`;
  const notes = [];
  if (full) notes.push(`<div class="ck-notice ck-n-coop">${ui.img(G.coopImg(), 'ck-n-ic', '')}<span><b>The coop is full (${n}/${cap}).</b> Upgrade the coop on the Farm to house more Chikns.</span>
    <button class="btn sm gold" data-a="ckFarm">Go to Farm</button></div>`);
  if (S.farm.hungry) notes.push(`<div class="ck-notice ck-n-hungry">${ui.icon('feed', 30, 'ck-n-ic')}<span><b>Your Chikns are hungry!</b> There is no FEED for their daily meals, so they are losing weight.</span>
    <button class="btn sm green" data-a="exchangeDlg" data-args='["feed"]'>Get FEED</button></div>`);
  return `<section class="panel ck-head" style="--bg:url(${G.img('bg/hall')})">
    <div class="ck-flock" aria-hidden="true">${ui.img('chikn/engineer', 'ck-f ck-f1')}${ui.img('chikn/miner', 'ck-f ck-f3')}${ui.img('chikn/leader', 'ck-f ck-f2')}</div>
    <div class="ck-head-main">
      <div class="ck-title">${ui.img('ui/chikns', 'ck-title-ic', '')}<div class="ck-title-t"><h1>Chikn NFT</h1>
        <div class="ck-sub">Rent, buy, feed and assign your miners. Every Chikn lays about one EGG a day, heavier ones more, and your Mining Team boosts the whole mine. Rent your own NFTs out for passive EGG.</div></div></div>
      <div class="ck-stats">
        <div class="ck-stat ${full ? 'ck-full' : ''}" title="Chikns in the coop / coop capacity">${ui.img(G.coopImg(), 'ck-stat-ic', '')}<div><div class="ck-sl">Coop</div><div class="ck-sv">${n}<small>/${cap}</small></div></div></div>
        <div class="ck-stat">${ui.img('ui/mines', 'ck-stat-ic', '')}<div><div class="ck-sl">Squad</div><div class="ck-sv">${G.squad().length}<small>/${G.squadSlots()}</small></div></div></div>
        <div class="ck-stat" title="Your flock eats ${G.fmt(G.upkeepPerDay(), 1)} FEED a day">${ui.icon('egg', 34, 'ck-stat-ic')}<div><div class="ck-sl">Eggs / day</div><div class="ck-sv">${fmtEgg(G.eggsPerDay())}</div></div></div>
        ${G.rentIncome() > 0 ? `<div class="ck-stat ck-income" title="Rent from your Chikns that other players are using, after the ${Math.round(D.rent.fee * 100)}% market fee">${ui.icon('egg', 34, 'ck-stat-ic')}<div><div class="ck-sl">Rent income</div><div class="ck-sv">+${fmtEgg(G.rentIncome())}<small>/day</small></div></div></div>` : ''}
        <div class="ck-stat ck-nest">${ui.img('farm/nest', 'ck-stat-ic', '')}<div class="ck-nest-m"><div class="ck-sl">Nest</div>
          <div class="ck-sv">${ui.icon('egg', 18)}<span data-b="ckNestV"></span></div><div class="bar gold ck-nestbar" data-b="ckNest"><i></i></div></div>
          <button class="btn gold sm" data-a="ckCollect" data-b="ckNestBtn">Collect</button></div>
      </div>
      ${notes.join('')}
    </div>
    <div class="ck-hire">${acq('hire', 'green', 'miner', 'Rent a Chikn', free ? 'First rental is FREE!' : 'EGG a day, from other holders')}${acq('buyNftDlg', 'purple', 'leader', 'Buy a Chikn NFT', ui.cost(D.buyNft.cost, 1, 18))}</div>
  </section>`;
}

function teamHTML() {
  const squad = G.squad(), slots = G.squadSlots();
  let cells = '';
  for (let i = 0; i < MAX_SLOTS; i++) {
    const c = squad[i];
    if (c) cells += `<div class="ck-slot">${ui.chiknCard(c, { attrs: cardAttrs(c), noStatus: true })}
      <button class="ck-rm" data-a="toggleSquad" data-args='[${c.id}]' title="Remove from the Mining Team" aria-label="Remove ${esc(c.name)} from the Mining Team">×</button></div>`;
    else if (i < slots) cells += `<button class="ck-slot ck-empty" data-a="ckPick"><span class="ck-plus">+</span><b>Empty Slot</b><span>Assign an idle Chikn</span></button>`;
    else cells += `<div class="ck-slot ck-locked">${ui.img('ui/lock', 'ck-lock', '')}<b>Locked</b><span>Player Lv. ${unlockLv(i)}</span></div>`;
  }
  const chips = BONUS_TYPES.map((t) => [t, G.bonus(t)]).filter(([, v]) => v > 0)
    .map(([t, v]) => `<span class="ck-chip"><b>+${G.fmt(v * 100, 1)}%</b>${bonusLabel(t)}</span>`).join('');
  return `<section class="panel ck-team">
    <div class="panel-h">${ui.img('ui/mines', '', '')}<span class="sp">Mining Team <span class="ck-dimh">(${squad.length}/${slots})</span></span>
      <span class="ck-power">${ui.img('ui/battle', '', '')}<span>Squad power</span><b>${num(G.squadPower())}</b></span></div>
    <div class="ck-slots">${cells}</div>
    <div class="ck-chips"><span class="ck-chips-l">Team bonuses</span>${chips || '<span class="dim">Assign Chikns to boost your mine.</span>'}</div>
  </section>`;
}

// ---------- rentals: Chikns you rent, and yours rented out for passive EGG ----------
const left = (sec) => G.fmtTime(Math.max(0, sec));
function rentalsHTML() {
  const S = G.S, inn = S.chikns.filter((c) => c.rent), out = S.chikns.filter((c) => c.lease);
  const own = S.chikns.filter((c) => c.own !== false && !c.lease && (c.status === 'idle' || c.status === 'squad'));
  const row = (c, right) => `<div class="ck-rent-row rarity-${c.rarity}" ${cardAttrs(c)}>${ui.img('chikn/' + c.role, 'ck-rent-img', '')}
    <div class="ck-rent-t"><b>${esc(c.name)}</b><small style="color:${D.rarity(c.rarity).color}">${D.rarity(c.rarity).name} ${D.roles[c.role].name}</small></div>${right}</div>`;
  const inRows = inn.map((c) => row(c, `<div class="ck-rent-r"><b>${left(c.rent.left)}</b><small>${c.rent.auto ? 'auto-renew' : 'then it goes home'} · ${G.fmt(c.rent.price, 2)} EGG/day</small></div>`)).join('');
  const outRows = out.map((c) => row(c, c.lease.left == null
    ? `<div class="ck-rent-r"><b>Listed</b><small>${G.fmt(c.lease.price, 2)} EGG/day · waiting for a renter (usually within ${G.fmtTime(G.rentWait(c))})</small></div>`
    : `<div class="ck-rent-r"><b class="ck-good">+${G.fmt(c.lease.price * (1 - D.rent.fee), 2)}/day</b><small>${left(c.lease.left)} left · earned ${G.fmt(c.lease.earned, 1)} EGG</small></div>`)).join('');
  const income = G.rentIncome(), spend = G.rentSpend();
  return `<section class="panel ck-rentals">
    <div class="panel-h">${ui.icon('egg', 28)}<span class="sp">Rentals</span><small>${inn.length} rented · ${out.length} of yours on the market</small></div>
    <div class="ck-rent-cols">
      <div class="ck-rent-col"><div class="ck-rent-h">Rented from other holders <small>${spend ? `${G.fmt(spend, 2)} EGG a day` : ''}</small></div>
        ${inRows || `<div class="ck-rent-empty">None. Rented Chikns work and lay EGG for you until the rental ends.</div>`}
        <button class="btn sm green" data-a="hire">Rent a Chikn</button></div>
      <div class="ck-rent-col"><div class="ck-rent-h">Your NFTs for rent: passive income <small>${income ? `<b class="ck-good">+${G.fmt(income, 2)} EGG a day</b>` : ''}</small></div>
        ${outRows || `<div class="ck-rent-empty">List a Chikn you own: it keeps working for you until a renter takes it, then earns you EGG every day without eating your FEED.</div>`}
        ${own.length ? '<button class="btn sm purple" data-a="ckRentPick">Rent out a Chikn</button>' : ''}
        ${S.stats.rentEarned ? `<div class="ck-rent-tot">Earned from rent so far: <b>${G.fmt(S.stats.rentEarned, 1)} EGG</b></div>` : ''}</div>
    </div>
  </section>`;
}

function rosterHTML() {
  const S = G.S, n = { all: S.chikns.length };
  for (const c of S.chikns) { n[c.status] = (n[c.status] || 0) + 1; if (c.rent) n.rented = (n.rented || 0) + 1; }
  const list = roster();
  const tabs = FILTERS.map(([k, l]) => `<button class="tab ${filter === k ? 'on' : ''}" data-a="ckFilter" data-args='["${k}"]'>${l}<span class="ck-n">${n[k] || 0}</span></button>`).join('');
  const sorts = SORTS.map(([k, l]) => `<button class="tab ${sort === k ? 'on' : ''}" data-a="ckSort" data-args='["${k}"]'>${l}</button>`).join('');
  const empty = {
    all: S.stats.hired === 0 ? 'No Chikns yet. Your first rental is free!' : 'No Chikns yet. Rent one to get started.',
    squad: 'Your Mining Team is empty.', idle: 'No idle Chikns. Everyone is busy!',
    exp: 'No Chikns are on an expedition.', injured: 'Nobody is recovering. Great job keeping them safe!',
    rented: 'You are not renting any Chikns.', away: 'None of your Chikns is rented out right now.',
  }[filter];
  const hireBtn = coopFull() ? '<button class="btn gold" data-a="ckFarm">Upgrade the coop</button>' : '<button class="btn gold" data-a="hire">Rent a Chikn</button>';
  return `<section class="panel ck-roster">
    <div class="panel-h">${ui.img('ui/chikns', '', '')}<span class="sp">Roster</span><small>${S.chikns.length} Chikn${S.chikns.length === 1 ? '' : 's'} · ${fmtEgg(G.eggsPerDay())} EGG a day</small></div>
    <div class="ck-tools"><div class="tabs ck-filt">${tabs}</div><div class="tabs ck-sort"><span class="ck-sort-l">Sort</span>${sorts}</div></div>
    ${list.length ? `<div class="ck-grid">${list.map((c) => ui.chiknCard(c, { attrs: cardAttrs(c) })).join('')}</div>`
      : `<div class="empty ck-empty-list">${ui.img('chikn/explorer', 'ck-empty-img', '')}<div>${empty}</div>
        ${filter === 'all' || filter === 'idle' ? hireBtn : ''}</div>`}
  </section>`;
}

function rarityHTML() {
  const std = D.rent.weights, pre = D.buyNft.weights;
  return `<section class="panel ck-legend">
    <div class="panel-h">${ui.img('ui/trophy', '', '')}<span class="sp">Rarity</span><small>Odds</small></div>
    <div class="ck-rhead"><span>Weight & eggs per day</span><span title="Share of each rarity on the rental market">Rent</span><span title="Odds when you buy a Chikn NFT">Buy</span></div>
    ${D.rarities.map((r, i) => {
      const a = G.kgStart({ rarity: r.id }), b = G.kgCap({ rarity: r.id });
      return `<div class="ck-rrow rarity-${r.id}">
      <div class="ck-frame">${ui.img('chikn/miner', '', '')}</div>
      <div class="ck-rinfo"><b style="color:${r.color}">${r.name}</b><span>+${r.pct}% squad bonus</span>
        <span class="ck-rw" title="Weight from ${a} kg (start) up to ${b} kg (fully fed); eggs per day at those weights">
          <span class="ck-rk">${G.fmtFull(a)}–${G.fmtFull(b)} kg</span><span class="ck-re">${ui.icon('egg', 13)}${fmtEgg(F.eggsAt(a))}–${fmtEgg(F.eggsAt(b))}/day</span></span></div>
      <span class="ck-odds">${odds(std, i)}</span><span class="ck-odds pre">${odds(pre, i)}</span></div>`;
    }).join('')}
    <div class="ck-note">Feed Chikns to make them heavier: their level follows their weight, and heavier Chikns lay more EGG every day
      (${F.step * 10} kg ≈ ${fmtEgg(F.eggsAt(F.step * 10))}, ${F.step * 40} kg ≈ ${fmtEgg(F.eggsAt(F.step * 40))} a day).</div>
  </section>`;
}

function rolesHTML() {
  const S = G.S;
  return `<section class="panel ck-roles">
    <div class="panel-h">${ui.img('ui/crafting', '', '')}<span class="sp">Role Guide</span><small>Squad bonus</small></div>
    <div class="ck-rolegrid">${Object.entries(D.roles).map(([id, r]) => {
      const n = S.chikns.filter((c) => c.role === id).length;
      return `<div class="ck-role" ${r.bonus === 'all' ? 'title="Leaders add half their bonus to mining, machines, factories, refining, crafting and expeditions"' : ''}>
        ${ui.img('chikn/' + id, 'ck-role-img', r.name)}<div class="ck-role-t"><b>${r.name}</b><span>${r.label}</span></div>
        <span class="ck-own ${n ? '' : 'none'}">×${n}</span></div>`;
    }).join('')}</div>
  </section>`;
}

// ---------- detail modal ----------
function detailHTML(c) {
  const S = G.S, R = D.rarity(c.rarity), role = D.roles[c.role];
  const a = G.kgStart(c), cap = G.kgCap(c), w = kgOf(c), maxed = w >= cap;
  const p1 = feedPlan(c, 1), p5 = feedPlan(c, 5), nk = nextLvKg(c), nl = nk ? atKg(c, nk) : null;
  const list = roster(), i = list.findIndex((x) => x.id === c.id);
  const exp = c.status === 'exp' ? S.exps.find((e) => e.ids.includes(c.id)) : null;
  const status = {
    squad: '<span class="tag g">In Mining Team</span>',
    idle: '<span class="tag">Idle</span>',
    exp: `<span class="tag o">Exploring${exp ? ' ' + esc(G.expSite(exp.site).name) : ''}</span>`,
    injured: `<span class="tag r">Recovering · <span data-b="until:${c.until}"></span></span>`,
    away: '<span class="tag p">Rented out</span>',
  }[c.status] || '';
  const full = S.squad.length >= G.squadSlots();
  const squadBtn = c.status === 'squad' ? `<button class="btn red" data-a="ckSquad" data-args='[${c.id}]'>Remove from Team</button>`
    : c.status === 'idle' ? `<button class="btn ${full ? 'cant' : ''}" data-a="ckSquad" data-args='[${c.id}]' ${full ? 'title="Your Mining Team is full"' : ''}>Add to Mining Team</button>`
    : `<button class="btn gray" disabled>${c.status === 'exp' ? 'On expedition' : c.status === 'away' ? 'Rented out' : 'Recovering'}</button>`;
  const rentBox = rentBoxHTML(c);
  // next: [label, value] shown under the stat, or null when there is nothing more to gain
  const stat = (lbl, cur, next, sub, cls = '') => `<div class="ck-ds ${cls}"><span class="ck-ds-l">${lbl}</span><b class="ck-ds-v">${cur}</b>
    <span class="ck-ds-s">${sub}</span>${next ? `<span class="ck-ds-n">${next[0]} <b>${next[1]}</b></span>` : `<span class="ck-ds-n">${maxed ? 'Max weight' : 'Max level'}</span>`}</div>`;
  const gain5 = Math.round(p5.kg - w);
  return `<div class="ck-det rarity-${c.rarity}">
    <div class="ck-det-art"><div class="ck-rays"></div><div class="ck-shine"></div>${ui.img('chikn/' + c.role, 'ck-det-img', role.name)}
      <span class="ck-det-lv">Lv. ${c.lv}</span><span class="ck-det-kg">${ui.img('farm/scale', '', '')}${fmtKg(w)}</span><span class="ck-det-rar">${R.name}</span></div>
    <div class="ck-det-info">
      <div class="ck-det-h"><div class="ck-det-name">${esc(c.name)} <span class="dim">#${c.num}</span></div>
        <div class="ck-det-sub"><b style="color:${R.color}">${R.name}</b><span>·</span><span>${role.name}</span>${status}</div></div>
      <div class="ck-wrow">${ui.img('farm/scale', 'ck-w-ic', '')}<div class="ck-w-m">
        <div class="ck-w-t"><span class="ck-w-l">Weight</span><span class="ck-lvchip" title="A Chikn's level follows its weight">Lv. ${c.lv} <small>from weight</small></span></div>
        ${ui.bar((w - a) / Math.max(1, cap - a) * 100, 'gold lg ck-wbar', `${Math.round(w)} / ${cap} kg`, `data-b="ckKg:${c.id}"`)}
        <div class="ck-w-s">Starts at ${a} kg · ${nk ? `Lv. ${nl.lv} at <b>${nk} kg</b>` : `max ${cap} kg`} · eats ${G.fmt(F.upkeep(w), 1)} FEED a day</div></div></div>
      <div class="ck-dstats">
        ${stat('Bonus', '+' + G.fmt(G.chiknPct(c), 1) + '%', nl && [`Lv. ${nl.lv}`, '+' + G.fmt(G.chiknPct(nl), 1) + '%'], esc(role.label), 'good')}
        ${stat('Power', G.fmtFull(G.chiknPower(c)), nl && [`Lv. ${nl.lv}`, G.fmtFull(G.chiknPower(nl))], 'Battle strength')}
        ${stat('Eggs / day', fmtEgg(G.chiknEgg(c)), !maxed && [`+${Math.round(p1.kg - w)} kg`, fmtEgg(F.eggsAt(p1.kg))], 'Laid into the nest', 'egg')}
      </div>
      ${rentBox}
      ${S.farm.hungry ? `<div class="ck-hungry">${ui.icon('feed', 22)}<span><b>Hungry!</b> No FEED for daily meals: your Chikns are slowly losing weight.</span></div>` : ''}
      <div class="ck-det-acts ck-feeds">
        ${c.rent ? '<button class="btn gray lg" disabled title="The weight of a rented NFT belongs to its holder">Rented Chikns can\'t be fattened</button>'
          : c.status === 'away' ? '<button class="btn gray lg" disabled>Rented out: feed it when it is back</button>'
          : maxed ? '<button class="btn gold lg" disabled>★ Max weight reached</button>'
          : `<button class="btn green lg ck-feed" data-a="ckFeed" data-args='[${c.id},1]' data-need="feed:${p1.cost}" title="Feed ${esc(c.name)}: +${F.step} kg for ${p1.cost} FEED">${ui.img('res/feed', '', '')}<span class="ck-feed-t">Feed<small>+${F.step} kg</small></span>${ui.cost({ feed: p1.cost }, 1, 18)}</button>
            ${p5.k > 1 ? `<button class="btn green ck-feed ck-feed5" data-a="ckFeed" data-args='[${c.id},${p5.k}]' data-need="feed:${p5.cost}" title="Feed ${p5.k} times: +${gain5} kg for ${p5.cost} FEED">
              <span class="ck-feed-t">×${p5.k}<small>+${gain5} kg</small></span>${ui.cost({ feed: p5.cost }, 1, 18)}</button>` : ''}`}
      </div>
      <div class="ck-det-acts">${squadBtn}<button class="btn purple ck-farm" data-a="ckFarm" title="Collect eggs, upgrade the coop and grind FEED">${ui.img('farm/nest', '', '')}Egg Farm</button></div>
      <div class="ck-det-foot"><span class="dim">You own ${ui.icon('feed', 16)} <span data-b="res:feed"></span> FEED</span>
        ${list.length > 1 && i >= 0 ? `<span class="ck-det-nav"><button class="btn sm gray ff" data-a="ckNav" data-args='[-1]' aria-label="Previous Chikn">◀</button><span class="dim">${i + 1} / ${list.length}</span><button class="btn sm gray ff" data-a="ckNav" data-args='[1]' aria-label="Next Chikn">▶</button></span>` : ''}</div>
    </div>
  </div>`;
}
// ownership & rental box in the detail modal
function rentBoxHTML(c) {
  if (c.rent) return `<div class="ck-rentbox ck-rb-in"><div><b>Rented</b> from holder ${c.rent.owner} · <b>${left(c.rent.left)}</b> left · ${G.fmt(c.rent.price, 2)} EGG a day
      <label class="ck-auto"><input type="checkbox" data-a="ckAuto" data-args='[${c.id}]' ${c.rent.auto ? 'checked' : ''}> Renew automatically</label></div>
    <div class="ck-rb-btns">${D.rent.days.map((d) => `<button class="btn sm green" data-a="ckExtend" data-args='[${c.id},${d}]' data-need="egg:${D.rentCost(c.rent.price || G.rentPrice(c), d)}">+${d}d · ${ui.cost({ egg: D.rentCost(c.rent.price || G.rentPrice(c), d) }, 1, 14)}</button>`).join('')}</div></div>`;
  if (c.lease && c.lease.left == null) return `<div class="ck-rentbox ck-rb-out"><div><b>Listed for rent</b>: ${G.fmt(c.lease.price, 2)} EGG a day for ${c.lease.days} day${c.lease.days === 1 ? '' : 's'}. It keeps working for you until a renter takes it (usually within ${G.fmtTime(G.rentWait(c))}).</div>
    <div class="ck-rb-btns"><button class="btn sm red" data-a="ckCancelRent" data-args='[${c.id}]'>Cancel listing</button></div></div>`;
  if (c.lease) return `<div class="ck-rentbox ck-rb-out"><div><b>Rented out</b> to ${c.lease.renter}: <b class="ck-good">+${G.fmt(c.lease.price * (1 - D.rent.fee), 2)} EGG a day</b> for you, ${left(c.lease.left)} left · earned ${G.fmt(c.lease.earned, 1)} EGG so far. It comes back exactly as it left.</div></div>`;
  if (c.own === false) return '';
  const can = c.status === 'idle' || c.status === 'squad';
  return `<div class="ck-rentbox"><div><b>Your NFT.</b> Rent it out for passive income: about <b>${G.fmt(G.rentPrice(c) * (1 - D.rent.fee), 2)} EGG a day</b> at today's market price, and it doesn't eat your FEED while it is away.</div>
    <div class="ck-rb-btns"><button class="btn sm purple ${can ? '' : 'cant'}" data-a="ckRentOut" data-args='[${c.id}]' ${can ? '' : 'title="Wait until it is back"'}>Rent it out</button></div></div>`;
}
function openDetail(id) {
  if (!G.chikn(G.S, id)) return;
  ui.modal({ wide: true, actions: [], html: `<div id="ck-det">${detailHTML(G.chikn(G.S, id))}</div>`, onClose: () => { openId = null; } });
  openId = id;
}
function refreshDetail(flash) {
  const box = document.getElementById('ck-det'), c = openId != null && G.chikn(G.S, openId);
  if (!box || !c) return;
  box.innerHTML = detailHTML(c);
  if (flash) box.querySelector('.ck-det-art').classList.add('ck-flash');
  ui.refresh();
}

// ---------- handlers ----------
ui.handlers.ckOpen = (el, e, id) => { G.sfx('click'); openDetail(id); };
ui.handlers.ckFilter = (el, e, k) => { filter = k; G.sfx('click'); ui.render(); };
ui.handlers.ckSort = (el, e, k) => { sort = k; G.sfx('click'); ui.render(); };
ui.handlers.ckNav = (el, e, dir) => {
  const list = roster(), i = list.findIndex((x) => x.id === openId);
  if (i < 0 || list.length < 2) return;
  openId = list[(i + dir + list.length) % list.length].id;
  G.sfx('click');
  refreshDetail();
};
ui.handlers.ckFeed = (el, e, id, times = 1) => {
  const c = G.chikn(G.S, id);
  if (!c) return;
  const lv0 = c.lv, kg0 = kgOf(c);
  const r = G.act.feed(id, times);
  if (!r.ok) { ui.toast(r.msg, 'bad', 'res/feed'); G.sfx('err'); return; }
  const [x, y] = ui.centerOf(el);
  ui.float(`+${Math.round(r.kg - kg0)} kg`, x, y - 22, '#ffe27a');
  if (r.lv > lv0) setTimeout(() => ui.float(`Lv. ${r.lv}!`, x, y - 48, '#9dff8a'), 240);
  ui.sparks(x, y, '#ffd54a', 8 + 2 * r.done);
  G.sfx(r.lv > lv0 ? 'up' : 'ok');
  if (r.done < times) ui.toast(r.kg >= G.kgCap(c) ? `${c.name} reached max weight (${fmtKg(r.kg)})!` : `${c.name} ate ${r.done}× for ${G.fmt(r.spent)} FEED, then the FEED ran out`, r.kg >= G.kgCap(c) ? 'good' : '', 'res/feed');
  refreshDetail(true);
  ui.render();
};
ui.handlers.ckSquad = (el, e, id) => {
  const c = G.chikn(G.S, id), was = c && c.status === 'squad';
  const r = G.act.toggleSquad(id);
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
  G.sfx('ok');
  ui.toast(was ? `${c.name} left the Mining Team` : `${c.name} joined the Mining Team!`, was ? '' : 'good', 'chikn/' + c.role);
  refreshDetail();
  ui.render();
};
ui.handlers.ckPick = () => {
  const idle = G.S.chikns.filter((c) => c.status === 'idle').sort(cmp.rarity);
  ui.modal({ title: `${ui.img('ui/chikns', '', '')} Assign to Mining Team`, wide: true, actions: [{ label: 'Close', cls: 'gray' }],
    html: idle.length ? `<p class="muted" style="margin-top:0">Pick an idle Chikn. Squad Chikns boost your whole mine with their role bonus.</p>
      <div class="ck-grid ck-pick">${idle.map((c) => ui.chiknCard(c, { attrs: `data-a="ckAssign" data-args='[${c.id}]'`, noStatus: true })).join('')}</div>`
      : `<div class="empty">No idle Chikns right now.<div style="margin-top:10px">${coopFull() ? '<button class="btn gold" data-a="ckFarm">Upgrade the coop</button>' : '<button class="btn gold" data-a="hire">Rent a Chikn</button>'}</div></div>` });
};
ui.handlers.ckAssign = (el, e, id) => {
  const c = G.chikn(G.S, id), r = G.act.toggleSquad(id);
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
  ui.closeModal();
  G.sfx('ok');
  ui.toast(`${c.name} joined the Mining Team!`, 'good', 'chikn/' + c.role);
  ui.render();
};
ui.handlers.ckCollect = (el) => {
  const r = G.act.collectNest();
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
  const [x, y] = ui.centerOf(el);
  ui.float(`+${G.fmt(r.n)}${ui.icon('egg', 20)}`, x, y - 20);
  ui.sparks(x, y, '#ffd27a', 12);
  G.sfx('coin');
  ui.refresh();
};
// ---------- renting out ----------
let outDays = 7, outK = 1;
function rentOutHTML(c) {
  const fair = G.rentPrice(c), price = Math.round(fair * outK * 100) / 100, wait = D.rent.wait * Math.pow(outK, D.rent.elastic);
  const total = price * outDays * (1 - D.rent.fee);
  const days = D.rent.days.map((d) => `<button type="button" class="tab ${outDays === d ? 'on' : ''}" data-odays="${d}">${d} day${d === 1 ? '' : 's'}</button>`).join('');
  const ks = D.rent.priceK.map((k) => `<button type="button" class="tab ${outK === k ? 'on' : ''}" data-ok="${k}">${k === 1 ? 'Market' : (k > 1 ? '+' : '−') + Math.round(Math.abs(k - 1) * 100) + '%'}</button>`).join('');
  return `<div class="ck-ro">${ui.chiknCard(c, { noStatus: true })}<div class="ck-ro-m">
    <p class="muted" style="margin-top:0">List <b>${esc(c.name)}</b> on the rental market. It keeps working for you until a renter takes it. While it is rented out it works and lays EGG for the renter, doesn't eat your FEED, and earns you rent every day, also while you are offline. It comes back exactly as it left.</p>
    <div class="ck-ro-l">Length</div><div class="tabs">${days}</div>
    <div class="ck-ro-l">Price <small>market: ${G.fmt(fair, 2)} EGG a day</small></div><div class="tabs">${ks}</div>
    <div class="ck-ro-sum"><div><span>Rent</span><b>${G.fmt(price, 2)} EGG a day</b></div><div><span>You get</span><b class="ck-good">${G.fmt(price * (1 - D.rent.fee), 2)} EGG a day</b></div>
      <div><span>Whole rental</span><b>${G.fmt(total, 1)} EGG</b></div><div><span>A renter usually within</span><b>${G.fmtTime(wait)}</b></div></div>
    <small class="dim">${Math.round(D.rent.fee * 100)}% market fee is burned. A higher price waits longer for a renter.</small>
    <button class="btn purple lg block" data-ro="${c.id}" style="margin-top:10px">List for rent</button></div></div>`;
}
ui.handlers.ckRentOut = (el, e, id) => {
  const c = G.chikn(G.S, id);
  if (!c) return;
  ui.modal({ title: `${ui.icon('egg', 26)} Rent out ${esc(c.name)}`, wide: true, actions: [], html: `<div id="ck-ro">${rentOutHTML(c)}</div>` });
  const box = ui.modalEl(), redraw = () => { const w = box.querySelector('#ck-ro'); if (w) w.innerHTML = rentOutHTML(c); };
  box.addEventListener('click', (ev) => {
    const d = ev.target.closest('[data-odays]'), k = ev.target.closest('[data-ok]'), go = ev.target.closest('[data-ro]');
    if (d) { outDays = +d.dataset.odays; redraw(); return; }
    if (k) { outK = +k.dataset.ok; redraw(); return; }
    if (!go) return;
    const r = G.act.listRent(c.id, outDays, outK);
    if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
    ui.closeModal(); G.sfx('ok');
    ui.toast(`${c.name} is listed for ${G.fmt(r.price, 2)} EGG a day. You'll get a message when a renter takes it.`, 'good', 'res/egg', 3.6);
    ui.render();
  });
};
ui.handlers.ckRentPick = () => {
  const own = G.S.chikns.filter((c) => c.own !== false && !c.lease && (c.status === 'idle' || c.status === 'squad')).sort(cmp.rarity);
  ui.modal({ title: `${ui.icon('egg', 26)} Rent out a Chikn`, wide: true, actions: [{ label: 'Close', cls: 'gray' }],
    html: `<p class="muted" style="margin-top:0">Pick one of your own Chikn NFTs (rented ones can't be rented out).</p>
      <div class="ck-grid ck-pick">${own.map((c) => ui.chiknCard(c, { attrs: `data-a="ckRentOut" data-args='[${c.id}]'` })).join('')}</div>` });
};
ui.handlers.ckCancelRent = (el, e, id) => {
  const r = G.act.cancelRent(id);
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
  G.sfx('ok'); refreshDetail(); ui.render();
};
ui.handlers.ckExtend = (el, e, id, days) => {
  const c = G.chikn(G.S, id), r = G.act.extendRent(id, days);
  if (!r.ok) { ui.toast(r.msg, 'bad', 'res/egg'); G.sfx('err'); return; }
  G.sfx('coin'); ui.toast(`${c.name} stays ${days} more day${days === 1 ? '' : 's'} (−${r.cost} EGG)`, 'good', 'res/egg');
  refreshDetail(); ui.render();
};
ui.handlers.ckAuto = (el, e, id) => { const r = G.act.autoRenew(id); if (r.ok) { G.sfx('click'); ui.toast(r.auto ? 'Auto-renew on: the rental renews when it ends, if you have the EGG' : 'Auto-renew off: the Chikn goes home when the rental ends', '', 'res/egg'); } refreshDetail(); };
// Renting and buying are limited by the coop: point the player to the Farm.
ui.handlers.ckCoopFull = () => {
  G.sfx('err');
  ui.toast(`The coop is full (${G.S.chikns.length}/${G.coopCap()}). Upgrade it on the Farm to rent or buy more Chikns.`, 'bad', G.coopImg(), 3.4);
};
ui.handlers.ckFarm = () => {
  if (!ui.views.farm) { ui.toast('The Egg Farm is not open yet', '', 'farm/nest'); return; }
  ui.closeModal();
  ui.go('farm');
};
document.addEventListener('keydown', (e) => {
  if (ui.cur !== 'chikns' || openId == null || !document.getElementById('ck-det')) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') ui.handlers.ckNav(null, e, e.key === 'ArrowLeft' ? -1 : 1);
});

ui.views.chikns = {
  render(el) {
    sig = sigOf();
    el.innerHTML = `${headHTML()}<div class="ck-page"><div class="ck-main">${teamHTML()}${rentalsHTML()}${rosterHTML()}</div>
      <aside class="ck-side">${rarityHTML()}${rolesHTML()}</aside></div>`;
  },
  update() { // re-render when chikns are hired, return from expeditions, recover, change weight/level, or the coop/hunger changes
    if (sigOf() === sig) return;
    ui.render();
    refreshDetail();
  },
};
})();
