// Builds one self-contained HTML file: inlines CSS, JS and every image in assets/web as data URIs.
// usage: node build.mjs [output.html]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('.', import.meta.url).pathname;
const wikiOnly = process.argv.includes('--wiki');
const outArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const out = outArg || join(root, wikiOnly ? 'dist/chikn-wiki.html' : 'dist/chikn-henium-mines.html');
const CSS = ['base', 'mines', 'factories', 'crafting', 'chikns', 'farm', 'guild', 'dex', 'expeditions', 'battle', 'events', 'wiki'];
const JS = ['data', 'state', 'systems', 'farm', 'dex', 'ui', 'view-mines', 'view-factories', 'view-crafting', 'view-chikns', 'view-farm',
  'view-guild', 'view-dex', 'view-expeditions', 'view-battle', 'view-events', 'view-wiki', 'main'];

const read = (p) => readFileSync(join(root, p), 'utf8');
const opt = (p) => (existsSync(join(root, p)) ? read(p) : `/* missing ${p} */`);

const assets = {};
const webDir = join(root, 'assets/web');
for (const group of readdirSync(webDir)) {
  for (const f of readdirSync(join(webDir, group))) {
    if (!f.endsWith('.webp')) continue;
    assets[`${group}/${f.slice(0, -5)}`] = 'data:image/webp;base64,' + readFileSync(join(webDir, group, f)).toString('base64');
  }
}

const css = CSS.map((n) => `/* ${n}.css */\n` + opt(`src/css/${n}.css`)).join('\n');
const js = `window.G = window.G || {};\nG.WIKI_ONLY = ${wikiOnly};\nG.ASSETS = ${JSON.stringify(assets)};\n` +
  JS.map((n) => `// ---- ${n}.js ----\n` + opt(`src/js/${n}.js`)).join('\n');
let html = read('src/index.html')
  .replace('<!--CSS-->', () => `<style>\n${css}\n</style>`)
  .replace('<!--JS-->', () => `<script>\n${js}\n</script>`);
if (wikiOnly) html = html.replace('<title>Chikn Henium Mines</title>', '<title>Chikn Henium Mines Wiki</title>');
writeFileSync(out, html);
console.log(`built ${out}  ${(html.length / 1048576).toFixed(2)} MB, ${Object.keys(assets).length} images`);
