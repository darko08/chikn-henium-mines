// Core Hopper — the simulation: the belt around the planet, buildings, digging, goals, story beats, the rocket,
// comets, saving and the catch-up while you were away. Everything runs on CH.step(dt).
(() => {
const CH = window.CH, D = CH.D;
const SAVE = 'core-hopper-v1';
const ok = (x) => Object.assign({ ok: true }, x), fail = (msg) => ({ ok: false, msg });

// ---------- events ----------
const handlers = {};
CH.on = (e, f) => (handlers[e] = handlers[e] || []).push(f);
CH.emit = (e, ...a) => (handlers[e] || []).forEach((f) => { try { f(...a); } catch (err) { console.error(err); } });
CH.now = () => Date.now() + ((CH.S && CH.S.clockOff) || 0);

// ---------- state ----------
CH.newGame = () => {
  const t = Date.now();
  const S = { v: 1, cores: 0, up: {}, logs: [], stats: { taps: 0, launches: 0, made: 0 }, settings: { sound: true, speed: 1 },
    clockOff: 0, last: t, created: t, cometNext: t + 20 * 60e3 };
  CH.newRun(S, 0);
  return S;
};
// a fresh world: an empty ring, starter kits, nothing dug
CH.newRun = (S, pi) => {
  const P = D.planet(pi), n = P.slots + (S.up.wideRing ? 2 : 0);
  Object.assign(S, { planet: pi, slots: Array(n).fill(null), ring: [], inv: {}, got: {}, ema: {}, dug: 0, rocket: {}, goal: 0, beats: {},
    launched: false, comet: null, kits: { drill: 2, dock: 1 } });
  if (pi > 0) S.kits.furnace = 1;
  if (S.up.headStart) { S.kits.drill += 2; S.kits.furnace = (S.kits.furnace || 0) + 1; }
  CH.queue = CH.queue || [];
  return S;
};
CH.P = () => D.planet(CH.S.planet);
CH.layer = (dug = CH.S.dug) => { const L = CH.P().layers; let i = 0; L.forEach((l, k) => { if (dug >= l.at) i = k; }); return i; };
CH.ores = () => CH.P().layers.filter((l) => CH.S.dug >= l.at).flatMap((l) => l.ores);
CH.coreOpen = () => CH.S.dug >= CH.P().core;
CH.rocketPct = (S = CH.S) => {
  let need = 0, have = 0;
  for (const part of D.planet(S.planet).rocket) for (const t in part.need) { need += part.need[t]; have += Math.min(part.need[t], ((S.rocket[part.id] || {})[t]) || 0); }
  return need ? Math.floor(have / need * 100) : 100;
};
CH.rocketDone = () => CH.rocketPct() >= 100;
CH.goals = () => (CH.S.planet === 0 ? D.goalsFirst : D.goalsNext);
CH.goal = () => CH.goals()[CH.S.goal] || null;
CH.beltSpeed = () => D.belt.speed * (CH.S.up.quickBelt ? 1.3 : 1);
CH.bSpeed = (st) => D.speed(st.lv) * (CH.S.up.overclock ? 1.25 : 1);
CH.awayCap = () => (CH.S.up.longNap ? 8 : 3) * 3600;
CH.perMin = (t) => (CH.S.ema[t] || 0) * 2; // items collected per minute (moving average)
CH.has = (cost, k = 1) => Object.entries(cost).every(([t, n]) => (CH.S.inv[t] || 0) >= n * k);
CH.missing = (cost, k = 1) => Object.entries(cost).filter(([t, n]) => (CH.S.inv[t] || 0) < n * k).map(([t, n]) => `${n * k - (CH.S.inv[t] || 0)} ${D.items[t].name}`);
const pay = (cost, k = 1) => { for (const t in cost) CH.S.inv[t] -= cost[t] * k; };
const give = (S, rew) => { for (const t in rew) { if (t === 'kit') S.kits[rew[t]] = (S.kits[rew[t]] || 0) + 1; else S.inv[t] = (S.inv[t] || 0) + rew[t]; } };

// ---------- stations ----------
const mk = (t) => ({ t, lv: 1, buf: {}, out: [], cur: -1, prog: 0, rr: 0, st: 'idle', ore: 'stone', mode: 'all', tok: 2, taken: 0, rec: -1 });
// the recipes a machine runs: all of them, or the one the player picked
CH.recipes = (s) => { const R = D.buildings[s.t].recipes || []; return s.rec >= 0 && R[s.rec] ? [R[s.rec]] : R; };
// does this building take this item off the belt right now? (lap: how far the item has ridden, in slots)
CH.accepts = (s, t, lap = 0) => {
  if (s.t === 'dock') return s.tok >= 1 && (s.mode !== 'parts' || D.items[t].kind !== 'ore' || lap >= CH.S.slots.length); // ore nobody took after a full lap
  const R = CH.recipes(s);
  if (!R.length) return false;
  let need = 0;
  for (const r of R) if (r.in[t]) need = Math.max(need, r.in[t]);
  return need > 0 && (s.buf[t] || 0) < need * 2;
};
function work(S, s, dt) {
  const B = D.buildings[s.t], spd = CH.bSpeed(s);
  if (s.t === 'drill') {
    if (s.out.length >= 3) { s.st = 'full'; return; }
    if (!CH.ores().includes(s.ore)) s.ore = 'stone';
    s.prog += dt * spd; s.st = 'work';
    if (s.prog >= B.t) { s.prog -= B.t; s.out.push(s.ore); S.dug += 1; }
    return;
  }
  if (s.t === 'dock') { s.tok = Math.min(3, s.tok + dt * D.dockSpeed(s.lv)); s.st = s.taken > 0 ? 'work' : 'idle'; return; }
  if (s.t === 'feeder') { // storage → belt
    const t = s.feed;
    if (!t || !(S.inv[t] >= 1)) { s.st = 'idle'; return; }
    if (s.out.length >= 2) { s.st = 'full'; return; }
    s.prog += dt * spd; s.st = 'work';
    if (s.prog >= B.t) { s.prog -= B.t; S.inv[t] -= 1; s.out.push(t); }
    return;
  }
  if (s.cur < 0) {
    if (s.out.length > 2) { s.st = 'full'; return; }
    for (let k = 0; k < B.recipes.length; k++) {
      const ri = (s.rr + k) % B.recipes.length, r = B.recipes[ri];
      if (s.rec >= 0 && ri !== s.rec) continue;
      if (Object.entries(r.in).every(([t, n]) => (s.buf[t] || 0) >= n)) {
        for (const t in r.in) s.buf[t] -= r.in[t];
        s.cur = ri; s.prog = 0; s.rr = ri + 1; break;
      }
    }
    if (s.cur < 0) { s.st = 'idle'; return; }
  }
  const r = B.recipes[s.cur];
  s.prog += dt * spd; s.st = 'work';
  if (s.prog >= r.t) {
    const outs = Object.entries(r.out).flatMap(([t, n]) => Array(n).fill(t));
    if (s.out.length + outs.length > 4) { s.prog = r.t; s.st = 'full'; return; }
    s.out.push(...outs); s.cur = -1; s.prog = 0; S.stats.made += outs.length;
  }
}
const gapAt = (S, c) => { const n = S.slots.length; for (const it of S.ring) { const d = Math.abs(it.p - c); if (Math.min(d, n - d) < D.belt.gap) return false; } return true; };

// ---------- one step of the world ----------
CH.step = (dt) => {
  const S = CH.S, n = S.slots.length;
  S.slots.forEach((s) => { if (s) { s.taken = Math.max(0, s.taken - dt); work(S, s, dt); } });
  // buildings put their products on the belt where there is room
  S.slots.forEach((s, i) => { if (s && s.out.length && gapAt(S, i + 0.5)) S.ring.push({ t: s.out.shift(), p: i + 0.501, d: 0 }); });
  // the belt moves clockwise; a building takes an item as it passes the building's middle
  const v = CH.beltSpeed() * dt;
  for (let k = S.ring.length - 1; k >= 0; k--) {
    const it = S.ring[k], p1 = it.p + v;
    for (let c = Math.floor(it.p + 0.5) + 0.5; c <= p1; c += 1) {
      const i = Math.floor(c) % n, s = S.slots[i];
      if (s && CH.accepts(s, it.t, (it.d || 0) + (c - it.p))) {
        S.ring.splice(k, 1);
        if (s.t === 'dock') { s.tok -= 1; s.taken = 1; S.inv[it.t] = (S.inv[it.t] || 0) + 1; S.got[it.t] = (S.got[it.t] || 0) + 1; S.ema[it.t] = (S.ema[it.t] || 0) + 1; CH.emit('collect', it.t, i); }
        else s.buf[it.t] = (s.buf[it.t] || 0) + 1;
        it.gone = true; break;
      }
    }
    if (!it.gone) { it.p = p1 % n; it.d = (it.d || 0) + v; }
  }
  const decay = Math.exp(-dt / 30);
  for (const t in S.ema) S.ema[t] *= decay;
  CH.check();
};

// ---------- goals, story, layers, comets ----------
CH.queue = [];
const beat = (b) => { CH.queue.push(b); if (b.log && !CH.S.logs.includes(b.log)) CH.S.logs.push(b.log); };
CH.fire = (on) => { // a story event ("start", "core", "launch", "firstDock")
  const S = CH.S, list = D.story[S.planet] || D.story.more;
  list.forEach((b, i) => { if (b.on === on && !S.beats[i]) { S.beats[i] = 1; beat(b); } });
};
CH.check = () => {
  const S = CH.S, list = D.story[S.planet] || D.story.more;
  list.forEach((b, i) => { if (b.at != null && !S.beats[i] && S.dug >= b.at) { S.beats[i] = 1; beat(b); } });
  const L = CH.layer();
  if ((S.seenLayer || 0) < L) { S.seenLayer = L; CH.emit('layer', CH.P().layers[L]); }
  if (CH.coreOpen() && !S.coreSeen) { S.coreSeen = true; CH.fire('core'); CH.emit('core'); }
  if (!S.beats.dock && S.slots.some((s) => s && s.t === 'dock') && S.slots.some((s) => s && s.t === 'drill')) { S.beats.dock = 1; CH.fire('firstDock'); }
  for (let g = CH.goal(); g && g.p(S) >= g.n; g = CH.goal()) {
    if (g.rew) give(S, g.rew);
    S.goal += 1; CH.emit('goal', g);
  }
  const t = CH.now();
  if (S.comet && t > S.comet.until) { S.comet = null; S.cometNext = t + rnd(D.comet.every) * 1000; }
  if (!S.comet && t >= S.cometNext) { S.comet = { until: t + D.comet.stays * 1000, a: Math.random() }; CH.emit('comet'); }
};
const rnd = ([a, b]) => a + Math.random() * (b - a);

// ---------- player actions ----------
CH.act = {
  tap() { const S = CH.S; S.inv.stone = (S.inv.stone || 0) + 1; S.got.stone = (S.got.stone || 0) + 1; S.dug += 1; S.stats.taps += 1; return ok(); },
  place(i, t) {
    const S = CH.S;
    if (S.slots[i]) return fail('That slot is taken');
    if (!(S.kits[t] > 0)) return fail(`You have no ${D.buildings[t].name} kit. Craft one in the Workshop.`);
    S.kits[t] -= 1; S.slots[i] = mk(t);
    return ok();
  },
  pickup(i) {
    const S = CH.S, s = S.slots[i];
    if (!s) return fail('Nothing to pick up');
    S.kits[s.t] = (S.kits[s.t] || 0) + 1;
    for (const t in s.buf) S.inv[t] = (S.inv[t] || 0) + s.buf[t];
    for (const t of s.out) S.inv[t] = (S.inv[t] || 0) + 1;
    S.slots[i] = null;
    return ok({ lv: s.lv });
  },
  craft(t, n = 1) {
    const cost = D.buildings[t].kit;
    if (!CH.has(cost, n)) return fail(`Not enough: ${CH.missing(cost, n).join(', ')}`);
    pay(cost, n); CH.S.kits[t] = (CH.S.kits[t] || 0) + n;
    return ok();
  },
  upgrade(i) {
    const s = CH.S.slots[i], cost = s && D.upCost(s.t, s.lv);
    if (!s) return fail('Nothing there');
    if (!cost) return fail('Already at max level');
    if (!CH.has(cost)) return fail(`Not enough: ${CH.missing(cost).join(', ')}`);
    pay(cost); s.lv += 1;
    return ok({ lv: s.lv });
  },
  setOre(i, ore) { const s = CH.S.slots[i]; if (!s || s.t !== 'drill' || !CH.ores().includes(ore)) return fail('Not here'); s.ore = ore; s.prog = 0; return ok(); },
  setRecipe(i, k) { // -1: everything it can make
    const S = CH.S, s = S.slots[i], R = s && D.buildings[s.t].recipes;
    if (!R || k < -1 || k >= R.length) return fail('Not here');
    s.rec = k; s.cur = -1; s.prog = 0;
    const keep = new Set(CH.recipes(s).flatMap((r) => Object.keys(r.in)));
    for (const t in s.buf) if (!keep.has(t) && s.buf[t] > 0) { S.inv[t] = (S.inv[t] || 0) + s.buf[t]; s.buf[t] = 0; } // inputs it no longer uses go to storage
    return ok();
  },
  setFeed(i, t) { const s = CH.S.slots[i]; if (!s || s.t !== 'feeder' || !D.items[t]) return fail('Not a Feeder'); s.feed = t; return ok(); },
  setMode(i, m) { const s = CH.S.slots[i]; if (!s || s.t !== 'dock') return fail('Not a Dock'); s.mode = m; return ok(); },
  deliver(id) {
    const S = CH.S, part = CH.P().rocket.find((x) => x.id === id);
    if (!part) return fail('No such part');
    const have = (S.rocket[id] = S.rocket[id] || {});
    let moved = 0;
    for (const t in part.need) {
      const k = Math.min(part.need[t] - (have[t] || 0), S.inv[t] || 0);
      if (k > 0) { have[t] = (have[t] || 0) + k; S.inv[t] -= k; moved += k; }
    }
    return moved ? ok({ moved }) : fail(`Nothing to deliver yet. It still needs ${Object.entries(part.need).filter(([t, n]) => (have[t] || 0) < n).map(([t, n]) => `${n - (have[t] || 0)} ${D.items[t].name}`).join(', ')}`);
  },
  launch() {
    const S = CH.S;
    if (!CH.coreOpen()) return fail(`Dig down to the core first (${D.fmt(S.dug)} of ${D.fmt(CH.P().core)})`);
    if (!CH.rocketDone()) return fail('Finish the rocket first');
    if (S.launched) return fail('Already launched');
    S.launched = true; S.cores += 1; S.stats.launches += 1;
    CH.fire('launch'); CH.check();
    return ok();
  },
  travel() { const S = CH.S; if (!S.launched) return fail('Launch first'); CH.queue.length = 0; CH.newRun(S, S.planet + 1); CH.fire('start'); return ok(); },
  buy(id) {
    const S = CH.S, u = D.ups.find((x) => x.id === id);
    if (!u || S.up[id]) return fail('Already yours');
    if (S.cores < u.cost) return fail(`Needs ${u.cost} Star Core${u.cost > 1 ? 's' : ''}`);
    S.cores -= u.cost; S.up[id] = true;
    if (id === 'wideRing') S.slots.push(null, null);
    return ok();
  },
  comet() {
    const S = CH.S;
    if (!S.comet) return fail('The comet is gone');
    const parts = D.itemOrder.filter((t) => (S.got[t] || 0) > 0 && D.items[t].kind === 'part');
    const t = parts.length && Math.random() < 0.6 ? parts[Math.floor(Math.random() * parts.length)] : CH.ores()[Math.floor(Math.random() * CH.ores().length)];
    const n = D.items[t].kind === 'part' ? 8 + Math.floor(Math.random() * 10) : 25 + Math.floor(Math.random() * 30);
    S.inv[t] = (S.inv[t] || 0) + n; S.comet = null; S.cometNext = CH.now() + rnd(D.comet.every) * 1000;
    return ok({ t, n });
  },
};

// ---------- time away ----------
// the factory keeps running while you are away (up to 3 hours, 8 with Long Nap)
CH.catchUp = (sec) => {
  const S = CH.S, run = Math.min(sec, CH.awayCap());
  if (run < 5) return null;
  const got0 = { ...S.got }, dug0 = S.dug, layer0 = CH.layer(), goal0 = S.goal;
  const dt = 0.2, steps = Math.ceil(run / dt);
  for (let i = 0; i < steps; i++) CH.step(Math.min(dt, run - i * dt));
  const got = {};
  for (const t in S.got) { const d = S.got[t] - (got0[t] || 0); if (d > 0) got[t] = d; }
  const core = CH.P().core;
  return { sec, run, got, dug: Math.min(S.dug, core) - Math.min(dug0, core), layer: CH.layer() > layer0 ? CH.P().layers[CH.layer()] : null, core: CH.coreOpen() && dug0 < CH.P().core, goals: S.goal - goal0 };
};

// ---------- saving ----------
CH.save = () => { try { CH.S.last = CH.now(); localStorage.setItem(SAVE, JSON.stringify(CH.S)); } catch (e) { /* storage blocked */ } };
CH.load = () => {
  try {
    const raw = localStorage.getItem(SAVE);
    if (!raw) return null;
    const S = JSON.parse(raw);
    return S && S.v === 1 && Array.isArray(S.slots) ? S : null;
  } catch (e) { return null; }
};
CH.wipe = () => { try { localStorage.removeItem(SAVE); } catch (e) { /* ignore */ } };
})();
