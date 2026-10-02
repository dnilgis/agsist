#!/usr/bin/env python3
"""patch_home_r7_bids.py -- r7 "bids" area of the AGSIST homepage overhaul (2026-10-01).

usage: python3 patch_home_r7_bids.py --repo DIR

Runs after the cutover (and after r7-prices / r7-season), before
scripts/bake_homepage.py. Patches IN PLACE, only files this area owns:
  index.html                      Cash Bids card, The Read, the Wire, the rail
                                  (USDA reports, Grain Stocks card, COT, Yield
                                  Nowcast, Call Scorecard, Price Alert), signup,
                                  FAQ (+ its FAQPage JSON-LD), footer strip
  components/bids-homepage.js     v17 -> v18
  components/homepage-extras.js   v2  -> v3
Every anchor must match exactly once or the script exits naming it. A second
run is refused (marker check on all three files).
"""
import os, re, sys

MARK = 'r7-bids'

def once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        sys.exit('ANCHOR %s matched %d times, expected 1' % (label, n))
    return text.replace(old, new)

def times(text, old, new, k, label):
    n = text.count(old)
    if n != k:
        sys.exit('ANCHOR %s matched %d times, expected %d' % (label, n, k))
    return text.replace(old, new)

def rx_once(text, pattern, repl, label, flags=re.S):
    m = list(re.finditer(pattern, text, flags))
    if len(m) != 1:
        sys.exit('ANCHOR %s matched %d times, expected 1' % (label, len(m)))
    return text[:m[0].start()] + (repl(m[0]) if callable(repl) else repl) + text[m[0].end():]

def rd(root, p):
    with open(os.path.join(root, p), encoding='utf-8', newline='') as f:
        return f.read()

def wr(root, p, s):
    with open(os.path.join(root, p), 'w', encoding='utf-8', newline='') as f:
        f.write(s)

# ───────────────────────────────────────────── components/bids-homepage.js
JS_RENDER = r'''  // ── Render one elevator (compact, for homepage card) ────────────
  /* r7-bids 2026-10-01: rows are grouped by DELIVERY PERIOD inside each
     elevator ("Oct 2026", then the crops priced for it), so the period is
     said once and a reader compares crops for the same haul. The distance
     sits on the town line and says what it is: the elevator network's miles
     are straight-line (haversine in bids-network.js), not road miles. The
     licensed feed's distance is its own and is labelled as from the ZIP. */
  function delLabel(b){ return b.deliveryMonth || b.deliveryStart || 'Spot'; }
  function renderElevatorHTML(elev){
    var cityState = (elev.city||'') + (elev.city && elev.state ? ', ' : '') + (elev.state||'');
    var distStr = elev.distance != null
      ? elev.distance.toFixed(0) + ' mi ' + (elev.fromNetwork ? 'straight-line' : 'from your ZIP')
      : '';

    var html = '<div class="bh-elev" style="padding:.55rem 0;border-bottom:1px solid var(--border)">';

    // Elevator header
    html += '<div style="min-width:0;margin-bottom:.3rem">';
    html += '<div style="font-size:.95rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(elev.facility) + '</div>';
    var sub = [];
    if(cityState) sub.push(escHtml(cityState));
    if(distStr) sub.push('<span class="r7-mi" style="font-family:\'JetBrains Mono\',monospace">' + distStr + '</span>');
    if(elev.fromNetwork) sub.push('<span style="color:var(--green)">direct from elevator</span>');
    if(sub.length) html += '<div style="font-size:.75rem;color:var(--text-muted)">' + sub.join(' &middot; ') + '</div>';
    html += '</div>';

    // Every shown row, capped per crop as before, then grouped by period.
    var rows = [], over = [];
    COMM_ORDER.forEach(function(cat){
      var catBids = (elev.commodities[cat] || []).slice();
      if(!catBids.length) return;
      catBids.sort(function(a,b){
        return (rowMonthKey(a) || '9999').localeCompare(rowMonthKey(b) || '9999') || delLabel(a).localeCompare(delLabel(b));
      });
      catBids.slice(0, MAX_BIDS_PER_COMMODITY).forEach(function(b){ rows.push({ b: b, cat: cat }); });
      if(catBids.length > MAX_BIDS_PER_COMMODITY) over.push((catBids.length - MAX_BIDS_PER_COMMODITY) + ' more ' + COMM_NAMES[cat].toLowerCase());
    });
    var groups = [], byLabel = {};
    rows.forEach(function(r){
      var lab = delLabel(r.b);
      if(!byLabel[lab]){ byLabel[lab] = { label: lab, key: rowMonthKey(r.b) || '9999', rows: [] }; groups.push(byLabel[lab]); }
      byLabel[lab].rows.push(r);
    });
    groups.sort(function(a,b){ return a.key.localeCompare(b.key) || a.label.localeCompare(b.label); });

    groups.forEach(function(g){
      html += '<div class="r7-per" style="font-family:\'JetBrains Mono\',monospace;font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin:.45rem 0 .1rem">' + escHtml(g.label) + '</div>';
      g.rows.sort(function(a,b){ return COMM_ORDER.indexOf(a.cat) - COMM_ORDER.indexOf(b.cat); });
      g.rows.forEach(function(r){
        var bid = r.b, cat = r.cat;
        var perTon = notPerBushel(bid);
        var pp = perTon ? null : ppu(bid.cashPrice);
        var cashStr = pp != null ? '$' + pp.toFixed(2) : '—';
        var basis = perTon ? { str:'—', cls:'muted' } : formatBasis(bid.basis);
        var grade = String(bid.commodity || '').trim();
        var special = isSpecialGrade(bid);
        var sameAsCrop = grade.toLowerCase() === String(COMM_NAMES[cat] || '').toLowerCase() || grade.toLowerCase() === cat;
        var cropTxt = (cat === 'other' && grade) ? grade : COMM_NAMES[cat];
        var gradeTxt = cat === 'other'
          ? (perTon ? 'per ton, not per bushel' : special ? 'special grade' : '')
          : (sameAsCrop && !perTon && !special) ? '' : grade
            + (perTon ? (grade ? ' · ' : '') + 'per ton, not per bushel' : '')
            + (special && !perTon ? (grade ? ' · ' : '') + 'special grade' : '');
        /* A special grade's basis is not the futures grade's basis: no red or green on it. */
        var bColor = special ? 'var(--text-muted)' : basis.cls === 'pos' ? 'var(--green)' : basis.cls === 'neg' ? 'var(--red,#ef4444)' : 'var(--text-muted)';
        /* The contract the basis is against: named by the licensed feed's
           symbol when it sends one, otherwise checked against the page's
           own futures file by fillRefs() below. Never guessed. */
        var refAttr = '', refTxt = '';
        if(!perTon && !special && basis.str !== '—'){
          var rm = refMonth(bid.symbol);
          if(rm) refTxt = 'basis vs ' + rm;
          else if(pp != null && bid.basis != null && REF_KEY[cat]){
            var ek = refEndKey(bid, cat);
            if(ek) refAttr = ' data-ref-crop="' + cat + '" data-ref-end="' + ek + '" data-ref-imp="' + (pp - basisCents(bid.basis) / 100).toFixed(4) + '"' + (bid.checkedAt ? ' data-ref-read="' + escHtml(String(bid.checkedAt)) + '"' : '');
          }
        }

        html += '<div style="display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:.1rem .6rem;align-items:baseline;padding:.15rem 0">';
        html += '<span style="min-width:0"><span style="display:block;font-size:.85rem;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(cropTxt) + '</span>'
          + '<span class="r7-ref"' + refAttr + ' style="display:block;font-size:.75rem;color:var(--text-muted)">' + escHtml(refTxt) + '</span></span>';
        html += '<span style="font-family:\'JetBrains Mono\',monospace;font-size:1.05rem;font-weight:700;color:var(--text);text-align:right;white-space:nowrap">' + cashStr + '</span>';
        html += '<span style="font-family:\'JetBrains Mono\',monospace;font-size:.85rem;font-weight:700;color:' + bColor + ';text-align:right;white-space:nowrap;min-width:48px">' + basis.str + '</span>';
        if(gradeTxt){
          html += '<span style="grid-column:1/-1;font-size:.75rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(gradeTxt) + '</span>';
        }
        var bc = perTon || special ? null : boardCarry(bid);
        if(bc){
          html += '<span class="r7-carry" style="grid-column:1/-1;font-size:.75rem;color:var(--text-muted)">Board carry ' + escHtml(bc.from) + ' \u2192 ' + escHtml(bc.to) + ': <span style="font-family:\'JetBrains Mono\',monospace;color:var(--text-dim)">' + bc.txt + '</span> (this elevator\u2019s board)</span>';
        }
        html += '</div>';
      });
    });

    if(over.length){
      html += '<div style="font-size:.75rem;color:var(--text-muted);padding:.1rem 0">+' + escHtml(over.join(', ')) + '</div>';
    }

    // Watch this elevator. Scoped to corn -- the page's headline commodity --
    // and only offered when this elevator actually has a real, priced corn
    // bid; there is nothing honest to watch at an elevator with no corn row.
    var cornBids = elev.commodities.corn;
    if(cornBids && cornBids.length && elev.state && elev.facility){
      var wid = widFor(elev.state, elev.facility, elev.city, 'corn');
      var label = escHtml(elev.facility + (cityState ? ', ' + cityState : '') + ' — corn');
      html += '<div class="watch-elevator-wrap" data-wid="' + wid + '" data-label="' + label + '" style="margin-top:.35rem">'
        + '<button type="button" class="watch-elevator-btn" style="background:none;border:none;padding:0;font-size:.75rem;color:var(--text-muted);text-decoration:underline;cursor:pointer;min-height:44px">Watch this elevator — free</button>'
        + '</div>';
    }

    html += '</div>';
    return html;
  }

  /* r7-bids 2026-10-01: THE FUTURES MONTH A NETWORK BASIS IS QUOTED AGAINST.
     The elevator boards do not name it. The month the trade prices a
     delivery against is the first listed contract month on or after the end
     of the delivery window (corn Mar May Jul Sep Dec; soybeans Jan Mar May
     Jul Aug Sep Nov; Chicago wheat Mar May Jul Sep Dec). That month is
     printed only when the board's own cash minus its own basis lands within
     REF_TOL of that contract in data/prices.json. A Kansas HRW board quoted
     off Kansas City fails the Chicago check and prints nothing, which is
     right: the page has no dated KC contract to name. */
  var REF_CYCLE = { corn:[3,5,7,9,12], soybeans:[1,3,5,7,8,9,11], wheat:[3,5,7,9,12] };
  var REF_KEY = { corn:'corn', soybeans:'beans', wheat:'wheat' };
  var REF_TOL = 0.08;
  var MON_LC = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  function refEndKey(b, cat){
    var p = String(b.deliveryStart || '');
    var m = /^(\d{4})-(\d{2})(?:\/(\d{4})-(\d{2}))?/.exec(p);
    if(m) return m[3] ? m[3] + '-' + m[4] : m[1] + '-' + m[2];
    var nc = /^newcrop-(\d{4})$/.exec(p);
    if(nc) return nc[1] + (cat === 'wheat' ? '-07' : '-10');
    return rowMonthKey(b) || '';
  }
  function refCandidate(cat, endKey){
    var m = /^(\d{4})-(\d{2})$/.exec(endKey || ''); if(!m || !REF_CYCLE[cat]) return null;
    var y = +m[1], mo = +m[2], cyc = REF_CYCLE[cat], pick = null;
    for(var i = 0; i < cyc.length; i++){ if(cyc[i] >= mo){ pick = cyc[i]; break; } }
    if(pick == null){ pick = cyc[0]; y += 1; }
    var yy = String(y).slice(-2);
    return { key: REF_KEY[cat] + '-' + MON_LC[pick - 1] + yy, label: MON[pick - 1] + ' \'' + yy + ' ' + (cat === 'soybeans' ? 'soybeans' : cat) };
  }
  /* r7-bids 7b: THE ELEVATOR'S OWN CARRY. merged-index.json carries, per
     place and crop, `now` (nearest open delivery) and `best` (its top cash
     across every period it posts). When `best` is a LATER period at the same
     board, the difference is the carry that elevator is paying today, in its
     own numbers. Earlier or same-period `best` says nothing about carry and
     is not used. */
  function periodStart(p){ var m = /^(\d{4})-(\d{2})/.exec(String(p || '')); return m ? m[1] + '-' + m[2] : ''; }
  function periodEnd(p){ var m = /^(\d{4})-(\d{2})(?:\/(\d{4})-(\d{2}))?/.exec(String(p || '')); return m ? (m[3] ? m[3] + '-' + m[4] : m[1] + '-' + m[2]) : ''; }
  function shortMon(k){ var m = /^(\d{4})-(\d{2})$/.exec(k || ''); return m ? MON[+m[2] - 1] + ' \'' + m[1].slice(2) : ''; }
  function monthsApart(a, b){ var x = /^(\d{4})-(\d{2})$/.exec(a), y = /^(\d{4})-(\d{2})$/.exec(b); return (x && y) ? (+y[1] - +x[1]) * 12 + (+y[2] - +x[2]) : null; }
  function quarterCents(c){ var a = Math.abs(c), w = Math.floor(a + 1e-9), f = Math.round((a - w) * 4); if(f === 4){ w++; f = 0; } return w + (f ? ' ' + ['', '1/4', '1/2', '3/4'][f] : ''); }
  function boardCarry(b){
    if(b.source !== 'network' || b.bestCash == null || b.cashPrice == null) return null;
    var s0 = periodStart(b.deliveryStart), e0 = periodEnd(b.deliveryStart), s1 = periodStart(b.bestPeriod);
    if(!s0 || !s1 || s1 <= e0) return null;
    /* A later period in the NEXT crop year (wheat from June, corn and
       soybeans from September) is new crop, not storage carry. */
    var y0 = +s0.slice(0, 4), m0 = +s0.slice(5, 7), ncm = b.category === 'wheat' ? 6 : 9;
    if(b.category !== 'corn' && b.category !== 'soybeans' && b.category !== 'wheat') return null;
    if(s1 >= (m0 < ncm ? y0 : y0 + 1) + '-' + (ncm < 10 ? '0' : '') + ncm) return null;
    var c = (b.bestCash - b.cashPrice) * 100;
    return { from: shortMon(s0), to: shortMon(s1), fromKey: s0, toKey: s1, months: monthsApart(s0, s1),
             cents: c, fromCash: b.cashPrice, toCash: b.bestCash,
             txt: Math.abs(c) < 0.125 ? 'even' : (c > 0 ? '+' : '−') + quarterCents(c) + '¢' };
  }
  function pricesOnce(){
    if(!window.__agsistPricesP){
      window.__agsistPricesP = fetch('/data/prices.json', { cache: 'no-store' })
        .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
    }
    return window.__agsistPricesP;
  }
  function fillRefs(area){
    pricesOnce().then(function(pd){
      var q = (pd && pd.quotes) || {}, n = 0, used = {}, oldest = '';
      var els = area.querySelectorAll('.r7-ref[data-ref-crop]');
      for(var i = 0; i < els.length; i++){
        var el = els[i], crop = el.getAttribute('data-ref-crop'), cand = refCandidate(crop, el.getAttribute('data-ref-end'));
        var imp = parseFloat(el.getAttribute('data-ref-imp'));
        var fq = cand && q[cand.key];
        if(!fq || fq.close == null || !isFinite(imp)) continue;
        /* 7b: the conventional month must also be the NEAREST listed
           contract to cash minus basis, and within 8 cents. Dec and Mar
           corn sit 14 1/4 cents apart; 15 cents could not tell them apart. */
        var best = null, bestD = Infinity, re = new RegExp('^' + REF_KEY[crop] + '-[a-z]{3}\\d{2}$');
        Object.keys(q).forEach(function(k){ if(!re.test(k) || !q[k] || q[k].close == null) return; var d = Math.abs(q[k].close / 100 - imp); if(d < bestD){ bestD = d; best = k; } });
        if(best !== cand.key || bestD > REF_TOL) continue;
        el.textContent = 'basis vs ' + cand.label;
        used[cand.label] = fq.close / 100;
        var rdt = el.getAttribute('data-ref-read') || ''; if(rdt && (!oldest || rdt < oldest)) oldest = rdt;
        n++;
      }
      var note = area.querySelector('.r7-ref-note');
      if(note && n){
        /* 7b: the boards and the futures file are read at different times;
           say both, with the futures level the page actually has. */
        var fut = Object.keys(used).map(function(l){ return l + ' $' + used[l].toFixed(2); }).join(', ');
        var ft = ctTime(pd && pd.fetched), bt = ctTime(oldest);
        note.textContent = 'A basis month is shown only where the board\u2019s cash minus its basis is nearest that futures contract on this page, within 8\u00a2.'
          + (ft ? ' Futures on this page: ' + fut + ' at ' + ft + (bt ? '; the boards were read ' + bt + ', so cash minus basis will not equal those prices exactly.' : '.') : '');
        note.hidden = false;
      }
    });
  }

'''

