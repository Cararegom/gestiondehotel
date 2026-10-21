const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('advertencia solo se inicia para recepcionista con hotel autenticado', () => {
  const app = read('js/main.js');
  const service = read('js/services/energyReceptionWarning.js');
  assert.match(app, /startEnergyReceptionWarning\(/);
  assert.match(app, /stopEnergyReceptionWarning\(/);
  assert.match(service, /isReceptionist\(role\)/);
  assert.match(service, /\.eq\('hotel_id', hotelId\)/);
  assert.match(service, /document\.hidden/);
  assert.match(service, /onEnergyRoute\(\)/);
});

test('administración tiene opción independiente de alertas por correo', () => {
  const source = read('js/modules/control-energia/control-energia.js');
  assert.match(source, /energy_reception_warning_enabled/);
  assert.match(source, /energy_reception_warning_minutes/);
  assert.match(source, /Advertencia a recepci[oó]n/);
  assert.match(source, /can_admin/);
});

test('modal centrado y recordatorio controlado, sin marcar control como completado', () => {
  const service = read('js/services/energyReceptionWarning.js');
  assert.match(service, /position:fixed;inset:0/);
  assert.match(service, /role="alertdialog"/);
  assert.match(service, /Recordar en 2 minutos/);
  assert.match(service, /window\.location\.hash = '#\/control-energia'/);
  assert.doesNotMatch(service, /\.update\(/);
  assert.doesNotMatch(service, /service_role/);
});

test('reglas: no avisa antes del plazo y omite controles finalizados', async () => {
  const url = pathToFileURL(path.join(ROOT, 'js/services/energyReceptionWarningRules.mjs')).href;
  const { selectEnergyReceptionWarnings } = await import(url);
  const now = Date.parse('2026-10-20T22:00:00.000Z');
  const checks = [
    { id: 'new', status: 'pending', created_at: '2026-10-20T21:57:00Z' },
    { id: 'old', status: 'overdue', created_at: '2026-10-20T21:50:00Z' },
    { id: 'done', status: 'completed', created_at: '2026-10-20T21:00:00Z' },
    { id: 'cancelled', status: 'cancelled', created_at: '2026-10-20T21:00:00Z' }
  ];
  assert.deepEqual(selectEnergyReceptionWarnings(checks, 5, now).map((c) => c.id), ['old']);
  assert.deepEqual(selectEnergyReceptionWarnings(checks, 11, now), []);
  assert.deepEqual(selectEnergyReceptionWarnings(checks, 0, now), []);
  assert.deepEqual(selectEnergyReceptionWarnings(null, 5, now), []);
});
