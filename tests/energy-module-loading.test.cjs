const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const index = fs.readFileSync('app/index.html', 'utf8');
const serviceWorker = fs.readFileSync('sw.js', 'utf8');
const recovery = fs.readFileSync('js/energy-module-recovery.js', 'utf8');
const main = fs.readFileSync('js/main.js', 'utf8');
const energy = fs.readFileSync('js/modules/control-energia/control-energia-20260902.js', 'utf8');

test('Control de Energia usa una URL nueva para evitar JS cacheado', () => {
  assert.match(index, /type="importmap"/);
  assert.match(index, /"\/js\/modules\/control-energia\/control-energia\.js"\s*:\s*"\/js\/modules\/control-energia\/control-energia-20260902\.js"/);
  assert.match(index, /\/js\/main\.js\?v=20260902-energy-loader-1/);
  assert.match(main, /import\('\.\/modules\/control-energia\/control-energia\.js'\)/);
  assert.match(energy, /export async function mount/);
});

test('service worker renueva caches y precarga el modulo versionado', () => {
  assert.match(serviceWorker, /APP_VERSION = '20260902-energy-loader-1'/);
  assert.match(serviceWorker, /control-energia-20260902\.js/);
  assert.match(serviceWorker, /cache\.match\(request\) \|\| await caches\.match\(request\)/);
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
  assert.match(serviceWorker, /self\.clients\.claim\(\)/);
});

test('un fallo de importacion ya no deja spinner infinito', () => {
  assert.match(index, /energy-module-recovery\.js\?v=20260902-1/);
  assert.ok(index.indexOf('energy-module-recovery.js') < index.indexOf('/js/main.js'));
  assert.match(recovery, /unhandledrejection/);
  assert.match(recovery, /Unexpected token/);
  assert.match(recovery, /app-global-loading-overlay/);
  assert.match(recovery, /energy-module-retry/);
  assert.match(recovery, /window\.location\.reload\(\)/);
});