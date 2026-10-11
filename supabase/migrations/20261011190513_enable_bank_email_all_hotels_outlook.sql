-- Enable independent reconciliation for existing and future hotels.
-- Preserve the current audited allocation, locking and tenant checks.
insert into public.hotel_features(hotel_id, feature_key, enabled, configuration, enabled_at)
select h.id, 'bank_reconciliation_v2', true,
  jsonb_build_object('gmailLabelName', case lower(btrim(h.nombre))
    when 'hotel marena san isidro' then 'PAGOS HOTEL MARENA'
    when 'hotel corales del mar' then 'PAGOS HOTEL CORALES'
    else 'PAGOS HOTEL ' || upper(regexp_replace(btrim(h.nombre), '^hotel\s+', '', 'i')) end,
    'bankKey', case lower(btrim(h.nombre)) when 'hotel marena san isidro' then '@hotelok'
      when 'hotel corales del mar' then '0090237193' else '' end), now()
from public.hoteles h
on conflict(hotel_id,feature_key) do update set enabled=true,
  configuration=excluded.configuration || hotel_features.configuration,
  enabled_at=coalesce(hotel_features.enabled_at,now()),updated_at=now();

create or replace function app_private.enable_hotel_bank_reconciliation()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,app_private as $function$
begin
  insert into public.hotel_features(hotel_id,feature_key,enabled,configuration,enabled_at)
  values(new.id,'bank_reconciliation_v2',true,jsonb_build_object(
    'gmailLabelName','PAGOS HOTEL ' || upper(regexp_replace(btrim(new.nombre),'^hotel\s+','','i')),'bankKey',''),now())
  on conflict(hotel_id,feature_key) do nothing;
  return new;
end;
$function$;
revoke all on function app_private.enable_hotel_bank_reconciliation() from public,anon,authenticated;
drop trigger if exists enable_hotel_bank_reconciliation on public.hoteles;
create trigger enable_hotel_bank_reconciliation after insert on public.hoteles
for each row execute function app_private.enable_hotel_bank_reconciliation();

alter table public.bank_email_integrations add column if not exists bank_key text not null default '';
alter table public.bank_email_integrations add column if not exists outlook_delta_link text;
alter table public.bank_email_integrations add column if not exists sync_lock_token uuid;
alter table public.bank_email_integrations add column if not exists sync_locked_until timestamptz;
update public.bank_email_integrations i set bank_key=coalesce(f.configuration->>'bankKey','')
from public.hotel_features f where f.hotel_id=i.hotel_id and f.feature_key='bank_reconciliation_v2' and i.bank_key='';
alter table public.bank_email_integrations drop constraint bank_email_integrations_provider_check;
alter table public.bank_email_integrations add constraint bank_email_integrations_provider_check check(provider in ('google','microsoft'));
alter table public.bank_email_oauth_states drop constraint bank_email_oauth_states_provider_check;
alter table public.bank_email_oauth_states add constraint bank_email_oauth_states_provider_check check(provider in ('google','microsoft'));
alter table public.bank_payment_events drop constraint bank_payment_events_provider_check;
alter table public.bank_payment_events add constraint bank_payment_events_provider_check check(provider in ('gmail','outlook','simulation'));
-- Gmail permits one Watch per OAuth client and mailbox; do not let another hotel replace it.
create unique index if not exists bank_email_integrations_provider_mailbox_unique
on public.bank_email_integrations(provider,lower(btrim(connected_email)));
alter table public.bank_payment_audit_log drop constraint bank_payment_audit_log_action_check;
alter table public.bank_payment_audit_log add constraint bank_payment_audit_log_action_check check(action in (
 'payment_detected','auto_matched','manual_confirmed','relation_changed','payment_rejected','duplicate_detected','parse_error',
 'gmail_watch_renewed','gmail_watch_renewal_failed','gmail_connected','gmail_connection_failed','gmail_connection_test_failed','gmail_disconnected',
 'outlook_connected','outlook_connection_failed','outlook_disconnected','outlook_sync_failed','bank_email_settings_changed',
 'matching_ambiguous','no_match','marked_reviewed','expected_payment_created','expected_payment_cancelled',
 'multiple_allocation_changed','manual_reconciliation_state_changed','cash_movement_linked'));

