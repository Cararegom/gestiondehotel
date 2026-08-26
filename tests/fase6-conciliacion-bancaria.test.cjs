const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const hub = fs.readFileSync('js/modules/reportes/reportes-centro.js', 'utf8');
const bankModule = fs.readFileSync('js/modules/pagos-bancarios/pagos-bancarios.js', 'utf8');
const main = fs.readFileSync('js/main.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260803120000_bank_email_payments_pilot.sql', 'utf8');
const allocationsMigration = fs.readFileSync('supabase/migrations/20260825223000_bank_payment_multiple_allocations.sql', 'utf8');
const bankApi = fs.readFileSync('supabase/functions/bank-email-api/index.ts', 'utf8');
const reconcilableMigration = fs.readFileSync('supabase/migrations/20260826181130_fase5_ventas_bancarias_conciliables.sql', 'utf8');
const capacityMigration = fs.readFileSync('supabase/migrations/20260826183106_fase6_prevenir_doble_conciliacion.sql', 'utf8');
const cashModule = fs.readFileSync('js/modules/caja/caja-movimientos.js', 'utf8');
const cashView = fs.readFileSync('js/modules/caja/caja.js', 'utf8');
const bankService = fs.readFileSync('js/services/bankPaymentService.js', 'utf8');

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
  assert.match(bankModule, /Total.*Pagado.*Pendiente/);
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

test('Fase 5 separa venta cobrada de venta conciliable y conserva el aislamiento', () => {
  assert.match(reconcilableMigration, /FUNCTION public\.bank_email_sale_is_reconcilable/);
  assert.match(reconcilableMigration, /resolve_bank_email_pilot_hotel\('Hotel Marena San Isidro'\)/);
  assert.doesNotMatch(reconcilableMigration, /estado_pago[^\n]*<>[^\n]*pagado/);
  assert.match(reconcilableMigration, /REVOKE ALL ON FUNCTION public\.bank_email_sale_is_reconcilable[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(reconcilableMigration, /bank_email_sale_is_reconcilable\(v_sale_type, v_sale_id, v_hotel_id\)/);
  assert.doesNotMatch(bankApi, /estado_pago\.is\.null,estado_pago\.neq\.pagado/);
  assert.match(bankApi, /isBankReconciliationPaymentMethod/);
  assert.match(bankApi, /in\('metodo_pago_id', bankPaymentMethodIds\)/);
});

test('Fase 6 impide doble conciliacion y permite corregir el evento actual', () => {
  assert.match(capacityMigration, /FUNCTION public\.bank_email_sale_available_amount_cop/);
  assert.match(capacityMigration, /e\.status IN \('matched', 'confirmed'\)/);
  assert.match(capacityMigration, /a\.payment_event_id <> p_exclude_payment_event_id/);
  assert.match(capacityMigration, /pg_advisory_xact_lock/);
  assert.match(capacityMigration, /v_amount > v_available/);
  assert.match(capacityMigration, /REVOKE ALL ON FUNCTION public\.bank_email_sale_available_amount_cop[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(bankApi, /activeSaleAllocationTotals/);
  assert.match(bankApi, /sales\.filter\(\(sale\) => Number\(sale\.available_amount_cop \|\| 0\) > 0\)/);
});

test('Fase 7 presenta candidatos humanos, cercanos y consultados por lotes', () => {
  assert.match(bankApi, /rankCandidatesByTime/);
  assert.match(bankApi, /candidateWindowStart/);
  assert.match(bankApi, /ventas_restaurante_items/);
  assert.match(bankApi, /terraza_pedido_items/);
  assert.match(bankApi, /terraza_mesas/);
  assert.match(bankApi, /humanItemSummary/);
  assert.doesNotMatch(bankApi, /Restaurante · \$\{sale\.nombre_cliente_temporal \|\| sale\.id\}/);
  assert.doesNotMatch(bankApi, /Terraza - \$\{sale\.cliente_nombre \|\| sale\.id\}/);
});

test('Fase 9 muestra estados bancarios solo en Caja del hotel piloto', () => {
  assert.match(cashModule, /BANK_RECONCILIATION_PILOT_HOTEL_NAME = 'hotel marena san isidro'/);
  assert.match(cashModule, /hotelName[\s\S]*BANK_RECONCILIATION_PILOT_HOTEL_NAME/);
  assert.match(cashModule, /showBankStatus[\s\S]*getBankPaymentCashStatuses/);
  assert.match(cashView, /id="bank-status-header" class="hidden"/);
  assert.match(cashModule, /Esperando verificacion/);
  assert.match(cashModule, /Confirmado por banco/);
  assert.match(cashModule, /Revision administrativa/);
  assert.match(cashModule, /No aplica/);
  assert.match(bankService, /cash-movement-statuses/);
});

test('Fase 9 usa relaciones operativas persistidas y nunca crea movimientos', () => {
  const section = bankApi.slice(
    bankApi.indexOf("if (action === 'cash-movement-statuses')"),
    bankApi.indexOf("if (action === 'list')")
  );
  assert.match(section, /bank_payment_allocations/);
  assert.match(section, /pago_reserva_id/);
  assert.match(section, /venta_tienda_id/);
  assert.match(section, /venta_restaurante_id/);
  assert.match(section, /venta_terraza_id/);
  assert.doesNotMatch(section, /fecha_movimiento|concepto|amount_cop|\.insert\(|\.update\(|\.delete\(/);
  assert.match(section, /operational_role_required/);
});
