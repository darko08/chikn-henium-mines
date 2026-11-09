// Battle screen: arena hero, squad power, PvE missions, PvP guild wars and the animated battle modal.
(() => {
const G = window.G, D = G.D, ui = G.ui, esc = ui.esc;
const now = () => G.now(); // the game clock (moves faster in test mode)
const STEP = 450; // ms per battle round

let mode = 'pve'; // 'pve' | 'pvp'
let sig = '';     // state signature of the last render
let run = null;   // running battle animation

const sw = () => `<img class="bt-sw" src="${G.img('ui/battle')}" alt="Power" draggable="false">`;
const pct = (c) => Math.round(c * 100) + '%';
const tier = (c) => (c >= 0.7 ? 'bt-good' : c >= 0.4 ? 'bt-mid' : 'bt-bad');
const nextStage = () => Math.min(G.S.battle.cleared, D.stages.length - 1);
const resting = (i) => (G.S.battle.cd[i] || 0) > now();
const sprite = (key, cls, alt = '', style = '') => `<img class="${cls}" src="${G.img(key)}" alt="${esc(alt)}" draggable="false" ${style}>`;
const squadSprites = (list, cls) => list.slice(0, 5).map((c, i) => sprite('chikn/' + c.role, cls, c.name, `style="--i:${i}"`)).join('');
const rivalSprites = (cls, n = 3) => Array.from({ length: n }, (_, i) => sprite('chikn/guardian', cls + ' bt-red', 'Rival guardian', `style="--i:${i}"`)).join('');

const stateSig = () => {
  const B = G.S.battle;
  return [mode, B.tickets, B.cleared, D.stages.map((_, i) => (resting(i) ? 1 : 0)).join(''), G.squadPower(), G.S.squad.join(','),
    G.S.guild.warPts, (B.rivals || []).map((r) => r.name).join(',')].join('|');
};

ui.binders.btTicket = (el) => {
  const B = G.S.battle;
  el.textContent = B.tickets >= D.pvpTickets ? 'Full' : G.fmtTime(D.pvpTicketTime - B.tt);
};

// ---------- pieces ----------
function titleHTML() {
  const S = G.S;
  return `<div class="bt-top">
    <div class="view-title">${ui.img('ui/battle', '', '')}<div><h1>Battle Arena</h1><div class="sub">Clear monster missions and raid rival guilds with your squad.</div></div></div>
    <div class="bt-chips">
      <span class="bt-chip">${ui.img('ui/trophy', '', '')}Wins <b>${G.fmtFull(S.stats.wins)}</b></span>
      <span class="bt-chip">${ui.img('monster/golem', '', '')}Stages <b>${S.battle.cleared}/${D.stages.length}</b></span>
      <span class="bt-chip">${ui.img('ui/guild', '', '')}War pts <b>${G.fmtFull(S.guild.warPts)}</b></span>
    </div>
  </div>`;
}

function heroHTML() {
  const sq = G.squad(), P = G.squadPower();
  let foe, name, power, tag;
  if (mode === 'pvp') {
    const rv = G.rivals()[0];
    foe = `<div class="bt-h-foe bt-rival-grp">${rivalSprites('bt-h-rv', 3)}</div>`;
    name = rv.name; power = rv.power; tag = `Guild Lv. ${rv.lv}`;
  } else {
    const i = nextStage(), st = D.stages[i];
    foe = `<div class="bt-h-foe">${sprite('monster/' + st.mon, 'bt-h-mon', st.name)}</div>`;
    name = st.name; power = st.power; tag = G.S.battle.cleared >= D.stages.length ? 'All cleared' : `Stage ${i + 1}`;
  }
  const ch = G.winChance(P, power);
  return `<section class="bt-hero" style="background-image:url(${G.img('bg/arena')})">
    <div class="bt-h-me">${sq.length ? squadSprites(sq, 'bt-h-sp') : ['miner', 'guardian', 'engineer'].map((r, i) => sprite('chikn/' + r, 'bt-h-sp bt-ghost', '', `style="--i:${i}"`)).join('') +
      '<button class="bt-h-empty" data-a="nav" data-args=\'["chikns"]\'>No squad yet<small>Assign Chikns</small></button>'}</div>
    <div class="bt-h-mid"><div class="bt-vs"><span>VS</span></div><div class="bt-h-ch ${tier(ch)}">Win chance <b>${pct(ch)}</b></div></div>
    ${foe}
    <div class="bt-h-plate bt-pl-me"><span>Your Squad</span><b>${sw()}${G.fmtFull(P)}</b></div>
    <div class="bt-h-plate bt-pl-foe"><span>${esc(name)} <small>${tag}</small></span><b>${sw()}${G.fmtFull(power)}</b></div>
  </section>`;
}

function squadHTML() {
  const sq = G.squad(), slots = G.squadSlots(), P = G.squadPower();
  const bonus = G.bonus('battle') + (G.specIs('cmdr') ? 0.25 : 0);
  const minis = sq.map((c) => {
    const R = D.rarity(c.rarity), role = D.roles[c.role];
    return `<button class="bt-mini rarity-${c.rarity}" data-a="nav" data-args='["chikns"]' title="Open the Chikn NFT screen">
      <span class="bt-mini-av">${ui.img('chikn/' + c.role, '', role.name)}</span>
      <span class="bt-mini-t"><b>${esc(c.name)} <small>Lv.${c.lv}</small></b><span style="color:${R.color}">${R.name} ${role.name}</span></span>
      <span class="bt-mini-p">${sw()}${G.fmtFull(G.chiknPower(c))}</span>
    </button>`;
  }).join('') + Array.from({ length: Math.max(0, slots - sq.length) }, () => `<button class="bt-mini bt-mini-empty" data-a="nav" data-args='["chikns"]'>
      <span class="bt-mini-av">+</span><span class="bt-mini-t"><b>Empty slot</b><span>Assign a Chikn</span></span></button>`).join('');
  return `<section class="panel bt-squad">
    <div class="panel-h">${ui.img('ui/chikns', '', '')}<span class="sp">Battle Squad</span><small>${sq.length}/${slots}</small></div>
    <div class="bt-pow">${ui.img('ui/battle', '', '')}<div class="sp"><span>Squad Power</span><b>${G.fmtFull(P)}</b></div>${bonus ? `<em>+${Math.round(bonus * 100)}% bonus</em>` : ''}</div>
    <div class="bt-minis">${minis}</div>
    <button class="btn block bt-manage" data-a="nav" data-args='["chikns"]'>${ui.img('ui/chikns', '', '')}Manage squad in Chikn NFT</button>
    <div class="bt-hint">Guardians fight 1.8× harder and boost the whole squad.</div>
  </section>`;
}

function modesHTML() {
  const S = G.S, B = S.battle, i = nextStage();
  const pveSub = B.cleared >= D.stages.length ? 'All stages cleared!' : `Stage ${i + 1}: ${D.stages[i].name}`;
  return `<div class="bt-modes" role="tablist" aria-label="Battle mode">
    <button class="bt-mode ${mode === 'pve' ? 'bt-mode-on' : ''}" data-a="btMode" data-args='["pve"]' role="tab" aria-selected="${mode === 'pve'}">
      ${ui.img('monster/hgolem', 'bt-mode-ic', '')}<span class="bt-mode-t"><span class="bt-mode-l">PvE <small>(Missions)</small></span><span class="bt-mode-s">${esc(pveSub)}</span></span></button>
    <button class="bt-mode bt-mode-pvp ${mode === 'pvp' ? 'bt-mode-on' : ''}" data-a="btMode" data-args='["pvp"]' role="tab" aria-selected="${mode === 'pvp'}">
      ${ui.img('ui/guild', 'bt-mode-ic', '')}<span class="bt-mode-t"><span class="bt-mode-l">PvP <small>(Guild Wars)</small></span><span class="bt-mode-s">${B.tickets}/${D.pvpTickets} tickets · ${G.fmtFull(S.guild.warPts)} war pts</span></span>
      ${B.tickets ? `<span class="badge">${B.tickets}</span>` : ''}</button>
  </div>`;
}

function stageHTML(st, i) {
  const B = G.S.battle, P = G.squadPower(), ch = G.winChance(P, st.power);
  const locked = i > B.cleared, cleared = i < B.cleared, next = i === B.cleared, rest = resting(i);
  let foot;
  if (locked) foot = `<div class="bt-st-lock">${ui.img('ui/lock', '', '')}Clear ${esc(D.stages[i - 1].name)} first</div>`;
  else if (rest) foot = `<button class="btn gray block" disabled>${ui.img('ui/timer', '', '')}Resting <span data-b="until:${B.cd[i]}">${G.fmtTime((B.cd[i] - now()) / 1000)}</span></button>`;
  else foot = ui.btn(`${ui.img('ui/battle', '', '')}${next ? 'Fight!' : 'Fight'}`, 'btFight', [i], `${next ? 'red' : ''} block`);
  return `<article class="bt-st ${locked ? 'bt-locked' : ''} ${cleared ? 'bt-clr' : ''} ${next ? 'bt-next' : ''}">
    <div class="bt-st-art">
      <span class="bt-st-n">${i + 1}</span>
      ${cleared ? '<span class="bt-st-tag">✔ Cleared</span>' : next ? '<span class="bt-st-tag bt-st-tag-next">Next</span>' : ''}
      ${sprite('monster/' + st.mon, 'bt-st-img', st.name)}
      ${locked ? ui.img('ui/lock', 'bt-st-lkimg', 'Locked') : ''}
    </div>
    <div class="bt-st-b">
      <div class="bt-st-name">${esc(st.name)}</div>
      <div class="bt-st-row"><span class="bt-st-pow">${sw()}${G.fmtFull(st.power)}</span><span class="bt-ch ${tier(ch)}">${pct(ch)} win</span></div>
      <div class="bt-chbar ${tier(ch)}"><i style="width:${ch * 100}%"></i></div>
      <div class="bt-st-rew">${ui.rew(st.r, 18)}${next ? '<span class="bt-x2">×2 first clear</span>' : ''}</div>
      ${foot}
    </div>
  </article>`;
}

function pveHTML() {
  const B = G.S.battle;
  return `<section class="panel bt-pve">
    <div class="panel-h">${ui.img('monster/golem', '', '')}<span class="sp">Monster Missions</span><small>Cleared ${B.cleared}/${D.stages.length} · first clears pay double</small></div>
    <div class="bt-grid">${D.stages.map(stageHTML).join('')}</div>
  </section>`;
}

function pvpHTML() {
  const S = G.S, B = S.battle, P = G.squadPower(), rivals = G.rivals(), pv = D.rules.pvp;
  const tk = Array.from({ length: D.pvpTickets }, (_, i) => `<span class="bt-tk ${i < B.tickets ? 'bt-tk-on' : ''}">${ui.img('ui/battle', '', '')}</span>`).join('');
  const rows = rivals.map((rv, idx) => {
    const ch = G.winChance(P, rv.power);
    return `<div class="bt-rv">
      <div class="bt-rv-av">${sprite('chikn/guardian', 'bt-red', 'Rival guardian')}</div>
      <div class="bt-rv-m"><div class="bt-rv-n">${esc(rv.name)}</div><div class="bt-rv-s">Guild Lv. ${rv.lv} · ${sw()}${G.fmtFull(rv.power)}</div>
        <div class="bt-chbar ${tier(ch)}"><i style="width:${ch * 100}%"></i></div></div>
      <div class="bt-rv-c ${tier(ch)}"><b>${pct(ch)}</b><small>win</small></div>
      ${B.tickets > 0 ? ui.btn(`${ui.img('ui/battle', '', '')}Attack`, 'btPvp', [idx], 'red') : '<button class="btn gray" disabled>No tickets</button>'}
    </div>`;
  }).join('');
  return `<section class="panel bt-pvp">
    <div class="panel-h">${ui.img('ui/guild', '', '')}<span class="sp">Guild Wars</span><small>${esc(S.guild.name)} vs rival guilds</small></div>
    <div class="bt-pvp-top">
      <div class="bt-box"><div class="bt-lbl">Battle tickets</div><div class="bt-tks">${tk}<b>${B.tickets}/${D.pvpTickets}</b></div>
        <div class="bt-refill">${B.tickets < D.pvpTickets ? `${ui.img('ui/timer', '', '')}Next ticket in <b data-b="btTicket">${G.fmtTime(D.pvpTicketTime - B.tt)}</b>` : 'Tickets full. Go fight!'}</div></div>
      <div class="bt-box"><div class="bt-lbl">War points</div><div class="bt-wp">${ui.img('ui/trophy', '', '')}<b>${G.fmtFull(S.guild.warPts)}</b></div><div class="bt-refill">Earned for ${esc(S.guild.name)}</div></div>
      <div class="bt-box bt-terms"><div class="bt-lbl">Victory</div><div class="bt-tw"><b class="gain">+${pv.pts[0]}–${pv.pts[1]} war pts</b> ${Object.entries({ henium: pv.henium, ...pv.loot(S.depth) }).map(([r, v]) => `${ui.icon(r, 18)}${ui.amt(r, v)}`).join(' ')}</div>
        <div class="bt-lbl">Defeat</div><div class="bt-tl">−${pv.lose} war pts</div></div>
    </div>
    <div class="bt-rivals">${rows}</div>
    <div class="bt-note">Each attack uses 1 ticket. A ticket refills every ${G.fmtTime(D.pvpTicketTime)}. New rivals appear after every war.</div>
  </section>`;
}

// ---------- battle animation modal ----------
const $ = (id) => document.getElementById(id);
function stopRun() { if (run) { run.alive = false; clearTimeout(run.timer); run = null; } }
function setHP(side, hp) {
  const bar = $('bt-hp-' + side);
  if (!bar) return;
  const v = Math.max(0, Math.min(100, hp));
  bar.querySelector('i').style.width = v + '%';
  bar.querySelector('b').textContent = `${Math.ceil(v)} / 100`;
  bar.classList.toggle('bt-low', v > 0 && v < 30);
}
function retrigger(el, cls) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function hitFX(target, dmg) {
  const ring = $('bt-ring');
  retrigger($('bt-f-' + target), 'bt-hit');
  if (!ring) return;
  const base = target === 'foe' ? 72 : 26, crit = dmg >= 25;
  const n = document.createElement('div');
  n.className = 'bt-dmg' + (crit ? ' bt-dmg-crit' : '') + (target === 'me' ? ' bt-dmg-me' : '');
  n.textContent = '-' + dmg;
  n.style.left = (base - 9 + Math.random() * 18) + '%';
  n.style.top = (22 + Math.random() * 18) + '%';
  const boom = document.createElement('div');
  boom.className = 'bt-boom';
  boom.style.left = (base - 6 + Math.random() * 12) + '%';
  boom.style.top = (48 + Math.random() * 18) + '%';
  ring.append(boom, n);
  setTimeout(() => { n.remove(); boom.remove(); }, 1000);
}

function playBattle(r, stageIdx) {
  stopRun();
  const pve = r.mon !== 'rival', sq = G.squad();
  const foeArt = pve ? sprite('monster/' + r.mon, 'bt-f-mon', r.foe) : rivalSprites('bt-f-sp', 3);
  const title = pve ? `${ui.img('ui/battle', '', '')} Stage ${stageIdx + 1}: ${esc(r.foe)}` : `${ui.img('ui/guild', '', '')} Guild War vs ${esc(r.foe)}`;
  ui.modal({ title, wide: true, actions: [], onClose: () => { stopRun(); ui.render(); },
    html: `<div class="bt-fight" style="background-image:url(${G.img('bg/arena')})">
      <div class="bt-hps">
        <div class="bt-hpb bt-hpb-me"><div class="bt-hpb-t"><b>Your Squad</b><span>${sw()}${G.fmtFull(r.P)}</span></div>
          <div class="bar green lg" id="bt-hp-me"><i style="width:100%"></i><b>100 / 100</b></div></div>
        <div class="bt-hpb bt-hpb-foe"><div class="bt-hpb-t"><b>${esc(r.foe)}</b><span>${sw()}${G.fmtFull(r.E)}</span></div>
          <div class="bar red lg" id="bt-hp-foe"><i style="width:100%"></i><b>100 / 100</b></div></div>
      </div>
      <div class="bt-ring" id="bt-ring">
        <div class="bt-f bt-f-me" id="bt-f-me">${squadSprites(sq, 'bt-f-sp')}</div>
        <div class="bt-vs bt-vs-big"><span>VS</span></div>
        <div class="bt-f bt-f-foe ${pve ? '' : 'bt-f-rival'}" id="bt-f-foe">${foeArt}</div>
      </div>
      <div class="bt-round" id="bt-round">Get ready…</div>
      <div class="bt-res" id="bt-res" hidden></div>
    </div>
    <div class="bt-mfoot"><span class="bt-mch">Win chance <b class="${tier(r.chance)}">${pct(r.chance)}</b></span>
      <button class="btn gray lg" data-a="btSkip" id="bt-skip">Skip ▸▸</button>
      <button class="btn green lg" data-a="btDone" id="bt-done" hidden>Continue</button></div>` });

  const R = run = { alive: true, timer: 0, i: 0, r, pve, stageIdx, done: false };
  const step = () => {
    if (!R.alive) return;
    if (R.i >= r.rounds.length) { finish(R); return; }
    const rd = r.rounds[R.i++];
    retrigger($('bt-f-' + rd.who), 'bt-atk');
    hitFX(rd.who === 'me' ? 'foe' : 'me', rd.dmg);
    setHP('me', rd.a); setHP('foe', rd.b);
    const rl = $('bt-round');
    if (rl) rl.textContent = `Round ${Math.ceil(R.i / 2)}`;
    G.sfx(rd.who === 'me' ? 'tap' : 'click');
    R.timer = setTimeout(step, STEP);
  };
  R.timer = setTimeout(step, 650);
}

function finish(R) {
  if (!R.alive || R.done) return;
  R.done = true;
  clearTimeout(R.timer);
  const r = R.r, last = r.rounds[r.rounds.length - 1];
  if (last) { setHP('me', last.a); setHP('foe', last.b); }
  const loser = $('bt-f-' + (r.win ? 'foe' : 'me')), winner = $('bt-f-' + (r.win ? 'me' : 'foe'));
  if (loser) loser.classList.add('bt-ko');
  if (winner) winner.classList.add('bt-won');
  const fight = document.querySelector('.bt-fight');
  if (fight) fight.classList.add('bt-over');
  const next = R.pve && r.first && D.stages[R.stageIdx + 1];
  let body;
  if (r.win) {
    body = `<div class="bt-res-rew">${r.rew ? ui.rew(r.rew, 28) : ''}</div>`;
    if (R.pve && r.first) body += `<div class="bt-res-first">First clear! Rewards ×2${next ? ` · <b>${esc(next.name)}</b> unlocked` : ''}</div>`;
  } else {
    body = `<div class="bt-res-tip">${R.pve ? 'Your squad retreats to rest. Level up your Chikns or add Guardians for more power.' : 'The rival guild held the line. Power up your squad and try again.'}</div>`;
  }
  if (!R.pve) body += `<div class="bt-res-pts ${r.pts >= 0 ? '' : 'bt-pts-down'}">${ui.img('ui/guild', '', '')}${r.pts >= 0 ? '+' : '−'}${Math.abs(r.pts)} War Points</div>`;
  const res = $('bt-res');
  if (res) {
    res.className = 'bt-res ' + (r.win ? 'bt-res-win' : 'bt-res-lose');
    res.innerHTML = `<div class="bt-res-in"><div class="bt-res-h">${r.win ? 'Victory!' : 'Defeat'}</div>${body}</div>`;
    res.hidden = false;
  }
  const skip = $('bt-skip'), done = $('bt-done');
  if (skip) skip.hidden = true;
  if (done) { done.hidden = false; done.focus(); }
  G.sfx(r.win ? 'win' : 'lose');
}

// ---------- view ----------
ui.views.battle = {
  render(el) {
    el.innerHTML = `${titleHTML()}
      <div class="bt-head">${heroHTML()}${squadHTML()}</div>
      ${modesHTML()}
      ${mode === 'pvp' ? pvpHTML() : pveHTML()}`;
    sig = stateSig(); // after rendering: G.rivals() may have just rolled new rivals
  },
  update() { if (!run && stateSig() !== sig) ui.render(); },
};

// ---------- handlers ----------
ui.handlers.btMode = (el, e, m) => { if (mode !== m) { mode = m; G.sfx('click'); ui.render(); } };
ui.handlers.btFight = (el, e, i) => {
  const r = G.act.fight(i);
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); ui.render(); return; }
  playBattle(r, i);
};
ui.handlers.btPvp = (el, e, idx) => {
  const r = G.act.pvp(idx);
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); ui.render(); return; }
  playBattle(r, -1);
};
ui.handlers.btSkip = () => { if (run) finish(run); };
ui.handlers.btDone = () => ui.closeModal();
})();
