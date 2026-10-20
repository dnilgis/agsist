/* Read a bid board Sig pasted by hand (elev-admin.html, Paste bids).
 *
 * NEW Cooperative's site puts a Cloudflare bot check in front of the bids
 * reader, and the reader does not try to get past it. So Sig opens
 * https://www.newcoop.com/cash-bids in his own browser, copies the page source
 * (or select-all text, or uses the "Copy for AGSIST" bookmarklet) and pastes it
 * here. Nothing in this file fetches their site.
 *
 * The board (Sig's page source, Oct 20): inside <turbo-frame id="cashbids">, an
 * <h1 class="text-4xl ..."> per location, then a table
 *   COMMODITY | DELIVERY | CASH PRICE | BASIS | FUTURE PRICE | FUTURE CHANGE
 *   Corn | 10/1/2026 - 10/31/2026 | $4.26 | -35 | 461-4 | -5-4
 * Cells are kept exactly as printed; dnilgis/bids reads them with the same code
 * as a live read and proves cash = (futures + basis) / 100 on every row.
 *
 * Works in a browser (window.AgsistPasteBids) and in node (module.exports). */
(function (root) {
  'use strict';

  /* dnilgis/bids sources/newcoop-*.json: id and locationId, Oct 20 2026.
     The board prints 69 headings; these 66 are the ones bids reads. */
  var NEWCOOP_BOARDS = [
    ['newcoop-afton', 'Afton'], ['newcoop-algona', 'Algona'], ['newcoop-anita', 'Anita'], ['newcoop-anthon', 'Anthon'],
    ['newcoop-badger', 'Badger'], ['newcoop-barnum', 'Barnum'], ['newcoop-belmond', 'Belmond'], ['newcoop-blairsburg', 'Blairsburg'],
    ['newcoop-blencoe', 'Blencoe'], ['newcoop-bode', 'Bode'], ['newcoop-britt', 'Britt'], ['newcoop-chariton', 'Chariton'],
    ['newcoop-churdan', 'Churdan'], ['newcoop-clare', 'Clare'], ['newcoop-clearfield', 'Clearfield'], ['newcoop-cooper', 'Cooper'],
    ['newcoop-correctionville', 'Correctionville'], ['newcoop-creston1', 'Creston 1'], ['newcoop-creston2', 'Creston 2'],
    ['newcoop-daviscity', 'Davis City'], ['newcoop-dickens', 'Dickens'], ['newcoop-dows', 'Dows'], ['newcoop-duncombe', 'Duncombe'],
    ['newcoop-essex', 'Essex'], ['newcoop-everly', 'Everly'], ['newcoop-fostoria', 'Fostoria'], ['newcoop-garner', 'Garner'],
    ['newcoop-glidden', 'Glidden'], ['newcoop-greenville', 'Greenville'], ['newcoop-gruver', 'Gruver'], ['newcoop-hornick', 'Hornick'],
    ['newcoop-humboldt', 'Humboldt'], ['newcoop-humeston', 'Humeston'], ['newcoop-klemme', 'Klemme'], ['newcoop-knierim', 'Knierim'],
    ['newcoop-knoke', 'Knoke'], ['newcoop-lamoni', 'Lamoni'], ['newcoop-lanesboro', 'Lanesboro'], ['newcoop-langdon', 'Langdon'],
    ['newcoop-lanyon', 'Lanyon'], ['newcoop-lidderdale', 'Lidderdale'], ['newcoop-lohrville', 'Lohrville'], ['newcoop-luverne', 'LuVerne'],
    ['newcoop-mallard', 'Mallard'], ['newcoop-mapleton', 'Mapleton'], ['newcoop-milford', 'Milford'], ['newcoop-onawa', 'Onawa'],
    ['newcoop-osceola', 'Osceola'], ['newcoop-otho', 'Otho'], ['newcoop-palmer', 'Palmer'], ['newcoop-pierson', 'Pierson'],
    ['newcoop-pomeroy', 'Pomeroy'], ['newcoop-rands', 'Rands'], ['newcoop-redoak', 'Red Oak'], ['newcoop-roelyn', 'Roelyn'],
    ['newcoop-rowan', 'Rowan'], ['newcoop-sloan', 'Sloan'], ['newcoop-superior', 'Superior'], ['newcoop-ute', 'Ute'],
    ['newcoop-villisca', 'Villisca'], ['newcoop-vincent', 'Vincent'], ['newcoop-washta', 'Washta'], ['newcoop-westbend', 'West Bend'],
    ['newcoop-whiting', 'Whiting'], ['newcoop-whittemore', 'Whittemore'], ['newcoop-woolstock', 'Woolstock']
  ];

  /* Sites with a paste reader. The Today page lists every other site as
     "no paste reader yet". */
  var SITES = {
    newcoop: { name: 'NEW Cooperative', page: 'https://www.newcoop.com/cash-bids', hosts: ['newcoop.com'], boards: NEWCOOP_BOARDS }
  };
  /* The site key for a host ("www.newcoop.com" or "newcoop.com"), or null. */
  function siteFor(h) {
    var x = String(h || '').toLowerCase().replace(/^www\./, '');
    if (SITES[x]) return x;
    for (var k in SITES) if (SITES[k].hosts.indexOf(x) >= 0) return k;
    return null;
  }

  var RE = {
    delivery: /^\d{1,2}\/\d{1,2}\/\d{4}\s*-\s*\d{1,2}\/\d{1,2}\/\d{4}$/,
    cash: /^\$?\d{1,3}(?:\.\d{1,4})?$/,
    basis: /^[-+]?\d{1,4}(?:\.\d{1,2})?$/,
    future: /^\d{2,5}-[0-7]$/,
    change: /^(?:[-+]?\d{1,4}-[0-7]|-|unch)$/i,
    commodity: /^[A-Za-z][A-Za-z0-9 #&()\/.,'-]{0,39}$/
  };
  var HEAD = ['commodity', 'delivery', 'cash price', 'basis', 'future price', 'future change'];

  function decode(s) {
    return String(s == null ? '' : s).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  function text(h) {
    return decode(String(h == null ? '' : h).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  }
  function key(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  /* Cloudflare's own signs of a challenge page (not its passive script, which
     their real board carries). A paste of one is refused. */
  function botCheck(s) {
    var b = String(s || '');
    if (/window\._cf_chl_opt\b/.test(b)) return true;
    if (/\/cdn-cgi\/challenge-platform\/h\//.test(b)) return true;
    if (/<title>\s*Just a moment\.\.\.\s*<\/title>/i.test(b)) return true;
    if (/^\s*Just a moment\.\.\.\s*$/m.test(b) && /(Verify you are human|security of your connection|Enable JavaScript and cookies)/i.test(b)) return true;
    return false;
  }

  function cleanRow(c) {
    var r = { commodity: c[0], delivery: c[1], cash: c[2], basis: c[3], future: c[4], change: c[5] || '' };
    for (var f in r) r[f] = String(r[f] == null ? '' : r[f]).replace(/\s+/g, ' ').trim();
    if (!RE.commodity.test(r.commodity) || !RE.delivery.test(r.delivery) || !RE.cash.test(r.cash) ||
        !RE.basis.test(r.basis) || !RE.future.test(r.future)) return null;
    if (r.change && !RE.change.test(r.change)) r.change = '';
    return r;
  }

  /* The page source: same reading as lib/adapters/newcoop.mjs in dnilgis/bids. */
  function parseHtml(html) {
    var s = String(html);
    var start = s.indexOf('<turbo-frame id="cashbids"');
    var body = start >= 0 ? s.slice(start) : s;
    var re = /<h1\s+class="text-4xl[^"]*"\s*>([\s\S]*?)<\/h1>/g, hits = [], m;
    while ((m = re.exec(body))) hits.push({ i: m.index, name: text(m[1]) });
    var out = [];
    hits.forEach(function (h, k) {
      var sec = body.slice(h.i, k + 1 < hits.length ? hits[k + 1].i : undefined);
      var head = [], th = /<th\b[^>]*>([\s\S]*?)<\/th>/g, t;
      while ((t = th.exec(sec))) head.push(text(t[1]).toLowerCase());
      if (HEAD.some(function (c, i) { return head[i] !== c; })) return;
      var rows = [], tr = /<tr>\s*([\s\S]*?)<\/tr>/g, r;
      while ((r = tr.exec(sec))) {
        var tds = [], td = /<td\b[^>]*>([\s\S]*?)<\/td>/g, d;
        while ((d = td.exec(r[1]))) tds.push(text(d[1]));
        if (tds.length < 6) continue;
        var row = cleanRow(tds);
        if (row) rows.push(row);
      }
      out.push({ name: h.name, rows: rows });
    });
    return out;
  }

  /* Select-all text of the same page. Copied tables come out a row per line
     with tabs between cells (Chrome, Edge) or a cell per line (Safari on a
     phone); both are read as one stream of cells. A heading is the cell right
     before "COMMODITY". */
  function parseText(txt) {
    var cells = String(txt).replace(/\r/g, '').split(/\t|\n/).map(function (c) { return c.replace(/\s+/g, ' ').trim(); })
      .filter(function (c) { return c; });
    var out = [], cur = null;
    for (var i = 0; i < cells.length; i++) {
      if (/^commodity$/i.test(cells[i]) && i > 0) {
        var name = cells[i - 1];
        if (cur && cur.rows.length === 0 && cur.name === name) continue;
        cur = { name: name, rows: [] };
        out.push(cur);
        i += 5;   // the rest of the header
        continue;
      }
      if (!cur || !RE.delivery.test(cells[i])) continue;
      var c = [cells[i - 1], cells[i], cells[i + 1], cells[i + 2], cells[i + 3], cells[i + 4]];
      if (c[5] && !RE.change.test(c[5])) c[5] = '';
      var row = cleanRow(c);
      if (row) { cur.rows.push(row); i += row.change ? 4 : 3; }
    }
    return out;
  }

  function parse(input) {
    var s = String(input || '');
    var html = /<turbo-frame\b|<h1\b[^>]*text-4xl|<td\b/i.test(s);
    return { kind: html ? 'page source' : 'copied text', locations: html ? parseHtml(s) : parseText(s) };
  }

  /* Each location to its bids board. "Lu Verne" is "LuVerne", "Creston 1"
     stays Creston 1. A location with no board is listed, not sent. */
  function match(site, locations) {
    var boards = (SITES[site] || {}).boards || [];
    var byKey = {};
    boards.forEach(function (b) { byKey[key(b[1])] = b; });
    var matched = [], unmatched = [], seen = {};
    locations.forEach(function (l) {
      var b = byKey[key(l.name)];
      if (!b) { if (l.rows.length) unmatched.push({ name: l.name, rows: l.rows.length }); return; }
      if (seen[b[0]]) return;
      seen[b[0]] = true;
      matched.push({ id: b[0], name: b[1], printed: l.name, rows: l.rows });
    });
    var missing = boards.filter(function (b) { return !seen[b[0]]; }).map(function (b) { return b[1]; });
    return { matched: matched, unmatched: unmatched, missing: missing };
  }

  /* Everything the preview needs, and the body to save, or why not. */
  function read(site, input) {
    if (!SITES[site]) return { error: 'There is no paste reader for that site yet.' };
    var s = String(input || '');
    if (!s.trim()) return { error: 'Nothing was pasted.' };
    if (botCheck(s)) return { error: 'That is the bot check page, not the bids. Open the page in your own browser, wait for the bids to show, then copy again.' };
    var p = parse(s);
    var m = match(site, p.locations);
    var rows = m.matched.reduce(function (a, l) { return a + l.rows.length; }, 0);
    if (!rows) return { error: 'No bid rows were found in that paste (' + p.kind + ', ' + p.locations.length + ' location heading(s)). Copy the whole page and try again.', kind: p.kind };
    return {
      kind: p.kind, rows: rows, matched: m.matched, unmatched: m.unmatched, missing: m.missing,
      body: { site: site, locations: m.matched.filter(function (l) { return l.rows.length; })
        .map(function (l) { return { name: l.name, rows: l.rows }; }) }
    };
  }

  var api = { SITES: SITES, siteFor: siteFor, NEWCOOP_BOARDS: NEWCOOP_BOARDS, botCheck: botCheck, parseHtml: parseHtml,
              parseText: parseText, parse: parse, match: match, read: read };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AgsistPasteBids = api;
})(typeof window !== 'undefined' ? window : this);
