// Shared UI: router, top bar, nav, live bindings, modals, toasts, floaters, sounds, common widgets.
(() => {
const G = window.G, D = G.D;
const ui = G.ui = { views: {}, handlers: {}, cur: 'mines' };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
ui.$ = $; ui.$$ = $$;
const esc = ui.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
G.img = (key) => G.ASSETS[key] || '';
const now = () => G.now(); // the game clock (moves faster in test mode)

// ---------- small builders ----------
ui.icon = (r, size = 24, cls = '') => `<img class="ic ${cls}" src="${G.img('res/' + r)}" width="${size}" height="${size}" alt="${esc(D.res[r] ? D.res[r].name : r)}">`;
ui.img = (key, cls = '', alt = '') => `<img class="${cls}" src="${G.img(key)}" alt="${esc(alt)}" draggable="false">`;
ui.amt = (r, v) => (r === 'henium' && v < 100 ? G.fmt(v, 2) : G.fmt(v));
ui.need = (cost, k = 1) => Object.entries(cost).map(([r, v]) => `${r}:${v * k}`).join(',');
const parseNeed = (s) => Object.fromEntries(s.split(',').filter(Boolean).map((p) => { const [r, v] = p.split(':'); return [r, +v]; }));
ui.cost = (cost, k = 1, size = 20) => `<span class="cost">${Object.entries(cost).map(([r, v]) =>
  `<span class="c" data-cr="${r}" data-cv="${v * k}">${ui.icon(r, size)}${ui.amt(r, v * k)}</span>`).join('')}</span>`;
ui.rew = (rew, size = 20) => `<span class="cost gain">${Object.entries(rew).filter(([, v]) => v > 0).map(([r, v]) =>
  `<span class="c">${ui.icon(r, size)}+${ui.amt(r, v)}</span>`).join('')}</span>`;
ui.bar = (pct, cls = '', text = '', attrs = '') => `<div class="bar ${cls}" ${attrs}><i style="width:${Math.max(0, Math.min(100, pct))}%"></i>${text !== '' ? `<b>${text}</b>` : ''}</div>`;
ui.btn = (label, a, args = [], cls = '', need = null, extra = '') =>
  `<button class="btn ${cls}" data-a="${a}" data-args='${esc(JSON.stringify(args))}' ${need ? `data-need="${ui.need(need)}"` : ''} ${extra}>${label}</button>`;
ui.perH = (perSec) => G.fmt(perSec * 3600) + '/h';

// Chikn card used by several screens
// rental badge: a Chikn you rent (time left), or one of yours listed for rent
ui.rentTag = (c) => (c.rent ? ` <span class="tag o" title="Rented from ${c.rent.owner}${c.rent.auto ? ', renews automatically' : ''}">Rented · ${G.fmtTime(Math.max(0, c.rent.left))}</span>`
  : c.lease && c.lease.left == null ? ' <span class="tag p" title="Listed on the rental market: it keeps working for you until a renter takes it">For rent</span>' : '');
ui.chiknCard = (c, opts = {}) => {
  const R = D.rarity(c.rarity), role = D.roles[c.role];
  const st = { squad: '<span class="tag g">Squad</span>', exp: '<span class="tag o">Expedition</span>', injured: '<span class="tag r">Recovering</span>', idle: '<span class="tag">Idle</span>',
    away: '<span class="tag p">Rented out</span>' }[c.status] + ui.rentTag(c);
  return `<div class="ccard rarity-${c.rarity} ${opts.sel ? 'sel' : ''} ${opts.cls || ''}" ${opts.attrs || ''}>
    <div class="ccard-art">${ui.img('chikn/' + c.role, 'ccard-img', role.name)}<span class="ccard-lv">Lv.${c.lv}</span></div>
    <div class="ccard-name">${esc(c.name)} <span class="dim">#${c.num}</span></div>
    <div class="ccard-meta"><span style="color:${R.color}">${R.name}</span> · ${role.name}</div>
    <div class="ccard-bonus">+${G.fmt(G.chiknPct(c), 1)}% ${role.label}</div>
    ${opts.noStatus ? '' : `<div class="ccard-st">${st}</div>`}
  </div>`;
};

// ---------- live bindings ----------
ui.binders = {
  res: (el, r) => { el.textContent = G.fmtRes(r, G.S.res[r]); },
  rate: (el, r) => { el.textContent = ui.perH(G.rates()[r] || 0); },
  job: (el, id) => {
    const j = G.S.jobs.find((x) => x.id === +id);
    if (!j) return;
    const active = G.activeJob(j.f) === j, pct = active ? j.t / j.dur * 100 : 0;
    const i = el.querySelector('i'), b = el.querySelector('b');
    if (i) i.style.width = pct + '%';
    if (b) b.textContent = active ? G.fmtTime(j.dur - j.t) : 'Queued';
  },
  craft: (el, id) => {
    const c = G.S.crafts.find((x) => x.id === +id);
    if (!c) return;
    el.querySelector('i').style.width = (c.t / c.dur * 100) + '%';
    const b = el.querySelector('b'); if (b) b.textContent = G.fmtTime(c.dur - c.t);
  },
  exp: (el, id) => {
    const e = G.S.exps.find((x) => x.id === +id);
    if (!e) return;
    el.querySelector('i').style.width = Math.min(100, e.t / e.dur * 100) + '%';
    const b = el.querySelector('b'); if (b) b.textContent = e.done ? 'Done!' : G.fmtTime(e.dur - e.t);
  },
  until: (el, t) => { el.textContent = G.fmtTime((+t - now()) / 1000); },
  // construction progress of a factory (on a .bar): data-b="con:<factoryId>"
  con: (el, fid) => {
    const c = G.S.factories[fid] && G.S.factories[fid].con;
    const i = el.querySelector('i'), b = el.querySelector('b');
    if (i) i.style.width = (c ? Math.min(100, c.t / c.dur * 100) : 100) + '%';
    if (b) b.textContent = c ? G.fmtTime(c.dur - c.t) : 'Done!';
  },
  // digging progress (on a .bar): data-b="dig"
  dig: (el) => {
    const d = G.S.dig, i = el.querySelector('i'), b = el.querySelector('b');
    if (i) i.style.width = (d ? Math.min(100, d.t / d.dur * 100) : 0) + '%';
    if (b) b.textContent = d ? G.fmtTime((d.dur - d.t) / G.digSpeed()) : '';
  },
  // farm day countdown: data-b="farmday"
  farmday: (el) => { el.textContent = G.fmtTime(G.farmDayLeft()); },
  xp: (el) => { const p = G.S.player, need = D.xpNeed(p.lv); el.querySelector('i').style.width = (p.xp / need * 100) + '%'; const b = el.querySelector('b'); if (b) b.textContent = `${G.fmtFull(p.xp)} / ${G.fmtFull(need)} XP`; },
  lv: (el) => { el.textContent = G.S.player.lv; },
  nest: (el) => { el.textContent = G.fmt(G.S.nest); },
  dur: (el, id) => { const m = G.S.machines.find((x) => x.id === +id); if (!m) return; el.querySelector('i').style.width = m.dur + '%'; const b = el.querySelector('b'); if (b) b.textContent = Math.round(m.dur) + '%'; el.classList.toggle('red', m.dur < 25); el.classList.toggle('green', m.dur >= 25); },
};
ui.refresh = () => {
  for (const el of $$('[data-b]')) { const s = el.dataset.b, i = s.indexOf(':'); const f = ui.binders[i < 0 ? s : s.slice(0, i)]; if (f) f(el, i < 0 ? '' : s.slice(i + 1)); }
  for (const el of $$('[data-need]')) el.classList.toggle('cant', !G.has(parseNeed(el.dataset.need)));
  for (const el of $$('.cost .c[data-cr]')) el.classList.toggle('no', G.S.res[el.dataset.cr] + 1e-9 < +el.dataset.cv);
  ui.navBadges();
  const v = ui.views[ui.cur];
  if (v && v.update) v.update();
};

// ---------- router ----------
ui.go = (name) => {
  if (!ui.views[name]) return;
  ui.cur = name;
  $$('.nav-btn').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
  const el = $('#view');
  el.scrollTop = 0;
  ui.renderView();
  G.sfx('click');
};
ui.renderView = () => {
  const el = $('#view'), top = el.scrollTop, v = ui.views[ui.cur];
  el.className = 'v-' + ui.cur;
  el.innerHTML = '';
  v.render(el);
  el.scrollTop = top;
  ui.refresh();
};
ui.render = ui.renderView;
// run a game action, toast errors, re-render
ui.run = (name, ...args) => {
  const r = G.act[name](...args);
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); }
  else { G.sfx('ok'); if (r.msg) ui.toast(r.msg, 'good'); }
  ui.render();
  return r;
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const name = el.dataset.a, args = el.dataset.args ? JSON.parse(el.dataset.args) : [];
  if (ui.handlers[name]) { e.preventDefault(); ui.handlers[name](el, e, ...args); }
  else if (G.act[name]) { e.preventDefault(); ui.run(name, ...args); }
});

