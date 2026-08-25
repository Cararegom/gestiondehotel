const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const hub = fs.readFileSync('js/modules/reportes/reportes-centro.js', 'utf8');
const bankModule = fs.readFileSync('js/modules/pagos-bancarios/pagos-bancarios.js', 'utf8');
const main = fs.readFileSync('js/main.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260803120000_bank_email_payments_pilot.sql', 'utf8');

test('Fase 6 solo aparece en Reportes para el piloto administrador', () => {
  assert.match(hub, /key: 'conciliacion'.*adminOnly: true, pilotOnly: true/);
  assert.match(hub, /getBankPaymentPilotStatus/);
  assert.match(hub, /pilotStatus\.canAccess === true && pilotStatus\.isAdmin === true/);
  assert.doesNotMatch(main, /text: 'Pagos bancarios'/);
});

test('la conciliacion respeta el flujo pago primero y no crea pagos ni caja', () => {
  assert.match(bankModule, /const BANK_FIRST_WORKFLOW = true/);
  assert.match(bankModule, /Primero se recibe el pago y luego la recepcionista registra/);
  assert.match(bankModule, /no crea cobros ni movimientos adicionales en Caja/i);

  const reviewFunction = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.review_bank_payment_event'),
    migration.indexOf('ALTER TABLE public.bank_email_integrations ENABLE ROW LEVEL SECURITY')
  );
  assert.doesNotMatch(reviewFunction, /INSERT INTO public\.pagos_reserva/i);
  assert.doesNotMatch(reviewFunction, /INSERT INTO public\.movimientos_caja/i);
});

test('el piloto permanece fijado exclusivamente a Hotel Marena San Isidro', () => {
  assert.match(migration, /v_expected_name constant text := 'hotel marena san isidro'/i);
  assert.match(migration, /p_pilot_hotel_name text DEFAULT 'Hotel Marena San Isidro'/);
});
