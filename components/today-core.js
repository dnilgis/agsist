/* The Today list's arithmetic (elev-today.html), kept apart so it can be tested
 * against a real dnilgis/bids index. scripts/morning_report.py does the same
 * sums in Python for the email's Today block; test/today-core.test.mjs checks
 * both against one fixture.
 *
 * Works in a browser (window.AgsistToday) and in node (module.exports). */
(function (root) {
  'use strict';

  var LIVE_H = 14;        // dnilgis/bids lib/freshness.mjs WITHDRAW_H
  var PASTED_H = 168;     // PASTED_WITHDRAW_H: a board Sig pasted by hand
  var STALE_H = 6;        // LATE_H: older than this and a blocked board needs a person

  var STATES = { IA: 'Iowa', IL: 'Illinois', IN: 'Indiana', KS: 'Kansas', MN: 'Minnesota', MO: 'Missouri', NE: 'Nebraska',
    ND: 'North Dakota', SD: 'South Dakota', WI: 'Wisconsin', OH: 'Ohio', MI: 'Michigan', KY: 'Kentucky', TN: 'Tennessee',
    OK: 'Oklahoma', TX: 'Texas', CO: 'Colorado', MT: 'Montana', AR: 'Arkansas', GA: 'Georgia', AL: 'Alabama', MS: 'Mississippi',
    LA: 'Louisiana', PA: 'Pennsylvania', NY: 'New York', ID: 'Idaho', WA: 'Washington', OR: 'Oregon', WY: 'Wyoming',
    NC: 'North Carolina', SC: 'South Carolina', VA: 'Virginia', MD: 'Maryland', DE: 'Delaware', NJ: 'New Jersey',
    CA: 'California', AZ: 'Arizona', NM: 'New Mexico', UT: 'Utah', NV: 'Nevada', FL: 'Florida', WV: 'West Virginia',
    ON: 'Ontario', MB: 'Manitoba', SK: 'Saskatchewan', AB: 'Alberta' };

  function t(iso) { var x = Date.parse(iso || ''); return isFinite(x) ? x : null; }
  function host(s) {
    var u = s.website || s.url || '';
    try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; }
  }
  function botCheck(s) { return /bot check|Cloudflare challenge/i.test(s.error || ''); }
  function refused(s) { return s.health === 'refused' && !s.emptyBoard; }

  /* A board with a price on the site right now: last good read inside its line. */
  function current(s, now) {
    var c = t(s.checkedAt);
    if (c == null || !(s.rows > 0)) return false;
    var line = s.pasted === true ? PASTED_H : LIVE_H;
    return (now - c) / 36e5 < line;
  }

  function health(index, now) {
    var src = (index && index.sources) || [];
    var n = 0;
    src.forEach(function (s) { if (current(s, now)) n++; });
    return { current: n, total: src.length, pct: src.length ? Math.round(100 * n / src.length) : 0 };
  }

  /* Sites a person has to deal with by hand: a host where a board was blocked by
     a bot check or refused, and whose boards have had no good read for STALE_H.
     For a bot check the whole page is blocked, so every stale board on that host
     counts; for a refusal only the refused boards do. Biggest town count first. */
  function handPaste(index, now, readers) {
    var by = {};
    ((index && index.sources) || []).forEach(function (s) {
      var h = host(s); if (!h) return;
      (by[h] = by[h] || []).push(s);
    });
    var out = [];
    Object.keys(by).forEach(function (h) {
      var rows = by[h];
      var bot = rows.some(botCheck);
      var stale = function (s) { var c = t(s.checkedAt); return c == null || (now - c) / 36e5 >= STALE_H; };
      var hit = rows.filter(function (s) { return (bot || refused(s)) && stale(s); });
      var pasted = rows.filter(function (s) { return s.pasted === true; });
      if (!hit.length && !(pasted.length && bot)) return;
      var boards = hit.length ? hit : pasted;
      var towns = {}, states = {};
      boards.forEach(function (s) { towns[(s.location || '') + '|' + (s.usState || '')] = 1; states[s.usState || ''] = 1; });
      var last = null;
      boards.forEach(function (s) { var c = t(s.checkedAt); if (c != null && (last == null || c > last)) last = c; });
      var ops = {};
      rows.forEach(function (s) { if (s.operator) ops[s.operator] = (ops[s.operator] || 0) + 1; });
      var op = Object.keys(ops).sort(function (a, b) { return ops[b] - ops[a] || (a < b ? -1 : 1); })[0] || h;
      var reader = readers ? readers(h) : null;
      var why = bot ? 'bot check' : 'refused';
      var sample = (boards.filter(bot ? botCheck : refused)[0] || boards[0] || {}).error || '';
      var newestPaste = null;
      pasted.forEach(function (s) { var c = t(s.pastedAt || s.checkedAt); if (c != null && (newestPaste == null || c > newestPaste)) newestPaste = c; });
      out.push({ host: h, operator: op, why: why, reason: sample.replace(/\s+/g, ' ').slice(0, 140),
        boards: boards.length, towns: Object.keys(towns).length, states: Object.keys(states).filter(Boolean).sort(),
        lastGood: last == null ? null : new Date(last).toISOString(),
        pastedAt: newestPaste == null ? null : new Date(newestPaste).toISOString(),
        site: reader, platform: rows[0].platform || '', page: (rows[0].website || rows[0].url || '') });
    });
    out.sort(function (a, b) { return b.towns - a.towns || b.boards - a.boards || (a.host < b.host ? -1 : 1); });
    return out;
  }

  /* "59 Iowa towns" / "16 towns in Minnesota and Iowa" / "1 town" */
  function townsText(p) {
    var n = p.towns, w = n === 1 ? 'town' : 'towns';
    if (p.states.length === 1 && STATES[p.states[0]]) return n + ' ' + STATES[p.states[0]] + ' ' + w;
    if (p.states.length > 1 && p.states.length <= 3) return n + ' ' + w + ' in ' + p.states.map(function (s) { return STATES[s] || s; }).join(', ');
    return n + ' ' + w;
  }

  function ct(iso, opts) {
    var d = new Date(iso); if (isNaN(d)) return '';
    return d.toLocaleString('en-US', Object.assign({ timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, opts || {})) + ' CT';
  }
  function ctDay(ms) {
    return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });   // 2026-10-20
  }

  var api = { LIVE_H: LIVE_H, PASTED_H: PASTED_H, STALE_H: STALE_H, STATES: STATES, host: host, current: current,
              health: health, handPaste: handPaste, townsText: townsText, ct: ct, ctDay: ctDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AgsistToday = api;
})(typeof window !== 'undefined' ? window : this);
