-- Permite aplicar una tarifa a varias habitaciones o excluir habitaciones concretas.
-- Se conserva habitacion_id para compatibilidad con reglas existentes.

alter table public.tarifas_programadas_habitacion
  add column if not exists habitaciones_aplicables uuid[] not null default array[]::uuid[],
  add column if not exists habitaciones_excluidas uuid[] not null default array[]::uuid[];

alter table public.tarifas_programadas_habitacion
  drop constraint if exists tarifas_programadas_scope_habitaciones_check;

alter table public.tarifas_programadas_habitacion
  add constraint tarifas_programadas_scope_habitaciones_check
  check (
    not (habitaciones_aplicables && habitaciones_excluidas)
    and (
      habitacion_id is null
      or (
        cardinality(habitaciones_aplicables) = 0
        and cardinality(habitaciones_excluidas) = 0
      )
    )
  );

comment on column public.tarifas_programadas_habitacion.habitaciones_aplicables is
'Lista opcional de habitaciones a las que aplica la tarifa. Vacía significa sin restricción positiva.';

comment on column public.tarifas_programadas_habitacion.habitaciones_excluidas is
'Lista opcional de habitaciones excluidas de una tarifa general. No puede solaparse con habitaciones_aplicables.';