-- Keep the RPC signature for existing clients. New code supplies a trusted hotel UUID.
create or replace function public.resolve_bank_email_pilot_hotel(p_pilot_hotel_name text default 'Hotel Marena San Isidro')
returns uuid language plpgsql stable security definer set search_path=public,pg_temp as $function$
declare v_ids uuid[]; v_requested text:=btrim(coalesce(p_pilot_hotel_name,''));
begin
  select array_agg(h.id order by h.id::text) into v_ids from public.hoteles h
  join public.hotel_features f on f.hotel_id=h.id and f.feature_key='bank_reconciliation_v2' and f.enabled
  where h.id::text=lower(v_requested) or lower(btrim(h.nombre))=lower(v_requested);
  if coalesce(cardinality(v_ids),0)<>1 then
    raise exception 'El hotel de conciliacion no esta habilitado o es ambiguo.' using errcode='42501';
  end if;
  return v_ids[1];
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.bank_email_actor_is_pilot_admin(p_actor_id uuid, p_hotel_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
  select coalesce(
    exists (
      select 1 from public.usuarios u
      where u.id = p_actor_id
        and u.hotel_id = p_hotel_id
        and u.activo is true
        and exists (
          select 1 from public.hoteles h
          where h.id = p_hotel_id
            and exists (select 1 from public.hotel_features f where f.hotel_id=h.id and f.feature_key='bank_reconciliation_v2' and f.enabled)
        )
        and (
          lower(btrim(coalesce(u.rol::text, ''))) in ('admin','administrador','superadmin','super administrador','superadministrador')
          or exists (select 1 from public.hoteles h where h.id = p_hotel_id and h.creado_por = p_actor_id)
          or exists (
            select 1 from public.usuarios_roles ur
            join public.roles r on r.id = ur.rol_id
            where ur.usuario_id = p_actor_id
              and ur.hotel_id = p_hotel_id
              and lower(btrim(coalesce(r.nombre, ''))) in ('admin','administrador','superadmin','super administrador','superadministrador')
          )
        )
    ), false
  );
$function$;

CREATE OR REPLACE FUNCTION app_private.bank_email_actor_is_pilot_operational(p_actor_id uuid, p_hotel_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
  select coalesce(
    exists (
      select 1
      from public.usuarios u
      where u.id = p_actor_id
        and u.hotel_id = p_hotel_id
        and u.activo is true
        and exists (
          select 1
          from public.hoteles h
          where h.id = p_hotel_id
            and exists (select 1 from public.hotel_features f where f.hotel_id=h.id and f.feature_key='bank_reconciliation_v2' and f.enabled)
        )
        and (
          lower(btrim(coalesce(u.rol::text, ''))) in (
            'admin', 'administrador', 'superadmin', 'recepcionista'
          )
          or exists (
            select 1
            from public.hoteles h
            where h.id = p_hotel_id
              and h.creado_por = p_actor_id
          )
          or exists (
            select 1
            from public.usuarios_roles ur
            join public.roles r on r.id = ur.rol_id
            where ur.usuario_id = p_actor_id
              and ur.hotel_id = p_hotel_id
              and lower(btrim(coalesce(r.nombre, ''))) in (
                'admin', 'administrador', 'superadmin', 'recepcionista'
              )
          )
        )
    ),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION app_private.bank_email_user_has_pilot_access(p_hotel_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
  select coalesce(
    auth.uid() is not null
    and exists (
      select 1 from public.hoteles h
      where h.id = p_hotel_id
        and exists (select 1 from public.hotel_features f where f.hotel_id=h.id and f.feature_key='bank_reconciliation_v2' and f.enabled)
    )
    and exists (
      select 1 from public.usuarios u
      where u.id = auth.uid()
        and u.hotel_id = p_hotel_id
        and u.activo is true
    ), false
  );
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_assert_pilot_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pilot_hotel_id uuid;
BEGIN
  v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel(NEW.hotel_id::text);

  IF NEW.hotel_id IS DISTINCT FROM v_pilot_hotel_id THEN
    RAISE EXCEPTION 'La fila no pertenece al hotel piloto autorizado.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.hotel_id IS DISTINCT FROM OLD.hotel_id THEN
    RAISE EXCEPTION 'hotel_id es inmutable.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_cancel_pending_on_reservation_payment()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hotel_id uuid;
  v_cancelled integer;
  v_changed integer;
  v_actor_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.hotel_id, OLD.reserva_id, OLD.monto)
      IS NOT DISTINCT FROM (NEW.hotel_id, NEW.reserva_id, NEW.monto) THEN RETURN NEW; END IF;
  -- Acquire tenant locks in a stable order, including both sides of a moved receipt.
  FOR v_hotel_id IN
    SELECT h.id FROM public.hoteles h JOIN public.hotel_features f ON f.hotel_id=h.id
    WHERE f.feature_key='bank_reconciliation_v2' AND f.enabled
      AND (h.id=NEW.hotel_id OR (TG_OP='UPDATE' AND h.id=OLD.hotel_id)) ORDER BY h.id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_hotel_id::text || ':expected-matching',0));
  END LOOP;
  FOR v_hotel_id IN
    SELECT h.id FROM public.hoteles h JOIN public.hotel_features f ON f.hotel_id=h.id
    WHERE f.feature_key='bank_reconciliation_v2' AND f.enabled
      AND (h.id=NEW.hotel_id OR (TG_OP='UPDATE' AND h.id=OLD.hotel_id)) ORDER BY h.id
  LOOP
    v_cancelled := 0;
    IF NEW.hotel_id=v_hotel_id THEN
      UPDATE public.expected_payments SET status='cancelled',matched_bank_payment_id=NULL,updated_at=now()
      WHERE hotel_id=v_hotel_id AND reservation_id=NEW.reserva_id AND status='pending';
      GET DIAGNOSTICS v_changed=ROW_COUNT; v_cancelled:=v_cancelled+v_changed;
    END IF;
    IF TG_OP='UPDATE' AND OLD.hotel_id=v_hotel_id
        AND (OLD.hotel_id,OLD.reserva_id) IS DISTINCT FROM (NEW.hotel_id,NEW.reserva_id) THEN
      UPDATE public.expected_payments SET status='cancelled',matched_bank_payment_id=NULL,updated_at=now()
      WHERE hotel_id=v_hotel_id AND reservation_id=OLD.reserva_id AND status='pending';
      GET DIAGNOSTICS v_changed=ROW_COUNT; v_cancelled:=v_cancelled+v_changed;
    END IF;
    IF v_cancelled>0 THEN
      SELECT u.id INTO v_actor_id FROM public.usuarios u WHERE u.id=NEW.usuario_id AND u.hotel_id=v_hotel_id;
      INSERT INTO public.bank_payment_audit_log(hotel_id,user_id,action,payment_event_id,details)
      VALUES(v_hotel_id,v_actor_id,'expected_payment_cancelled',NULL,jsonb_build_object(
        'reason','reservation_payment_recorded','reservation_id',
        CASE WHEN NEW.hotel_id=v_hotel_id THEN NEW.reserva_id ELSE OLD.reserva_id END,'cancelled_count',v_cancelled));
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_handle_reservation_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pilot_hotel_id uuid;
  v_reason text;
  v_event_ids uuid[];
  v_all_event_ids uuid[];
  v_event_id uuid;
  v_cancelled integer := 0;
begin
  begin
    v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel(OLD.hotel_id::text);
  exception when others then
    return new;
  end;
  if old.hotel_id is distinct from v_pilot_hotel_id then
    return new;
  end if;

  v_reason := case
    when new.hotel_id is distinct from old.hotel_id then 'reservation_hotel_changed'
    when new.estado::text not in (
      'activa', 'check_in', 'ocupada', 'pendiente', 'reservada',
      'confirmada', 'tiempo agotado'
    ) then 'reservation_inactive'
    when new.habitacion_id is distinct from old.habitacion_id then 'reservation_room_changed'
    when new.monto_total is distinct from old.monto_total
      or new.monto_pagado is distinct from old.monto_pagado then 'reservation_balance_changed'
    else null
  end;
  if v_reason is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_pilot_hotel_id::text || ':expected-matching',
    0
  ));

  select array_agg(distinct e.id order by e.id)
    into v_event_ids
    from public.bank_payment_events e
   where e.hotel_id = v_pilot_hotel_id
     and e.status = 'matched'
     and (
       e.matched_reservation_id = old.id
       or e.matched_expected_payment_id in (
         select ep.id
           from public.expected_payments ep
          where ep.hotel_id = v_pilot_hotel_id
            and ep.reservation_id = old.id
       )
     )
     and not (
       v_reason = 'reservation_inactive'
       and public.bank_payment_has_valid_caja_link(e.id, v_pilot_hotel_id)
     );

  if new.hotel_id is distinct from old.hotel_id
     or new.habitacion_id is distinct from old.habitacion_id then
    select array_agg(distinct event_id order by event_id)
      into v_all_event_ids
      from (
        select unnest(coalesce(v_event_ids, array[]::uuid[])) as event_id
        union
        select e.id
          from public.bank_payment_events e
         where e.hotel_id = v_pilot_hotel_id
           and e.matched_reservation_id = old.id
      ) affected;
  else
    v_all_event_ids := v_event_ids;
  end if;

  update public.bank_payment_events e
     set status = 'manual_review',
         matched_expected_payment_id = null,
         matched_reservation_id = case
           when new.hotel_id is distinct from old.hotel_id then null
           else e.matched_reservation_id
         end,
         matched_room_id = case
           when new.habitacion_id is distinct from old.habitacion_id then null
           else e.matched_room_id
         end,
         review_reason = v_reason,
         metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object(
           'reservation_invalidated', true,
           'reservation_invalidation_reason', v_reason,
           'reservation_invalidated_at', now()
         )
   where e.id = any(coalesce(v_event_ids, array[]::uuid[]));

  if new.hotel_id is distinct from old.hotel_id
     or new.habitacion_id is distinct from old.habitacion_id then
    update public.bank_payment_events e
       set matched_reservation_id = case
             when new.hotel_id is distinct from old.hotel_id then null
             else e.matched_reservation_id
           end,
           matched_room_id = case
             when new.habitacion_id is distinct from old.habitacion_id then null
             else e.matched_room_id
           end,
           metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object(
             'reservation_relation_changed', true,
             'relation_invalidated', true,
             'reservation_relation_change_reason', v_reason,
             'reservation_relation_changed_at', now()
           )
     where e.hotel_id = v_pilot_hotel_id
       and e.matched_reservation_id = old.id
       and e.status <> 'matched';
  end if;

  update public.expected_payments ep
     set status = 'cancelled',
         matched_bank_payment_id = null,
         reservation_id = case
           when new.hotel_id is distinct from old.hotel_id then null
           else ep.reservation_id
         end,
         room_id = case
           when new.habitacion_id is distinct from old.habitacion_id then null
           else ep.room_id
         end,
         updated_at = now()
   where ep.hotel_id = v_pilot_hotel_id
     and ep.reservation_id = old.id
     and ep.status in ('pending', 'matched');
  get diagnostics v_cancelled = row_count;

  if new.hotel_id is distinct from old.hotel_id
     or new.habitacion_id is distinct from old.habitacion_id then
    update public.expected_payments ep
       set reservation_id = case
             when new.hotel_id is distinct from old.hotel_id then null
             else ep.reservation_id
           end,
           room_id = case
             when new.habitacion_id is distinct from old.habitacion_id then null
             else ep.room_id
           end,
           updated_at = now()
     where ep.hotel_id = v_pilot_hotel_id
       and ep.reservation_id = old.id
       and ep.status in ('confirmed', 'cancelled', 'expired');
  end if;

  if v_cancelled > 0 then
    perform public.bank_email_write_audit(
      v_pilot_hotel_id, null, 'expected_payment_cancelled', null,
      jsonb_build_object(
        'reason', v_reason,
        'reservation_id', old.id,
        'cancelled_count', v_cancelled
      )
    );
  end if;
  foreach v_event_id in array coalesce(v_all_event_ids, array[]::uuid[]) loop
    perform public.bank_email_write_audit(
      v_pilot_hotel_id, null, 'relation_changed', v_event_id,
      jsonb_build_object('reason', v_reason, 'reservation_id', old.id)
    );
  end loop;
  foreach v_event_id in array coalesce(v_event_ids, array[]::uuid[]) loop
    perform public.bank_email_notify_payment_event(v_event_id);
  end loop;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_mark_deleted_relation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pilot_hotel_id uuid;
  v_relation_type text;
  v_relation_id uuid := OLD.id;
  v_all_event_ids uuid[];
  v_notify_event_ids uuid[];
  v_event_id uuid;
  v_cancelled integer := 0;
