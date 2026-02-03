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
        
        // Init tooltips
        initTooltips();
    }
    
    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
