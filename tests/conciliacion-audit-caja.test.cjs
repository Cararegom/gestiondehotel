const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const cajaMigration = fs.readFileSync('supabase/migrations/20260901184238_bank_payment_allocation_caja_link.sql', 'utf8');
const auditMigration = fs.readFileSync('supabase/migrations/20260901195500_allow_cash_movement_linked_audit.sql', 'utf8');

test('la conciliacion durable de Caja usa una accion admitida por la auditoria', () => {
  assert.match(cajaMigration, /'cash_movement_linked'/);
  assert.match(auditMigration, /drop constraint if exists bank_payment_audit_log_action_check/);
  assert.match(auditMigration, /add constraint bank_payment_audit_log_action_check/);
  assert.match(auditMigration, /'cash_movement_linked'::text/);
});
