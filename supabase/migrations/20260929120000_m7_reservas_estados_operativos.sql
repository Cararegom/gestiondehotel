-- M7: unificar los estados que bloquean disponibilidad y cerrar el hueco de
-- reservas en estado "tiempo agotado" que aun conservan una estancia abierta.

create or replace function public.validar_cruce_reserva(
  p_habitacion_id uuid,
  p_entrada timestamptz,
  p_salida timestamptz,
  p_reserva_id_excluida uuid default null
)
returns boolean
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
begin
  if p_habitacion_id is null
     or p_entrada is null
     or p_salida is null
     or p_salida <= p_entrada then
    raise exception 'M7_INTERVALO_RESERVA_INVALIDO: habitacion y rango valido son obligatorios'
      using errcode = '22023';
  end if;

  return exists (
    select 1
      from public.reservas r
     where r.habitacion_id = p_habitacion_id
       and r.estado in (
         'pendiente'::public.estado_reserva_enum,
         'reservada'::public.estado_reserva_enum,
         'confirmada'::public.estado_reserva_enum,
         'check_in'::public.estado_reserva_enum,
         'activa'::public.estado_reserva_enum,
         'ocupada'::public.estado_reserva_enum,
         'tiempo agotado'::public.estado_reserva_enum
       )
       and (p_reserva_id_excluida is null or r.id <> p_reserva_id_excluida)
       and tstzrange(r.fecha_inicio, r.fecha_fin, '[)')
           && tstzrange(p_entrada, p_salida, '[)')
  );
end;
$$;

revoke all on function public.validar_cruce_reserva(uuid,timestamptz,timestamptz,uuid)
  from public, anon;
grant execute on function public.validar_cruce_reserva(uuid,timestamptz,timestamptz,uuid)
  to authenticated, service_role;
