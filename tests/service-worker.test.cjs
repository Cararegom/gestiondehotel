const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const serviceWorkerSource = readFileSync(resolve(__dirname, '../sw.js'), 'utf8');

function loadServiceWorker({ fetchImpl, cacheOverrides = {} } = {}) {
  const listeners = new Map();
  const cache = {
    addAll: async () => undefined,
    match: async () => undefined,
    put: async () => undefined,
    ...cacheOverrides,
  };
  const context = {
    URL,
    Set,
    Response,
    fetch: fetchImpl || (async () => new Response('network')),
    caches: {
      open: async () => cache,
      keys: async () => [],
      delete: async () => true,
      match: async () => undefined,
    },
    self: {
      location: { origin: 'https://gestiondehotel.com' },
      clients: { claim: async () => undefined },
      skipWaiting: async () => undefined,
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
    },
  };
  vm.runInNewContext(serviceWorkerSource, context, { filename: 'sw.js' });
  return { cache, listeners };
}

function fetchEvent(request) {
  let responsePromise = null;
  const backgroundPromises = [];
  return {
    event: {
      request,
      respondWith(value) {
        responsePromise = Promise.resolve(value);
      },
      waitUntil(value) {
        backgroundPromises.push(Promise.resolve(value));
      },
    },
    response: () => responsePromise,
    background: () => Promise.all(backgroundPromises),
  };
}

test('el service worker ignora solicitudes chrome-extension y otros origenes', () => {
  const { listeners } = loadServiceWorker();
  const extension = fetchEvent({
    method: 'GET',
    url: 'chrome-extension://extension-id/content.js',
    mode: 'cors',
    destination: 'script',
  });
  listeners.get('fetch')(extension.event);
  assert.equal(extension.response(), null);

  const external = fetchEvent({
    method: 'GET',
    url: 'https://cdn.example.test/library.js',
    mode: 'cors',
    destination: 'script',
  });
  listeners.get('fetch')(external.event);
  assert.equal(external.response(), null);
});

test('network-first conserva la respuesta aunque falle cache.put', async () => {
  const { listeners } = loadServiceWorker({
    fetchImpl: async () => new Response('actual', { status: 200 }),
    cacheOverrides: {
      put: async () => {
        throw new TypeError('cache unavailable');
      },
    },
  });
  const request = fetchEvent({
    method: 'GET',
    url: 'https://gestiondehotel.com/js/main.js',
    mode: 'cors',
    destination: 'script',
  });
  listeners.get('fetch')(request.event);
  const response = await request.response();
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'actual');
});

test('las estrategias devuelven Response 503 si no hay red ni cache', async () => {
  const { listeners } = loadServiceWorker({
    fetchImpl: async () => {
      throw new TypeError('offline');
    },
  });

  const script = fetchEvent({
    method: 'GET',
    url: 'https://gestiondehotel.com/js/main.js',
    mode: 'cors',
    destination: 'script',
  });
  listeners.get('fetch')(script.event);
  assert.equal((await script.response()).status, 503);

  const image = fetchEvent({
    method: 'GET',
    url: 'https://gestiondehotel.com/icons/logo.jpeg',
    mode: 'cors',
    destination: 'image',
  });
  listeners.get('fetch')(image.event);
  assert.equal((await image.response()).status, 503);
});
