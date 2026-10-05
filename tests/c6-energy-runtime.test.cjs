const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ENERGY_VERSION = '20260910-c6-camera-1';
const CANONICAL_MODULE = 'js/modules/control-energia/control-energia.js';
const LEGACY_MODULE = 'js/modules/control-energia/control-energia-20260902.js';

const index = fs.readFileSync('app/index.html', 'utf8');
const main = fs.readFileSync('js/main.js', 'utf8');
const serviceWorker = fs.readFileSync('sw.js', 'utf8');
const legacyModule = fs.readFileSync(LEGACY_MODULE, 'utf8');

function energyImportFromMain() {
  const match = main.match(/import\(['"](\.\/modules\/control-energia\/control-energia\.js\?v=[^'"]+)['"]\)/);
  assert.ok(match, 'main.js debe importar directamente el modulo canonico con cache-bust');
  return match[1];
}

test('C6 ejecuta el modulo canonico corregido sin redireccion por import map', () => {
  assert.doesNotMatch(index, /control-energia-20260902\.js/);

  const importSpecifier = energyImportFromMain();
  assert.equal(importSpecifier, `./modules/control-energia/control-energia.js?v=${ENERGY_VERSION}`);

  const sourcePath = path.join('js', importSpecifier.slice(2).split('?')[0]);
  const runtimeSource = fs.readFileSync(sourcePath, 'utf8');

  assert.match(runtimeSource, /ENERGY_SCANNER_STOP_TIMEOUT_MS = 1500/);
  assert.match(runtimeSource, /ENERGY_SCAN_TIMEOUT_MS = 12000/);
  assert.match(runtimeSource, /void stopScanner\(\);[\s\S]{0,500}db\.rpc\('energy_scan'/);
  assert.match(runtimeSource, /renderScanRetry/);
});

test('C6 conserva compatibilidad con clientes cacheados sin duplicar la implementacion', () => {
  assert.match(
    legacyModule,
    new RegExp(`export \\{ mount, unmount \\} from './control-energia\\.js\\?v=${ENERGY_VERSION}';`)
  );
  assert.doesNotMatch(legacyModule, /function renderScanner|function processToken|ENERGY_SCAN_TIMEOUT_MS/);
});

test('C6 renueva el service worker y precarga exactamente el modulo ejecutado', () => {
  assert.match(serviceWorker, new RegExp(`APP_VERSION = '${ENERGY_VERSION}'`));
  assert.match(
    serviceWorker,
    new RegExp(`/js/modules/control-energia/control-energia\\.js\\?v=${ENERGY_VERSION}`)
  );
});
