/* Indonesia Research Portal - static front-end.
   All data are pre-baked JSON files in /data, refreshed by GitHub Actions
   (scripts/refresh.py) and the local research sync (scripts/build_research.py). */
'use strict';

const D = {};
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const C = { up: '#3fc78a', down: '#f06a6a', saf: '#e9a23b', dim: '#9aa2b1', mute: '#646c7c', line: '#252c39', text: '#e9e6dd' };
const OVERLAY_COLORS = ['#e9a23b', '#5aa9e6', '#c084fc', '#3fc78a', '#f06a6a', '#f2d46b', '#7dd3c0', '#ff9f80', '#a3b18a', '#e5e7eb'];

// ------------------------------------------------------------------ formatting
const nf = (dp) => new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmt = (x, dp = 0) => (x == null || isNaN(x) ? '—' : nf(dp).format(x));
const fmtPx = (x) => (x == null ? '—' : x >= 1000 ? fmt(x, 0) : x >= 100 ? fmt(x, 0) : fmt(x, x < 10 ? 2 : 1));
const pct = (x, dp = 2) => (x == null || isNaN(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + fmt(Math.abs(x), dp) + '%');
const sgn = (x, dp = 0) => (x == null || isNaN(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + fmt(Math.abs(x), dp));
const cls = (x) => (x == null || isNaN(x) || x === 0 ? 'flat' : x > 0 ? 'up' : 'down');
const rpbn = (x, dp = 0) => (x == null ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + 'Rp' + fmt(Math.abs(x), dp) + 'bn');
const rptn = (bn) => (Math.abs(bn) >= 1000 ? (bn < 0 ? '−' : bn > 0 ? '+' : '') + 'Rp' + fmt(Math.abs(bn) / 1000, 2) + 'tn' : rpbn(bn));
const dShort = (iso) => { const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const daysAgo = (iso) => (Date.now() - new Date(iso + (iso.length === 10 ? 'T00:00:00+07:00' : '')).getTime()) / 864e5;
function ago(iso) {
  const m = (Date.now() - new Date(iso).getTime()) / 6e4;
  if (m < 60) return Math.max(1, Math.round(m)) + 'm ago';
  if (m < 1440) return Math.round(m / 60) + 'h ago';
  return Math.round(m / 1440) + 'd ago';
}
function wibNow() { return new Date(Date.now() + 7 * 3600e3); } // use getUTC* on this
function wibStr(d = new Date()) { return d.toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }); }

// rating pills
const BULL = new Set(['BUY', 'ADD', 'OW', 'O-PF', 'HC O-PF']);
const BEAR = new Set(['SELL', 'REDUCE', 'UW', 'U-PF']);
function ratingPill(r) {
  if (!r) return '<span class="pill nr">—</span>';
  const k = r === 'HC O-PF' ? 'hc' : BULL.has(r) ? 'bull' : BEAR.has(r) ? 'bear' : r === 'NOT RATED' ? 'nr' : 'neu';
  return `<span class="pill ${k}">${esc(r === 'NOT RATED' ? 'N-R' : r)}</span>`;
}

// sparkline svg
function spark(arr, w = 72, h = 22) {
  if (!arr || arr.length < 2) return '';
  const mn = Math.min(...arr), mx = Math.max(...arr), rg = mx - mn || 1;
  const pts = arr.map((v, i) => `${(i / (arr.length - 1)) * w},${h - 2 - ((v - mn) / rg) * (h - 4)}`).join(' ');
  const col = arr[arr.length - 1] >= arr[0] ? C.up : C.down;
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${col}" stroke-width="1.4" points="${pts}"/></svg>`;
}

// segmented buttons
function seg(el, opts, cur, onPick) {
  el.innerHTML = opts.map((o) => `<button data-k="${esc(o.k ?? o)}" class="${(o.k ?? o) === cur ? 'on' : ''}">${esc(o.l ?? o)}</button>`).join('');
  el.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    onPick(b.dataset.k);
  };
}

// ------------------------------------------------------------------ data
async function getJSON(name) {
  const bust = Math.floor(Date.now() / 300000);
  try { const r = await fetch(`data/${name}?v=${bust}`); if (!r.ok) throw new Error(r.status); return await r.json(); }
  catch (e) { console.warn('load failed', name, e); return null; }
}
const STK = {};      // code -> stock row
const Q = (sym) => (D.quotes && D.quotes.q[sym]) || null;
const SECTOR_SYM = {};
function sectorOf(code) { return (STK[code] && STK[code].s) || (D.companies && D.companies[code] && D.companies[code].s) || null; }
function nameOf(code) { return (STK[code] && STK[code].n) || (D.companies && D.companies[code] && D.companies[code].n) || code; }
// research archive folder -> IDX-IC sector
const FOLDER_SECTOR = {
  'Indonesia Banks': 'Financials', 'Indonesia Coal': 'Energy', 'Indonesia Oil & Gas': 'Energy', 'Indonesia Metals': 'Basic Materials',
  'Indonesia Cement': 'Basic Materials', 'Indonesia Plantations': 'Consumer Non-Cyclicals', 'Indonesia Consumer Staples': 'Consumer Non-Cyclicals',
  'Indonesia Consumer Discretionary': 'Consumer Cyclicals', 'Indonesia Media': 'Consumer Cyclicals', 'Indonesia Real Estate': 'Property & Real Estate',
  'Indonesia Autos': 'Industrials', 'Indonesia Telecom': 'Infrastructure', 'Indonesia Infra': 'Infrastructure', 'Indonesia Power': 'Infrastructure',
  'Indonesia Healthcare': 'Healthcare', 'Indonesia Logistics': 'Transportation & Logistics', 'Indonesia Internet': 'Technology',
};
function noteSector(n) { return n.tk ? sectorOf(n.tk) : FOLDER_SECTOR[n.f] || null; }

// ------------------------------------------------------------------ series helpers
const RANGES = ['1D', '1W', '1M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y'];
function seriesFor(sym, rng) {
  const s = D.series && D.series[sym]; if (!s) return null;
  if (rng === '1D') return s.d1;
  if (rng === '1W') return s.w1;
  const src = ['3Y', '5Y', '10Y'].includes(rng) ? s.y10 : s.y1;
  if (!src) return null;
  const last = src.t[src.t.length - 1] * 1000;
  const d = new Date(last);
  let from;
  if (rng === 'YTD') from = Date.UTC(d.getUTCFullYear(), 0, 1) / 1000 - 7 * 3600;
  else {
    const months = { '1M': 1, '6M': 6, '1Y': 12, '3Y': 36, '5Y': 60, '10Y': 120 }[rng];
    const f = new Date(last); f.setUTCMonth(f.getUTCMonth() - months); from = f.getTime() / 1000;
  }
  // keep one point before the window start as the base
  let i0 = src.t.findIndex((t) => t >= from); if (i0 > 0) i0 -= 1; if (i0 < 0) i0 = 0;
  return { t: src.t.slice(i0), c: src.c.slice(i0) };
}
function retFor(sym, rng) {
  const q = Q(sym); if (!q) return null;
  if (q.r && q.r[rng] != null) return q.r[rng];
  const s = seriesFor(sym, rng); if (!s || s.c.length < 2) return null;
  const base = rng === '1D' ? q.pc : s.c[0];
  return (q.p / base - 1) * 100;
}

