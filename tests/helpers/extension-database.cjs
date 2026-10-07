const { PGlite } = require('@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const ids = { hotel: id(1), foreignHotel: id(2), actor: id(10), foreignActor: id(11),
  secondActor: id(12), room: id(20), reservation: id(30), method: id(40), secondMethod: id(41),
  foreignMethod: id(42), shift: id(50), operation: id(60) };
const migration = readFileSync(resolve(__dirname,
  '../../supabase/migrations/20261007194220_extension_estancia_atomica.sql'), 'utf8');
async function database() {
  const db = new PGlite();
  await db.exec(`
    set timezone='UTC';
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    grant usage on schema auth to authenticated,anon,service_role;
    create table public.usuarios(id uuid primary key, hotel_id uuid, activo boolean default true);
    create table public.habitaciones(id uuid primary key, hotel_id uuid, estado text default 'ocupada',
      activo boolean default true, actualizado_en timestamptz default now());
    create table public.reservas(id uuid primary key, hotel_id uuid, habitacion_id uuid,
      cliente_nombre text, estado text default 'activa', fecha_inicio timestamptz, fecha_fin timestamptz,
      monto_pagado numeric default 0, notas text, actualizado_en timestamptz default now());
    create table public.turnos(id uuid primary key, hotel_id uuid, usuario_id uuid,
      estado text default 'abierto',fecha_cierre timestamptz);
    create table public.metodos_pago(id uuid primary key,hotel_id uuid,activo boolean default true);
    create table public.pagos_reserva(id uuid primary key default gen_random_uuid(),hotel_id uuid,
      reserva_id uuid,monto numeric,fecha_pago timestamptz,metodo_pago_id uuid,usuario_id uuid,
      concepto text,client_operation_id uuid,source text,business_date date);
    create unique index pagos_reserva_source_operation_uq
      on public.pagos_reserva(hotel_id,source,client_operation_id);
    create table public.caja(id uuid primary key default gen_random_uuid(),hotel_id uuid,tipo text,
      monto numeric,concepto text,fecha_movimiento timestamptz,metodo_pago_id uuid,usuario_id uuid,
      reserva_id uuid,pago_reserva_id uuid,turno_id uuid,client_operation_id uuid,source text,
      business_date date,original_movement_id uuid);
    create table public.servicios_x_reserva(id uuid primary key default gen_random_uuid(),hotel_id uuid,
      reserva_id uuid,descripcion_manual text,cantidad integer,precio_cobrado numeric,estado_pago text,
      pago_reserva_id uuid,caja_movimiento_id uuid,fecha_servicio timestamptz);
    create table public.cronometros(id uuid primary key default gen_random_uuid(),hotel_id uuid,
      reserva_id uuid,habitacion_id uuid,fecha_inicio timestamptz,fecha_fin timestamptz,activo boolean,
      creado_en timestamptz default now(),actualizado_en timestamptz default now());
    create table public.auditoria_operaciones(id uuid primary key default gen_random_uuid(),hotel_id uuid,
      actor_id uuid,accion text,entidad text,entity_id uuid,before_data jsonb,after_data jsonb,
      client_operation_id uuid);
    create unique index auditoria_operaciones_request_uq
      on public.auditoria_operaciones(hotel_id,accion,client_operation_id);
    create function public.fase1_actor_es_miembro_activo(p_hotel_id uuid)
      returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
      select exists(select 1 from public.usuarios where id=auth.uid() and hotel_id=p_hotel_id and activo)
    $$;
    create function public.hotel_business_date(p_hotel uuid,p_date timestamptz)
      returns date language sql stable as $$ select (p_date at time zone 'America/Bogota')::date $$;
    create function public.mantenimiento_habitacion_tiene_bloqueo(p_room uuid)
      returns boolean language sql stable as $$ select false $$;
    insert into public.usuarios(id,hotel_id) values
      ('${ids.actor}','${ids.hotel}'),('${ids.foreignActor}','${ids.foreignHotel}'),
      ('${ids.secondActor}','${ids.hotel}');
    insert into public.habitaciones(id,hotel_id) values ('${ids.room}','${ids.hotel}');
    insert into public.metodos_pago(id,hotel_id) values
      ('${ids.method}','${ids.hotel}'),('${ids.secondMethod}','${ids.hotel}'),
      ('${ids.foreignMethod}','${ids.foreignHotel}');
    insert into public.turnos(id,hotel_id,usuario_id) values
      ('${ids.shift}','${ids.hotel}','${ids.actor}');
  `);
  await db.exec(migration);
  await db.exec(`
    alter table public.reservas enable row level security;
    create policy reservas_hotel on public.reservas to authenticated
      using (public.fase1_actor_es_miembro_activo(hotel_id))
      with check (public.fase1_actor_es_miembro_activo(hotel_id));
    grant select on public.reservas to authenticated;
  `);
  return db;
}
async function reset(db) {
  await db.exec(`
    truncate public.auditoria_operaciones,public.cronometros,public.servicios_x_reserva,
      public.caja,public.pagos_reserva,public.reservas;
    update public.usuarios set activo=true;
    update public.habitaciones set estado='ocupada';
    update public.turnos set estado='abierto',fecha_cierre=null;
    update public.metodos_pago set activo=true;
    insert into public.reservas(id,hotel_id,habitacion_id,cliente_nombre,fecha_inicio,fecha_fin)
      values('${ids.reservation}','${ids.hotel}','${ids.room}','Cliente prueba',
        '2026-10-06T20:00:00Z','2026-10-07T17:00:00Z');
    insert into public.cronometros(hotel_id,reserva_id,habitacion_id,fecha_inicio,fecha_fin,activo)
      values('${ids.hotel}','${ids.reservation}','${ids.room}',
        '2026-10-06T20:00:00Z','2026-10-07T17:00:00Z',true);
  `);
}
async function asActor(db, actor, action) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims',$1,true)",
      [JSON.stringify(actor ? {sub:actor,role:'authenticated'} : {role:'anon'})]);
    await tx.exec(`set local role ${actor ? 'authenticated' : 'anon'}`);
    return action(tx);
  });
}
async function extend(db, options = {}) {
  const result = await db.query(`select public.extender_estancia_reserva_atomica(
    $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) as result`, [
    options.reservation || ids.reservation, options.previous || '2026-10-07T17:00:00Z',
    options.next || '2026-10-08T17:00:00Z', options.amount ?? 60000,
    options.description || '1 noche(s) adicional(es)',
    JSON.stringify(options.payments ?? [{metodo_pago_id:ids.method,monto:60000}]),
    options.shift === null ? null : options.shift || ids.shift,
    options.operation || ids.operation, options.notes ?? null,
    options.occurredAt || '2026-10-07T19:30:00Z'
  ]);
  return result.rows[0].result;
}
async function state(db) {
  const result = await db.query(`select
    (select count(*)::int from public.pagos_reserva) as payments,
    (select count(*)::int from public.caja) as movements,
    (select coalesce(sum(monto),0) from public.caja) as revenue,
    (select count(*)::int from public.servicios_x_reserva) as services,
    (select count(*)::int from public.cronometros where activo) as timers,
    (select count(*)::int from public.auditoria_operaciones where accion='reserva.extender') as extensions,
    (select monto_pagado from public.reservas where id='${ids.reservation}') as paid,
    (select fecha_fin::text from public.reservas where id='${ids.reservation}') as checkout`);
  return result.rows[0];
}
module.exports = { database, reset, asActor, extend, state, ids, id, migration };
