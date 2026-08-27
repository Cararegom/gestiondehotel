const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const parser = fs.readFileSync('supabase/functions/_shared/bank-email/bankParsers/bancolombia.ts', 'utf8');
const paymentService = fs.readFileSync('supabase/functions/_shared/bank-email/payment-service.ts', 'utf8');
const design = fs.readFileSync('docs/conciliacion-bancaria-v2/12-diseno-movimientos-salientes.md', 'utf8');

test('Fase 12 mantiene las salidas fuera del flujo de ingresos', () => {
  assert.match(parser, /classification === "sent"/);
  assert.match(parser, /outgoing_transfer_detected/);
  assert.match(parser, /rejectedReasons/);
  assert.match(paymentService, /parsed\.disposition === 'detected'/);
  assert.match(design, /nunca entra en `bank_payment_events`/);
  assert.match(design, /nunca inserta directamente en Caja o ledger/);
});

test('Fase 12 exige clasificacion administrativa idempotente y sin duplicar gastos', () => {
  assert.match(design, /exclusivamente administrativa/);
  assert.match(design, /operación idempotente/);
  assert.match(design, /sin duplicarlo/);
  assert.match(design, /Recepción no verá la pestaña/);
  assert.match(design, /Hotel Marena San Isidro/);
});