// ---------- top bar & nav ----------
const NAV = [['mines', 'Mines'], ['factories', 'Factories'], ['crafting', 'Crafting'], ['chikns', 'Chikn NFT'], ['farm', 'Farm'], ['guild', 'Guild'],
  ['dex', 'DEX'], ['expeditions', 'Expeditions'], ['battle', 'Battle'], ['events', 'Events'], ['wiki', 'Wiki']];
ui.renderShell = () => {
  const pill = (r) => `<div class="pill cur"><img src="${G.img('res/' + r)}" alt=""><div><div class="lbl">${D.res[r].name}</div><div class="val" data-b="res:${r}"></div></div>
    <button class="plus" data-a="exchangeDlg" data-args='["${r}"]' aria-label="Get more ${D.res[r].name}">+</button></div>`;
  const strip = D.barRes.map((r) => `<div class="r" title="${D.res[r].name}"><img src="${G.img('res/' + r)}" alt=""><div><div class="lbl">${D.shortName[r] || D.res[r].name}</div><div class="val num" data-b="res:${r}"></div></div></div>`).join('');
  $('#topbar').innerHTML = `<img class="logo" src="${G.img('ui/logo')}" alt="Chikn Henium Mines" data-a="nav" data-args='["mines"]'>
    <div class="top-scroll">${pill('egg')}${pill('feed')}${pill('henium')}<div class="pill eth" data-a="nav" data-args='["dex"]' title="Simulated ETH — trade on the DEX"><img src="${G.img('res/eth')}" alt=""><div><div class="lbl">ETH</div><div class="val" data-b="res:eth"></div></div></div><button type="button" class="res-strip" data-a="inventory" title="Inventory: every ore and material you have" aria-label="Open inventory">${strip}<span class="res-more" aria-hidden="true">▾</span></button></div>
    <div class="top-icons"><button class="icon-btn" data-a="notes" aria-label="Notifications"><img src="${G.img('ui/bell')}" alt=""><span class="badge" id="note-badge" hidden></span></button>
    <button class="icon-btn" data-a="settings" aria-label="Settings"><img src="${G.img('ui/settings')}" alt=""></button></div>`;
  setTimeout(ui.speedChip, 0);
  $('#sidenav').innerHTML = NAV.map(([id, label]) => `<button class="nav-btn ${ui.cur === id ? 'on' : ''}" data-view="${id}" data-a="nav" data-args='["${id}"]'>
      <img src="${G.img(id === 'farm' ? 'farm/nest' : 'ui/' + id)}" alt=""><span>${label}</span><span class="badge" data-badge="${id}" hidden></span></button>`).join('') +
    `<div class="nav-player" data-a="profile"><img class="av" src="${G.img('chikn/miner')}" alt=""><div style="flex:1;min-width:0"><div class="row"><span class="lv" data-b="lv"></span><span class="muted" style="font-size:12px">Level</span></div>${ui.bar(0, 'gold', '', 'data-b="xp"')}</div></div>`;
};
// Inventory: every resource you hold, grouped like the production chain, with the live amount and the mining rate
ui.handlers.inventory = () => {
  const S = G.S, rates = G.rates(), cat = (c) => Object.keys(D.res).filter((r) => D.res[r].cat === c && r in S.res);
  const item = (r) => `<div class="inv-it" title="${esc(D.res[r].name)}">${ui.icon(r, 34)}<div><b data-b="res:${r}">${G.fmt(S.res[r])}</b><small>${esc(D.res[r].name)}</small>${rates[r] > 0 && r !== 'egg' ? `<i>+${G.fmt(rates[r] * 3600)}/h</i>` : ''}</div></div>`;
  const group = (title, list) => (list.length ? `<h3 class="inv-h">${title}</h3><div class="inv-grid">${list.map(item).join('')}</div>` : '');
  ui.modal({ title: 'Inventory', wide: true, html: group('Ores from the mines', cat('raw')) + group('Processed materials (Factories)', cat('mat'))
    + `<p class="dim" style="font-size:13px;margin:10px 0 0">Crushed Ore comes from the Ore Crusher; the Ore Separator and the Feed Mill use it. EGG, FEED and HENIUM are in the top bar.</p>`,
    actions: [{ label: 'Factories', cls: 'purple', fn: () => ui.go('factories') }, { label: 'Close', cls: 'green' }] });
};
ui.handlers.nav = (el, e, id) => { if (el.closest('#modal-root')) ui.closeModal(); ui.go(id); };
ui.navBadges = () => {
  const S = G.S, set = (id, n) => { const b = $(`[data-badge="${id}"]`); if (b) { b.hidden = !n; b.textContent = n > 9 ? '9+' : n; } };
  set('mines', G.questList().filter((q) => q.done).length);
  set('factories', D.factories.filter((f) => S.factories[f.id].lv === 0 && !S.factories[f.id].con && S.depth >= f.reqDepth && G.has(f.build)).length);
  set('crafting', S.machines.filter((m) => !m.zone).length);
  set('chikns', S.stats.hired === 0 ? 1 : 0);
  set('farm', (S.farm.hungry ? 1 : 0) + (S.nest >= Math.max(1, G.nestCap() * 0.9) ? 1 : 0));
  set('expeditions', S.exps.filter((e) => e.done).length);
  set('battle', S.battle.tickets >= D.pvpTickets && S.player.lv >= 3 ? 1 : 0);
  set('events', G.missions().filter((m) => m.done && !m.claimed).length + Array.from({ length: S.season.lv }, (_, i) => i + 1).filter((l) => !S.season.claimed.includes(l)).length);
  const nb = $('#note-badge'), unread = S.notes.filter((n) => !n.read).length;
  if (nb) { nb.hidden = !unread; nb.textContent = unread > 9 ? '9+' : unread; }
};