// ------------------------------------------------------------------ charts
Chart.defaults.color = C.mute;
Chart.defaults.font.family = "'Roboto Mono', monospace";
Chart.defaults.font.size = 10.5;
Chart.defaults.borderColor = 'rgba(37,44,57,.6)';
const CH = {};
function mkChart(id, cfg) {
  if (CH[id]) CH[id].destroy();
  const x = cfg.options && cfg.options.scales && cfg.options.scales.x;
  if (x && x.type === 'linear') {   // pin a time axis to the data instead of "nice" padded bounds
    const xs = cfg.data.datasets.flatMap((d) => d.data.map((p) => p.x));
    if (xs.length) { x.min = Math.min(...xs); x.max = Math.max(...xs); }
  }
  CH[id] = new Chart($(id), cfg); return CH[id];
}
function timeTick(rng) {
  return (v) => {
    const d = new Date(v);
    if (rng === '1D') return d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
    if (rng === '1W' || rng === '1M') return d.toLocaleDateString('en-GB', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short' });
    if (['3Y', '5Y', '10Y'].includes(rng)) return d.toLocaleDateString('en-GB', { timeZone: 'Asia/Jakarta', month: 'short', year: '2-digit' });
    return d.toLocaleDateString('en-GB', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short' });
  };
}
function gradient(ctx, col) {
  const g = ctx.createLinearGradient(0, 0, 0, 300);
  g.addColorStop(0, col + '55'); g.addColorStop(1, col + '00'); return g;
}

// ================================================================== OVERVIEW
const DESK = ['^JKSE', '^JKLQ45', 'IDX30.JK', 'IDX80.JK', 'KOMPAS100.JK', 'IDXSMC-LIQ.JK', 'IDXHIDIV20.JK', 'ISSI.JK', 'IDR=X', 'EIDO'];
const ST = { idxRange: '1M', overlays: new Set(LS.get('idrp.overlays', [])), secRange: '1D', mvRange: '1D', flowPeriod: 'YTD', flowAgg: 'D', topFlow: '1W', rnGroup: 'house', sector: null, sdRange: '1Y', secSort: { k: 'YTD', dir: 1 }, consSort: { k: 'mc', dir: -1 } };

function renderTicker() {
  const syms = ['^JKSE', '^JKLQ45', 'IDX30.JK', 'IDX80.JK', 'KOMPAS100.JK', 'IDXSMC-LIQ.JK', 'IDR=X', 'EIDO', 'IDXFINANCE.JK', 'IDXENERGY.JK', 'IDXBASIC.JK', 'IDXINFRA.JK', 'IDXNONCYC.JK', 'IDXTECHNO.JK'];
  const html = syms.map((s) => {
    const q = Q(s); if (!q) return '';
    const r = q.r && q.r['1D'];
    return `<span class="tk"><b>${esc(q.n.replace('MSCI Indonesia ETF (USD)', 'EIDO').toUpperCase())}</b><span class="v mono">${fmt(q.p, q.p < 100 ? 2 : 2)}</span><span class="mono ${cls(r)}">${pct(r)}</span></span>`;
  }).join('');
  $('tickerTrack').innerHTML = html + html;
}

function renderKpis() {
  const j = Q('^JKSE');
  if (j) {
    $('kJci').textContent = fmt(j.p, 2);
    $('kJciChg').innerHTML = `<span class="${cls(j.ch)}">${j.ch >= 0 ? '▲' : '▼'} ${fmt(Math.abs(j.ch), 2)} (${pct(j.r['1D'])})</span>`;
    $('kJciMeta').textContent = j.dl ? `Day range ${fmt(j.dl, 0)} – ${fmt(j.dh, 0)} · YTD ${pct(j.r.YTD, 1)}` : 'Jakarta Composite Index';
  }
  const m = D.market;
  if (m) {
    $('kBreadth').innerHTML = `<span class="up">${m.adv}</span> / <span class="down">${m.dec}</span>`;
    const tot = m.adv + m.dec + m.unch || 1;
    $('kBreadthBar').innerHTML = `<i style="width:${(m.adv / tot) * 100}%;background:${C.up}"></i><i style="width:${(m.unch / tot) * 100}%;background:${C.mute}"></i><i style="width:${(m.dec / tot) * 100}%;background:${C.down}"></i>`;
    $('kBreadthMeta').textContent = `${m.unch} unch · turnover Rp${fmt(m.turnover, 1)}tn · ${dShort(m.asof)}`;
  }
  const f = D.flows;
  if (f && f.daily.length) {
    const last = f.daily[f.daily.length - 1];
    $('kFlow').innerHTML = `<span class="${cls(last.n)}">${rpbn(last.n)}</span>`;
    const mtd = f.daily.filter((x) => x.d.slice(0, 7) === last.d.slice(0, 7)).reduce((a, x) => a + x.n, 0);
    const ytd = f.daily.filter((x) => x.d.slice(0, 4) === last.d.slice(0, 4)).reduce((a, x) => a + x.n, 0);
    $('kFlowChg').innerHTML = `MTD <span class="${cls(mtd)}">${rptn(mtd)}</span> · YTD <span class="${cls(ytd)}">${rptn(ytd)}</span>`;
    $('kFlowMeta').textContent = `Session ${dShort(last.d)} · all boards`;
  }
  const fx = Q('IDR=X');
  if (fx) {
    $('kFx').textContent = fmt(fx.p, 0);
    // rupiah weakening (USD/IDR up) is shown red
    const r = fx.r['1D'];
    $('kFxChg').innerHTML = `<span class="${cls(-r)}">${r >= 0 ? '▲' : '▼'} ${fmt(Math.abs(fx.ch), 0)} (${pct(r)})</span> <span class="mute">· YTD ${pct(fx.r.YTD, 1)}</span>`;
  }
}

function renderDesk() {
  const syms = DESK.filter(Q);
  $('deskRows').innerHTML = syms.map((s, i) => {
    const q = Q(s); const r = retFor(s, ST.idxRange);
    const on = ST.overlays.has(s);
    const col = OVERLAY_COLORS[i % OVERLAY_COLORS.length];
    return `<div class="stat-row" data-s="${esc(s)}"><input type="checkbox" class="stat-cb" ${on ? 'checked' : ''} tabindex="-1"/><span class="stat-sw" style="--sw:${col}"></span>
      <span class="stat-nm">${esc(q.n)}</span><b>${fmt(q.p, 2)}</b><span class="chgc ${cls(s === 'IDR=X' ? -r : r)}">${pct(r)}</span></div>`;
  }).join('') + `<div class="note">Change column = return over the chart range (${ST.idxRange}). USD/IDR rising (rupiah weakening) is shown in red.</div>`;
  $('deskRows').onclick = (e) => {
    const row = e.target.closest('.stat-row'); if (!row) return;
    const s = row.dataset.s;
    ST.overlays.has(s) ? ST.overlays.delete(s) : ST.overlays.add(s);
    LS.set('idrp.overlays', [...ST.overlays]);
    renderDesk(); renderIdxChart();
  };
}

function renderIdxChart() {
  const rng = ST.idxRange;
  const ov = [...ST.overlays].filter(Q);
  const ctx = $('idxChart').getContext('2d');
  if (!ov.length) {
    const s = seriesFor('^JKSE', rng);
    $('idxChartTitle').textContent = 'JCI — Index Performance';
    $('idxChartSub').textContent = `Yahoo Finance · ^JKSE · ${rng === '1D' ? '5-min intraday' : rng === '1W' ? '30-min' : ['3Y', '5Y', '10Y'].includes(rng) ? 'weekly close' : 'daily close'} · ${pct(retFor('^JKSE', rng))} over ${rng}`;
    if (!s) return;
    const up = s.c[s.c.length - 1] >= s.c[0];
    const col = up ? C.saf : C.down;
    mkChart('idxChart', {
      type: 'line',
      data: { datasets: [{ data: s.t.map((t, i) => ({ x: t * 1000, y: s.c[i] })), borderColor: col, backgroundColor: gradient(ctx, col), fill: true, borderWidth: 1.6, pointRadius: 0, tension: 0.15 }] },
      options: baseLineOpts(rng, (v) => fmt(v, 0)),
    });
  } else {
    $('idxChartTitle').textContent = 'Desk Snapshot — Relative Returns';
    $('idxChartSub').textContent = `Rebased to 0% at the start of ${rng} · ${ov.length} series`;
    const ds = ov.map((s) => {
      const ser = seriesFor(s, rng); if (!ser || !ser.c.length) return null;
      const base = rng === '1D' && Q(s).pc ? Q(s).pc : ser.c[0];
      const col = OVERLAY_COLORS[DESK.indexOf(s) % OVERLAY_COLORS.length];
      return { label: Q(s).n, data: ser.t.map((t, i) => ({ x: t * 1000, y: (ser.c[i] / base - 1) * 100 })), borderColor: col, borderWidth: 1.6, pointRadius: 0, tension: 0.15 };
    }).filter(Boolean);
    const opts = baseLineOpts(rng, (v) => v.toFixed(1) + '%');
    opts.plugins.legend = { display: true, labels: { boxWidth: 10, boxHeight: 2, color: C.dim } };
    opts.plugins.tooltip.callbacks.label = (c) => `${c.dataset.label}: ${pct(c.parsed.y)}`;
    mkChart('idxChart', { type: 'line', data: { datasets: ds }, options: opts });
  }
}
function baseLineOpts(rng, yfmt) {
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    scales: {
      x: { type: 'linear', ticks: { callback: timeTick(rng), maxTicksLimit: 7, maxRotation: 0 }, grid: { display: false } },
      y: { position: 'right', ticks: { callback: yfmt, maxTicksLimit: 6 }, grid: { color: 'rgba(37,44,57,.5)' } },
    },
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: '#1b212c', borderColor: C.line, borderWidth: 1, titleColor: C.text, bodyColor: C.dim,
        callbacks: { title: (it) => { const d = new Date(it[0].parsed.x); return rng === '1D' || rng === '1W' ? d.toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' WIB' : d.toLocaleDateString('en-GB', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric' }); },
          label: (c) => fmt(c.parsed.y, 2) } },
    },
  };
}

function renderSectors() {
  const rng = ST.secRange;
  const secs = Object.entries(D.quotes.q).filter(([, q]) => q.g === 'sector').map(([s, q]) => ({ s, n: q.n, r: q.r[rng] })).filter((x) => x.r != null).sort((a, b) => b.r - a.r);
  const mx = Math.max(...secs.map((x) => Math.abs(x.r)), 0.5);
  const jci = retFor('^JKSE', rng);
  $('secSub').textContent = `IDX-IC sector indices · ${rng} return · JCI ${pct(jci)}`;
  $('sectorBars').innerHTML = secs.map((x) => {
    const w = (Math.abs(x.r) / mx) * 50;
    const pos = x.r >= 0 ? `left:50%;width:${w}%;background:${C.up}` : `left:${50 - w}%;width:${w}%;background:${C.down}`;
    return `<div class="sector" data-n="${esc(x.n)}" title="Open ${esc(x.n)} in the Sector tab"><span class="nm">${esc(x.n)}</span><span class="bar"><i style="${pos}"></i></span><span class="pct ${cls(x.r)}">${pct(x.r)}</span></div>`;
  }).join('');
  $('sectorBars').onclick = (e) => { const r = e.target.closest('.sector'); if (r) { ST.sector = r.dataset.n; go('sector'); } };
}

function renderPulse() {
  const f = D.flows; if (!f) return;
  const last = f.daily.slice(-30);
  mkChart('pulseChart', {
    type: 'bar',
    data: { labels: last.map((x) => dShort(x.d)), datasets: [{ data: last.map((x) => x.n), backgroundColor: last.map((x) => (x.n >= 0 ? C.up : C.down)), borderRadius: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => rpbn(c.parsed.y, 1) } } },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } }, y: { position: 'right', ticks: { callback: (v) => fmt(v, 0) } } } },
  });
  const s = last.reduce((a, x) => a + x.n, 0);
  const buys = last.filter((x) => x.n > 0).length;
  $('pulseNote').innerHTML = `Last 30 sessions: net <b class="${cls(s)}">${rptn(s)}</b> · foreigners were net buyers on ${buys} of 30 days. <a href="#flows" data-go="flows" style="color:var(--saffron)">Full flows →</a>`;
}

