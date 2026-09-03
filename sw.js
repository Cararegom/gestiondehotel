const APP_VERSION = '20260903-sentry-tracing-1';
const APP_SHELL_CACHE = `gestiondehotel-shell-${APP_VERSION}`;
const RUNTIME_CACHE = `gestiondehotel-runtime-${APP_VERSION}`;
const OFFLINE_URL = '/app/offline.html';

const APP_SHELL_ASSETS = [
  '/',
  '/login.html',
  '/app/index.html',
  OFFLINE_URL,
  '/style.css',
  '/js/main.js',
  '/js/sentry-browser.js?v=20260903-tracing-1',
  '/js/manifest.json',
  '/js/modules/control-energia/control-energia-20260902.js',
  '/favicon.ico',
  '/icons/logo.jpeg',
  '/icons/192x192.png',
  '/icons/512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => ![APP_SHELL_CACHE, RUNTIME_CACHE].includes(name))
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function shouldCacheAsset(request, url) {
  if (request.method !== 'GET') return false;
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/supabase/')) return false;
  if (url.pathname.startsWith('/functions/')) return false;

  const cacheableDestinations = new Set(['document', 'script', 'style', 'image', 'font', 'manifest', 'worker']);
  return cacheableDestinations.has(request.destination) ||
    url.pathname.startsWith('/app/') ||
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/style.css';
}

function serviceUnavailableResponse() {
  return new Response('', {
    status: 503,
    statusText: 'Service Unavailable'
  });
}

async function cacheResponse(cache, request, response) {
  if (!response?.ok) return;
  try {
    await cache.put(request, response.clone());
  } catch {
    // A cache write must never turn a valid network response into a failure.
  }
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const networkResponse = await fetch(request);
    if (!networkResponse) return serviceUnavailableResponse();
    await cacheResponse(cache, request, networkResponse);
    return networkResponse;
  } catch {
    const cached = await cache.match(request) || await caches.match(request);
    if (cached) return cached;

    if (request.mode === 'navigate') {
      const offline = await caches.match(OFFLINE_URL);
      if (offline) return offline;
    }

    return serviceUnavailableResponse();
  }
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then(async (response) => {
      if (!response) return serviceUnavailableResponse();
      await cacheResponse(cache, request, response);
      return response;
    });

  if (cached) {
    const updatePromise = fetchPromise.catch(() => undefined);
    if (typeof event?.waitUntil === 'function') event.waitUntil(updatePromise);
    return cached;
  }

  try {
    return await fetchPromise;
  } catch {
    return serviceUnavailableResponse();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (request.method !== 'GET') return;
  if (!['http:', 'https:'].includes(url.protocol)) return;
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Los modulos JS y estilos deben reflejar inmediatamente la version actual.
  // Si la red falla, networkFirst puede usar la copia fresca precargada del shell.
  if (request.destination === 'script' || request.destination === 'style') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (shouldCacheAsset(request, url)) {
    event.respondWith(staleWhileRevalidate(request, event));
  }
});
