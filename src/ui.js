// Core Hopper — the interface: top bar, goal card, tabs (Build, Workshop, Rocket, Storage, Log), the building sheet,
// story dialogs, toasts, settings, the away summary and the star map after a launch.
(() => {
const CH = window.CH, D = CH.D, R = CH.R;
const U = (CH.U = { tab: 'build' });
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = { drill: '⛏️', dock: '📥', furnace: '🔥', press: '🔨', feeder: '📤', assembler: '⚙️', refinery: '⛽' };
const icon = (t, px) => CH.itemIcon(t, px);
const cost = (c, k = 1) => Object.entries(c).map(([t, n]) => `<span class="c ${(CH.S.inv[t] || 0) >= n * k ? '' : 'no'}" data-need="${t}:${n * k}">${icon(t, 18)}${D.fmt(n * k)}</span>`).join('');

// ---------- sound ----------
let ac = null, heard = false;
['pointerdown', 'keydown'].forEach((e) => window.addEventListener(e, () => { heard = true; }, { once: true, capture: true }));
U.sfx = (k) => {
  if (!heard || !CH.S.settings.sound) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const notes = { tap: [[420, 0.04]], place: [[520, 0.06], [780, 0.08]], craft: [[660, 0.05], [880, 0.07]], goal: [[523, 0.08], [659, 0.08], [784, 0.14]], err: [[200, 0.12]],
      layer: [[392, 0.1], [523, 0.1], [659, 0.18]], launch: [[220, 0.2], [330, 0.2], [440, 0.3], [660, 0.4]], comet: [[880, 0.06], [1175, 0.1]] }[k] || [[600, 0.05]];
    let at = ac.currentTime;
    for (const [f, d] of notes) { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0.07, at); g.gain.exponentialRampToValueAtTime(0.0008, at + d); o.connect(g).connect(ac.destination); o.start(at); o.stop(at + d + 0.02); at += d * 0.8; }
  } catch (e) { /* no audio */ }
};

// ---------- shell ----------
U.init = () => {
  $('#hud').innerHTML = `<div class="hud-planet"><b data-b="pname"></b><small data-b="layer"></small></div>
    <div class="hud-depth"><div class="bar"><i data-b="depthbar"></i></div><small data-b="depth"></small></div>
    <button class="hud-cores" data-a="starmap" title="Star Cores">★ <b data-b="cores"></b></button>
    <button class="hud-gear" data-a="settings" aria-label="Settings">⚙</button>`;
  $('#tabs').innerHTML = [['build', '🏗️', 'Build'], ['craft', '⚒️', 'Workshop'], ['rocket', '🚀', 'Rocket'], ['items', '📦', 'Storage'], ['log', '📜', 'Log']]
    .map(([k, i, l]) => `<button data-tab="${k}"><span>${i}</span>${l}<i class="dot" data-dot="${k}"></i></button>`).join('');
  document.addEventListener('click', (e) => {
    const tb = e.target.closest('[data-tab]');
    if (tb) { U.tab = tb.dataset.tab; R.placing = null; U.sfx('tap'); U.panel(); return; }
    const el = e.target.closest('[data-a]');
    if (el && !el.disabled && U.h[el.dataset.a]) { e.preventDefault(); U.h[el.dataset.a](el, ...(el.dataset.args ? JSON.parse(el.dataset.args) : [])); }
  });
  U.panel();
};

