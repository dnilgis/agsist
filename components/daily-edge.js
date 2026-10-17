/* daily-edge.js -- the "Only on AGSIST" block and Sig's note on /daily.

   Draws data/daily.json -> edge and cca_note. Every number in them was
   counted by scripts/daily_edge.py from the elevator boards AGSIST reads,
   before the briefing was drafted; nothing here computes one. The markup is
   the same as daily_edge.render_html / render_note_html draw on each
   /daily/YYYY-MM-DD page (test/daily-edge.test.mjs holds the two equal).
   No edge, or no fact in it: nothing at all. No note: nothing at all. */
(function (root) {
  'use strict';
  var MAX = 3;
  var CSS = ".dv3-edge{margin:1.1rem 0 0;padding:.85rem 1.05rem;background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--green);border-radius:8px}.dv3-edge-label{font-family:'JetBrains Mono',monospace;font-size:.72rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--green);margin:0 0 .45rem}.dv3-edge-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.6rem}.dv3-edge-fact{margin:0;padding:0}.dv3-edge-s{margin:0;font-size:1rem;line-height:1.55;color:var(--text);font-weight:600}.dv3-edge-s a{color:inherit;text-decoration:underline;text-decoration-color:var(--green);text-decoration-thickness:2px;text-underline-offset:3px}.dv3-edge-d{margin:.15rem 0 0;font-size:.84rem;line-height:1.5;color:var(--text-dim)}.dv3-edge-note{margin:.6rem 0 0;font-size:.76rem;line-height:1.5;color:var(--text-muted)}.dv3-edge-note a{color:var(--text-muted);text-decoration:underline;display:inline-block;padding:.35rem 0;margin:-.35rem 0}.dv3-cca{margin:1rem 0 0;padding:.8rem 1.05rem;background:var(--surface2);border:1px solid var(--border);border-left:4px solid var(--gold);border-radius:8px}.dv3-cca-label{font-family:'JetBrains Mono',monospace;font-size:.72rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);margin:0 0 .3rem}.dv3-cca-text{margin:0;font-size:.98rem;line-height:1.6;color:var(--text)}.dv3-cca-by{margin:.35rem 0 0;font-size:.8rem;color:var(--text-muted)}";
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[c];
    });
  }
  function shown(edge) {
    if (!edge || !Array.isArray(edge.facts)) return [];
    return edge.facts.filter(function (f) { return f && typeof f === 'object' && f.sentence && f.url; }).slice(0, MAX);
  }
  function linked(f) {
    var s = String(f.sentence || ''), k = String(f.key || ''), u = String(f.url || '');
    if (u.charAt(0) !== '/') u = '';
    var i = k && u ? s.indexOf(k) : -1;
    if (i < 0) return esc(s);
    return esc(s.slice(0, i)) + '<a href="' + esc(u) + '">' + esc(k) + '</a>' + esc(s.slice(i + k.length));
  }
  function html(edge, dateIso) {
    var facts = shown(edge);
    if (!facts.length) return '';
    var items = facts.map(function (f) {
      return '<li class="dv3-edge-fact" id="edge-' + esc(f.id) + '">' +
        '<p class="dv3-edge-s">' + linked(f) + '</p>' +
        (f.detail ? '<p class="dv3-edge-d">' + esc(f.detail) + '</p>' : '') + '</li>';
    }).join('');
    var cite = /^\d{4}-\d{2}-\d{2}$/.test(String(dateIso || '')) ? ' Quote it with the date and a link to agsist.com/daily/' + esc(dateIso) + '.' : '';
    return '<section class="dv3-edge" aria-labelledby="dv3-edge-h">' +
      '<h2 class="dv3-edge-label" id="dv3-edge-h">' + esc(edge.label || 'Only on AGSIST') + '</h2>' +
      '<ol class="dv3-edge-list">' + items + '</ol>' +
      '<p class="dv3-edge-note">Counted by code from the elevator boards AGSIST reads itself, ' +
      'not by the writer of this briefing.' + cite + ' <a href="/editorial-standards#how-the-daily-is-made">How this briefing is made</a></p>' +
      '</section>';
  }
  function note(n) {
    if (!n || typeof n !== 'object' || !String(n.text || '').trim()) return '';
    return '<aside class="dv3-cca" aria-label="A note from Sig">' +
      '<p class="dv3-cca-label">From Sig</p>' +
      '<p class="dv3-cca-text">' + esc(String(n.text).trim()) + '</p>' +
      '<p class="dv3-cca-by">Sigurd Lindquist, CCA</p></aside>';
  }
  var api = { html: html, note: note, shown: shown, CSS: CSS };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  try {
    var st = root.document.createElement('style'); st.textContent = CSS; root.document.head.appendChild(st);
  } catch (e) {}
  root.agsistDailyEdge = api;
})(typeof window !== 'undefined' ? window : this);
