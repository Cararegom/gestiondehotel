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
  '20260921130000_m5_cierre_metodos_inactivos.sql',
);
const migration = fs.readFileSync(migrationPath, 'utf8');
const cierreSource = fs.readFileSync(path.join(root, 'js/modules/caja/caja-cierre.js'), 'utf8');
const turnosSource = fs.readFileSync(path.join(root, 'js/modules/caja/caja-turnos.js'), 'utf8');

const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const ids = {
  hotel: id(1),
  actor: id(2),
  turno: id(3),
  cash: id(10),
  card: id(11),
  inactiveBank: id(12),
  foreignMethod: id(13),
  inactiveUnused: id(14),
  operation: id(20),
};

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;

    create table public.usuarios(
      id uuid primary key,
      hotel_id uuid not null,
      activo boolean not null default true
    );
    create table public.metodos_pago(
      id uuid primary key,
      hotel_id uuid not null,
      nombre text not null,
      activo boolean not null default true
    );
    create table public.turnos(
      id uuid primary key,
      hotel_id uuid not null,
      usuario_id uuid not null,
      estado text not null default 'abierto',
      fecha_apertura timestamptz not null default now(),
      fecha_cierre timestamptz,
      balance_final numeric
    );
    create table public.caja(
      id uuid primary key default gen_random_uuid(),
      hotel_id uuid not null,
      turno_id uuid not null,
      metodo_pago_id uuid,
      tipo text not null,
      monto numeric not null
    );
    create table public.turno_arqueos(
      id uuid primary key default gen_random_uuid(),
      turno_id uuid not null,
      hotel_id uuid not null,
      metodo_pago_id uuid not null,
      expected_amount numeric not null,
      counted_amount numeric not null,
      difference numeric generated always as (counted_amount - expected_amount) stored,
      note text,
      counted_by uuid not null,
      counted_at timestamptz not null default now(),
      approved_by uuid,
      client_operation_id uuid not null,
      unique(turno_id, metodo_pago_id),
      unique(hotel_id, client_operation_id, metodo_pago_id)
    );
    create table public.auditoria_operaciones(
      id uuid primary key default gen_random_uuid(),
      hotel_id uuid not null,
      actor_id uuid not null,
      accion text not null,
      entidad text not null,
      entity_id uuid,
      before_data jsonb,
      after_data jsonb,
      reason text,
      client_operation_id uuid
    );

    create function public.fase1_actor_es_miembro_activo(p_hotel_id uuid)
    returns boolean language sql stable security definer
    set search_path = pg_catalog, public as $$
      select auth.uid() is not null and exists (
        select 1 from public.usuarios u
        where u.id = auth.uid() and u.hotel_id = p_hotel_id and u.activo is true
      )
    $$;
    create function public.fase1_actor_tiene_permiso(p_hotel_id uuid, p_permiso text)
    returns boolean language sql stable security definer
    set search_path = pg_catalog, public as $$ select false $$;
    create function public.fase1_business_date(p_instant timestamptz)
    returns date language sql stable
    set search_path = pg_catalog, public as $$ select p_instant::date $$;

    insert into public.usuarios(id, hotel_id, activo)
      values ('${ids.actor}', '${ids.hotel}', true);
    insert into public.metodos_pago(id, hotel_id, nombre, activo) values
      ('${ids.cash}', '${ids.hotel}', 'Efectivo', true),
      ('${ids.card}', '${ids.hotel}', 'Tarjeta', true),
      ('${ids.inactiveBank}', '${ids.hotel}', 'Transferencia anterior', false),
      ('${ids.foreignMethod}', '${id(99)}', 'Metodo ajeno', true);
  `);
  await db.exec(migration);
  return db;
}

async function seedOpenShift(db, { withoutMethod = false } = {}) {
  const bankMethodSql = withoutMethod ? 'null' : `'${ids.inactiveBank}'`;
  await db.exec(`
    insert into public.turnos(id, hotel_id, usuario_id, estado)
      values ('${ids.turno}', '${ids.hotel}', '${ids.actor}', 'abierto');
    insert into public.caja(hotel_id, turno_id, metodo_pago_id, tipo, monto) values
      ('${ids.hotel}', '${ids.turno}', '${ids.cash}', 'apertura', 100000),
      ('${ids.hotel}', '${ids.turno}', ${bankMethodSql}, 'ingreso', 50000);
  `);
}

async function asActor(db, action) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.actor })]);
    await db.exec('set local role authenticated');
    const result = await action();
    await db.exec('commit');
    return result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

async function closeShift(db, arqueos, operationId = ids.operation) {
  return asActor(db, async () => {
    const result = await db.query(
      'select public.cerrar_turno_con_arqueo($1, $2::jsonb, $3, $4, null) as result',
      [ids.turno, JSON.stringify(arqueos), operationId, '2026-09-21T18:00:00Z'],
    );
    return result.rows[0].result;
  });
}

function completeArqueo(overrides = {}) {
  return [
    { metodo_pago_id: ids.cash, counted_amount: overrides.cash ?? 100000 },
    { metodo_pago_id: ids.card, counted_amount: overrides.card ?? 0 },
    { metodo_pago_id: ids.inactiveBank, counted_amount: overrides.inactiveBank ?? 50000 },
  ];
}

test('M5 exige el metodo inactivo usado y conserva el turno abierto si falta', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await seedOpenShift(db);

  await assert.rejects(
    () => closeShift(db, completeArqueo().filter((item) => item.metodo_pago_id !== ids.inactiveBank)),
    /M5_ARQUEO_INCOMPLETO/,
  );

  const state = await db.query(`
    select estado, fecha_cierre, balance_final,
      (select count(*)::integer from public.turno_arqueos) as arqueos
    from public.turnos where id = $1
  `, [ids.turno]);
  assert.deepEqual(state.rows[0], {
    estado: 'abierto',
    fecha_cierre: null,
    balance_final: null,
    arqueos: 0,
  });
});

test('M5 persiste activos y usados, incluido el inactivo, y calcula el balance contado', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await seedOpenShift(db);

  const result = await closeShift(db, completeArqueo({ cash: 99000, inactiveBank: 49000 }));
  assert.equal(Number(result.balance_final), 148000);
  assert.equal(Number(result.metodos_arqueados), 3);

  const rows = await db.query(`
    select metodo_pago_id, expected_amount, counted_amount, difference
    from public.turno_arqueos
    order by metodo_pago_id
  `);
  assert.deepEqual(rows.rows.map((row) => ({
    ...row,
    expected_amount: Number(row.expected_amount),
    counted_amount: Number(row.counted_amount),
    difference: Number(row.difference),
  })), [
    { metodo_pago_id: ids.cash, expected_amount: 100000, counted_amount: 99000, difference: -1000 },
    { metodo_pago_id: ids.card, expected_amount: 0, counted_amount: 0, difference: 0 },
    { metodo_pago_id: ids.inactiveBank, expected_amount: 50000, counted_amount: 49000, difference: -1000 },
  ]);

  const shift = await db.query('select estado, balance_final from public.turnos where id = $1', [ids.turno]);
  assert.equal(shift.rows[0].estado, 'cerrado');
  assert.equal(Number(shift.rows[0].balance_final), 148000);
});

test('M5 rechaza metodos duplicados, ajenos y movimientos financieros sin metodo', async (t) => {
  await t.test('metodo duplicado', async (subtest) => {
    const db = await createDatabase();
    subtest.after(() => db.close());
    await seedOpenShift(db);
    await assert.rejects(
      () => closeShift(db, [...completeArqueo(), { metodo_pago_id: ids.cash, counted_amount: 0 }]),
      /M5_METODO_DUPLICADO/,
    );
  });

  await t.test('metodo de otro hotel', async (subtest) => {
    const db = await createDatabase();
    subtest.after(() => db.close());
    await seedOpenShift(db);
    await assert.rejects(
      () => closeShift(db, [...completeArqueo(), { metodo_pago_id: ids.foreignMethod, counted_amount: 0 }]),
      /M5_METODO_INVALIDO/,
    );
  });

  await t.test('movimiento sin metodo', async (subtest) => {
    const db = await createDatabase();
    subtest.after(() => db.close());
    await seedOpenShift(db, { withoutMethod: true });
    await assert.rejects(
      () => closeShift(db, completeArqueo()),
      /M5_MOVIMIENTO_SIN_METODO/,
    );
  });
});

test('M5 une metodos activos con los usados y conserva conteos por UUID en frontend', async () => {
  const moduleUrl = `${pathToFileURL(path.join(root, 'js/modules/caja/caja-cierre.js')).href}?m5=${Date.now()}`;
  const { combinarMetodosPagoParaArqueo, obtenerValorArqueo } = await import(moduleUrl);

  const methods = combinarMetodosPagoParaArqueo(
    [
      { id: ids.cash, nombre: 'Efectivo', activo: true },
      { id: ids.card, nombre: 'Tarjeta', activo: true },
      { id: ids.inactiveBank, nombre: 'Transferencia anterior', activo: false },
      { id: ids.inactiveUnused, nombre: 'Convenio antiguo', activo: false },
    ],
    [
      {
        tipo: 'ingreso',
        metodo_pago_id: ids.inactiveBank,
        metodos_pago: { id: ids.inactiveBank, nombre: 'Transferencia anterior', activo: false },
      },
    ],
  );

  assert.deepEqual(new Set(methods.map((method) => method.id)), new Set([ids.cash, ids.card, ids.inactiveBank]));
  assert.equal(methods.some((method) => method.id === ids.inactiveUnused), false);
  assert.equal(methods.find((method) => method.id === ids.inactiveBank).activo, false);
  assert.equal(obtenerValorArqueo({ [ids.inactiveBank]: 50000 }, methods.find((method) => method.id === ids.inactiveBank)), 50000);

  assert.match(cierreSource, /valoresReales\[metodo\.id\]\s*=\s*valor/);
  assert.match(cierreSource, /metodos_pago\(id, nombre, activo\)/);
  assert.match(turnosSource, /combinarMetodosPagoParaArqueo\(metodosDisponibles, movimientos\)/);
  assert.match(turnosSource, /counted_amount:\s*obtenerValorArqueo\(valoresReales, metodo\)/);
  assert.ok(
    turnosSource.indexOf("rpc('cerrar_turno_con_arqueo'") < turnosSource.indexOf('await enviarReporteCierreCaja'),
    'el reporte debe enviarse despues de confirmar el cierre',
  );
});