// ---------- live values ----------
const B = {
  pname: () => CH.P().name, layer: () => (CH.coreOpen() ? 'Core open!' : CH.P().layers[CH.layer()].name),
  depth: () => `Depth ${D.fmt(Math.min(CH.S.dug, CH.P().core))} / ${D.fmt(CH.P().core)}`,
  cores: () => String(CH.S.cores),
  inv: (t) => D.fmt(CH.S.inv[t] || 0), rate: (t) => { const r = CH.perMin(t); return r >= 0.05 ? `+${r >= 10 ? Math.round(r) : r.toFixed(1)}/min` : ''; },
  kits: (t) => String(CH.S.kits[t] || 0),
  goalp: () => { const g = CH.goal(); return g ? `${D.fmt(Math.min(g.n, g.p(CH.S)))} / ${D.fmt(g.n)}` : ''; },
  comet: () => (CH.S.comet ? 'A comet is passing! Tap it.' : `Next comet in ~${D.time((CH.S.cometNext - CH.now()) / 1000)}`),
};
U.refresh = () => {
  const S = CH.S, P = CH.P();
  document.querySelectorAll('[data-b]').forEach((el) => { const [k, a] = el.dataset.b.split(':'); if (B[k]) { const v = B[k](a); if (el.textContent !== v) el.textContent = v; } });
  const db = $('[data-b="depthbar"]'); if (db) db.style.width = Math.min(100, S.dug / P.core * 100) + '%';
  const gb = $('#goal .bar i'), g = CH.goal(); if (gb && g) gb.style.width = Math.min(100, g.p(S) / g.n * 100) + '%';
  document.querySelectorAll('[data-need]').forEach((el) => { const [t, n] = el.dataset.need.split(':'); el.classList.toggle('no', (S.inv[t] || 0) < +n); });
  document.querySelectorAll('[data-cost]').forEach((el) => { el.classList.toggle('cant', !CH.has(JSON.parse(el.dataset.cost), +(el.dataset.k || 1))); });
  // dots on tabs: something to do there
  const dots = { craft: D.buildOrder.some((t) => CH.has(D.buildings[t].kit) && unlocked(t)), rocket: CH.coreOpen() && CH.rocketDone() && !S.launched,
    build: Object.values(S.kits).some((n) => n > 0) && S.slots.some((s) => !s) };
  document.querySelectorAll('[data-dot]').forEach((el) => { el.hidden = !dots[el.dataset.dot]; });
  if (sigOf() !== U.sig) U.panel();
  goalCard();
};
const unlocked = (t) => { const S = CH.S; if (S.planet > 0) return true; const g = S.goal; return { drill: 0, dock: 0, furnace: 3, press: 7, feeder: 8, assembler: 8, refinery: 10 }[t] <= g; };
const sigOf = () => { const S = CH.S; return [U.tab, S.planet, S.goal, CH.layer(), CH.coreOpen(), S.launched, JSON.stringify(S.kits), S.slots.map((s) => (s ? s.t + s.lv : '-')).join(''), S.logs.length, Object.keys(S.inv).length, R.placing].join('|'); };

// ---------- goal card ----------
let lastGoal = -1;
function goalCard() {
  const S = CH.S, g = CH.goal(), el = $('#goal');
  if (S.goal === lastGoal && el.dataset.p === String(S.planet)) return;
  lastGoal = S.goal; el.dataset.p = S.planet;
  el.innerHTML = g ? `<div class="g-k">GOAL ${S.goal + 1}</div><div class="g-t">${esc(g.text)}</div><div class="bar"><i></i></div><small data-b="goalp"></small>
    <details><summary>Hint</summary>${esc(g.hint)}</details>` : '<div class="g-t">All goals done on this world.</div>';
}

