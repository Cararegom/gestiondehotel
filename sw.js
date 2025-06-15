// sw.js (Service Worker Básico)

// Este evento se dispara cuando el Service Worker se instala.
self.addEventListener('install', (event) => {
  console.log('Service Worker instalado.');
  // Forzar al nuevo Service Worker a activarse inmediatamente.
  self.skipWaiting();
});

// Este evento se dispara cuando el Service Worker se activa.
self.addEventListener('activate', (event) => {
  console.log('Service Worker activado.');
  // Tomar el control de la página inmediatamente.
  return self.clients.claim();
});

// Este evento intercepta las peticiones de red (lo dejamos simple por ahora).
self.addEventListener('fetch', (event) => {
  // Simplemente dejamos que la petición continúe a la red.
  event.respondWith(fetch(event.request));
});