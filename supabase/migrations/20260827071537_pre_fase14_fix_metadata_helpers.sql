create or replace function public.get_my_current_hotel_id()
returns uuid language sql stable security definer
set search_path = pg_catalog, public
as $$ select u.hotel_id from public.usuarios u where u.id = auth.uid() and u.activo is true limit 1; $$;

create or replace function public.get_my_current_rol()
returns text language sql stable security definer
set search_path = pg_catalog, public
as $$ select u.rol from public.usuarios u where u.id = auth.uid() and u.activo is true limit 1; $$;

revoke all on function public.get_my_current_hotel_id(), public.get_my_current_rol() from public, anon;
grant execute on function public.get_my_current_hotel_id(), public.get_my_current_rol() to authenticated, service_role;
