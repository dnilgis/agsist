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
    }
    
    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
