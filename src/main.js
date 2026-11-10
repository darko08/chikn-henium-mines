// Core Hopper — boot: load or start a game, catch up on the time away, then the frame loop (simulate, draw, refresh, save).
(() => {
const CH = window.CH, R = CH.R, U = CH.U;
function boot() {
  const saved = CH.load();
  CH.S = saved || CH.newGame();
  const cv = document.getElementById('cv');
  R.init(cv);
  U.init();
  if (!saved) CH.fire('start');
  else U.away(CH.catchUp((CH.now() - CH.S.last) / 1000));
  U.dialog();

  // taps (a short press without dragging)
  let down = null;
  cv.addEventListener('pointerdown', (e) => { down = { x: e.offsetX, y: e.offsetY }; });
  cv.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.offsetX - down.x, e.offsetY - down.y) < 12) U.tapCanvas(e.offsetX, e.offsetY); down = null; });
  window.addEventListener('resize', () => R.resize());
  setTimeout(() => R.resize(), 50);

  let last = performance.now(), ui = 0, sv = 0;
  const frame = (ts) => {
    const dt = Math.min(0.1, Math.max(0, (ts - last) / 1000)); last = ts;
    const k = CH.S.settings.speed || 1;
    if (k > 1) CH.S.clockOff = (CH.S.clockOff || 0) + dt * (k - 1) * 1000; // test speed: the clock runs faster too
    let sim = dt * k;
    while (sim > 1e-6) { const d = Math.min(0.05, sim); CH.step(d); sim -= d; }
    R.draw(dt);
    if ((ui += dt) > 0.25) { ui = 0; U.refresh(); U.dialog(); }
    if ((sv += dt) > 5) { sv = 0; CH.save(); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { CH.save(); return; }
    const gap = (CH.now() - CH.S.last) / 1000;
    if (gap > 30) U.away(CH.catchUp(gap));
    last = performance.now();
  });
  window.addEventListener('pagehide', CH.save);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
