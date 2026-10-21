/* Ag in 60 scenes. Every frame is a pure function of the clock: seek(t) draws
 * the scene on screen at t seconds, so a render is the same every time and a
 * frame can be grabbed at any point (scripts/ag60/render.mjs).
 * Plan: /out/plan.json (scripts/ag60/build_plan.py, timed by voice.py). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const easeIO = (x) => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const back = (x) => { x = clamp(x); const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lerp = (a, b, x) => a + (b - a) * x;
  let PLAN = null, GEO = null, PATHS = null;

  // entrance: slide and fade, staggered by i
  const enter = (p, i = 0, dist = 60, dur = .35) => {
    const x = ease((p - i * .07) / dur);
    return `opacity:${x.toFixed(3)};transform:translateY(${((1 - x) * dist).toFixed(1)}px)`;
  };
  const words = (text, p, start = 0, per = .06) => esc(text).split(' ').map((w, i) => {
    const x = ease((p - start - i * per) / .25);
    return `<span style="display:inline-block;opacity:${x.toFixed(3)};transform:translateY(${((1 - x) * 40).toFixed(1)}px)">${w}&nbsp;</span>`;
  }).join('');

  // ---- price ticking: roll from the prior price to today's ----
  const FR = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
  function parsePrice(s) {
    const m = /\$([\d,]+)\.(\d\d)([¼½¾])?/.exec(s || '');
    if (!m) return null;
    return +m[1].replace(/,/g, '') + (+m[2]) / 100 + ({ '¼': .0025, '½': .005, '¾': .0075 }[m[3]] || 0);
  }
  function showPrice(v) {
    const q = Math.round(v * 400) / 4; const c = Math.floor(q + 1e-9); const f = Math.round((q - c) * 100) / 100;
    return `$${Math.floor(c / 100).toLocaleString('en-US')}.${String(c % 100).padStart(2, '0')}${FR[f] || ''}`;
  }

  const S = {};

  S.hook = (s, p, d) => {
    const x = ease(p / .45);
    const sc = lerp(1.5, 1, back(p / .5));
    const m = /^([^\d]*)([\d.,]+)(.*)$/.exec(s.value);
    let val = esc(s.value);
    if (m && p < .7) {          // count up to the number
      const n = parseFloat(m[2].replace(/,/g, ''));
      const k = ease(p / .7);
      const dec = (m[2].split('.')[1] || '').length;
      val = esc(m[1] + (n * k).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + m[3]);
    }
    const sz = s.value.length > 9 ? 200 : 290;
    return `<div style="position:absolute;top:120px;left:0;right:0">
      <div class="kicker" style="${enter(p, 0)}">${esc(s.kicker || "Today's number")}</div>
      <div class="big" style="font-size:${sz}px;margin-top:30px;opacity:${x};transform:scale(${sc.toFixed(3)});transform-origin:left center;filter:blur(${((1 - x) * 12).toFixed(1)}px)">${val}</div>
      <div class="h1" style="font-size:86px;margin-top:40px;${enter(p, 4)}">${esc(s.unit)}</div>
      <div class="h2" style="margin-top:44px;color:var(--muted);${enter(p, 8)}">${esc(s.why)}</div></div>`;
  };

  S.tile = (s, p, d) => {
    const to = parsePrice(s.price), from = parsePrice(s.prev);
    const k = easeIO((p - .15) / .75);
    const rolling = to != null && from != null && p < .9;   // the roll from the prior close is motion, not a quote: drawn dim
    const shown = rolling ? showPrice(lerp(from, to, k)) : s.price;
    const up = s.dir === 'up', dn = s.dir === 'down';
    const col = up ? 'var(--green)' : dn ? 'var(--red)' : 'var(--muted)';
    const arrow = up ? '▲' : dn ? '▼' : '■';
    const slide = 1 - ease(p / .3);
    const pct = (s.pct > 0 ? '+' : '') + Number(s.pct).toFixed(2) + '%';
    return `<div style="position:absolute;inset:60px 0 0 0;transform:translateX(${(slide * 900).toFixed(1)}px)">
      <div class="card" style="padding:70px 60px 76px;border-color:${col};box-shadow:0 0 0 2px rgba(0,0,0,.2), 0 40px 120px -40px ${col}">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <div class="h1" style="font-size:120px">${esc(s.name)}</div>
          <div class="mono" style="font-size:34px;color:var(--muted)">${esc(s.contract)}</div></div>
        <div class="mono" style="font-weight:800;font-size:${Math.min(236, Math.floor(860 / (s.price.length * .6)))}px;line-height:1.05;margin-top:60px;color:var(--cream);opacity:${rolling ? .45 : 1};letter-spacing:-.04em">${esc(shown)}</div>
        <div style="display:flex;gap:28px;align-items:center;margin-top:40px;${enter(p, 6)}">
          <div class="mono" style="font-weight:800;font-size:110px;color:${col}">${arrow} ${esc(s.change)}</div>
          <div class="mono" style="font-size:60px;color:${col};opacity:.85">${esc(pct)}</div></div>
        <div class="mono" style="font-size:40px;color:var(--muted);margin-top:50px;${enter(p, 9)}">${s.prev ? 'Prior close ' + esc(s.prev) : ''}</div>
      </div></div>`;
  };

  S.bars = (s, p) => {
    const max = Math.max(...s.rows.map((r) => Math.abs(r.pct)), .1);
    const rows = s.rows.map((r, i) => {
      const w = ease((p - .1 - i * .06) / .4) * Math.abs(r.pct) / max * 380;
      const col = r.pct >= 0 ? 'var(--green)' : 'var(--red)';
      const lead = r.name === s.lead;
      return `<div style="display:flex;align-items:center;height:118px;${enter(p, i)}">
        <div style="width:330px;font:${lead ? 800 : 600} 46px Inter;color:${lead ? 'var(--gold)' : 'var(--text)'}">${esc(r.name)}</div>
        <div style="position:relative;width:440px;height:64px">
          <div style="position:absolute;left:${r.pct >= 0 ? 0 : 380 - w}px;width:${w.toFixed(1)}px;top:0;bottom:0;background:${col};border-radius:8px;opacity:${lead ? 1 : .7}"></div></div>
        <div class="mono" style="font-weight:700;font-size:44px;color:${col};width:200px;text-align:right">${r.pct > 0 ? '+' : ''}${Number(r.pct).toFixed(2)}%</div></div>`;
    }).join('');
    return `<div style="position:absolute;top:90px;left:0;right:0"><div class="kicker" style="${enter(p, 0)}">${esc(s.title)}</div><div style="margin-top:50px">${rows}</div></div>`;
  };

  S.headline = (s, p) => `<div style="position:absolute;top:170px;left:0;right:0">
      <div class="kicker" style="${enter(p, 0)}">${esc(s.kicker)}</div>
      <div class="h1" style="margin-top:50px;font-size:${s.text.length > 90 ? 100 : s.text.length > 60 ? 116 : 136}px">${words(s.text, p, .1, .045)}</div>
      ${s.sub ? `<div class="h2" style="margin-top:44px;color:var(--gold);${enter(p, 10)}">${esc(s.sub)}</div>` : ''}</div>`;

  const fmt = (x) => new Date(x + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  S.chart = (s, p) => {
    const W = 960, H = 370;
    const panel = (key, label, color, y0) => {
      const v = s.series[key]; if (!v) return '';
      const lo = Math.min(...v), hi = Math.max(...v), pad = (hi - lo) * .15 || .01;
      const X = (i) => 20 + i * (W - 220) / (v.length - 1);
      const Y = (x) => y0 + 40 + (H - 120) * (1 - (x - lo + pad) / (hi - lo + 2 * pad));
      const k = easeIO((p - .1) / .7);
      const n = Math.max(1, Math.floor(k * (v.length - 1)));
      const pts = v.slice(0, n + 1).map((x, i) => `${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join(' ');
      const last = v[n];
      const ch = v[v.length - 1] - v[0];
      return `<text x="20" y="${y0 + 20}" fill="${color}" font-size="44" font-weight="800">${label}</text>
        <text x="${W - 10}" y="${y0 + 20}" fill="${ch < 0 ? '#e0685f' : '#5fc28a'}" font-size="38" font-weight="700" text-anchor="end" font-family="JetBrains Mono">${ch < 0 ? '' : '+'}${(ch * 100).toFixed(1)}¢ since ${fmt(s.dates[0])}</text>
        <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${X(n)}" cy="${Y(last)}" r="16" fill="${color}"/>
        <text x="${X(n) + 30}" y="${Y(last) + 14}" fill="#F4EFE1" font-size="44" font-weight="800" font-family="JetBrains Mono">${showPrice(last)}</text>`;
    };
    const d0 = s.dates[0], d1 = s.dates[s.dates.length - 1];
    return `<div style="position:absolute;top:60px;left:0;right:0"><div class="kicker" style="${enter(p, 0)}">${esc(s.title)}</div>
      <svg width="${W}" height="${2 * H + 90}" style="margin-top:30px">
        ${panel('corn', 'Corn', '#d4a23f', 20)}${panel('soybeans', 'Soybeans', '#6f9fc2', H + 40)}
        <text x="20" y="${2 * H + 80}" fill="rgba(233,237,235,.7)" font-size="32" font-family="JetBrains Mono">${fmt(d0)}</text>
        <text x="${W - 220}" y="${2 * H + 80}" fill="rgba(233,237,235,.7)" font-size="32" font-family="JetBrains Mono" text-anchor="end">${fmt(d1)}</text>
      </svg></div>`;
  };

  S.counter = (s, p) => {
    const big = +String(s.big).replace(/,/g, ''), of = +String(s.of).replace(/,/g, '');
    const k = easeIO(p / .8);
    const n = Math.round(big * k);
    const cols = 60, cell = 16, rows = Math.ceil(of / cols);
    let dots = '';
    for (let i = 0; i < of; i++) {
      const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
      const on = i < n;
      dots += `<rect x="${x}" y="${y}" width="${cell - 4}" height="${cell - 4}" rx="3" fill="${on ? '#e0685f' : 'rgba(233,237,235,.14)'}"/>`;
    }
    return `<div style="position:absolute;top:30px;left:0;right:0">
      <div class="kicker" style="${enter(p, 0)}">Cash bids, AGSIST elevators</div>
      <div style="display:flex;align-items:baseline;gap:24px;margin-top:20px">
        <div class="mono" style="font-weight:800;font-size:170px;color:var(--red);letter-spacing:-.04em">${n.toLocaleString('en-US')}</div>
        <div class="mono" style="font-size:60px;color:var(--muted)">of ${esc(s.of)}</div></div>
      <div class="h2" style="font-size:52px;${enter(p, 3)}">${esc(s.line)}</div>
      <svg width="${cols * cell}" height="${rows * cell}" style="margin-top:36px">${dots}</svg>
      <div class="h2" style="margin-top:28px;color:var(--gold);font-weight:800;${enter(p, 8)}">${esc(s.sub)}</div></div>`;
  };

  // ---- map: Albers equal-area, lower 48 ----
  function project(lon, lat) {
    const r = Math.PI / 180, p1 = 29.5 * r, p2 = 45.5 * r, l0 = -96 * r, f0 = 37.5 * r;
    const n = (Math.sin(p1) + Math.sin(p2)) / 2, C = Math.cos(p1) ** 2 + 2 * n * Math.sin(p1);
    const rho = (f) => Math.sqrt(C - 2 * n * Math.sin(f)) / n;
    const t = n * (lon * r - l0);
    return [rho(lat * r) * Math.sin(t), rho(f0) - rho(lat * r) * Math.cos(t)];
  }
  function buildPaths() {
    if (PATHS || !GEO) return PATHS;
    const W = 960, H = 640;
    const feats = GEO.features.filter((f) => f.properties.iso_a2 === 'US' && !['AK', 'HI'].includes(f.properties.postal));
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    const rings = feats.map((f) => {
      const g = f.geometry; const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      return { st: f.properties.postal, polys: polys.map((pl) => pl.map((ring) => ring.map(([lo, la]) => { const q = project(lo, la); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); return q; }))) };
    });
    const sc = Math.min(W / (x1 - x0), H / (y1 - y0));
    const P = (q) => [(q[0] - x0) * sc, (y1 - q[1]) * sc];
    PATHS = { W, H, sc, x0, y1, states: {} };
    for (const r of rings) {
      let d = '', cx = 0, cy = 0, cn = 0, best = 0;
      for (const pl of r.polys) for (const [ri, ring] of pl.entries()) {
        d += ring.map((q, i) => { const [x, y] = P(q); return (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1); }).join('') + 'Z';
        if (ri === 0 && ring.length > best) { best = ring.length; cx = 0; cy = 0; cn = 0; for (const q of ring) { const [x, y] = P(q); cx += x; cy += y; cn++; } }
      }
      PATHS.states[r.st] = { d, cx: cx / cn, cy: cy / cn };
    }
    PATHS.proj = (lon, lat) => P(project(lon, lat));
    return PATHS;
  }
  const NUDGE = { MI: [25, 45], FL: [30, 0], LA: [-15, 0], KY: [10, 5], MN: [-10, 20], ND: [0, 0], TX: [10, 10], IL: [0, 10], IN: [0, 6], OH: [0, 6] };

  S.map = (s, p) => {
    const g = buildPaths(); if (!g) return '';
    const by = {}; for (const r of s.rows) by[r.st] = r;
    const colorFor = (m) => {   // under = deeper red, over = green; +-0.9 full
      const x = clamp(Math.abs(m) / .9);
      return m < 0 ? `rgba(224,104,95,${(.25 + .75 * x).toFixed(2)})` : `rgba(95,194,138,${(.3 + .7 * x).toFixed(2)})`;
    };
    let shapes = '', labels = '';
    const order = Object.keys(g.states);
    order.forEach((st, i) => {
      const r = by[st]; const k = ease((p - .05 - (r ? 0 : .2)) / .35);
      const fill = r ? colorFor(r.median) : 'rgba(233,237,235,.06)';
      shapes += `<path d="${g.states[st].d}" fill="${fill}" stroke="#0a0c0d" stroke-width="2" opacity="${k.toFixed(2)}"/>`;
      if (r && r.n >= (s.min_n || 15)) {
        const kk = ease((p - .25 - i * .004) / .3);
        const [nx, ny] = NUDGE[st] || [0, 0];
        const c = Math.round(Math.abs(r.median) * 100);
        const hl = st === s.hi || st === s.lo;
        labels += `<g opacity="${kk.toFixed(2)}" transform="translate(${(g.states[st].cx + nx).toFixed(1)},${(g.states[st].cy + ny).toFixed(1)}) scale(${(hl ? lerp(1.6, 1.25, ease((p - .5) / .3)) : 1).toFixed(2)})">
          <text text-anchor="middle" y="10" font-size="${hl ? 30 : 24}" font-weight="800" font-family="JetBrains Mono" fill="#fff" stroke="#000" stroke-width="5" paint-order="stroke">${r.median < 0 ? '-' : '+'}${c}</text></g>`;
      }
    });
    return `<div style="position:absolute;top:30px;left:0;right:0">
      <div class="kicker" style="${enter(p, 0)}">${esc(s.title)}</div>
      <div class="h2" style="font-size:44px;margin-top:10px;color:var(--muted);${enter(p, 2)}">Cents over (+) or under (-) futures</div>
      <svg width="${g.W}" height="${g.H}" style="margin-top:60px;transform:scale(${lerp(1.08, 1, ease(p / .8)).toFixed(3)});transform-origin:50% 40%">${shapes}${labels}</svg>
      <div style="display:flex;gap:30px;margin-top:20px;font:600 32px 'JetBrains Mono';${enter(p, 6)}">
        <span style="color:var(--red)">■ under</span><span style="color:var(--green)">■ over</span><span style="color:var(--muted)">labels: ${s.min_n || 15}+ elevators</span></div></div>`;
  };

  S.hail = (s, p) => {
    const g = buildPaths(); if (!g) return '';
    let shapes = '';
    for (const st in g.states) shapes += `<path d="${g.states[st].d}" fill="rgba(233,237,235,.07)" stroke="#2a3133" stroke-width="2"/>`;
    const pts = s.points.map((q, i) => {
      const [x, y] = g.proj(q.lon, q.lat); const k = back((p - .1 - i * .015) / .25);
      const r = (8 + q.mag * 9) * clamp(k, 0, 1.3);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${q.mag >= 1 ? '#e0685f' : '#d4a23f'}" fill-opacity=".8" stroke="#fff" stroke-width="2"/>`;
    }).join('');
    return `<div style="position:absolute;top:30px;left:0;right:0"><div class="kicker" style="${enter(p, 0)}">${esc(s.title)}</div>
      <svg width="${g.W}" height="${g.H}" style="margin-top:80px">${shapes}${pts}</svg>
      <div style="display:flex;gap:30px;margin-top:20px;font:600 32px 'JetBrains Mono';${enter(p, 6)}"><span style="color:var(--red)">● 1 inch or more</span><span style="color:var(--gold)">● smaller</span></div></div>`;
  };

  S.progress = (s, p) => {
    const rows = s.rows.map((r, i) => {
      const k = easeIO((p - .1 - i * .15) / .6);
      const w = 900;
      const behind = r.pct < r.avg5 - 2;
      return `<div style="margin-top:${i ? 70 : 50}px;${enter(p, i * 2)}">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <div class="h1" style="font-size:84px">${esc(r.name)}</div>
          <div class="mono" style="font-weight:800;font-size:110px;color:${behind ? 'var(--red)' : 'var(--cream)'}">${Math.round(r.pct * k)}%</div></div>
        <div style="position:relative;height:90px;margin-top:16px;background:rgba(233,237,235,.08);border-radius:14px">
          <div style="position:absolute;left:0;top:0;bottom:0;width:${(w * r.pct / 100 * k).toFixed(1)}px;background:linear-gradient(90deg,#b8862c,#d4a23f);border-radius:14px"></div>
          <div style="position:absolute;left:${(w * r.avg5 / 100).toFixed(1)}px;top:-18px;bottom:-18px;width:6px;background:#fff;opacity:${ease((p - .5) / .2)}"></div>
          <div class="mono" style="position:absolute;left:${(w * r.avg5 / 100 - 120).toFixed(1)}px;top:104px;font-size:32px;color:#fff;opacity:${ease((p - .5) / .2)}">5-yr avg ${r.avg5}%</div></div></div>`;
    }).join('');
    return `<div style="position:absolute;top:50px;left:0;right:0"><div class="kicker" style="${enter(p, 0)}">${esc(s.title)}</div>${rows}</div>`;
  };

  S.calendar = (s, p) => `<div style="position:absolute;top:80px;left:0;right:0"><div class="kicker" style="${enter(p, 0)}">On the calendar</div>
      ${s.items.map((it, i) => `<div class="card" style="margin-top:36px;padding:40px 44px;${enter(p, 2 + i * 3, 80)}">
        <div class="mono" style="font-size:40px;font-weight:700;color:var(--gold)">${esc(it.when)}</div>
        <div class="h2" style="margin-top:14px;font-weight:700;font-size:54px;color:var(--cream)">${esc(it.what)}</div>
        ${it.note ? `<div class="mono" style="margin-top:16px;font-size:40px;font-weight:800;color:var(--red)">${esc(it.note)}</div>` : ''}
        ${it.note2 ? `<div class="mono" style="margin-top:16px;font-size:34px;color:var(--muted)">${esc(it.note2)}</div>` : ''}</div>`).join('')}</div>`;

  S.clock = (s, p) => {
    const h = parsePrice(s.harvest), pr = parsePrice(s.projected);
    const k = easeIO((p - .1) / .7);
    return `<div style="position:absolute;top:80px;left:0;right:0"><div class="kicker" style="${enter(p, 0)}">Crop insurance harvest price, ${esc(s.crop)} ${esc(s.contract)}</div>
      <div style="display:flex;gap:40px;margin-top:60px">
        <div class="card" style="flex:1;padding:40px;${enter(p, 2)}"><div class="mono" style="font-size:34px;color:var(--muted)">Projected</div><div class="mono" style="font-size:110px;font-weight:800">${esc(s.projected)}</div></div>
        <div class="card" style="flex:1;padding:40px;border-color:var(--gold);${enter(p, 4)}"><div class="mono" style="font-size:34px;color:var(--gold)">So far</div><div class="mono" style="font-size:110px;font-weight:800;color:var(--gold)">${showPrice(lerp(pr, h, k))}</div></div></div>
      <div style="margin-top:60px;height:40px;background:rgba(233,237,235,.08);border-radius:20px;position:relative">
        <div style="position:absolute;left:0;top:0;bottom:0;border-radius:20px;background:var(--gold);width:${(960 * (s.days_done || 0) / (s.days_total || 1) * k).toFixed(1)}px"></div></div>
      <div class="mono" style="font-size:38px;margin-top:20px;color:var(--muted)">${s.days_done} of ${s.days_total} trading days averaged</div></div>`;
  };

  S.watch = (s, p) => `<div style="position:absolute;top:160px;left:0;right:0">
      <div class="kicker" style="font-size:56px;${enter(p, 0)}">One thing to watch</div>
      <div class="h1" style="margin-top:60px;font-size:${s.text.length > 80 ? 112 : 130}px;color:var(--cream)">${words(s.text, p, .15, .05)}</div></div>`;

  S.slam = (s, p) => {
    const x = ease(p / .3), sc = lerp(1.6, 1, back(p / .4));
    const col = s.side === 'above' ? 'var(--green)' : s.side === 'below' ? 'var(--red)' : 'var(--gold)';
    return `<div style="position:absolute;top:150px;left:0;right:0">
      <div class="kicker" style="${enter(p, 0)}">${esc(s.label)}</div>
      <div class="mono" style="font-weight:800;font-size:${Math.min(260, Math.floor(900 / (String(s.value).length * .6)))}px;margin-top:40px;color:var(--cream);opacity:${x};transform:scale(${sc.toFixed(3)});transform-origin:left center">${esc(s.value)}</div>
      <div class="h2" style="margin-top:10px;${enter(p, 3)}">${esc(s.unit)}</div>
      <div class="mono" style="margin-top:60px;font-size:72px;font-weight:800;color:${col};${enter(p, 5)}">${esc(s.side)} trade</div>
      <div class="mono" style="margin-top:10px;font-size:52px;color:var(--muted);${enter(p, 6)}">${esc(s.vs)}</div></div>`;
  };

  S.report = (s, p) => {
    const vals = [...(s.range || []), s.consensus, s.actual, ...(s.prior != null ? [s.prior] : [])];
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * .12 || 1; const X = (v) => 30 + 900 * (v - lo + pad) / (hi - lo + 2 * pad);
    const k = ease((p - .25) / .5);
    const f = (v) => Math.abs(v) >= 1000 ? v.toLocaleString('en-US') : String(v);
    const row = (label, v, col, i, big) => `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:${i ? 26 : 50}px;${enter(p, 2 + i * 2)}">
        <div class="h2" style="font-size:${big ? 56 : 46}px;color:${col}">${label}</div><div class="mono" style="font-weight:800;font-size:${big ? 120 : 80}px;color:${col}">${f(v)}</div></div>`;
    return `<div style="position:absolute;top:60px;left:0;right:0"><div class="kicker" style="${enter(p, 0)}">USDA vs the trade, ${esc(({ 'bil bu': 'billion bushels', 'B bu': 'billion bushels', 'mil bu': 'million bushels', 'bu/acre': 'bushels an acre' })[s.unit] || s.unit)}</div>
      <div class="h1" style="margin-top:24px;font-size:92px">${esc(s.label)}</div>
      ${row('USDA', s.actual, 'var(--gold)', 0, true)}${row('Trade average', s.consensus, 'var(--cream)', 1)}
      ${s.prior != null ? row('USDA last month', s.prior, 'var(--muted)', 2) : ''}
      <svg width="960" height="220" style="margin-top:40px">
        ${s.range ? `<rect x="${X(s.range[0])}" y="80" width="${X(s.range[1]) - X(s.range[0])}" height="56" rx="28" fill="rgba(233,237,235,.16)"/>
          <text x="${X(s.range[0])}" y="190" fill="rgba(233,237,235,.7)" font-size="30" font-family="JetBrains Mono">${f(s.range[0])}</text>
          <text x="${X(s.range[1])}" y="190" fill="rgba(233,237,235,.7)" font-size="30" font-family="JetBrains Mono" text-anchor="end">${f(s.range[1])}</text>
          <text x="${(X(s.range[0]) + X(s.range[1])) / 2}" y="40" fill="rgba(233,237,235,.7)" font-size="30" font-family="JetBrains Mono" text-anchor="middle">trade range</text>` : ''}
        <line x1="${X(s.consensus)}" x2="${X(s.consensus)}" y1="62" y2="154" stroke="#fff" stroke-width="7"/>
        <circle cx="${lerp(X(s.consensus), X(s.actual), k)}" cy="108" r="38" fill="#d4a23f" stroke="#0a0c0d" stroke-width="6"/>
      </svg></div>`;
  };

  S.rainprint = (s, p) => {
    // the Rain Print idea in one beat: this year's rain piling up, against the usual year
    const W = 880, H = 520, cum = s.cum;
    const maxV = Math.max(...cum.map((c) => Math.max(c[1], c[2]))) * 1.08;
    const X = (dd) => 40 + (W - 80) * (dd / 366), Y = (v) => H - 60 - (H - 120) * v / maxV;
    const k = easeIO((p - .05) / .75);
    const n = Math.max(1, Math.floor(k * (cum.length - 1)));
    let stair = `M${X(0)},${Y(0)}`; for (const c of cum.slice(0, n + 1)) stair += `H${X(c[0]).toFixed(1)}V${Y(c[1]).toFixed(1)}`;
    const norm = cum.map((c, i) => `${i ? 'L' : 'M'}${X(c[0]).toFixed(1)},${Y(c[2]).toFixed(1)}`).join('');
    const last = cum[n];
    return `<div style="position:absolute;top:40px;left:0;right:0;${enter(p, 0, 80)}">
      <div class="card" style="background:var(--stone);border:none;padding:50px 40px 40px;color:var(--ink)">
        <div style="font:400 italic 40px Fraunces;color:#6b645a">Rain Print</div>
        <div style="font:700 92px/1 Fraunces;margin-top:8px">${esc(s.year)}</div>
        <div style="font:600 40px Inter;margin-top:12px">${esc(s.place)}</div>
        <svg width="${W}" height="${H}" style="margin-top:20px">
          <path d="${norm}" fill="none" stroke="#9b9386" stroke-width="4" stroke-dasharray="10 10"/>
          <path d="${stair}" fill="none" stroke="#1f3b57" stroke-width="7" stroke-linejoin="round"/>
          <circle cx="${X(last[0])}" cy="${Y(last[1])}" r="12" fill="#1f3b57"/>
          <text x="${Math.min(X(last[0]) - 20, W - 40)}" y="${Y(last[1]) - 34}" text-anchor="end" font-size="44" font-weight="800" fill="#1f3b57" font-family="JetBrains Mono">${last[1].toFixed(2)} in</text>
          <text x="${X(cum[cum.length - 1][0]) - 10}" y="${Y(cum[cum.length - 1][2]) + 60}" font-size="32" fill="#6b645a" text-anchor="end" font-family="Inter" opacity="${ease((p - .7) / .2)}">usual by now ${s.usual} in</text>
        </svg>
        <div style="font:600 34px 'JetBrains Mono';color:#6b645a">Your town's year in rain: agsist.com/rain-print</div></div></div>`;
  };

  S.end = (s, p) => {
    const k = back(p / .5);
    return `<div style="position:absolute;top:180px;left:0;right:0;text-align:center">
      <img src="/img/logo-agsist-ondark.svg" style="width:760px;transform:scale(${lerp(.7, 1, clamp(k, 0, 1.2)).toFixed(3)});opacity:${ease(p / .3)}">
      <div class="h1" style="margin-top:70px;font-size:96px;${enter(p, 3)}">The Daily, every morning</div>
      <div class="mono" style="margin-top:40px;font-size:56px;color:var(--gold);font-weight:800;${enter(p, 5)}">agsist.com/daily</div>
      <div class="mono" style="margin-top:120px;font-size:30px;color:var(--muted);${enter(p, 8)}">Computer voice. Script built by code from the AGSIST Daily.<br>Every number has its date and source on screen.</div></div>`;
  };

  function sceneAt(t) {
    const sc = PLAN.scenes;
    for (let i = sc.length - 1; i >= 0; i--) if (t >= sc[i].start) return [sc[i], i];
    return [sc[0], 0];
  }

  function seek(t) {
    const [s, i] = sceneAt(t);
    const p = t - s.start;
    const fn = S[s.kind];
    $('scene').innerHTML = fn ? fn(s, p, s.dur) : '';
    $('scene').style.opacity = String(clamp((s.start + s.dur - t) / .08 + .0));
    const src = s.src ? ` · ${esc(s.src)}` : '';
    $('asof').innerHTML = s.kind === 'end' ? '' : `<b>${esc(s.asof || '')}</b>${src}`;
    $('asof').style.cssText += `;opacity:${ease((p - .1) / .3)}`;
    // the cut: a gold wipe for the first few frames of each scene
    const w = clamp(1 - p / .16);
    $('flash').style.background = w > 0 ? `linear-gradient(115deg, transparent ${(100 - w * 140).toFixed(1)}%, rgba(212,162,63,${(.55 * w).toFixed(2)}) ${(110 - w * 140).toFixed(1)}%, transparent ${(125 - w * 140).toFixed(1)}%)` : 'none';
    $('rows').style.transform = `translate(${(-t * 14 % 92).toFixed(1)}px, ${(t * 6 % 92).toFixed(1)}px)`;
    $('prog').style.width = (1080 * clamp(t / PLAN.total)).toFixed(1) + 'px';
    const c = PLAN.captions.find((c) => t >= c.start && t < c.end + .05);
    $('cap').innerHTML = c && s.kind !== 'end' ? `<span>${esc(c.text).replace(/(\$[\d,.]+[¼½¾]?|[\d,.]*[¼½¾]?¢|\d[\d,.]*%)/g, '<em>$1</em>')}</span>` : '';
    return i;
  }

  async function init(plan) {
    PLAN = plan;
    PLAN.total = plan.total || plan.scenes.reduce((m, s) => Math.max(m, s.start + s.dur), 0);
    $('date').textContent = new Date(plan.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    if (plan.scenes.some((s) => s.kind === 'map' || s.kind === 'hail')) {
      GEO = await (await fetch('/data/us-states.geo.json')).json();
      buildPaths();
    }
    await document.fonts.ready;
    await Promise.all([...document.images].map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
    seek(0);
    return PLAN.total;
  }

  window.AG60 = { init, seek };
  const q = new URLSearchParams(location.search).get('plan');
  if (q) fetch(q).then((r) => r.json()).then(init).then(() => { const t = +(new URLSearchParams(location.search).get('t') || 0); seek(t); window.AG60_READY = true; });
})();
