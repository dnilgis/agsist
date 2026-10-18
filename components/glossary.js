/* AGSIST glossary marks. 2026-10-18.

   One shared glossary (data/glossary.json). After the page is idle, this file
   loads the list and marks the FIRST use of each term inside the page's main
   content with a small button: tap (or hover, on a mouse) opens a one-line
   plain explanation and a link to /glossary#<term>.

   Where it looks: [data-glossary-root] if the page has one, else <main>.
   Never inside nav, header, footer, links, buttons, headings, summaries,
   labels, form fields, code, tables' header cells, live regions, mostly-number
   text, or anything under [data-no-gloss]. A page opts out with
   data-glossary="off" on <html> or <body>.

   Accessible: each mark is a <button aria-expanded aria-controls="gl-pop">;
   Escape closes and puts focus back; the popover is a labeled dialog that
   does not trap focus. At most MAX marks a page so text stays readable.

   The matching core (pickMarks) is pure and exported for tests. */
(function (root) {
  'use strict';
  var MAX = 14;
  var SKIP = /^(A|BUTTON|H1|H2|H3|H4|H5|H6|SUMMARY|LABEL|NAV|HEADER|FOOTER|SCRIPT|STYLE|NOSCRIPT|TEMPLATE|CODE|PRE|KBD|SAMP|SVG|INPUT|TEXTAREA|SELECT|OPTION|ABBR|DFN|TITLE|TH|CAPTION|LEGEND|TIME|DATA|OUTPUT|METER|PROGRESS|IFRAME|CANVAS|TEXT)$/i;

  function compile(terms) {
    var out = [];
    (terms || []).forEach(function (t) {
      var res = [];
      (t.match || []).forEach(function (src) {
        try { res.push(new RegExp(src, (t.flags == null ? 'i' : t.flags).replace('g', ''))); } catch (e) { /* a pattern this browser cannot run is skipped */ }
      });
      if (res.length) out.push({ id: t.id, term: t.term, short: t.short, res: res });
    });
    return out;
  }

  /* Earliest match of term t in s from position `from`: {start, end} or null.
     Group 1, when the pattern has one, is the part that gets marked. */
  function firstIn(t, s) {
    var best = null;
    for (var i = 0; i < t.res.length; i++) {
      var m = t.res[i].exec(s);
      if (!m) continue;
      var txt = m[1] != null ? m[1] : m[0];
      var start = m.index + (m[1] != null ? m[0].indexOf(m[1]) : 0);
      if (!best || start < best.start) best = { start: start, end: start + txt.length };
    }
    return best;
  }

  function mostlyNumber(s) {
    var t = (s || '').replace(/\s+/g, '');
    if (!t) return false;
    var d = (t.match(/[0-9$%¢.,+\-−▲▼]/g) || []).length;
    return d / t.length > 0.4;
  }

  /* segs: array of strings (text nodes in document order, already filtered).
     Returns [{seg, start, end, id}] with each term at most once, in order. */
  function pickMarks(segs, compiled, max) {
    max = max || MAX;
    var left = compiled.slice(), marks = [];
    for (var i = 0; i < segs.length && left.length && marks.length < max; i++) {
      var s = segs[i], pos = 0;
      if (mostlyNumber(s)) continue;
      while (left.length && marks.length < max) {
        var rest = s.slice(pos), hit = null, k = -1;
        for (var j = 0; j < left.length; j++) {
          var f = firstIn(left[j], rest);
          if (f && (!hit || f.start < hit.start)) { hit = f; k = j; }
        }
        if (!hit) break;
        marks.push({ seg: i, start: pos + hit.start, end: pos + hit.end, id: left[k].id });
        left.splice(k, 1);
        pos += hit.end;
      }
    }
    return marks;
  }

  var api = { pickMarks: pickMarks, compile: compile, mostlyNumber: mostlyNumber, MAX: MAX };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  /* ---------- browser ---------- */
  var doc = root.document;
  if (!doc || root.AgsistGlossary) return;
  root.AgsistGlossary = api;
  var off = function (el) { return el && el.getAttribute && el.getAttribute('data-glossary') === 'off'; };
  if (off(doc.documentElement) || off(doc.body)) return;

  function skipEl(el, top) {
    for (var e = el; e && e !== top; e = e.parentNode) {
      if (e.nodeType !== 1) continue;
      if (SKIP.test(e.tagName)) return true;
      if (e.hasAttribute('data-no-gloss') || e.hasAttribute('aria-live') || e.hasAttribute('hidden') ||
          e.getAttribute('aria-hidden') === 'true' || e.isContentEditable) return true;
      var r = e.getAttribute('role');
      if (r && /^(button|tab|link|heading|status|alert|timer|marquee|menu|menuitem|navigation)$/.test(r)) return true;
      var c = typeof e.className === 'string' ? e.className : '';
      if (/(^|\s)(gl-term|gl-pop|next-links|breadcrumb|skip|ticker|snav)(\s|$)/.test(c)) return true;
    }
    return false;
  }

  function textNodes(top) {
    var out = [], w = doc.createTreeWalker(top, 4, null), n;
    while ((n = w.nextNode())) {
      if (!/[A-Za-z]{3}/.test(n.nodeValue)) continue;
      if (skipEl(n.parentNode, top.parentNode)) continue;
      if (mostlyNumber(n.parentNode.textContent)) continue;
      out.push(n);
    }
    return out;
  }

  var CSS = '.gl-term{font:inherit;color:inherit;background:none;border:0;border-radius:2px;padding:0;margin:0;cursor:help;display:inline;line-height:inherit;letter-spacing:inherit;text-transform:inherit;text-align:inherit;text-decoration:underline dotted;text-decoration-thickness:1px;text-underline-offset:.2em;-webkit-tap-highlight-color:transparent}' +
    '.gl-term:hover,.gl-term[aria-expanded="true"]{text-decoration-style:solid;background:rgba(var(--gold-rgb,212,162,63),.12)}' +
    '.gl-term:focus-visible{outline:2px solid var(--gold,#d4a23f);outline-offset:2px}' +
    '.gl-pop{position:absolute;z-index:9000;box-sizing:border-box;width:min(330px,calc(100vw - 32px));background:var(--surface,#101415);color:var(--text,#e8ece9);border:1px solid var(--border-2,rgba(132,160,168,.3));border-radius:8px;padding:.7rem .85rem .6rem;font:400 .875rem/1.45 var(--font-body,system-ui,sans-serif);text-align:left;text-transform:none;letter-spacing:0;box-shadow:0 8px 28px rgba(0,0,0,.35)}' +
    '.gl-pop[hidden]{display:none}.gl-pop b{display:block;margin:0 1.6rem .2rem 0;font-weight:700}.gl-pop p{margin:0 0 .45rem}' +
    '.gl-pop a{color:var(--gold,#d4a23f);font-size:.82rem}.gl-pop .gl-x{position:absolute;top:.3rem;right:.3rem;width:32px;height:32px;border:0;background:none;color:inherit;font-size:1.15rem;line-height:1;cursor:pointer;border-radius:6px}' +
    '.gl-pop .gl-x:focus-visible{outline:2px solid var(--gold,#d4a23f)}' +
    '@media print{.gl-pop{display:none!important}.gl-term{text-decoration:none}}';

  var pop, open = null, pinned = false, hoverT = 0, byId = {};

  function ensurePop() {
    if (pop) return pop;
    var st = doc.createElement('style'); st.textContent = CSS; doc.head.appendChild(st);
    pop = doc.createElement('div');
    pop.id = 'gl-pop'; pop.className = 'gl-pop'; pop.setAttribute('role', 'dialog'); pop.hidden = true;
    pop.innerHTML = '<button type="button" class="gl-x" aria-label="Close">&times;</button><b id="gl-pop-t"></b><p id="gl-pop-d"></p><a id="gl-pop-a" href="/glossary">More in the glossary</a>';
    pop.setAttribute('aria-labelledby', 'gl-pop-t');
    doc.body.appendChild(pop);
    pop.querySelector('.gl-x').addEventListener('click', function () { close(true); });
    pop.addEventListener('mouseenter', function () { clearTimeout(hoverT); });
    pop.addEventListener('mouseleave', function () { if (!pinned) hoverT = setTimeout(function () { close(false); }, 300); });
    return pop;
  }

  function place(btn) {
    var r = btn.getBoundingClientRect(), vw = doc.documentElement.clientWidth;
    var w = Math.min(330, vw - 32), x = Math.max(16, Math.min(r.left + root.scrollX, root.scrollX + vw - 16 - w));
    pop.style.left = x + 'px';
    pop.style.top = (r.bottom + root.scrollY + 6) + 'px';
  }

  function show(btn, pin) {
    var t = byId[btn.getAttribute('data-term')];
    if (!t) return;
    ensurePop();
    if (open && open !== btn) open.setAttribute('aria-expanded', 'false');
    pop.querySelector('#gl-pop-t').textContent = t.term;
    pop.querySelector('#gl-pop-d').textContent = t.short;
    pop.querySelector('#gl-pop-a').setAttribute('href', '/glossary#' + t.id);
    pop.hidden = false; place(btn);
    btn.setAttribute('aria-expanded', 'true');
    open = btn; pinned = !!pin;
  }

  function close(focusBack) {
    if (!open) return;
    var b = open; open = null; pinned = false;
    b.setAttribute('aria-expanded', 'false');
    if (pop) pop.hidden = true;
    if (focusBack) b.focus();
  }

  function wrap(node, start, end, t) {
    var mid = node.splitText(start); mid.splitText(end - start);
    var b = doc.createElement('button');
    b.type = 'button'; b.className = 'gl-term';
    b.setAttribute('data-term', t.id);
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', 'gl-pop');
    b.setAttribute('aria-label', mid.nodeValue + ': what this means');
    b.textContent = mid.nodeValue;
    mid.parentNode.replaceChild(b, mid);
  }

  function run(data) {
    var top = doc.querySelector('[data-glossary-root]') || doc.querySelector('main');
    if (!top || top.querySelector('.gl-term')) return;
    var compiled = compile(data && data.terms);
    compiled.forEach(function (t) { byId[t.id] = t; });
    var nodes = textNodes(top);
    var marks = pickMarks(nodes.map(function (n) { return n.nodeValue; }), compiled, MAX);
    /* wrap from the last mark back so earlier offsets stay right */
    for (var i = marks.length - 1; i >= 0; i--) wrap(nodes[marks[i].seg], marks[i].start, marks[i].end, byId[marks[i].id]);
    if (!marks.length) return;
    var hover = root.matchMedia && root.matchMedia('(hover: hover) and (pointer: fine)').matches;
    top.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.gl-term');
      if (!b) return;
      e.preventDefault();
      if (open === b && pinned) close(false); else show(b, true);
    });
    if (hover) {
      top.addEventListener('mouseover', function (e) {
        var b = e.target.closest && e.target.closest('.gl-term');
        if (!b || pinned) return;
        clearTimeout(hoverT); hoverT = setTimeout(function () { show(b, false); }, 250);
      });
      top.addEventListener('mouseout', function (e) {
        var b = e.target.closest && e.target.closest('.gl-term');
        if (!b || pinned) return;
        clearTimeout(hoverT); hoverT = setTimeout(function () { close(false); }, 300);
      });
    }
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) close(true); });
    doc.addEventListener('click', function (e) {
      if (!open || !pop) return;
      if (pop.contains(e.target) || (e.target.closest && e.target.closest('.gl-term'))) return;
      close(false);
    });
    root.addEventListener('resize', function () { close(false); });
  }

  function start() {
    var go = function () {
      fetch('/data/glossary.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d) run(d); }).catch(function () {});
    };
    if (root.requestIdleCallback) root.requestIdleCallback(go, { timeout: 2500 }); else setTimeout(go, 900);
  }
  if (doc.readyState === 'complete') start(); else root.addEventListener('load', start);
})(typeof window !== 'undefined' ? window : this);