def patch_bids_js(s):
    s = once(s, "// bids-homepage.js — Homepage Cash Bids Preview\n",
             "// bids-homepage.js — Homepage Cash Bids Preview\n// r7-bids 2026-10-01: rows grouped by delivery period, basis contract named, straight-line miles.\n",
             'bids-js header')
    # The licensed feed's symbol names the contract; say the year too.
    s = rx_once(s, r"  function refMonth\(sym\)\{\n.*?\n  \}\n",
                "  function refMonth(sym){\n"
                "    var m = /^([A-Z]{1,3})([FGHJKMNQUVXZ])(\\d{2})$/.exec(String(sym || '').trim().toUpperCase());\n"
                "    if(!m) return '';\n"
                "    var crop = /^Z[CS]$/.test(m[1]) ? (m[1] === 'ZC' ? ' corn' : ' soybeans') : (WHEAT_EXCH[m[1]] ? ' ' + WHEAT_EXCH[m[1]] + ' wheat' : '');\n"
                "    return FUT_MON[m[2]] + ' \\'' + m[3] + crop;\n"
                "  }\n", 'bids-js refMonth')
    s = rx_once(s, r"  // ── Render one elevator \(compact, for homepage card\) ────────────\n.*?(?=  // ── Distance between two real points, in miles)",
                JS_RENDER, 'bids-js renderElevatorHTML')
    s = once(s, "+ '<span>Delivery</span><span style=\"text-align:right\">Cash</span>",
             "+ '<span>Crop</span><span style=\"text-align:right\">Cash</span>", 'bids-js column head')
    s = once(s, "          html += '<div class=\"bids-read-time\"",
             "          html += '<div class=\"r7-ref-note\" hidden>A basis month is shown only where the board\\u2019s cash minus its basis matches that futures contract on this page, within 15\\u00a2.</div>';\n"
             "          html += '<div class=\"bids-read-time\"", 'bids-js ref note')
    s = once(s, "        area.innerHTML = html;\n",
             "        area.innerHTML = html;\n        fillRefs(area);\n", 'bids-js fillRefs call')
    s = once(s, "  var NET_SCRIPT = '/components/bids-network.js?v=2';", "  var NET_SCRIPT = '/components/bids-network.js?v=3';", 'bids-js net v')
    s = once(s, "            lat: typeof r.lat === 'number' ? r.lat : null,\n",
             "            bestCash: r.bestCash == null ? null : r.bestCash, bestPeriod: r.bestPeriod || '',   // r7-bids 7b: the board's own later period\n"
             "            lat: typeof r.lat === 'number' ? r.lat : null,\n", 'bids-js best fields')
    s = once(s, "        ts: Date.now()\n", "        boardCarry: boardCarry(best),   // r7-bids 7b\n        ts: Date.now()\n", 'bids-js summary carry')
    s = once(s, "      geoTxt.textContent = label ? label : ('ZIP ' + zip);\n",
             "      geoTxt.textContent = label ? label : ('ZIP ' + zip);\n"
             "      /* r7-bids 7b: a ZIP is set, so the button changes it. */\n"
             "      var zb = document.getElementById('bids-enter-zip-btn');\n"
             "      if(zb){ zb.textContent = 'Change ZIP'; zb.setAttribute('aria-label', 'Change the ZIP code for nearby cash bids'); }\n", 'bids-js change zip')
    s = once(s, "'Get the AGSIST Daily in your inbox every morning →</a></div>'",
             "'Get the AGSIST Daily in your inbox every weekday →</a></div>'", 'bids-js cta weekday')
    return s

