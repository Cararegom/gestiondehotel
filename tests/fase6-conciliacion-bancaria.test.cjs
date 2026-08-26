const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const hub = fs.readFileSync('js/modules/reportes/reportes-centro.js', 'utf8');
const bankModule = fs.readFileSync('js/modules/pagos-bancarios/pagos-bancarios.js', 'utf8');
const main = fs.readFileSync('js/main.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260803120000_bank_email_payments_pilot.sql', 'utf8');
const allocationsMigration = fs.readFileSync('supabase/migrations/20260825223000_bank_payment_multiple_allocations.sql', 'utf8');
const bankApi = fs.readFileSync('supabase/functions/bank-email-api/index.ts', 'utf8');

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

test('la conciliacion muestra productos y distribuye una transferencia entre varios conceptos', () => {
  assert.match(bankApi, /detalle_ventas_tienda/);
  assert.match(bankApi, /from\('productos_tienda'\)[\s\S]*select\('id, nombre'\)/);
  assert.doesNotMatch(bankApi, /producto:productos_tienda\(nombre\)/);
  assert.match(bankApi, /store_sale_details_lookup_failed[\s\S]*safeStoreDetails/);
  assert.match(bankModule, /bank-sale-allocation/);
  assert.match(bankModule, /Registrada como pagada/);
  assert.match(allocationsMigration, /CREATE TABLE IF NOT EXISTS public\.bank_payment_allocations/);
  assert.match(allocationsMigration, /La suma distribuida debe ser exactamente igual a la transferencia/);
  assert.doesNotMatch(allocationsMigration, /INSERT INTO public\.(?:pagos_reserva|caja)/i);
  assert.match(allocationsMigration, /REVOKE ALL ON FUNCTION public\.replace_bank_payment_allocations[\s\S]*FROM PUBLIC,anon,authenticated/i);
});

test('Fase 3 reconstruye allocations enriquecidas sin confiar en columnas legacy', () => {
  assert.match(bankApi, /async function getPaymentAllocations/);
  assert.match(bankApi, /from\('bank_payment_allocations'\)[\s\S]*eq\('hotel_id', pilotHotelId\)[\s\S]*eq\('payment_event_id', paymentEventId\)/);
  assert.match(bankApi, /detalle_ventas_tienda/);
  assert.match(bankApi, /ventas_restaurante_items/);
  assert.match(bankApi, /terraza_pedido_items/);
  assert.match(bankApi, /return \{ event, allocations \}/);
  assert.match(bankModule, /event\?\.allocations/);
  assert.match(bankModule, /currentSale\.dataset\.allocationAmount/);
  assert.match(bankModule, /allocationAmount \|\| input\.dataset\.amount/);
});

test('Fase 4 calcula el credito de reserva desde allocations y no desde el evento completo', () => {
  assert.match(bankApi, /committedReservationTotals/);
  assert.match(bankApi, /from\('bank_payment_allocations'\)[\s\S]*eq\('allocation_type', 'reservation'\)/);
  assert.doesNotMatch(bankApi, /relatesDirectly[\s\S]*event\.amount_cop/);
});
