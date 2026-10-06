const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '../..');
const migrationDirectory = path.join(root, 'supabase/migrations');
const migrationFiles = fs.readdirSync(migrationDirectory).filter((file) => file.endsWith('.sql')).sort();

function latestFunction(name) {
  let definition;
  let migration;
  const pattern = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\bAS\\s+(\\$[a-zA-Z_0-9]*\\$)[\\s\\S]*?\\1\\s*;`,
    'ig',
  );
  for (const file of migrationFiles) {
    const source = fs.readFileSync(path.join(migrationDirectory, file), 'utf8');
    for (const match of source.matchAll(pattern)) {
      definition = match[0];
      migration = file;
    }
  }
  if (!definition) throw new Error(`Missing real function: ${name}`);
  return { definition, migration };
}

const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const ids = {
  hotelA: id(1),
  hotelB: id(2),
  actorA: id(10),
  actorB: id(11),
  reservationA: id(20),
  reservationB: id(21),
  payment: id(30),
  priorPayment: id(31),
  foreignPayment: id(32),
  service: id(40),
  laterService: id(41),
  storeSale: id(50),
  restaurantSale: id(60),
  cash: id(70),
};

async function database() {
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

    create table public.hoteles(id uuid primary key);
    create table public.usuarios(
      id uuid primary key,
      hotel_id uuid,
      activo boolean not null default true
    );
    create table public.reservas(
      id uuid primary key,
      hotel_id uuid not null,
      monto_total numeric not null default 0,
      monto_pagado numeric not null default 0,
      actualizado_en timestamptz default now()
    );
    create table public.pagos_reserva(
      id uuid primary key,
      hotel_id uuid not null,
      reserva_id uuid not null,
      monto numeric not null,
      usuario_id uuid,
      source text,
      client_operation_id uuid
    );
    create table public.servicios_x_reserva(
      id uuid primary key,
      hotel_id uuid,
      reserva_id uuid,
      precio_cobrado numeric,
      estado_pago text default 'pendiente',
      pago_reserva_id uuid
    );
    create table public.ventas_tienda(
      id uuid primary key,
      hotel_id uuid not null,
      reserva_id uuid,
      total_venta numeric not null,
      estado_pago text default 'pendiente',
      actualizado_en timestamptz default now()
    );
    create table public.ventas_restaurante(
      id uuid primary key,
      hotel_id uuid not null,
      reserva_id uuid,
      monto_total numeric,
      total_venta numeric,
      estado_pago text default 'pendiente'
    );
    create table public.caja(
      id uuid primary key,
      hotel_id uuid not null,
      tipo text not null,
      monto numeric not null,
      venta_tienda_id uuid,
      venta_restaurante_id uuid
    );
    create table public.auditoria_operaciones(
      id uuid primary key default gen_random_uuid(),
      hotel_id uuid not null,
      actor_id uuid not null,
      accion text not null,
      entidad text not null,
      entity_id uuid,
      after_data jsonb,
      client_operation_id uuid
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
  `);

  const rpc = latestFunction('liquidar_consumos_reserva_atomico');
  const rpcMigration = fs.readFileSync(path.join(migrationDirectory, rpc.migration), 'utf8');
  if (/_c4_liquidar_consumos_monto_seguro\.sql$/.test(rpc.migration)) {
    await db.exec(rpcMigration);
  } else {
    await db.exec(rpc.definition);
  }
  await db.exec(`
    grant execute on function public.liquidar_consumos_reserva_atomico(uuid, uuid) to authenticated, service_role;
    grant select on public.reservas, public.pagos_reserva, public.servicios_x_reserva,
      public.ventas_tienda, public.ventas_restaurante, public.caja,
      public.auditoria_operaciones to authenticated;
    insert into public.hoteles(id) values ('${ids.hotelA}'), ('${ids.hotelB}');
    insert into public.usuarios(id, hotel_id, activo) values
      ('${ids.actorA}', '${ids.hotelA}', true),
      ('${ids.actorB}', '${ids.hotelB}', true);
  `);
  return { db, migration: rpc.migration };
}

async function asActor(db, actorId, action, role = 'authenticated') {
  await db.exec('begin');
  try {
    const claims = actorId ? { sub: actorId, role } : { role };
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await db.exec(`set local role ${role}`);
    const result = await action(db);
    await db.exec('commit');
    return result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

async function callLiquidation(db, reservationId = ids.reservationA, paymentId = ids.payment) {
  const result = await db.query(
    'select public.liquidar_consumos_reserva_atomico($1, $2) as result',
    [reservationId, paymentId],
  );
  return result.rows[0].result;
}

module.exports = { database, asActor, callLiquidation, ids, latestFunction };
