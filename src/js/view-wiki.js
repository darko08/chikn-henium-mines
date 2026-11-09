// Wiki: the in-game encyclopedia (view id "wiki"). Every table and number is generated at render time from the live
// game data (G.D) and helpers (G.*), so the articles stay correct when the balance changes. Layout: a sidebar with
// categories, articles and search (a dropdown on phones) and an article pane with breadcrumbs, back/forward history,
// internal links (data-a="wkGo") and painted art. Deep link from any screen: data-a="wkOpen" data-args='["dex"]'.
(() => {
const G = window.G, D = G.D, ui = G.ui, esc = ui.esc, F = D.farm;
const WORLD_CHIKNS = 22000; // Chikn NFTs in the real collection (the same figure the Farm screen uses)

// Rule numbers the code uses outside the data tables (hazards, battle, expeditions, guild, timings...) live in D.rules
// (data.js) and the game reads them from there, so the wiki always shows the live rules.
const RULE = D.rules;
// "an Uncommon Miner": the free first hire (G.act.hire)
const freeHire = () => { const n = `${(D.rarity(RULE.freeHire.rarity) || {}).name || RULE.freeHire.rarity} ${(D.roles[RULE.freeHire.role] || {}).name || RULE.freeHire.role}`; return (/^[aeiou]/i.test(n) ? 'an ' : 'a ') + n; };

// ---------- module state (survives visits to other screens) ----------
let cur = 'home';
let hist = [{ id: 'home', y: 0 }], hi = 0;
let query = '', hlq = '', tocOpen = false, booted = false, textMode = false, index = null, pending = null, fresh = null, sideY = 0;
const closed = new Set();     // collapsed sidebar categories
const look = {};              // building galleries: gallery id -> look on show (1..10)
const galCfg = {};

// ---------- small helpers ----------
const PLAY = () => !G.WIKI_ONLY && !document.body.classList.contains('wiki-only');
const safe = (fn, alt = '') => { try { return fn(); } catch (e) { console.error('[wiki]', e); return alt; } };
const rn = (r) => (D.res[r] ? D.res[r].name : r);
const n0 = (x) => G.fmtFull(Math.round(x || 0));
const nd = (x, d = 2) => G.fmtFull(x || 0, d);
const big = (x) => (Math.abs(x) >= 1e6 ? G.fmt(x) : n0(x));
const sig = (v, s = 3) => { if (!v) return '0'; const a = Math.abs(v); if (a >= 1000) return n0(v); if (a < 1e-6) return v.toExponential(2); return String(+v.toPrecision(s)); };
const pc = (x, d = 1) => `${+(x * 100).toFixed(d)}%`;
const tm = (s) => G.fmtTime(s);
const secs = (s) => (s < 60 ? `${(Math.round(s * 10) / 10).toFixed(1)}s` : G.fmtTime(s));
const amtOf = (r, v) => (r === 'eth' ? sig(v) : ui.amt(r, v));
const has = (key) => !!(G.ASSETS && G.ASSETS[key]);
const ic = (r, s = 20) => (textMode ? ` ${rn(r)} ` : ui.icon(r, s, 'wk-ic'));
const pic = (key, cls = '', alt = '', w = 0, h = 0) => (textMode ? '' : `<img class="${cls}" src="${G.img(key)}" alt="${esc(alt)}"${w ? ` width="${w}"` : ''}${h ? ` height="${h}"` : ''} draggable="false">`);
const args = (a) => esc(JSON.stringify(a));
const chips = (cost, s = 18) => {
  const e = Object.entries(cost || {}).filter(([, v]) => v > 0);
  if (!e.length) return '<span class="dim">free</span>';
  return `<span class="wk-cost">${e.map(([r, v]) => `<span class="wk-c" title="${esc(rn(r))}">${ic(r, s)}${amtOf(r, v)}</span>`).join('')}</span>`;
};
const ranges = (rr, s = 18) => `<span class="wk-cost">${Object.entries(rr).map(([r, [a, b]]) => `<span class="wk-c" title="${esc(rn(r))}">${ic(r, s)}${amtOf(r, a)}–${amtOf(r, b)}</span>`).join('')}</span>`;
const sumCost = (list) => { const t = {}; for (const c of list) for (const r in c) t[r] = (t[r] || 0) + c[r]; return t; };
const title = (id) => (byId[id] ? byId[id].title : id);
const L = (id, text) => (textMode ? (text || title(id)) : `<a class="wk-a" href="#wiki/${id}" data-a="wkGo" data-args='${args([id])}'>${text || esc(title(id))}</a>`);
const H = (t, id) => `<h2 id="wk-s-${id}">${t}</h2>`;
const H3 = (t) => `<h3>${t}</h3>`;
const P = (t) => `<p>${t}</p>`;
const UL = (items, cls = '') => `<ul class="wk-ul ${cls}">${items.filter(Boolean).map((x) => `<li>${x}</li>`).join('')}</ul>`;
const OL = (items) => `<ol class="wk-ol">${items.filter(Boolean).map((x) => `<li>${x}</li>`).join('')}</ol>`;
const box = (html, kind = 'tip', head = '') => `<div class="wk-box wk-${kind}">${head ? `<b class="wk-box-h">${head}</b>` : ''}${html}</div>`;
const fx = (html) => `<div class="wk-f">${html}</div>`;
const you = (html) => (PLAY() ? box(html, 'you', 'Your game right now') : '');
const dl = (rows) => `<dl class="wk-dl">${rows.filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
const goBtn = (view, label) => (PLAY() && ui.views[view] ? `<p class="wk-gobar"><button class="btn sm wk-go" data-a="nav" data-args='${args([view])}'>${label} ➜</button></p>` : '');
const niceNum = (x) => { if (x <= 0) return 0; const p = Math.pow(10, Math.floor(Math.log10(x))); const m = x / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };
const niceTicks = (lo, hi, n = 5) => { const st = niceNum((hi - lo) / n) || 1, out = []; for (let v = Math.ceil(lo / st) * st; v <= hi + st * 1e-9; v += st) out.push(v); return out; };
const orList = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} or ${a[a.length - 1]}` : a.join(''));
const isPhone = () => { const b = document.querySelector('.wk-tocb'); return !!b && getComputedStyle(b).display !== 'none'; }; // one-column layout with the Contents dropdown
const scroller = () => document.getElementById('view');
const artOf = (id) => (has('factory/' + id) ? 'factory/' + id : id === 'feedmill' && has('farm/mill') ? 'farm/mill' : `tier/${id}-1`);
const VERB = { crusher: 'Crush', separator: 'Separate', smelter: 'Smelt', forge: 'Forge', advanced: 'Assemble', refinery: 'Refine', feedmill: 'Mill' };
const SPLIT = { refinery: 'Refiners', war: 'Guild-war fighters', boss: 'Monster hunters' };
const freshState = () => fresh || (fresh = G.newState('fresh'));

// Evaluate fn with some fields of G.S temporarily replaced (paths like 'farm.day'); always restored. This lets the
// wiki ask the real game helpers "what if" questions (another level, another epoch...) without touching the save.
function withS(patch, fn) {
  const S = G.S, undo = [];
  try {
    for (const path in patch) {
      const ks = path.split('.'), last = ks.pop();
      let o = S;
      for (const k of ks) o = o[k];
      undo.push([o, last, o[last]]);
      o[last] = patch[path];
    }
    return fn();
  } finally { for (let i = undo.length - 1; i >= 0; i--) { const [o, k, v] = undo[i]; o[k] = v; } }
}
// a "bare" player: no squad, specialization, events, hazards or upgrades
const BARE = { squad: [], spec: null, hazard: null, 'live.id': null, 'guild.bonus': 0, 'guild.zoneLv': 1, 'fup.eff': 0, 'fup.waste': 0, 'fup.energy': 0 };
const pureRate = (z, extra = {}) => withS(Object.assign({}, BARE, { depth: z.from, machines: [], ['zones.' + z.id + '.lv']: 1 }, extra), () => G.zoneRate(z));
const mstat = (m, lv, zone = null) => withS({ squad: [], 'fup.energy': 0 }, () => G.machineStats({ type: m.id, lv, zone, dur: 100 }));
// the world as it is at the start of epoch e (halvings follow the world clock, like the contract)
const atEpoch = (e, fn) => withS({ worldT: e * D.supply.halvingDays * 86400, 'world.mined': D.cumEmission(e * D.supply.halvingDays) }, fn);

// natural pixel size of a WebP data URI, read from its header (building art keeps its natural size: later looks are bigger)
const natCache = {};
function nat(key) {
  if (natCache[key]) return natCache[key];
  let s = null;
  try {
    const uri = G.img(key), i = uri.indexOf(',') + 1, b = atob(uri.slice(i, i + 48)), u = (k) => b.charCodeAt(k), t = b.slice(12, 16);
    if (t === 'VP8X') s = { w: 1 + (u(24) | u(25) << 8 | u(26) << 16), h: 1 + (u(27) | u(28) << 8 | u(29) << 16) };
    else if (t === 'VP8L') { const v = u(21) | u(22) << 8 | u(23) << 16 | u(24) << 24; s = { w: 1 + (v & 0x3fff), h: 1 + ((v >>> 14) & 0x3fff) }; }
    else if (t === 'VP8 ') s = { w: (u(26) | u(27) << 8) & 0x3fff, h: (u(28) | u(29) << 8) & 0x3fff };
  } catch (e) { s = null; }
  return (natCache[key] = s && s.w > 0 && s.h > 0 ? s : { w: 220, h: 180 });
}

// Table: head = ['Label' | ['Label', 'cls']], rows = [[cell, ...]] where a cell is html or {h, c}. o.me(i) marks a row.
function T(head, rows, o = {}) {
  const hc = head.map((h) => (Array.isArray(h) ? h : [h, '']));
  const th = hc.map(([t, c]) => `<th class="${c}" scope="col">${t}</th>`).join('');
  const tr = rows.map((r, i) => `<tr class="${o.me && o.me(i) ? 'wk-me' : ''}">${r.map((x, j) => {
    const cell = x !== null && typeof x === 'object' ? x : { h: x == null ? '' : x };
    return `<td class="${cell.c || (hc[j] ? hc[j][1] : '')}">${cell.h}</td>`;
  }).join('')}</tr>`).join('');
  const tf = o.foot ? `<tfoot><tr>${o.foot.map((x) => { const c = x !== null && typeof x === 'object' ? x : { h: x }; return `<td class="${c.c || ''}">${c.h}</td>`; }).join('')}</tr></tfoot>` : '';
  return `<div class="wk-tw" tabindex="0"><table class="wk-t ${o.cls || ''}" style="--tmin:${o.min || 520}px">${o.cap ? `<caption>${o.cap}</caption>` : ''}<thead><tr>${th}</tr></thead><tbody>${tr}</tbody>${tf}</table></div>`;
}

// Small SVG line chart. o: {x0, x1, y0, y1, xt:[[v, label]], yt:[[v, label]], series:[{pts, cls, area}], extra(X, Y), legend, cap}
function chart(o) {
  if (textMode) return '';
  const W = 640, Hh = o.h || 280, L0 = o.left || 58, R0 = 24, T0 = o.yl ? 26 : 14, B0 = o.xl ? 46 : 32;
  const X = (x) => L0 + (x - o.x0) / (o.x1 - o.x0) * (W - L0 - R0);
  const Y = (y) => Hh - B0 - (y - o.y0) / (o.y1 - o.y0) * (Hh - T0 - B0);
  const path = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`).join(' ');
  let s = '';
  for (const [v, t] of o.yt) s += `<line class="wk-g" x1="${L0}" x2="${W - R0}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="wk-tk" x="${L0 - 7}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${t}</text>`;
  for (const [v, t] of o.xt) s += `<text class="wk-tk" x="${X(v).toFixed(1)}" y="${Hh - B0 + 17}" text-anchor="${v >= o.x1 ? 'end' : 'middle'}">${t}</text>`;
  s += `<line class="wk-axis" x1="${L0}" x2="${W - R0}" y1="${Y(o.y0)}" y2="${Y(o.y0)}"/>`;
  for (const se of o.series) {
    const p = se.pts, last = p[p.length - 1];
    if (se.area) s += `<path class="wk-area ${se.cls}" d="${path(p)} L${X(last[0]).toFixed(1)} ${Y(o.y0)} L${X(p[0][0]).toFixed(1)} ${Y(o.y0)} Z"/>`;
    s += `<path class="wk-line ${se.cls}" d="${path(p)}"/>`;
  }
  if (o.extra) s += o.extra(X, Y);
  if (o.xl) s += `<text class="wk-axl" x="${((L0 + W - R0) / 2).toFixed(0)}" y="${Hh - 6}" text-anchor="middle">${o.xl}</text>`;
  if (o.yl) s += `<text class="wk-axl" x="${L0 - 6}" y="14" text-anchor="start">${o.yl}</text>`;
  return `<figure class="wk-fig"><div class="wk-chart"><svg class="wk-svg" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(o.label || '')}">${s}</svg></div>
    ${o.legend ? `<div class="wk-legend">${o.legend.map(([cls, t]) => `<span><i class="${cls}"></i>${t}</span>`).join('')}</div>` : ''}${o.cap ? `<figcaption>${o.cap}</figcaption>` : ''}</figure>`;
}

// Gallery of a building's looks (Lv. 1..10), stepped with ◀ ▶ or the thumbnails; only the gallery re-renders.
function gallery(gid, name, keys, label, sub, def) {
  if (textMode || !keys.length) return '';
  galCfg[gid] = { name, keys, label, sub };
  if (!look[gid]) look[gid] = Math.min(keys.length, Math.max(1, def || 1));
  return `<div class="wk-gal" data-gal="${gid}">${galInner(gid)}</div>`;
}
function galInner(gid) {
  const g = galCfg[gid], n = Math.min(g.keys.length, Math.max(1, look[gid] || 1)), key = g.keys[n - 1], s = nat(key);
  return `<div class="wk-gal-stage">
      <button class="wk-gal-arr" data-a="wkLook" data-args='${args([gid, n - 1])}' ${n > 1 ? '' : 'disabled'} aria-label="Previous look">‹</button>
      <figure class="wk-gal-fig"><span class="wk-gal-glow"></span><img class="wk-gal-big" src="${G.img(key)}" width="${s.w}" height="${s.h}" alt="${esc(g.name)}, ${esc(g.label(n))} look" draggable="false"></figure>
      <button class="wk-gal-arr" data-a="wkLook" data-args='${args([gid, n + 1])}' ${n < g.keys.length ? '' : 'disabled'} aria-label="Next look">›</button>
    </div>
    <div class="wk-gal-cap"><b>${esc(g.label(n))}</b>${g.sub ? `<span>${g.sub(n)}</span>` : ''}<span class="wk-gal-k">Look ${n} of ${g.keys.length}</span></div>
    <div class="wk-gal-strip">${g.keys.map((k, i) => { const t = nat(k), on = i + 1 === n;
      return `<button class="wk-gal-th ${on ? 'on' : ''}" data-a="wkLook" data-args='${args([gid, i + 1])}' aria-pressed="${on}" title="${esc(g.label(i + 1))}"><img src="${G.img(k)}" style="width:${Math.round(t.w * 0.24)}px" alt="" draggable="false"><span>${esc(g.label(i + 1))}</span></button>`; }).join('')}</div>`;
}
const tierKeys = (id, max = 10) => { const k = []; for (let n = 1; n <= max; n++) if (has(`tier/${id}-${n}`)) k.push(`tier/${id}-${n}`); return k; };

// ---------- derived facts shared by several articles ----------
const zoneRes = (z) => [z.res, ...Object.keys(z.extra || {})];
function gateText(z) {
  const g = z.gate, p = [];
  if (!g) return '';
  if (g.factory) p.push(`build the ${L('b-' + g.factory, esc(D.factoryById(g.factory).name))}`);
  if (g.machine) p.push(`craft any ${L('machines', 'machine')}`);
  if (g.refineryLv) p.push(`${L('b-refinery', 'Henium Refinery')} Lv. ${g.refineryLv}`);
  if (g.license) p.push(`a ${L('guild', 'Guild License')}`);
  return p.join(' + ');
}
// contiguous depth ranges (digging FROM depth d) in which each resource is part of the dig cost
function digScan() {
  const m = {};
  for (let d = 1; d < D.maxDepth; d++) for (const r in D.digCost(d)) {
    const segs = m[r] = m[r] || [];
    const last = segs[segs.length - 1];
    if (last && last[1] === d - 1) last[1] = d; else segs.push([d, d]);
  }
  return m;
}
const segTxt = (segs) => segs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');
function milestones() { // floor levels where output doubles (detected from D.floorRate)
  const z = D.zones[0], out = [];
  for (let lv = 2; lv <= 300; lv++) { const j = D.floorRate(z, lv, 1) / D.floorRate(z, lv - 1, 1) / (lv / (lv - 1)); if (j > 1.01) out.push([lv, j]); }
  return out;
}
const growth = (fn) => { const a = fn(40), b = fn(41); return a > 0 ? b / a : 0; };
const recipeOf = (f, r) => `<div class="wk-rec">${chips(r.in, 16)}<span class="wk-arr">→</span>${f.id === 'refinery' ? `<span class="wk-cost"><span class="wk-c">${ic('henium', 16)}your share</span></span>` : chips(r.out, 16)}</div>`;
const firstUpHenium = () => { const f = D.factories[0]; for (let l = 1; l < D.factoryMaxLv; l++) if (D.factoryUpCost(f, l).henium) return l; return 0; };
const odds = (w) => { const t = w.reduce((a, b) => a + b, 0); return w.map((x) => (t ? x / t : 0)); };
const squadSteps = () => { const out = [[1, D.squadSlots(1)]]; for (let lv = 2; lv <= 100; lv++) if (D.squadSlots(lv) !== D.squadSlots(lv - 1)) out.push([lv, D.squadSlots(lv)]); return out; };
const fakeChikn = (o) => Object.assign({ id: -1, name: 'Example', role: 'miner', rarity: 'common', lv: 1, kg: 100, status: 'idle' }, o);
const feedAt = (kg, spec = null) => withS({ spec, 'live.id': null }, () => G.feedCost(fakeChikn({ kg })));
function feedTotal(from, to, spec = null) { let kg = from, t = 0, n = 0; while (kg < to - 1e-9 && n < 999) { t += feedAt(kg, spec); kg = Math.min(to, kg + F.step); n++; } return { feed: t, n }; }
// the lowest DEX fee share Trader Chikns can reach (ask G.feeK with an absurdly strong Trader in the team)
const feeFloor = () => withS({ spec: null, chikns: [fakeChikn({ id: -9, role: 'trader', rarity: D.rarities[D.rarities.length - 1].id, lv: 99, status: 'squad' })], squad: [-9] }, () => G.feeK());
const lvAt = (rarity, kg) => withS({ spec: null }, () => { const c = fakeChikn({ rarity, kg }); G.syncLv(c); return c.lv; });
// one refinery job vs selling its Henium Ore on the DEX (your refinery if built, else a Lv. 2 example)
function refineVsSell() {
  const f = D.factoryById('refinery'), rec = f && f.recipes[0], ore = rec ? rec.in.heniumOre || 0 : 0;
  if (!ore || !G.poolFor('heniumOre', 'henium')) return null;
  const own = G.S.factories.refinery.lv, lv = own || 2, W = G.worldRefPower();
  const p = own ? G.myRefPower() : D.refPower(lv), perDay = G.emission() * D.supply.split.refinery * p / (p + W);
  const jobT = rec.t * (own ? G.factorySpeed(f) : D.factorySpeed(lv));
  const rest = Object.fromEntries(Object.entries(rec.in).filter(([r]) => r !== 'heniumOre'));
  return { own, lv, ore, rest, perJob: perDay * jobT / F.day, sell: G.dexQuote('heniumOre', 'henium', ore).out };
}
const EPOCHS = 7; // epochs shown in the supply table and chart (the 7th ends in 2054)
const supplyBounds = () => Array.from({ length: EPOCHS + 1 }, (_, i) => D.cumEmission(i * D.supply.halvingDays));
const epochDate = (e) => new Date(D.supply.genesis + e * D.supply.halvingDays * 86400e3).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
// the most FEED daily missions can pay in one day: the fixed missions plus the best rotating one
const missionFeedMax = () => { const f = (m) => G.missionReward(m, 1).feed || 0;
  return D.missions.filter((m) => !RULE.rotating.includes(m.id)).reduce((t, m) => t + f(m), 0) + Math.max(0, ...D.missions.filter((m) => RULE.rotating.includes(m.id)).map(f)); };
// resources the progress bundles pay (daily missions, season track, hazards, fights) at some depth
let bundleSet = null;
const bundleRes = () => { if (!bundleSet) { bundleSet = new Set(); for (let d = 1; d <= D.maxDepth; d++) Object.keys(D.bundle(d, 1)).forEach((r) => bundleSet.add(r)); } return bundleSet; };
// the stone cost of a dig grows by g1 per level, then by g2 from the dig at depth knee on
function stoneGrowth() {
  const sg = (d) => D.digCost(d + 1).stone / D.digCost(d).stone, g1 = sg(1);
  for (let d = 2; d < D.maxDepth - 1; d++) if (Math.abs(sg(d) - g1) > 0.01) return { g1, knee: d, g2: sg(d) };
  return { g1, knee: 0, g2: g1 };
}
const myPlay = () => (PLAY() ? G.S : null);

// ======================================================================================================================
// Articles. Each returns HTML built from the live data.
// ======================================================================================================================
function aHome() {
  const fact = (k, a, b, id) => `<a class="wk-fact" href="#wiki/${id}" data-a="wkGo" data-args='${args([id])}'>${pic(k, 'wk-fact-ic')}<b>${a}</b><span>${b}</span></a>`;
  return `<div class="wk-facts">
      ${fact('ui/mines', `${D.zones.length} zones`, `depth 1–${D.maxDepth}`, 'zones')}
      ${fact('ui/factories', `${D.factories.length} factories`, `${D.factoryMaxLv} looks each`, 'buildings')}
      ${fact('ui/crafting', `${D.machines.length} machines`, `up to Lv. ${D.machineMaxLv}`, 'machines')}
      ${fact('ui/chikns', `${Object.keys(D.roles).length} Chikn roles`, `${D.rarities.length} rarities`, 'chikns')}
      ${fact('res/henium', `${G.fmt(D.supply.cap)} HENIUM`, 'fixed supply', 'henium')}
      ${fact('ui/dex', `${Object.keys(G.dexPools()).length} DEX pools`, 'x · y = k', 'dex')}
    </div>
    ${P(`Welcome to the encyclopedia of <b>Chikn Henium Mines</b>, the idle mining tycoon where your Chikns dig for ore, run factories and refine <b>HENIUM</b>, the scarce token at the heart of the game. New here? Start with ${L('start')}, then ${L('currencies')}.`)}
    ${box(`Every table and number in this wiki is read straight from the game's data and formulas, so it is always up to date. Search with the box (press <kbd>/</kbd>), follow the <span class="wk-a">blue links</span>, and use ◀ ▶ to go back and forward.`, 'tip', 'How to use the wiki')}
    <div class="wk-cards">${CATS.map((c) => `<section class="wk-card" id="wk-s-cat-${c.id}"><h3>${pic(c.icon, 'wk-card-ic')}${esc(c.name)}</h3>
      ${ARTS.filter((a) => a.cat === c.id).map((a) => `<div class="wk-card-a">${L(a.id)}<span>${esc(a.sub)}</span></div>`).join('')}</section>`).join('')}</div>`;
}

function aStart() {
  const S = myPlay(), chain = D.factories.filter((f) => f.id !== 'feedmill'), mill = D.factoryById('feedmill');
  const crusher = D.factoryById('crusher'), ref = D.factoryById('refinery');
  const step = (art, verb, name, body) => `<div class="wk-step">${pic(art, 'wk-step-art')}<div class="wk-step-v">${verb}</div><div class="wk-step-n">${name}</div><div class="wk-step-r">${body}</div></div>`;
  const arrow = '<span class="wk-flow-arr" aria-hidden="true">➜</span>';
  const flow = [step('ui/mines', 'Mine', L('zones', 'Mine floors'), `<span class="wk-cost">${D.topRes.map((r) => `<span class="wk-c">${ic(r, 20)}</span>`).join('')}</span>`)]
    .concat(chain.map((f) => step(artOf(f.id), VERB[f.id] || 'Make', L('b-' + f.id, esc(f.name)), f.recipes.map((r) => recipeOf(f, r)).join(''))));
  const unl = [];
  for (const z of D.zones) unl.push([z.from, `${ic(z.res, 20)} <b>${esc(z.name)}</b> opens`, z.gate ? `Needs: ${gateText(z)}` : 'Open from the start']);
  for (const f of D.factories) unl.push([f.reqDepth, `${pic(artOf(f.id), 'wk-tic')} ${L('b-' + f.id, esc(f.name))} can be built`, chips(f.build, 16)]);
  unl.sort((a, b) => a[0] - b[0]);
  const lvU = [];
  for (const m of D.machines) lvU.push([m.lv, `${pic('machine/' + m.id, 'wk-tic')} Craft the ${L('machines', esc(m.name))}`]);
  for (const e of D.expeditions) lvU.push([e.lv, `${pic('ui/expeditions', 'wk-tic')} Expedition: ${L('expeditions', esc(e.name))}`]);
  for (const [lv, n] of squadSteps().slice(1)) lvU.push([lv, `${pic('ui/chikns', 'wk-tic')} Mining Team grows to ${n} Chikns`]);
  lvU.push([RULE.specLv, `${pic('ui/trophy', 'wk-tic')} Choose a ${L('specs', 'specialization')}`]);
  lvU.push([RULE.hazardLv, `${pic('prop/rubble', 'wk-tic')} Creatures, bandits and cave-ins start to appear (${L('hazards', 'hazards')})`]);
  lvU.sort((a, b) => a[0] - b[0]);
  const curM = S ? D.journey.findIndex((j) => !safe(() => j.done(S), false)) : -1;
  const xpLv = [1, 5, 10, 15, 20, 25, 30, 40, 50];
  return `${P(`You run a Chikn mining company. Your Chikns dig ore out of a vertical mine, your factories turn it into ever more valuable materials, and at the end of the chain the ${L('b-refinery', 'Henium Refinery')} produces <b>HENIUM</b>. Dig deeper to reach richer zones, build and upgrade factories, craft machines, grow your Chikn farm and team up with your guild. The goal of Season 1: reach depth ${D.maxDepth}, the bottom of the world.`)}
    ${H('The production chain', 'chain')}
    ${P('Every resource flows down the same chain. Each step is a building with recipes: put materials in, wait, collect the output. Numbers are per job at building Lv. 1.')}
    <div class="wk-flow">${flow.join(arrow)}</div>
    ${P(`The ${L('b-separator', 'Ore Separator')} is a shortcut: it sorts Crushed Ore into the ores of deeper zones, so you can smelt and assemble before you can mine them. The refinery does not have a fixed output: it pays your share of the world's daily HENIUM emission (see ${L('henium')}).`)}
    ${H('The farm loop', 'farm')}
    <div class="wk-flow wk-flow-s">${step(artOf('feedmill'), 'Mill', L('b-feedmill', 'Feed Mill'), mill.recipes.map((r) => recipeOf(mill, r)).join(''))}${arrow}
      ${step('chikn/miner', 'Feed', L('chikns', 'Chikns'), `<span class="wk-cost"><span class="wk-c">${ic('feed', 16)}+${F.step} kg per feeding</span></span>`)}${arrow}
      ${step('farm/nest', 'Lay', L('farm', 'Egg Farm'), `<span class="wk-cost"><span class="wk-c">${ic('egg', 16)}~${sig(F.eggsAt(100))} per day at 100 kg</span></span>`)}</div>
    ${P(`Chikns lay <b>EGG</b>, the scarce everyday currency, about one per farm day each. They eat <b>FEED</b> every day, and heavier Chikns lay more eggs. FEED is limited by the Feed Mill's daily quota, which keeps egg inflation in check. Read ${L('farm')}.`)}
    ${H('Your first steps', 'first')}
    ${OL([
      `<b>Tap</b> the Stone Zone floor to mine by hand, then <b>upgrade</b> it (Lv. 2 costs ${chips(D.floorCost(D.zones[0], 1), 16)}) so it mines faster on its own. See ${L('zones')}.`,
      `<b>Dig deeper.</b> The first dig costs ${chips(D.digCost(1), 16)} and takes ${tm(D.digTime(2))}. Every dig costs more and takes longer: ${L('digging')}.`,
      `<b>Hire your first Chikn.</b> It's free (${freeHire()}). Chikns in your Mining Team boost everything they're good at: ${L('chikns')}.`,
      `At depth ${crusher.reqDepth} build the ${L('b-crusher', 'Ore Crusher')} (${chips(crusher.build, 16)}), at depth ${mill.reqDepth} the ${L('b-feedmill', 'Feed Mill')} (${chips(mill.build, 16)}). You need the crusher to break into the Coal Zone.`,
      `Follow the <b>quests</b> on the Mines screen. They walk you through every unlock and pay ores and materials for the next step, a little FEED and, at the big milestones, HENIUM (${L('events', 'quests')}).`,
      `Craft your first ${L('machines', 'machine')} and deploy it on a floor: it mines faster, and you need one to break into the Iron Zone.`,
      `From depth ${ref.reqDepth}, build the ${L('b-refinery', 'Henium Refinery')} and start earning HENIUM.`,
    ])}
    ${H('Unlocks by depth', 'depth')}
    ${T(['Depth', 'Unlock', 'Requirement / cost'], unl.map(([d, a, b]) => [{ h: `<b>${d}</b>`, c: 'wk-n' }, a, b]), { min: 560, me: (i) => S && unl[i][0] <= S.depth && (!unl[i + 1] || unl[i + 1][0] > S.depth) })}
    ${H('Unlocks by player level', 'level')}
    ${P(`You earn XP for almost everything: digging (more the deeper you go), building, finished factory jobs, crafting, hiring, battles, expeditions, quests and missions. Every level-up pays FEED (${RULE.levelFeed(10)} FEED at Lv. 10, ${RULE.levelFeed(30)} at Lv. 30).`)}
    ${T(['Player level', 'What opens'], lvU.map(([l, t]) => [{ h: `<b>Lv. ${l}</b>`, c: 'wk-n' }, t]), { min: 420 })}
    ${T(['Level', 'XP to the next level', 'Reward for reaching it'], xpLv.map((l) => [{ h: `Lv. ${l}`, c: 'wk-n' }, { h: n0(D.xpNeed(l)), c: 'wk-n' }, chips({ feed: RULE.levelFeed(l + 1) }, 16)]), { min: 380, me: (i) => S && S.player.lv === xpLv[i] })}
    ${H('The 6-month journey', 'journey')}
    ${P('The roadmap of Season 1. Each month is a chapter with a goal; the game ticks it off when you get there.')}
    ${T(['Month', 'Chapter', 'Goal', 'What happens', ...(S ? [''] : [])], D.journey.map((j, i) => [{ h: `<b>${i + 1}</b>`, c: 'wk-n' }, `<b>${esc(j.name)}</b>`, esc(j.goal), `<span class="wk-sm">${j.items.map(esc).join(' · ')}</span>`,
      ...(S ? [safe(() => j.done(S), false) ? '<span class="tag g">Done</span>' : i === curM ? '<span class="tag o">Now</span>' : ''] : [])]), { min: 640, me: (i) => i === curM })}
    ${H('Time', 'time')}
    ${UL([
      `Everything runs in real time. A <b>farm day</b> is a real day (${tm(F.day)}): eggs, FEED upkeep, the Feed Mill quota and the daily HENIUM payouts all run on farm days.`,
      `Factory jobs take minutes to hours, building upgrades from minutes (Lv. 2) to about two weeks (Lv. 10), and deep digs about a week each. Nothing comes easy: the Core Zone is about half a year away.`,
      `The game saves automatically. While you're away your floors keep mining for up to ${RULE.offlineH} hours; factories, buildings, digs, the farm and the daily payouts keep running for up to 60 days (machines don't wear out while you're offline).`,
    ])}`;
}

function aCurrencies() {
  const S = G.S, x = G.exRate(), st = D.hires.standard.cost, fr = freshState().res;
  const card = (r, t, line, id) => `<a class="wk-tok" href="#wiki/${id}" data-a="wkGo" data-args='${args([id])}'>${ic(r, 46)}<div><b>${t}</b><span>${line}</span></div></a>`;
  const eggUps = D.fUpgrades.filter((u) => u.base.egg).map((u) => u.name);
  const dep = PLAY() ? S.depth : 25;
  const pE = G.spot('egg', 'henium'), pH = G.spot('henium', 'eth');
  return `<div class="wk-toks">${card('egg', 'EGG', 'laid by Chikns · scarce · burned when spent', 'farm')}${card('feed', 'FEED', 'Chikn food · daily mill quota', 'farm')}${card('henium', 'HENIUM', `${G.fmt(D.supply.cap)} max · minted by work`, 'henium')}${card('eth', 'ETH', 'simulated · DEX only', 'dex')}</div>
    ${P(`A new mine starts with ${chips({ egg: fr.egg, feed: fr.feed, henium: fr.henium }, 18)}. Prices right now on the ${L('dex', 'DEX')}: 1 EGG = <b>${sig(pE)}</b> HENIUM${G.poolFor('feed', 'henium') ? `, 1 FEED = <b>${sig(G.spot('feed', 'henium'))}</b> HENIUM` : ''}, 1 HENIUM = <b>${sig(pH)}</b> ETH.`)}
    ${H(`${ic('egg', 26)} EGG`, 'egg')}
    ${P(`EGG is the everyday currency of the Chikn world, and it is <b>scarce</b>: only Chikns lay it, about one per farm day each (a 100 kg Chikn lays ${sig(F.eggsAt(100))}, an 800 kg one ${sig(F.eggsAt(800))}). Eggs collect in the nest, which holds ${F.nestDays} days of laying; collect them on the ${L('farm', 'Farm')} or with Collect All before it fills up.`)}
    ${P('Spending EGG <b>burns</b> it: it leaves the economy for good instead of going to another player. Where EGG goes:')}
    ${UL([
      `Hiring Chikns: a Standard Hire costs ${chips(st, 16)} (${L('chikns')}).`,
      `Coop upgrades: ${chips({ egg: F.coopCost(1).egg }, 16)} up to ${chips({ egg: F.coopCost(F.coopMax - 1).egg }, 16)} (${L('b-coop', 'Coop')}).`,
      eggUps.length ? `Global factory upgrades (${eggUps.join(', ')}), see ${L('buildings')}.` : '',
      `Guild: donations, zone expansions and the Guild License (${chips(D.licenseCost, 16)}), see ${L('guild')}.`,
      `Burning EGG for FEED: ${x.e2f} EGG → 1 FEED (the + button next to FEED).`,
      `Bandit tolls: paying bandits off costs ${chips({ egg: RULE.bandits.toll(dep) }, 16)} at depth ${dep} (${L('hazards')}).`,
      `Trading on the ${L('dex', 'DEX')}: a third of every swap fee is burned.`,
    ])}
    ${P(`Nothing else creates EGG. Quests, daily missions, battles, expeditions, the season track and hazards pay ores, materials, FEED or HENIUM, never EGG. The ${L('dex', 'DEX')} only moves existing EGG between players, and HENIUM can <b>never</b> be turned back into EGG.`)}
    ${H(`${ic('feed', 26)} FEED`, 'feed')}
    ${P(`FEED is Chikn food, ground from minerals. Chikns eat it every day (a 100 kg Chikn eats ${sig(F.upkeep(100))} FEED a day), you feed them to make them heavier (+${F.step} kg per feeding; the cost rises with weight) and a Standard Hire costs ${chips({ feed: st.feed }, 16)}. Without FEED, Chikns get hungry and slowly lose weight.`)}
    ${UL([
      `<b>Feed Mill</b>: grinds FEED from ${chips(D.factoryById('feedmill').recipes[0].in, 16)}, but only up to a daily quota (${F.millQuota(1)} FEED at Lv. 1, ${F.millQuota(D.factoryMaxLv)} at Lv. ${D.factoryMaxLv}): ${L('b-feedmill')}.`,
      `<b>Burning EGG</b>: ${x.e2f} EGG → 1 FEED.`,
      `<b>Rewards</b>, a little on purpose: ${RULE.levelFeed(10)} FEED per level-up at Lv. 10 (${RULE.levelFeed(30)} at Lv. 30), at most ${missionFeedMax()} a day from daily missions, ${D.seasonReward(2).feed}–${D.seasonReward(D.seasonMax - 2).feed} on even season levels, a few from one-time quests, ${RULE.exp.feedAmt[0]}–${RULE.exp.feedAmt[1]} now and then from expeditions and ${RULE.supply.feed(1)}–${RULE.supply.feed(D.maxDepth)} from supply crates and creatures (more the deeper you are).`,
    ])}
    ${P(`The Feed Mill's quota is by far the biggest source. ${G.poolFor('feed', 'henium') ? `FEED also trades on the ${L('dex', 'DEX')} (1 FEED = ${sig(G.spot('feed', 'henium'))} HENIUM right now). ` : 'FEED is not traded on the DEX. '}It is scarce on purpose: it is the brake on egg inflation.`)}
    ${H(`${ic('henium', 26)} HENIUM`, 'henium')}
    ${P(`HENIUM is the scarce token at the heart of the game, built like bitcoin: there will never be more than <b>${G.fmtFull(D.supply.cap)}</b>. The world has mined <b data-b="wkMined">${G.fmt(S.world.mined)}</b> so far. New HENIUM is minted only by work and fighting: the world's daily emission (${n0(G.emission())} HENIUM per farm day right now, halving over time) is split between refiners, guild-war fighters and monster hunters, and every HENIUM any reward pays you comes out of it. You need it for deep digs, high building levels, premium hires, the guild and speed-ups. Everything about it: ${L('henium')}.`)}
    ${H(`${ic('eth', 26)} ETH`, 'eth')}
    ${P(`ETH is <b>simulated</b> in this prototype: there is no wallet, blockchain or real money. You can sell EGG and HENIUM for ETH on the ${L('dex', 'DEX')} and buy them back, which shows what a real cash-out market would look like. Withdrawing ETH is not possible here.`)}`;
}

function sourcesOf(r) {
  const out = [], push = (k, v) => out.push(`<div class="wk-src"><b>${k}</b> ${v}</div>`);
  if (r === 'egg') push('Laid', `by every ${L('chikns', 'Chikn')}, ~1 per day (${L('farm', 'Egg Farm')})`);
  const zs = D.zones.filter((z) => z.res === r || (z.extra && z.extra[r]));
  if (zs.length) push('Mined', zs.map((z) => `${L('zones', esc(z.name))} <small>${z.from}–${z.to}${z.extra && z.extra[r] ? ` (+${pc(z.extra[r], 0)})` : ''}</small>`).join(', '));
  const mk = [];
  for (const f of D.factories) for (const rec of f.recipes) if (rec.out[r] !== undefined) mk.push(L('b-' + f.id, esc(f.id === 'refinery' ? f.name : rec.name)));
  if (mk.length) push(r === 'henium' ? 'Refined' : 'Made', mk.join(', '));
  const sc = D.machines.filter((m) => m.rare && r === 'rareEarth');
  if (sc.length) push('Machine', sc.map((m) => `${L('machines', esc(m.name))} <small>+${pc(m.rare, 0)} of floor output</small>`).join(', '));
  if (r === 'henium') push('Earned', `${L('guild', 'guild wars')}, ${L('battle', 'monster hunts')}, bounties, quests, the season track, guild projects, expeditions, PvP and bandit wins: all paid out of the daily emission (${L('henium')})`);
  if (r === 'feed') push('Burn', `${G.exRate().e2f} EGG → 1 FEED`);
  const ex = D.expeditions.concat(D.veinExpedition || []).filter((e) => e.r[r]);
  if (ex.length) push('Loot', `${L('expeditions', 'expeditions')}: ${ex.map((e) => esc(e.name)).join(', ')}`);
  const bt = D.stages.filter((s) => s.r[r]);
  if (bt.length) push('Battle', bt.map((s) => esc(s.name)).join(', '));
  if (r === 'egg') push('Rewards', 'never: only Chikns lay EGG');
  else if (r === 'feed') push('Rewards', `a little from level-ups, ${L('events', 'missions')}, quests, the season track and ${L('hazards', 'hazards')}`);
  else {
    const rw = [D.quests.some((q) => q.r[r]) ? 'quests' : '', bundleRes().has(r) ? `${L('events', 'missions')}, the season track, ${L('hazards', 'hazards')} and PvP` : ''].filter(Boolean);
    if (rw.length) push('Rewards', rw.join(', '));
  }
  if (r === 'eth') push('DEX', `swap EGG or HENIUM for it (${L('dex', 'DEX')})`);
  else if (['egg', 'feed'].includes(r) && G.poolFor(r, 'henium')) push('DEX', `buy it from other players (${L('dex', 'DEX')})`);
  return out.join('') || '<span class="dim">—</span>';
}
function usesOf(r, scan) {
  const out = [], push = (k, v) => out.push(`<div class="wk-src"><b>${k}</b> ${v}</div>`);
  const recs = [];
  for (const f of D.factories) for (const rec of f.recipes) if (rec.in[r]) recs.push(L('b-' + f.id, esc(rec.name)));
  if (recs.length) push('Recipes', recs.join(', '));
  const builds = D.factories.filter((f) => f.build[r]);
  if (builds.length) push('Build', builds.map((f) => L('b-' + f.id, esc(f.name))).join(', '));
  const ups = {};
  for (const f of D.factories) for (let l = 1; l < D.factoryMaxLv; l++) if (D.factoryUpCost(f, l)[r] && !f.build[r]) { ups[f.id] = l; break; }
  const ids = Object.keys(ups);
  if (ids.length) {
    const lvs = [...new Set(Object.values(ups))];
    push('Upgrades', ids.length >= D.factories.length - builds.length && lvs.length === 1 ? `every building from Lv. ${lvs[0]} → ${lvs[0] + 1}${builds.length ? ' (plus the ones above)' : ''}`
      : ids.map((id) => `${L('b-' + id, esc(D.factoryById(id).name))} <small>Lv. ${ups[id]}→</small>`).join(', '));
  }
  if (F.coopCost(1)[r]) push('Coop', L('b-coop', 'coop upgrades'));
  const mc = D.machines.filter((m) => m.cost[r]);
  if (mc.length) push('Machines', mc.map((m) => L('machines', esc(m.name))).join(', '));
  let mu = false;
  for (const m of D.machines) for (let l = 1; l < D.machineMaxLv; l++) if (D.machineUpCost(m, l)[r]) mu = true;
  const sv = !!D.machineServiceCost(0)[r];
  if (mu || sv) push('Machine care', [mu ? 'upgrades' : '', sv ? 'servicing' : ''].filter(Boolean).join(', '));
  if (r === 'coal') push('Fuel', 'every working machine burns Coal');
  const fl = D.zones.filter((z) => z.up[r]);
  if (fl.length) push('Floors', `upgrading ${fl.map((z) => esc(z.short)).join(', ')}`);
  if (scan[r]) push('Digging', `${L('digging', 'digs')} from depth ${segTxt(scan[r])}`);
  const hires = Object.values(D.hires).filter((h) => h.cost[r]);
  if (hires.length) push('Hiring', hires.map((h) => esc(h.name)).join(', '));
  if (r === 'feed') push('Farm', 'feeding & daily upkeep');
  const gd = [];
  if (D.donations.some((d) => d.res === r)) gd.push('donations');
  if (D.guildZoneCost(1)[r]) gd.push('zone');
  if (D.licenseCost[r]) gd.push('license');
  if (gd.length) push('Guild', L('guild', gd.join(', ')));
  const fu = D.fUpgrades.filter((u) => u.base[r]);
  if (fu.length) push('Factory upgrades', fu.map((u) => esc(u.name)).join(', '));
  if (r === 'henium') push('Speed-ups', 'finish jobs, crafts, builds and digs now');
  if (r === 'stone') push('Hazards', 'clearing cave-ins');
  if (r === 'egg') push('Hazards', 'bandit tolls · burn for FEED');
  return out.join('') || '<span class="dim">trading only</span>';
}
function aResources() {
  const scan = digScan(), CAT = { cur: 'Currency', raw: 'Raw ore', mat: 'Material', ext: 'External' };
  const toks = new Set(G.dexTokens()), notTraded = Object.keys(D.res).filter((r) => !toks.has(r));
  const rows = Object.keys(D.res).map((r) => {
    const p = r === 'henium' ? G.spot('henium', 'eth') : G.poolFor(r, 'henium') ? G.spot(r, 'henium') : 0;
    return [`<div class="wk-rcell">${ic(r, 32)}<div><b>${esc(rn(r))}</b><span class="wk-cat-t wk-k-${D.res[r].cat}">${CAT[D.res[r].cat] || D.res[r].cat}</span>
        <small>${p ? `${sig(p)} ${r === 'henium' ? 'ETH' : 'HENIUM'}` : 'not on the DEX'}</small></div></div>`, sourcesOf(r), usesOf(r, scan)];
  });
  return `${P(`The game has ${Object.keys(D.res).length} resources in four groups: <b>currencies</b> (${L('currencies')}), <b>raw ores</b> you mine, <b>materials</b> your factories make, and simulated <b>ETH</b>. Raw ores come from the ${L('zones', 'mine zones')}; materials come from the recipes of the ${L('buildings', 'buildings')}. ${notTraded.length ? `Everything except ${notTraded.map((r) => esc(rn(r))).join(', ')}` : 'Every resource'} can also be bought and sold on the ${L('dex', 'DEX')}; the small number under each name is its live price.`)}
    ${T(['Resource', 'Where it comes from', 'What uses it'], rows, { min: 660, cls: 'wk-res' })}
    ${H('Reading the chain', 'chain')}
    ${UL([
      `<b>Stone</b> is used by almost everything, and every dig costs more of it. Keep upgrading the Stone Zone.`,
      `<b>Coal</b> fuels every machine and is part of most smelting and refining. Machines stop when it runs out.`,
      `<b>Ingots</b> (Smelter) are needed for digs past the Copper and Iron Zones, machines and upgrades.`,
      `<b>Components, Machine Parts, Alloy and Circuits</b> gate the late game: deep digs, high building levels and the best machines.`,
      `<b>Henium Ore</b> is mined in the Henium Vein and the Core Zone, and refined into HENIUM.`,
    ])}`;
}

function aZones() {
  const S = myPlay(), z0 = D.zones[0], ms = milestones(), dugK = D.floorRate(z0, 1, 2) / D.floorRate(z0, 1, 1) - 1;
  const upK = growth((lv) => Object.values(D.floorCost(z0, lv))[0]);
  const rows = D.zones.map((z) => [`<span class="wk-rname">${ic(z.res, 28)}<b>${esc(z.name)}</b></span>`, { h: `${z.from}–${z.to}`, c: 'wk-n' },
    zoneRes(z).map((r) => `${ic(r, 18)} ${esc(rn(r))}${z.extra && z.extra[r] ? ` <small>+${pc(z.extra[r], 0)}</small>` : ''}`).join('<br>'),
    { h: `${sig(z.base)}/s<br><small>${n0(z.base * 3600)}/h</small>`, c: 'wk-n' }, chips(z.up, 16), z.gate ? gateText(z) : '<span class="dim">—</span>']);
  const lvls = [1, 5, ...ms.flatMap(([l]) => [l - 1, l])].filter((v, i, a) => v >= 1 && a.indexOf(v) === i).sort((a, b) => a - b);
  const full = z0.to - z0.from + 1;
  const ex = lvls.map((lv) => [{ h: `Lv. ${lv}`, c: 'wk-n' }, { h: `${big(D.floorRate(z0, lv, full) * 3600)}/h`, c: 'wk-n' }, { h: ms.some(([l]) => l === lv) ? `<span class="tag o">×${ms.find(([l]) => l === lv)[1].toFixed(0)} milestone</span>` : '', c: '' }, chips(D.floorCost(z0, lv), 16)]);
  const hz = D.zoneById('henium'), rz = D.zoneById('rare');
  const hoK = hz ? pureRate(hz, { 'guild.zoneLv': 2 }) / pureRate(hz) - 1 : 0, reK = rz ? pureRate(rz, { 'guild.zoneLv': 2 }) / pureRate(rz) - 1 : 0;
  const minerK = pureRate(z0, { spec: 'miner' }) / pureRate(z0) - 1;
  const mine = S ? D.zones.filter((z) => G.zoneOpen(z)).map((z) => { const m = G.machineOn(z.id);
    return [`${ic(z.res, 20)} ${esc(z.short)}`, { h: `Lv. ${S.zones[z.id].lv}`, c: 'wk-n' }, { h: `${G.zoneDug(z)}/${z.to - z.from + 1}`, c: 'wk-n' }, { h: `${big(G.zoneRate(z) * 3600)}/h`, c: 'wk-n' }, m ? esc(D.machineById(m.type).name) + ` Lv. ${m.lv}` : '<span class="dim">—</span>']; }) : [];
  return `${P(`Your mine is a vertical shaft of ${D.maxDepth} depth levels in ${D.zones.length} zones. Each zone has one <b>floor</b> that produces its ore all the time, faster the more you upgrade it and the deeper you have dug inside the zone. You open a zone by ${L('digging', 'digging')} into its first depth level.`)}
    ${T(['Zone', ['Depth', 'wk-n'], 'Produces', ['Base rate (floor Lv. 1)', 'wk-n'], 'First upgrade', 'To break in'], rows, { min: 700 })}
    ${H('How floor output works', 'rate')}
    ${fx(`output per second = base × floor level × (1 + ${pc(dugK, 0)} × (levels dug in the zone − 1)) × 2<sup>milestones</sup>`)}
    ${UL([
      `<b>Floor level</b>: output grows in a straight line with the level.`,
      `<b>Depth dug</b>: every extra depth level you dig inside a zone adds ${pc(dugK, 0)} to that zone's output (a fully dug ${esc(z0.short)} Zone: +${pc(dugK * (full - 1), 0)}).`,
      `<b>Milestones</b>: at floor level ${ms.map(([l]) => l).join(', ')} output doubles again (×${ms.length ? ms[0][1].toFixed(0) : 2} each).`,
      `Each upgrade costs ${upK ? `×${upK.toFixed(2)}` : 'more than'} the one before, in the zone's own ore (see the first-upgrade column).`,
    ])}
    ${T(['Floor level', ['Stone output (fully dug)', 'wk-n'], 'Note', 'Upgrade to the next level'], ex, { min: 520, cap: `${esc(z0.name)}, all ${full} depth levels dug, no bonuses` })}
    ${H('Everything that changes a floor', 'mult')}
    ${UL([
      `<b>Machines</b>: one ${L('machines', 'machine')} per floor multiplies its output and adds a flat amount per hour.`,
      `<b>Miner Chikns</b> in your Mining Team add their bonus %, Leaders half of theirs (${L('chikns')}).`,
      `<b>Guild projects</b> add a permanent mining bonus for everyone (${L('guild')}).`,
      `<b>Miner specialization</b>: +${pc(minerK, 0)} on every floor (${L('specs')}).`,
      `<b>Guild zone</b> levels: +${pc(hoK, 0)} Henium Ore and +${pc(reK, 0)} Rare Earth per level above 1.`,
      `<b>Live events</b> can double a zone for a while (${L('events')}); a <b>cave-in</b> stops a floor until you clear it (${L('hazards')}).`,
    ])}
    ${H('Tapping', 'tap')}
    ${P(`Tapping a floor mines by hand: each tap gives ${pc(RULE.tap.share, 0)} of the floor's output per second plus ${RULE.tap.base} × base × √(floor level), at least 1. A <b>rich vein</b> makes taps worth ×${RULE.rich.mult} for ${RULE.rich.taps} taps. Every tap costs 1 <b>tap energy</b>: you hold up to ${RULE.tap.energyMax}, and it refills 1 every ${Math.round(1 / RULE.tap.regen)} s, so tapping speeds you up but never replaces your floors' real production.`)}
    ${mine.length ? you(T(['Floor', ['Level', 'wk-n'], ['Dug', 'wk-n'], ['Output', 'wk-n'], 'Machine'], mine, { min: 460 })) : ''}
    ${goBtn('mines', 'Open the Mines')}`;
}

function aDigging() {
  const S = myPlay(), scan = digScan(), sample = [2, 5, 10, 15, 20, 21, 22, 25, 30, 35, 40, 45, 50].filter((d) => d >= 2 && d <= D.maxDepth);
  const firstH = scan.henium ? scan.henium[0][0] : 0;
  const row = (d) => { const z = D.zoneOf(d - 1), gz = D.zones.find((x) => x.from === d);
    return [{ h: `<b>${d}</b>`, c: 'wk-n' }, `${ic(z.res, 18)} ${esc(z.short)}`, chips(D.digCost(d - 1), 16), { h: tm(D.digTime(d)), c: 'wk-n' }, gz && gz.gate ? `<span class="wk-sm">${gateText(gz)}</span>` : gz ? 'new zone' : ''];
  };
  const head = ['Dig to depth', 'Digging in', 'Cost', ['Time', 'wk-n'], 'Gate'];
  const all = [];
  for (let d = 2; d <= D.maxDepth; d++) all.push(d);
  const zoneOres = new Set(D.zones.map((z) => z.res));
  const extras = Object.keys(scan).filter((r) => r !== 'stone' && !zoneOres.has(r)).sort((a, b) => scan[a][0][0] - scan[b][0][0]);
  const totCost = sumCost(all.map((d) => D.digCost(d - 1))), totT = all.reduce((s, d) => s + D.digTime(d), 0);
  const ds = PLAY() ? G.digSpeed() : 1;
  const zc = D.zones.find((z) => z.res !== 'stone' && z.to > z.from + 1), zoreK = zc ? D.digCost(zc.to - 1)[zc.res] / D.digCost(zc.to - 2)[zc.res] : 0;
  const heavy = D.machineById('heavy'), hs = heavy ? mstat(heavy, D.machineMaxLv).speed : 0, d30 = Math.min(30, D.maxDepth);
  return `${P(`Digging opens the next depth level of your mine: deeper levels make each zone more productive, and the first level of a new zone opens a whole new floor. A dig is paid up front and then takes time; one dig runs at a time. The cost depends on the depth you dig <b>from</b>, the time on the depth you dig <b>to</b>.`)}
    ${H('What a dig costs', 'cost')}
    ${UL([
      (() => { const sg = stoneGrowth(); return `<b>Stone</b>, always: ${chips({ stone: D.digCost(1).stone }, 16)} for the first dig, ×${sg.g1.toFixed(2)} for every level deeper${sg.knee ? ` up to the dig from depth ${sg.knee} (${chips({ stone: D.digCost(sg.knee).stone }, 16)}), then only ×${sg.g2.toFixed(2)} per level (${chips({ stone: D.digCost(D.maxDepth - 1).stone }, 16)} for the last dig)` : ''}.`; })(),
      `<b>The ore of the zone you're digging in</b>, from the ${esc(zc ? zc.name : 'Coal Zone')} on (×${zoreK.toFixed(2)} per level inside a zone; it starts over in every new zone).`,
      ...extras.map((r) => `${ic(r, 18)} <b>${esc(rn(r))}</b> for digs from depth ${scan[r][0][0]} on${r === 'henium' ? ' (the first HENIUM dig is ' + firstH + ' → ' + (firstH + 1) + ')' : ''}.`),
    ])}
    ${box(`<b>HENIUM is needed from depth ${firstH}:</b> once you stand in the ${esc(D.zoneOf(firstH).name)}, every further dig costs ${chips({ henium: D.digCost(firstH).henium }, 16)} and up (${chips({ henium: D.digCost(D.maxDepth - 1).henium }, 16)} for the last one). Digging to depth ${firstH} itself still costs no HENIUM.`, 'warn')}
    ${T(head, sample.map(row), { min: 720, me: (i) => sample[i] === firstH + 1 })}
    <details class="wk-more"><summary>Show every depth (2–${D.maxDepth})</summary>${T(head, all.map(row), { min: 720, me: (i) => S && all[i] === S.depth + 1 })}</details>
    ${P(`All digs from depth 1 to ${D.maxDepth} together cost ${chips(totCost, 16)} and take ${tm(totT)} of digging (without machines).`)}
    ${H('Gates: breaking into a new zone', 'gates')}
    ${P('The first dig into a new zone also needs a milestone behind you:')}
    ${UL(D.zones.filter((z) => z.gate).map((z) => `${ic(z.res, 18)} <b>${esc(z.name)}</b> (depth ${z.from}): ${gateText(z)}.`))}
    ${H('Machines dig faster', 'speed')}
    ${P(`A working ${L('machines', 'machine')} on the floor of the zone you're digging in speeds the dig up by its speed: a ${heavy ? esc(heavy.name) : 'drill'} at Lv. ${D.machineMaxLv} digs ×${hs.toFixed(1)} as fast, so the dig to depth ${d30} takes ${tm(D.digTime(d30) / (hs || 1))} instead of ${tm(D.digTime(d30))}. A broken machine or one without Coal doesn't help.`)}
    ${P(`<b>Finish now</b>: you can complete a running dig at once for ${2} HENIUM per started ${(() => { let s = 1; while (G.speedCost(s + 1) === 1 && s < 3600) s++; return s; })()} seconds left (twice the price of a factory speed-up). Example: the dig to depth ${d30} costs ${chips({ henium: 2 * G.speedCost(D.digTime(d30)) }, 16)} to finish instantly.`)}
    ${S ? you(`You are at depth <b>${S.depth}</b>. Dig speed right now: <b>×${ds.toFixed(2)}</b>${ds > 1 ? ' (thanks to your machine)' : ' (no working machine on your deepest floor)'}${S.dig ? `. Digging to depth ${S.dig.to}: <b data-b="wkDig"></b> left` : ''}.`) : ''}
    ${goBtn('mines', 'Open the Mines')}`;
}

function aBuildings() {
  const S = myPlay(), fh = firstUpHenium(), spd = D.factorySpeed(2), yl = D.factoryYield(2);
  const all = D.factories.map((f) => ({ id: 'b-' + f.id, name: f.name, art: G.bImg(f.id, S ? Math.max(1, S.factories[f.id].lv) : 1), line: `depth ${f.reqDepth}`, cost: chips(f.build, 15) }))
    .concat([{ id: 'b-coop', name: 'Coop', art: S ? G.coopImg() : 'tier/coop-1', line: 'from the start', cost: `houses ${F.coop(1)} Chikns` },
      { id: 'b-hq', name: 'Headquarters', art: S ? G.hqImg() : 'tier/hq-1', line: 'from the start', cost: 'grows as you dig' }]);
  const slots0 = withS({ 'fup.slots': 0 }, () => G.jobSlots());
  let step = 1; while (G.speedCost(step + 1) === 1 && step < 3600) step++;
  const fu = D.fUpgrades.map((u) => [`<b>${esc(u.name)}</b>`, esc(u.desc), { h: u.max, c: 'wk-n' },
    `<div class="wk-lvcost">${Array.from({ length: u.max }, (_, l) => `<span><small>Lv. ${l + 1}</small>${chips(D.fUpCost(u, l), 15)}</span>`).join('')}</div>`]);
  return `${P(`Buildings turn raw ore into everything else. There are ${D.factories.length} factories, the ${L('b-coop', 'Coop')} on the farm and your ${L('b-hq', 'Headquarters')}. Each factory unlocks at a depth, is built once and then upgraded up to Lv. ${D.factoryMaxLv}. <b>Every level has its own look</b> (${D.factoryMaxLv} per building), each richer than the last: wood, stone, iron, brass, gold, crystal and finally legendary.`)}
    <div class="wk-bgrid">${all.map((b) => `<a class="wk-bcard" href="#wiki/${b.id}" data-a="wkGo" data-args='${args([b.id])}'><span class="wk-bcard-art">${pic(b.art, '', b.name)}</span><b>${esc(b.name)}</b><small>${b.line}</small><span class="wk-bcard-c">${b.cost}</span></a>`).join('')}</div>
    ${H('Construction', 'build')}
    ${P(`Building or upgrading <b>starts construction</b>: you pay up front, then it takes time (the same for every building). While a building is under construction its jobs pause and it takes no new ones. You can finish construction at once for 2 HENIUM per started ${step} seconds left.`)}
    ${T(['Level', ...Array.from({ length: D.factoryMaxLv }, (_, i) => [`${i + 1}`, 'wk-n'])], [['Build time', ...Array.from({ length: D.factoryMaxLv }, (_, i) => ({ h: tm(D.buildTime(i + 1)).replace(' ', '<br>'), c: 'wk-n' }))]], { min: 600 })}
    ${P(`Every level makes jobs <b>${pc(1 - spd, 0)} faster</b> (job time ×${spd.toFixed(2)} per level) and output <b>${pc(yl - 1, 0)} bigger</b>. Upgrades get much pricier each level and need better materials: Components from Lv. 2 → 3, Machine Parts from Lv. 4 → 5, <b>HENIUM from Lv. ${fh} → ${fh + 1}</b>, Alloy and Circuits after that.`)}
    ${H('The production queue', 'queue')}
    ${UL([
      `You have <b>${slots0} queue slots</b> (more with the Queue Slot upgrade). Each building works on one job at a time, in queue order; jobs of different buildings run in parallel.`,
      `Inputs are paid when you queue a job. <b>Repeat</b> re-queues the same job when it finishes, as long as you have the materials.`,
      `Cancelling a job refunds everything if it hasn't started, ${pc(RULE.refund, 0)} if it has.`,
      `Speed-up: 1 HENIUM per started ${step} seconds left. Refinery batches can't be rushed: they pay HENIUM for the time they run (${L('b-refinery', 'Henium Refinery')}).`,
      `Job time is also shortened by Operator Chikns, the Efficiency upgrade and the Industrialist specialization; the Waste upgrade lowers recipe inputs.`,
    ])}
    ${H('Global factory upgrades', 'fup')}
    ${P('Paid with HENIUM and EGG on the Factories screen; they apply to every building.')}
    ${T(['Upgrade', 'Effect per level', ['Max', 'wk-n'], 'Cost of each level'], fu, { min: 640 })}
    ${goBtn('factories', 'Open the Factories')}`;
}

const BLURB = {
  crusher: 'The first step of every production chain. The Ore Crusher breaks Stone into Crushed Ore, the raw input of the Ore Separator and of the Feed Mill.',
  separator: 'Sorts and concentrates Crushed Ore into Copper, Iron, a little Henium Ore and a pinch of Rare Earth: a way to get the ores of deeper zones before you can mine them.',
  smelter: 'Melts Copper and Iron with Coal into ingots. Ingots are needed for deeper digs, machines and most upgrades.',
  forge: 'Turns ingots into Components and Machine Parts, the building blocks of machines, building upgrades and deep digs.',
  advanced: 'High-tech assembly: Alloy and Circuits from ingots, Components and Rare Earth. You need them for the refinery, the best machines, deep digs and high building levels.',
  refinery: 'The heart of the HENIUM economy. It processes Henium Ore into HENIUM, but how much it pays depends on your refinery power compared with the rest of the world.',
  feedmill: 'Grinds mineral FEED for your Chikns. The world\'s FEED is limited, so the mill may only grind a daily quota that grows with its level.',
};
function aFactory(f) {
  const S = myPlay(), st = S ? S.factories[f.id] : null, lv = st ? st.lv : 0;
  const isRef = f.id === 'refinery', isMill = f.id === 'feedmill', rec0 = f.recipes[0], out0 = Object.entries(rec0.out)[0];
  const W = G.worldRefPower(), E = G.emission() * D.supply.split.refinery;
  const head = ['Level', 'Cost to reach it', ['Build time', 'wk-n'], [`Job time (${esc(rec0.name)})`, 'wk-n']];
  if (isRef) head.push(['Power (world share now)', 'wk-n'], ['HENIUM / day now', 'wk-n']);
  else head.push([`Yield (${esc(rn(out0[0]))})`, 'wk-n']);
  if (isMill) head.push(['Daily FEED quota', 'wk-n']);
  const costs = [];
  const rows = [];
  for (let l = 1; l <= D.factoryMaxLv; l++) {
    const cost = l === 1 ? f.build : D.factoryUpCost(f, l - 1), sp = D.factorySpeed(l), y = D.factoryYield(l);
    costs.push(cost);
    const r = [{ h: `<b>Lv. ${l}</b>`, c: 'wk-n' }, chips(cost, 15), { h: tm(D.buildTime(l)), c: 'wk-n' }, { h: `${secs(rec0.t * sp)} <small>×${(1 / sp).toFixed(2)}</small>`, c: 'wk-n' }];
    if (isRef) { const p = D.refPower(l), sh = p / (p + W); r.push({ h: `${n0(p)} <small>${pc(sh, 2)}</small>`, c: 'wk-n' }, { h: nd(E * sh), c: 'wk-n' }); }
    else r.push({ h: `×${y.toFixed(2)} <small>${n0(Math.max(1, Math.round(out0[1] * y)))}</small>`, c: 'wk-n' });
    if (isMill) { const per = Math.max(1, Math.round(out0[1] * y)); r.push({ h: `${n0(F.millQuota(l))} <small>${sig(F.millQuota(l) / per, 2)} jobs</small>`, c: 'wk-n' }); }
    rows.push(r);
  }
  const recRows = f.recipes.map((r) => [`<b>${esc(r.name)}</b>`, chips(r.in, 16), isRef ? `${ic('henium', 16)} your share of the emission` : chips(r.out, 16), { h: secs(r.t), c: 'wk-n' }]);
  const keys = tierKeys(f.id, D.factoryMaxLv);
  const refPart = isRef ? (() => {
    const myP = lv > 0 ? G.myRefPower() : 0, ex = lv || 1, exP = lv ? myP : D.refPower(ex), sh = exP / (exP + W);
    const jobT = rec0.t * D.factorySpeed(ex);
    return `${H('How the refinery pays', 'pay')}
      ${P(`The recipe's inputs are fixed, its output is not. The whole world may mint ${n0(G.emission())} HENIUM per farm day right now, and ${pc(D.supply.split.refinery, 0)} of it (${n0(E)}) goes to refiners, shared by <b>refinery power</b>. Your power is set by the refinery level, plus bonuses from Scientist Chikns, the guild zone and the Miner specialization. Every finished job pays your daily share × job time ÷ day length (${tm(F.day)}).`)}
      ${fx(`HENIUM per day = ${n0(G.emission())} × ${pc(D.supply.split.refinery, 0)} × your power ÷ (your power + world power)`)}
      ${P(`${lv ? `Your Lv. ${lv} refinery has <b>${sig(myP)}</b> power` : `A Lv. ${ex} refinery has <b>${n0(exP)}</b> power`}; the rest of the world has <b>${n0(W)}</b> today. Share: ${sig(exP)} ÷ ${n0(exP + W)} = <b>${pc(sh, 2)}</b>, so the refinery earns <b>${nd(E * sh)}</b> HENIUM a day if it never stops: about ${nd(E * sh * jobT / F.day, 3)} per ${secs(jobT)} job.`)}
      ${box(`The world adds about ${pc(D.supply.worldGrowth, 1)} refinery power every farm day, so your share shrinks unless you keep upgrading. Batches have a fixed length and can't be rushed with HENIUM, so only <b>power</b> raises your daily HENIUM. More in ${L('henium')}.`, 'warn')}`;
  })() : '';
  const millPart = isMill ? `${H('The daily quota', 'quota')}
      ${P(`FEED is the brake on the egg economy, so every Feed Mill may only grind its share of the world's FEED each farm day: ${F.millQuota(1)} FEED at Lv. 1, +${F.millQuota(2) - F.millQuota(1)} per level. Queued jobs count toward the quota; when it's used up, the mill (and its repeat) waits for the next farm day. More in ${L('farm')}.`)}
      ${S && lv ? you(`Today: <b>${n0(S.farm.milled + G.queuedFeed())}</b> of <b>${n0(G.millQuota())}</b> FEED milled or queued. Next farm day in <b data-b="farmday"></b>.`) : ''}` : '';
  return `${dl([['Unlocks at', `depth ${f.reqDepth}`], ['Build cost', chips(f.build, 16)], ['First build', tm(D.buildTime(1))], ['Max level', `Lv. ${D.factoryMaxLv}`],
      S ? ['Yours', lv ? `<b>Lv. ${lv}</b>${st.con ? ` · building Lv. ${st.con.to}` : ''}` : st && st.con ? 'under construction' : 'not built yet'] : null])}
    ${P(esc(BLURB[f.id] || f.desc))}
    ${H('Recipes', 'recipes')}
    ${T(['Recipe', 'Input', 'Output (Lv. 1)', ['Time (Lv. 1)', 'wk-n']], recRows, { min: 520 })}
    ${refPart}${millPart}
    ${H(`${D.factoryMaxLv} looks`, 'looks')}
    ${P(`Every upgrade gives the ${esc(f.name)} a new, grander look, and later looks are drawn bigger. Step through them:`)}
    ${gallery('b-' + f.id, f.name, keys, (n) => `Lv. ${n}`, (n) => (n === lv ? '<span class="tag g">yours</span>' : n === 1 ? 'wood' : n === keys.length ? 'legendary' : ''), lv || 1)}
    ${H('Upgrades', 'upgrades')}
    ${T(head, rows, { min: isRef ? 700 : 680, me: (i) => i + 1 === lv, foot: [{ h: '<b>Total</b>' }, chips(sumCost(costs), 15), { h: tm(Array.from({ length: D.factoryMaxLv }, (_, i) => D.buildTime(i + 1)).reduce((a, b) => a + b, 0)), c: 'wk-n' }, ...Array.from({ length: head.length - 3 }, () => '')] })}
    ${P(`Yield multiplies every recipe's output${isRef ? ' (except the refinery\'s HENIUM, which follows power)' : ''}; job time is before Operator, Efficiency and Industrialist bonuses.`)}
    ${goBtn('factories', 'Open the Factories')}`;
}

function aCoop() {
  const S = myPlay(), lv = S ? S.farm.coopLv : 0, keys = tierKeys('coop', F.coopMax);
  const rows = Array.from({ length: F.coopMax }, (_, i) => i + 1).map((l) => [{ h: `<b>Lv. ${l}</b>`, c: 'wk-n' }, { h: `${F.coop(l)} Chikns`, c: 'wk-n' }, l === 1 ? '<span class="dim">starting coop</span>' : chips(F.coopCost(l - 1), 15)]);
  return `${dl([['Houses', `${F.coop(1)} Chikns at Lv. 1, ${F.coop(F.coopMax)} at Lv. ${F.coopMax}`], ['Upgrade', 'instant, on the Farm screen'], S ? ['Yours', `<b>Lv. ${lv}</b> · ${S.chikns.length}/${G.coopCap()} Chikns`] : null])}
    ${P(`The coop is where your Chikns live. It holds a limited number of them, and <b>hiring fails when it's full</b>, so the coop is often the first thing to upgrade when you want a bigger flock. Upgrades are paid in Stone, Copper and EGG and take effect at once (no construction time). Every level gets a new look.`)}
    ${H(`${keys.length} looks`, 'looks')}
    ${gallery('b-coop', 'Coop', keys, (n) => `Lv. ${n}`, (n) => `houses ${F.coop(n)}${n === lv ? ' · <span class="tag g">yours</span>' : ''}`, lv || 1)}
    ${H('Capacity and costs', 'cap')}
    ${T(['Level', ['Capacity', 'wk-n'], 'Cost to reach it'], rows, { min: 440, me: (i) => i + 1 === lv })}
    ${P(`More Chikns means more eggs, but also more FEED every day: see ${L('farm')}.`)}
    ${goBtn('farm', 'Open the Farm')}`;
}

function aHQ() {
  const S = myPlay(), keys = tierKeys('hq', 10), ranges = {};
  for (let d = 1; d <= D.maxDepth; d++) { const t = D.hqTier(d); (ranges[t] = ranges[t] || [d, d])[1] = d; }
  const cur = S ? D.hqTier(S.depth) : 0;
  const rows = Object.keys(ranges).map((t) => [{ h: `<b>Lv. ${t}</b>`, c: 'wk-n' }, { h: `${ranges[t][0]}–${ranges[t][1]}`, c: 'wk-n' }]);
  const per = ranges[2] ? ranges[2][0] - ranges[1][0] : 5;
  return `${dl([['Grows', `every ${per} depth levels`], ['Cost', 'nothing: it grows as you dig'], S ? ['Yours', `<b>Lv. ${cur}</b> at depth ${S.depth}`] : null])}
    ${P(`The headquarters of your mining company stands on the surface above the shaft. It isn't upgraded with materials: it grows by itself, getting a new and grander look every ${per} depth levels you dig, from a wooden shack to a legendary mining palace. It is your trophy: it shows at a glance how deep your mine goes.`)}
    ${H(`${keys.length} looks`, 'looks')}
    ${gallery('b-hq', 'Headquarters', keys, (n) => `Lv. ${n}`, (n) => (ranges[n] ? `depth ${ranges[n][0]}–${ranges[n][1]}` : '') + (n === cur ? ' · <span class="tag g">yours</span>' : ''), cur || 1)}
    ${H('Look by depth', 'depth')}
    ${T(['Look', ['Depth', 'wk-n']], rows, { min: 260, me: (i) => +Object.keys(ranges)[i] === cur })}
    ${goBtn('mines', 'Open the Mines')}`;
}

function aMachines() {
  const S = myPlay(), z0 = D.zones[0];
  const rows = D.machines.map((m) => {
    const a = mstat(m, 1), b = mstat(m, D.machineMaxLv), zs = m.zones ? mstat(m, D.machineMaxLv, m.zones[0]) : null;
    return [`<span class="wk-mname">${pic('machine/' + m.id, 'wk-mach', m.name)}<span><b>${esc(m.name)}</b><small>player Lv. ${m.lv} · crafts in ${secs(m.t)}</small></span></span>`,
      { h: `×${a.speed.toFixed(2)} → ×${b.speed.toFixed(2)}${zs ? `<br><small>×${zs.speed.toFixed(2)} on ${m.zones.map((z) => esc(D.zoneById(z).short)).join(' & ')}</small>` : ''}`, c: 'wk-n' },
      { h: `+${n0(a.cap)} → +${n0(b.cap)}<small>/h</small>${m.rare ? `<br><small>+${pc(m.rare, 0)} as Rare Earth</small>` : ''}`, c: 'wk-n' },
      { h: `${n0(m.energy)}<small> Coal/h</small><br>${m.wear}%<small>/min · ${tm(100 / m.wear * 60)} to 0%</small>`, c: 'wk-n' }, chips(m.cost, 15)];
  });
  const svc = [75, 50, 25, 0].map((d) => [{ h: `${d}%`, c: 'wk-n' }, chips(D.machineServiceCost(d), 15)]);
  const ups = D.machines.map((m) => `<details class="wk-more"><summary>${pic('machine/' + m.id, 'wk-tic')} ${esc(m.name)}: upgrade costs</summary>${T(['Upgrade', 'Cost', ['Speed after', 'wk-n'], ['Capacity after', 'wk-n']], Array.from({ length: D.machineMaxLv - 1 }, (_, i) => i + 1).map((l) => { const s = mstat(m, l + 1); return [{ h: `Lv. ${l} → ${l + 1}`, c: 'wk-n' }, chips(D.machineUpCost(m, l), 15), { h: `×${s.speed.toFixed(2)}`, c: 'wk-n' }, { h: `+${n0(s.cap)}/h`, c: 'wk-n' }]; }), { min: 460 })}</details>`).join('');
  const hv = D.machineById('heavy') || D.machines[0], lvX = D.machineMaxLv, fl = 10, dugAll = z0.to - z0.from + 1;
  const base = withS(Object.assign({}, BARE, { depth: z0.to, machines: [], ['zones.' + z0.id + '.lv']: fl }), () => G.zoneRate(z0));
  const withM = withS(Object.assign({}, BARE, { depth: z0.to, machines: [{ id: -1, type: hv.id, lv: lvX, dur: 100, zone: z0.id }], ['zones.' + z0.id + '.lv']: fl }), () => G.zoneRate(z0));
  const lvK = mstat(D.machines[0], 1).cap / D.machines[0].cap;
  const mine = S ? S.machines.map((m) => { const s = G.machineStats(m); return [`${pic('machine/' + m.type, 'wk-tic')} ${esc(s.def.name)}`, { h: `Lv. ${m.lv}`, c: 'wk-n' }, m.zone ? esc(D.zoneById(m.zone).short) : '<span class="dim">in storage</span>', { h: `${Math.round(m.dur)}%`, c: 'wk-n' }, { h: `×${s.speed.toFixed(2)}`, c: 'wk-n' }]; }) : [];
  return `${P(`Machines are crafted on the Crafting screen and deployed on mine floors, one per floor. A machine multiplies its floor's output, adds a flat amount of ore per hour, and speeds up ${L('digging', 'digging')} when it stands in the zone you're digging in. Better machines unlock at higher player levels.`)}
    ${T(['Machine', ['Speed (Lv. 1 → 10)', 'wk-n'], ['Capacity (Lv. 1 → 10)', 'wk-n'], ['Coal use & wear', 'wk-n'], 'Crafting cost'], rows, { min: 680, cls: 'wk-mt' })}
    ${H('How a machine boosts a floor', 'boost')}
    ${fx('floor output with a machine = floor output × speed + capacity per hour')}
    ${P(`Speed and capacity grow with the machine's level: a Lv. 1 machine has ${pc(lvK, 0)} of its Lv. ${D.machineMaxLv} bonus. Engineer Chikns add half their bonus to the speed. Example: a Lv. ${fl} ${esc(z0.name)} floor (fully dug) mines ${big(base * 3600)}/h; with a ${esc(hv.name)} Lv. ${lvX} it mines <b>${big(withM * 3600)}/h</b>.`)}
    ${H('Coal, wear and servicing', 'care')}
    ${UL([
      `<b>Energy</b>: a deployed machine burns Coal every hour. When your Coal runs out it stops until you have Coal again. The Energy Use upgrade lowers the burn.`,
      `<b>Wear</b>: while you play, durability drops by the machine's wear rate (Engineers slow it down). Machines don't wear while you're offline. At 0% the machine breaks and stops drilling.`,
      `<b>Service</b> restores durability to 100%. The price grows with the damage:`,
    ])}
    ${T([['Durability', 'wk-n'], 'Service cost'], svc, { min: 300 })}
    ${H('Crafting, deploying and upgrading', 'craft')}
    ${UL([
      `Crafting runs in the crafting queue (${freshState().craftSlots} slots at the start, more with the Craft Slot upgrade); Crafter Chikns make it faster. Finish a craft at once with HENIUM.`,
      `<b>Deploy</b> a machine on any open floor; deploying it where another machine stands sends that one back to storage.`,
      `<b>Upgrade</b> machines up to Lv. ${D.machineMaxLv} with Machine Parts, Iron Ingots and (from Lv. 5) Alloy.`,
      `The ${esc((D.machines.find((m) => m.zones) || {}).name || 'Henium Extractor')} is a specialist: much faster on the Henium Vein and the Core Zone.`,
    ])}
    ${ups}
    ${mine.length ? you(T(['Machine', ['Level', 'wk-n'], 'Floor', ['Durability', 'wk-n'], ['Speed', 'wk-n']], mine, { min: 440 })) : ''}
    ${goBtn('crafting', 'Open Crafting')}`;
}

const BONUS_TXT = {
  mine: 'more ore from every mine floor (and from taps)',
  machine: 'machines run faster (half the bonus is added to their speed) and wear out slower',
  factory: 'factory jobs finish sooner',
  battle: 'more squad battle power; Guardians also hit harder themselves',
  all: 'half of its bonus to mining, factories, machines, refinery power, crafting and expedition loot',
  refine: 'more refinery power, so a bigger share of the HENIUM emission',
  craft: 'machines are crafted faster',
  trade: () => `cheaper DEX swaps: the swap fee drops by its bonus (to no less than ${pc(feeFloor(), 0)} of the fee)`,
  explore: 'more loot from expeditions (when it goes on one)',
  safety: 'in the squad: cave-ins may turn into rich veins · on expeditions: fewer injuries',
};
function aChikns() {
  const S = myPlay(), pct1 = G.chiknPct(fakeChikn({ lv: 2 })) / G.chiknPct(fakeChikn({ lv: 1 })) - 1;
  const RM = D.rarities[D.rarities.length - 1], pow1 = (G.chiknPower(fakeChikn({ rarity: RM.id, lv: D.chiknMaxLv })) / G.chiknPower(fakeChikn({ rarity: RM.id })) - 1) / (D.chiknMaxLv - 1);
  const guardK = G.chiknPower(fakeChikn({ role: 'guardian' })) / G.chiknPower(fakeChikn({}));
  const so = odds(D.hires.standard.weights), po = odds(D.hires.premium.weights), max = D.chiknMaxLv;
  const roles = Object.entries(D.roles).map(([id, r]) => [`<span class="wk-mname">${pic('chikn/' + id, 'wk-chikn', r.name)}<b>${esc(r.name)}</b></span>`, esc(r.label), `<span class="wk-sm">${(() => { const t = BONUS_TXT[r.bonus]; return typeof t === 'function' ? safe(t, '') : t || ''; })()}</span>`,
    ['explore'].includes(r.bonus) ? 'expedition team' : r.bonus === 'safety' ? 'squad & expedition' : 'Mining Team']);
  const rar = D.rarities.map((R, i) => {
    const capF = withS({ spec: 'farmer' }, () => G.kgCap({ rarity: R.id }));
    return [`<b style="color:${R.color}">${esc(R.name)}</b>`, { h: `+${sig(G.chiknPct(fakeChikn({ rarity: R.id })))}% → +${sig(G.chiknPct(fakeChikn({ rarity: R.id, lv: max })))}%`, c: 'wk-n' },
      { h: `${R.kg0} → ${R.kgMax} kg<br><small>Egg Farmer: ${capF} kg</small>`, c: 'wk-n' }, { h: `${sig(F.eggsAt(R.kg0), 3)} → ${sig(F.eggsAt(R.kgMax), 3)}`, c: 'wk-n' },
      { h: `${n0(G.chiknPower(fakeChikn({ rarity: R.id })))} → ${n0(G.chiknPower(fakeChikn({ rarity: R.id, lv: max })))}`, c: 'wk-n' }, { h: `${so[i] ? pc(so[i], 1) : '—'} · ${po[i] ? pc(po[i], 1) : '—'}`, c: 'wk-n' }];
  });
  const ex = D.rarity('rare') || D.rarities[2], kgs = [ex.kg0, 200, 300, 400, ex.kgMax].filter((k, i, a) => k >= ex.kg0 && k <= ex.kgMax && a.indexOf(k) === i);
  const lvEx = kgs.map((kg) => { const lv = lvAt(ex.id, kg); return [{ h: `${kg} kg`, c: 'wk-n' }, { h: `Lv. ${lv}`, c: 'wk-n' }, { h: `+${sig(G.chiknPct(fakeChikn({ rarity: ex.id, lv })))}%`, c: 'wk-n' }, { h: sig(F.eggsAt(kg), 3), c: 'wk-n' }, { h: n0(G.chiknPower(fakeChikn({ rarity: ex.id, lv }))), c: 'wk-n' }]; });
  const leaderTo = Object.values(D.roles).map((r) => r.bonus).filter((b, i, a) => a.indexOf(b) === i && b !== 'all')
    .filter((b) => withS({ chikns: [fakeChikn({ id: -7, role: 'leader', status: 'squad' })], squad: [-7] }, () => G.bonus(b)) > 0);
  const st = D.hires.standard, pr = D.hires.premium;
  return `${P(`Chikns are your workers (in the real game, Chikn NFTs). Every Chikn has a <b>role</b> (what it's good at), a <b>rarity</b> (how good) and a <b>weight</b>, which sets its level. Chikns in your <b>Mining Team</b> (squad) give their bonus to the whole mine; Explorers and Medics shine on ${L('expeditions', 'expeditions')}. All Chikns lay EGG on the ${L('farm', 'farm')} and eat FEED.`)}
    ${H('The 10 roles', 'roles')}
    ${T(['Role', 'Bonus', 'What it does', 'Counts in'], roles, { min: 640, cls: 'wk-roles' })}
    ${P(`A Leader adds half its bonus to: ${leaderTo.map((b) => esc((Object.values(D.roles).find((r) => r.bonus === b) || {}).label || b)).join(', ')}. Guardians have ×${sig(guardK)} battle power of their own.`)}
    ${H('Rarities', 'rarity')}
    ${T(['Rarity', ['Bonus (Lv. 1 → ' + max + ')', 'wk-n'], ['Weight (start → max)', 'wk-n'], ['EGG/day (start → max)', 'wk-n'], ['Battle power (Lv. 1 → ' + max + ')', 'wk-n'], ['Hire odds (standard · premium)', 'wk-n']], rar, { min: 700 })}
    ${P(`The bonus grows by ${pc(pct1, 0)} of the base per level, battle power by ${pc(pow1, 0)} per level. ${esc(st.name)}: ${chips(st.cost, 16)} · ${esc(pr.name)}: ${chips(pr.cost, 16)} (Rare or better guaranteed). Your very first hire is free: ${freeHire()}. Hiring, and claiming a Chikn from the season track, needs a free spot in the ${L('b-coop', 'Coop')}.`)}
    ${H('Weight sets the level', 'weight')}
    ${P(`A Chikn's level follows its weight: it starts at its rarity's start weight (Lv. 1) and reaches Lv. ${max} at its rarity's max weight. Feeding adds ${F.step} kg for a little FEED (more the heavier it is); hungry Chikns lose weight and levels. Example, a ${esc(ex.name)} Chikn:`)}
    ${T([['Weight', 'wk-n'], ['Level', 'wk-n'], ['Bonus', 'wk-n'], ['EGG/day', 'wk-n'], ['Battle power', 'wk-n']], lvEx, { min: 440 })}
    ${H('Mining Team', 'squad')}
    ${P(`Only Chikns in your Mining Team give their role bonus to the mine, factories, machines and battles. It has ${squadSteps().map(([l, n], i) => (i ? `${n} from player Lv. ${l}` : `${n} slots`)).join(', ')}. Team members can't go on expeditions; Chikns that come back injured rest for ${tm(RULE.injuredSec)}.`)}
    ${S ? you(`${S.chikns.length} Chikns in a coop for ${G.coopCap()}, Mining Team ${G.squad().length}/${G.squadSlots()}, squad battle power <b>${n0(G.squadPower())}</b>.`) : ''}
    ${goBtn('chikns', 'Open Chikn NFT')}`;
}

function aFarm() {
  const S = myPlay(), kgs = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  let cross = 0;
  for (let kg = 100; kg <= 2000; kg++) if (F.upkeep(kg) >= F.eggsAt(kg)) { cross = kg; break; }
  const rows = kgs.map((kg) => [{ h: `<b>${kg} kg</b>`, c: 'wk-n' }, { h: sig(F.eggsAt(kg), 3), c: 'wk-n' }, { h: sig(F.upkeep(kg), 3), c: 'wk-n' }, { h: sig(F.eggsAt(kg) / F.upkeep(kg), 3), c: 'wk-n' },
    { h: n0(feedAt(kg)), c: 'wk-n' }, { h: kg > 100 ? n0(feedTotal(100, kg).feed) : '—', c: 'wk-n' }]);
  const yMax = Math.ceil(Math.max(F.upkeep(900), F.eggsAt(900)));
  const pts = (fn) => { const p = []; for (let kg = 100; kg <= 900; kg += 20) p.push([kg, fn(kg)]); return p; };
  const ch = chart({ x0: 100, x1: 900, y0: 0, y1: yMax, h: 260, label: 'Eggs per day and FEED upkeep per day by Chikn weight',
    xt: [100, 300, 500, 700, 900].map((k) => [k, `${k} kg`]), yt: Array.from({ length: yMax + 1 }, (_, i) => [i, String(i)]),
    series: [{ pts: pts(F.eggsAt), cls: 'gold', area: true }, { pts: pts(F.upkeep), cls: 'red' }],
    extra: (X, Y) => (cross && cross <= 900 ? `<line class="wk-mk" x1="${X(cross)}" x2="${X(cross)}" y1="${Y(0)}" y2="${Y(yMax)}"/><circle class="wk-dot" cx="${X(cross)}" cy="${Y(F.eggsAt(cross))}" r="5"/><text class="wk-lbl" x="${X(cross) + 8}" y="${Y(yMax) + 14}">${cross} kg: upkeep = eggs</text>` : ''),
    legend: [['gold', 'EGG laid per day'], ['red', 'FEED eaten per day']], cap: 'Eggs grow with diminishing returns while upkeep grows in a straight line.' });
  const maxRows = D.rarities.map((R) => { const a = feedTotal(R.kg0, R.kgMax), capF = withS({ spec: 'farmer' }, () => G.kgCap({ rarity: R.id })), b = feedTotal(R.kg0, capF, 'farmer');
    return [`<b style="color:${R.color}">${esc(R.name)}</b>`, { h: `${R.kg0} → ${R.kgMax}`, c: 'wk-n' }, { h: `${a.n}`, c: 'wk-n' }, { h: n0(a.feed), c: 'wk-n' }, { h: `${n0(b.feed)} <small>to ${capF} kg</small>`, c: 'wk-n' }]; });
  const farmerFeed = feedAt(400, 'farmer') / feedAt(400);
  const fake5 = Array.from({ length: 5 }, (_, i) => fakeChikn({ id: -10 - i }));
  const nestK = withS({ chikns: fake5, spec: 'farmer' }, () => G.nestCap()) / withS({ chikns: fake5, spec: null }, () => G.nestCap());
  const capK = withS({ spec: 'farmer' }, () => G.kgCap({ rarity: 'common' })) / D.rarity('common').kgMax;
  const coopRows = Array.from({ length: F.coopMax }, (_, i) => i + 1).map((l) => [{ h: `Lv. ${l}`, c: 'wk-n' }, { h: F.coop(l), c: 'wk-n' }, { h: n0(F.millQuota(l)), c: 'wk-n' }, { h: sig(F.coop(l) * F.upkeep(100), 3), c: 'wk-n' }]);
  const pE = G.spot('egg', 'henium'), e100 = WORLD_CHIKNS * F.eggsAt(100), u100 = WORLD_CHIKNS * F.upkeep(100);
  const fullCoop = F.coop(F.coopMax);
  return `${P(`Every Chikn lays about <b>1 EGG per farm day</b> (a farm day is a real day, ${tm(F.day)}). Heavier Chikns lay more, with diminishing returns. In exchange, every Chikn <b>eats FEED</b> every day, and FEED is scarce. That trade-off is the whole farm: it keeps EGG scarce and rewards players who manage their flock well.`)}
    ${H('Eggs and upkeep by weight', 'eggs')}
    ${fx(`EGG per day = (weight ÷ 100 kg)<sup>${sig(Math.log(F.eggsAt(200)) / Math.log(2), 2)}</sup> · FEED per day = weight ÷ ${sig(100 / F.upkeep(100))} kg`)}
    ${T([['Weight', 'wk-n'], ['EGG / day', 'wk-n'], ['FEED upkeep / day', 'wk-n'], ['EGG per FEED eaten', 'wk-n'], ['FEED per feeding (+' + F.step + ' kg)', 'wk-n'], ['FEED to grow from 100 kg', 'wk-n']], rows, { min: 640, cap: `Which rarities can reach a weight: see the max weights in ${L('chikns', 'Chikns')}.` })}
    ${ch}
    ${box(`Above about <b>${cross} kg</b> a Chikn eats more FEED per day than it lays EGG. Light Chikns turn FEED into eggs most efficiently; heavy Chikns get the most eggs out of each coop spot.`, 'tip', 'The key trade-off')}
    ${H('Feeding', 'feeding')}
    ${P(`Each feeding adds ${F.step} kg and costs about ${sig(feedAt(200) / F.step, 2)} FEED per kg at 200 kg: the cost rises in a straight line with weight. A Chikn can grow to its rarity's max weight (×${sig(capK)} with the Egg Farmer specialization), and its level follows its weight (${L('chikns')}). During the Feed Festival event feeding costs less.`)}
    ${T(['Rarity', ['Weight', 'wk-n'], ['Feedings', 'wk-n'], ['FEED to max weight', 'wk-n'], ['As Egg Farmer', 'wk-n']], maxRows, { min: 560 })}
    ${H('Upkeep, hunger and the nest', 'upkeep')}
    ${UL([
      `Your Chikns eat their daily upkeep continuously from your FEED stock.`,
      `With no FEED left they get <b>hungry</b>: each hungry day a Chikn loses ${pc(F.hunger, 0)} of its weight above its start weight plus ${RULE.hungerFlat} kg, and its level drops with it. It never drops below its start weight.`,
      `Eggs collect in the <b>nest</b>, which holds ${F.nestDays} days of laying (×${sig(nestK)} for an Egg Farmer). A full nest stops collecting: collect it on the Farm or with Collect All.`,
    ])}
    ${H('Coop and Feed Mill', 'coop')}
    ${P(`The ${L('b-coop', 'Coop')} limits how many Chikns you can keep; the ${L('b-feedmill', 'Feed Mill')} grinds FEED up to a daily quota. Both grow with their level:`)}
    ${T(['Level', ['Coop holds', 'wk-n'], ['Mill quota (FEED/day)', 'wk-n'], ['Upkeep of a full coop at 100 kg', 'wk-n']], coopRows, { min: 520, me: (i) => S && i + 1 === S.farm.coopLv })}
    ${P(`You can also burn EGG for FEED (${G.exRate().e2f} EGG → 1 FEED) and earn a little FEED from level-ups, daily missions (at most ${missionFeedMax()} a day), quests, the season track and hazards. The Feed Mill's quota is the main source.`)}
    ${H('Strategy: the Egg Farmer', 'strategy')}
    ${P(`Yes, you can play mostly as an egg farmer. Pick the <b>Egg Farmer</b> specialization at player Lv. ${RULE.specLv}: ${esc((D.specs.find((s) => s.id === 'farmer') || {}).desc || '')} (feeding costs ×${sig(farmerFeed, 2)}).`)}
    ${OL([
      `Upgrade the <b>Coop</b> to house more Chikns and the <b>Feed Mill</b> for a bigger FEED quota: those two set the size of your farm.`,
      `Keep FEED for at least two days of upkeep before you fatten anybody.`,
      `Fatten the <b>lightest</b> Chikns first: they are the cheapest to feed and gain the most eggs per kg.`,
      `When FEED is your bottleneck, keep more Chikns light; when coop space is the bottleneck, make them heavy.`,
      `Sell surplus EGG on the ${L('dex', 'DEX')} (1 EGG = ${sig(pE)} HENIUM right now) or use it for hires, coop upgrades and the guild.`,
    ])}
    ${H('The world view', 'world')}
    ${P(`There are about <b>${G.fmtFull(WORLD_CHIKNS)}</b> Chikns in the world. At 100 kg each they lay <b>${G.fmtFull(Math.round(e100))} EGG</b> a day and eat <b>${G.fmtFull(Math.round(u100))} FEED</b>. Fattening them all to 400 kg would mean ${G.fmtFull(Math.round(WORLD_CHIKNS * F.eggsAt(400)))} EGG a day, but also ${G.fmtFull(Math.round(WORLD_CHIKNS * F.upkeep(400)))} FEED. FEED is the brake: it comes from Feed Mills with daily quotas (a maxed mill grinds ${F.millQuota(D.factoryMaxLv)} FEED a day, which feeds ${Math.floor(F.millQuota(D.factoryMaxLv) / F.upkeep(100))} Chikns at 100 kg, while a maxed coop holds ${fullCoop}) and from burning EGG at ${G.exRate().e2f}:1. So the world's egg supply can only grow as fast as its FEED supply, and every egg spent is burned.`)}
    ${S ? you(`${S.chikns.length} Chikns lay <b>${sig(G.eggsPerDay(), 3)}</b> EGG and eat <b>${sig(G.upkeepPerDay(), 3)}</b> FEED per day; your FEED lasts ${isFinite(G.feedDaysLeft()) ? sig(G.feedDaysLeft(), 2) + ' days' : 'forever'}${S.farm.hungry ? ' — <b>your Chikns are hungry!</b>' : ''}. Nest: <b data-b="nest"></b> / ${n0(G.nestCap())}.`) : ''}
    ${goBtn('farm', 'Open the Farm')}`;
}

const SPEC_NOTE = {
  miner: () => `Also +${pc(withS(Object.assign({}, BARE, { spec: 'miner', 'factories.refinery.lv': 1 }), () => G.myRefPower()) / D.refPower(1) - 1, 0)} refinery power.`,
  indus: () => 'Works on every building, the Feed Mill too. The refinery\'s HENIUM follows refinery power, so there only the speed helps.',
  trader: () => `A DEX hop costs ${pc(withS({ spec: 'trader', squad: [] }, () => G.dexFee()), 2)} instead of ${pc(D.dex.fee, 1)}; Trader Chikns in your Mining Team lower it further (${L('dex', 'DEX')}).`,
  explor: () => `Expedition injury risk ×${RULE.exp.specRisk}.`,
  cmdr: () => 'Counts in every fight: PvE stages, PvP, creatures and bandits.',
  farmer: () => `The farm specialist, see ${L('farm')}.`,
  gleader: () => `Raises donation points and the mining bonus of every guild project you finish (${L('guild')}).`,
};
function aSpecs() {
  const S = myPlay();
  const rows = D.specs.map((s) => [`<b>${esc(s.name)}</b>`, esc(s.desc), `<span class="wk-sm">${SPEC_NOTE[s.id] ? safe(SPEC_NOTE[s.id]) : ''}</span>`]);
  return `${P(`At player Lv. ${RULE.specLv} you choose a specialization: a permanent bonus that shapes how you play this mine. The choice can't be changed later, so pick the part of the game you enjoy most.`)}
    ${T(['Specialization', 'Effect', 'Good to know'], rows, { min: 640, me: (i) => S && S.spec === D.specs[i].id })}
    ${H('Which one?', 'which')}
    ${UL([
      `<b>Miner</b> or <b>Industrialist</b> for a fast, steady climb down the mine.`,
      `<b>Egg Farmer</b> if you want a big Chikn farm and EGG income.`,
      `<b>Commander</b> for PvP, guild wars and monster hunts (both pay HENIUM, see ${L('henium')}).`,
      `<b>Explorer</b> for expedition loot, <b>Guild Leader</b> if you carry your guild's projects.`,
    ])}
    ${S ? you(S.spec ? `You are a <b>${esc((D.specs.find((s) => s.id === S.spec) || {}).name || S.spec)}</b>.` : S.player.lv >= RULE.specLv ? 'You can choose your specialization now: click your level in the menu.' : `Unlocks at player Lv. ${RULE.specLv} (you are Lv. ${S.player.lv}).`) : ''}`;
}

function aHenium() {
  const S = G.S, sp = D.supply, B = supplyBounds(), ep = G.epoch(), mined = S.world.mined;
  const eps = B.slice(0, -1).map((lo, i) => ({ i, lo, hi: B[i + 1], e: atEpoch(i, () => G.emission()) }));
  const rows = eps.map((x) => [{ h: `<b>${x.i + 1}</b>`, c: 'wk-n' }, { h: `${G.fmt(x.lo)} – ${G.fmt(x.hi)}`, c: 'wk-n' }, { h: `${sig(x.e)}`, c: 'wk-n' },
    ...Object.keys(sp.split).map((k) => ({ h: sig(x.e * sp.split[k]), c: 'wk-n' })), { h: `${epochDate(x.i)} – ${epochDate(x.i + 1)}`, c: 'wk-n' }]);
  const nowX = (() => { const e = Math.min(ep, eps.length - 1), x = eps[e]; return e + Math.min(1, Math.max(0, (mined - x.lo) / (x.hi - x.lo))); })();
  const ch = chart({ x0: 0, x1: eps.length, y0: 0, y1: sp.cap * 1.05, h: 300, left: 50, label: 'HENIUM total supply by epoch',
    xt: B.map((b, i) => [i, i === 0 ? 'Launch' : `H${i}`]),
    yt: [0, 5e6, 10e6, 15e6, 20e6].map((v) => [v, v ? `${v / 1e6}M` : '0']),
    series: [{ pts: B.map((b, i) => [i, b]), cls: 'purple', area: true }],
    extra: (X, Y) => `<line class="wk-cap" x1="${X(0)}" x2="${X(eps.length)}" y1="${Y(sp.cap)}" y2="${Y(sp.cap)}"/><text class="wk-lbl" x="${X(0) + 6}" y="${Y(sp.cap) - 6}">cap ${G.fmt(sp.cap)}</text>`
      + B.slice(1, -1).map((b, i) => `<line class="wk-mk" x1="${X(i + 1)}" x2="${X(i + 1)}" y1="${Y(0)}" y2="${Y(sp.cap)}"/>`).join('')
      + eps.map((x) => `<text class="wk-seg" x="${X(x.i + 0.5)}" y="${Y(sp.cap * 0.12)}" text-anchor="middle">${sig(x.e)}</text><text class="wk-seg2" x="${X(x.i + 0.5)}" y="${Y(sp.cap * 0.12) + 15}" text-anchor="middle">per day</text>`).join('')
      + B.map((b, i) => `<circle class="wk-dot2" cx="${X(i)}" cy="${Y(b)}" r="3.5"/>`).join('')
      + `<circle class="wk-dot" cx="${X(nowX)}" cy="${Y(mined)}" r="7"/><text class="wk-lbl wk-now" x="${X(nowX) + (nowX > eps.length * 0.6 ? -10 : 10)}" y="${Y(mined) + 24}" text-anchor="${nowX > eps.length * 0.6 ? 'end' : 'start'}">now ${G.fmt(mined)}</text>`,
    legend: [['purple', 'HENIUM mined in total'], ['gold', 'the world today']], cap: `Each column is one epoch of ${G.fmtFull(sp.halvingDays)} days (about 4 years). Every halving halves the daily emission, so each epoch adds half as much as the one before; the total never quite reaches the cap.` });
  const W = G.worldRefPower(), E = G.emission(), Er = E * sp.split.refinery, lv = S.factories.refinery.lv, PL = PLAY();
  const myP = lv ? G.myRefPower() : 0, exLv = lv || 5, exP = lv ? myP : D.refPower(exLv), exSh = exP / (exP + W);
  const refRows = Array.from({ length: D.factoryMaxLv }, (_, i) => i + 1).map((l) => { const p = D.refPower(l), sh = p / (p + W), W2 = withS({ worldT: S.worldT + 365 * 86400 }, () => G.worldRefPower()), sh2 = p / (p + W2);
    return [{ h: `Lv. ${l}`, c: 'wk-n' }, { h: n0(p), c: 'wk-n' }, { h: pc(sh, 2), c: 'wk-n' }, { h: nd(Er * sh), c: 'wk-n' }, { h: `${pc(sh2, 2)} · ${nd(Er * sh2)}`, c: 'wk-n' }]; });
  const days = [0, 30, 100, 365, 1000].map((d) => [{ h: `${d ? '+' : ''}${G.fmtFull(d)}`, c: 'wk-n' }, { h: n0(withS({ worldT: S.worldT + d * 86400 }, () => G.worldRefPower())), c: 'wk-n' }]);
  const firsts = D.stages.filter((s) => s.first && s.first.henium);
  const questH = D.quests.reduce((s, q) => s + (q.r.henium || 0), 0);
  let seasonH = 0; for (let l = 1; l <= D.seasonMax; l++) seasonH += D.seasonReward(l).henium || 0;
  const projH = D.guildProjects.reduce((s, p, i) => s + G.guildProjectReward(i), 0);
  const expH = D.expeditions.concat(D.veinExpedition || []).filter((e) => e.r.henium);
  const scan = digScan(), hd = scan.henium ? scan.henium[0][0] : 0;
  let digH = 0; for (let d = hd; d < D.maxDepth && hd; d++) digH += D.digCost(d).henium || 0;
  const fh = firstUpHenium();
  let upH = 0; for (const f of D.factories) for (let l = fh; l < D.factoryMaxLv && fh; l++) upH += D.factoryUpCost(f, l).henium || 0;
  const fupH = D.fUpgrades.reduce((s, u) => s + Array.from({ length: u.max }, (_, l) => D.fUpCost(u, l).henium || 0).reduce((a, b) => a + b, 0), 0);
  const mHen = D.machines.filter((m) => m.cost.henium);
  const donH = D.donations.find((d) => d.res === 'henium');
  const kRows = eps.map((x) => atEpoch(x.i, () => { const hp = G.poolFor('henium', 'eth'), sp2 = G.poolFor('stone', 'henium');
    return [{ h: `<b>${x.i + 1}</b>`, c: 'wk-n' }, { h: `×${sig(G.henValueK())}`, c: 'wk-n' }, { h: hp ? sig(G.fairPrice(hp)) : '—', c: 'wk-n' }, { h: sp2 ? sig(G.fairPrice(sp2)) : '—', c: 'wk-n' }, { h: sig(x.e), c: 'wk-n' }]; }));
  const ws = G.warShare(), hunt = S.hunt || 0;
  const burned = S.dex ? S.dex.burned.henium : 0;
  return `${dl([['Max supply', `<b>${G.fmtFull(sp.cap)}</b>`], ['Launch', epochDate(0)], ['Mined so far', `<b data-b="wkMined">${G.fmt(mined)}</b>`], ['Epoch now', `${ep + 1} of ${eps.length}`], ['Emission now', `${sig(E)} / farm day`], ['Next halving', `${epochDate(ep + 1)} (at ${G.fmt(G.nextHalving())})`]])}
    ${P(`HENIUM is built like bitcoin: a fixed maximum of <b>${G.fmtFull(sp.cap)}</b>, new coins only from work and fighting, and an emission that halves over time. Nothing existed at launch: every HENIUM is minted day by day on a fixed schedule, exactly the daily emission and no more. The HENIUM contract enforces the same schedule on-chain. Every HENIUM paid to a player (refinery jobs, war and hunt payouts, bounties, quests, the season track, guild projects, expedition and fight loot) is taken out of that emission, so whatever you earn is HENIUM the rest of the world doesn't get. Once all ${G.fmt(sp.cap)} are mined, nobody gets paid any more.`)}
    ${H('Halvings', 'halving')}
    ${P(`The whole world may mint <b>${sig(sp.daily)} HENIUM per farm day</b> in the first epoch. Every ${G.fmtFull(sp.halvingDays)} days (about 4 years) the daily emission halves, like bitcoin's halvings, and the split between refiners, fighters and hunters stays the same.`)}
    ${T([['Epoch', 'wk-n'], ['Supply range', 'wk-n'], ['Emission / day', 'wk-n'], ...Object.keys(sp.split).map((k) => [`${SPLIT[k] || k} (${pc(sp.split[k], 0)})`, 'wk-n']), ['Dates', 'wk-n']], rows, { min: 720, me: (i) => i === ep })}
    ${ch}
    ${H('Where the daily emission goes', 'split')}
    <div class="wk-split" role="img" aria-label="Emission split">${Object.keys(sp.split).map((k) => `<i style="--g:${sp.split[k] * 100}"></i>`).join('')}</div>
    <div class="wk-split-l">${Object.keys(sp.split).map((k, i) => `<span><i class="wk-s${i + 1}"></i><b>${pc(sp.split[k], 0)}</b> ${SPLIT[k] || k} · ${sig(E * sp.split[k])}/day</span>`).join('')}</div>
    ${H3('1. Refining: your share of world refinery power')}
    ${fx(`your HENIUM per day = emission × ${pc(sp.split.refinery, 0)} × your power ÷ (your power + world power)`)}
    ${P(`Your power comes from your ${L('b-refinery', 'refinery')}'s level (${D.refPower(1)} at Lv. 1, ×${sig(D.refPower(2) / D.refPower(1))} per level), plus bonuses from Scientist (and Leader) Chikns, guild zone levels and the Miner specialization. The rest of the world started with ${n0(sp.worldPower0)} power and builds ${pc(sp.worldGrowth, 1)} more every farm day: the difficulty rises, so your share shrinks unless you keep upgrading.`)}
    ${box(`<b>Worked example${lv ? ' (your refinery)' : ''}:</b> ${lv ? `your Lv. ${lv} refinery has ${sig(myP)} power` : `a Lv. ${exLv} refinery has ${n0(exP)} power`}. World power today: ${n0(W)}. Share = ${sig(exP)} ÷ (${sig(exP)} + ${n0(W)}) = <b>${pc(exSh, 2)}</b>. Refiners get ${pc(sp.split.refinery, 0)} × ${sig(E)} = ${sig(Er)} HENIUM a day, so this refinery earns <b>${nd(Er * exSh)} HENIUM per farm day</b> if it never stops (a job pays its slice of that as it finishes).`, 'info')}
    ${T([['Refinery', 'wk-n'], ['Power', 'wk-n'], ['Share today', 'wk-n'], ['HENIUM / day today', 'wk-n'], ['In 365 farm days', 'wk-n']], refRows, { min: 600, me: (i) => i + 1 === lv })}
    ${T([['Farm days from now', 'wk-n'], ['World refinery power', 'wk-n']], days, { min: 320, cap: 'The world keeps building refineries' })}
    ${H3('2. Guild wars')}
    ${P(`Every PvP win in the ${L('battle', 'Arena')} earns ${RULE.pvp.pts[0]}–${RULE.pvp.pts[1]} war points (a loss costs ${RULE.pvp.lose}). At every farm-day rollover the war pool (${pc(sp.split.war, 0)} of the emission) is paid out by share of war points: yours ÷ (yours + all other guilds'). The other guilds start at ${G.fmtFull(sp.worldWar0)} and grow ${pc(RULE.worldWar, 1)} a day; your points cool down ${pc(RULE.warDecay, 0)} every day, so keep fighting.`)}
    ${H3('3. Monster hunts')}
    ${P(`Every PvE win adds as many hunt points as the stage's number (${RULE.pveHunt(0)} for the first stage, ${RULE.pveHunt(D.stages.length - 1)} for the last); beating a creature adds ${RULE.creature.hunt}, beating bandits ${RULE.bandits.win.hunt}. At every rollover the hunter pool (${pc(sp.split.boss, 0)} of the emission) is shared by hunt points: yours ÷ (yours + all other hunters'). The other hunters start at ${G.fmtFull(sp.worldHunt0)} points and grow ${pc(RULE.worldHunt, 1)} a day; after each payout your points ${RULE.huntKeep === 0.5 ? 'halve' : `drop to ${pc(RULE.huntKeep, 0)}`}. First clears of the later stages also pay a one-time bounty: ${firsts.map((s) => `${esc(s.name)} ${chips(s.first, 15)}`).join(', ')}.`)}
    ${fx(`your hunt HENIUM per day = emission × ${pc(sp.split.boss, 0)} × your hunt points ÷ (your hunt points + other hunters')`)}
    ${PL ? you(`Your war points: <b>${n0(S.guild.warPts)}</b> (share ${pc(ws, 2)}, ${nd(G.warPerDay())} HENIUM/day) · hunt points: <b>${n0(hunt)}</b> of ${n0(hunt + (S.world.hunt || 0))} (share ${pc(G.huntShare(), 2)}, ≈${nd(G.huntPerDay())} at the next rollover)${lv ? ` · refinery: ${nd(G.refPerDay())} HENIUM/day` : ''}.`) : ''}
    ${H('Faucets: every way you earn HENIUM', 'faucets')}
    ${T(['Source', 'How much', 'Notes'], [
      [`${L('b-refinery', 'Refining')}`, `${pc(sp.split.refinery, 0)} of the emission`, 'shared by refinery power'],
      [`${L('guild', 'Guild wars')}`, `${pc(sp.split.war, 0)} of the emission`, 'shared by war points, paid daily'],
      [`${L('battle', 'Monster hunts')}`, `${pc(sp.split.boss, 0)} of the emission`, `by hunt points, paid daily`],
      [`${L('battle', 'First clears')}`, chips({ henium: firsts.reduce((s, x) => s + x.first.henium, 0) }, 15), 'one-time bounties, all stages together'],
      [`${L('battle', 'PvP wins')} & bandits`, chips({ henium: RULE.pvp.henium }, 15), 'per win'],
      [`${L('events', 'Story quests')}`, chips({ henium: questH }, 15), 'all quests together, once'],
      [`${L('events', 'Season track')}`, chips({ henium: seasonH }, 15), 'per season'],
      [`${L('guild', 'Guild projects')}`, chips({ henium: projH }, 15), 'all projects together, once'],
      [`${L('expeditions', 'Expeditions')}`, expH.map((e) => `${esc(e.name)} ${ranges({ henium: e.r.henium }, 15)}`).join('<br>'), 'loot, before team bonuses'],
    ], { min: 620 })}
    ${P(`None of these adds HENIUM on top of the emission: they are all paid out of it. Whatever you are paid comes off the other players' part: the world's supply follows the emission schedule exactly, so it grows by exactly ${sig(E)} a day and the halvings arrive on schedule, however much is paid out to you. Selling goods on the ${L('dex', 'DEX')} is <b>not</b> a faucet: the HENIUM you get comes from the other players (the market makers' treasury${D.dex.npcBuy ? `, refilled by only ${pc(D.dex.npcBuy, 0)} of what the other players mint` : ''}), so it only changes hands.`)}
    ${H('Sinks: where HENIUM leaves', 'sinks')}
    ${T(['Sink', 'Cost', 'Notes'], [
      [`${L('digging', 'Digging')} from depth ${hd}`, `${chips({ henium: D.digCost(hd).henium }, 15)} → ${chips({ henium: D.digCost(D.maxDepth - 1).henium }, 15)}`, `${chips({ henium: digH }, 15)} to reach depth ${D.maxDepth}`],
      [`${L('buildings', 'Building upgrades')} from Lv. ${fh} → ${fh + 1}`, `${chips({ henium: D.factoryUpCost(D.factories[0], fh).henium }, 15)} → ${chips({ henium: D.factoryUpCost(D.factories[0], D.factoryMaxLv - 1).henium }, 15)}`, `${chips({ henium: upH }, 15)} to max all ${D.factories.length}`],
      [`${L('chikns', 'Premium hire')}`, chips(D.hires.premium.cost, 15), 'Rare or better'],
      [`${L('guild', 'Guild License')}`, chips(D.licenseCost, 15), 'needed for the Core Zone'],
      [`${L('guild', 'Guild zone')}`, `${chips({ henium: D.guildZoneCost(1).henium }, 15)} and up`, 'per expansion'],
      [`${L('buildings', 'Factory upgrades')}`, chips({ henium: fupH }, 15), 'all levels of all global upgrades'],
      ...mHen.map((m) => [`${L('machines', esc(m.name))}`, chips({ henium: m.cost.henium }, 15), 'crafting cost']),
      ...(donH ? [[`${L('guild', 'Guild donation')}`, chips({ henium: donH.amt }, 15), `for ${donH.pts} points`]] : []),
      ['Speed-ups', `1 per ${(() => { let s = 1; while (G.speedCost(s + 1) === 1 && s < 3600) s++; return s; })()} s`, 'jobs (not refinery batches) and crafts; ×2 for construction and digs'],
      [`${L('dex', 'DEX swaps')}`, `${pc(D.dex.fee * D.dex.burnShare, 2)} of the HENIUM sold`, `${pc(D.dex.burnShare, 0)} of the ${pc(D.dex.fee, 1)} fee is burned (less with a Trader discount)`],
      [`${L('hazards', 'Bandits')}`, `${pc(RULE.bandits.lose[1], 0)} / ${pc(RULE.bandits.ignore[1], 0)} of your HENIUM`, `if you lose / ignore a raid (above ${RULE.bandits.keep} HENIUM)`],
    ], { min: 620 })}
    ${PL ? you(`You have burned <b>${nd(burned)}</b> HENIUM in DEX fees so far.`) : ''}
    ${H('Why HENIUM gets more valuable', 'value')}
    ${UL([
      `<b>Fixed supply</b>: no more than ${G.fmt(sp.cap)}, ever.`,
      `<b>Halvings</b>: new supply shrinks every epoch.`,
      `<b>Rising difficulty</b>: the world's refinery power grows every day, so each refinery earns less.`,
      `<b>Burns</b>: everything spent on digs, upgrades, hires and fees is gone for good.`,
      `<b>Market makers follow it</b>: the DEX's NPC market makers value HENIUM higher in every epoch, so resources cost fewer HENIUM and HENIUM costs more ETH:`,
    ])}
    ${T([['Epoch', 'wk-n'], ['Value factor', 'wk-n'], ['Fair price of 1 HENIUM (ETH)', 'wk-n'], ['Fair price of 1 Stone (HENIUM)', 'wk-n'], ['Emission / day', 'wk-n']], kRows, { min: 560, me: (i) => i === ep })}`;
}

function aDex() {
  const P0 = G.dexPools(), pools = Object.values(P0), pool = G.poolFor('egg', 'henium');
  if (!pool) return P('The DEX is not available in this build.');
  const ra = pool.a === 'egg' ? pool.ra : pool.rb, rb = pool.a === 'egg' ? pool.rb : pool.ra, k = ra * rb, price = rb / ra;
  const amt = Math.max(1, niceNum(ra * 0.001)), q = G.dexQuote('egg', 'henium', amt);
  const fr = G.dexFee(), fee = amt * fr, burn = fee * D.dex.burnShare, inAF = amt - fee, ra2 = ra + amt - burn, rb2 = rb - q.out;
  const sizes = [0.0003, 0.003, 0.03, 0.1, 0.3].map((f) => niceNum(ra * f)).filter((v, i, a) => v > 0 && a.indexOf(v) === i);
  const imp = sizes.map((a) => { const x = G.dexQuote('egg', 'henium', a); return [{ h: `${G.fmtFull(a)} EGG`, c: 'wk-n' }, { h: pc(a / ra, 2), c: 'wk-n' }, { h: nd(x.out), c: 'wk-n' }, { h: sig(x.rate, 4), c: 'wk-n' }, { h: pc(x.impact, 2), c: 'wk-n' }]; });
  const big1 = niceNum(ra * 0.25), xA = ra, xB = ra + big1 * (1 - fr);
  const cx0 = ra * 0.4, cx1 = ra * 2.2, cy1 = rb * 2.6;
  const ch = chart({ x0: cx0, x1: cx1, y0: 0, y1: cy1, h: 280, left: 62, label: 'Constant product curve of the EGG/HENIUM pool',
    xt: niceTicks(cx0, cx1, 5).map((v) => [v, G.fmt(v)]), yt: niceTicks(0, cy1, 4).map((v) => [v, G.fmt(v)]), yl: 'HENIUM in the pool',
    series: [{ pts: Array.from({ length: 61 }, (_, i) => { const x = ra * (0.4 + i * 0.03); return [x, Math.min(rb * 2.6, k / x)]; }).filter(([x, y]) => y <= rb * 2.6), cls: 'blue' }],
    extra: (X, Y) => `<path class="wk-arrow" d="M${X(xA) + 8} ${Y(k / xA) + 6} L${X(xB) - 8} ${Y(k / xB) - 4}"/>
      <circle class="wk-dot" cx="${X(xA)}" cy="${Y(k / xA)}" r="6"/><text class="wk-lbl" x="${X(xA) + 10}" y="${Y(k / xA) - 12}">now: ${G.fmt(ra)} EGG · ${G.fmt(rb)} HENIUM</text>
      <circle class="wk-dot3" cx="${X(xB)}" cy="${Y(k / xB)}" r="6"/><text class="wk-lbl" x="${X(xB) - 4}" y="${Y(k / xB) + 26}">after selling ${G.fmt(big1)} EGG</text>`,
    xl: 'EGG in the pool', legend: [['blue', `x · y = k (${G.fmt(k)})`]], cap: `Selling EGG moves the pool down the curve: more EGG, less HENIUM, so each further EGG buys less. Selling ${G.fmt(big1)} EGG at once gives ${nd(G.dexQuote('egg', 'henium', big1).out)} HENIUM, ${pc(G.dexQuote('egg', 'henium', big1).impact, 1)} below the spot price.` });
  const r2 = G.dexQuote('stone', 'alloy', 5000);
  const fairRows = ['egg/henium', 'henium/eth', 'egg/eth', 'stone/henium', 'alloy/henium'].map((id) => P0[id]).filter(Boolean).map((p) => { const cp = G.poolPrice(p), fp = G.fairPrice(p);
    return [`${ic(p.a, 18)}${ic(p.b, 18)} ${esc(rn(p.a))}/${esc(rn(p.b))}`, { h: sig(cp, 4), c: 'wk-n' }, { h: sig(fp, 4), c: 'wk-n' }, { h: `${cp >= fp ? '+' : ''}${pc(cp / fp - 1, 1)}`, c: 'wk-n' }]; });
  const poolRows = pools.slice().sort((a, b) => G.poolTVL(b) - G.poolTVL(a)).map((p) => [`<span class="wk-pair">${ic(p.a, 20)}${ic(p.b, 20)}</span> <b>${esc(rn(p.a))} / ${esc(rn(p.b))}</b>`, { h: `${sig(G.poolPrice(p), 4)} <small>${esc(rn(p.b))}</small>`, c: 'wk-n' }, { h: `${G.fmt(p.ra)} / ${amtOf(p.b, p.rb)}`, c: 'wk-n' }, { h: G.fmt(G.poolTVL(p)), c: 'wk-n' }]);
  const rv = refineVsSell(), wmsg = safe(() => G.act.withdrawEth().msg, ''), npcT = G.S.dex && G.S.dex.npc && D.dex.treasury0 !== undefined ? G.S.dex.npc : null;
  const tokens = G.dexTokens();
  return `${P(`The DEX (decentralized exchange) is where everything is traded: every resource, EGG, HENIUM and simulated ETH. There's no order book and no middleman. Instead there are <b>${pools.length} liquidity pools</b>, each holding two tokens, and an automatic formula sets the price. ${tokens.length} tokens trade here; any token can be swapped for any other.`)}
    ${H('x · y = k, simply', 'amm')}
    ${P(`Each pool keeps the product of its two reserves constant: <b>x × y = k</b>. When you put tokens in, the pool pays out just enough of the other token to keep k the same. The price is simply the ratio of the reserves. Right now the EGG/HENIUM pool holds <b>${G.fmtFull(Math.round(ra))} EGG</b> and <b>${G.fmtFull(Math.round(rb))} HENIUM</b>: k = ${G.fmt(k)}, and 1 EGG costs ${G.fmtFull(Math.round(rb))} ÷ ${G.fmtFull(Math.round(ra))} = <b>${sig(price, 4)} HENIUM</b>.`)}
    ${box(OL([
      `You sell <b>${G.fmtFull(amt)} EGG</b>. The fee is ${pc(fr, fr < D.dex.fee ? 3 : 1)}${fr < D.dex.fee ? ' (with your Trader discount)' : ''}: ${sig(fee, 3)} EGG. A third (${sig(burn, 3)} EGG) is burned, the rest stays in the pool.`,
      `${sig(inAF, 5)} EGG go into the pricing: HENIUM out = ${G.fmtFull(Math.round(rb))} × ${sig(inAF, 5)} ÷ (${G.fmtFull(Math.round(ra))} + ${sig(inAF, 5)}) = <b>${nd(q.out, 4)} HENIUM</b>.`,
      `Average price ${sig(q.rate, 5)} HENIUM per EGG vs a spot price of ${sig(q.spot, 5)}: the fee plus a price impact of ${pc(q.impact, 3)}.`,
      `The pool now holds ${nd(ra2, 2)} EGG and ${nd(rb2, 2)} HENIUM. k grew a little (${G.fmt(ra2 * rb2)}): the fee stays with the pool.`,
    ]), 'info', 'Worked example (live, nothing is traded)')}
    ${ch}
    ${H('Price impact and slippage', 'impact')}
    ${P('The bigger your trade compared with the pool, the further you push the price and the worse your average rate. Same pool, different sizes:')}
    ${T([['You sell', 'wk-n'], ['Share of the pool', 'wk-n'], ['You get (HENIUM)', 'wk-n'], ['Average price', 'wk-n'], ['Price impact', 'wk-n']], imp, { min: 520 })}
    ${P(`<b>Slippage protection</b>: when you swap you set a minimum amount to receive. If the price moved (an NPC trade, or another of your swaps) and you'd get less, the swap is cancelled instead. Big orders are best split into smaller ones, with time in between for the market makers to bring the price back.`)}
    ${H('Fees and burns', 'fees')}
    ${UL([
      `Every hop costs a <b>${pc(D.dex.fee, 1)}</b> fee, paid in the token you sell. Trader Chikns in your Mining Team lower it by their bonus (to no less than ${pc(feeFloor(), 0)} of it) and the Trader ${L('specs', 'specialization')} halves it${PLAY() ? `: yours is <b>${pc(G.dexFee(), 3)}</b>` : ''}.`,
      `<b>${pc(D.dex.burnShare, 0)}</b> of the fee you actually pay is burned: HENIUM and EGG leave the economy for good, which makes both scarcer the more the world trades. The rest stays in the pool for the liquidity providers.`,
    ])}
    ${H('Routing through HENIUM', 'route')}
    ${P(`Every resource has a pool against HENIUM, so the router can swap anything: if there's no direct pool, it goes through HENIUM in two hops (and pays two fees). Example: 5,000 Stone → Alloy goes <b>${r2 ? r2.route.join(', then ') : 'stone → henium → alloy'}</b> and gives ${r2 ? `<b>${nd(r2.out, 2)} Alloy</b> (fees worth ${n0(r2.feeIn)} Stone)` : 'Alloy'}.`)}
    ${H('NPC market makers', 'npc')}
    ${P(`The rest of the world trades too. Every ${D.dex.tick} seconds NPC market makers trade each pool toward its <b>fair price</b>: they close up to ${pc(D.dex.maxMove || 0.25, 0)} of the gap per round, aiming at a slightly noisy target (±${pc(RULE.mm.noise, 0)}), and every trade keeps x · y = k. So prices drift back after big trades, and they keep trading while you're offline.`)}
    ${npcT ? P(`They can only spend what they own. HENIUM they put into a pool comes out of their treasury (${G.fmtFull(D.dex.treasury0)} at launch, <b>${G.fmtFull(Math.round(npcT.henium))}</b> now), HENIUM they take out goes back into it, and they spend at most ${pc(D.dex.perTick || 0, 1)} of it per pool per round. The treasury only grows by ${pc(D.dex.npcBuy || 0, 0)} of what the other players mint each day (they bring part of their earnings to market), so trading can never create HENIUM: selling lots of ore when the treasury is low simply moves the price more.`) : ''}
    ${P(`Fair prices follow the HENIUM value factor (×${sig(G.henValueK())} now; it rises at every halving, see ${L('henium')}): the more valuable HENIUM gets, the fewer HENIUM a resource is worth and the more ETH one HENIUM is worth.`)}
    ${rv ? box(`Goods are cheap next to HENIUM${D.dex.oreValueK ? ` (a resource's fair price is ${pc(D.dex.oreValueK, 0)} of its reference price, divided by the value factor)` : ''}. Selling ${rv.ore} Henium Ore here gives about <b>${nd(rv.sell)} HENIUM</b>; one job of ${rv.own ? 'your' : 'a'} Lv. ${rv.lv} refinery turns the same ore (plus ${chips(rv.rest, 15)}) into <b>${nd(rv.perJob)} HENIUM</b>. ${rv.perJob > rv.sell ? 'Refining pays more than selling.' : 'Right now selling pays more than refining at this level.'}`, 'tip', 'Refine or sell?') : ''}
    ${T(['Pool', ['Price now', 'wk-n'], ['Fair price', 'wk-n'], ['Difference', 'wk-n']], fairRows, { min: 460 })}
    ${H('All pools', 'pools')}
    ${T(['Pool', ['Price', 'wk-n'], ['Reserves', 'wk-n'], ['Liquidity (HENIUM)', 'wk-n']], poolRows, { min: 560 })}
    ${H('ETH and cashing out', 'eth')}
    ${P(`ETH here is <b>simulated</b>: you can sell EGG or HENIUM for it and buy back, but it can't leave the game. Trying to withdraw tells you why:`)}
    ${wmsg ? `<blockquote class="wk-quote">${esc(wmsg)}</blockquote>` : ''}
    ${P('A real, on-chain version would need:')}
    ${UL([
      'HENIUM and EGG as real tokens (smart contracts) with the 21M cap and the burns enforced on-chain.',
      'Audited AMM pool contracts and real liquidity, plus a wallet connection for every player.',
      'A server-authoritative game, so nobody can mint by editing a save, and limits against bots and wash trading.',
      'A bridge for EGG and FEED from the existing Chikn ecosystem, and legal and compliance checks before any real-money cash-out.',
    ])}
    ${goBtn('dex', 'Open the DEX')}`;
}

function aGuild() {
  const S = myPlay(), g = G.S.guild, gl = (D.specs.find((s) => s.id === 'gleader') || {}).name || 'Guild Leader';
  const projRows = D.guildProjects.map((p, i) => [{ h: `${i + 1}`, c: 'wk-n' }, `<b>${esc(p.name)}</b>`, { h: G.fmtFull(p.need), c: 'wk-n' }, { h: `+${p.bonus}%`, c: 'wk-n' }, chips({ henium: G.guildProjectReward(i) }, 15),
    ...(S ? [i < g.proj ? '<span class="tag g">Done</span>' : i === g.proj ? `<span class="tag o">${Math.floor(g.pts / p.need * 100)}%</span>` : ''] : [])]);
  const k1 = withS({ 'guild.proj': 1, spec: null }, () => G.donation(0).amt) / withS({ 'guild.proj': 0, spec: null }, () => G.donation(0).amt) - 1;
  const don = D.donations.map((d, i) => { const cur = withS({ spec: null }, () => G.donation(i)); return [chips({ [d.res]: d.amt }, 16), { h: `${d.pts}`, c: 'wk-n' }, S ? chips({ [d.res]: cur.amt }, 16) : '', ...(S ? [{ h: `${G.donation(i).pts}`, c: 'wk-n' }] : [])]; });
  const hz = D.zoneById('henium'), rz = D.zoneById('rare');
  const hoK = hz ? pureRate(hz, { 'guild.zoneLv': 2 }) / pureRate(hz) - 1 : 0, reK = rz ? pureRate(rz, { 'guild.zoneLv': 2 }) / pureRate(rz) - 1 : 0;
  const refK = withS(Object.assign({}, BARE, { 'factories.refinery.lv': 1, 'guild.zoneLv': 2 }), () => G.myRefPower()) / D.refPower(1) - 1;
  const zl = Array.from({ length: 8 }, (_, i) => i + 1).map((l) => [{ h: `Lv. ${l} → ${l + 1}`, c: 'wk-n' }, chips(D.guildZoneCost(l), 15), { h: `+${pc(hoK * l, 0)}`, c: 'wk-n' }, { h: `+${pc(reK * l, 0)}`, c: 'wk-n' }, { h: `+${pc(refK * l, 0)}`, c: 'wk-n' }]);
  const passive = 1 / RULE.memberRate;
  return `${P(`You mine as part of a guild${S ? `, <b>${esc(g.name)}</b> (Lv. ${g.lv}, ${g.members}/${g.max} members)` : ''}. Guildmates pool resources into big projects that give everybody a permanent mining bonus, expand the guild's deep zone, and fight other guilds for a share of the HENIUM emission.`)}
    ${H('Guild projects', 'projects')}
    ${P(`The guild works on one project at a time. When its points are full, every member gets the mining bonus for good, the guild levels up and you get a HENIUM reward (paid out of the daily emission, like all HENIUM). Your guildmates chip in on their own (a project fills in about ${tm(passive)} without you); your donations speed it up.`)}
    ${T([['#', 'wk-n'], 'Project', ['Points', 'wk-n'], ['Mining bonus', 'wk-n'], 'Reward', ...(S ? [''] : [])], projRows, { min: 560, me: (i) => S && i === g.proj })}
    ${H('Donations', 'donate')}
    ${P(`Donate resources for points. Every finished project makes donations ${pc(k1, 0)} bigger and worth ${pc(k1, 0)} more points. The ${esc(gl)} specialization gives +25% points and project bonuses.`)}
    ${T(['Donation (first project)', ['Points', 'wk-n'], ...(S ? ['Donation now', ['Points now', 'wk-n']] : [])], don, { min: S ? 520 : 320 })}
    ${H('Guild zone and License', 'zone')}
    ${P(`Expanding the guild's deep zone raises Henium Ore output by ${pc(hoK, 0)}, Rare Earth by ${pc(reK, 0)} and refinery power by ${pc(refK, 0)} per level above 1.${S ? ` Your guild zone is Lv. ${g.zoneLv}.` : ''}`)}
    ${T(['Expansion', 'Cost', ['Henium Ore', 'wk-n'], ['Rare Earth', 'wk-n'], ['Refinery power', 'wk-n']], zl, { min: 560, me: (i) => S && i + 1 === g.zoneLv })}
    ${P(`The <b>Guild License</b> (${chips(D.licenseCost, 16)}) can be bought once your guild reaches Lv. ${RULE.licenseGuildLv}. You need it to break into the ${esc((D.zones.find((z) => z.gate && z.gate.license) || {}).name || 'Core Zone')}.${S ? ` You ${g.license ? '<b>hold</b> a license' : 'don\'t have one yet'}.` : ''}`)}
    ${H('Guild wars and the leaderboard', 'wars')}
    ${P(`Guild wars are fought in the ${L('battle', 'Arena')} (PvP). Wins earn war points for you and your guild, and war points earn a share of the ${pc(D.supply.split.war, 0)} war pool of the daily HENIUM emission (${L('henium')}). The season leaderboard ranks guilds by contribution plus war points.`)}
    ${goBtn('guild', 'Open the Guild')}`;
}

function aExpeditions() {
  const S = myPlay(), X = RULE.exp, sites = D.expeditions.concat(D.veinExpedition ? [D.veinExpedition] : []);
  const rows = sites.map((e) => [`<b>${esc(e.name)}</b>${e.event ? ' <span class="tag p">event</span>' : ''}`, { h: `Lv. ${e.lv}`, c: 'wk-n' }, { h: tm(e.t), c: 'wk-n' }, { h: e.slots, c: 'wk-n' }, { h: `${esc(e.riskName)} <small>${pc(e.risk, 0)}</small>`, c: 'wk-n' }, ranges(e.r, 16)]);
  const k3 = (X.base + X.per * 3 + Math.min(X.powCap, 300 / X.powDiv));
  const ex = D.expeditions.find((e) => e.r.heniumOre) || D.expeditions[0];
  return `${P(`Send idle Chikns (not in your Mining Team) on expeditions to bring back loot. Each site takes a team of up to its slot count, runs for a fixed time and has an injury risk. One team per site at a time.`)}
    ${T(['Site', ['Player level', 'wk-n'], ['Time', 'wk-n'], ['Slots', 'wk-n'], ['Injury risk', 'wk-n'], 'Base loot (each run)'], rows, { min: 680 })}
    ${P(`The Henium Vein expedition only opens during the "${esc((D.liveEvents.find((e) => e.id === 'vein') || {}).name || 'Henium Vein Discovered!')}" live event.`)}
    ${H('Loot', 'loot')}
    ${fx(`loot = base loot × (${X.base} + ${X.per} per Chikn + team power ÷ ${X.powDiv} (max ${X.powCap})) × (1 + explore bonus)`)}
    ${UL([
      `Bigger and stronger teams bring back more. Explorer Chikns in the team add their bonus, Leaders half of theirs, the Explorer specialization +${pc(X.specLoot, 0)}.`,
      `There's a ${pc(X.feed, 0)} chance (more with explorers) of ${X.feedAmt[0]}–${X.feedAmt[1]} bonus FEED.`,
      `Example: 3 Chikns with ${300} power together and no explorers → ×${sig(k3, 3)}: the ${esc(ex.name)} brings ${ranges(Object.fromEntries(Object.entries(ex.r).map(([r, [a, b]]) => [r, [Math.round(a * k3), Math.round(b * k3)]])), 15)}.`,
    ])}
    ${H('Injuries', 'risk')}
    ${P(`Each Chikn in the team may come back injured (the site's risk). Medic Chikns in the team lower the risk by their bonus (down to ${pc(X.riskMin, 0)} of it), the Explorer specialization ×${X.specRisk}. Injured Chikns rest for ${tm(RULE.injuredSec)}; nobody is ever lost.`)}
    ${S ? you(`${G.idleChikns().length} idle Chikns, ${S.exps.length} expedition${S.exps.length === 1 ? '' : 's'} running.`) : ''}
    ${goBtn('expeditions', 'Open Expeditions')}`;
}

function aBattle() {
  const S = myPlay(), P1 = S ? G.squadPower() : 0;
  const rows = D.stages.map((st, i) => [{ h: `${i + 1}`, c: 'wk-n' }, `<span class="wk-mname">${pic('monster/' + st.mon, 'wk-mon', st.name)}<b>${esc(st.name)}</b></span>`, { h: n0(st.power), c: 'wk-n' }, chips(st.r, 15), st.first ? chips(st.first, 15) : '<span class="dim">—</span>',
    ...(S ? [{ h: i <= S.battle.cleared ? pc(G.winChance(P1, st.power), 0) : '🔒', c: 'wk-n' }] : [])]);
  const ratios = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
  const cap = (() => { let r = 1; while (G.winChance(r * 1000, 1000) < G.winChance(100000, 1000) - 1e-9 && r < 20) r += 0.01; return r; })();
  const flo = (() => { let r = 1; while (G.winChance(r * 1000, 1000) > G.winChance(1, 1000) + 1e-9 && r > 0.01) r -= 0.01; return r; })();
  return `${P(`Your Mining Team fights monsters in PvE stages and rival guilds in PvP. Every fight is decided by one number: your <b>squad power</b> against the enemy's.`)}
    ${H('PvE stages', 'pve')}
    ${P(`Stages unlock one after another. A win pays the stage's ores and materials; the <b>first clear</b> pays them twice, plus a one-time HENIUM bounty on the later stages. After a fight the stage rests ${RULE.rest.win} s (win) or ${RULE.rest.lose} s (loss). Wins also earn hunt points (${RULE.pveHunt(0)} on stage 1, ${RULE.pveHunt(D.stages.length - 1)} on stage ${D.stages.length}) for your share of the daily HENIUM hunt pool (${L('henium')}).`)}
    ${T([['#', 'wk-n'], 'Monster', ['Power', 'wk-n'], 'Reward per win', 'First-clear bounty', ...(S ? [['Your chance', 'wk-n']] : [])], rows, { min: 700, me: (i) => S && i === S.battle.cleared })}
    ${H('Win chance', 'chance')}
    ${fx(`win chance = ${pc(RULE.win.base, 0)} + (your power − enemy power) ÷ (${RULE.win.div} × enemy power), between ${pc(RULE.win.min, 0)} and ${pc(RULE.win.max, 0)}`)}
    ${T([['Your power ÷ enemy power', 'wk-n'], ['Win chance', 'wk-n']], ratios.map((r) => [{ h: `×${r}`, c: 'wk-n' }, { h: pc(G.winChance(r * 1000, 1000), 1), c: 'wk-n' }]), { min: 300 })}
    ${P(`At ×${sig(cap, 3)} your power or more you hit the ${pc(G.winChance(1e6, 1000), 0)} cap; at ×${sig(flo, 2)} or less you still have ${pc(G.winChance(1, 1000), 0)}.`)}
    ${H('Squad power', 'power')}
    ${P(`Squad power = the battle power of the Chikns in your Mining Team, × (1 + Guardian bonuses + the Commander specialization). A Chikn's battle power comes from its rarity and level (${L('chikns')}); Guardians count ×${sig(G.chiknPower(fakeChikn({ role: 'guardian' })) / G.chiknPower(fakeChikn({})))}.`)}
    ${H('PvP: guild wars', 'pvp')}
    ${UL([
      `You hold up to <b>${D.pvpTickets} battle tickets</b>; each attack uses one and a ticket refills every ${tm(D.pvpTicketTime)}.`,
      `${RULE.rivals.n} rival guilds are on offer, ${pc(RULE.rivals.power[0], 0)}–${pc(RULE.rivals.power[1], 0)} as strong as you; new rivals appear after every fight.`,
      `A win pays ${chips({ ...RULE.pvp.loot(S ? S.depth : 25), henium: RULE.pvp.henium }, 15)} (loot for depth ${S ? `${S.depth}, yours` : 25}; it grows as you dig) and ${RULE.pvp.pts[0]}–${RULE.pvp.pts[1]} <b>war points</b>; a loss costs ${RULE.pvp.lose} war points.`,
      `War points earn a daily share of the HENIUM war pool and count for your guild (${L('guild')}).`,
    ])}
    ${S ? you(`Squad power <b>${n0(P1)}</b> · stages cleared ${S.battle.cleared}/${D.stages.length} · tickets ${S.battle.tickets}/${D.pvpTickets} · war points ${n0(S.guild.warPts)}.`) : ''}
    ${goBtn('battle', 'Open Battle')}`;
}

function aEvents() {
  const S = myPlay(), ev = S ? G.liveEvent() : null;
  const evRows = D.liveEvents.map((e) => [`<b>${esc(e.name)}</b>`, `<span class="wk-sm">${esc(e.desc)}</span>`, { h: tm(e.dur), c: 'wk-n' }, { h: e.minDepth ? `${e.minDepth}` : '—', c: 'wk-n' }]);
  const cells = Array.from({ length: D.seasonMax }, (_, i) => i + 1).map((l) => { const r = D.seasonReward(l);
    const body = r.chikn ? `${pic('chikn/leader', 'wk-sr-c')}<small style="color:${(D.rarity(r.chikn) || {}).color}">${esc((D.rarity(r.chikn) || {}).name || r.chikn)}</small>` : Object.entries(r).map(([k, v]) => `${ic(k, 22)}<small>${amtOf(k, v)}</small>`).join('');
    return `<div class="wk-sr ${r.chikn ? 'wk-sr-big' : ''} ${S && l <= S.season.lv ? 'wk-sr-on' : ''}"><b>${l}</b>${body}</div>`; }).join('');
  const tot = {}; let chikns = [];
  for (let l = 1; l <= D.seasonMax; l++) { const r = D.seasonReward(l); if (r.chikn) chikns.push(r.chikn); else for (const k in r) tot[k] = (tot[k] || 0) + r[k]; }
  let xpAll = 0; for (let l = 1; l < D.seasonMax; l++) xpAll += D.seasonNeed(l);
  const lvP = S ? S.player.lv : 10, dP = S ? S.depth : 10;
  const ms = D.missions.map((m) => { const fixed = !RULE.rotating.includes(m.id); return [esc(m.text(m.n(lvP))), { h: `${G.fmtFull(m.n(1))} · ${G.fmtFull(m.n(30))}`, c: 'wk-n' }, chips(G.missionReward(m, dP), 15), fixed ? 'every day' : 'rotates']; });
  const qs = D.quests.map((q, i) => [{ h: `${i + 1}`, c: 'wk-n' }, esc(q.text), chips(q.r, 15), ...(S ? [S.quests.done.includes(q.id) ? '<span class="tag g">Done</span>' : ''] : [])]);
  return `${P('Something is always going on: live events change the rules for a few hours, the season pass rewards everything you do, daily missions reset every day and story quests guide you through the game.')}
    ${H('Live events', 'live')}
    ${P(`One live event runs at a time; the next starts ${tm(RULE.liveGap[0])}–${tm(RULE.liveGap[1])} after the last one ends. Some only appear once you're deep enough.${ev ? ` Right now: <b>${esc(ev.name)}</b>, <span data-b="until:${S.live.until}"></span> left.` : ''}`)}
    ${T(['Event', 'Effect', ['Lasts', 'wk-n'], ['From depth', 'wk-n']], evRows, { min: 600, me: (i) => ev && D.liveEvents[i].id === ev.id })}
    ${H('Season pass', 'season')}
    ${P(`Every XP you earn also fills the season pass: ${D.seasonMax} levels (${G.fmtFull(D.seasonNeed(1))} XP for the first, +${G.fmtFull(D.seasonNeed(2) - D.seasonNeed(1))} per level after that; ${G.fmtFull(xpAll)} XP in total). Claim each level's reward on the Events screen. A season lasts about ${RULE.seasonDays} days, then everything starts over.`)}
    <div class="wk-track">${cells}</div>
    ${P(`Odd levels pay ores and materials (more and better the higher the level), even levels a little FEED, every fifth level HENIUM, and every tenth a Chikn. The whole track pays ${chips(tot, 16)} plus ${chikns.length} Chikns (${chikns.map((c) => esc((D.rarity(c) || {}).name || c)).join(', ')}); a Chikn can only be claimed while your ${L('b-coop', 'Coop')} has room.`)}
    ${H('Daily missions', 'missions')}
    ${P(`Every day you get ${D.missions.length - RULE.rotating.length + 1} missions: ${D.missions.filter((m) => !RULE.rotating.includes(m.id)).length} fixed ones and one that rotates. Targets grow with your player level (shown here for Lv. ${lvP}; the second column shows Lv. 1 · Lv. 30), rewards with your depth: ores and materials of your zone (shown for depth ${dP}), plus at most ${missionFeedMax()} FEED a day in total. Missions never pay EGG.`)}
    ${T(['Mission', ['Target (Lv. 1 · 30)', 'wk-n'], `Reward (depth ${dP})`, 'When'], ms, { min: 560 })}
    ${H('Story quests', 'quests')}
    ${P('Quests are shown three at a time on the Mines screen and lead you through the whole game, from your first tap to depth 50.')}
    ${T([['#', 'wk-n'], 'Quest', 'Reward', ...(S ? [''] : [])], qs, { min: 480 })}
    ${goBtn('events', 'Open Events')}`;
}

function aHazards() {
  const S = myPlay(), d = S ? S.depth : 25, P1 = S ? Math.max(RULE.hazardMin, G.squadPower()) : 0, B = RULE.bandits, C = RULE.creature;
  const card = (art, name, when, html) => `<div class="wk-hz">${pic(art, 'wk-hz-art', name)}<div><h3>${name}</h3><div class="wk-hz-w">${when}</div>${html}</div></div>`;
  const ev = D.liveEvents.find((e) => e.id === 'collapse');
  return `${P(`Every ${tm(RULE.hazardGap[0])}–${tm(RULE.hazardGap[1])} something may happen on one of your open floors. Below player Lv. ${RULE.hazardLv} you only meet the friendly ones. Numbers below are for depth <b>${d}</b>${S ? ' (yours)' : ''}; costs and rewards grow with depth.`)}
    ${card('prop/rubble', 'Cave-in', `lasts ${tm(RULE.collapse.sec)} or until cleared`, `${P(`A floor collapses and <b>stops producing</b>. Clear the rubble for ${chips({ stone: RULE.collapse.stone(d) }, 16)}, or wait it out. Medic Chikns in your Mining Team may stop it before it happens: their safety bonus is the chance (up to ${pc(RULE.medicCap, 0)}) that a cave-in turns into a rich vein instead.${ev ? ` During the ${esc(ev.name)} event, ${pc(RULE.collapseEvent, 0)} of all hazards are cave-ins, aimed at the Henium Vein.` : ''}`)}`)}
    ${card('res/heniumOre', 'Rich vein', `lasts ${tm(RULE.rich.sec)}`, P(`A floor glows: your next ${RULE.rich.taps} taps on it are worth ×${RULE.rich.mult}. Tap fast!`))}
    ${card('prop/crate', 'Supply drop', `lasts ${tm(RULE.supply.sec)}`, P(`A crate falls into the mine. Open it for ${chips({ ...RULE.supply.loot(d), feed: RULE.supply.feed(d) }, 16)}: ores and materials of your zone and a little FEED.`))}
    ${card('monster/' + C.mons[0], 'Creature', `lasts ${tm(C.sec)}`, P(`A creature (${orList(C.mons.map((m) => esc((D.stages.find((x) => x.mon === m) || {}).name || m)))}) lurks on a floor with ${pc(C.power[0], 0)}–${pc(C.power[1], 0)} of your squad's power${S ? ` (${n0(P1 * C.power[0])}–${n0(P1 * C.power[1])})` : ''}. Fight it (${L('battle', 'win chance')}) for ${chips({ ...C.loot(d), feed: C.feed(d) }, 16)} and ${C.hunt} hunt point${C.hunt === 1 ? '' : 's'}; if it wins, it just escapes.`))}
    ${card('ui/battle', 'Bandit raid', `lasts ${tm(B.sec)}`, `${P(`Bandits with ${pc(B.power[0], 0)}–${pc(B.power[1], 0)} of your squad's power${S ? ` (${n0(P1 * B.power[0])}–${n0(P1 * B.power[1])})` : ''} raid a floor. You choose:`)}${UL([
      `<b>Pay the toll</b>: ${chips({ egg: B.toll(d) }, 16)} and they leave.`,
      `<b>Defend</b>: win and take their loot, ${chips({ ...B.win.loot(d), henium: B.win.henium }, 16)}, plus ${B.win.hunt} hunt points; lose and they steal ${pc(B.lose[0], 0)} of that floor's ore and ${pc(B.lose[1], 0)} of your HENIUM.`,
      `<b>Ignore them</b>: when time runs out they steal ${pc(B.ignore[0], 0)} of the ore and ${pc(B.ignore[1], 0)} of your HENIUM.`,
    ])}${P(`Raiders only go after HENIUM when you hold more than ${B.keep}, and they come at most once every ${tm(B.gap)}. A strong Mining Team (Guardians, the Commander specialization) is the best defense.`)}`)}
    ${H('Handling hazards well', 'tips')}
    ${UL([
      'Keep a stock of Stone for cave-ins, and a Medic in the squad if they hurt you.',
      'Fight creatures and bandits only when your squad is clearly stronger; otherwise pay the toll.',
      'Spend or trade big HENIUM stashes instead of leaving them lying around.',
    ])}
    ${goBtn('mines', 'Open the Mines')}`;
}

const GLOSS = [
  ['AMM', 'Automated market maker: a pool that prices trades with a formula (x · y = k) instead of an order book.', 'dex'],
  ['Burn', 'Destroying tokens for good. Spending EGG burns it; a third of every DEX fee is burned.', 'currencies'],
  ['Cap', `The maximum HENIUM supply: ${G.fmtFull(D.supply.cap)}.`, 'henium'],
  ['Construction', 'Building or upgrading takes time; jobs pause meanwhile.', 'buildings'],
  ['Coop', 'Houses your Chikns; hiring fails when it is full.', 'b-coop'],
  ['Depth', `How deep your mine goes, 1 to ${D.maxDepth}. Each new depth makes its zone produce more.`, 'digging'],
  ['Difficulty', 'The world\'s total refinery power. It grows every farm day, so each refinery earns a smaller share.', 'henium'],
  ['Dig', 'Paying to open the next depth level; takes time.', 'digging'],
  ['Durability', 'A machine\'s condition. It wears down while drilling; at 0% the machine stops until serviced.', 'machines'],
  ['EGG', 'Scarce everyday currency, laid by Chikns.', 'currencies'],
  ['Emission', 'The HENIUM the whole world may mint per farm day.', 'henium'],
  ['Epoch', 'The period between two halvings.', 'henium'],
  ['Farm day', `The game's day for eggs, FEED and payouts: a real day (${tm(F.day)}).`, 'farm'],
  ['FEED', 'Chikn food; daily upkeep and feeding.', 'currencies'],
  ['Floor', 'A zone\'s production line in the mine; upgrade it to mine more.', 'zones'],
  ['Gate', 'A milestone you need before digging into a new zone.', 'digging'],
  ['Halving', 'The moment the daily HENIUM emission halves.', 'henium'],
  ['HENIUM', 'The scarce token at the heart of the game.', 'henium'],
  ['Hunt points', 'Earned by PvE wins, creatures and bandits; they pay your share of the daily hunter pool.', 'battle'],
  ['Look', `One of the ${D.factoryMaxLv} pieces of art of a building; every level has its own.`, 'buildings'],
  ['Milestone', 'Floor levels where output doubles.', 'zones'],
  ['Mining Team', 'Your squad: the Chikns whose bonuses count.', 'chikns'],
  ['Nest', 'Where laid eggs collect until you pick them up.', 'farm'],
  ['Pool', 'Two tokens locked together on the DEX for trading.', 'dex'],
  ['Price impact', 'How much your own trade moves the price.', 'dex'],
  ['Quota', 'The FEED a Feed Mill may grind per farm day.', 'b-feedmill'],
  ['Refinery power', 'Sets your share of the refiners\' HENIUM.', 'henium'],
  ['Route', 'The path of a swap; through HENIUM when there is no direct pool.', 'dex'],
  ['Slippage', 'Getting a worse price than quoted because the pool moved; the minimum-received setting protects you.', 'dex'],
  ['Spot price', 'The pool\'s current price before fees and impact.', 'dex'],
  ['TVL', 'Total value locked: the value of everything in a pool.', 'dex'],
  ['War points', 'Earned in PvP; they pay a share of the daily war pool.', 'guild'],
  ['Weight', 'A Chikn\'s kg. It sets its level and how many eggs it lays.', 'farm'],
  ['Yield', 'The output multiplier of a building level.', 'buildings'],
];
function aGlossary() {
  return `<dl class="wk-gloss">${GLOSS.map(([t, d, id]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)} ${L(id, '→ ' + esc(title(id)))}</dd></div>`).join('')}</dl>`;
}

function aFaq() {
  const hd = (digScan().henium || [[21]])[0][0], core = D.zones.find((z) => z.gate && z.gate.license), ref = D.factoryById('refinery');
  const qa = [
    ['How do I get HENIUM early on?', `Story quests pay HENIUM from the Coal Zone on, the later battle stages pay first-clear bounties, and PvP wins pay a little. The real income starts with the ${L('b-refinery', 'Henium Refinery')} at depth ${ref.reqDepth}.`],
    ['Why can\'t I turn HENIUM into EGG?', `EGG is only laid by Chikns; that keeps it scarce. You can still buy EGG from other traders on the ${L('dex', 'DEX')}.`],
    ['Why is my refinery earning less every day?', `The rest of the world keeps building refineries (+${pc(D.supply.worldGrowth, 1)} power a day) and the emission halves over time. Upgrade the refinery and recruit Scientists to keep your share. See ${L('henium')}.`],
    ['My machine stopped!', `Either it ran out of Coal (it restarts once you have Coal) or its durability hit 0% (service it). See ${L('machines')}.`],
    ['I can\'t dig deeper.', `Check the gate of the next zone (a building, a machine, a License) and the cost: from depth ${hd} every dig costs HENIUM. See ${L('digging')}.`],
    ['My Chikns are losing weight.', `They are hungry: your FEED ran out. Mill FEED, burn EGG for FEED or claim FEED rewards. See ${L('farm')}.`],
    ['The Feed Mill stopped.', `It reached today's quota. It continues on the next farm day; upgrade it for a bigger quota.`],
    ['How do I get more EGG?', `More Chikns (upgrade the ${L('b-coop', 'Coop')}), heavier Chikns (feeding), and collecting the nest before it's full. See ${L('farm')}.`],
    ['Can I lose Chikns?', `No. Expeditions can injure them (they rest ${tm(RULE.injuredSec)}) and hunger costs weight, but nobody is ever lost.`],
    ['How do I reach the Core Zone?', `${core ? `Its gate needs ${gateText(core)}` : 'Upgrade the refinery and buy a Guild License'}. The License needs a guild at Lv. ${RULE.licenseGuildLv}: finish guild projects.`],
    ['Is ETH real?', 'No. ETH, HENIUM, EGG and the other players are simulated in this prototype; nothing leaves the game.'],
    ['What happens while I\'m offline?', `Your floors keep mining for up to ${RULE.offlineH} hours. Factories, buildings, digs, the farm and the daily HENIUM payouts keep running the whole time (up to 60 days). Machines don't wear out offline.`],
  ];
  return qa.map(([q, a]) => `<details class="wk-qa"><summary>${esc(q)}</summary><p>${a}</p></details>`).join('');
}

