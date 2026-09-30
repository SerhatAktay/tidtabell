// Network-first for same-origin GETs, cache as offline fallback. API calls are
// cross-origin (workers.dev) and never touched, so data is always live.
const CACHE = 'tidtabell-shell';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // gtfs/ is thousands of small route files; caching each one would only bloat storage.
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/gtfs/')) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
