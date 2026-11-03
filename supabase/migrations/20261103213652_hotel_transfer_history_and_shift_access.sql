begin;

set local lock_timeout = '5s';
create table public.usuarios_historial_hoteles (
  hotel_id uuid not null references public.hoteles(id) on delete cascade,
  usuario_id uuid not null,
  nombre text,
  primary key (hotel_id, usuario_id)
);

alter table public.usuarios_historial_hoteles enable row level security;
revoke all on public.usuarios_historial_hoteles from public, anon, authenticated;
grant select on public.usuarios_historial_hoteles to authenticated;

create policy usuarios_historial_hoteles_select
  on public.usuarios_historial_hoteles for select to authenticated
  using (
    public.fase1_actor_es_miembro_activo(hotel_id)
    or (select public.actor_is_saas_superadmin())
  );

create function p0_private.registrar_usuario_historico_hotel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.usuarios_historial_hoteles (hotel_id, usuario_id, nombre)
  values (old.hotel_id, old.id, old.nombre)
  on conflict (hotel_id, usuario_id) do update set nombre = excluded.nombre;
  return new;
end;
$$;

revoke all on function p0_private.registrar_usuario_historico_hotel()
  from public, anon, authenticated;

create trigger registrar_usuario_historico_hotel
  after update of hotel_id on public.usuarios
  for each row
  when (old.hotel_id is not null and old.hotel_id is distinct from new.hotel_id)
  execute function p0_private.registrar_usuario_historico_hotel();

create view public.usuarios_historial
with (security_invoker = true) as
  select u.hotel_id, u.id, u.nombre::text, u.correo::text, u.email::text, u.activo, false as trasladado
  from public.usuarios u
  union all
  select h.hotel_id, h.usuario_id, h.nombre, null::text, null::text, false, true
  from public.usuarios_historial_hoteles h
  where not exists (
    select 1 from public.usuarios u where u.id = h.usuario_id and u.hotel_id = h.hotel_id
  );

revoke all on public.usuarios_historial from public, anon, authenticated;
grant select on public.usuarios_historial to authenticated;

create function public.usuarios_historial(t public.turnos)
returns setof public.usuarios_historial rows 1
language sql stable security invoker
set search_path = ''
as $$
  select u.* from public.usuarios_historial u where u.hotel_id = t.hotel_id and u.id = t.usuario_id;
$$;

create function public.usuarios_historial(m public.caja)
returns setof public.usuarios_historial rows 1
language sql stable security invoker
set search_path = ''
as $$
  select u.* from public.usuarios_historial u where u.hotel_id = m.hotel_id and u.id = m.usuario_id;
$$;

revoke all on function public.usuarios_historial(public.turnos),
  public.usuarios_historial(public.caja) from public, anon, authenticated;
grant execute on function public.usuarios_historial(public.turnos),
  public.usuarios_historial(public.caja) to authenticated;

create policy turnos_acceso_hotel_activo
  on public.turnos as restrictive for all to authenticated
  using (
    public.fase1_actor_es_miembro_activo(hotel_id)
    or (select public.actor_is_saas_superadmin())
  )
  with check (
    public.fase1_actor_es_miembro_activo(hotel_id)
    or (select public.actor_is_saas_superadmin())
  );

notify pgrst, 'reload schema';

commit;
