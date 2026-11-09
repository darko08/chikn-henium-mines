// Boot: load or create a save, offline progress, main loop, global event feedback.
(() => {
const G = window.G, D = G.D, ui = G.ui;

G.start = (S) => {
  if (G.S && G.S.settings) S.settings = { ...S.settings, ...G.S.settings }; // keep sound and test speed
  G.S = S;
  G.save();
  ui.renderShell();
  ui.go('mines');
};

const note = (n) => {
  const S = G.S, t = G.now(), last = S.notes[0];
  if (G.offLog) { S.notes.unshift({ text: n.text, icon: n.icon || null, t, read: false }); if (S.notes.length > 40) S.notes.length = 40; return; } // while catching up: the bell only, the report tells the story
  // the same message again within a minute: count it instead of flooding the bell and the screen
  if (last && last.text === n.text && t - last.t < 60e3) { last.n = (last.n || 1) + 1; last.t = t; last.read = false; return; }
  S.notes.unshift({ text: n.text, icon: n.icon || null, t, read: false });
  if (S.notes.length > 40) S.notes.length = 40;
  ui.toast(n.text, n.bad ? 'bad' : n.good ? 'good' : '', n.icon || null, 3.4);
};
G.on('nestFull', () => note({ text: 'The nest is full: new eggs are being lost. Collect them!', icon: 'farm/nest', bad: true }));
G.on('note', note);
G.on('levelUp', (lv) => {
  if (G.offLog) return; // levelled up while away: no toasts over the report
  G.sfx('level');
  ui.toast(`Level up! You reached Lv. ${lv} (+${D.rules.levelFeed(lv)} FEED)`, 'good', 'ui/gift', 3.6);
  if (lv === 15 || lv === 30) ui.toast('A new Mining Team slot is open!', 'good', 'ui/chikns');
  if (lv === D.rules.specLv && !G.S.spec) setTimeout(() => ui.handlers.spec(), 700);
});
G.on('seasonUp', (lv) => !G.offLog && ui.toast(`Season level ${lv}! Claim your reward in Events.`, 'purple', 'ui/trophy'));
G.on('craftDone', (m) => {
  const d = D.machineById(m.type);
  note({ text: `${d.name} crafted! Deploy it on a mine floor.`, icon: 'machine/' + m.type, good: true });
  if (['crafting', 'mines'].includes(ui.cur)) ui.render();
});
G.on('jobDone', ({ out, f }) => {
  if (out.henium) ui.toast(`+${G.fmt(out.henium, 2)} HENIUM refined`, 'purple', 'res/henium', 2.2);
  if (ui.cur === 'factories') ui.render();
});
G.on('expDone', (e) => {
  note({ text: `Your expedition to ${G.expSite(e.site).name} is back!`, icon: 'ui/expeditions', good: true });
  if (ui.cur === 'expeditions') ui.render();
});
G.on('noCoal', (m) => note({ text: `${D.machineById(m.type).name} ran out of Coal and stopped.`, icon: 'res/coal', bad: true }));
G.on('broken', (m) => note({ text: `${D.machineById(m.type).name} broke down. Service it to keep drilling.`, icon: 'machine/' + m.type, bad: true }));
const worldViews = ['mines', 'events', 'expeditions'];
G.on('live', (e) => { note({ text: `Live event: ${e.name}`, icon: 'ui/events' }); if (worldViews.includes(ui.cur) && !ui.modalOpen()) ui.render(); });
G.on('liveEnd', () => { if (worldViews.includes(ui.cur) && !ui.modalOpen()) ui.render(); });
G.on('hazard', (h) => {
  const z = D.zoneById(h.zone).name;
  const text = { collapse: `Cave-in in the ${z}! Clear the rubble.`, richvein: `Rich vein in the ${z}! Tap it fast!`, supply: `A supply crate dropped into the ${z}.`,
    creature: `A creature is lurking in the ${z}!`, bandits: `Bandits are raiding the ${z}!` }[h.type];
  note({ text, icon: { collapse: 'prop/rubble', richvein: 'res/' + D.zoneById(h.zone).res, supply: 'prop/crate', creature: 'monster/' + h.mon, bandits: 'ui/battle' }[h.type], bad: h.type === 'collapse' || h.type === 'bandits' });
  if (h.type === 'collapse' || h.type === 'bandits') G.sfx('boom');
  if ((ui.cur === 'mines' || ui.cur === 'events') && !ui.modalOpen()) ui.render();
});
G.on('hazardEnd', () => { if ((ui.cur === 'mines' || ui.cur === 'events') && !ui.modalOpen()) ui.render(); });
G.on('built', () => { if (['mines', 'farm'].includes(ui.cur) && !ui.modalOpen()) ui.render(); });
G.on('dug', (d) => G.S.notes.unshift({ text: `Reached depth ${d.depth}${d.newZone ? `: the ${d.newZone.name} is open` : ''}`, icon: 'ui/mines', t: G.now(), read: false }));
G.on('built', (b) => G.S.notes.unshift({ text: `${b.f.name} ${b.from ? `upgraded to Lv. ${b.lv}` : 'is built'}`, icon: 'ui/factories', t: G.now(), read: false }));
G.on('hungry', () => note({ text: 'Your Chikns are hungry and losing weight! Grind FEED in the Feed Mill or burn EGG for FEED.', icon: 'res/feed', bad: true }));
G.on('farmDay', (day, offline) => { if (!offline && ui.cur === 'farm' && !ui.modalOpen()) ui.render(); });

function welcome() {
  ui.modal({ title: 'Welcome to Chikn Henium Mines!', hero: 'ui/logo', wide: false,
    html: `<p style="text-align:center;margin-top:0">Dig deeper, build factories, refine <b>HENIUM</b> and grow your Chikn mining empire.</p>
      <div class="list-row">${ui.icon('stone', 28)}<div class="sp"><b>Tap</b> a mine floor to dig by hand. <b>Upgrade</b> floors to mine faster.</div></div>
      <div class="list-row">${ui.img('ui/mines', 'ic', '').replace('class="ic"', 'class="ic" width="28" height="28"')}<div class="sp"><b>Dig Deeper</b> to open new zones: Coal, Copper, Iron, the Henium Vein…</div></div>
      <div class="list-row">${ui.img('ui/factories', 'ic', '').replace('class="ic"', 'class="ic" width="28" height="28"')}<div class="sp">Build <b>factories</b> to crush, separate, smelt and refine ore into HENIUM. Every upgrade gives a building a grander new look.</div></div>
      <div class="list-row">${ui.icon('egg', 28)}<div class="sp"><b>EGG is rare:</b> each Chikn lays about one a day. Fatten your Chikns with scarce <b>FEED</b> on the Farm to get more.</div></div>
      <p class="dim" style="font-size:13px;text-align:center;margin-bottom:0">Follow the Quests on the right. Progress saves automatically.</p>`,
    actions: [
      { label: 'Load Showcase (Lv. 27)', cls: 'purple', fn: () => { G.start(G.newState('showcase')); ui.toast('Showcase save loaded: your mining empire at Lv. 27', 'good', 'ui/trophy'); } },
      { label: 'Start Mining!', cls: 'green lg' }] });
}
// "Welcome back": everything that happened while you were away, the farm and the problems first
const FIRST = ['egg', 'feed', 'henium'];
G.showAway = function showOffline(off) {
  const S = G.S, row = (icon, html, btn = '') => `<div class="away-row">${icon}<div class="sp">${html}</div>${btn}</div>`;
  const ic = (r) => ui.icon(r, 26), img = (k) => ui.img(k, 'ic', '').replace('class="ic"', 'class="ic" width="26" height="26"');
  const rows = [];
  if (!off.warp) rows.push(row(img('ui/timer'), off.sec > off.mineSec + 60
    ? `You were away <b>${G.fmtTime(off.sec)}</b>. Your floors mined for <b>${G.fmtTime(off.mineSec)}</b> (they stop after ${D.rules.offlineH} hours away); factories, digs, the farm, rentals and the daily payouts ran the whole time.`
    : `You were away <b>${G.fmtTime(off.sec)}</b>. Your mine, factories and farm kept working.`));
  if (off.hungry) rows.push(row(ic('feed'), `<b class="away-bad">FEED ran out: your Chikns are hungry</b>${off.kgLost >= 0.5 ? ` and lost ${G.fmt(off.kgLost)} kg in total` : ''}. Grind FEED at the Feed Mill or burn EGG for FEED.`,
    '<button class="btn sm green" data-a="exchangeDlg" data-args=\'["feed"]\'>Get FEED</button>'));
  const nest = Math.floor(S.nest);
  if (off.eggsLaid >= 0.5 || nest >= 1) rows.push(row(ic('egg'), `Your Chikns laid <b>${G.fmt(off.eggsLaid, 1)} EGG</b> into the nest${off.eggsLost >= 0.5 ? `. <b class="away-bad">The nest was full, so ${G.fmt(off.eggsLost, 1)} eggs were lost</b>: collect more often or upgrade the coop` : ''}.`));
  if (off.feedUsed >= 0.5) rows.push(row(ic('feed'), `Your flock ate ${G.fmt(off.feedUsed, 1)} FEED.`));
  if (off.expsBack > 0) rows.push(row(img('ui/expeditions'), `<b>${off.expsBack} expedition${off.expsBack > 1 ? 's are' : ' is'} back</b>: claim the loot.`, '<button class="btn sm gold" data-a="nav" data-args=\'["expeditions"]\'>Expeditions</button>'));
  for (const l of off.log || []) rows.push(row(img(l.kind === 'built' ? 'ui/factories' : l.kind === 'dug' ? 'ui/mines' : l.kind === 'craft' ? 'ui/crafting' : l.kind === 'coal' ? 'res/coal' : 'ui/settings'),
    l.kind === 'stopped' || l.kind === 'coal' ? `<span class="away-bad">${ui.esc(l.text)}</span>` : ui.esc(l.text)));
  if (off.rent >= 0.05) rows.push(row(ic('egg'), `Your Chikns on rent earned you <b>${G.fmt(off.rent, 1)} EGG</b>.`));
  if (off.left && off.left.length) rows.push(row(img('ui/chikns'), `${off.left.map(ui.esc).join(', ')} went back to ${off.left.length > 1 ? 'their owners' : 'its owner'} (rental ended).`, '<button class="btn sm green" data-a="hire">Rent a Chikn</button>'));
  if (off.war[0] !== off.war[1] || off.hunt[0] !== off.hunt[1]) rows.push(row(img('ui/battle'), `War points ${G.fmtFull(off.war[0])} → <b>${G.fmtFull(off.war[1])}</b>, hunt points ${G.fmtFull(off.hunt[0])} → <b>${G.fmtFull(off.hunt[1])}</b> (they cool down every day: fight to keep your share of the daily HENIUM).`));
  const gains = Object.entries(off.gains).sort((a, b) => (FIRST.indexOf(a[0]) + 1 || 99) - (FIRST.indexOf(b[0]) + 1 || 99) || b[1] - a[1]);
  const chips = gains.map(([r, v]) => `<span class="away-g">${ui.icon(r, 22)}<b>+${ui.amt(r, v)}</b><small>${D.res[r].name}</small></span>`).join('');
  if (off.hungry) G.emit('note', { text: 'Your Chikns are hungry and losing weight! Grind FEED in the Feed Mill or burn EGG for FEED.', icon: 'res/feed', bad: true });
  ui.modal({ title: off.warp ? `Skipped ${G.fmtTime(off.sec)}` : 'Welcome back, MineMaster!', hero: off.warp ? '' : 'chikn/miner', wide: true,
    html: `<div class="away">${rows.join('')}${chips ? `<div class="away-h">You got</div><div class="away-gains">${chips}</div>` : ''}</div>`,
    actions: nest >= 1 ? [{ label: `Collect ${nest} EGG from the nest`, cls: 'green lg', fn: () => { if (G.act.collectNest().ok) G.sfx('coin'); ui.render(); } }] : [{ label: 'Continue', cls: 'green lg' }] });
};
const showOffline = G.showAway;
// a short tab switch only gets a report when something notable happened
const worthTelling = (o) => !!o && (o.sec >= 300 || (o.log && o.log.length) || o.hungry || o.expsBack > 0 || o.eggsLost >= 0.5 || (o.left && o.left.length));

function bootWiki() {
  G.save = () => {};
  G.S = G.newState('fresh');
  document.body.classList.add('wiki-only');
  ui.cur = 'wiki';
  ui.renderView();
}
function boot() {
  if (G.WIKI_ONLY) return bootWiki();
  const saved = G.load();
  G.S = saved || G.newState('fresh');
  ui.renderShell();
  let off = null;
  if (saved) off = G.offline((G.now() - G.S.last) / 1000);
  ui.go('mines');
  if (!saved) welcome();
  else if (worthTelling(off)) showOffline(off);

  let last = performance.now(), acc = 0, saveAcc = 0;
  const loop = (t) => {
    const dt = Math.min(1, Math.max(0, (t - last) / 1000));
    last = t;
    const k = G.speed(); // test speed: the game clock runs k times faster
    if (k > 1) G.S.clockOff = (G.S.clockOff || 0) + dt * (k - 1) * 1000;
    G.tick(dt * k);
    acc += dt; saveAcc += dt;
    if (acc >= 0.25) { acc = 0; ui.refresh(); }
    if (saveAcc >= 8) { saveAcc = 0; G.save(); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { G.save(); return; }
    const gap = (G.now() - G.S.last) / 1000;
    if (gap >= 30) { const o = G.offline(gap); if (worthTelling(o)) showOffline(o); ui.render(); }
    else if (gap > 1) G.tick(gap);
    last = performance.now();
  });
  window.addEventListener('pagehide', G.save);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
