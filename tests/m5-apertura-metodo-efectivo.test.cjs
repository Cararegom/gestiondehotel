const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const cierreMigration = fs.readFileSync(
  path.join(migrationsDir, '20260921130000_m5_cierre_metodos_inactivos.sql'),
  'utf8',
);
const aperturaMigration = fs.readFileSync(
  path.join(migrationsDir, '20261005220000_m5_apertura_turno_metodo_efectivo.sql'),
  'utf8',
);
const turnosSource = fs.readFileSync(path.join(root, 'js/modules/caja/caja-turnos.js'), 'utf8');

const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const ids = {
  hotelA: id(1),
  hotelB: id(2),
  hotelSinEfectivo: id(3),
  actorA: id(10),
  actorB: id(11),
  actorSinEfectivo: id(12),
  cashA: id(20),
  bancolombiaA: id(21),
  cashB: id(22),
  bancolombiaB: id(23),
  tarjetaSinEfectivo: id(24),
  legacyOpenA: id(30),
  legacyClosedA: id(31),
  legacyOpenSinEfectivo: id(32),
};

const schemaSql = `
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$
    select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create type public.tipo_movimiento_caja_enum as enum ('ajuste', 'apertura', 'cierre', 'egreso', 'ingreso');

  create table public.usuarios(
    id uuid primary key,
    hotel_id uuid not null,
    activo boolean not null default true
  );
  create table public.financial_accounts(
    id uuid primary key default gen_random_uuid(),
    hotel_id uuid not null,
    name text not null,
    unique(hotel_id, name)
  );
  create table public.metodos_pago(
    id uuid primary key,
    hotel_id uuid not null,
    nombre text not null,
    activo boolean default true,
    financial_account_id uuid references public.financial_accounts(id),
    unique(hotel_id, nombre)
  );
  create table public.turnos(
    id uuid primary key default gen_random_uuid(),
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
    tipo public.tipo_movimiento_caja_enum not null,
    monto numeric not null,
    concepto text not null,
    fecha_movimiento timestamptz default now(),
    metodo_pago_id uuid references public.metodos_pago(id),
    usuario_id uuid,
    turno_id uuid references public.turnos(id),
    creado_en timestamptz default now(),
    client_operation_id uuid,
    source text,
    business_date date
  );
  create table public.account_movements(
    id uuid primary key default gen_random_uuid(),
    hotel_id uuid not null,
    account_id uuid not null references public.financial_accounts(id),
    direction text not null check (direction in ('in', 'out')),
    amount numeric not null,
    occurred_at timestamptz not null,
    business_date date not null,
    description text,
    source text not null,
    caja_id uuid unique references public.caja(id),
    metodo_pago_id uuid,
    turno_id uuid,
    created_by uuid,
    client_operation_id uuid
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
    unique(turno_id, metodo_pago_id)
  );
  create table public.auditoria_operaciones(
    id uuid primary key default gen_random_uuid(),
    hotel_id uuid not null,
    actor_id uuid not null references public.usuarios(id),
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
  returns date language sql stable set search_path = pg_catalog, public as $$ select p_instant::date $$;
  create function public.hotel_business_date(p_hotel_id uuid, p_instant timestamptz)
  returns date language sql stable set search_path = pg_catalog, public as $$ select p_instant::date $$;

  create function public.fase2_ensure_method_account(p_method_id uuid, p_hotel_id uuid, p_actor uuid)
  returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
  declare v_method public.metodos_pago%rowtype; v_account uuid;
  begin
    select * into v_method from public.metodos_pago where id = p_method_id and hotel_id = p_hotel_id for update;
    if not found then raise exception 'Metodo de pago fuera del hotel' using errcode = '42501'; end if;
    if v_method.financial_account_id is not null then return v_method.financial_account_id; end if;
    insert into public.financial_accounts(hotel_id, name) values (p_hotel_id, 'Cuenta ' || v_method.nombre)
    on conflict(hotel_id, name) do update set name = excluded.name returning id into v_account;
    update public.metodos_pago set financial_account_id = v_account where id = v_method.id;
    return v_account;
  end $$;

  -- Version previa del trigger: el AFTER INSERT ya existe en produccion.
  create function public.fase2_project_caja_to_account()
  returns trigger language plpgsql as $$ begin return NEW; end $$;
  create trigger fase2_project_caja_to_account_trg after insert on public.caja
  for each row execute function public.fase2_project_caja_to_account();
`;