# ───────────────────────────────────────────── components/bids-network.js
def patch_net_js(s):
    s = once(s, "/* bids-network.js — read the live elevator scrape, in the browser.\n",
             "/* bids-network.js — read the live elevator scrape, in the browser.\n * r7-bids 2026-10-01: rows also carry the board's own later-period bid (best).\n", 'net header')
    s = once(s, "      basisCents: n.basisCents,\n",
             "      basisCents: n.basisCents,\n"
             "      /* r7-bids: the same board's top bid across its posted periods, and\n"
             "         which period. The card uses it only when that period is LATER\n"
             "         than this row's: the elevator's own carry, in its own numbers. */\n"
             "      bestCash: (p.best && p.best[crop] && p.best[crop].cash != null) ? p.best[crop].cash : null,\n"
             "      bestPeriod: (p.best && p.best[crop] && p.best[crop].period) || '',\n", 'net best')
    return s

# ───────────────────────────────────────────── components/homepage-extras.js
EXTRAS_CARRY = r'''
  /* r7-bids 2026-10-01 (7b): THE CARRY BOX STARTS FROM THE ELEVATOR'S OWN
     BOARD. When the looked-up elevator posts a later delivery for the same
     crop (bids-homepage.js publishes it as sum.boardCarry), that difference
     is the carry, labelled with both periods. Only when the board posts no
     later period does it fall back to the Dec-to-Mar corn futures spread,
     labelled as futures carry with basis change excluded. Either way the
     note says which months the carry covers, and the result line says so
     when "months you would store" differs. Nothing is scaled. */
  var carryCover = null;   // {months, from, to} of the prefilled carry
  function carryCaveat(months){
    var el = $('idx1-calc-carry');
    if(!carryCover || !el || el.dataset.autofilled !== 'true' || carryCover.months == null || months === carryCover.months) return '';
    return ' The carry above covers ' + carryCover.from + ' to ' + carryCover.to + ' (' + carryCover.months + ' month' + (carryCover.months === 1 ? '' : 's') + '), not your ' + months + '; it is not scaled.';
  }
  function qc(c){ var a = Math.abs(c), w = Math.floor(a + 1e-9), f = Math.round((a - w) * 4); if(f === 4){ w++; f = 0; } return w + (f ? ' ' + ['', '1/4', '1/2', '3/4'][f] : '') + '¢'; }
  function prefillCarry(sum){
    var carryEl = $('idx1-calc-carry'), card = $('idx1-store-sell');
    if(!carryEl || !card || !sum || sum.crop !== 'corn') return;
    var note = $('idx1-calc-carry-src');
    if(!note){ note = document.createElement('div'); note.id = 'idx1-calc-carry-src'; note.className = 'idx1-extras-fine';
      var res = $('idx1-calc-result'); if(res && res.parentNode) res.parentNode.insertBefore(note, res); }
    function fill(v){
      if(carryEl.value === '' || carryEl.dataset.autofilled === 'true'){
        carryEl.value = v; carryEl.dataset.autofilled = 'true';
      }
      calcStoreOrSell();
    }
    var bc = sum.boardCarry;
    if(bc && bc.from && bc.to && isFinite(bc.cents)){
      if(bc.cents <= 0){
        carryCover = null;
        note.textContent = 'This elevator’s board pays ' + qc(bc.cents) + ' less for ' + bc.to + ' than ' + bc.from + ': no carry on its own board, so the box is left for your number.';
        return;
      }
      carryCover = { months: bc.months, from: bc.from, to: bc.to };
      note.textContent = 'Carry from the board at ' + String(sum.where || 'this elevator') + ' (the bid filled above): ' + bc.from + ' $' + (+bc.fromCash).toFixed(2) + ' → ' + bc.to + ' $' + (+bc.toCash).toFixed(2) + ', +' + qc(bc.cents) + ' per bu' + (bc.months != null ? ', covering ' + bc.months + ' month' + (bc.months === 1 ? '' : 's') : '') + '.';
      fill((bc.cents / 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
      return;
    }
    var p = window.__agsistPricesP || (window.__agsistPricesP = fetch('/data/prices.json', { cache: 'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; }));
    p.then(function(pd){
      var q = (pd && pd.quotes) || {}, dec = q['corn-dec'];
      var m = dec && /^ZCZ(\d{2})\./.exec(String(dec.ticker || ''));
      var my = m ? ('0' + (+m[1] + 1)).slice(-2) : '';
      var mar = m ? q['corn-mar' + my] : null;
      if(!dec || dec.close == null || !mar || mar.close == null){
        carryCover = null;
        note.textContent = 'Carry: this elevator posts no later corn bid, and the futures spread is not loaded yet. Enter your own.'; return;
      }
      var c = mar.close - dec.close, yy = m[1], when = '';
      try{ var d = new Date(pd.fetched); if(!isNaN(d)) when = d.toLocaleString('en-US', {month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZone:'America/Chicago'}) + ' CT'; }catch(e){}
      if(c <= 0){
        carryCover = null;
        note.textContent = 'This elevator posts no later corn bid, and Mar \'' + my + ' corn futures are ' + qc(c) + ' under Dec \'' + yy + ': no futures carry either. Enter your own.';
        return;
      }
      carryCover = { months: 3, from: 'Dec \'' + yy, to: 'Mar \'' + my };
      note.textContent = 'This elevator posts no later corn bid. Futures carry Dec \'' + yy + ' → Mar \'' + my + ' only, ' + qc(c) + ' per bu' + (when ? ' at ' + when : '') + '; basis gain not included.';
      fill((c / 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
    });
  }
'''

def patch_extras_js(s):
    s = once(s, " * AGSIST homepage extras — added 2026-09-30.\n",
             " * AGSIST homepage extras — added 2026-09-30.\n * r7-bids 2026-10-01: carry prefilled from the Dec-Mar corn futures spread.\n",
             'extras header')
    s = once(s, "  function onBidsPublished(evt){\n", EXTRAS_CARRY + "\n  function onBidsPublished(evt){\n", 'extras carry fn')
    s = once(s, "    renderBasisChart(sum);\n  }\n", "    renderBasisChart(sum);\n    prefillCarry(sum);\n  }\n", 'extras carry call')
    s = once(s, "    var totalCost = cost * months, net = carry - totalCost;\n",
             "    var totalCost = cost * months, net = carry - totalCost, cav = carryCaveat(months);\n", 'extras caveat var')
    s = once(s, "' now, if your carry estimate holds.';", "' now, if your carry estimate holds.' + cav;", 'extras caveat 1')
    s = once(s, "' now, at these numbers.';", "' now, at these numbers.' + cav;", 'extras caveat 2')
    s = once(s, "'Breakeven — storing and selling now cost the same at these numbers.';", "'Breakeven — storing and selling now cost the same at these numbers.' + cav;", 'extras caveat 3')
    s = once(s, "    if(el) el.addEventListener('input', calcStoreOrSellDebounced);\n",
             "    if(el) el.addEventListener('input', function(){ el.dataset.autofilled = 'false'; calcStoreOrSellDebounced(); });\n",
             'extras typed marks not-autofilled')
    return s

