// Boot: load or create a save, offline progress, main loop, global event feedback.
(() => {
const G = window.G, D = G.D, ui = G.ui;

G.start = (S) => {
  G.S = S;
  G.save();
  ui.renderShell();
  ui.go('mines');
};

const note = (n) => {
  const S = G.S;
  S.notes.unshift({ text: n.text, icon: n.icon || null, t: G.now(), read: false });
  if (S.notes.length > 40) S.notes.length = 40;
  ui.toast(n.text, n.bad ? 'bad' : n.good ? 'good' : '', n.icon || null, 3.4);
};
G.on('note', note);
G.on('levelUp', (lv) => {
  G.sfx('level');
  ui.toast(`Level up! You reached Lv. ${lv} (+${D.rules.levelFeed(lv)} FEED)`, 'good', 'ui/gift', 3.6);
  if (lv === 15 || lv === 30) ui.toast('A new Mining Team slot is open!', 'good', 'ui/chikns');
  if (lv === D.rules.specLv && !G.S.spec) setTimeout(() => ui.handlers.spec(), 700);
});
G.on('seasonUp', (lv) => ui.toast(`Season level ${lv}! Claim your reward in Events.`, 'purple', 'ui/trophy'));
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
function showOffline(off) {
  const rows = Object.entries(off.gains).sort((a, b) => b[1] - a[1]).slice(0, 8);
  ui.modal({ title: 'Welcome back, MineMaster!', hero: 'chikn/miner',
    html: `<p style="text-align:center;margin-top:0">Your chikns kept working for <b>${G.fmtTime(off.sec)}</b> while you were away.</p>
      <div style="display:flex;justify-content:center">${ui.rew(Object.fromEntries(rows), 24)}</div>`,
    actions: [{ label: 'Collect', cls: 'green lg', fn: () => G.sfx('coin') }] });
}

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
  else if (off && Object.keys(off.gains).length) showOffline(off);

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
    if (gap >= 30) { const o = G.offline(gap); if (o && Object.keys(o.gains).length) showOffline(o); ui.render(); }
    else if (gap > 1) G.tick(gap);
    last = performance.now();
  });
  window.addEventListener('pagehide', G.save);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
