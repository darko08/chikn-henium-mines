// Smoke test: load the built game, collect JS errors, screenshot views.
// usage: node test/smoke.mjs <html> <outDir> [views comma list] [--mobile]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';
const [html, outDir, viewsArg = 'mines', flag] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const errors = [];
const browser = await chromium.launch();
const mobile = flag === '--mobile';
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1600, height: 1000 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('file://' + html);
await page.waitForTimeout(900);
await page.screenshot({ path: `${outDir}/00-welcome.png` });
await page.click('text=Load Showcase');
await page.waitForTimeout(1200);
for (const v of viewsArg.split(',')) {
  await page.click(`.nav-btn[data-view="${v}"]`).catch((e) => errors.push(`nav ${v}: ${e.message.split('\n')[0]}`));
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${outDir}/${v}.png`, fullPage: false });
}
// exercise a few actions on the mines screen
await page.click('.nav-btn[data-view="mines"]');
await page.waitForTimeout(400);
const fl = await page.$('.floor[data-zone="stone"]');
if (fl) { const b = await fl.boundingBox(); for (let i = 0; i < 5; i++) await page.mouse.click(b.x + b.width * 0.45, b.y + b.height * 0.5); }
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/zz-after-taps.png` });
const state = await page.evaluate(() => ({ depth: G.S.depth, lv: G.S.player.lv, stone: Math.round(G.S.res.stone), jobs: G.S.jobs.length, view: G.ui.cur }));
console.log('state', JSON.stringify(state));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no JS errors');
await browser.close();
