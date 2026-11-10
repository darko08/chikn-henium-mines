// Plays a whole world with a sensible ring and checks that it can be finished: every goal, the rocket, the launch,
// the star map and the flight to the next world. Measures how long it takes in game time.
// usage: node test/fullrun.mjs [outDir]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || '/tmp/ch-shots'; mkdirSync(out, { recursive: true });
const html = new URL('../dist/index.html', import.meta.url).pathname;
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('file://' + html); await p.waitForTimeout(500);
// a bot that plays like a reasonable player: grows the ring, picks ores for what the goals need, delivers the rocket
const res = await p.evaluate(() => {
  const S = CH.S, A = CH.act, D = CH.D, log = [];
  CH.queue.length = 0;
  for (let i = 0; i < 20; i++) A.tap();
  let sec = 0;
  const find = (t) => S.slots.findIndex((s) => s && s.t === t);
  const free = () => S.slots.findIndex((s) => !s);
  const need = () => { // what the rocket and kits still need most
    const want = { brick: 0, ironPlate: 0, gear: 0, circuit: 0, fuel: 0 };
    for (const part of CH.P().rocket) for (const t in part.need) want[t] += Math.max(0, part.need[t] - ((S.rocket[part.id] || {})[t] || 0) - (S.inv[t] || 0));
    return want;
  };
  // the layout this bot builds, in clockwise order
  const LAYOUT = ['drill', 'drill', 'furnace', 'dock', 'drill', 'drill', 'furnace', 'press', 'drill', 'assembler', 'drill', 'refinery'];
  const plan = () => {
    // craft and place the next building of the layout that we can afford
    for (let i = 0; i < LAYOUT.length && i < S.slots.length; i++) {
      if (S.slots[i]) continue;
      const t = LAYOUT[i];
      if (!(S.kits[t] > 0) && !A.craft(t).ok) return;
      A.place(i, t);
    }
  };
  const tuneOres = () => {
    const ores = CH.ores(), w = need(), drills = S.slots.map((s, i) => (s && s.t === 'drill' ? i : -1)).filter((i) => i >= 0);
    const order = [];
    if (ores.includes('ironOre')) order.push('ironOre', 'ironOre');
    if (ores.includes('copperOre') && (w.circuit > 0 || (S.got.circuit || 0) < 5)) order.push('copperOre');
    if (ores.includes('coal') && w.fuel > 0) order.push('coal');
    if (ores.includes('crystal') && w.fuel > 0) order.push('crystal');
    order.push('stone');
    if ((S.inv.stone || 0) < 100) order.unshift('stone'); // always one drill on Stone while kits need it
    drills.forEach((i, k) => { const o = order[k % order.length]; if (S.slots[i].ore !== o) A.setOre(i, o); });
  };
  // the dock keeps parts only, so ore keeps circling to the machines
  for (let m = 0; m < 240 && !S.launched; m++) { // up to 4 hours, one minute at a time
    plan(); tuneOres();
    // the Press makes what the rocket needs more of
    const pr = find('press'), w2 = need();
    if (pr >= 0) A.setRecipe(pr, (S.inv.gear || 0) >= 15 + w2.gear && w2.circuit > 0 ? 1 : 0); // keep some gears for kits and the rocket, then wire
    const d = find('dock'); if (d >= 0) S.slots[d].mode = (S.inv.stone || 0) < 80 ? 'all' : 'parts'; // keep Stone for kits, then only parts
    for (let i = 0; i < 1200; i++) CH.step(0.05);
    sec += 60;
    for (const part of CH.P().rocket) A.deliver(part.id);
    if (CH.coreOpen() && CH.rocketDone()) { const r = A.launch(); log.push(`launch at ${sec / 60} min: ${r.ok}`); }
    if (m % 10 === 9) log.push(`${sec / 60} min: goal ${S.goal} "${CH.goal() ? CH.goal().text : '-'}", dug ${S.dug}, rocket ${CH.rocketPct()}%, ring ${S.ring.length}, slots ${S.slots.map((s) => (s ? s.t[0] + s.st[0] : '.')).join('')}`);
  }
  log.push('inventory ' + JSON.stringify(S.inv) + ' kits ' + JSON.stringify(S.kits));
  return { log, launched: S.launched, goal: S.goal, cores: S.cores, min: sec / 60, inv: S.inv };
});
console.log(res.log.join('\n'));
console.log('launched', res.launched, 'after', res.min, 'min · cores', res.cores, '· goal', res.goal);
if (res.launched) {
  const skip = async () => { for (let i = 0; i < 12; i++) { const nb = await p.$('#dialog [data-a="next"]'); if (!nb) break; await nb.click(); await p.waitForTimeout(60); } };
  await skip();
  await p.evaluate(() => CH.U.h.starmap(null, true)); await p.waitForTimeout(300); await skip(); await p.screenshot({ path: `${out}/m-11-starmap.png` });
  await p.evaluate(() => CH.U.h.buy(null, 'quickBelt')); await p.waitForTimeout(100);
  await skip(); await p.click('[data-a="travel"]'); await p.waitForTimeout(400); await p.screenshot({ path: `${out}/m-12-frost.png` });
  console.log('now on', await p.evaluate(() => `${CH.P().name}, ${CH.S.slots.length} slots, kits ${JSON.stringify(CH.S.kits)}, up ${JSON.stringify(CH.S.up)}, dialog ${!document.getElementById('dialog').hidden}`));
}
console.log('errors:', errs.length ? errs.join(' | ') : 'none');
await b.close();