function universe() { return D.stocks.rows.filter((r) => r.r); }
function renderMovers() {
  const rng = ST.mvRange;
  const rows = universe().map((r) => ({ ...r, x: r.r[rng] })).filter((r) => r.x != null).sort((a, b) => b.x - a.x);
  $('moversSub').textContent = `Top ${universe().length} IDX stocks by market cap · ${rng} return · Yahoo Finance closes`;
  const tr = (r) => `<tr class="click" data-c="${r.c}"><td><span class="nm">${esc(r.n)}</span><span class="tk-tag">${r.c}</span></td><td class="r" style="width:74px">${fmtPx(r.yp ?? r.p)}</td><td class="r ${cls(r.x)}" style="width:70px">${pct(r.x)}</td><td class="r" style="width:80px">${spark(r.sp)}</td></tr>`;
  $('mvTop').innerHTML = rows.slice(0, 20).map(tr).join('');
  $('mvBot').innerHTML = rows.slice(-20).reverse().map(tr).join('');
}

function renderHighs() {
  const u = universe().filter((r) => r.h52 && r.yp && r.mc >= 5000);
  const hi = u.map((r) => ({ ...r, dist: (r.yp / r.h52 - 1) * 100 })).filter((r) => r.dist >= -3).sort((a, b) => b.dist - a.dist || b.mc - a.mc).slice(0, 15);
  const lo = u.filter((r) => r.l52).map((r) => ({ ...r, dist: (r.yp / r.l52 - 1) * 100 })).filter((r) => r.dist <= 3).sort((a, b) => a.dist - b.dist || b.mc - a.mc).slice(0, 15);
  const head = (lbl) => `<tr><th>Stock</th><th class="r">Price</th><th class="r">${lbl}</th><th class="r">Gap</th><th class="r">YTD</th></tr>`;
  const row = (r, ref) => `<tr class="click" data-c="${r.c}"><td><span class="nm">${esc(r.n)}</span><span class="tk-tag">${r.c}</span>${Math.abs(r.dist) < 0.05 ? ' <span class="pill ' + (ref === 'h' ? 'bull' : 'bear') + '">AT ' + (ref === 'h' ? 'HIGH' : 'LOW') + '</span>' : ''}</td><td class="r">${fmtPx(r.yp)}</td><td class="r">${fmtPx(ref === 'h' ? r.h52 : r.l52)}</td><td class="r ${cls(ref === 'h' ? r.dist : r.dist)}">${pct(r.dist, 1)}</td><td class="r ${cls(r.r.YTD)}">${pct(r.r.YTD, 1)}</td></tr>`;
  $('hiTbl').innerHTML = hi.length ? head('52W high') + hi.map((r) => row(r, 'h')).join('') : '<tr><td class="empty">No large/mid caps near a 52-week high.</td></tr>';
  $('loTbl').innerHTML = lo.length ? head('52W low') + lo.map((r) => row(r, 'l')).join('') : '<tr><td class="empty">No large/mid caps near a 52-week low.</td></tr>';
  $('hiSub').textContent = `Stocks > Rp5tn market cap within 3% of their 52-week closing high / low · ${hi.length} near highs, ${lo.length} near lows`;
}

function renderOverview() {
  renderKpis();
  seg($('idxRange'), RANGES, ST.idxRange, (k) => { ST.idxRange = k; renderIdxChart(); renderDesk(); });
  renderDesk(); renderIdxChart();
  seg($('secRange'), ['1D', '1W', '1M', '6M', 'YTD', '1Y'], ST.secRange, (k) => { ST.secRange = k; renderSectors(); });
  renderSectors(); renderPulse();
  seg($('mvRange'), ['1D', '1W', '1M', '6M', 'YTD', '1Y'], ST.mvRange, (k) => { ST.mvRange = k; renderMovers(); });
  renderMovers(); renderHighs();
}

