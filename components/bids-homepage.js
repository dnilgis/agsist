// ═══════════════════════════════════════════════════════════════════
// bids-homepage.js — Homepage Cash Bids Preview
// r7-bids 2026-10-01: rows grouped by delivery period, basis contract named, straight-line miles.
//
// TWO FEEDS, ONE CARD (2026-09-25). The AGSIST elevator network (dnilgis/bids,
// read in the browser by components/bids-network.js) is the primary source and
// wins on price. The licensed Barchart feed, reached through the Cloudflare
// Worker proxy so the key is never in the page, fills what the network does
// not cover. Neither failing empties the card. When the second feed ends set
// LICENSED_FEED = false below and the request is never made (that cutover is
// the owner's decision; this file does not make it).
//
// Groups results by elevator, shows top 3 nearest with commodity rows.
//
// Called by geo.js after ZIP resolves via propagateLocation():
//   window.loadHomepageBids(lat, lng, label, zip)
//
// DEPLOY: /components/bids-homepage.js
// ═══════════════════════════════════════════════════════════════════

(function(){
  'use strict';

  // Cloudflare Worker proxy — API key is held server-side, never exposed.
  var PROXY_URL = 'https://agsist-barchart.dnilgis.workers.dev/barchart/getGrainBids';

  // Set to false the day the second feed ends. Off means off: the
  // proxy is not called at all, rather than called and ignored.
  var LICENSED_FEED = true;
  var LICENSED_DEADLINE_MS = 6000;
  var NET_SCRIPT = '/components/bids-network.js?v=3';

  var MAX_ELEVATORS = 3;
  var MAX_BIDS_PER_COMMODITY = 3;

  // ── Helpers ─────────────────────────────────────────────────────
  // Meal, hulls, pellets, oil and flour are priced per ton, not per bushel, and
  // "soybean meal" contains "soy". They are never filed under the grain.
  var NOT_PER_BUSHEL = /\b(meal|hulls?|pellets?|oil|flour|ddg|distillers|gluten|canola|peas?)\b/i;
  function notPerBushel(b){ return NOT_PER_BUSHEL.test(String(b && b.commodity || '')); }
  // White, non-GMO, organic, feed, durum and spring wheat are different products
  // from the commodity the futures price. Words are the ones the feed carries.
  var SPECIAL_GRADE = /non[- ]?gmo|organic|\bwhite\b|\bfeed\b|durum|\bsww\b|spring|\bhrs\b|\bdns\b|dark northern|mgex/i;
  function isSpecialGrade(b){ return SPECIAL_GRADE.test(String(b && b.commodity || '')); }
  var PPU_BAND = { corn:[2,12], soybeans:[6,32], wheat:[3,20] };
  function ppu(raw){ return raw == null ? null : (raw > 30 ? raw / 100 : raw); }
  // A row outside its own commodity's band is a unit mismatch, not a price.
  function plausible(b){
    var band = PPU_BAND[b.category];
    if(!band) return true;
    var p = ppu(b.cashPrice);
    return p != null && p >= band[0] && p <= band[1];
  }
  var US_STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
  // A blank state is kept (the feed does not always carry one); a state that
  // is not a US state (an Ontario row, say) is not a US bid.
  function inScope(b){
    var st = String(b.state || '').trim().toUpperCase();
    if(st && US_STATES.indexOf(st) < 0) return false;
    if(b.currency && String(b.currency).toUpperCase() !== 'USD') return false;
    return true;
  }
  function classifyCommodity(name){
    var n = (name || '').toLowerCase();
    if(NOT_PER_BUSHEL.test(n)) return 'other';
    if(n.indexOf('corn') >= 0) return 'corn';
    if(n.indexOf('soy') >= 0 || n.indexOf('bean') >= 0) return 'soybeans';
    if(n.indexOf('wheat') >= 0 || n.indexOf('hrw') >= 0 || n.indexOf('srw') >= 0 || n.indexOf('hrs') >= 0) return 'wheat';
    return 'other';
  }

  function escHtml(s){
    if(!s) return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Short, stable id for "watch this elevator" -- FNV-1a 32-bit over
  // state|facility|city|commodity, uppercased. Must stay byte-identical to
  // scripts/send_elevator_watch.py's wid_for(), which is why it uses
  // Math.imul rather than `*`: h can exceed 2^53 partway through a long
  // facility name, and plain multiplication silently rounds at that point --
  // caught by cross-checking this against the Python hash on a real string,
  // not assumed safe because both "look like" the same formula.
  function widFor(state, facility, city, commodity){
    var s = [state, facility, city, commodity].map(function(x){ return String(x || '').trim().toUpperCase(); }).join('|');
    var h = 0x811c9dc5;
    for(var i = 0; i < s.length; i++){
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  function basisCents(bN){
    if(bN == null) return null;
    return Math.abs(bN) < 5 ? bN * 100 : bN;
  }

  function formatBasis(bN){
    var cents = basisCents(bN);
    if(cents == null) return { str:'\u2014', cls:'muted' };
    return {
      /* 2026-10-01: a flat basis is "even", not "+0c". */
      str: cents === 0 ? 'even' : (cents > 0 ? '+' : '\u2212') + Math.abs(cents).toFixed(0) + '\u00a2',
      cls: cents > 0 ? 'pos' : cents < 0 ? 'neg' : 'muted'
    };
  }

  /* 2026-10-01: the futures month a basis is quoted against, read from the
     symbol the licensed feed sends (ZCZ26 -> Dec). The elevator network
     rows carry no symbol, so they print no month rather than a guessed one. */
  var FUT_MON = {F:'Jan',G:'Feb',H:'Mar',J:'Apr',K:'May',M:'Jun',N:'Jul',Q:'Aug',U:'Sep',V:'Oct',X:'Nov',Z:'Dec'};
  var WHEAT_EXCH = {KE:'KC', ZW:'Chi', MW:'MGEX'};
  function refMonth(sym){
    var m = /^([A-Z]{1,3})([FGHJKMNQUVXZ])(\d{2})$/.exec(String(sym || '').trim().toUpperCase());
    if(!m) return '';
    var crop = /^Z[CS]$/.test(m[1]) ? (m[1] === 'ZC' ? ' corn' : ' soybeans') : (WHEAT_EXCH[m[1]] ? ' ' + WHEAT_EXCH[m[1]] + ' wheat' : '');
    return FUT_MON[m[2]] + ' \'' + m[3] + crop;
  }
  function ctTime(iso){
    var d = new Date(iso); if(!iso || isNaN(d)) return '';
    try{
      var t = d.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit', timeZone:'America/Chicago'});
      var day = d.toLocaleDateString('en-US', {month:'short', day:'numeric', timeZone:'America/Chicago'});
      var today = new Date().toLocaleDateString('en-US', {month:'short', day:'numeric', timeZone:'America/Chicago'});
      return (day === today ? '' : day + ' ') + t + ' CT';
    }catch(e){ return ''; }
  }
  var feedTimes = { network: null, licensed: null };

  var COMM_ORDER = ['corn','soybeans','wheat','other'];
  var COMM_NAMES = { corn:'Corn', soybeans:'Soybeans', wheat:'Wheat', other:'Other' };
  var COMM_COLORS = { corn:'var(--gold)', soybeans:'var(--green)', wheat:'#ca8a3c', other:'var(--text-muted)' };

  // NOT `parseFloat(x) || null`: a FLAT basis is exactly 0 and 0 is falsy, so
  // the strongest basis on a board was published as "unknown".
  function flatNum(v){ var n = parseFloat(v); return isFinite(n) ? n : null; }
  function licBasis(v){ var n = flatNum(v); if(n == null) return null; var a = Math.abs(n); return a < 1 ? n : a >= 5 ? n / 100 : null; }

  // ── Flatten Barchart response (same logic as /cash-bids) ───────
  function flattenBarchartResponse(data){
    var flat = [];
    var raw = data.results || data.bids || data.data || [];
    if(!Array.isArray(raw)) return flat;

    raw.forEach(function(item){
      if(item.bids && Array.isArray(item.bids)){
        var facName = item.company || item.name || item.locationName || 'Unknown';
        var branchName = (typeof item.location === 'string') ? item.location : '';
        item.bids.forEach(function(bid){
          flat.push({
            facility: facName, branch: branchName,
            city: item.city || '', state: item.state || '',
            distance: parseFloat(item.distance || bid.distance) || null,
            phone: item.phone || '',
            commodity: bid.commodity || bid.commodity_display_name || bid.commodityName || '',
            cashPrice: parseFloat(bid.cashprice || bid.cashPrice) || null,
            basis: licBasis(bid.basis),
            deliveryMonth: bid.deliveryMonth || bid.delivery_month || '',
            deliveryStart: bid.deliveryStart || bid.delivery_start || '',
            symbol: bid.symbol || item.symbol || '',
            deliveryEnd: bid.deliveryEnd || bid.delivery_end || '',
            category: classifyCommodity(bid.commodity || bid.commodity_display_name || bid.commodityName || '')
          });
        });
      } else if(item.commodity || item.commodityName || item.cashprice !== undefined || item.cashPrice !== undefined){
        flat.push({
          facility: item.company || item.name || item.facility || item.locationName || 'Unknown',
          branch: (typeof item.location === 'string') ? item.location : '',
          city: item.city || '', state: item.state || '',
          distance: parseFloat(item.distance) || null,
          phone: item.phone || '',
          commodity: item.commodity || item.commodity_display_name || item.commodityName || '',
          cashPrice: parseFloat(item.cashprice || item.cashPrice) || null,
          basis: licBasis(item.basis),
          deliveryMonth: item.deliveryMonth || item.delivery_month || '',
          deliveryStart: item.deliveryStart || item.delivery_start || '',
          symbol: item.symbol || '',
          deliveryEnd: item.deliveryEnd || item.delivery_end || '',
          category: classifyCommodity(item.commodity || item.commodity_display_name || item.commodityName || '')
        });
      }
    });
    return flat;
  }

  // ── Group flat bids → elevator objects ──────────────────────────
  // The feed sends "N/A" for boards with no phone. Not a number: no Call button.
  function hasPhone(p){ return String(p || '').replace(/\D/g, '').length >= 7; }
  function groupByElevator(bids){
    var map = {};
    bids.forEach(function(b){
      var key = (b.facility||'') + '||' + (b.branch||'') + '||' + (b.city||'') + '||' + (b.source === 'network' ? 'n' : 'l');
      if(!map[key]){
        map[key] = {
          facility: b.facility, branch: b.branch,
          city: b.city, state: b.state,
          distance: b.distance, phone: hasPhone(b.phone) ? b.phone : '',
          fromNetwork: false,
          commodities: {}
        };
      }
      var elev = map[key];
      if(!hasPhone(elev.phone) && hasPhone(b.phone)) elev.phone = b.phone;
      // A real, existing distinction (line ~375): the AGSIST elevator network
      // feed tags its own rows `source:'network'`. Barchart rows carry no
      // `source` at all. This is the only honest "where did this number come
      // from" signal in the data -- not an invented verification badge.
      if(b.source === 'network') elev.fromNetwork = true;
      var cat = b.category || 'other';
      if(!elev.commodities[cat]) elev.commodities[cat] = [];
      elev.commodities[cat].push(b);
    });
    return Object.keys(map).map(function(k){ return map[k]; });
  }

  // ── Render one elevator (compact, for homepage card) ────────────
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

  // ── Distance between two real points, in miles ──────────────────────────
  // Plain haversine. Used only when both bids carry real network-fed
  // coordinates -- never estimated, never backed into from a ZIP centroid.
  var NEARBY_RADIUS_MI = 25;
  function milesBetween(lat1, lon1, lat2, lon2){
    var R = 3958.8, toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── What was found, published once, for the band at the top of the page ──
  // The summary is built from the rows this loader already parsed. Nothing is
  // published unless a corn bid with a real cash price came back, so the band
  // cannot show a stale or invented number: no bid, no line.
  function publishSummary(label, zip, bids, elevators){
    try{
      /* THE NEAREST OPEN MONTH FIRST, THEN THE HIGHEST PRICE INSIDE IT. The
         highest corn price across every month is an elevator's 2027 forward
         beating today's spot. White corn and other special grades never set
         the headline. A row with no month is used only if no row has one. */
      var best = null, bestKey = '', nowKey = thisMonth(), pool = [], keyed = [];
      for(var i = 0; i < bids.length; i++){
        var b = bids[i];
        /* flattenBarchartResponse has already classified every row; using
           its `category` avoids a second copy of the rule. */
        if(b.category !== 'corn') continue;
        if(b.cashPrice == null || notPerBushel(b) || isSpecialGrade(b)) continue;
        pool.push(b);
        var k = rowMonthKey(b);
        if(k && k >= nowKey) keyed.push({b: b, k: k});
      }
      if(keyed.length){
        keyed.forEach(function(x){ if(!bestKey || x.k < bestKey) bestKey = x.k; });
        pool = keyed.filter(function(x){ return x.k === bestKey; }).map(function(x){ return x.b; });
      }
      for(var j = 0; j < pool.length; j++){
        if(!best || pool[j].cashPrice > best.cashPrice) best = pool[j];
      }
      if(!best) return;

      /* Guarantee same-month before either comparison is built, regardless
         of which path picked `best` above. The `keyed.length` branch already
         narrows `pool` to one month when at least one row parses -- but if
         EVERY row's deliveryMonth is unparseable, or every contract on offer
         is already behind `nowKey` (a real rollover-season case), `keyed`
         stays empty and `pool` silently falls back to every corn row across
         every month mixed together. Re-filtering here to best's own month
         closes that gap no matter how `best` was reached.
         A `best` with NO parseable month of its own (bestMonthKey === '')
         is the one case this can't fix by filtering: two unparseable rows
         matching on "both blank" is not evidence their delivery windows
         actually agree, so there is nothing safe to average -- pool is
         emptied instead of grouping them on a shared blank. Withhold, don't
         guess, per the site's own honest-numbers rule. */
      var bestMonthKey = rowMonthKey(best);
      pool = bestMonthKey ? pool.filter(function(p){ return rowMonthKey(p) === bestMonthKey; }) : [];

      /* Real, honest "how does this compare" data: average basis across
         every OTHER corn bid this same search already pulled in, at the
         same delivery month as the headline bid. Not a county average (no
         county field exists in this feed) and not a new fetch -- pool is
         the exact same qualifying-bid list the headline number above was
         picked from. Left null/0 when there is nothing to average, which
         the renderer must treat as "don't show this line", never as $0. */
      var basisVals = [], basisElev = {};
      for(var bi = 0; bi < pool.length; bi++){
        if(pool[bi] === best || rowKey(pool[bi]) === rowKey(best)) continue;
        if(pool[bi].basis != null){ basisVals.push(basisCents(pool[bi].basis) / 100); basisElev[rowKey(pool[bi])] = 1; }
      }
      var avgBasis = null;
      if(basisVals.length){
        var sumB = 0;
        for(var bj = 0; bj < basisVals.length; bj++) sumB += basisVals[bj];
        avgBasis = sumB / basisVals.length;
      }
      /* Nearby average, by real distance -- not a county, not the ZIP search
         radius the headline bid itself came from. A fixed ring (25 miles)
         drawn around the headline elevator's own coordinates, compared
         against every OTHER bid in the same pool that also carries real
         coordinates and falls inside that ring. A bid with no coordinates,
         or one further than the ring, is left out rather than assumed to
         match. If the headline bid itself has no coordinates, these fields
         stay unset and the line never appears -- the honest outcome for a
         Barchart-only search, not a bug. Computed before the event below so
         the one dispatch this function makes carries the real numbers --
         this used to run after the dispatch and silently never reached the
         page; caught by actually rendering the page, not by the event
         payload alone. */
      var nearbyRadiusMiles, avgBasisNearby, avgBasisNearbyCount, avgBasisNearbyElevators;
      if(typeof best.lat === 'number' && typeof best.lon === 'number'){
        var nearVals = [], nearElev = {};
        for(var ni = 0; ni < pool.length; ni++){
          var np = pool[ni];
          if(np === best || rowKey(np) === rowKey(best)) continue;
          if(typeof np.lat !== 'number' || typeof np.lon !== 'number' || np.basis == null) continue;
          if(milesBetween(best.lat, best.lon, np.lat, np.lon) <= NEARBY_RADIUS_MI){ nearVals.push(basisCents(np.basis) / 100); nearElev[rowKey(np)] = 1; }
        }
        nearbyRadiusMiles = NEARBY_RADIUS_MI;
        avgBasisNearby = nearVals.length ? (nearVals.reduce(function(a, b){ return a + b; }, 0) / nearVals.length) : null;
        avgBasisNearbyCount = nearVals.length;
        avgBasisNearbyElevators = Object.keys(nearElev).length;
      }

      var sum = {
        label: label || ('ZIP ' + zip),
        zip: zip,
        crop: 'corn',
        cash: best.cashPrice,
        basis: (best.basis == null ? null : basisCents(best.basis) / 100),
        monthKey: bestMonthKey,
        where: (best.facility || '') + (best.branch ? ' \u00b7 ' + best.branch : ''),
        city: (best.city || '') + (best.state ? ', ' + best.state : ''),
        miles: (best.distance == null ? null : best.distance),
        avgBasis: avgBasis,
        avgBasisCount: basisVals.length,
        avgBasisElevators: Object.keys(basisElev).length,
        avgBasisNearbyElevators: avgBasisNearbyElevators,
        nearbyRadiusMiles: nearbyRadiusMiles,
        avgBasisNearby: avgBasisNearby,
        avgBasisNearbyCount: avgBasisNearbyCount,
        elevators: elevators.length,
        boardCarry: boardCarry(best),   // r7-bids 7b
        ts: Date.now()
      };
      window.AGSIST_STATE = window.AGSIST_STATE || {};
      window.AGSIST_STATE.bids = sum;
      try{ window.dispatchEvent(new CustomEvent('agsist:bids', { detail: sum })); }
      catch(e){ var ev = document.createEvent('Event'); ev.initEvent('agsist:bids', false, false); window.dispatchEvent(ev); }
    }catch(e){}
  }

  // ── The two feeds ───────────────────────────────────────────────
  // The dedupe is the rule /cash-bids already uses (netKey): same operator
  // name once legal words and plurals are stripped, same town, same state.
  // Names that differ by a real word ("ADM Grain" / "ADM") are merged only by
  // isTwin() below, under much stricter conditions: a repeated elevator is
  // visible and fixable, a wrong merge hides a real one.
  var LEGAL = {llc:1,lc:1,inc:1,incorporated:1,co:1,corp:1,corporation:1,ltd:1,limited:1,lp:1,llp:1,company:1};
  function normOperator(name){
    var t = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')
      .replace(/co op/g, 'coop').replace(/co operative/g, 'cooperative')
      .split(' ').filter(function(x){ return x; });
    while(t.length && LEGAL[t[t.length - 1]]) t.pop();
    t = t.map(function(x){ return (x === 'cooperative' || x === 'coops') ? 'coop' : x; });
    var FOLD = {bros:'brother',brothers:'brother',brother:'brother',st:'saint',mt:'mount',ft:'fort',
                farmers:'farmer',assn:'association',assoc:'association',elev:'elevator',elevators:'elevator'};
    t = t.map(function(x){ return FOLD[x] || x; });
    t = t.map(function(x){ return (x.length > 3 && x.charAt(x.length - 1) === 's') ? x.slice(0, -1) : x; });
    return t.join('');
  }
  function plain(x){ return String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function rowKey(r){ return normOperator(r.facility) + '|' + plain(r.city) + '|' + plain(r.state); }

  // Load bids-network.js on demand so index.html does not have to carry it.
  // Resolves to the API, or null. Never rejects, never waits past 3 seconds.
  function ensureNet(){
    return new Promise(function(resolve){
      if(window.AGSIST_BIDS_NET) return resolve(window.AGSIST_BIDS_NET);
      var done = false;
      function finish(){ if(!done){ done = true; resolve(window.AGSIST_BIDS_NET || null); } }
      try{
        var sc = document.createElement('script');
        sc.src = NET_SCRIPT; sc.async = true;
        sc.onload = finish; sc.onerror = finish;
        document.head.appendChild(sc);
      }catch(e){ return finish(); }
      setTimeout(finish, 3000);
    });
  }

  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  // "2026-10" -> "Oct 2026". The board's own text ("Sept 26 Corn", "09/01/2026")
  // reads as a day, so the label is built from the period, not the board.
  function periodLabel(p){
    var m = /^(\d{4})-(\d{2})(?:\/(\d{4})-(\d{2}))?/.exec(p || '');
    if(!m || !MON[+m[2] - 1]) return '';
    /* A window: \"Aug\u2013Nov 2026\", so an open Aug-Nov bid does not read as August. */
    if(m[3] && (m[3] !== m[1] || m[4] !== m[2]) && MON[+m[4] - 1])
      return MON[+m[2] - 1] + (m[3] === m[1] ? '' : ' ' + m[1]) + '\u2013' + MON[+m[4] - 1] + ' ' + m[3];
    return MON[+m[2] - 1] + ' ' + m[1];
  }
  function ctToday(){ try{ return new Date().toLocaleDateString('en-CA', {timeZone:'America/Chicago'}); }catch(e){ return new Date().toISOString().slice(0, 10); } }
  function thisMonth(){ return ctToday().slice(0, 7); }

  // Each feed resolves to {rows, ok}. ok is false when the feed could not be
  // read at all; an empty answer from a feed that answered is ok.
  function fromNetwork(zip){
    return ensureNet().then(function(NET){
      if(!NET || typeof NET.snapshotForZip !== 'function') return {rows: [], ok: false};
      return NET.snapshotForZip(zip, { radiusMi: 50 }).then(function(snap){
        if(!snap || !snap.bids){
          return (typeof NET.reachable === 'function' ? NET.reachable() : Promise.resolve(true))
            .then(function(up){ return {rows: [], ok: !!up}; });
        }
        var now = thisMonth();
        var rows = [];
        feedTimes.network = snap.fetched || null;
        snap.bids.forEach(function(r){
          // A delivery window that has closed is not a bid.
          var pEnd = String(r.period || '').split('/').pop();
          if(/^\d{4}-\d{2}/.test(pEnd) && pEnd.slice(0, 7) < now) return;
          var cat = notPerBushel(r) ? 'other' : (/^(corn|soybeans|wheat)$/.test(r.crop || '') ? r.crop : classifyCommodity(r.commodity));
          rows.push({
            facility: r.facility || '', branch: r.branch || '',
            city: r.city || '', state: r.state || '',
            distance: r.distance == null ? null : r.distance,
            phone: r.phone || '', commodity: r.commodity || '',
            cashPrice: r.cashPrice == null ? null : r.cashPrice,
            // The network says its basis in cents; carry that, no unit guess.
            basis: r.basisCents != null && isFinite(r.basisCents) ? r.basisCents / 100 : (r.basis == null ? null : r.basis),
            deliveryMonth: periodLabel(r.period) || r.delivery || '',
            checkedAt: r.checkedAt || null,
            deliveryStart: r.period || '',
            category: cat, source: 'network', currency: r.currency || '',
            // Real coordinates, not a geocode -- bids-network.js already carries
            // each elevator's own lat/lon (it needs them to compute distance).
            // The licensed feed never gives us coordinates, so Barchart rows
            // leave these null and are simply left out of the nearby average.
            bestCash: r.bestCash == null ? null : r.bestCash, bestPeriod: r.bestPeriod || '',   // r7-bids 7b: the board's own later period
            lat: typeof r.lat === 'number' ? r.lat : null,
            lon: typeof r.lon === 'number' ? r.lon : null
          });
        });
        return {rows: rows, ok: true};
      });
    }).catch(function(){ return {rows: [], ok: false}; });
  }

  function fromLicensed(zip){
    if(!LICENSED_FEED) return Promise.resolve({rows: [], ok: null});   // not asked
    var url = PROXY_URL + '?zipCode=' + encodeURIComponent(zip) + '&maxDistance=50&getAllBids=1';
    var live = fetch(url)
      .then(function(r){ return r.ok ? r.json() : Promise.reject('HTTP ' + r.status); })
      .then(function(data){ feedTimes.licensed = new Date().toISOString(); var today = ctToday();
        /* A delivery window that ended before today is not a bid (Sep 26 corn on Oct 1). */
        var rows = flattenBarchartResponse(data).filter(function(b){ var e = String(b.deliveryEnd || '').slice(0, 10); return !(/^\d{4}-\d{2}-\d{2}$/.test(e) && e < today); });
        return {rows: rows, ok: true}; })
      .catch(function(err){ console.warn('[AGSIST] licensed bid feed:', err); return {rows: [], ok: false}; });
    return Promise.race([live, new Promise(function(res){ setTimeout(function(){ res({rows: [], ok: false}); }, LICENSED_DEADLINE_MS); })]);
  }

  // The delivery month of a row as YYYY-MM: from the label ("Nov 2026",
  // "Sep26", "Sept '26") first, then from the period / window start.
  function rowMonthKey(r){
    var mm = /^([A-Za-z]{3})[A-Za-z]*\s*'?(\d{2}|\d{4})$/.exec(String(r.deliveryMonth || '').trim());
    var i = mm ? MON.map(function(x){ return x.toLowerCase(); }).indexOf(mm[1].toLowerCase()) : -1;
    if(i >= 0) return (mm[2].length === 2 ? '20' + mm[2] : mm[2]) + '-' + ('0' + (i + 1)).slice(-2);
    var m = /^(\d{4})-(\d{2})(?:\/(\d{4})-(\d{2}))?/.exec(String(r.deliveryStart || ''));
    if(!m) return '';
    var st = m[1] + '-' + m[2], nw = thisMonth();
    /* An open window counts as this month, not the month it opened. */
    if(m[3] && st < nw && (m[3] + '-' + m[4]) >= nw) return nw;
    return st;
  }
  // The same elevator under a longer name ("ADM" and "ADM Grain" at Mankato):
  // same town, state, crop, delivery month, one whole normalised name a prefix
  // of the other, cash within one cent. Same rule as netIsTwin() in /cash-bids;
  // anything looser merges different companies (CHS Ag Terminals sits 5c under
  // ADM Mankato).
  function isTwin(a, b){
    if(a.category !== b.category || a.cashPrice == null || b.cashPrice == null) return false;
    if(Math.abs(a.cashPrice - b.cashPrice) > 0.01) return false;
    var ca = plain(a.city);
    if(!ca || ca !== plain(b.city) || !plain(a.state) || plain(a.state) !== plain(b.state)) return false;
    var ka = rowMonthKey(a);
    if(!ka || ka !== rowMonthKey(b)) return false;
    var na = normOperator(a.facility), nb = normOperator(b.facility);
    if(na.length < 3 || nb.length < 3) return false;
    return na.indexOf(nb) === 0 || nb.indexOf(na) === 0;
  }

  // Ours wins on price. A licensed row is dropped only where the network
  // already prices that SAME crop at that elevator; a crop the network lacks
  // there is kept. The licensed row lends its phone number either way.
  function mergeFeeds(net, lic){
    var mine = {}, out = net.slice();
    net.forEach(function(r){ (mine[rowKey(r)] = mine[rowKey(r)] || []).push(r); });
    lic.forEach(function(r){
      var k = rowKey(r), mates = mine[k];
      if(mates){
        mates.forEach(function(o){ if(!o.phone && r.phone) o.phone = r.phone; });
        var has = mates.some(function(o){ return o.category === r.category; });
        if(has) return;
      }
      for(var i = 0; i < net.length; i++){
        if(isTwin(net[i], r)){ if(!net[i].phone && r.phone) net[i].phone = r.phone; return; }
      }
      out.push(r);
    });
    return out;
  }

  function loadAllBids(zip){
    return Promise.all([fromNetwork(zip), fromLicensed(zip)]).then(function(x){
      // Neither feed could be read: say so. An empty list here would tell the
      // reader there are no elevators near them, which is not what happened.
      if(x[0].ok === false && (x[1].ok === false || x[1].ok === null)) throw new Error('no bid feed reachable');
      return mergeFeeds(x[0].rows, x[1].rows).filter(function(b){
        return (b.cashPrice !== null || b.basis !== null) && inScope(b) && plausible(b);
      });
    });
  }
  window.__agsistHomeBidsInternals = { mergeFeeds: mergeFeeds, rowKey: rowKey, fromNetwork: fromNetwork, widFor: widFor, publishSummary: publishSummary };

  // ── Main load function ──────────────────────────────────────────
  var loadSeq = 0;
  function loadHomepageBids(lat, lng, label, zip){
    var mySeq = ++loadSeq;
    var area = document.getElementById('bids-list-area');
    var geoTxt = document.getElementById('bids-geo-txt');
    if(!area) return;

    // Need ZIP for Barchart API
    if(!zip){
      area.innerHTML = '<div style="text-align:center;padding:1rem;font-size:.82rem;color:var(--text-muted)">'
        + 'Enter your ZIP to see nearby cash bids.<br><a href="/cash-bids" style="color:var(--gold)">Search any ZIP \u2192</a></div>';
      return;
    }

    // Update geo bar
    if(geoTxt){
      geoTxt.textContent = label ? label : ('ZIP ' + zip);
      /* r7-bids 7b: a ZIP is set, so the button changes it. */
      var zb = document.getElementById('bids-enter-zip-btn');
      if(zb){ zb.textContent = 'Change ZIP'; zb.setAttribute('aria-label', 'Change the ZIP code for nearby cash bids'); }
    }

    // Show loading skeleton
    area.innerHTML = '<div aria-label="Loading cash bids">'
      + '<div style="height:36px;background:var(--surface2);border-radius:6px;margin-bottom:.4rem;opacity:.4"></div>'
      + '<div style="height:36px;background:var(--surface2);border-radius:6px;margin-bottom:.4rem;opacity:.35"></div>'
      + '<div style="height:36px;background:var(--surface2);border-radius:6px;opacity:.3"></div>'
      + '</div>';

    // ── Both feeds, in parallel; neither failing empties the card ───
    loadAllBids(zip)
      .then(function(bids){
        if(mySeq !== loadSeq) return;   // a newer ZIP was asked while this loaded

        if(bids.length === 0){
          area.innerHTML = '<div style="text-align:center;padding:1rem;font-size:.82rem;color:var(--text-muted)">'
            + 'No elevator bids found within 50 mi.<br>'
            + '<a href="/cash-bids?zip=' + escHtml(zip) + '" style="color:var(--gold)">Try wider search \u2192</a></div>';
          return;
        }

        var elevators = groupByElevator(bids);
        elevators.sort(function(a,b){ return (a.distance||999) - (b.distance||999); });

        var top = elevators.slice(0, MAX_ELEVATORS);
        var totalElevators = elevators.length;

        // Column labels
        // 2026-10-01: column labels at .75rem; the rows below are what a
        // farmer reads in a truck (cash 1.05rem, basis and month .85rem).
        var html = '<div style="display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:.1rem .6rem;padding:0 0 .2rem;'
          + 'font-family:\'JetBrains Mono\',monospace;font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)">'
          + '<span>Crop</span><span style="text-align:right">Cash</span><span style="text-align:right">Basis</span></div>';

        top.forEach(function(elev){
          html += renderElevatorHTML(elev);
        });

        // When these numbers were read. Only feeds that put a row on the card.
        var anyNet = top.some(function(e){ return e.fromNetwork; });
        var anyLic = top.some(function(e){ return !e.fromNetwork; });
        var when = [];
        /* Each network board carries the time it was last read (checkedAt).
           The file's build time is not that, so it is not printed here. */
        var oldest = null;
        top.forEach(function(e){ if(!e.fromNetwork) return; COMM_ORDER.forEach(function(c){ (e.commodities[c] || []).forEach(function(b){ if(b.checkedAt && (!oldest || b.checkedAt < oldest)) oldest = b.checkedAt; }); }); });
        if(anyNet && ctTime(oldest)) when.push('Elevator boards read ' + ctTime(oldest) + (top.filter(function(e){ return e.fromNetwork; }).length > 1 ? ' or later' : ''));
        if(anyLic && ctTime(feedTimes.licensed)) when.push((when.length ? 'other quotes' : 'quotes') + ' read ' + ctTime(feedTimes.licensed));
        if(when.length){
          var w = when.join(' \u00b7 ');
          html += '<div class="r7-ref-note" hidden>A basis month is shown only where the board\u2019s cash minus its basis matches that futures contract on this page, within 15\u00a2.</div>';
          html += '<div class="bids-read-time" style="font-family:\'JetBrains Mono\',monospace;font-size:.75rem;color:var(--text-muted);padding:.45rem 0 0">' + escHtml(w.charAt(0).toUpperCase() + w.slice(1)) + '</div>';
        }

        // Footer link
        var extra = totalElevators - MAX_ELEVATORS;
        html += '<a href="/cash-bids?zip=' + escHtml(zip) + '" style="display:block;text-align:center;padding:.55rem 0 .1rem;font-size:.76rem;color:var(--gold);font-weight:600;text-decoration:none">';
        if(extra > 0){
          html += extra + ' more elevator' + (extra > 1 ? 's' : '') + ' nearby \u2014 View All \u2192';
        } else {
          html += 'View All Cash Bids \u2192';
        }
        html += '</a>';

        // 2026-09-30: a successful ZIP lookup is the single most personalized
        // moment on the homepage. Growth panel finding: the interaction ends
        // there with no ask. One line, only for a reader not already signed
        // up (window.isSignedUp, exposed by index.html; if it's not there
        // yet, fail open rather than block a real feature on that).
        var alreadySignedUp = (typeof window.isSignedUp === 'function') && window.isSignedUp();
        if(!alreadySignedUp){
          html += '<div style="margin-top:.5rem;padding:.5rem 0 0;border-top:1px solid var(--border);text-align:center">'
            + '<a href="#signup-compact" id="bids-cta-link" style="color:var(--gold);font-weight:600;font-size:.82rem;text-decoration:none">'
            /* 2026-10-01: this said "Get <ZIP> prices in your inbox". The
               signup it opens posts {email, source} -- no ZIP -- and the
               Daily is national. Promise what the form delivers. */
            + 'Get the AGSIST Daily in your inbox every weekday →</a></div>';
        }

        area.innerHTML = html;
        fillRefs(area);

        if(!alreadySignedUp){
          var ctaLink = document.getElementById('bids-cta-link');
          if(ctaLink){
            ctaLink.addEventListener('click', function(e){
              e.preventDefault();
              var su = document.getElementById('signup-compact');
              if(!su) return;
              su.style.display = 'flex';
              su.classList.add('is-asked');
              su.scrollIntoView({behavior:'smooth', block:'center'});
              var em = document.getElementById('compact-email');
              if(em) setTimeout(function(){ em.focus(); }, 400);
            });
          }
        }

        publishSummary(label, zip, bids, elevators);
        console.log('[AGSIST] Homepage bids: ' + top.length + ' elevators (' + bids.length + ' total bids)');
      })
      .catch(function(err){
        if(mySeq !== loadSeq) return;
        console.warn('[AGSIST] Homepage bids fetch failed:', err);
        area.innerHTML = '<div style="text-align:center;padding:1rem;font-size:.82rem;color:var(--text-muted)">'
          + 'Cash bids unavailable right now.<br><a href="/cash-bids" style="color:var(--gold)">Search cash bids \u2192</a></div>';
      });
  }

  // ── lookupBids — called from homepage ZIP entry ─────────────────
  function lookupBids(){
    var zipEl = document.getElementById('bids-zip');
    var zip = zipEl ? zipEl.value.trim() : '';
    if(!zip || zip.length !== 5 || isNaN(zip)) return;

    /* A ZIP typed here used to load bids and nothing else, so the weather
       card two hundred pixels above it kept showing somewhere else. Hand it
       to the one entry point, which fills every box and runs both. */
    if(typeof window.agsistSetZip === 'function'){ window.agsistSetZip(zip); return; }

    // Intent signal: a deliberate ZIP search on the homepage bid card.
    // Same event name as the cash-bids page so reporting unifies.
    try { if (typeof window.gtag === 'function') gtag('event', 'bids_search', { page: 'home', method: 'zip' }); } catch(e) {}

    // Geocode ZIP for label, then load bids
    fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + zip + '&count=1&language=en&format=json&countryCode=US')
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(d.results && d.results.length){
          var r = d.results[0];
          var label = r.name + (r.admin1 ? ', ' + r.admin1.substring(0,2) : '');
          loadHomepageBids(r.latitude, r.longitude, label, zip);
        } else {
          loadHomepageBids(null, null, 'ZIP ' + zip, zip);
        }
      })
      .catch(function(){
        loadHomepageBids(null, null, 'ZIP ' + zip, zip);
      });
  }

  // Expose globally
  window.loadHomepageBids = loadHomepageBids;
  window.lookupBids = lookupBids;

})();
