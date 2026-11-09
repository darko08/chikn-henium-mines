// Plays the first minutes of a fresh game through the real UI.
// usage: node test/fresh.mjs <html> <outDir>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [html, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('file://' + html);
await page.waitForTimeout(700);
await page.click('text=Start Mining!');
await page.waitForTimeout(300);
const floor = await page.$('.floor[data-zone="stone"]');
const b = await floor.boundingBox();
for (let i = 0; i < 40; i++) {
  await page.mouse.click(b.x + b.width * (0.35 + (i % 5) * 0.05), b.y + b.height * 0.55);
  await page.waitForTimeout(25);
}
await page.screenshot({ path: `${out}/f1-taps.png` });
for (let i = 0; i < 3; i++) { await page.click('.floor[data-zone="stone"] .up'); await page.waitForTimeout(120); }
await page.click('button.act[data-a="dig"]');
await page.waitForTimeout(300);
await page.click('button.act[data-a="hire"]');
await page.waitForTimeout(400);
await page.click('[data-hire="standard"]');
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/f2-reveal.png` });
await page.click('text=Awesome!');
await page.waitForTimeout(300);
// fast-forward 3 minutes of game time, then claim finished quests
await page.evaluate(() => { for (let i = 0; i < 180; i++) G.tick(1); G.ui.render(); });
for (let i = 0; i < 6; i++) {
  const q = await page.$('[data-a="claimQuest"]');
  if (!q) break;
  await q.click();
  await page.waitForTimeout(150);
}
await page.screenshot({ path: `${out}/f3-progress.png` });
const st = await page.evaluate(() => ({ depth: G.S.depth, stoneLv: G.S.zones.stone.lv, stone: Math.round(G.S.res.stone), egg: Math.round(G.S.res.egg), chikns: G.S.chikns.length, quests: G.S.quests.done }));
console.log(JSON.stringify(st));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no JS errors');
await browser.close();
