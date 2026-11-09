// DEX screen: Uniswap-style swaps between every resource, EGG, HENIUM and (simulated) ETH; liquidity pools with live
// charts; why HENIUM is scarce (21M cap, halvings, who mints it, what burns it); a wallet with ETH cash-out; swap history.
// AMM core: src/js/dex.js (G.dexQuote, G.act.swap, G.dexPools, G.spot, G.poolTVL ...). Replaces the old Market screen.
(() => {
const G = window.G, D = G.D, ui = G.ui, esc = ui.esc;

const TABS = [['swap', 'Swap', 'ui/dex'], ['pools', 'Pools', 'ui/market'], ['henium', 'HENIUM', 'res/henium'], ['wallet', 'Wallet', 'prop/chest'], ['history', 'History', 'ui/timer']];
const QUICK = [['egg', 'henium'], ['henium', 'eth'], ['egg', 'eth'], ['stone', 'henium'], ['copperIngot', 'alloy']];
const SLIPS = [0.005, 0.01, 0.03];
const POPULAR = ['egg', 'henium', 'eth'];
const WALLET = ['egg', 'henium', 'feed', 'eth'];
const CASH = ['egg', 'henium'];
const SELLS = [0.1, 0.25, 0.5, 1];
const DESC = { egg: 'Laid by your Chikns · scarce', henium: 'Minted by work & fighting · 21M cap', feed: 'Milled in the Feed Mill', eth: 'Simulated · your cash-out asset' };
const CW = 600, CH = 220, CPAD = 16; // price chart viewBox (CPAD = room on the right for the live dot)

// view state (kept while the page is open)
let tab = 'swap', from = 'egg', to = 'henium', amtStr = '', maxMode = false, slip = 0.005, inv = false, pickSide = 'from';
let swapSig = '', chartSig = '', poolSig = '', outSig = '', lastOut = 0, chartPts = [];

// ---------- small helpers ----------
const name = (t) => (D.res[t] ? D.res[t].name : t);
const cat = (t) => (D.res[t] ? D.res[t].cat : '');
const isCur = (t) => cat(t) === 'cur' || cat(t) === 'ext';
const bal = (t) => Math.max(0, (G.S.res[t] || 0));
const args = (...a) => esc(JSON.stringify(a));
const trim = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
const pct = (x, d = 2) => (x > 0 && x < 0.0001 ? '<0.01%' : trim((x * 100).toFixed(d)) + '%');
const setT = (el, s) => { if (el.textContent !== s) el.textContent = s; };
const setH = (el, h) => { if (el && el._dx !== h) { el._dx = h; el.innerHTML = h; } };
const fine = () => window.matchMedia && matchMedia('(pointer: fine)').matches;
const dexReady = () => !!(G.S && G.S.dex && G.S.dex.pools);
const huntShare = () => G.huntShare();     // your hunt points ÷ (yours + all other hunters'), as paid at the day rollover
const huntPerDay = () => G.huntPerDay();
const feeTxt = () => { const f = G.dexFee(); return `${pct(f, f < D.dex.fee ? 3 : 1)} fee per hop${f < D.dex.fee ? ' (Trader discount)' : ''}`; };

// plain number with ~n significant digits and thousands separators (never exponent notation)
function dec(v, n = 4) {
  if (!isFinite(v) || !v) return '0';
  const a = Math.abs(v);
  if (a >= 1e7) return G.fmt(v);
  if (a >= 1000) return G.fmtFull(Math.round(v));
  return trim(v.toFixed(Math.min(12, Math.max(0, n - 1 - Math.floor(Math.log10(a))))));
}
// token amount: HENIUM and ETH keep their decimals, big piles get K/M
function amt(t, v) {
  const a = Math.abs(v || 0);
  if (!(a > 0)) return '0';
  if (a >= 1e7) return G.fmt(v);
  if (a >= 1000) return G.fmtFull(v, t === 'henium' || t === 'eth' ? 2 : 0);
  if (a >= 1) return trim(v.toFixed(t === 'eth' ? 4 : 2));
  return dec(v, 4);
}
// price (HTML): tiny prices get a subscript zero count, e.g. 0.0₆16 = 0.00000016
function px(v) {
  if (!isFinite(v) || v <= 0) return '–';
  if (v >= 1e-4) return dec(v, 4);
  let z = -Math.floor(Math.log10(v)) - 1, m = v * Math.pow(10, z + 1);
  if (m >= 9.9995) { z--; m /= 10; }
  return `0.0<sub>${z}</sub>${trim(m.toFixed(3)).replace('.', '')}`;
}
// a number string for the amount box, rounded down so it never exceeds v
function floorStr(v) {
  if (!(v > 0)) return '';
  const d = v >= 1000 ? 2 : v >= 1 ? 4 : 8, k = Math.pow(10, d);
  return trim((Math.floor(v * k + 1e-9) / k).toFixed(d));
}
// value of v units of t: shown in HENIUM (HENIUM itself in ETH)
function worth(t, v) {
  const u = t === 'henium' ? 'eth' : 'henium', x = v * G.spot(t, u);
  return x > 0 ? `≈ ${ui.icon(u, 15)}${amt(u, x)}` : '';
}
const chg = (c) => {
  const k = Math.abs(c) < 0.00005 ? 'flat' : c > 0 ? 'up' : 'down';
  return `<span class="dx-chg ${k}">${k === 'up' ? '▲' : k === 'down' ? '▼' : '•'} ${Math.abs(c * 100).toFixed(2)}%</span>`;
};
const pairIc = (a, b, s = 30) => `<span class="dx-pair" style="--s:${s}px">${ui.icon(a, s)}${ui.icon(b, s)}</span>`;
function flash(el, up) { if (!el) return; el.classList.remove('dx-fu', 'dx-fd'); void el.offsetWidth; el.classList.add(up ? 'dx-fu' : 'dx-fd'); }

const FLIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 3.5v14m0 0L4 14m3.5 3.5L11 14M16.5 20.5v-14m0 0L13 10m3.5-3.5L20 10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const INV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h15m0 0l-3.5-3.5M19 8l-3.5 3.5M20 16H5m0 0l3.5-3.5M5 16l3.5 3.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>';
const FLAME = '<svg class="dx-fl" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5c.9 3.3-1.2 5-2.6 6.9C8 10.3 6.5 12.3 6.5 15c0 3.8 2.6 7.5 5.5 7.5s5.5-2.7 5.5-7c0-2.8-1.3-5-2.6-6.5.1 2-.7 3.3-1.9 3.8.7-3.8-.1-8-1-11.3z" fill="#ff7a2f"/><path d="M12 12.3c-1.6 1.6-2.7 3.1-2.7 4.9 0 2.1 1.2 3.8 2.7 3.8s2.7-1.5 2.7-3.7c0-1.9-1-3.5-2.7-5z" fill="#ffd54a"/></svg>';

// ---------- prices & charts ----------
// price history of 1 x in y: the pool hist (one point per market-maker trade) plus the live price
function series(x, y) {
  const live = G.spot(x, y), as = (p, t) => (v) => (p.a === t ? v : 1 / v);
  let pts = [];
  const p = G.poolFor(x, y);
  if (p) pts = p.hist.map(as(p, x));
  else {
    const p1 = G.poolFor(x, 'henium'), p2 = G.poolFor('henium', y);
    if (p1 && p2) {
      const n = Math.min(p1.hist.length, p2.hist.length), h2 = p2.hist.slice(-n).map(as(p2, 'henium'));
      pts = p1.hist.slice(-n).map(as(p1, x)).map((v, i) => v * h2[i]);
    }
  }
  if (live > 0 && (!pts.length || Math.abs(live / pts[pts.length - 1] - 1) > 1e-9)) pts.push(live);
  return pts;
}
function range(pts, minRel) {
  let lo = Math.min(...pts), hi = Math.max(...pts);
  const mid = (lo + hi) / 2, r = mid * minRel;
  if (hi - lo < r) { lo = mid - r / 2; hi = mid + r / 2; }
  return [lo, hi];
}
const trendCol = (pts) => { const c = pts.length > 1 ? pts[pts.length - 1] / pts[0] - 1 : 0; return Math.abs(c) < 0.00005 ? '#8aa0ff' : c > 0 ? '#5fe08a' : '#ff6b7a'; };
function sparkSVG(pts, w = 120, h = 36) {
  if (!pts.length) return '';
  if (pts.length < 2) pts = [pts[0], pts[0]];
  const [lo, hi] = range(pts, 0.012), col = trendCol(pts);
  const X = (i) => (i / (pts.length - 1) * w).toFixed(1), Y = (v) => (h - 3 - (v - lo) / (hi - lo) * (h - 6)).toFixed(1);
  const line = pts.map((v, i) => `${X(i)},${Y(v)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line class="dx-ref" x1="0" x2="${w}" y1="${Y(pts[0])}" y2="${Y(pts[0])}" vector-effect="non-scaling-stroke"/>
    <polygon points="0,${h} ${line} ${w},${h}" fill="${col}" fill-opacity=".16"/><polyline points="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

// ---------- header & tabs ----------
function headHTML() {
  return `<section class="panel dx-head" style="--bg:url(${G.img('bg/floor-henium')})">
    ${ui.img('ui/dex', 'dx-head-ic', '')}
    <div class="dx-head-t"><div class="dx-h1"><h1>Henium DEX</h1>
      <span class="dx-sim" title="ETH, prices and trades are simulated in this prototype. No wallet, blockchain or real money is involved.">Simulated · testnet prototype</span></div>
      <div class="dx-sub">Swap any resource for any other. ${feeTxt()}, and a third of it is burned forever.</div></div>
    <div class="dx-wal">${['henium', 'egg', 'eth'].map((t) => `<button class="dx-wl ${t}" data-a="dxTab" data-args='["wallet"]' title="Your ${name(t)}: open the wallet">
        ${ui.icon(t, 30)}<span><small>${name(t)}</small><b data-b="res:${t}"></b></span></button>`).join('')}
      <div class="dx-wl dx-tk" title="NPC market makers trade every ${D.dex.tick} s">${ui.img('ui/timer', 'dx-tk-ic', '')}<span><small>Prices move</small><b data-b="dxTick"></b></span></div></div>
    <div class="dx-mascot" aria-hidden="true"><div class="dx-bubble">Every swap burns a little!</div>${ui.img('chikn/trader', 'dx-mascot-img', '')}</div>
  </section>`;
}
function tabsHTML() {
  const n = G.S.dex.log.length;
  return `<nav class="dx-tabs" role="tablist" aria-label="DEX sections">${TABS.map(([id, label, ic]) =>
    `<button class="dx-tab ${tab === id ? 'on' : ''}" role="tab" aria-selected="${tab === id}" data-a="dxTab" data-args='["${id}"]'>${ui.img(ic, 'dx-tab-ic', '')}<span>${label}</span>${id === 'history' && n ? `<i class="dx-cnt">${n}</i>` : ''}</button>`).join('')}</nav>`;
}

// ---------- Swap ----------
const curAmt = () => { if (maxMode) return bal(from); const v = parseFloat(amtStr); return isFinite(v) && v > 0 ? v : 0; };
const quote = () => { const a = curAmt(); return a > 0 ? G.dexQuote(from, to, a) : null; };
const part = (t, p) => { const x = bal(t) * p; return t === 'egg' && x >= 1 ? Math.floor(x) : x; }; // EGG stays in whole eggs

function boxHTML(side) {
  const pay = side === 'from', t = pay ? from : to;
  return `<div class="dx-box ${side}">
    <div class="dx-box-h"><span class="dx-lbl">${pay ? 'You pay' : 'You receive'}</span>
      ${pay ? `<div class="dx-pcts">${[[0.25, '25%'], [0.5, '50%'], ['max', 'Max']].map(([p, l]) => `<button class="dx-chip ${p === 'max' && maxMode ? 'on' : ''}" data-a="dxPct" data-args='${args(p)}'>${l}</button>`).join('')}</div>` : ''}</div>
    <div class="dx-box-m">
      ${pay ? `<input id="dx-amt" class="dx-amt" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" maxlength="20" placeholder="0" aria-label="Amount of ${esc(name(t))} to pay" value="${esc(maxMode ? floorStr(bal(from)) : amtStr)}">`
        : '<div class="dx-amt dx-out zero" aria-live="polite">0</div>'}
      <button class="dx-tok" data-a="dxPick" data-args='["${side}"]' aria-label="Choose the token you ${pay ? 'pay' : 'receive'} (now ${esc(name(t))})">${ui.icon(t, 30)}<span>${esc(name(t))}</span>${CHEV}</button>
    </div>
    <div class="dx-box-f"><span class="dx-worth ${side}"></span><span class="dx-bal">Balance <b data-b="res:${t}"></b></span></div>
  </div>`;
}

function swapHTML() {
  const S = G.S;
  return `<div class="dx-swap">
    <section class="panel dx-card" aria-label="Swap tokens">
      <div class="dx-card-h"><h2>Swap</h2>
        <div class="dx-slip" role="group" aria-label="Slippage tolerance"><span title="The most the price may move against you before the swap is cancelled">Slippage</span>
          ${SLIPS.map((s) => `<button class="dx-chip ${s === slip ? 'on' : ''}" data-a="dxSlip" data-args='[${s}]' aria-pressed="${s === slip}">${pct(s, 1)}</button>`).join('')}</div></div>
      ${boxHTML('from')}
      <div class="dx-flipw"><button class="dx-flip" data-a="dxFlip" aria-label="Flip: pay ${esc(name(to))} and receive ${esc(name(from))}" title="Flip direction">${FLIP}</button></div>
      ${boxHTML('to')}
      <div class="dx-det">
        <div class="dx-rate"><span class="dx-rate-t"></span><button class="dx-inv" data-a="dxInv" aria-label="Invert the price" title="Invert the price">${INV}</button></div>
        <div class="dx-rows">
          <div class="dx-q"><span>Price impact</span><b class="dx-imp"></b></div>
          <div class="dx-q"><span>Fee <small>${feeTxt().replace(' fee', '')}</small></span><b class="dx-fee"></b></div>
          <div><span>Route</span><b class="dx-route"></b></div>
          <div class="dx-q"><span>Minimum received</span><b class="dx-min"></b></div>
        </div>
      </div>
      <button class="btn lg block green dx-go" data-a="dxSwap">Swap</button>
      <div class="dx-foot">${FLAME}<span>A third of every fee is burned. Market makers trade again in <b data-b="dxTick"></b>.</span></div>
    </section>
    <div class="dx-right">
      <section class="panel dx-chart">
        <div class="dx-ch-h">${pairIc(inv ? to : from, inv ? from : to, 34)}<div class="dx-ch-tt"><b>${esc(name(inv ? to : from))} <span class="dx-ar">➜</span> ${esc(name(inv ? from : to))}</b>
          <small>${G.dexRoute(from, to) && G.dexRoute(from, to).length > 1 ? 'Routed through HENIUM' : 'Direct pool'} · market makers trade every ${D.dex.tick} s</small></div>
          <button class="dx-chip dx-ch-inv" data-a="dxInv" title="Invert the price">${INV}<span>Invert</span></button></div>
        <div class="dx-ch-p"><b class="dx-ch-price"></b><span class="dx-ch-unit"></span><span class="dx-ch-chg"></span></div>
        <div class="dx-ch-plot"><svg class="dx-ch-svg" viewBox="0 0 ${CW} ${CH}" preserveAspectRatio="none" aria-hidden="true"></svg>
          <span class="dx-ch-hi"></span><span class="dx-ch-lo"></span><i class="dx-ch-dot"></i><i class="dx-ch-x" hidden></i><div class="dx-ch-tip" hidden></div>
          <div class="dx-ch-wait" hidden>${ui.img('ui/timer', '', '')}<span>Collecting price history…<br><small>a new point every ${D.dex.tick} s</small></span></div></div>
        <div class="dx-ch-ax"><span class="dx-ch-span"></span><span>now</span></div>
        <div class="dx-ch-stats"><div class="dx-st"><span>Low</span><b class="dx-ch-l"></b></div><div class="dx-st"><span>High</span><b class="dx-ch-h2"></b></div>
          <div class="dx-st"><span class="dx-ch-liqk">Liquidity</span><b class="dx-ch-liq"></b></div><div class="dx-st"><span>Your ${esc(name(to))}</span><b data-b="res:${to}"></b></div></div>
      </section>
      <section class="panel dx-quick"><div class="panel-h">${ui.img('ui/energy', '', '')}<span class="sp">Quick pairs</span><small>one tap to load</small></div>
        <div class="dx-qps">${QUICK.filter(([a, b]) => G.dexRoute(a, b)).map(([a, b]) => `<button class="dx-qp ${a === from && b === to ? 'on' : ''}" data-a="dxPair" data-args='${args(a, b)}'
          title="Load ${esc(name(a))} → ${esc(name(b))}">${pairIc(a, b, 30)}<b>${esc(name(a))} <span class="dx-ar">➜</span> ${esc(name(b))}</b><small><span data-b="dxPx:${a},${b}"></span> ${esc(name(b))}</small></button>`).join('')}</div></section>
      <section class="panel dx-mini" data-a="dxTab" data-args='["henium"]' role="button" tabindex="0" aria-label="Why HENIUM is rare">
        ${ui.icon('henium', 54)}<div class="dx-mini-b"><b>HENIUM is scarce</b><span><span data-b="dxH:mined"></span> of 21,000,000 mined · only work and fighting mint it</span>
          ${ui.bar(S.world.mined / D.supply.cap * 100, 'purple', '', 'data-b="dxBar:supply"')}</div><span class="dx-mini-go">➜</span></section>
    </div>
  </div>`;
}

// live part of the swap card: quote, details, button (no full re-render)
function fillSwap(card) {
  const a = curAmt(), route = G.dexRoute(from, to), q = route && a > 0 ? G.dexQuote(from, to, a) : null;
  const put = (sel, h) => setH(card.querySelector(sel), h);
  const out = card.querySelector('.dx-out');
  put('.dx-out', q ? amt(to, q.out) : '0');
  out.classList.toggle('zero', !q);
  const os = from + '>' + to + ':' + a;
  if (q && os === outSig && lastOut > 0 && Math.abs(q.out / lastOut - 1) > 1e-9) flash(out, q.out > lastOut);
  outSig = os; lastOut = q ? q.out : 0;
  put('.dx-worth.from', a > 0 ? worth(from, a) : '');
  let diff = '';
  if (q) {
    const vin = a * G.spot(from, 'henium'), vout = q.out * G.spot(to, 'henium');
    if (vin > 0 && vout > 0) { const d = vout / vin - 1; diff = ` <small class="${d < -0.05 ? 'dx-bad' : d < -0.01 ? 'dx-warn' : ''}">(${d >= 0 ? '+' : '−'}${pct(Math.abs(d))})</small>`; }
  }
  put('.dx-worth.to', q ? worth(to, q.out) + diff : '');
  const r = q ? q.out / a : G.spot(from, to);
  put('.dx-rate-t', !(r > 0) ? 'No price yet' : inv ? `1 ${esc(name(to))} = ${px(1 / r)} ${esc(name(from))}` : `1 ${esc(name(from))} = ${px(r)} ${esc(name(to))}`);
  const imp = card.querySelector('.dx-imp');
  put('.dx-imp', q ? pct(q.impact) : '–');
  imp.className = 'dx-imp ' + (!q ? '' : q.impact > 0.05 ? 'bad' : q.impact > 0.01 ? 'warn' : 'ok');
  put('.dx-fee', q ? q.steps.map((s) => `<span class="dx-feel">${amt(s.i, s.fee)} ${esc(name(s.i))}<span class="dx-burn" title="Burned forever">${FLAME}${amt(s.i, s.burn)} burned</span></span>`).join('')
    : `<span class="dx-feel dim">a third is burned</span>`);
  const toks = route ? [from, ...route.map(([, o]) => o)] : [];
  put('.dx-route', toks.length ? toks.map((t) => `<span class="dx-rt">${ui.icon(t, 18)}${esc(name(t))}</span>`).join('<span class="dx-rts">›</span>') : '–');
  put('.dx-min', q ? `${amt(to, q.out * (1 - slip))} ${esc(name(to))}` : '–');
  card.querySelector('.dx-det').classList.toggle('idle', !q);
  // the big button
  const btn = card.querySelector('.dx-go');
  let label = `${ui.img('ui/dex', '', '')}Swap`, cls = 'green', dis = false;
  if (!route) { label = 'No pool for this pair'; cls = 'gray'; dis = true; }
  else if (!(a > 0)) { label = 'Enter an amount'; cls = 'gray'; dis = true; }
  else if (a > bal(from) + 1e-9) { label = `Not enough ${esc(name(from))}`; cls = 'red'; dis = true; }
  else if (!q || !(q.out > 0)) { label = 'Amount too small'; cls = 'gray'; dis = true; }
  else if (q.impact > 0.05) { label = `Swap anyway · ${pct(q.impact, 1)} impact`; cls = 'red'; }
  setH(btn, label);
  const c = `btn lg block dx-go ${cls}${dis ? ' cant' : ''}`;
  if (btn.className !== c) btn.className = c;
}

function drawChart() {
  const plot = document.querySelector('#view .dx-ch-plot');
  if (!plot) return;
  const x = inv ? to : from, y = inv ? from : to, pts = series(x, y);
  chartPts = pts;
  const box = plot.closest('.dx-chart'), q = (s) => box.querySelector(s);
  if (!pts.length) return;
  const n = pts.length, p = n < 2 ? [pts[0], pts[0]] : pts, [lo, hi] = range(p, 0.015);
  const first = pts[0], last = pts[n - 1], c = last / first - 1, col = trendCol(p);
  const X = (i) => (i / (p.length - 1) * (CW - CPAD)), Y = (v) => (CH - 14 - (v - lo) / (hi - lo) * (CH - 34));
  const line = p.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  q('.dx-ch-svg').innerHTML = `<defs><linearGradient id="dx-ch-g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".45"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75].map((f) => `<line class="dx-grid" x1="0" x2="${CW}" y1="${f * CH}" y2="${f * CH}" vector-effect="non-scaling-stroke"/>`).join('')}
    <line class="dx-ref" x1="0" x2="${CW}" y1="${Y(first).toFixed(1)}" y2="${Y(first).toFixed(1)}" vector-effect="non-scaling-stroke"/>
    <polygon points="0,${CH} ${line} ${(CW - CPAD).toFixed(1)},${CH}" fill="url(#dx-ch-g)"/>
    <polyline points="${line}" fill="none" stroke="${col}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  const dot = q('.dx-ch-dot');
  dot.style.left = ((CW - CPAD) / CW * 100) + '%'; dot.style.top = (Y(last) / CH * 100) + '%'; dot.style.setProperty('--c', col);
  setH(q('.dx-ch-hi'), `High ${px(Math.max(...pts))}`);
  setH(q('.dx-ch-lo'), `Low ${px(Math.min(...pts))}`);
  setH(q('.dx-ch-price'), px(last));
  setH(q('.dx-ch-unit'), `${esc(name(y))} per ${esc(name(x))}`);
  setH(q('.dx-ch-chg'), n > 1 ? chg(c) : '');
  const span = (n - 1) * D.dex.tick;
  setH(q('.dx-ch-span'), span >= D.dex.tick ? `${G.fmtTime(span)} ago` : 'live');
  setH(q('.dx-ch-l'), px(Math.min(...pts)));
  setH(q('.dx-ch-h2'), px(Math.max(...pts)));
  const route = G.dexRoute(from, to) || [], pools = route.map(([i, o]) => G.poolFor(i, o));
  const tvl = pools.length ? Math.min(...pools.map(G.poolTVL)) : 0;
  setH(q('.dx-ch-liqk'), pools.length > 1 ? 'Thinnest pool' : 'Pool TVL');
  setH(q('.dx-ch-liq'), `${ui.icon('henium', 16)}${G.fmt(tvl)}`);
  q('.dx-ch-wait').hidden = n >= 3;
}
function chartKey() {
  const route = G.dexRoute(from, to) || [];
  return [from, to, inv, G.spot(from, to), ...route.map(([i, o]) => G.poolFor(i, o).hist.length)].join('|');
}
function bindChart(plot) {
  const tip = plot.querySelector('.dx-ch-tip'), xl = plot.querySelector('.dx-ch-x');
  const show = (e) => {
    const n = chartPts.length;
    if (n < 2) return;
    const r = plot.getBoundingClientRect(), w = r.width * (CW - CPAD) / CW;
    const i = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / w)) * (n - 1)), f = i / (n - 1) * (CW - CPAD) / CW * 100;
    const s = (n - 1 - i) * D.dex.tick, y = inv ? from : to;
    xl.style.left = f + '%'; xl.hidden = false;
    tip.innerHTML = `<b>${px(chartPts[i])}</b> ${esc(name(y))}<small>${i === n - 1 ? 'now' : '~' + G.fmtTime(s) + ' ago'}</small>`;
    tip.style.left = Math.min(82, Math.max(18, f)) + '%'; tip.hidden = false;
  };
  plot.addEventListener('pointermove', show);
  plot.addEventListener('pointerdown', show);
  plot.addEventListener('pointerleave', () => { tip.hidden = true; xl.hidden = true; });
}
function bindSwap(el) {
  const inp = el.querySelector('#dx-amt');
  if (inp) {
    inp.addEventListener('input', () => {
      let v = inp.value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
      const i = v.indexOf('.');
      if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '');
      if (v[0] === '.') v = '0' + v;
      if (v !== inp.value) inp.value = v;
      amtStr = v;
      if (maxMode) { maxMode = false; const m = el.querySelector('.dx-pcts .on'); if (m) m.classList.remove('on'); }
      tickSwap(true);
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ui.handlers.dxSwap(el.querySelector('.dx-go'), e); } });
  }
  const plot = el.querySelector('.dx-ch-plot');
  if (plot) bindChart(plot);
  const mini = el.querySelector('.dx-mini');
  if (mini) mini.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mini.click(); } });
}
function tickSwap(force) {
  const card = document.querySelector('#view .dx-card');
  if (!card) return;
  if (maxMode) { // the amount follows your live balance until you edit it
    const inp = card.querySelector('#dx-amt'), s = floorStr(bal(from));
    if (inp && document.activeElement !== inp && inp.value !== s) inp.value = s;
  }
  const route = G.dexRoute(from, to) || [];
  const sig = [from, to, amtStr, maxMode ? bal(from) : bal(from) >= curAmt(), slip, inv, ...route.map(([i, o]) => { const p = G.poolFor(i, o); return p.ra + '/' + p.rb; })].join('|');
  if (force || sig !== swapSig) { swapSig = sig; fillSwap(card); }
  const ck = chartKey();
  if (force || ck !== chartSig) { chartSig = ck; drawChart(); }
}
function showTabs() { // after switching tabs far down the page, scroll back so the tab bar is in view
  const view = document.getElementById('view'), tabs = view && view.querySelector('.dx-tabs');
  if (!tabs) return;
  const y = tabs.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop;
  if (view.scrollTop > y) view.scrollTop = Math.max(0, y - 8);
}
function focusAmt() {
  if (!fine()) return;
  const inp = document.querySelector('#view #dx-amt');
  if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

// ---------- token picker ----------
function pickerHTML(side) {
  const cur = side === 'from' ? from : to, other = side === 'from' ? to : from, toks = G.dexTokens();
  const order = (t) => { const i = Object.keys(D.res).indexOf(t); return i < 0 ? 999 : i; };
  const groups = [['Currencies', toks.filter(isCur)], ['Raw ore', toks.filter((t) => cat(t) === 'raw')], ['Materials', toks.filter((t) => cat(t) === 'mat')],
    ['Other', toks.filter((t) => !isCur(t) && cat(t) !== 'raw' && cat(t) !== 'mat')]];
  const row = (t) => `<button class="dx-pk-row ${t === cur ? 'on' : ''}" data-a="dxPickTok" data-args='${args(t)}' data-k="${esc((name(t) + ' ' + t + (t === 'eth' ? ' ethereum ether' : '')).toLowerCase())}">
      ${ui.icon(t, 38)}<span class="dx-pk-nm"><b>${esc(name(t))}</b><small>${t === other ? `<em>${side === 'from' ? 'You receive this' : 'You pay this'} · tap to flip</em>` : t === cur ? 'Selected' : esc(DESC[t] || (cat(t) === 'raw' ? 'Raw ore' : cat(t) === 'mat' ? 'Processed material' : 'Token'))}</small></span>
      <span class="dx-pk-bal"><b data-b="res:${t}"></b><small>${bal(t) > 0 ? worth(t, bal(t)) : 'none yet'}</small></span></button>`;
  return `<div class="dx-pk">
    <label class="dx-pk-s">${SEARCH}<input type="search" id="dx-pk-q" placeholder="Search tokens" autocomplete="off" spellcheck="false" aria-label="Search tokens"></label>
    <div class="dx-pk-pop">${POPULAR.filter((t) => toks.includes(t)).map((t) => `<button class="dx-pk-chip ${t === cur ? 'on' : ''}" data-a="dxPickTok" data-args='${args(t)}'>${ui.icon(t, 22)}${esc(name(t))}</button>`).join('')}</div>
    <div class="dx-pk-list">${groups.filter(([, l]) => l.length).map(([label, l]) => `<div class="dx-pk-grp"><div class="dx-pk-gh">${label}</div>${l.sort((a, b) => order(a) - order(b)).map(row).join('')}</div>`).join('')}
      <div class="dx-pk-none" hidden>No token matches “<b></b>”</div></div>
  </div>`;
}
function openPicker(side) {
  pickSide = side;
  ui.modal({ title: `${ui.img('ui/dex', '', '')} ${side === 'from' ? 'You pay with…' : 'You receive…'}`, html: pickerHTML(side), actions: [] });
  const ov = ui.modalEl();
  if (!ov) return;
  ov.querySelector('.modal').classList.add('dx-pk-modal');
  const s = ov.querySelector('#dx-pk-q');
  s.addEventListener('input', () => {
    const v = s.value.trim().toLowerCase();
    let any = false;
    for (const g of ov.querySelectorAll('.dx-pk-grp')) {
      let k = 0;
      for (const r of g.querySelectorAll('.dx-pk-row')) { const hit = !v || r.dataset.k.includes(v); r.hidden = !hit; if (hit) k++; }
      g.hidden = !k; any = any || k > 0;
    }
    const none = ov.querySelector('.dx-pk-none');
    none.hidden = any; none.querySelector('b').textContent = s.value.trim();
  });
  s.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = ov.querySelector('.dx-pk-row:not([hidden])'); if (b) b.click(); } });
  if (fine()) setTimeout(() => s.focus(), 40);
}

