-- Seguridad: elimina politicas RLS permisivas que abrian datos entre hoteles.
--
-- Las politicas permisivas se combinan con OR. Estas cuatro solo exigian
-- auth.uid() IS NOT NULL, por lo que anulaban las politicas por hotel que ya
-- existen en las mismas tablas:
--
--   habitaciones: cualquier usuario autenticado podia actualizar habitaciones
--     de cualquier hotel. Queda "Permitir acceso a habitaciones del propio
--     hotel" (ALL, hotel_id = get_my_hotel_id()).
--
--   integraciones_hotel: cualquier usuario autenticado (incluido un registro
--     nuevo de prueba) podia leer, crear y modificar las integraciones de otros
--     hoteles, incluidas facturador_api_key y crm_token. Quedan las politicas
--     "... own hotel integrations only" (select/insert/update/delete).
--
-- Verificado en produccion antes de aplicar: ningun usuario activo tiene roles
-- en un hotel distinto de usuarios.hotel_id y no hay usuarios activos sin hotel.

begin;

drop policy if exists "Permitir actualización a usuarios autenticados" on public.habitaciones;

drop policy if exists "Allow select for hotel integrations" on public.integraciones_hotel;
drop policy if exists "Allow insert for hotel integrations" on public.integraciones_hotel;
drop policy if exists "Allow update for hotel integrations" on public.integraciones_hotel;

-- Ninguna politica de estas tablas puede quedar abierta solo por estar autenticado.
do $check$
declare
  v_abiertas text;
begin
  select string_agg(tablename || '.' || policyname, ', ')
    into v_abiertas
    from pg_policies
   where schemaname = 'public'
     and tablename in ('habitaciones', 'integraciones_hotel')
     and (
       coalesce(qual, '') ~* '^\(?\s*(auth\.uid\(\) is not null|true)\s*\)?$'
       or coalesce(with_check, '') ~* '^\(?\s*(auth\.uid\(\) is not null|true)\s*\)?$'
     );

  if v_abiertas is not null then
    raise exception 'RLS_POLITICA_ABIERTA: siguen abiertas: %', v_abiertas;
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'habitaciones'
       and policyname = 'Permitir acceso a habitaciones del propio hotel'
  ) then
    raise exception 'RLS_SIN_POLITICA_HOTEL: habitaciones quedaria sin politica por hotel';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'integraciones_hotel'
         and policyname like '%own hotel integrations only') < 4 then
    raise exception 'RLS_SIN_POLITICA_HOTEL: integraciones_hotel quedaria sin politicas por hotel';
  end if;
end
$check$;

commit;
