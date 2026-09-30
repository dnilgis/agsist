// ═══════════════════════════════════════════════════════════════════
// bids-homepage.js — Homepage Cash Bids Preview
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
  var NET_SCRIPT = '/components/bids-network.js?v=1';

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
      str: (cents >= 0 ? '+' : '\u2212') + Math.abs(cents).toFixed(0) + '\u00a2',
      cls: cents > 0 ? 'pos' : cents < 0 ? 'neg' : 'muted'
    };
  }

  var COMM_ORDER = ['corn','soybeans','wheat','other'];
  var COMM_NAMES = { corn:'Corn', soybeans:'Soybeans', wheat:'Wheat', other:'Other' };
  var COMM_COLORS = { corn:'var(--gold)', soybeans:'var(--green)', wheat:'#ca8a3c', other:'var(--text-muted)' };

  // NOT `parseFloat(x) || null`: a FLAT basis is exactly 0 and 0 is falsy, so
  // the strongest basis on a board was published as "unknown".
  function flatNum(v){ var n = parseFloat(v); return isFinite(n) ? n : null; }

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
            basis: flatNum(bid.basis),
            deliveryMonth: bid.deliveryMonth || bid.delivery_month || '',
            deliveryStart: bid.deliveryStart || bid.delivery_start || '',
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
          basis: flatNum(item.basis),
          deliveryMonth: item.deliveryMonth || item.delivery_month || '',
          deliveryStart: item.deliveryStart || item.delivery_start || '',
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
      var key = (b.facility||'') + '||' + (b.branch||'') + '||' + (b.city||'');
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
  function renderElevatorHTML(elev){
    var distStr = elev.distance != null ? elev.distance.toFixed(0) + ' mi' : '';
    var cityState = (elev.city||'') + (elev.city && elev.state ? ', ' : '') + (elev.state||'');

    var html = '<div style="padding:.55rem 0;border-bottom:1px solid var(--border)">';

    // Elevator header
    html += '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:.4rem;margin-bottom:.3rem">';
    html += '<div style="min-width:0;overflow:hidden">';
    html += '<div style="font-size:.82rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(elev.facility) + '</div>';
    if(cityState){
      html += '<div style="font-size:.62rem;color:var(--text-muted)">' + escHtml(cityState)
        + (elev.fromNetwork ? ' <span style="color:var(--green)">&middot; direct from elevator</span>' : '')
        + '</div>';
    }
    html += '</div>';
    if(distStr){
      html += '<span style="font-family:\'JetBrains Mono\',monospace;font-size:.62rem;font-weight:700;color:var(--text-muted);white-space:nowrap;flex-shrink:0">' + distStr + '</span>';
    }
    html += '</div>';

    // Commodity sections
    COMM_ORDER.forEach(function(cat){
      var catBids = elev.commodities[cat];
      if(!catBids || catBids.length === 0) return;

      // Sort by delivery date
      catBids.sort(function(a,b){
        return (a.deliveryStart||a.deliveryMonth||'').localeCompare(b.deliveryStart||b.deliveryMonth||'');
      });

      var shown = catBids.slice(0, MAX_BIDS_PER_COMMODITY);
      var overflow = catBids.length - shown.length;

      // Commodity label
      html += '<div style="display:flex;align-items:center;gap:.3rem;margin:.2rem 0 .1rem;font-size:.58rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:' + COMM_COLORS[cat] + '">'
        + COMM_NAMES[cat]
        + '</div>';

      // Bid rows
      shown.forEach(function(bid){
        var perTon = notPerBushel(bid);
        var pp = perTon ? null : ppu(bid.cashPrice);
        var cashStr = pp != null ? '$' + pp.toFixed(2) : '\u2014';
        var basis = perTon ? { str:'\u2014', cls:'muted' } : formatBasis(bid.basis);
        var del = bid.deliveryMonth || bid.deliveryStart || 'Spot';
        var grade = String(bid.commodity || '').trim();
        var gradeTxt = grade + (perTon ? (grade ? ' \u00b7 ' : '') + 'per ton, not per bushel' : '');
        var bColor = basis.cls === 'pos' ? 'var(--green)' : basis.cls === 'neg' ? 'var(--red,#ef4444)' : 'var(--text-muted)';

        html += '<div style="display:grid;grid-template-columns:1fr auto auto;gap:.1rem .45rem;align-items:baseline;padding:.1rem .15rem">';
        html += '<span style="font-size:.7rem;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(del) + '</span>';
        html += '<span style="font-family:\'JetBrains Mono\',monospace;font-size:.82rem;font-weight:700;color:var(--text);text-align:right;white-space:nowrap">' + cashStr + '</span>';
        html += '<span style="font-family:\'JetBrains Mono\',monospace;font-size:.68rem;font-weight:700;color:' + bColor + ';text-align:right;white-space:nowrap;min-width:40px">' + basis.str + '</span>';
        if(gradeTxt){
          html += '<span style="grid-column:1/-1;font-size:.62rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(gradeTxt) + '</span>';
        }
        html += '</div>';
      });

      if(overflow > 0){
        html += '<div style="font-size:.6rem;color:var(--text-muted);padding:.02rem .15rem">+' + overflow + ' more</div>';
      }
    });

    // Watch this elevator. Scoped to corn -- the page's headline commodity --
    // and only offered when this elevator actually has a real, priced corn
    // bid; there is nothing honest to watch at an elevator with no corn row.
    var cornBids = elev.commodities.corn;
    if(cornBids && cornBids.length && elev.state && elev.facility){
      var wid = widFor(elev.state, elev.facility, elev.city, 'corn');
      var label = escHtml(elev.facility + (cityState ? ', ' + cityState : '') + ' — corn');
      html += '<div class="watch-elevator-wrap" data-wid="' + wid + '" data-label="' + label + '" style="margin-top:.35rem">'
        + '<button type="button" class="watch-elevator-btn" style="background:none;border:none;padding:0;font-size:.66rem;color:var(--text-muted);text-decoration:underline;cursor:pointer;min-height:24px">Watch this elevator — free</button>'
        + '</div>';
    }

    html += '</div>';
    return html;
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
      var basisVals = [];
      for(var bi = 0; bi < pool.length; bi++){
        if(pool[bi] === best) continue;
        if(pool[bi].basis != null) basisVals.push(pool[bi].basis);
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
      var nearbyRadiusMiles, avgBasisNearby, avgBasisNearbyCount;
      if(typeof best.lat === 'number' && typeof best.lon === 'number'){
        var nearVals = [];
        for(var ni = 0; ni < pool.length; ni++){
          var np = pool[ni];
          if(np === best) continue;
          if(typeof np.lat !== 'number' || typeof np.lon !== 'number' || np.basis == null) continue;
          if(milesBetween(best.lat, best.lon, np.lat, np.lon) <= NEARBY_RADIUS_MI) nearVals.push(np.basis);
        }
        nearbyRadiusMiles = NEARBY_RADIUS_MI;
        avgBasisNearby = nearVals.length ? (nearVals.reduce(function(a, b){ return a + b; }, 0) / nearVals.length) : null;
        avgBasisNearbyCount = nearVals.length;
      }

      var sum = {
        label: label || ('ZIP ' + zip),
        zip: zip,
        crop: 'corn',
        cash: best.cashPrice,
        basis: (best.basis == null ? null : best.basis),
        where: (best.facility || '') + (best.branch ? ' \u00b7 ' + best.branch : ''),
        city: (best.city || '') + (best.state ? ', ' + best.state : ''),
        miles: (best.distance == null ? null : best.distance),
        avgBasis: avgBasis,
        avgBasisCount: basisVals.length,
        nearbyRadiusMiles: nearbyRadiusMiles,
        avgBasisNearby: avgBasisNearby,
        avgBasisNearbyCount: avgBasisNearbyCount,
        elevators: elevators.length,
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
    var m = /^(\d{4})-(\d{2})/.exec(p || '');
    return m && MON[+m[2] - 1] ? MON[+m[2] - 1] + ' ' + m[1] : '';
  }
  function thisMonth(){ var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }

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
        snap.bids.forEach(function(r){
          // A delivery window that has closed is not a bid.
          if(/^\d{4}-\d{2}/.test(r.period || '') && r.period.slice(0, 7) < now) return;
          var cat = notPerBushel(r) ? 'other' : (/^(corn|soybeans|wheat)$/.test(r.crop || '') ? r.crop : classifyCommodity(r.commodity));
          rows.push({
            facility: r.facility || '', branch: r.branch || '',
            city: r.city || '', state: r.state || '',
            distance: r.distance == null ? null : r.distance,
            phone: r.phone || '', commodity: r.commodity || '',
            cashPrice: r.cashPrice == null ? null : r.cashPrice,
            basis: r.basis == null ? null : r.basis,
            deliveryMonth: periodLabel(r.period) || r.delivery || '',
            deliveryStart: r.period || '',
            category: cat, source: 'network', currency: r.currency || '',
            // Real coordinates, not a geocode -- bids-network.js already carries
            // each elevator's own lat/lon (it needs them to compute distance).
            // The licensed feed never gives us coordinates, so Barchart rows
            // leave these null and are simply left out of the nearby average.
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
      .then(function(data){ return {rows: flattenBarchartResponse(data), ok: true}; })
      .catch(function(err){ console.warn('[AGSIST] licensed bid feed:', err); return {rows: [], ok: false}; });
    return Promise.race([live, new Promise(function(res){ setTimeout(function(){ res({rows: [], ok: false}); }, LICENSED_DEADLINE_MS); })]);
  }

  // The delivery month of a row as YYYY-MM: from the label ("Nov 2026",
  // "Sep26", "Sept '26") first, then from the period / window start.
  function rowMonthKey(r){
    var mm = /^([A-Za-z]{3})[A-Za-z]*\s*'?(\d{2}|\d{4})$/.exec(String(r.deliveryMonth || '').trim());
    var i = mm ? MON.map(function(x){ return x.toLowerCase(); }).indexOf(mm[1].toLowerCase()) : -1;
    if(i >= 0) return (mm[2].length === 2 ? '20' + mm[2] : mm[2]) + '-' + ('0' + (i + 1)).slice(-2);
    var m = /^(\d{4})-(\d{2})/.exec(String(r.deliveryStart || ''));
    return m ? m[1] + '-' + m[2] : '';
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
        // FIX: .65rem font-size for readability (was .5rem — too small)
        var html = '<div style="display:grid;grid-template-columns:1fr auto auto;gap:.1rem .45rem;padding:0 .15rem .15rem;'
          + 'font-family:\'JetBrains Mono\',monospace;font-size:.65rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);opacity:.75">'
          + '<span>Delivery</span><span style="text-align:right">Cash</span><span style="text-align:right">Basis</span></div>';

        top.forEach(function(elev){
          html += renderElevatorHTML(elev);
        });

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
          html += '<div style="margin-top:.5rem;padding:.6rem .7rem;background:var(--surface2);border:1px solid var(--border);border-radius:6px;text-align:center">'
            + '<a href="#signup-compact" id="bids-cta-link" style="color:var(--gold);font-weight:600;font-size:.82rem;text-decoration:none">'
            + 'Get ' + escHtml(zip) + ' prices in your inbox every morning →</a></div>';
        }

        area.innerHTML = html;

        if(!alreadySignedUp){
          var ctaLink = document.getElementById('bids-cta-link');
          if(ctaLink){
            ctaLink.addEventListener('click', function(e){
              e.preventDefault();
              var su = document.getElementById('signup-compact');
              if(!su) return;
              su.style.display = 'flex';
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