const seedSql = `
  insert into public.usuarios(id, hotel_id) values
    ('${ids.actorA}', '${ids.hotelA}'),
    ('${ids.actorB}', '${ids.hotelB}'),
    ('${ids.actorSinEfectivo}', '${ids.hotelSinEfectivo}');
  insert into public.metodos_pago(id, hotel_id, nombre, activo) values
    ('${ids.cashA}', '${ids.hotelA}', 'Efectivo', true),
    ('${ids.bancolombiaA}', '${ids.hotelA}', 'Bancolombia', true),
    ('${ids.cashB}', '${ids.hotelB}', ' efectivo ', true),
    ('${ids.bancolombiaB}', '${ids.hotelB}', 'Transferencia', true),
    ('${ids.tarjetaSinEfectivo}', '${ids.hotelSinEfectivo}', 'Tarjeta', true);
`;

// Turnos con aperturas creadas por la version defectuosa (antes de la migracion).
const legacySql = `
  insert into public.turnos(id, hotel_id, usuario_id, estado, fecha_cierre) values
    ('${ids.legacyOpenA}', '${ids.hotelA}', '${ids.actorA}', 'abierto', null),
    ('${ids.legacyClosedA}', '${ids.hotelA}', '${ids.actorA}', 'cerrado', now()),
    ('${ids.legacyOpenSinEfectivo}', '${ids.hotelSinEfectivo}', '${ids.actorSinEfectivo}', 'abierto', null);
  insert into public.caja(hotel_id, usuario_id, turno_id, tipo, concepto, monto, source) values
    ('${ids.hotelA}', '${ids.actorA}', '${ids.legacyOpenA}', 'apertura', 'Apertura de caja', 120000, 'shift_open'),
    ('${ids.hotelA}', '${ids.actorA}', '${ids.legacyOpenA}', 'ingreso', 'Ingreso legado sin metodo', 5000, 'manual_cash'),
    ('${ids.hotelA}', '${ids.actorA}', '${ids.legacyClosedA}', 'apertura', 'Apertura de caja', 80000, 'shift_open'),
    ('${ids.hotelSinEfectivo}', '${ids.actorSinEfectivo}', '${ids.legacyOpenSinEfectivo}', 'apertura', 'Apertura de caja', 50000, 'shift_open');
`;

async function createDatabase({ legacy = false } = {}) {
  const db = new PGlite();
  await db.exec(schemaSql);
  await db.exec(seedSql);
  await db.exec(cierreMigration);
  if (legacy) await db.exec(legacySql);
  await db.exec(aperturaMigration);
  return db;
}

async function asActor(db, actorId, action) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: actorId })]);
    await db.exec('set local role authenticated');
    const result = await action();
    await db.exec('commit');
    return result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

async function abrirTurno(db, hotelId, actorId, monto = 120000) {
  return asActor(db, actorId, async () => {
    const result = await db.query(
      'select public.abrir_turno_con_apertura($1, $2, $3, $4) as turno',
      [hotelId, actorId, monto, '2026-10-05T12:00:00Z'],
    );
    return result.rows[0].turno;
  });
}

async function cerrarTurno(db, turnoId, actorId, arqueos, operationId = id(900)) {
  return asActor(db, actorId, async () => {
    const result = await db.query(
      'select public.cerrar_turno_con_arqueo($1, $2::jsonb, $3, $4, null) as result',
      [turnoId, JSON.stringify(arqueos), operationId, '2026-10-05T20:00:00Z'],
    );
    return result.rows[0].result;
  });
}

async function registrarMovimiento(db, { hotelId, actorId, turnoId, tipo, monto, metodo }) {
  const result = await db.query(
    `insert into public.caja(hotel_id, usuario_id, turno_id, tipo, concepto, monto, metodo_pago_id, source)
     values ($1, $2, $3, $4, $5, $6, $7, 'manual_cash') returning id`,
    [hotelId, actorId, turnoId, tipo, `Prueba ${tipo}`, monto, metodo],
  );
  return result.rows[0].id;
}

async function aperturaDe(db, turnoId) {
  const result = await db.query(
    `select id, tipo::text as tipo, concepto, monto, metodo_pago_id, source, business_date, usuario_id, hotel_id
       from public.caja where turno_id = $1 and tipo = 'apertura'`,
    [turnoId],
  );
  return result.rows;
}

