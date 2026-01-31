/**
 * AGSIST Shared Components Loader
 * Loads header and footer from component files
 * 
 * Usage: Add these to your HTML:
 *   <div id="header-placeholder"></div>
 *   ... page content ...
 *   <div id="footer-placeholder"></div>
 *   <script src="components/includes.js"></script>
 */

(function() {
    'use strict';
    
    // Determine base path (handles subdirectories)
    const scripts = document.getElementsByTagName('script');
    const currentScript = scripts[scripts.length - 1];
    const scriptPath = currentScript.src;
    const basePath = scriptPath.substring(0, scriptPath.lastIndexOf('/') + 1);
    
    // Load a component into a placeholder
    async function loadComponent(placeholderId, componentFile) {
        const placeholder = document.getElementById(placeholderId);
        if (!placeholder) return;
        
        try {
            const response = await fetch(basePath + componentFile);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const html = await response.text();
            
            // Insert HTML
            placeholder.outerHTML = html;
            
            return true;
        } catch (err) {
            console.warn(`Failed to load ${componentFile}:`, err);
            return false;
        }
    }
    
    // Initialize mobile menu toggle after header loads
    function initMobileMenu() {
        const btn = document.querySelector('.mobile-menu-btn');
        const menu = document.getElementById('mobile-menu');
        
        if (btn && menu) {
            btn.addEventListener('click', function() {
                menu.classList.toggle('active');
            });
            
            // Close menu when clicking a link
            menu.querySelectorAll('a').forEach(link => {
                link.addEventListener('click', () => menu.classList.remove('active'));
            });
            
            // Close menu when clicking outside
            document.addEventListener('click', function(e) {
                if (!menu.contains(e.target) && !btn.contains(e.target)) {
                    menu.classList.remove('active');
                }
            });
        }
    }
    
    // Load components on DOMContentLoaded
    async function init() {
        const headerLoaded = await loadComponent('header-placeholder', 'header.html');
        await loadComponent('footer-placeholder', 'footer.html');
        
        // Initialize mobile menu after header loads
        if (headerLoaded) {
            initMobileMenu();
        }
        
        // Dispatch event when components are loaded
        window.dispatchEvent(new CustomEvent('componentsLoaded'));
    }
    
    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
