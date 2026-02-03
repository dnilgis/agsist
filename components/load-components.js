/*
 * AGSIST Component Loader
 * 
 * Usage in any page:
 * 
 *   <head>
 *       <link rel="stylesheet" href="/components/shared.css">
 *   </head>
 *   <body>
 *       <div id="header"></div>
 *       
 *       <!-- your page content -->
 *       
 *       <div id="footer"></div>
 *       <script src="/components/load-components.js"></script>
 *   </body>
 */

(function() {
    'use strict';
    
    // Configuration
    var HEADER_FILE = '/components/header.html';
    var FOOTER_FILE = '/components/footer.html';
    
    // Load HTML into an element
    function loadHTML(elementId, url, callback) {
        var element = document.getElementById(elementId);
        if (!element) {
            console.warn('[AGSIST] Element #' + elementId + ' not found');
            return;
        }
        
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    element.outerHTML = xhr.responseText;
                    console.log('[AGSIST] Loaded ' + url);
                    if (callback) callback(true);
                } else {
                    console.error('[AGSIST] Failed to load ' + url + ' (HTTP ' + xhr.status + ')');
                    element.innerHTML = '<div style="background:#300;color:#f88;padding:10px;text-align:center;">Failed to load ' + url + '</div>';
                    if (callback) callback(false);
                }
            }
        };
        
        xhr.send();
    }
    
    // Initialize mobile menu
    function initMobileMenu() {
        var btn = document.getElementById('nav-mobile-btn');
        var menu = document.getElementById('nav-mobile');
        
        if (!btn || !menu) {
            console.warn('[AGSIST] Mobile menu elements not found');
            return;
        }
        
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var isOpen = menu.classList.toggle('active');
            btn.textContent = isOpen ? '✕' : '☰';
        });
        
        // Close when clicking a link
        var links = menu.querySelectorAll('a');
        for (var i = 0; i < links.length; i++) {
            links[i].addEventListener('click', function() {
                menu.classList.remove('active');
                btn.textContent = '☰';
            });
        }
        
        // Close when clicking outside
        document.addEventListener('click', function(e) {
            if (menu.classList.contains('active') && 
                !menu.contains(e.target) && 
                !btn.contains(e.target)) {
                menu.classList.remove('active');
                btn.textContent = '☰';
            }
        });
        
        console.log('[AGSIST] Mobile menu initialized');
    }
    
    // Tooltip system — appends to <body> so overflow:hidden parents can't clip it
    function initTooltips() {
        var tt = document.createElement('div');
        tt.id = 'agsist-tooltip';
        document.body.appendChild(tt);

        function show(e) {
            var tip = e.target.closest('[data-tip]');
            if (!tip) return;
            tt.textContent = tip.getAttribute('data-tip');
            // Force layout so offsetWidth/Height are accurate
            tt.style.display = 'block';
            tt.classList.remove('visible');
            var r = tip.getBoundingClientRect();
            var ttW = tt.offsetWidth;
            var ttH = tt.offsetHeight;
            // Center horizontally, keep on screen
            var left = Math.max(8, Math.min(r.left + r.width / 2 - ttW / 2, window.innerWidth - ttW - 8));
            // Above by default
            var top = r.top - ttH - 6;
            // Flip below if clipped at top
            if (top < 4) top = r.bottom + 6;
            tt.style.left = left + 'px';
            tt.style.top = top + 'px';
            tt.classList.add('visible');
        }

        function hide() {
            tt.classList.remove('visible');
        }

        document.addEventListener('mouseover', show);
        document.addEventListener('mouseout', function(e) {
            if (e.target.closest('[data-tip]')) hide();
        });
        document.addEventListener('focusin', show);
        document.addEventListener('focusout', function(e) {
            if (e.target.closest('[data-tip]')) hide();
        });
        // Touch: toggle on tap
        document.addEventListener('touchstart', function(e) {
            var tip = e.target.closest('[data-tip]');
            if (tip) {
                if (tt.classList.contains('visible')) { hide(); }
                else { show(e); }
            } else { hide(); }
        }, { passive: true });

        console.log('[AGSIST] Tooltips initialized');
    }

    // ═══════════════════════════════════════════════════════════════
    //  AUTO-TOOLTIP: scans page text and annotates ag abbreviations
    // ═══════════════════════════════════════════════════════════════
    function autoAnnotateTooltips() {
        var dict = {
            // ── Government Agencies ──
            'FSA':   'Farm Service Agency — farm loans, conservation & disaster programs',
            'NRCS':  'Natural Resources Conservation Service — soil & water conservation',
            'RMA':   'Risk Management Agency — federal crop insurance oversight',
            'AMS':   'Agricultural Marketing Service — market reports, grading & inspection',
            'NASS':  'National Agricultural Statistics Service — crop reports & ag census',
            'FCIC':  'Federal Crop Insurance Corporation — sets policy terms & premium rates',
            'ERS':   'Economic Research Service — ag economic analysis & outlook',
            'APHIS': 'Animal & Plant Health Inspection Service — pest & disease regulation',
            'FAS':   'Foreign Agricultural Service — export programs & trade data',
            // ── Farm Programs ──
            'CRP':   'Conservation Reserve Program — annual rental payments for resting sensitive land',
            'ARC':   'Agriculture Risk Coverage — county or individual revenue safety net',
            'PLC':   'Price Loss Coverage — payments when prices fall below reference price',
            'SCO':   'Supplemental Coverage Option — area-based coverage stacked on crop insurance',
            'ECO':   'Enhanced Coverage Option — higher coverage crop insurance endorsement',
            'DMC':   'Dairy Margin Coverage — safety net based on milk price minus feed cost',
            'EQIP':  'Environmental Quality Incentives Program — cost-share for conservation practices',
            'CSP':   'Conservation Stewardship Program — payments for enhancing conservation',
            'NAP':   'Noninsured Crop Disaster Assistance — covers crops without insurance options',
            'LDP':   'Loan Deficiency Payment — paid when market price drops below loan rate',
            'PRF':   'Pasture, Rangeland, Forage — rainfall index insurance for grazing land',
            'STAX':  'Stacked Income Protection Plan — area revenue insurance for cotton',
            'WRP':   'Wetlands Reserve Program — easements to protect wetland habitat',
            // ── Markets & Exchanges ──
            'CBOT':  'Chicago Board of Trade — primary exchange for grain futures',
            'CME':   'Chicago Mercantile Exchange — livestock, dairy & financial futures',
            'WASDE': 'World Ag Supply & Demand Estimates — key monthly USDA report',
            'MPR':   'Mandatory Price Reporting — USDA livestock price transparency program',
            'FMMO':  'Federal Milk Marketing Order — sets minimum milk prices by use class',
            'HTA':   'Hedge-To-Arrive — contract locking futures price, basis set later',
            // ── Wheat Classes ──
            'SRW':   'Soft Red Winter wheat — cakes, crackers, pastries',
            'HRW':   'Hard Red Winter wheat — bread flour, most widely grown US class',
            'HRS':   'Hard Red Spring wheat — premium bread flour, highest protein',
            'DNS':   'Dark Northern Spring wheat — top grade of HRS',
            // ── Dairy Terms ──
            'NDM':   'Nonfat Dry Milk — key dairy commodity in Class IV pricing',
            'NFDM':  'Nonfat Dry Milk — key dairy commodity in Class IV pricing',
            'BFP':   'Basic Formula Price — predecessor to Class III milk pricing',
            // ── Crop Science ──
            'GDU':   'Growing Degree Units — accumulated heat units for crop development',
            'GDD':   'Growing Degree Days — same as GDU, heat accumulation measure',
            'IPM':   'Integrated Pest Management — science-based approach to pest control',
            // ── Precision Ag ──
            'VRA':   'Variable Rate Application — adjusting inputs by field zone',
            'NDVI':  'Normalized Difference Vegetation Index — satellite crop health index',
            'RTK':   'Real-Time Kinematic — GPS correction for sub-inch field accuracy',
            // ── Drought & Weather ──
            'USDM':  'U.S. Drought Monitor — weekly national drought assessment',
            'PDSI':  'Palmer Drought Severity Index — long-term drought/moisture measurement',
            'ENSO':  'El Niño–Southern Oscillation — Pacific climate pattern affecting global weather',
            // ── Soils ──
            'WSS':   'Web Soil Survey — NRCS online tool for soil maps & data',
            'CEC':   'Cation Exchange Capacity — soil\'s ability to hold nutrients',
            // ── Crop Stages (Corn) ──
            'VE':    'Emergence — corn seedling breaking soil surface',
            'VT':    'Tasseling — final vegetative stage, tassel fully visible',
            'R1':    'Silking — silks emerge, pollination begins',
            'R2':    'Blister — kernels white, watery fluid inside',
            'R3':    'Milk — kernels yellow outside, milky fluid inside',
            'R4':    'Dough — kernel starch thickening to dough consistency',
            'R5':    'Dent — dent visible on most kernels, milk line forming',
            'R6':    'Physiological Maturity — black layer formed, maximum dry weight',
            // ── Units & Measures ──
            'GPA':   'Gallons per acre — spray application rate',
            // ── Insurance Terms ──
            'APH':   'Actual Production History — yield history used to set crop insurance guarantee',
            'MPCI':  'Multi-Peril Crop Insurance — basic federal crop insurance coverage',
            'RP':    'Revenue Protection — crop insurance covering revenue loss',
            'YP':    'Yield Protection — crop insurance covering yield loss only',
            'AIP':   'Approved Insurance Provider — private company selling federal crop insurance',
            // ── Livestock ──
            'COOL':  'Country of Origin Labeling — meat origin disclosure requirement',
            'BQA':   'Beef Quality Assurance — industry best-practice certification',
            // ── Other Ag ──
            'CCC':   'Commodity Credit Corporation — USDA financial arm for farm programs',
            'RFS':   'Renewable Fuel Standard — biofuel blending mandate affecting corn demand',
            'DDGs':  'Dried Distillers Grains — ethanol co-product used as livestock feed',
            'E15':   'Gasoline blended with 15% ethanol'
        };

        // Build sorted terms list (longest first prevents partial matches)
        var terms = Object.keys(dict);
        // Remove duplicates
        var seen = {};
        terms = terms.filter(function(t) {
            if (seen[t]) return false;
            seen[t] = true;
            return true;
        });
        terms.sort(function(a, b) { return b.length - a.length; });

        // Build regex: match whole words only
        // Escape special regex chars in terms (like '+')
        var escaped = terms.map(function(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
        var pattern = new RegExp('\\b(' + escaped.join('|') + ')\\b', 'g');

        // Elements to skip (don't annotate inside these)
        var SKIP_TAGS = { A:1, SCRIPT:1, STYLE:1, CODE:1, PRE:1, INPUT:1, SELECT:1, TEXTAREA:1, BUTTON:1, OPTION:1, SVG:1, IFRAME:1 };

        // Only scan inside <main> (or full body as fallback)
        var root = document.querySelector('main') || document.body;

        // Skip pages that opt out of auto-tooltips
        if (root.hasAttribute('data-no-tips')) return;

        // Collect text nodes that contain matches
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
        var textNodes = [];
        var n;
        while (n = walker.nextNode()) {
            var p = n.parentElement;
            if (!p) continue;
            if (SKIP_TAGS[p.tagName]) continue;
            if (p.hasAttribute('data-tip')) continue;
            if (p.classList && p.classList.contains('tip')) continue;
            // Skip inside hint popups and inert elements
            if (p.closest && (p.closest('.hint-popup') || p.closest('[inert]'))) continue;
            // Check heading tags — skip H1 to avoid cluttering titles
            if (p.tagName === 'H1') continue;
            pattern.lastIndex = 0;
            if (pattern.test(n.textContent)) {
                textNodes.push(n);
            }
        }

        // Track which terms we've annotated (only annotate first occurrence per page for common terms)
        var annotated = {};
        var MAX_PER_TERM = 3; // annotate up to 3 occurrences of each term per page
        var totalCount = 0;

        textNodes.forEach(function(textNode) {
            var text = textNode.textContent;
            var frag = document.createDocumentFragment();
            var lastIdx = 0;
            var match;
            pattern.lastIndex = 0;
            var replaced = false;

            while ((match = pattern.exec(text)) !== null) {
                var term = match[1];
                if (!dict[term]) continue;
                if (!annotated[term]) annotated[term] = 0;
                if (annotated[term] >= MAX_PER_TERM) continue;

                // Text before match
                if (match.index > lastIdx) {
                    frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
                }

                // Create tooltip span
                var span = document.createElement('span');
                span.className = 'tip';
                span.setAttribute('data-tip', dict[term]);
                span.textContent = term;
                frag.appendChild(span);

                annotated[term]++;
                totalCount++;
                replaced = true;
                lastIdx = match.index + match[0].length;
            }

            if (replaced) {
                // Remaining text after last match
                if (lastIdx < text.length) {
                    frag.appendChild(document.createTextNode(text.slice(lastIdx)));
                }
                textNode.parentNode.replaceChild(frag, textNode);
            }
        });

        console.log('[AGSIST] Auto-annotated ' + totalCount + ' abbreviation(s) across page');
    }

    // Main initialization
    function init() {
        console.log('[AGSIST] Loading components...');
        
        // Load header first, then init mobile menu
        loadHTML('header', HEADER_FILE, function(success) {
            if (success) {
                initMobileMenu();
            }
        });
        
        // Load footer
        loadHTML('footer', FOOTER_FILE);
        
        // Init tooltips (event handler)
        initTooltips();
        
        // Auto-annotate abbreviations after a brief delay
        // (allows dynamic content like crop-progress JS to render first)
        setTimeout(autoAnnotateTooltips, 800);
    }
    
    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
