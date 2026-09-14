/* Service worker de Mesa de Mercado 2.0 — SOLO el envoltorio (shell). Criterio heredado
   de la mesa privada: JAMÁS cachear datos de mercado. Toda petición a
   *.supabase.co se deja pasar a la red SIEMPRE — una foto vieja no puede
   disfrazarse del mercado de ahora. Offline: abre el shell y falla honesto. */
const VER = 'mesa2-v28';
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

// ---- Avisos push (los manda el worker del VPS con la llave VAPID) ----
// Payload esperado (JSON): { titulo, cuerpo, tag?, url? } — url es una ruta de
// la app ('#/copiloto'). Si no llega JSON, el texto crudo va de cuerpo.
self.addEventListener('push', (e) => {
  let d = {};
  if (e.data) {
    try { d = e.data.json(); } catch (_) { d = { cuerpo: e.data.text() }; }
  }
  if (!d || typeof d !== 'object') d = { cuerpo: String(d == null ? '' : d) };
  const op = {
    body: String(d.cuerpo || ''),
    // solo rutas internas de la app (#/…): nunca un destino externo del payload
    data: { url: (typeof d.url === 'string' && d.url.startsWith('#/')) ? d.url : '#/copiloto' },
    icon: './icon-192.png', badge: './icon-192.png',
  };
  // renotify exige tag no vacío (si no, el navegador lanza TypeError).
  if (d.tag) { op.tag = String(d.tag); op.renotify = true; }
  e.waitUntil(self.registration.showNotification(String(d.titulo || 'Mesa de Mercado 2.0'), op));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const u0 = (e.notification.data && e.notification.data.url) || '#/copiloto';
  const url = (typeof u0 === 'string' && u0.startsWith('#/')) ? u0 : '#/copiloto';
  const abs = new URL('./' + url, self.registration.scope).href;   // siempre dentro de la app
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(x => x.url && x.url.startsWith(self.registration.scope)) || cs[0];
    if (!c) return self.clients.openWindow(abs);
    // Enfocar y llevar a la ruta: la app cambia el hash (sin recargar) al
    // recibir el mensaje; si la ruta no es un hash, se navega de verdad.
    return Promise.resolve(c.focus ? c.focus() : c).then(w => {
      const cli = w || c;
      cli.postMessage({ tipo: 'navegar', url }); return cli;
    }).catch(() => self.clients.openWindow(abs));
  }));
});

// El navegador puede rotar la suscripción push: se vuelve a suscribir con la
// misma llave y se avisa a la app para que guarde el endpoint nuevo en la nube.
self.addEventListener('pushsubscriptionchange', (e) => {
  const key = e.oldSubscription && e.oldSubscription.options && e.oldSubscription.options.applicationServerKey;
  e.waitUntil(
    (key ? self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : Promise.resolve())
      .catch(() => null)
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then(cs => cs.forEach(c => c.postMessage({ tipo: 'resuscribir' })))
  );
});