// ---------- Pools ----------
function poolGroups() {
  const P = G.dexPools(), ids = Object.keys(P), used = new Set();
  const take = (f) => ids.filter((id) => !used.has(id) && f(P[id])).map((id) => (used.add(id), id));
  const g = [['Currencies', 'res/henium', take((p) => isCur(p.a) && isCur(p.b))], ['Raw ore', 'ui/mines', take((p) => cat(p.a) === 'raw' || cat(p.b) === 'raw')],
    ['Materials', 'ui/factories', take((p) => cat(p.a) === 'mat' || cat(p.b) === 'mat')]];
  g.push(['Other', 'ui/dex', take(() => true)]);
  return g.filter(([, , l]) => l.length);
}
function poolsHTML() {
  const P = G.dexPools(), X = G.S.dex;
  const row = (id) => { const p = P[id]; return `<div class="dx-pl" data-pid="${esc(id)}">
    <div class="dx-pl-n">${pairIc(p.a, p.b, 34)}<div><b>${esc(name(p.a))} / ${esc(name(p.b))}</b><small>You hold <span data-b="res:${p.a}"></span> ${esc(name(p.a))}</small></div></div>
    <div class="dx-pl-px"><b class="dx-pl-pv"></b><small class="dx-pl-inv"></small></div>
    <div class="dx-pl-sp"></div><div class="dx-pl-chg"></div>
    <div class="dx-pl-tvl"><b></b><small></small></div>
    <button class="btn sm gold dx-pl-go" data-a="dxPair" data-args='${args(p.a, p.b)}'>Trade</button></div>`; };
  return `<section class="panel dx-pools">
    <div class="dx-sum">
      <div class="dx-sumt">${ui.img('ui/market', '', '')}<span>Pools</span><b>${Object.keys(P).length}</b></div>
      <div class="dx-sumt">${ui.icon('henium', 30)}<span>Total value locked</span><b data-b="dxPools:tvl"></b></div>
      <div class="dx-sumt">${FLAME}<span>Burned by your swaps</span><b data-b="dxPools:burn"></b></div>
      <div class="dx-sumt">${ui.img('ui/timer', '', '')}<span>Next market move</span><b data-b="dxTick"></b></div>
    </div>
    <p class="dx-note">Constant-product pools (x · y = k), like Uniswap. NPC market makers nudge every pool toward its fair price every ${D.dex.tick} s; HENIUM's fair value rises at every halving.</p>
    <div class="dx-pl-cols" aria-hidden="true"><span>Pool</span><span>Price</span><span>Last ${Math.round(60 * D.dex.tick / 60)} min</span><span>Change</span><span>TVL · reserves</span><span></span></div>
    ${poolGroups().map(([label, ic, l]) => `<div class="dx-grp">${ui.img(ic, '', '')}<span>${label}</span></div>${l.map(row).join('')}`).join('')}
  </section>`;
}
function fillPools(fl) {
  const P = G.dexPools();
  for (const row of document.querySelectorAll('#view .dx-pl[data-pid]')) {
    const p = P[row.dataset.pid];
    if (!p) continue;
    const pts = series(p.a, p.b), price = G.spot(p.a, p.b), c = pts.length ? price / pts[0] - 1 : 0;
    setH(row.querySelector('.dx-pl-pv'), `${px(price)} <small>${esc(name(p.b))}</small>`);
    setH(row.querySelector('.dx-pl-inv'), `1 ${esc(name(p.b))} = ${px(1 / price)} ${esc(name(p.a))}`);
    setH(row.querySelector('.dx-pl-sp'), sparkSVG(pts));
    setH(row.querySelector('.dx-pl-chg'), chg(c));
    setH(row.querySelector('.dx-pl-tvl b'), `${ui.icon('henium', 16)}${G.fmt(G.poolTVL(p))}`);
    setH(row.querySelector('.dx-pl-tvl small'), `${amt(p.a, p.ra)} ${esc(name(p.a))} · ${amt(p.b, p.rb)} ${esc(name(p.b))}`);
    if (fl && row._p && Math.abs(price / row._p - 1) > 1e-9) flash(row.querySelector('.dx-pl-px'), price > row._p);
    row._p = price;
  }
}
const poolKey = () => Object.values(G.dexPools()).map((p) => p.hist.length + ':' + p.ra).join(',');