// ================================================================== NEWS
let newsBucket = 'ALL';
function renderNews() {
  const n = D.news; if (!n) { $('newsList').innerHTML = '<li class="empty">News feed unavailable.</li>'; return; }
  const keys = Object.keys(n.b);
  seg($('newsSeg'), [{ k: 'ALL', l: 'All' }, ...keys.map((k) => ({ k, l: n.labels[k] }))], newsBucket, (k) => { newsBucket = k; renderNews(); });
  let items = newsBucket === 'ALL' ? keys.flatMap((k) => n.b[k].slice(0, k === 'FLOW' ? 6 : 12)) : n.b[newsBucket];
  items = [...items].sort((a, b) => (a.d < b.d ? 1 : -1));
  $('newsSub').textContent = `Google News · Indonesia · refreshed ${ago(n.updated)} · ${items.length} headlines${newsBucket === 'FLOW' ? ' · Bahasa Indonesia sources' : ''}`;
  $('newsList').innerHTML = items.map((x) => `<li><span class="news-tag">${esc(n.labels[x.c] || x.c)}</span><div class="news-body"><a href="${esc(x.l)}" target="_blank" rel="noopener">${esc(x.t)}</a><div class="news-meta">${esc(x.s)} · ${ago(x.d)}</div></div></li>`).join('') || '<li class="empty">No headlines in this bucket.</li>';
  const mac = (D.research ? D.research.notes : []).filter((x) => (x.k === 'macro' || x.k === 'strategy') && daysAgo(x.d) <= 21);
  $('macroNotes').innerHTML = mac.length ? mac.map(noteRow).join('') : '<div class="empty">No macro or strategy notes in the last 3 weeks.</div>';
}

// ================================================================== RESEARCH
function upside(n) {
  if (!n.tp || !n.tk || !STK[n.tk]) return null;
  return (n.tp / (STK[n.tk].yp || STK[n.tk].p) - 1) * 100;
}
function tpCell(n) {
  if (!n.tp) return '<span class="mute">—</span>';
  const u = upside(n);
  const chg = n.ptp && n.ptp !== n.tp ? `<span class="mute">${fmt(n.ptp)}</span><span class="arrow">→</span>` : '';
  return `${chg}Rp${fmt(n.tp)}${u != null ? ` <span class="${cls(u)}" title="upside to last close">${pct(u, 0)}</span>` : ''}`;
}
function callCell(n) {
  return n.prev && n.prev !== n.rating ? `${ratingPill(n.prev)}<span class="arrow">→</span>${ratingPill(n.rating)}` : ratingPill(n.rating);
}
function noteRow(n) {
  const co = n.k === 'company' ? `${esc(n.co)}${n.tk ? `<span class="tk-tag">${n.tk}</span>` : ''}` : `<span class="kind">${n.k}</span>${n.k === 'sector' ? esc(n.co.replace(/^Indonesia /, '')) : 'Indonesia'}`;
  return `<div class="rn-row"><span class="d">${dShort(n.d)}</span><span class="h mute" style="font-size:12px">${esc(n.h)}</span><span><div class="co">${co}</div><div class="ti">${esc(n.t)}</div></span><span class="rt">${n.k === 'company' ? callCell(n) : ''}</span><span class="tp">${n.k === 'company' ? tpCell(n) : ''}</span></div>`;
}
function renderResearch() {
  const R = D.research; if (!R) { $('rnList').innerHTML = '<div class="empty">No research index yet.</div>'; return; }
  const win = +$('rnWindow').value, kind = $('rnKind').value;
  const notes = R.notes.filter((n) => daysAgo(n.d) <= win && (!kind || n.k === kind));
  const latest = R.notes.length ? R.notes[0].d : null;
  $('rnSub').textContent = `${notes.length} notes · ${new Set(notes.map((n) => n.h)).size} houses · latest ${latest ? dShort(latest) : '—'} · rating/TP auto-read from page 1 (verify in the PDF)`;
  seg($('rnGroup'), [{ k: 'house', l: 'House' }, { k: 'company', l: 'Company' }, { k: 'date', l: 'Date' }], ST.rnGroup, (k) => { ST.rnGroup = k; renderResearch(); });
  const key = { house: (n) => n.h, company: (n) => (n.k === 'company' ? n.co : n.co), date: (n) => n.d }[ST.rnGroup];
  const groups = new Map();
  notes.forEach((n) => { const k = key(n); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); });
  let ks = [...groups.keys()];
  ks.sort(ST.rnGroup === 'date' ? (a, b) => (a < b ? 1 : -1) : (a, b) => groups.get(b).length - groups.get(a).length || a.localeCompare(b));
  $('rnList').innerHTML = ks.map((k) => `<div class="rn-group"><h4>${esc(ST.rnGroup === 'date' ? new Date(k + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : k)}<span>${groups.get(k).length} note${groups.get(k).length > 1 ? 's' : ''}</span></h4>${groups.get(k).map(noteRow).join('')}</div>`).join('') || '<div class="empty">No notes in this window.</div>';

  // upgrades / downgrades (company notes, same window)
  const co = notes.filter((n) => n.k === 'company');
  const ups = co.filter((n) => n.action === 'upgrade' || (n.tp && n.ptp && n.tp > n.ptp && n.action !== 'downgrade'));
  const dns = co.filter((n) => n.action === 'downgrade' || (n.tp && n.ptp && n.tp < n.ptp && n.action !== 'upgrade'));
  const head = '<tr><th>Company</th><th>House</th><th>Call</th><th class="r">Target</th></tr>';
  const row = (n) => `<tr><td><span class="nm">${esc(n.co)}</span>${n.tk ? `<span class="tk-tag">${n.tk}</span>` : ''}<div class="mute" style="font-size:11px">${dShort(n.d)} · ${esc(n.t.slice(0, 60))}</div></td><td class="mute" style="font-size:12px">${esc(n.h)}</td><td>${callCell(n)}</td><td class="r">${tpCell(n)}${n.ptp && n.tp ? `<div class="${cls(n.tp - n.ptp)}" style="font-size:11px">${pct((n.tp / n.ptp - 1) * 100, 1)} TP</div>` : ''}</td></tr>`;
  $('upTbl').innerHTML = ups.length ? head + ups.map(row).join('') : '<tr><td class="empty">None in this window.</td></tr>';
  $('dnTbl').innerHTML = dns.length ? head + dns.map(row).join('') : '<tr><td class="empty">None in this window.</td></tr>';
  $('upSub').textContent = `${ups.length} in window · rating upgrades or higher TPs`;
  $('dnSub').textContent = `${dns.length} in window · rating downgrades or lower TPs`;
}