# ───────────────────────────────────────────── index.html
CSS = r'''<style>
/* ===== 2026-10-01 r7-bids: Cash Bids, The Read, the Wire, rail, signup, FAQ, footer ===== */
/* Claim line: a quiet ruled row at the foot of the bids card. Not ad orange: it is not paid space. */
#f1 .r7-claim{display:flex;align-items:center;min-height:44px;margin-top:12px;padding-top:8px;border-top:1px solid var(--hair);font-size:.8rem;color:var(--text-dim);text-decoration:none}
#f1 .r7-claim:hover,#f1 .r7-claim:focus-visible{color:var(--text);text-decoration:underline}
#bids-list-area .r7-ref-note{font-size:.75rem;color:var(--text-muted);padding:.4rem 0 0}
#idx1-calc-carry-src{margin:.25rem 0 .4rem}
/* The Read: "61st percentile", one word, no gap */
#f-read .r7-ord{font-size:.5em;font-weight:700}
#f-read .sig-price:not([data-r7]){visibility:hidden}
#f-read .r7-barcap{font-family:'JetBrains Mono',monospace;font-size:.75rem;color:var(--text-muted)}
/* Rail */
#cot-rows .r7-cot-px{font-family:'JetBrains Mono',monospace;font-size:.75rem;color:var(--text-muted);margin-top:4px;font-variant-numeric:tabular-nums}
#cot-rows .r7-up{color:var(--green)}#cot-rows .r7-dn{color:var(--red)}
#cot-rows .r7-dim{opacity:.85}
/* Light theme: darker up/down for these small figures, measured to 4.5:1 on the widget. */
html[data-theme="light"] #cot-rows .cot-dir.short,html[data-theme="light"] #cot-rows .cot-chg.dn{color:var(--red)}
html[data-theme="light"] #cot-rows .r7-up{color:#23663f}html[data-theme="light"] #cot-rows .r7-dn{color:#9a3620}
.r7-nc-usda{font-family:'JetBrains Mono',monospace;font-size:.75rem;color:var(--text-muted);margin-top:4px;font-variant-numeric:tabular-nums}
#r7-pa-now{font-family:'JetBrains Mono',monospace;font-size:.75rem;color:var(--text-muted);min-height:1.1em;font-variant-numeric:tabular-nums}
@media(max-width:600px){
  #f-price-alert select,#f-price-alert input,#f-price-alert button{min-height:44px;font-size:16px!important}
}
/* Signup: one row on desktop (email + button), stacked on a phone */
#signup-full .signup-row{display:flex;flex-direction:row;flex-wrap:nowrap;gap:8px;align-items:stretch}
#signup-full .signup-row .signup-input{flex:1 1 auto!important;min-width:0;min-height:44px}
#signup-full .signup-row .signup-submit{flex:none;min-height:44px}
#signup-compact .scu-input,#signup-compact .scu-btn{min-height:44px}
@media(max-width:600px){
  #signup-full .signup-row{flex-direction:column}
  #signup-full .signup-row .signup-input{font-size:16px;width:100%}
  #signup-full .signup-row .signup-submit{width:100%}
  #signup-compact .scu-input{font-size:16px}
}
/* Footer strip: the "Open" tag sat orange on the orange slot. Dark ink on
   the orange, both themes (the same #0d1117 the briefing's orange buttons use). */
footer .ad-slot--lead .ad-slot-tag{color:#0d1117;border-color:rgba(13,17,23,.55)}
html[data-theme="light"] footer .ad-slot--lead .ad-slot-pitch,html[data-theme="light"] footer .ad-slot--lead .ad-slot-cta{color:#0d1117}
</style>
'''

