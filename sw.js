// Cache del CODIGO de la app. Los datos de medidores NO pasan por aqui (viven en IndexedDB).
// Al publicar cambios de codigo: subir APP_VERSION aqui y en js/app.js.
const APP_VERSION = '2.0.0';
const CACHE = 'medidores-app-' + APP_VERSION;
const ASSETS = [
  './', './index.html', './manifest.json',
  './css/app.css', './js/app.js',
  './vendor/leaflet.js', './vendor/leaflet.css', './vendor/xlsx.full.min.js',
  './icon-180.png', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  // No se activa solo: la app muestra "Actualizar" y el usuario decide.
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Mosaicos de mapa y otros dominios: directo a la red (sin cache propio)
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request))
  );
});
