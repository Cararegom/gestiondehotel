-- Tarifas programadas por habitación/tiempo sin modificar la tarifa base.
-- La tarifa programada actúa como override opcional y siempre conserva fallback a habitaciones/tiempos_estancia.

create table if not exists public.tarifas_programadas_habitacion (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hoteles(id) on delete cascade,
  habitacion_id uuid references public.habitaciones(id) on delete cascade,
  tiempo_estancia_id uuid references public.tiempos_estancia(id) on delete cascade,
  nombre text not null,
  modalidad text not null default 'noche',
  dias_semana integer[] not null default array[]::integer[],
  fecha_inicio date,
  fecha_fin date,
  precio_1_persona numeric(12,2),
  precio_2_personas numeric(12,2),
  precio_huesped_adicional numeric(12,2),
  precio_final numeric(12,2),
  prioridad integer not null default 0,
  activo boolean not null default true,
  creada_por uuid references public.usuarios(id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint tarifas_programadas_modalidad_check
    check (modalidad in ('noche', 'tiempo_estancia')),

  constraint tarifas_programadas_dias_check
    check (dias_semana <@ array[0,1,2,3,4,5,6]::integer[]),

  constraint tarifas_programadas_fechas_check
    check (fecha_fin is null or fecha_inicio is null or fecha_fin >= fecha_inicio),

  constraint tarifas_programadas_scope_check
    check (
      (modalidad = 'noche' and tiempo_estancia_id is null)
      or (modalidad = 'tiempo_estancia' and tiempo_estancia_id is not null)
    ),

  constraint tarifas_programadas_precio_no_negativo_check
    check (
      coalesce(precio_1_persona, 0) >= 0
      and coalesce(precio_2_personas, 0) >= 0
      and coalesce(precio_huesped_adicional, 0) >= 0
      and coalesce(precio_final, 0) >= 0
    ),

  constraint tarifas_programadas_precio_requerido_check
    check (
      (modalidad = 'tiempo_estancia' and precio_final is not null)
      or (
        modalidad = 'noche'
        and (
          precio_final is not null
          or precio_1_persona is not null
          or precio_2_personas is not null
        )
      )
    )
);

create index if not exists idx_tarifas_programadas_resolucion
  on public.tarifas_programadas_habitacion(hotel_id, activo, modalidad, prioridad desc);

create index if not exists idx_tarifas_programadas_habitacion
  on public.tarifas_programadas_habitacion(habitacion_id)
  where habitacion_id is not null;

create index if not exists idx_tarifas_programadas_tiempo
  on public.tarifas_programadas_habitacion(tiempo_estancia_id)
  where tiempo_estancia_id is not null;

create index if not exists idx_tarifas_programadas_creada_por
  on public.tarifas_programadas_habitacion(creada_por)
  where creada_por is not null;

alter table public.tarifas_programadas_habitacion enable row level security;

grant select, insert, update, delete
on public.tarifas_programadas_habitacion
to authenticated;

create policy tarifas_programadas_select_hotel
on public.tarifas_programadas_habitacion
for select
to authenticated
using (
  exists (
    select 1
    from public.usuarios u
    where u.id = (select auth.uid())
      and u.hotel_id = tarifas_programadas_habitacion.hotel_id
  )
);

create policy tarifas_programadas_insert_hotel
on public.tarifas_programadas_habitacion
for insert
to authenticated
with check (
  exists (
    select 1
    from public.usuarios u
    where u.id = (select auth.uid())
      and u.hotel_id = tarifas_programadas_habitacion.hotel_id
  )
  and (creada_por is null or creada_por = (select auth.uid()))
);

create policy tarifas_programadas_update_hotel
on public.tarifas_programadas_habitacion
for update
to authenticated
using (
  exists (
    select 1
    from public.usuarios u
    where u.id = (select auth.uid())
      and u.hotel_id = tarifas_programadas_habitacion.hotel_id
  )
)
with check (
  exists (
    select 1
    from public.usuarios u
    where u.id = (select auth.uid())
      and u.hotel_id = tarifas_programadas_habitacion.hotel_id
  )
);

create policy tarifas_programadas_delete_hotel
on public.tarifas_programadas_habitacion
for delete
to authenticated
using (
  exists (
    select 1
    from public.usuarios u
    where u.id = (select auth.uid())
      and u.hotel_id = tarifas_programadas_habitacion.hotel_id
  )
);

comment on table public.tarifas_programadas_habitacion is
'Tarifas programadas opcionales por día/fecha. No sustituyen ni modifican los precios base de habitaciones o tiempos_estancia.';
