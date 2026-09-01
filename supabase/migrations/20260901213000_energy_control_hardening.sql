-- Endurece Control de Energia: roles modernos, QR privados, alertas idempotentes
-- y limpieza segura de pilotos mal configurados.

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table if not exists private.room_energy_qr_secrets (
  room_id uuid primary key references public.habitaciones(id) on delete cascade,
  hotel_id uuid not null references public.hoteles(id) on delete cascade,
  token uuid not null unique,
  created_at timestamptz not null default now()
);

revoke all on private.room_energy_qr_secrets from public;
revoke all on private.room_energy_qr_secrets from anon;
revoke all on private.room_energy_qr_secrets from authenticated;

-- Conserva los QR ya emitidos, pero deja de guardar el secreto en una tabla
-- que los usuarios operativos pueden consultar directamente.
insert into private.room_energy_qr_secrets (room_id, hotel_id, token, created_at)
select h.id, h.hotel_id, h.energy_qr_token, coalesce(h.energy_qr_created_at, now())
from public.habitaciones h
where h.energy_qr_token is not null
on conflict (room_id) do update
set hotel_id = excluded.hotel_id,
    token = excluded.token,
    created_at = excluded.created_at;

update public.habitaciones
set energy_qr_token = null
where energy_qr_token is not null;

drop index if exists public.habitaciones_energy_qr_token_uidx;

alter table public.habitaciones
  drop constraint if exists habitaciones_energy_qr_token_deprecated_check;
alter table public.habitaciones
  add constraint habitaciones_energy_qr_token_deprecated_check
  check (energy_qr_token is null);

alter table public.room_energy_checks
  add column if not exists admin_alert_claimed_at timestamptz,
  add column if not exists admin_alert_attempts integer not null default 0;

alter table public.room_energy_checks
  drop constraint if exists room_energy_checks_alert_attempts_check;
alter table public.room_energy_checks
  add constraint room_energy_checks_alert_attempts_check
  check (admin_alert_attempts between 0 and 1000);

-- Esta tabla solo se escribe mediante funciones SECURITY DEFINER.
revoke all on public.room_energy_checks from anon;
revoke all on public.room_energy_checks from authenticated;
grant select on public.room_energy_checks to authenticated;

alter table public.room_energy_checks enable row level security;
drop policy if exists room_energy_checks_tenant_select on public.room_energy_checks;
create policy room_energy_checks_tenant_select
on public.room_energy_checks
for select
to authenticated
using (hotel_id = (select public.get_my_hotel_id()));

create unique index if not exists energy_check_notification_recipient_uidx
on public.notificaciones (hotel_id, usuario_id, entidad_tipo, entidad_id, tipo)
where entidad_tipo = 'energy_check' and usuario_id is not null;

create index if not exists room_energy_checks_alert_queue_idx
on public.room_energy_checks (due_at, admin_alert_sent_at)
where status in ('pending', 'overdue') and admin_alert_sent_at is null;

create or replace function public.energy_actor_allowed(p_admin_only boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and u.activo = true
      and (
        case when p_admin_only then
          lower(trim(coalesce(u.rol, ''))) in ('admin', 'administrador')
          or exists (
            select 1
            from public.usuarios_roles ur
            join public.roles r on r.id = ur.rol_id
            where ur.usuario_id = u.id
              and ur.hotel_id = u.hotel_id
              and lower(trim(r.nombre)) in ('admin', 'administrador')
          )
          or exists (
            select 1 from public.hoteles h
            where h.id = u.hotel_id and h.creado_por = u.id
          )
        else
          lower(trim(coalesce(u.rol, ''))) in (
            'admin', 'administrador', 'recepcionista', 'camarera', 'mantenimiento'
          )
          or exists (
            select 1
            from public.usuarios_roles ur
            join public.roles r on r.id = ur.rol_id
            where ur.usuario_id = u.id
              and ur.hotel_id = u.hotel_id
              and lower(trim(r.nombre)) in (
                'admin', 'administrador', 'recepcionista', 'camarera', 'mantenimiento'
              )
          )
          or exists (
            select 1 from public.hoteles h
            where h.id = u.hotel_id and h.creado_por = u.id
          )
        end
      )
  );
$function$;

revoke all on function public.energy_actor_allowed(boolean) from public;
revoke all on function public.energy_actor_allowed(boolean) from anon;
revoke all on function public.energy_actor_allowed(boolean) from authenticated;
grant execute on function public.energy_actor_allowed(boolean) to service_role;

