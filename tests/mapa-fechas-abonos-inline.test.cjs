const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const enhancer = fs.readFileSync('js/mapa-fechas-abonos-inline.js', 'utf8');
const appIndex = fs.readFileSync('app/index.html', 'utf8');
const mapSource = fs.readFileSync('js/modules/mapa-habitaciones/mapa-habitaciones.js', 'utf8');
const modalsSource = fs.readFileSync('js/modules/mapa-habitaciones/modales-gestion.js', 'utf8');
const eventsSource = fs.readFileSync('js/modules/mapa-habitaciones/mapa-ui-events.js', 'utf8');
const paymentHistorySource = fs.readFileSync('js/mapa-consumos-pagos-enhancer.js', 'utf8');

test('Ver consumos muestra la fecha del pago junto a cada servicio pagado', () => {
  assert.match(enhancer, /pago_reserva_id/);
  assert.match(enhancer, /fecha_servicio/);
  assert.match(enhancer, /\.from\('pagos_reserva'\)/);
  assert.match(enhancer, /\.select\('id, fecha_pago'\)/);
  assert.match(enhancer, /Fecha pago: \$\{paymentDate\}/);
  assert.match(enhancer, /paymentDateInline/);
});

test('Ver consumos elimina las listas duplicadas de historial', () => {
  assert.match(enhancer, /removeDuplicatePaymentLists/);
  assert.match(enhancer, /data-consumos-payment-history/);
  assert.match(enhancer, /data-payment-history-section/);
  assert.doesNotMatch(enhancer, /Historial de pagos y abonos/);
  assert.match(modalsSource, /dataset\.inlinePaymentDates = 'true'/);
  assert.match(paymentHistorySource, /dataset\.inlinePaymentDates === 'true'/);
  assert.match(paymentHistorySource, /clearInlinePaymentHistory\(modalRoot\)/);
});

test('M13 monta las fechas con el mapa y las desmonta al salir', () => {
  assert.match(enhancer, /export function mountMapaPaymentDates/);
  assert.match(enhancer, /export function unmountMapaPaymentDates/);
  assert.match(enhancer, /addEventListener\(MAPA_ACCOUNT_MODAL_RENDERED_EVENT/);
  assert.match(enhancer, /removeEventListener\(MAPA_ACCOUNT_MODAL_RENDERED_EVENT/);
  assert.match(mapSource, /mountMapaPaymentDates\(\{ supabase, hotelId \}\)/);
  assert.match(mapSource, /unmountMapaPaymentDates\(\)/);
  assert.doesNotMatch(enhancer, /setInterval|POLL_MS|MutationObserver/);
});

test('las fechas se consultan por hotel y reserva y no crean movimientos', () => {
  assert.match(enhancer, /\.eq\('hotel_id', hotelId\)/);
  assert.match(enhancer, /\.eq\('reserva_id', reservationId\)/);
  assert.doesNotMatch(enhancer, /\.insert\(/);
  assert.doesNotMatch(enhancer, /\.update\(/);
  assert.doesNotMatch(enhancer, /\.delete\(/);
});

test('M13 emite el contexto conocido y elimina busquedas intermedias de habitacion y reserva', () => {
  assert.match(eventsSource, /mapaAccountModalRendered/);
  assert.match(modalsSource, /emitMapaAccountModalRendered\(\{/);
  assert.match(modalsSource, /reservationId: reserva\.id/);
  assert.doesNotMatch(enhancer, /\.from\('habitaciones'\)/);
  assert.doesNotMatch(enhancer, /\.from\('reservas'\)/);
  assert.doesNotMatch(appIndex, /\/js\/mapa-fechas-abonos-inline\.js/);
});

test('M13 consulta directamente servicios y pagos con aislamiento por hotel', async () => {
  const modulePath = path.resolve('js/mapa-fechas-abonos-inline.js');
  const { loadPaymentContext } = await import(`${pathToFileURL(modulePath).href}?m13=${Date.now()}`);
  const calls = [];
  const responses = {
    servicios_x_reserva: [{ id: 'service-1', estado_pago: 'pagado' }],
    pagos_reserva: [{ id: 'payment-1', fecha_pago: '2026-09-30T18:00:00Z' }],
  };
  const supabase = {
    from(table) {
      const call = { table, filters: [] };
      calls.push(call);
      const builder = {
        select(columns) {
          call.columns = columns;
          return builder;
        },
        eq(column, value) {
          call.filters.push({ column, value });
          return builder;
        },
        then(resolve, reject) {
          return Promise.resolve({ data: responses[table], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };

  const result = await loadPaymentContext(supabase, 'hotel-1', 'reservation-1');

  assert.deepEqual(result, {
    services: responses.servicios_x_reserva,
    payments: responses.pagos_reserva,
  });
  assert.deepEqual(calls.map((call) => call.table), ['servicios_x_reserva', 'pagos_reserva']);
  for (const call of calls) {
    assert.deepEqual(call.filters, [
      { column: 'hotel_id', value: 'hotel-1' },
      { column: 'reserva_id', value: 'reservation-1' },
    ]);
  }
});