test('1-4, 8: apertura en Efectivo, ingresos/egreso, cierre correcto y ledger sin duplicados', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const turno = await abrirTurno(db, ids.hotelA, ids.actorA, 120000);
  const aperturas = await aperturaDe(db, turno.id);
  assert.equal(aperturas.length, 1, 'una sola apertura por turno');
  assert.deepEqual(
    { ...aperturas[0], id: undefined, monto: Number(aperturas[0].monto), business_date: undefined },
    {
      id: undefined,
      tipo: 'apertura',
      concepto: 'Apertura de caja',
      monto: 120000,
      metodo_pago_id: ids.cashA,
      source: 'shift_open',
      business_date: undefined,
      usuario_id: ids.actorA,
      hotel_id: ids.hotelA,
    },
  );
  assert.ok(aperturas[0].business_date, 'business_date se conserva');

  const base = { hotelId: ids.hotelA, actorId: ids.actorA, turnoId: turno.id };
  await registrarMovimiento(db, { ...base, tipo: 'ingreso', monto: 50000, metodo: ids.cashA });
  await registrarMovimiento(db, { ...base, tipo: 'ingreso', monto: 80000, metodo: ids.bancolombiaA });
  await registrarMovimiento(db, { ...base, tipo: 'egreso', monto: 20000, metodo: ids.cashA });

  const result = await cerrarTurno(db, turno.id, ids.actorA, [
    { metodo_pago_id: ids.cashA, counted_amount: 150000 },
    { metodo_pago_id: ids.bancolombiaA, counted_amount: 80000 },
  ]);
  assert.equal(result.idempotent, false);
  assert.equal(Number(result.balance_final), 230000);

  const arqueos = await db.query(
    'select metodo_pago_id, expected_amount from public.turno_arqueos where turno_id = $1 order by metodo_pago_id',
    [turno.id],
  );
  assert.deepEqual(
    arqueos.rows.map((row) => [row.metodo_pago_id, Number(row.expected_amount)]),
    [[ids.cashA, 150000], [ids.bancolombiaA, 80000]],
    'Efectivo esperado = apertura + ingreso efectivo - egreso',
  );

  const estado = await db.query('select estado from public.turnos where id = $1', [turno.id]);
  assert.equal(estado.rows[0].estado, 'cerrado');

  const ledger = await db.query(`
    select c.tipo::text as tipo, count(m.id)::int as asientos, max(m.direction) as direction
      from public.caja c
      left join public.account_movements m on m.caja_id = c.id
     where c.turno_id = $1
     group by c.id, c.tipo
     order by c.tipo, max(m.amount)
  `, [turno.id]);
  assert.deepEqual(ledger.rows, [
    { tipo: 'apertura', asientos: 0, direction: null },
    { tipo: 'egreso', asientos: 1, direction: 'out' },
    { tipo: 'ingreso', asientos: 1, direction: 'in' },
    { tipo: 'ingreso', asientos: 1, direction: 'in' },
  ]);
});

test('5: M5_MOVIMIENTO_SIN_METODO sigue bloqueando un ingreso realmente sin metodo', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const turno = await abrirTurno(db, ids.hotelA, ids.actorA);
  await registrarMovimiento(db, {
    hotelId: ids.hotelA, actorId: ids.actorA, turnoId: turno.id, tipo: 'ingreso', monto: 10000, metodo: null,
  });

  await assert.rejects(
    () => cerrarTurno(db, turno.id, ids.actorA, [
      { metodo_pago_id: ids.cashA, counted_amount: 120000 },
      { metodo_pago_id: ids.bancolombiaA, counted_amount: 0 },
    ]),
    /M5_MOVIMIENTO_SIN_METODO/,
  );
  const estado = await db.query('select estado from public.turnos where id = $1', [turno.id]);
  assert.equal(estado.rows[0].estado, 'abierto');
});

test('6: cada hotel usa su propio Efectivo', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const turnoA = await abrirTurno(db, ids.hotelA, ids.actorA);
  const turnoB = await abrirTurno(db, ids.hotelB, ids.actorB);
  assert.equal((await aperturaDe(db, turnoA.id))[0].metodo_pago_id, ids.cashA);
  assert.equal((await aperturaDe(db, turnoB.id))[0].metodo_pago_id, ids.cashB);
});

test('7: hotel sin Efectivo activo falla claro y no deja turno ni caja', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await db.exec(`update public.metodos_pago set activo = false where id = '${ids.cashB}'`);

  for (const [hotelId, actorId] of [[ids.hotelSinEfectivo, ids.actorSinEfectivo], [ids.hotelB, ids.actorB]]) {
    await assert.rejects(
      () => abrirTurno(db, hotelId, actorId),
      /M5_EFECTIVO_NO_CONFIGURADO: el hotel no tiene un metodo de pago Efectivo activo/,
    );
    const counts = await db.query(
      `select (select count(*)::int from public.turnos where hotel_id = $1) as turnos,
              (select count(*)::int from public.caja where hotel_id = $1) as caja`,
      [hotelId],
    );
    assert.deepEqual(counts.rows[0], { turnos: 0, caja: 0 });
  }
});

