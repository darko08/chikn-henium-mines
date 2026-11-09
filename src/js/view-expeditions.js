// Expeditions screen: painted world map with site markers, site card, team picker, launch pad and active expeditions.
(() => {
const G = window.G, D = G.D, ui = G.ui, esc = ui.esc;

// Marker / card art per site (fallback: the expeditions icon)
const ART = { shaft: 'prop/headframe', cavern: 'res/rareEarth', lava: 'monster/beast', field: 'res/heniumOre', ruins: 'prop/lantern', vein: 'res/henium' };
const RISKS = ['Low', 'Medium', 'High', 'Extreme'];
const RISK_C = { Low: '#5be36b', Medium: '#ffd23f', High: '#ff8a3d', Extreme: '#ff4d6d' };
const ORDER = { explorer: 0, medic: 1, leader: 2 };

let sel = null;   // selected site id
let picked = [];  // chikn ids picked for the next expedition
let sig = '';     // state signature of the last render (update() re-renders when it changes)

const art = (s) => ART[s.id] || 'ui/expeditions';
const veinLive = () => { const e = G.liveEvent(); return !!(e && e.id === 'vein'); };
const expAt = (siteId) => G.S.exps.find((e) => e.site === siteId);
const isLocked = (s) => G.S.player.lv < s.lv;
const sites = () => D.expeditions.concat(veinLive() || expAt('vein') ? [D.veinExpedition] : []);
const teamOf = (ids) => ids.map((id) => G.chikn(G.S, id)).filter(Boolean);
const pctTxt = (x) => Math.round(x * 100) + '%';
const riskColor = (x) => (x < 0.08 ? RISK_C.Low : x < 0.16 ? RISK_C.Medium : x < 0.28 ? RISK_C.High : RISK_C.Extreme);
const sortIdle = (list) => list.slice().sort((a, b) => (ORDER[a.role] ?? 9) - (ORDER[b.role] ?? 9) || G.chiknPower(b) - G.chiknPower(a));

// Outcome preview for a team (the same odds G.act.claimExp uses: G.expOdds)
function preview(site, ids) {
  const t = teamOf(ids), o = G.expOdds(site, t);
  return { n: t.length, power: o.power, k: t.length ? o.k : 0, risk: o.risk };
}

const stateSig = () => [veinLive(), G.S.player.lv, G.idleChikns().map((c) => c.id).join(','),
  G.S.exps.map((e) => e.id + (e.done ? 'd' : '')).join(',')].join('|');

function ensureSelection() {
  const list = sites();
  if (sel && list.some((s) => s.id === sel)) return;
  const free = list.filter((s) => !isLocked(s) && !expAt(s.id));
  sel = (free.find((s) => s.event) || free[free.length - 1] || list[0]).id;
}

ui.binders.exLeft = (el, id) => {
  const e = G.S.exps.find((x) => x.id === +id);
  if (e) el.textContent = e.done ? 'Ready!' : G.fmtTime(e.dur - e.t);
};

// ---------- pieces ----------
const avatar = (c, cls = '') => `<span class="ex-av rarity-${c.rarity} ${cls}" title="${esc(c.name)} · ${D.rarity(c.rarity).name} ${D.roles[c.role].name}">${ui.img('chikn/' + c.role, '', c.name)}</span>`;

function titleHTML() {
  const S = G.S, idle = G.idleChikns().length, out = S.exps.filter((e) => !e.done).length, ready = S.exps.filter((e) => e.done).length;
  return `<div class="ex-top">
    <div class="view-title">${ui.img('ui/expeditions', '', '')}<div><h1>Expeditions</h1><div class="sub">Send idle Chikns into the wild. Higher risk, bigger loot.</div></div></div>
    <div class="ex-chips">
      <span class="ex-chip">${ui.img('ui/chikns', '', '')}Idle <b>${idle}</b></span>
      <span class="ex-chip">${ui.img('ui/timer', '', '')}Exploring <b>${out}</b></span>
      ${ready ? `<button type="button" class="ex-chip ex-chip-gold" data-a="exClaim" data-args='[${S.exps.find((e) => e.done).id}]' title="Claim the loot">${ui.img('prop/chest', '', '')}Ready <b>${ready}</b> · Claim</button>` : ''}
    </div>
  </div>`;
}

function markerHTML(s) {
  const e = expAt(s.id), lk = isLocked(s), on = sel === s.id;
  const edge = s.x >= 80 ? 'ex-mk-r' : s.x <= 15 ? 'ex-mk-l' : '';
  const [, main, sub] = s.name.match(/^(.*?)(\s*\(.*\))?$/); // "Henium Vein (Depth 29)" -> name + optional note
  const live = s.event && veinLive();
  const cls = ['ex-mk', edge, on ? 'ex-on' : '', lk ? 'ex-lk' : '', live ? 'ex-ev' : '', e ? (e.done ? 'ex-back' : 'ex-going') : ''].join(' ');
  return `<button class="${cls}" style="left:${s.x}%;top:${s.y}%" data-a="exSite" data-args='["${s.id}"]' aria-pressed="${on}"
      aria-label="${esc(s.name)}, risk ${s.riskName}${lk ? `, requires level ${s.lv}` : ''}">
    ${live ? '<span class="ex-mk-lim">Limited</span>' : ''}
    <span class="ex-mk-pin">${ui.img(art(s), 'ex-mk-img', '')}${lk ? ui.img('ui/lock', 'ex-mk-lock', '') : ''}</span>
    <span class="ex-mk-name">${esc(main)}${sub ? `<span class="ex-mk-sub"> ${esc(sub)}</span>` : ''}${lk ? ` <small>Lv. ${s.lv}</small>` : ''}</span>
    ${e ? `<span class="ex-mk-st" data-b="exLeft:${e.id}">${e.done ? 'Ready!' : ''}</span>` : ''}
  </button>`;
}

function mapHTML() {
  return `<section class="panel ex-mapp">
    <div class="panel-h">${ui.img('ui/expeditions', '', '')}<span class="sp">World Map</span>
      ${veinLive() ? `<span class="ex-live">${ui.img('res/henium', '', '')}Henium Vein open · <b data-b="until:${G.S.live.until}"></b></span>` : '<small>Tap a site to plan an expedition</small>'}</div>
    <div class="ex-map" style="background-image:url(${G.img('bg/map')})">${sites().map(markerHTML).join('')}</div>
  </section>`;
}

function siteHTML(s) {
  const lk = isLocked(s), rc = RISK_C[s.riskName] || '#fff', ri = RISKS.indexOf(s.riskName);
  const X = D.rules.exp, k1 = X.base + X.per; // a lone Chikn's loot multiplier (more Chikns, power and Explorers raise it)
  const rew = Object.entries(s.r).map(([r, [a, b]]) => `<div class="ex-rw">${ui.icon(r, 32)}<div class="ex-rw-t"><span>${D.res[r].name}</span><b>${ui.amt(r, Math.max(1, Math.round(a * k1)))}–${ui.amt(r, Math.round(b * k1))}+</b></div></div>`).join('')
    + `<div class="ex-rw">${ui.icon('feed', 32)}<div class="ex-rw-t"><span>FEED, ${Math.round(X.feed * 100)}%+ chance</span><b>${X.feedAmt[0]}–${X.feedAmt[1]}</b></div></div>`;
  return `<section class="panel ex-site ${s.event ? 'ex-site-ev' : ''}" style="--rc:${rc}">
    ${s.event ? `<div class="ex-ribbon">${ui.img('ui/timer', '', '')}${veinLive() ? `Limited event · ends in <b data-b="until:${G.S.live.until}"></b>` : 'Limited event · ended'}</div>` : ''}
    <div class="ex-site-top">
      <div class="ex-site-ic">${ui.img(art(s), '', '')}</div>
      <div class="ex-site-t"><h2>${esc(s.name)}</h2>
        <div class="ex-risk">Risk: <b>${s.riskName}</b><span class="ex-pips" aria-hidden="true">${RISKS.map((_, i) => `<i class="${i <= ri ? 'ex-pip-on' : ''}"></i>`).join('')}</span></div></div>
      ${ui.img('prop/chest', 'ex-chest', 'Loot chest')}
    </div>
    <div class="ex-facts">
      <div class="ex-fact">${ui.img('ui/timer', '', '')}<span>Duration</span><b>${G.fmtTime(s.t)}</b></div>
      <div class="ex-fact">${ui.img('ui/chikns', '', '')}<span>Team</span><b>${s.slots} slot${s.slots > 1 ? 's' : ''}</b></div>
      <div class="ex-fact ${lk ? 'ex-fact-bad' : ''}">${ui.img(lk ? 'ui/lock' : 'ui/trophy', '', '')}<span>Requires</span><b>Lv. ${s.lv}</b></div>
      <div class="ex-fact"><i class="ex-cross" aria-hidden="true">✚</i><span>Injury</span><b style="color:${riskColor(s.risk)}">${pctTxt(s.risk)}</b></div>
    </div>
    <div class="ex-sub">Possible rewards <small>(for one Chikn; a bigger, stronger team and Explorers bring more)</small></div>
    <div class="ex-rws">${rew}</div>
  </section>`;
}

function launchHTML(s) {
  const e = expAt(s.id);
  if (e) {
    const t = teamOf(e.ids);
    return `<section class="panel ex-launch ${e.done ? 'ex-launch-ready' : 'ex-launch-busy'}">
      <div class="panel-h"><span class="sp">${e.done ? 'Your team is back!' : 'Team exploring…'}</span><small>${t.length}/${s.slots}</small></div>
      <div class="ex-busyteam">${t.map((c) => avatar(c, 'ex-av-lg')).join('')}</div>
      ${ui.bar(Math.min(100, e.t / e.dur * 100), e.done ? 'gold lg' : 'green lg', e.done ? 'Done!' : G.fmtTime(e.dur - e.t), `data-b="exp:${e.id}"`)}
      ${e.done ? ui.btn(`${ui.img('prop/chest', '', '')}Claim Rewards`, 'exClaim', [e.id], 'gold lg block ex-go')
        : `<button class="btn gray lg block ex-go" disabled>${ui.img('ui/timer', '', '')}Back in <span data-b="exLeft:${e.id}">${G.fmtTime(e.dur - e.t)}</span></button>`}
    </section>`;
  }
  const ids = picked.slice(0, s.slots), pv = preview(s, ids);
  const slots = Array.from({ length: s.slots }, (_, i) => {
    const c = G.chikn(G.S, ids[i]);
    return c ? `<button class="ex-slot ex-slot-full rarity-${c.rarity}" data-a="exPick" data-args='[${c.id}]' aria-label="Remove ${esc(c.name)} from the team">${ui.img('chikn/' + c.role, '', '')}<span class="ex-slot-n">${esc(c.name)}</span><span class="ex-slot-x" aria-hidden="true">×</span></button>`
      : `<button class="ex-slot" data-a="exToPick" aria-label="Pick a Chikn">+</button>`;
  }).join('');
  const block = isLocked(s) ? `Requires player Lv. ${s.lv}` : s.event && !veinLive() ? 'This event has ended' : '';
  const go = block ? `<button class="btn gray lg block ex-go" disabled>${ui.img('ui/lock', '', '')}${block}</button>`
    : `<button class="btn green lg block ex-go ${ids.length ? '' : 'cant'}" data-a="exStart">${ui.img('ui/expeditions', '', '')}Start Expedition</button>`;
  return `<section class="panel ex-launch">
    <div class="panel-h"><span class="sp">Expedition Team</span><small>${ids.length}/${s.slots} picked</small></div>
    <div class="ex-slots">${slots}</div>
    <div class="ex-prev">
      <div class="ex-pv"><span>Loot</span><b class="${pv.k > 1 ? 'ex-up' : ''}">${pv.n ? '×' + pv.k.toFixed(2) : '—'}</b></div>
      <div class="ex-pv"><span>Injury risk</span><b style="color:${riskColor(pv.risk)}">${pctTxt(pv.risk)}</b></div>
      <div class="ex-pv"><span>Back in</span><b>${G.fmtTime(s.t)}</b></div>
    </div>
    ${go}
  </section>`;
}

function perkHTML(c) {
  const p = G.chiknPct(c);
  if (c.role === 'explorer') return `<span class="ex-ck-p ex-loot">+${G.fmt(p, 1)}% loot</span>`;
  if (c.role === 'medic') return `<span class="ex-ck-p ex-safe">−${G.fmt(p, 1)}% injury</span>`;
  if (c.role === 'leader') return `<span class="ex-ck-p ex-loot">+${G.fmt(p / 2, 1)}% loot</span>`;
  return `<span class="ex-ck-p">Power ${G.fmtFull(G.chiknPower(c))}</span>`;
}

function pickerHTML(s) {
  const idle = sortIdle(G.idleChikns()), busy = G.S.chikns.filter((c) => c.status !== 'idle');
  const n = (st) => busy.filter((c) => c.status === st).length;
  const cards = idle.map((c) => {
    const on = picked.includes(c.id), R = D.rarity(c.rarity), role = D.roles[c.role];
    return `<button class="ex-ck rarity-${c.rarity} ${on ? 'ex-ck-on' : ''}" data-a="exPick" data-args='[${c.id}]' aria-pressed="${on}" title="${esc(c.name)} #${c.num} · ${R.name} ${role.name}">
      <span class="ex-ck-art">${ui.img('chikn/' + c.role, '', role.name)}<span class="ex-ck-lv">Lv.${c.lv}</span>${on ? '<span class="ex-ck-ok" aria-hidden="true">✔</span>' : ''}</span>
      <span class="ex-ck-n">${esc(c.name)}</span>
      <span class="ex-ck-r" style="color:${R.color}">${role.name}</span>
      ${perkHTML(c)}
    </button>`;
  }).join('');
  const busyTxt = [['squad', 'in your squad'], ['exp', 'exploring'], ['injured', 'recovering']].filter(([k]) => n(k)).map(([k, l]) => `<b>${n(k)}</b> ${l}`).join(' · ');
  return `<section class="panel ex-pick" id="ex-pick">
    <div class="panel-h">${ui.img('ui/chikns', '', '')}<span class="sp">Choose your team</span>
      ${idle.length ? `<button class="btn sm" data-a="exAuto">Auto-pick</button>` : ''}${picked.length ? '<button class="btn sm gray" data-a="exClear">Clear</button>' : ''}</div>
    <div class="ex-tips">
      <span class="ex-tip">${ui.img('chikn/explorer', '', '')}Explorers boost loot</span>
      <span class="ex-tip">${ui.img('chikn/medic', '', '')}Medics reduce injuries</span>
      <span class="ex-tip">${ui.img('ui/battle', '', '')}Squad Chikns can't go</span>
    </div>
    ${idle.length ? `<div class="ex-cks">${cards}</div>`
      : `<div class="ex-none">${ui.img('chikn/miner', '', '')}<div><b>${G.S.chikns.length ? 'No idle Chikns right now.' : 'You have no Chikns yet.'}</b>
        <div class="muted">${G.S.chikns.length ? 'Free up a squad slot in the Chikn NFT screen or hire more Chikns.' : 'Your first Chikns join your squad. Hire a few more to send them exploring!'}</div>
        <div class="row wrap" style="margin-top:8px"><button class="btn sm gold" data-a="hire">Hire a Chikn</button><button class="btn sm" data-a="nav" data-args='["chikns"]'>Chikn NFT</button></div></div></div>`}
    ${busyTxt ? `<div class="ex-busy">Busy: ${busyTxt}. Picking up to <b>${s.slots}</b> for ${esc(s.name)}.</div>` : ''}
  </section>`;
}

function activeHTML() {
  const list = G.S.exps;
  const rows = list.map((e) => {
    const s = G.expSite(e.site), t = teamOf(e.ids);
    return `<div class="ex-run ${e.done ? 'ex-run-done' : ''}">
      <button class="ex-run-ic" data-a="exSite" data-args='["${s.id}"]' aria-label="Show ${esc(s.name)}">${ui.img(art(s), '', '')}</button>
      <div class="ex-run-m">
        <div class="ex-run-top"><b>${esc(s.name)}</b><span class="ex-run-team">${t.map((c) => avatar(c)).join('')}</span></div>
        ${ui.bar(Math.min(100, e.t / e.dur * 100), e.done ? 'gold' : 'green', e.done ? 'Done!' : G.fmtTime(e.dur - e.t), `data-b="exp:${e.id}"`)}
      </div>
      ${e.done ? ui.btn('Claim', 'exClaim', [e.id], 'gold') : ''}
    </div>`;
  }).join('');
  return `<section class="panel ex-act">
    <div class="panel-h">${ui.img('ui/timer', '', '')}<span class="sp">Active Expeditions</span><small>${list.length} running</small></div>
    ${rows || `<div class="ex-empty">${ui.img('ui/expeditions', '', '')}<span>No teams out exploring. Pick a site on the map and send a team!</span></div>`}
  </section>`;
}

function showResults(r, hadMedic) {
  const inj = r.injured || [];
  ui.modal({ title: `${ui.img('ui/expeditions', '', '')} Expedition complete!`, actions: [{ label: 'Collect', cls: 'green lg' }],
    html: `<div class="ex-res">
      <div class="ex-res-hero"><div class="ex-res-rays"></div>${ui.img('prop/chest', 'ex-res-chest', 'Loot chest')}</div>
      <p class="ex-res-t">Your team is back from <b>${esc(r.site.name)}</b> with:</p>
      <div class="ex-res-rew">${ui.rew(r.rew, 30)}</div>
      ${inj.length ? `<div class="ex-res-inj"><div class="ex-res-h">${inj.length} Chikn${inj.length > 1 ? 's' : ''} got hurt and ${inj.length > 1 ? 'are' : 'is'} recovering</div>
          ${inj.map((c) => `<div class="ex-res-c">${avatar(c)}<span class="sp"><b>${esc(c.name)}</b> <span class="muted">${D.roles[c.role].name}</span></span><span class="tag r">Back in <span data-b="until:${c.until}">${G.fmtTime((c.until - G.now()) / 1000)}</span></span></div>`).join('')}
          <div class="dim ex-res-tip">${hadMedic ? 'Your Medic helped, but risky sites still bite. Level up your Medics for better protection.' : 'Tip: bring a Medic to cut the injury risk.'}</div></div>`
        : '<div class="ex-res-safe">✔ Everyone came back safe!</div>'}
    </div>` });
}

// ---------- view ----------
ui.views.expeditions = {
  render(el) {
    ensureSelection();
    const s = G.expSite(sel);
    picked = picked.filter((id) => { const c = G.chikn(G.S, id); return c && c.status === 'idle'; }).slice(0, s.slots);
    sig = stateSig();
    el.innerHTML = `${titleHTML()}
      <div class="ex-grid">
        <div class="ex-col">${mapHTML()}${pickerHTML(s)}</div>
        <div class="ex-col">${siteHTML(s)}${launchHTML(s)}${activeHTML()}</div>
      </div>`;
  },
  update() { if (stateSig() !== sig) ui.render(); },
};

// ---------- handlers ----------
ui.handlers.exSite = (el, e, id) => {
  sel = id;
  picked = picked.slice(0, G.expSite(id).slots);
  G.sfx('click');
  ui.render();
};
ui.handlers.exPick = (el, e, id) => {
  const s = G.expSite(sel);
  if (picked.includes(id)) picked = picked.filter((x) => x !== id);
  else if (picked.length < s.slots) picked.push(id);
  else if (s.slots === 1) picked = [id];
  else { ui.toast(`${s.name} takes up to ${s.slots} Chikns. Remove one first.`, 'bad'); G.sfx('err'); return; }
  G.sfx('click');
  ui.render();
};
ui.handlers.exAuto = () => {
  const s = G.expSite(sel);
  const score = (c) => G.chiknPower(c) + (c.role === 'explorer' ? 2000 : c.role === 'medic' ? (s.risk >= 0.15 ? 1500 : 600) : c.role === 'leader' ? 800 : 0);
  picked = G.idleChikns().slice().sort((a, b) => score(b) - score(a)).slice(0, s.slots).map((c) => c.id);
  G.sfx('click');
  ui.render();
};
ui.handlers.exClear = () => { picked = []; ui.render(); };
ui.handlers.exToPick = () => {
  const p = document.getElementById('ex-pick');
  if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
ui.handlers.exStart = (el) => {
  const s = G.expSite(sel), r = G.act.startExp(sel, picked);
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
  const [x, y] = ui.centerOf(el);
  ui.sparks(x, y, '#7be35a', 12);
  G.sfx('up');
  ui.toast(`Team sent to ${s.name}! Back in ${G.fmtTime(s.t)}.`, 'good', 'ui/expeditions');
  picked = [];
  ui.render();
};
ui.handlers.exClaim = (el, e, id) => {
  const run = G.S.exps.find((x) => x.id === id);
  const hadMedic = !!run && teamOf(run.ids).some((c) => c.role === 'medic');
  const r = G.act.claimExp(id);
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
  G.sfx(r.injured && r.injured.length ? 'coin' : 'win');
  ui.render();
  showResults(r, hadMedic);
};
})();
