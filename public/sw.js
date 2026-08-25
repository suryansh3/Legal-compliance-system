/* Legal Metrology Compliance Checker — Service Worker
 * Strategy:
 *  - App shell (/, /static/*) : stale-while-revalidate
 *  - CDN assets              : cache-first (immutable-ish)
 *  - /api/*                  : network-only (never cache authed/dynamic data)
 */
const CACHE = 'lmpc-shell-v2';
const SHELL = [
  '/',
  '/static/app.js',
  '/static/style.css',
  '/manifest.webmanifest',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return; // never intercept mutations

  // API: network only (auth tokens, live data)
  if (url.pathname.startsWith('/api/')) return;

  // CDN libs: cache-first
  if (url.origin !== self.location.origin) {
    e.respondWith(
      caches.match(e.request).then((hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
      )
    );
    return;
  }

  // Same-origin shell: stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => hit); // offline fallback to cache
      return hit || net;
    })
  );
});