JS_INLINE = r'''<script>
/* ===== 2026-10-01 r7-bids: rail and footer, read from the page's own data files ===== */
(function(){
  'use strict';
  function $(i){return document.getElementById(i);}
  function get(u){return fetch(u,{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;});}
  function pricesOnce(){
    if(!window.__agsistPricesP){window.__agsistPricesP=get('/data/prices.json');}
    return window.__agsistPricesP;
  }
  var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var CODE={F:0,G:1,H:2,J:3,K:4,M:5,N:6,Q:7,U:8,V:9,X:10,Z:11};
  /* "ZCZ26.CBT" -> "Dec '26". A continuous ticker (ZC=F) names no month. */
  function tickMonth(t){var m=/^[A-Z]{2,3}([FGHJKMNQUVXZ])(\d{2})\./.exec(String(t||''));return m?MON[CODE[m[1]]]+" '"+m[2]:'';}
  /* The contract a continuous or alias quote is today: the dated contract in
     the same file carrying the identical close, open and change, or the
     repair note the price pipeline writes. Empty when neither says. */
  function contractOf(q,key){
    var x=q[key];if(!x)return '';
    var own=tickMonth(x.ticker);if(own)return own;
    if(x.contract)return x.contract;
    if(x.repaired_from&&q[x.repaired_from])return tickMonth(q[x.repaired_from].ticker);
    var hit='';
    Object.keys(q).forEach(function(k){var y=q[k];if(hit||!y||k===key||!/-[a-z]{3}\d{2}$/.test(k))return;
      if(k.split('-')[0]!==key.split('-')[0])return;
      if(y.close===x.close&&y.open===x.open&&y.netChange===x.netChange)hit=tickMonth(y.ticker);});
    return hit;
  }
  function ctStamp(iso){var d=new Date(iso);if(!iso||isNaN(d))return '';
    try{return d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Chicago'})+' CT';}catch(e){return '';}}
  /* 34.75 cents -> "34 3/4" (the ticker's own way of writing eighths of a cent). */
  function cents(c){var a=Math.abs(c),w=Math.floor(a+1e-9),f=Math.round((a-w)*4);if(f===4){w++;f=0;}
    return w+(f?(' '+['','1/4','1/2','3/4'][f]):'');}
  var MINUS='−';
  window.__r7={pricesOnce:pricesOnce,contractOf:contractOf,ctStamp:ctStamp,cents:cents,tickMonth:tickMonth};

  /* COT: what price did since the positions were taken. cot.json's `price` is
     the Tuesday close of the front-month continuous series (ZC=F and so on,
     scripts/enrich_cot_prices.py); the comparison is that same ticker's
     latest close in data/prices.json, so both ends are one series. If the
     tickers do not match, nothing is printed. */
  var COTMAP=[['corn','corn','corn','ZC=F','c'],['beans','beans','beans','ZS=F','c'],['wheat','wheat','wheat','ZW=F','c'],['cattle','livecattle','cattle','LE=F','cwt']];
  Promise.all([get('/data/cot.json'),pricesOnce()]).then(function(R){
    var cot=R[0],pd=R[1];if(!cot||!pd||!pd.quotes)return;
    var q=pd.quotes,rd=new Date(cot.report_date);if(isNaN(rd))return;
    var rds=MON[rd.getMonth()]+' '+rd.getDate();
    COTMAP.forEach(function(m){
      var row=document.querySelector('#cot-rows .cot-row-'+m[0]);var c=cot[m[1]],x=q[m[2]];
      if(!row||!c||c.price==null||!x||x.close==null||x.ticker!==m[3])return;
      var d=x.close-c.price,mon=contractOf(q,m[2]);
      var txt=m[4]==='c'?(d===0?'unchanged':(d>0?'+':MINUS)+cents(d)+'¢ per bu'):(Math.abs(d)<0.005?'unchanged':(d>0?'+':MINUS)+'$'+Math.abs(d).toFixed(2)+' per cwt');
      var el=row.querySelector('.r7-cot-px');if(!el){el=document.createElement('div');el.className='r7-cot-px';row.appendChild(el);}
      el.innerHTML='Price since '+rds+': <span class="'+(d>0?'r7-up':d<0?'r7-dn':'')+'">'+txt+'</span>'+(mon?' <span class="r7-dim">front month, now '+mon+'</span>':'');
    });
  });

  /* Price alert: name the contract on every option, and an example target
     that today's price has not already crossed. */
  var BASE={'corn':'Corn, front month','corn-dec':'Corn','beans':'Soybeans, front month','beans-nov':'Soybeans','wheat':'Wheat, front month','cattle':'Live cattle, front month'};
  window.__r7paLabel=function(v){var o=document.querySelector('#pa-symbol option[value="'+v+'"]');return o?(o.getAttribute('data-short')||o.textContent):v;};
  pricesOnce().then(function(pd){
    var sel=$('pa-symbol'),dir=$('pa-direction'),tgt=$('pa-target'),now=$('r7-pa-now');if(!sel||!pd||!pd.quotes)return;
    var q=pd.quotes,stamp=ctStamp(pd.fetched);
    /* 7b: a front-month option that is the same contract as a dated one is
       a duplicate; the dated one stays, because it does not roll. */
    [['corn','corn-dec'],['beans','beans-nov']].forEach(function(pr){var a=contractOf(q,pr[0]),b=contractOf(q,pr[1]);
      if(a&&a===b){var o=sel.querySelector('option[value="'+pr[0]+'"]');if(o){if(sel.value===pr[0])sel.value=pr[1];o.parentNode.removeChild(o);}}});
    Array.prototype.forEach.call(sel.options,function(o){var k=o.value,mon=contractOf(q,k);if(!mon||!BASE[k])return;
      var dated=/-[a-z]{3}$/.test(k);
      o.textContent=dated?BASE[k]+' '+mon:BASE[k]+' (now '+mon+', follows the roll)';
      o.setAttribute('data-short',dated?BASE[k]+' '+mon:BASE[k]);});
    function ex(){var x=q[sel.value];
      if(!x||x.close==null){tgt.placeholder='Target';if(now)now.textContent='';return;}
      var p=x.close/(sel.value==='cattle'?1:100),step=sel.value==='cattle'?5:0.25;
      var t=dir.value==='above'?Math.floor(p/step+1)*step:Math.ceil(p/step-1)*step;
      tgt.placeholder=t.toFixed(2);
      if(now){var mon=contractOf(q,sel.value);now.textContent='Now $'+p.toFixed(2)+(mon?', '+mon:'')+(stamp?' · '+stamp:'');}}
    sel.addEventListener('change',ex);dir.addEventListener('change',ex);ex();
  });

  /* Footer: the strip is sponsorship, and the page calls sponsorship one
     thing. loader.js injects the footer after this runs. */
  var tries=0;(function relabel(){var l=document.querySelector('#site-footer .adspace-lbl, footer .adspace-lbl');
    if(l){l.textContent='Sponsor · supporter strip';return;}
    if(tries++<40)setTimeout(relabel,250);})();
})();
</script>
'''
JS_READ = r'''    Promise.all([(window.__agsistPricesP||(window.__agsistPricesP=get('/data/prices.json'))),get('/data/price-stats.json'),get('/data/cot.json')]).then(function(R){
      var px=(R[0]&&R[0].quotes)||{},stats=R[1]||{},cot=R[2]||{};
      /* price-stats.json is built after the close, not live: name the time. */
      /* cot.json `updated` is when the file was built; report_date is the positions' date. */
      var cotAsOf='';try{if(cot.report_date){var _c=new Date(cot.report_date);if(!isNaN(_c))cotAsOf=_c.toLocaleDateString('en-US',{month:'short',day:'numeric'});}}catch(e){}
      var asOf='';try{if(stats.updated){var _d=new Date(stats.updated);if(!isNaN(_d))asOf=_d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Chicago'})+' CT';}}catch(e){}
      /* r7-bids 2026-10-01: ONE PRICE PER CONTRACT ON THE PAGE. The price
         printed here is the board's (the front-month quote the tiles show,
         prices.json `<crop>-nearby`), with its contract month. The
         percentile is ranked by build_price_percentile.py at the file's
         build time, against 5 years of weekly closes, so it carries that
         time instead of borrowing the board's. The midpoint labels are gone:
         "61st percentile" already says "above the midpoint". */
      function bandTxt(p){if(p<10)return 'Near a 5-year low.';if(p<25)return 'Historically low: below most of the last 5 years.';if(p>=90)return 'Near a 5-year high.';if(p>=75)return 'Historically high: above most of the last 5 years.';return '';}
      Object.keys(GR).forEach(function(k){
        var g=GR[k],pre='sig-'+k,st=stats[g.sk],nb=px[k+'-nearby'],q=nb||px[k],pct,lo,hi,tag,rd;
        var live=(q&&q.close!=null)?q.close*g.s:null,mon=(nb&&nb.contract)||'';
        /* quarter cents, like the tiles: 681.75 -> $6.81 3/4 */
        var qp=function(c){var w=Math.floor(c+1e-9),f=Math.round((c-w)*4);if(f===4){w++;f=0;}return '$'+(w/100).toFixed(2)+(f?' '+['','1/4','1/2','3/4'][f]:'');};
        if(st&&st.pct!=null){pct=st.pct;lo=st.lo;hi=st.hi;tag='5-year';
          var b=bandTxt(pct);rd=(b?'<b>'+b+'</b> ':'')+'Ranked'+(asOf?' at '+asOf:'')+' against 5 years of weekly front-month closes.';}
        else if(q&&q.close!=null&&q.wk52_hi!=null&&q.wk52_lo!=null&&q.wk52_hi>q.wk52_lo){lo=q.wk52_lo*g.s;hi=q.wk52_hi*g.s;pct=Math.round((q.close-q.wk52_lo)/(q.wk52_hi-q.wk52_lo)*100);tag='52-week';rd='Where the board price sits in its 52-week range.';}
        else{if($(pre+'-tag'))$(pre+'-tag').textContent='Not loaded yet';return;}
        pct=Math.max(0,Math.min(100,pct));
        if($(pre+'-num'))$(pre+'-num').innerHTML=tag==='5-year'?pct+'<span class="r7-ord">'+ord(pct)+'</span>':pct+'%';
        if($(pre+'-sub'))$(pre+'-sub').textContent=tag==='5-year'?'percentile':'of its 52-week range';
        if($(pre+'-tag'))$(pre+'-tag').textContent=tag;
        var pe=$(pre+'-price');
        if(pe){pe.textContent=(live!=null?(mon?mon+' ':'')+qp(q.close)+' on the board · ':'')+(tag==='5-year'?'5-year':'52-week')+' range $'+lo.toFixed(2)+'–$'+hi.toFixed(2);pe.setAttribute('data-r7','1');}
        bar(pre,pct);
        if($(pre+'-read'))$(pre+'-read').innerHTML=rd;
      });
'''
JS_CAL = r'''  function buildUSDACalendar(){
    var strip=document.getElementById('usda-cal-strip');if(!strip)return;
    /* r7-bids 2026-10-01: rebuilt.
       - An event whose release time has passed is gone, compared as a real
         instant (the ET wall time converted with the browser's own zone
         rules), not "today's date".
       - Monthly reports come from /usda-calendar.ics, the calendar file the
         site already publishes. No report date is typed in here. Non-USDA
         rows in that file (CONAB, StatCan) are left out: this is the USDA list.
       - The next WASDE is always on the strip, even when weekly rows would
         push it past the tenth card.
       - Weekly releases that fall on a federal holiday (fixed by law: the
         2nd Monday of October and so on) say "holiday, date may shift" --
         the same rule /usda-calendar uses. Nothing in the repo says which
         day USDA moves a holiday release to, so this does not say either. */
    function etParts(d){var s=d.toLocaleString('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
      var m=/(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+)/.exec(s);return m?{y:+m[3],mo:+m[1],d:+m[2],h:(+m[4])%24,mi:+m[5]}:null;}
    function etToUtc(y,mo,d,h,mi){var g=Date.UTC(y,mo-1,d,h,mi),p=etParts(new Date(g));if(!p)return new Date(g);return new Date(g-(Date.UTC(p.y,p.mo-1,p.d,p.h,p.mi)-g));}
    function nth(y,mo,wd,n){var d=new Date(Date.UTC(y,mo-1,1));var off=(wd-d.getUTCDay()+7)%7;return 1+off+(n-1)*7;}
    function lastMon(y,mo){var d=new Date(Date.UTC(y,mo,0));return d.getUTCDate()-((d.getUTCDay()-1+7)%7);}
    function iso(y,mo,d){return y+'-'+('0'+mo).slice(-2)+'-'+('0'+d).slice(-2);}
    function observed(y,mo,d){var w=new Date(Date.UTC(y,mo-1,d)).getUTCDay(),t=new Date(Date.UTC(y,mo-1,d+(w===6?-1:w===0?1:0)));return iso(t.getUTCFullYear(),t.getUTCMonth()+1,t.getUTCDate());}
    function holidays(y){return [observed(y,1,1),iso(y,1,nth(y,1,1,3)),iso(y,2,nth(y,2,1,3)),iso(y,5,lastMon(y,5)),observed(y,6,19),observed(y,7,4),iso(y,9,nth(y,9,1,1)),iso(y,10,nth(y,10,1,2)),observed(y,11,11),iso(y,11,nth(y,11,4,4)),observed(y,12,25)];}
    var now=new Date(),nowEt=etParts(now)||{y:now.getFullYear(),mo:now.getMonth()+1,d:now.getDate()};
    var todayIso=iso(nowEt.y,nowEt.mo,nowEt.d),HOL={};
    [nowEt.y,nowEt.y+1].forEach(function(y){holidays(y).forEach(function(h){HOL[h]=1;});});
    var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function clock(h,mi){return ((h%12)||12)+':'+('0'+mi).slice(-2)+' '+(h<12?'AM':'PM')+' ET';}
    var weekly=[{name:'Export Sales',wd:4,h:8,mi:30},{name:'Export Inspections',wd:1,h:11,mi:0},{name:'Crop Progress',wd:1,h:16,mi:0}];
    var events=[];
    for(var i=0;i<28;i++){
      var dd=new Date(Date.UTC(nowEt.y,nowEt.mo-1,nowEt.d+i)),y=dd.getUTCFullYear(),mo=dd.getUTCMonth()+1,da=dd.getUTCDate(),wd=dd.getUTCDay(),di=iso(y,mo,da);
      weekly.forEach(function(r){if(r.wd!==wd)return;var at=etToUtc(y,mo,da,r.h,r.mi),hol=!!HOL[di];
        /* A holiday row stays until its day is over: its time is not known. */
        if(hol?di<todayIso:at<=now)return;
        events.push({name:r.name,day:di,mo:mo,da:da,at:at,time:hol?'Federal holiday · date may shift, check USDA':clock(r.h,r.mi)});});
    }
    function render(list,note){
      list.sort(function(a,b){return a.at-b.at;});
      var seen={},u=[];list.forEach(function(e){var k=e.name+'|'+e.day;if(!seen[k]){seen[k]=1;u.push(e);}});
      var shown=u.slice(0,10),w=null;
      for(var j=0;j<u.length;j++){if(u[j].name==='WASDE'){w=u[j];break;}}
      if(w&&shown.indexOf(w)<0){shown[shown.length-1]=w;}
      strip.innerHTML='';
      shown.forEach(function(ev){var card=document.createElement('div'),isToday=ev.day===todayIso,dateStr=months[ev.mo-1]+' '+ev.da;
        card.className='cal-card'+(isToday?' today':'');card.setAttribute('role','listitem');
        card.innerHTML=(isToday?'<div class="cal-today-badge">Today</div>':'<div class="cal-date">'+dateStr+'</div>')+'<div class="cal-name">'+ev.name+'</div><div class="cal-time">'+ev.time+(isToday?' · '+dateStr:'')+'</div>';
        strip.appendChild(card);});
      /* 7b: one line for a federal holiday inside the strip's dates. The
         repo's calendar flags only the holiday's own releases, so the rest
         of that week is described, not moved. */
      var last=shown.length?shown[shown.length-1].day:todayIso,hd=Object.keys(HOL).sort().filter(function(h){return h>=todayIso&&h<=last;})[0];
      var hn=document.getElementById('r7-cal-hol'),host=strip.parentNode;
      if(hd){if(!hn){hn=document.createElement('p');hn.id='r7-cal-hol';host.parentNode.insertBefore(hn,host.nextSibling);}
        var hp=hd.split('-');hn.textContent='Federal holiday '+months[+hp[1]-1]+' '+(+hp[2])+': release dates that week may shift, check USDA.';}
      else if(hn){hn.parentNode.removeChild(hn);}
      if(note){var n=document.createElement('div');n.className='cal-card';n.setAttribute('role','listitem');n.innerHTML='<div class="cal-name">'+note+'</div><div class="cal-time"><a href="/usda-calendar">Full calendar &rarr;</a></div>';strip.appendChild(n);}
    }
    render(events.slice(),'');
    fetch('/usda-calendar.ics',{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error(r.status);return r.text();}).then(function(t){
      var out=events.slice();
      t.replace(/\r/g,'').split('BEGIN:VEVENT').slice(1).forEach(function(b){
        var s=/\nSUMMARY:([^\n]*)/.exec(b),d=/\nDTSTART:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}Z/.exec(b);
        if(!s||!d)return;var name=s[1].trim();
        if(/CONAB|StatCan|Brazil|Canada/i.test(name))return;
        var at=new Date(Date.UTC(+d[1],+d[2]-1,+d[3],+d[4],+d[5]));if(at<=now)return;
        var p=etParts(at);if(!p)return;
        out.push({name:name.replace(/\s+Report$/,''),day:iso(p.y,p.mo,p.d),mo:p.mo,da:p.d,at:at,time:clock(p.h,p.mi)});
      });
      render(out,'');
    }).catch(function(){render(events.slice(),'Monthly report dates not loaded yet');});
  }
'''

