// Crafting screen: machine list, selected machine with its crafting tree (inputs -> machine), crafting queue,
// mine floor coverage and the player's machines (deploy / upgrade / service).
(() => {
const G = window.G, D = G.D, ui = G.ui, esc = ui.esc;
const NH = 44, NG = 8; // crafting-tree input node height & gap (px); the SVG links are computed from these
let sel = null, lastSig = '';

// ---------- helpers ----------
const tierOf = (m) => D.machines.indexOf(m) + 1;
const isLocked = (m) => G.S.player.lv < m.lv;
const craftTime = (m) => m.t / (1 + G.bonus('craft'));
const ownedOf = (id) => G.S.machines.filter((x) => x.type === id).length;
const plainImg = (key, cls = '') => ui.img(key, cls, '');
const FF = '<svg class="cr-ffi" viewBox="0 0 26 16" aria-hidden="true"><path d="M1.5 1.6v12.8L12 8zM13.5 1.6v12.8L24 8z"/></svg>';
const statsAt = (m, lv, zone = null) => G.machineStats({ type: m.id, lv, dur: 100, zone });
const pickDefault = () => { const open = D.machines.filter((m) => !isLocked(m)); return (open[open.length - 1] || D.machines[0]).id; };
// Crafts and owned machines as rendered; if they change outside an action, re-render.
const sig = () => G.S.crafts.map((c) => c.id).join() + '|' + G.S.machines.map((m) => `${m.id}:${m.zone || ''}:${m.lv}:${m.off ? 1 : 0}${m.dur > 0 ? 1 : 0}`).join() + '|' + G.S.player.lv +
  '|' + D.factories.map((f) => G.S.factories[f.id].lv).join(); // source icons show each factory's current look
const selected = () => { if (!sel || !D.machineById(sel)) sel = pickDefault(); return D.machineById(sel); };

// The building art at the player's current level of that factory (its Lv. 1 look while unbuilt).
const facArt = (fid) => G.bImg(fid, Math.max(1, G.S.factories[fid] ? G.S.factories[fid].lv : 1));

// Where a crafting input comes from: raw ore -> its mine zone, processed -> the factory that makes it.
function sourceOf(r) {
  const S = G.S, cat = D.res[r] ? D.res[r].cat : '';
  if (cat === 'raw') {
    const z = D.zones.find((x) => x.res === r);
    if (!z) return { icon: 'ui/mines', label: 'Mines' };
    if (G.zoneOpen(z)) return { icon: 'ui/mines', label: z.name, tip: `Mined in the ${z.name} (depth ${z.from}–${z.to})` };
    const alt = D.factories.find((f) => S.factories[f.id].lv > 0 && f.recipes.some((rec) => rec.out[r]));
    return { icon: alt ? facArt(alt.id) : 'ui/lock', label: alt ? `${alt.name}` : `${z.name} · depth ${z.from}`, lock: !alt,
      tip: `${z.name} opens at depth ${z.from}${alt ? `; until then the ${alt.name} produces it` : ''}` };
  }
  if (r === 'egg') return { icon: 'farm/nest', label: 'Chikn Nest', tip: 'Only Chikns lay EGG, about one a day each' };
  const f = D.factories.find((x) => x.recipes.some((rec) => rec.out[r]));
  if (f) return { icon: facArt(f.id), label: f.name, lock: S.factories[f.id].lv < 1, tip: `Made in the ${f.name}${S.factories[f.id].lv > 0 ? ` (Lv. ${S.factories[f.id].lv})` : ' (not built yet)'}` };
  return { icon: 'ui/market', label: 'Market', tip: 'Buy it on the Market' };
}

// ---------- live binders ----------
ui.binders.crNeed = (el, arg) => { // have/need on a tree input; also recolours its link
  const [r, need] = arg.split(':'), have = G.S.res[r], ok = have + 1e-9 >= +need;
  const h = el.querySelector('.cr-have');
  if (h) h.textContent = G.fmt(have);
  if (el.classList.contains('cr-ok') === ok) return;
  el.classList.toggle('cr-ok', ok); el.classList.toggle('cr-lack', !ok);
  const p = document.getElementById('cr-l-' + r);
  if (p) p.setAttribute('class', 'cr-link ' + (ok ? 'cr-ok' : 'cr-lack'));
};
ui.binders.crSpeed = (el, id) => { // speed-up price shrinks as the craft progresses
  const c = G.S.crafts.find((x) => x.id === +id);
  if (!c) return;
  const cost = G.speedCost(c.dur - c.t);
  if (el.dataset.c === String(cost)) return;
  el.dataset.c = cost; el.dataset.need = 'henium:' + cost;
  const n = el.querySelector('.cr-ffn');
  if (n) n.textContent = cost;
};
ui.binders.crSvc = (el, id) => { // service price grows as the machine wears
  const m = G.S.machines.find((x) => x.id === +id);
  if (!m) return;
  const c = D.machineServiceCost(m.dur), key = ui.need(c);
  if (el.dataset.k === key) return;
  el.dataset.k = key;
  el.innerHTML = ui.cost(c, 1, 15);
  const b = el.parentElement && el.parentElement.querySelector('[data-a="service"]');
  if (b) b.dataset.need = key;
};

// ---------- header ----------
function headHTML() {
  const S = G.S, open = D.zones.filter((z) => G.zoneOpen(z));
  const covered = open.filter((z) => G.machineOn(z.id)).length, bonus = G.bonus('craft');
  return `<header class="panel cr-head">
    <div class="cr-hl">${plainImg('ui/crafting', 'cr-hico')}<div><h1>Crafting Workshop</h1><div class="cr-hsub">Craft drills and machines, then deploy them on your mine floors.</div></div></div>
    <div class="cr-chips">
      <span class="cr-chip">${plainImg('machine/heavy')}<span><b>${S.machines.length}</b><small>Machines</small></span></span>
      <span class="cr-chip">${plainImg('ui/mines')}<span><b>${covered}/${open.length}</b><small>Floors equipped</small></span></span>
      <span class="cr-chip">${plainImg('chikn/crafter')}<span><b>+${Math.round(bonus * 100)}%</b><small>Craft speed</small></span></span>
    </div>
  </header>`;
}

// ---------- machine list ----------
function listHTML() {
  const S = G.S, m0 = selected();
  const items = D.machines.map((m) => {
    const lk = isLocked(m), own = ownedOf(m.id), on = m === m0;
    return `<button type="button" class="cr-mi ${on ? 'cr-sel' : ''} ${lk ? 'cr-locked' : ''}" data-a="crSel" data-args='["${m.id}"]' aria-pressed="${on}">
      <span class="cr-mi-art">${ui.img('machine/' + m.id, 'cr-mi-img', m.name)}${lk ? plainImg('ui/lock', 'cr-mi-lock') : ''}<span class="cr-mi-own ${own ? '' : 'cr-zero'}" title="Owned: ${own}">×${own}</span></span>
      <span class="cr-mi-t"><b>${esc(m.name)}</b><small><span class="cr-tier">Tier ${tierOf(m)}</span><span class="${lk ? 'cr-req' : ''}">Req. Lv. ${m.lv}</span></small></span>
    </button>`;
  }).join('');
  return `<section class="panel cr-list" aria-label="Machines">
    <div class="panel-h">${plainImg('ui/settings')}<span class="sp">Machines</span><small>${D.machines.filter((m) => !isLocked(m)).length}/${D.machines.length} unlocked</small></div>
    <div class="cr-mlist">${items}</div>
    <div class="cr-lvnote">Your level: <b>Lv. ${S.player.lv}</b></div>
  </section>`;
}

// ---------- selected machine: crafting tree + stats ----------
function inputNode(r, need) {
  const have = G.S.res[r], ok = have + 1e-9 >= need, s = sourceOf(r);
  return `<div class="cr-in ${ok ? 'cr-ok' : 'cr-lack'}" data-b="crNeed:${r}:${need}">
    <span class="cr-in-ic">${ui.icon(r, 30)}</span>
    <div class="cr-in-t">
      <div class="cr-in-l1"><b>${esc(D.res[r].name)}</b><span class="cr-hn"><span class="cr-have">${G.fmt(have)}</span>/${G.fmt(need)}</span></div>
      <div class="cr-in-src ${s.lock ? 'cr-lk' : ''}" ${s.tip ? `title="${esc(s.tip)}"` : ''}>${plainImg(s.icon, 'cr-src-ic')}<span>${esc(s.label)}</span></div>
    </div>
  </div>`;
}

function craftBtn(m) {
  const S = G.S, time = G.fmtTime(craftTime(m));
  if (isLocked(m)) return `<button type="button" class="btn gray lg cr-craft cant" data-a="craft" data-args='["${m.id}"]'>${plainImg('ui/lock')}<span>Requires</span><span>Lv. ${m.lv}</span></button>`;
  const full = S.crafts.length >= S.craftSlots;
  return ui.btn(full ? '<span>Queue</span><span>full</span>' : `<span>Craft</span><span>(${time})</span>`, 'craft', [m.id], 'green lg cr-craft' + (full ? ' cant' : ''), full ? null : m.cost,
    `title="${full ? 'The crafting queue is full' : `Craft a ${esc(m.name)} (${time})`}"`);
}

function treeHTML(m) {
  const cost = m.cost, keys = Object.keys(cost), n = keys.length, H = n * NH + (n - 1) * NG;
  const links = keys.map((r, i) => {
    const y = i * (NH + NG) + NH / 2, ok = G.S.res[r] + 1e-9 >= cost[r];
    return `<path id="cr-l-${r}" class="cr-link ${ok ? 'cr-ok' : 'cr-lack'}" d="M0 ${y} C 55 ${y}, 45 ${H / 2}, 100 ${H / 2}" vector-effect="non-scaling-stroke"/>`;
  }).join('');
  return `<div class="cr-tree">
    <div class="cr-feed">
      <div class="cr-ins">${keys.map((r) => inputNode(r, cost[r])).join('')}</div>
      <svg class="cr-links" viewBox="0 0 100 ${H}" preserveAspectRatio="none" style="height:${H}px" aria-hidden="true">${links}</svg>
    </div>
    <div class="cr-target ${isLocked(m) ? 'cr-locked' : ''}">
      <div class="cr-tart"><span class="cr-tglow"></span>${ui.img('machine/' + m.id, 'cr-tart-img', m.name)}</div>
      <div class="cr-tname">${esc(m.name)}</div>
      <div class="cr-tsub">Crafts at Lv. 1</div>
      ${craftBtn(m)}
    </div>
  </div>`;
}

function statsHTML(m) {
  const a = statsAt(m, 1), b = statsAt(m, D.machineMaxLv);
  const row = (icon, label, now, max, tip = '') => `<div class="cr-st" ${tip ? `title="${esc(tip)}"` : ''}>${plainImg(icon, 'cr-st-ic')}<span class="cr-st-l">${label}</span>
    <b>${now}</b>${max ? `<i>➜ ${max}</i>` : ''}</div>`;
  let extra = '';
  if (m.rare) extra += row('res/rareEarth', 'Rare Earth bonus', `+${Math.round(m.rare * 100)}%`, '', 'Extra Rare Earth, as a share of the floor output');
  if (m.zones) {
    const za = statsAt(m, 1, m.zones[0]), zb = statsAt(m, D.machineMaxLv, m.zones[0]);
    extra += row('res/heniumOre', 'Henium-zone speed', `×${za.speed.toFixed(2)}`, `×${zb.speed.toFixed(2)}`, `On the ${m.zones.map((z) => D.zoneById(z).name).join(' and ')}`);
  }
  return `<div class="cr-stats">
    <div class="cr-st-h"><span>Machine stats</span><small>Lv. 1 ➜ Lv. ${D.machineMaxLv}</small></div>
    ${row('ui/mines', 'Mining speed', `×${a.speed.toFixed(2)}`, `×${b.speed.toFixed(2)}`, 'Multiplies the floor output')}
    ${row('prop/cart', 'Capacity', `+${G.fmt(a.cap)}/h`, `+${G.fmt(b.cap)}/h`, 'Flat ore per hour added to the floor')}
    ${row('ui/energy', 'Energy', `${G.fmt(a.energy)} Coal/h`, '', 'Coal burned while deployed')}
    ${row('ui/settings', 'Wear', `${m.wear}%/min`, '', 'Durability lost per minute while you play (machines don\'t wear out offline)')}
    ${extra}
    ${row('ui/mines', 'Per floor', '1 machine', '', 'Only one machine works on a floor. Deploying another one there sends the first back to storage: machines on the same floor do not stack')}
    ${row('ui/timer', 'Craft time', G.fmtTime(craftTime(m)), '', G.bonus('craft') ? `Crafter bonus: −${Math.round((1 - 1 / (1 + G.bonus('craft'))) * 100)}% time` : 'Crafter Chikns speed this up')}
    <div class="cr-st-note">${isLocked(m) ? `${plainImg('ui/lock', 'cr-st-ic')}<span>Unlocks at player <b>Lv. ${m.lv}</b></span>` : `${plainImg('ui/trophy', 'cr-st-ic')}<span>Upgrade up to <b>Lv. ${D.machineMaxLv}</b> after crafting</span>`}</div>
  </div>`;
}

function detailHTML() {
  const m = selected(), own = ownedOf(m.id), inQ = G.S.crafts.filter((c) => c.type === m.id).length;
  return `<section class="panel cr-detail" aria-label="Selected machine">
    <div class="panel-h"><span class="sp">Selected: ${esc(m.name)}</span><span class="tag p">Tier ${tierOf(m)}</span>
      ${own ? `<span class="tag g">Owned ×${own}</span>` : ''}${inQ ? `<span class="tag o">Crafting ×${inQ}</span>` : ''}${isLocked(m) ? `<span class="tag r">Lv. ${m.lv}</span>` : ''}</div>
    <div class="cr-dbody">
      <div class="cr-treebox"><div class="cr-sub-h">Crafting tree <small>Required materials ➜ machine</small></div>${treeHTML(m)}</div>
      ${statsHTML(m)}
    </div>
  </section>`;
}

// ---------- crafting queue ----------
function queueHTML() {
  const S = G.S, m = selected();
  const rows = S.crafts.map((c) => {
    const d = D.machineById(c.type), cost = G.speedCost(c.dur - c.t);
    return `<div class="cr-q">
      <span class="cr-q-art">${ui.img('machine/' + c.type, 'cr-q-img', d.name)}</span>
      <div class="cr-q-mid"><div class="cr-q-name"><b>${esc(d.name)}</b><small>Tier ${tierOf(d)}</small></div>
        ${ui.bar(c.t / c.dur * 100, 'blue lg', G.fmtTime(c.dur - c.t), `data-b="craft:${c.id}"`)}</div>
      <button type="button" class="btn sm cr-ff" data-a="speedCraft" data-args='[${c.id}]' data-b="crSpeed:${c.id}" data-c="${cost}" data-need="henium:${cost}"
        title="Speed up: finish now for HENIUM" aria-label="Speed up ${esc(d.name)}">${FF}<span class="cr-ffn">${cost}</span>${ui.icon('henium', 16)}</button>
    </div>`;
  }).join('');
  let empty = '';
  for (let i = S.crafts.length; i < S.craftSlots; i++) {
    empty += `<button type="button" class="cr-q-add" data-a="craft" data-args='["${m.id}"]' ${isLocked(m) ? '' : `data-need="${ui.need(m.cost)}"`}
      title="Craft the selected machine"><span class="cr-plus">+</span><span>Add ${esc(m.name)}</span><small>${G.fmtTime(craftTime(m))}</small></button>`;
  }
  return `<section class="panel cr-queue" aria-label="Crafting queue">
    <div class="panel-h">${plainImg('ui/timer')}<span class="sp">Crafting Queue <span class="cr-cnt">(${S.crafts.length}/${S.craftSlots})</span></span></div>
    <div class="cr-qlist">${rows}${empty}</div>
  </section>`;
}

// ---------- mine floors overview ----------
function floorsHTML() {
  const open = D.zones.filter((z) => G.zoneOpen(z));
  const rows = open.map((z) => {
    const m = G.machineOn(z.id), d = m ? D.machineById(m.type) : null, ms = m ? G.machineStats(m) : null;
    return `<div class="cr-fl ${m ? '' : 'cr-fl-empty'}" style="--zg:${z.glow}">${ui.icon(z.res, 26)}<div class="cr-fl-t"><b>${esc(z.name)}</b><small>Depth ${z.from}–${z.to}</small></div>
      ${m ? `<span class="cr-fl-m">${ui.img('machine/' + m.type, 'cr-fl-img', d.name)}<span><b>${esc(d.name)}</b><small>Lv. ${m.lv} · ×${ms.speed.toFixed(2)}</small></span></span>`
        : '<span class="cr-fl-none">No machine</span>'}</div>`;
  }).join('') || '<div class="empty">No mine floors open yet.</div>';
  return `<section class="panel cr-floors" aria-label="Mine floors"><div class="panel-h">${plainImg('ui/mines')}<span class="sp">Mine Floors</span><small>${open.filter((z) => G.machineOn(z.id)).length}/${open.length} equipped</small></div>
    <p class="cr-fl-rule"><b>One machine per floor.</b> A second one on the same floor replaces the first (it goes back to storage), so machines don't stack. Its speed multiplies the floor's output together with your Chikn, guild and specialization bonuses. On your deepest floor it also speeds up digging.</p>${rows}</section>`;
}

// ---------- my machines ----------
function machineCard(x) {
  const d = D.machineById(x.type), ms = G.machineStats(x), z = x.zone ? D.zoneById(x.zone) : null;
  const status = !z ? ['Stored', ''] : x.dur <= 0 ? ['Broken', 'r'] : x.off ? ['No coal', 'r'] : ['Working', 'g'];
  const open = D.zones.filter((oz) => G.zoneOpen(oz) || oz.id === x.zone); // keep the current floor listed
  const opts = `<option value="" ${z ? '' : 'selected'}>Storage (not deployed)</option>` + open.map((oz) => {
    const occ = G.machineOn(oz.id), swap = occ && occ !== x ? ` · swap with ${D.machineById(occ.type).name}` : '';
    const boost = d.zones && d.zones.includes(oz.id) ? ` · ×${d.zoneSpeed} zone` : '';
    return `<option value="${oz.id}" ${x.zone === oz.id ? 'selected' : ''}>${esc(oz.name)} (${oz.from}–${oz.to})${boost}${swap}</option>`;
  }).join('');
  const up = x.lv < D.machineMaxLv ? D.machineUpCost(d, x.lv) : null;
  const svc = D.machineServiceCost(x.dur), perfect = x.dur >= 99.5;
  return `<article class="cr-mc ${z ? 'cr-mc-dep' : 'cr-mc-stored'}" style="--zg:${z ? z.glow : '#5a63b8'}">
    <div class="cr-mc-top">
      <div class="cr-mc-art" ${z ? `style="background-image:url(${G.img('bg/floor-' + z.id)})"` : ''}>${ui.img('machine/' + x.type, 'cr-mc-img', d.name)}<span class="cr-mc-lv">Lv. ${x.lv}</span></div>
      <div class="cr-mc-info">
        <div class="cr-mc-name">${esc(d.name)}</div>
        <div class="cr-mc-st"><span class="tag ${status[1]}">${status[0]}</span>${z ? `<span class="cr-mc-z">${ui.icon(z.res, 16)}${esc(z.name)}</span>` : ''}</div>
        <div class="cr-kv"><span>Speed</span><b>×${ms.speed.toFixed(2)}</b></div>
        <div class="cr-kv"><span>Capacity</span><b>+${G.fmt(ms.cap)}/h</b></div>
        <div class="cr-kv cr-dur"><span>Durability</span>${ui.bar(x.dur, x.dur < 25 ? 'red' : 'green', Math.round(x.dur) + '%', `data-b="dur:${x.id}"`)}</div>
      </div>
    </div>
    <label class="cr-dep"><span>${plainImg('ui/mines')}Floor</span><select data-cr-deploy="${x.id}" aria-label="Deploy ${esc(d.name)} to a mine floor">${opts}</select></label>
    <div class="cr-mc-btns">
      <div class="cr-mc-b">${up ? ui.btn('▲ Upgrade', 'upgradeMachine', [x.id], 'sm', up, `title="Upgrade to Lv. ${x.lv + 1}"`) + ui.cost(up, 1, 15) : '<button type="button" class="btn sm gray" disabled>★ Max Lv.</button><span class="cr-mc-hint">Fully upgraded</span>'}</div>
      <div class="cr-mc-b">${perfect ? '<button type="button" class="btn sm gray" disabled>Service</button><span class="cr-mc-hint">In perfect shape</span>'
        : `${ui.btn(`${plainImg('ui/crafting')}Service`, 'service', [x.id], 'sm gold', svc, 'title="Restore durability to 100%"')}<span data-b="crSvc:${x.id}">${ui.cost(svc, 1, 15)}</span>`}</div>
    </div>
  </article>`;
}

function myMachinesHTML() {
  const S = G.S;
  const body = S.machines.length ? `<div class="cr-mgrid">${S.machines.map(machineCard).join('')}</div>`
    : `<div class="cr-none">${plainImg('machine/basic', 'cr-none-img')}<div><b>No machines yet</b><div class="muted">Craft your first drill above, then deploy it on a mine floor to boost its output.</div></div></div>`;
  const stored = S.machines.filter((m) => !m.zone).length;
  return `<section class="panel cr-mine" aria-label="My machines">
    <div class="panel-h">${plainImg('machine/improved', 'cr-mh-ic')}<span class="sp">My Machines <span class="cr-cnt">(${S.machines.length})</span></span>${stored ? `<span class="tag o">${stored} in storage</span>` : ''}</div>
    ${body}
  </section>`;
}

// ---------- view ----------
ui.views.crafting = {
  render(el) {
    lastSig = sig();
    el.innerHTML = `<div class="cr-wrap"><div class="cr-grid">
      ${headHTML()}${listHTML()}${detailHTML()}
      <div class="cr-side">${queueHTML()}${floorsHTML()}</div>
      ${myMachinesHTML()}
    </div></div>`;
  },
  update() {
    if (sig() !== lastSig && !(document.activeElement && document.activeElement.matches('select[data-cr-deploy]'))) ui.render();
  },
};

// ---------- handlers ----------
ui.handlers.crSel = (el, e, id) => {
  if (sel === id) return;
  sel = id;
  G.sfx('click');
  ui.render();
};
document.addEventListener('change', (e) => {
  const s = e.target.closest && e.target.closest('select[data-cr-deploy]');
  if (!s) return;
  const id = +s.dataset.crDeploy, zid = s.value || null, m = G.S.machines.find((x) => x.id === id);
  const r = ui.run('deploy', id, zid);
  if (r.ok && m) ui.toast(zid ? `${D.machineById(m.type).name} deployed to the ${D.zoneById(zid).name}` : `${D.machineById(m.type).name} moved to storage`, 'good', 'machine/' + m.type);
});
})();