// ================================================================== STRATEGY
function renderStrategy() {
  const S = D.strategy; if (!S) return;
  const H = [...S.houses].sort((a, b) => (a.d < b.d ? 1 : -1));
  const perf = (D.stratPerf && D.stratPerf.p) || {};
  const jciSince = (d) => { const s = D.series['^JKSE'].y1; const t0 = new Date(d + 'T16:00:00+07:00').getTime() / 1000; let b = null; s.t.forEach((t, i) => { if (t <= t0) b = s.c[i]; }); return b ? (Q('^JKSE').p / b - 1) * 100 : null; };
  const houseRet = (h) => { const p = perf[h.h] || {}; const rs = Object.values(p).map(([a, b]) => (b / a - 1) * 100); return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null; };
  $('stSub').textContent = `${H.length} houses · latest ${dShort(H[0].d)} · picks performance uses IDX closes, equal-weighted`;
  $('houseGrid').innerHTML = H.map((h) => {
    const hr = houseRet(h), jr = jciSince(h.d);
    const stCls = /constructive|bull|positive/i.test(h.stance) ? 'bull' : /cautious|bear|negative/i.test(h.stance) ? 'bear' : 'neu';
    return `<div class="house"><div class="house-h"><div><h4>${esc(h.h)}</h4><div class="ttl">${dShort(h.d)} · ${esc(h.title)}</div></div><div style="text-align:right"><span class="pill ${stCls}">${esc(h.stance.toUpperCase())}</span>${h.jci ? `<div class="mono" style="font-size:12px;margin-top:6px">JCI ${fmt(h.jci)}</div><div class="mute" style="font-size:10.5px">${esc(h.jciNote || '')}</div>` : ''}</div></div>
      <ul>${h.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      <div class="picks">${h.picks.map((p) => `<span class="pill ${p.hc ? 'hc' : 'ghost'}" title="${esc(nameOf(p.c))}${p.tp ? ' · TP Rp' + fmt(p.tp) : ''}">${p.c}</span>`).join('')}</div>
      ${h.added.length || h.removed.length ? `<div class="chg-line">${h.added.length ? `<span class="up">+ ${h.added.join(', ')}</span>` : ''}${h.added.length && h.removed.length ? ' · ' : ''}${h.removed.length ? `<span class="down">− ${h.removed.join(', ')}</span>` : ''}</div>` : ''}
      <div class="chg-line">Picks since report: <b class="${cls(hr)}">${pct(hr, 1)}</b> vs JCI <b class="${cls(jr)}">${pct(jr, 1)}</b>${hr != null && jr != null ? ` · alpha <b class="${cls(hr - jr)}">${pct(hr - jr, 1)}</b>` : ''}</div></div>`;
  }).join('');

  // matrix
  const pick = {};
  H.forEach((h) => h.picks.forEach((p) => { (pick[p.c] = pick[p.c] || {})[h.h] = p; }));
  const codes = Object.keys(pick).sort((a, b) => Object.keys(pick[b]).length - Object.keys(pick[a]).length || ((STK[b] || {}).mc || 0) - ((STK[a] || {}).mc || 0));
  const hdr = `<tr><th>Stock</th><th>Sector</th><th class="c">#</th>${H.map((h) => `<th class="c">${esc(h.h.replace(' International', '').replace(' Sekuritas', ''))}</th>`).join('')}<th class="r">Price</th><th class="r">Avg TP</th><th class="r">Upside</th><th class="r">1M</th><th class="r">YTD</th></tr>`;
  $('pickMatrix').innerHTML = hdr + codes.map((c) => {
    const s = STK[c] || {}; const tps = Object.values(pick[c]).map((p) => p.tp).filter(Boolean);
    const avg = tps.length ? tps.reduce((a, b) => a + b, 0) / tps.length : null; const px = s.yp || s.p;
    const up = avg && px ? (avg / px - 1) * 100 : null;
    return `<tr class="click" data-c="${c}"><td><span class="nm">${esc(nameOf(c))}</span><span class="tk-tag">${c}</span></td><td class="mute" style="font-size:12px">${esc(sectorOf(c) || '—')}</td><td class="c mono">${Object.keys(pick[c]).length}</td>
      ${H.map((h) => { const p = pick[c][h.h]; if (!p) return '<td class="c mute">·</td>'; const pr = (perf[h.h] || {})[c]; const r = pr ? (pr[1] / pr[0] - 1) * 100 : null; return `<td class="c" title="${p.tp ? 'TP Rp' + fmt(p.tp) : ''}${r != null ? ' · since ' + dShort(h.d) + ': ' + pct(r, 1) : ''}"><span class="dotc ${p.hc ? 'hc' : ''}"></span>${r != null ? `<div class="${cls(r)}" style="font-size:10px;font-family:Roboto Mono">${pct(r, 0)}</div>` : ''}</td>`; }).join('')}
      <td class="r">${fmtPx(px)}</td><td class="r">${avg ? fmt(avg) : '—'}</td><td class="r ${cls(up)}">${pct(up, 0)}</td><td class="r ${cls(s.r && s.r['1M'])}">${pct(s.r && s.r['1M'], 1)}</td><td class="r ${cls(s.r && s.r.YTD)}">${pct(s.r && s.r.YTD, 1)}</td></tr>`;
  }).join('');

  // inferred tilt
  const secs = Object.values(D.quotes.q).filter((q) => q.g === 'sector').map((q) => q.n);
  const cnt = {}; H.forEach((h) => h.picks.forEach((p) => { const s = sectorOf(p.c) || 'Other'; ((cnt[s] = cnt[s] || {})[h.h] = (cnt[s][h.h] || 0) + 1); }));
  const rows = secs.map((s) => ({ s, tot: H.reduce((a, h) => a + ((cnt[s] || {})[h.h] || 0), 0) })).sort((a, b) => b.tot - a.tot);
  const mx = Math.max(1, ...rows.flatMap((r) => H.map((h) => (cnt[r.s] || {})[h.h] || 0)));
  $('tiltGrid').innerHTML = `<tr><th>IDX-IC sector</th>${H.map((h) => `<th class="c">${esc(h.h.replace(' International', '').replace(' Sekuritas', ''))}</th>`).join('')}<th class="c">Total</th><th>Read</th></tr>` + rows.map((r) => {
    const cells = H.map((h) => { const v = (cnt[r.s] || {})[h.h] || 0; return `<td class="c">${v ? `<span class="heat" style="background:rgba(233,162,59,${0.12 + 0.55 * (v / mx)});color:${v / mx > 0.5 ? '#1a1206' : C.text}">${v}</span>` : '<span class="mute">·</span>'}</td>`; }).join('');
    const nh = H.filter((h) => (cnt[r.s] || {})[h.h]).length;
    const read = nh >= 3 ? '<span class="pill bull">CONSENSUS FAVOURED</span>' : nh === 0 ? '<span class="pill nr">NO PICKS</span>' : '<span class="pill neu">SELECTIVE</span>';
    return `<tr class="click" data-sec="${esc(r.s)}"><td>${esc(r.s)}</td>${cells}<td class="c mono">${r.tot}</td><td>${read}</td></tr>`;
  }).join('');
  $('tiltGrid').onclick = (e) => { const tr = e.target.closest('tr[data-sec]'); if (tr) { ST.sector = tr.dataset.sec; go('sector'); } };
}

