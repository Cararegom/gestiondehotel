const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

async function loadModule() {
  return import(pathToFileURL(path.resolve('supabase/functions/_shared/bank-email/sale-capacity.ts')).href);
}

test('descuenta allocations activas de otros eventos y permite reabrir el actual', async () => {
  const { activeSaleAllocationTotals, saleAvailableAmount } = await loadModule();
  const allocations = [
    { payment_event_id: 'evento-a', sale_type: 'tienda', sale_id: 'venta-1', amount_cop: 4000 },
    { payment_event_id: 'evento-b', sale_type: 'tienda', sale_id: 'venta-1', amount_cop: 6000 },
    { payment_event_id: 'pendiente', sale_type: 'tienda', sale_id: 'venta-1', amount_cop: 9999 }
  ];
  const totals = activeSaleAllocationTotals(allocations, new Set(['evento-a', 'evento-b']), 'evento-b');
  assert.equal(totals.get('tienda:venta-1'), 4000);
  assert.equal(saleAvailableAmount(10000, totals.get('tienda:venta-1')), 6000);
});

test('una venta totalmente conciliada queda sin saldo', async () => {
  const { saleAvailableAmount } = await loadModule();
  assert.equal(saleAvailableAmount(10000, 10000), 0);
  assert.equal(saleAvailableAmount(10000, 12000), 0);
});
