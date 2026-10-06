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
  '20260912120000_a8_bank_reservation_allocation_capacity.sql',
);
const migration = fs.readFileSync(migrationPath, 'utf8');
const cajaRelationMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260901184238_bank_payment_allocation_caja_link.sql'),
  'utf8',
);
const privateAllocationMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260828063000_recepcion_relacion_pagos_bancarios.sql'),
  'utf8',
);

const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const ids = {
  hotel: id(1),
  otherHotel: id(2),
  actor: id(10),
  room: id(20),
  reservation: id(30),
  paidReservation: id(31),
  eventA: id(40),
  eventB: id(41),
  eventCaja: id(42),
  eventReview: id(43),
  eventCajaLink: id(44),
  payment: id(50),
  expected: id(60),
  expiredExpected: id(61),
  caja: id(70),
};

test('A8 protege la rama de reserva y conserva el camino validado desde Caja', () => {
  assert.match(migration, /create or replace function public\.bank_email_reservation_available_amount_cop/i);
  assert.match(migration, /:bank-reservation:/i);
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*bank_email_reservation_available_amount_cop/i);
  assert.match(migration, /bank_reconciliation_caja_validated/i);
  assert.match(migration, /alter function public\.replace_bank_payment_allocations_from_caja[\s\S]*set schema app_private/i);
  assert.match(migration, /set_config\('app\.bank_reconciliation_caja_validated', 'true', true\)/i);
  assert.match(migration, /a\.caja_id is null/i);
  assert.match(migration, /p_exclude_payment_event_id/i);
  assert.match(migration, /e\.status in \('matched', 'confirmed'\)/i);
  assert.match(migration, /from public\.pagos_reserva/i);
  assert.match(migration, /from public\.expected_payments/i);
  assert.match(cajaRelationMigration, /for share/i);
  assert.match(cajaRelationMigration, /v_caja\.reserva_id is distinct from v_target_id/i);
  assert.match(cajaRelationMigration, /v_caja\.monto::numeric is distinct from v_amount::numeric/i);
  assert.match(cajaRelationMigration, /public\.replace_bank_payment_allocations\(/i);
});