// ---------- tabs ----------
U.panel = () => {
  const S = CH.S, el = $('#panel');
  U.sig = sigOf();
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === U.tab));
  if (U.tab === 'build') {
    const kits = D.buildOrder.filter((t) => (S.kits[t] || 0) > 0);
    el.innerHTML = `<p class="hint">${R.placing ? `Tap a glowing slot on the ring to place the <b>${D.buildings[R.placing].name}</b>.` : 'Pick a building, then tap an empty slot on the ring. Tap a building to see it, switch what it makes or upgrade it.'}</p>
      <div class="kits">${kits.map((t) => `<button class="kit ${R.placing === t ? 'on' : ''}" data-a="pick" data-args='["${t}"]'><span class="ki">${ICON[t]}</span><b>${D.buildings[t].name}</b><small>×<span data-b="kits:${t}"></span></small></button>`).join('') || '<div class="empty">No kits. Craft buildings in the Workshop.</div>'}</div>
      <div class="flow"><b>How it flows:</b> the belt runs clockwise. Each building takes what it needs as items pass, and puts its products on the belt. A Dock stores everything that reaches it.</div>`;
  } else if (U.tab === 'craft') {
    el.innerHTML = `<div class="list">${D.buildOrder.filter(unlocked).map((t) => { const b = D.buildings[t];
      return `<div class="row"><span class="ki">${ICON[t]}</span><div class="sp"><b>${b.name}</b> <small class="dim">you have ${S.kits[t] || 0}</small><div class="desc">${esc(b.desc)}</div>
        ${b.recipes ? `<div class="recs">${b.recipes.map((r) => `<span>${Object.entries(r.in).map(([k, n]) => `${n}${icon(k, 16)}`).join(' + ')} → ${Object.entries(r.out).map(([k, n]) => `${n}${icon(k, 16)}`).join(' ')}</span>`).join('')}</div>` : ''}
        <div class="cost">${cost(b.kit)}</div></div>
        <div class="btns"><button class="btn" data-a="craft" data-args='["${t}",1]' data-cost='${JSON.stringify(b.kit)}'>Craft</button><button class="btn sm" data-a="craft" data-args='["${t}",5]' data-cost='${JSON.stringify(b.kit)}' data-k="5">×5</button></div></div>`; }).join('')}</div>
      ${D.buildOrder.some((t) => !unlocked(t)) ? '<p class="hint">More buildings unlock as you follow the goals.</p>' : ''}`;
  } else if (U.tab === 'rocket') {
    const P = CH.P();
    el.innerHTML = `<div class="list">${P.rocket.map((part) => { const have = S.rocket[part.id] || {};
      return `<div class="row"><span class="ki">🚀</span><div class="sp"><b>${part.name}</b><div class="cost">${Object.entries(part.need).map(([t, n]) => `<span class="c ${(have[t] || 0) >= n ? 'done' : ''}">${icon(t, 18)}${D.fmt(have[t] || 0)}/${D.fmt(n)}</span>`).join('')}</div></div>
        <button class="btn" data-a="deliver" data-args='["${part.id}"]'>Deliver</button></div>`; }).join('')}</div>
      <div class="launch"><div>${CH.coreOpen() ? '✅ The core is open.' : `⛏️ Dig down to the core: <b data-b="depth"></b>`}<br>${CH.rocketDone() ? '✅ The rocket is ready.' : `🚀 Rocket <b>${CH.rocketPct()}%</b> built.`}</div>
        <button class="btn big ${CH.coreOpen() && CH.rocketDone() && !S.launched ? '' : 'cant'}" data-a="launch">Launch!</button></div>`;
  } else if (U.tab === 'items') {
    const have = D.itemOrder.filter((t) => (S.inv[t] || 0) > 0 || (S.got[t] || 0) > 0);
    el.innerHTML = `<div class="grid">${have.map((t) => `<div class="it">${icon(t, 30)}<div><b data-b="inv:${t}"></b><small>${D.items[t].name}</small><i data-b="rate:${t}"></i></div></div>`).join('') || '<div class="empty">Nothing yet. Put a Dock on the ring.</div>'}</div>
      <p class="hint" data-b="comet"></p>`;
  } else if (U.tab === 'log') {
    const logs = [];
    for (const k of [0, 1, 'more']) (D.story[k] || []).forEach((b) => { if (b.log && S.logs.includes(b.log)) logs.push(b); });
    el.innerHTML = `<div class="logs">${logs.map((b) => `<div class="log"><b>Log ${b.log}</b>${b.lines.map(([w, x]) => `<p><i style="color:${D.who[w].color}">${D.who[w].name}:</i> ${esc(x)}</p>`).join('')}</div>`).join('') || '<div class="empty">No logs found yet. Keep digging.</div>'}</div>
      <p class="hint">Worlds finished: ${S.stats.launches} · Star Cores collected: ${S.cores + D.ups.filter((u) => S.up[u.id]).reduce((a, u) => a + u.cost, 0)}</p>`;
  }
  U.refresh();
};