// ---------- registry ----------
const CATS = [
  { id: 'basics', name: 'Basics', icon: 'chikn/explorer' },
  { id: 'mine', name: 'The Mine', icon: 'ui/mines' },
  { id: 'build', name: 'Buildings', icon: 'ui/factories' },
  { id: 'chikn', name: 'Chikns & Farm', icon: 'ui/chikns' },
  { id: 'econ', name: 'Economy', icon: 'res/henium' },
  { id: 'world', name: 'Guild & Adventure', icon: 'ui/guild' },
  { id: 'ref', name: 'Reference', icon: 'ui/wiki' },
];
const ARTS = [
  { id: 'home', cat: null, title: 'Wiki Home', icon: 'ui/wiki', sub: 'Every system of Chikn Henium Mines, explained with numbers taken straight from the game.', body: aHome },
  { id: 'start', cat: 'basics', title: 'Getting Started', icon: 'chikn/explorer', sub: 'The game loop: mine, crush, separate, smelt, forge, assemble and refine HENIUM; the farm; the 6-month journey.', body: aStart, kw: 'game loop tutorial beginner journey roadmap month unlock level xp' },
  { id: 'currencies', cat: 'basics', title: 'Currencies', icon: 'res/egg', sub: 'EGG, FEED, HENIUM and ETH: what each is for, where it comes from and where it goes.', body: aCurrencies, kw: 'token money burn' },
  { id: 'resources', cat: 'basics', title: 'Resources', icon: 'res/heniumOre', sub: 'Every ore and material: where it comes from and what uses it.', body: aResources, kw: 'ore material ingot items' },
  { id: 'zones', cat: 'mine', title: 'Mines & Zones', icon: 'ui/mines', sub: 'The seven zones, floor output, upgrades and milestones.', body: aZones, kw: 'floor zone rate upgrade milestone tap' },
  { id: 'digging', cat: 'mine', title: 'Digging Deeper', icon: 'prop/headframe', sub: 'What every dig costs and how long it takes, gates, and how machines speed it up.', body: aDigging, kw: 'dig depth gate cost time' },
  { id: 'machines', cat: 'mine', title: 'Machines', icon: 'machine/heavy', sub: 'Drills, scanners, rigs and extractors: stats, coal, wear, servicing and upgrades.', body: aMachines, kw: 'drill crafting durability service coal energy' },
  { id: 'hazards', cat: 'mine', title: 'Hazards', icon: 'prop/rubble', sub: 'Cave-ins, bandits, creatures, rich veins and supply drops, and how to handle each.', body: aHazards, kw: 'cave-in collapse bandits creature rich vein supply crate raid' },
  { id: 'buildings', cat: 'build', title: 'Buildings Overview', icon: 'ui/factories', sub: 'All buildings, construction time, the production queue and global factory upgrades.', body: aBuildings, kw: 'factory construction queue upgrade looks' },
  ...D.factories.map((f) => ({ id: 'b-' + f.id, cat: 'build', title: f.name, icon: artOf(f.id), sub: `${f.desc}. Unlocks at depth ${f.reqDepth}.`, body: () => aFactory(f), kw: `factory building ${f.recipes.map((r) => r.name).join(' ')}` })),
  { id: 'b-coop', cat: 'build', title: 'Coop', icon: 'farm/coop', sub: 'Where your Chikns live: capacity, upgrades and its 10 looks.', body: aCoop, kw: 'coop capacity chikn house' },
  { id: 'b-hq', cat: 'build', title: 'Headquarters', icon: 'prop/hq', sub: 'Your company HQ: a new look every few depth levels.', body: aHQ, kw: 'hq headquarters' },
  { id: 'chikns', cat: 'chikn', title: 'Chikns', icon: 'ui/chikns', sub: 'The 10 roles, the 6 rarities, hiring, weight and levels, and the Mining Team.', body: aChikns, kw: 'nft role rarity hire squad team level weight' },
  { id: 'farm', cat: 'chikn', title: 'The Egg Farm', icon: 'farm/nest', sub: 'Eggs by weight, FEED upkeep and hunger, coop and mill, and the Egg Farmer strategy.', body: aFarm, kw: 'egg feed weight kg nest upkeep hunger farmer' },
  { id: 'specs', cat: 'chikn', title: 'Specializations', icon: 'ui/trophy', sub: 'Seven permanent play styles to choose at player Lv. 8.', body: aSpecs, kw: 'specialization miner industrialist trader explorer commander farmer guild leader' },
  { id: 'henium', cat: 'econ', title: 'HENIUM Tokenomics', icon: 'res/henium', sub: 'The 21M cap, halvings, the emission split, refinery shares, faucets, sinks and burns.', body: aHenium, kw: 'supply halving emission epoch refinery share war hunt faucet sink burn value' },
  { id: 'dex', cat: 'econ', title: 'The DEX', icon: 'ui/dex', sub: 'Constant-product pools, fees and burns, routing, slippage, market makers and ETH.', body: aDex, kw: 'exchange swap pool amm liquidity price eth trade' },
  { id: 'guild', cat: 'world', title: 'Guild', icon: 'ui/guild', sub: 'Projects, donations, the guild zone, the License, wars and the leaderboard.', body: aGuild, kw: 'guild project donation license zone war leaderboard' },
  { id: 'expeditions', cat: 'world', title: 'Expeditions', icon: 'ui/expeditions', sub: 'Sites, risk, time, slots and loot; Explorers and Medics.', body: aExpeditions, kw: 'expedition loot injury explorer medic' },
  { id: 'battle', cat: 'world', title: 'Battle', icon: 'ui/battle', sub: 'PvE stages, first-clear bounties, PvP tickets, war points and win chances.', body: aBattle, kw: 'pve pvp fight monster stage arena win chance power' },
  { id: 'events', cat: 'world', title: 'Events, Seasons & Missions', icon: 'ui/events', sub: 'Live events, the 40-level season pass, daily missions and story quests.', body: aEvents, kw: 'live event season pass mission quest daily' },
  { id: 'glossary', cat: 'ref', title: 'Glossary', icon: 'ui/wiki', sub: 'Every term in one place.', body: aGlossary, kw: 'terms definitions' },
  { id: 'faq', cat: 'ref', title: 'FAQ', icon: 'chikn/scientist', sub: 'Quick answers to the questions every MineMaster asks.', body: aFaq, kw: 'questions help' },
];
const byId = Object.fromEntries(ARTS.map((a) => [a.id, a]));
const art = (id) => byId[id] || byId.home;

