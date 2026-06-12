const cacheName = 'eks-app-v4';
const assets = [
  'index.html',
  'script.js',
  'manifest.json',
  'Banner.jpg',
  'Icons/app-icon.png',
  'js/xlsx.full.min.js',
  'js/fachbilder.js',
  'js/html2canvas.min.js',
  'js/jspdf.umd.min.js'
];

// Installation: Dateien einzeln cachen (einzelne Fehler brechen die Installation NICHT ab)
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(cacheName).then((cache) => Promise.allSettled(assets.map((a) => cache.add(a))))
  );
});

// Alte Caches aufräumen
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== cacheName).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Abruf: erst Cache, dann Netz
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});