function currentPrivateAllocationFunction() {
  const marker = 'create or replace function app_private.replace_bank_payment_allocations(';
  const start = privateAllocationMigration.toLowerCase().indexOf(marker);
  assert.notEqual(start, -1, 'No se encontro la implementacion privada vigente de allocations');
  const bodyStart = privateAllocationMigration.indexOf('as $function$', start);
  const end = privateAllocationMigration.indexOf('$function$;', bodyStart + 1);
  assert.notEqual(bodyStart, -1);
  assert.notEqual(end, -1);
  return privateAllocationMigration.slice(start, end + '$function$;'.length);
}

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema app_private;

    create function auth.role() returns text language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role')
    $$;

    create table public.reservas(
      id uuid primary key,
      hotel_id uuid not null,
      habitacion_id uuid,
      monto_total numeric not null,
      monto_pagado numeric not null default 0
    );
    create table public.pagos_reserva(
      id uuid primary key,
      hotel_id uuid not null,
      reserva_id uuid not null,
      monto numeric not null
    );
    create table public.expected_payments(
      id uuid primary key,
      hotel_id uuid not null,
      reservation_id uuid,
      expected_amount_cop bigint not null,
      status text not null,
      expires_at timestamptz,
      matched_bank_payment_id uuid
    );
    create table public.bank_payment_events(
      id uuid primary key,
      hotel_id uuid not null,
      status text not null,
      amount_cop bigint not null,
      updated_at timestamptz not null default clock_timestamp(),
      matched_reservation_id uuid,
      matched_room_id uuid,
      matched_sale_id uuid,
      matched_sale_type text,
      matched_expected_payment_id uuid,
      review_reason text,
      reviewed_by uuid,
      reviewed_at timestamptz,
      confirmed_by uuid,
      confirmed_at timestamptz,
      metadata jsonb not null default '{}'::jsonb
    );
    create table public.bank_payment_allocations(
      id uuid primary key default gen_random_uuid(),
      hotel_id uuid not null,
      payment_event_id uuid not null,
      allocation_type text not null,
      reservation_id uuid,
      room_id uuid,
      sale_id uuid,
      sale_type text,
      amount_cop bigint not null,
      created_by uuid,
      caja_id uuid,
      created_at timestamptz not null default clock_timestamp()
    );

    create function public.resolve_bank_email_pilot_hotel(text)
    returns uuid language sql stable as $$ select '${ids.hotel}'::uuid $$;
    create function app_private.bank_email_actor_is_pilot_operational(uuid, uuid)
    returns boolean language sql stable as $$ select true $$;
    create function app_private.bank_email_actor_is_pilot_admin(uuid, uuid)
    returns boolean language sql stable as $$ select true $$;
    create function public.bank_email_sale_is_reconcilable(text, uuid, uuid)
    returns boolean language sql stable as $$ select true $$;
    create function public.bank_email_sale_available_amount_cop(text, uuid, uuid, uuid default null)
    returns bigint language sql stable as $$ select 999999999::bigint $$;
    create function public.bank_email_write_audit(uuid, uuid, text, uuid, jsonb)
    returns void language sql as $$ select $$;
  `);
  await db.exec(currentPrivateAllocationFunction());
  await db.exec(`
    create function public.replace_bank_payment_allocations_from_caja(
      p_payment_event_id uuid,
      p_actor_id uuid,
      p_allocations jsonb,
      p_action text,
      p_review_reason text default null,
      p_pilot_hotel_name text default 'Hotel Marena San Isidro'
    ) returns jsonb language plpgsql security definer
    set search_path = pg_catalog, public, app_private as $$
    begin
      return app_private.replace_bank_payment_allocations(
        p_payment_event_id, p_actor_id, p_allocations, p_action,
        p_review_reason, p_pilot_hotel_name
      );
    end $$;
  `);
  await db.exec(`
    insert into public.reservas(id, hotel_id, habitacion_id, monto_total, monto_pagado) values
      ('${ids.reservation}', '${ids.hotel}', '${ids.room}', 100, 0),
      ('${ids.paidReservation}', '${ids.hotel}', '${ids.room}', 100, 70);
    insert into public.bank_payment_events(id, hotel_id, status, amount_cop) values
      ('${ids.eventA}', '${ids.hotel}', 'detected', 70),
      ('${ids.eventB}', '${ids.hotel}', 'detected', 40),
      ('${ids.eventCaja}', '${ids.hotel}', 'confirmed', 15),
      ('${ids.eventReview}', '${ids.hotel}', 'manual_review', 99),
      ('${ids.eventCajaLink}', '${ids.hotel}', 'detected', 100);
    insert into public.pagos_reserva(id, hotel_id, reserva_id, monto)
      values ('${ids.payment}', '${ids.hotel}', '${ids.paidReservation}', 80);
    insert into public.expected_payments(id, hotel_id, reservation_id, expected_amount_cop, status, expires_at) values
      ('${ids.expected}', '${ids.hotel}', '${ids.paidReservation}', 10, 'pending', now() + interval '1 hour'),
      ('${ids.expiredExpected}', '${ids.hotel}', '${ids.paidReservation}', 50, 'pending', now() - interval '1 hour');
    insert into public.bank_payment_allocations(
      hotel_id, payment_event_id, allocation_type, reservation_id, room_id, amount_cop, created_by, caja_id
    ) values (
      '${ids.hotel}', '${ids.eventCaja}', 'reservation', '${ids.paidReservation}', '${ids.room}', 15, '${ids.actor}', '${ids.caja}'
    ), (
      '${ids.hotel}', '${ids.eventReview}', 'reservation', '${ids.paidReservation}', '${ids.room}', 99, '${ids.actor}', null
    );
  `);
  await db.exec(migration);
  return db;
}

async function replaceReservation(db, eventId, reservationId, amount, extra = {}) {
  const allocations = [{
    type: 'reservation',
    reservationId,
    amountCop: amount,
    ...extra,
  }];
  return db.query(
    `select app_private.replace_bank_payment_allocations(
      $1, $2, $3::jsonb, 'confirm', 'Prueba A8', 'Hotel Marena San Isidro'
    ) as result`,
    [eventId, ids.actor, JSON.stringify(allocations)],
  );
}

test('A8 ejecuta el control de capacidad sobre PostgreSQL real', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  await t.test('calcula saldo sin duplicar pagos respaldados por Caja', async () => {
    const result = await db.query(
      'select public.bank_email_reservation_available_amount_cop($1, $2, null) as available',
      [ids.paidReservation, ids.hotel],
    );
    assert.equal(Number(result.rows[0].available), 10);

    const foreign = await db.query(
      'select public.bank_email_reservation_available_amount_cop($1, $2, null) as available',
      [ids.paidReservation, ids.otherHotel],
    );
    assert.equal(foreign.rows[0].available, null);
  });

  await t.test('la ruta validada de Caja no descuenta dos veces el cobro existente', async () => {
    const allocations = [{
      type: 'reservation',
      reservationId: ids.paidReservation,
      amountCop: 100,
      cajaId: ids.caja,
    }];
    const result = await db.query(
      `select public.replace_bank_payment_allocations_from_caja(
        $1, $2, $3::jsonb, 'link', 'Prueba Caja A8', 'Hotel Marena San Isidro'
      ) as result`,
      [ids.eventCajaLink, ids.actor, JSON.stringify(allocations)],
    );
    assert.equal(result.rows[0].result.payment_event.status, 'matched');
  });

  await t.test('rechaza que dos eventos excedan el total de una reserva', async () => {
    await replaceReservation(db, ids.eventA, ids.reservation, 70);
    await assert.rejects(
      replaceReservation(db, ids.eventB, ids.reservation, 40),
      /saldo conciliable \(30\)/i,
    );

    const state = await db.query(`
      select e.id, e.status, coalesce(sum(a.amount_cop), 0)::bigint as allocated
      from public.bank_payment_events e
      left join public.bank_payment_allocations a on a.payment_event_id = e.id
      where e.id in ('${ids.eventA}', '${ids.eventB}')
      group by e.id, e.status
      order by e.id
    `);
    assert.deepEqual(
      state.rows.map((row) => ({ id: row.id, status: row.status, allocated: Number(row.allocated) })),
      [
        { id: ids.eventA, status: 'confirmed', allocated: 70 },
        { id: ids.eventB, status: 'detected', allocated: 0 },
      ],
    );
  });

  await t.test('un reintento del mismo evento excluye su allocation actual', async () => {
    const result = await replaceReservation(db, ids.eventA, ids.reservation, 70);
    assert.equal(result.rows[0].result.payment_event.status, 'confirmed');
    const count = await db.query(
      'select count(*)::integer as count, sum(amount_cop)::bigint as total from public.bank_payment_allocations where payment_event_id = $1',
      [ids.eventA],
    );
    assert.deepEqual(count.rows[0], { count: 1, total: 70 });
  });
});
