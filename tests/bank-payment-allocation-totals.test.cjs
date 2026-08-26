const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

async function loadTotals() {
  return import(pathToFileURL(path.resolve('supabase/functions/_shared/bank-email/allocation-totals.ts')).href);
}

test('una transferencia dividida acredita a la reserva solo su allocation', async () => {
  const { committedReservationTotals } = await loadTotals();
  const eventId = '11111111-1111-4111-8111-111111111111';
  const totals = committedReservationTotals([
    { payment_event_id: eventId, reservation_id: 'reserva-a', amount_cop: 60000 },
    { payment_event_id: eventId, reservation_id: null, amount_cop: 20000 },
    { payment_event_id: eventId, reservation_id: null, amount_cop: 20000 }
  ], new Set([eventId]));

  assert.equal(totals.get('reserva-a'), 60000);
});

test('ignora allocations de eventos no comprometidos y montos invalidos', async () => {
  const { committedReservationTotals } = await loadTotals();
  const totals = committedReservationTotals([
    { payment_event_id: 'pendiente', reservation_id: 'reserva-a', amount_cop: 90000 },
    { payment_event_id: 'confirmado', reservation_id: 'reserva-a', amount_cop: -1 },
    { payment_event_id: 'confirmado', reservation_id: 'reserva-a', amount_cop: 40000 }
  ], new Set(['confirmado']));

  assert.equal(totals.get('reserva-a'), 40000);
});
