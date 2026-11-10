// Plays the first world through the real UI where it matters (taps, placing, crafting) and fast-forwards time
// in between. Prints the progress and takes screenshots. usage: node test/play.mjs [outDir] [--desktop]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || '/tmp/ch-shots';
const desktop = process.argv.includes('--desktop');
mkdirSync(out, { recursive: true });
const html = new URL('../dist/index.html', import.meta.url).pathname;
const b = await chromium.launch();
const ctx = await b.newContext(desktop ? { viewport: { width: 1280, height: 800 } } : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const log = (...a) => console.log(...a);
const shot = (n) => p.screenshot({ path: `${out}/${desktop ? 'd' : 'm'}-${n}.png` });
const ff = (sec) => p.evaluate((s) => { for (let i = 0; i < s * 20; i++) CH.step(0.05); CH.U.refresh(); }, sec);
const state = () => p.evaluate(() => ({ goal: CH.S.goal, g: CH.goal() && CH.goal().text, dug: CH.S.dug, inv: CH.S.inv, kits: CH.S.kits, layer: CH.layer(), ring: CH.S.ring.length, slots: CH.S.slots.map((s) => (s ? s.t[0] + s.st[0] : '.')).join('') }));
// tap on a slot through the canvas
const tapSlot = async (i) => { const [x, y] = await p.evaluate((k) => CH.R.slotXY(k, 0.5), i); const box = await (await p.$('#cv')).boundingBox(); await p.mouse.click(box.x + x, box.y + y); };
const tapPlanet = async () => { const box = await (await p.$('#cv')).boundingBox(); const [x, y] = await p.evaluate(() => { const r = CH.R; const c = document.getElementById('cv').getBoundingClientRect(); return [c.width / 2, c.height / 2 + 30]; }); await p.mouse.click(box.x + x, box.y + y); };

await p.goto('file://' + html); await p.waitForTimeout(600);
await shot('01-intro');
for (let i = 0; i < 6; i++) { const nb = await p.$('#dialog [data-a="next"]'); if (!nb) break; await nb.click(); await p.waitForTimeout(80); }
await shot('02-start');
for (let i = 0; i < 6; i++) { await tapPlanet(); await p.waitForTimeout(60); }
log('after taps', JSON.stringify(await state()));
// Build: pick the Drill and place it on slot 0, the Dock on slot 1
await p.click('[data-tab="build"]'); await p.click('[data-a="pick"][data-args*="drill"]'); await p.waitForTimeout(100); await tapSlot(0); await p.waitForTimeout(100);
await p.click('[data-a="pick"][data-args*="dock"]'); await p.waitForTimeout(100); await tapSlot(1); await p.waitForTimeout(200);
for (let i = 0; i < 3; i++) { const nb = await p.$('#dialog [data-a="next"]'); if (!nb) break; await nb.click(); await p.waitForTimeout(80); }
await ff(10); await p.waitForTimeout(400); await shot('03-first-line');
log('after first line + 10 s', JSON.stringify(await state()));
await ff(60);
log('after 70 s', JSON.stringify(await state()));
// craft a furnace and put it between drill and dock: move dock to slot 2, furnace on slot 1
await p.click('[data-tab="craft"]'); await p.waitForTimeout(100);
const craftF = await p.$('[data-a="craft"][data-args=\'["furnace",1]\']'); if (craftF) await craftF.click();
await p.waitForTimeout(150);
await tapSlot(1); await p.waitForTimeout(200); await shot('04-dock-sheet');
await p.click('[data-a="pickup"]'); await p.waitForTimeout(150);
await p.click('[data-tab="build"]'); await p.click('[data-a="pick"][data-args*="furnace"]'); await tapSlot(1); await p.waitForTimeout(100);
await p.click('[data-a="pick"][data-args*="dock"]'); await tapSlot(2); await p.waitForTimeout(100);
await tapSlot(2); await p.waitForTimeout(150); await p.click('[data-a="mode"][data-args*="parts"]'); await p.waitForTimeout(100); await p.click('.sheet-bg');
await ff(90);
log('after furnace line + 90 s', JSON.stringify(await state()));
await shot('05-furnace-line');
// let the rest play by script: a bigger ring for the whole chain, to check the first world can be finished
await p.evaluate(() => {
  const S = CH.S, A = CH.act;
  S.inv.stone = (S.inv.stone || 0) + 400; // a helping hand so the test can build the full chain quickly
  for (let k = 0; k < 4; k++) A.craft('drill');
  S.slots.forEach((s, i) => { if (s) A.pickup(i); });
});
await ff(1);
const plan = await p.evaluate(() => {
  const S = CH.S, A = CH.act, put = (i, t) => A.place(i, t);
  put(0, 'drill'); put(1, 'drill'); put(2, 'drill'); put(3, 'furnace'); put(4, 'dock');
  S.slots[4].mode = 'parts';
  return S.slots.map((s) => (s ? s.t : '.')).join(',');
});
log('ring', plan);
for (let m = 0; m < 30; m++) { await ff(60); const st = await state(); if (m % 5 === 4) log(`+${m + 1} min`, JSON.stringify({ goal: st.goal, g: st.g, dug: st.dug, layer: st.layer, inv: st.inv })); }
await shot('06-later');
await p.click('[data-tab="items"]'); await p.waitForTimeout(200); await shot('07-storage');
await p.click('[data-tab="rocket"]'); await p.waitForTimeout(200); await shot('08-rocket');
await p.click('[data-tab="log"]'); await p.waitForTimeout(200); await shot('09-log');
// away for 2 hours
// the game saves on pagehide, so wind the saved clock back after that save runs
await p.evaluate(() => window.addEventListener('pagehide', () => { CH.save = () => {}; /* visibilitychange saves again after pagehide */ const k = 'core-hopper-v1', o = JSON.parse(localStorage.getItem(k)); o.last -= 2 * 3600e3; localStorage.setItem(k, JSON.stringify(o)); }));
await p.reload(); await p.waitForTimeout(800); await shot('10-away');
log('errors:', errs.length ? errs.join(' | ') : 'none');
await b.close();
