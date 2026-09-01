const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const relationApi = fs.readFileSync('supabase/functions/bank-payment-relation-api/index.ts', 'utf8');
const bootstrap = fs.readFileSync('js/bank-payment-reception-bootstrap.js', 'utf8');

test('la API limitada de recepcion expone solo el nombre necesario del pagador', () => {
  assert.match(relationApi, /sender_name/);
  assert.match(relationApi, /senderName:\s*safeSenderName\(row\.sender_name\)/);
  assert.match(relationApi, /senderName:\s*safeSenderName\(data\.sender_name\)/);
  assert.doesNotMatch(relationApi, /sender_email.*senderName/);
  assert.doesNotMatch(relationApi, /transaction_reference.*senderName/);
});

test('Caja muestra el nombre en la lista y al confirmar la transferencia elegida', () => {
  assert.match(bootstrap, /A nombre de: \$\{escapeHtml\(transfer\.senderName \|\| 'Nombre no disponible'\)\}/);
  assert.match(bootstrap, /A nombre de: \$\{escapeHtml\(currentTransfer\.senderName \|\| 'Nombre no disponible'\)\}/);
  assert.match(bootstrap, /La referencia y el contenido del correo siguen ocultos/);
  assert.doesNotMatch(bootstrap, /no veras nombre del pagador/i);
});
