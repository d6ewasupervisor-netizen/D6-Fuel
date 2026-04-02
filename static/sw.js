const CACHE_NAME = 'suppl-intel-v1';
const STATIC_ASSETS = [
    '/',
    '/static/css/styles.css',
    '/static/js/api.js',
    '/static/js/scanner.js',
    '/static/js/gestures.js',
    '/static/js/pdf-viewer.js',
    '/static/js/image-cache.js',
    '/static/js/planogram.js',
    '/static/js/app.js',
    '/static/images/mascot.png',
    '/static/manifest.json',
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    // Network-first for API calls
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    // Cache-first for static assets
    e.respondWith(
        caches.match(e.request).then((cached) => {
            if (cached) return cached;
            return fetch(e.request).then((resp) => {
                // Cache new static resources
                if (resp.ok && (url.pathname.startsWith('/static/') || url.pathname === '/')) {
                    const clone = resp.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
                }
                return resp;
            });
        })
    );
});
