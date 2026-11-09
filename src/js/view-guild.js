// Guild screen: banner (crest, level, members, bonuses), tabs Projects / Rewards / Wars / Leaderboard,
// the Guild Zone "Deep Core" expansion and the Guild License for the Core Zone.
(() => {
const G = window.G, D = G.D, ui = G.ui, esc = ui.esc;
const PROJ_ART = ['prop/headframe', 'prop/cartIron', 'prop/lift', 'res/henium', 'prop/hq'];
const TABS = [['projects', 'Projects', 'ui/factories'], ['rewards', 'Rewards', 'ui/gift'], ['wars', 'Wars', 'ui/battle'], ['board', 'Leaderboard', 'ui/trophy']];
const WAR_GOAL = 300; // D.journey "Expand Territory" is done at 300 war points
const LICENSE_LV = D.rules.licenseGuildLv; // guild level needed for the Guild License (G.act.buyLicense)
const CORE = D.zoneById('core');
let tab = 'projects', sig = '';

const projArt = (i) => PROJ_ART[i] || 'prop/chest';
const projBonus = (p) => Math.round(p.bonus * (G.specIs('gleader') ? 1.25 : 1)); // as granted by G.sys.guildCheck
const projHenium = (i) => G.guildProjectReward(i); // HENIUM paid out when project i completes (G.sys.guildCheck)
const memberRate = (p) => p.need * D.rules.memberRate; // points per second added by guildmates (G.sys.guildTick)
const zoneBonus = (lv) => [Math.round(D.rules.guildZone.heniumOre * 100 * (lv - 1)), Math.round(D.rules.guildZone.rareEarth * 100 * (lv - 1))]; // % Henium Ore, % Rare Earth (G.zoneRate)
const num = (n) => (Math.abs(n) < 1e6 ? G.fmtFull(Math.floor(n)) : G.fmt(n)); // exact digits until it gets long

// ---------- leaderboard: deterministic rival guilds ----------
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const mix = (h) => { h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16; return h >>> 0; };
const rival = (name, i) => {
  const a = mix(hash(name)), b = mix(a), c = mix(b), d = mix(c);
  return { i, name, base: 1500 + a % 9500, rate: 20 + b % 80, lv: 3 + c % 9, members: 96 + d % 104, hue: 25 + i * 43 };
};
const RIVALS = D.rivals.map(rival);
const rivalScore = (r) => Math.floor(r.base + r.rate * Math.max(0, (G.now() - G.S.created) / 3600e3)); // grows slowly over time
const myScore = () => Math.floor(G.S.guild.contrib + G.S.guild.warPts);
const board = () => {
  const g = G.S.guild;
  return RIVALS.map((r) => ({ ...r, score: rivalScore(r) }))
    .concat({ name: g.name, lv: g.lv, members: g.members, hue: 0, score: myScore(), me: true })
    .sort((a, b) => b.score - a.score || (a.me ? -1 : 1));
};

// ---------- live binders ----------
const projPct = () => { const g = G.S.guild, p = D.guildProjects[g.proj]; return p ? Math.min(100, g.pts / p.need * 100) : 100; };
ui.binders.gdLevel = (el) => { const pct = projPct(); el.firstElementChild.style.width = pct + '%'; const b = el.querySelector('b'); if (b) b.textContent = D.guildProjects[G.S.guild.proj] ? Math.floor(pct) + '%' : 'MAX'; };
ui.binders.gdProj = (el) => {
  const g = G.S.guild, p = D.guildProjects[g.proj];
  if (!p) return;
  el.firstElementChild.style.width = projPct() + '%';
  el.querySelector('b').textContent = `${G.fmtFull(Math.floor(g.pts))} / ${G.fmtFull(p.need)} pts · ${Math.floor(projPct())}%`;
};
ui.binders.gdEta = (el) => { const g = G.S.guild, p = D.guildProjects[g.proj]; if (p) el.textContent = 'done in ~' + G.fmtTime((p.need - g.pts) / memberRate(p)); };
ui.binders.gdScore = (el, i) => { el.textContent = num(rivalScore(RIVALS[+i])); };

// ---------- banner ----------
function bannerHTML() {
  const g = G.S.guild, p = D.guildProjects[g.proj];
  const stat = (label, val, extra = '', cls = '') => `<div class="gd-stat ${cls}"><span class="gd-sl">${label}</span><span class="gd-sv">${val}</span>${extra}</div>`;
  return `<section class="panel gd-banner" style="--bg:url(${G.img('bg/surface')})">
    <div class="gd-crest">${ui.img('ui/guild', 'gd-crest-img', 'Guild crest')}<span class="gd-crest-lv">Lv. ${g.lv}</span></div>
    <div class="gd-id">
      <div class="gd-kicker">${ui.img('prop/flag', '', '')}Your Guild</div>
      <h1 class="gd-name">${esc(g.name)}</h1>
      <div class="gd-lvrow"><span class="gd-lvchip">Lv. ${g.lv}</span><div class="bar gold lg" data-b="gdLevel"><i></i><b></b></div>
        <span class="gd-lvchip next">${p ? 'Lv. ' + (g.lv + 1) : 'MAX'}</span></div>
      <div class="gd-lvhint">${p ? `Complete <b>${esc(p.name)}</b> to reach guild Lv.&nbsp;${g.lv + 1}` : 'Every guild project is complete. Legendary guild!'}</div>
    </div>
    <div class="gd-stats">
      ${stat('Members', `${g.members}<small>/${g.max}</small>`, ui.bar(g.members / g.max * 100, 'blue'))}
      ${stat('Guild Mining Bonus', `+${g.bonus}%`, '<span class="gd-ss">on every mine floor</span>', 'good')}
      ${stat('Your Contribution', `${num(g.contrib)}<small> pts</small>`)}
      ${stat('War Points', `${num(g.warPts)}`, '', 'war')}
    </div>
  </section>`;
}

// ---------- tabs ----------
function projectsHTML() {
  const g = G.S.guild, p = D.guildProjects[g.proj];
  const upcoming = D.guildProjects.slice(g.proj + 1).map((q, j) => `<div class="gd-up">${ui.img(projArt(g.proj + 1 + j), 'gd-up-img', '')}
      <div class="gd-up-t"><b>${esc(q.name)}</b><span>${G.fmtFull(q.need)} project pts</span></div>
      <span class="gd-pill good">+${projBonus(q)}% mining</span>${ui.img('ui/lock', 'gd-up-lock', 'Locked')}</div>`).join('');
  if (!p) return `<div class="gd-alldone">${ui.img('ui/trophy', 'gd-alldone-img', '')}<div class="hx">All guild projects complete!</div>
    <div class="muted">Your guild earned +${g.bonus}% mining for every member. Keep fighting in the Arena for war points.</div></div>`;
  const dons = D.donations.map((x, i) => {
    const d = G.donation(i);
    return `<div class="gd-don">${ui.icon(d.res, 46)}<div class="gd-don-amt">${G.fmtFull(d.amt)}</div><div class="gd-don-res">${D.res[d.res].name}</div>
      <div class="gd-pill pts">+${G.fmtFull(d.pts)} pts</div>
      <button class="btn green sm block" data-a="gdDonate" data-args='[${i}]' data-need="${ui.need({ [d.res]: d.amt })}">Donate</button></div>`;
  }).join('');
  return `<div class="gd-proj">
      <div class="gd-proj-art">${ui.img(projArt(g.proj), '', '')}<span class="gd-proj-no">${g.proj + 1}/${D.guildProjects.length}</span></div>
      <div class="gd-proj-main">
        <div class="gd-kicker">Current Guild Project</div>
        <div class="gd-proj-n">${esc(p.name)}</div>
        <div class="bar green lg gd-proj-bar" data-b="gdProj"><i></i><b></b></div>
        <div class="gd-proj-meta"><span>Reward <span class="gd-pill good">+${projBonus(p)}% Guild Mining Bonus</span><span class="gd-pill h">${ui.icon('henium', 16)} +${projHenium(g.proj)}</span></span>
          <span class="dim">Guildmates add ~${G.fmt(memberRate(p) * 60)} pts/min · <span data-b="gdEta"></span></span></div>
      </div>
    </div>
    <div class="gd-sec"><span>Donate</span><small>Donations add project points and count as your contribution</small></div>
    <div class="gd-dons">${dons}</div>
    ${upcoming ? `<div class="gd-sec"><span>Upcoming Projects</span></div><div class="gd-ups">${upcoming}</div>` : ''}`;
}

function rewardsHTML() {
  const g = G.S.guild, done = D.guildProjects.slice(0, g.proj);
  const earned = done.reduce((s, q, i) => s + projHenium(i), 0);
  const row = (q, i) => {
    const st = i < g.proj ? 'done' : i === g.proj ? 'cur' : 'lock';
    return `<div class="gd-rw ${st}">${ui.img(projArt(i), 'gd-rw-img', '')}
      <div class="gd-rw-t"><b>${esc(q.name)}</b><span>${st === 'done' ? 'Completed' : st === 'cur' ? `In progress · ${Math.floor(projPct())}%` : 'Locked'}</span></div>
      <span class="gd-pill good">+${projBonus(q)}% mining</span><span class="gd-pill h">${ui.icon('henium', 16)} +${projHenium(i)}</span>
      <span class="gd-rw-st">${st === 'done' ? '✔' : st === 'cur' ? '' : ui.img('ui/lock', '', 'Locked')}</span></div>`;
  };
  return `<div class="gd-cards">
      <div class="gd-card good"><span>Guild Mining Bonus</span><b>+${g.bonus}%</b><small>applies to every mine floor</small></div>
      <div class="gd-card"><span>Projects Completed</span><b>${g.proj} / ${D.guildProjects.length}</b><small>each one raises the guild level</small></div>
      <div class="gd-card h"><span>HENIUM Earned</span><b>${ui.icon('henium', 24)} ${earned}</b><small>paid out on completion</small></div>
    </div>
    <div class="gd-sec"><span>Completed Projects</span></div>
    ${done.length ? `<div class="gd-rws">${done.map(row).join('')}</div>`
      : `<div class="gd-empty">${ui.img('ui/gift', '', '')}<div>No projects completed yet. Finish <b>${esc(D.guildProjects[0].name)}</b> to unlock the first reward.</div></div>`}
    ${g.proj < D.guildProjects.length ? `<div class="gd-sec"><span>Still to Earn</span></div><div class="gd-rws">${D.guildProjects.map((q, i) => (i >= g.proj ? row(q, i) : '')).join('')}</div>` : ''}`;
}

function warsHTML() {
  const S = G.S, g = S.guild;
  return `<div class="gd-war" style="--bg:url(${G.img('bg/arena')})">
      ${ui.img('ui/battle', 'gd-war-ic', '')}
      <div class="gd-war-t"><div class="gd-kicker">Guild Wars</div><div class="gd-war-pts"><b>${num(g.warPts)}</b> war points</div>
        <div class="gd-war-s">Win PvP battles in the Arena to raise ${esc(g.name)}'s war score.</div></div>
      <button class="btn red lg gd-war-btn" data-a="gdBattle">${ui.img('ui/battle', '', '')}Battle</button>
    </div>
    <div class="gd-cards">
      <div class="gd-card"><span>Battle Tickets</span><b>${S.battle.tickets} / ${D.pvpTickets}</b><small>refill over time</small></div>
      <div class="gd-card"><span>Squad Power</span><b>${num(G.squadPower())}</b><small>from your Mining Team</small></div>
      <div class="gd-card"><span>Battles Won</span><b>${num(S.stats.wins)}</b><small>PvE and PvP</small></div>
    </div>
    <div class="gd-sec"><span>Territory Goal</span><small>Month 4 of the journey: Expand Territory</small></div>
    <div class="gd-goal"><div class="gd-goal-t"><b>${Math.min(g.warPts, WAR_GOAL)} / ${WAR_GOAL}</b> war points for territory control</div>
      ${ui.bar(g.warPts / WAR_GOAL * 100, g.warPts >= WAR_GOAL ? 'gold lg' : 'red lg', g.warPts >= WAR_GOAL ? 'Territory secured!' : Math.floor(g.warPts / WAR_GOAL * 100) + '%')}</div>
    <div class="gd-sec"><span>How War Points Work</span></div>
    <div class="gd-rules">
      <div class="gd-rule win"><b>Win</b><span>+${D.rules.pvp.pts[0]} to +${D.rules.pvp.pts[1]} war points per PvP victory. They also count as your guild contribution, and pay your share of the daily HENIUM war pool.</span></div>
      <div class="gd-rule lose"><b>Lose</b><span>−${D.rules.pvp.lose} war points. Build a stronger Mining Team before you attack.</span></div>
      <div class="gd-rule"><b>Cool-down</b><span>War points drop ${Math.round(D.rules.warDecay * 100)}% at every game-day rollover, so keep fighting to hold your share.</span></div>
      <div class="gd-rule"><b>Tickets</b><span>Each PvP battle costs a ticket. You hold up to ${D.pvpTickets}; one refills every ${G.fmtTime(D.pvpTicketTime)}.</span></div>
    </div>`;
}

function boardHTML() {
  const rows = board(), mi = rows.findIndex((r) => r.me), me = rows[mi], above = rows[mi - 1];
  return `<div class="gd-bhead"><div><div class="gd-kicker">Season Guild Ranking</div><div class="gd-bsub">${rows.length} guilds · score = contribution + war points</div></div>
      <div class="gd-myrank"><span>Your rank</span><b>#${mi + 1}</b></div></div>
    <div class="gd-gap">${above ? `${ui.img('ui/trophy', '', '')}<span><b>+${num(above.score - me.score + 1)} pts</b> to pass <b>${esc(above.name)}</b>. Donate or win PvP battles to climb!</span>`
      : `${ui.img('ui/trophy', '', '')}<span><b>${esc(me.name)}</b> leads the season. Keep it up!</span>`}</div>
    <div class="gd-board">${rows.map((r, i) => `<div class="gd-br ${r.me ? 'me' : ''} ${i < 3 ? 'top top' + (i + 1) : ''}">
      <span class="gd-rank">${i + 1}</span>
      <img class="gd-bcrest" src="${G.img('ui/guild')}" alt="" style="filter:hue-rotate(${r.hue}deg) drop-shadow(0 2px 2px rgba(0,0,0,.5))">
      <div class="gd-bname"><b>${esc(r.name)}</b>${r.me ? '<span class="tag g">You</span>' : ''}<span class="gd-bmeta">Lv. ${r.lv} · ${r.members}/200 members</span></div>
      <span class="gd-score" ${r.me ? '' : `data-b="gdScore:${r.i}"`}>${num(r.score)}</span></div>`).join('')}</div>`;
}

// ---------- side column ----------
function zoneHTML() {
  const g = G.S.guild, lv = g.zoneLv, cost = D.guildZoneCost(lv), [h, r] = zoneBonus(lv), [h2, r2] = zoneBonus(lv + 1);
  return `<section class="panel gd-zone">
    <div class="gd-zone-art" style="background-image:url(${G.img('bg/map')})"><div class="gd-zone-tag">${ui.img('ui/guild', '', '')}<div><div class="gd-kicker">Guild Zone</div><b>Deep Core</b></div><span class="gd-zone-lv">Lv. ${lv}</span></div></div>
    <div class="gd-zb">${ui.icon('heniumOre', 30)}<span class="gd-zb-t">Henium Ore yield</span><b class="good">+${h}%</b><span class="gd-zb-n">→ +${h2}%</span></div>
    <div class="gd-zb">${ui.icon('rareEarth', 30)}<span class="gd-zb-t">Rare Earth yield</span><b class="good">+${r}%</b><span class="gd-zb-n">→ +${r2}%</span></div>
    <div class="gd-zone-foot"><div class="gd-zone-cost"><span class="dim">Expand to Lv. ${lv + 1}</span>${ui.cost(cost, 1, 18)}</div>
      <button class="btn green" data-a="gdExpand" data-need="${ui.need(cost)}">Expand</button></div>
  </section>`;
}

function licenseHTML() {
  const S = G.S, g = S.guild, own = g.license, lvOk = g.lv >= LICENSE_LV, refLv = CORE.gate.refineryLv || 0, refOk = S.factories.refinery.lv >= refLv;
  const chk = (okv, text) => `<div class="gd-req ${okv ? 'ok' : ''}"><span class="gd-chk">${okv ? '✔' : ''}</span><span>${text}</span></div>`;
  return `<section class="panel gd-lic ${own ? 'own' : ''}">
    <div class="panel-h">${ui.img(own ? 'ui/trophy' : 'ui/lock', '', '')}<span class="sp">Guild License</span>${own ? '<span class="tag g">Active</span>' : '<span class="tag r">Not owned</span>'}</div>
    <div class="gd-lic-t">Required to break into the <b>${CORE.name}</b> (depth ${CORE.from}–${CORE.to}).</div>
    ${chk(lvOk, `Guild Lv. ${LICENSE_LV} <span class="dim">(yours: Lv. ${g.lv})</span>`)}
    ${chk(own, 'Guild License')}
    ${refLv ? chk(refOk, `Henium Refinery Lv. ${refLv} <span class="dim">(also needed to dig)</span>`) : ''}
    ${own ? `<div class="gd-lic-ok">Your mine is licensed for the ${CORE.name}.</div>`
      : `<div class="gd-lic-buy"><div class="gd-zone-cost"><span class="dim">Price</span>${ui.cost(D.licenseCost, 1, 18)}</div>
        <button class="btn gold ${lvOk ? '' : 'cant'}" data-a="gdLicense" ${lvOk ? `data-need="${ui.need(D.licenseCost)}"` : ''}>Buy License</button></div>`}
  </section>`;
}

// ---------- handlers ----------
ui.handlers.gdTab = (el, e, k) => { tab = k; G.sfx('click'); ui.render(); };
ui.handlers.gdDonate = (el, e, i) => {
  const r = G.act.donate(i);
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
  const [x, y] = ui.centerOf(el);
  ui.float(`+${G.fmtFull(r.pts)} pts`, x, y - 20, '#9dff8a');
  ui.sparks(x, y, '#7be35a', 10);
  G.sfx('coin');
  ui.render();
};
ui.handlers.gdExpand = (el) => {
  const r = G.act.expandZone();
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
  const [x, y] = ui.centerOf(el);
  ui.sparks(x, y, '#c77dff', 14);
  G.sfx('up');
  ui.toast(`Deep Core expanded to Lv. ${r.lv}! Henium Ore +${zoneBonus(r.lv)[0]}%, Rare Earth +${zoneBonus(r.lv)[1]}%`, 'good', 'ui/guild');
  ui.render();
};
ui.handlers.gdLicense = (el) => {
  const r = G.act.buyLicense();
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return; }
  G.sfx('level');
  ui.toast('Guild License acquired! The Core Zone can be opened.', 'good', 'ui/trophy');
  ui.render();
};
ui.handlers.gdBattle = () => {
  if (ui.views.battle) ui.go('battle');
  else { ui.toast('The Battle arena is not open yet', 'bad', 'ui/battle'); G.sfx('err'); }
};

const sigOf = () => { const g = G.S.guild; return [g.proj, g.lv, g.members, g.bonus, g.license, g.zoneLv].join(); };
ui.views.guild = {
  render(el) {
    sig = sigOf();
    const body = { projects: projectsHTML, rewards: rewardsHTML, wars: warsHTML, board: boardHTML }[tab]();
    el.innerHTML = `${bannerHTML()}<div class="gd-page">
      <section class="panel gd-main"><div class="tabs gd-tabs" role="tablist">${TABS.map(([k, l, ic]) =>
        `<button class="tab ${tab === k ? 'on' : ''}" role="tab" aria-selected="${tab === k}" data-a="gdTab" data-args='["${k}"]'>${ui.img(ic, '', '')}<span>${l}</span></button>`).join('')}</div>
        <div class="gd-body">${body}</div></section>
      <aside class="gd-side">${zoneHTML()}${licenseHTML()}</aside></div>`;
  },
  update() { if (sigOf() !== sig) ui.render(); }, // a project can complete while guildmates contribute
};
})();
