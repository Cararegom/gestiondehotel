const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260828063000_recepcion_relacion_pagos_bancarios.sql', 'utf8');
const relationApi = fs.readFileSync('supabase/functions/bank-payment-relation-api/index.ts', 'utf8');
const adminApi = fs.readFileSync('supabase/functions/bank-email-api/index.ts', 'utf8');
const bootstrap = fs.readFileSync('js/bank-payment-reception-bootstrap.js', 'utf8');
const appIndex = fs.readFileSync('app/index.html', 'utf8');
const packageJson = fs.readFileSync('package.json', 'utf8');

test('recepcion solo obtiene una via operativa para relacionar, no permisos administrativos', () => {
  assert.match(migration, /bank_email_actor_is_pilot_operational/);
  assert.match(migration, /'admin', 'administrador', 'superadmin', 'recepcionista'/);
  assert.match(migration, /if v_action = 'link'[\s\S]*bank_email_actor_is_pilot_operational/);
  assert.match(migration, /elsif not app_private\.bank_email_actor_is_pilot_admin/);
  assert.match(migration, /Solo un administrador efectivo puede confirmar pagos/);
  assert.doesNotMatch(migration, /grant execute on function app_private\.bank_email_actor_is_pilot_operational[\s\S]{0,120}authenticated/i);

  for (const action of ['list', 'detail', 'candidates', 'manual-action']) {
    const pattern = new RegExp(`action === '${action.replace('-', '\\-')}'[\\s\\S]{0,180}requirePilotAdministrator`);
    assert.match(adminApi, pattern);
  }
});

test('API de recepcion falla cerrada por hotel/rol y nunca expone evidencia bancaria sensible', () => {
  assert.match(relationApi, /isBankEmailProcessingEnabled/);
  assert.match(relationApi, /context\.profile\.hotel_id !== pilot\.id/);
  assert.match(relationApi, /isPilotOperationalUser/);
  assert.match(relationApi, /operational_role_required/);
  assert.match(relationApi, /select\('id,amount_cop,status,email_received_at,created_at,updated_at'\)/);
  assert.doesNotMatch(relationApi, /transaction_reference|sender_name|sender_email|gmail_message_id|gmail_thread_id|email_subject|raw_content_hash/);
  assert.doesNotMatch(relationApi, /manualAction|p_action:\s*'confirm'|p_action:\s*'reject'|p_action:\s*'mark_reviewed'/);
});

test('la relacion se construye desde movimientos reales de Caja y debe cuadrar exactamente', () => {
  assert.match(relationApi, /\.from\('caja'\)/);
  assert.match(relationApi, /\.eq\('hotel_id', hotelId\)/);
  assert.match(relationApi, /\.eq\('tipo', 'ingreso'\)/);
  assert.match(relationApi, /isBankReconciliationPaymentMethod/);
  assert.match(relationApi, /targetForMovement/);
  assert.match(relationApi, /total !== event\.amountCop/);
  assert.match(relationApi, /deben sumar exactamente/);
  assert.match(relationApi, /p_actor_id:\s*context\.user\.id/);
  assert.match(relationApi, /p_action:\s*'link'/);
  assert.match(relationApi, /p_review_reason:\s*reason/);
  assert.match(migration, /La suma distribuida debe ser exactamente igual a la transferencia/);
});

test('la interfaz limitada vive en Caja, exige motivo y no abre la consola bancaria completa', () => {
  assert.match(appIndex, /bank-payment-reception-bootstrap\.js/);
  assert.match(bootstrap, /isCajaRoute/);
  assert.match(bootstrap, /Relacionar pago con Caja/);
  assert.match(bootstrap, /No se muestran datos sensibles del correo bancario/);
  assert.match(bootstrap, /bank-reception-movement/);
  assert.match(bootstrap, /Motivo de la relacion/);
  assert.match(bootstrap, /movementIds/);
  assert.match(bootstrap, /reason/);
  assert.doesNotMatch(bootstrap, /sender_name|sender_email|transaction_reference|gmail_message_id|email_subject|raw_content_hash/);
});

test('CI incluye la nueva Edge Function en typecheck y lint', () => {
  assert.match(packageJson, /supabase\/functions\/bank-payment-relation-api\/index\.ts/);
  assert.match(packageJson, /supabase\/functions\/bank-payment-relation-api/);
});