// ================================================================== FUND FLOWS
function flowWindow(period) {
  const f = D.flows.daily; const last = f[f.length - 1].d;
  const y = last.slice(0, 4), m = last.slice(0, 7), q0 = `${y}-${String(Math.floor((+last.slice(5, 7) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
  if (period === 'MTD') return f.filter((x) => x.d.slice(0, 7) === m);
  if (period === 'QTD') return f.filter((x) => x.d >= q0);
  if (period === 'YTD') return f.filter((x) => x.d.slice(0, 4) === y);
  if (period === '3M') return f.slice(-63);
  return f;
}
function isoWeek(d) { const dt = new Date(d + 'T00:00:00Z'); const day = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - day); return dt.toISOString().slice(0, 10); }
function renderFlows() {
  const F = D.flows; if (!F) return;
  seg($('flowPeriod'), ['MTD', 'QTD', '3M', 'YTD', 'All'], ST.flowPeriod, (k) => { ST.flowPeriod = k; renderFlowChart(); });
  seg($('flowAgg'), ['D', 'W', 'M'], ST.flowAgg, (k) => { ST.flowAgg = k; renderFlowChart(); });
  const last = F.daily[F.daily.length - 1];
  const sum = (p) => flowWindow(p).reduce((a, x) => a + x.n, 0);
  const k = [['Latest session · ' + dShort(last.d), last.n], ['Month-to-date', sum('MTD')], ['Quarter-to-date', sum('QTD')], ['Year-to-date', sum('YTD')]];
  $('flowKpis').innerHTML = k.map(([l, v]) => `<div class="flow-kpi"><div class="lbl">${l}</div><div class="v ${cls(v)}">${rptn(v)}</div></div>`).join('');
  renderFlowChart(); renderSecFlows();
  seg($('topFlowSeg'), ['1D', '1W', '1M', 'MTD', 'YTD'], ST.topFlow, (k2) => { ST.topFlow = k2; renderTopFlows(); });
  renderTopFlows();
}
function renderFlowChart() {
  const rows = flowWindow(ST.flowPeriod);
  const buckets = new Map();
  rows.forEach((x) => { const k = ST.flowAgg === 'D' ? x.d : ST.flowAgg === 'W' ? isoWeek(x.d) : x.d.slice(0, 7); buckets.set(k, (buckets.get(k) || 0) + x.n); });
  const labels = [...buckets.keys()]; const vals = [...buckets.values()];
  let c = 0; const cum = vals.map((v) => (c += v));
  $('flowSub').textContent = `All boards · Rp bn · ${{ D: 'daily', W: 'weekly', M: 'monthly' }[ST.flowAgg]} · ${dShort(rows[0].d)} – ${dShort(rows[rows.length - 1].d)} ${rows[0].d.slice(0, 4)}`;
  const lab = (k) => (ST.flowAgg === 'M' ? new Date(k + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : (ST.flowAgg === 'W' ? 'wk ' : '') + dShort(k));
  mkChart('flowChart', {
    data: { labels: labels.map(lab), datasets: [
      { type: 'line', label: 'Cumulative', data: cum, borderColor: C.saf, borderWidth: 1.8, pointRadius: 0, yAxisID: 'y2', tension: 0.15, order: 0 },
      { type: 'bar', label: 'Net foreign', data: vals, backgroundColor: vals.map((v) => (v >= 0 ? C.up : C.down)), borderRadius: 2, yAxisID: 'y', order: 1 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, labels: { boxWidth: 10, color: C.dim } }, tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${rpbn(x.parsed.y, 1)}` } } },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10, maxRotation: 0 } }, y: { position: 'left', ticks: { callback: (v) => fmt(v, 0) }, title: { display: true, text: 'Net · Rp bn' } }, y2: { position: 'right', grid: { display: false }, ticks: { callback: (v) => fmt(v, 0) }, title: { display: true, text: 'Cumulative' } } } },
  });
}
function secFlowSums() {
  const F = D.flows; const dd = F.daily.map((x) => x.d); const last = dd[dd.length - 1];
  const idxFrom = (pred) => dd.map((d, i) => (pred(d, i) ? i : -1)).filter((i) => i >= 0);
  const W = { '1D': idxFrom((d, i) => i === dd.length - 1), '1W': idxFrom((d, i) => i >= dd.length - 5), '1M': idxFrom((d, i) => i >= dd.length - 21), MTD: idxFrom((d) => d.slice(0, 7) === last.slice(0, 7)), YTD: idxFrom((d) => d.slice(0, 4) === last.slice(0, 4)) };
  return Object.entries(F.sectors).filter(([s]) => s !== 'Other').map(([s, arr]) => { const o = { s }; Object.entries(W).forEach(([k, ix]) => { o[k] = ix.reduce((a, i) => a + (arr[i] || 0), 0); }); return o; });
}
function renderSecFlows() {
  const rows = secFlowSums(); const sk = ST.secSort;
  rows.sort((a, b) => (sk.k === 's' ? a.s.localeCompare(b.s) * sk.dir : (a[sk.k] - b[sk.k]) * sk.dir));
  const ks = ['1D', '1W', '1M', 'MTD', 'YTD'];
  const mx = {}; ks.forEach((k) => { mx[k] = Math.max(1, ...rows.map((r) => Math.abs(r[k]))); });
  const heat = (v, m) => { const a = Math.min(1, Math.abs(v) / m) * 0.45; return `background:${v >= 0 ? `rgba(63,199,138,${a})` : `rgba(240,106,106,${a})`}`; };
  $('secFlowTbl').innerHTML = `<tr><th class="sortable" data-k="s">Sector</th>${ks.map((k) => `<th class="r sortable" data-k="${k}">${k}${sk.k === k ? (sk.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr>` +
    rows.map((r) => `<tr class="click" data-sec="${esc(r.s)}"><td>${esc(r.s)} <span class="mute">▸</span></td>${ks.map((k) => `<td class="r"><span class="cell-heat" style="${heat(r[k], mx[k])}">${sgn(r[k], 0)}</span></td>`).join('')}</tr>`).join('');
  const tot = {}; ks.forEach((k) => { tot[k] = rows.reduce((a, r) => a + r[k], 0); });
  $('secFlowTbl').innerHTML += `<tr><td><b>Total</b></td>${ks.map((k) => `<td class="r ${cls(tot[k])}"><b>${sgn(tot[k], 0)}</b></td>`).join('')}</tr>`;
  $('secFlowTbl').onclick = (e) => {
    const th = e.target.closest('th.sortable');
    if (th) { const k = th.dataset.k; ST.secSort = { k, dir: ST.secSort.k === k ? -ST.secSort.dir : k === 's' ? 1 : -1 }; renderSecFlows(); return; }
    const tr = e.target.closest('tr[data-sec]'); if (tr) showSecFlow(tr.dataset.sec);
  };
}
function showSecFlow(s) {
  const F = D.flows; const arr = F.sectors[s]; if (!arr) return;
  const n = 60; const lbl = F.daily.slice(-n).map((x) => dShort(x.d)); const v = arr.slice(-n);
  let c = 0; const cum = v.map((x) => (c += x));
  $('secFlowDetail').hidden = false;
  $('secFlowTitle').textContent = `${s} · daily foreign net, last ${n} sessions · cumulative ${rptn(c)}`;
  mkChart('secFlowChart', { data: { labels: lbl, datasets: [
    { type: 'line', data: cum, borderColor: C.saf, borderWidth: 1.5, pointRadius: 0, yAxisID: 'y2' },
    { type: 'bar', data: v, backgroundColor: v.map((x) => (x >= 0 ? C.up : C.down)), borderRadius: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => rpbn(x.parsed.y, 1) } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } }, y: { ticks: { callback: (x) => fmt(x, 0) } }, y2: { position: 'right', grid: { display: false }, ticks: { callback: (x) => fmt(x, 0) } } } } });
}
function renderTopFlows() {
  const t = D.flows.top[ST.topFlow]; if (!t) return;
  $('topFlowSub').textContent = `By stock · Rp bn · ${dShort(t.from)} – ${dShort(t.to)} · price change over the same window (unadjusted IDX closes)`;
  const head = '<tr><th>Stock</th><th>Sector</th><th class="r">Net</th><th class="r">Price</th></tr>';
  const row = (r) => `<tr class="click" data-c="${r.c}"><td><span class="nm">${esc(r.n)}</span><span class="tk-tag">${r.c}</span></td><td class="mute" style="font-size:11.5px">${esc(r.s)}</td><td class="r ${cls(r.f)}">${sgn(r.f, 1)}</td><td class="r ${cls(r.px)}">${pct(r.px, 1)}</td></tr>`;
  $('fBuyTbl').innerHTML = head + t.buy.map(row).join('');
  $('fSellTbl').innerHTML = head + t.sell.map(row).join('');
}

// ================================================================== SECTOR
function sectorList() { return Object.entries(D.quotes.q).filter(([, q]) => q.g === 'sector').map(([s, q]) => ({ s, n: q.n })); }
function renderSector() {
  const secs = sectorList();
  if (!ST.sector || !secs.find((x) => x.n === ST.sector)) ST.sector = secs[0].n;
  $('secChips').innerHTML = secs.map((x) => `<button class="chip ${x.n === ST.sector ? 'on' : ''}" data-n="${esc(x.n)}">${esc(x.n)}</button>`).join('');
  $('secChips').onclick = (e) => { const b = e.target.closest('.chip'); if (b) { ST.sector = b.dataset.n; renderSector(); } };
  const sym = secs.find((x) => x.n === ST.sector).s; const q = Q(sym);
  $('sdTitle').textContent = `${ST.sector} — vs JCI`;
  seg($('sdRange'), ['1M', '6M', 'YTD', '1Y', '3Y', '5Y'], ST.sdRange, (k) => { ST.sdRange = k; renderSector(); });
  const st = [['1D', q.r['1D']], ['1W', q.r['1W']], ['1M', q.r['1M']], ['YTD', q.r.YTD], ['1Y', q.r['1Y']], ['YTD vs JCI', q.r.YTD - Q('^JKSE').r.YTD]];
  $('sdStats').innerHTML = st.map(([l, v]) => `<div class="flow-kpi"><div class="lbl">${l}</div><div class="v ${cls(v)}">${l.includes('vs') ? (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), 1) + 'pp' : pct(v, 1)}</div></div>`).join('');
  const ds = [[sym, ST.sector, C.saf], ['^JKSE', 'JCI', C.dim]].map(([s, l, col]) => { const ser = seriesFor(s, ST.sdRange); if (!ser) return null; return { label: l, data: ser.t.map((t, i) => ({ x: t * 1000, y: (ser.c[i] / ser.c[0] - 1) * 100 })), borderColor: col, borderWidth: s === sym ? 2 : 1.3, borderDash: s === sym ? [] : [4, 3], pointRadius: 0, tension: 0.15 }; }).filter(Boolean);
  const o = baseLineOpts(ST.sdRange, (v) => v.toFixed(0) + '%'); o.plugins.legend = { display: true, labels: { boxWidth: 10, boxHeight: 2, color: C.dim } }; o.plugins.tooltip.callbacks.label = (c) => `${c.dataset.label}: ${pct(c.parsed.y)}`;
  mkChart('sdChart', { type: 'line', data: { datasets: ds }, options: o });

  // constituents
  const cons = D.stocks.rows.filter((r) => r.s === ST.sector).slice(0, 25);
  const ck = ST.consSort; const get = (r, k) => (k === 'n' ? r.n : ['1M', 'YTD'].includes(k) ? (r.r ? r.r[k] : null) : r[k]);
  cons.sort((a, b) => { const x = get(a, ck.k), y = get(b, ck.k); if (ck.k === 'n') return x.localeCompare(y) * ck.dir; return ((x ?? -1e9) - (y ?? -1e9)) * ck.dir; });
  const th = (k, l, r = true) => `<th class="${r ? 'r ' : ''}sortable" data-k="${k}">${l}${ck.k === k ? (ck.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  $('sdCons').innerHTML = `<tr>${th('n', 'Stock', false)}${th('mc', 'Mkt cap')}${th('p', 'Price')}${th('d1', '1D')}${th('1M', '1M')}${th('YTD', 'YTD')}${th('fn', 'Foreign')}</tr>` + cons.map((r) => `<tr class="click" data-c="${r.c}"><td><span class="nm">${esc(r.n)}</span><span class="tk-tag">${r.c}</span></td><td class="r">${r.mc >= 1000 ? 'Rp' + fmt(r.mc / 1000, 1) + 'tn' : 'Rp' + fmt(r.mc) + 'bn'}</td><td class="r">${fmtPx(r.p)}</td><td class="r ${cls(r.d1)}">${pct(r.d1, 1)}</td><td class="r ${cls(r.r && r.r['1M'])}">${pct(r.r && r.r['1M'], 1)}</td><td class="r ${cls(r.r && r.r.YTD)}">${pct(r.r && r.r.YTD, 1)}</td><td class="r ${cls(r.fn)}">${sgn(r.fn, 1)}</td></tr>`).join('');
  $('sdCons').querySelector('tr').onclick = (e) => { const t = e.target.closest('th.sortable'); if (!t) return; const k = t.dataset.k; ST.consSort = { k, dir: ST.consSort.k === k ? -ST.consSort.dir : k === 'n' ? 1 : -1 }; renderSector(); };

  // sector flows
  const arr = D.flows.sectors[ST.sector] || []; const n = 40; const v = arr.slice(-n); const lbl = D.flows.daily.slice(-n).map((x) => dShort(x.d));
  mkChart('sdFlowChart', { type: 'bar', data: { labels: lbl, datasets: [{ data: v, backgroundColor: v.map((x) => (x >= 0 ? C.up : C.down)), borderRadius: 2 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => rpbn(x.parsed.y, 1) } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } }, y: { position: 'right', ticks: { callback: (x) => fmt(x, 0) } } } } });
  const sums = secFlowSums().find((x) => x.s === ST.sector) || {};
  $('sdFlowNote').innerHTML = `1W <b class="${cls(sums['1W'])}">${rptn(sums['1W'] || 0)}</b> · 1M <b class="${cls(sums['1M'])}">${rptn(sums['1M'] || 0)}</b> · YTD <b class="${cls(sums.YTD)}">${rptn(sums.YTD || 0)}</b>`;

  // notes
  const notes = (D.research ? D.research.notes : []).filter((nn) => noteSector(nn) === ST.sector);
  const bull = notes.filter((x) => BULL.has(x.rating)).length, bear = notes.filter((x) => BEAR.has(x.rating)).length;
  $('sdTilt').innerHTML = notes.length ? `${notes.length} notes · <span class="up">${bull} positive</span> / <span class="down">${bear} negative</span> ratings` : 'no notes yet';
  $('sdNotes').innerHTML = notes.length ? notes.slice(0, 30).map(noteRow).join('') : '<div class="empty">No broker notes in the archive for this sector yet.</div>';
}

// ================================================================== WATCHLIST
const DEFAULT_WATCH = ['BBCA', 'BBRI', 'BMRI', 'TLKM', 'ASII', 'AMMN', 'GOTO'];
function wlGet() { return { hold: LS.get('idrp.hold', []), watch: LS.get('idrp.watch', DEFAULT_WATCH) }; }
function jciSinceDate(d) {
  const s = D.series['^JKSE']; const src = daysAgo(d) > 360 ? s.y10 : s.y1; const t0 = new Date(d + 'T16:00:00+07:00').getTime() / 1000;
  let b = null; src.t.forEach((t, i) => { if (t <= t0) b = src.c[i]; }); if (b == null) b = src.c[0];
  return (Q('^JKSE').p / b - 1) * 100;
}
function renderWatchlist() {
  const W = wlGet();
  // holdings
  const H = W.hold.map((h) => { const s = STK[h.c] || {}; const px = s.yp || s.p; return { ...h, s, px, mv: px && h.q ? px * h.q : null }; });
  const tot = H.reduce((a, h) => a + (h.mv || 0), 0);
  $('wlSub').textContent = `${H.length} holdings · market value Rp${fmt(tot / 1e6, 1)}m · saved in this browser only · prices as of ${D.stocks ? dShort(D.stocks.asof) : '—'}`;
  $('wlHold').innerHTML = `<tr><th>Stock</th><th class="r">Qty</th><th class="r">Weight</th><th class="r">Entry Rp</th><th class="r">Entry date</th><th class="r">Return</th><th class="r">vs JCI</th><th class="r">LTP</th><th class="r">1D</th><th class="r">1M</th><th class="r">YTD</th><th></th></tr>` +
    (H.length ? H.map((h, i) => { const ret = h.px && h.e ? (h.px / h.e - 1) * 100 : null; const jr = h.dt ? jciSinceDate(h.dt) : null; const r = h.s.r || {};
      return `<tr><td class="click" data-c="${h.c}" style="cursor:pointer"><span class="nm">${esc(nameOf(h.c))}</span><span class="tk-tag">${h.c}</span></td><td class="r">${fmt(h.q)}</td><td class="r">${tot && h.mv ? fmt((h.mv / tot) * 100, 1) + '%' : '—'}</td><td class="r">${h.e ? fmt(h.e) : '—'}</td><td class="r">${h.dt ? dShort(h.dt) + " '" + h.dt.slice(2, 4) : '—'}</td><td class="r ${cls(ret)}">${pct(ret, 1)}</td><td class="r ${cls(ret != null && jr != null ? ret - jr : null)}">${ret != null && jr != null ? sgn(ret - jr, 1) + 'pp' : '—'}</td><td class="r">${fmtPx(h.px)}</td><td class="r ${cls(h.s.d1)}">${pct(h.s.d1, 1)}</td><td class="r ${cls(r['1M'])}">${pct(r['1M'], 1)}</td><td class="r ${cls(r.YTD)}">${pct(r.YTD, 1)}</td><td><button class="x-btn" data-del-hold="${i}" title="Remove">×</button></td></tr>`; }).join('')
      : '<tr><td colspan="12" class="empty">No holdings yet. Add one above.</td></tr>');
  // watch
  const lastNote = (c) => (D.research ? D.research.notes.find((n) => n.tk === c) : null);
  $('wlWatch').innerHTML = `<tr><th>Stock</th><th>Sector</th><th class="r">LTP</th><th class="r">1D</th><th class="r">1W</th><th class="r">1M</th><th class="r">YTD</th><th class="r">1Y</th><th class="r">vs 52WH</th><th class="r">Foreign 1D</th><th>Latest note</th><th></th></tr>` +
    W.watch.map((c, i) => { const s = STK[c] || {}; const r = s.r || {}; const n = lastNote(c); const px = s.yp || s.p;
      return `<tr><td class="click" data-c="${c}" style="cursor:pointer"><span class="nm">${esc(nameOf(c))}</span><span class="tk-tag">${c}</span></td><td class="mute" style="font-size:11.5px">${esc(sectorOf(c) || '—')}</td><td class="r">${fmtPx(px)}</td><td class="r ${cls(s.d1)}">${pct(s.d1, 1)}</td><td class="r ${cls(r['1W'])}">${pct(r['1W'], 1)}</td><td class="r ${cls(r['1M'])}">${pct(r['1M'], 1)}</td><td class="r ${cls(r.YTD)}">${pct(r.YTD, 1)}</td><td class="r ${cls(r['1Y'])}">${pct(r['1Y'], 1)}</td><td class="r">${s.h52 && px ? pct((px / s.h52 - 1) * 100, 1) : '—'}</td><td class="r ${cls(s.fn)}">${sgn(s.fn, 1)}</td><td style="font-size:12px">${n ? `${dShort(n.d)} · ${esc(n.h)} ${ratingPill(n.rating)}${n.tp ? ' <span class="mono">Rp' + fmt(n.tp) + '</span>' : ''}` : '<span class="mute">—</span>'}</td><td><button class="x-btn" data-del-watch="${i}" title="Remove">×</button></td></tr>`; }).join('');
  // notes
  const names = new Set([...W.watch, ...W.hold.map((h) => h.c)]);
  const notes = (D.research ? D.research.notes : []).filter((n) => n.tk && names.has(n.tk) && daysAgo(n.d) <= 30);
  $('wlRnSub').textContent = `Notes on watchlist and holdings names · last 30 days · ${notes.length} reports`;
  $('wlNotes').innerHTML = notes.length ? notes.map(noteRow).join('') : '<div class="empty">No recent notes on your names.</div>';
}
function wlBind() {
  $('wlAddHold').onclick = () => {
    const c = $('wlCode').value.trim().toUpperCase(); if (!/^[A-Z]{4}$/.test(c)) { $('wlCode').focus(); return; }
    const W = wlGet(); W.hold.push({ c, q: +$('wlQty').value.replace(/,/g, '') || 0, e: +$('wlPx').value.replace(/,/g, '') || (STK[c] ? STK[c].p : null), dt: $('wlDt').value || null });
    LS.set('idrp.hold', W.hold); ['wlCode', 'wlQty', 'wlPx', 'wlDt'].forEach((id) => { $(id).value = ''; }); renderWatchlist();
  };
  $('wlAddWatch').onclick = () => {
    const c = $('wlWCode').value.trim().toUpperCase(); if (!/^[A-Z]{4}$/.test(c)) return;
    const W = wlGet(); if (!W.watch.includes(c)) W.watch.push(c); LS.set('idrp.watch', W.watch); $('wlWCode').value = ''; renderWatchlist();
  };
  $('view-watchlist').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del-hold],[data-del-watch]'); if (!b) return;
    const W = wlGet();
    if (b.dataset.delHold != null) { W.hold.splice(+b.dataset.delHold, 1); LS.set('idrp.hold', W.hold); }
    else { W.watch.splice(+b.dataset.delWatch, 1); LS.set('idrp.watch', W.watch); }
    renderWatchlist();
  });
}

