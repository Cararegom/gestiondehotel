const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('las consultas CRM usan solamente columnas existentes', () => {
  const source = fs.readFileSync(path.join(root, 'js/modules/clientes/clientes.js'), 'utf8');

  assert.match(source, /from\('ventas'\)\.select\('cliente_id, total, fecha_venta'\)/);
  assert.match(source, /from\('ventas_tienda'\)\.select\('cliente_id, total_venta, fecha, creado_en'\)/);
  assert.match(source, /from\('ventas_restaurante'\)\.select\('cliente_id, monto_total, total_venta, fecha_venta, fecha, creado_en'\)/);
  assert.doesNotMatch(source, /from\('ventas'\)\.select\('[^']*creado_en/);
  assert.doesNotMatch(source, /from\('ventas_tienda'\)\.select\('[^']*\btotal,/);
  assert.doesNotMatch(source, /from\('ventas_restaurante'\)\.select\('[^']*\btotal,/);
});

test('el agregador CRM tolera colecciones nulas', async () => {
  const source = fs.readFileSync(path.join(root, 'js/services/crmCommercialService.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const { buildClientCommercialInsights } = await import(moduleUrl);

  assert.deepEqual(buildClientCommercialInsights(), {});
  assert.deepEqual(buildClientCommercialInsights({
    clientes: null,
    reservas: null,
    ventas: null,
    ventasTienda: null,
    ventasRestaurante: null,
    actividades: null
  }), {});
});