create or replace function public.energy_actor_role_label()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (
      select r.nombre
      from public.usuarios_roles ur
      join public.roles r on r.id = ur.rol_id
      where ur.usuario_id = u.id
        and ur.hotel_id = u.hotel_id
        and lower(trim(r.nombre)) in (
          'admin', 'administrador', 'recepcionista', 'camarera', 'mantenimiento'
        )
      order by case lower(trim(r.nombre))
        when 'administrador' then 1
        when 'admin' then 1
        when 'recepcionista' then 2
        when 'camarera' then 3
        when 'mantenimiento' then 4
        else 9 end,
        r.nombre
      limit 1
    ),
    nullif(trim(u.rol), ''),
    'usuario'
  )
  from public.usuarios u
  where u.id = auth.uid() and u.activo = true;
$function$;

revoke all on function public.energy_actor_role_label() from public;
revoke all on function public.energy_actor_role_label() from anon;
revoke all on function public.energy_actor_role_label() from authenticated;
grant execute on function public.energy_actor_role_label() to service_role;

create or replace function public.energy_capabilities()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user public.usuarios%rowtype;
  v_enabled boolean := false;
begin
  select * into v_user
  from public.usuarios
  where id = auth.uid() and activo = true;

  if v_user.id is null then
    return jsonb_build_object(
      'hotel_id', null,
      'can_control', false,
      'can_admin', false,
      'enabled', false
    );
  end if;

  select coalesce(c.energy_control_enabled, false)
  into v_enabled
  from public.configuracion_hotel c
  where c.hotel_id = v_user.hotel_id;

  return jsonb_build_object(
    'hotel_id', v_user.hotel_id,
    'can_control', public.energy_actor_allowed(false),
    'can_admin', public.energy_actor_allowed(true),
    'enabled', coalesce(v_enabled, false),
    'role_label', public.energy_actor_role_label()
  );
end;
$function$;

revoke all on function public.energy_capabilities() from public;
revoke all on function public.energy_capabilities() from anon;
revoke all on function public.energy_capabilities() from authenticated;
grant execute on function public.energy_capabilities() to authenticated;
grant execute on function public.energy_capabilities() to service_role;

