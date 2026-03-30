// FICHAJES sw.js v0.5.5
const CACHE_NAME = 'fichajes-v0.5.5';
const STATIC_FILES = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.json'
];

// ── INSTALL: cachear estáticos ────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpiar cachés viejas ──────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: cache-first para estáticos, network-first para API ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API de Apps Script → siempre red, sin caché
  if (url.hostname.includes('script.google.com')) {
    event.respondWith(fetch(event.request).catch(() =>
      new Response(JSON.stringify({ error: 'Sin conexión' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    ));
    return;
  }

  // Estáticos → cache-first, actualiza en background
  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