// ---------- toasts, floaters, sparks ----------
ui.toast = (text, kind = '', icon = null, life = 2.8) => {
  const box = $('#toasts');
  while (box.children.length > 3) box.firstChild.remove();
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.style.setProperty('--life', life + 's');
  t.innerHTML = (icon ? `<img src="${G.img(icon)}" alt="">` : '') + `<span>${esc(text)}</span>`;
  box.appendChild(t);
  setTimeout(() => t.remove(), (life + 0.5) * 1000);
};
ui.float = (html, x, y, color = '#fff') => {
  const f = document.createElement('div');
  f.className = 'float';
  f.style.left = x + 'px'; f.style.top = y + 'px'; f.style.color = color;
  f.innerHTML = html;
  $('#fx').appendChild(f);
  setTimeout(() => f.remove(), 1150);
};
ui.sparks = (x, y, color = '#ffd54a', n = 8) => {
  const fx = $('#fx');
  for (let i = 0; i < n; i++) {
    const s = document.createElement('div'), a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 45;
    s.className = 'spark';
    s.style.cssText = `left:${x}px;top:${y}px;background:${color};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 20}px`;
    fx.appendChild(s);
    setTimeout(() => s.remove(), 750);
  }
};
ui.centerOf = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

// ---------- modal ----------
let modalClose = null;
ui.modal = ({ title = '', html = '', wide = false, hero = '', actions = [{ label: 'OK', cls: 'green' }], onClose = null }) => {
  ui.closeModal();
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay"><div class="modal panel ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <button class="x" aria-label="Close">×</button>
    ${title ? `<div class="panel-h">${title}</div>` : ''}
    ${hero ? `<img class="hero" src="${G.img(hero)}" alt="">` : ''}
    <div class="mbody">${html}</div>
    ${actions.length ? `<div class="foot">${actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-mi="${i}" ${a.need ? `data-need="${ui.need(a.need)}"` : ''}>${a.label}</button>`).join('')}</div>` : ''}
  </div></div>`;
  const ov = root.firstElementChild;
  const close = () => { root.innerHTML = ''; modalClose = null; document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('.modal > .x')) return close();
    const b = e.target.closest('[data-mi]');
    if (b) { const a = actions[+b.dataset.mi]; const keep = a.fn ? a.fn(b) === false : false; if (!keep) close(); }
  });
  modalClose = close;
  ui.refresh();
  return close;
};
ui.closeModal = () => { if (modalClose) modalClose(); };
ui.modalOpen = () => !!$('#modal-root').firstElementChild;
// the current dialog's overlay; extra listeners go here so they die with the dialog (never on #modal-root)
ui.modalEl = () => $('#modal-root').firstElementChild;

