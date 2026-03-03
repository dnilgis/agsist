// ═══════════════════════════════════════════════════════════════════════
// bids-homepage.js — Homepage Cash Bids card wiring
// 1. Wires the "Find Bids" button to navigate to /cash-bids?zip=VALUE
// 2. Reads /data/bids.json (pre-fetched national grid) for passive display
//
// DEPLOY: /components/bids-homepage.js
// ═══════════════════════════════════════════════════════════════════════

(function(){
  'use strict';

  var LOADED = false;

  // ── Wire the "Find Bids" button and ZIP input ──
  // geo.js renders a ZIP input and button into the bids card,
  // but never wires the click handler. We do it here.
  function wireSearchButton(){
    // Find the bids card — look for the card containing bids-list-area
    var area = document.getElementById('bids-list-area');
    if(!area) return;

    // Walk up to find the card container
    var card = area.closest('.dash-card') || area.closest('section') || area.parentElement;
    if(!card) return;

    // Find any input and button inside the card
    var zipInput = card.querySelector('input[type="text"], input[type="tel"], input[inputmode="numeric"]');
    var goBtn = card.querySelector('button');

    // Also try finding by common patterns
    if(!zipInput) zipInput = document.getElementById('bids-zip-input') || document.getElementById('bids-zip');
    if(!goBtn) goBtn = document.getElementById('bids-go-btn') || document.getElementById('bids-go');

    function doNavigate(){
      var zip = zipInput ? (zipInput.value || '').trim().replace(/\D/g,'') : '';
      if(zip.length >= 5){
        window.location.href = '/cash-bids?zip=' + zip.slice(0,5);
      } else if(zip.length > 0){
        // Flash the input to indicate invalid
        if(zipInput){
          zipInput.style.borderColor = '#ef4444';
          setTimeout(function(){ zipInput.style.borderColor = ''; }, 1500);
        }
      } else {
        // No zip entered, just go to the page
        window.location.href = '/cash-bids';
      }
    }

    if(goBtn){
      goBtn.addEventListener('click', function(e){
        e.preventDefault();
        doNavigate();
      });
    }

    if(zipInput){
      zipInput.addEventListener('keydown', function(e){
        if(e.key === 'Enter'){
          e.preventDefault();
          doNavigate();
        }
      });
    }

    // Also wire the "Enter ZIP" link if it exists
    var enterZipLink = card.querySelector('a[href="#"]');
    if(enterZipLink && zipInput){
      enterZipLink.addEventListener('click', function(e){
        e.preventDefault();
        zipInput.focus();
      });
    }

    console.log('[AGSIST] Bids card wired:', goBtn ? 'button found' : 'no button', zipInput ? 'input found' : 'no input');
  }

  // ── Haversine distance ──
  function haversine(lat1,lng1,lat2,lng2){
    var R=3958.8,d2r=Math.PI/180;
    var dLat=(lat2-lat1)*d2r,dLng=(lng2-lng1)*d2r;
    var a=Math.sin(dLat/2)*Math.sin(dLat/2)+
          Math.cos(lat1*d2r)*Math.cos(lat2*d2r)*
          Math.sin(dLng/2)*Math.sin(dLng/2);
    return R*2*Math.asin(Math.sqrt(a));
  }

  // ── Load cached bids from /data/bids.json ──
  function loadHomepageBids(lat, lng, label){
    if(LOADED) return;
    var area = document.getElementById('bids-list-area');
    var geoTxt = document.getElementById('bids-geo-txt');
    if(!area) return;

    LOADED = true;

    fetch('/data/bids.json?v=' + Date.now())
      .then(function(r){ return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function(data){
        var bids = data.bids || [];
        var grid = data.zip_grid || [];

        if(!bids.length){
          area.innerHTML = '<div style="text-align:center;padding:1rem;font-size:.82rem;color:var(--text-muted)">'
            + 'No bids data available yet.<br><a href="/cash-bids" style="color:var(--gold)">Search any ZIP →</a></div>';
          return;
        }

        var nearZips = grid
          .map(function(z){ return {zip:z.zip, dist:haversine(lat,lng,z.lat,z.lng)}; })
          .sort(function(a,b){ return a.dist-b.dist; })
          .slice(0, 4);
        var zipSet = {};
        nearZips.forEach(function(z){ zipSet[z.zip]=true; });

        var nearby = bids
          .filter(function(b){ return zipSet[b.sourceZip]; })
          .map(function(b){
            b._d = (b.lat!=null && b.lng!=null) ? haversine(lat,lng,b.lat,b.lng) : (b.distance||999);
            return b;
          })
          .filter(function(b){ return b._d <= 75; })
          .sort(function(a,b){ return a._d - b._d; });

        var seen = {};
        var unique = [];
        nearby.forEach(function(b){
          var key = b.facility + '|' + b.commodity;
          if(!seen[key]){ seen[key]=true; unique.push(b); }
        });

        var top = unique.slice(0, 5);

        if(top.length === 0){
          area.innerHTML = '<div style="text-align:center;padding:1rem;font-size:.82rem;color:var(--text-muted)">'
            + '<div style="font-size:1.2rem;margin-bottom:.3rem">📍</div>'
            + 'No elevator bids found nearby.<br><a href="/cash-bids" style="color:var(--gold)">Search any ZIP →</a></div>';
          return;
        }

        if(geoTxt && label) geoTxt.textContent = '📍 Bids near ' + label;

        var html = '';
        top.forEach(function(b){
          var ci = (b.category==='corn')?'🌽':(b.category==='soybeans')?'🫘':(b.category==='wheat')?'🌾':'🌱';
          var cashStr = b.cashPrice != null ? '$' + b.cashPrice.toFixed(2) : '—';
          var bN = b.basis, bStr = '—', bColor = 'var(--text-muted)';
          if(bN != null){
            var cents = Math.abs(bN) > 5 ? bN : bN * 100;
            bStr = (cents >= 0 ? '+' : '') + cents.toFixed(0) + '¢';
            bColor = cents > 0 ? 'var(--green)' : cents < 0 ? 'var(--red,#ef4444)' : 'var(--text-muted)';
          }
          var distStr = b._d != null ? b._d.toFixed(0) + ' mi' : '';

          html += '<div style="display:flex;align-items:center;gap:.65rem;padding:.55rem 0;border-bottom:1px solid var(--border)">'
            + '<span style="font-size:1rem;flex-shrink:0">' + ci + '</span>'
            + '<div style="flex:1;min-width:0">'
              + '<div style="font-size:.8rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (b.facility||'Unknown') + '</div>'
              + '<div style="font-size:.68rem;color:var(--text-muted)">' + (b.commodity||'') + (distStr ? ' · ' + distStr : '') + '</div>'
            + '</div>'
            + '<div style="text-align:right;flex-shrink:0">'
              + '<div style="font-family:\'JetBrains Mono\',monospace;font-size:.88rem;font-weight:700;color:var(--text)">' + cashStr + '</div>'
              + '<div style="font-family:\'JetBrains Mono\',monospace;font-size:.72rem;font-weight:600;color:' + bColor + '">' + bStr + '</div>'
            + '</div>'
          + '</div>';
        });

        html += '<a href="/cash-bids" style="display:block;text-align:center;padding:.65rem 0;font-size:.78rem;color:var(--gold);font-weight:600;text-decoration:none;margin-top:.3rem">View All Cash Bids →</a>';
        area.innerHTML = html;
        console.log('[AGSIST] Homepage bids: ' + top.length + ' shown');
      })
      .catch(function(err){
        console.warn('[AGSIST] Homepage bids load failed:', err);
        area.innerHTML = '<div style="text-align:center;padding:1rem;font-size:.82rem;color:var(--text-muted)">'
          + 'No bids data available yet.<br><a href="/cash-bids" style="color:var(--gold)">Search any ZIP →</a></div>';
      });
  }

  // Expose globally so geo.js CAN call it directly
  window.loadHomepageBids = loadHomepageBids;

  // ── Poll for AGSIST_GEO since geolocation is async ──
  var attempts = 0;
  var maxAttempts = 30; // 30 x 500ms = 15 seconds

  function tryLoad(){
    if(LOADED) return;
    attempts++;

    if(window.AGSIST_GEO && window.AGSIST_GEO.lat){
      loadHomepageBids(
        window.AGSIST_GEO.lat,
        window.AGSIST_GEO.lng,
        (window.AGSIST_GEO.city || '') + ', ' + (window.AGSIST_GEO.state || '')
      );
      return;
    }

    if(attempts < maxAttempts){
      setTimeout(tryLoad, 500);
    } else {
      console.warn('[AGSIST] Homepage bids: gave up waiting for geo after 15s');
    }
  }

  // ── Initialize ──
  // Wire button immediately (DOM should be ready since script is at bottom)
  wireSearchButton();

  // Also wire after a short delay in case geo.js renders the card async
  setTimeout(wireSearchButton, 1000);
  setTimeout(wireSearchButton, 3000);

  // Start polling for geo data
  tryLoad();
})();
