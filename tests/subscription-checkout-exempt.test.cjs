const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const checkout = fs.readFileSync(
  path.resolve(__dirname, '../supabase/functions/billing-create-checkout/index.ts'),
  'utf8'
);

test('billing-create-checkout consulta la exención y rechaza cobros internos', () => {
  assert.match(checkout, /suscripcion_exenta/);
  assert.match(checkout, /hotel\.suscripcion_exenta === true/);
  assert.match(checkout, /SUBSCRIPTION_EXEMPT/);
  assert.match(checkout, /exenta de cobro y no requiere renovación/);
});
