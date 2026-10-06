const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20261001120000_b4_reserva_estados_legacy_guard.sql',
);
const migration = fs.readFileSync(migrationPath, 'utf8');

const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

async function loadOperationModule() {
  const modulePath = path.join(root, 'js/modules/reservas/reservas-operacion.js');
  return import(`${pathToFileURL(modulePath).href}?b4=${Date.now()}`);
}

async function createDatabaseWithHistoricalRows() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;

    create type public.estado_reserva_enum as enum (
      'activa', 'cancelada', 'cancelada_mantenimiento', 'check_in', 'check_out',
      'completada', 'confirmada', 'facturada_pagada', 'finalizada', 'finalizada_auto',
      'no_show', 'ocupada', 'pendiente', 'reservada', 'tiempo agotado'
    );

    create table public.reservas(
      id uuid primary key,
      estado public.estado_reserva_enum not null,
      notas text
    );

    insert into public.reservas(id, estado, notas)
    values ('${id(1)}', 'check_in', 'fila historica');
  `);
  await db.exec(migration);
  return db;
}

test('B4 separa estados canonicos de los estados heredados del enum', async () => {
  const operation = await loadOperationModule();

  assert.deepEqual(operation.RESERVA_CANONICAL_OPERATIONAL_STATES, [
    'pendiente', 'reservada', 'confirmada', 'activa', 'ocupada',
  ]);
  assert.deepEqual(operation.RESERVA_LEGACY_STATES, [
    'check_in', 'tiempo agotado', 'facturada_pagada', 'check_out',
  ]);

  for (const state of operation.RESERVA_LEGACY_STATES) {
    assert.equal(operation.RESERVA_WRITABLE_STATES.includes(state), false);
    assert.equal(operation.RESERVA_VISIBLE_STATES.includes(state), true);
    assert.equal(operation.isLegacyReservaState(state), true);
  }

  for (const state of operation.RESERVA_LEGACY_OPERATIONAL_STATES) {
    assert.equal(operation.RESERVA_CONFLICT_STATES.includes(state), true);
  }
});

test('B4 permite estados canonicos y rechaza nuevas escrituras legacy', async (t) => {
  const db = await createDatabaseWithHistoricalRows();
  t.after(() => db.close());

  await db.query(
    'insert into public.reservas(id, estado, notas) values ($1, $2, $3)',
    [id(2), 'reservada', 'canonica'],
  );

  for (const [index, state] of ['check_in', 'check_out', 'facturada_pagada', 'tiempo agotado'].entries()) {
    await assert.rejects(
      () => db.query(
        'insert into public.reservas(id, estado, notas) values ($1, $2, $3)',
        [id(index + 10), state, 'rechazada'],
      ),
      /B4_ESTADO_RESERVA_LEGACY_NO_ESCRIBIBLE/,
    );
  }

  await assert.rejects(
    () => db.query('update public.reservas set estado = $1 where id = $2', ['check_out', id(2)]),
    /B4_ESTADO_RESERVA_LEGACY_NO_ESCRIBIBLE/,
  );
});

test('B4 conserva filas historicas y permite normalizarlas a un estado canonico', async (t) => {
  const db = await createDatabaseWithHistoricalRows();
  t.after(() => db.close());

  await db.query('update public.reservas set notas = $1 where id = $2', ['actualizada', id(1)]);
  const historical = await db.query('select estado, notas from public.reservas where id = $1', [id(1)]);
  assert.deepEqual(historical.rows[0], { estado: 'check_in', notas: 'actualizada' });

  await db.query('update public.reservas set estado = $1 where id = $2', ['activa', id(1)]);
  const normalized = await db.query('select estado from public.reservas where id = $1', [id(1)]);
  assert.equal(normalized.rows[0].estado, 'activa');
});

test('B4 deja el guard centralizado y sin ejecucion publica', async (t) => {
  const db = await createDatabaseWithHistoricalRows();
  t.after(() => db.close());

  const privileges = await db.query(`
    select
      has_function_privilege('anon', 'public.reserva_estado_es_legacy(public.estado_reserva_enum)', 'execute') as anon_helper,
      has_function_privilege('authenticated', 'public.reserva_estado_es_legacy(public.estado_reserva_enum)', 'execute') as authenticated_helper,
      has_function_privilege('anon', 'public.b4_rechazar_estado_reserva_legacy()', 'execute') as anon_trigger,
      has_function_privilege('authenticated', 'public.b4_rechazar_estado_reserva_legacy()', 'execute') as authenticated_trigger,
      has_function_privilege('service_role', 'public.b4_rechazar_estado_reserva_legacy()', 'execute') as service_trigger
  `);
  assert.deepEqual(privileges.rows[0], {
    anon_helper: false,
    authenticated_helper: true,
    anon_trigger: false,
    authenticated_trigger: false,
    service_trigger: true,
  });

  assert.match(migration, /before insert or update of estado on public\.reservas/i);
  assert.match(migration, /new\.estado is distinct from old\.estado/i);
  assert.doesNotMatch(migration, /alter\s+type[\s\S]+rename|drop\s+type/i);
});