test('prevencion: no se puede insertar ni dejar una apertura sin metodo', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const turno = await abrirTurno(db, ids.hotelA, ids.actorA);

  await assert.rejects(
    () => db.query(
      `insert into public.caja(hotel_id, turno_id, tipo, concepto, monto, source)
       values ($1, $2, 'apertura', 'Apertura de caja', 1, 'shift_open')`,
      [ids.hotelA, turno.id],
    ),
    /M5_APERTURA_SIN_METODO/,
  );
  await assert.rejects(
    () => db.query("update public.caja set metodo_pago_id = null where turno_id = $1 and tipo = 'apertura'", [turno.id]),
    /M5_APERTURA_SIN_METODO/,
  );
  await assert.rejects(
    () => db.query("update public.caja set metodo_pago_id = $2 where turno_id = $1 and tipo = 'apertura'", [turno.id, ids.cashB]),
    /M5_APERTURA_METODO_INVALIDO/,
  );
  await assert.rejects(
    () => db.query(
      `insert into public.metodos_pago(id, hotel_id, nombre) values ($1, $2, 'EFECTIVO')`,
      [id(77), ids.hotelA],
    ),
    /metodos_pago_un_efectivo_activo_por_hotel/,
  );
});

test('reparacion: solo aperturas shift_open sin metodo de turnos abiertos, con trazabilidad', async (t) => {
  const db = await createDatabase({ legacy: true });
  t.after(() => db.close());

  const rows = await db.query(`
    select turno_id, tipo::text as tipo, monto, metodo_pago_id
      from public.caja
     order by turno_id, tipo
  `);
  assert.deepEqual(rows.rows.map((row) => ({ ...row, monto: Number(row.monto) })), [
    { turno_id: ids.legacyOpenA, tipo: 'apertura', monto: 120000, metodo_pago_id: ids.cashA },
    { turno_id: ids.legacyOpenA, tipo: 'ingreso', monto: 5000, metodo_pago_id: null },
    { turno_id: ids.legacyClosedA, tipo: 'apertura', monto: 80000, metodo_pago_id: null },
    { turno_id: ids.legacyOpenSinEfectivo, tipo: 'apertura', monto: 50000, metodo_pago_id: null },
  ]);

  const audit = await db.query(
    "select hotel_id, actor_id, after_data from public.auditoria_operaciones where accion = 'caja.reparar_metodo_apertura'",
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].hotel_id, ids.hotelA);
  assert.equal(audit.rows[0].actor_id, ids.actorA);
  assert.equal(audit.rows[0].after_data.metodo_pago_id, ids.cashA);

  const ledger = await db.query('select count(*)::int as n from public.account_movements');
  assert.equal(ledger.rows[0].n, 0, 'la reparacion no proyecta aperturas al ledger');

  // Reaplicar la migracion es idempotente: no duplica aperturas ni auditoria.
  await db.exec(aperturaMigration);
  const again = await db.query(
    "select (select count(*)::int from public.auditoria_operaciones) as audit, (select count(*)::int from public.caja where tipo = 'apertura') as aperturas",
  );
  assert.deepEqual(again.rows[0], { audit: 1, aperturas: 3 });
});

test('la migracion aborta sin cambios si un hotel tiene dos Efectivo activos', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(schemaSql);
  await db.exec(seedSql);
  await db.exec(cierreMigration);
  await db.exec(legacySql);
  await db.exec(`insert into public.metodos_pago(id, hotel_id, nombre) values ('${id(78)}', '${ids.hotelA}', 'EFECTIVO')`);

  await assert.rejects(() => db.exec(aperturaMigration), /M5_EFECTIVO_DUPLICADO/);
  await db.exec('rollback').catch(() => {});
  const apertura = await aperturaDe(db, ids.legacyOpenA);
  assert.equal(apertura[0].metodo_pago_id, null);
});

test('el frontend conserva la firma del RPC de apertura', () => {
  assert.match(turnosSource, /rpc\('abrir_turno_con_apertura',\s*\{\s*p_hotel_id: currentHotelId,\s*p_usuario_id: currentModuleUser\.id,\s*p_monto_inicial: montoInicial,\s*p_fecha_movimiento: fechaMovimiento\s*\}\)/);
});
