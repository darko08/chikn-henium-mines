// Builds the game into dist/: one index.html with the CSS and JS inlined, plus the files that make it installable
// (manifest, service worker, icons). usage: node build.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('.', import.meta.url).pathname, out = join(root, 'dist');
const JS = ['data', 'sim', 'render', 'ui', 'main'];
const read = (p) => readFileSync(join(root, p), 'utf8');
mkdirSync(out, { recursive: true });
const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const html = read('src/index.html')
  .replace('<!--CSS-->', () => `<style>\n${read('src/style.css')}\n</style>`)
  .replace('<!--JS-->', () => `<script>\nwindow.CH = { version: '${version}' };\n${JS.map((n) => `// ---- ${n}.js ----\n${read(`src/${n}.js`)}`).join('\n')}\n</script>`);
writeFileSync(join(out, 'index.html'), html);
writeFileSync(join(out, 'sw.js'), read('src/sw.js').replace('__VERSION__', version));
copyFileSync(join(root, 'src/manifest.webmanifest'), join(out, 'manifest.webmanifest'));
for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable.png']) if (existsSync(join(root, 'assets', f))) copyFileSync(join(root, 'assets', f), join(out, f));
console.log(`built dist/index.html ${(html.length / 1024).toFixed(0)} KB (version ${version})`);
