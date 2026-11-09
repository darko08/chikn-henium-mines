// Background music: one track per screen group, crossfaded on screen changes. The MP3s live next to the page
// (music/*.mp3, copied by build.mjs), load only when music plays, and start after the first tap or key (browsers block
// autoplay). Settings: S.settings.music (on/off) and S.settings.musicVol (0–1).
(() => {
const G = window.G, ui = G.ui;
const TRACKS = {
  mines: 'music/main-theme.mp3',          // the playful marimba & banjo main theme
  mines2: 'music/playful-mines-2.mp3',
  farm: 'music/playful-farm-2.mp3',
  factories: 'music/playful-factories.mp3',
};
const BY_VIEW = { mines: 'mines', factories: 'factories', crafting: 'factories', chikns: 'farm', farm: 'farm', guild: 'mines2', dex: 'mines2',
  expeditions: 'mines2', battle: 'mines2', events: 'mines', wiki: 'mines' };
const FADE = 1.4; // seconds
let ready = false, cur = null, curKey = '';
const on = () => !!(G.S && G.S.settings && G.S.settings.music !== false);
const vol = () => (G.S && G.S.settings && typeof G.S.settings.musicVol === 'number' ? G.S.settings.musicVol : 0.45);

function fade(a, to, done) {
  const from = a.volume, t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / (FADE * 1000));
    a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step); else if (done) done();
  };
  requestAnimationFrame(step);
}
// play the track for this screen (crossfade from the one that is playing)
G.music = (view = ui.cur) => {
  if (!ready || G.WIKI_ONLY) return;
  const key = BY_VIEW[view] || 'mines';
  if (!on()) { if (cur) { const old = cur; cur = null; curKey = ''; fade(old, 0, () => old.pause()); } return; }
  if (key === curKey && cur) { cur.volume = vol(); return; }
  const old = cur, a = new Audio(TRACKS[key]);
  a.loop = true; a.volume = 0; cur = a; curKey = key;
  a.play().then(() => fade(a, vol())).catch(() => { /* blocked or missing file: stay silent */ });
  if (old) fade(old, 0, () => old.pause());
};
G.musicState = () => ({ ready, track: curKey, playing: !!cur && !cur.paused, volume: cur ? cur.volume : 0 }); // for tests
G.musicVolume = (v) => { if (G.S) G.S.settings.musicVol = v; if (cur) cur.volume = on() ? v : 0; };
// start after the first tap or key, then follow the screens
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => { if (!ready) { ready = true; G.music(); } }, { capture: true }));
const go = ui.go;
ui.go = (name) => { go(name); G.music(name); };
document.addEventListener('visibilitychange', () => { if (cur) { if (document.hidden) cur.pause(); else if (on()) cur.play().catch(() => {}); } });
})();
