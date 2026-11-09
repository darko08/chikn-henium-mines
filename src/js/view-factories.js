// Factories screen: "Industrial Processing Hub". Production-flow ribbon (the Ore → HENIUM chain plus the Farm branch),
// factory cards over the hall backdrop with level-based building art (every level is a new, bigger look), timed
// construction behind scaffolding, ore & material inventory, production queue, the global Factory Upgrades and a
// before → after celebration whenever a construction finishes.
(() => {
const G = window.G, D = G.D, ui = G.ui, esc = ui.esc;

const VERB = { crusher: 'Crushing ore', separator: 'Separating ore', smelter: 'Smelting', forge: 'Forging', advanced: 'Assembling',
  refinery: 'Refining Henium', feedmill: 'Milling FEED' };
const STEP = { crusher: 'Crush', separator: 'Separate', smelter: 'Smelt', forge: 'Forge', advanced: 'Assemble', refinery: 'Refine', feedmill: 'Mill' };
// Side branches outside the Ore → HENIUM chain: listed after the chain and marked with their branch instead of a number.
const BRANCH = { feedmill: { label: 'Farm', out: 'feed', note: 'Stone + Crushed Ore → FEED for your Chikns' } };
const CHAIN = D.factories.filter((f) => !BRANCH[f.id]);
const SIDE = D.factories.filter((f) => BRANCH[f.id]);
const UP_ICON = { eff: 'ui/settings', waste: 'prop/rubble', energy: 'ui/energy', slots: 'ui/timer', craft: 'ui/crafting' };
const RAW = [...Object.keys(D.res).filter((r) => D.res[r].cat === 'raw'), 'crushedOre'];
const MATS = Object.keys(D.res).filter((r) => D.res[r].cat === 'mat' && !RAW.includes(r));
let lastEpoch = -1, lastSig = '';

// ---------- helpers ----------
const x2 = (v) => '×' + v.toFixed(2);
const speedOf = (lv) => 1 / D.factorySpeed(lv);
const recOf = (f, rid) => f.recipes.find((r) => r.id === rid) || f.recipes[0];
const slotsUp = D.fUpgrades.find((u) => u.id === 'slots');
const maxSlots = () => G.jobSlots() - G.S.fup.slots + (slotsUp ? slotsUp.max : 0);
const queueFull = () => G.S.jobs.length >= G.jobSlots();
const plainImg = (key, cls = '') => ui.img(key, cls, '');
const stOf = (fid) => G.S.factories[fid];
const artLv = (fid) => Math.max(1, stOf(fid).lv); // an unbuilt building shows its Lv. 1 look (dimmed)
const bImg = (fid, lv, cls = '', alt = '') => ui.img(G.bImg(fid, lv), cls, alt);
// Natural pixel size of an image, read from its WebP header (the art of a higher level is drawn bigger).
const NAT = {};
const natSize = (key) => {
  if (key in NAT) return NAT[key];
  let s = null;
  try {
    const uri = G.img(key), i = uri.indexOf(',');
    const b = atob(uri.slice(i + 1, i + 49)), u = (o) => b.charCodeAt(o), cc = b.slice(12, 16);
    if (cc === 'VP8X') s = [1 + (u(24) | u(25) << 8 | u(26) << 16), 1 + (u(27) | u(28) << 8 | u(29) << 16)];
    else if (cc === 'VP8L') { const v = (u(21) | u(22) << 8 | u(23) << 16 | u(24) << 24) >>> 0; s = [1 + (v & 0x3fff), 1 + ((v >>> 14) & 0x3fff)]; }
    else if (cc === 'VP8 ') s = [(u(26) | u(27) << 8) & 0x3fff, (u(28) | u(29) << 8) & 0x3fff];
  } catch (e) { s = null; }
  return (NAT[key] = s && s[0] > 0 && s[1] > 0 ? s : null);
};
// Size of a building's look relative to its top-level look (0..1), keeping the art's natural size ratio:
// the top level fills the stage width, Lv. 1 stands at about half of it.
const grow = (fid, lv) => {
  const n = D.factoryMaxLv, l = Math.min(n, Math.max(1, lv)), a = natSize(G.bImg(fid, l)), z = natSize(G.bImg(fid, n));
  if (a && z) return +Math.min(1, a[0] / z[0]).toFixed(3);
  return +(0.46 + 0.54 * (l - 1) / Math.max(1, n - 1)).toFixed(3); // fallback if the header can't be read
};
// The looks of a building, one per D.tier() value: [{from, to}] (levels), so nothing assumes a fixed number of looks.
const looks = () => {
  const out = [];
  for (let lv = 1; lv <= D.factoryMaxLv; lv++) {
    const t = D.tier(lv), l = out[out.length - 1];
    if (l && l.t === t) l.to = lv; else out.push({ t, from: lv, to: lv });
  }
  return out;
};
const lookNo = (lv) => looks().findIndex((l) => lv >= l.from && lv <= l.to) + 1;
const newLook = (lv) => lv >= 1 && lv < D.factoryMaxLv && D.tier(lv + 1) > D.tier(lv);
const conLeft = (st) => (st && st.con ? Math.max(0, st.con.dur - st.con.t) : 0);
const finishCost = (st) => 2 * G.speedCost(conLeft(st));
const timer = () => plainImg('ui/timer', 'fx-ti');
// Henium Refinery: HENIUM is your refinery power's share of what the world mints each day (when the core models it).
const REF = () => typeof G.refShare === 'function' && typeof D.refPower === 'function' && typeof G.emission === 'function';
const pctS = (x) => (x > 0 && x < 0.001 ? '<0.1' : (x * 100).toFixed(x < 0.1 ? 1 : 0)) + '%';
const refK = () => { const lv = G.S.factories.refinery.lv; return lv > 0 ? G.myRefPower() / D.refPower(lv) : 1; }; // bonuses on top of the level
const refPowAt = (lv) => Math.round(D.refPower(lv) * refK()); // matches G.myRefPower() at the current level
const refShareAt = (lv) => { const m = D.refPower(lv) * refK(); return m > 0 ? m / (m + G.worldRefPower()) : 0; };
const refDayAt = (lv) => G.emission() * D.supply.split.refinery * refShareAt(lv);
// Feed Mill: grinding is capped by a daily FEED quota (milled today + queued).
const quota = () => ({ cap: G.millQuota(), used: G.S.farm.milled, queued: G.queuedFeed() });
const quotaBlocked = (f, rec) => {
  if (f.id !== 'feedmill') return false;
  const q = quota(), batch = G.recipeOut(f, rec).feed || 0;
  return q.used + q.queued + batch > q.cap;
};
// Everything that changes the markup when it happens outside an action: repeat jobs re-queue themselves after 'jobDone',
// constructions start/finish, digging unlocks factories, a new farm day resets the Feed Mill quota.
const sigOf = () => {
  const S = G.S;
  return S.jobs.map((j) => `${j.id}${j.repeat ? 'r' : ''}`).join() + '|' + G.jobSlots() + '|' +
    D.factories.map((f) => { const st = S.factories[f.id]; return st.lv + (st.con ? '>' + st.con.to : ''); }).join() + '|' + S.depth + '|' + S.farm.day;
};
const FF = '<svg class="fx-ffi" viewBox="0 0 26 16" aria-hidden="true"><path d="M1.5 1.6v12.8L12 8zM13.5 1.6v12.8L24 8z"/></svg>';

// ---------- live binders ----------
// Speed-up price shrinks as the job runs.
ui.binders.fxSpeed = (el, id) => {
  const j = G.S.jobs.find((x) => x.id === +id);
  if (!j) return;
  const c = G.speedCost(j.dur - j.t);
  if (el.dataset.c === String(c)) return;
  el.dataset.c = c; el.dataset.need = 'henium:' + c;
  const n = el.querySelector('.fx-ffn');
  if (n) n.textContent = c;
};
// "Finish now" price of a construction shrinks as it progresses.
ui.binders.fxFinish = (el, fid) => {
  const st = stOf(fid);
  if (!st || !st.con) return;
  const c = finishCost(st);
  if (el.dataset.c === String(c)) return;
  el.dataset.c = c; el.dataset.need = 'henium:' + c;
  const n = el.querySelector('.fx-ffn');
  if (n) n.textContent = c;
};
// The new look rises out of its blueprint as the construction progresses.
ui.binders.fxRise = (el, fid) => {
  const st = stOf(fid);
  el.style.setProperty('--p', st && st.con ? Math.min(1, st.con.t / st.con.dur).toFixed(3) : 1);
};
ui.binders.fxConLeft = (el, fid) => { el.textContent = G.fmtTime(conLeft(stOf(fid))); };
// Compact inventory amount.
ui.binders.fxAmt = (el, r) => { el.textContent = G.fmt(G.S.res[r]); };
// World HENIUM supply bar on the refinery card.
ui.binders.fxSupply = (el) => {
  const w = G.S.world.mined, next = G.nextHalving();
  const fill = el.querySelector('.fx-sfill');
  if (fill) fill.style.width = (w / D.supply.cap * 100) + '%';
  const m = el.querySelector('[data-k="mined"]');
  if (m) m.textContent = G.fmt(w);
  const l = el.querySelector('[data-k="left"]');
  if (l) l.textContent = G.fmt(Math.max(0, next - w));
};
// Feed Mill daily quota: milled today (solid) and queued (striped).
ui.binders.fxQuota = (el) => {
  const q = quota(), pct = (v) => Math.min(100, v / Math.max(1, q.cap) * 100);
  const m = el.querySelector('.fx-qm'), qq = el.querySelector('.fx-qq');
  if (m) m.style.width = pct(q.used) + '%';
  if (qq) { qq.style.left = pct(q.used) + '%'; qq.style.width = Math.max(0, pct(q.used + q.queued) - pct(q.used)) + '%'; }
  const b = el.querySelector('.fx-qbar > b');
  if (b) b.textContent = `${G.fmt(q.used + q.queued)} / ${q.cap} FEED`;
  const u = el.querySelector('[data-k="used"]'), w = el.querySelector('[data-k="queued"]');
  if (u) u.textContent = G.fmt(q.used);
  if (w) w.textContent = G.fmt(q.queued);
};

// ---------- header & production flow ----------
function stepBtn(f) {
  const st = stOf(f.id), con = !!st.con, off = st.lv < 1 && !con, busy = !con && st.lv > 0 && G.activeJob(f.id);
  const tip = `${f.name}${con ? ` (under construction → Lv. ${st.con.to})` : off ? ' (not built)' : ` (Lv. ${st.lv}, ${busy ? 'working' : 'idle'})`}`;
  return `<button type="button" class="fx-step ${off ? 'fx-off' : ''} ${busy ? 'fx-busy' : ''} ${con ? 'fx-bld-step' : ''}" data-a="fxFocus" data-args='["${f.id}"]' title="${esc(tip)}">
    <span class="fx-step-ic">${bImg(f.id, artLv(f.id))}</span><span class="fx-step-l">${esc(STEP[f.id] || f.name)}</span></button>`;
}
const endStep = (res, label, tip, cls = '') => `<div class="fx-step fx-end ${cls}" title="${esc(tip)}"><span class="fx-step-ic">${plainImg('res/' + res)}</span><span class="fx-step-l">${label}</span></div>`;

function flowHTML() {
  const chain = [endStep('stone', 'Ore', 'Raw ore from the mines', 'fx-start'), ...CHAIN.map(stepBtn), endStep('henium', 'HENIUM', 'Refined HENIUM', 'fx-hen')];
  const side = SIDE.map((f) => {
    const b = BRANCH[f.id];
    return `<div class="fx-branch" title="${esc(`${b.label} branch: ${b.note}`)}"><span class="fx-branch-l">${esc(b.label)}</span>
      <div class="fx-chain" style="--n:2">${stepBtn(f)}${endStep(b.out, D.res[b.out].name, `${D.res[b.out].name} for your Chikns`, 'fx-feed')}</div>
      <span class="fx-branch-n">${esc(b.note)}</span></div>`;
  }).join('');
  return `<nav class="fx-flow" aria-label="Production flow"><span class="fx-flow-l">Production flow</span>
    <div class="fx-chain fx-main" style="--n:${chain.length}">${chain.join('')}</div>${side}</nav>`;
}

function headHTML() {
  const S = G.S, built = D.factories.filter((f) => S.factories[f.id].lv > 0).length;
  const building = D.factories.filter((f) => S.factories[f.id].con).length;
  return `<header class="panel fx-head">
    <div class="fx-hl">${plainImg('ui/factories', 'fx-hico')}<div><h1>Industrial Processing Hub</h1>
      <div class="fx-hsub">${built}/${D.factories.length} factories built${building ? ` · <b class="fx-hcon">${building} under construction</b>` : ''} · Production queue ${S.jobs.length}/${G.jobSlots()}</div></div></div>
    ${flowHTML()}
  </header>`;
}

// ---------- factory cards ----------
function recChip(f, rec, built, on) {
  const inp = built ? G.recipeIn(rec) : rec.in;
  const out = built ? G.recipeOut(f, rec) : rec.out;
  const t = built ? rec.t * G.factorySpeed(f) : rec.t;
  const have = (list) => list.map((r) => `<span class="fx-hv" title="${esc(D.res[r].name)} you have">${ui.icon(r, 15)}<b data-b="fxAmt:${r}">${G.fmt(G.S.res[r])}</b></span>`).join('');
  const stock = built || G.S.depth >= f.reqDepth
    ? `<span class="fx-rc-have"><small>You have</small>${have(Object.keys(inp))}<span class="fx-arr">➜</span>${have(Object.keys(out))}</span>` : '';
  const body = `<span class="fx-radio"></span><span class="fx-rc-nt"><b class="fx-rc-n">${esc(rec.name)}</b><span class="fx-rc-t" title="Time per batch">${plainImg('ui/timer')}${G.fmtTime(t)}</span></span>
    <span class="fx-rc-io">${ui.cost(inp, 1, 18)}<span class="fx-arr">➜</span>${ui.rew(out, 18)}</span>${stock}`;
  if (!built || f.recipes.length < 2) return `<div class="fx-rc ${built ? 'fx-on' : ''} fx-solo">${body}</div>`;
  return `<button type="button" class="fx-rc ${on ? 'fx-on' : ''}" data-a="setRecipe" data-args='${esc(JSON.stringify([f.id, rec.id]))}' aria-pressed="${on}" ${on ? '' : `title="Select ${esc(rec.name)}"`}>${body}</button>`;
}

const speedBtn = (j) => {
  if (G.canRush && !G.canRush(j)) return ''; // refinery batches can't be rushed (they pay HENIUM for refining time)
  const c = G.speedCost(j.dur - j.t);
  return `<button type="button" class="btn sm fx-ff" data-a="speedJob" data-args='[${j.id}]' data-b="fxSpeed:${j.id}" data-c="${c}" data-need="henium:${c}"
    title="Speed up: finish this job now for HENIUM" aria-label="Speed up">${FF}<span class="fx-ffn">${c}</span>${ui.icon('henium', 16)}</button>`;
};

// One-line output summary; recipes with many outputs show icons only (amounts in the tooltip).
function outLine(f, rec) {
  const out = G.recipeOut(f, rec), keys = Object.keys(out);
  if (keys.length <= 2) return `<span class="fx-jb-rn">${esc(rec.name)}</span>${ui.rew(out, 16)}`;
  const tip = keys.map((r) => `+${ui.amt(r, out[r])} ${D.res[r].name}`).join(', ');
  return `<span class="fx-jb-rn">${esc(rec.name)}</span><span class="fx-outs" title="${esc(tip)}">${keys.map((r) => ui.icon(r, 16)).join('')}</span>`;
}

function jobBox(f) {
  const j = G.activeJob(f.id), waiting = G.S.jobs.filter((x) => x.f === f.id).length - (j ? 1 : 0);
  if (!j) {
    return `<div class="fx-jb fx-jb-idle"><div class="fx-jb-h"><span class="fx-dot"></span><span class="fx-jb-v">Idle</span></div>
      <div class="fx-jb-row">${ui.bar(0, '', 'Waiting for a job', 'aria-hidden="true"')}</div>
      <div class="fx-jb-out fx-jb-wrap">Pick a recipe, then press <b>Start</b></div></div>`;
  }
  const rec = recOf(f, j.r);
  return `<div class="fx-jb fx-jb-run"><div class="fx-jb-h"><span class="fx-dot fx-on"></span><span class="fx-jb-v">${VERB[f.id] || 'Processing'}…</span>
      ${j.repeat ? '<span class="fx-loop" title="Auto-repeat on">⟳</span>' : ''}${waiting > 0 ? `<span class="fx-wait">+${waiting}</span>` : ''}</div>
    <div class="fx-jb-row">${ui.bar(j.t / j.dur * 100, 'green lg', G.fmtTime(j.dur - j.t), `data-b="job:${j.id}"`)}${speedBtn(j)}</div>
    <div class="fx-jb-out">${outLine(f, rec)}</div></div>`;
}

// Status board while the building is under construction: progress, "Finish now", paused jobs.
function conBox(f) {
  const st = stOf(f.id), c = st.con, cost = finishCost(st), paused = G.S.jobs.filter((j) => j.f === f.id).length;
  return `<div class="fx-jb fx-jb-con">
    <div class="fx-jb-h"><span class="fx-jb-v">Under construction</span></div>
    <div class="fx-con-to">${st.lv > 0 ? `Lv. ${st.lv} ` : ''}➜ <b>Lv. ${c.to}</b>${st.lv > 0 ? '' : ' · new building'}</div>
    ${ui.bar(c.t / c.dur * 100, 'gold lg fx-conbar', G.fmtTime(c.dur - c.t), `data-b="con:${f.id}"`)}
    <button type="button" class="btn sm purple fx-finish" data-a="speedBuild" data-args='["${f.id}"]' data-b="fxFinish:${f.id}" data-c="${cost}" data-need="henium:${cost}"
      title="Finish the construction now for HENIUM">${FF}<span>Finish now</span><span class="fx-ffn">${cost}</span>${ui.icon('henium', 16)}</button>
    ${paused ? `<div class="fx-paused">⏸ ${paused} job${paused > 1 ? 's' : ''} paused</div>` : ''}
  </div>`;
}

function supplyHTML() {
  const S = G.S, w = S.world.mined, cap = D.supply.cap, next = G.nextHalving();
  const marks = D.supply.halvings.map((h) => `<i class="fx-smark ${h === next ? 'fx-next' : w >= h ? 'fx-past' : ''}" style="left:${h / cap * 100}%" title="Halving at ${G.fmt(h)}"></i>`).join('');
  const ref = REF();
  return `<div class="fx-supply" data-b="fxSupply">
    <div class="fx-sup-h">${ui.icon('henium', 22)}<b>HENIUM supply</b><span class="tag p">Epoch ${G.epoch() + 1}</span><span class="fx-yield" ${ref ? `title="The whole world mints ${G.fmt(G.emission())} HENIUM a day in this epoch"` : ''}>${ref ? `${G.fmt(G.emission())}/day` : `Yield ×${G.halving()}`}</span></div>
    <div class="fx-sbar"><i class="fx-sfill" style="width:${w / cap * 100}%"></i>${marks}</div>
    <div class="fx-sup-f"><span><b data-k="mined">${G.fmt(w)}</b> / ${G.fmt(cap)} mined</span><span>Next halving ${G.fmt(next)} · <b data-k="left">${G.fmt(Math.max(0, next - w))}</b> left</span></div>
    ${ref ? `<div class="fx-sup-f fx-sup-me"><span>Your refining share <b>${pctS(G.refShare())}</b></span><span>≈ <b>${G.fmt(G.refPerDay(), 2)}</b> HENIUM a day</span></div>` : ''}
  </div>`;
}

function quotaHTML() {
  const q = quota(), pct = (v) => Math.min(100, v / Math.max(1, q.cap) * 100);
  return `<div class="fx-quota" data-b="fxQuota">
    <div class="fx-q-h">${ui.icon('feed', 22)}<b>Daily FEED quota</b><span class="fx-q-new" title="Time until the next farm day resets the quota">New day ${timer()}<span data-b="farmday">${G.fmtTime(G.farmDayLeft())}</span></span></div>
    <div class="fx-qbar"><i class="fx-qm" style="width:${pct(q.used)}%"></i><i class="fx-qq" style="left:${pct(q.used)}%;width:${Math.max(0, pct(q.used + q.queued) - pct(q.used))}%"></i><b>${G.fmt(q.used + q.queued)} / ${q.cap} FEED</b></div>
    <div class="fx-q-f"><span><b data-k="used">${G.fmt(q.used)}</b> milled · <b data-k="queued">${G.fmt(q.queued)}</b> queued · your share of the world pool</span>
      <button type="button" class="fx-farm" data-a="nav" data-args='["farm"]' title="Open the Egg Farm">${plainImg('farm/nest')}Farm ›</button></div>
  </div>`;
}

function plate(f, right) {
  const b = BRANCH[f.id];
  const num = b ? `<span class="fx-num fx-num-b" title="${esc(b.label)} branch">${ui.icon(b.out, 26)}</span>` : `<span class="fx-num">${CHAIN.indexOf(f) + 1}</span>`;
  return `<header class="fx-plate">${num}<div class="fx-ct"><h3>${esc(f.name)}</h3><div class="fx-desc">${b ? `<span class="fx-btag">${esc(b.label)}</span>` : ''}${esc(f.desc)}</div></div>${right}</header>`;
}

// The building on its plot. Its size grows with the level; under construction the target look rises out of its
// blueprint behind scaffolding, hazard tape, a crane and dust. Click it to see every look of the building.
function stageHTML(f, on) {
  const st = stOf(f.id), c = st.con, lv = c ? c.to : artLv(f.id);
  const inner = c
    ? `<span class="fx-bld fx-rising" data-b="fxRise:${f.id}" style="--p:${Math.min(1, c.t / c.dur).toFixed(3)}">${bImg(f.id, lv, 'fx-art fx-ghost')}${bImg(f.id, lv, 'fx-art fx-rise', `${f.name} Lv. ${lv} under construction`)}<span class="fx-scaf"></span><span class="fx-line"></span>
        <span class="fx-crane" aria-hidden="true">🏗️</span><span class="fx-hammer" aria-hidden="true">🔨</span></span>
      <span class="fx-tape" aria-hidden="true"></span><span class="fx-dust" aria-hidden="true"><i></i><i></i><i></i></span>`
    : `<span class="fx-bld">${bImg(f.id, lv, 'fx-art', `${f.name} Lv. ${lv}`)}</span>`;
  return `<button type="button" class="fx-stage ${on ? 'fx-on' : ''} ${c ? 'fx-building' : ''}" style="--g:${grow(f.id, lv)}" data-a="fxLooks" data-args='["${f.id}"]'
    title="${esc(f.name)}: see all ${looks().length} looks"><span class="fx-glow"></span>${inner}<span class="fx-looks-hint">${looks().length} looks</span></button>`;
}

function upgradeHTML(f, lv) {
  const cost = D.factoryUpCost(f, lv), nx = lv + 1, t = G.fmtTime(D.buildTime(nx));
  return `<div class="fx-upg">
    <button type="button" class="fx-next" data-a="fxLooks" data-args='["${f.id}",${nx}]' title="Preview the Lv. ${nx} look">${bImg(f.id, nx, 'fx-next-img', `${f.name} Lv. ${nx}`)}${newLook(lv) ? '<span class="fx-newtag">New look!</span>' : ''}</button>
    <div class="fx-upg-m">
      <div class="fx-upg-h"><b>Next: Lv. ${nx}</b><span class="fx-bt" title="Construction time">${timer()}${t}</span></div>
      <div class="fx-upg-s">${f.id === 'refinery' && REF() ? `Power <em>${refPowAt(lv)} ➜ ${refPowAt(nx)}</em> · ≈ <em>${G.fmt(refDayAt(nx), 1)}</em> HENIUM/day`
        : `Speed <em>${x2(speedOf(nx))}</em> · Yield <em>${x2(D.factoryYield(nx))}</em>${f.id === 'feedmill' ? ` · Quota <em>${D.farm.millQuota(nx)}/day</em>` : ''}`}</div>
    </div>
    <div class="fx-upg-f">${ui.cost(cost, 1, 16)}${ui.btn('▲ Upgrade', 'upgradeFactory', [f.id], 'gold sm fx-upbtn', cost, `title="Upgrade the ${esc(f.name)} to Lv. ${nx}: construction takes ${t}"`)}</div>
  </div>`;
}

function buildHTML(f) {
  const t = G.fmtTime(D.buildTime(1));
  return `<div class="fx-upg fx-upg-build">
    <div class="fx-upg-m"><div class="fx-upg-h"><b>Build Lv. 1</b><span class="fx-bt" title="Construction time">${timer()}${t}</span></div>
      <div class="fx-upg-s">Construction takes time. Jobs can start once it stands.</div></div>
    <div class="fx-upg-f">${ui.cost(f.build, 1, 16)}${ui.btn('🔨 Build', 'build', [f.id], 'green sm fx-upbtn', f.build, `title="Build the ${esc(f.name)}: construction takes ${t}"`)}</div>
  </div>`;
}

// Upgrade row while a construction runs: the button says so.
function conFootHTML(f) {
  const st = stOf(f.id), c = st.con;
  return `<div class="fx-upg fx-upg-con">
    <span class="fx-upg-ic" aria-hidden="true">🏗️</span>
    <div class="fx-upg-m"><div class="fx-upg-h"><b>${st.lv > 0 ? 'Upgrading to' : 'Building'} Lv. ${c.to}</b></div>
      <div class="fx-upg-s">${timer()}<span data-b="fxConLeft:${f.id}">${G.fmtTime(conLeft(st))}</span> left${st.lv > 0 ? ' · jobs paused' : ''}</div></div>
    <button type="button" class="btn sm gray fx-upbtn" disabled title="A construction is already in progress">🚧 Under construction</button>
  </div>`;
}

function cardHTML(f) {
  const S = G.S, st = S.factories[f.id], lv = st.lv, con = st.con;
  if (lv < 1 && !con) {
    const can = S.depth >= f.reqDepth;
    return `<article class="fx-card ${can ? 'fx-new' : 'fx-locked'}" id="fx-${f.id}" style="--acc:${f.accent}">
      <div class="fx-scene">${plate(f, can ? '<span class="fx-lv fx-lv-new">Not built</span>' : `<span class="fx-lv fx-lv-lock">${plainImg('ui/lock')}Locked</span>`)}
        ${stageHTML(f, false)}
        <div class="fx-status">${can
          ? `<div class="fx-jb fx-jb-ready"><div class="fx-jb-h"><span class="fx-dot fx-ready"></span>Ready to build!</div><div class="fx-jb-hint">Unlocks ${f.recipes.map((r) => `<b>${esc(r.name)}</b>`).join(' & ')}.</div></div>`
          : `<div class="fx-jb fx-lockbox">${plainImg('ui/lock', 'fx-lk')}<div><b>Requires depth ${f.reqDepth}</b><small>You are at depth ${S.depth}</small></div></div>`}
        </div></div>
      <div class="fx-body">
        <div class="fx-recs">${f.recipes.map((r) => recChip(f, r, false, false)).join('')}</div>
        <div class="fx-foot">${can ? buildHTML(f)
          : `<button type="button" class="btn gray block" data-a="nav" data-args='["mines"]'>${plainImg('ui/mines')}Dig to depth ${f.reqDepth}</button>`}</div>
      </div>
    </article>`;
  }
  const built = lv > 0, rec = recOf(f, st.recipe), max = lv >= D.factoryMaxLv, full = queueFull(), j = !con && built && G.activeJob(f.id);
  const inCost = G.recipeIn(rec), qBlock = built && quotaBlocked(f, rec), stop = !!con || full || qBlock;
  const why = con ? 'Jobs pause while the building is under construction' : full ? 'Production queue is full: wait for a job to finish or unlock a slot'
    : qBlock ? "Today's FEED quota is used up: it resets on the next farm day" : '';
  const startLabel = con ? '⏸ Paused' : full ? 'Queue full' : qBlock ? 'Quota used' : '▶ Start';
  const stat = (label, now, tip) => `<span class="fx-stat" title="${tip}">${label} <b>${now}</b></span>`;
  const lvBadge = con ? `<span class="fx-lv fx-lv-con" title="Under construction">${built ? `Lv. ${lv}<i>➜</i>${con.to}` : `Lv. ${con.to}`}</span>`
    : `<span class="fx-lv">Lv. ${lv}<small>/${D.factoryMaxLv}</small></span>`;
  return `<article class="fx-card ${con ? 'fx-con' : j ? 'fx-run' : 'fx-idle'} ${built ? '' : 'fx-first'}" id="fx-${f.id}" style="--acc:${f.accent}">
    <div class="fx-scene">${plate(f, lvBadge)}
      ${stageHTML(f, !!j)}
      <div class="fx-status">${con ? conBox(f) : jobBox(f)}
        ${con ? '' : `<div class="fx-stats">${f.id === 'refinery' && REF()
          ? stat('Power', G.fmt(G.myRefPower()), 'Refinery power: it decides your share of the HENIUM the world mints each day') + stat('Share', pctS(G.refShare()), 'Your share of the world refinery power')
          : stat('Speed', x2(speedOf(lv)), 'Production speed from the factory level') + stat('Yield', x2(D.factoryYield(lv)), 'Output multiplier from the factory level')}</div>`}</div></div>
    <div class="fx-body">
      <div class="fx-recs">${f.recipes.map((r) => recChip(f, r, built, built && r.id === rec.id)).join('')}</div>
      ${built && f.id === 'refinery' ? supplyHTML() : ''}${built && f.id === 'feedmill' ? quotaHTML() : ''}
      <div class="fx-foot">
        ${built ? `<div class="fx-acts">
          ${ui.btn(startLabel, 'queue', [f.id, rec.id, false], 'green' + (stop ? ' cant' : ''), stop ? null : inCost, `title="${esc(why || 'Queue one batch of ' + rec.name)}"`)}
          ${ui.btn('⟳ Auto-repeat', 'queue', [f.id, rec.id, true], 'purple' + (stop ? ' cant' : ''), stop ? null : inCost, `title="${esc(why || 'Queue a batch that restarts itself when done')}"`)}
        </div>` : ''}
        ${con ? conFootHTML(f) : max ? '<div class="fx-upg fx-upg-max"><span class="fx-maxed">★ Max level reached: the grandest look</span></div>' : upgradeHTML(f, lv)}
      </div>
    </div>
  </article>`;
}

function hallHTML() {
  const branch = SIDE.length ? `<div class="fx-sep" role="presentation"><span class="fx-sep-l">${ui.icon('feed', 24)}Farm branch</span><small>${esc(SIDE.map((f) => BRANCH[f.id].note).join(' · '))}</small></div>` : '';
  return `<section class="fx-hall" aria-label="Factories" style="background-image:linear-gradient(180deg,rgba(16,10,40,.28),rgba(12,8,30,.62)),url(${G.img('bg/hall')})">
    <div class="fx-cards">${CHAIN.map(cardHTML).join('')}${branch}${SIDE.map(cardHTML).join('')}</div></section>`;
}

// ---------- side: inventory ----------
function invHTML() {
  const item = (r) => `<div class="fx-it" title="${esc(D.res[r].name)}">${ui.icon(r, 30)}<div class="fx-it-t"><b data-b="fxAmt:${r}">${G.fmt(G.S.res[r])}</b><small>${esc(D.res[r].name)}</small></div></div>`;
  return `<section class="panel fx-inv" aria-label="Inventory">
    <div class="panel-h">${plainImg('prop/cartStone')}<span class="sp">Raw Ore Inventory</span></div>
    <div class="fx-invgrid">${RAW.map(item).join('')}</div>
    <div class="panel-h fx-sub">${plainImg('prop/crate')}<span class="sp">Processed Materials</span></div>
    <div class="fx-invgrid">${MATS.map(item).join('')}</div>
  </section>`;
}

// ---------- production queue ----------
function jobTile(j) {
  const f = D.factoryById(j.f), rec = recOf(f, j.r), out = G.recipeOut(f, rec), active = G.activeJob(f.id) === j, paused = !!stOf(f.id).con;
  const keys = Object.keys(out), single = keys.length === 1;
  const icon = single ? ui.icon(keys[0], 40) : bImg(f.id, artLv(f.id), 'fx-jt-fac', f.name);
  const amt = single ? '+' + ui.amt(keys[0], out[keys[0]]) : keys.length + ' outputs';
  const bar = paused ? ui.bar(active ? j.t / j.dur * 100 : 0, 'fx-pbar', '⏸ Paused · building', `title="The ${esc(f.name)} is under construction"`)
    : ui.bar(active ? j.t / j.dur * 100 : 0, active ? 'green' : 'blue', active ? G.fmtTime(j.dur - j.t) : 'Queued', `data-b="job:${j.id}"`);
  return `<div class="fx-jt ${paused ? 'fx-paused-t' : active ? 'fx-on' : 'fx-wait'}" style="--acc:${f.accent}">
    <div class="fx-jt-top"><span class="fx-jt-ic">${icon}</span><div class="fx-jt-name"><b>${esc(rec.name)}</b><small>${esc(f.name)} · ${amt}</small></div>
      <button type="button" class="fx-x" data-a="cancelJob" data-args='[${j.id}]' title="Cancel job (full refund before it starts, ${Math.round(D.rules.refund * 100)}% after)" aria-label="Cancel ${esc(rec.name)} job">✕</button></div>
    ${bar}
    <div class="fx-jt-btns"><button type="button" class="fx-rep ${j.repeat ? 'fx-on' : ''}" data-a="toggleRepeat" data-args='[${j.id}]' aria-pressed="${!!j.repeat}" title="Auto-repeat this job">⟳ <span class="fx-rep-w">Repeat</span> <span class="fx-rep-s">${j.repeat ? 'on' : 'off'}</span></button>${paused ? '' : speedBtn(j)}</div>
  </div>`;
}

function queueHTML() {
  const S = G.S, slots = G.jobSlots();
  let empty = '';
  for (let i = S.jobs.length; i < slots; i++) empty += `<button type="button" class="fx-add" data-a="fxAddJob"><span class="fx-plus">+</span><span>Add Job</span></button>`;
  const lock = slots < maxSlots() ? `<button type="button" class="fx-add fx-add-lock" data-a="fxGoUp" data-args='["slots"]' title="Buy a Queue Slot in Factory Upgrades">${plainImg('ui/lock', 'fx-lk')}<span>Unlock slot</span></button>` : '';
  return `<section class="panel fx-queue" id="fx-queue" aria-label="Production queue">
    <div class="panel-h">${plainImg('ui/timer')}<span class="sp">Production Queue <span class="fx-cnt">(${S.jobs.length}/${slots})</span></span><small class="fx-qnote">1 job per factory runs at a time</small></div>
    <div class="fx-qgrid">${S.jobs.map(jobTile).join('')}${empty}${lock}</div>
  </section>`;
}

// ---------- factory upgrades ----------
function upgradesHTML() {
  const S = G.S;
  const tiles = D.fUpgrades.map((u) => {
    const lv = S.fup[u.id] || 0, max = lv >= u.max, m = u.desc.match(/^([+\-−])(\d+)(%?)\s*(.*)$/);
    const now = m ? `${m[1]}${lv * u.per}${m[3]}` : `Lv. ${lv}`, next = m ? `${m[1]}${(lv + 1) * u.per}${m[3]}` : '';
    const cost = max ? null : D.fUpCost(u, lv);
    return `<div class="fx-up ${max ? 'fx-max' : ''}" id="fx-up-${u.id}">
      <span class="fx-up-ic">${plainImg(UP_ICON[u.id] || 'ui/settings')}</span>
      <div class="fx-up-t"><div class="fx-up-n"><b>${esc(u.name)}</b><small>Lv. ${lv}/${u.max}</small></div>
        <div class="fx-pips" aria-hidden="true">${Array.from({ length: u.max }, (_, k) => `<i class="${k < lv ? 'fx-on' : ''}"></i>`).join('')}</div>
        <div class="fx-up-e"><b>${now}</b>${max ? '' : `<i>➜ ${next}</i>`}<small>${esc(m ? m[4] : u.desc)}</small></div></div>
      <div class="fx-up-buy">${max ? '<span class="fx-maxed">★ Maxed</span>' : ui.btn('▲ Buy', 'fUpgrade', [u.id], 'green sm', cost) + ui.cost(cost, 1, 16)}</div>
    </div>`;
  }).join('');
  return `<section class="panel fx-ups" id="fx-ups" aria-label="Factory upgrades">
    <div class="panel-h">${plainImg('ui/factories')}<span class="sp">Factory Upgrades</span><small>Apply to every factory</small></div>
    <div class="fx-upgrid">${tiles}</div></section>`;
}

// ---------- view ----------
ui.views.factories = {
  render(el) {
    lastEpoch = G.epoch(); lastSig = sigOf();
    el.innerHTML = `<div class="fx-wrap"><div class="fx-grid">
      ${headHTML()}${hallHTML()}
      <aside class="fx-side">${invHTML()}${queueHTML()}</aside>
      ${upgradesHTML()}
    </div></div>`;
  },
  update() {
    // re-render when the queue or a building changed outside an action (a repeat job re-queued itself, a construction
    // finished, a new farm day) or a HENIUM halving just changed the refinery yield
    if (sigOf() !== lastSig || G.epoch() !== lastEpoch) ui.render();
  },
};

// 'jobDone' fires before a repeat job is re-queued; render again once finishJob has returned.
let healQueued = false;
G.on('jobDone', () => {
  if (healQueued) return;
  healQueued = true;
  queueMicrotask(() => { healQueued = false; if (ui.cur === 'factories') ui.render(); });
});

// ---------- celebration: every finished construction is a new look ----------
function showCard(fid) {
  if (ui.cur !== 'factories') ui.go('factories');
  setTimeout(() => focusCards([fid]), 60);
}
function celebrate({ f, lv, from }) {
  const first = !from, before = first ? 1 : from;
  const k = Math.max(0.45, Math.min(0.9, grow(f.id, before) / grow(f.id, lv) * 0.86)); // the old look, a bit smaller than the new one
  const stat = (label, a, b) => `<span class="fx-cel-st"><small>${label}</small><b>${a}</b><i>➜</i><b class="fx-cel-new">${b}</b></span>`;
  const rows = first
    ? `<span class="fx-cel-st fx-cel-unl"><small>Unlocks</small><b>${f.recipes.map((r) => esc(r.name)).join(' & ')}</b></span>`
    : f.id === 'refinery' && REF()
      ? stat('Power', refPowAt(from), refPowAt(lv)) + stat('HENIUM a day', '≈' + G.fmt(refDayAt(from), 1), '≈' + G.fmt(refDayAt(lv), 1)) + stat('Speed', x2(speedOf(from)), x2(speedOf(lv)))
      : stat('Speed', x2(speedOf(from)), x2(speedOf(lv))) + stat('Yield', x2(D.factoryYield(from)), x2(D.factoryYield(lv))) +
        (f.id === 'feedmill' ? stat('FEED quota', D.farm.millQuota(from), D.farm.millQuota(lv) + '/day') : '');
  const fresh = first || D.tier(lv) > D.tier(from);
  ui.modal({
    title: first ? `${esc(f.name)} is built!` : `${esc(f.name)} reached Lv. ${lv}!`,
    actions: [{ label: 'Show me', cls: 'gray', fn: () => showCard(f.id) }, { label: 'Awesome!', cls: 'green lg' }],
    html: `<div class="fx-cel" style="--acc:${f.accent};--k:${k.toFixed(3)}">
      <div class="fx-cel-cmp">
        <figure class="fx-cel-b">${bImg(f.id, before, 'fx-cel-img' + (first ? ' fx-ghost' : ''), first ? 'Blueprint' : `${f.name} Lv. ${from}`)}<figcaption>${first ? 'Blueprint' : `Lv. ${from}`}</figcaption></figure>
        <span class="fx-cel-arr" aria-hidden="true">➜</span>
        <figure class="fx-cel-a"><span class="fx-cel-rays"></span><span class="fx-cel-glow"></span>${bImg(f.id, lv, 'fx-cel-img', `${f.name} Lv. ${lv}`)}<figcaption>Lv. ${lv}</figcaption></figure>
      </div>
      <div class="fx-cel-h">${fresh ? '<span class="fx-newtag fx-static">New look!</span>' : ''}<b>Look ${lookNo(lv)} of ${looks().length}</b>${lv < D.factoryMaxLv ? `<span class="dim">Next look at Lv. ${lv + 1}</span>` : '<span class="fx-maxed">★ The grandest look</span>'}</div>
      <div class="fx-cel-stats">${rows}</div>
    </div>`,
  });
  G.sfx('level');
  requestAnimationFrame(() => {
    const a = document.querySelector('.fx-cel-a .fx-cel-img');
    if (!a) return;
    const [x, y] = ui.centerOf(a);
    ui.sparks(x, y, '#ffd54a', 16); ui.sparks(x, y - 20, f.accent, 10);
  });
}
// Registered once at load; reacts only while a game runs. The dialog opens after every other 'built' listener has run
// (main.js re-renders the Mines/Farm only while no dialog is open). Never stacks dialogs: with one open, it becomes a notification.
G.on('built', (e) => {
  if (!G.S || !e || !e.f) return;
  if (ui.cur === 'factories') ui.render(); // the card leaves its construction state
  const S = G.S;
  setTimeout(() => {
    if (G.S !== S) return; // a new game was started meanwhile
    if (ui.modalOpen()) {
      G.emit('note', { text: e.from ? `${e.f.name} upgraded to Lv. ${e.lv}: a new look!` : `${e.f.name} is built!`, icon: G.bImg(e.f.id, e.lv), good: true });
      G.sfx('up');
      return;
    }
    celebrate(e);
  }, 0);
});

// ---------- handlers ----------
const pulse = (els) => els.forEach((e) => {
  e.classList.remove('fx-pulse'); void e.offsetWidth; e.classList.add('fx-pulse');
  setTimeout(() => e.classList.remove('fx-pulse'), 1800);
});
const focusCards = (ids) => {
  const cards = ids.map((id) => document.getElementById('fx-' + id)).filter(Boolean);
  if (!cards.length) return false;
  cards[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  pulse(cards);
  return true;
};
ui.handlers.fxFocus = (el, e, fid) => { if (focusCards([fid])) G.sfx('click'); };
ui.handlers.fxAddJob = () => {
  const S = G.S, built = D.factories.filter((f) => S.factories[f.id].lv > 0 && !S.factories[f.id].con);
  const idle = built.filter((f) => !G.activeJob(f.id));
  if (!built.length) {
    const can = D.factories.filter((f) => S.depth >= f.reqDepth && S.factories[f.id].lv < 1).map((f) => f.id);
    if (focusCards(can.length ? can.slice(0, 1) : [D.factories[0].id])) ui.toast(D.factories.some((f) => S.factories[f.id].con) ? 'Your factory is still under construction' : 'Build your first factory to start production', '', 'ui/factories');
    return;
  }
  focusCards((idle.length ? idle : built).map((f) => f.id));
  ui.toast(idle.length ? `Pick a factory and press Start (${idle.length} idle)` : 'All factories are busy: queue another batch', '', 'ui/factories');
  G.sfx('click');
};
ui.handlers.fxGoUp = (el, e, uid) => {
  const t = document.getElementById('fx-up-' + uid);
  if (!t) return;
  t.scrollIntoView({ behavior: 'smooth', block: 'center' });
  pulse([t]);
  G.sfx('click');
};
// Gallery of every look of a building: the ones you own, the next one, and silhouettes of what is still to come.
ui.handlers.fxLooks = (el, e, fid, focus) => {
  const f = D.factoryById(fid), st = stOf(fid), L = looks(), cur = st.lv, to = st.con ? st.con.to : 0;
  const cells = L.map((l) => {
    const range = l.from === l.to ? `Lv. ${l.from}` : `Lv. ${l.from}–${l.to}`;
    const isCur = cur >= l.from && cur <= l.to, owned = cur >= l.from, building = !owned && to >= l.from, next = !owned && !building && cur + 1 >= l.from;
    const hidden = !owned && !building && !next;
    const tag = isCur ? '<span class="tag g">Current</span>' : building ? '<span class="tag o">Building</span>' : next ? '<span class="tag p">Next</span>' : owned ? '<span class="tag">Owned</span>' : '';
    return `<div class="fx-look ${owned ? 'fx-own' : ''} ${isCur ? 'fx-cur' : ''} ${hidden ? 'fx-mys' : ''} ${focus >= l.from && focus <= l.to ? 'fx-foc' : ''}" style="--g:${grow(fid, l.from)}">
      <div class="fx-look-art"><span class="fx-look-glow"></span>${bImg(fid, l.from, 'fx-look-img', hidden ? `${f.name} ${range}: still a secret` : `${f.name} ${range}`)}${hidden ? '<span class="fx-q">?</span>' : ''}</div>
      <div class="fx-look-c"><b>${range}</b>${tag}</div></div>`;
  }).join('');
  ui.modal({ title: `${bImg(fid, artLv(fid))} ${esc(f.name)} · ${L.length} looks`, wide: true, actions: [{ label: 'Close', cls: 'gray' }],
    html: `<p class="muted fx-looks-p">Every upgrade rebuilds the ${esc(f.name)} in a grander style. ${cur > 0 ? `You own <b>${lookNo(cur)}</b> of ${L.length}.` : 'Build it to unlock the first look.'}</p>
      <div class="fx-looks" style="--acc:${f.accent}">${cells}</div>` });
  G.sfx('click');
  const foc = document.querySelector('.fx-look.fx-foc');
  if (foc) foc.scrollIntoView({ block: 'nearest' });
};
})();
