const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260901184238_bank_payment_allocation_caja_link.sql', 'utf8');
const relationApi = fs.readFileSync('supabase/functions/bank-payment-relation-api/index.ts', 'utf8');
const bootstrap = fs.readFileSync('js/bank-payment-reception-bootstrap.js', 'utf8');

test('la conciliacion conserva el movimiento exacto de Caja y evita reutilizarlo', () => {
  assert.match(migration, /add column if not exists caja_id uuid/i);
  assert.match(migration, /foreign key \(caja_id\) references public\.caja\(id\) on delete restrict/i);
  assert.match(migration, /create unique index if not exists bank_payment_allocations_caja_id_unique/i);
  assert.match(migration, /where caja_id is not null/i);
  assert.match(migration, /replace_bank_payment_allocations_from_caja/i);
  assert.match(migration, /El movimiento de Caja ya esta conciliado con otra transferencia/);
  assert.match(migration, /revoke all on function public\.replace_bank_payment_allocations_from_caja[\s\S]*from authenticated/i);
  assert.match(migration, /grant execute on function public\.replace_bank_payment_allocations_from_caja[\s\S]*to service_role/i);
});

test('la API de recepcion usa cajaId como llave durable y bloquea duplicados', () => {
  assert.match(relationApi, /RELATABLE_STATUSES = \['detected', 'manual_review'\]/);
  assert.doesNotMatch(relationApi, /RELATABLE_STATUSES = \[[^\]]*'matched'/);
  assert.match(relationApi, /eventHasCashLink/);
  assert.match(relationApi, /action === 'movement-statuses'/);
  assert.match(relationApi, /\.not\('caja_id', 'is', null\)/);
  assert.match(relationApi, /cajaId: row\.id/);
  assert.match(relationApi, /replace_bank_payment_allocations_from_caja/);
  assert.match(relationApi, /cash_movement_already_reconciled/);
});

test('Caja consulta el vinculo exacto antes de volver a ofrecer Conciliar pago', () => {
  assert.match(bootstrap, /invoke\('movement-statuses'/);
  assert.match(bootstrap, /linkedState\?\.linked === true/);
  assert.match(bootstrap, /renderLinkedMovementState/);
  assert.match(bootstrap, /reconciled\.textContent = eventStatus === 'manual_review' \? 'Revisar' : 'Conciliado'/);
  assert.match(bootstrap, /Fail closed/);
  assert.match(bootstrap, /Conciliar pago/);
});
