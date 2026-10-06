const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const posSource = fs.readFileSync(path.join(root, 'js/modules/tienda/pos.js'), 'utf8');
const categoriesSource = fs.readFileSync(path.join(root, 'js/modules/tienda/categorias.js'), 'utf8');
const inventorySource = fs.readFileSync(path.join(root, 'js/modules/tienda/inventario.js'), 'utf8');
const rlsSource = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260827070843_pre_fase14_tenant_policy_cleanup.sql'),
  'utf8',
);
const baselineSource = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260326191500_baseline_public_schema.sql'),
  'utf8',
);

function extractFunction(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `no se encontro ${startMarker}`);
  assert.notEqual(end, -1, `no se encontro ${endMarker}`);
  return source.slice(start, end);
}

test('B6 acota la lectura de categorias del POS al hotel activo', () => {
  const cargarDatosPOS = extractFunction(
    posSource,
    'export async function cargarDatosPOS()',
    'export async function renderPOS()',
  );
  assert.match(
    cargarDatosPOS,
    /from\('categorias_producto'\)[\s\S]*?select\('id, nombre'\)[\s\S]*?eq\('hotel_id', tiendaState\.currentHotelId\)/,
  );
});

test('B6 mantiene el mismo filtro en las otras lecturas de categorias de Tienda', () => {
  assert.match(
    categoriesSource,
    /from\('categorias_producto'\)[\s\S]*?select\('\*'\)[\s\S]*?eq\('hotel_id', tiendaState\.currentHotelId\)/,
  );
  assert.match(
    inventorySource,
    /from\('categorias_producto'\)\.select\('id, nombre'\)\.eq\('hotel_id', tiendaState\.currentHotelId\)/,
  );
});

test('B6 conserva RLS tenant-safe como segunda barrera', () => {
  assert.match(
    baselineSource,
    /alter table "public"\."categorias_producto" enable row level security/i,
  );
  assert.match(
    rlsSource,
    /on public\.categorias_producto[\s\S]*?public\.fase1_actor_es_miembro_activo\(hotel_id\)/i,
  );
});
