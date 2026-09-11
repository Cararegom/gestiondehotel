-- Ranking privado de desempeño para Control de Energía.
-- Solo el creador/propietario del hotel puede consultar este RPC.

create or replace function public.energy_admin_performance_ranking(p_days integer default 30)
returns table (
  user_id uuid,
  nombre text,
  rol text,
  total_checks bigint,
  avg_seconds numeric,
  fastest_seconds numeric,
  on_time_checks bigint,
  on_time_pct numeric,
  last_completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_hotel_id uuid;
  v_days integer;
begin
  select u.hotel_id into v_hotel_id
  from public.usuarios u
  join public.hoteles h on h.id = u.hotel_id and h.creado_por = u.id
  where u.id = auth.uid() and u.activo = true;

  if v_hotel_id is null then
    raise exception 'NO_AUTORIZADO';
  end if;

  v_days := case
    when p_days is null or p_days <= 0 then null
    else least(p_days, 3650)
  end;

  return query
  select
    e.completed_by_user_id as user_id,
    coalesce(nullif(trim(u.nombre), ''), 'Usuario')::text as nombre,
    coalesce(nullif(trim(u.rol), ''), max(nullif(trim(e.completed_by_role), '')), 'usuario')::text as rol,
    count(*)::bigint as total_checks,
    round(avg(extract(epoch from (e.completed_at - e.created_at)))::numeric, 1) as avg_seconds,
    round(min(extract(epoch from (e.completed_at - e.created_at)))::numeric, 1) as fastest_seconds,
    count(*) filter (where e.completed_at <= e.due_at)::bigint as on_time_checks,
    round((100.0 * count(*) filter (where e.completed_at <= e.due_at) / nullif(count(*), 0))::numeric, 1) as on_time_pct,
    max(e.completed_at) as last_completed_at
  from public.room_energy_checks e
  left join public.usuarios u on u.id = e.completed_by_user_id
  where e.hotel_id = v_hotel_id
    and e.status = 'completed'
    and e.completed_at is not null
    and e.completed_by_user_id is not null
    and (v_days is null or e.completed_at >= now() - make_interval(days => v_days))
  group by e.completed_by_user_id, u.nombre, u.rol
  order by count(*) desc,
           avg(extract(epoch from (e.completed_at - e.created_at))) asc,
           max(e.completed_at) desc;
end;
$function$;

revoke all on function public.energy_admin_performance_ranking(integer) from public;
revoke all on function public.energy_admin_performance_ranking(integer) from anon;
revoke all on function public.energy_admin_performance_ranking(integer) from authenticated;
grant execute on function public.energy_admin_performance_ranking(integer) to authenticated;
grant execute on function public.energy_admin_performance_ranking(integer) to service_role;
