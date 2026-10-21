// Deme service worker (v2).
// Caches: app shell + static assets, visited pages, and the PUBLIC record JSON
// (read-only, for offline browsing of what was already loaded).
// Never caches: non-GET requests, cross-origin requests (Supabase auth, picks,
// watches, Turnstile), or anything carrying an Authorization header.
// Online, pages and record data are always fetched fresh first (network-first),
// so a push to main and any pipeline data fix go live immediately.
const VERSION = 'v2';
const SHELL = 'deme-shell-' + VERSION;
const PAGES = 'deme-pages-' + VERSION;
const DATA = 'deme-data-' + VERSION;
const KEEP = [SHELL, PAGES, DATA];
const OFFLINE_URL = '/offline.html';
const MAX_PAGES = 60;
const MAX_DATA = 400; // per-decision files are small; this bounds storage

const PRECACHE = [
  '/',
  OFFLINE_URL,
  '/assets/css/deme.css',
  '/assets/js/common.js',
  '/assets/js/pwa.js',
];

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {}))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req, cacheName, max, ignoreSearch) {
  return fetch(req)
    .then((res) => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(cacheName).then((c) => c.put(req, copy)).then(() => trim(cacheName, max));
      }
      return res;
    })
    .catch(() => caches.match(req, { ignoreSearch: !!ignoreSearch }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('Authorization')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Pages: fresh when online; last-seen copy, then offline page, when not.
  if (req.mode === 'navigate') {
    event.respondWith(
      networkFirst(req, PAGES, MAX_PAGES, true).then(
        (res) => res || caches.match(OFFLINE_URL).then((r) => r || Response.error())
      )
    );
    return;
  }

  // Public record data: fresh when online; already-loaded copy when offline.
  if (url.pathname.startsWith('/data/')) {
    event.respondWith(
      networkFirst(req, DATA, MAX_DATA).then((res) => res || Response.error())
    );
    return;
  }

  // Static assets: instant from cache, refreshed in the background.
  if (url.pathname.startsWith('/assets/') || /\.(?:svg|png|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(SHELL).then((cache) =>
        cache.match(req).then((cached) => {
          const refresh = fetch(req)
            .then((res) => {
              if (res && res.status === 200) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || refresh;
        })
      )
    );
  }
});
