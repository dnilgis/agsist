/* components/crop-risk.js: "County crop risk", the county's own crop insurance record for corn and soybeans.

   A record of past crop years, not a forecast. Shown on the county Atlas page, the PRF county view and the ARC/PLC
   county page, from the county's Atlas file on the data host (the crop_risk record in it), loaded when the page
   opens. Every number arrives rounded the way it prints; this file formats and never rounds.

   WIRING: <section class="crk" data-crop-risk data-fips="19001" data-place="Adair County" data-h="2"> anywhere on
   the page. Each one is filled once this file loads; a slot added later (the PRF county view) calls
   AgCropRisk.mount(el). The page holds the box (min-height in its .crk style) before this runs.

   Pure functions on window.AgCropRisk (test/crop-risk-section.test.mjs). No em dashes. */
(function (root) {
  'use strict';

  var HOST = 'https://dnilgis.github.io/agsist-data/data/atlas/counties/';
  var CROPS = [['corn', 'Corn', 'corn'], ['soy', 'Soybeans', 'soybeans']];
  var CAUSE = [['drought_heat', 'drought and heat'], ['moisture', 'excess moisture'], ['hail', 'hail'], ['other', 'other']];
  var NA = 'n/a';
  var cache = {};

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  }
  function commas(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function ratio(x) { return x === null || x === undefined ? NA : Number(x).toFixed(2); }
  function cents(x) { return x === null || x === undefined ? NA : '$' + Number(x).toFixed(2); }
  function bushels(x) { return x === null || x === undefined ? NA : Number(x).toFixed(1); }
  /* whole dollars, millions with one decimal */
  function usd(n) {
    if (n >= 1e6) return '$' + (Math.round(n / 1e5) / 10).toFixed(1) + ' million';
    return '$' + commas(Math.round(n));
  }

  /* the crop that opens: corn when it has a record, else soybeans when they do, else corn */
  function pick(rec) {
    if (rec && rec.corn && rec.corn.status === 'ok') return 'corn';
    if (rec && rec.soy && rec.soy.status === 'ok') return 'soy';
    return 'corn';
  }

  function fact(label, value, sub) {
    return '<div class="crk-f"><span>' + label + (sub ? '<small>' + sub + '</small>' : '') + '</span><span class="crk-r">' + value + '</span></div>';
  }

  function causes(c) {
    if (!c.causes) {
      return '<p class="crk-w"><span>What caused the claims</span> not shown: in no year did the cause-of-loss total match the claims record.</p>';
    }
    // whole percents rounded once by the builder (they sum to 100); printed as given
    var parts = CAUSE.map(function (k) { return k[1] + ' ' + c.causes[k[0]] + '%'; });
    return '<p class="crk-w"><span>What caused the claims</span> ' + parts.join(' &middot; ') +
      '<small>share of dollars paid, ' + c.cause_years + ' of ' + c.insured_years + ' years; other is wind, freeze, price decline and the rest</small></p>';
  }

  function table(c, word) {
    var yld = c.yield_years > 0;
    var h = '<details class="crk-d"><summary>Loss ratio by year, ' + word + ', ' + c.first + ' to ' + c.last + '</summary><div class="crk-tw"><table><thead><tr><th scope="col">Crop year</th>' +
      '<th scope="col">Loss ratio</th><th scope="col">Claims per insured acre</th>' + (yld ? '<th scope="col">County yield, bu/ac</th>' : '') + '</tr></thead><tbody>';
    for (var i = 0; i < c.years.length; i++) {
      var r = c.years[i];
      // r[4]: claims topped premium that year, on the dollars (the headline counts the same flag)
      h += '<tr' + (r[4] ? ' class="crk-o"' : '') + '><th scope="row">' + r[0] + '</th><td>' + ratio(r[1]) + '</td><td>' + cents(r[2]) + '</td>' +
        (yld ? '<td>' + bushels(r[3]) + '</td>' : '') + '</tr>';
    }
    return h + '</tbody></table></div><p class="crk-n">Only insured years are listed (premium above $0). n/a: not reported. A bold ratio means claims were more than premium that year. ' +
      'The cause shares count only the years whose cause-of-loss total matches the claims record.</p></details>';
  }

  /* the section's inside for one crop; rec is the county file's crop_risk. With no record (null, or neither crop has
     one) it is '' and the section is hidden: no empty heading, no "no record" line */
  function render(rec, crop, o) {
    o = o || {};
    if (empty(rec) || !rec.corn || !rec.soy) return '';
    var lvl = o.h === 3 ? 3 : 2;
    var place = esc(o.place || 'this county');
    var out = '<h' + lvl + ' class="crk-t">County crop risk</h' + lvl + '>';
    out += '<div class="crk-b" role="group" aria-label="Crop">';
    CROPS.forEach(function (k) {
      out += '<button type="button" data-crk-crop="' + k[0] + '" aria-pressed="' + (k[0] === crop ? 'true' : 'false') + '">' + k[1] + '</button>';
    });
    out += '</div>';
    var meta = CROPS.filter(function (k) { return k[0] === crop; })[0];
    var c = rec[crop];
    if (!c || c.status !== 'ok') {
      var n = c ? c.insured_years : 0;
      out += '<p class="crk-h">Fewer than 10 insured years of ' + meta[2] + ' in ' + place + ' (' + n + '), so no record is shown.</p>';
    } else {
      out += '<p class="crk-h">' + meta[1].replace(/s$/, '') + ' claims topped premium in <b>' + c.loss_years + ' of ' + c.insured_years + '</b> insured years in ' + place + ', ' + c.first + ' to ' + c.last + '.</p>';
      out += fact('Loss ratio, all ' + c.insured_years + ' years', ratio(c.loss_ratio), usd(c.paid) + ' paid on ' + usd(c.premium) + ' of premium');
      out += fact('Median year', ratio(c.median), 'loss ratio of the middle year');
      out += c.per_acre === null || c.per_acre === undefined
        ? fact('Claims paid per insured acre', NA, 'insured acres not reported')
        : fact('Claims paid per insured acre', cents(c.per_acre) + ' a year', 'all years with acres reported (' + c.acre_years + ')');
      out += causes(c);
      out += table(c, meta[2]);
    }
    var nass = rec[crop] && rec[crop].status === 'ok' && rec[crop].yield_years > 0;
    out += '<p class="crk-n">A record of past crop years, not a forecast. Loss ratio: claims paid over total premium, all plans.' +
      (rec.open_year ? ' Crop year ' + esc(rec.open_year) + ' is still being settled and is left out.' : '') + '</p>';
    out += '<p class="crk-s">Source: USDA RMA, Summary of Business and Cause of Loss, crop years 1989 to ' + esc(rec.through) + (nass ? '; county yields, USDA NASS' : '') + '.</p>';
    return out;
  }

  /* true when neither crop has a record to show (the held box then gives its room back: the section sits below the
     first screen on every page that has it, and a tall empty box would be worse) */
  function empty(rec) {
    return !rec || !['corn', 'soy'].some(function (k) { return rec[k] && rec[k].status === 'ok'; });
  }

  function draw(el, rec, crop) {
    if (empty(rec)) {
      el.classList.add('crk-none');
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.innerHTML = render(rec, crop, { h: Number(el.getAttribute('data-h')), place: el.getAttribute('data-place') });
    var bs = el.querySelectorAll('[data-crk-crop]');
    for (var i = 0; i < bs.length; i++) {
      bs[i].addEventListener('click', function (ev) {
        var keep = el.querySelector('.crk-d');
        var open = !!(keep && keep.open);
        draw(el, rec, ev.currentTarget.getAttribute('data-crk-crop'));
        var d = el.querySelector('.crk-d');
        if (d && open) d.open = true;
        var b = el.querySelector('[data-crk-crop][aria-pressed="true"]');
        if (b) b.focus();
      });
    }
  }

  function mount(el) {
    if (!el || el.getAttribute('data-crk-on') === '1') return;
    el.setAttribute('data-crk-on', '1');
    var fips = el.getAttribute('data-fips') || '';
    if (!/^\d{5}$/.test(fips)) { draw(el, null, 'corn'); return; }
    var got = cache[fips] || (cache[fips] = fetch(HOST + fips + '.json').then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }));
    got.then(function (d) {
      var rec = (d && d.crop_risk) || null;
      // the page held the box only for the loading moment (the section sits below the first screen everywhere it is
      // used); filled, it fits its crop, and a crop switch is the reader's own tap
      el.classList.add('crk-done');
      draw(el, rec, pick(rec));
    }).catch(function () {
      delete cache[fips];
      var lvl = el.getAttribute('data-h') === '3' ? 3 : 2;
      el.classList.add('crk-none');
      el.innerHTML = '<h' + lvl + ' class="crk-t">County crop risk</h' + lvl + '><p class="crk-n">The county crop insurance record could not be loaded. Reload the page to try again.</p>';
    });
  }

  function scan() {
    var els = document.querySelectorAll('[data-crop-risk]');
    for (var i = 0; i < els.length; i++) mount(els[i]);
  }

  root.AgCropRisk = { render: render, pick: pick, usd: usd, empty: empty, mount: mount, HOST: HOST };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
  }
})(typeof window !== 'undefined' ? window : this);
