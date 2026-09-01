-- Corrige el contrato de la cola de alertas: hoteles.correo es citext,
-- mientras la Edge Function consume un valor text.
create or replace function public.energy_claim_overdue_alerts(p_limit integer default 50)
returns table (
  id uuid,
  hotel_id uuid,
  room_id uuid,
  created_at timestamptz,
  due_at timestamptz,
  source_user_id uuid,
  room_name text,
  hotel_name text,
  hotel_email text,
  source_user_name text,
  energy_email_notifications_enabled boolean,
  energy_alert_emails text,
  report_email text,
  attempt integer
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return query
  with candidates as (
    select e.id
    from public.room_energy_checks e
    join public.configuracion_hotel cfg on cfg.hotel_id = e.hotel_id
    where cfg.energy_control_enabled = true
      and e.status in ('pending', 'overdue')
      and e.due_at < now()
      and e.admin_alert_sent_at is null
      and e.admin_alert_attempts < 5
      and (
        e.admin_alert_status is null
        or e.admin_alert_status in ('failed', 'webhook_missing')
        or (
          e.admin_alert_status = 'processing'
          and e.admin_alert_claimed_at < now() - interval '5 minutes'
        )
      )
    order by e.due_at
    for update of e skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ), claimed as (
    update public.room_energy_checks e
    set status = 'overdue',
        overdue_at = coalesce(e.overdue_at, now()),
        admin_alert_status = 'processing',
        admin_alert_claimed_at = now(),
        admin_alert_attempts = e.admin_alert_attempts + 1
    from candidates c
    where e.id = c.id
    returning e.*
  )
  select
    c.id,
    c.hotel_id,
    c.room_id,
    c.created_at,
    c.due_at,
    c.source_user_id,
    r.nombre,
    h.nombre,
    h.correo::text,
    u.nombre,
    cfg.energy_email_notifications_enabled,
    cfg.energy_alert_emails,
    cfg.correo_reportes,
    c.admin_alert_attempts
  from claimed c
  join public.habitaciones r on r.id = c.room_id and r.hotel_id = c.hotel_id
  join public.hoteles h on h.id = c.hotel_id
  join public.configuracion_hotel cfg on cfg.hotel_id = c.hotel_id
  left join public.usuarios u on u.id = c.source_user_id;
end;
$function$;

revoke all on function public.energy_claim_overdue_alerts(integer) from public;
revoke all on function public.energy_claim_overdue_alerts(integer) from anon;
revoke all on function public.energy_claim_overdue_alerts(integer) from authenticated;
grant execute on function public.energy_claim_overdue_alerts(integer) to service_role;
