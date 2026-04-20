// ═══════════════════════════════════════════════════════════════════
// bids-homepage.js — Homepage Cash Bids Preview
//
// Barchart API key is held server-side by the Cloudflare Worker proxy.
// Worker source: /worker/worker.js (deployed to Cloudflare Workers).
// If the proxy is unreachable, the bids list shows an error state —
// the raw API key is NEVER exposed to the client.
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

  var MAX_ELEVATORS = 3;
  var MAX_BIDS_PER_COMMODITY = 3;

  // ── Helpers ─────────────────────────────────────────────────────
  function classifyCommodity(name){
    var n = (name || '').toLowerCase();
    if(n.indexOf('corn') >= 0) return 'corn';
    if(n.indexOf('soy') >= 0 || n.indexOf('bean') >= 0) return 'soybeans';
    if(n.indexOf('wheat') >= 0 || n.indexOf('hrw') >= 0 || n.indexOf('srw') >= 0 || n.indexOf('hrs') >= 0) return 'wheat';
    return 'other';
  }

  function escHtml(s){
    if(!s) return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function basisCents(bN){
    if(bN == null) return null;
    return Math.abs(bN) < 5 ? bN * 100 : bN;
  }

  function formatBasis(bN){
    var cents = basisCents(bN);
    if(cents == null) return { str:'\u2014', cls:'muted' };
    return {
      str: (cents >= 0 ? '+' : '') + cents.toFixed(0) + '\u00a2',
      cls: cents > 0 ? 'pos' : cents < 0 ? 'neg' : 'muted'
    };
  }

  var COMM_ORDER = ['corn','soybeans','wheat','other'];
  var COMM_ICONS = { corn:'\ud83c\udf3d', soybeans:'\ud83e\udeb6', wheat:'\ud83c\udf3e', other:'\ud83c\udf31' };
  var COMM_NAMES = { corn:'Corn', soybeans:'Soybeans', wheat:'Wheat', other:'Other' };
  var COMM_COLORS = { corn:'var(--gold)', soybeans:'var(--green)', wheat:'#ca8a3c', other:'var(--text-muted)' };

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
            basis: parseFloat(bid.basis) || null,
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
          basis: parseFloat(item.basis) || null,
          deliveryMonth: item.deliveryMonth || item.delivery_month || '',
          deliveryStart: item.deliveryStart || item.delivery_start || '',
          category: classifyCommodity(item.commodity || item.commodity_display_name || item.commodityName || '')
        });
      }
    });
    return flat;
  }

  // ── Group flat bids → elevator objects ──────────────────────────
  function groupByElevator(bids){
    var map = {};
    bids.forEach(function(b){
      var key = (b.facility||'') + '||' + (b.branch||'') + '||' + (b.city||'');
      if(!map[key]){
        map[key] = {
          facility: b.facility, branch: b.branch,
          city: b.city, state: b.state,
          distance: b.distance, phone: b.phone,
          commodities: {}
        };
      }
      var elev = map[key];
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
      html += '<div style="font-size:.62rem;color:var(--text-muted)">' + escHtml(cityState) + '</div>';
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
        + '<span style="font-size:.72rem">' + COMM_ICONS[cat] + '</span> ' + COMM_NAMES[cat]
        + '</div>';

      // Bid rows
      shown.forEach(function(bid){
        var cashStr = bid.cashPrice != null ? '$' + bid.cashPrice.toFixed(2) : '\u2014';
        var basis = formatBasis(bid.basis);
        var del = bid.deliveryMonth || bid.deliveryStart || 'Spot';
        var bColor = basis.cls === 'pos' ? 'var(--green)' : basis.cls === 'neg' ? 'var(--red,#ef4444)' : 'var(--text-muted)';

        html += '<div style="display:grid;grid-template-columns:1fr auto auto;gap:.1rem .45rem;align-items:baseline;padding:.1rem .15rem">';
        html += '<span style="font-size:.7rem;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(del) + '</span>';
        html += '<span style="font-family:\'JetBrains Mono\',monospace;font-size:.82rem;font-weight:700;color:var(--text);text-align:right;white-space:nowrap">' + cashStr + '</span>';
        html += '<span style="font-family:\'JetBrains Mono\',monospace;font-size:.68rem;font-weight:700;color:' + bColor + ';text-align:right;white-space:nowrap;min-width:40px">' + basis.str + '</span>';
        html += '</div>';
      });

      if(overflow > 0){
        html += '<div style="font-size:.6rem;color:var(--text-muted);padding:.02rem .15rem">+' + overflow + ' more</div>';
      }
    });

    html += '</div>';
    return html;
  }

  // ── Main load function ──────────────────────────────────────────
  function loadHomepageBids(lat, lng, label, zip){
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
      geoTxt.textContent = label ? ('\ud83d\udccd ' + label) : ('\ud83d\udccd ZIP ' + zip);
    }

    // Show loading skeleton
    area.innerHTML = '<div aria-label="Loading cash bids">'
      + '<div style="height:36px;background:var(--surface2);border-radius:6px;margin-bottom:.4rem;opacity:.4"></div>'
      + '<div style="height:36px;background:var(--surface2);border-radius:6px;margin-bottom:.4rem;opacity:.35"></div>'
      + '<div style="height:36px;background:var(--surface2);border-radius:6px;opacity:.3"></div>'
      + '</div>';

    // ── Proxy request (no API key in query — server-side only) ─────
    var url = PROXY_URL
      + '?zipCode=' + encodeURIComponent(zip)
      + '&maxDistance=50&getAllBids=1';

    fetch(url)
      .then(function(r){ return r.ok ? r.json() : Promise.reject('HTTP ' + r.status); })
      .then(function(data){
        var bids = flattenBarchartResponse(data);
        bids = bids.filter(function(b){ return b.cashPrice !== null || b.basis !== null; });

        if(bids.length === 0){
          area.innerHTML = '<div style="text-align:center;padding:1rem;font-size:.82rem;color:var(--text-muted)">'
            + '<div style="font-size:1.2rem;margin-bottom:.3rem">\ud83d\udccd</div>'
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

        area.innerHTML = html;
        console.log('[AGSIST] Homepage bids: ' + top.length + ' elevators (' + bids.length + ' total bids)');
      })
      .catch(function(err){
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
