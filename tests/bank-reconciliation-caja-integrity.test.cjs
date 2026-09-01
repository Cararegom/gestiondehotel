const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync(
  'supabase/migrations/20260901203000_bank_reconciliation_caja_integrity_repair.sql',
  'utf8'
);

test('una reserva finalizada conserva matched solo con enlace de Caja integro', () => {
  assert.match(migration, /bank_payment_has_valid_caja_link/i);
  assert.match(migration, /v_reason = 'reservation_inactive'[\s\S]*bank_payment_has_valid_caja_link/i);
  assert.match(migration, /e\.amount_cop::numeric = \([\s\S]*sum\(a\.amount_cop\)/i);
  assert.match(migration, /a\.caja_id is null/i);
  assert.match(migration, /c\.monto::numeric is distinct from a\.amount_cop::numeric/i);
  assert.match(migration, /fa\.account_type is distinct from 'bank'/i);
});

test('cambios reales en Caja degradan la conciliacion a revision', () => {
  assert.match(migration, /bank_reconciliation_handle_caja_update/i);
  assert.match(migration, /after update of hotel_id, tipo, monto, metodo_pago_id, reserva_id/i);
  assert.match(migration, /review_reason = 'cash_movement_changed'/i);
  assert.match(migration, /'relation_changed'/i);
  assert.match(migration, /bank_email_notify_payment_event/i);
});

test('la reparacion historica solo restaura reservation_inactive con Caja valida', () => {
  assert.match(migration, /e\.status = 'manual_review'/i);
  assert.match(migration, /e\.review_reason = 'reservation_inactive'/i);
  assert.match(migration, /bank_payment_has_valid_caja_link\(e\.id, e\.hotel_id\)/i);
  assert.match(migration, /reservation_inactive_repaired_from_caja/i);
  assert.match(migration, /manual_reconciliation_state_changed/i);
});

test('las relaciones legacy ambiguas dejan de figurar como conciliadas', () => {
  assert.match(migration, /a\.caja_id is null/i);
  assert.match(migration, /a2\.payment_event_id <> a\.payment_event_id/i);
  assert.match(migration, /a2\.reservation_id is not distinct from a\.reservation_id/i);
  assert.match(migration, /legacy_caja_link_ambiguous/i);
  assert.match(migration, /set status = 'manual_review'/i);
});

test('los helpers nuevos no quedan expuestos a clientes', () => {
  assert.match(migration, /revoke all on function public\.bank_payment_has_valid_caja_link\(uuid, uuid\) from authenticated/i);
  assert.match(migration, /grant execute on function public\.bank_payment_has_valid_caja_link\(uuid, uuid\) to service_role/i);
  assert.match(migration, /revoke all on function public\.bank_reconciliation_handle_caja_update\(\) from authenticated/i);
});
