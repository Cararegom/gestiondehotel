const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const api = fs.readFileSync('supabase/functions/bank-email-api/index.ts', 'utf8');
const server = fs.readFileSync('supabase/functions/_shared/bank-email/server.ts', 'utf8');
const main = fs.readFileSync('js/main.js', 'utf8');
const service = fs.readFileSync('js/services/bankPaymentService.js', 'utf8');
const notifications = fs.readFileSync('js/modules/notificaciones/notificaciones.js', 'utf8');

test('recepcion puede leer solo el resumen sanitario del piloto', () => {
  assert.match(api, /action === 'operational-summary'/);
  assert.match(api, /isPilotOperationalUser/);
  assert.match(api, /select\('status, updated_at'\)/);
  assert.doesNotMatch(api, /operational-summary'[\s\S]{0,1800}transaction_reference|operational-summary'[\s\S]{0,1800}sender_name/);
  assert.match(service, /getBankPaymentOperationalSummary/);
});

test('listado, detalle, candidatos y acciones exigen administrador en servidor', () => {
  for (const action of ['list', 'detail', 'candidates', 'manual-action']) {
    const pattern = new RegExp(`action === '${action.replace('-', '\\-')}'[\\s\\S]{0,180}requirePilotAdministrator`);
    assert.match(api, pattern);
  }
  assert.match(server, /usuarios_roles[\s\S]*roles\(nombre\)/);
  assert.match(server, /administrator_role_lookup_failed/);
});

test('la ruta y los enlaces administrativos quedan cerrados a recepcion', () => {
  assert.match(main, /'\/pagos-bancarios'.*adminOnly: true/);
  assert.match(service, /canAccess: data\.eligible === true && data\.integrationEnabled === true && data\.canManageReconciliation === true/);
  assert.match(notifications, /paymentEventId && \['admin', 'administrador', 'superadmin'\]\.includes\(currentBellContext\?\.role\)/);
});
