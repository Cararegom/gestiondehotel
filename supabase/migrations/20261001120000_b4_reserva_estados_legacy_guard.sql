-- B4: documentar la maquina de estados real de reservas y evitar que los
-- valores heredados del enum vuelvan a ser escritos. No se eliminan valores
-- del enum ni filas historicas; check_in/tiempo agotado siguen considerandose
-- estancias abiertas al leer datos antiguos.

create or replace function public.reserva_estado_es_legacy(
  p_estado public.estado_reserva_enum
)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog, public
as $$
  select p_estado::text in (
    'check_in',
    'check_out',
    'facturada_pagada',
    'tiempo agotado'
  );
$$;

comment on function public.reserva_estado_es_legacy(public.estado_reserva_enum) is
  'B4: identifica estados heredados visibles para compatibilidad, pero no validos para nuevas escrituras.';

create or replace function public.b4_rechazar_estado_reserva_legacy()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if public.reserva_estado_es_legacy(new.estado)
     and (tg_op = 'INSERT' or new.estado is distinct from old.estado) then
    raise exception 'B4_ESTADO_RESERVA_LEGACY_NO_ESCRIBIBLE: %', new.estado
      using errcode = '22023';
  end if;

  return new;
end;
$$;

comment on function public.b4_rechazar_estado_reserva_legacy() is
  'B4: impide nuevas reservas o transiciones hacia estados heredados sin modificar filas historicas.';

drop trigger if exists b4_reservas_estado_legacy_guard on public.reservas;
create trigger b4_reservas_estado_legacy_guard
before insert or update of estado on public.reservas
for each row
execute function public.b4_rechazar_estado_reserva_legacy();

revoke all on function public.reserva_estado_es_legacy(public.estado_reserva_enum)
  from public, anon;
revoke all on function public.b4_rechazar_estado_reserva_legacy()
  from public, anon, authenticated;
grant execute on function public.reserva_estado_es_legacy(public.estado_reserva_enum)
  to authenticated, service_role;
grant execute on function public.b4_rechazar_estado_reserva_legacy()
  to service_role;
