// Farm screen ("Egg Farm"): the farmyard (coop, Chikns, nest), farm stats, the fattening pen (feed Chikns with FEED,
// +10 kg per feeding, sorting, "Fatten all"), a weigh-in scale, the coop, the Feed Mill (daily FEED quota), the egg
// market and an explainer of the egg economy. EGG is scarce: each Chikn lays about one a day, heavier ones a bit more.
(() => {
const G = window.G, D = G.D, ui = G.ui, esc = ui.esc, F = D.farm;
const MILL = D.factoryById('feedmill'), REC = MILL.recipes[0];
const WORLD_CHIKNS = 22000;   // Chikn NFTs in the real collection
const RESERVE_DAYS = 2;       // "Fatten all" keeps this many days of FEED upkeep in stock
const DIAL_MAX = 1000;        // the scale's dial reads 0–1,000 kg ...
const SWEEP = 135;            // ... with the needle swinging from −135° to +135°
const SPOTS = [[14, 16], [42, 30], [57, 6], [80, 22], [28, 1], [94, 4]]; // yard spots [left %, bottom %] in the yard box
const TAGS = { squad: '<span class="tag g">Squad</span>', exp: '<span class="tag o">Expedition</span>', injured: '<span class="tag r">Recovering</span>' };
const SELL = [5, 20, 100];    // EGG amounts for "Sell EGG for HENIUM" on the DEX
let sortBy = 'kg', desc = true, scaleId = null;
let sig = '', millSig = '', eggSeen = -1, needleAt = -SWEEP, fatKey = '', fatPlan = null;
let seen = { S: null, coop: 0, day: 0 };
const effects = []; // visual effects to play after the next render ({t, S, ...})

// ---------- helpers ----------
const one = (n) => (n >= 100 ? G.fmtFull(Math.round(n)) : (Math.round(n * 10) / 10).toFixed(1)); // per-day rates
const two = (n) => (Math.round(n * 100) / 100).toFixed(2);                                        // next-feeding preview
const kgs = (kg) => G.fmtFull(Math.round(kg));
const whole = (n) => G.fmtFull(Math.floor(n + 1e-9));
const daysTxt = (d) => (!isFinite(d) ? '∞' : d < 10 ? (Math.floor(d * 10) / 10).toFixed(1) : G.fmtFull(Math.floor(d)));
const plural = (n, w) => `${G.fmtFull(n)} ${w}${n === 1 ? '' : 's'}`;
const setT = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
const q = (sel, root = document) => root.querySelector(sel);
const atMax = (c) => c.kg >= G.kgCap(c) - 1e-6;
const growth = (c) => { const a = G.kgStart(c), b = G.kgCap(c); return Math.max(0, Math.min(1, (c.kg - a) / Math.max(1, b - a))); };
const fatness = (c) => (1 + 0.14 * growth(c)).toFixed(3); // chunkier art the closer a Chikn is to its max weight
const hasArt = (key) => !!(G.ASSETS && G.ASSETS[key]);
const millRun = () => { const S = G.S; return S.factories.feedmill.lv > 0 ? G.recipeOut(MILL, REC).feed : 0; };
const inView = (el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; };
// EGG -> HENIUM goes through the DEX when it exists (core rejects the old 'e2h' burn then); otherwise the burn exchange
const dexOn = () => typeof G.act.swap === 'function' && typeof G.dexQuote === 'function' && !!(G.S && G.S.dex);
const eggQuote = (amt) => { const r = dexOn() && G.dexQuote('egg', 'henium', amt); return r ? r.out : 0; };
const hen = (n) => (n >= 100 ? G.fmt(n) : n.toFixed(n >= 10 ? 1 : 2));
const marketView = () => (ui.views.dex ? 'dex' : 'market');

// Natural pixel size of a WebP data URI (read from its header). Building art keeps its natural size ratio, since
// higher levels are drawn bigger; CSS scales it per context with --fm-k.
const natCache = {};
function natSize(key) {
  if (natCache[key]) return natCache[key];
  const uri = G.img(key), i = uri.indexOf(',') + 1;
  let s = null;
  try {
    const b = atob(uri.slice(i, i + 48)), u = (k) => b.charCodeAt(k), t = b.slice(12, 16);
    if (t === 'VP8X') s = { w: 1 + (u(24) | u(25) << 8 | u(26) << 16), h: 1 + (u(27) | u(28) << 8 | u(29) << 16) };
    else if (t === 'VP8L') { const v = u(21) | u(22) << 8 | u(23) << 16 | u(24) << 24; s = { w: 1 + (v & 0x3fff), h: 1 + ((v >>> 14) & 0x3fff) }; }
    else if (t === 'VP8 ') s = { w: (u(26) | u(27) << 8) & 0x3fff, h: (u(28) | u(29) << 8) & 0x3fff };
  } catch (e) { s = null; }
  return (natCache[key] = s && s.w > 0 && s.h > 0 ? s : { w: 240, h: 190 });
}
const natImg = (key, cls = '', alt = '') => { const s = natSize(key);
  return `<img class="fm-nat ${cls}" src="${G.img(key)}" width="${s.w}" height="${s.h}" style="--fm-nw:${s.w}" alt="${esc(alt)}" draggable="false">`; };

// cost and result of `n` feedings in a row (stops at max weight), without changing anything
function feedPlan(c, n) {
  const cap = G.kgCap(c);
  let kg = c.kg, cost = 0, done = 0;
  while (done < n && kg < cap - 1e-6) { cost += G.feedCost({ ...c, kg }); kg = Math.min(cap, kg + F.step); done++; }
  return { cost, kg, done };
}
// "Fatten all": feed the lightest Chikn, again and again, while RESERVE_DAYS of upkeep stay in stock
function fattenPlan() {
  const S = G.S, flock = S.chikns.filter((c) => !c.rent && c.status !== 'away').map((c) => ({ c, kg: c.kg, cap: G.kgCap(c), n: 0 })); // only your own Chikns at home
  let feed = S.res.feed, up = G.upkeepPerDay(), spent = 0, n = 0, eggs = 0;
  for (let guard = 0; guard < 5000; guard++) {
    let x = null;
    for (const y of flock) if (y.kg < y.cap - 1e-6 && (!x || y.kg < x.kg)) x = y;
    if (!x) break;
    const cost = G.feedCost({ ...x.c, kg: x.kg }), kg = Math.min(x.cap, x.kg + F.step), up2 = up + F.upkeep(kg) - F.upkeep(x.kg);
    if (feed - cost < RESERVE_DAYS * up2) break; // the lightest is also the cheapest, so nobody else fits either
    feed -= cost; spent += cost; up = up2; eggs += F.eggsAt(kg) - F.eggsAt(x.kg); x.kg = kg; x.n++; n++;
  }
  return { n, spent, eggs, up, left: feed, list: flock.filter((x) => x.n), reserve: RESERVE_DAYS * G.upkeepPerDay(),
    allMax: flock.length > 0 && flock.every((x) => x.c.kg >= x.cap - 1e-6) };
}

const KEY = { kg: (c) => c.kg, egg: (c) => G.chiknEgg(c) };
const flock = () => G.S.chikns.filter((c) => c.status !== 'away').sort((a, b) => (KEY[sortBy](a) - KEY[sortBy](b)) * (desc ? -1 : 1) || a.id - b.id);
const scaleChikn = () => {
  const S = G.S;
  let c = scaleId != null && G.chikn(S, scaleId);
  if (!c) { c = S.chikns.reduce((a, x) => (!a || x.kg > a.kg ? x : a), null); scaleId = c ? c.id : null; }
  return c || null;
};
// a few Chikns for the yard, from the heaviest to the lightest so their sizes vary
function yardPicks(max) {
  const list = G.S.chikns.slice().sort((a, b) => b.kg - a.kg || a.id - b.id), k = Math.min(max, list.length);
  return Array.from({ length: k }, (_, i) => list[k < 2 ? 0 : Math.round(i * (list.length - 1) / (k - 1))]);
}
const sigOf = () => {
  const S = G.S, m = S.factories.feedmill;
  return [S.chikns.map((c) => c.id + c.status).join(), S.farm.coopLv, m.lv, m.con ? m.con.to : 0, S.depth >= MILL.reqDepth,
    S.farm.hungry, S.spec, S.player.lv >= D.rules.specLv, S.stats.hired > 0].join('|');
};
const millSigOf = () => G.S.jobs.filter((j) => j.f === 'feedmill').map((j) => j.id + (j.repeat ? 'r' : '')).join() +
  '|' + (G.S.farm.millAuto ? 1 : 0);

// ---------- dial geometry ----------
const ang = (kg) => -SWEEP + 2 * SWEEP * Math.max(0, Math.min(1, kg / DIAL_MAX));
const pt = (a, r) => { const t = (a - 90) * Math.PI / 180; return [(r * Math.cos(t)).toFixed(2), (r * Math.sin(t)).toFixed(2)]; };
const arc = (a0, a1, r) => { if (a1 - a0 < 0.05) a1 = a0 + 0.05; const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
  return `M${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`; };

// ---------- live binders ----------
ui.binders.fmDay = (el) => setT(el, G.fmtFull(G.S.farm.day + 1)); // farm.day counts finished days
ui.binders.fmDayBar = (el) => { const i = el.firstElementChild; if (i) i.style.width = Math.min(100, G.S.farm.dayT / F.day * 100) + '%'; };
ui.binders.fmNest = (el) => {
  const n = G.S.nest, cap = G.nestCap(), full = n >= 1 && Math.floor(n + 1e-9) >= Math.floor(cap + 1e-9); // as the numbers show it
  const i = q('.fm-nfill', el);
  if (i) i.style.width = Math.min(100, n / cap * 100) + '%';
  setT(q('.fm-ncap', el), whole(cap));
  el.classList.toggle('fm-full', full);
  const b = q('.fm-collect', el);
  if (b) b.classList.toggle('cant', n < 1);
  const nest = q('.fm-hero .fm-nest-img');
  if (nest) nest.classList.toggle('fm-full', full);
};
ui.binders.fmStat = (el, k) => {
  const S = G.S;
  if (k === 'egg') return setT(el, one(G.eggsPerDay()));
  if (k === 'up') return setT(el, one(G.upkeepPerDay()));
  if (k === 'days') {
    const d = G.feedDaysLeft(), hungry = S.farm.hungry;
    el.classList.toggle('fm-hungry', hungry);
    el.classList.toggle('fm-warn', !hungry && d < 2);
    setT(q('.fm-ss', el), hungry ? 'Hungry! Chikns are losing weight' : !isFinite(d) ? 'No Chikns to feed yet'
      : d < 2 ? `Only ${daysTxt(d)} days left!` : `${daysTxt(d)} days of upkeep left`);
  }
};
ui.binders.fmCard = (el, id) => {
  const c = G.chikn(G.S, +id);
  if (!c) return;
  const feed = G.S.res.feed, cost = G.feedCost(c), cap = G.kgCap(c);
  const key = `${c.kg}|${Math.floor(feed + 1e-9)}|${cost}|${cap}`;
  if (el.dataset.k === key) return;
  el.dataset.k = key;
  const max = atMax(c), p5 = feedPlan(c, 5);
  el.classList.toggle('fm-max', max);
  el.style.setProperty('--fm-fat', fatness(c));
  q('.fm-wfill', el).style.width = growth(c) * 100 + '%';
  setT(q('.fm-wtxt', el), `${kgs(c.kg)} / ${kgs(cap)} kg`);
  setT(q('.fm-lvv', el), String(c.lv));
  setT(q('.fm-ev', el), one(G.chiknEgg(c)));
  const nx = q('.fm-next', el), next = F.eggsAt(Math.min(cap, c.kg + F.step));
  const nh = c.rent ? '<small>rented: its weight stays as it is</small>' : max ? '<b class="fm-star">★ Max weight</b>' : `+${F.step} kg → <b>${two(next)}</b> <small>· eats +${two(F.upkeep(Math.min(cap, c.kg + F.step)) - F.upkeep(c.kg))} FEED/day</small>`;
  if (nx.dataset.h !== nh) { nx.dataset.h = nh; nx.innerHTML = nh; }
  nx.title = max ? '' : `Next feeding: ${two(G.chiknEgg(c))} → ${two(next)} EGG/day`;
  const b1 = q('.fm-f1', el), b5 = q('.fm-f5', el);
  if (c.rent) { b1.disabled = true; b5.hidden = true; setT(q('.fm-f1l', b1), 'Rented'); setT(q('.fm-fcv', b1), '—'); b1.title = `${c.name} is rented: only its owner can fatten it`; return; }
  b1.disabled = max || feed + 1e-9 < cost;
  setT(q('.fm-f1l', b1), max ? 'Max weight' : 'Feed ×1');
  setT(q('.fm-fcv', b1), String(cost));
  b1.title = max ? `${c.name} is at max weight` : feed + 1e-9 < cost ? `Needs ${cost} FEED` : `+${F.step} kg for ${cost} FEED`;
  b5.hidden = max || p5.done < 2;
  b5.disabled = feed + 1e-9 < p5.cost;
  setT(q('.fm-f5l', b5), '×' + p5.done);
  setT(q('.fm-fcv', b5), G.fmtFull(p5.cost));
  b5.title = feed + 1e-9 < p5.cost ? `Needs ${p5.cost} FEED` : `+${kgs(p5.kg - c.kg)} kg for ${p5.cost} FEED`;
};
ui.binders.fmFatten = (el) => {
  const S = G.S, ev = G.liveEvent();
  const key = Math.floor(S.res.feed + 1e-9) + '|' + S.chikns.reduce((s, c) => s + c.kg, 0).toFixed(2) + '|' + S.chikns.length + '|' + (ev ? ev.id : '') + S.spec;
  if (key !== fatKey || !fatPlan) { fatKey = key; fatPlan = fattenPlan(); }
  const p = fatPlan;
  el.classList.toggle('cant', !p.n); // stays clickable, so a tap explains why it can't feed
  const own = S.chikns.some((c) => !c.rent && c.status !== 'away'), need = Math.max(0, Math.ceil(p.reserve + G.feedCost(S.chikns.filter((c) => !c.rent && c.status !== 'away').sort((a, b) => a.kg - b.kg)[0] || { kg: 100, rarity: 'common' }) - S.res.feed));
  setT(q('.fm-fat-s', el), p.n ? `${plural(p.n, 'feeding')} · ${G.fmtFull(p.spent)} FEED`
    : !own ? 'No Chikns of your own to fatten' : p.allMax ? 'Everyone is at max weight' : `Need ${G.fmtFull(need)} more FEED (keeps ${Math.ceil(p.reserve)} in reserve)`);
};
ui.binders.fmScale = (el) => {
  const c = scaleId != null && G.chikn(G.S, scaleId);
  const kg = c ? c.kg : 0, a = ang(kg), nd = q('.fm-needle', el);
  if (nd && nd.dataset.a !== a.toFixed(2)) {
    if (!nd.dataset.a) getComputedStyle(nd).transform; // just rendered: flush the old angle so the needle swings
    nd.style.transform = `rotate(${a.toFixed(2)}deg)`;
    nd.dataset.a = a.toFixed(2);
    needleAt = a;
  }
  if (!c || el.dataset.k === c.id + ':' + kg) return;
  el.dataset.k = c.id + ':' + kg;
  const pr = q('.fm-prog', el), box = el.closest('.fm-weigh') || el, on = q('.fm-on', box);
  if (pr) pr.setAttribute('d', arc(ang(G.kgStart(c)), a, 44));
  tween(q('.fm-read-v', el), Math.round(kg));
  setT(q('.fm-w-kg', box), kgs(kg) + ' kg');
  setT(q('.fm-w-egg', box), one(G.chiknEgg(c)));
  if (on) on.style.setProperty('--fm-fat', fatness(c));
};
ui.binders.fmMill = (el) => {
  const S = G.S, cap = G.millQuota(), m = S.farm.milled, qd = G.queuedFeed(), used = m + qd;
  const full = S.factories.feedmill.lv > 0 && cap - used < 0.5; // the last batch of a day is cut to what is left
  const con = !!S.factories.feedmill.con, auto = !!S.farm.millAuto;
  const key = `${m}|${qd}|${cap}|${auto}|${con}`;
  if (el.dataset.k === key) return;
  el.dataset.k = key;
  setT(q('.fm-q-used', el), whole(used));
  setT(q('.fm-q-cap', el), G.fmtFull(cap));
  const mi = q('.fm-q-m', el), qi = q('.fm-q-q', el);
  if (mi) mi.style.width = Math.min(100, m / cap * 100) + '%';
  if (qi) { qi.style.left = Math.min(100, m / cap * 100) + '%'; qi.style.width = Math.max(0, Math.min(100 - m / cap * 100, qd / cap * 100)) + '%'; }
  setT(q('.fm-q-note', el), `${whole(m)} milled · ${whole(qd)} grinding`);
  el.classList.toggle('fm-qfull', full);
  const why = con ? 'The Feed Mill is under construction' : full ? `Today's quota is used up: it resets at the next farm day${auto ? ', and auto-grind starts again by itself' : ''}` : '';
  for (const b of el.querySelectorAll('.fm-grind')) { b.disabled = !!why; b.title = why || b.dataset.tip || ''; }
  const w = q('.fm-mill-why', el);
  if (w) { w.hidden = !why; setT(w, why); }
};
ui.binders.fmQuote = (el, amt) => setT(el, amt === 'rate' ? hen(eggQuote(1)) : hen(eggQuote(+amt)));
ui.binders.fmSpeed = (el, fid) => {
  const c = G.S.factories[fid] && G.S.factories[fid].con;
  if (!c) return;
  const cost = 2 * G.speedCost(c.dur - c.t);
  if (el.dataset.c === String(cost)) return;
  el.dataset.c = cost; el.dataset.need = 'henium:' + cost;
  setT(q('.fm-spv', el), G.fmtFull(cost));
};

// readout digits count towards the new weight
function tween(el, to) {
  if (!el) return;
  const from = +el.dataset.v;
  if (from === to) return;
  el.dataset.v = to;
  if (!isFinite(from) || Math.abs(to - from) < 2) { el.textContent = G.fmtFull(to); return; }
  const t0 = performance.now(), dur = 650;
  const step = (t) => {
    if (+el.dataset.v !== to) return; // a newer target took over
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = G.fmtFull(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- farmyard hero ----------
function heroHTML() {
  const S = G.S, hungry = S.farm.hungry, lv = S.farm.coopLv, n = S.chikns.length;
  const yard = yardPicks(SPOTS.length).map((c, i) => {
    const [x, y] = SPOTS[i], s = (0.8 + 0.45 * Math.max(0, Math.min(1, (c.kg - 100) / 700))).toFixed(3);
    return `<div class="fm-ch ${i % 2 ? 'fm-flip' : ''}" data-a="fmWeigh" data-args='[${c.id}]' data-cid="${c.id}"
      style="left:${x}%;bottom:${y}%;--fm-s:${s};--fm-d:${(i * 0.61 % 2.4).toFixed(2)}s;z-index:${50 - y}" title="${esc(c.name)} · ${kgs(c.kg)} kg (tap to weigh)">
      ${hungry && i < 2 ? '<span class="fm-bub">Hungry!</span>' : ''}<span class="fm-shadow"></span>${ui.img('chikn/' + c.role, 'fm-ch-img', c.name)}</div>`;
  }).join('');
  const empty = n ? '' : `<div class="fm-yard-empty"><b>The yard is empty</b><span class="fm-ye-t">Chikns lay EGG. Hire one to start your farm.</span>
    <button type="button" class="btn gold sm" data-a="hire"><span class="fm-long">${S.stats.hired === 0 ? 'Hire your first Chikn (free)' : 'Hire a Chikn'}</span>
      <span class="fm-short">${S.stats.hired === 0 ? 'Hire (free)' : 'Hire'}</span></button></div>`;
  return `<section class="panel fm-hero ${hungry ? 'fm-is-hungry' : ''}" aria-label="Farmyard">
    <div class="fm-scene" style="--fm-bg:url(${G.img('bg/farm')})">
      <div class="fm-top">
        <div class="fm-title">${ui.img('farm/nest', 'fm-title-ic', '')}<div class="fm-title-t"><h1>Egg Farm</h1>
          <div class="fm-sub">Fatten your Chikns with FEED. Heavier Chikns lay more EGG.</div></div></div>
        <div class="fm-day" title="A farm day is a real day (24 hours): eggs, FEED upkeep, the Feed Mill quota and the daily payouts run on it">
          <span class="fm-sun" aria-hidden="true"></span>
          <div class="fm-day-t"><b>Day <span data-b="fmDay">${G.fmtFull(S.farm.day + 1)}</span></b>
            <small>next day in <span data-b="farmday">${G.fmtTime(G.farmDayLeft())}</span></small>
            <span class="fm-daybar" data-b="fmDayBar"><i></i></span></div></div>
      </div>
      <button type="button" class="fm-coopbtn" data-a="fmGoto" data-args='["fm-coop"]' title="Coop Lv. ${lv}: ${n}/${G.coopCap()} Chikns">
        ${natImg(G.coopImg(), 'fm-coop-img', 'Chikn coop')}<span class="fm-coop-lv">Lv. ${lv}</span></button>
      <div class="fm-yard">${ui.img('farm/trough', 'fm-trough' + (hungry ? ' fm-empty' : ''), 'Feeding trough')}${yard}${empty}</div>
      <img class="fm-nest-img" src="${G.img('farm/nest')}" alt="Nest" draggable="false" data-a="fmCollect" title="Collect the eggs">
    </div>
    <div class="fm-nestctl" data-b="fmNest">
      <div class="fm-nest-n">${ui.icon('egg', 38)}<div class="fm-nest-t"><span class="fm-sl">Eggs in the nest</span>
        <b class="fm-nest-v"><span data-b="nest">${whole(S.nest)}</span><small> / <span class="fm-ncap">${whole(G.nestCap())}</span></small></b>
        <span class="nest-eta" data-b="nestEta"></span></div></div>
      <div class="bar gold fm-nbar"><i class="fm-nfill"></i></div>
      <button type="button" class="btn gold lg fm-collect" data-a="fmCollect">${ui.icon('egg', 26)}Collect</button>
      <span class="fm-nest-full">Nest full! New eggs are lost until you collect.</span>
    </div>
  </section>`;
}

// ---------- stats row ----------
function tile(cls, icon, label, value, sub, attrs = '') {
  return `<div class="fm-tile fm-t-${cls}" ${attrs}>${icon}<div class="fm-tt"><span class="fm-sl">${label}</span>
    <b class="fm-sv">${value}</b><small class="fm-ss">${sub}</small></div></div>`;
}
function statsHTML() {
  const S = G.S, n = S.chikns.length, cap = G.coopCap(), built = S.factories.feedmill.lv > 0, free = cap - n;
  return `<section class="panel fm-stats" aria-label="Farm stats">
    <div class="fm-tiles">
      ${tile('egg', ui.icon('egg', 44), 'EGG per day', `<span data-b="fmStat:egg">${one(G.eggsPerDay())}</span>`, `laid by ${plural(n, 'Chikn')}`)}
      ${tile('up', ui.icon('feed', 44), 'FEED upkeep', `<span data-b="fmStat:up">${one(G.upkeepPerDay())}</span><small>/day</small>`,
        built ? `Your mill grinds up to ${G.millQuota()}/day` : 'Build a Feed Mill to grind FEED')}
      ${tile('feed', ui.icon('feed', 44), 'FEED in stock', `<span data-b="res:feed">${whole(S.res.feed)}</span>`, '', 'data-b="fmStat:days"')}
      ${tile('coop', ui.img(G.coopImg(), 'fm-tile-coop', ''), 'Coop', `${n}<small>/${cap}</small>`,
        free > 0 ? `${plural(free, 'space')} free` : 'Full: upgrade to hire more', free > 0 ? '' : 'data-full="1"')}
    </div>
    <p class="fm-explain">${ui.icon('egg', 18)}<span>Every Chikn lays about <b>1 EGG a day</b>; heavier Chikns lay more, with diminishing returns.
      Chikns eat <b>FEED</b> every day to keep their weight; without it they slowly slim down. A farm day is a real day (24 hours).</span></p>
  </section>`;
}

// ---------- fattening pen ----------
function cardHTML(c) {
  const R = D.rarity(c.rarity), role = D.roles[c.role];
  return `<article class="fm-card rarity-${c.rarity}" data-id="${c.id}" data-b="fmCard:${c.id}" style="--fm-fat:${fatness(c)}">
    <button type="button" class="fm-art" data-a="fmWeigh" data-args='[${c.id}]' title="Put ${esc(c.name)} on the scale" aria-label="Weigh ${esc(c.name)}">
      ${ui.img('chikn/' + c.role, 'fm-art-img', role.name)}<span class="fm-lv">Lv.<b class="fm-lvv">${c.lv}</b></span></button>
    <div class="fm-cm">
      <div class="fm-c1"><b class="fm-name">${esc(c.name)}</b><span class="fm-rar" style="color:${R.color}">${R.name}</span></div>
      <div class="fm-c2"><span>${role.name} #${c.num}</span>${TAGS[c.status] || ''}${ui.rentTag(c)}</div>
      <div class="bar fm-wbar"><i class="fm-wfill"></i><b class="fm-wtxt"></b></div>
      <div class="fm-eggs"><span class="fm-epd">${ui.icon('egg', 18)}<b class="fm-ev"></b><small>EGG/day</small></span><span class="fm-next"></span></div>
      <div class="fm-btns">
        <button type="button" class="btn green sm fm-f1" data-a="fmFeed" data-args='[${c.id},1]'><span class="fm-f1l">Feed ×1</span><span class="fm-fc">${ui.icon('feed', 16)}<span class="fm-fcv"></span></span></button>
        <button type="button" class="btn green sm fm-f5" data-a="fmFeed" data-args='[${c.id},5]'><span class="fm-f5l">×5</span><span class="fm-fc">${ui.icon('feed', 16)}<span class="fm-fcv"></span></span></button>
      </div>
    </div>
  </article>`;
}
// FEED alert above the pen: '' | 'low' (under 2 days left) | 'hungry'. update() swaps it in place when it changes.
const alertState = () => { const S = G.S; return !S.chikns.length ? '' : S.farm.hungry ? 'hungry' : G.feedDaysLeft() < 2 ? 'low' : ''; };
let alertSeen = '';
ui.binders.fmLow = (el) => setT(el, daysTxt(G.feedDaysLeft()));
function alertHTML() {
  const S = G.S, st = alertState();
  alertSeen = st;
  if (!st) return '';
  const hungry = st === 'hungry';
  return `<div class="fm-alert ${hungry ? 'fm-bad' : ''}">${ui.icon('feed', 30)}<div class="fm-alert-t"><b>${hungry ? 'Your Chikns are hungry!' : `Only <span data-b="fmLow">${daysTxt(G.feedDaysLeft())}</span> days of FEED left`}</b>
      <span>${hungry ? 'Without FEED they slowly lose weight and lay fewer eggs.' : 'When it runs out, your Chikns start losing weight.'}</span></div>
    <div class="fm-alert-b">${S.factories.feedmill.lv > 0 ? '<button type="button" class="btn sm green" data-a="fmGoto" data-args=\'["fm-mill"]\'>Grind FEED</button>' : ''}
      <button type="button" class="btn sm gold" data-a="fmEx" data-args='["e2f",5]' data-need="${ui.need({ egg: 5 * G.exRate().e2f })}">Burn ${ui.icon('egg', 16)}${5 * G.exRate().e2f} → ${ui.icon('feed', 16)}5</button></div>
  </div>`;
}
function penHTML() {
  const S = G.S, list = flock();
  const sorts = [['kg', 'Weight'], ['egg', 'Eggs']].map(([k, l]) => `<button type="button" class="tab ${sortBy === k ? 'on' : ''}" data-a="fmSort" data-args='["${k}"]'
    aria-pressed="${sortBy === k}" title="${sortBy === k ? 'Tap again to reverse' : 'Sort by ' + l.toLowerCase()}">${l}${sortBy === k ? `<span class="fm-dir">${desc ? '▼' : '▲'}</span>` : ''}</button>`).join('');
  return `<section class="panel fm-pen" id="fm-pen" aria-label="Fattening pen">
    <div class="panel-h">${ui.img('farm/trough', '', '')}<span class="sp">Fattening Pen <span class="fm-dimh">(${list.length})</span></span>
      <div class="tabs fm-sort"><span class="fm-sort-l">Sort</span>${sorts}</div></div>
    <div id="fm-alert-slot">${alertHTML()}</div>
    <div class="fm-penbar">
      <div class="fm-pen-info"><span class="fm-have">${ui.icon('feed', 22)}<b data-b="res:feed">${whole(S.res.feed)}</b> FEED</span>
        <span class="fm-pen-hint">Each feeding adds <b>+${F.step} kg</b>; heavier Chikns need more FEED per feeding.</span></div>
      <button type="button" class="btn gold fm-fatten" data-a="fmFatten" data-b="fmFatten" title="Feeds the lightest Chikns first and keeps ${RESERVE_DAYS} days of upkeep in reserve">
        ${ui.img('farm/basket', 'fm-fat-ic', '')}<span class="fm-fat-t"><span class="fm-fat-l">Fatten all</span><small class="fm-fat-s"></small></span></button>
    </div>
    ${list.length ? `<div class="fm-grid">${list.map(cardHTML).join('')}</div>`
      : `<div class="empty fm-empty">${ui.img('chikn/miner', 'fm-empty-img', '')}<div>No Chikns in the pen yet. Every Chikn lays about one EGG a day.</div>
        <button type="button" class="btn gold" data-a="hire">${S.stats.hired === 0 ? 'Hire your first Chikn (free)' : 'Hire a Chikn'}</button></div>`}
  </section>`;
}

// ---------- weigh-in scale ----------
function dialSVG(c) {
  let ticks = '';
  for (let kg = 0; kg <= DIAL_MAX; kg += 50) {
    const big = kg % 250 === 0, [x0, y0] = pt(ang(kg), big ? 33 : 37), [x1, y1] = pt(ang(kg), 42);
    ticks += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" class="${big ? 'fm-tk2' : 'fm-tk'}"/>`;
  }
  const lab = [0, 500, 1000].map((kg) => { const [x, y] = pt(ang(kg), 23); return `<text x="${x}" y="${y}" class="fm-dl">${kg ? kg / 100 : 0}</text>`; }).join('');
  const range = c ? `<path d="${arc(ang(G.kgStart(c)), ang(G.kgCap(c)), 44)}" class="fm-range" style="stroke:${D.rarity(c.rarity).color}"/>
    <path d="${arc(ang(G.kgStart(c)), ang(c.kg), 44)}" class="fm-prog"/>` : '';
  return `<svg class="fm-dial" viewBox="-50 -50 100 100" aria-hidden="true">
    <circle r="48" class="fm-face"/>${range}${ticks}${lab}<text y="16" class="fm-unit">×100 kg</text>
    <g class="fm-needle" style="transform:rotate(${needleAt.toFixed(2)}deg)"><circle r="40" opacity="0"/><path d="M-2.4 5 L-0.7 -38 L0.7 -38 L2.4 5 Z" class="fm-ndl"/></g>
    <circle r="6.5" class="fm-hub"/><circle r="2.2" cx="-1.6" cy="-1.8" class="fm-hubhi"/></svg>`;
}
function scaleHTML(drop = false) {
  const c = scaleChikn(), list = flock(), i = c ? list.findIndex((x) => x.id === c.id) : -1;
  const R = c && D.rarity(c.rarity);
  const avatars = list.map((x) => `<button type="button" class="fm-av rarity-${x.rarity} ${c && x.id === c.id ? 'on' : ''}" data-a="fmWeigh" data-args='[${x.id}]'
    title="${esc(x.name)} · ${kgs(x.kg)} kg" aria-label="Weigh ${esc(x.name)}" aria-pressed="${!!(c && x.id === c.id)}">${ui.img('chikn/' + x.role, '', '')}</button>`).join('');
  const info = c ? `<div class="fm-w-name">${esc(c.name)} <span class="dim">#${c.num}</span></div>
      <div class="fm-w-rar"><b style="color:${R.color}">${R.name}</b> · ${D.roles[c.role].name}</div>
      <div class="fm-w-kv"><span>Weight</span><b class="fm-w-kg">${kgs(c.kg)} kg</b></div>
      <div class="fm-w-kv"><span>Range</span><b>${kgs(G.kgStart(c))}–${kgs(G.kgCap(c))} kg</b></div>
      <div class="fm-w-kv"><span>EGG/day now</span><b class="fm-w-egg fm-eggc">${one(G.chiknEgg(c))}</b></div>
      <div class="fm-w-kv"><span>at max weight</span><b class="fm-eggc">${one(F.eggsAt(G.kgCap(c)))}</b></div>
      <div class="fm-w-nav">${list.length > 1 ? `<button type="button" class="btn sm gray ff" data-a="fmScaleNav" data-args='[-1]' aria-label="Previous Chikn">◀</button>
        <span class="dim">${i + 1} / ${list.length}</span><button type="button" class="btn sm gray ff" data-a="fmScaleNav" data-args='[1]' aria-label="Next Chikn">▶</button>` : ''}</div>`
    : `<div class="fm-w-none">Nobody on the scale.<br>Hire a Chikn to weigh it!</div>`;
  return `<section class="panel fm-weigh" id="fm-weigh" aria-label="Weigh-in">
    <div class="panel-h">${ui.img('farm/scale', '', '')}<span class="sp">Weigh-in</span><small>Tap a Chikn</small></div>
    <div class="fm-wbody">
      <div class="fm-scale" data-b="fmScale">
        <img class="fm-scale-img" src="${G.img('farm/scale')}" alt="Weighing scale" draggable="false">
        ${dialSVG(c)}
        ${c ? `<div class="fm-on ${drop ? 'fm-drop' : ''}" style="--fm-s:${(0.86 + 0.28 * growth(c)).toFixed(3)};--fm-fat:${fatness(c)}">${ui.img('chikn/' + c.role, 'fm-on-img', c.name)}</div>` : ''}
        <div class="fm-read"><b class="fm-read-v" data-v="${c ? Math.round(c.kg) : 0}">${c ? kgs(c.kg) : 0}</b><small>kg</small></div>
      </div>
      <div class="fm-winfo">${info}</div>
    </div>
    ${list.length > 1 ? `<div class="fm-pick" role="group" aria-label="Pick a Chikn to weigh">${avatars}</div>` : ''}
  </section>`;
}
function centerPick() {
  const box = q('.fm-pick'), on = box && q('.fm-av.on', box);
  if (on) box.scrollLeft = on.offsetLeft - box.clientWidth / 2 + on.offsetWidth / 2;
}

// ---------- coop ----------
// One building look in a before → after row. The row shares its width by natural widths (--fm-sum), so a bigger
// (higher-level) look stays bigger.
function lookHTML(key, cap, cls = '', extra = '') {
  return `<figure class="fm-look ${cls}" style="--fm-nw:${natSize(key).w}">${extra}${natImg(key, '', 'Coop')}<figcaption>${cap}</figcaption></figure>`;
}
const nextKey = (lv) => (hasArt('tier/coop-' + lv) ? 'tier/coop-' + lv : G.bImg('coop', lv));
function nextLookHTML(lv) {
  if (hasArt('tier/coop-' + lv)) return lookHTML(nextKey(lv), `Next look · Lv. ${lv}`, 'fm-next-look', '<span class="fm-glow" aria-hidden="true"></span>');
  // the art for this level isn't ready yet: tease it as a mystery silhouette
  return lookHTML(nextKey(lv), `Lv. ${lv} · new look`, 'fm-next-look fm-mystery', '<span class="fm-glow" aria-hidden="true"></span><span class="fm-q">?</span>');
}
const lookSum = (...keys) => keys.reduce((s, k) => s + natSize(k).w, 0);
function coopHTML() {
  const S = G.S, lv = S.farm.coopLv, max = lv >= F.coopMax, cap = G.coopCap(), n = S.chikns.length;
  const cost = max ? null : F.coopCost(lv), next = max ? cap : F.coop(lv + 1);
  const pips = Array.from({ length: F.coopMax }, (_, k) => `<i class="${k < lv ? 'on' : ''} ${k === lv && !max ? 'nx' : ''}"></i>`).join('');
  return `<section class="panel fm-coop" id="fm-coop" aria-label="Coop">
    <div class="panel-h">${ui.img('farm/coop', '', '')}<span class="sp">Chikn Coop</span><span class="fm-lvchip">Lv. ${lv}<small>/${F.coopMax}</small></span></div>
    <div class="fm-looks ${max ? 'fm-solo' : ''}" style="--fm-sum:${max ? lookSum(G.coopImg()) : lookSum(G.coopImg(), nextKey(lv + 1))}">${lookHTML(G.coopImg(), max ? `Lv. ${lv} · max level` : `Now · Lv. ${lv}`, 'fm-now')}
      ${max ? '' : `<span class="fm-arrow" aria-hidden="true">➜</span>${nextLookHTML(lv + 1)}`}</div>
    <div class="fm-pips" aria-label="Coop level ${lv} of ${F.coopMax}">${pips}</div>
    <div class="fm-kvs">
      <div class="fm-kv"><span>Houses</span><b>${n} / ${cap}</b><span>Chikns</span></div>
      ${ui.bar(n / cap * 100, n >= cap ? 'red' : 'blue', '')}
      ${max ? '' : `<div class="fm-kv"><span>At Lv. ${lv + 1}</span><b>${next}</b><span>Chikns <em>(+${next - cap})</em></span></div>`}
    </div>
    ${max ? '<div class="fm-maxnote">★ Max level: the grandest coop in the land</div>'
      : `<div class="fm-upbox"><div class="fm-upcost"><small>Upgrade cost</small>${ui.cost(cost, 1, 18)}</div>${ui.btn('Upgrade Coop', 'upgradeCoop', [], 'green', cost)}${ui.miss(cost)}</div>`}
  </section>`;
}
function celebrateCoop(from, to) {
  const before = G.bImg('coop', from), after = G.bImg('coop', to), fresh = after !== before;
  G.sfx('level');
  ui.modal({ title: `${ui.img('farm/coop', '', '')} Coop upgraded to Lv. ${to}!`, actions: [{ label: 'Bawk-tastic!', cls: 'green lg' }],
    html: `<div class="fm-cele" style="--fm-sum:${lookSum(before, after)}"><span class="fm-rays" aria-hidden="true"></span>
        ${lookHTML(before, `Lv. ${from}`, 'fm-before')}<span class="fm-arrow" aria-hidden="true">➜</span>${lookHTML(after, `Lv. ${to}`, 'fm-after')}
        <span class="fm-confetti" aria-hidden="true">${'<i></i>'.repeat(14)}</span></div>
      <p class="fm-cele-t">${fresh ? 'A brand-new look for your farm! ' : ''}Your coop now houses <b>${F.coop(to)} Chikns</b> (+${F.coop(to) - F.coop(from)}).</p>` });
}

// ---------- feed mill ----------
function millHTML() {
  const S = G.S, st = S.factories.feedmill, lv = st.lv, con = st.con, built = lv > 0, can = S.depth >= MILL.reqDepth;
  const art = natImg(G.bImg('feedmill', Math.max(1, lv)), built ? '' : 'fm-dim', 'Feed Mill');
  const head = `<div class="panel-h">${ui.icon('feed', 30)}<span class="sp">Feed Mill</span>${built ? `<span class="fm-lvchip">Lv. ${lv}<small>/${D.factoryMaxLv}</small></span>` : '<span class="tag">Not built</span>'}</div>`;
  const note = `<p class="fm-note">${ui.img('ui/energy', 'fm-note-ic', '')}<span>In the real game the daily FEED pool is <b>fixed for the whole world</b> and every mill
    gets a share of it, like bitcoin mining. Here your share is your daily quota; a bigger mill grinds a bigger share.</span></p>`;
  const building = con ? `<div class="fm-con"><div class="fm-con-h">${ui.img('ui/timer', '', '')}<b>${built ? `Upgrading to Lv. ${con.to}` : 'Under construction'}</b>
      <small>${built ? 'Grinding is paused until it is done' : 'Opens when the builders are done'}</small></div>
    <div class="fm-con-row">${ui.bar(con.t / con.dur * 100, 'gold lg', G.fmtTime(con.dur - con.t), 'data-b="con:feedmill"')}
      <button type="button" class="btn sm purple" data-a="speedBuild" data-args='["feedmill"]' data-b="fmSpeed:feedmill" data-need="henium:${2 * G.speedCost(con.dur - con.t)}"
        title="Finish now for HENIUM">Finish ${ui.icon('henium', 16)}<span class="fm-spv">${2 * G.speedCost(con.dur - con.t)}</span></button></div></div>` : '';
  if (!built) {
    return `<section class="panel fm-mill" id="fm-mill" aria-label="Feed Mill">${head}
      <div class="fm-mill-top"><div class="fm-mill-art">${art}</div><div class="fm-mill-info">
        ${con ? '<b class="fm-mill-st">Being built…</b>' : can ? `<b class="fm-mill-st">Ready to build</b><small>Grinds Stone and Crushed Ore into FEED, up to ${F.millQuota(1)} FEED a day at Lv. 1.</small>`
          : `<b class="fm-mill-st">${ui.img('ui/lock', 'fm-lock', '')}Locked</b><small>Reach depth ${MILL.reqDepth} to build it (you are at ${S.depth}).</small>`}</div></div>
      ${building}
      ${con ? '' : can ? `<div class="fm-upbox"><div class="fm-upcost"><small>Build cost</small>${ui.cost(MILL.build, 1, 18)}</div>${ui.btn('Build Feed Mill', 'build', ['feedmill'], 'green', MILL.build)}</div>`
        : `<button type="button" class="btn gray block" data-a="nav" data-args='["mines"]'>${ui.img('ui/mines', '', '')}Dig to depth ${MILL.reqDepth}</button>`}
      ${note}</section>`;
  }
  const jobs = S.jobs.filter((j) => j.f === 'feedmill'), act = G.activeJob('feedmill'), auto = jobs.some((j) => j.repeat);
  const inp = G.recipeIn(REC), out = millRun(), t = REC.t * G.factorySpeed(MILL);
  const job = act ? `<div class="fm-job"><span class="fm-job-l">${auto ? '⟳ ' : ''}Grinding ${ui.icon('feed', 16)}${out}</span>
      ${ui.bar(act.t / act.dur * 100, 'green', G.fmtTime(act.dur - act.t), `data-b="job:${act.id}"`)}${jobs.length > 1 ? `<span class="fm-job-w">+${jobs.length - 1} queued</span>` : ''}</div>`
    : `<div class="fm-job fm-idle"><span class="fm-job-l">Idle</span>${ui.bar(0, '', 'Ready to grind')}</div>`;
  return `<section class="panel fm-mill" id="fm-mill" data-b="fmMill" aria-label="Feed Mill">${head}
    <div class="fm-mill-top"><div class="fm-mill-art">${art}</div>
      <div class="fm-mill-info"><span class="fm-sl">Today's FEED quota</span>
        <div class="fm-quota"><b class="fm-q-used">0</b><span>/ <span class="fm-q-cap">${G.millQuota()}</span> FEED</span></div>
        <div class="fm-qbar"><i class="fm-q-m"></i><i class="fm-q-q"></i></div>
        <small class="fm-q-note"></small><small class="fm-q-reset">New quota in <span data-b="farmday">${G.fmtTime(G.farmDayLeft())}</span></small></div></div>
    ${building}${con ? '' : job}
    <div class="fm-recipe">${ui.cost(inp, 1, 18)}<span class="fm-arr">➜</span>${ui.rew({ feed: out }, 18)}<span class="fm-rt">${ui.img('ui/timer', '', '')}${G.fmtTime(t)}</span></div>
    <div class="fm-mill-acts">
      <button type="button" class="btn green fm-grind" data-a="fmGrind" data-args='[false]' data-need="${ui.need(inp)}" data-tip="Grind one batch of FEED">${ui.icon('feed', 22)}Grind FEED</button>
      ${auto ? `<button type="button" class="btn purple fm-auto-on" data-a="fmAutoOff" title="Auto-grind is on: it keeps grinding until today's quota is used. Tap to stop.">⟳ Auto: on</button>`
        : `<button type="button" class="btn purple fm-grind" data-a="fmGrind" data-args='[true]' data-need="${ui.need(inp)}" data-tip="Keep grinding until today's quota is used">⟳ Auto</button>`}
      <button type="button" class="btn gray sm fm-tofac" data-a="nav" data-args='["factories"]'>${ui.img('ui/factories', '', '')}Factories</button>
    </div>
    <div class="fm-mill-why" hidden></div>
    ${lv < D.factoryMaxLv ? `<div class="fm-mill-up">Lv. ${lv + 1} grinds up to <b>${F.millQuota(lv + 1)} FEED/day</b>. Upgrade it in Factories.</div>` : '<div class="fm-mill-up">★ Max level mill</div>'}
    ${note}</section>`;
}

// ---------- egg market ----------
function exRow(gets, title, rate, btns) {
  return `<div class="fm-ex"><div class="fm-ex-h">${ui.icon('egg', 30)}<span class="fm-ex-ar">➜</span>${ui.icon(gets, 30)}
    <div class="fm-ex-t"><b>${title}</b><small>${rate}</small></div></div><div class="fm-ex-b">${btns}</div></div>`;
}
function marketHTML() {
  const S = G.S, x = G.exRate(), epd = G.eggsPerDay(), dex = dexOn();
  const feed = exRow('feed', 'Burn EGG for FEED', `${G.fmtFull(x.e2f)} EGG → 1 FEED`, [1, 10, 50].map((a) => `<button type="button" class="btn sm green" data-a="fmEx"
    data-args='["e2f",${a}]' data-need="${ui.need({ egg: a * x.e2f })}" title="Burn ${G.fmtFull(a * x.e2f)} EGG for ${a} FEED"><span class="fm-ex-g">+${a}${ui.icon('feed', 16)}</span><span class="fm-ex-c">${ui.icon('egg', 14)}${G.fmtFull(a * x.e2f)}</span></button>`).join(''));
  const henium = dex
    ? exRow('henium', 'Sell EGG for HENIUM', `on the DEX · 1 EGG ≈ <span data-b="fmQuote:rate">${hen(eggQuote(1))}</span> HENIUM`, SELL.map((a) => `<button type="button" class="btn sm purple"
        data-a="fmSell" data-args='[${a}]' data-need="${ui.need({ egg: a })}" title="Sell ${a} EGG on the DEX"><span class="fm-ex-g">${ui.icon('egg', 16)}${a}</span><span class="fm-ex-c">≈${ui.icon('henium', 14)}<span data-b="fmQuote:${a}">${hen(eggQuote(a))}</span></span></button>`).join(''))
    : exRow('henium', 'Burn EGG for HENIUM', `${G.fmtFull(x.e2h)} EGG → 1 HENIUM`, [1, 5, 20].map((a) => `<button type="button" class="btn sm purple" data-a="fmEx"
        data-args='["e2h",${a}]' data-need="${ui.need({ egg: a * x.e2h })}" title="Burn ${G.fmtFull(a * x.e2h)} EGG for ${a} HENIUM"><span class="fm-ex-g">+${a}${ui.icon('henium', 16)}</span><span class="fm-ex-c">${ui.icon('egg', 14)}${G.fmtFull(a * x.e2h)}</span></button>`).join(''));
  const worth = epd > 0 ? (dex ? epd * eggQuote(1) : epd / x.e2h) : 0;
  return `<section class="panel fm-mkt" id="fm-mkt" aria-label="Egg market">
    <div class="panel-h">${ui.img('farm/basket', '', '')}<span class="sp">Egg Market</span><small>Cash in your eggs</small></div>
    <div class="fm-have-row"><span class="fm-have">${ui.icon('egg', 24)}<b data-b="res:egg">${whole(S.res.egg)}</b> EGG</span>
      <span class="fm-earn">Your farm lays <b>${one(epd)}</b> EGG/day${worth > 0 ? ` ≈ <b>${hen(worth)}</b> HENIUM/day${dex ? ' at today\'s price' : ' if burned'}` : ''}</span></div>
    ${feed}${henium}
    <p class="fm-note fm-oneway">${ui.img('ui/lock', 'fm-note-ic', '')}<span><b>No way back:</b> HENIUM can never be turned into new EGG. Only Chikns lay EGG,
      and EGG burned for FEED is gone for good, which keeps EGG scarce.</span></p>
    <div class="fm-links"><button type="button" class="btn sm gold" data-a="hire">${ui.img('ui/chikns', '', '')}Hire Chikn</button>
      <button type="button" class="btn sm" data-a="fmMarket">${ui.img(ui.views.dex ? 'ui/dex' : 'ui/market', '', '')}${ui.views.dex ? 'DEX' : 'Market'}</button></div>
  </section>`;
}

// ---------- how the egg economy works ----------
function curveSVG() {
  const W = 240, H = 120, x0 = 24, x1 = W - 8, y0 = H - 20, y1 = 8, kmax = 900, emax = 4;
  const X = (kg) => (x0 + kg / kmax * (x1 - x0)).toFixed(1), Y = (e) => (y0 - e / emax * (y0 - y1)).toFixed(1);
  let d = '';
  for (let kg = 100; kg <= kmax; kg += 20) d += (d ? 'L' : 'M') + X(kg) + ' ' + Y(F.eggsAt(kg));
  const grid = [1, 2, 3, 4].map((e) => `<line x1="${x0}" x2="${x1}" y1="${Y(e)}" y2="${Y(e)}" class="fm-cg"/><text x="${x0 - 5}" y="${+Y(e) + 3.5}" class="fm-cy">${e}</text>`).join('');
  const xs = [0, 300, 600, 900].map((kg) => `<text x="${kg === 900 ? x1 + 4 : X(kg)}" y="${H - 6}" class="fm-cx ${kg === 900 ? 'fm-cxe' : ''}">${kg}${kg === 900 ? ' kg' : ''}</text>`).join('');
  const dots = [100, 200, 400, 800].map((kg) => `<circle cx="${X(kg)}" cy="${Y(F.eggsAt(kg))}" r="3.6" class="fm-cd"/>`).join('');
  return `<svg class="fm-curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="EGG per day rises with weight, but each extra kilo adds a little less">
    ${grid}${xs}<path d="M${X(100)} ${Y(1)}L${X(400)} ${Y(4)}" class="fm-clin"/><text x="${+X(400) + 4}" y="${+Y(4) + 9}" class="fm-clt">if it were linear</text>
    <path d="${d}" class="fm-cl"/>${dots}</svg>`;
}
function specHTML() {
  const S = G.S, sp = D.specs.find((s) => s.id === 'farmer');
  if (!sp) return '';
  if (S.spec === 'farmer') return `<div class="fm-spec fm-on">${ui.img('farm/basket', '', '')}<div><b>You are an Egg Farmer</b><span>${esc(sp.desc)}</span></div></div>`;
  if (S.spec) return `<div class="fm-spec">${ui.img('farm/basket', '', '')}<div><b>Egg Farmer</b><span>A specialization for players who live off eggs: ${esc(sp.desc.charAt(0).toLowerCase() + sp.desc.slice(1))}</span></div></div>`;
  return `<div class="fm-spec">${ui.img('farm/basket', '', '')}<div><b>Live off eggs?</b><span>The <b>Egg Farmer</b> specialization: ${esc(sp.desc.charAt(0).toLowerCase() + sp.desc.slice(1))}</span></div>
    ${S.player.lv >= D.rules.specLv ? '<button type="button" class="btn sm gold" data-a="spec">Choose</button>' : `<span class="tag">Lv. ${D.rules.specLv}</span>`}</div>`;
}
function howHTML() {
  const rows = [100, 200, 400, 800].map((kg) => `<tr><td>${kg} kg</td><td>${ui.icon('egg', 16)}<b>${F.eggsAt(kg).toFixed(1)}</b></td><td>${ui.icon('feed', 16)}${one(F.upkeep(kg))}</td></tr>`).join('');
  return `<section class="panel fm-how" id="fm-how" aria-label="How the egg economy works">
    <div class="panel-h">${ui.icon('egg', 30)}<span class="sp">How the egg economy works</span></div>
    <div class="fm-how-g">
      <table class="fm-table"><thead><tr><th>Weight</th><th>EGG/day</th><th>Eats FEED/day</th></tr></thead><tbody>${rows}</tbody></table>
      ${curveSVG()}
    </div>
    <div class="fm-world">
      <div class="fm-wl"><span class="fm-wn">${G.fmtFull(WORLD_CHIKNS)}</span><small>Chikns in the world</small></div><span class="fm-x">×</span>
      <div class="fm-wl"><span class="fm-wn">~1</span><small>EGG a day each</small></div><span class="fm-x">≈</span>
      <div class="fm-wl"><span class="fm-wn fm-eggc">${G.fmtFull(WORLD_CHIKNS)}</span><small>EGG a day, worldwide</small></div>
    </div>
    <p class="fm-how-t"><b>FEED is the limit.</b> Every extra kilo needs FEED to grow and FEED to keep, and only a fixed amount of FEED is milled each day.
      So eggs stay rare: the better you manage your FEED, the more your farm lays.</p>
    ${specHTML()}
  </section>`;
}

// ---------- effects ----------
function bounce(id) {
  const els = [...document.querySelectorAll(`.fm-card[data-id="${id}"] .fm-art-img, .fm-ch[data-cid="${id}"] .fm-ch-img`)];
  if (scaleId === id) els.push(...document.querySelectorAll('.fm-weigh .fm-on-img'));
  for (const e of els) { e.classList.remove('fm-bounce'); void e.offsetWidth; e.classList.add('fm-bounce'); }
}
function flyEggs(fromEl, n) {
  const fx = document.getElementById('fx'), pill = q('#topbar [data-b="res:egg"]');
  const dest = pill && (pill.closest('.pill') || pill);
  if (!fx || !dest || !fromEl) return;
  const [sx, sy] = ui.centerOf(fromEl), dimg = dest.querySelector('img') || dest, [tx, ty] = ui.centerOf(dimg);
  for (let i = 0; i < n; i++) {
    const img = document.createElement('img');
    img.src = G.img('res/egg'); img.className = 'fm-fly'; img.alt = '';
    img.style.cssText = `left:${sx + (i - n / 2) * 10}px;top:${sy}px;--fm-dx:${tx - sx - (i - n / 2) * 10}px;--fm-dy:${ty - sy}px;animation-delay:${i * 70}ms`;
    fx.appendChild(img);
    setTimeout(() => img.remove(), 1000 + i * 70);
  }
  setTimeout(() => { dest.classList.remove('fm-pillpop'); void dest.offsetWidth; dest.classList.add('fm-pillpop'); setTimeout(() => dest.classList.remove('fm-pillpop'), 600); }, 760);
}
function popEgg() {
  const nest = q('.fm-hero .fm-nest-img');
  if (!nest) return;
  const r = nest.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return;
  ui.float(`+1${ui.icon('egg', 20)}`, r.left + r.width * (0.35 + Math.random() * 0.3), r.top + r.height * 0.35, '#ffe9a8');
  nest.classList.remove('fm-plop'); void nest.offsetWidth; nest.classList.add('fm-plop');
}
// Effects run on the next frame, on whatever DOM is current then: an action can render the view twice in a row
// (main.js on 'built', then ui.run), and the second render would wipe a class added to the first.
let fxQueued = false;
function playEffects() {
  const S = G.S;
  if (seen.S === S && S.farm.coopLv > seen.coop) { const from = seen.coop, to = S.farm.coopLv; setTimeout(() => celebrateCoop(from, to), 80); }
  if (seen.S === S && S.farm.day > seen.day) effects.push({ t: 'day', S });
  seen = { S, coop: S.farm.coopLv, day: S.farm.day };
  if (!effects.length || fxQueued) return;
  fxQueued = true;
  requestAnimationFrame(() => {
    fxQueued = false;
    if (ui.cur !== 'farm') return; // keep them for the next visit
    while (effects.length) {
      const e = effects.shift();
      if (e.S !== G.S) continue;
      if (e.t === 'day') {
        const d = q('.fm-hero .fm-day');
        if (d) { d.classList.add('fm-flash'); const [x, y] = ui.centerOf(d); ui.float(`New day! Day ${G.fmtFull(G.S.farm.day + 1)}`, x, y + 34, '#ffe27a'); }
      }
      if (e.t === 'mill') {
        const a = q('.fm-mill .fm-mill-art');
        if (a) { a.classList.add('fm-newlook'); const [x, y] = ui.centerOf(a); ui.float(e.lv === 1 ? 'Feed Mill built!' : `Feed Mill Lv. ${e.lv}: new look!`, x, y - 20, '#ffe27a'); ui.sparks(x, y, '#ffd54a', 14); }
      }
    }
  });
}
// the mill's level-up gets a "new look" glow the next time the farm is drawn (main.js re-renders the farm on 'built')
G.on('built', (e) => {
  if (!e || !e.f || e.f.id !== 'feedmill') return;
  for (let i = effects.length - 1; i >= 0; i--) if (effects[i].t === 'mill') effects.splice(i, 1);
  effects.push({ t: 'mill', lv: e.lv, S: G.S });
});

function swap(id, html) {
  const old = document.getElementById(id);
  if (!old) return false;
  old.outerHTML = html;
  ui.refresh();
  return true;
}
const swapMill = () => { millSig = millSigOf(); swap('fm-mill', millHTML()); };

// ---------- view ----------
ui.views.farm = {
  render(el) {
    sig = sigOf(); millSig = millSigOf(); eggSeen = Math.floor(G.S.nest); fatPlan = null;
    el.innerHTML = `<div class="fm-page">${heroHTML()}${statsHTML()}
      <div class="fm-mid">${penHTML()}<div class="fm-side">${scaleHTML()}${coopHTML()}</div></div>
      <div class="fm-low">${millHTML()}${marketHTML()}${howHTML()}</div></div>`;
    centerPick();
    playEffects();
  },
  update() {
    if (sigOf() !== sig) { ui.render(); return; }
    if (millSigOf() !== millSig) swapMill();
    if (alertState() !== alertSeen) { const slot = document.getElementById('fm-alert-slot'); if (slot) { slot.innerHTML = alertHTML(); ui.refresh(); } }
    const n = Math.floor(G.S.nest);
    if (n > eggSeen && !ui.modalOpen()) popEgg();
    eggSeen = n;
  },
};

// ---------- handlers ----------
ui.handlers.fmCollect = (el) => {
  const r = G.act.collectNest();
  if (!r.ok) { ui.toast(r.msg, 'bad', 'farm/nest'); G.sfx('err'); return; }
  const btn = q('.fm-collect') || el, [x, y] = ui.centerOf(btn);
  ui.float(`+${G.fmtFull(r.n)}${ui.icon('egg', 24)}`, x, y - 30, '#ffe27a');
  ui.sparks(x, y, '#ffd27a', 14);
  flyEggs(q('.fm-hero .fm-nest-img') || btn, Math.min(6, r.n));
  G.sfx('coin');
  eggSeen = Math.floor(G.S.nest);
  ui.refresh();
};
ui.handlers.fmFeed = (el, e, id, n) => {
  const c = G.chikn(G.S, id);
  if (!c) return;
  const kg0 = c.kg, lv0 = c.lv;
  const r = G.act.feed(id, n);
  if (!r.ok) { ui.toast(r.msg, 'bad', 'res/feed'); G.sfx('err'); return; }
  const [x, y] = ui.centerOf(el);
  ui.float(`+${kgs(r.kg - kg0)} kg`, x, y - 26, '#ffe27a');
  ui.sparks(x, y, '#e8c28a', 6 + 2 * r.done);
  if (r.lv > lv0) setTimeout(() => ui.float(`Lv. ${r.lv}!`, x, y - 54, '#9dff8a'), 200);
  G.sfx('up');
  bounce(id);
  ui.refresh();
};
ui.handlers.fmSort = (el, e, k) => {
  if (sortBy === k) desc = !desc; else { sortBy = k; desc = true; }
  G.sfx('click');
  ui.render();
};
ui.handlers.fmWeigh = (el, e, id) => {
  if (!G.chikn(G.S, id)) return;
  const fromScale = !!el.closest('#fm-weigh'), same = scaleId === id;
  scaleId = id;
  G.sfx('click');
  if (!same) { swap('fm-weigh', scaleHTML(true)); centerPick(); }
  const p = document.getElementById('fm-weigh');
  if (!fromScale && p && !inView(p)) p.scrollIntoView({ behavior: 'smooth', block: 'center' });
};
ui.handlers.fmScaleNav = (el, e, dir) => {
  const list = flock(), i = list.findIndex((c) => c.id === scaleId);
  if (list.length < 2) return;
  ui.handlers.fmWeigh(el, e, list[(i + dir + list.length) % list.length].id);
};
ui.handlers.fmGoto = (el, e, id) => {
  const t = document.getElementById(id);
  if (!t) return;
  G.sfx('click');
  t.scrollIntoView({ behavior: 'smooth', block: 'center' });
  t.classList.remove('fm-hl'); void t.offsetWidth; t.classList.add('fm-hl');
  setTimeout(() => t.classList.remove('fm-hl'), 1600);
};
ui.handlers.fmGrind = (el, e, auto) => {
  const r = G.act.queue('feedmill', 'feed', !!auto);
  if (!r.ok) { ui.toast(r.msg, 'bad', 'res/feed'); G.sfx('err'); return; }
  const [x, y] = ui.centerOf(el);
  ui.float(`+${millRun()}${ui.icon('feed', 20)} ${auto ? 'auto-grinding' : 'grinding'}`, x, y - 26, '#f3d59b');
  G.sfx('ok');
  swapMill();
};
ui.handlers.fmAutoOff = () => {
  for (const j of G.S.jobs) if (j.f === 'feedmill' && j.repeat) G.act.toggleRepeat(j.id);
  ui.toast('Auto-grind stopped: the current batch still finishes', '', 'res/feed');
  G.sfx('click');
  swapMill();
};
ui.handlers.fmEx = (el, e, kind, n) => {
  const r = G.act.exchange(kind, n);
  if (!r.ok) { ui.toast(r.msg, 'bad', 'res/egg'); G.sfx('err'); return; }
  const gets = kind === 'e2h' ? 'henium' : 'feed', [x, y] = ui.centerOf(el);
  ui.float(`+${G.fmtFull(n)}${ui.icon(gets, 20)}`, x, y - 24, kind === 'e2h' ? '#e5c6ff' : '#f3d59b');
  ui.sparks(x, y, kind === 'e2h' ? '#c77dff' : '#ff9a3c', 8);
  G.sfx('coin');
  fatPlan = null;
  ui.refresh();
};
ui.handlers.fmSell = (el, e, amt) => {
  if (!dexOn()) return;
  const quote = eggQuote(amt);
  const r = G.act.swap('egg', 'henium', amt, quote * 0.97); // refuse if the price slipped more than 3% meanwhile
  if (!r.ok) { ui.toast(r.msg, 'bad', 'res/egg'); G.sfx('err'); return; }
  const [x, y] = ui.centerOf(el);
  ui.float(`+${hen(r.out)}${ui.icon('henium', 20)}`, x, y - 24, '#e5c6ff');
  ui.sparks(x, y, '#c77dff', 8);
  G.sfx('coin');
  ui.refresh();
};
ui.handlers.fmMarket = () => ui.go(marketView());
ui.handlers.fmFatten = () => {
  const p = fattenPlan();
  if (!p.n) {
    ui.toast(!G.S.chikns.length ? 'Hire a Chikn first' : p.allMax ? 'Every Chikn is already at max weight' :
      `Not enough FEED: Fatten all keeps ${Math.ceil(p.reserve)} FEED (${RESERVE_DAYS} days of upkeep) in reserve`, 'bad', 'res/feed');
    G.sfx('err');
    return;
  }
  const egg0 = G.eggsPerDay(), up0 = G.upkeepPerDay(), feed0 = G.S.res.feed;
  const rows = p.list.sort((a, b) => a.c.kg - b.c.kg || a.c.id - b.c.id).map((x) => `<div class="fm-frow rarity-${x.c.rarity}">
      <span class="fm-frow-a">${ui.img('chikn/' + x.c.role, '', '')}</span><div class="fm-frow-t"><b>${esc(x.c.name)}</b><small>${kgs(x.c.kg)} → ${kgs(x.kg)} kg</small></div>
      <span class="fm-frow-n">×${x.n}</span><span class="fm-frow-e">${ui.icon('egg', 16)}${two(G.chiknEgg(x.c))} → <b>${two(F.eggsAt(x.kg))}</b></span></div>`).join('');
  ui.modal({ title: `${ui.img('farm/basket', '', '')} Fatten all`, actions: [{ label: 'Cancel', cls: 'gray' },
    { label: `Fatten! ${ui.icon('feed', 20)} ${G.fmtFull(p.spent)}`, cls: 'gold lg', fn: doFatten }],
    html: `<p class="muted fm-fintro">Feeds your <b>lightest Chikns first</b> (they are the cheapest to fatten) and keeps
        <b>${RESERVE_DAYS} days</b> of upkeep in reserve (${ui.icon('feed', 16)} ${G.fmtFull(Math.ceil(RESERVE_DAYS * p.up))}).</p>
      <div class="fm-flist">${rows}</div>
      <div class="fm-fsum">
        <div><span>FEED</span><b>${whole(feed0)} → ${whole(p.left)}</b><small>−${G.fmtFull(p.spent)}</small></div>
        <div><span>EGG per day</span><b class="fm-eggc">${one(egg0)} → ${one(egg0 + p.eggs)}</b><small>+${two(p.eggs)}</small></div>
        <div><span>Upkeep per day</span><b>${one(up0)} → ${one(p.up)}</b><small>FEED</small></div>
      </div>` });
};
function doFatten() {
  const p = fattenPlan(); // FEED may have changed while the dialog was open
  if (!p.n) { ui.toast('Not enough FEED left to fatten anyone', 'bad', 'res/feed'); G.sfx('err'); return; }
  const egg0 = G.eggsPerDay(), fed = [];
  let done = 0, spent = 0;
  for (const x of p.list) {
    const c = x.c, kg0 = c.kg, r = G.act.feed(c.id, x.n);
    if (r.ok) { done += r.done; spent += r.spent; fed.push([c.id, r.kg - kg0]); }
  }
  G.sfx('level');
  ui.toast(`Fattened ${plural(fed.length, 'Chikn')}: ${plural(done, 'feeding')}, −${G.fmtFull(spent)} FEED, +${two(G.eggsPerDay() - egg0)} EGG/day`, 'good', 'farm/basket', 3.6);
  ui.render();
  fed.forEach(([id, kg], i) => setTimeout(() => {
    bounce(id);
    const a = q(`.fm-card[data-id="${id}"] .fm-art`);
    if (a && inView(a)) { const [x, y] = ui.centerOf(a); ui.float(`+${kgs(kg)} kg`, x, y - 30, '#ffe27a'); }
  }, 120 + i * 90));
}
})();
