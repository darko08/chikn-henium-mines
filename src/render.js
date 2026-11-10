// Core Hopper — drawing: starfield, the tiny planet with its cut-away layers, the belt and the items riding it,
// the buildings around the ring, Pip digging, the rocket, comets and floating numbers. Canvas 2D, redrawn every frame.
(() => {
const CH = window.CH, D = CH.D;
const R = (CH.R = { sel: -1, placing: null, floats: [], tapT: 0, launchT: 0, shake: 0 });
let cv, ctx, W = 400, H = 400, dpr = 1, t = 0, stars = [], sprites = {}, spriteKey = '';
const G = {}; // geometry

const TAU = Math.PI * 2;
const OUT = '#0b0e24';
function shade(hex, k) { // k > 0 lighter, k < 0 darker
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function body(c, x, y, w, h, col, r = 0.18) {
  const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, shade(col, 0.25)); g.addColorStop(1, shade(col, -0.25));
  rr(c, x, y, w, h, Math.min(w, h) * r); c.fillStyle = g; c.fill(); c.lineWidth = G.lw; c.strokeStyle = OUT; c.stroke();
}

// ---------- setup ----------
R.init = (canvas) => { cv = canvas; ctx = cv.getContext('2d'); R.resize(); };
R.resize = () => {
  const box = cv.parentElement.getBoundingClientRect();
  W = Math.max(280, Math.floor(box.width)); H = Math.max(280, Math.floor(Math.min(box.height || W, W * 1.05)));
  dpr = Math.min(2.5, window.devicePixelRatio || 1);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const m = Math.min(W, H);
  Object.assign(G, { cx: W / 2, cy: H / 2 + m * 0.03, rp: m * 0.25, bw: m * 0.034, bh: m * 0.088, lw: Math.max(1.4, m * 0.0045) });
  G.rb = G.rp + G.bw * 0.95;
  stars = Array.from({ length: 140 }, (_, i) => ({ x: (Math.sin(i * 91.7) * 0.5 + 0.5) * W, y: (Math.sin(i * 37.3 + 1) * 0.5 + 0.5) * H, r: 0.4 + (i % 5) * 0.28, p: i * 1.7 }));
  spriteKey = '';
};

// ---------- item sprites ----------
function itemSprite(type) {
  const key = `${type}|${G.bw}|${dpr}`;
  if (sprites[key]) return sprites[key];
  const s = Math.max(10, Math.round(G.bw * 1.0 * dpr)), c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d'), it = D.items[type], col = it.color, k = s / 20;
  x.lineWidth = 1.4 * k; x.strokeStyle = OUT; x.translate(s / 2, s / 2);
  const g = x.createLinearGradient(0, -8 * k, 0, 8 * k); g.addColorStop(0, shade(col, 0.35)); g.addColorStop(1, shade(col, -0.3)); x.fillStyle = g;
  x.beginPath();
  if (it.shape === 'rock') { [[-7, -2], [-3, -7], [4, -6], [8, -1], [5, 6], [-4, 7], [-8, 3]].forEach(([a, b], i) => (i ? x.lineTo(a * k, b * k) : x.moveTo(a * k, b * k))); x.closePath(); x.fill(); x.stroke(); }
  else if (it.shape === 'gem') { x.moveTo(0, -8 * k); x.lineTo(7 * k, -1 * k); x.lineTo(0, 8 * k); x.lineTo(-7 * k, -1 * k); x.closePath(); x.fill(); x.stroke(); }
  else if (it.shape === 'brick') { rr(x, -8 * k, -5 * k, 16 * k, 10 * k, 2 * k); x.fill(); x.stroke(); x.beginPath(); x.moveTo(-8 * k, 0); x.lineTo(8 * k, 0); x.moveTo(0, -5 * k); x.lineTo(0, 0); x.stroke(); }
  else if (it.shape === 'plate') { rr(x, -8 * k, -4 * k, 16 * k, 8 * k, 2.5 * k); x.fill(); x.stroke(); }
  else if (it.shape === 'gear') { for (let i = 0; i < 16; i++) { const a = i / 16 * TAU, r = i % 2 ? 5.2 : 8; x.lineTo(Math.cos(a) * r * k, Math.sin(a) * r * k); } x.closePath(); x.fill(); x.stroke(); x.beginPath(); x.arc(0, 0, 2.2 * k, 0, TAU); x.fillStyle = OUT; x.fill(); }
  else if (it.shape === 'coil') { x.arc(0, 0, 7 * k, 0, TAU); x.fill(); x.stroke(); x.beginPath(); for (let i = -1; i <= 1; i++) { x.moveTo(-6 * k, i * 3 * k); x.lineTo(6 * k, i * 3 * k); } x.stroke(); }
  else if (it.shape === 'chip') { rr(x, -7 * k, -7 * k, 14 * k, 14 * k, 2 * k); x.fill(); x.stroke(); x.fillStyle = shade(col, 0.6); x.fillRect(-3 * k, -3 * k, 6 * k, 6 * k); }
  else if (it.shape === 'cell') { rr(x, -4.5 * k, -8 * k, 9 * k, 16 * k, 4 * k); x.fill(); x.stroke(); x.fillStyle = '#fff8'; x.fillRect(-1.5 * k, -5 * k, 3 * k, 8 * k); }
  return (sprites[key] = c);
}
CH.itemIcon = (type, px = 22) => { const c = itemSprite(type); return `<img class="ico" src="${c.toDataURL()}" width="${px}" height="${px}" alt="${D.items[type].name}">`; };

// ---------- geometry helpers ----------
const N = () => CH.S.slots.length;
const slotA = (i) => -Math.PI / 2 + (i + 0.5) * TAU / N();
const posA = (p) => -Math.PI / 2 + p * TAU / N();
const bWidth = () => Math.min(G.rb * TAU / N() * 0.74, G.bh * 1.05);
R.slotXY = (i, up = 0.5) => { const a = slotA(i), r = G.rb + G.bw * 0.5 + G.bh * up; return [G.cx + Math.cos(a) * r, G.cy + Math.sin(a) * r]; };
R.rocketXY = () => [W - Math.min(W, H) * 0.12, Math.min(W, H) * 0.17];
R.cometXY = () => { const a = CH.S.comet ? CH.S.comet.a : 0; return [W * (0.12 + 0.05 * Math.sin(t * 0.4 + a * 6)), H * (0.86 + 0.02 * Math.cos(t * 0.5))]; };
// what is under a tap
R.hit = (x, y) => {
  const S = CH.S;
  if (S.comet) { const [a, b] = R.cometXY(); if (Math.hypot(x - a, y - b) < Math.min(W, H) * 0.08) return { k: 'comet' }; }
  const [rx, ry] = R.rocketXY(); if (Math.abs(x - rx) < W * 0.08 && Math.abs(y - ry) < H * 0.12) return { k: 'rocket' };
  const dx = x - G.cx, dy = y - G.cy, r = Math.hypot(dx, dy);
  if (r < G.rp) return { k: 'planet' };
  if (r > G.rb - G.bw && r < G.rb + G.bw * 0.5 + G.bh * 1.25) {
    let a = Math.atan2(dy, dx) + Math.PI / 2; a = ((a % TAU) + TAU) % TAU;
    return { k: 'slot', i: Math.floor(a / (TAU / N())) % N() };
  }
  return null;
};

// ---------- the scene ----------
function sky() {
  const S = CH.S, P = CH.P();
  const g = ctx.createRadialGradient(G.cx, G.cy, G.rp * 0.5, G.cx, G.cy, Math.max(W, H) * 0.75);
  g.addColorStop(0, shade(P.pal.bg, 0.12)); g.addColorStop(1, P.pal.bg);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (const s of stars) { ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 1.3 + s.p); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill(); }
  ctx.globalAlpha = 1;
  // home: the stars you lit again
  const hx = W * 0.1, hy = H * 0.1, lit = Math.min(1, 0.12 + S.cores * 0.12), hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, Math.min(W, H) * (0.06 + lit * 0.06));
  hg.addColorStop(0, `rgba(255,236,170,${0.25 + lit * 0.6})`); hg.addColorStop(1, 'rgba(255,236,170,0)');
  ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(hx, hy, Math.min(W, H) * 0.14, 0, TAU); ctx.fill();
}
function planet() {
  const S = CH.S, P = CH.P(), pal = P.pal, { cx, cy, rp } = G, f = Math.min(1, S.dug / P.core);
  let sx = 0, sy = 0;
  if (R.shake > 0) { sx = (Math.random() - 0.5) * R.shake; sy = (Math.random() - 0.5) * R.shake; }
  ctx.save(); ctx.translate(sx, sy);
  const glow = ctx.createRadialGradient(cx, cy, rp * 0.9, cx, cy, rp * 1.5); glow.addColorStop(0, pal.glow + '55'); glow.addColorStop(1, pal.glow + '00');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, rp * 1.5, 0, TAU); ctx.fill();
  const g = ctx.createRadialGradient(cx - rp * 0.35, cy - rp * 0.4, rp * 0.1, cx, cy, rp);
  g.addColorStop(0, shade(pal.surface, 0.35)); g.addColorStop(1, shade(pal.surface, -0.35));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rp, 0, TAU); ctx.fill();
  for (let i = 0; i < 7; i++) { // craters
    const a = i * 2.1 + S.planet, d = rp * (0.25 + (i % 3) * 0.22), r = rp * (0.06 + (i % 4) * 0.025);
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.9;
    if (y < cy - rp * 0.45 && Math.abs(x - cx) < rp * 0.45) continue;
    ctx.fillStyle = shade(pal.surface, -0.25); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.fillStyle = shade(pal.surface, 0.12); ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.6, 0, TAU); ctx.fill();
  }
  // the cut-away: the layers you have dug through, down to the core
  const a0 = -Math.PI / 2 - 0.42, a1 = -Math.PI / 2 + 0.42, rc = rp * 0.15, rad = (fr) => rp - (rp - rc) * fr;
  const wedge = (r) => { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath(); };
  const L = P.layers, cols = [pal.crust, pal.mantle, pal.deep];
  for (let k = 0; k < L.length; k++) { wedge(rad(L[k].at / P.core)); ctx.fillStyle = shade(cols[k], -0.1); ctx.fill(); }
  // stripes for texture
  ctx.save(); wedge(rp); ctx.clip();
  for (let r = rp; r > rc; r -= rp * 0.06) { ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke(); }
  ctx.restore();
  const re = rad(f);
  // the part not dug yet is dark
  ctx.save(); wedge(re); ctx.fillStyle = 'rgba(6,7,22,.86)'; ctx.fill(); ctx.restore();
  // the core
  const open = f >= 1, pulse = 0.5 + 0.5 * Math.sin(t * 3);
  const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rc * (open ? 2.4 : 1.3));
  cg.addColorStop(0, open ? '#fff' : shade(pal.core, -0.5)); cg.addColorStop(0.35, open ? pal.core : shade(pal.core, -0.6)); cg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = open ? 0.85 + 0.15 * pulse : 0.6; ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, rc * (open ? 2.4 : 1.3), 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  // wedge edges
  ctx.strokeStyle = OUT; ctx.lineWidth = G.lw * 1.2; wedge(rp); ctx.stroke();
  pip(cx, cy - Math.max(re, rc * 1.4));
  ctx.restore();
}
function pip(x, y) { // the little digging robot
  const s = G.bh * 0.32, dig = t - R.tapT < 0.35, sw = dig ? Math.sin((t - R.tapT) * 30) * 0.6 : Math.sin(t * 2) * 0.08;
  ctx.save(); ctx.translate(x, y - s * 0.9 + Math.sin(t * 3) * s * 0.06);
  ctx.save(); ctx.rotate(-0.6 + sw); ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = s * 0.18; ctx.beginPath(); ctx.moveTo(s * 0.4, 0); ctx.lineTo(s * 1.2, -s * 0.5); ctx.stroke();
  ctx.strokeStyle = '#c9d2e3'; ctx.lineWidth = s * 0.22; ctx.beginPath(); ctx.moveTo(s * 0.95, -s * 0.85); ctx.quadraticCurveTo(s * 1.35, -s * 0.55, s * 1.4, -s * 0.1); ctx.stroke(); ctx.restore();
  body(ctx, -s * 0.45, -s * 0.1, s * 0.9, s * 0.75, '#e9b34a', 0.3);
  ctx.beginPath(); ctx.arc(0, -s * 0.45, s * 0.48, 0, TAU); ctx.fillStyle = '#f4f6ff'; ctx.fill(); ctx.lineWidth = G.lw; ctx.strokeStyle = OUT; ctx.stroke();
  rr(ctx, -s * 0.32, -s * 0.62, s * 0.64, s * 0.3, s * 0.14); ctx.fillStyle = '#1d2a5c'; ctx.fill();
  ctx.fillStyle = '#7ff3ff'; ctx.beginPath(); ctx.arc(-s * 0.12, -s * 0.47, s * 0.07, 0, TAU); ctx.arc(s * 0.14, -s * 0.47, s * 0.07, 0, TAU); ctx.fill();
  ctx.restore();
}
function belt() {
  const S = CH.S, P = CH.P(), { cx, cy, rb, bw } = G;
  ctx.lineWidth = bw; ctx.strokeStyle = P.pal.belt; ctx.beginPath(); ctx.arc(cx, cy, rb, 0, TAU); ctx.stroke();
  ctx.lineWidth = G.lw; ctx.strokeStyle = OUT; ctx.beginPath(); ctx.arc(cx, cy, rb + bw / 2, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy, rb - bw / 2, 0, TAU); ctx.stroke();
  const arc = rb * TAU / N();
  ctx.setLineDash([arc * 0.05, arc * 0.2]); ctx.lineDashOffset = -(t * CH.beltSpeed() * arc) % (arc * 0.25);
  ctx.lineWidth = bw * 0.5; ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.arc(cx, cy, rb, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  const sz = bw * 0.95;
  for (const it of S.ring) {
    const a = posA(it.p), x = cx + Math.cos(a) * rb, y = cy + Math.sin(a) * rb;
    ctx.drawImage(itemSprite(it.t), x - sz / 2, y - sz / 2, sz, sz);
  }
}
// ---------- buildings ----------
function building(s, i) {
  const a = slotA(i), w = bWidth(), h = G.bh, base = -G.bw * 0.5, on = s.st === 'work';
  ctx.save(); ctx.translate(G.cx + Math.cos(a) * G.rb, G.cy + Math.sin(a) * G.rb); ctx.rotate(a + Math.PI / 2); ctx.translate(0, base);
  if (R.sel === i) { ctx.shadowColor = '#ffe27a'; ctx.shadowBlur = 18; }
  const col = D.buildings[s.t].color;
  if (s.t === 'drill') {
    const jit = on ? Math.sin(t * 50) * w * 0.012 : 0; ctx.translate(jit, 0);
    ctx.save(); ctx.translate(0, G.bw * 0.95); ctx.rotate(on ? t * 9 : 0); // the bit, turning in the ground
    ctx.beginPath(); ctx.moveTo(-w * 0.12, -w * 0.05); ctx.lineTo(w * 0.12, -w * 0.05); ctx.lineTo(0, w * 0.2); ctx.closePath(); ctx.fillStyle = '#c9d2e3'; ctx.fill(); ctx.lineWidth = G.lw; ctx.strokeStyle = OUT; ctx.stroke(); ctx.restore();
    ctx.lineCap = 'round';
    for (const sgn of [-1, 1]) { ctx.strokeStyle = OUT; ctx.lineWidth = w * 0.13; ctx.beginPath(); ctx.moveTo(sgn * w * 0.4, 0); ctx.lineTo(sgn * w * 0.1, -h * 0.82); ctx.stroke(); ctx.strokeStyle = shade(col, -0.1); ctx.lineWidth = w * 0.07; ctx.stroke(); }
    ctx.strokeStyle = shade(col, -0.2); ctx.lineWidth = w * 0.06; ctx.beginPath(); ctx.moveTo(-w * 0.27, -h * 0.38); ctx.lineTo(w * 0.27, -h * 0.38); ctx.stroke();
    body(ctx, -w * 0.22, -h * 1.0, w * 0.44, h * 0.22, col);
    ctx.drawImage(itemSprite(s.ore), -w * 0.17, -h * 1.0 - w * 0.36, w * 0.34, w * 0.34);
  } else if (s.t === 'furnace') {
    body(ctx, w * 0.12, -h * 1.0, w * 0.2, h * 0.4, '#7a4436', 0.1);
    body(ctx, -w * 0.45, -h * 0.72, w * 0.9, h * 0.72, '#b4583f');
    rr(ctx, -w * 0.22, -h * 0.38, w * 0.44, h * 0.3, w * 0.12); ctx.fillStyle = on ? `rgba(255,${150 + 60 * Math.sin(t * 9)},60,1)` : '#3a1f1a'; ctx.fill(); ctx.lineWidth = G.lw; ctx.strokeStyle = OUT; ctx.stroke();
    if (on) for (let k = 0; k < 3; k++) { const ph = (t * 0.7 + k / 3) % 1; ctx.globalAlpha = 0.5 * (1 - ph); ctx.fillStyle = '#cfd4e6'; ctx.beginPath(); ctx.arc(w * 0.22 + ph * w * 0.15, -h * 1.05 - ph * h * 0.5, w * (0.06 + ph * 0.1), 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
  } else if (s.t === 'press') {
    body(ctx, -w * 0.45, -h * 0.5, w * 0.9, h * 0.5, col);
    body(ctx, -w * 0.4, -h * 1.0, w * 0.12, h * 0.55, '#7d8db0', 0.2);
    body(ctx, w * 0.28, -h * 1.0, w * 0.12, h * 0.55, '#7d8db0', 0.2);
    const py = on ? Math.abs(Math.sin(t * 5)) * h * 0.22 : 0;
    body(ctx, -w * 0.3, -h * 0.98 + py, w * 0.6, h * 0.16, '#e2e7f2', 0.2);
  } else if (s.t === 'assembler') {
    body(ctx, -w * 0.46, -h * 0.85, w * 0.92, h * 0.85, col);
    ctx.save(); ctx.translate(0, -h * 0.45); ctx.rotate(on ? t * 2.5 : 0);
    ctx.beginPath(); for (let k = 0; k < 16; k++) { const aa = k / 16 * TAU, r = (k % 2 ? 0.17 : 0.24) * w; ctx.lineTo(Math.cos(aa) * r, Math.sin(aa) * r); } ctx.closePath();
    ctx.fillStyle = '#e8fff8'; ctx.fill(); ctx.lineWidth = G.lw; ctx.strokeStyle = OUT; ctx.stroke(); ctx.restore();
    ctx.fillStyle = on && Math.sin(t * 8) > 0 ? '#9fffcf' : '#1d6b58'; ctx.beginPath(); ctx.arc(w * 0.3, -h * 0.75, w * 0.05, 0, TAU); ctx.fill();
  } else if (s.t === 'refinery') {
    body(ctx, -w * 0.45, -h * 0.95, w * 0.38, h * 0.95, col, 0.45);
    body(ctx, w * 0.06, -h * 0.72, w * 0.38, h * 0.72, shadeHex(col, -0.08), 0.45);
    ctx.strokeStyle = OUT; ctx.lineWidth = w * 0.07; ctx.beginPath(); ctx.moveTo(-w * 0.07, -h * 0.6); ctx.lineTo(w * 0.06, -h * 0.6); ctx.stroke();
    if (on) for (let k = 0; k < 3; k++) { const ph = (t * 0.9 + k / 3) % 1; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(-w * 0.26 + (k - 1) * w * 0.07, -h * (0.15 + ph * 0.7), w * 0.035, 0, TAU); ctx.fill(); }
  } else if (s.t === 'feeder') {
    body(ctx, -w * 0.42, -h * 0.66, w * 0.84, h * 0.66, col);
    if (s.feed) ctx.drawImage(itemSprite(s.feed), -w * 0.18, -h * 0.56, w * 0.36, w * 0.36);
    const by = on ? -Math.abs(Math.sin(t * 6)) * h * 0.08 : 0; ctx.fillStyle = '#efe0ff'; ctx.beginPath(); ctx.moveTo(-w * 0.14, -h * 0.74 + by); ctx.lineTo(w * 0.14, -h * 0.74 + by); ctx.lineTo(0, -h * 0.98 + by); ctx.closePath(); ctx.fill(); ctx.lineWidth = G.lw; ctx.strokeStyle = OUT; ctx.stroke();
  } else if (s.t === 'dock') {
    body(ctx, -w * 0.45, -h * 0.62, w * 0.9, h * 0.62, col);
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = G.lw; for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(k * w * 0.22, -h * 0.55); ctx.lineTo(k * w * 0.22, -h * 0.08); ctx.stroke(); }
    if (s.mode === 'parts') { ctx.drawImage(itemSprite('gear'), -w * 0.16, -h * 0.5, w * 0.32, w * 0.32); }
    if (s.taken > 0) { const by = Math.sin(t * 8) * h * 0.06; ctx.fillStyle = '#9fe0ff'; ctx.beginPath(); ctx.moveTo(-w * 0.14, -h * 0.98 + by); ctx.lineTo(w * 0.14, -h * 0.98 + by); ctx.lineTo(0, -h * 0.74 + by); ctx.closePath(); ctx.fill(); ctx.lineWidth = G.lw; ctx.strokeStyle = OUT; ctx.stroke(); }
  }
  ctx.shadowBlur = 0;
  // level pips and the status light
  for (let k = 0; k < s.lv; k++) { ctx.fillStyle = '#ffe27a'; ctx.beginPath(); ctx.arc(-w * 0.32 + k * w * 0.16, -h * 0.06, w * 0.045, 0, TAU); ctx.fill(); }
  const sc = s.st === 'work' ? '#5dff8a' : s.st === 'full' ? '#ff5a6a' : '#ffc94d';
  ctx.fillStyle = sc; ctx.beginPath(); ctx.arc(w * 0.42, -h * 0.98, w * 0.07, 0, TAU); ctx.fill(); ctx.lineWidth = G.lw * 0.8; ctx.strokeStyle = OUT; ctx.stroke();
  ctx.restore();
}
function shadeHex(hex, k) { const m = shade(hex, k).match(/\d+/g).map(Number); return '#' + m.map((v) => v.toString(16).padStart(2, '0')).join(''); }
function emptySlot(i) {
  const a = slotA(i), w = bWidth() * 0.62, glow = R.placing != null;
  ctx.save(); ctx.translate(G.cx + Math.cos(a) * G.rb, G.cy + Math.sin(a) * G.rb); ctx.rotate(a + Math.PI / 2); ctx.translate(0, -G.bw * 0.5 - G.bh * 0.4);
  ctx.setLineDash([4, 4]); ctx.lineWidth = G.lw; ctx.strokeStyle = glow ? `rgba(120,255,160,${0.6 + 0.4 * Math.sin(t * 6)})` : 'rgba(255,255,255,.25)';
  rr(ctx, -w / 2, -w / 2, w, w, w * 0.25); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = glow ? 'rgba(120,255,160,.9)' : 'rgba(255,255,255,.35)'; ctx.font = `${Math.round(w * 0.6)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('+', 0, 1);
  if (R.sel === i) { ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = G.lw * 1.5; rr(ctx, -w / 2 - 3, -w / 2 - 3, w + 6, w + 6, w * 0.3); ctx.stroke(); }
  ctx.restore();
}
function rocket() {
  const S = CH.S, P = CH.P(), [x0, y0] = R.rocketXY(), m = Math.min(W, H), h = m * 0.17, w = h * 0.42;
  const pct = (id) => { const part = P.rocket.find((p) => p.id === id), have = S.rocket[id] || {}; let a = 0, b = 0; for (const k in part.need) { b += part.need[k]; a += Math.min(part.need[k], have[k] || 0); } return b ? a / b : 1; };
  const hull = pct('hull'), eng = pct('engine'), tank = pct('tank');
  let y = y0, x = x0;
  if (R.launchT) { const k = Math.min(1, (t - R.launchT) / 2.4); y = y0 - k * k * H * 1.2; }
  ctx.save(); ctx.translate(x, y);
  // pad
  if (!R.launchT) { ctx.fillStyle = '#3a3f66'; rr(ctx, -w * 0.9, h * 0.52, w * 1.8, h * 0.08, 4); ctx.fill(); }
  // scaffold
  ctx.strokeStyle = 'rgba(200,210,255,.35)'; ctx.lineWidth = 1.5; if (hull < 1) { ctx.strokeRect(-w * 0.55, -h * 0.5, w * 1.1, h * 1.02); }
  // hull fills from the bottom as parts arrive
  ctx.save(); ctx.beginPath(); ctx.rect(-w, h * 0.5 - h * 1.05 * hull, w * 2, h * 1.1 * hull + 2); ctx.clip();
  ctx.beginPath(); ctx.moveTo(0, -h * 0.5); ctx.quadraticCurveTo(w * 0.55, -h * 0.2, w * 0.38, h * 0.38); ctx.lineTo(-w * 0.38, h * 0.38); ctx.quadraticCurveTo(-w * 0.55, -h * 0.2, 0, -h * 0.5); ctx.closePath();
  const g = ctx.createLinearGradient(-w * 0.5, 0, w * 0.5, 0); g.addColorStop(0, '#c9d3ec'); g.addColorStop(0.5, '#ffffff'); g.addColorStop(1, '#8e9bc0');
  ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = G.lw; ctx.strokeStyle = OUT; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -h * 0.12, w * 0.16, 0, TAU); ctx.fillStyle = tank >= 1 ? '#ffd84d' : '#4e6db3'; ctx.fill(); ctx.stroke();
  ctx.restore();
  // fins and engine
  ctx.globalAlpha = 0.25 + 0.75 * eng; ctx.fillStyle = '#ff7a45';
  for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sgn * w * 0.32, h * 0.1); ctx.lineTo(sgn * w * 0.62, h * 0.48); ctx.lineTo(sgn * w * 0.3, h * 0.42); ctx.closePath(); ctx.fill(); ctx.lineWidth = G.lw; ctx.strokeStyle = OUT; ctx.stroke(); }
  ctx.globalAlpha = 1;
  if (R.launchT || (hull >= 1 && eng >= 1 && tank >= 1)) { const fl = h * (R.launchT ? 0.6 : 0.12) * (0.8 + 0.2 * Math.sin(t * 30)); ctx.fillStyle = R.launchT ? '#ffd84d' : 'rgba(255,216,77,.5)'; ctx.beginPath(); ctx.moveTo(-w * 0.2, h * 0.4); ctx.lineTo(w * 0.2, h * 0.4); ctx.lineTo(0, h * 0.4 + fl); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  if (!R.launchT) { ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.font = `600 ${Math.round(m * 0.03)}px system-ui`; ctx.textAlign = 'center'; ctx.fillText(`${CH.rocketPct()}%`, x0, y0 + h * 0.75); }
}
function comet() {
  if (!CH.S.comet) return;
  const [x, y] = R.cometXY(), m = Math.min(W, H);
  const g = ctx.createLinearGradient(x, y, x + m * 0.16, y + m * 0.06); g.addColorStop(0, 'rgba(160,240,255,.9)'); g.addColorStop(1, 'rgba(160,240,255,0)');
  ctx.strokeStyle = g; ctx.lineWidth = m * 0.03; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + m * 0.16, y + m * 0.06); ctx.stroke();
  ctx.fillStyle = '#e8fbff'; ctx.beginPath(); ctx.arc(x, y, m * (0.018 + 0.004 * Math.sin(t * 6)), 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `700 ${Math.round(m * 0.028)}px system-ui`; ctx.textAlign = 'left'; ctx.fillText('Tap!', x + m * 0.03, y - m * 0.025);
}
function floats(dt) {
  R.floats = R.floats.filter((f) => (f.life -= dt) > 0);
  ctx.textAlign = 'center';
  for (const f of R.floats) {
    const k = 1 - f.life / f.max; ctx.globalAlpha = Math.min(1, f.life * 2);
    if (f.icon) ctx.drawImage(itemSprite(f.icon), f.x - 22, f.y - k * 36 - 10, 18, 18);
    ctx.font = `800 ${f.size || 15}px system-ui`; ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.strokeText(f.txt, f.x + (f.icon ? 8 : 0), f.y - k * 36); ctx.fillStyle = f.col || '#fff'; ctx.fillText(f.txt, f.x + (f.icon ? 8 : 0), f.y - k * 36);
  }
  ctx.globalAlpha = 1;
}
R.float = (x, y, txt, col, icon, size) => R.floats.push({ x, y, txt, col, icon, size, life: 1.2, max: 1.2 });

R.draw = (dt) => {
  t += dt; if (R.shake > 0) R.shake = Math.max(0, R.shake - dt * 20);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sky(); planet(); belt();
  CH.S.slots.forEach((s, i) => (s ? building(s, i) : emptySlot(i)));
  rocket(); comet(); floats(dt);
};
R.time = () => t;
})();
