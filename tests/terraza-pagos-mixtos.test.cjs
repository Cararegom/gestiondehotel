const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('Terraza conserva pagos mixtos, reserva y cantidades editables', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260705190000_terraza_pagos_mixtos.sql'),
    'utf8'
  );
  const cobros = fs.readFileSync(path.join(root, 'js/modules/terraza/terraza-cobros.js'), 'utf8');
  const mapa = fs.readFileSync(path.join(root, 'js/modules/terraza/terraza-mapa.js'), 'utf8');
  const historial = fs.readFileSync(path.join(root, 'js/modules/terraza/terraza-historial.js'), 'utf8');

  assert.match(migration, /cerrar_pedido_terraza_mixto/);
  assert.match(migration, /jsonb_array_elements\(p_pagos\)/);
  assert.match(migration, /pagos_mixtos = p_pagos/);
  assert.match(cobros, /collectMixedPayments/);
  assert.match(cobros, /p_pagos: pagosMixtos/);
  assert.match(mapa, /data-item-quantity/);
  assert.match(historial, /Reservada por:/);
});