BEGIN
  BEGIN
    v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel(OLD.hotel_id::text);
  EXCEPTION WHEN OTHERS THEN
    RETURN OLD;
  END;
  IF OLD.hotel_id IS DISTINCT FROM v_pilot_hotel_id THEN
    RETURN OLD;
  END IF;
  v_relation_type := CASE
    WHEN TG_TABLE_NAME = 'reservas' THEN 'reservation'
    ELSE 'room'
  END;

  -- DELETE already owns the parent row. Waiting for the ledger lock here could
  -- deadlock with an in-flight FK write, so fail fast and let the operator retry.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
    v_pilot_hotel_id::text || ':expected-matching',
    0
  )) THEN
    RAISE EXCEPTION 'Hay un pago bancario en proceso; vuelve a intentar eliminar en unos segundos.'
      USING ERRCODE = '55P03';
  END IF;

  SELECT array_agg(DISTINCT event_id ORDER BY event_id)
    INTO v_all_event_ids
    FROM (
      SELECT e.id AS event_id
        FROM public.bank_payment_events e
       WHERE e.hotel_id = v_pilot_hotel_id
         AND (
           (TG_TABLE_NAME = 'reservas' AND e.matched_reservation_id = v_relation_id)
           OR (TG_TABLE_NAME = 'habitaciones' AND e.matched_room_id = v_relation_id)
         )
      UNION
      SELECT ep.matched_bank_payment_id
        FROM public.expected_payments ep
       WHERE ep.hotel_id = v_pilot_hotel_id
         AND ep.matched_bank_payment_id IS NOT NULL
         AND (
           (TG_TABLE_NAME = 'reservas' AND ep.reservation_id = v_relation_id)
           OR (TG_TABLE_NAME = 'habitaciones' AND ep.room_id = v_relation_id)
         )
    ) related;

  SELECT array_agg(e.id ORDER BY e.id)
    INTO v_notify_event_ids
    FROM public.bank_payment_events e
   WHERE e.id = ANY(COALESCE(v_all_event_ids, ARRAY[]::uuid[]))
     AND e.status = 'matched';

  UPDATE public.bank_payment_events e
     SET status = CASE WHEN e.status = 'matched' THEN 'manual_review' ELSE e.status END,
         matched_expected_payment_id = CASE
           WHEN e.status = 'matched' THEN NULL
           ELSE e.matched_expected_payment_id
         END,
         review_reason = CASE
           WHEN e.status = 'matched' THEN 'related_' || v_relation_type || '_deleted'
           ELSE e.review_reason
         END,
         metadata = e.metadata || jsonb_build_object(
           'relation_deleted', true,
           'deleted_relation_type', v_relation_type,
           'deleted_relation_id', v_relation_id,
           'relation_deleted_at', now()
         )
   WHERE e.id = ANY(COALESCE(v_all_event_ids, ARRAY[]::uuid[]));

  UPDATE public.expected_payments ep
     SET status = 'cancelled',
         matched_bank_payment_id = NULL,
         updated_at = now()
   WHERE ep.hotel_id = v_pilot_hotel_id
     AND ep.status IN ('pending', 'matched')
     AND (
       (TG_TABLE_NAME = 'reservas' AND ep.reservation_id = v_relation_id)
       OR (TG_TABLE_NAME = 'habitaciones' AND ep.room_id = v_relation_id)
     );
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  IF v_cancelled > 0 THEN
    PERFORM public.bank_email_write_audit(
      v_pilot_hotel_id, NULL, 'expected_payment_cancelled', NULL,
      jsonb_build_object(
        'reason', 'related_' || v_relation_type || '_deleted',
        'relation_id', v_relation_id,
        'cancelled_count', v_cancelled
      )
    );
  END IF;
  FOREACH v_event_id IN ARRAY COALESCE(v_all_event_ids, ARRAY[]::uuid[]) LOOP
    PERFORM public.bank_email_write_audit(
      v_pilot_hotel_id, NULL, 'relation_changed', v_event_id,
      jsonb_build_object(
        'reason', 'related_' || v_relation_type || '_deleted',
        'relation_id', v_relation_id
      )
    );
  END LOOP;
  FOREACH v_event_id IN ARRAY COALESCE(v_notify_event_ids, ARRAY[]::uuid[]) LOOP
    PERFORM public.bank_email_notify_payment_event(v_event_id);
  END LOOP;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_notification_is_visible(p_entity_type text, p_hotel_id uuid, p_usuario_id uuid, p_user_id uuid, p_entity_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_pilot_hotel_id uuid;
BEGIN
  IF COALESCE(p_entity_type, '') NOT IN (
    'bank_payment_event', 'bank_payment_events', 'bank_email_integration'
  ) THEN
    RETURN true;
  END IF;
  IF v_actor_id IS NULL OR p_usuario_id IS DISTINCT FROM v_actor_id
     OR p_user_id IS DISTINCT FROM v_actor_id THEN
    RETURN false;
  END IF;

  BEGIN
    v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel(p_hotel_id::text);
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  IF p_hotel_id <> v_pilot_hotel_id
     OR NOT app_private.bank_email_user_has_pilot_access(p_hotel_id) THEN
    RETURN false;
  END IF;
  IF p_entity_type = 'bank_email_integration' THEN
    RETURN p_entity_id IS NULL;
  END IF;
  RETURN EXISTS (
      SELECT 1
        FROM public.bank_payment_events e
       WHERE e.id = p_entity_id
         AND e.hotel_id = p_hotel_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_reservation_available_amount_cop(p_reservation_id uuid, p_hotel_id uuid, p_exclude_payment_event_id uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_pilot_hotel_id uuid;
  v_reservation_total numeric;
  v_reservation_paid numeric;
  v_payment_rows_total numeric;
  v_expected_total numeric;
  v_unbacked_allocated numeric;
  v_legacy_allocated numeric;
begin
  v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel(p_hotel_id::text);
  if p_hotel_id is distinct from v_pilot_hotel_id then
    return null;
  end if;

  select coalesce(r.monto_total, 0), coalesce(r.monto_pagado, 0)
    into v_reservation_total, v_reservation_paid
    from public.reservas r
   where r.id = p_reservation_id
     and r.hotel_id = v_pilot_hotel_id;
  if not found then
    return null;
  end if;

  select coalesce(sum(pr.monto), 0)
    into v_payment_rows_total
    from public.pagos_reserva pr
   where pr.hotel_id = v_pilot_hotel_id
     and pr.reserva_id = p_reservation_id;

  -- Los pagos esperados pendientes vigentes y los ya enlazados tambien reservan
  -- capacidad. Al editar un evento se excluye su propio pago esperado.
  select coalesce(sum(ep.expected_amount_cop), 0)
    into v_expected_total
    from public.expected_payments ep
   where ep.hotel_id = v_pilot_hotel_id
     and ep.reservation_id = p_reservation_id
     and (
       ep.status in ('matched', 'confirmed')
       or (
         ep.status = 'pending'
         and (ep.expires_at is null or ep.expires_at >= now())
       )
     )
     and (
       p_exclude_payment_event_id is null
       or ep.matched_bank_payment_id is distinct from p_exclude_payment_event_id
     );

  -- Una allocation con caja_id ya esta incluida en pagos_reserva/monto_pagado.
  -- Solo las asignaciones bancarias aun no respaldadas por Caja consumen saldo
  -- adicional, evitando descontar dos veces el mismo cobro.
  select coalesce(sum(a.amount_cop), 0)
    into v_unbacked_allocated
    from public.bank_payment_allocations a
    join public.bank_payment_events e
      on e.id = a.payment_event_id
     and e.hotel_id = a.hotel_id
   where a.hotel_id = v_pilot_hotel_id
     and a.allocation_type = 'reservation'
     and a.reservation_id = p_reservation_id
     and a.caja_id is null
     and e.status in ('matched', 'confirmed')
     and (
       p_exclude_payment_event_id is null
       or a.payment_event_id <> p_exclude_payment_event_id
     );

  -- Conserva compatibilidad con relaciones 1:1 anteriores a allocations.
  select coalesce(sum(e.amount_cop), 0)
    into v_legacy_allocated
    from public.bank_payment_events e
   where e.hotel_id = v_pilot_hotel_id
     and e.status in ('matched', 'confirmed')
     and e.matched_expected_payment_id is null
     and e.matched_reservation_id = p_reservation_id
     and (
       p_exclude_payment_event_id is null
       or e.id <> p_exclude_payment_event_id
     )
     and not exists (
       select 1
         from public.bank_payment_allocations a
        where a.hotel_id = e.hotel_id
          and a.payment_event_id = e.id
     );

  return greatest(
    0,
    floor(
      v_reservation_total
      - greatest(v_reservation_paid, v_payment_rows_total)
      - v_expected_total
      - v_unbacked_allocated
      - v_legacy_allocated
    )::bigint
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_sale_available_amount_cop(p_sale_type text, p_sale_id uuid, p_hotel_id uuid, p_exclude_payment_event_id uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pilot_hotel_id uuid;
  v_sale_total bigint;
  v_allocated bigint;
BEGIN
  v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel(p_hotel_id::text);
  IF p_hotel_id IS DISTINCT FROM v_pilot_hotel_id
     OR NOT public.bank_email_sale_is_reconcilable(p_sale_type, p_sale_id, p_hotel_id) THEN
    RETURN NULL;
  END IF;

  CASE lower(btrim(COALESCE(p_sale_type, '')))
    WHEN 'tienda' THEN
      SELECT floor(COALESCE(v.total_venta, 0))::bigint INTO v_sale_total
        FROM public.ventas_tienda v
       WHERE v.id = p_sale_id AND v.hotel_id = v_pilot_hotel_id;
    WHEN 'restaurante' THEN
      SELECT floor(COALESCE(v.total_venta, v.monto_total, 0))::bigint INTO v_sale_total
        FROM public.ventas_restaurante v
       WHERE v.id = p_sale_id AND v.hotel_id = v_pilot_hotel_id;
    WHEN 'terraza' THEN
      SELECT floor(COALESCE(v.total, 0))::bigint INTO v_sale_total
        FROM public.terraza_pedidos v
       WHERE v.id = p_sale_id AND v.hotel_id = v_pilot_hotel_id;
    WHEN 'venta' THEN
      SELECT floor(COALESCE(v.total, 0))::bigint INTO v_sale_total
        FROM public.ventas v
       WHERE v.id = p_sale_id AND v.hotel_id = v_pilot_hotel_id;
    ELSE
      RETURN NULL;
  END CASE;

  IF v_sale_total IS NULL OR v_sale_total <= 0 THEN RETURN 0; END IF;

  SELECT COALESCE(sum(a.amount_cop), 0)::bigint INTO v_allocated
    FROM public.bank_payment_allocations a
    JOIN public.bank_payment_events e
      ON e.id = a.payment_event_id
     AND e.hotel_id = a.hotel_id
   WHERE a.hotel_id = v_pilot_hotel_id
     AND a.allocation_type = 'sale'
     AND a.sale_type = lower(btrim(p_sale_type))
     AND a.sale_id = p_sale_id
     AND e.status IN ('matched', 'confirmed')
     AND (p_exclude_payment_event_id IS NULL OR a.payment_event_id <> p_exclude_payment_event_id);

  RETURN GREATEST(0, v_sale_total - v_allocated);
END;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_sale_is_reconcilable(p_sale_type text, p_sale_id uuid, p_hotel_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pilot_hotel_id uuid;
BEGIN
  v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel(p_hotel_id::text);
  IF p_hotel_id IS DISTINCT FROM v_pilot_hotel_id
     OR NOT public.bank_email_sale_belongs_to_hotel(p_sale_type, p_sale_id, p_hotel_id) THEN
    RETURN false;
  END IF;

  CASE lower(btrim(COALESCE(p_sale_type, '')))
    WHEN 'tienda' THEN
      RETURN EXISTS (
        SELECT 1
          FROM public.ventas_tienda v
          JOIN public.metodos_pago m ON m.id = v.metodo_pago_id AND m.hotel_id = v.hotel_id
         WHERE v.id = p_sale_id AND v.hotel_id = v_pilot_hotel_id
           AND lower(btrim(m.nombre)) IN ('bancolombia', 'transferencia', 'transferencia bancaria', 'llave')
      );
    WHEN 'restaurante' THEN
      RETURN EXISTS (
        SELECT 1
          FROM public.ventas_restaurante v
          JOIN public.metodos_pago m ON m.id = v.metodo_pago_id AND m.hotel_id = v.hotel_id
         WHERE v.id = p_sale_id AND v.hotel_id = v_pilot_hotel_id
           AND lower(btrim(m.nombre)) IN ('bancolombia', 'transferencia', 'transferencia bancaria', 'llave')
      );
    WHEN 'terraza' THEN
      RETURN EXISTS (
        SELECT 1
          FROM public.terraza_pedidos v
          JOIN public.metodos_pago m ON m.id = v.metodo_pago_id AND m.hotel_id = v.hotel_id
         WHERE v.id = p_sale_id AND v.hotel_id = v_pilot_hotel_id
           AND lower(btrim(m.nombre)) IN ('bancolombia', 'transferencia', 'transferencia bancaria', 'llave')
      );
    WHEN 'venta' THEN
      -- La tabla legacy no conserva metodo de pago; mantiene compatibilidad actual.
      RETURN true;
    ELSE
      RETURN false;
  END CASE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_write_audit(p_hotel_id uuid, p_user_id uuid, p_action text, p_payment_event_id uuid DEFAULT NULL::uuid, p_details jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_hotel_id IS DISTINCT FROM public.resolve_bank_email_pilot_hotel(p_hotel_id::text) THEN
    RAISE EXCEPTION 'Auditoria fuera del hotel piloto.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.bank_payment_audit_log (
    hotel_id, user_id, action, payment_event_id, details
  ) VALUES (
    p_hotel_id, p_user_id, p_action, p_payment_event_id, COALESCE(p_details, '{}'::jsonb)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.replace_bank_payment_allocations(p_payment_event_id uuid, p_actor_id uuid, p_allocations jsonb, p_action text, p_review_reason text DEFAULT NULL::text, p_pilot_hotel_name text DEFAULT 'Hotel Marena San Isidro'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_hotel_id uuid;
  v_event_snapshot public.bank_payment_events%rowtype;
  v_event public.bank_payment_events%rowtype;
  v_item jsonb;
  v_normalized jsonb := '[]'::jsonb;
  v_previous jsonb := '[]'::jsonb;
  v_type text;
  v_sale_type text;
  v_reservation_id uuid;
  v_room_id uuid;
  v_sale_id uuid;
  v_amount bigint;
  v_available bigint;
  v_total bigint := 0;
  v_count integer;
  v_legacy_reservation uuid;
  v_legacy_room uuid;
  v_legacy_sale uuid;
  v_legacy_sale_type text;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_reason text := nullif(btrim(coalesce(p_review_reason, '')), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Esta funcion solo puede ejecutarse desde el servidor.' using errcode = '42501';
  end if;
  if v_action not in ('link', 'confirm') or jsonb_typeof(p_allocations) is distinct from 'array' then
    raise exception 'La distribucion enviada no es valida.' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_allocations);
  if v_count < 1 or v_count > 50 then
    raise exception 'La distribucion debe contener entre 1 y 50 destinos.' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'Toda accion manual de conciliacion requiere un motivo.' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'El motivo no puede superar 500 caracteres.' using errcode = '22023';
  end if;

  v_hotel_id := public.resolve_bank_email_pilot_hotel(p_pilot_hotel_name);
  if v_action = 'link' then
    if not app_private.bank_email_actor_is_pilot_operational(p_actor_id, v_hotel_id) then
      raise exception 'Solo un usuario operativo autorizado puede relacionar pagos.' using errcode = '42501';
    end if;
  elsif not app_private.bank_email_actor_is_pilot_admin(p_actor_id, v_hotel_id) then
    raise exception 'Solo un administrador efectivo puede confirmar pagos.' using errcode = '42501';
  end if;

  select * into v_event_snapshot from public.bank_payment_events
   where id = p_payment_event_id and hotel_id = v_hotel_id;
  if not found or v_event_snapshot.status in ('duplicated', 'rejected') then
    raise exception 'El pago bancario no admite esta distribucion.' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_allocations)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' or coalesce(v_item ->> 'amountCop', '') !~ '^[0-9]+$' then
      raise exception 'Cada destino debe incluir un valor entero en COP.' using errcode = '22023';
    end if;
    v_type := lower(btrim(coalesce(v_item ->> 'type', '')));
    v_amount := (v_item ->> 'amountCop')::bigint;
    if v_amount <= 0 then
      raise exception 'Cada valor distribuido debe ser mayor que cero.' using errcode = '22023';
    end if;
    v_total := v_total + v_amount;

    if v_type = 'reservation' then
      begin v_reservation_id := (v_item ->> 'reservationId')::uuid;
      exception when invalid_text_representation then
        raise exception 'La reserva seleccionada no es valida.' using errcode = '22023';
      end;
      select r.habitacion_id into v_room_id from public.reservas r
       where r.id = v_reservation_id and r.hotel_id = v_hotel_id;
      if not found then
        raise exception 'La reserva seleccionada no pertenece al hotel.' using errcode = '22023';
      end if;
      if exists (select 1 from jsonb_array_elements(v_normalized) n
        where n ->> 'allocation_type' = 'reservation' and n ->> 'reservation_id' = v_reservation_id::text) then
        raise exception 'La reserva esta repetida en la distribucion.' using errcode = '22023';
      end if;
      v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
        'allocation_type','reservation','reservation_id',v_reservation_id,'room_id',v_room_id,'amount_cop',v_amount));
    elsif v_type = 'sale' then
      begin v_sale_id := (v_item ->> 'saleId')::uuid;
      exception when invalid_text_representation then
        raise exception 'La venta seleccionada no es valida.' using errcode = '22023';
      end;
      v_sale_type := lower(btrim(coalesce(v_item ->> 'saleType', '')));
      if v_sale_type not in ('tienda','restaurante','terraza','venta')
         or not public.bank_email_sale_is_reconcilable(v_sale_type,v_sale_id,v_hotel_id) then
        raise exception 'La venta no existe, no pertenece al piloto o no usa un metodo bancario conciliable.' using errcode = '22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended(v_hotel_id::text || ':bank-sale:' || v_sale_type || ':' || v_sale_id::text,0));
      v_available := public.bank_email_sale_available_amount_cop(v_sale_type,v_sale_id,v_hotel_id,p_payment_event_id);
      if v_available is null or v_amount > v_available then
        raise exception 'La venta ya fue conciliada o el valor supera su saldo conciliable (%).',coalesce(v_available,0) using errcode = '22023';
      end if;
      if exists (select 1 from jsonb_array_elements(v_normalized) n
        where n ->> 'allocation_type'='sale' and n ->> 'sale_type'=v_sale_type and n ->> 'sale_id'=v_sale_id::text) then
        raise exception 'Una venta esta repetida en la distribucion.' using errcode = '22023';
      end if;
      v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
        'allocation_type','sale','sale_id',v_sale_id,'sale_type',v_sale_type,'amount_cop',v_amount));
    else
      raise exception 'Tipo de distribucion no reconocido.' using errcode = '22023';
    end if;
  end loop;

  if v_total is distinct from v_event_snapshot.amount_cop then
    raise exception 'La suma distribuida debe ser exactamente igual a la transferencia (%).',v_event_snapshot.amount_cop using errcode = '22023';
  end if;

  select * into v_event from public.bank_payment_events
   where id=p_payment_event_id and hotel_id=v_hotel_id for update;
  if not found or v_event.status in ('duplicated','rejected')
     or v_event.amount_cop is distinct from v_event_snapshot.amount_cop
     or v_event.updated_at is distinct from v_event_snapshot.updated_at then
    raise exception 'El pago bancario cambio mientras se validaba. Vuelve a abrirlo.' using errcode='40001';
  end if;

  select coalesce(jsonb_agg(to_jsonb(a)-'hotel_id'-'created_by' order by a.created_at,a.id),'[]'::jsonb)
    into v_previous from public.bank_payment_allocations a where a.payment_event_id=v_event.id;
  delete from public.bank_payment_allocations where payment_event_id=v_event.id;
  insert into public.bank_payment_allocations(hotel_id,payment_event_id,allocation_type,reservation_id,room_id,sale_id,sale_type,amount_cop,created_by)
  select v_hotel_id,v_event.id,n->>'allocation_type',
    case when n->>'allocation_type'='reservation' then (n->>'reservation_id')::uuid end,
    case when n->>'allocation_type'='reservation' then (n->>'room_id')::uuid end,
    case when n->>'allocation_type'='sale' then (n->>'sale_id')::uuid end,
    case when n->>'allocation_type'='sale' then n->>'sale_type' end,
    (n->>'amount_cop')::bigint,p_actor_id
  from jsonb_array_elements(v_normalized) n;

  if v_count=1 then
    v_item:=v_normalized->0;
    if v_item->>'allocation_type'='reservation' then
      v_legacy_reservation:=(v_item->>'reservation_id')::uuid;
      v_legacy_room:=(v_item->>'room_id')::uuid;
    else
      v_legacy_sale:=(v_item->>'sale_id')::uuid;
      v_legacy_sale_type:=v_item->>'sale_type';
    end if;
  end if;

  update public.bank_payment_events set
    status=case when v_action='confirm' then 'confirmed' else 'matched' end,
    matched_reservation_id=v_legacy_reservation, matched_room_id=v_legacy_room,
    matched_sale_id=v_legacy_sale, matched_sale_type=v_legacy_sale_type,
    matched_expected_payment_id=null, review_reason=v_reason,
    reviewed_by=p_actor_id, reviewed_at=clock_timestamp(),
    confirmed_by=case when v_action='confirm' then p_actor_id else null end,
    confirmed_at=case when v_action='confirm' then clock_timestamp() else null end,
    metadata=(coalesce(metadata,'{}'::jsonb)-'relation_deleted'-'relation_invalidated') || jsonb_build_object(
      'allocation_count',v_count,'allocated_amount_cop',v_total,'allocation_source','bank_payment_allocations'),
    updated_at=clock_timestamp()
  where id=v_event.id returning * into v_event;

  perform public.bank_email_write_audit(v_hotel_id,p_actor_id,'multiple_allocation_changed',v_event.id,jsonb_build_object(
    'action',v_action,'reason',v_reason,'previous_allocations',v_previous,'new_allocations',v_normalized,
    'allocation_count',v_count,'amount_cop',v_total));

  return jsonb_build_object('payment_event',to_jsonb(v_event),'allocations',(
    select coalesce(jsonb_agg(to_jsonb(a)-'hotel_id'-'created_by' order by a.created_at,a.id),'[]'::jsonb)
    from public.bank_payment_allocations a where a.payment_event_id=v_event.id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_notify_payment_event(p_payment_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event public.bank_payment_events%rowtype;
  v_message text;
  v_amount text;
  v_sender text;
  v_payment_time timestamp with time zone;
BEGIN
  SELECT * INTO v_event FROM public.bank_payment_events WHERE id = p_payment_event_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF lower(COALESCE(v_event.metadata ->> 'is_test', 'false')) = 'true' THEN RETURN; END IF;
  IF v_event.status = 'duplicated' THEN RETURN; END IF;
  IF v_event.status = 'rejected' AND v_event.reviewed_by IS NULL THEN RETURN; END IF;

  v_amount := replace(to_char(v_event.amount_cop, 'FM999,999,999,999,990'), ',', '.');
  v_sender := COALESCE(NULLIF(btrim(v_event.sender_name), ''), 'Remitente no identificado');
  v_payment_time := COALESCE(v_event.transaction_occurred_at, v_event.email_received_at, v_event.detected_at);
  v_message := 'Transferencia recibida' || case when nullif(btrim(v_event.metadata ->> 'bank_key'),'') is not null
    then ' en la llave ' || (v_event.metadata ->> 'bank_key') else '' end
    || E'
Monto: $' || v_amount
    || E'
Remitente: ' || v_sender
    || E'
Fecha: ' || to_char(v_payment_time AT TIME ZONE public.hotel_time_zone(v_event.hotel_id), 'DD/MM/YYYY')
    || E'
Hora: ' || lower(to_char(v_payment_time AT TIME ZONE public.hotel_time_zone(v_event.hotel_id), 'HH12:MI a.m.'));

  INSERT INTO public.notificaciones (
    hotel_id, usuario_id, user_id, rol_destino, tipo, mensaje,
    entidad_tipo, entidad_id, leida, creado_en, actualizado_en
  )
  SELECT v_event.hotel_id, u.id, u.id, NULL,
    'general_info'::public.tipo_notificacion_enum,
    v_message, 'bank_payment_event', v_event.id, false, now(), now()
  FROM public.usuarios u
  WHERE u.hotel_id = v_event.hotel_id
    AND u.activo IS TRUE
    AND (
      lower(COALESCE(u.rol::text, '')) IN ('admin', 'administrador', 'superadmin', 'recepcionista', 'recepcion')
      OR EXISTS (
        SELECT 1
        FROM public.usuarios_roles ur
        JOIN public.roles r ON r.id = ur.rol_id
        WHERE ur.usuario_id = u.id
          AND ur.hotel_id = v_event.hotel_id
          AND lower(btrim(r.nombre)) IN ('admin', 'administrador', 'superadmin', 'recepcionista', 'recepcion')
      )
    )
  ON CONFLICT (hotel_id, usuario_id, entidad_tipo, entidad_id)
    WHERE entidad_tipo = 'bank_payment_event' AND usuario_id IS NOT NULL
  DO UPDATE SET mensaje = EXCLUDED.mensaje, actualizado_en = now(),
    user_id = EXCLUDED.user_id, rol_destino = NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_bank_email_pubsub_inbox_for_hotel(p_hotel_id uuid, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pilot_hotel_id uuid;
  v_rows jsonb;
  v_limit integer;
BEGIN
  v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel(p_hotel_id::text);
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);

  WITH candidates AS (
    SELECT i.id
      FROM public.bank_email_pubsub_inbox i
     WHERE i.hotel_id = v_pilot_hotel_id
       AND (
         (i.status IN ('pending', 'retry', 'failed') AND i.next_attempt_at <= now())
         OR (i.status = 'processing' AND i.updated_at <= now() - interval '10 minutes')
       )
     ORDER BY i.next_attempt_at, i.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT v_limit
  ), claimed AS (
    UPDATE public.bank_email_pubsub_inbox i
       SET status = 'processing', attempts = i.attempts + 1, updated_at = now()
      FROM candidates c
     WHERE i.id = c.id
     RETURNING i.*
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.created_at), '[]'::jsonb)
    INTO v_rows
    FROM claimed c;

  RETURN v_rows;
END;
$function$;
revoke all on function public.claim_bank_email_pubsub_inbox_for_hotel(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_bank_email_pubsub_inbox_for_hotel(uuid,integer) to service_role;

create or replace function public.claim_bank_outlook_sync(p_hotel_id uuid,p_integration_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $function$
declare v_lock uuid:=gen_random_uuid(); v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Servidor requerido.' using errcode='42501'; end if;
  perform public.resolve_bank_email_pilot_hotel(p_hotel_id::text);
  update public.bank_email_integrations set sync_lock_token=v_lock,sync_locked_until=now()+interval '3 minutes'
  where id=p_integration_id and hotel_id=p_hotel_id and provider='microsoft'
    and (sync_locked_until is null or sync_locked_until<now()) returning id into v_id;
  return case when v_id is null then null else v_lock end;
end;
$function$;
revoke all on function public.claim_bank_outlook_sync(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_bank_outlook_sync(uuid,uuid) to service_role;

-- Reuse the existing Vault secrets; credentials never appear in this migration.
do $cron$
begin
 if exists(select 1 from pg_namespace where nspname='cron')
   and exists(select 1 from vault.secrets where name='bank_email_cron_secret') then
  perform cron.schedule('outlook-bank-sync-every-minute','* * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='bank_email_project_url' order by created_at desc limit 1) || '/functions/v1/bank-outlook-sync',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
        (select decrypted_secret from vault.decrypted_secrets where name='bank_email_cron_secret' order by created_at desc limit 1)),
      body := '{}'::jsonb, timeout_milliseconds := 60000);
  $job$);
 end if;
end;
$cron$;
