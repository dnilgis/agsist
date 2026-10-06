// ═══════════════════════════════════════════════════════════════════
// bids-homepage.js — Homepage Cash Bids Preview
// r7-bids 2026-10-01: rows grouped by delivery period, basis contract named, straight-line miles.
// HERO 2026-10-06: one row per elevator (price board), tap to expand; footer is one line;
//   publishes `agsist:bids-top` + window.__agsistBidsTop for the hero band after every render.
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
  var NET_SCRIPT = '/components/bids-network.js?v=5';

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
  /* WAVE1-A: a labelled HRS or DNS wheat row is a wheat class (shown as
     "Wheat · HRS"), not a special grade. Everything else is unchanged. */
  function isSpecialGrade(b){
    if(b && b.category === 'wheat' && wheatClass(b) === 'HRS') return false;
    return SPECIAL_GRADE.test(String(b && b.commodity || ''));
  }
  /* WAVE1-A: sorghum and oats bands. Sorghum quoted per hundredweight would
     read about 1.79x its per-bushel price; the network's own rows run $3.48
     to $5.67 a bushel (304 places, 2026-10-03). WAVE3-I: the band stops at
     $6, below the $6.21 that the lowest of those rows would read per cwt,
     and a row that names cwt is never read as a bushel price. */
  var PPU_BAND = { corn:[2,12], soybeans:[6,32], wheat:[3,20], sorghum:[2,6], oats:[1,8] };
  var PER_CWT = /\bcwt\b|hundredweight/i;
  function ppu(raw){ return raw == null ? null : (raw > 30 ? raw / 100 : raw); }
  // A row outside its own commodity's band is a unit mismatch, not a price.
  function plausible(b){
    var band = PPU_BAND[b.category];
    if(!band) return true;
    if(PER_CWT.test(String(b.commodity || ''))) return false;
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
    /* WAVE1-A: sorghum ("Milo") and oats are their own crops, not "Other". */
    if(/sorghum|\bmilo\b/.test(n)) return 'sorghum';
    if(/\boats?\b/.test(n)) return 'oats';
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

  /* PANEL6 D6 2026-10-06: ONE QUARTER-CENT FORMATTER, for the card and the
     hero band (index1 reads it from window.agsistBidFmt). The hero wrote
     $4.37 3/4 and the card $4.38 for the same bid. Rounded to the nearest
     quarter cent, the way the pit writes it. */
  function qParts(dollars){
    var c = Math.round(Number(dollars) * 400) / 4, w = Math.floor(c + 1e-9), f = Math.round((c - w) * 4);
    if(f === 4){ w++; f = 0; }
    return { whole: '$' + (w / 100).toFixed(2), frac: f ? ['', '1/4', '1/2', '3/4'][f] : '' };
  }
  function qCash(dollars, fracClass){
    if(dollars == null || !isFinite(Number(dollars))) return '\u2014';
    var p = qParts(dollars);
    return p.whole + (p.frac ? '<span class="' + (fracClass || 'bh-frac') + '"> ' + p.frac + '</span>' : '');
  }
  function qCashText(dollars){ if(dollars == null || !isFinite(Number(dollars))) return '\u2014'; var p = qParts(dollars); return p.whole + (p.frac ? ' ' + p.frac : ''); }
  /* Cents, signed: \u221262\u00a2, \u221262 1/2\u00a2, \u22121/2\u00a2, even. */
  function qCents(cents){
    var a = Math.abs(Number(cents)), q = Math.round(a * 4) / 4, w = Math.floor(q + 1e-9), f = Math.round((q - w) * 4);
    if(!w && !f) return 'even';
    return (cents < 0 ? '\u2212' : '+') + (w || !f ? String(w) : '') + (w && f ? ' ' : '') + (f ? ['', '1/4', '1/2', '3/4'][f] : '') + '\u00a2';
  }
  function formatBasis(bN){
    var cents = basisCents(bN);
    if(cents == null) return { str:'\u2014', cls:'muted' };
    return {
      /* 2026-10-01: a flat basis is "even", not "+0c". */
      str: qCents(cents),
      cls: cents > 0 ? 'pos' : cents < 0 ? 'neg' : 'muted'
    };
  }

  /* 2026-10-01: the futures month a basis is quoted against, read from the
     symbol the licensed feed sends (ZCZ26 -> Dec). The elevator network
     rows carry no symbol, so they print no month rather than a guessed one. */
  var FUT_MON = {F:'Jan',G:'Feb',H:'Mar',J:'Apr',K:'May',M:'Jun',N:'Jul',Q:'Aug',U:'Sep',V:'Oct',X:'Nov',Z:'Dec'};
  var WHEAT_EXCH = {KE:'KC', ZW:'Chicago', MW:'MGEX'};
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
      /* WAVE1-A: "Oct 2, 1:31 PM CT", the same shape as the coverage
         and second-feed lines under the card. */
      return (day === today ? '' : day + ', ') + t + ' CT';
    }catch(e){ return ''; }
  }
  var feedTimes = { network: null, licensed: null };

  var COMM_ORDER = ['corn','soybeans','wheat','sorghum','oats','other'];
  var COMM_NAMES = { corn:'Corn', soybeans:'Soybeans', wheat:'Wheat', sorghum:'Sorghum', oats:'Oats', other:'Other' };

  /* WAVE1-A: WHEAT BY CLASS, ONLY WHERE THE BOARD SAYS WHICH. "Winter Wheat"
     alone could be hard red or soft red, so it gets no class. Spring wheat
     (HRS, DNS) is a class, not a special grade, but it is quoted off
     Minneapolis, which this page has no price for, so it never names a
     contract. */
  function wheatClass(b){
    var t = String(b && b.commodity || '');
    if(/\bhrw\b|hrww|hard red winter|\bkc wheat/i.test(t)) return 'HRW';
    if(/\bsrw\b|soft red/i.test(t)) return 'SRW';
    if(/\bhrs\b|hard red spring|spring wheat|\bdns\b|dark northern/i.test(t)) return 'HRS';
    if(/soft white|\bsww\b|white wheat/i.test(t)) return 'SWW';
    if(/durum/i.test(t)) return 'Durum';
    return '';
  }

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
          city: b.city, town: b.town || '', state: b.state,
          distance: b.distance, phone: hasPhone(b.phone) ? b.phone : '',
          fromNetwork: false,
          /* WAVE1-A: the board's own coordinates and times, and its source id. */
          lat: typeof b.lat === 'number' ? b.lat : null, lon: typeof b.lon === 'number' ? b.lon : null,
          pricedAt: b.pricedAt || null, checkedAt: b.checkedAt || null, sourceId: b.sourceId || '',
          commodities: {}
        };
      }
      var elev = map[key];
      if(b.pricedAt && (!elev.pricedAt || b.pricedAt > elev.pricedAt)) elev.pricedAt = b.pricedAt;
      if(b.checkedAt && (!elev.checkedAt || b.checkedAt > elev.checkedAt)) elev.checkedAt = b.checkedAt;
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
  /* WAVE1-A 2026-10-03: FRESHNESS, PER ELEVATOR, FROM THE BOARD'S OWN TIMES.
     merged-index.json carries two times per place: pricedAt (when the board's
     prices last changed) and checkedAt (when the bids repo last read it). Both
     are printed on the elevator's line. A board whose last change is older
     than one trading day is flagged in words. A trading day here is a weekday;
     exchange holidays are not known to this file, so the Monday after a
     Friday holiday can flag a board one day early. The licensed feed sends no
     time per row, so its elevators print the time this page read the feed. */
  function ctDate(iso){
    var d = new Date(iso); if(!iso || isNaN(d)) return '';
    try{ return d.toLocaleDateString('en-CA', {timeZone:'America/Chicago'}); }catch(e){ return ''; }
  }
  function dayShift(ds, n){ var d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function isWeekend(ds){ var g = new Date(ds + 'T12:00:00Z').getUTCDay(); return g === 0 || g === 6; }
  function prevWeekday(ds){ var x = dayShift(ds, -1); while(isWeekend(x)) x = dayShift(x, -1); return x; }
  function lastWeekday(ds){ var x = ds; while(isWeekend(x)) x = dayShift(x, -1); return x; }
  function dayName(ds){
    var d = new Date(ds + 'T12:00:00Z'); if(isNaN(d)) return ds;
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()] + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }
  /* WAVE3-I: the board has not posted on the latest finished trading day.
     On a weekend or a Monday that is Friday, so a board last changed
     Thursday is flagged on Saturday. On a weekday it is yesterday, so a
     board that has not posted yet this morning is not flagged. */
  function staleSince(iso){
    var pd = ctDate(iso); if(!pd) return '';
    var cut = prevWeekday(ctToday());
    return pd < cut ? pd : '';
  }

  /* WAVE1-A: A PHONE IS PRINTED ONLY WHEN IT IS ONE. Ten digits after an
     optional leading 1, not all the same digit (the directory carries
     9999999999 for "none"). */
  function phoneDigits(p){
    var d = String(p || '').replace(/\D/g, '');
    if(d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    if(d.length !== 10 || /^(\d)\1+$/.test(d) || /^[01]/.test(d)) return '';
    return d;
  }
  function callLink(p){
    var d = phoneDigits(p); if(!d) return '';
    return '<a class="bh-call-a" href="tel:+1' + d + '">Call (' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6) + '</a>';
  }

  /* WAVE1-A: the join key for data/bids-prev/<ST>.json, built by
     scripts/build_bids_prev.py with the same FNV-1a over the same string:
     place|crop|period, exactly as merged-index.json writes them. */
  function fnv(s){
    var h = 0x811c9dc5;
    for(var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function prevKey(b){ return (b.source === 'network' && b.place && b.netCrop && b.deliveryStart) ? fnv(b.place + '|' + b.netCrop + '|' + b.deliveryStart) : ''; }

  /* WAVE1-A: ONE ELEVATOR AT ONE PIN UNDER SEVERAL TOWN NAMES. Dumas Co-op
     is filed under Dumas, Etter, Morton and Mwell, all at 35.8823,-101.968,
     and the card showed it three times. Places with the same operator at the
     same coordinates become one card. A row whose crop, period, cash and
     basis agree across towns is shown once; a row that differs (Morton's
     wheat is 15c over Dumas's) is kept and says which towns it is for. */
  /* 2026-10-06 THE TOWN TO PRINT. About 150 places in the bids repo carry an
     elevator's name in `city` ("Walsh Grain", "Melrose Farm Service"). The
     bids merge now publishes `town` beside it, filled only from a ZIP or
     geocode table, and null otherwise. `city` stays the key everywhere (board,
     contact, watch and dedupe keys); only what is printed changes. */
  function townOf(x){ return String((x && (x.town || x.city)) || ''); }
  function rowId(c, b){ return c + '|' + (b.deliveryStart || b.deliveryMonth || '') + '|' + b.cashPrice + '|' + b.basis + '|' + (b.commodity || ''); }
  function mergeOnePin(elevs){
    var seen = {}, out = [];
    elevs.forEach(function(e){
      if(!e.fromNetwork || typeof e.lat !== 'number' || typeof e.lon !== 'number'){ out.push(e); return; }
      var k = normOperator(e.facility) + '@' + e.lat.toFixed(4) + ',' + e.lon.toFixed(4) + '|' + plain(e.state);
      var m = seen[k], town = townOf(e);
      if(!m){
        e.towns = town ? [town] : [];
        COMM_ORDER.forEach(function(c){ (e.commodities[c] || []).forEach(function(b){ b.towns = town ? [town] : []; }); });
        seen[k] = e; out.push(e); return;
      }
      if(town && m.towns.indexOf(town) < 0) m.towns.push(town);
      if(!hasPhone(m.phone) && hasPhone(e.phone)) m.phone = e.phone;
      if(e.pricedAt && (!m.pricedAt || e.pricedAt > m.pricedAt)) m.pricedAt = e.pricedAt;
      if(e.checkedAt && (!m.checkedAt || e.checkedAt > m.checkedAt)) m.checkedAt = e.checkedAt;
      COMM_ORDER.forEach(function(c){
        (e.commodities[c] || []).forEach(function(b){
          var list = m.commodities[c] || (m.commodities[c] = []), id = rowId(c, b), hit = null;
          for(var i = 0; i < list.length; i++){ if(rowId(c, list[i]) === id){ hit = list[i]; break; } }
          if(hit){ if(town && hit.towns.indexOf(town) < 0) hit.towns.push(town); }
          else { b.towns = town ? [town] : []; list.push(b); }
        });
      });
    });
    return out;
  }

  /* 2026-10-06 HERO: ONE ROW PER ELEVATOR, A PRICE BOARD. The row is a
     button: name, a staleness tag, "town · N mi", then one cell per crop
     column (cash big, basis and the day's change small under it). Tapping it
     opens everything the card used to print open: freshness in words, Call,
     every delivery month with its basis contract and carry, basis vs normal,
     Watch this elevator. Nothing was removed, only moved behind the tap. */
  function byMonth(a, b){
    return (rowMonthKey(a) || '9999').localeCompare(rowMonthKey(b) || '9999') || delLabel(a).localeCompare(delLabel(b));
  }
  /* The cell's bid: the nearest delivery month, per bushel, standard grade. */
  function pickCell(elev, cat){
    var l = (elev.commodities[cat] || []).filter(function(b){ return !notPerBushel(b) && !isSpecialGrade(b) && ppu(b.cashPrice) != null && !rowExpired(b); });
    l.sort(byMonth);
    return l[0] || null;
  }
  function ctShort(iso){
    var d = new Date(iso); if(!iso || isNaN(d)) return '';
    try{ return d.toLocaleDateString('en-US', {month:'short', day:'numeric', timeZone:'America/Chicago'}); }catch(e){ return ''; }
  }
  /* "2026-10-01" (already a Central-time day) -> "Oct 1". */
  function ctShortDay(ds){ var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ds || ''); return m ? MON[+m[2] - 1] + ' ' + (+m[3]) : ''; }
  function ctClock(iso){
    var d = new Date(iso); if(!iso || isNaN(d)) return '';
    try{ return d.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit', timeZone:'America/Chicago'}); }catch(e){ return ''; }
  }
  /* Freshness, from this elevator's own times (WAVE1-A / WAVE3-I rule). */
  function freshness(elev){
    /* PANEL6 U16: a stale tag says "Old · Oct 1"; a fresh one the date only.
       `ageUnknown`: the board carries no posting time at all. */
    var o = { stale: false, full: '', tag: '—', kind: 'na', sr: '', ageUnknown: true };
    if(elev.fromNetwork){
      var chk = ctTime(elev.checkedAt) && ctTime(elev.checkedAt) !== ctTime(elev.pricedAt) ? ' · checked ' + ctTime(elev.checkedAt) : '';
      if(!ctTime(elev.pricedAt)){
        o.full = 'No posting time on record' + chk; o.sr = 'No posting time on record';
        return o;
      }
      var st = staleSince(elev.pricedAt);
      o.ageUnknown = false;
      o.stale = !!st;
      o.kind = st ? 'old' : 'ok';
      o.full = (st ? 'Not updated since ' : 'Posted ') + ctTime(elev.pricedAt) + chk;
      o.tag = (st ? 'Old · ' : '') + ctShort(elev.pricedAt);
      o.sr = (st ? 'Not updated since ' : 'Posted ') + ctShort(elev.pricedAt);
    } else {
      o.full = ctTime(feedTimes.licensed) ? 'Quotes read ' + ctTime(feedTimes.licensed) + ', no posting time sent' : 'No posting time sent';
      o.sr = 'No posting time sent';
    }
    return o;
  }
  /* The basis contract, by the same rules as the expanded rows: named from
     the licensed feed's symbol, or checked later against data/prices.json by
     fillRefs(). Returns the data attributes and any label known now. */
  /* PANEL6 D4: `staleOn` is the Central-time day a stale board last posted.
     Its basis is checked against that day's settle, not today's close. */
  function refFor(bid, cat, pp, staleOn){
    var r = { attr: '', label: '', short: '' };
    var rm = refMonth(bid.symbol);
    if(rm){
      r.label = 'basis vs ' + rm.replace(/ (corn|soybeans)$/, '');
      r.short = rm.slice(0, 3) + (/KC wheat$/.test(rm) ? ' KC' : '');
      return r;
    }
    if(pp != null && bid.basis != null && refCropFor(bid, cat)){
      var rc = refCropFor(bid, cat), ek = refEndKey(bid, rc === 'kcwheat' ? 'wheat' : rc);
      if(ek) r.attr = ' data-ref-crop="' + rc + '" data-ref-for="' + cat + '" data-ref-end="' + ek + '" data-ref-imp="' + (pp - basisCents(bid.basis) / 100).toFixed(4) + '"' + (bid.pricedAt || bid.checkedAt ? ' data-ref-read="' + escHtml(String(bid.pricedAt || bid.checkedAt)) + '"' : '')
        + (staleOn ? ' data-ref-on="' + escHtml(staleOn) + '"' : '');
    }
    return r;
  }
  function chgSpan(bid, perTon, special){
    var pk = perTon || special ? '' : prevKey(bid);
    if(!pk) return '';
    return '<span class="bh-chg" hidden data-pk="' + pk + '" data-st="' + escHtml(String(bid.state || '').toUpperCase()) + '" data-cash="' + bid.cashPrice + '" data-on="' + escHtml(ctDate(bid.pricedAt || bid.checkedAt)) + '"></span>';
  }
  /* PANEL6 D8: the delivery month, short: "Oct", or "Jan '27" when the year
     is not this one. From the same key every picker uses. */
  function monthShort(k){
    var m = /^(\d{4})-(\d{2})$/.exec(k || ''); if(!m) return '';
    return MON[+m[2] - 1] + (m[1] === ctToday().slice(0, 4) ? '' : ' \'' + m[1].slice(2));
  }
  function staleDay(elev, fr, bid){ return fr && fr.stale ? ctDate(bid.pricedAt || elev.pricedAt) : ''; }
  function cellHTML(elev, cat, fr){
    var name = COMM_NAMES[cat] || cat;
    var b = pickCell(elev, cat);
    if(!b){
      /* A board whose only rows are old-crop or new-crop outside their
         window (D1) does post a bid; it is just not a current one. */
      var why = (elev.commodities[cat] || []).some(rowExpired)
        ? 'only an old-crop or new-crop ' + name.toLowerCase() + ' bid outside its window; tap for it'
        : 'no standard ' + name.toLowerCase() + ' bid posted';
      return '<span class="bh-cell bh-cell--none" title="' + escHtml(why.charAt(0).toUpperCase() + why.slice(1)) + '"><span class="bh-ck">' + escHtml(name) + '</span><span class="bh-cash">—</span><span class="bh-vh">' + escHtml(why) + '</span></span>';
    }
    var pp = ppu(b.cashPrice), bs = formatBasis(b.basis), wc = cat === 'wheat' ? wheatClass(b) : '';
    var mon = monthShort(rowMonthKey(b));
    var sub = '';
    if(mon) sub += '<span class="bh-mon"><span class="bh-vh">for </span>' + escHtml(mon) + '</span>';
    if(bs.str !== '—'){
      var rf = refFor(b, cat, pp, staleDay(elev, fr, b));
      /* "Oct · −62¢" until the contract is known, then "Oct · −62¢ Dec". */
      var tail = rf.short ? ' ' + rf.short : '';
      sub += (mon ? '<span class="bh-sep" aria-hidden="true">·</span>' : '')
        + '<span class="bh-bas"><span class="bh-vh">, basis </span><span class="bh-num">' + bs.str + '</span><span class="bh-refm"' + rf.attr + '>' + escHtml(tail) + '</span></span>';
    }
    sub += chgSpan(b, false, false);
    return '<span class="bh-cell"><span class="bh-ck">' + escHtml(name + (wc ? ' · ' + wc : '')) + '</span>'
      + '<span class="bh-cash">' + qCash(pp) + '</span>'
      + (sub ? '<span class="bh-sub">' + sub + '</span>' : '') + '</span>';
  }

  var bhSeq = 0;
  /* A stable id per board: the same string goes on the row button as
     data-board-key and into the hero summary, so the hero can open it. */
  function boardKey(elev){ return 'b' + fnv([elev.facility, elev.branch, elev.city, elev.state, elev.fromNetwork ? 'n' : 'l'].map(function(x){ return String(x || '').trim().toUpperCase(); }).join('|')); }
  function renderElevatorHTML(elev, cropPick, bothFeeds, cols, isOpen, topLabel){
    var towns = (elev.towns && elev.towns.length > 1) ? elev.towns.join(', ') : townOf(elev);
    var cityState = towns + (towns && elev.state ? ', ' : '') + (elev.state||'');
    /* WAVE3-I: "straight-line" is said once, in How to read. */
    var distStr = elev.distance != null
      ? elev.distance.toFixed(0) + ' mi' + (elev.fromNetwork ? '' : ' from your ZIP')
      : '';
    var ck = contactKey(elev.facility, elev.city, elev.state);
    var fr = freshness(elev);
    var xid = 'bh-x-' + (++bhSeq);

    var html = '<div class="bh-elev' + (fr.stale ? ' is-stale' : '') + '" data-ck="' + escHtml(ck) + '" data-st="' + escHtml(String(elev.state || '').toUpperCase()) + '"'
      + (elev.sourceId ? ' data-src="' + escHtml(elev.sourceId) + '"' : '') + '>';

    // The row
    html += '<button type="button" class="bh-head" data-board-key="' + escHtml(boardKey(elev)) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '" aria-controls="' + xid + '">';
    html += '<span class="bh-id"><span class="bh-l1"><span class="bh-name">' + escHtml(elev.facility) + '</span>'
      + (topLabel ? '<span class="bh-topk">' + escHtml(topLabel) + '</span>' : '')
      + '<span class="bh-type"></span></span>';
    /* PANEL6 U12: the date tag sits on the town line, so every name line is
       one height. */
    var sub = [];
    if(cityState) sub.push(escHtml(cityState));
    if(distStr) sub.push('<span class="bh-mi">' + distStr + '</span>');
    sub.push('<span class="bh-age bh-age--' + fr.kind + '" title="' + escHtml(fr.full) + '"><span class="bh-dot" aria-hidden="true"></span><span class="bh-vh">' + escHtml(fr.sr) + '</span><span aria-hidden="true">' + escHtml(fr.tag) + '</span></span>');
    html += '<span class="bh-where">' + sub.join('<span class="bh-sep" aria-hidden="true"> · </span>') + '</span>';
    html += '</span>';
    cols.forEach(function(c){ html += cellHTML(elev, c, fr); });
    html += '<span class="bh-chev" aria-hidden="true"></span></button>';
    /* 2026-10-06 signup: "Watch" sits on the row, no expand needed. It is a
       sibling of the row button (a button cannot hold a button). Filled in
       below once we know the row offers a watch; its tap opens the row and
       runs the existing watch flow (components/homepage-extras.js). */
    var watchAt = html.length;

    // Everything else, behind the tap
    html += '<div class="bh-more" id="' + xid + '"' + (isOpen ? '' : ' hidden') + '>';
    html += '<div class="bh-fresh">' + (fr.stale ? '<span class="bh-stale">' + escHtml(fr.full.split(' · ')[0]) + '</span>' + (fr.full.indexOf(' · ') > 0 ? ' · ' + escHtml(fr.full.split(' · ').slice(1).join(' · ')) : '') : escHtml(fr.full)) + '</div>';
    html += '<div class="bh-call">' + callLink(elev.phone) + '</div>';
    if(elev.towns && elev.towns.length > 1){
      html += '<div class="bh-note">One location, filed under ' + elev.towns.length + ' town names. A row that differs by town says which.</div>';
    }
    /* WAVE3-I: the source tag only tells two feeds apart. */
    if(elev.fromNetwork && bothFeeds) html += '<div class="bh-note bh-direct">Direct from the elevator&rsquo;s own board</div>';

    // Every shown row, capped per crop as before, then grouped by period.
    var rows = [], over = [];
    COMM_ORDER.forEach(function(cat){
      if(cropPick && cropPick !== 'all' && cat !== cropPick) return;
      var catBids = (elev.commodities[cat] || []).slice();
      if(!catBids.length) return;
      catBids.sort(byMonth);
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
      html += '<div class="bh-per">' + escHtml(g.label) + '</div>';
      g.rows.sort(function(a,b){ return COMM_ORDER.indexOf(a.cat) - COMM_ORDER.indexOf(b.cat); });
      g.rows.forEach(function(r){
        var bid = r.b, cat = r.cat;
        var perTon = notPerBushel(bid);
        var pp = perTon ? null : ppu(bid.cashPrice);
        var cashStr = pp != null ? qCash(pp) : '—';
        var basis = perTon ? { str:'—', cls:'muted' } : formatBasis(bid.basis);
        var grade = String(bid.commodity || '').trim();
        var special = isSpecialGrade(bid);
        var wc = cat === 'wheat' ? wheatClass(bid) : '';
        var sameAsCrop = grade.toLowerCase() === String(COMM_NAMES[cat] || '').toLowerCase() || grade.toLowerCase() === cat
          || (cat === 'sorghum' && /^(milo|grain sorghum)$/i.test(grade));
        var cropTxt = (cat === 'other' && grade) ? grade : COMM_NAMES[cat] + (wc ? ' · ' + wc : '');
        var gradeTxt = cat === 'other'
          ? (perTon ? 'per ton, not per bushel' : special ? 'special grade' : '')
          : (sameAsCrop && !perTon && !special) || (wc && !perTon && !special) ? '' : grade
            + (perTon ? (grade ? ' · ' : '') + 'per ton, not per bushel' : '')
            + (special && !perTon ? (grade ? ' · ' : '') + 'special grade' : '');
        /* WAVE1-A: basis in one neutral colour; a negative basis is not bad news. */
        var refAttr = '', refTxt = '';
        if(!perTon && !special && basis.str !== '—'){
          var rf = refFor(bid, cat, pp, staleDay(elev, fr, bid));
          refTxt = rf.label; refAttr = rf.attr;
        }
        html += '<div class="bh-row">';
        html += '<span class="bh-rc"><span class="bh-rn">' + escHtml(cropTxt) + '</span>'
          + '<span class="r7-ref"' + refAttr + '>' + escHtml(refTxt) + '</span></span>';
        html += '<span class="bh-rcash">' + cashStr + '</span>';
        html += '<span class="bh-rchg">' + chgSpan(bid, perTon, special) + '</span>';
        html += '<span class="bh-rbas' + (basis.cls === 'muted' || special ? ' is-muted' : '') + '">' + basis.str + '</span>';
        /* A row that only some of a merged card's towns post. */
        if(elev.towns && elev.towns.length > 1 && bid.towns && bid.towns.length && bid.towns.length < elev.towns.length){
          gradeTxt = (gradeTxt ? gradeTxt + ' · ' : '') + 'at ' + bid.towns.join(', ');
        }
        if(gradeTxt) html += '<span class="bh-rnote">' + escHtml(gradeTxt) + '</span>';
        var bc = perTon || special ? null : boardCarry(bid);
        if(bc){
          html += '<span class="bh-rnote r7-carry">Carry ' + escHtml(bc.from) + ' → ' + escHtml(bc.to) + ': <span class="bh-fig">' + bc.txt + '</span></span>';
        }
        html += '</div>';
      });
    });

    if(over.length){
      html += '<div class="bh-note">+' + escHtml(over.join(', ')) + '</div>';
    }

    /* Basis vs normal, from USDA's weekly state series, for the crops shown. */
    var nCrops = [];
    ['corn','soybeans'].forEach(function(c){ if((!cropPick || cropPick === 'all' || cropPick === c) && (elev.commodities[c] || []).length) nCrops.push(c); });
    if(!cropPick || cropPick === 'all' || cropPick === 'wheat'){
      (elev.commodities.wheat || []).forEach(function(b){ var wc = wheatClass(b); if(USDA_CROP[wc] && /^(HRW|SRW|HRS)$/.test(wc) && nCrops.indexOf(wc) < 0) nCrops.push(wc); });
    }
    if(nCrops.length) html += '<div class="bh-normal" hidden data-st="' + escHtml(String(elev.state || '').toUpperCase()) + '" data-crops="' + nCrops.join(',') + '"></div>';

    // Watch this elevator. Scoped to corn, offered only with a real priced
    // corn row or a readable network row (WAVE2-G alert options).
    var opts = [];
    rows.forEach(function(r){
      var b = r.b;
      if(b.source !== 'network' || notPerBushel(b) || isSpecialGrade(b)) return;
      if(!/^(corn|soybeans|wheat|sorghum|oats)$/.test(b.netCrop || '') || !b.deliveryStart) return;
      var pp = ppu(b.cashPrice), bc = basisCents(b.basis);
      if(pp == null || bc == null || !b.pricedAt) return;
      opts.push({ w: widFor(b.state || elev.state, b.facility || elev.facility, b.city || elev.city, b.netCrop),
        c: b.netCrop, n: COMM_NAMES[b.netCrop], p: b.deliveryStart, l: delLabel(b),
        cash: Math.round(pp * 100), basis: Math.round(bc), t: ctTime(b.pricedAt) });
    });
    var cornBids = elev.commodities.corn;
    var hasCorn = !!(cornBids && cornBids.length);
    if((hasCorn || opts.length) && elev.state && elev.facility){
      var wid = hasCorn ? widFor(elev.state, elev.facility, elev.city, 'corn') : '';
      var name = elev.facility + (townOf(elev) ? ', ' + townOf(elev) + (elev.state ? ', ' + elev.state : '') : '');
      var label = escHtml(name + ' — corn');
      html += '<div class="watch-elevator-wrap" data-wid="' + wid + '" data-label="' + label + '" data-name="' + escHtml(name) + '"'
        + (opts.length ? ' data-opts="' + escHtml(JSON.stringify(opts)) + '"' : '') + '>'
        + '<button type="button" class="watch-elevator-btn">Watch this elevator</button>'
        + '</div>';
      html = html.slice(0, watchAt)
        + '<button type="button" class="bh-watch" aria-controls="' + xid + '" aria-label="Watch this elevator: ' + escHtml(name) + '">Watch</button>'
        + html.slice(watchAt);
    }

    html += '</div></div>';
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
  var REF_CYCLE = { corn:[3,5,7,9,12], soybeans:[1,3,5,7,8,9,11], wheat:[3,5,7,9,12], oats:[3,5,7,9,12], kcwheat:[3,5,7,9,12] };
  var REF_KEY = { corn:'corn', soybeans:'beans', wheat:'wheat', oats:'oats', kcwheat:'kcwheat' };
  /* WAVE1-A: WHICH FUTURES A ROW IS CHECKED AGAINST.
       sorghum   corn futures: milo is quoted off corn, and the label is only
                 printed when the board's cash minus basis lands on a corn
                 contract, so the data has to say so first.
       oats      CBOT oats, dated months are in data/prices.json.
       wheat     HRW is checked against KC wheat. The price file carries KC
                 only as its continuous front-month series (KE=F), so a match
                 names the exchange, never a month. SRW and unlabelled wheat
                 are checked against Chicago. HRS, white and durum are quoted
                 off contracts this page has no price for, so nothing is
                 named. */
  function refCropFor(b, cat){
    if(cat === 'corn' || cat === 'soybeans' || cat === 'oats') return cat;
    if(cat === 'sorghum') return 'corn';
    if(cat === 'wheat'){
      var wc = wheatClass(b);
      /* WAVE3-I: unlabelled wheat in the hard red winter states is checked
         against KC, not Chicago. */
      if(wc === '' && HRW_STATES.indexOf(String(b.state || '').trim().toUpperCase()) >= 0) return 'kcwheat';
      return wc === 'HRW' ? 'kcwheat' : (wc === '' || wc === 'SRW') ? 'wheat' : '';
    }
    return '';
  }
  var HRW_STATES = ['KS','OK','NE','CO','TX','SD','MT'];
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
    return { key: REF_KEY[cat] + '-' + MON_LC[pick - 1] + yy, label: MON[pick - 1] + ' \'' + yy + ' ' + (cat === 'soybeans' ? 'soybeans' : cat === 'wheat' ? 'Chicago wheat' : cat === 'kcwheat' ? 'KC wheat' : cat) };
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
  /* The contract a network basis is quoted against, or null. One copy of the
     rule, used by the card (fillRefs) and the hero summary (publishTop). */
  function harvestOnce(){
    if(!window.__agsistHarvestP){
      window.__agsistHarvestP = fetch('/data/harvest-prices.json', { cache: 'no-store' })
        .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
    }
    return window.__agsistHarvestP;
  }
  /* PANEL6 D4 2026-10-06: A STALE BOARD IS CHECKED AGAINST THE SETTLE ON THE
     DAY IT POSTED. Against today's close, a rally moved its cash minus basis
     more than 8 cents off and the month vanished, leaving a bare "−70¢".
     The only dated settles this page holds are data/harvest-prices.json
     windows[].series (Dec corn and Nov soybeans, one per trading day). The
     daily archive's quote_strip `prev` is not a settle and is never used.
     No settle on file for that day and contract: no month, never a guess. */
  var FUT_CODE = 'FGHJKMNQUVXZ';
  function settleOn(hp, crop, candKey, day){
    if(!hp || !Array.isArray(hp.windows) || !day) return null;
    var root = crop === 'corn' ? 'ZC' : crop === 'soybeans' ? 'ZS' : '';
    var m = /-([a-z]{3})(\d{2})$/.exec(candKey || '');
    if(!root || !m) return null;
    var tk = root + FUT_CODE.charAt(MON_LC.indexOf(m[1])) + m[2];
    for(var i = 0; i < hp.windows.length; i++){
      var w = hp.windows[i];
      if(!w || String(w.ticker || '').split('.')[0] !== tk || !Array.isArray(w.series)) continue;
      for(var j = 0; j < w.series.length; j++){
        var x = w.series[j];
        if(x && x.d === day && typeof x.s === 'number' && isFinite(x.s)) return x.s;
      }
    }
    return null;
  }
  function resolveRef(crop, forCrop, imp, endKey, q, onDay, hp){
    if(!isFinite(imp)) return null;
    if(onDay){
      var sc = refCandidate(crop, endKey);
      var sv = sc && settleOn(hp, crop, sc.key, onDay);
      if(sv == null || Math.abs(sv - imp) > REF_TOL) return null;
      var stext = forCrop === crop ? sc.label.replace(/ (corn|soybeans|oats)$/, '') : sc.label;
      return { label: sc.label, text: stext, close: sv, settleDay: onDay,
               short: sc.label.slice(0, 3) + (forCrop === crop ? '' : ' ' + crop) };
    }
    if(crop === 'kcwheat'){
      /* 2026-10-05: a dated KC contract by the same delivery-month rule
         as every other crop (the price file now carries kcwheat-dec26,
         -mar27, -may27). Front month was wrong for a July new-crop bid.
         It must be the nearest dated KC contract, within 8 cents, and
         nearer than Chicago's SAME month; a month not on file prints
         nothing. */
      var kcand = refCandidate('kcwheat', endKey);
      var kq = kcand && q[kcand.key];
      if(!kq || kq.close == null) return null;
      var kBest = null, kBestD = Infinity;
      Object.keys(q).forEach(function(k){ if(!/^kcwheat-[a-z]{3}\d{2}$/.test(k) || !q[k] || q[k].close == null) return; var d = Math.abs(q[k].close / 100 - imp); if(d < kBestD){ kBestD = d; kBest = k; } });
      if(kBest !== kcand.key || kBestD > REF_TOL) return null;
      var chiSame = q[kcand.key.replace(/^kcwheat-/, 'wheat-')];
      if(chiSame && chiSame.close != null && Math.abs(chiSame.close / 100 - imp) <= kBestD) return null;
      return { label: kcand.label, text: kcand.label, close: kq.close / 100, short: kcand.label.slice(0, 3) + ' KC' };
    }
    var cand = refCandidate(crop, endKey);
    var fq = cand && q[cand.key];
    if(!fq || fq.close == null) return null;
    /* 7b: the conventional month must also be the NEAREST listed
       contract to cash minus basis, and within 8 cents. Dec and Mar
       corn sit 14 1/4 cents apart; 15 cents could not tell them apart. */
    var best = null, bestD = Infinity, re = new RegExp('^' + REF_KEY[crop] + '-[a-z]{3}\\d{2}$');
    Object.keys(q).forEach(function(k){ if(!re.test(k) || !q[k] || q[k].close == null) return; var d = Math.abs(q[k].close / 100 - imp); if(d < bestD){ bestD = d; best = k; } });
    if(best !== cand.key || bestD > REF_TOL) return null;
    var text = forCrop === crop ? cand.label.replace(/ (corn|soybeans|oats)$/, '') : cand.label;
    return { label: cand.label, text: text, close: fq.close / 100,
             short: cand.label.slice(0, 3) + (forCrop === crop ? '' : ' ' + crop) };
  }
  var pricesData = null;
  var hpData = null;
  function fillRefs(area){
    Promise.all([pricesOnce(), harvestOnce()]).then(function(x){
      var pd = x[0]; pricesData = pd; hpData = x[1];
      var q = (pd && pd.quotes) || {}, n = 0, used = {}, settled = {}, oldest = '';
      var els = area.querySelectorAll('.r7-ref[data-ref-crop], .bh-refm[data-ref-crop]');
      for(var i = 0; i < els.length; i++){
        var el = els[i], crop = el.getAttribute('data-ref-crop'), forCrop = el.getAttribute('data-ref-for') || crop;
        var r = resolveRef(crop, forCrop, parseFloat(el.getAttribute('data-ref-imp')), el.getAttribute('data-ref-end'), q, el.getAttribute('data-ref-on') || '', hpData);
        if(!r) continue;
        var sdl = r.settleDay ? ctShortDay(r.settleDay) : '';
        /* A cell reads "−62 Dec"; the expanded row names the full contract. */
        if(el.classList.contains('bh-refm')){ el.textContent = ' ' + r.short; el.title = 'basis vs ' + r.text + (sdl ? ', matched to the ' + sdl + ' settle' : ''); continue; }
        el.textContent = 'basis vs ' + r.text;
        if(r.settleDay){ settled[r.label + ' ' + sdl] = r.close; n++; continue; }
        used[r.label] = r.close;
        var rdt = el.getAttribute('data-ref-read') || ''; if(rdt && (!oldest || rdt < oldest)) oldest = rdt;
        n++;
      }
      var note = area.querySelector('.r7-ref-note');
      if(note && n){
        /* 7b: the boards and the futures file are read at different times;
           say both, with the futures level the page actually has. */
        var fut = Object.keys(used).map(function(l){ return l + ' ' + qCashText(used[l]); }).join(', ');
        var stl = Object.keys(settled).map(function(l){ return l + ' ' + qCashText(settled[l]); }).join(', ');
        var ft = ctTime(pd && pd.fetched);
        note.textContent = (ft && fut ? 'Futures at ' + ft + ': ' + fut + '. Boards post at other times. ' : '')
          + (stl ? 'Old boards are matched to the settle on the day they posted: ' + stl + '. ' : '')
          + 'A basis month shows where cash minus basis lands within 8¢ of that contract.';
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
  /* WAVE1-A: one option per elevator and crop: its nearest open delivery
     month, per bushel, not a special grade. Nearest elevator first. */
  function storeOptions(bids, best){
    var nowKey = thisMonth(), by = {};
    bids.forEach(function(b){
      if(['corn','soybeans','wheat','sorghum','oats'].indexOf(b.category) < 0) return;
      if(b.cashPrice == null || notPerBushel(b) || isSpecialGrade(b)) return;
      var k = rowMonthKey(b); if(!k || k < nowKey) return;
      var id = rowKey(b) + '|' + b.category;
      var o = by[id];
      if(o && (o.monthKey < k || (o.monthKey === k && o.cash >= b.cashPrice))) return;
      by[id] = { id: id, crop: b.category, cropName: COMM_NAMES[b.category] + (b.category === 'wheat' && wheatClass(b) ? ' ' + wheatClass(b) : ''),
        where: (b.facility || '') + (b.branch ? ' \u00b7 ' + b.branch : ''),
        city: townOf(b) + (b.state ? ', ' + b.state : ''),
        miles: b.distance == null ? null : b.distance,
        cash: ppu(b.cashPrice), monthKey: k, monthLabel: shortMon(k),
        boardCarry: boardCarry(b), isBest: b === best };
    });
    /* One pin, several town names, same price: one option (see mergeOnePin). */
    var one = {}, out = [];
    Object.keys(by).forEach(function(k){
      var o = by[k];
      var sk = normOperator(o.where) + '|' + o.crop + '|' + o.monthKey + '|' + o.cash + '|' + (o.miles == null ? '' : Math.round(o.miles * 10));
      if(one[sk]){ if(o.isBest) one[sk].isBest = true; return; }
      one[sk] = o; out.push(o);
    });
    out.sort(function(a, b){ return COMM_ORDER.indexOf(a.crop) - COMM_ORDER.indexOf(b.crop) || (a.miles == null ? 999 : a.miles) - (b.miles == null ? 999 : b.miles); });
    return out.slice(0, 60);
  }

  function publishSummary(label, zip, bids, elevators){
    try{
      /* THE NEAREST OPEN MONTH FIRST, THEN THE HIGHEST PRICE INSIDE IT. The
         highest corn price across every month is an elevator's 2027 forward
         beating today's spot. White corn and other special grades never set
         the headline. A row with no month is used only if no row has one. */
      /* PANEL6 D3: the same pick as the hero (topPick): fresh boards first,
         stale only when none is fresh, expired new/old-crop rows never.
         The calculator's "Highest corn bid nearby" and the hero now name
         the same bid. `pool` is the picked month's rows from that pool. */
      var tp = topPick(elevators, 'corn');
      if(!tp) return;
      var best = tp.best.b;
      var pool = tp.pool.map(function(x){ return x.b; });
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
        city: townOf(best) + (best.state ? ', ' + best.state : ''),
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
        /* WAVE1-A: WHY THIS BID, IN WORDS THE CALCULATOR CAN PRINT. The rule
           above: the highest corn cash among bids for the nearest open
           delivery month. `pickCount` is how many bids it was chosen from. */
        pickRule: 'highest corn bid nearby',
        stale: !!tp.best.stale,
        higherOlder: tp.higherOlder ? { cash: ppu(tp.higherOlder.b.cashPrice), posted: tp.higherOlder.e.pricedAt || null } : null,
        pickCount: pool.length,
        monthLabel: shortMon(bestMonthKey) || '',
        /* Every listed elevator's nearest open bid per crop, so the reader can
           price the calculator off any of them. */
        options: storeOptions(bids, best),
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
  /* WAVE1-A: ...and never gives up for the page view. The script tag is
     added once. If it lands after the 3 seconds, `agsist:bids-net-ready`
     fires and the card draws again. If it fails, the next call adds it again. */
  var netScriptP = null, netScriptLate = false, netScriptState = 'none';
  function netReady(){ try{ window.dispatchEvent(new CustomEvent('agsist:bids-net-ready', { detail: { path: NET_SCRIPT } })); }catch(e){} }
  function ensureNet(){
    if(window.AGSIST_BIDS_NET){ netScriptState = 'ok'; return Promise.resolve(window.AGSIST_BIDS_NET); }
    if(!netScriptP){
      netScriptState = 'pending'; netScriptLate = false;
      netScriptP = new Promise(function(resolve){
        try{
          var sc = document.createElement('script');
          sc.src = NET_SCRIPT; sc.async = true;
          sc.onload = function(){ netScriptState = window.AGSIST_BIDS_NET ? 'ok' : 'failed'; if(netScriptState === 'failed') netScriptP = null; resolve(window.AGSIST_BIDS_NET || null); if(netScriptLate && window.AGSIST_BIDS_NET) netReady(); };
          sc.onerror = function(){ netScriptState = 'failed'; netScriptP = null; try{ sc.parentNode.removeChild(sc); }catch(e){} resolve(null); };
          document.head.appendChild(sc);
        }catch(e){ netScriptState = 'failed'; netScriptP = null; resolve(null); }
      });
    }
    var p = netScriptP;
    return new Promise(function(resolve){
      var done = false;
      p.then(function(n){ if(!done){ done = true; resolve(n); } });
      setTimeout(function(){ if(!done){ done = true; netScriptLate = true; resolve(null); } }, 3000);
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
      if(!NET || typeof NET.snapshotForZip !== 'function') return {rows: [], ok: false, pending: netScriptState === 'pending'};
      return NET.snapshotForZip(zip, { radiusMi: 50 }).then(function(snap){
        if(!snap || !snap.bids){
          /* WAVE1-A: null is "nothing within 50 miles" only when both the
             index and this ZIP's coordinate file actually loaded. A slow or
             failed file is not an empty answer. */
          if(typeof NET.status === 'function'){
            var stt = NET.status(zip);
            return {rows: [], ok: stt === 'ok', pending: stt === 'pending'};
          }
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
          var cat = notPerBushel(r) ? 'other' : (/^(corn|soybeans|wheat|sorghum|oats)$/.test(r.crop || '') ? r.crop : classifyCommodity(r.commodity));
          rows.push({
            facility: r.facility || '', branch: r.branch || '',
            city: r.city || '', town: r.town || '', state: r.state || '',
            distance: r.distance == null ? null : r.distance,
            phone: r.phone || '', commodity: r.commodity || '',
            cashPrice: r.cashPrice == null ? null : r.cashPrice,
            // The network says its basis in cents; carry that, no unit guess.
            basis: r.basisCents != null && isFinite(r.basisCents) ? r.basisCents / 100 : (r.basis == null ? null : r.basis),
            deliveryMonth: periodLabel(r.period) || r.delivery || '',
            checkedAt: r.checkedAt || null,
            /* WAVE1-A: when the board last changed, the crop key and place
               string merged-index.json uses (the daily-change join), and
               the board's source id (its own file carries its phone). */
            pricedAt: r.pricedAt || null, netCrop: r.crop || '', place: r.place || '', sourceId: r.sourceId || '',
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
  /* PANEL6 D1 2026-10-06: THE PERIOD TOKENS. The network files some rows as
     `spot`, `newcrop-YYYY` or `oldcrop-YYYY`, and this returned '' for all
     three, so Meyer's $12.10 new-crop soybean bid was dropped from "Top".
       spot          the current month.
       newcrop-YYYY  an open window: Sep-Dec of YYYY for corn, soybeans and
                     sorghum, Jun-Sep for wheat and oats. Inside it, the
                     current month; before it, the window start; after it,
                     expired.
       oldcrop-YYYY  the crop harvested in YYYY, inside its crop year: Jun YYYY
                     to May YYYY+1 for wheat, oats and barley, Sep YYYY to
                     Aug YYYY+1 for corn, soybeans and sorghum. Inside it, the
                     current month; before it, its first month; after it,
                     expired. (2026-10-06: it was "only before Sep of YYYY",
                     which hid ADM Plains KS's $6.75 old-crop HRW wheat.)
     YYYY IS THE HARVEST YEAR, measured on the bids repo's raw boards on
     2026-10-06: Cooperative Elevator Co. posts "Corn 2025" as O/C corn and
     "White Wheat 2026" as O/C wheat; FMN1 posts 2026 old-crop wheat for
     10/01/2026 delivery; ADM Plains' "Old Crop Wheat" is oldcrop-2026 in Oct
     2026. Same rule as deliveryMonth() in dnilgis/bids scripts/merge_bids.mjs.
     A real delivery end date on the row (deliveryEnd, YYYY-MM-DD) beats the
     token. The "(2026-12)" on a Gradable label is the FUTURES contract month,
     not a delivery month, and is not read as one.
     An expired row is never a current bid (rowExpired); a row with no month
     at all is still used last, as before. */
  var NC_WIN = { corn:[9,12], soybeans:[9,12], sorghum:[9,12], wheat:[6,9], oats:[6,9] };
  var CY_START = { wheat: 6, oats: 6, barley: 6 };
  function tokenMonth(r){
    var p = String(r.deliveryStart || '').trim().toLowerCase(), nw = thisMonth();
    var tok = p === 'spot' || /^(newcrop|oldcrop)-\d{4}$/.test(p);
    var de = tok ? /^(\d{4}-\d{2})-\d{2}$/.exec(String(r.deliveryEnd || '').trim()) : null;
    if(de) return de[1] >= nw ? { key: de[1] } : { key: '', expired: true };
    if(p === 'spot') return { key: nw };
    var nc = /^newcrop-(\d{4})$/.exec(p);
    if(nc){
      var w = NC_WIN[r.category] || NC_WIN[r.netCrop] || null;
      if(!w) return { key: '' };
      var s = nc[1] + '-' + ('0' + w[0]).slice(-2), e = nc[1] + '-' + ('0' + w[1]).slice(-2);
      if(nw < s) return { key: s };
      if(nw <= e) return { key: nw };
      return { key: '', expired: true };
    }
    var oc = /^oldcrop-(\d{4})$/.exec(p);
    if(oc){
      var a = CY_START[r.category] || CY_START[r.netCrop] || 9, y = +oc[1];
      var cs = y + '-' + ('0' + a).slice(-2);
      var ce = a === 1 ? y + '-12' : (y + 1) + '-' + ('0' + (a - 1)).slice(-2);
      if(nw < cs) return { key: cs };
      if(nw <= ce) return { key: nw };
      return { key: '', expired: true };
    }
    return null;
  }
  function rowExpired(r){ var t = tokenMonth(r); return !!(t && t.expired); }
  function rowMonthKey(r){
    var tk = tokenMonth(r);
    if(tk) return tk.key;
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
      if(x[0].ok === false && (x[1].ok === false || x[1].ok === null)){
        var err = new Error('no bid feed reachable'); err.pending = !!x[0].pending; throw err;
      }
      var out = mergeFeeds(x[0].rows, x[1].rows).filter(function(b){
        return (b.cashPrice !== null || b.basis !== null) && inScope(b) && plausible(b);
      });
      /* WAVE1-A: the caller needs to know whether the network answered. */
      out.netOk = x[0].ok !== false; out.netPending = !!x[0].pending;
      return out;
    });
  }
  window.__agsistHomeBidsInternals = { mergeFeeds: mergeFeeds, rowKey: rowKey, fromNetwork: fromNetwork, widFor: widFor, publishSummary: publishSummary,
    rowMonthKey: function(r){ return rowMonthKey(r); }, rowExpired: function(r){ return rowExpired(r); }, topEntry: function(e, c){ return topEntry(e, c); } };

  // ── WAVE1-A: the day's change, filled after the card draws ──────────
  // data/bids-prev/<ST>.json is written by scripts/build_bids_prev.py in the
  // bids workflow: per network place, crop and delivery period, the last cash
  // seen on each of the last few trading days (Central time). A row's change
  // is its cash now minus the last cash on the latest trading day BEFORE the
  // day its board last changed. Missing history prints an em dash and says
  // why; it is never a zero.
  var prevCache = {};
  function prevShard(st){
    if(!/^[A-Z]{2}$/.test(st)) return Promise.resolve(null);
    if(!prevCache[st]){
      prevCache[st] = fetch('/data/bids-prev/' + st + '.json', { cache: 'no-store' })
        .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; })
        .then(function(j){ if(!j) delete prevCache[st]; return j; });
    }
    return prevCache[st];
  }
  function fillChanges(area){
    var els = area.querySelectorAll('.bh-chg[data-pk]'), states = {};
    for(var i = 0; i < els.length; i++) states[els[i].getAttribute('data-st')] = 1;
    Object.keys(states).forEach(function(st){
      prevShard(st).then(function(j){
        var cells = area.querySelectorAll('.bh-chg[data-pk][data-st="' + st + '"]');
        for(var c = 0; c < cells.length; c++){
          var el = cells[c], hist = j && j.rows && j.rows[el.getAttribute('data-pk')];
          var on = el.getAttribute('data-on'), cash = parseFloat(el.getAttribute('data-cash'));
          /* 2026-10-06 HERO: no em-dash column. A change prints only when
             there is one; the reasons for a blank are in How to read. */
          el.hidden = true; el.className = 'bh-chg';
          if(!j){ el.textContent = ''; continue; }
          var prev = null;
          if(Array.isArray(hist) && on){ for(var h = 0; h < hist.length; h++){ if(hist[h] && hist[h][0] < on && hist[h][1] != null) prev = hist[h]; } }
          if(!prev || !isFinite(cash)){ el.textContent = ''; continue; }
          /* WAVE3-I: the earlier price's day is named whenever this is not
             a move into the latest trading day: a gap in the record, or a
             board that has not posted on the latest trading day. */
          var d = (cash - prev[1]) * 100, gap = prev[0] < prevWeekday(on) || on !== lastWeekday(ctToday());
          var tail = gap ? ' <span class="bh-chgd">' + escHtml(dayName(prev[0]).slice(0, 3)) + '</span>' : '';
          el.title = 'Change from this board’s last price on ' + dayName(prev[0]) + ', $' + (+prev[1]).toFixed(2);
          if(Math.abs(d) < 0.125){ el.innerHTML = 'unch' + tail; el.className = 'bh-chg is-flat'; }
          else { el.innerHTML = (d > 0 ? '▲' : '▼') + quarterCents(d) + '¢' + tail; el.className = 'bh-chg ' + (d > 0 ? 'is-up' : 'is-dn'); }
          el.hidden = false;
          el.setAttribute('aria-label', (Math.abs(d) < 0.125 ? 'unchanged' : (d > 0 ? 'up ' : 'down ') + quarterCents(d) + ' cents') + ' since ' + dayName(prev[0]));
        }
      });
    });
  }

  // ── WAVE1-A: phone and buyer type, from data the page can load ─────────
  // data/elevator-contacts/<ST>.json (scripts/build_elevator_contacts.py, from
  // the elevator directory) carries operator, town, phone and the directory's
  // own facility type. A network board's own file in the bids repo carries
  // the phone the elevator publishes, and that one wins. No type is guessed
  // from a name.
  var TYPE_WORD = { 'Country Elevator':'Elevator', 'Ethanol/Bio-Fuel':'Ethanol plant', 'River Terminal':'River terminal',
                    'Export Terminal':'Export terminal', 'Feed Mill':'Feed mill', 'Feedlot':'Feedlot' };
  function contactKey(fac, city, st){ return normOperator(fac) + '|' + plain(city) + '|' + plain(st); }
  var contactCache = {};
  function contactShard(st){
    if(!/^[A-Z]{2}$/.test(st)) return Promise.resolve(null);
    if(!contactCache[st]){
      contactCache[st] = fetch('/data/elevator-contacts/' + st + '.json')
        .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; })
        .then(function(j){
          if(!j || !Array.isArray(j.rows)){ delete contactCache[st]; return null; }
          var m = {};
          j.rows.forEach(function(r){ var k = contactKey(r[0], r[1], st); var o = m[k] || (m[k] = {}); if(!o.phone && phoneDigits(r[2])) o.phone = r[2]; if(!o.type && r[3]) o.type = r[3]; });
          return m;
        });
    }
    return contactCache[st];
  }
  function fillContacts(area){
    var els = area.querySelectorAll('.bh-elev[data-ck]');
    Array.prototype.forEach.call(els, function(el){
      var call = el.querySelector('.bh-call'), type = el.querySelector('.bh-type');
      var own = (el.getAttribute('data-src') && window.AGSIST_BIDS_NET && window.AGSIST_BIDS_NET.sourceFile)
        ? window.AGSIST_BIDS_NET.sourceFile(el.getAttribute('data-src')).then(function(j){ return j && j.source && j.source.contact && j.source.contact.phone || ''; }, function(){ return ''; })
        : Promise.resolve('');
      Promise.all([own, contactShard(el.getAttribute('data-st'))]).then(function(x){
        var c = x[1] && x[1][el.getAttribute('data-ck')];
        if(call && !call.innerHTML) call.innerHTML = callLink(x[0]) || (c ? callLink(c.phone) : '');
        /* WAVE3-I: "Elevator" is what every row is unless it says otherwise. */
        if(type && c && TYPE_WORD[c.type] && TYPE_WORD[c.type] !== 'Elevator'){ type.textContent = TYPE_WORD[c.type]; type.title = 'Facility type as the elevator directory files it'; }
      });
    });
  }

  // ── WAVE1-A: basis vs normal, from USDA's weekly state elevator series ──
  // There is no multi-year basis record per elevator: this site's own
  // per-elevator log (data/basis/changes-*.json) starts 2026-06-10, which
  // cannot give a same-week normal. data/transport/basis.json carries USDA
  // AgTransport's weekly state elevator-bid basis and, from
  // scripts/fetch_transport.py, its same-week average over the prior five
  // years and how many of those years were found (avg5_n). Gates: at least
  // 3 years, and a latest week no older than 21 days.
  var STATE_NAME = {AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
  var NORMAL_MIN_YEARS = 3, NORMAL_MAX_AGE_DAYS = 21;
  var USDA_CROP = { corn:'Corn', soybeans:'Soybeans', HRW:'Hard Red Winter Wheat', SRW:'Soft Red Winter Wheat', HRS:'Hard Red Spring Wheat' };
  var transportP = null;
  function transportOnce(){
    if(!transportP) transportP = fetch('/data/transport/basis.json').then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; })
      .then(function(j){ if(!j) transportP = null; return j; });
    return transportP;
  }
  /* WAVE5-A: scripts/fetch_transport.py rejects a USDA week outside a
     plausible basis band (+/- $5/bu) and lists it in j.rejected. The line says
     so, so a missing week or a thinner average is not silent. */
  function rejectedNote(j, key){
    var r = ((j && j.rejected) || []).filter(function(x){ return x && x.series === key; });
    if(!r.length) return '';
    return ' USDA posted ' + (r.length === 1 ? 'one week' : r.length + ' weeks') + ' (' + r.map(function(x){ return escHtml(x.date); }).join(', ')
      + ') outside a plausible basis band; ' + (r.length === 1 ? 'it is' : 'they are') + ' left out of the history and the average.';
  }
  function normalLine(stName, cropTxt, s, rej){
    var head = '<strong style="color:var(--text-dim)">' + escHtml(stName + ' ' + cropTxt) + ':</strong> ';
    if(rej && s) return normalLine(stName, cropTxt, s) + rej;
    if(!s) return head + '— no USDA state series here, and our elevator record (from June 2026) is too short.';
    var age = (Date.now() - Date.parse(s.date + 'T12:00:00Z')) / 864e5;
    if(!(age <= NORMAL_MAX_AGE_DAYS)) return head + '— USDA’s latest week for this series is ' + escHtml(s.date) + ', too old to compare.';
    if(s.avg5_n == null) return head + '— the number of years behind USDA’s same-week average is not in the file yet, so no comparison is printed.';
    if(s.avg5 == null || s.avg5_n < NORMAL_MIN_YEARS) return head + '— only ' + s.avg5_n + ' earlier year' + (s.avg5_n === 1 ? '' : 's') + ' on record for this week; ' + NORMAL_MIN_YEARS + ' are needed to call a normal.';
    var now = Math.round(s.latest * 100), avg = Math.round(s.avg5 * 100), d = now - avg;
    var fmt = function(c){ return (c > 0 ? '+' : c < 0 ? '−' : '') + Math.abs(c) + '¢'; };
    var verdict = Math.abs(d) <= 1 ? '<strong style="color:var(--text-dim)">about normal</strong>'
      : '<strong style="color:' + (d > 0 ? 'var(--green)' : 'var(--red)') + '">' + Math.abs(d) + '¢ ' + (d > 0 ? 'stronger' : 'weaker') + '</strong> than normal';
    return head + 'elevator average ' + fmt(now) + ' the week of ' + escHtml(s.date) + ', ' + verdict
      + ' (same week, ' + s.avg5_n + '-year average ' + fmt(avg) + ', ' + s.avg5_n + ' of 5 years found).';
  }
  /* 2026-10-06 HERO: one box per elevator, inside its expanded row, for that
     elevator's own state and the crops it posts. */
  function fillNormal(area){
    var boxes = area.querySelectorAll('.bh-normal[data-st]');
    if(!boxes.length) return;
    transportOnce().then(function(j){
      Array.prototype.forEach.call(boxes, function(box){
        var st = box.getAttribute('data-st'), stName = STATE_NAME[st];
        var crops = String(box.getAttribute('data-crops') || '').split(',').filter(function(x){ return x; });
        if(!stName || !crops.length){ box.hidden = true; return; }
        var head = '<div class="bh-normal-h">Basis vs normal</div>';
        if(!j){ box.innerHTML = head + '— the USDA basis file did not load.'; box.hidden = false; return; }
        var ser = j.series || {}, lines = [], none = [];
        crops.forEach(function(c){
          var nm = USDA_CROP[c]; if(!nm) return;
          var cropTxt = c === 'corn' ? 'corn' : c === 'soybeans' ? 'soybeans' : c + ' wheat';
          var sr = ser[nm + '|' + stName + '|Elevator Bid'];
          if(!sr){ none.push(cropTxt); return; }
          lines.push('<div>' + normalLine(stName, cropTxt, sr, rejectedNote(j, nm + '|' + stName + '|Elevator Bid')) + '</div>');
        });
        var withData = lines.length;
        if(!withData && !none.length){ box.hidden = true; return; }
        /* Crops with no state series share one line, said once. */
        if(none.length) lines.push('<div>' + normalLine(stName, none.join(' and '), null) + '</div>');
        box.innerHTML = head + lines.join('')
          + (withData ? '<div>State average across USDA’s reporting elevators (AgTransport, weekly), not this elevator.</div>' : '');
        box.hidden = false;
      });
    });
  }

  // ── Main load function ──────────────────────────────────────────
  var loadSeq = 0;
  /* WAVE1-A: the last request, so a late file or a reconnect can draw again. */
  var lastArgs = null, degraded = false;
  function retryLoad(){
    try{ if(window.AGSIST_BIDS_NET && window.AGSIST_BIDS_NET.reset) window.AGSIST_BIDS_NET.reset(); }catch(e){}
    if(lastArgs) loadHomepageBids.apply(null, lastArgs);
  }
  window.addEventListener('agsist:bids-net-ready', function(){ if(degraded && lastArgs) loadHomepageBids.apply(null, lastArgs); });
  window.addEventListener('online', function(){ if(degraded) retryLoad(); });
  var CROP_KEY = 'agsist_bids_crop';
  function savedCrop(){ try{ return window.localStorage.getItem(CROP_KEY) || 'all'; }catch(e){ return 'all'; } }

  function errorHTML(pending, zip){
    return '<div class="bh-err" style="text-align:center;padding:1rem;font-size:.82rem;color:var(--text-muted)">'
      + (pending ? 'Elevator bids are still loading on this connection. They will fill in here when they arrive.'
                 : 'Cash bids unavailable right now.')
      + '<br><button type="button" class="bh-retry" style="margin:.5rem 0 .2rem;min-height:44px;padding:.4rem 1rem;background:none;border:1px solid var(--border);border-radius:6px;color:var(--gold);font-weight:700;font-size:.82rem;cursor:pointer">Try again</button>'
      + '<br><a href="/cash-bids' + (zip ? '?zip=' + escHtml(zip) : '') + '" style="color:var(--gold)">Search cash bids →</a></div>';
  }

  // ── 2026-10-06 HERO: the card's own styles ───────────────────────
  // index.html and index1.html both draw this card and only index1 loads
  // css/home.css, so the card carries its layout with it. Inserted first in
  // <head>, so any page stylesheet still overrides it.
  var CARD_CSS = [
    '#bids-list-area .bh-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '#bids-list-area .bh-crops{display:flex;flex-wrap:wrap;gap:.35rem;margin:0 0 .5rem}',
    '#bids-list-area .bh-crop{min-height:36px;padding:.25rem .75rem;border-radius:999px;font-family:inherit;font-size:.8125rem;font-weight:700;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text-dim)}',
    '#bids-list-area .bh-crop[aria-pressed="true"]{border-color:var(--gold);background:var(--gold);color:#0a0c0d}',
    '#bids-list-area .bh-degraded{font-size:.8125rem;color:var(--text-dim);margin:0 0 .4rem}',
    '#bids-list-area .bh-cols{display:none}',
    '#bids-list-area .bh-elev{border-bottom:1px solid var(--border)}',
    '#bids-list-area .bh-head{display:grid;grid-template-columns:minmax(0,1fr) 1.25rem;column-gap:.75rem;row-gap:.25rem;align-items:start;width:100%;box-sizing:border-box;margin:0;padding:.6rem 0;background:none;border:0;border-radius:0;color:inherit;font:inherit;text-align:left;cursor:pointer}',
    '#bids-list-area .bh-head:focus-visible{outline:2px solid var(--gold);outline-offset:2px}',
    '#bids-list-area .bh-head:hover .bh-name{text-decoration:underline;text-underline-offset:3px}',
    '#bids-list-area .bh-id{grid-column:1;grid-row:1;min-width:0;display:block}',
    '#bids-list-area .bh-chev{grid-column:2;grid-row:1;align-self:center;text-align:right;color:var(--text-muted);font-size:1.1rem;line-height:1}',
    '#bids-list-area .bh-chev::before{content:"+"}',
    '#bids-list-area .bh-head[aria-expanded="true"] .bh-chev::before{content:"\\2212"}',
    '#bids-list-area .bh-l1{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:.5rem;min-width:0}',
    '#bids-list-area .bh-name{min-width:0;overflow-wrap:break-word;font-size:1rem;font-weight:700;line-height:1.3;color:var(--text)}',
    '#bids-list-area .bh-age{flex:none;display:inline-flex;align-items:center;gap:.3rem;font-size:.8125rem;font-weight:500;color:var(--text-muted);white-space:nowrap}',
    '#bids-list-area .bh-dot{width:7px;height:7px;border-radius:50%;background:var(--text-muted);flex:none}',
    '#bids-list-area .bh-age--ok .bh-dot{background:var(--green)}',
    '#bids-list-area .bh-age--old .bh-dot{background:var(--orange,#d08a3c)}',
    '#bids-list-area .bh-type{flex:none;font-size:.8125rem;color:var(--text-muted);white-space:nowrap}',
    '#bids-list-area .bh-type:empty{display:none}',
    '#bids-list-area .bh-where{display:block;margin-top:.1rem;font-size:.8125rem;color:var(--text-muted)}',
    '#bids-list-area .bh-where .bh-age{display:inline-flex;vertical-align:baseline}',
    '#bids-geo-bar.bh-geo-quiet{justify-content:flex-end;margin-bottom:0!important}',
    '#bids-geo-bar.bh-geo-quiet>span[aria-hidden="true"]{display:none!important}',
    '#bids-geo-bar.bh-geo-quiet #bids-geo-txt{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '#bids-list-area .bh-cell{grid-column:1/-1;display:grid;grid-template-columns:6.5rem auto minmax(0,1fr);column-gap:.6rem;align-items:baseline}',
    '#bids-list-area .bh-ck{font-size:.875rem;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#bids-list-area .bh-cash{font-family:"JetBrains Mono",monospace;font-size:1.125rem;font-weight:700;color:var(--text);white-space:nowrap}',
    '#bids-list-area .bh-cell--none .bh-cash{color:var(--text-muted);font-weight:400}',
    /* PANEL6 U2: at 200% text the sub-line wraps instead of running over the price. */
    '#bids-list-area .bh-sub{display:flex;flex-wrap:wrap;justify-content:flex-end;justify-content:safe flex-end;column-gap:.35rem;min-width:0;font-size:.8125rem;color:var(--text-muted)}',
    /* Monospace for figures only (HERO type rule); "Oct" and "Dec" are words. */
    '#bids-list-area .bh-num{font-family:"JetBrains Mono",monospace}',
    '#bids-list-area .bh-sub>span{white-space:nowrap}',
    '#bids-list-area .bh-frac{font-size:.8em;font-weight:600}',
    '#bids-list-area .bh-topk{flex:none;font-size:.8125rem;font-weight:700;color:var(--gold);white-space:nowrap}',
    '[data-theme="light"] #bids-list-area .bh-topk{color:#86600f}',
    '#bids-list-area .bh-chg{font-family:"JetBrains Mono",monospace;font-size:.8125rem;white-space:nowrap}',
    '#bids-list-area .bh-chg[hidden]{display:none}',
    '#bids-list-area .bh-chg.is-up{color:var(--green)}',
    '#bids-list-area .bh-chg.is-dn{color:var(--red)}',
    '#bids-list-area .bh-chg.is-flat{color:var(--text-muted)}',
    '#bids-list-area .bh-chgd{font-family:inherit}',
    '#bids-list-area .bh-more{padding:0 0 .75rem;font-size:.875rem;color:var(--text-dim)}',
    '#bids-list-area .bh-more[hidden]{display:none}',
    '#bids-list-area .bh-fresh,#bids-list-area .bh-note{font-size:.8125rem;color:var(--text-muted)}',
    '#bids-list-area .bh-stale{font-weight:700;color:var(--text-dim)}',
    '#bids-list-area .bh-call:empty{display:none}',
    '#bids-list-area .bh-call-a{display:inline-flex;align-items:center;min-height:44px;font-size:.875rem;font-weight:700;color:var(--gold);text-decoration:none;white-space:nowrap}',
    '#bids-list-area .bh-per{margin:.5rem 0 .1rem;font-size:.8125rem;font-weight:700;color:var(--text-muted)}',
    '#bids-list-area .bh-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;column-gap:.6rem;align-items:baseline;padding:.15rem 0}',
    '#bids-list-area .bh-rc{min-width:0}',
    '#bids-list-area .bh-rn{font-size:.875rem;color:var(--text-dim)}',
    '#bids-list-area .bh-rc .r7-ref{font-size:.8125rem;color:var(--text-muted)}',
    '#bids-list-area .bh-rc .r7-ref:not(:empty)::before{content:"\\00a0\\00b7\\00a0"}',
    '#bids-list-area .bh-rcash{font-family:"JetBrains Mono",monospace;font-size:1rem;font-weight:700;color:var(--text);text-align:right;white-space:nowrap}',
    '#bids-list-area .bh-rchg{text-align:right}',
    '#bids-list-area .bh-rbas{min-width:3rem;font-family:"JetBrains Mono",monospace;font-size:.875rem;font-weight:700;color:var(--text-dim);text-align:right;white-space:nowrap}',
    '#bids-list-area .bh-rbas.is-muted{color:var(--text-muted)}',
    '#bids-list-area .bh-rnote{grid-column:1/-1;font-size:.8125rem;color:var(--text-muted)}',
    '#bids-list-area .bh-fig{font-family:"JetBrains Mono",monospace;color:var(--text-dim)}',
    '#bids-list-area .bh-normal{margin-top:.4rem;font-size:.8125rem;color:var(--text-muted)}',
    '#bids-list-area .bh-normal[hidden]{display:none}',
    '#bids-list-area .bh-normal-h{font-weight:700;color:var(--text-dim)}',
    '#bids-list-area .bh-elev{position:relative}',
    '#bids-list-area .bh-elev:has(>.bh-watch) .bh-id{padding-right:3.6rem}',
    '#bids-list-area .bh-watch{position:absolute;top:0;right:1.6rem;min-width:44px;min-height:44px;padding:0 .3rem;background:none;border:0;border-radius:6px;font-family:inherit;font-size:.875rem;font-weight:600;color:var(--gold);text-decoration:underline;text-underline-offset:3px;cursor:pointer}',
    '[data-theme="light"] #bids-list-area .bh-watch{color:#86600f}',
    '#bids-list-area .bh-watch:focus-visible{outline:2px solid var(--gold);outline-offset:0}',
    '#bids-list-area .watch-elevator-btn{min-height:44px;padding:0;background:none;border:0;font-family:inherit;font-size:.8125rem;color:var(--text-muted);text-decoration:underline;cursor:pointer}',
    '#bids-list-area .bh-foot{display:flex;justify-content:flex-end;align-items:center;padding:.35rem 0 0;font-size:.875rem}',
    '#bids-list-area .bh-links{display:flex;flex-wrap:wrap;align-items:center;column-gap:.4rem;font-size:.8125rem;color:var(--text-muted)}',
    '#bids-list-area .bh-sep{color:var(--text-muted)}',
    '#bids-list-area .bh-tipb{min-height:44px;padding:0;background:none;border:0;font-family:inherit;font-size:.8125rem;color:var(--text-muted);cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}',
    '#bids-list-area .bh-fl{display:inline-flex;align-items:center;min-height:44px;color:var(--text-muted);text-decoration:underline;text-underline-offset:3px}',
    '#bids-list-area .bh-all{display:inline-flex;align-items:center;min-height:44px;color:var(--gold);font-weight:600;text-decoration:none}',
    '#bids-list-area .bh-tip{padding:.1rem 0 .5rem;font-size:.8125rem;line-height:1.5;color:var(--text-muted)}',
    '#bids-list-area .bh-tip[hidden]{display:none}',
    '#bids-list-area .bh-tip>div+div{margin-top:.35rem}',
    '#bids-list-area .bh-tip b{color:var(--text-dim)}',
    '#bids-list-area .bh-feed:empty{display:none}',
    '[data-theme="light"] #bids-list-area :is(.bh-all,.bh-call-a){color:#86600f}',
    '#bids-list-area .bh-mi{white-space:nowrap}',
    /* A narrow card (index.html's side column, any phone) keeps stacked rows. */
    '#bids-list-area{container-type:inline-size}'
  ].join('\n') + '\n' + colRules(':not(.bh-k3)', 460) + '\n' + colRules('.bh-k3', 580);
  /* Columns once the card itself is wide enough: 460px for two crops, 580px
     for three, so a name is never broken mid-word to fit a third column. */
  function colRules(k, min){
    var P = '#bids-list-area .bh-list' + k + ' ';
    return ['@container (min-width:' + min + 'px){',
      P + '.bh-cols,' + P + '.bh-head{grid-template-columns:minmax(0,1fr) repeat(var(--bh-k,2),6.5rem) 1.25rem;column-gap:.75rem}',
      P + '.bh-cols{display:grid;padding:0 0 .3rem;border-bottom:1px solid var(--border);font-size:.8125rem;font-weight:600;color:var(--text-muted)}',
      P + '.bh-cols>span{text-align:right}',
      P + '.bh-head{align-items:center}',
      P + '.bh-cell{grid-column:auto;grid-row:1;display:flex;flex-direction:column;align-items:flex-end;text-align:right}',
      P + '.bh-cell .bh-ck{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}',
      P + '.bh-cash{font-size:1.25rem;line-height:1.25}',
      P + '.bh-head>.bh-chev{grid-column:-2}',
      P + '.bh-more{padding-right:calc(1.25rem + .75rem)}',
      /* Watch sits at the right edge of the name column, clear of the price columns. */
      P + '.bh-watch{right:calc(1.25rem + .75rem + var(--bh-k,2) * (6.5rem + .75rem))}',
      '}'].join('\n');
  }
  function ensureCSS(){
    if(document.getElementById('bh-css')) return;
    try{
      var st = document.createElement('style');
      st.id = 'bh-css'; st.textContent = CARD_CSS;
      document.head.insertBefore(st, document.head.firstChild);
    }catch(e){}
  }

  // ── 2026-10-06 HERO: the top bid per crop, for the band at the top ──
  // Each crop's entry is the board with the highest cash for the nearest open
  // delivery month, per bushel, standard grade, among the boards this card
  // holds that it does not flag as stale. If every board is stale, the
  // highest stale one, marked stale. No board: null. Same radius as the card.
  var BIDS_RADIUS_MI = 50;
  var topSeq = 0;
  /* PANEL6 D3 2026-10-06: ONE PICK, USED BY THE HERO AND THE CALCULATOR.
     The pool is the boards this card does not flag as stale; if there are
     none, the stale ones. Inside the pool: the nearest open delivery month,
     then the highest cash. Expired new-crop and old-crop rows are never in
     it (D1). When the pick came from the fresh pool and a stale board bids
     more for the same month, that bid is returned as `higherOlder`, so a
     lone fresh board's lower bid is never called "Top" without saying so. */
  function topPick(elevators, cat){
    var nowKey = thisMonth(), fresh = [], old = [];
    elevators.forEach(function(e){
      var fr = freshness(e);
      (e.commodities[cat] || []).forEach(function(b){
        if(notPerBushel(b) || isSpecialGrade(b) || ppu(b.cashPrice) == null || rowExpired(b)) return;
        (fr.stale ? old : fresh).push({ e: e, b: b, stale: fr.stale, fr: fr });
      });
    });
    function narrow(list){
      var keyed = list.filter(function(x){ var k = rowMonthKey(x.b); return k && k >= nowKey; });
      if(!keyed.length) return { pool: list, mk: '' };
      var mk = keyed.reduce(function(m, x){ var k = rowMonthKey(x.b); return !m || k < m ? k : m; }, '');
      return { pool: keyed.filter(function(x){ return rowMonthKey(x.b) === mk; }), mk: mk };
    }
    function highest(list){ var best = null; list.forEach(function(x){ if(!best || ppu(x.b.cashPrice) > ppu(best.b.cashPrice)) best = x; }); return best; }
    var src = fresh.length ? fresh : old;
    if(!src.length) return null;
    var n = narrow(src), best = highest(n.pool);
    var higherOlder = null;
    if(fresh.length && old.length){
      var mk = rowMonthKey(best.b);
      var hi = highest(old.filter(function(x){ return rowMonthKey(x.b) === mk; }));
      if(hi && ppu(hi.b.cashPrice) > ppu(best.b.cashPrice)) higherOlder = hi;
    }
    return { best: best, pool: n.pool, higherOlder: higherOlder };
  }
  function topEntry(elevators, cat){
    var tp = topPick(elevators, cat);
    if(!tp) return null;
    var best = tp.best;
    var b = best.b, e = best.e, pp = ppu(b.cashPrice), bc = basisCents(b.basis);
    var ref = null, rm = refMonth(b.symbol);
    if(rm) ref = rm.replace(/ (corn|soybeans)$/, '');
    else if(bc != null && refCropFor(b, cat) && pricesData){
      var rc = refCropFor(b, cat);
      var r = resolveRef(rc, cat, pp - bc / 100, refEndKey(b, rc === 'kcwheat' ? 'wheat' : rc), (pricesData && pricesData.quotes) || {}, staleDay(e, best.fr, b), hpData);
      if(r) ref = r.text;
    }
    var ho = tp.higherOlder;
    return {
      cash: Math.round(pp * 10000) / 10000,
      basis: bc == null ? null : Math.round(bc * 100) / 10000,
      ref: ref,
      name: e.facility || '',
      town: townOf(e) + (townOf(e) && e.state ? ', ' : '') + (e.state || ''),
      mi: e.distance == null ? null : Math.round(e.distance * 10) / 10,
      posted: e.fromNetwork && e.pricedAt ? String(e.pricedAt) : null,
      stale: best.stale,
      month: monthShort(rowMonthKey(b)) || null,
      boardKey: boardKey(e),
      higherOlder: ho ? { cash: Math.round(ppu(ho.b.cashPrice) * 10000) / 10000, posted: ho.e.fromNetwork && ho.e.pricedAt ? String(ho.e.pricedAt) : null } : null,
      ageUnknown: !!best.fr.ageUnknown
    };
  }
  function dispatchTop(detail){
    window.__agsistBidsTop = detail;
    try{ window.dispatchEvent(new CustomEvent('agsist:bids-top', { detail: detail })); }
    catch(e){ try{ var ev = document.createEvent('CustomEvent'); ev.initCustomEvent('agsist:bids-top', false, false, detail); window.dispatchEvent(ev); }catch(e2){} }
  }
  /* PANEL6 D5: `status` says why a crop is null. 'ok' (drawn), 'none'
     (loaded, nothing within the radius), 'failed', 'pending' (still
     loading), 'nozip'. The hero can no longer read "couldn't load" as
     "no bid within 50 mi". */
  function emptyTop(place, status){ return { status: status || 'ok', place: place || null, radiusMi: BIDS_RADIUS_MI, corn: null, soybeans: null, wheat: null }; }
  function placeOf(label, zip){ return label ? label : (zip ? 'ZIP ' + zip : null); }
  function publishTop(ctx){
    var tok = ++topSeq;
    function build(){
      var d = emptyTop(placeOf(ctx.label, ctx.zip), 'ok');
      ['corn','soybeans','wheat'].forEach(function(c){ try{ d[c] = topEntry(ctx.elevators, c); }catch(e){ d[c] = null; } });
      dispatchTop(d);
    }
    build();
    /* Network boards name no contract; once the futures file and the dated
       settles are in, the label can be checked, so the summary goes out
       again with it. */
    if(!pricesData || !hpData) Promise.all([pricesOnce(), harvestOnce()]).then(function(x){ if(tok !== topSeq) return; if(x[0]) pricesData = x[0]; if(x[1]) hpData = x[1]; if(x[0] || x[1]) build(); });
  }
  function publishEmpty(label, zip, status){ ++topSeq; dispatchTop(emptyTop(placeOf(label, zip), status)); }

  /* PANEL6 U4: one persistent, visually hidden live region beside the card,
     so a screen reader hears when the bids arrive, fail or come back empty. */
  function liveNode(area){
    var n = document.getElementById('bh-live');
    if(!n && area && area.parentNode){
      n = document.createElement('div');
      n.id = 'bh-live'; n.setAttribute('role', 'status'); n.setAttribute('aria-live', 'polite');
      n.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';
      area.parentNode.insertBefore(n, area.nextSibling);
    }
    return n;
  }
  function announce(area, text){ var n = liveNode(area); if(n && n.textContent !== text) n.textContent = text; }

  var feedNodes = null;
  function drawCard(ctx){
    var area = ctx.area, zip = ctx.zip, crop = ctx.crop || 'all';
    ensureCSS();
    var present = COMM_ORDER.filter(function(c){ return c !== 'other' && ctx.elevators.some(function(e){ return (e.commodities[c] || []).length; }); });
    if(crop !== 'all' && present.indexOf(crop) < 0) crop = 'all';
    var list = crop === 'all' ? ctx.elevators : ctx.elevators.filter(function(e){ return (e.commodities[crop] || []).length; });
    var top = list.slice(0, MAX_ELEVATORS);
    /* Columns: corn and soybeans, wheat when a shown board has it, or the
       one crop picked. A crop no shown board posts gets no column. */
    var cols = crop !== 'all' ? [crop]
      : ['corn','soybeans','wheat'].filter(function(c){ return top.some(function(e){ return (e.commodities[c] || []).length; }); });
    if(!cols.length) cols = present.filter(function(c){ return c !== 'other'; }).slice(0, 3);
    var openSet = ctx.open || (ctx.open = {});
    var html = '';

    if(ctx.degraded){
      html += '<div class="bh-degraded">'
        + (ctx.netPending ? 'Elevator network still loading; showing the second feed only for now.' : 'Elevator network could not be read; showing the second feed only.')
        + ' <button type="button" class="bh-retry" style="min-height:44px;background:none;border:none;color:var(--gold);font-weight:700;text-decoration:underline;cursor:pointer;padding:0 .2rem;font-size:inherit">Try again</button></div>';
    }
    /* WAVE1-A: crop picker, only crops that came back for this ZIP. */
    if(present.length > 1){
      html += '<div class="bh-crops" role="group" aria-label="Show bids for">';
      ['all'].concat(present).forEach(function(c){
        html += '<button type="button" class="bh-crop" data-crop="' + c + '" aria-pressed="' + (c === crop) + '">' + (c === 'all' ? 'All crops' : COMM_NAMES[c]) + '</button>';
      });
      html += '</div>';
    }

    /* FIX6: the hero names the top corn and soybean board; if the card does
       not already draw it, it is drawn here as an extra row marked "Top corn
       bid", so the hero's tap can always open it. agsistOpenBidRow() can add
       any other board the same way (ctx.force). */
    var shown = {}, extras = [], extraLab = {};
    top.forEach(function(e){ shown[boardKey(e)] = 1; });
    [['corn', 'corn'], ['soybeans', 'soybean']].forEach(function(cw){
      var tp = null; try{ tp = topPick(ctx.elevators, cw[0]); }catch(e){}
      if(!tp) return;
      var e = tp.best.e, k = boardKey(e);
      if(shown[k]) return;
      if(!extraLab[k]){ extraLab[k] = []; extras.push(e); }
      extraLab[k].push(cw[1]);
    });
    if(ctx.force && !shown[ctx.force] && !extraLab[ctx.force]){
      ctx.elevators.forEach(function(e){ if(boardKey(e) === ctx.force && !extraLab[ctx.force]){ extraLab[ctx.force] = []; extras.push(e); } });
    }
    var drawn = top.concat(extras);
    if(crop === 'all' && extras.length){
      /* An extra board can carry a crop the first three do not. */
      cols = ['corn','soybeans','wheat'].filter(function(c){ return drawn.some(function(e){ return (e.commodities[c] || []).length; }); });
      if(!cols.length) cols = present.filter(function(c){ return c !== 'other'; }).slice(0, 3);
    }

    html += '<div class="bh-list' + (cols.length >= 3 ? ' bh-k3' : '') + '" style="--bh-k:' + Math.max(cols.length, 1) + '">';
    html += '<div class="bh-cols" aria-hidden="true"><span style="text-align:left">Elevator</span>'
      + cols.map(function(c){ return '<span>' + escHtml(COMM_NAMES[c] || c) + '</span>'; }).join('') + '<span></span></div>';
    var anyNet = drawn.some(function(e){ return e.fromNetwork; }), anyLic = drawn.some(function(e){ return !e.fromNetwork; });
    top.forEach(function(elev){
      var k = contactKey(elev.facility, elev.city, elev.state);
      html += renderElevatorHTML(elev, crop, anyNet && anyLic, cols, !!openSet[k]);
    });
    extras.forEach(function(elev){
      var k = contactKey(elev.facility, elev.city, elev.state), labs = extraLab[boardKey(elev)];
      html += renderElevatorHTML(elev, 'all', anyNet && anyLic, cols, !!openSet[k], labs.length ? 'Top ' + labs.join(' and ') + ' bid' : '');
    });
    html += '</div>';

    /* PANEL6 U11: under the rows, one row with View all on the right, then
       one muted line: How to read · Wrong number? · Claim your board. */
    var nDrawn = 0;
    list.forEach(function(e){ if(shown[boardKey(e)] || extraLab[boardKey(e)]) nDrawn++; });
    var tipWas = area.querySelector('.bh-tipb');
    var tipOpen = !!(tipWas && tipWas.getAttribute('aria-expanded') === 'true');
    html += '<div class="bh-foot">'
      + '<a class="bh-all" href="/cash-bids?zip=' + escHtml(zip) + '"' + (list.length > nDrawn ? ' aria-label="View all ' + list.length + ' elevators"' : '') + '>'
      + (list.length > nDrawn ? 'View all ' + list.length + ' →' : 'View all cash bids →') + '</a>'
      + '</div>'
      + '<div class="bh-links">'
      + '<button type="button" class="bh-tipb" aria-expanded="' + tipOpen + '" aria-controls="bh-tip">How to read</button>'
      + '<span class="bh-sep" aria-hidden="true">·</span>'
      + '<a class="bh-fl" href="/contact">Wrong number?</a>'
      + '<span class="bh-sep" aria-hidden="true">·</span>'
      + '<a class="bh-fl r7-claim" href="/elevators#claim" data-track="claim_board">Claim your board</a>'
      + '</div>';
    html += '<div class="bh-tip" id="bh-tip"' + (tipOpen ? '' : ' hidden') + '>'
      + '<div><b>Basis</b> is the cash bid minus the futures price it is quoted against. −62 Dec means 62¢ under December futures. Less negative is stronger.</div>'
      + '<div class="r7-ref-note" hidden></div>'
      + '<div>Tap for phone, nearest delivery month, the board’s best later month (carry), basis vs normal and posting time.</div>'
      + '<div><b>Date tag:</b> a green dot and a date mean the board posted on the latest trading day. “Old” and an orange dot mean it has not posted since the date shown. A dash means the feed sends no posting time.</div>'
      + '<div><b>▲▼</b> under a price: change since this elevator’s previous posted price, same delivery month. A day name after it is the day of that earlier price. No mark: no earlier price on record.</div>'
      + (anyNet ? '<div>Miles are straight-line.' + (anyLic ? ' Miles marked “from your ZIP” are the second feed’s own.' : '') + '</div>' : '')
      + '<div>Posted prices, not contracts. Freight, moisture and grade discounts are the elevator’s; call before you haul.</div>'
      + '<div class="bh-feed"></div>'
      + '</div>';

    var alreadySignedUp = (typeof window.isSignedUp === 'function') && window.isSignedUp();
    if(!alreadySignedUp){
      html += '<div style="margin-top:.5rem;padding:.5rem 0 0;border-top:1px solid var(--border);text-align:center">'
        + '<a href="#signup-compact" id="bids-cta-link" style="color:var(--gold);font-weight:600;font-size:.82rem;text-decoration:none">'
        /* 2026-10-01: this said "Get <ZIP> prices in your inbox". The
           signup it opens posts {email, source} -- no ZIP -- and the
           Daily is national. Promise what the form delivers. */
        + 'Get the AGSIST Daily in your inbox every weekday →</a></div>';
    }

    /* The page's feed-count lines (index1: .r7-cov, #idx1-trust-ledger) live
       in How to read. Held by reference so a redraw keeps them. */
    if(!feedNodes){
      feedNodes = [document.querySelector('.r7-cov'), document.getElementById('idx1-trust-ledger')].filter(function(x){ return x; });
    }
    area.innerHTML = html;
    var slot = area.querySelector('.bh-feed');
    if(slot) feedNodes.forEach(function(n){ slot.appendChild(n); });

    fillRefs(area);
    fillChanges(area);
    fillContacts(area);
    fillNormal(area);

    Array.prototype.forEach.call(area.querySelectorAll('.bh-head'), function(btn){
      btn.addEventListener('click', function(){
        var on = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', on ? 'true' : 'false');
        var p = document.getElementById(btn.getAttribute('aria-controls'));
        if(p) p.hidden = !on;
        var el = btn.closest('.bh-elev'), k = el && el.getAttribute('data-ck');
        if(k){ if(on) openSet[k] = 1; else delete openSet[k]; }
      });
    });
    Array.prototype.forEach.call(area.querySelectorAll('.bh-watch'), function(wb){
      wb.addEventListener('click', function(){
        var el = wb.closest('.bh-elev'), head = el && el.querySelector('.bh-head');
        if(head && head.getAttribute('aria-expanded') !== 'true') head.click();
        var inner = el && el.querySelector('.watch-elevator-wrap .watch-elevator-btn');
        if(inner) inner.click();
        else { var f = el && el.querySelector('.watch-elevator-email'); if(f) f.focus(); }
      });
    });
    var tb = area.querySelector('.bh-tipb');
    if(tb) tb.addEventListener('click', function(){
      var on = tb.getAttribute('aria-expanded') !== 'true';
      tb.setAttribute('aria-expanded', on ? 'true' : 'false');
      var p = area.querySelector('.bh-tip'); if(p) p.hidden = !on;
    });
    var crops = area.querySelectorAll('.bh-crop');
    Array.prototype.forEach.call(crops, function(btn){
      btn.addEventListener('click', function(){
        ctx.crop = btn.getAttribute('data-crop');
        try{ window.localStorage.setItem(CROP_KEY, ctx.crop); }catch(e){}
        drawCard(ctx);
        /* WAVE3-I: no scroll. The raise picker clicks this chip from the top
           of the page, and focus() alone scrolled the reader down to here. */
        var f = area.querySelector('.bh-crop[data-crop="' + ctx.crop + '"]'); if(f){ try{ f.focus({ preventScroll: true }); }catch(e){ f.focus(); } }
      });
    });
    Array.prototype.forEach.call(area.querySelectorAll('.bh-retry'), function(b){ b.addEventListener('click', retryLoad); });

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
    lastCtx = ctx;
    publishTop(ctx);
    var pl = placeOf(ctx.label, zip);
    announce(area, 'Cash bids loaded: ' + list.length + ' elevator' + (list.length === 1 ? '' : 's') + ' within ' + BIDS_RADIUS_MI + ' mi' + (pl ? ' of ' + pl : '') + ', ' + drawn.length + ' shown.');
    return drawn;
  }

  /* FIX6: the hero's tap. Scrolls to that board's row, opens it and moves
     focus to it. A board the card is not drawing is drawn first. */
  var lastCtx = null;
  function openBidRow(key){
    var area = document.getElementById('bids-list-area');
    if(!area || !key) return false;
    var sel = '.bh-head[data-board-key="' + String(key).replace(/[^A-Za-z0-9_-]/g, '') + '"]';
    var btn = area.querySelector(sel);
    if(!btn && lastCtx && lastCtx.elevators.some(function(e){ return boardKey(e) === key; })){
      lastCtx.force = key; drawCard(lastCtx); btn = area.querySelector(sel);
    }
    if(!btn) return false;
    if(btn.getAttribute('aria-expanded') !== 'true') btn.click();
    try{ btn.scrollIntoView({ block: 'center', behavior: 'smooth' }); }catch(e){ btn.scrollIntoView(); }
    try{ btn.focus({ preventScroll: true }); }catch(e){ btn.focus(); }
    return true;
  }
  window.agsistOpenBidRow = openBidRow;

  function loadHomepageBids(lat, lng, label, zip){
    var mySeq = ++loadSeq;
    var area = document.getElementById('bids-list-area');
    var geoTxt = document.getElementById('bids-geo-txt');
    if(!area) return;
    lastArgs = [lat, lng, label, zip];

    // Need ZIP for Barchart API
    if(!zip){
      degraded = false;
      area.innerHTML = '<div style="text-align:center;padding:1rem;font-size:.82rem;color:var(--text-muted)">'
        + 'Enter your ZIP to see nearby cash bids.<br><a href="/cash-bids" style="color:var(--gold)">Search any ZIP →</a></div>';
      publishEmpty(label, zip, 'nozip');
      announce(area, 'Enter your ZIP to see nearby cash bids.');
      return;
    }

    // Update geo bar
    if(geoTxt){
      geoTxt.textContent = label ? label : ('ZIP ' + zip);
      /* r7-bids 7b: a ZIP is set, so the button changes it. */
      var zb = document.getElementById('bids-enter-zip-btn');
      if(zb){ zb.textContent = 'Change ZIP'; zb.setAttribute('aria-label', 'Change the ZIP code for nearby cash bids (now ' + (label ? label : 'ZIP ' + zip) + ')'); }
    }
    quietGeo();

    // Show loading skeleton, unless a degraded card is already up (a quiet redraw).
    if(!degraded || !area.querySelector('.bh-elev')){
      if(feedNodes === null) feedNodes = [document.querySelector('.r7-cov'), document.getElementById('idx1-trust-ledger')].filter(function(x){ return x; });
      area.innerHTML = '<div><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap">Loading cash bids</span>'
        + '<div style="height:36px;background:var(--surface2);border-radius:6px;margin-bottom:.4rem;opacity:.4"></div>'
        + '<div style="height:36px;background:var(--surface2);border-radius:6px;margin-bottom:.4rem;opacity:.35"></div>'
        + '<div style="height:36px;background:var(--surface2);border-radius:6px;opacity:.3"></div>'
        + '</div>';
    }

    /* PANEL6 D5: the hero hears "still loading", not silence. A quiet
       redraw of a card already showing bids sends nothing new. */
    if(!area.querySelector('.bh-elev')) publishEmpty(label, zip, 'pending');
    liveNode(area);

    // ── Both feeds, in parallel; neither failing empties the card ───
    loadAllBids(zip)
      .then(function(bids){
        if(mySeq !== loadSeq) return;   // a newer ZIP was asked while this loaded
        degraded = !bids.netOk;

        if(bids.length === 0){
          /* WAVE1-A: "none within 50 mi" only when the network really answered. */
          if(!bids.netOk){ area.innerHTML = errorHTML(bids.netPending, zip); Array.prototype.forEach.call(area.querySelectorAll('.bh-retry'), function(b){ b.addEventListener('click', retryLoad); }); publishEmpty(label, zip, bids.netPending ? 'pending' : 'failed'); announce(area, bids.netPending ? 'Elevator bids are still loading.' : 'Cash bids could not load right now.'); return; }
          area.innerHTML = '<div style="text-align:center;padding:1rem;font-size:.82rem;color:var(--text-muted)">'
            + 'No elevator bids found within ' + BIDS_RADIUS_MI + ' mi.<br>'
            + '<a href="/cash-bids?zip=' + escHtml(zip) + '" style="color:var(--gold)">Try wider search →</a></div>';
          publishEmpty(label, zip, 'none');
          announce(area, 'No elevator bids found within ' + BIDS_RADIUS_MI + ' mi.');
          return;
        }

        var elevators = mergeOnePin(groupByElevator(bids));
        /* WAVE1-A: 0 mi is a distance. `a.distance||999` sent an elevator in
           the reader's own ZIP (Dumas Co-op at Dumas, 0.0 mi) to the bottom. */
        elevators.sort(function(a,b){ return (a.distance == null ? 999 : a.distance) - (b.distance == null ? 999 : b.distance); });

        var top = drawCard({ area: area, zip: zip, label: label, elevators: elevators, crop: savedCrop(), degraded: degraded, netPending: bids.netPending });

        publishSummary(label, zip, bids, elevators);
        console.log('[AGSIST] Homepage bids: ' + top.length + ' elevators (' + bids.length + ' total bids)');
      })
      .catch(function(err){
        if(mySeq !== loadSeq) return;
        degraded = true;
        console.warn('[AGSIST] Homepage bids fetch failed:', err);
        area.innerHTML = errorHTML(!!(err && err.pending), zip);
        Array.prototype.forEach.call(area.querySelectorAll('.bh-retry'), function(b){ b.addEventListener('click', retryLoad); });
        publishEmpty(label, zip, err && err.pending ? 'pending' : 'failed');
        announce(area, err && err.pending ? 'Elevator bids are still loading.' : 'Cash bids could not load right now.');
      });
  }

  /* PANEL6 U8: with the hero band on the page, the place is already said
     at the top; the card's geo bar keeps only its Change ZIP button. The
     place text stays for screen readers. */
  function quietGeo(){
    var gb = document.getElementById('bids-geo-bar');
    if(gb && document.getElementById('hero-band')) gb.classList.add('bh-geo-quiet');
  }
  ensureCSS(); quietGeo();

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
          /* WAVE3-I: the code from the full name ("Minnesota" is MN, not MI). */
          var stc = '', an = String(r.admin1 || '').trim().toLowerCase();
          Object.keys(STATE_NAME).forEach(function(k){ if(STATE_NAME[k].toLowerCase() === an) stc = k; });
          var label = r.name + (stc ? ', ' + stc : '');
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
  /* PANEL6 D6/D7: the one formatter, for the hero band too. cash(dollars,
     fracClass) returns HTML ("$4.37<span class=..> 3/4</span>"), cashText
     plain text, basis(cents) "−62 1/2¢", day(iso) "Oct 1" in Central time. */
  window.agsistBidFmt = { cash: qCash, cashText: qCashText, basis: qCents, day: ctShort };
  window.loadHomepageBids = loadHomepageBids;
  window.lookupBids = lookupBids;
  /* 2026-10-05: geo.js parks a request when it runs first (slow link). */
  if(window.__agsistBidsPending && !lastArgs){
    var _p = window.__agsistBidsPending; window.__agsistBidsPending = null;
    try{ loadHomepageBids.apply(null, _p); }catch(e){}
  }

})();