// ---------- the sheet (bottom modal) ----------
U.sheet = (html, onClose) => {
  const el = $('#sheet');
  el.innerHTML = `<div class="sheet-bg" data-a="close"></div><div class="sheet">${html}</div>`;
  el.hidden = false; U.onClose = onClose; U.refresh();
};
U.close = () => { const el = $('#sheet'); el.hidden = true; el.innerHTML = ''; R.sel = -1; if (U.onClose) { const f = U.onClose; U.onClose = null; f(); } };
function slotSheet(i) {
  const S = CH.S, s = S.slots[i];
  R.sel = i;
  if (!s) {
    const kits = D.buildOrder.filter((t) => (S.kits[t] || 0) > 0);
    return U.sheet(`<h3>Empty slot</h3>${kits.length ? `<p class="hint">Place a building here:</p><div class="kits">${kits.map((t) => `<button class="kit" data-a="placeHere" data-args='[${i},"${t}"]'><span class="ki">${ICON[t]}</span><b>${D.buildings[t].name}</b><small>×${S.kits[t]}</small></button>`).join('')}</div>`
      : '<p class="hint">You have no building kits. Craft them in the Workshop.</p><button class="btn" data-a="tab" data-args=\'["craft"]\'>Open Workshop</button>'}`);
  }
  const b = D.buildings[s.t], up = D.upCost(s.t, s.lv), st = { work: 'Working', idle: s.t === 'dock' ? 'Waiting for items' : 'Waiting for inputs', full: 'Blocked: the belt is full here' }[s.st];
  const spd = CH.bSpeed(s);
  let body = '';
  if (s.t === 'drill') {
    body = `<p class="hint">Mines <b>${(60 / (b.t / spd)).toFixed(0)}</b> ore a minute. Every piece digs the planet deeper.</p><div class="ores">${CH.ores().map((o) => `<button class="chip ${s.ore === o ? 'on' : ''}" data-a="ore" data-args='[${i},"${o}"]'>${icon(o, 20)}${D.items[o].name}</button>`).join('')}</div>`;
  } else if (s.t === 'feeder') {
    const have = D.itemOrder.filter((t) => (S.inv[t] || 0) > 0 || s.feed === t);
    body = `<p class="hint">Puts <b>${(60 / (b.t / spd)).toFixed(0)}</b> items a minute from your storage back on the belt.</p><div class="ores">${have.map((t) => `<button class="chip ${s.feed === t ? 'on' : ''}" data-a="feed" data-args='[${i},"${t}"]'>${icon(t, 20)}${D.items[t].name} <small>${D.fmt(S.inv[t] || 0)}</small></button>`).join('') || '<span class="dim">Your storage is empty.</span>'}</div>`;
  } else if (s.t === 'dock') {
    body = `<p class="hint">Takes up to <b>${Math.round(D.dockSpeed(s.lv) * 60)}</b> items a minute off the belt into your storage.</p>
      <div class="ores"><button class="chip ${s.mode !== 'parts' ? 'on' : ''}" data-a="mode" data-args='[${i},"all"]'>Keep everything</button><button class="chip ${s.mode === 'parts' ? 'on' : ''}" data-a="mode" data-args='[${i},"parts"]'>Parts only</button></div>
      <p class="hint">${s.mode === 'parts' ? 'Ore rides on to your machines. Ore that went all the way around without being used is kept, so the belt never jams.' : 'Everything that reaches it goes into storage, ore too.'}</p>`;
  } else {
    const rec = (r) => `${Object.entries(r.in).map(([t, n]) => `${n}${icon(t, 18)}`).join(' + ')} → ${Object.entries(r.out).map(([t, n]) => `${n}${icon(t, 18)}`).join(' ')} <small>${(r.t / spd).toFixed(1)}s</small>`;
    body = `${b.recipes.length > 1 ? `<p class="hint">What should it make?</p><div class="ores"><button class="chip ${s.rec < 0 ? 'on' : ''}" data-a="rec" data-args='[${i},-1]'>Everything</button>${b.recipes.map((r, k) => `<button class="chip ${s.rec === k ? 'on' : ''}" data-a="rec" data-args='[${i},${k}]'>${rec(r)}</button>`).join('')}</div>`
      : `<div class="recs"><span class="on">${rec(b.recipes[0])}</span></div>`}
      <p class="hint">Holding: ${Object.entries(s.buf).filter(([, n]) => n > 0).map(([t, n]) => `${n}${icon(t, 16)}`).join(' ') || 'nothing'}${s.out.length ? ` · ready to ship: ${s.out.length}` : ''}</p>`;
  }
  U.sheet(`<h3>${ICON[s.t]} ${b.name} <small>Lv. ${s.lv}</small></h3><p class="st st-${s.st}">● ${st}</p><p class="desc">${esc(b.desc)}</p>${body}
    <div class="sheet-acts">${up ? `<button class="btn" data-a="upgrade" data-args='[${i}]' data-cost='${JSON.stringify(up)}'>Upgrade to Lv. ${s.lv + 1} (×${D.speed(s.lv + 1).toFixed(1)} speed)<span class="cost">${cost(up)}</span></button>` : '<span class="dim">★ Max level</span>'}
    <button class="btn ghost" data-a="pickup" data-args='[${i}]'>Pick up${s.lv > 1 ? ' (levels are lost)' : ''}</button></div>`);
}

