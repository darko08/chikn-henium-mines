// Events screen: Season 1 pass + reward track, daily missions, live events & hazards, and the 6-month journey.
(() => {
const G = window.G, D = G.D, ui = G.ui, esc = ui.esc;
const now = () => Date.now();

const MIS_IC = { mined: 'ui/mines', processed: 'ui/factories', crafted: 'ui/crafting', wins: 'ui/battle', exps: 'ui/expeditions', upgrades: 'ui/energy', taps: 'res/stone' };
const EV_IC = { vein: 'res/heniumOre', comp: 'ui/trophy', collapse: 'prop/rubble', rush: 'res/copper', feast: 'res/feed', stoneday: 'res/stone' };
const EV_GO = { vein: ['expeditions', 'Join Expedition'], feast: ['chikns', 'Feed Chikns'] };
const HZ = {
  collapse: ['Cave-in!', 'Production on this floor stopped. Clear the rubble to restart it.'],
  richvein: ['Rich vein!', 'Tap the glowing floor fast for ×10 ore.'],
  supply: ['Supply drop!', 'A crate of ore and FEED landed. Open it before it is gone.'],
  creature: ['Creature sighted!', 'Send your squad to fight it for loot.'],
  bandits: ['Bandit raid!', 'Defend the floor or pay the toll, or they steal ore.'],
};
// 6-month journey art: [background, sprite, goal icon, colour]
const MONTH = [
  ['bg/surface', 'prop/headframe', 'ui/mines', '#3d8cff'],
  ['bg/surface', 'factory/smelter', 'ui/settings', '#25b4dc'],
  ['bg/floor-copper', 'machine/heavy', 'ui/crafting', '#3ccf4e'],
  ['bg/map', 'prop/flag', 'prop/flag', '#ffc21a'],
  ['bg/floor-henium', 'res/henium', 'res/henium', '#ff7a1f'],
  ['bg/hall', 'prop/hq', 'ui/trophy', '#d35bff'],
];
const NODE_W = 96, NODE_GAP = 10; // reward track geometry (kept in sync with events.css)

let sig = '';
let trackX = null; // remembered scroll position of the reward track

// Exact amounts for this screen's own labels (HENIUM keeps its decimals)
const amt = (r, v) => (r === 'henium' ? ui.amt(r, v) : G.fmtFull(Math.round(v)));
const rewFull = (rew, size) => `<span class="cost gain">${Object.entries(rew).filter(([, v]) => v > 0).map(([r, v]) => `<span class="c">${ui.icon(r, size)}+${amt(r, v)}</span>`).join('')}</span>`;

const nextReset = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };
const claimable = () => { const s = G.S.season; return Array.from({ length: s.lv }, (_, i) => i + 1).filter((l) => !s.claimed.includes(l)); };
const rewOf = (lv) => D.seasonReward(lv, G.S.depth);
const seasonFrac = () => { const s = G.S.season; return s.lv >= D.seasonMax ? 1 : Math.min(1, s.xp / D.seasonNeed(s.lv)); };

const stateSig = () => {
  const S = G.S, h = S.hazard, ev = G.liveEvent();
  return [S.season.lv, S.season.claimed.length, S.season.ends, G.missions().map((m) => (m.done ? 1 : 0) + (m.claimed ? 2 : 0)).join(''),
    ev ? ev.id : '-', h ? h.type + h.zone + h.at : '-', D.journey.map((j) => (j.done(S) ? 1 : 0)).join(''), S.daily.day].join('|');
};

ui.binders.evSXp = (el) => {
  const s = G.S.season, max = s.lv >= D.seasonMax;
  el.querySelector('i').style.width = seasonFrac() * 100 + '%';
  const b = el.querySelector('b');
  if (b) b.textContent = max ? 'MAX LEVEL' : `${G.fmtFull(s.xp)} / ${G.fmtFull(D.seasonNeed(s.lv))} XP`;
};
ui.binders.evMis = (el, id) => {
  const m = G.missions().find((x) => x.id === id);
  if (!m) return;
  el.querySelector('i').style.width = Math.min(100, m.cur / m.n * 100) + '%';
  const b = el.querySelector('b');
  if (b) b.textContent = `${G.fmtFull(m.cur)} / ${G.fmtFull(m.n)}`;
};

// ---------- season ----------
function rewardArt(r, size) {
  if (r.chikn) return `<span class="ev-chk rarity-${r.chikn}">${ui.img(r.chikn === 'mythic' ? 'chikn/leader' : 'chikn/explorer', '', D.rarity(r.chikn).name + ' Chikn')}</span>`;
  return ui.icon(Object.keys(r)[0], size);
}
function rewardText(r) {
  if (r.chikn) return `${D.rarity(r.chikn).name} Chikn`;
  return Object.entries(r).map(([k, v]) => `${amt(k, v)} ${D.res[k].name}`).join(' + ');
}

function seasonHTML() {
  const s = G.S.season, cl = claimable(), max = s.lv >= D.seasonMax;
  const resN = cl.filter((l) => !rewOf(l).chikn).length, chLv = cl.find((l) => rewOf(l).chikn);
  const next = max ? null : rewOf(s.lv + 1);
  return `<section class="ev-season" style="background-image:linear-gradient(90deg,rgba(21,26,70,.15) 0%,rgba(21,26,70,.82) 34%,rgba(21,26,70,.95) 70%,rgba(21,26,70,.6) 100%),url(${G.img('bg/floor-henium')})">
    <div class="ev-s-name">
      <div class="ev-s-kick">${ui.img('ui/trophy', '', '')}Season 1</div>
      <h2 class="ev-s-title">Deep Veins</h2>
      <div class="ev-s-ends">${ui.img('ui/timer', '', '')}Ends in <b data-b="until:${s.ends}">${G.fmtTime((s.ends - now()) / 1000)}</b></div>
    </div>
    <div class="ev-s-prog">
      <div class="ev-s-row"><span class="ev-lv"><small>Lv.</small>${s.lv}</span>${ui.bar(seasonFrac() * 100, 'blue lg sp', ' ', 'data-b="evSXp"')}<span class="ev-lv ev-lv-next">${max ? '★' : `<small>Lv.</small>${s.lv + 1}`}</span></div>
      <div class="ev-s-next">${next ? `Next reward: <b>${rewardText(next)}</b> at Lv. ${s.lv + 1}` : 'You reached the top of the season!'} · Earn season XP from everything you do.</div>
    </div>
    <div class="ev-s-cta">
      ${resN ? `<button class="btn gold lg" data-a="evClaimAll">${ui.img('ui/gift', '', '')}Claim all <span class="ev-cnt">${resN}</span></button>`
        : chLv ? `<button class="btn purple lg" data-a="evClaim" data-args="[${chLv}]">${ui.img('ui/chikns', '', '')}Claim ${D.rarity(rewOf(chLv).chikn).name} Chikn</button>`
        : '<span class="ev-s-done">✔ All rewards claimed</span>'}
    </div>
    ${ui.img('prop/chest', 'ev-s-chest', '')}
  </section>`;
}

function nodeHTML(lv) {
  const s = G.S.season, r = rewOf(lv), claimed = s.claimed.includes(lv), reached = lv <= s.lv;
  const st = claimed ? 'claimed' : reached ? 'ready' : 'locked';
  const k0 = r.chikn ? null : Object.keys(r)[0], extra = r.chikn ? [] : Object.entries(r).slice(1);
  const kind = r.chikn ? 'ev-k-chikn ev-r-' + r.chikn : 'ev-k-' + k0;
  const label = r.chikn ? 'Chikn' : amt(k0, r[k0]);
  // ore & material bundles: tint the box with the ore's colour and list the material under the main amount
  const tint = k0 && !['egg', 'feed', 'henium'].includes(k0) && D.res[k0] ? ` style="--kc:${D.res[k0].color}"` : '';
  const action = st === 'ready' ? ui.btn('Claim', 'evClaim', [lv], 'green sm')
    : st === 'claimed' ? '<span class="ev-n-ok">✔ Claimed</span>' : `<span class="ev-n-lk">${ui.img('ui/lock', '', 'Locked')}</span>`;
  return `<div class="ev-node ev-${st} ${kind} ${lv % 5 === 0 ? 'ev-big' : ''} ${lv === s.lv ? 'ev-cur' : ''}" data-lv="${lv}" title="Level ${lv}: ${esc(rewardText(r))}">
    <div class="ev-n-lv">${lv}</div>
    <div class="ev-n-box ${extra.length ? 'ev-n-multi' : ''}"${tint}>${r.chikn ? `<span class="ev-n-rib">${D.rarity(r.chikn).name}</span>` : ''}${rewardArt(r, 44)}<span class="ev-n-amt">${label}</span>${extra.map(([k, v]) => `<span class="ev-n-sub">+${ui.icon(k, 18)}${amt(k, v)}</span>`).join('')}</div>
    <div class="ev-n-act">${action}</div>
  </div>`;
}

function trackHTML() {
  const s = G.S.season, n = claimable().length;
  const fill = Math.min(D.seasonMax - 1, s.lv - 1 + (s.lv < D.seasonMax ? seasonFrac() : 0));
  return `<section class="panel ev-trackp">
    <div class="panel-h">${ui.img('ui/gift', '', '')}<span class="sp">Season Rewards <small>Level ${s.lv} / ${D.seasonMax}${n ? ` · ${n} ready to claim` : ''}</small></span>
      <button class="btn sm ff" data-a="evTrack" data-args='[-1]' aria-label="Scroll rewards left">◀</button><button class="btn sm ff" data-a="evTrack" data-args='[1]' aria-label="Scroll rewards right">▶</button></div>
    <div class="ev-track" id="ev-track" tabindex="0" aria-label="Season reward track">
      <div class="ev-track-in" style="--n:${D.seasonMax};--w:${NODE_W}px;--g:${NODE_GAP}px">
        <div class="ev-line"><i style="width:calc(${fill} * (var(--w) + var(--g)))"></i></div>
        ${Array.from({ length: D.seasonMax }, (_, i) => nodeHTML(i + 1)).join('')}
      </div>
    </div>
  </section>`;
}

// ---------- missions ----------
function missionsHTML() {
  const ms = G.missions(), done = ms.filter((m) => m.done).length, total = {};
  for (const m of ms) for (const r in m.r) total[r] = (total[r] || 0) + m.r[r];
  const rows = ms.map((m) => {
    const p = Math.min(100, m.cur / m.n * 100);
    const act = m.claimed ? '<span class="ev-claimed">✔ Claimed</span>' : m.done ? ui.btn('Claim', 'evMission', [m.id], 'green sm') : `<span class="ev-mis-pct">${Math.floor(p)}%</span>`;
    return `<div class="ev-mis ${m.done ? 'ev-mis-done' : ''} ${m.claimed ? 'ev-mis-claimed' : ''}">
      <span class="ev-mis-ic">${ui.img(MIS_IC[m.stat] || 'ui/events', '', '')}</span>
      <div class="ev-mis-m"><div class="ev-mis-l">${esc(m.label)}</div>${ui.bar(p, m.done ? 'gold' : 'green', `${G.fmtFull(m.cur)} / ${G.fmtFull(m.n)}`, `data-b="evMis:${m.id}"`)}</div>
      <div class="ev-mis-r">${ui.rew(m.r, 22)}</div>
      <div class="ev-mis-a">${act}</div>
    </div>`;
  }).join('');
  return `<section class="panel ev-missions">
    <div class="panel-h">${ui.img('ui/events', '', '')}<span class="sp">Daily Missions <small>${done}/${ms.length} done</small></span>
      <span class="ev-reset">${ui.img('ui/timer', '', '')}Resets in <b data-b="until:${nextReset()}">${G.fmtTime((nextReset() - now()) / 1000)}</b></span></div>
    <div class="ev-mis-list">${rows}</div>
    <div class="ev-haul">${ui.img('prop/chest', 'ev-haul-chest', '')}
      <div class="ev-haul-m"><div class="ev-haul-t">Daily haul <small>${ms.filter((m) => m.claimed).length}/${ms.length} claimed</small></div>
        <div class="ev-pips">${ms.map((m) => `<i class="${m.claimed ? 'ev-pip-c' : m.done ? 'ev-pip-d' : ''}"></i>`).join('')}</div>
        <div class="ev-haul-r">${rewFull(total, 20)}</div></div>
    </div>
    <div class="ev-foot">New missions every day at 00:00 UTC. Claim before the reset!</div>
  </section>`;
}

// ---------- live events ----------
function liveHTML() {
  const S = G.S, ev = G.liveEvent(), h = S.hazard;
  let cur;
  if (ev) {
    const [view, label] = EV_GO[ev.id] || ['mines', 'Go to mine'];
    cur = `<div class="ev-now">
      <div class="ev-now-art">${ui.img(EV_IC[ev.id] || 'ui/events', '', '')}</div>
      <div class="ev-now-m"><div class="ev-now-top"><span class="ev-livetag">● LIVE</span><span class="ev-now-t">${ui.img('ui/timer', '', '')}<b data-b="until:${S.live.until}">${G.fmtTime((S.live.until - now()) / 1000)}</b></span></div>
        <h3>${esc(ev.name)}</h3><p>${esc(ev.desc)}</p>
        <button class="btn sm ${ev.id === 'vein' ? 'purple' : 'gold'}" data-a="${view === 'mines' ? 'evGoMine' : 'nav'}" data-args='["${view === 'mines' ? (ev.zone || '') : view}"]'>${label}</button></div>
    </div>`;
  } else {
    cur = `<div class="ev-now ev-now-idle"><div class="ev-now-art">${ui.img('ui/bell', '', '')}</div>
      <div class="ev-now-m"><h3>No live event right now</h3><p>The next event starts in <b data-b="until:${S.live.next}">${G.fmtTime((S.live.next - now()) / 1000)}</b>. Keep mining!</p></div></div>`;
  }
  let hz;
  if (h) {
    const z = D.zoneById(h.zone), [name, what] = HZ[h.type] || [h.type, ''];
    const icon = { collapse: 'prop/rubble', richvein: 'res/' + z.res, supply: 'prop/crate', creature: 'monster/' + h.mon, bandits: 'ui/battle' }[h.type] || 'ui/bell';
    const bad = ['collapse', 'bandits', 'creature'].includes(h.type);
    hz = `<div class="ev-hz ${bad ? 'ev-hz-bad' : 'ev-hz-good'}">
      <div class="ev-hz-art">${ui.img(icon, '', '')}</div>
      <div class="ev-hz-m"><div class="ev-hz-top"><b>${name}</b><span class="ev-hz-z">${esc(z.name)}</span></div><p>${what}</p></div>
      <div class="ev-hz-r">${h.until ? `<span class="ev-hz-t">${ui.img('ui/timer', '', '')}<b data-b="until:${h.until}">${G.fmtTime((h.until - now()) / 1000)}</b></span>` : ''}
        <button class="btn sm ${bad ? 'red' : 'green'}" data-a="evGoMine" data-args='["${h.zone}"]'>Go to mine</button></div>
    </div>`;
  } else hz = `<div class="ev-hz ev-hz-none">${ui.img('ui/mines', '', '')}<span>No hazards in your mine right now. Cave-ins, creatures and bandits can strike at any time!</span></div>`;
  const list = D.liveEvents.map((e) => {
    const on = ev && ev.id === e.id, lk = e.minDepth && S.depth < e.minDepth;
    return `<div class="ev-le ${on ? 'ev-le-on' : ''} ${lk ? 'ev-le-lk' : ''}">${ui.img(EV_IC[e.id] || 'ui/events', 'ev-le-ic', '')}
      <div class="ev-le-m"><b>${esc(e.name)}</b><span>${esc(e.desc)}</span></div>
      <div class="ev-le-c">${on ? '<span class="ev-chip ev-chip-live">LIVE</span>' : ''}<span class="ev-chip">${G.fmtTime(e.dur)}</span>${e.minDepth ? `<span class="ev-chip ${lk ? 'ev-chip-lk' : ''}">Depth ${e.minDepth}+</span>` : ''}</div>
    </div>`;
  }).join('');
  return `<section class="panel ev-live">
    <div class="panel-h">${ui.img('ui/bell', '', '')}<span class="sp">Live Events</span></div>
    <div class="ev-live-body">
      <div class="ev-live-a">${cur}<div class="ev-sub">Hazards</div>${hz}</div>
      <div class="ev-live-b"><div class="ev-sub">Event rotation</div><div class="ev-les">${list}</div></div>
    </div>
  </section>`;
}

// ---------- journey ----------
function journeyHTML() {
  const S = G.S, done = D.journey.map((j) => !!j.done(S)), cur = done.indexOf(false);
  const cards = D.journey.map((j, i) => {
    const [bg, art, goal, color] = MONTH[i] || MONTH[MONTH.length - 1];
    const st = done[i] ? 'done' : i === cur ? 'cur' : 'future';
    return `<article class="ev-mo ev-mo-${st}" style="--mc:${color}">
      <header class="ev-mo-h"><span class="ev-mo-n">Month ${i + 1}</span><span class="ev-mo-name">${esc(j.name)}</span></header>
      <div class="ev-mo-art" style="background-image:url(${G.img(bg)})">${ui.img(art, 'ev-mo-sp', '')}
        ${st === 'done' ? '<span class="ev-mo-badge ev-mo-badge-done">✔ Complete</span>' : st === 'cur' ? '<span class="ev-mo-badge ev-mo-badge-cur">You are here</span>' : `${ui.img('ui/lock', 'ev-mo-lock', 'Locked')}`}</div>
      <ul class="ev-mo-items">${j.items.map((t) => `<li><span class="ev-mo-cb">${st === 'done' ? '✔' : ''}</span>${esc(t)}</li>`).join('')}</ul>
      <div class="ev-mo-goal">${ui.img(goal, '', '')}<span>Goal: ${esc(j.goal)}</span>${st === 'done' ? '<b>✔</b>' : ''}</div>
      ${i < D.journey.length - 1 ? '<span class="ev-mo-arrow" aria-hidden="true">❯</span>' : ''}
    </article>`;
  }).join('');
  const n = done.filter(Boolean).length;
  return `<section class="ev-journey">
    <div class="ev-j-head"><div><h2>6-Month Game Journey</h2><div class="ev-j-sub">From a small mine to a full mining empire</div></div>
      <span class="ev-j-chip">${cur < 0 ? 'Journey complete!' : `Month ${cur + 1} of ${D.journey.length}`} · ${n}/${D.journey.length} goals reached</span></div>
    <div class="ev-mos">${cards}</div>
  </section>`;
}

// ---------- view ----------
function placeTrack() {
  const t = document.getElementById('ev-track');
  if (!t) return;
  if (trackX == null) {
    const s = G.S.season, first = claimable()[0] || s.lv;
    trackX = Math.max(0, (first - 2.5) * (NODE_W + NODE_GAP));
  }
  t.scrollLeft = trackX;
  t.addEventListener('scroll', () => { trackX = t.scrollLeft; }, { passive: true });
}

ui.views.events = {
  render(el) {
    sig = stateSig();
    el.innerHTML = `<div class="ev-top"><div class="view-title">${ui.img('ui/events', '', '')}<div><h1>Events</h1><div class="sub">Season pass, daily missions, live events and your 6-month journey.</div></div></div></div>
      ${seasonHTML()}
      ${trackHTML()}
      <div class="ev-grid">${missionsHTML()}${liveHTML()}</div>
      ${journeyHTML()}`;
    placeTrack();
  },
  update() { if (stateSig() !== sig) ui.render(); },
};

// ---------- handlers ----------
const floatRew = (el, rew) => {
  const [x, y] = ui.centerOf(el);
  Object.entries(rew).forEach(([r, v], i) => setTimeout(() => ui.float(`+${amt(r, v)}${ui.icon(r, 20)}`, x + (i - (Object.keys(rew).length - 1) / 2) * 34, y - 16), i * 110));
  ui.sparks(x, y, '#ffd54a', 10);
};
ui.handlers.evClaim = (el, e, lv) => {
  const r = G.act.claimSeason(lv);
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
  if (r.c) { ui.render(); ui.reveal(r.c); return; }
  floatRew(el, r.rew);
  G.sfx('coin');
  ui.render();
};
ui.handlers.evClaimAll = () => {
  const got = {}, chikns = [];
  let n = 0;
  for (const lv of claimable()) {
    if (rewOf(lv).chikn) { chikns.push(lv); continue; }
    const r = G.act.claimSeason(lv);
    if (r.ok && r.rew) { n++; for (const k in r.rew) got[k] = (got[k] || 0) + r.rew[k]; }
  }
  if (!n) { ui.toast(chikns.length ? 'Tap Claim on each Chikn reward to meet your new Chikns!' : 'Nothing to claim yet', chikns.length ? 'purple' : 'bad', 'ui/chikns'); return; }
  G.sfx('coin');
  ui.render();
  ui.modal({ title: `${ui.img('ui/gift', '', '')} Season rewards claimed!`, hero: 'prop/chest', actions: [{ label: 'Awesome!', cls: 'green lg' }],
    html: `<p class="ev-ca-t">You collected <b>${n}</b> season reward${n > 1 ? 's' : ''}:</p>
      <div class="ev-ca-rew">${rewFull(got, 30)}</div>
      ${chikns.length ? `<div class="ev-ca-ch">${ui.img('ui/chikns', '', '')}<span>${chikns.length > 1 ? `${chikns.length} Chikn rewards are` : 'A Chikn reward is'} waiting at level ${chikns.join(', ')}. Claim ${chikns.length > 1 ? 'them' : 'it'} on the track to meet your new Chikn!</span></div>` : ''}` });
};
ui.handlers.evMission = (el, e, id) => {
  const r = G.act.claimMission(id);
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
  floatRew(el, r.rew);
  G.sfx('coin');
  ui.render();
};
ui.handlers.evGoMine = (el, e, zone) => {
  const z = zone && D.zoneById(zone);
  if (z && G.zoneOpen(z)) G.S.sel = zone;
  ui.go('mines');
};
ui.handlers.evTrack = (el, e, dir) => {
  const t = document.getElementById('ev-track');
  if (t) t.scrollBy({ left: dir * Math.max(200, t.clientWidth * 0.8), behavior: 'smooth' });
};
})();