// ---------- HENIUM ----------
function refAt(lv) { // what-if: HENIUM/day with the refinery at another level
  const st = G.S.factories.refinery, old = st.lv;
  st.lv = lv;
  try { return G.refPerDay(); } finally { st.lv = old; }
}
function refStatus() {
  const st = G.S.factories.refinery;
  if (st.con) return ['wait', st.lv ? `Upgrading to Lv. ${st.con.to}` : 'Under construction'];
  if (st.lv < 1) return ['off', 'Not built yet'];
  return G.activeJob('refinery') ? ['on', `Lv. ${st.lv} · refining now`] : ['wait', `Lv. ${st.lv} · idle`];
}
function nextBounty() {
  for (let i = G.S.battle.cleared; i < D.stages.length; i++) { const st = D.stages[i]; if (st.first && st.first.henium) return st; }
  return null;
}
function earnHTML() {
  const st = G.S.factories.refinery, lv = st.lv, [sc, stx] = refStatus(), nb = nextBounty();
  const nxt = lv < D.factoryMaxLv ? refAt(lv + 1) : null, gain = nxt != null ? nxt - G.refPerDay() : 0;
  const card = (cls, art, title, tag, status, vs, bar, val, note, cta) => `<div class="dx-earn ${cls}">${art}<div class="dx-earn-b">
      <div class="dx-earn-h"><b>${title}</b><span class="dx-tag">${tag}</span>${status}</div>
      <div class="dx-vs">${vs}</div>${bar}<div class="dx-earn-v">${val}</div><div class="dx-earn-n">${note}</div>${cta}</div></div>`;
  return card('ref', `<img class="dx-earn-art ${lv ? '' : 'off'}" src="${G.img(G.bImg('refinery', Math.max(1, lv)))}" alt="Henium Refinery">`, 'Refining', '70% · work',
      `<span class="dx-rs ${sc}"><i></i>${stx}</span>`,
      `<span>Your power <b data-b="dxE:refPow"></b></span><span>World <b data-b="dxE:worldPow"></b></span>`,
      ui.bar(0, 'purple dx-sb', ' ', 'data-b="dxBar:ref"'),
      `<b class="dx-pur">+<span data-b="dxE:refDay"></span></b> HENIUM per game day while refining`,
      `${nxt != null ? `${lv ? 'Upgrade to' : 'Build'} Lv. ${lv + 1}: <b class="dx-up">+${amt('henium', gain)}</b> a day. ` : ''}The world adds ${trim((D.supply.worldGrowth * 100).toFixed(2))}% refinery power every day, so your share shrinks unless you keep upgrading.`,
      `<button class="btn sm gold" data-a="nav" data-args='["factories"]'>${ui.img('ui/factories', '', '')}${lv ? 'Upgrade your Refinery' : 'Build your Refinery'}</button>`) +
    card('war', ui.img('ui/battle', 'dx-earn-art', ''), 'Guild wars', '20% · fighting', '',
      `<span>Your war points <b data-b="dxE:warPts"></b></span><span>Rival guilds <b data-b="dxE:worldWar"></b></span>`,
      ui.bar(0, 'gold dx-sb', ' ', 'data-b="dxBar:war"'),
      `<b class="dx-pur">+<span data-b="dxE:warDay"></span></b> HENIUM at the next day rollover`,
      `War points cool down ${Math.round(D.rules.warDecay * 100)}% every day: keep raiding rival guilds to hold your share.`,
      `<button class="btn sm red" data-a="gdBattle">${ui.img('ui/battle', '', '')}Raid rival guilds</button>`) +
    card('hunt', ui.img(nb ? 'monster/' + nb.mon : 'ui/trophy', 'dx-earn-art', ''), 'Monster hunts', '10% · fighting', '',
      `<span>Your hunt points <b data-b="dxE:hunt"></b></span><span>Other hunters <b data-b="dxE:worldHunt"></b></span>`,
      ui.bar(0, 'green dx-sb', ' ', 'data-b="dxBar:hunt"'),
      `<b class="dx-pur">+<span data-b="dxE:huntDay"></span></b> HENIUM at the next day rollover`,
      `${nb ? `First clear of <b>${esc(nb.name)}</b> pays a one-time bounty of <b class="dx-pur">${nb.first.henium} HENIUM</b>. ` : 'Every monster bounty is claimed. '}PvE wins, creatures and bandits earn hunt points; they ${D.rules.huntKeep === 0.5 ? 'halve' : `drop to ${Math.round(D.rules.huntKeep * 100)}%`} every day.`,
      `<button class="btn sm green" data-a="nav" data-args='["battle"]'>${ui.img('ui/battle', '', '')}Hunt monsters</button>`);
}
function sinksHTML() {
  const S = G.S, f = D.factoryById('refinery'), g = S.guild;
  const dig = S.depth >= D.maxDepth ? 'You reached the bottom of the world' : S.depth >= 21 ? `Next dig (depth ${S.depth + 1}): ${D.digCost(S.depth).henium} HENIUM, more every level`
    : `From depth 21 on, every new level costs HENIUM (${D.digCost(21).henium}+)`;
  const rows = [
    ['ui/mines', 'Digging below depth 21', dig, 'mines'],
    ['ui/factories', 'Building upgrades', `the Henium Refinery from Lv. 1 → 2 (${D.factoryUpCost(f, 1).henium} HENIUM, up to ${G.fmtFull(D.factoryUpCost(f, 9).henium)} for Lv. 10); other buildings from Lv. 5 → 6 (${D.factoryUpCost(D.factories[0], 5).henium}, up to ${D.factoryUpCost(D.factories[0], 9).henium})`, 'factories'],
    ['ui/chikns', 'Buying Chikn NFTs', `${D.buyNft.cost.henium} HENIUM per NFT, rare or better`, 'chikns'],
    ['ui/guild', 'Guild license & zone', `${g.license ? 'License owned' : `License ${D.licenseCost.henium} HENIUM`} · zone Lv. ${g.zoneLv + 1}: ${D.guildZoneCost(g.zoneLv).henium} HENIUM`, 'guild'],
    ['ui/timer', 'Speed-ups', `1 HENIUM per started 10 minutes skipped (digs and builds cost double; refinery batches can't be rushed)`, 'factories'],
    ['ui/dex', 'Every DEX swap', `A third of the ${pct(G.dexFee(), 3)} fee is burned`, null],
  ];
  return rows.map(([ic, t, s, v]) => `<${v ? `button class="dx-sink" data-a="nav" data-args='["${v}"]'` : 'div class="dx-sink"'}>${ui.img(ic, 'dx-sink-ic', '')}
    <span class="dx-sink-t"><b>${t}</b><small>${esc(s)}</small></span>${v ? '<span class="dx-sink-go">➜</span>' : ''}</${v ? 'button' : 'div'}>`).join('');
}
function heniumHTML() {
  const S = G.S, cap = D.supply.cap, hv = D.supply.halvings, e = G.epoch(), sp = D.supply.split;
  const marks = hv.map((h, i) => `<i class="dx-mark ${i < e ? 'past' : ''}" style="left:${h / cap * 100}%" title="Halving ${i + 1} at ${G.fmtFull(h)} HENIUM"></i>`).join('');
  const sched = [0, ...hv].map((lo, i) => `<div class="dx-ep ${i === e ? 'cur' : i < e ? 'past' : ''}"><span class="dx-ep-n">Epoch ${i + 1}</span>
    <span class="dx-ep-r">${G.fmt(lo)} – ${G.fmt(hv[i] || cap)}</span><b>${G.fmt(D.supply.daily * Math.pow(0.5, i), 1)}<small> / day</small></b></div>`).join('');
  return `<div class="dx-hen">
    <section class="panel dx-hero">
      <div class="dx-hero-ic">${ui.icon('henium', 104)}</div>
      <div class="dx-hero-t"><h2>HENIUM is rare by design</h2>
        <p>Only <b>21,000,000</b> will ever exist. New HENIUM is minted only by <b>work</b> (refining) and <b>fighting</b> (guild wars and monster hunts).
          The world's daily emission halves at every epoch, and every DEX swap burns a little more.</p>
        <div class="dx-facts">
          <div class="dx-fact"><span>Hard cap</span><b>21M</b></div>
          <div class="dx-fact"><span>Mined so far</span><b data-b="dxH:minedS"></b></div>
          <div class="dx-fact"><span>World emission</span><b data-b="dxH:emis"></b></div>
          <div class="dx-fact"><span>Next halving</span><b data-b="dxH:toNextS"></b></div>
        </div></div>
      <div class="dx-hp"><div class="dx-hp-h">1 HENIUM is worth</div>
        <div class="dx-hp-r">${ui.icon('eth', 26)}<b data-b="dxPx:henium,eth"></b><span>ETH</span></div>
        <div class="dx-hp-r">${ui.icon('egg', 26)}<b data-b="dxPx:henium,egg"></b><span>EGG</span></div>
        <div class="dx-hp-sp" data-b="dxSpark:henium,eth"></div>
        <div class="dx-hp-n">Market makers value it ×${G.henValueK().toFixed(1)} today, more after every halving.</div>
        <button class="btn sm purple block" data-a="dxPair" data-args='["henium","eth"]'>Trade HENIUM</button></div>
    </section>
    <div class="dx-hcol">
    <section class="panel dx-supp">
      <div class="panel-h">${ui.icon('henium', 30)}<span class="sp">HENIUM supply</span><small>21M cap · bitcoin-style halvings</small></div>
      <div class="dx-mined"><span class="dx-k">World mined</span><div class="dx-mv"><b data-b="dxH:mined"></b><span> / ${G.fmtFull(cap)}</span></div></div>
      <div class="dx-supbar">${ui.bar(0, 'purple lg', ' ', 'data-b="dxBar:supply"')}<div class="dx-marks">${marks}</div>
        <div class="dx-scale"><span>0</span><span><i class="dx-tri"></i>halvings</span><span>21M cap</span></div></div>
      <div class="dx-sgrid"><div class="dx-sbox"><span>Current epoch</span><b data-b="dxH:epoch"></b></div><div class="dx-sbox"><span>World emission</span><b class="dx-pur" data-b="dxH:emis"></b></div></div>
      <div class="dx-nexth"><div class="dx-nh-t"><span data-b="dxH:next"></span><span class="dim" data-b="dxH:toNext"></span></div>
        ${ui.bar(0, 'gold', ' ', 'data-b="dxBar:epoch"')}<div class="dx-eta" data-b="dxH:eta"></div></div>
      <div class="dx-sched">${sched}</div>
    </section>
    <section class="panel dx-sinks"><div class="panel-h">${ui.img('prop/chest', '', '')}<span class="sp">What HENIUM buys</span><small>sinks that keep it scarce</small></div>${sinksHTML()}</section>
    </div>
    <div class="dx-hcol">
    <section class="panel dx-earnp">
      <div class="panel-h">${ui.img('ui/energy', '', '')}<span class="sp">Who mints HENIUM</span><small>the world's emission per game day</small></div>
      <div class="dx-split"><div class="dx-split-bar"><i class="r" style="flex:${sp.refinery}"></i><i class="w" style="flex:${sp.war}"></i><i class="h" style="flex:${sp.boss}"></i></div>
        <div class="dx-split-l"><span class="r"><i></i>${Math.round(sp.refinery * 100)}% refiners <b data-b="dxH:sr"></b></span><span class="w"><i></i>${Math.round(sp.war * 100)}% guild wars <b data-b="dxH:sw"></b></span>
          <span class="h"><i></i>${Math.round(sp.boss * 100)}% monster hunts <b data-b="dxH:sh"></b></span></div></div>
      <div class="dx-earns">${earnHTML()}</div>
      <div class="dx-earn-tot">${ui.icon('henium', 26)}<span>Your share: up to <b data-b="dxE:total"></b> HENIUM per game day. War and hunt payouts arrive in <b data-b="farmday"></b>.</span></div>
    </section>
    <section class="panel dx-burnp">
      <div class="panel-h">${FLAME}<span class="sp">Burned forever</span><small>gone from the supply for good</small></div>
      <div class="dx-burned">
        <div class="dx-bx">${ui.icon('henium', 40)}<div><span>HENIUM burned</span><b data-b="dxB:hen"></b><small>by DEX fees <span data-b="dxB:dexHen"></span></small></div></div>
        <div class="dx-bx">${ui.icon('egg', 40)}<div><span>EGG burned</span><b data-b="dxB:egg"></b><small>by DEX fees <span data-b="dxB:dexEgg"></span></small></div></div>
      </div>
      <p class="dx-note">Every swap pays a ${feeTxt()}. A third of it is burned; the rest stays in the pool and deepens liquidity.</p>
    </section>
    </div>
  </div>`;
}