// ---------- sounds ----------
let ac = null;
G.sfx = (name) => {
  if (!G.S || !G.S.settings.sound) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const notes = { click: [[660, 0.04]], tap: [[520, 0.05], [780, 0.05]], ok: [[700, 0.06], [940, 0.08]], err: [[220, 0.12]],
      coin: [[880, 0.05], [1320, 0.09]], up: [[523, 0.07], [659, 0.07], [784, 0.12]], level: [[523, 0.1], [659, 0.1], [784, 0.1], [1046, 0.22]],
      hire: [[392, 0.08], [523, 0.08], [659, 0.08], [880, 0.2]], boom: [[110, 0.25]], win: [[659, 0.1], [784, 0.1], [988, 0.25]], lose: [[392, 0.15], [262, 0.3]] }[name];
    if (!notes) return;
    let t = ac.currentTime;
    for (const [f, d] of notes) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = name === 'boom' || name === 'err' ? 'sawtooth' : 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d + 0.02);
      t += d * 0.85;
    }
  } catch (e) { /* audio unavailable */ }
};

// ---------- shared dialogs ----------
ui.handlers.exchangeDlg = (el, e, focus) => {
  const x = G.exRate(), row = (kind, label, give, get) => `<div class="list-row"><div class="sp"><div class="hx">${label}</div><div class="muted" style="font-size:13px">${give} → ${get}</div></div>
    ${[1, 10, 100].map((q) => `<button class="btn sm ${kind === 'e2h' ? 'purple' : 'green'}" data-x="${kind}" data-q="${q}">×${q}</button>`).join('')}</div>`;
  ui.modal({ title: `${ui.img('ui/dex', '', '')} Exchange`, actions: [{ label: 'Done', cls: 'gray' }],
    html: `<p class="muted" style="margin-top:0">EGG is laid by Chikns only, and no reward ever pays it. Burning EGG for FEED removes it for good, which keeps EGG scarce.</p>
      ${row('e2f', 'Burn EGG for FEED', `${ui.icon('egg', 18)} ${x.e2f}`, `${ui.icon('feed', 18)} 1`)}
      <div class="list-row"><div class="sp"><div class="hx">Trade EGG, HENIUM, ores and ETH</div><div class="muted" style="font-size:13px">Swap anything for anything on the DEX</div></div><button class="btn sm purple" data-a="nav" data-args='["dex"]'>Open DEX</button></div>
      <p class="dim" style="font-size:12px;margin-bottom:0">${focus === 'henium' ? 'HENIUM is earned by refining Henium Ore, guild wars and monster hunts: every HENIUM comes out of the world\'s fixed daily emission.' : focus === 'feed' ? 'FEED is scarce: grind your daily quota in the Feed Mill, or burn EGG for it.' : 'Every Chikn lays about 1 EGG a day; heavier Chikns lay more. Collect them on the Farm.'}</p>` });
  ui.modalEl().addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-x]');
    if (!b) return;
    const r = G.act.exchange(b.dataset.x, +b.dataset.q);
    if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); } else { G.sfx('coin'); ui.refresh(); }
  });
};
ui.handlers.notes = () => {
  const S = G.S;
  S.notes.forEach((n) => (n.read = true));
  ui.modal({ title: `${ui.img('ui/bell', '', '')} Notifications`, actions: [{ label: 'Close', cls: 'gray' }],
    html: S.notes.length ? S.notes.slice(0, 25).map((n) => `<div class="list-row">${n.icon ? ui.img(n.icon, 'ic', '').replace('class="ic"', 'class="ic" width="28" height="28"') : ''}<div class="sp">${esc(n.text)}</div><span class="dim" style="font-size:12px">${G.fmtTime((now() - n.t) / 1000)} ago</span></div>`).join('') : '<div class="empty">No notifications yet.</div>' });
  ui.navBadges();
};
const SPEEDS = [1, 10, 60, 600, 3600];
const SKIPS = [[3600, '1 h'], [8 * 3600, '8 h'], [86400, '1 day'], [7 * 86400, '7 days']];
// a chip in the top bar while the game runs faster than real time (click: settings)
ui.speedChip = () => {
  const bar = $('#topbar .top-icons'), k = G.speed();
  if (!bar) return;
  let chip = bar.querySelector('.speed-chip');
  if (k <= 1) { if (chip) chip.remove(); return; }
  if (!chip) { chip = document.createElement('button'); chip.type = 'button'; chip.className = 'speed-chip'; chip.dataset.a = 'settings'; bar.prepend(chip); }
  chip.textContent = `⏩ ×${G.fmtFull(k)}`; chip.title = `Test speed: the game runs ${G.fmtFull(k)}× faster than real time. Click to change.`;
};
ui.handlers.settings = () => {
  const S = G.S;
  ui.modal({ title: `${ui.img('ui/settings', '', '')} Settings`, actions: [{ label: 'Close', cls: 'gray' }],
    html: `<div class="list-row"><div class="sp">Sound effects</div><button class="btn sm ${S.settings.sound ? 'green' : 'gray'}" data-set="sound">${S.settings.sound ? 'On' : 'Off'}</button></div>
      <div class="set-test"><div class="hx">Test speed</div><div class="muted" style="font-size:13px">The game runs in real time (a day is 24 hours). For testing, make time run faster: at ×60 one real minute is one game hour. Hazards pause above ×10, because you couldn't react to them.</div>
        <div class="tabs set-speeds">${SPEEDS.map((k) => `<button type="button" class="tab ${G.speed() === k ? 'on' : ''}" data-speed="${k}">×${G.fmtFull(k)}</button>`).join('')}</div>
        <div class="hx" style="margin-top:8px;font-size:15px">Skip ahead</div><div class="muted" style="font-size:13px">Jump forward as if you played the whole time (floors mine all along).</div>
        <div class="set-skips">${SKIPS.map(([sec, l]) => `<button type="button" class="btn sm purple" data-skip="${sec}">+${l}</button>`).join('')}</div></div>
      <div class="list-row"><div class="sp"><div class="hx">Start a new game</div><div class="muted" style="font-size:13px">Month 1: The Beginning — a small mine at depth 1.</div></div><button class="btn sm red" data-set="fresh">New Game</button></div>
      <div class="list-row"><div class="sp"><div class="hx">Showcase save</div><div class="muted" style="font-size:13px">Jump to the mockup: Lv. 27, depth 27, Heavy Drill on the Henium Vein.</div></div><button class="btn sm purple" data-set="showcase">Load</button></div>
      <p class="dim" style="font-size:12px;margin-bottom:0">Progress saves automatically in this browser. Prototype build: tokens, NFTs and other players are simulated.</p>` });
  ui.modalEl().addEventListener('click', (ev) => {
    const sp = ev.target.closest('[data-speed]'), sk = ev.target.closest('[data-skip]');
    if (sp) {
      S.settings.speed = +sp.dataset.speed; G.save();
      ui.modalEl().querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', x === sp));
      ui.speedChip(); ui.toast(S.settings.speed > 1 ? `Test speed ×${G.fmtFull(S.settings.speed)}: one real minute is ${G.fmtTime(60 * S.settings.speed)} of game time` : 'Real time again', '', 'ui/timer');
      return;
    }
    if (sk) {
      const r = G.warp(+sk.dataset.skip); G.save(); ui.closeModal(); ui.render();
      const rows = Object.entries(r.gains).sort((a, b) => b[1] - a[1]).slice(0, 8);
      ui.modal({ title: `${ui.img('ui/timer', '', '')} Skipped ${G.fmtTime(r.sec)}`, actions: [{ label: 'OK', cls: 'green' }],
        html: `<p style="text-align:center;margin-top:0">Your mine, factories, farm and rentals ran for <b>${G.fmtTime(r.sec)}</b>.</p><div style="display:flex;justify-content:center">${ui.rew(Object.fromEntries(rows), 24)}</div>` });
      return;
    }
    const b = ev.target.closest('[data-set]');
    if (!b) return;
    const k = b.dataset.set;
    if (k === 'sound') { S.settings.sound = !S.settings.sound; b.textContent = S.settings.sound ? 'On' : 'Off'; b.className = `btn sm ${S.settings.sound ? 'green' : 'gray'}`; return; }
    if (k === 'fresh' || k === 'showcase') {
      if (!confirm(k === 'fresh' ? 'Start over from depth 1? Your current progress will be replaced.' : 'Load the showcase save? Your current progress will be replaced.')) return;
      G.start(G.newState(k)); ui.closeModal(); ui.toast(k === 'fresh' ? 'New mine founded. Good luck, MineMaster!' : 'Showcase save loaded', 'good');
    }
  });
};
ui.handlers.profile = () => {
  const S = G.S, spec = D.specs.find((s) => s.id === S.spec);
  ui.modal({ title: `${ui.img('ui/chikns', '', '')} ${esc(S.player.name)} · Lv. ${S.player.lv}`, actions: [{ label: 'Close', cls: 'gray' }],
    html: `${ui.bar(S.player.xp / D.xpNeed(S.player.lv) * 100, 'gold lg', `${G.fmtFull(S.player.xp)} / ${G.fmtFull(D.xpNeed(S.player.lv))} XP`)}
      <div class="list-row" style="margin-top:10px"><div class="sp">Specialization</div><b>${spec ? spec.name : S.player.lv >= D.rules.specLv ? '<button class="btn sm gold" data-a="spec">Choose</button>' : `Unlocks at Lv. ${D.rules.specLv}`}</b></div>
      <div class="list-row"><div class="sp">Ore mined</div><b class="num">${G.fmt(S.stats.mined)}</b></div>
      <div class="list-row"><div class="sp">Ore processed</div><b class="num">${G.fmt(S.stats.processed)}</b></div>
      <div class="list-row"><div class="sp">HENIUM refined</div><b class="num">${G.fmt(S.stats.refined, 2)}</b></div>
      <div class="list-row"><div class="sp">EGG burned</div><b class="num">${G.fmt(S.stats.eggBurned)}</b></div>
      <div class="list-row"><div class="sp">Battles won</div><b class="num">${S.stats.wins}</b></div>` });
};
ui.handlers.spec = () => {
  ui.modal({ title: 'Choose your specialization', wide: true, actions: [],
    html: `<p class="muted" style="margin-top:0">Play your way. This choice is permanent for this mine.</p><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${D.specs.map((s) =>
      `<div class="card"><div class="hx" style="font-size:20px">${s.name}</div><p class="muted" style="font-size:14px;min-height:40px">${s.desc}</p><button class="btn green block" data-spec="${s.id}">Choose ${s.name}</button></div>`).join('')}</div>` });
  ui.modalEl().addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-spec]');
    if (!b) return;
    const r = G.act.chooseSpec(b.dataset.spec);
    ui.closeModal();
    if (r.ok) { G.sfx('level'); ui.toast(`You are now a ${D.specs.find((s) => s.id === b.dataset.spec).name}!`, 'good', 'ui/trophy'); ui.render(); } else ui.toast(r.msg, 'bad');
  });
};
})();
