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
  const terraza = fs.readFileSync(path.join(root, 'js/modules/terraza/terraza.js'), 'utf8');
  const mapa = fs.readFileSync(path.join(root, 'js/modules/terraza/terraza-mapa.js'), 'utf8');
  const historial = fs.readFileSync(path.join(root, 'js/modules/terraza/terraza-historial.js'), 'utf8');
  const inventario = fs.readFileSync(path.join(root, 'js/modules/terraza/terraza-inventario.js'), 'utf8');
  const listaCompra = fs.readFileSync(path.join(root, 'js/modules/terraza/terraza-lista-compras.js'), 'utf8');
  const pedidos = fs.readFileSync(path.join(root, 'js/modules/terraza/terraza-pedidos.js'), 'utf8');
  const menuPublico = fs.readFileSync(path.join(root, 'js/public/menu-terraza.js'), 'utf8');

  assert.match(migration, /cerrar_pedido_terraza_mixto/);
  assert.match(migration, /jsonb_array_elements\(p_pagos\)/);
  assert.match(migration, /pagos_mixtos = p_pagos/);
  assert.match(cobros, /collectMixedPayments/);
  assert.match(cobros, /p_pagos: pagosMixtos/);
  assert.match(mapa, /data-item-quantity/);
  assert.match(historial, /Reservada por:/);
  assert.match(inventario, /data-action="print-inventory"/);
  assert.match(inventario, /productosActivos = state\.productos\.filter\(\(producto\) => producto\.activo !== false\)/);
  assert.match(terraza, /state\.isAdmin \? \[\{ id: 'inventario', label: 'Inventario' \}\] : \[\]/);
  assert.match(terraza, /\{ id: 'lista-compra', label: 'Lista de compra' \}/);
  assert.match(terraza, /renderListaCompraTab/);
  assert.match(listaCompra, /renderListaCompraTab/);
  assert.match(listaCompra, /item\.disponible < item\.stockMinimo/);
  assert.match(listaCompra, /sugerido: Math\.max\(0, stockMinimo - disponible\)/);
  assert.match(listaCompra, /exportListaCompraExcel/);
  assert.match(terraza, /data-action="print-inventory"/);
  assert.match(mapa, /state\.isAdmin \? `<button class="rounded-lg border border-slate-200 px-2 py-1/);
  assert.match(pedidos, /product\.activo === false/);
  assert.match(menuPublico, /filter\(\(product\) => product\?\.activo !== false\)/);
});