WIRE_HEAD = r'''
  /* r7-bids 2026-10-01 (7b): build_news.py runs in the evening and reads
     the `close` in prices.json then, and files ":hi"/":lo" when that price
     reaches the file's 52-week bound. That is a traded price, not a checked
     settle, so the card says "traded to a 52-week high of $X" and names the
     series (`corn` is the front-month continuous; `corn-dec` the December
     contract). Words follow the page's vocabulary. */
  var WIRE_SERIES={corn:'corn, front-month continuous',beans:'soybeans, front-month continuous',wheat:'wheat, front-month continuous','corn-dec':'December corn contract','beans-nov':'November soybean contract'};
  var LONGMON=['January','February','March','April','May','June','July','August','September','October','November','December'];
  function wireVocab(t){t=String(t||'');
    t=t.replace(/(\d(?:\.\d+)?) B bu\b/g,'$1 billion bu').replace(/\bSept\b\.?/g,'Sep').replace(/(\d+)\.0 cents/g,'$1 cents');
    t=t.replace(new RegExp('\\b('+LONGMON.join('|')+') (\\d{1,2}), (\\d{4})','g'),function(_,m,d,y){return m.slice(0,3)+' '+(+d)+', '+y;});
    t=t.replace(new RegExp('\\b(\\d{1,2}) ('+LONGMON.join('|')+')\\b','g'),function(_,d,m){return m.slice(0,3)+' '+(+d);});
    return t;}
  function wireHead(i){var h=String(i.headline||''),m,k=/^px:[\d-]+:([a-z-]+):(hi|lo)$/.exec(i.id||'');
    if(k){var ser=WIRE_SERIES[k[1]]||k[1],w=k[2]==='hi'?'high':'low';
      if((m=/^(.*?) took its 52-week (?:high|low) to (\$[\d.,]+)$/.exec(h)))return m[1]+' traded to a 52-week '+w+' of '+m[2]+' ('+ser+')';
      if((m=/^(.*?) closed at a 52-week (?:high|low)$/.exec(h)))return m[1]+' traded to a 52-week '+w+' ('+ser+')';}
    return wireVocab(h);}
  function wireDetail(i){var d=String(i.detail||'');if(/:(hi|lo)$/.test(i.id||''))d=d.replace(/, the (highest|lowest) it has settled in a year\./,', the $1 in a year.');return wireVocab(d);}
  /* Board items (moves, highs, lows) show only from the latest two weekday
     sessions, Central time; anything older is history, not wire. */
  function wireRecent(day){try{var t=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Chicago'})),keep=[];
    while(keep.length<2){var w=t.getDay();if(w>0&&w<6)keep.push(t.getFullYear()+'-'+('0'+(t.getMonth()+1)).slice(-2)+'-'+('0'+t.getDate()).slice(-2));t.setDate(t.getDate()-1);}
    return keep.indexOf(day)>=0;}catch(e){return false;}}
'''

FAQ = [
    # (visible old, visible new, json-ld old, json-ld new)
    ("Both the nearby front-month contract and the December new-crop harvest contract are shown with net change, percent change, and 52-week range.",
     "The front-month contract and the new-crop December contract are both shown, each labelled with its contract month (for example Dec &rsquo;26), with net change, percent change, and 52-week range.",
     "Both the nearby front-month contract and the December new-crop harvest contract are shown with net change, percent change, and 52-week range.",
     "The front-month contract and the new-crop December contract are both shown, each labelled with its contract month (for example Dec ’26), with net change, percent change, and 52-week range."),
    ("at 12:00 PM Eastern Time. It is the most market-moving USDA report, often moving corn and soybean futures 10-40 cents at release. AGSIST's USDA Calendar",
     "at 12:00 PM Eastern Time. AGSIST's USDA Calendar",
     "at 12:00 PM Eastern Time. It is the most market-moving USDA report, often moving corn and soybean futures 10-40 cents at release. AGSIST's USDA Calendar",
     "at 12:00 PM Eastern Time. AGSIST's USDA Calendar"),
    ("The corn-to-soybean price ratio compares November soybean futures divided by December corn futures. Across historical USDA price data, ratios above 2.6:1 have typically favored soybean profitability per acre; below 2.4:1, corn; between 2.4 and 2.6 is neutral. Actual thresholds shift with local yield potential, input costs, and basis &mdash; individual operations should run break-even math on their own numbers.",
     "The corn-to-soybean price ratio is November soybean futures divided by December corn futures. A higher ratio leans toward soybeans and a lower one toward corn, but where the line falls depends on your own yields, input costs, and basis, so run break-even math on your own numbers.",
     "The corn-to-soybean price ratio compares November soybean futures divided by December corn futures. Across historical USDA price data, ratios above 2.6:1 have typically favored soybean profitability per acre; below 2.4:1, corn; between 2.4 and 2.6 is neutral. Actual thresholds shift with local yield potential, input costs, and basis — individual operations should run break-even math on their own numbers.",
     "The corn-to-soybean price ratio is November soybean futures divided by December corn futures. A higher ratio leans toward soybeans and a lower one toward corn, but where the line falls depends on your own yields, input costs, and basis, so run break-even math on your own numbers."),
]

