/* Service worker de Mesa 2.0 — SOLO el envoltorio (shell). Criterio heredado
   de la mesa privada: JAMÁS cachear datos de mercado. Toda petición a
   *.supabase.co se deja pasar a la red SIEMPRE — una foto vieja no puede
   disfrazarse del mercado de ahora. Offline: abre el shell y falla honesto. */
const VER = 'mesa2-v4';
const SHELL = [
  './', './index.html', './app/main.js',
  './vendor/supabase.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Datos de mercado / auth / proxy de brókeres: SIEMPRE a la red, nunca caché.
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('fonts.gstatic.com')
      || url.hostname.endsWith('ts.net')) return;
  // Shell: network-first con respaldo a caché (offline abre la app).
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && e.request.method === 'GET' && url.origin === location.origin) {
        const cp = r.clone(); caches.open(VER).then(c => c.put(e.request, cp));
      }
      return r;
    }).catch(() => caches.match(e.request).then(m => m || caches.match('./index.html')))
  );
});