create or replace function public.energy_list_qr_tokens()
returns table (
  room_id uuid,
  room_name text,
  token uuid,
  generated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_hotel_id uuid;
begin
  if not public.energy_actor_allowed(true) then
    raise exception 'NO_AUTORIZADO';
  end if;

  select u.hotel_id into v_hotel_id
  from public.usuarios u
  where u.id = auth.uid() and u.activo = true;

  return query
  select h.id, h.nombre, s.token, s.created_at
  from public.habitaciones h
  left join private.room_energy_qr_secrets s
    on s.room_id = h.id and s.hotel_id = h.hotel_id
  where h.hotel_id = v_hotel_id
    and h.activo = true
  order by h.nombre;
end;
$function$;

revoke all on function public.energy_list_qr_tokens() from public;
revoke all on function public.energy_list_qr_tokens() from anon;
revoke all on function public.energy_list_qr_tokens() from authenticated;
grant execute on function public.energy_list_qr_tokens() to authenticated;
grant execute on function public.energy_list_qr_tokens() to service_role;

create or replace function public.energy_notify_recipients(
  p_check_id uuid,
  p_audience text,
  p_type text,
  p_message text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_check public.room_energy_checks%rowtype;
  v_inserted integer := 0;
begin
  if p_audience not in ('admin', 'reception') then
    raise exception 'AUDIENCIA_INVALIDA';
  end if;

  if p_type not in ('sistema_alerta', 'general_info') then
    raise exception 'TIPO_NOTIFICACION_INVALIDO';
  end if;

  select * into v_check
  from public.room_energy_checks
  where id = p_check_id;

  if v_check.id is null then
    raise exception 'CONTROL_NO_ENCONTRADO';
  end if;

  insert into public.notificaciones (
    hotel_id, usuario_id, user_id, rol_destino, tipo, mensaje,
    entidad_tipo, entidad_id, leida
  )
  select
    v_check.hotel_id,
    u.id,
    u.id,
    null,
    p_type::public.tipo_notificacion_enum,
    p_message,
    'energy_check',
    v_check.id,
    false
  from public.usuarios u
  where u.hotel_id = v_check.hotel_id
    and u.activo = true
    and (
      lower(trim(coalesce(u.rol, ''))) in (
        case when p_audience = 'admin' then 'admin' else 'recepcionista' end,
        case when p_audience = 'admin' then 'administrador' else 'admin' end,
        case when p_audience = 'admin' then 'admin' else 'administrador' end
      )
      or exists (
        select 1
        from public.usuarios_roles ur
        join public.roles r on r.id = ur.rol_id
        where ur.usuario_id = u.id
          and ur.hotel_id = v_check.hotel_id
          and (
            (p_audience = 'admin' and lower(trim(r.nombre)) in ('admin', 'administrador'))
            or (p_audience = 'reception' and lower(trim(r.nombre)) in ('admin', 'administrador', 'recepcionista'))
          )
      )
      or exists (
        select 1 from public.hoteles h
        where h.id = v_check.hotel_id and h.creado_por = u.id
      )
    )
  on conflict (hotel_id, usuario_id, entidad_tipo, entidad_id, tipo)
    where entidad_tipo = 'energy_check' and usuario_id is not null
  do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

revoke all on function public.energy_notify_recipients(uuid,text,text,text) from public;
revoke all on function public.energy_notify_recipients(uuid,text,text,text) from anon;
revoke all on function public.energy_notify_recipients(uuid,text,text,text) from authenticated;
grant execute on function public.energy_notify_recipients(uuid,text,text,text) to service_role;

create or replace function public.create_energy_check_on_cleaning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_enabled boolean := false;
  v_timeout integer := 10;
  v_has_qr boolean := false;
begin
  select coalesce(c.energy_control_enabled, false),
         coalesce(c.energy_check_timeout_minutes, 10)
  into v_enabled, v_timeout
  from public.configuracion_hotel c
  where c.hotel_id = new.hotel_id;

  select exists (
    select 1
    from private.room_energy_qr_secrets s
    where s.room_id = new.id and s.hotel_id = new.hotel_id
  ) into v_has_qr;

  -- Solo una habitacion que ya tiene QR preparado queda bajo control obligatorio.
  -- Esto permite desplegar los QR de forma progresiva sin bloquear habitaciones.
  if new.estado = 'limpieza'
     and old.estado is distinct from 'limpieza'
     and v_enabled
     and v_has_qr then
    insert into public.room_energy_checks (
      hotel_id, room_id, source_user_id, source_user_role,
      source_movement, due_at
    ) values (
      new.hotel_id,
      new.id,
      auth.uid(),
      public.energy_actor_role_label(),
      jsonb_build_object('from', old.estado, 'to', new.estado),
      now() + make_interval(mins => v_timeout)
    )
    on conflict (room_id) where status in ('pending', 'overdue') do nothing;
  end if;

  if old.estado = 'limpieza'
     and new.estado = 'libre'
     and v_enabled
     and exists (
       select 1 from public.room_energy_checks e
       where e.room_id = new.id
         and e.hotel_id = new.hotel_id
         and e.status in ('pending', 'overdue')
     ) then
    raise exception using errcode = 'P0001', message = 'CONTROL_ENERGIA_PENDIENTE';
  end if;

  return new;
end;
$function$;

revoke all on function public.create_energy_check_on_cleaning() from public;
revoke all on function public.create_energy_check_on_cleaning() from anon;
revoke all on function public.create_energy_check_on_cleaning() from authenticated;
grant execute on function public.create_energy_check_on_cleaning() to service_role;

drop trigger if exists habitaciones_energy_check_trigger on public.habitaciones;
create trigger habitaciones_energy_check_trigger
before update of estado on public.habitaciones
for each row execute function public.create_energy_check_on_cleaning();

create or replace function public.energy_scan(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user public.usuarios%rowtype;
  v_room public.habitaciones%rowtype;
  v_check public.room_energy_checks%rowtype;
begin
  select * into v_user
  from public.usuarios
  where id = auth.uid() and activo = true;

  if v_user.id is null or not public.energy_actor_allowed(false) then
    raise exception 'NO_AUTORIZADO';
  end if;

  select h.* into v_room
  from private.room_energy_qr_secrets s
  join public.habitaciones h on h.id = s.room_id and h.hotel_id = s.hotel_id
  join public.configuracion_hotel c on c.hotel_id = h.hotel_id
  where s.token = p_token
    and h.hotel_id = v_user.hotel_id
    and h.activo = true
    and c.energy_control_enabled = true;

  if v_room.id is null then
    raise exception 'QR_INVALIDO';
  end if;

  select * into v_check
  from public.room_energy_checks
  where room_id = v_room.id
    and hotel_id = v_room.hotel_id
    and status in ('pending', 'overdue')
  order by created_at desc
  limit 1;

  if v_check.id is null then
    raise exception 'SIN_CONTROL_PENDIENTE';
  end if;

  update public.room_energy_checks
  set scanned_at = coalesce(scanned_at, now())
  where id = v_check.id and status in ('pending', 'overdue');

  return jsonb_build_object(
    'check_id', v_check.id,
    'room_name', v_room.nombre,
    'created_at', v_check.created_at,
    'due_at', v_check.due_at
  );
end;
$function$;

create or replace function public.energy_confirm(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user public.usuarios%rowtype;
  v_room public.habitaciones%rowtype;
  v_check public.room_energy_checks%rowtype;
  v_completed_at timestamptz := now();
begin
  select * into v_user
  from public.usuarios
  where id = auth.uid() and activo = true;

  if v_user.id is null or not public.energy_actor_allowed(false) then
    raise exception 'NO_AUTORIZADO';
  end if;

  select h.* into v_room
  from private.room_energy_qr_secrets s
  join public.habitaciones h on h.id = s.room_id and h.hotel_id = s.hotel_id
  join public.configuracion_hotel c on c.hotel_id = h.hotel_id
  where s.token = p_token
    and h.hotel_id = v_user.hotel_id
    and h.activo = true
    and c.energy_control_enabled = true;

  if v_room.id is null then
    raise exception 'QR_INVALIDO';
  end if;

  select * into v_check
  from public.room_energy_checks
  where room_id = v_room.id
    and hotel_id = v_room.hotel_id
    and status in ('pending', 'overdue')
  order by created_at desc
  limit 1
  for update;

  if v_check.id is null then
    raise exception 'SIN_CONTROL_PENDIENTE';
  end if;

  update public.room_energy_checks
  set status = 'completed',
      scanned_at = coalesce(scanned_at, v_completed_at),
      completed_at = v_completed_at,
      completed_by_user_id = auth.uid(),
      completed_by_role = public.energy_actor_role_label(),
      admin_alert_claimed_at = null
  where id = v_check.id
    and status in ('pending', 'overdue');

  perform public.energy_notify_recipients(
    v_check.id,
    'reception',
    'general_info',
    coalesce(v_user.nombre, 'Un usuario') ||
      ' realizo Control de Energia en habitacion ' || v_room.nombre || '.'
  );

  return jsonb_build_object(
    'completed', true,
    'check_id', v_check.id,
    'room_name', v_room.nombre,
    'completed_at', v_completed_at
  );
end;
$function$;

create or replace function public.energy_regenerate_qr(p_room_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_token uuid := gen_random_uuid();
  v_hotel_id uuid;
  v_actor_hotel_id uuid;
begin
  if not public.energy_actor_allowed(true) then
    raise exception 'NO_AUTORIZADO';
  end if;

  select u.hotel_id into v_actor_hotel_id
  from public.usuarios u
  where u.id = auth.uid() and u.activo = true;

  select h.hotel_id into v_hotel_id
  from public.habitaciones h
  where h.id = p_room_id and h.activo = true;

  if v_hotel_id is null or v_hotel_id is distinct from v_actor_hotel_id then
    raise exception 'NO_AUTORIZADO';
  end if;

  insert into private.room_energy_qr_secrets (room_id, hotel_id, token, created_at)
  values (p_room_id, v_hotel_id, v_token, now())
  on conflict (room_id) do update
  set hotel_id = excluded.hotel_id,
      token = excluded.token,
      created_at = excluded.created_at;

  update public.habitaciones
  set energy_qr_created_at = now(),
      energy_qr_token = null
  where id = p_room_id and hotel_id = v_hotel_id;

  return v_token;
end;
$function$;

create or replace function public.energy_cancel(p_check_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rows integer := 0;
begin
  if not public.energy_actor_allowed(true) then
    raise exception 'NO_AUTORIZADO';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'MOTIVO_REQUERIDO';
  end if;

  update public.room_energy_checks
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by_user_id = auth.uid(),
      cancellation_reason = trim(p_reason),
      admin_alert_claimed_at = null
  where id = p_check_id
    and hotel_id = (select u.hotel_id from public.usuarios u where u.id = auth.uid() and u.activo = true)
    and status in ('pending', 'overdue');

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'SIN_CONTROL_PENDIENTE';
  end if;
end;
$function$;

revoke all on function public.energy_scan(uuid) from public;
revoke all on function public.energy_scan(uuid) from anon;
revoke all on function public.energy_scan(uuid) from authenticated;
grant execute on function public.energy_scan(uuid) to authenticated;
grant execute on function public.energy_scan(uuid) to service_role;

revoke all on function public.energy_confirm(uuid) from public;
revoke all on function public.energy_confirm(uuid) from anon;
revoke all on function public.energy_confirm(uuid) from authenticated;
grant execute on function public.energy_confirm(uuid) to authenticated;
grant execute on function public.energy_confirm(uuid) to service_role;

revoke all on function public.energy_regenerate_qr(uuid) from public;
revoke all on function public.energy_regenerate_qr(uuid) from anon;
revoke all on function public.energy_regenerate_qr(uuid) from authenticated;
grant execute on function public.energy_regenerate_qr(uuid) to authenticated;
grant execute on function public.energy_regenerate_qr(uuid) to service_role;

revoke all on function public.energy_cancel(uuid,text) from public;
revoke all on function public.energy_cancel(uuid,text) from anon;
revoke all on function public.energy_cancel(uuid,text) from authenticated;
grant execute on function public.energy_cancel(uuid,text) to authenticated;
grant execute on function public.energy_cancel(uuid,text) to service_role;

create or replace function public.energy_cancel_open_checks_when_disabled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.energy_control_enabled = true and new.energy_control_enabled = false then
    update public.room_energy_checks
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by_user_id = auth.uid(),
        cancellation_reason = 'Control de Energia desactivado',
        admin_alert_claimed_at = null
    where hotel_id = new.hotel_id
      and status in ('pending', 'overdue');
  end if;
  return new;
end;
$function$;

revoke all on function public.energy_cancel_open_checks_when_disabled() from public;
revoke all on function public.energy_cancel_open_checks_when_disabled() from anon;
revoke all on function public.energy_cancel_open_checks_when_disabled() from authenticated;
grant execute on function public.energy_cancel_open_checks_when_disabled() to service_role;

drop trigger if exists configuracion_hotel_energy_disable_trg on public.configuracion_hotel;
create trigger configuracion_hotel_energy_disable_trg
after update of energy_control_enabled on public.configuracion_hotel
for each row execute function public.energy_cancel_open_checks_when_disabled();

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
    h.correo,
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

-- Corrige el piloto que quedo habilitado por UUID sobre el hotel de prueba.
-- El trigger anterior cancela de forma auditable los controles abiertos de ese hotel.
update public.configuracion_hotel c
set energy_control_enabled = false,
    actualizado_en = now()
where c.hotel_id in (
  select h.id
  from public.hoteles h
  where lower(trim(h.nombre)) = 'hotel dora smith de prueba'
)
and c.energy_control_enabled = true;

-- El piloto real (Hotel Marena San Isidro) queda intencionalmente apagado hasta
-- que el administrador prepare e instale los QR. Al activarlo, solo las
-- habitaciones que ya tengan secreto QR quedan bajo control obligatorio.

-- Programa el procesador solo en entornos que tengan Cron, pg_net y los secretos
-- ya usados por las automatizaciones del proyecto. Staging vacio puede omitirlo.
do $do$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net')
     and to_regclass('cron.job') is not null
     and exists (select 1 from vault.decrypted_secrets where name = 'bank_email_project_url')
     and exists (select 1 from vault.decrypted_secrets where name = 'bank_email_cron_secret') then

    select jobid into v_job_id
    from cron.job
    where jobname = 'energy-overdue-alerts-every-minute'
    limit 1;

    if v_job_id is not null then
      perform cron.unschedule(v_job_id);
    end if;

    perform cron.schedule(
      'energy-overdue-alerts-every-minute',
      '* * * * *',
      $cron$
        select net.http_post(
          url := (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'bank_email_project_url'
            order by created_at desc
            limit 1
          ) || '/functions/v1/process-energy-alerts',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'bank_email_cron_secret'
              order by created_at desc
              limit 1
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 10000
        ) as request_id;
      $cron$
    );
  end if;
end;
$do$;
