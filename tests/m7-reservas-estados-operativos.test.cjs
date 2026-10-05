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
  '20260929120000_m7_reservas_estados_operativos.sql',
);
const migration = fs.readFileSync(migrationPath, 'utf8');
const reservasSource = fs.readFileSync(path.join(root, 'js/modules/reservas/reservas.js'), 'utf8');
const calculosSource = fs.readFileSync(path.join(root, 'js/modules/reservas/reservas-calculos.js'), 'utf8');

const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const roomId = id(1);
const reservationId = id(2);

async function loadModules() {
  const cacheKey = Date.now();
  const operation = await import(`${pathToFileURL(path.join(root, 'js/modules/reservas/reservas-operacion.js')).href}?m7=${cacheKey}`);
  const render = await import(`${pathToFileURL(path.join(root, 'js/modules/reservas/reservas-render.js')).href}?m7=${cacheKey}`);
  const actions = await import(`${pathToFileURL(path.join(root, 'js/modules/reservas/reservas-acciones.js')).href}?m7=${cacheKey}`);
  const ui = await import(`${pathToFileURL(path.join(root, 'js/modules/reservas/reservas-ui.js')).href}?m7=${cacheKey}`);
  return { actions, operation, render, ui };
}

async function createDatabase() {
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
      habitacion_id uuid not null,
      estado public.estado_reserva_enum not null,
      fecha_inicio timestamptz not null,
      fecha_fin timestamptz not null
    );

    grant usage on schema public to authenticated, service_role;
    grant select on public.reservas to authenticated, service_role;
  `);
  await db.exec(migration);
  return db;
}

async function hasConflict(db, {
  start = '2026-10-01T11:00:00Z',
  end = '2026-10-01T13:00:00Z',
  excludedId = null,
  targetRoomId = roomId,
} = {}) {
  const result = await db.query(
    'select public.validar_cruce_reserva($1, $2, $3, $4) as conflict',
    [targetRoomId, start, end, excludedId],
  );
  return result.rows[0].conflict;
}

test('M7 centraliza todos los estados visibles y muestra ocupada y tiempo agotado en operacion', async () => {
  const { operation, render } = await loadModules();

  assert.deepEqual(operation.RESERVA_CANONICAL_OPERATIONAL_STATES, [
    'pendiente', 'reservada', 'confirmada', 'activa', 'ocupada',
  ]);
  assert.deepEqual(operation.RESERVA_OPERATIONAL_STATES, [
    'pendiente', 'reservada', 'confirmada', 'activa', 'ocupada', 'check_in', 'tiempo agotado',
  ]);
  assert.equal(operation.RESERVA_VISIBLE_STATES.includes('finalizada'), true);
  assert.equal(operation.RESERVA_VISIBLE_STATES.includes('facturada_pagada'), true);
  assert.equal(operation.getReservaStateLabel('tiempo agotado'), 'Tiempo agotado');

  const reservations = operation.RESERVA_OPERATIONAL_STATES.map((estado, index) => ({
    id: `reservation-${index}`,
    estado,
    fecha_inicio: `2026-10-0${index + 1}T12:00:00Z`,
  }));
  const html = render.buildReservasListHtml({
    reservasEnriquecidas: reservations,
    reservasFiltradas: reservations,
    renderReservasGrupo: (title, group) => `<section data-title="${title}">${group.map((item) => item.id).join(',')}</section>`,
    getDateMsSafe: (value) => new Date(value).getTime(),
    getReservaFilterDateISO: (reservation) => reservation.fecha_inicio,
    getReservaRegistroISO: (reservation) => reservation.fecha_inicio,
  });

  assert.match(html, /data-title="Ocupada">reservation-4/);
  assert.match(html, /data-title="Tiempo agotado">reservation-6/);
  for (const reservation of reservations) assert.match(html, new RegExp(reservation.id));
});

test('M7 ofrece cobro y checkout para estancias ocupadas o con tiempo agotado', async () => {
  const { actions, ui } = await loadModules();

  for (const estado of ['ocupada', 'tiempo agotado']) {
    const html = actions.getAccionesReservaHTML({
      id: reservationId,
      habitacion_id: roomId,
      estado,
      pendiente: 25000,
    });
    assert.match(html, /data-action="abonar"/);
    assert.match(html, /data-action="checkout"/);
    assert.notEqual(ui.getReservaBorderColor(estado), 'border-gray-300');
    assert.notEqual(ui.getReservaBgColor(estado), 'bg-gray-200');
  }
});

test('M7 bloquea cruces para cada estado operativo y respeta limites y exclusion', async (t) => {
  const { operation } = await loadModules();
  const db = await createDatabase();
  t.after(() => db.close());

  for (const estado of operation.RESERVA_CONFLICT_STATES) {
    await db.exec('delete from public.reservas');
    await db.query(
      `insert into public.reservas(id, habitacion_id, estado, fecha_inicio, fecha_fin)
       values ($1, $2, $3, $4, $5)`,
      [reservationId, roomId, estado, '2026-10-01T10:00:00Z', '2026-10-01T12:00:00Z'],
    );
    assert.equal(await hasConflict(db), true, `el estado ${estado} debe bloquear`);
  }

  assert.equal(await hasConflict(db, {
    start: '2026-10-01T12:00:00Z',
    end: '2026-10-01T13:00:00Z',
  }), false, 'el limite [) permite una reserva inmediatamente posterior');
  assert.equal(await hasConflict(db, { excludedId: reservationId }), false);

  await db.query('update public.reservas set estado = $1 where id = $2', ['finalizada', reservationId]);
  assert.equal(await hasConflict(db), false, 'una reserva finalizada no bloquea disponibilidad');

  await assert.rejects(
    () => hasConflict(db, { start: '2026-10-01T13:00:00Z', end: '2026-10-01T12:00:00Z' }),
    /M7_INTERVALO_RESERVA_INVALIDO/,
  );
});

test('M7 conserva invocacion segura y conecta listado y validaciones a los estados compartidos', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const privileges = await db.query(`
    select
      has_function_privilege('anon', 'public.validar_cruce_reserva(uuid,timestamptz,timestamptz,uuid)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.validar_cruce_reserva(uuid,timestamptz,timestamptz,uuid)', 'execute') as authenticated,
      has_function_privilege('service_role', 'public.validar_cruce_reserva(uuid,timestamptz,timestamptz,uuid)', 'execute') as service_role
  `);
  assert.deepEqual(privileges.rows[0], { anon: false, authenticated: true, service_role: true });

  assert.match(migration, /stable\s+security invoker\s+set search_path\s*=\s*pg_catalog, public/i);
  assert.match(migration, /'tiempo agotado'::public\.estado_reserva_enum/i);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon/i);
  assert.match(reservasSource, /\.in\('estado', RESERVA_VISIBLE_STATES\)/);
  assert.match(reservasSource, /\.in\('estado', RESERVA_CONFLICT_STATES\)/);
  assert.match(calculosSource, /\.in\('estado', RESERVA_CONFLICT_STATES\)/);
  assert.doesNotMatch(reservasSource, /const estadosVisibles\s*=\s*\[/);
});
