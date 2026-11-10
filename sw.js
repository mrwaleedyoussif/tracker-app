/* Service worker — caches the app shell so it opens instantly and works offline (read-only).
   API calls (script.google.com) are never cached. Bump CACHE on every release. */
const CACHE = 'tracker-1448-v8';
const SHELL = ['./', './index.html', './styles.css?v=3', './app.js?v=4', './i18n.js?v=5', './config.js?v=3', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-192.png', './icons/maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png', './icons/favicon-64.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // API & external → network only
  // navigation requests → app shell (so deep links like ?v=dash work offline)
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return r; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  // static assets → stale-while-revalidate
  e.respondWith(caches.match(req).then(cached => {
    const net = fetch(req).then(r => { if (r && r.ok) caches.open(CACHE).then(c => c.put(req, r.clone())); return r; }).catch(() => cached);
    return cached || net;
  }));
});
