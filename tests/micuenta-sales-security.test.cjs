const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const miCuenta = fs.readFileSync(path.join(root, 'js/modules/micuenta/micuenta.js'), 'utf8');
const checkout = fs.readFileSync(path.join(root, 'supabase/functions/billing-create-checkout/index.ts'), 'utf8');

test('Mi Cuenta vende desde el uso real y muestra ahorro anual sin inventar popularidad', () => {
  assert.match(miCuenta, /findRecommendedUpgrade/);
  assert.match(miCuenta, /Recomendación basada en tu uso/);
  assert.match(miCuenta, /Uso actual de tu plan/);
  assert.match(miCuenta, /Anual = pagas 10 meses y recibes 12/);
  assert.doesNotMatch(miCuenta, /más vendido|más elegido/i);
});

test('Mi Cuenta escapa contenido dinámico y usa reset por correo para contraseña', () => {
  assert.match(miCuenta, /function escapeHtml/);
  assert.match(miCuenta, /resetPasswordForEmail\(user\.email/);
  assert.doesNotMatch(miCuenta, /updateUser\(\{ password:/);
});

test('billing-create-checkout valida identidad, pertenencia y rol antes de usar service role', () => {
  assert.match(checkout, /auth\.getUser\(token\)/);
  assert.match(checkout, /select\('id, hotel_id, rol'\)/);
  assert.match(checkout, /belongsToHotel/);
  assert.match(checkout, /roleCanManage/);
  assert.match(checkout, /isCreator/);
  assert.match(checkout, /not authorized to manage this hotel subscription/);
});

test('checkout toma el correo del usuario autenticado y restringe URLs de retorno', () => {
  assert.match(checkout, /authUser\.email/);
  assert.match(checkout, /safeReturnUrl/);
  assert.match(checkout, /ALLOWED_ORIGINS\.has\(url\.origin\)/);
  assert.doesNotMatch(checkout, /sanitizeString\(payload\?\.userEmail/);
});
