// Mines screen: surface base, vertical shaft of zone floors, side panels, action bar, dashboard strip.
(() => {
const G = window.G, D = G.D, ui = G.ui, esc = ui.esc;
const CART = { stone: 'cartStone', coal: 'cartCoal', copper: 'cartCopper', iron: 'cartIron', henium: 'cartHenium', rare: 'cartRare', core: 'cartHenium' };
const FACTORY_SLOTS = { crusher: 3, separator: 13, smelter: 23, forge: 58, advanced: 68, refinery: 78 };
let lineIdx = 0, popT = 0;

ui.binders.zrate = (el, zid) => { el.textContent = ui.perH(G.zoneRate(D.zoneById(zid))); };
ui.binders.depth = (el) => { el.textContent = `${G.S.depth} / ${D.maxDepth}`; };
// progress toward the next floor upgrade: the scarcest cost resource decides
ui.binders.fprog = (el, zid) => {
  const z = D.zoneById(zid), cost = D.floorCost(z, G.S.zones[zid].lv);
  const pct = Math.min(1, ...Object.entries(cost).map(([r, v]) => (G.S.res[r] || 0) / v)) * 100;
  el.querySelector('i').style.width = pct + '%';
  el.classList.toggle('ready', pct >= 100);
};
ui.binders.tapen = (el) => {
  const e = Math.floor(G.S.tapEnergy || 0), max = D.rules.tap.energyMax;
  el.querySelector('b').textContent = `${e}/${max}`;
  el.querySelector('i').style.width = (e / max * 100) + '%';
  el.classList.toggle('low', e < 5);
};

function floorHTML(z) {
  const S = G.S, open = G.zoneOpen(z), st = S.zones[z.id], h = S.hazard && S.hazard.zone === z.id ? S.hazard : null;
  const sel = S.sel === z.id ? 'sel' : '';
  const label = `<div class="plate">${ui.icon(z.res, 30)}<div><div class="pl1">Lv. ${z.from}–${z.to}</div><div class="pl2">${z.name}</div></div></div>`;
  if (!open) {
    const next = S.depth + 1 === z.from;
    const gate = next ? G.digGate(z.from) : null;
    return `<div class="floor locked ${next ? 'next' : ''}" style="background-image:url(${G.img('bg/floor-' + z.id)})">${label}
      <div class="lockmsg">${ui.img('ui/lock', 'lk', '')}<div><b>${next ? 'Locked' : 'Locked'}</b><div>${esc(gate || (next ? `Dig to depth ${z.from} to open` : `Reach depth ${z.from}`))}</div></div></div></div>`;
  }
  const workers = Math.min(3, 1 + Math.floor(st.lv / 8));
  const m = G.machineOn(z.id), ms = m ? G.machineStats(m) : null;
  let stage = '';
  for (let i = 0; i < workers; i++) stage += `<div class="wk" style="--d:${(i * 0.23 + z.from * 0.07) % 0.7}s">${ui.img('chikn/miner', 'wk-img', 'Miner')}</div>`;
  if (st.lv >= 3) stage += `<div class="cart" style="--d:${z.from % 5}s">${ui.img('prop/' + CART[z.id], 'cart-img', 'Ore cart')}</div>`;
  if (m) stage += `<div class="mach ${ms.working ? 'on' : 'off'}">${ui.img('machine/' + m.type, 'mach-img', ms.def.name)}</div>`;
  let haz = '';
  if (h) {
    if (h.type === 'collapse') haz = `<div class="haz collapse">${ui.img('prop/rubble', 'haz-img', '')}<div class="haz-box"><b>Cave-in!</b> Production stopped<button class="btn sm gold" data-a="hazardAct" data-args='["clear"]' data-need="${ui.need(h.cost)}">Clear ${ui.cost(h.cost, 1, 16)}</button></div></div>`;
    if (h.type === 'richvein') haz = `<div class="haz rich"><div class="haz-box pulse"><b>Rich vein!</b> Tap ×10</div></div>`;
    if (h.type === 'supply') haz = `<div class="haz supply">${ui.img('prop/crate', 'haz-img bob', '')}<div class="haz-box"><b>Supply drop!</b><button class="btn sm green" data-a="hazardAct" data-args='["open"]'>Open</button></div></div>`;
    if (h.type === 'creature') haz = `<div class="haz creature">${ui.img('monster/' + h.mon, 'haz-img bob', '')}<div class="haz-box"><b>Creature!</b> Power ${G.fmt(h.power)}<button class="btn sm red" data-a="hazardAct" data-args='["fight"]'>Fight</button></div></div>`;
    if (h.type === 'bandits') haz = `<div class="haz bandits"><div class="haz-box"><b>Bandit raid!</b> Power ${G.fmt(h.power)}<button class="btn sm red" data-a="hazardAct" data-args='["fight"]'>Defend</button><button class="btn sm gray" data-a="hazardAct" data-args='["pay"]' data-need="${ui.need(h.toll)}">Pay ${ui.cost(h.toll, 1, 16)}</button></div></div>`;
  }
  const deepest = D.zoneOf(S.depth) === z;
  return `<div class="floor ${sel} ${h ? 'h-' + h.type : ''}" data-zone="${z.id}" data-a="tapFloor" data-args='["${z.id}"]' style="background-image:url(${G.img('bg/floor-' + z.id)});--glow:${z.glow}">
    ${label}<div class="stage">${stage}</div>
    ${deepest ? `<div class="depth-chip">Depth <b data-b="depth"></b>${S.dig ? ` <span class="dig-chip">→ ${S.dig.to}</span>${ui.bar(0, 'gold dig-bar', '', 'data-b="dig"')}` : ''}</div>` : ''}
    <div class="ratebox"><div class="rb-main"><span class="rb-v">${ui.icon(z.res, 18)}<span data-b="zrate:${z.id}"></span></span>
      <button class="up" data-a="upgradeZone" data-args='["${z.id}"]' data-need="${ui.need(D.floorCost(z, st.lv))}" title="Upgrade to Lv. ${st.lv + 1}" aria-label="Upgrade ${z.name}">▲</button></div>
      <div class="rb-next" title="Cost of the next floor upgrade (Lv. ${st.lv} → ${st.lv + 1})"><span class="rb-lv">Lv.${st.lv + 1}</span>${ui.cost(D.floorCost(z, st.lv), 1, 13)}</div>
      ${ui.bar(0, 'green rb-prog', '', `data-b="fprog:${z.id}"`)}</div>
    ${haz}</div>`;
}

function surfaceHTML() {
  const S = G.S;
  // every building shows its current look (a new one per level) and grows with its level; scaffolding while building
  const facs = D.factories.filter((f) => f.id in FACTORY_SLOTS && (S.factories[f.id].lv > 0 || S.factories[f.id].con)).map((f) => {
    const st = S.factories[f.id], lv = Math.max(1, st.lv);
    return `<div class="sf-fac ${st.con ? 'con' : ''}" style="left:${FACTORY_SLOTS[f.id]}%;--t:${D.tier(lv)}" data-a="nav" data-args='["factories"]'
      title="${esc(f.name)} Lv. ${st.lv}${st.con ? ` · building Lv. ${st.con.to}` : ''}"><img src="${G.img(G.bImg(f.id, lv))}" alt="${esc(f.name)}">
      ${st.con ? ui.bar(0, 'gold sf-conbar', '', `data-b="con:${f.id}"`) : ''}</div>`;
  }).join('');
  const line = D.chiknLines[lineIdx % D.chiknLines.length];
  return `<div class="surface" style="background-image:url(${G.img('bg/surface')})">
    <img class="sf-hq" src="${G.img(G.hqImg())}" style="--t:${D.hqTier(S.depth)}" alt="Headquarters" title="Headquarters · grows every 5 depth levels">
    <img class="sf-flag f1" src="${G.img('prop/flag')}" alt=""><img class="sf-flag f2" src="${G.img('prop/flag')}" alt="">
    ${facs}
    <img class="sf-head" src="${G.img('prop/headframe')}" alt="Mine headframe">
    <div class="sf-sign">My Mine<br><b>Lv. ${S.depth}</b></div>
    <div class="tap-energy" data-b="tapen" title="Tap energy: every tap on a floor costs 1, and it refills 1 every ${Math.round(1 / D.rules.tap.regen)} s">${ui.img('ui/energy', 'te-ic', '')}<div class="te-bar"><i></i></div><b></b></div>
    <div class="mascot"><div class="bubble" id="bubble">${esc(line)}</div>${ui.img('chikn/explorer', 'mascot-img', '')}</div>
  </div>`;
}

function sideHTML() {
  const S = G.S, z = D.zoneById(S.sel), st = S.zones[z.id], open = G.zoneOpen(z);
  const rates = G.rates();
  const prod = D.topRes.map((r) => `<div class="pr ${r === z.res ? 'hl' : ''}">${ui.icon(r, 22)}<span class="sp">${D.res[r].name}</span><b class="num">+${G.fmt((rates[r] || 0) * 3600)}</b></div>`).join('');
  const m = G.machineOn(z.id);
  let mach;
  if (m) {
    const ms = G.machineStats(m);
    mach = `<div class="row" style="align-items:flex-start">${ui.img('machine/' + m.type, 'side-mach', '')}<div class="col sp" style="gap:2px">
      <div class="hx" style="font-size:17px">${ms.def.name} <span class="muted">(Lv. ${m.lv})</span></div>
      <div class="kv">Speed <b>${ms.speed.toFixed(1)}x</b></div><div class="kv">Capacity <b>+${G.fmt(ms.cap)}/h</b></div>
      <div class="kv">Energy <b>−${G.fmt(ms.energy)} Coal/h</b></div>
      <div class="kv">Durability ${ui.bar(m.dur, m.dur < 25 ? 'red' : 'green', '', `data-b="dur:${m.id}"`)}</div>
      ${m.off ? '<div class="tag r">No coal — machine idle</div>' : ''}</div></div>
      <div class="row" style="margin-top:8px">${m.lv < D.machineMaxLv ? ui.btn('Upgrade', 'upgradeMachine', [m.id], 'sm sp', D.machineUpCost(ms.def, m.lv)) : '<button class="btn sm sp cant" disabled>Max Lv.</button>'}${ui.btn('Service', 'service', [m.id], 'sm gray sp', D.machineServiceCost(m.dur))}</div>
      <div class="dim" style="font-size:12px;margin-top:4px">Upgrade: ${m.lv < D.machineMaxLv ? ui.cost(D.machineUpCost(ms.def, m.lv), 1, 16) : 'max'}</div>`;
  } else {
    const spare = S.machines.filter((x) => !x.zone);
    mach = `<div class="muted" style="font-size:14px">No machine on this floor.</div>` + (spare.length
      ? spare.map((x) => `<div class="list-row">${ui.img('machine/' + x.type, 'ic', '').replace('class="ic"', 'class="ic" width="44" height="30"')}<span class="sp">${D.machineById(x.type).name} Lv.${x.lv}</span>${ui.btn('Deploy', 'deploy', [x.id, z.id], 'sm green')}</div>`).join('')
      : `<button class="btn sm" data-a="nav" data-args='["crafting"]' style="margin-top:6px">Craft a machine</button>`);
  }
  const squad = G.squad();
  const team = squad.length ? squad.map((c) => `<div class="tm rarity-${c.rarity}" data-a="nav" data-args='["chikns"]'>${ui.img('chikn/' + c.role, 'tm-img', '')}<div class="sp"><div class="tm-n">${D.rarity(c.rarity).name} ${D.roles[c.role].name}</div><div class="tm-b">+${G.fmt(G.chiknPct(c), 1)}% ${D.roles[c.role].label}</div></div></div>`).join('')
    : `<div class="muted" style="font-size:14px">No Chikns yet.</div><button class="btn sm gold" data-a="hire" style="margin-top:6px">Hire your first Chikn (free)</button>`;
  const qs = G.questList();
  const quests = qs.map((q) => `<div class="q ${q.done ? 'done' : ''}"><span class="qc">${q.done ? '✔' : ''}</span><span class="sp">${esc(q.text)}</span>
    ${q.done ? ui.btn('Claim', 'claimQuest', [q.id], 'sm green') : `<span class="num dim">${G.fmt(q.cur)}/${G.fmt(q.target)}</span>`}</div>`).join('') || '<div class="muted">All quests complete. Legendary!</div>';
  return `<div class="panel side-floor">
      <div class="panel-h" style="margin-bottom:4px"><span class="sp">Selected Floor</span><button class="btn sm ff" data-a="cycleFloor" data-args='[-1]' aria-label="Previous floor">◀</button><button class="btn sm ff" data-a="cycleFloor" data-args='[1]' aria-label="Next floor">▶</button></div>
      <div class="row">${ui.icon(z.res, 40)}<div class="sp"><div class="hx" style="font-size:20px">${z.name} <span class="muted">(${z.from}–${z.to})</span></div>
      <div class="muted" style="font-size:13px">${open ? `Floor Lv. ${st.lv} · dug ${G.zoneDug(z)}/${z.to - z.from + 1} levels` : 'Locked'}</div></div></div>
      ${open ? `<div class="row" style="margin-top:8px"><div class="sp"><div class="dim" style="font-size:12px">Output</div><div class="hx big" data-b="zrate:${z.id}"></div></div>
        ${ui.btn(`Upgrade Floor`, 'upgradeZone', [z.id], 'green', D.floorCost(z, st.lv))}</div>
        <div class="dim" style="font-size:12px;margin-top:4px">Next level: ${ui.cost(D.floorCost(z, st.lv), 1, 16)}</div>` : ''}
    </div>
    <div class="panel"><div class="panel-h">Production <small>(per hour)</small></div><div class="prod">${prod}</div></div>
    <div class="panel"><div class="panel-h">Active Machine</div>${mach}</div>
    <div class="panel"><div class="panel-h"><span class="sp">Mining Team</span><small>${squad.length}/${G.squadSlots()}</small></div>${team}</div>
    <div class="panel"><div class="panel-h"><span class="sp">Quests</span><small>${qs.filter((q) => q.done).length}/${qs.length}</small></div>${quests}</div>`;
}

function actionsHTML() {
  const S = G.S, cost = D.digCost(S.depth), gate = S.depth < D.maxDepth ? G.digGate(S.depth + 1) : 'Max depth';
  const ev = G.liveEvent(), h = S.hazard;
  const collectN = (S.nest >= 1 ? 1 : 0) + S.exps.filter((e) => e.done).length + G.missions().filter((m) => m.done && !m.claimed).length;
  const ticker = h ? `<b>${{ collapse: 'Cave-in!', richvein: 'Rich vein spotted!', supply: 'Supply drop!', creature: 'Creature sighted!', bandits: 'Bandit raid!' }[h.type]}</b><span>${D.zoneById(h.zone).name} · <span data-b="until:${h.until}"></span></span>`
    : ev ? `<b>${esc(ev.name)}</b><span>${esc(ev.desc.split('.')[0])} · <span data-b="until:${S.live.until}"></span></span>` : `<b>All quiet in the mine</b><span>Next event soon…</span>`;
  const digCard = S.dig
    ? `<div class="act digging">${ui.img('ui/mines', 'act-ic bob', '')}<span class="act-l">Digging → ${S.dig.to}</span>
        <span class="act-c dig-row">${ui.bar(0, 'gold', '', 'data-b="dig"')}<button class="btn sm purple dig-fin" data-a="speedDig" title="Finish the dig now">⚡ ${ui.icon('henium', 14)}<span data-b="digcost"></span></button></span></div>`
    : `<button class="act ${gate ? 'cant' : ''}" data-a="dig" ${gate ? '' : `data-need="${ui.need(cost)}"`}>${ui.img('ui/mines', 'act-ic', '')}<span class="act-l">Dig Deeper</span><span class="act-c">${gate ? esc(gate.length > 34 ? gate.slice(0, 32) + '…' : gate)
        : `${ui.cost(cost, 1, 15)} <span class="dig-time">${ui.img('ui/timer', 'ic', '').replace('class="ic"', 'class="ic" width="14" height="14"')}${G.fmtTime(D.digTime(S.depth + 1) / G.digSpeed())}</span>`}</span></button>`;
  return `<div class="mine-actions">
    ${digCard}
    <button class="act" data-a="hire">${ui.img('ui/chikns', 'act-ic', '')}<span class="act-l">Hire Chikn</span><span class="act-c">${S.stats.hired === 0 ? 'First one is free!' : ui.cost(D.hires.standard.cost, 1, 15)}</span>${S.stats.hired === 0 ? '<span class="badge">!</span>' : ''}</button>
    <button class="act" data-a="nav" data-args='["factories"]'>${ui.img('ui/factories', 'act-ic', '')}<span class="act-l">Build Factory</span><span class="act-c">${D.factories.filter((f) => S.factories[f.id].lv > 0).length}/${D.factories.length} built</span></button>
    <button class="act gold" data-a="collectAll">${ui.img('prop/chest', 'act-ic', '')}<span class="act-l">Collect All</span><span class="act-c">Nest: ${ui.icon('egg', 15)}<span data-b="nest"></span></span>${collectN ? `<span class="badge">${collectN}</span>` : ''}</button>
    <div class="ticker ${h ? 'haz-' + h.type : ''}" data-a="nav" data-args='["events"]'>${ui.img(h ? 'ui/battle' : 'ui/events', 'act-ic', '')}<div class="col" style="gap:0">${ticker}</div><span class="go">➜</span></div>
  </div>`;
}

function dashHTML() {
  const S = G.S, g = S.guild, p = D.guildProjects[g.proj], ms = G.missions().slice(0, 3);
  const sNeed = D.seasonNeed(S.season.lv);
  return `<div class="dash">
    <div class="panel dash-season" data-a="nav" data-args='["events"]' style="background-image:linear-gradient(90deg,rgba(21,26,70,.95) 30%,rgba(21,26,70,.3)),url(${G.img('bg/floor-henium')})">
      <div class="panel-h">${ui.img('ui/trophy', '', '')}Season 1: Deep Veins</div>
      <div class="muted">Ends in <b data-b="until:${S.season.ends}"></b></div>
      <div class="row" style="margin-top:10px"><span class="lvchip">Lv. ${S.season.lv}</span>${ui.bar(S.season.xp / sNeed * 100, 'blue lg sp', `${G.fmtFull(S.season.xp)} / ${G.fmtFull(sNeed)} XP`)}</div></div>
    <div class="panel" data-a="nav" data-args='["events"]'><div class="panel-h">${ui.img('ui/events', '', '')}Daily Missions</div>
      ${ms.map((m) => `<div class="mrow ${m.claimed ? 'claimed' : ''}"><span class="qc ${m.done ? 'on' : ''}">${m.done ? '✔' : ''}</span><span class="sp ml">${esc(m.label)}</span>${ui.bar(m.cur / m.n * 100, 'green', `${G.fmt(m.cur)}/${G.fmt(m.n)}`)}<span class="mr">${ui.rew(m.r, 16)}</span></div>`).join('')}</div>
    <div class="panel" data-a="nav" data-args='["guild"]'><div class="panel-h">${ui.img('ui/guild', '', '')}Guild: ${esc(g.name)}</div>
      <div class="muted" style="text-align:center">Members: ${g.members} / ${g.max}</div>
      ${p ? `<div class="hx" style="margin:6px 0 4px">Guild Project: ${esc(p.name)}</div>${ui.bar(g.pts / p.need * 100, 'green lg', Math.floor(g.pts / p.need * 100) + '%')}
      <div class="muted" style="margin-top:6px;font-size:14px">Reward: <b>+${p.bonus}% Guild Mining Bonus</b> · <b>${ui.icon('henium', 15)}+${G.guildProjectReward(g.proj)}</b></div>` : '<div class="hx">All projects complete!</div>'}</div>
    <div class="panel" data-a="nav" data-args='["events"]'><div class="panel-h">${ui.img('ui/bell', '', '')}Live Events</div>
      ${G.liveEvent() ? `<div class="list-row">${ui.icon('heniumOre', 28)}<div class="sp"><b>${esc(G.liveEvent().name)}</b><div class="muted" style="font-size:12px">${esc(G.liveEvent().desc)}</div></div><span class="tchip" data-b="until:${S.live.until}"></span></div>` : ''}
      <div class="list-row">${ui.img('ui/trophy', 'ic', '').replace('class="ic"', 'class="ic" width="26" height="26"')}<div class="sp"><b>Guild Mining Competition</b><div class="muted" style="font-size:12px">Top guilds earn exclusive machines!</div></div></div>
      <div class="list-row">${ui.img('ui/energy', 'ic', '').replace('class="ic"', 'class="ic" width="26" height="26"')}<div class="sp"><b>Next HENIUM halving</b><div class="muted" style="font-size:12px">${G.fmt(G.nextHalving() - S.world.mined)} HENIUM left in this epoch</div></div></div></div>
  </div>`;
}

ui.views.mines = {
  render(el) {
    const S = G.S;
    el.innerHTML = `<div class="mines-grid">
      <section class="scene">${surfaceHTML()}
        <div class="shaft" style="--open:${D.zones.filter((z) => G.zoneOpen(z)).length}">
          ${D.zones.map(floorHTML).join('')}
          <div class="elevator"><div class="cabin">${ui.img('prop/lift', 'cabin-img', 'Elevator')}<span class="cabin-lv">L${S.depth}</span></div></div>
        </div>
      </section>
      <aside class="side" id="mine-side">${sideHTML()}</aside>
    </div>${actionsHTML()}${dashHTML()}`;
  },
  update() {
    // production pop-ups every ~3s
    popT++;
    if (popT % 12 !== 0 || ui.modalOpen()) return;
    for (const z of D.zones) {
      if (!G.zoneOpen(z)) continue;
      const el = document.querySelector(`.floor[data-zone="${z.id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue;
      const amt = G.zoneRate(z) * 3;
      if (amt < 0.05) continue;
      ui.float(`+${ui.amt(z.res, amt)}${ui.icon(z.res, 18)}`, r.left + r.width * (0.3 + Math.random() * 0.35), r.top + r.height * 0.45, '#fff');
    }
    if (popT % 24 === 0) { lineIdx++; const b = document.getElementById('bubble'); if (b) b.textContent = D.chiknLines[lineIdx % D.chiknLines.length]; }
  },
};

// ---------- handlers ----------
ui.handlers.tapFloor = (el, e, zid) => {
  const r = G.act.tap(zid);
  if (G.S.sel !== zid) { G.S.sel = zid; document.querySelectorAll('.floor.sel').forEach((f) => f.classList.remove('sel')); el.classList.add('sel'); document.getElementById('mine-side').innerHTML = sideHTML(); }
  if (!r.ok) {
    if ((G.S.tapEnergy || 0) < 1) { ui.float('<span style="color:#ff8a95">No energy</span>', e.clientX, e.clientY - 10); G.sfx('err'); return; }
    ui.toast(r.msg, 'bad'); G.sfx('err'); return;
  }
  ui.float(`+${ui.amt(r.res, r.amt)}${ui.icon(r.res, 20)}`, e.clientX, e.clientY - 10, r.rich ? '#ffe27a' : '#fff');
  const side = document.getElementById('mine-side'); if (side) side.innerHTML = sideHTML(); // quests and costs follow every tap
  ui.sparks(e.clientX, e.clientY, D.res[r.res].color, r.rich ? 14 : 6);
  G.sfx('tap');
  ui.refresh();
};
ui.handlers.cycleFloor = (el, e, dir) => {
  const open = D.zones.filter((z) => G.zoneOpen(z));
  const i = open.findIndex((z) => z.id === G.S.sel);
  G.S.sel = open[(i + dir + open.length) % open.length].id;
  ui.render();
};
ui.binders.digcost = (el) => { const d = G.S.dig; if (d) el.textContent = 2 * G.speedCost((d.dur - d.t) / G.digSpeed()); };
ui.handlers.dig = () => {
  const r = G.act.dig();
  if (!r.ok) { ui.toast(r.msg, 'bad', 'ui/lock'); G.sfx('err'); return; }
  G.sfx('boom');
  ui.toast(`Your chikns started digging to depth ${r.to} · ${G.fmtTime(r.dur / G.digSpeed())}`, 'good', 'ui/mines');
  ui.render();
};
// a dig finished: new zone or a bigger headquarters are big moments
G.on('dug', ({ depth, newZone }) => {
  G.sfx('boom');
  if (ui.cur === 'mines' && !ui.modalOpen()) ui.render();
  const hqUp = D.hqTier(depth) > D.hqTier(depth - 1);
  if (ui.modalOpen()) { ui.toast(`Reached depth ${depth}!`, 'good', 'ui/mines'); return; }
  if (newZone) {
    ui.modal({ title: `New zone: ${newZone.name}!`, hero: 'res/' + newZone.res, actions: [{ label: 'Let\'s dig!', cls: 'green' }],
      html: `<p style="text-align:center">Your chikns broke through into the <b>${newZone.name}</b> at depth ${depth}.<br>It produces <b>${D.res[newZone.res].name}</b>. Upgrade the new floor to boost output.</p>
        ${hqUp ? '<p style="text-align:center" class="muted">Your headquarters grew too — look at the surface!</p>' : ''}` });
  } else if (hqUp) {
    const t = D.hqTier(depth);
    ui.modal({ title: 'Headquarters upgraded!', actions: [{ label: 'Magnificent!', cls: 'gold' }],
      html: `<div class="up-compare"><div><img src="${G.img('tier/hq-' + (t - 1))}" alt=""><span>Before</span></div><b class="up-arrow">➜</b>
        <div class="up-new"><img src="${G.img('tier/hq-' + t)}" alt=""><span>Look ${t} / 10</span></div></div>
        <p style="text-align:center">Depth ${depth} reached. Your headquarters gets a new, grander look every 5 levels.</p>` });
  } else ui.toast(`Reached depth ${depth}!`, 'good', 'ui/mines');
});
ui.handlers.collectAll = (el) => {
  const r = G.act.collectAll();
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
  const [x, y] = ui.centerOf(el);
  Object.entries(r.got).slice(0, 5).forEach(([res, v], i) => setTimeout(() => ui.float(`+${ui.amt(res, v)}${ui.icon(res, 20)}`, x + (i - 2) * 26, y - 20), i * 120));
  ui.sparks(x, y, '#ffd54a', 14);
  G.sfx('coin');
  if (r.injured && r.injured.length) ui.toast(`Expedition back: ${r.injured.map((c) => c.name).join(', ')} got hurt and is recovering.`, 'bad', 'ui/expeditions', 3.6);
  ui.render();
};
ui.handlers.hazardAct = (el, e, choice) => {
  const r = G.act.hazard(choice);
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
  G.sfx(r.win === false ? 'lose' : 'win');
  ui.toast(r.msg + (r.rew ? '' : ''), r.win === false ? 'bad' : 'good');
  if (r.rew) { const [x, y] = ui.centerOf(el); Object.entries(r.rew).forEach(([res, v], i) => ui.float(`+${ui.amt(res, v)}${ui.icon(res, 20)}`, x + i * 30, y - 10)); }
  ui.render();
};
// Hiring dialog (shared with the Chikn NFT screen)
ui.handlers.hire = () => {
  const S = G.S, free = S.stats.hired === 0;
  const odds = (w) => { const t = w.reduce((a, b) => a + b, 0); return D.rarities.map((r, i) => w[i] ? `<span style="color:${r.color}">${r.name} ${(w[i] / t * 100).toFixed(w[i] / t < 0.01 ? 1 : 0)}%</span>` : '').filter(Boolean).join(' · '); };
  ui.modal({ title: `${ui.img('ui/chikns', '', '')} Hire a Chikn`, wide: true, actions: [],
    html: `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
      <div class="card col" style="align-items:center;text-align:center">${ui.img('chikn/miner', 'hire-img', '')}<div class="hx" style="font-size:22px">Standard Hire</div>
        <div class="dim" style="font-size:12px">${odds(D.hires.standard.weights)}</div>
        <button class="btn green lg block" data-hire="standard" ${free ? '' : `data-need="${ui.need(D.hires.standard.cost)}"`}>${free ? 'Hire FREE' : 'Hire ' + ui.cost(D.hires.standard.cost, 1, 18)}</button></div>
      <div class="card col" style="align-items:center;text-align:center">${ui.img('chikn/leader', 'hire-img', '')}<div class="hx" style="font-size:22px">Premium Hire</div>
        <div class="dim" style="font-size:12px">${odds(D.hires.premium.weights)}</div>
        <button class="btn purple lg block" data-hire="premium" data-need="${ui.need(D.hires.premium.cost)}">Hire ${ui.cost(D.hires.premium.cost, 1, 18)}</button></div></div>` });
  ui.modalEl().addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-hire]');
    if (!b) return;
    const r = G.act.hire(b.dataset.hire);
    if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
    ui.reveal(r.c);
  });
};
ui.reveal = (c) => {
  const R = D.rarity(c.rarity), role = D.roles[c.role];
  G.sfx('hire');
  ui.modal({ title: `New Chikn!`, actions: [{ label: 'Awesome!', cls: 'green' }], onClose: () => ui.render(),
    html: `<div class="reveal rarity-${c.rarity}"><div class="rays"></div>${ui.img('chikn/' + c.role, 'reveal-img', role.name)}</div>
      <div style="text-align:center"><div class="hx" style="font-size:26px;color:${R.color}">${R.name} ${role.name}</div>
      <div class="hx" style="font-size:18px">${esc(c.name)} #${c.num}</div>
      <div class="muted">+${G.fmt(G.chiknPct(c), 1)}% ${role.label} · ${Math.round(c.kg)} kg · lays ~${G.chiknEgg(c).toFixed(1)} EGG/day</div>
      <div style="margin-top:6px">${c.status === 'squad' ? '<span class="tag g">Joined your Mining Team</span>' : '<span class="tag">Waiting in the barracks</span>'}</div></div>` });
};
})();