// ---------- dialogs: story ----------
U.dialog = () => {
  const el = $('#dialog');
  if (!el.hidden || !CH.queue.length || !$('#sheet').hidden) return;
  const b = CH.queue.shift();
  let k = 0;
  const show = () => {
    const [w, txt] = b.lines[k];
    el.innerHTML = `<div class="dlg"><div class="face face-${w}"></div><div class="sp"><b style="color:${D.who[w].color}">${D.who[w].name}</b><p>${esc(txt)}</p></div><button class="btn" data-a="next">${k < b.lines.length - 1 ? 'Next' : 'OK'}</button></div>`;
  };
  U.h.next = () => { k += 1; if (k < b.lines.length) show(); else { el.hidden = true; el.innerHTML = ''; U.dialog(); } };
  el.hidden = false; show();
};

// ---------- toasts & floats ----------
U.toast = (txt, kind = '') => {
  const box = $('#toasts'), d = document.createElement('div');
  d.className = 'toast ' + kind; d.textContent = txt; box.appendChild(d);
  while (box.children.length > 2) box.firstChild.remove();
  setTimeout(() => d.remove(), 2800);
};
const res = (r, okMsg, sfx = 'place') => { if (!r.ok) { U.toast(r.msg, 'bad'); U.sfx('err'); return false; } if (okMsg) U.toast(okMsg, 'good'); U.sfx(sfx); return true; };

// ---------- handlers ----------
U.h = {
  close: () => U.close(),
  tab: (el, k) => { U.close(); U.tab = k; U.panel(); },
  pick: (el, t) => { R.placing = R.placing === t ? null : t; U.sfx('tap'); U.panel(); },
  placeHere: (el, i, t) => { if (res(CH.act.place(i, t), `${D.buildings[t].name} placed`)) { U.close(); U.panel(); } },
  craft: (el, t, n) => { if (res(CH.act.craft(t, n), `Crafted ${n} × ${D.buildings[t].name}`, 'craft')) U.panel(); },
  ore: (el, i, o) => { if (res(CH.act.setOre(i, o))) slotSheet(i); },
  mode: (el, i, m) => { if (res(CH.act.setMode(i, m))) slotSheet(i); },
  feed: (el, i, t) => { if (res(CH.act.setFeed(i, t))) slotSheet(i); },
  rec: (el, i, k) => { if (res(CH.act.setRecipe(i, k))) slotSheet(i); },
  upgrade: (el, i) => { const r = CH.act.upgrade(i); if (res(r, `Upgraded to Lv. ${r.lv}`, 'craft')) slotSheet(i); },
  pickup: (el, i) => { if (res(CH.act.pickup(i), 'Picked up: the kit is back in Build')) { U.close(); U.panel(); } },
  deliver: (el, id) => { const r = CH.act.deliver(id); if (res(r, `Delivered ${r.moved} parts`, 'craft')) U.panel(); },
  launch: () => {
    const r = CH.act.launch();
    if (!res(r, null, 'launch')) return;
    R.launchT = R.time(); R.shake = 12;
    setTimeout(() => U.h.starmap(null, true), 2600);
  },
  starmap: (el, launched) => {
    const S = CH.S, next = D.planet(S.planet + 1);
    U.sheet(`<h3>★ Star Map</h3>${launched ? `<p class="big">You brought the Star Core of <b>${esc(CH.P().name)}</b> home. A star shines again.</p>` : ''}
      <p class="hint">Star Cores: <b>${S.cores}</b>. Spend them on upgrades that last for every world.</p>
      <div class="list">${D.ups.map((u) => `<div class="row"><span class="ki">✦</span><div class="sp"><b>${u.name}</b><div class="desc">${esc(u.desc)}</div></div>
        ${S.up[u.id] ? '<span class="dim">Owned</span>' : `<button class="btn ${S.cores >= u.cost ? '' : 'cant'}" data-a="buy" data-args='["${u.id}"]'>★ ${u.cost}</button>`}</div>`).join('')}</div>
      ${S.launched ? `<button class="btn big" data-a="travel">Fly to ${esc(next.name)} →</button>` : ''}`);
  },
  buy: (el, id) => { if (res(CH.act.buy(id), 'Upgrade bought', 'goal')) U.h.starmap(); },
  travel: () => { if (res(CH.act.travel(), null, 'layer')) { R.launchT = 0; U.close(); U.tab = 'build'; U.panel(); lastGoal = -1; U.toast(`Welcome to ${CH.P().name}`, 'good'); U.dialog(); } },
  settings: () => {
    const S = CH.S;
    U.sheet(`<h3>⚙ Settings</h3><div class="row"><div class="sp">Sound</div><button class="btn sm" data-a="sound">${S.settings.sound ? 'On' : 'Off'}</button></div>
      <div class="row"><div class="sp">Test speed <div class="desc">For testing: time runs faster.</div></div>${[1, 5, 20].map((k) => `<button class="btn sm ${S.settings.speed === k ? '' : 'ghost'}" data-a="speed" data-args="[${k}]">×${k}</button>`).join('')}</div>
      <div class="row"><div class="sp">Start over <div class="desc">Deletes your progress.</div></div><button class="btn sm ghost" data-a="reset">New game</button></div>`);
  },
  sound: () => { CH.S.settings.sound = !CH.S.settings.sound; U.h.settings(); },
  speed: (el, k) => { CH.S.settings.speed = k; U.h.settings(); },
  reset: () => { if (!confirm('Start a new game? Your progress will be deleted.')) return; CH.wipe(); location.reload(); },
};
U.slotSheet = slotSheet;