// ---------- Wallet ----------
const walletEth = () => WALLET.reduce((s, t) => s + bal(t) * G.spot(t, 'eth'), 0);
const restEth = () => G.dexTokens().filter((t) => !WALLET.includes(t)).reduce((s, t) => s + bal(t) * G.spot(t, 'eth'), 0);
function walletHTML() {
  const listed = G.dexTokens();
  const rows = WALLET.map((t) => `<div class="dx-wr ${t}">${ui.icon(t, 46)}
      <div class="dx-wr-n"><b>${esc(name(t))}</b><small>${esc(DESC[t] || '')}</small></div>
      <div class="dx-wr-b"><b data-b="res:${t}"></b><small>${!listed.includes(t) ? 'not on the DEX yet' : t === 'eth' ? `1 ETH = <span data-b="dxPx:eth,henium"></span> HENIUM` : `≈ <span data-b="dxVal:${t}"></span> ETH`}</small></div>
      ${listed.includes(t) ? `<button class="btn sm" data-a="dxPair" data-args='${args(t, t === 'eth' ? 'henium' : 'eth')}'>Trade</button>` : '<span class="dx-wr-na"></span>'}</div>`).join('');
  const cash = (t) => `<div class="dx-cash ${t}">
      <div class="dx-cash-art">${ui.icon(t, 54)}<span class="dx-ar">➜</span>${ui.icon('eth', 54)}</div>
      <div class="dx-cash-t">Sell ${esc(name(t))} for ETH</div>
      <div class="dx-cash-r">1 ${esc(name(t))} = <b data-b="dxPx:${t},eth"></b> ETH</div>
      <div class="dx-cash-q">${SELLS.map((p) => `<button class="btn ${p >= 1 ? 'red' : 'purple'} dx-cash-b" data-a="dxSell" data-args='${args(t, p)}' data-b="dxSell:${t}:${p}"><span>${p >= 1 ? 'All' : p * 100 + '%'}</span><small></small></button>`).join('')}</div>
      <div class="dx-cash-n">You hold <b data-b="res:${t}"></b> ${esc(name(t))}</div></div>`;
  return `<div class="dx-wgrid">
    <section class="panel dx-bals"><div class="panel-h">${ui.img('prop/chest', '', '')}<span class="sp">Your wallet</span><span class="dx-sim">Simulated ETH</span></div>
      <div class="dx-tot"><span>Total value</span><div><b>${ui.icon('eth', 34)}<span data-b="dxVal:total"></span><small>ETH</small></b><em>≈ ${ui.icon('henium', 18)}<span data-b="dxVal:totalHen"></span> HENIUM</em></div></div>
      <div class="dx-wrs">${rows}</div>
      <div class="dx-idx">${ui.img('ui/factories', '', '')}<span>Your ores and materials are worth another <b>${ui.icon('eth', 16)}<span data-b="dxVal:rest"></span> ETH</b> at today's DEX prices.</span>
        <button class="btn sm" data-a="dxPair" data-args='["stone","henium"]'>Sell ore</button></div>
    </section>
    <div class="dx-wcol">
      <section class="panel dx-cashp"><div class="panel-h">${ui.icon('eth', 30)}<span class="sp">Cash out to ETH</span><small>slippage limit ${pct(slip, 1)}</small></div>
        <div class="dx-cashes">${CASH.filter((t) => G.dexRoute(t, 'eth')).map(cash).join('')}</div></section>
      <section class="panel dx-wd"><div class="panel-h">${ui.img('ui/lock', '', '')}<span class="sp">Withdraw</span></div>
        <div class="dx-wd-row">${ui.icon('eth', 46)}<div class="dx-wd-b"><span>ETH balance</span><b data-b="res:eth"></b></div>
          <button class="btn purple dx-wd-btn" data-a="dxWithdraw">${ui.img('ui/lock', '', '')}Withdraw ETH</button></div>
        <p class="dx-note">ETH is simulated in this prototype, so it can't leave the game yet: real withdrawals come with the on-chain version. Other cash-out assets can be added later.</p></section>
    </div>
  </div>`;
}
function withdrawHTML(msg) {
  const steps = [['Smart contracts', 'HENIUM, EGG and these pools deployed on Ethereum or an L2'], ['Wallet connect', 'you sign every withdrawal with your own wallet'],
    ['Security audits', 'independent audits before real money touches the contracts'], ['Legal review', 'token and trading rules checked for every region']];
  return `<div class="dx-wdm">
    <div class="dx-wdm-art">${ui.icon('eth', 88)}${ui.img('ui/lock', 'dx-wdm-lock', '')}</div>
    <p class="dx-wdm-msg">${esc(msg)}</p>
    <div class="dx-wdm-h">What the on-chain version needs</div>
    <ol class="dx-wdm-l">${steps.map(([t, d], i) => `<li><span>${i + 1}</span><div><b>${t}</b><small>${d}</small></div></li>`).join('')}</ol>
    <div class="dx-wdm-bal">Your simulated balance ${ui.icon('eth', 18)}<b>${amt('eth', bal('eth'))} ETH</b> stays safe in your game wallet. Other cash-out assets can be added later.</div>
  </div>`;
}

