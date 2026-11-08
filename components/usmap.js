/* usmap.js: the one US states map (Nov 8, 2026). Replaces the state tile grids on the farmland sales hub, the rent
   hub, the crop condition page and the farmland atlas. The shapes are data/us-states-map.svg (scripts/build_us_map.py),
   fetched once and cached. A page hands in its own colors and links; this draws, labels and wires the states.

     AgUSMap.mount(el, {
       states: { IL: { fill:'#2e7d4f', text:'Live', href:'/land-sales/il' (optional), } },
       selected: 'IA',                         // optional, outlined
       onPick: function (st) {},               // optional, a tap or Enter on a state without href
       hint: 'Tap a state.',                   // what the readout says before any state is touched
       name: 'Farmland sales coverage by state'
     }) -> { update(states, selected) }

   A state with no entry is drawn as "no data": quiet, not tappable. Every state is one focusable element (a link when it
   has href, else a button) with its name and status as the accessible name. The small eastern states are tapped from a
   labelled chip out in the water, joined to the state by a line. The box reserves its aspect ratio before the file
   arrives, so nothing moves when the map appears. */
(function () {
  if (window.AgUSMap) return;
  var SRC = '/data/us-states-map.svg?v=1', NS = 'http://www.w3.org/2000/svg', geo = null, pending = null;
  var CSS = '.usm{position:relative;width:100%;max-width:980px;margin:0 auto}' +
    '.usm-box{position:relative;width:100%;aspect-ratio:920.5/676}' +
    '.usm-box svg{position:absolute;inset:0;width:100%;height:100%;display:block;overflow:visible}' +
    '.usm-box noscript,.usm-fail{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;font-size:.82rem;color:var(--text-muted,#9aa5a2);padding:0 12px}' +
    '.usm-s{cursor:pointer;outline:none}.usm-s.usm-off{cursor:default}' +
    '.usm-s path{fill:var(--usm-none,color-mix(in srgb,var(--text,#e9edeb) 16%,var(--bg,#0a0c0d)));stroke:var(--bg,#0a0c0d);stroke-width:.9;stroke-linejoin:round;transition:opacity .1s}' +
    '.usm-s.usm-dim path{stroke:var(--bg,#0a0c0d)}' +
    '.usm-s text{fill:var(--text,#e9edeb);font:700 17px/1 "JetBrains Mono",ui-monospace,monospace;text-anchor:middle;dominant-baseline:central;pointer-events:none;letter-spacing:.02em}' +
    '.usm-s.usm-dim text{fill:var(--text-muted,#9aa5a2)}' +
    '.usm-chip rect{fill:var(--usm-none,color-mix(in srgb,var(--text,#e9edeb) 16%,var(--bg,#0a0c0d)));stroke:var(--bg,#0a0c0d);stroke-width:1}' +
    '.usm-s .usm-ct{font-size:26px}' +
    '.usm-lead{stroke:var(--text-muted,#9aa5a2);stroke-width:1.3;fill:none;opacity:.8;pointer-events:none}' +
    '.usm-s:hover:not(.usm-off) path,.usm-s:focus-visible path,.usm-s.usm-sel path{stroke:var(--text,#e9edeb);stroke-width:2.2}' +
    '.usm-s:hover:not(.usm-off) .usm-chip rect,.usm-s:focus-visible .usm-chip rect,.usm-s.usm-sel .usm-chip rect{stroke:var(--text,#e9edeb);stroke-width:3}' +
    '.usm-s:focus-visible .usm-ring{stroke:#d4a23f;stroke-width:3.4;fill:none}' +
    '.usm-ring{fill:none;stroke:none;pointer-events:none}' +
    '.usm-read{min-height:1.4em;margin:8px 0 0;text-align:center;font-size:.86rem;color:var(--text,#e9edeb)}';

  function css() {
    if (document.getElementById('usm-css')) return;
    var s = document.createElement('style'); s.id = 'usm-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  function load() {
    if (geo) return Promise.resolve(geo);
    if (!pending) pending = fetch(SRC).then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(function (t) {
      var d = new DOMParser().parseFromString(t, 'image/svg+xml'), svg = d.documentElement, out = { vb: svg.getAttribute('viewBox'), list: [] };
      [].forEach.call(svg.querySelectorAll('path'), function (p) {
        out.list.push({ st: p.id, name: p.getAttribute('data-n'), d: p.getAttribute('d'),
          c: p.getAttribute('data-c').split(',').map(Number), o: p.getAttribute('data-o') ? p.getAttribute('data-o').split(',').map(Number) : null });
      });
      geo = out; return out;
    });
    return pending;
  }
  function el(n, a, kids) {
    var e = document.createElementNS(NS, n);
    for (var k in a) e.setAttribute(k, a[k]);
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function lum(hex) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    var h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1], v = [0, 2, 4].map(function (i) {
      var c = parseInt(h.substr(i, 2), 16) / 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);
    });
    return .2126 * v[0] + .7152 * v[1] + .0722 * v[2];
  }
  /* black or white, whichever reads better on the fill */
  function ink(fill) {
    var l = lum(fill); if (l == null) return null;
    return (1.05 / (l + .05)) >= ((l + .05) / .05) ? '#fff' : '#0a0c0d';
  }
  function mount(host, o) {
    css();
    host.textContent = '';
    var wrap = document.createElement('div'); wrap.className = 'usm';
    var box = document.createElement('div'); box.className = 'usm-box';
    var read = document.createElement('p'); read.className = 'usm-read'; read.setAttribute('aria-live', 'polite'); read.textContent = o.hint || '';
    wrap.appendChild(box); wrap.appendChild(read); host.appendChild(wrap);
    var st = o.states || {}, sel = o.selected || null, nodes = {}, api = {};
    function say(code) {
      var g = geo && geo.list.filter(function (x) { return x.st === code; })[0], s = st[code];
      read.textContent = g ? (g.name + (s ? ': ' + s.text : ': no data')) : (o.hint || '');
    }
    function paint() {
      Object.keys(nodes).forEach(function (code) {
        var n = nodes[code], s = st[code], on = !!s;
        n.g.setAttribute('class', 'usm-s' + (on ? '' : ' usm-dim usm-off') + (code === sel ? ' usm-sel' : ''));
        var fill = on ? s.fill : null, c = on ? ink(fill) : null;
        n.path.style.fill = fill || ''; n.chip && (n.chip.style.fill = fill || '');
        n.text.style.fill = c || '';
        n.g.setAttribute('aria-label', n.name + (on ? ', ' + s.text : ', no data'));
        if (on) { n.g.setAttribute('tabindex', '0'); n.g.removeAttribute('aria-disabled'); }
        else { n.g.removeAttribute('tabindex'); n.g.setAttribute('aria-disabled', 'true'); }
        n.g.setAttribute('role', on && s.href ? 'link' : 'button');
        if (on && !s.href) n.g.setAttribute('aria-pressed', code === sel ? 'true' : 'false'); else n.g.removeAttribute('aria-pressed');
      });
    }
    load().then(function (g) {
      var svg = el('svg', { viewBox: g.vb, role: 'group', 'aria-label': o.name || 'Map of the United States by state', focusable: 'false' });
      g.list.forEach(function (x) {
        var path = el('path', { d: x.d });
        var chip = null, lead = null, tx, ty;
        if (x.o) {
          lead = el('path', { d: 'M' + x.c[0] + ' ' + x.c[1] + 'L' + (x.o[0] - 33) + ' ' + x.o[1], 'class': 'usm-lead' });
          chip = el('rect', { x: x.o[0] - 33, y: x.o[1] - 29, width: 66, height: 58, rx: 8 });
          tx = x.o[0]; ty = x.o[1];
        } else { tx = x.c[0]; ty = x.c[1]; }
        var text = el('text', { x: tx, y: ty }); if (chip) text.setAttribute('class', 'usm-ct'); text.textContent = x.st;
        var g1 = el('g', { 'class': 'usm-s', 'data-st': x.st }, [path]);
        if (lead) g1.insertBefore(lead, path);
        if (chip) { var cg = el('g', { 'class': 'usm-chip' }, [chip]); g1.appendChild(cg); }
        g1.appendChild(text);
        nodes[x.st] = { g: g1, path: path, chip: chip, text: text, name: x.name, code: x.st };
        svg.appendChild(g1);
      });
      box.textContent = ''; box.appendChild(svg);
      /* a state with a link is a plain element that navigates on tap or Enter: one handler for both kinds */
      svg.addEventListener('click', function (e) {
        var g1 = e.target.closest && e.target.closest('.usm-s'); if (!g1 || g1.classList.contains('usm-off')) return;
        var code = g1.getAttribute('data-st'), s = st[code];
        if (s.href) { location.href = s.href; return; }
        sel = code; paint(); say(code); if (o.onPick) o.onPick(code);
      });
      svg.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var g1 = e.target.closest && e.target.closest('.usm-s'); if (!g1 || g1.classList.contains('usm-off')) return;
        e.preventDefault(); g1.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        var again = svg.querySelector('.usm-s[data-st="' + g1.getAttribute('data-st') + '"]'); if (again) again.focus();
      });
      ['mouseover', 'focusin'].forEach(function (ev) {
        svg.addEventListener(ev, function (e) { var g1 = e.target.closest && e.target.closest('.usm-s'); if (g1) say(g1.getAttribute('data-st')); });
      });
      svg.addEventListener('mouseleave', function () { say(sel); if (!sel) read.textContent = o.hint || ''; });
      paint();
      if (sel) say(sel);
    }, function () {
      box.innerHTML = '<div class="usm-fail">The map did not load. Every state is in the list below.</div>';
    });
    api.update = function (s2, sel2) { st = s2 || st; if (sel2 !== undefined) sel = sel2; if (geo) { paint(); if (sel) say(sel); } };
    return api;
  }
  window.AgUSMap = { mount: mount };
})();
