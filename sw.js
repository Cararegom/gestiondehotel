const APP_VERSION = '20260328-1';
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
  '/js/manifest.json',
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

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (request.mode === 'navigate') {
      const offline = await caches.match(OFFLINE_URL);
      if (offline) return offline;
    }

    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise || fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (shouldCacheAsset(request, url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