// ---------- History ----------
function historyHTML() {
  const X = G.S.dex, L = X.log;
  const sum = `<div class="dx-sum">
    <div class="dx-sumt">${ui.img('ui/timer', '', '')}<span>Swaps</span><b>${L.length}${L.length >= 40 ? '+' : ''}</b></div>
    <div class="dx-sumt">${ui.icon('henium', 30)}<span>Total volume</span><b data-b="dxB:vol"></b></div>
    <div class="dx-sumt">${FLAME}<span>HENIUM burned</span><b data-b="dxB:dexHen"></b></div>
    <div class="dx-sumt">${ui.icon('egg', 30)}<span>EGG burned</span><b data-b="dxB:dexEgg"></b></div></div>`;
  if (!L.length) {
    return `<section class="panel dx-histp">${sum}<div class="dx-empty">${ui.img('ui/dex', '', '')}<div><b>No swaps yet</b><span>Your last 40 swaps will show up here.</span>
      <button class="btn green" data-a="dxTab" data-args='["swap"]'>Make your first swap</button></div></div></section>`;
  }
  return `<section class="panel dx-histp">${sum}<p class="dx-note">Volume is valued in HENIUM at the time of each swap. The last 40 swaps are kept.</p>
    <div class="dx-hl">${L.map((t, i) => `<div class="dx-hr">
      <span class="dx-hr-t" data-b="dxAgo:${t.t}"></span>${pairIc(t.from, t.to, 30)}
      <div class="dx-hr-m"><b>${amt(t.from, t.amt)} ${esc(name(t.from))} <span class="dx-ar">➜</span> ${amt(t.to, t.out)} ${esc(name(t.to))}</b>
        <small>1 ${esc(name(t.from))} = ${t.amt > 0 ? px(t.out / t.amt) : '–'} ${esc(name(t.to))}</small></div>
      <span class="dx-hr-v">≈ ${ui.icon('henium', 16)}${amt('henium', t.value)}</span>
      <button class="btn sm gray dx-hr-a" data-a="dxAgain" data-args='[${i}]' title="Load this swap again">Again</button></div>`).join('')}</div></section>`;
}