// ---------- search ----------
const strip = (h) => h.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function buildIndex() {
  textMode = true;
  try { index = ARTS.map((a) => ({ a, t: a.title.toLowerCase(), x: strip(`${a.sub} ${safe(() => a.body(), '')}`), k: (a.kw || '').toLowerCase() })); }
  finally { textMode = false; }
  for (const e of index) e.lx = e.x.toLowerCase();
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = (q) => q.toLowerCase().split(/\s+/).map((w) => w.trim()).filter((w) => w.length > 0);
function search(q) {
  const ws = words(q);
  if (!ws.length) return [];
  if (!index) buildIndex();
  const out = [];
  for (const e of index) {
    if (!ws.every((w) => e.t.includes(w) || e.lx.includes(w) || e.k.includes(w))) continue;
    let score = 0;
    for (const w of ws) { if (e.t.includes(w)) score += 40; if (e.k.includes(w)) score += 8; let n = 0, i = -1; while ((i = e.lx.indexOf(w, i + 1)) >= 0 && n < 12) n++; score += n; }
    out.push({ a: e.a, score, snip: snippet(e, ws) });
  }
  return out.sort((a, b) => b.score - a.score);
}
function snippet(e, ws) {
  let i = -1;
  for (const w of ws) { i = e.lx.indexOf(w); if (i >= 0) break; }
  if (i < 0) return esc(e.x.slice(0, 90)) + '…';
  const a = Math.max(0, e.x.lastIndexOf(' ', Math.max(0, i - 36)) + 1), b = Math.min(e.x.length, i + 80);
  const raw = (a > 0 ? '…' : '') + e.x.slice(a, b) + (b < e.x.length ? '…' : '');
  const re = new RegExp(`(${ws.map(escRe).join('|')})`, 'gi');
  return raw.split(re).map((p, j) => (j % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
}
function markArticle(root, q) { // highlight search words in the article body, return the first mark
  const ws = words(q).filter((w) => w.length > 1);
  if (!ws.length || !root) return null;
  const re = new RegExp(`(${ws.map(escRe).join('|')})`, 'gi');
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('svg, mark, script, style, button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const nodes = [];
  while (tw.nextNode()) { re.lastIndex = 0; if (re.test(tw.currentNode.nodeValue)) nodes.push(tw.currentNode); }
  let first = null, count = 0;
  for (const n of nodes) {
    if (count > 80) break;
    const parts = n.nodeValue.split(re), frag = document.createDocumentFragment();
    parts.forEach((p, j) => { if (!p) return; if (j % 2) { const m = document.createElement('mark'); m.className = 'wk-mark'; m.textContent = p; frag.appendChild(m); first = first || m; count++; } else frag.appendChild(document.createTextNode(p)); });
    n.parentNode.replaceChild(frag, n);
  }
  // open collapsed <details> that contain a hit
  root.querySelectorAll('details').forEach((d) => { if (d.querySelector('mark.wk-mark')) d.open = true; });
  return first;
}

// ---------- rendering ----------
const itemHTML = (a, extra = '') => `<a class="wk-item ${a.id === cur ? 'on' : ''}" href="#wiki/${a.id}" data-a="wkGo" data-args='${args([a.id])}' ${a.id === cur ? 'aria-current="page"' : ''}>${pic(a.icon, 'wk-item-ic')}<span>${esc(a.title)}</span>${extra}</a>`;
function listHTML() {
  if (query.trim()) {
    const hits = search(query), qq = esc(query.trim());
    return `<div class="wk-res-h">${hits.length ? `${hits.length} article${hits.length > 1 ? 's' : ''} mention “${qq}”` : `Nothing found for “${qq}”`}</div>` +
      (hits.length ? hits.map(({ a, snip }) => `<a class="wk-item wk-hit ${a.id === cur ? 'on' : ''}" href="#wiki/${a.id}" data-a="wkGo" data-args='${args([a.id, 1])}'>${pic(a.icon, 'wk-item-ic')}<span><b>${esc(a.title)}</b><small>${snip}</small></span></a>`).join('')
        : `<div class="wk-res-none">Try ${['halving', 'refinery', 'feed', 'depth 21', 'alloy'].map((w) => `<button class="wk-chip" data-a="wkSuggest" data-args='${args([w])}'>${w}</button>`).join(' ')}</div>`);
  }
  return itemHTML(byId.home) + CATS.map((c) => {
    const items = ARTS.filter((a) => a.cat === c.id), open = !closed.has(c.id);
    return `<div class="wk-cat ${open ? 'open' : ''}"><button class="wk-cat-h" data-a="wkCat" data-args='${args([c.id])}' aria-expanded="${open}">${pic(c.icon, 'wk-cat-ic')}<span>${esc(c.name)}</span><small>${items.length}</small><i class="wk-chev" aria-hidden="true"></i></button>
      ${open ? `<div class="wk-items">${items.map((a) => itemHTML(a)).join('')}</div>` : ''}</div>`;
  }).join('');
}
function mainHTML() {
  const a = art(cur), c = CATS.find((x) => x.id === a.cat), i = ARTS.indexOf(a), prev = ARTS[i - 1], next = ARTS[i + 1];
  const body = safe(() => a.body(), box('This article could not be generated from the current game data.', 'warn'));
  const secs = [...body.matchAll(/<h2 id="(wk-s-[^"]+)">([\s\S]*?)<\/h2>/g)];
  const crumb = (id, t, anchor) => `<a class="wk-a" href="#wiki/${id}" data-a="wkGo" data-args='${args(anchor ? [id, 0, anchor] : [id])}'>${t}</a>`;
  return `<div class="wk-crumbs">
      <button class="wk-hb" data-a="wkBack" ${hi > 0 ? '' : 'disabled'} aria-label="Back" title="Back">◀</button><button class="wk-hb" data-a="wkFwd" ${hi < hist.length - 1 ? '' : 'disabled'} aria-label="Forward" title="Forward">▶</button>
      <nav class="wk-bc" aria-label="Breadcrumbs">${crumb('home', 'Wiki')}${c ? `<span class="wk-sep">›</span>${crumb('home', esc(c.name), 'wk-s-cat-' + c.id)}` : ''}${a.id !== 'home' ? `<span class="wk-sep">›</span><b>${esc(a.title)}</b>` : ''}</nav>
    </div>
    <header class="wk-ah">${pic(a.icon, 'wk-ah-ic', '')}<div><h1>${esc(a.title)}</h1><p class="wk-lead">${esc(a.sub)}</p></div></header>
    ${secs.length >= 3 ? `<nav class="wk-toc" aria-label="On this page"><b>On this page</b>${secs.map(([, id, t]) => `<a href="#${id}" data-a="wkJump" data-args='${args([id])}'>${esc(strip(t))}</a>`).join('')}</nav>` : ''}
    <div class="wk-body">${body}</div>
    <footer class="wk-foot">${prev ? `<a class="wk-pn" href="#wiki/${prev.id}" data-a="wkGo" data-args='${args([prev.id])}'><small>Previous</small>‹ ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="wk-pn wk-pn-n" href="#wiki/${next.id}" data-a="wkGo" data-args='${args([next.id])}'><small>Next</small>${esc(next.title)} ›</a>` : '<span></span>'}</footer>`;
}
const root = () => document.querySelector('.wk-root');
function refreshList() {
  const r = root();
  if (!r) return;
  r.querySelector('.wk-list').innerHTML = listHTML();
  const x = r.querySelector('.wk-qx');
  if (x) x.hidden = !query;
  r.classList.toggle('wk-open', tocOpen);
  const b = r.querySelector('.wk-tocb');
  if (b) b.setAttribute('aria-expanded', String(tocOpen));
}
function show(o = {}) {
  if (ui.cur !== 'wiki') { pending = o; ui.go('wiki'); return; }
  const r = root();
  if (!r) { pending = o; ui.render(); return; }
  const a = art(cur);
  if (a.cat) closed.delete(a.cat);
  r.querySelector('.wk-main').innerHTML = mainHTML();
  refreshList();
  const t = r.querySelector('.wk-tocb-cur');
  if (t) t.textContent = a.title;
  after(o);
}
function after(o = {}) {
  const sc = scroller(), r = root();
  if (!r) return;
  const first = hlq ? markArticle(r.querySelector('.wk-body'), hlq) : null;
  if (o.anchor) { const t = document.getElementById(o.anchor); if (t) t.scrollIntoView({ block: 'start' }); }
  else if (first) first.scrollIntoView({ block: 'center' });
  else if (sc && o.y !== undefined) sc.scrollTop = o.y;
  const side = r.querySelector('.wk-side'), on = side && side.querySelector('.wk-item.on');
  if (side && on && !query.trim()) { const sr = side.getBoundingClientRect(), orr = on.getBoundingClientRect(); if (orr.top < sr.top || orr.bottom > sr.bottom) side.scrollTop += orr.top - sr.top - sr.height / 3; }
  if (!PLAY()) { try { history.replaceState(null, '', '#wiki/' + cur); } catch (e) { /* sandboxed */ } }
  ui.refresh();
}
function go(id, o = {}) {
  if (!byId[id]) id = 'home';
  const sc = scroller();
  if (ui.cur === 'wiki' && sc && root()) hist[hi].y = sc.scrollTop;
  if (hist[hi].id !== id) { hist = hist.slice(0, hi + 1); hist.push({ id, y: 0 }); if (hist.length > 60) hist.shift(); hi = hist.length - 1; }
  cur = id; hlq = o.hl || ''; tocOpen = false;
  show({ y: 0, anchor: o.anchor });
}
function step(dir) {
  const j = hi + dir;
  if (j < 0 || j >= hist.length) return;
  const sc = scroller();
  if (sc && root()) hist[hi].y = sc.scrollTop;
  hi = j; cur = hist[hi].id; hlq = ''; tocOpen = false;
  show({ y: hist[hi].y });
}
function setLook(gid, n) {
  const g = galCfg[gid];
  if (!g) return;
  look[gid] = Math.min(g.keys.length, Math.max(1, n));
  const el = document.querySelector(`.wk-gal[data-gal="${gid}"]`);
  if (!el) return;
  el.innerHTML = galInner(gid);
  const strip2 = el.querySelector('.wk-gal-strip'), th = el.querySelector('.wk-gal-th.on');
  if (strip2 && th) strip2.scrollLeft = th.offsetLeft - strip2.clientWidth / 2 + th.clientWidth / 2;
  const big1 = el.querySelector('.wk-gal-big');
  if (big1) big1.classList.add('wk-pop');
}

ui.views.wiki = {
  render(el) {
    if (!booted) {
      booted = true;
      const m = /^#wiki\/([\w-]+)/.exec(location.hash || '');
      if (m && byId[m[1]]) { cur = m[1]; hist = [{ id: cur, y: 0 }]; hi = 0; }
    }
    index = null;
    const a = art(cur);
    if (a.cat) closed.delete(a.cat);
    el.innerHTML = `<div class="wk-root ${tocOpen ? 'wk-open' : ''}">
      <div class="wk-top">${pic('ui/wiki', 'wk-top-ic', 'Wiki')}<div class="wk-top-t"><h1>Wiki</h1><div class="wk-top-s">The Chikn Henium Mines encyclopedia · ${ARTS.length} articles · every number comes live from the game data</div></div></div>
      <div class="wk-layout">
        <aside class="wk-aside">
          <div class="wk-bar">
            <button class="wk-tocb" data-a="wkToc" aria-expanded="${tocOpen}" aria-controls="wk-side"><span class="wk-burger" aria-hidden="true"><i></i><i></i><i></i></span><span class="wk-tocb-t">Contents</span><b class="wk-tocb-cur">${esc(a.title)}</b></button>
            <div class="wk-search"><svg class="wk-mag" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>
              <input id="wk-q" type="search" placeholder="Search the wiki…" value="${esc(query)}" autocomplete="off" spellcheck="false" aria-label="Search the wiki"><button class="wk-qx" data-a="wkClear" ${query ? '' : 'hidden'} aria-label="Clear the search">×</button></div>
          </div>
          <nav class="wk-side" id="wk-side" aria-label="Wiki articles"><div class="wk-list">${listHTML()}</div></nav>
        </aside>
        <div class="wk-scrim" data-a="wkToc" aria-hidden="true"></div>
        <article class="wk-main panel">${mainHTML()}</article>
      </div>
    </div>`;
    const q = el.querySelector('#wk-q'), side = el.querySelector('.wk-side');
    q.addEventListener('input', () => { query = q.value; tocOpen = isPhone() && !!query.trim(); refreshList(); side.scrollTop = 0; });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const h = search(query)[0]; if (h) { q.blur(); go(h.a.id, { hl: query }); } }
      else if (e.key === 'Escape') { query = ''; q.value = ''; tocOpen = false; refreshList(); }
    });
    q.addEventListener('focus', () => { if (isPhone() && query.trim() && !tocOpen) { tocOpen = true; refreshList(); } });
    side.scrollTop = sideY;
    side.addEventListener('scroll', () => { sideY = side.scrollTop; }, { passive: true });
    const o = pending; pending = null;
    if (o) setTimeout(() => after(o), 0);
    else if (hlq) setTimeout(() => after({}), 0);
    else if (hist[hi].y > 0) setTimeout(() => { const sc = scroller(); if (sc && ui.cur === 'wiki' && sc.scrollTop === 0) sc.scrollTop = hist[hi].y; }, 0);
  },
};

// ---------- handlers & binders ----------
ui.handlers.wkGo = (el, e, id, fromSearch, anchor) => go(id, { hl: fromSearch ? query : '', anchor });
ui.handlers.wkOpen = (el, e, id) => { if (el && el.closest && el.closest('#modal-root')) ui.closeModal(); go(id); };
ui.handlers.wkBack = () => step(-1);
ui.handlers.wkFwd = () => step(1);
ui.handlers.wkToc = () => {
  tocOpen = !tocOpen;
  refreshList();
  if (tocOpen) { const s = document.querySelector('.wk-side'), on = s && s.querySelector('.wk-item.on'); if (s && on) s.scrollTop = on.offsetTop - s.clientHeight / 3; }
};
ui.handlers.wkCat = (el, e, id) => { if (closed.has(id)) closed.delete(id); else closed.add(id); refreshList(); };
ui.handlers.wkLook = (el, e, gid, n) => { setLook(gid, n); G.sfx('click'); };
ui.handlers.wkJump = (el, e, id) => { const t = document.getElementById(id); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
ui.handlers.wkClear = () => { query = ''; tocOpen = false; const q = document.getElementById('wk-q'); if (q) { q.value = ''; q.focus(); } refreshList(); };
ui.handlers.wkSuggest = (el, e, w) => { query = w; const q = document.getElementById('wk-q'); if (q) q.value = w; refreshList(); };
ui.binders.wkMined = (el) => { el.textContent = G.fmt(G.S.world.mined); };
ui.binders.wkDig = (el) => { const d = G.S.dig; el.textContent = d ? G.fmtTime((d.dur - d.t) / G.digSpeed()) : 'done'; };
// "/" focuses the search; arrow keys step through a focused gallery
document.addEventListener('keydown', (e) => {
  if (ui.cur !== 'wiki' || (ui.modalOpen && ui.modalOpen())) return;
  const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (e.key === '/' && !typing) { const q = document.getElementById('wk-q'); if (q) { e.preventDefault(); q.focus(); q.select(); } return; }
  const g = t && t.closest && t.closest('.wk-gal');
  if (g && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    const gid = g.dataset.gal;
    setLook(gid, (look[gid] || 1) + (e.key === 'ArrowRight' ? 1 : -1));
    const on = g.querySelector('.wk-gal-th.on');
    if (on) on.focus();
  }
});
document.addEventListener('scroll', (e) => {
  const sc = scroller();
  if (e.target === sc && ui.cur === 'wiki' && root() && hist[hi]) hist[hi].y = sc.scrollTop;
}, { passive: true, capture: true });
})();
