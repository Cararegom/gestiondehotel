const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20261001130000_b5_drop_dead_stock_function.sql',
);
const migration = fs.readFileSync(migrationPath, 'utf8');

function collectFiles(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(entryPath, extension);
    return entry.name.endsWith(extension) ? [entryPath] : [];
  });
}

test('B5 elimina exclusivamente la firma obsoleta', () => {
  assert.match(
    migration,
    /drop\s+function\s+if\s+exists\s+public\.descontar_stock_por_venta\s*\(\s*bigint\s*,\s*uuid\s*,\s*integer\s*\)\s*;/i,
  );
  assert.doesNotMatch(migration, /\bcascade\b/i);
});

test('B5 no tiene consumidores JavaScript activos', () => {
  const javascriptFiles = collectFiles(path.join(root, 'js'), '.js');
  const consumers = javascriptFiles.filter((filePath) => (
    fs.readFileSync(filePath, 'utf8').includes('descontar_stock_por_venta')
  ));
  assert.deepEqual(consumers, []);
});

test('B5 retira la funcion al ejecutar la migracion real', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await db.exec(`
    create or replace function public.descontar_stock_por_venta(
      p_venta_item_id bigint,
      p_plato_id uuid,
      p_cantidad_vendida integer
    ) returns void
    language plpgsql
    as $$ begin null; end; $$;
  `);

  const before = await db.query(
    "select to_regprocedure('public.descontar_stock_por_venta(bigint,uuid,integer)') is not null as exists",
  );
  assert.equal(before.rows[0].exists, true);

  await db.exec(migration);

  const after = await db.query(
    "select to_regprocedure('public.descontar_stock_por_venta(bigint,uuid,integer)') is not null as exists",
  );
  assert.equal(after.rows[0].exists, false);
});