// ---------- live binders ----------
ui.binders.dxTick = (el) => { if (dexReady()) setT(el, Math.max(0, Math.ceil(D.dex.tick - G.S.dex.t)) + 's'); };
ui.binders.dxAgo = (el, t) => { const s = (G.now() - +t) / 1000; setT(el, s < 5 ? 'just now' : G.fmtTime(s) + ' ago'); };
ui.binders.dxPx = (el, a) => { const [x, y] = a.split(','); setH(el, px(G.spot(x, y))); };
ui.binders.dxSpark = (el, a) => { const [x, y] = a.split(','); setH(el, sparkSVG(series(x, y), 200, 44)); };
ui.binders.dxVal = (el, k) => {
  const v = k === 'total' ? walletEth() : k === 'totalHen' ? walletEth() * G.spot('eth', 'henium') : k === 'rest' ? restEth() : bal(k) * G.spot(k, 'eth');
  setT(el, amt(k === 'totalHen' ? 'henium' : 'eth', v));
};
ui.binders.dxPools = (el, k) => {
  if (k === 'tvl') setH(el, G.fmt(Object.values(G.dexPools()).reduce((s, p) => s + G.poolTVL(p), 0)) + ' <small>HENIUM</small>');
  else if (k === 'burn') { const b = G.S.dex.burned; setH(el, `${amt('henium', b.henium)} <small>HENIUM</small> · ${amt('egg', b.egg)} <small>EGG</small>`); }
};
ui.binders.dxH = (el, k) => {
  const S = G.S, w = S.world.mined, cap = D.supply.cap, e = G.epoch(), next = G.nextHalving(), E = G.emission(), last = next >= cap, sp = D.supply.split;
  const m = {
    mined: () => G.fmtFull(Math.floor(w)),
    minedS: () => `${G.fmt(w)} · ${(w / cap * 100).toFixed(1)}%`,
    emis: () => `${G.fmt(E, 1)} / day`,
    epoch: () => `${e + 1} of ${D.supply.halvings.length + 1}`,
    toNext: () => (last ? `${G.fmtFull(Math.floor(cap - w))} left to mine` : `${G.fmtFull(Math.ceil(next - w))} HENIUM to go`),
    toNextS: () => (last ? 'final epoch' : `${G.nextHalvingDate()} · in ${G.fmtFull(Math.ceil(G.nextHalvingIn() / 86400))} days`),
    eta: () => (w >= cap ? 'All 21M are mined: no new HENIUM, ever' : `on ${G.nextHalvingDate()}, in ${G.fmtFull(Math.ceil(G.nextHalvingIn() / 86400))} days (every ${G.fmtFull(D.supply.halvingDays)} days)`),
    sr: () => G.fmt(E * sp.refinery, 1), sw: () => G.fmt(E * sp.war, 1), sh: () => G.fmt(E * sp.boss, 1),
  }[k];
  if (k === 'next') setH(el, last ? 'Final epoch: <b>no more halvings</b>' : `Next halving at <b>${G.fmtFull(next)}</b>`);
  else if (m) setT(el, m());
};
ui.binders.dxBar = (el, k) => {
  const S = G.S, w = S.world.mined, cap = D.supply.cap, e = G.epoch(), next = G.nextHalving(), prev = e ? D.supply.halvings[e - 1] : 0;
  let p = 0, t = '';
  if (k === 'supply') { p = w / cap * 100; t = p.toFixed(2) + '% of the cap mined'; }
  else if (k === 'epoch') { p = next > prev ? (w - prev) / (next - prev) * 100 : 100; t = Math.floor(p) + '% of epoch ' + (e + 1); }
  else if (k === 'ref') { p = G.refShare() * 100; t = pct(G.refShare()) + ' of the world'; }
  else if (k === 'war') { p = G.warShare() * 100; t = pct(G.warShare()) + ' of all war points'; }
  else if (k === 'hunt') { p = huntShare() * 100; t = pct(huntShare()) + ' of the hunt pool'; }
  const i = el.querySelector('i'), b = el.querySelector('b');
  if (i) i.style.width = (p > 0 ? Math.max(2.5, Math.min(100, p)) : 0) + '%';
  if (b) setT(b, t);
};
ui.binders.dxE = (el, k) => {
  const S = G.S;
  const m = {
    refPow: () => dec(G.myRefPower(), 3), worldPow: () => G.fmt(G.worldRefPower()), refDay: () => amt('henium', G.refPerDay()),
    warPts: () => G.fmtFull(Math.round(S.guild.warPts)), worldWar: () => G.fmt(S.world.war), warDay: () => amt('henium', G.warPerDay()),
    hunt: () => G.fmtFull(Math.round(S.hunt || 0)), worldHunt: () => G.fmt(S.world.hunt || 0), huntShare: () => pct(huntShare()), huntDay: () => amt('henium', huntPerDay()),
    total: () => amt('henium', G.refPerDay() + G.warPerDay() + huntPerDay()),
  }[k];
  if (m) setT(el, m());
};
ui.binders.dxB = (el, k) => {
  const S = G.S, X = S.dex;
  const v = { hen: () => amt('henium', S.stats.feeBurned || 0), egg: () => amt('egg', S.stats.eggBurned || 0), dexHen: () => amt('henium', X.burned.henium),
    dexEgg: () => amt('egg', X.burned.egg), vol: () => amt('henium', X.volume) }[k];
  if (v) setT(el, v());
};
ui.binders.dxSell = (el, a) => {
  const [t, p] = a.split(':'), x = +p >= 1 ? bal(t) : part(t, +p), q = x > 0 ? G.dexQuote(t, 'eth', x) : null;
  setH(el.querySelector('small'), q ? `+${amt('eth', q.out)}` : '–');
  el.classList.toggle('cant', !q);
};

