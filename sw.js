// AGSIST Service Worker — Cache Buster v2
// This version clears all caches on activation to ensure fresh content.

const CACHE_VERSION = 'agsist-v2-' + Date.now();

// Install: skip waiting to activate immediately
self.addEventListener('install', function(event) {
    self.skipWaiting();
});

// Activate: clear ALL old caches
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.map(function(cacheName) {
                    console.log('[SW] Clearing cache:', cacheName);
                    return caches.delete(cacheName);
                })
            );
        }).then(function() {
            console.log('[SW] All caches cleared');
            return self.clients.claim();
        })
    );
});

// Fetch: always go to network (no caching)
self.addEventListener('fetch', function(event) {
    event.respondWith(fetch(event.request));
});