def patch_index(t):
    # cache keys for the two component files this script edits
    t = once(t, '<script src="/components/bids-homepage.js?v=17" defer></script>',
             '<script src="/components/bids-homepage.js?v=18" defer></script>', 'idx bids v')
    t = once(t, '<script src="/components/homepage-extras.js?v=2" defer></script>',
             '<script src="/components/homepage-extras.js?v=3" defer></script>', 'idx extras v')

    # ── 12. Cash Bids: claim line at the foot of the card
    t = once(t, '<div id="idx1-trust-ledger">—</div>',
             '<div id="idx1-trust-ledger">—</div>\n        <a class="r7-claim" href="/elevators#claim" data-track="claim_board">Run an elevator? Claim your board, free.</a>',
             'idx claim line')

    # ── 3. The Read
    t = rx_once(t, r"    Promise\.all\(\[get\('/data/prices\.json'\),get\('/data/price-stats\.json'\),get\('/data/cot\.json'\)\]\)\.then\(function\(R\)\{\n.*?(?=      var le=px\.cattle,gf=px\.feeders)",
                JS_READ, 'idx read block')
    t = once(t, "        if($(pre+'-sub'))$(pre+'-sub').textContent=': 1 feeder/live';",
             "        if($(pre+'-sub'))$(pre+'-sub').textContent='feeder/live price ratio';", 'idx read cattle sub')
    t = once(t, "        if($(pre+'-price'))$(pre+'-price').textContent='Live $'+le.close.toFixed(2)+' \\u00b7 Feeder $'+gf.close.toFixed(2);",
             "        /* r7-bids 7b: both contract months, from the price file. */\n"
             "        var _co=window.__r7&&window.__r7.contractOf,_lm=_co?_co(px,'cattle'):'',_fm=_co?_co(px,'feeders'):'';\n"
             "        if($(pre+'-price')){$(pre+'-price').textContent='Live cattle'+(_lm?' '+_lm:'')+' $'+le.close.toFixed(2)+' \\u00b7 Feeder'+(_fm?' '+_fm:'')+' $'+gf.close.toFixed(2)+' per cwt';$(pre+'-price').setAttribute('data-r7','1');}", 'idx read cattle price')
    t = once(t, "var _fq=(px&&px.feeders)||null, _fclause='.';",
             "var _fq=(px&&px.feeders&&px.feeders.repaired_from&&px[px.feeders.repaired_from])||(px&&px.feeders)||null, _fclause='.';   /* r7-bids: the dated contract the price comes from, not the continuous range */", 'idx read feeder range')
    t = once(t, "        bar(pre,cp!=null?cp:50);",
             "        /* r7-bids 7b: no invented 50%: with no COT position the bar is hidden. */\n"
             "        var _sb=document.querySelector('#'+pre+' .sig-bar');if(cp!=null){bar(pre,cp);if(_sb&&!document.getElementById('sig-cattle-barcap')){var _bc=document.createElement('div');_bc.id='sig-cattle-barcap';_bc.className='r7-barcap';_bc.textContent='Bar: funds\\u2019 net '+(lc.net>=0?'long':'short')+', '+cp+'% of its 52-week range';_sb.parentNode.insertBefore(_bc,_sb.nextSibling);}}else if(_sb){_sb.style.display='none';}", 'idx read cattle bar')
    t = once(t, "if(cp!=null){if($(pre+'-tag'))$(pre+'-tag').textContent='COT';", "if(cp!=null){if($(pre+'-tag'))$(pre+'-tag').textContent='Ratio';", 'idx read cattle tag')
    t = once(t, "$(pre+'-tag').textContent='RATIO';", "$(pre+'-tag').textContent='Ratio';", 'idx read cattle tag2')
    t = once(t, "' contracts, '+cp+'% of the way up its 52-wk range'", "' contracts, '+cp+'% of the way up its 52-week range'", 'idx read cattle 52wk')
    t = once(t, "' their 52-wk range ('+_fp+'%).';", "' their 52-week range ('+_fp+'%).';", 'idx read feeder 52wk')

    # ── 2. The Wire
    t = once(t, "  var KIND={usda:'USDA',positioning:'Positioning',board:'Board',crop:'Crop',weather:'Weather'};\n",
             "  var KIND={usda:'USDA',positioning:'Positioning',board:'Board',crop:'Crop',weather:'Weather'};\n" + WIRE_HEAD,
             'idx wire head fn')
    t = once(t, "    if(sub) sub.textContent=items.length===1?'1 thing the numbers said':\n      items.length+' things the numbers said';\n",
             "    /* r7-bids: counted below, from the cards actually shown. */\n", 'idx wire early count')
    t = once(t, "    if(sub) sub.textContent=items.length===1?'1 thing the numbers said':items.length+' things the numbers said';\n    g.innerHTML=items.slice(0,4).map(function(i){",
             "    var shown=items.slice(0,4);   /* r7-bids: the count is what is shown, after the guards above */\n"
             "    if(sub) sub.textContent=shown.length===1?'1 thing the numbers said':shown.length+' things the numbers said';\n"
             "    g.innerHTML=shown.map(function(i){", 'idx wire count shown')
    t = once(t, "      var m=/^px:(\\d{4}-\\d{2}-\\d{2}):([a-z-]+):move$/.exec(i.id||'');\n",
             "      var hl=/^px:(\\d{4}-\\d{2}-\\d{2}):[a-z-]+:(hi|lo)$/.exec(i.id||'');   /* r7-bids 7b */\n"
             "      if(hl)return wireRecent(hl[1]);\n"
             "      var m=/^px:(\\d{4}-\\d{2}-\\d{2}):([a-z-]+):move$/.exec(i.id||'');\n", 'idx wire hi/lo guard')
    t = once(t, "    items=items.filter(function(i){\n",
             "    /* r7-bids: positioning items only from the latest COT report date in the file. */\n"
             "    var cotD=function(i){var m=/^cot:([^:]+):/.exec(i.id||'');var d=m?Date.parse(m[1]):NaN;return isNaN(d)?null:d;},cotMax=null;\n"
             "    items.forEach(function(i){var d=cotD(i);if(d!=null&&(cotMax==null||d>cotMax))cotMax=d;});\n"
             "    items=items.filter(function(i){var d=cotD(i);return d==null||d===cotMax;});\n"
             "    items=items.filter(function(i){\n", 'idx wire cot newest')
    t = once(t, "    band.hidden=false;\n    if(window.gaEvent) gaEvent('wire_band_shown'",
             "    band.hidden=false;\n"
             "    /* r7-bids 7b: the header counts the cards visible at this width (the layout hides some). */\n"
             "    var wcT=null;function wireCount(){var n=0;for(var c=g.firstElementChild;c;c=c.nextElementSibling){if(getComputedStyle(c).display!=='none')n++;}\n"
             "      if(sub)sub.textContent=n===1?'1 thing the numbers said':n+' things the numbers said';}\n"
             "    wireCount();window.addEventListener('resize',function(){clearTimeout(wcT);wcT=setTimeout(wireCount,150);});\n"
             "    if(window.gaEvent) gaEvent('wire_band_shown'", 'idx wire visible count')
    t = once(t, "        +'<strong>'+esc(i.headline||'')+'</strong>'\n        +'<em>'+esc(i.detail||'')+'</em></a>';",
             "        +'<strong>'+esc(wireHead(i))+'</strong>'\n        +'<em>'+esc(wireDetail(i))+'</em></a>';", 'idx wire wording')

    # ── 4. Rail: USDA reports (calendar from /usda-calendar.ics) and the Grain Stocks card
    t = rx_once(t, r"  function buildUSDACalendar\(\)\{\n.*?\n  \}\n(?=  buildUSDACalendar\(\);)", JS_CAL, 'idx calendar')
    t = once(t, "font-size:.68rem;color:var(--red)\">above trade range</div>",
             "font-size:.68rem;color:var(--red)\">above trade range, bearish</div>", 'idx stocks corn bearish')
    t = times(t, '<span style="font-size:.7rem;font-weight:600;color:var(--text-muted)">B bu</span>',
              '<span style="display:block;font-size:.7rem;font-weight:600;color:var(--text-muted)">billion bu</span>', 3, 'idx stocks units')
    t = once(t, "(1.843&ndash;2.005B)", "(1.843&ndash;2.005 billion bu)", 'idx stocks range unit')

    # ── 6. Rail: Yield Nowcast -- lead with the difference from USDA; the trend is AGSIST's own fit
    t = once(t, """        if(vs){
          var up=diff>0.4,dn=diff<-0.4;
          vs.innerHTML=up?'<span style="color:var(--green);font-weight:700">\\u25B2 '+Math.abs(diff).toFixed(1)+' above trend</span>'
            :dn?'<span style="color:var(--red);font-weight:700">\\u25BC '+Math.abs(diff).toFixed(1)+' below trend</span>'
            :'<span style="color:var(--text-dim);font-weight:700">\\u2248 on trend ('+c.trend.toFixed(1)+')</span>';
        }
""", """        /* r7-bids 7b: the headline is the difference from USDA (filled below
           from data/wasde.json). The trend is AGSIST's own linear fit on the
           backtest years (scripts/build_yield_nowcast.py), and says so. */
        if(vs){vs.textContent='USDA estimate not loaded yet';vs.style.color='var(--text-muted)';
          var tl=document.getElementById(map[crop]+'-trend');
          if(!tl){tl=document.createElement('div');tl.id=map[crop]+'-trend';tl.className='r7-nc-usda';vs.parentNode.insertBefore(tl,vs.nextSibling);}
          tl.textContent='AGSIST trend, own '+(c.backtest_years||'')+'-year fit: '+c.trend.toFixed(1)+(typeof c.mae==='number'?' \\u00b7 backtest miss averages '+c.mae.toFixed(1)+' bu':'');}
""", 'idx nowcast vs')
    t = once(t, """      var v=document.getElementById('nc-verdict');
      if(v){
        var cls=above&&!below?'beans':below&&!above?'corn':'neutral';
        v.className='ratio-verdict '+cls;
        v.textContent=above&&!below?'Above trend':below&&!above?'Below trend':'Near trend';
      }
""", """      var v=document.getElementById('nc-verdict');
      if(v){v.className='ratio-verdict neutral';v.textContent='USDA not loaded yet';}
      fetch('/data/wasde.json',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(w){if(!w||!w.metrics)return;
        var rel=w.release?new Date(w.release+'T12:00:00'):null,rs=rel&&!isNaN(rel)?rel.toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
        var ab=0,bl=0,n=0;
        [['corn_yield','corn','nc-corn'],['soy_yield','soybeans','nc-beans']].forEach(function(p){var m=null;w.metrics.forEach(function(x){if(!m&&String(x.key).indexOf(p[0])===0&&typeof x.value==='number')m=x;});
          var vs=document.getElementById(p[2]+'-vs'),c=d.crops[p[1]];if(!m||!vs||!c)return;
          var df=Math.round((c.nowcast-m.value)*10)/10;n++;if(df>0.4)ab++;else if(df<-0.4)bl++;
          vs.style.color='var(--text-dim)';
          vs.textContent=(Math.abs(df)<0.05?'Even with':(Math.abs(df).toFixed(1)+' bu '+(df>0?'above':'below')))+' USDA\\u2019s '+(rs?rs+' ':'')+'estimate ('+m.value.toFixed(1)+')';});
        if(v&&n){v.textContent=ab&&!bl?'Above USDA':bl&&!ab?'Below USDA':'Near USDA';}
      }).catch(function(){});
""", 'idx nowcast verdict')
    t = once(t, "        wk.innerHTML='Ratings week ending '+_wkEnd+' \\u00b7 updates Tuesdays'+_age;\n",
             "        /* r7-bids: dates as \"Sep 20, 2026\", and say when the ratings week trails the latest Crop Progress week. */\n"
             "        var _wkTxt=function(s){var d=new Date(s+'T12:00:00');return isNaN(d)?s:d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});};\n"
             "        wk.innerHTML='Ratings week ending '+_wkTxt(_wkEnd)+' \\u00b7 updates Tuesdays'+_age;\n"
             "        fetch('/data/crop-progress.json',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(cp){\n"
             "          if(!cp||!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(cp.report_date))||!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(_wkEnd)))return;\n"
             "          var n=Math.round((new Date(cp.report_date+'T12:00:00')-new Date(_wkEnd+'T12:00:00'))/6048e5);\n"
             "          if(n>=1)wk.innerHTML='Ratings week ending '+_wkTxt(_wkEnd)+', '+(n===1?'one week':n+' weeks')+' behind Crop Progress ('+_wkTxt(cp.report_date)+')'+_age;\n"
             "        }).catch(function(){});\n", 'idx nowcast week')

    # ── 7. Rail: Call Scorecard leads with direction
    t = once(t, '<span style="font-size:.735rem;color:var(--text-muted);text-align:right;line-height:1.3">Hit rate,<br>graded by rule</span>',
             '<span id="rsc-hit-lbl" style="font-size:.735rem;color:var(--text-muted);text-align:right;line-height:1.3">Direction right,<br>graded by rule</span>', 'idx scorecard label')
    t = once(t, '<span class="rsc-teaser-label">Call Scorecard hit rate<span id="rsct-sample"></span></span>',
             '<span class="rsc-teaser-label">Call Scorecard: direction right<span id="rsct-sample"></span></span>', 'idx scorecard teaser label')
    t = once(t, "      document.getElementById('rsc-hit').textContent=det.hit_rate.toFixed(1)+'%';\n      var rsctHit=document.getElementById('rsct-hit');\n      if(rsctHit)rsctHit.textContent=det.hit_rate.toFixed(1)+'%';\n",
             "      /* r7-bids: lead with direction, the number a reader judges a call by. */\n"
             "      var dirOk=!!(dirOnly&&typeof dirOnly.right_way==='number'&&dirOnly.graded);\n"
             "      var lead=dirOk?(dirOnly.right_way+' of '+dirOnly.graded):det.hit_rate.toFixed(1)+'%';\n"
             "      document.getElementById('rsc-hit').textContent=lead;\n"
             "      if(!dirOk){var _hl=document.getElementById('rsc-hit-lbl');if(_hl)_hl.innerHTML='Exact level right,<br>graded by rule';}\n"
             "      var rsctHit=document.getElementById('rsct-hit');\n"
             "      if(rsctHit)rsctHit.textContent=lead;\n", 'idx scorecard lead')
    t = once(t, "      if(rsctSample)rsctSample.textContent=(det.graded!=null?' (n='+det.graded+')':'');\n",
             "      if(rsctSample)rsctSample.textContent=dirOk?'':(det.graded!=null?' (n='+det.graded+')':'');\n", 'idx scorecard teaser n')
    t = rx_once(t, r"      var v='Hitting the called price level about 1 in 5 times\.';\n.*?      document\.getElementById\('rsc-verdict'\)\.innerHTML=v;\n",
                "      var exact=haveRecord&&typeof det.graded==='number'?('Exact level right '+det.played+' of '+det.graded+' ('+det.hit_rate.toFixed(1)+'%).'):('Exact level right '+det.hit_rate.toFixed(1)+'% of the time.');\n"
                "      var v=exact;\n"
                "      if(dirOk){var dr=dirOnly.rate!=null?dirOnly.rate:100*dirOnly.right_way/dirOnly.graded;\n"
                "        v='Direction right '+dirOnly.right_way+' of '+dirOnly.graded+' times'+(dr>=40&&dr<=60?', a coin flip.':' ('+dr.toFixed(1)+'%).')+' '+exact;}\n"
                "      document.getElementById('rsc-verdict').textContent=v;\n", 'idx scorecard verdict')

    t = times(t, '<span>52-wk range</span>', '<span>52-week range</span>', 4, 'idx cot 52-week labels')
    t = once(t, "        asof.textContent=last?('Through '+last):'';",
             "        var _ld=/^\\d{4}-\\d{2}-\\d{2}/.test(String(last||''))?new Date(String(last).slice(0,10)+'T12:00:00'):null;\n"
             "        asof.textContent=last?('Through '+(_ld&&!isNaN(_ld)?_ld.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):last)):'';", 'idx scorecard through date')

    # ── COT: true minus signs; the net figure's red from the theme token
    t = once(t, "return(n>=0?'+':'-')+str;}", "return(n>=0?'+':'\\u2212')+str;}", 'idx cot fmtK minus')
    t = once(t, "if(abs>=1000)return(n<0?'-':'')+Math.round(abs/1000)+'k';return String(Math.round(n));}",
             "if(abs>=1000)return(n<0?'\\u2212':'')+Math.round(abs/1000)+'k';return String(Math.round(n)).replace('-','\\u2212');}", 'idx cot fmtKShort minus')
    t = once(t, "fmtK(Math.abs(chg)).replace(/^[+-]/,'')", "fmtK(Math.abs(chg)).replace(/^[+\\u2212-]/,'')", 'idx cot chg strip')
    t = once(t, "isLong?'var(--green)':'#ef4444';}", "isLong?'var(--green)':'var(--red)';}", 'idx cot net red token')

    # ── 8. Rail: Price Alert
    t = once(t, "One email when a contract crosses your price, then it clears.",
             "One email the first time the price we check every 30 minutes (delayed about 15 minutes) is at or past your target. Then it clears.", 'idx pa copy')
    t = once(t, '<option value="corn">Corn (front month)</option>', '<option value="corn">Corn, front month</option>', 'idx pa corn')
    t = once(t, '<option value="corn-dec">Corn (new crop)</option>', '<option value="corn-dec">Corn, December contract</option>', 'idx pa corn-dec')
    t = once(t, '<option value="beans">Soybeans (front month)</option>', '<option value="beans">Soybeans, front month</option>', 'idx pa beans')
    t = once(t, '<option value="beans-nov">Soybeans (new crop)</option>', '<option value="beans-nov">Soybeans, November contract</option>', 'idx pa beans-nov')
    t = once(t, '<option value="wheat">Wheat</option>\n            <option value="cattle">Live Cattle</option>',
             '<option value="wheat">Wheat, front month</option>\n            <option value="cattle">Live cattle, front month</option>', 'idx pa wheat cattle')
    t = once(t, 'placeholder="4.50" aria-label="Target price in dollars"', 'placeholder="Target" aria-label="Target price in dollars"', 'idx pa placeholder')
    t = once(t, "        <input type=\"email\" id=\"pa-email\"",
             "        <div id=\"r7-pa-now\" aria-live=\"polite\"></div>\n        <input type=\"email\" id=\"pa-email\"", 'idx pa now line')
    t = once(t, "      var label=(PA_LABELS[symbol]||symbol)+' '+(direction==='above'?'above':'below')+' $'+dollars.toFixed(2);",
             "      var label=((window.__r7paLabel&&window.__r7paLabel(symbol))||PA_LABELS[symbol]||symbol)+' '+(direction==='above'?'above':'below')+' $'+dollars.toFixed(2);",
             'idx pa label')

    # ── 9. Signup
    t = once(t, ' <strong style="color:var(--text)">No ads. No fluff. Just the signal.</strong>', '', 'idx signup cut')
    t = once(t, '<div class="signup-row"><input type="text" class="signup-input" placeholder="First name" autocomplete="given-name" aria-label="First name"><input type="email"',
             '<div class="signup-row"><input type="email"', 'idx signup one row')
    t = once(t, "'AGSIST Daily arrives every morning. Check your spam folder", "'AGSIST Daily arrives every weekday morning. Check your spam folder", 'idx signup success weekday')
    t = once(t, 'Get the AGSIST Daily briefing every morning &mdash; markets, weather', 'Get the AGSIST Daily briefing every weekday &mdash; markets, weather', 'idx signup slim weekday')

    # ── 10. FAQ, visible text and its FAQPage JSON-LD together
    # The visible text and the JSON-LD text are the same words, so each old
    # string carries its own tail (the markup's "<a", the JSON's closing
    # quote) to be unique.
    TAILS = [(' Prices are in dollars per bushel. <a', ' Prices are in dollars per bushel."'),
             (' tracks all report dates with market impact ratings. <a', ' tracks all report dates with market impact ratings."'),
             (' Both contract prices update every 30 minutes on AGSIST\u2019s corn and soybean futures pages. <a', ' Both contract prices update every 30 minutes on AGSIST\u2019s corn and soybean futures pages."')]
    for i, (vo, vn, jo, jn) in enumerate(FAQ):
        tv, tj = TAILS[i]
        t = once(t, vo + tv, vn + tv, 'idx faq visible %d' % i)
        t = once(t, jo + tj, jn + tj, 'idx faq jsonld %d' % i)

    # ── CSS and the rail/footer script
    if t.count('</head>') != 1: sys.exit('ANCHOR </head> count != 1')
    t = t.replace('</head>', CSS + '</head>', 1)
    if t.count('</body>') != 1: sys.exit('ANCHOR </body> count != 1')
    t = t.replace('</body>', JS_INLINE + '</body>', 1)
    return t

def main():
    a = sys.argv[1:]
    if len(a) != 2 or a[0] != '--repo':
        sys.exit('usage: patch_home_r7_bids.py --repo DIR')
    root = a[1]
    idx = rd(root, 'index.html')
    bjs = rd(root, 'components/bids-homepage.js')
    njs = rd(root, 'components/bids-network.js')
    ejs = rd(root, 'components/homepage-extras.js')
    if '===== 2026-10-01 r7-bids' in idx or 'r7-bids 2026-10-01' in bjs or 'r7-bids 2026-10-01' in ejs or 'r7-bids 2026-10-01' in njs:
        sys.exit('r7-bids already applied to %s; refusing a second run' % root)
    idx = patch_index(idx)
    bjs = patch_bids_js(bjs)
    ejs = patch_extras_js(ejs)
    njs = patch_net_js(njs)
    wr(root, 'index.html', idx)
    wr(root, 'components/bids-homepage.js', bjs)
    wr(root, 'components/homepage-extras.js', ejs)
    wr(root, 'components/bids-network.js', njs)
    print('r7-bids applied to ' + root)

if __name__ == '__main__':
    main()
