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
  '20260915120000_a13_a14_reservation_lifecycle_atomic.sql',
);
const paymentMigrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20260809102000_fase1_pago_reserva_atomico.sql',
);
const migration = fs.readFileSync(migrationPath, 'utf8');
const paymentMigration = fs.readFileSync(paymentMigrationPath, 'utf8');

const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const ids = {
  hotelA: id(1),
  hotelB: id(2),
  actorA: id(10),
  actorB: id(11),
  roomA: id(20),
  roomB: id(21),
  stayA: id(30),
  stayB: id(31),
  timeA: id(40),
  methodA: id(50),
  shiftA: id(60),
  createOpA: id(100),
  createOpB: id(101),
  paymentOpA: id(102),
  checkinOpA: id(110),
  checkoutOpA: id(120),
  cleanupOpA: id(130),
};

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
    $$;
    grant usage on schema auth to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;

    create type public.estado_habitacion_enum as enum (
      'bloqueada', 'libre', 'limpieza', 'mantenimiento', 'ocupada', 'reservada', 'tiempo agotado'
    );
    create type public.estado_reserva_enum as enum (
      'activa', 'cancelada', 'cancelada_mantenimiento', 'check_in', 'check_out',
      'completada', 'confirmada', 'facturada_pagada', 'finalizada', 'finalizada_auto',
      'no_show', 'ocupada', 'pendiente', 'reservada', 'tiempo agotado'
    );

    create table public.hoteles(
      id uuid primary key,
      nombre text not null
    );
    create table public.usuarios(
      id uuid primary key,
      hotel_id uuid not null,
      nombre text,
      activo boolean not null default true
    );
    create table public.habitaciones(
      id uuid primary key,
      hotel_id uuid not null,
      nombre text not null,
      estado public.estado_habitacion_enum not null default 'libre',
      activo boolean not null default true,
      creado_en timestamptz default now(),
      actualizado_en timestamptz default now()
    );
    create table public.clientes(
      id uuid primary key default gen_random_uuid(),
      hotel_id uuid not null,
      nombre text not null,
      documento text,
      telefono text,
      activo boolean default true,
      fecha_creado timestamptz default now()
    );
    create table public.tiempos_estancia(
      id uuid primary key,
      hotel_id uuid,
      nombre text not null,
      minutos integer not null,
      activo boolean default true
    );
    create table public.metodos_pago(
      id uuid primary key,
      hotel_id uuid not null,
      nombre text not null,
      activo boolean default true
    );
    create table public.descuentos(
      id uuid primary key default gen_random_uuid(),
      hotel_id uuid not null,
      activo boolean not null default true,
      usos_maximos integer not null default 0,
      usos_actuales integer not null default 0,
      fecha_inicio timestamptz,
      fecha_fin timestamptz,
      expiracion timestamptz
    );
    create table public.reservas(
      id uuid primary key default gen_random_uuid(),
      hotel_id uuid not null,
      habitacion_id uuid not null,
      cliente_id uuid,
      cliente_nombre text not null,
      cliente_cedula varchar(50),
      cliente_telefono varchar(20),
      cedula varchar(20),
      telefono varchar(20),
      tiempo_estancia_id uuid,
      fecha_inicio timestamptz not null,
      fecha_fin timestamptz not null,
      cantidad_huespedes integer not null default 1,
      monto_total numeric,
      monto_pagado numeric default 0,
      metodo_pago_id uuid,
      estado public.estado_reserva_enum default 'pendiente',
      tipo_duracion text,
      cantidad_duracion integer,
      monto_estancia_base numeric default 0,
      monto_estancia_base_sin_impuestos numeric,
      monto_impuestos_estancia numeric,
      porcentaje_impuestos_aplicado numeric,
      nombre_impuesto_aplicado text,
      descuento_aplicado_id uuid,
      monto_descontado numeric default 0,
      usuario_id uuid,
      notas text,
      origen_reserva text default 'directa',
      creado_en timestamptz default now(),
      actualizado_en timestamptz default now()
    );
    create table public.cronometros(
      id uuid primary key default gen_random_uuid(),
      hotel_id uuid not null,
      reserva_id uuid,
      habitacion_id uuid not null,
      fecha_inicio timestamptz not null,
      fecha_fin timestamptz not null,
      activo boolean default true,
      creado_en timestamptz default now(),
      actualizado_en timestamptz default now()
    );
    create table public.turnos(
      id uuid primary key,
      hotel_id uuid not null,
      usuario_id uuid not null,
      estado varchar(20) not null default 'abierto',
      fecha_apertura timestamptz default now(),
      fecha_cierre timestamptz
    );
    create table public.pagos_reserva(
      id uuid primary key default gen_random_uuid(),
      hotel_id uuid not null,
      reserva_id uuid not null,
      monto numeric not null,
      fecha_pago timestamptz default now(),
      metodo_pago_id uuid not null,
      usuario_id uuid,
      concepto text,
      creado_en timestamptz default now(),
      actualizado_en timestamptz default now()
    );
    create table public.caja(
      id uuid primary key default gen_random_uuid(),
      hotel_id uuid not null,
      tipo text not null,
      monto numeric not null,
      concepto text not null,
      fecha_movimiento timestamptz default now(),
      metodo_pago_id uuid,
      usuario_id uuid,
      reserva_id uuid,
      pago_reserva_id uuid,
      turno_id uuid,
      client_operation_id uuid,
      source text,
      business_date date
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
      client_operation_id uuid,
      created_at timestamptz not null default now()
    );
    create unique index auditoria_operaciones_request_uq
      on public.auditoria_operaciones(hotel_id, accion, client_operation_id)
      where client_operation_id is not null;

    create function public.fase1_actor_es_miembro_activo(p_hotel_id uuid)
    returns boolean language sql stable security definer
    set search_path = pg_catalog, public as $$
      select auth.uid() is not null and exists (
        select 1 from public.usuarios u
        where u.id = auth.uid() and u.activo is true and u.hotel_id = p_hotel_id
      )
    $$;
    create function public.fase1_business_date(p_occurred_at timestamptz)
    returns date language sql immutable set search_path = pg_catalog as $$
      select (p_occurred_at at time zone 'America/Bogota')::date
    $$;

    insert into public.hoteles(id, nombre) values
      ('${ids.hotelA}', 'Hotel A'), ('${ids.hotelB}', 'Hotel B');
    insert into public.usuarios(id, hotel_id, nombre) values
      ('${ids.actorA}', '${ids.hotelA}', 'Recepcion A'),
      ('${ids.actorB}', '${ids.hotelB}', 'Recepcion B');
    insert into public.habitaciones(id, hotel_id, nombre) values
      ('${ids.roomA}', '${ids.hotelA}', '101'),
      ('${ids.roomB}', '${ids.hotelB}', '201');
    insert into public.tiempos_estancia(id, hotel_id, nombre, minutos) values
      ('${ids.timeA}', '${ids.hotelA}', 'Dos horas', 120);
    insert into public.metodos_pago(id, hotel_id, nombre) values
      ('${ids.methodA}', '${ids.hotelA}', 'Efectivo');
    insert into public.turnos(id, hotel_id, usuario_id) values
      ('${ids.shiftA}', '${ids.hotelA}', '${ids.actorA}');
  `);
  await db.exec(paymentMigration);
  await db.exec(migration);
  return db;
}

async function asActor(db, actorId, action) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(actorId ? { sub: actorId, role: 'authenticated' } : { role: 'anon' }),
    ]);
    await db.exec(`set local role ${actorId ? 'authenticated' : 'anon'}`);
    const result = await action(db);
    await db.exec('commit');
    return result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

function stayPayload({ hotelId = ids.hotelA, roomId = ids.roomA, clientId = null } = {}) {
  return {
    hotel_id: hotelId,
    habitacion_id: roomId,
    cliente_id: clientId,
    cliente_nombre: 'Huesped A',
    cedula: '12345',
    telefono: '3000000000',
    tiempo_estancia_id: hotelId === ids.hotelA ? ids.timeA : null,
    fecha_inicio: '2026-09-15T15:00:00.000Z',
    fecha_fin: '2026-09-15T17:00:00.000Z',
    cantidad_huespedes: 2,
    monto_total: 100000,
    monto_estancia_base: 100000,
    monto_estancia_base_sin_impuestos: 100000,
    monto_impuestos_estancia: 0,
    monto_descontado: 0,
    tipo_duracion: 'horas',
    cantidad_duracion: 2,
  };
}

async function createStay(db, operationId = ids.createOpA, payload = stayPayload(), payments = []) {
  const result = await db.query(
    `select public.crear_estancia_atomica($1::jsonb, $2, $3::jsonb, $4, $5, $6) as result`,
    [
      JSON.stringify(payload),
      operationId,
      JSON.stringify(payments),
      payments.length ? ids.shiftA : null,
      'Alquiler habitacion 101',
      '2026-09-15T14:55:00.000Z',
    ],
  );
  return result.rows[0].result;
}

async function seedFutureReservation(db, {
  reservationId = ids.stayA,
  hotelId = ids.hotelA,
  roomId = ids.roomA,
  roomState = 'reservada',
} = {}) {
  await db.query('update public.habitaciones set estado = $1 where id = $2', [roomState, roomId]);
  await db.query(
    `insert into public.reservas(
      id, hotel_id, habitacion_id, cliente_nombre, fecha_inicio, fecha_fin, estado, monto_total, monto_pagado
    ) values ($1, $2, $3, 'Huesped futuro', '2026-09-16T15:00:00Z', '2026-09-16T17:00:00Z', 'reservada', 50000, 50000)`,
    [reservationId, hotelId, roomId],
  );
}

async function seedActiveReservation(db, {
  reservationId = ids.stayA,
  hotelId = ids.hotelA,
  roomId = ids.roomA,
  state = 'activa',
} = {}) {
  await db.query('update public.habitaciones set estado = $1 where id = $2', ['ocupada', roomId]);
  await db.query(
    `insert into public.reservas(
      id, hotel_id, habitacion_id, cliente_nombre, fecha_inicio, fecha_fin, estado, monto_total, monto_pagado
    ) values ($1, $2, $3, 'Huesped activo', '2026-09-15T15:00:00Z', '2026-09-15T17:00:00Z', $4, 50000, 50000)`,
    [reservationId, hotelId, roomId, state],
  );
  await db.query(
    `insert into public.cronometros(hotel_id, reserva_id, habitacion_id, fecha_inicio, fecha_fin, activo)
     values ($1, $2, $3, '2026-09-15T15:00:00Z', '2026-09-15T17:00:00Z', true)`,
    [hotelId, reservationId, roomId],
  );
}

async function operationalState(db, roomId = ids.roomA) {
  const result = await db.query(`
    select
      (select count(*)::integer from public.reservas where habitacion_id = $1) as reservations,
      (select count(*)::integer from public.clientes where hotel_id = '${ids.hotelA}') as clients,
      (select count(*)::integer from public.cronometros where habitacion_id = $1 and activo) as active_timers,
      (select estado::text from public.habitaciones where id = $1) as room_state,
      (select count(*)::integer from public.auditoria_operaciones where entity_id = $1) as room_audits
  `, [roomId]);
  return result.rows[0];
}

test('A13 + A14: contrato SQL y callers del frontend', () => {
  const rental = fs.readFileSync(path.join(root, 'js/modules/mapa-habitaciones/modales-alquiler.js'), 'utf8');
  const management = fs.readFileSync(path.join(root, 'js/modules/mapa-habitaciones/modales-gestion.js'), 'utf8');
  const stateFlow = fs.readFileSync(path.join(root, 'js/modules/reservas/reservas-estado.js'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'js/services/reservationLifecycleService.js'), 'utf8');

  assert.match(migration, /FUNCTION public\.crear_estancia_atomica/i);
  assert.match(migration, /FUNCTION public\.realizar_checkin_reserva_atomico/i);
  assert.match(migration, /FUNCTION public\.finalizar_estancia_reserva_atomica/i);
  assert.match(migration, /FOR UPDATE/i);
  assert.match(migration, /cronometros_hotel_habitacion_activo_uq/i);
  assert.match(migration, /cronometros_hotel_reserva_activo_uq/i);
  assert.match(migration, /fase1_actor_es_miembro_activo/i);
  assert.match(migration, /auditoria_operaciones/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon/i);
  assert.match(service, /p_client_operation_id:\s*getStableOperationId/i);
  assert.match(rental, /crearEstanciaAtomica\(supabase/i);
  assert.doesNotMatch(rental, /\.from\('reservas'\)\s*\.insert\(reservaInsert\)/i);
  assert.match(management, /realizarCheckinReservaAtomico\(supabase/i);
  assert.match(management, /finalizarEstanciaReservaAtomica\(supabase/i);
  assert.match(stateFlow, /realizarCheckinReservaAtomico\(state\.supabase/i);
  assert.match(stateFlow, /finalizarEstanciaReservaAtomica\(state\.supabase/i);
});

test('A13 crea estancia, cliente y pago en una sola operacion idempotente', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const payments = [{
    metodo_pago_id: ids.methodA,
    monto: 100000,
    client_operation_id: ids.paymentOpA,
  }];

  const first = await asActor(db, ids.actorA, (tx) => createStay(tx, ids.createOpA, stayPayload(), payments));
  const retry = await asActor(db, ids.actorA, (tx) => createStay(tx, ids.createOpA, stayPayload(), payments));
  assert.equal(first.idempotent, false);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.reserva.id, first.reserva.id);

  const state = await db.query(`
    select
      (select count(*)::integer from public.reservas) as reservations,
      (select count(*)::integer from public.clientes) as clients,
      (select count(*)::integer from public.cronometros where activo) as active_timers,
      (select count(*)::integer from public.pagos_reserva) as payments,
      (select count(*)::integer from public.caja) as cash_movements,
      (select count(*)::integer from public.auditoria_operaciones) as audits,
      (select monto_pagado from public.reservas limit 1) as paid,
      (select estado::text from public.habitaciones where id = '${ids.roomA}') as room_state
  `);
  assert.deepEqual(state.rows[0], {
    reservations: 1,
    clients: 1,
    active_timers: 1,
    payments: 1,
    cash_movements: 1,
    audits: 2,
    paid: '100000',
    room_state: 'ocupada',
  });
});

test('A13 revierte cliente, reserva y habitacion si falla el cronometro', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await db.exec(`
    create function public.a13_test_fail_timer() returns trigger language plpgsql as $$
    begin raise exception 'A13_TEST_TIMER_FAILURE'; end $$;
    create trigger a13_test_fail_timer before insert on public.cronometros
    for each row execute function public.a13_test_fail_timer();
  `);

  await assert.rejects(
    asActor(db, ids.actorA, (tx) => createStay(tx)),
    /A13_TEST_TIMER_FAILURE/i,
  );
  assert.deepEqual(await operationalState(db), {
    reservations: 0,
    clients: 0,
    active_timers: 0,
    room_state: 'libre',
    room_audits: 0,
  });
});

test('A13 serializa dos solicitudes competidoras para la misma habitacion', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: ids.actorA, role: 'authenticated' }),
  ]);
  await db.exec('set role authenticated');
  const calls = await Promise.allSettled([
    createStay(db, ids.createOpA),
    createStay(db, ids.createOpB),
  ]);
  await db.exec('reset role');

  assert.equal(calls.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(calls.filter((result) => result.status === 'rejected').length, 1);
  assert.match(calls.find((result) => result.status === 'rejected').reason.message, /A13_HABITACION_NO_DISPONIBLE/i);
  const state = await operationalState(db);
  assert.equal(state.reservations, 1);
  assert.equal(state.active_timers, 1);
  assert.equal(state.room_state, 'ocupada');
});

test('A14 check-in es atomico, conserva duracion y rechaza otro hotel', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await seedFutureReservation(db);

  await assert.rejects(
    asActor(db, ids.actorB, (tx) => tx.query(
      'select public.realizar_checkin_reserva_atomico($1, $2, $3)',
      [ids.stayA, ids.checkinOpA, '2026-09-15T18:00:00Z'],
    )),
    /A14_RESERVA_NO_AUTORIZADA/i,
  );

  const first = await asActor(db, ids.actorA, (tx) => tx.query(
    'select public.realizar_checkin_reserva_atomico($1, $2, $3) as result',
    [ids.stayA, ids.checkinOpA, '2026-09-15T18:00:00Z'],
  ));
  const retry = await asActor(db, ids.actorA, (tx) => tx.query(
    'select public.realizar_checkin_reserva_atomico($1, $2, $3) as result',
    [ids.stayA, ids.checkinOpA, '2026-09-15T19:00:00Z'],
  ));
  assert.equal(first.rows[0].result.idempotent, false);
  assert.equal(retry.rows[0].result.idempotent, true);

  const state = await db.query(`
    select r.estado::text as reservation_state,
      extract(epoch from (r.fecha_fin - r.fecha_inicio))::integer as duration_seconds,
      h.estado::text as room_state,
      (select count(*)::integer from public.cronometros c where c.reserva_id = r.id and c.activo) as active_timers
    from public.reservas r join public.habitaciones h on h.id = r.habitacion_id
    where r.id = $1
  `, [ids.stayA]);
  assert.deepEqual(state.rows[0], {
    reservation_state: 'activa',
    duration_seconds: 7200,
    room_state: 'ocupada',
    active_timers: 1,
  });
});

test('A14 revierte el check-in completo si no puede crear el cronometro', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await seedFutureReservation(db);
  await db.exec(`
    create function public.a14_test_fail_timer() returns trigger language plpgsql as $$
    begin raise exception 'A14_TEST_TIMER_FAILURE'; end $$;
    create trigger a14_test_fail_timer before insert on public.cronometros
    for each row execute function public.a14_test_fail_timer();
  `);

  await assert.rejects(
    asActor(db, ids.actorA, (tx) => tx.query(
      'select public.realizar_checkin_reserva_atomico($1, $2, $3)',
      [ids.stayA, ids.checkinOpA, '2026-09-15T18:00:00Z'],
    )),
    /A14_TEST_TIMER_FAILURE/i,
  );
  const state = await db.query(`
    select r.estado::text as reservation_state, r.fecha_inicio::text as starts_at,
      h.estado::text as room_state,
      (select count(*)::integer from public.cronometros where reserva_id = r.id) as timers
    from public.reservas r join public.habitaciones h on h.id = r.habitacion_id
    where r.id = $1
  `, [ids.stayA]);
  assert.equal(state.rows[0].reservation_state, 'reservada');
  assert.equal(new Date(state.rows[0].starts_at).toISOString(), '2026-09-16T15:00:00.000Z');
  assert.equal(state.rows[0].room_state, 'reservada');
  assert.equal(state.rows[0].timers, 0);
});

test('A14 checkout actualiza las tres entidades y el reintento no duplica auditoria', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await seedActiveReservation(db);

  const first = await asActor(db, ids.actorA, (tx) => tx.query(
    'select public.finalizar_estancia_reserva_atomica($1, $2, $3, $4, $5) as result',
    [ids.stayA, ids.checkoutOpA, '2026-09-15T16:30:00Z', 75000, 'finalizada'],
  ));
  const retry = await asActor(db, ids.actorA, (tx) => tx.query(
    'select public.finalizar_estancia_reserva_atomica($1, $2, $3, $4, $5) as result',
    [ids.stayA, ids.checkoutOpA, '2026-09-15T17:30:00Z', 75000, 'finalizada'],
  ));
  assert.equal(first.rows[0].result.idempotent, false);
  assert.equal(retry.rows[0].result.idempotent, true);

  const state = await db.query(`
    select r.estado::text as reservation_state, r.monto_pagado,
      h.estado::text as room_state,
      (select count(*)::integer from public.cronometros c where c.reserva_id = r.id and c.activo) as active_timers,
      (select count(*)::integer from public.auditoria_operaciones a where a.accion = 'reserva.checkout') as checkout_audits
    from public.reservas r join public.habitaciones h on h.id = r.habitacion_id
    where r.id = $1
  `, [ids.stayA]);
  assert.deepEqual(state.rows[0], {
    reservation_state: 'finalizada',
    monto_pagado: '75000',
    room_state: 'limpieza',
    active_timers: 0,
    checkout_audits: 1,
  });
});

test('A14 revierte reserva y cronometro si la habitacion no puede pasar a limpieza', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await seedActiveReservation(db);
  await db.exec(`
    create function public.a14_test_fail_cleaning() returns trigger language plpgsql as $$
    begin
      if new.estado = 'limpieza' then raise exception 'A14_TEST_CLEANING_FAILURE'; end if;
      return new;
    end $$;
    create trigger a14_test_fail_cleaning before update of estado on public.habitaciones
    for each row execute function public.a14_test_fail_cleaning();
  `);

  await assert.rejects(
    asActor(db, ids.actorA, (tx) => tx.query(
      'select public.finalizar_estancia_reserva_atomica($1, $2, $3, $4, $5)',
      [ids.stayA, ids.checkoutOpA, '2026-09-15T16:30:00Z', 50000, 'completada'],
    )),
    /A14_TEST_CLEANING_FAILURE/i,
  );
  const state = await db.query(`
    select r.estado::text as reservation_state, h.estado::text as room_state,
      (select activo from public.cronometros where reserva_id = r.id limit 1) as timer_active,
      (select count(*)::integer from public.auditoria_operaciones a where a.accion = 'reserva.checkout') as audits
    from public.reservas r join public.habitaciones h on h.id = r.habitacion_id
    where r.id = $1
  `, [ids.stayA]);
  assert.deepEqual(state.rows[0], {
    reservation_state: 'activa',
    room_state: 'ocupada',
    timer_active: true,
    audits: 0,
  });
});

test('A14 limpieza forzada falla cerrada ante reserva activa y repara cronometro huerfano', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await seedActiveReservation(db);
  await assert.rejects(
    asActor(db, ids.actorA, (tx) => tx.query(
      'select public.forzar_limpieza_habitacion_atomica($1, $2, $3)',
      [ids.roomA, ids.cleanupOpA, '2026-09-15T16:00:00Z'],
    )),
    /A14_LIMPIEZA_FORZADA_RESERVA_ACTIVA/i,
  );

  await db.query('delete from public.reservas where id = $1', [ids.stayA]);
  const first = await asActor(db, ids.actorA, (tx) => tx.query(
    'select public.forzar_limpieza_habitacion_atomica($1, $2, $3) as result',
    [ids.roomA, ids.cleanupOpA, '2026-09-15T16:00:00Z'],
  ));
  const retry = await asActor(db, ids.actorA, (tx) => tx.query(
    'select public.forzar_limpieza_habitacion_atomica($1, $2, $3) as result',
    [ids.roomA, ids.cleanupOpA, '2026-09-15T17:00:00Z'],
  ));
  assert.equal(first.rows[0].result.idempotent, false);
  assert.equal(retry.rows[0].result.idempotent, true);
  const state = await db.query(`
    select h.estado::text as room_state,
      (select count(*)::integer from public.cronometros where habitacion_id = h.id and activo) as active_timers
    from public.habitaciones h where h.id = $1
  `, [ids.roomA]);
  assert.deepEqual(state.rows[0], { room_state: 'limpieza', active_timers: 0 });
});

test('A13 impide dos cronometros activos para una habitacion o reserva', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await seedActiveReservation(db);
  await assert.rejects(
    db.query(
      `insert into public.cronometros(hotel_id, reserva_id, habitacion_id, fecha_inicio, fecha_fin, activo)
       values ($1, $2, $3, now(), now() + interval '1 hour', true)`,
      [ids.hotelA, ids.stayB, ids.roomA],
    ),
    /cronometros_hotel_habitacion_activo_uq/i,
  );
  await db.query('update public.habitaciones set estado = $1 where id = $2', ['ocupada', ids.roomB]);
  await assert.rejects(
    db.query(
      `insert into public.cronometros(hotel_id, reserva_id, habitacion_id, fecha_inicio, fecha_fin, activo)
       values ($1, $2, $3, now(), now() + interval '1 hour', true)`,
      [ids.hotelA, ids.stayA, ids.roomB],
    ),
    /cronometros_hotel_reserva_activo_uq/i,
  );
});