// ================================================================== search + quick look
function bindSearch() {
  const inp = $('searchIn'), res = $('searchRes');
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase(); if (q.length < 2) { res.hidden = true; return; }
    const hits = D.stocks.rows.filter((r) => r.c.toLowerCase().startsWith(q) || r.n.toLowerCase().includes(q)).slice(0, 12);
    res.innerHTML = hits.map((r) => `<div data-c="${r.c}"><b>${r.c}</b>${esc(r.n)}</div>`).join('') || '<div>No match</div>';
    res.hidden = false;
  });
  res.addEventListener('mousedown', (e) => { const d = e.target.closest('[data-c]'); if (d) { e.preventDefault(); res.hidden = true; inp.value = ''; addToWatch(d.dataset.c); } });
  inp.addEventListener('blur', () => setTimeout(() => { res.hidden = true; }, 150));
}
function addToWatch(c) {
  const W = wlGet(); if (!W.watch.includes(c)) { W.watch.unshift(c); LS.set('idrp.watch', W.watch); }
  go('watchlist');
}

// ================================================================== nav
const RENDER = { overview: renderOverview, news: renderNews, research: renderResearch, strategy: renderStrategy, flows: renderFlows, sector: renderSector, watchlist: renderWatchlist };
const rendered = new Set();
function go(view, push = true) {
  if (!RENDER[view]) view = 'overview';
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== 'view-' + view; });
  const nav = document.querySelector(`.nav-item[data-view="${view}"]`);
  $('pageTitle').textContent = nav.dataset.title;
  try { RENDER[view](); } catch (e) { console.error(e); }
  rendered.add(view);
  if (push) history.replaceState(null, '', '#' + view);
  window.scrollTo({ top: 0 });
}
document.addEventListener('click', (e) => {
  const n = e.target.closest('.nav-item'); if (n) { go(n.dataset.view); return; }
  const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); go(g.dataset.go); }
});