// ---------- actions ----------
function fly(t, [x0, y0], [x1, y1], n = 5) { // a few coins hop from the pay box to the receive box
  const fx = document.getElementById('fx');
  if (!fx) return;
  for (let i = 0; i < n; i++) {
    const c = document.createElement('img');
    c.src = G.img('res/' + t); c.className = 'dx-coin'; c.alt = '';
    c.style.cssText = `left:${x0 + (i - n / 2) * 6}px;top:${y0}px;--tx:${x1 - x0 - (i - n / 2) * 6}px;--ty:${y1 - y0}px;animation-delay:${i * 60}ms`;
    fx.appendChild(c);
    setTimeout(() => c.remove(), 800 + i * 60);
  }
}
// run a swap with a slippage limit; true on success (floats, sparks, toast)
function doSwap(el, f, t, a, minOut, srcEl, dstEl) {
  const b0 = { ...G.S.dex.burned };
  const r = G.act.swap(f, t, a, minOut);
  if (!r.ok) { ui.toast(r.msg, 'bad'); G.sfx('err'); return false; }
  const [x, y] = el && el.isConnected ? ui.centerOf(el) : [innerWidth / 2, innerHeight / 2];
  const src = srcEl && srcEl.isConnected ? ui.centerOf(srcEl) : [x, y - 60], dst = dstEl && dstEl.isConnected ? ui.centerOf(dstEl) : [x, y - 10];
  fly(f, src, dst);
  setTimeout(() => {
    ui.float(`+${amt(t, r.out)}${ui.icon(t, 22)}`, dst[0], dst[1] - 24, D.res[t] && D.res[t].color ? D.res[t].color : '#fff');
    ui.sparks(dst[0], dst[1], t === 'henium' ? '#c77dff' : t === 'eth' ? '#8aa0ff' : '#ffd54a', 12);
  }, 380);
  ui.float(`−${amt(f, a)}${ui.icon(f, 18)}`, src[0], src[1] - 20, '#ffb4bd');
  const burned = (G.S.dex.burned.henium - b0.henium) + (G.S.dex.burned.egg - b0.egg);
  if (burned > 0) setTimeout(() => ui.float(`${FLAME}${amt(G.S.dex.burned.henium > b0.henium ? 'henium' : 'egg', burned)} burned`, x, y - 30, '#ffb27a'), 650);
  G.sfx('coin');
  ui.toast(`Swapped ${amt(f, a)} ${name(f)} for ${amt(t, r.out)} ${name(t)}`, 'good', 'res/' + t);
  return true;
}
const confirmImpact = (q, go) => ui.modal({ title: `${ui.img('ui/bell', '', '')} High price impact`, actions: [{ label: 'Cancel', cls: 'gray' }, { label: 'Swap anyway', cls: 'red', fn: go }],
  html: `<p class="dx-cf">This swap moves the price by <b class="dx-bad">${pct(q.impact)}</b>: you pay <b>${amt(q.from, q.amt)} ${esc(name(q.from))}</b> and get about <b>${amt(q.to, q.out)} ${esc(name(q.to))}</b>.</p>
    <p class="dx-cf dim">Big orders in thin pools get worse prices. Smaller swaps, or waiting for the market makers to rebalance (every ${D.dex.tick} s), get you more.</p>` });