// ---------- taps on the planet ----------
U.tapCanvas = (x, y) => {
  const S = CH.S, h = R.hit(x, y);
  if (!h) return;
  if (h.k === 'comet') { const r = CH.act.comet(); if (res(r, `Comet caught: +${r.n} ${D.items[r.t].name}`, 'comet')) R.float(x, y, `+${r.n}`, '#9ff3ff', r.t, 18); return; }
  if (h.k === 'rocket') { U.tab = 'rocket'; U.panel(); U.sfx('tap'); return; }
  if (h.k === 'planet') { CH.act.tap(); R.tapT = R.time(); R.float(x, y - 10, '+1', '#fff', 'stone'); U.sfx('tap'); return; }
  if (h.k === 'slot') {
    if (R.placing && !S.slots[h.i]) {
      const t = R.placing;
      if (res(CH.act.place(h.i, t), null)) { const [px, py] = R.slotXY(h.i); R.float(px, py, D.buildings[t].name, '#9dffb0'); if (!(S.kits[t] > 0)) R.placing = null; U.panel(); }
      return;
    }
    U.sfx('tap'); slotSheet(h.i);
  }
};

// ---------- the away summary ----------
U.away = (r) => {
  if (!r) return;
  const rows = Object.entries(r.got).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<span class="c">${icon(t, 20)}+${D.fmt(n)}</span>`).join('');
  U.sheet(`<h3>Welcome back!</h3><p class="big">Your factory worked for <b>${D.time(r.run)}</b>${r.sec > r.run + 60 ? ` (it stops after ${D.time(CH.awayCap())} away; you were gone ${D.time(r.sec)})` : ''}.</p>
    ${rows ? `<div class="cost">${rows}</div>` : '<p class="hint">Nothing reached a Dock. Check your belt.</p>'}
    <p class="hint">${r.dug > 0 ? `Dug <b>${D.fmt(r.dug)}</b> deeper` : 'Your drills are already at the core'}${r.layer ? `, down into the <b>${esc(r.layer.name)}</b>` : ''}${r.core ? '. <b>The core is open!</b>' : ''}.${r.goals ? ` ${r.goals} goal${r.goals > 1 ? 's' : ''} done.` : ''}</p>
    <button class="btn big" data-a="close">Collect</button>`, () => U.dialog());
};

// ---------- reactions to the world ----------
CH.on('goal', (g) => { U.sfx('goal'); U.toast(`Goal done: ${g.text}${g.rew ? ` · reward ${g.rew.kit ? '1 ' + D.buildings[g.rew.kit].name + ' kit' : Object.entries(g.rew).map(([t, n]) => `${n} ${D.items[t].name}`).join(', ')}` : ''}`, 'good'); lastGoal = -1; });
CH.on('layer', (l) => { U.sfx('layer'); U.toast(`You broke into the ${l.name}! New ore: ${l.ores.map((o) => D.items[o].name).join(', ')}`, 'good'); R.shake = 6; });
CH.on('core', () => { U.sfx('launch'); U.toast('The core is open!', 'good'); R.shake = 10; });
CH.on('comet', () => U.toast('A comet is passing! Tap it for loot.', 'good'));
let agg = {};
CH.on('collect', (t, i) => { agg[i] = agg[i] || {}; agg[i][t] = (agg[i][t] || 0) + 1; });
setInterval(() => { if (document.hidden) { agg = {}; return; } for (const i in agg) { const e = Object.entries(agg[i]).sort((a, b) => b[1] - a[1])[0]; const [x, y] = R.slotXY(+i, 1.3); R.float(x, y, `+${e[1]}`, '#9fe0ff', e[0], 13); } agg = {}; }, 900);
})();
