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
  const label = `<div class="plate">${ui.icon(z.res, 30)}<div><div class="pl1">Depth ${z.from}–${z.to}</div><div class="pl2">${z.name}</div></div></div>`;
  if (!open) {
    const next = S.depth + 1 === z.from, upcoming = D.zoneOf(S.depth).to + 1 === z.from; // the zone right after yours
    const gate = next || upcoming ? G.digGate(z.from) : null;
    return `<div class="floor locked ${next ? 'next' : ''} ${next || upcoming ? '' : 'far'}" style="background-image:url(${G.img('bg/floor-' + z.id)})">${label}
      <div class="lockmsg">${ui.img('ui/lock', 'lk', '')}<div><b>Locked</b><div>${esc(next ? gate || `Dig to depth ${z.from} to open` : `Reach depth ${z.from}${gate ? '. ' + gate : ''}`)}</div></div></div></div>`;
  }
  const workers = Math.min(3, 1 + Math.floor(st.lv / 8));
  const m = G.machineOn(z.id), ms = m ? G.machineStats(m) : null;
  let stage = '';
  for (let i = 0; i < workers; i++) stage += `<div class="wk" style="--d:${(i * 0.23 + z.from * 0.07) % 0.7}s">${ui.img('chikn/miner', 'wk-img', 'Miner')}</div>`;
  if (st.lv >= 3) stage += `<div class="cart" style="--d:${z.from % 5}s">${ui.img('prop/' + CART[z.id], 'cart-img', 'Ore cart')}</div>`;
  if (m) stage += `<div class="mach ${ms.working ? 'on' : 'off'}">${ui.img('machine/' + m.type, 'mach-img', ms.def.name)}</div>`;
  let haz = '';
  if (h) {
    const P = G.squadPower(), left = `<span class="haz-t" data-b="until:${h.until}"></span>`;
    const odds = h.power ? `Squad ${G.fmt(P)} vs ${G.fmt(h.power)} · <b>${Math.round(G.winChance(Math.max(1, P), h.power) * 100)}% win</b>` : '';
    const fight = (label) => (P > 0 ? `<button class="btn sm red" data-a="hazardAct" data-args='["fight"]'>${label}</button>` : `<button class="btn sm gold" data-a="nav" data-args='["chikns"]'>Assign Chikns</button>`);
    if (h.type === 'collapse') haz = `<div class="haz collapse">${ui.img('prop/rubble', 'haz-img', '')}<div class="haz-box"><b>Cave-in!</b> Production stopped · clears itself in ${left}<button class="btn sm gold" data-a="hazardAct" data-args='["clear"]' data-need="${ui.need(h.cost)}">Clear now ${ui.cost(h.cost, 1, 16)}</button></div></div>`;
    if (h.type === 'richvein') haz = `<div class="haz rich"><div class="haz-box pulse"><b>Rich vein!</b> Taps ×${D.rules.rich.mult} · ${D.rules.rich.taps - (h.taps || 0)} taps left · ${left}</div></div>`;
    if (h.type === 'supply') haz = `<div class="haz supply">${ui.img('prop/crate', 'haz-img bob', '')}<div class="haz-box"><b>Supply drop!</b> ${ui.rew(h.reward || {}, 14)} ${left}<button class="btn sm green" data-a="hazardAct" data-args='["open"]'>Open</button></div></div>`;
    if (h.type === 'creature') haz = `<div class="haz creature">${ui.img('monster/' + h.mon, 'haz-img bob', '')}<div class="haz-box"><b>Creature!</b> ${odds} · win ${ui.rew(h.reward || {}, 14)} ${left}${fight('Fight')}</div></div>`;
    if (h.type === 'bandits') haz = `<div class="haz bandits"><div class="haz-box"><b>Bandit raid!</b> ${odds} · lose: −${Math.round(D.rules.bandits.lose[0] * 100)}% ore, −${Math.round(D.rules.bandits.lose[1] * 100)}% HENIUM · ${left}${fight('Defend')}<button class="btn sm gray" data-a="hazardAct" data-args='["pay"]' data-need="${ui.need(h.toll)}">Pay ${ui.cost(h.toll, 1, 16)}</button></div></div>`;
  }
  const deepest = D.zoneOf(S.depth) === z;
  return `<div class="floor ${sel} ${h ? 'h-' + h.type : ''}" data-zone="${z.id}" data-a="tapFloor" data-args='["${z.id}"]' style="background-image:url(${G.img('bg/floor-' + z.id)});--glow:${z.glow}">
    ${label}<div class="stage">${stage}</div>
    ${deepest ? `<div class="depth-chip">Depth <b data-b="depth"></b>${S.dig ? ` <span class="dig-chip">→ ${S.dig.to}</span>${ui.bar(0, 'gold dig-bar', ' ', 'data-b="dig"')}` : ''}</div>` : ''}
    <div class="ratebox"><div class="rb-main"><span class="rb-v">${ui.icon(z.res, 18)}<span data-b="zrate:${z.id}"></span></span>
      <button class="up" data-a="upgradeZone" data-args='["${z.id}"]' data-need="${ui.need(D.floorCost(z, st.lv))}" title="Upgrade to Lv. ${st.lv + 1}" aria-label="Upgrade ${z.name}">▲</button></div>
      <div class="rb-next" title="Cost of the next floor upgrade (Lv. ${st.lv} → ${st.lv + 1})${[10, 25, 50, 100].includes(st.lv + 1) ? ': a milestone level, output ×2!' : ''}"><span class="rb-lv">Lv.${st.lv + 1}${[10, 25, 50, 100].includes(st.lv + 1) ? ' <b class="rb-x2">×2</b>' : ''}</span>${ui.cost(D.floorCost(z, st.lv), 1, 13)}</div>
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
    <div class="sf-sign">My Mine<br><b>Depth ${S.depth}</b></div>
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
      <div class="kv">Durability ${ui.bar(m.dur, m.dur < 25 ? 'red' : 'green', ' ', `data-b="dur:${m.id}"`)}</div>
      <div class="kv">Breaks in <b>${m.dur <= 0 ? 'broken' : '~' + G.fmtTime(m.dur / Math.max(1e-9, ms.def.wear * (1 - Math.min(0.6, G.bonus('machine') * 0.5))) * 60) + ' of play'}</b></div>
      ${m.off ? '<div class="tag r">No coal — machine idle</div>' : ''}</div></div>
      <div class="row" style="margin-top:8px">${m.lv < D.machineMaxLv ? ui.btn('Upgrade', 'upgradeMachine', [m.id], 'sm sp', D.machineUpCost(ms.def, m.lv)) : '<button class="btn sm sp cant" disabled>Max Lv.</button>'}${ui.btn('Service', 'service', [m.id], 'sm gray sp', D.machineServiceCost(m.dur, D.machineTier(m.type)))}</div>
      <div class="dim" style="font-size:12px;margin-top:4px">Upgrade: ${m.lv < D.machineMaxLv ? ui.cost(D.machineUpCost(ms.def, m.lv), 1, 16) : 'max'} · Service: ${m.dur >= 99.5 ? 'not needed' : ui.cost(D.machineServiceCost(m.dur, D.machineTier(m.type)), 1, 16)}</div>`;
  } else {
    const spare = S.machines.filter((x) => !x.zone);
    mach = `<div class="muted" style="font-size:14px">No machine on this floor.</div>` + (spare.length
      ? spare.map((x) => `<div class="list-row">${ui.img('machine/' + x.type, 'ic', '').replace('class="ic"', 'class="ic" width="44" height="30"')}<span class="sp">${D.machineById(x.type).name} Lv.${x.lv}</span>${ui.btn('Deploy', 'deploy', [x.id, z.id], 'sm green')}</div>`).join('')
      : `<button class="btn sm" data-a="nav" data-args='["crafting"]' style="margin-top:6px">Craft a machine</button>`);
  }
  const squad = G.squad();
  const team = squad.length ? squad.map((c) => `<div class="tm rarity-${c.rarity}" data-a="nav" data-args='["chikns"]'>${ui.img('chikn/' + c.role, 'tm-img', '')}<div class="sp"><div class="tm-n">${D.rarity(c.rarity).name} ${D.roles[c.role].name}</div><div class="tm-b">+${G.fmt(G.chiknPct(c), 1)}% ${D.roles[c.role].label}${ui.rentTag(c)}</div></div></div>`).join('')
    : `<div class="muted" style="font-size:14px">No Chikns yet.</div><button class="btn sm gold" data-a="hire" style="margin-top:6px">Rent your first Chikn (free)</button>`;
  const qs = G.questList();
  const quests = qs.map((q) => `<div class="q ${q.done ? 'done' : ''}"><span class="qc">${q.done ? '✔' : ''}</span><span class="sp">${esc(q.text)}<span class="q-rew">${ui.rew(q.r, 14)}</span></span>
    ${q.done ? ui.btn('Claim', 'mnQuest', [q.id], 'sm green') : `<span class="num dim">${G.fmt(q.cur)}/${G.fmt(q.target)}</span>`}</div>`).join('') || '<div class="muted">All quests complete. Legendary!</div>';
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
    <div class="panel side-quests"><div class="panel-h"><span class="sp">Quests</span><small>${qs.filter((q) => q.done).length}/${qs.length}</small></div>${quests}</div>`;
}

function actionsHTML() {
  const S = G.S, cost = D.digCost(S.depth), gate = S.depth < D.maxDepth ? G.digGate(S.depth + 1) : 'Max depth';
  const ev = G.liveEvent(), h = S.hazard;
  const collectN = (S.nest >= 1 ? 1 : 0) + S.exps.filter((e) => e.done).length + G.missions().filter((m) => m.done && !m.claimed).length;
  const ticker = h ? `<b>${{ collapse: 'Cave-in!', richvein: 'Rich vein spotted!', supply: 'Supply drop!', creature: 'Creature sighted!', bandits: 'Bandit raid!' }[h.type]}</b><span>${D.zoneById(h.zone).name} · <span data-b="until:${h.until}"></span></span>`
    : ev ? `<b>${esc(ev.name)}</b><span>${esc(ev.desc.split('.')[0])} · <span data-b="until:${S.live.until}"></span></span>` : `<b>All quiet in the mine</b><span>Next live event in <span data-b="until:${S.live.next}"></span></span>`;
  const digCard = S.dig
    ? `<div class="act digging">${ui.img('ui/mines', 'act-ic bob', '')}<span class="act-l">Digging → ${S.dig.to}</span>
        <span class="act-c dig-row">${ui.bar(0, 'gold', ' ', 'data-b="dig"')}</span><button class="btn sm purple dig-fin" data-a="mnFinishDig" title="Finish the dig now for HENIUM">⚡ Finish now ${ui.icon('henium', 14)}<span data-b="digcost"></span></button></div>`
    : `<button class="act ${gate ? 'cant' : ''}" data-a="dig" ${gate ? '' : `data-need="${ui.need(cost)}"`}>${ui.img('ui/mines', 'act-ic', '')}<span class="act-l">Dig Deeper</span><span class="act-c ${gate ? 'act-gate' : ''}">${gate ? esc(gate)
        : `${ui.cost(cost, 1, 15)} <span class="dig-time">${ui.img('ui/timer', 'ic', '').replace('class="ic"', 'class="ic" width="14" height="14"')}${G.fmtTime(D.digTime(S.depth + 1) / G.digSpeed())}</span>${ui.miss(cost)}`}</span></button>`;
  return `<div class="mine-actions">
    ${digCard}
    <button class="act" data-a="hire">${ui.img('ui/chikns', 'act-ic', '')}<span class="act-l">Rent a Chikn</span><span class="act-c">${S.stats.hired === 0 ? 'First rental is free!' : `from ${ui.cost({ egg: 1 }, 1, 15)} a day`}</span>${S.stats.hired === 0 ? '<span class="badge">!</span>' : ''}</button>
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
      <div class="panel-h">${ui.img('ui/trophy', '', '')}Season ${S.season.no || 1}: Deep Veins</div>
      <div class="muted">Ends in <b data-b="until:${S.season.ends}"></b></div>
      <div class="row" style="margin-top:10px"><span class="lvchip">Lv. ${S.season.lv}</span>${ui.bar(S.season.xp / sNeed * 100, 'blue lg sp', `${G.fmtFull(S.season.xp)} / ${G.fmtFull(sNeed)} XP`)}</div></div>
    <div class="panel" data-a="nav" data-args='["events"]'><div class="panel-h">${ui.img('ui/events', '', '')}Daily Missions</div>
      ${ms.map((m) => `<div class="mrow ${m.claimed ? 'claimed' : ''}"><span class="qc ${m.done ? 'on' : ''}">${m.done ? '✔' : ''}</span><span class="sp ml">${esc(m.label)}</span>${ui.bar(m.cur / m.n * 100, 'green', `${G.fmt(m.cur)}/${G.fmt(m.n)}`)}<span class="mr">${ui.rew(m.r, 16)}</span></div>`).join('')}</div>
    <div class="panel" data-a="nav" data-args='["guild"]'><div class="panel-h">${ui.img('ui/guild', '', '')}Guild: ${esc(g.name)}</div>
      <div class="muted" style="text-align:center">Members: ${g.members} / ${g.max}</div>
      ${p ? `<div class="hx" style="margin:6px 0 4px">Guild Project: ${esc(p.name)}</div>${ui.bar(g.pts / p.need * 100, 'green lg', Math.floor(g.pts / p.need * 100) + '%')}
      <div class="muted" style="margin-top:6px;font-size:14px">Reward: <b>+${Math.round(p.bonus * (G.specIs('gleader') ? 1.25 : 1))}% Guild Mining Bonus</b> · <b>${ui.icon('henium', 15)}+${G.guildProjectReward(g.proj)}</b></div>` : '<div class="hx">All projects complete!</div>'}</div>
    <div class="panel" data-a="nav" data-args='["events"]'><div class="panel-h">${ui.img('ui/bell', '', '')}Live Events</div>
      ${G.liveEvent() ? `<div class="list-row">${ui.icon('heniumOre', 28)}<div class="sp"><b>${esc(G.liveEvent().name)}</b><div class="muted" style="font-size:12px">${esc(G.liveEvent().desc)}</div></div><span class="tchip" data-b="until:${S.live.until}"></span></div>` : ''}
      <div class="list-row">${ui.img('ui/trophy', 'ic', '').replace('class="ic"', 'class="ic" width="26" height="26"')}<div class="sp"><b>Guild Mining Competition</b><div class="muted" style="font-size:12px">A live event: every floor mines +20% while it runs.</div></div></div>
      <div class="list-row">${ui.img('ui/energy', 'ic', '').replace('class="ic"', 'class="ic" width="26" height="26"')}<div class="sp"><b>Next HENIUM halving</b><div class="muted" style="font-size:12px">${G.nextHalvingDate()} · ${G.fmt(G.nextHalving() - S.world.mined)} HENIUM left in this epoch</div></div></div></div>
  </div>`;
}

let mnSig = null; // quests, missions, nest and expeditions shown on the Mines screen
ui.views.mines = {
  render(el) {
    const S = G.S;
    el.innerHTML = `<div class="mines-grid">
      <section class="scene">${surfaceHTML()}
        <div class="shaft" style="--open:${D.zones.filter((z) => G.zoneOpen(z)).length}">
          ${D.zones.map(floorHTML).join('')}
          ${(() => { const far = D.zones.filter((z) => !G.zoneOpen(z) && S.depth + 1 !== z.from && D.zoneOf(S.depth).to + 1 !== z.from); return far.length ? `<div class="floors-more">${ui.img('ui/lock', 'lk', '')} ${far.length} more zone${far.length > 1 ? 's' : ''} below: ${far.map((z) => esc(z.short)).join(', ')}</div>` : ''; })()}
          <div class="elevator"><div class="cabin">${ui.img('prop/lift', 'cabin-img', 'Elevator')}<span class="cabin-lv">L${S.depth}</span></div></div>
        </div>
      </section>
      <aside class="side" id="mine-side">${sideHTML()}</aside>
    </div>${actionsHTML()}${dashHTML()}`;
  },
  update() {
    const S = G.S, sg = G.questList().map((q) => (q.done ? 1 : 0)).join('') + '|' + G.missions().map((m) => (m.done ? 1 : 0) + (m.claimed ? 2 : 0)).join('') + '|' + Math.floor(S.nest) + '|' + S.exps.filter((x) => x.done).length;
    if (sg !== mnSig && !ui.modalOpen()) { const first = mnSig === null; mnSig = sg; if (!first) { ui.render(); return; } }
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
ui.handlers.mnFinishDig = () => {
  const d = G.S.dig;
  if (!d) return;
  const c = 2 * G.speedCost((d.dur - d.t) / G.digSpeed()), have = G.S.res.henium;
  ui.modal({ title: `${ui.img('ui/mines', '', '')} Finish the dig now?`, html: `<p style="margin-top:0">Reach depth <b>${d.to}</b> right away for <b>${G.fmtFull(c)} HENIUM</b> (you have ${G.fmt(have, 2)}). Otherwise it finishes by itself in ${G.fmtTime((d.dur - d.t) / G.digSpeed())}.</p>`,
    actions: [{ label: 'Keep digging', cls: 'gray' }, { label: `Finish for ${G.fmtFull(c)} HENIUM`, cls: have >= c ? 'purple' : 'purple cant', fn: () => {
      const r = G.act.speedDig();
      if (!r.ok) { ui.toast(r.msg, 'bad', 'res/henium'); G.sfx('err'); return; }
      ui.toast(`−${G.fmtFull(c)} HENIUM: the dig is done`, 'purple', 'res/henium');
    } }] });
};
ui.handlers.mnQuest = (el, e, id) => {
  const q = D.quests.find((x) => x.id === id), r = G.act.claimQuest(id);
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
  const [x, y] = ui.centerOf(el);
  Object.entries(q.r).forEach(([res, v], i) => ui.float(`+${ui.amt(res, v)}${ui.icon(res, 20)}`, x + i * 34, y - 12));
  ui.toast(`Quest complete: ${Object.entries(q.r).map(([res, v]) => `+${ui.amt(res, v)} ${D.res[res].name}`).join(', ')}`, 'good', 'ui/gift');
  G.sfx('coin');
  ui.render();
};
ui.handlers.tapFloor = (el, e, zid) => {
  const r = G.act.tap(zid);
  if (G.S.sel !== zid) { G.S.sel = zid; document.querySelectorAll('.floor.sel').forEach((f) => f.classList.remove('sel')); el.classList.add('sel'); document.getElementById('mine-side').innerHTML = sideHTML(); }
  if (!r.ok) {
    if ((G.S.tapEnergy || 0) < 1) { ui.float(`<span style="color:#ff8a95">No energy · +1 in ${Math.ceil((1 - (G.S.tapEnergy || 0)) / D.rules.tap.regen)}s</span>`, e.clientX, e.clientY - 10); G.sfx('err'); return; }
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
  const h = G.S.hazard;
  if (h && G.now() - h.at < 700 * G.speed()) return; // it appeared under a tapping finger a moment ago
  const r = G.act.hazard(choice);
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
  G.sfx(r.win === false ? 'lose' : 'win');
  ui.toast(r.msg + (r.rew ? '' : ''), r.win === false ? 'bad' : 'good');
  if (r.rew) { const [x, y] = ui.centerOf(el); Object.entries(r.rew).forEach(([res, v], i) => ui.float(`+${ui.amt(res, v)}${ui.icon(res, 20)}`, x + i * 30, y - 10)); }
  ui.render();
};
// Rental market (shared with the Chikn NFT screen): Chikn NFTs are a fixed collection, so you rent one from its holder
let rentDays = 7, rentAuto = true;
const rentOfferCard = (o) => {
  const R = D.rarity(o.rarity), role = D.roles[o.role], c = { rarity: o.rarity, role: o.role, kg: o.kg, lv: 1 };
  G.syncLv(c);
  const days = G.rentDays(o, rentDays), cost = o.free ? 0 : D.rentCost(o.price, days), S = G.S, full = S.chikns.length >= G.coopCap();
  const btn = full ? '<button class="btn gray block" data-a="nav" data-args=\'["farm"]\'>Coop full: upgrade it</button>'
    : `<button class="btn ${o.free ? 'gold' : 'green'} block" data-rent="${o.id}" ${cost ? `data-need="egg:${cost}"` : ''}>${o.free ? `Rent FREE for ${days} days` : `Rent ${days} day${days === 1 ? '' : 's'} · ${ui.cost({ egg: cost }, 1, 16)}`}</button>`;
  return `<div class="rent-card rarity-${o.rarity} ${o.free ? 'rent-free' : ''}">
    <div class="rent-top">${ui.img('chikn/' + o.role, 'rent-img', role.name)}<div class="rent-id"><b style="color:${R.color}">${R.name} ${role.name}</b>
      <span>${esc(o.name)} #${o.num} · Lv. ${c.lv}</span><small title="The holder who rents it out">Holder ${o.owner}</small></div></div>
    <div class="rent-kv"><span>Team bonus</span><b>+${G.fmt(G.chiknPct(c), 1)}% ${role.label}</b></div>
    <div class="rent-kv"><span>Weight</span><b>${Math.round(o.kg)} kg</b></div>
    <div class="rent-kv"><span>Lays</span><b>${G.fmt(G.chiknEgg(c), 2)} EGG/day</b></div>
    <div class="rent-kv"><span>Eats</span><b>${G.fmt(D.farm.upkeep(o.kg), 2)} FEED/day</b></div>
    <div class="rent-kv"><span>Battle power</span><b>${G.fmt(G.chiknPower(c))}</b></div>
    <div class="rent-price">${o.free ? `<b>Free</b> first rental · ${days} days, then it goes home (rent it again or another one)` : `<b>${G.fmt(o.price * (D.rent.disc[days] || 1), 2)}</b> EGG a day`}</div>
    ${btn}</div>`;
};
const rentHTML = () => {
  const S = G.S, mk = G.rentMarket(), n = S.chikns.length, cap = G.coopCap();
  const tabs = D.rent.days.map((d) => `<button type="button" class="tab ${rentDays === d ? 'on' : ''}" data-rdays="${d}">${d} day${d === 1 ? '' : 's'}${D.rent.disc[d] < 1 ? ` <small>−${Math.round((1 - D.rent.disc[d]) * 100)}%</small>` : ''}</button>`).join('');
  return `<p class="rent-intro">Chikn NFTs are a fixed collection of ${G.fmtFull(D.nftSupply)}: nobody can mint new ones. <b>Rent</b> one from its holder: it joins your coop, works in your Mining Team and lays EGG for you until the rental ends, then goes home. You feed it, but you can't fatten it and it never loses weight. Holders earn the rent as passive income (${Math.round(D.rent.fee * 100)}% market fee is burned).</p>
    <div class="rent-bar"><div class="tabs rent-days" role="group" aria-label="Rental length">${tabs}</div>
      <label class="rent-auto"><input type="checkbox" data-rauto ${rentAuto ? 'checked' : ''}> Renew automatically when it ends</label></div>
    <div class="rent-grid">${mk.offers.map(rentOfferCard).join('') || '<div class="empty">No offers right now.</div>'}</div>
    <div class="rent-foot"><span>Coop <b>${n}/${cap}</b></span><span>You have ${ui.cost({ egg: Math.floor(S.res.egg) }, 1, 16)}</span><span>New offers in <b data-b="farmday"></b></span>
      <button type="button" class="btn sm purple" data-a="buyNftDlg">Buy an NFT instead</button></div>`;
};
ui.handlers.hire = () => {
  ui.modal({ title: `${ui.img('ui/chikns', '', '')} Rent a Chikn`, wide: true, actions: [], html: `<div class="rent-wrap">${rentHTML()}</div>` });
  const box = ui.modalEl(), redraw = () => { const w = box.querySelector('.rent-wrap'); if (w) w.innerHTML = rentHTML(); };
  box.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-rdays]');
    if (t) { rentDays = +t.dataset.rdays; G.sfx('click'); redraw(); return; }
    const b = ev.target.closest('[data-rent]');
    if (!b) return;
    const r = G.act.rent(+b.dataset.rent, rentDays, rentAuto);
    if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); redraw(); return; }
    ui.reveal(r.c);
  });
  box.addEventListener('change', (ev) => { if (ev.target.matches('[data-rauto]')) rentAuto = ev.target.checked; });
};
// Buying a Chikn NFT from another holder (the old premium hire): it is yours to keep, fatten and rent out
ui.handlers.buyNftDlg = () => {
  const b = D.buyNft, t = b.weights.reduce((x, y) => x + y, 0);
  const odds = D.rarities.map((r, i) => (b.weights[i] ? `<span style="color:${r.color}">${r.name} ${(b.weights[i] / t * 100).toFixed(b.weights[i] / t < 0.01 ? 1 : 0)}%</span>` : '')).filter(Boolean).join(' · ');
  ui.modal({ title: `${ui.img('ui/chikns', '', '')} Buy a Chikn NFT`, actions: [],
    html: `<div class="card col" style="align-items:center;text-align:center">${ui.img('chikn/leader', 'hire-img', '')}
      <p class="muted" style="margin:4px 0 8px">You buy a random Chikn NFT from another holder on the market: the collection stays at ${G.fmtFull(D.nftSupply)}. It is <b>yours</b>: it works and lays EGG for you, you can fatten it, and you can <b>rent it out</b> for passive EGG.</p>
      <div class="dim" style="font-size:12px">${odds}</div>
      <button class="btn purple lg block" data-buynft data-need="${ui.need(b.cost)}" style="margin-top:10px">Buy ${ui.cost(b.cost, 1, 18)}</button></div>` });
  ui.modalEl().addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-buynft]')) return;
    const r = G.act.buyNft();
    if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
    ui.reveal(r.c);
  });
};
ui.reveal = (c) => {
  const R = D.rarity(c.rarity), role = D.roles[c.role];
  G.sfx('hire');
  ui.modal({ title: c.rent ? 'Chikn rented!' : 'New Chikn NFT!', actions: [{ label: 'Awesome!', cls: 'green' }], onClose: () => ui.render(),
    html: `<div class="reveal rarity-${c.rarity}"><div class="rays"></div>${ui.img('chikn/' + c.role, 'reveal-img', role.name)}</div>
      <div style="text-align:center"><div class="hx" style="font-size:26px;color:${R.color}">${R.name} ${role.name}</div>
      <div class="hx" style="font-size:18px">${esc(c.name)} #${c.num}</div>
      <div class="muted">+${G.fmt(G.chiknPct(c), 1)}% ${role.label} · ${Math.round(c.kg)} kg · lays ~${G.chiknEgg(c).toFixed(1)} EGG/day</div>
      <div style="margin-top:6px">${c.rent ? `<span class="tag o">Rented for ${G.fmtTime(c.rent.left)}${c.rent.auto ? ' · auto-renew' : ''}</span> ` : '<span class="tag p">Your NFT</span> '}${c.status === 'squad' ? '<span class="tag g">Joined your Mining Team</span>' : '<span class="tag">Waiting in the barracks</span>'}</div></div>` });
};
})();