ui.handlers.dxTab = (el, e, id) => {
  if (!TABS.some(([k]) => k === id)) return;
  tab = id; G.sfx('click'); ui.render(); showTabs();
};
ui.handlers.dxPick = (el, e, side) => { G.sfx('click'); openPicker(side); };
ui.handlers.dxPickTok = (el, e, t) => {
  const other = pickSide === 'from' ? to : from;
  if (t === other) { [from, to] = [to, from]; amtStr = ''; maxMode = false; }
  else if (pickSide === 'from') { if (t !== from) { from = t; amtStr = ''; maxMode = false; } }
  else to = t;
  ui.closeModal(); G.sfx('click'); ui.render(); focusAmt();
};
ui.handlers.dxFlip = () => {
  const q = quote();
  [from, to] = [to, from];
  amtStr = q ? floorStr(q.out) : maxMode ? '' : amtStr;
  maxMode = false; G.sfx('click'); ui.render();
  const b = document.querySelector('#view .dx-flip');
  if (b) b.classList.add('spun');
  focusAmt();
};
ui.handlers.dxPct = (el, e, p) => {
  const b = bal(from);
  if (!(b > 0)) { ui.toast(`You have no ${name(from)} yet`, 'bad', 'res/' + from); G.sfx('err'); return; }
  maxMode = p === 'max';
  amtStr = floorStr(maxMode ? b : part(from, p));
  const inp = document.querySelector('#view #dx-amt');
  if (inp) inp.value = amtStr;
  document.querySelectorAll('#view .dx-pcts .dx-chip').forEach((c) => c.classList.toggle('on', maxMode && c.dataset.args.includes('max')));
  G.sfx('click'); tickSwap(true);
};
ui.handlers.dxSlip = (el, e, s) => { if (SLIPS.includes(s)) slip = s; G.sfx('click'); ui.render(); };
ui.handlers.dxInv = () => { inv = !inv; G.sfx('click'); ui.render(); };
ui.handlers.dxSwap = (el) => {
  const a = curAmt(), route = G.dexRoute(from, to);
  if (!route) { ui.toast('No pool for this pair', 'bad'); G.sfx('err'); return; }
  if (!(a > 0)) { ui.toast('Enter an amount first', 'bad'); G.sfx('err'); focusAmt(); return; }
  if (a > bal(from) + 1e-9) { ui.toast(`Not enough ${name(from)}: you have ${amt(from, bal(from))}`, 'bad', 'res/' + from); G.sfx('err'); return; }
  const q = G.dexQuote(from, to, a);
  if (!q || !(q.out > 0)) { ui.toast('That amount is too small to swap', 'bad'); G.sfx('err'); return; }
  const card = document.querySelector('#view .dx-card');
  const go = () => {
    const src = card && card.querySelector('.dx-box.from .dx-tok'), dst = card && card.querySelector('.dx-box.to .dx-tok');
    if (doSwap(el, from, to, a, q.out * (1 - slip), src, dst)) { amtStr = ''; maxMode = false; }
    ui.render();
  };
  if (q.impact > 0.05) confirmImpact(q, go); else go();
};
ui.handlers.dxPair = (el, e, a, b) => {
  if (!a || !b || a === b || !G.dexRoute(a, b)) return;
  from = a; to = b; amtStr = ''; maxMode = false; tab = 'swap'; G.sfx('click'); ui.render(); showTabs();
  focusAmt();
};
// deep link for other screens: <button data-a="dxOpen" data-args='["egg","eth"]'> opens the DEX on that pair
ui.handlers.dxOpen = (el, e, a, b) => {
  if (a && b && a !== b && G.dexRoute(a, b)) { from = a; to = b; amtStr = ''; maxMode = false; }
  tab = 'swap'; ui.go('dex');
};
ui.handlers.dxAgain = (el, e, i) => {
  const t = G.S.dex.log[i];
  if (!t || !G.dexRoute(t.from, t.to)) return;
  from = t.from; to = t.to; amtStr = floorStr(Math.min(t.amt, bal(t.from)) || t.amt); maxMode = false; tab = 'swap'; G.sfx('click'); ui.render(); focusAmt();
};
ui.handlers.dxSell = (el, e, t, p) => {
  const a = p >= 1 ? bal(t) : part(t, p);
  if (!(a > 0)) { ui.toast(`You have no ${name(t)} to sell`, 'bad', 'res/' + t); G.sfx('err'); return; }
  const q = G.dexQuote(t, 'eth', a);
  if (!q) { ui.toast('No pool for this pair', 'bad'); G.sfx('err'); return; }
  const go = () => { const ok = doSwap(el, t, 'eth', a, q.out * (1 - slip), el, document.querySelector('#view .dx-wd-row .ic')); ui.render(); return ok; };
  if (p < 1 && q.impact <= 0.05) return go();
  ui.modal({ title: `${ui.icon(t, 30)} ${p >= 1 ? `Sell all your ${name(t)}?` : 'High price impact'}`, actions: [{ label: 'Cancel', cls: 'gray' }, { label: `Sell for ${amt('eth', q.out)} ETH`, cls: 'red', fn: go }],
    html: `<p class="dx-cf">Sell <b>${amt(t, a)} ${esc(name(t))}</b> for about <b>${ui.icon('eth', 18)} ${amt('eth', q.out)} ETH</b> (price impact <b class="${q.impact > 0.05 ? 'dx-bad' : q.impact > 0.01 ? 'dx-warn' : ''}">${pct(q.impact)}</b>).</p>
      <p class="dx-cf dim">${t === 'henium' ? 'HENIUM is scarce: you need it to dig below depth 21, for building levels 5+, premium hires and speed-ups.' : 'EGG is scarce: only your Chikns lay it, about one per Chikn a day.'}</p>` });
};
ui.handlers.dxWithdraw = () => {
  const r = G.act.withdrawEth ? G.act.withdrawEth() : { ok: false, msg: 'Real ETH withdrawals need the on-chain version. ETH here is simulated.' };
  if (r.ok) { G.sfx('ok'); ui.toast(r.msg || 'Withdrawal requested', 'good', 'res/eth'); ui.render(); return; }
  G.sfx('click');
  ui.modal({ title: `${ui.icon('eth', 30)} Withdraw ETH`, html: withdrawHTML(r.msg || ''), actions: [{ label: 'Got it', cls: 'green' }] });
};

// ---------- view ----------
function validPair() {
  const toks = G.dexTokens();
  if (!toks.includes(from)) from = toks.includes('egg') ? 'egg' : toks[0];
  if (!toks.includes(to) || to === from) to = from === 'henium' ? 'eth' : 'henium';
}
ui.views.dex = {
  render(el) {
    if (ui.cur === 'market') { // reached through the old 'market' id: behave as the DEX
      ui.cur = 'dex'; el.className = 'v-dex';
      ui.$$('.nav-btn').forEach((b) => b.classList.toggle('on', b.dataset.view === 'dex'));
    }
    if (!dexReady()) { el.innerHTML = '<div class="empty">The DEX is opening…</div>'; return; }
    validPair();
    swapSig = chartSig = poolSig = '';
    const body = tab === 'pools' ? poolsHTML() : tab === 'henium' ? heniumHTML() : tab === 'wallet' ? walletHTML() : tab === 'history' ? historyHTML() : swapHTML();
    el.innerHTML = `<div class="dx-page">${headHTML()}${tabsHTML()}<div class="dx-body dx-t-${tab}">${body}</div></div>`;
    if (tab === 'swap') { bindSwap(el); tickSwap(true); }
    if (tab === 'pools') { poolSig = poolKey(); fillPools(false); }
  },
  update() { // 4x per second: only refresh what moved (prices move every D.dex.tick seconds)
    if (!dexReady()) return;
    if (tab === 'swap') tickSwap(false);
    else if (tab === 'pools') { const k = poolKey(); if (k !== poolSig) { poolSig = k; fillPools(true); } }
  },
};
ui.views.market = ui.views.dex; // old links to the Market land on the DEX
})();