function session() {
  const w = wibNow(); const day = w.getUTCDay(); const mins = w.getUTCHours() * 60 + w.getUTCMinutes();
  const fri = day === 5;
  const wk = day >= 1 && day <= 5;
  const open = wk && ((mins >= 540 && mins < (fri ? 690 : 720)) || (mins >= (fri ? 840 : 810) && mins < 960));
  const lunch = wk && mins >= (fri ? 690 : 720) && mins < (fri ? 840 : 810);
  const upd = D.quotes ? new Date(D.quotes.updated) : null;
  $('session').classList.toggle('closed', !open);
  $('sessionTxt').textContent = `${open ? 'IDX open' : lunch ? 'IDX lunch break' : 'IDX closed'} · data ${upd ? upd.toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' WIB' : '—'}`;
  $('clock').textContent = 'WIB ' + new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta' });
  $('pageSub').textContent = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' · IDX / Jakarta';
}

// ================================================================== boot
(async function boot() {
  const files = { quotes: 'quotes.json', series: 'series.json', stocks: 'stocks.json', flows: 'flows.json', market: 'market.json', news: 'news.json', research: 'research.json', strategy: 'strategy.json', stratPerf: 'strategy_perf.json', companies: 'companies.json' };
  const vals = await Promise.all(Object.values(files).map(getJSON));
  Object.keys(files).forEach((k, i) => { D[k] = vals[i]; });
  // Yahoo prices are refreshed intraday and IDX closes only after the session, so prefer Yahoo where we have it
  if (D.stocks) D.stocks.rows.forEach((r) => { if (r.yp) r.p = r.yp; if (r.r && r.r['1D'] != null) r.d1 = r.r['1D']; STK[r.c] = r; });
  session(); setInterval(session, 1000);
  renderTicker(); bindSearch(); wlBind();
  $('rnWindow').onchange = renderResearch; $('rnKind').onchange = renderResearch;
  go((location.hash || '#overview').slice(1), false);
  window.addEventListener('hashchange', () => go(location.hash.slice(1), false));
})();
