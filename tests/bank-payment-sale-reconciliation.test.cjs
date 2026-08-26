const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

async function loadModule() {
  return import(pathToFileURL(path.resolve('supabase/functions/_shared/bank-email/sale-reconciliation.ts')).href);
}

test('reconoce exclusivamente los metodos bancarios configurados para el piloto', async () => {
  const { isBankReconciliationPaymentMethod } = await loadModule();
  assert.equal(isBankReconciliationPaymentMethod('Bancolombia'), true);
  assert.equal(isBankReconciliationPaymentMethod(' Transferencia bancaria '), true);
  assert.equal(isBankReconciliationPaymentMethod('Llave'), true);
  assert.equal(isBankReconciliationPaymentMethod('Efectivo'), false);
  assert.equal(isBankReconciliationPaymentMethod('Tarjeta Debito/Credito'), false);
  assert.equal(isBankReconciliationPaymentMethod(null), false);
});
