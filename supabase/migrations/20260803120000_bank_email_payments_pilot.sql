BEGIN;

-- The database cannot read application environment variables.  This resolver is
-- therefore the final database-side guard: it accepts only the configured pilot
-- name, normalizes case/outer whitespace and fails closed unless exactly one hotel
-- matches.  No hotel UUID is stored in this migration.
CREATE OR REPLACE FUNCTION public.resolve_bank_email_pilot_hotel(
  p_pilot_hotel_name text DEFAULT 'Hotel Marena San Isidro'
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids uuid[];
  v_expected_name constant text := 'hotel marena san isidro';
BEGIN
  IF lower(btrim(COALESCE(p_pilot_hotel_name, ''))) <> v_expected_name THEN
    RAISE EXCEPTION 'El nombre solicitado no corresponde al hotel piloto.'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(h.id ORDER BY h.id::text)
    INTO v_ids
    FROM public.hoteles h
   WHERE lower(btrim(h.nombre)) = v_expected_name;

  IF COALESCE(cardinality(v_ids), 0) <> 1 THEN
    RAISE EXCEPTION 'La integracion bancaria requiere exactamente un hotel piloto; encontrados: %.',
      COALESCE(cardinality(v_ids), 0)
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_ids[1];
END;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_user_has_pilot_access(p_hotel_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    p_hotel_id = public.resolve_bank_email_pilot_hotel('Hotel Marena San Isidro')
    AND EXISTS (
      SELECT 1
        FROM public.usuarios u
       WHERE u.id = auth.uid()
         AND u.hotel_id = p_hotel_id
         AND u.activo IS TRUE
    ),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
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
  v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel('Hotel Marena San Isidro');

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

CREATE TABLE IF NOT EXISTS public.bank_email_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'google',
  connected_email text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamp with time zone,
  gmail_label_name text NOT NULL DEFAULT 'PAGOS HOTEL MARENA',
  gmail_label_id text,
  gmail_history_id text,
  watch_expiration timestamp with time zone,
  watch_status text NOT NULL DEFAULT 'disconnected',
  watch_renewal_failures integer NOT NULL DEFAULT 0,
  last_watch_renewed_at timestamp with time zone,
  last_error_code text,
  created_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bank_email_integrations_provider_check
    CHECK (lower(btrim(provider)) = 'google'),
  CONSTRAINT bank_email_integrations_watch_status_check
    CHECK (watch_status IN (
      'disconnected', 'connecting', 'pending', 'active', 'label_missing',
      'renewal_due', 'renewal_pending', 'error'
    )),
  CONSTRAINT bank_email_integrations_failures_check
    CHECK (watch_renewal_failures >= 0),
  CONSTRAINT bank_email_integrations_hotel_provider_key UNIQUE (hotel_id, provider)
);

CREATE TABLE IF NOT EXISTS public.bank_email_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
  integration_id uuid REFERENCES public.bank_email_integrations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'google',
  state_hash text NOT NULL UNIQUE,
  code_verifier_encrypted text,
  redirect_uri text,
  user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '10 minutes'),
  consumed_at timestamp with time zone,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bank_email_oauth_states_provider_check CHECK (lower(btrim(provider)) = 'google'),
  CONSTRAINT bank_email_oauth_states_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT bank_email_oauth_states_metadata_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE IF NOT EXISTS public.bank_email_pubsub_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
  integration_id uuid REFERENCES public.bank_email_integrations(id) ON DELETE SET NULL,
  pubsub_message_id text NOT NULL UNIQUE,
  email_address text NOT NULL,
  history_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
  last_error_code text,
  processed_at timestamp with time zone,
  published_at timestamp with time zone,
  payload_hash text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bank_email_pubsub_inbox_status_check
    CHECK (status IN ('pending', 'processing', 'retry', 'failed', 'processed', 'ignored', 'dead_letter')),
  CONSTRAINT bank_email_pubsub_inbox_attempts_check CHECK (attempts >= 0)
);

CREATE TABLE IF NOT EXISTS public.expected_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
  reservation_id uuid REFERENCES public.reservas(id) ON DELETE SET NULL,
  room_id uuid REFERENCES public.habitaciones(id) ON DELETE SET NULL,
  sale_id uuid,
  sale_type text,
  expected_amount_cop bigint NOT NULL,
  payment_method text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  expires_at timestamp with time zone,
  matched_bank_payment_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT expected_payments_amount_check CHECK (expected_amount_cop > 0),
  CONSTRAINT expected_payments_method_check
    CHECK (lower(btrim(payment_method)) IN ('llave', 'transferencia', 'efectivo', 'tarjeta', 'otro')),
  CONSTRAINT expected_payments_status_check
    CHECK (status IN ('pending', 'matched', 'confirmed', 'cancelled', 'expired')),
  CONSTRAINT expected_payments_match_state_check
    CHECK ((status IN ('matched', 'confirmed')) = (matched_bank_payment_id IS NOT NULL)),
  CONSTRAINT expected_payments_sale_pair_check
    CHECK ((sale_id IS NULL AND sale_type IS NULL) OR (sale_id IS NOT NULL AND sale_type IS NOT NULL)),
  CONSTRAINT expected_payments_sale_target_exclusive_check
    CHECK (sale_id IS NULL OR (reservation_id IS NULL AND room_id IS NULL)),
  CONSTRAINT expected_payments_sale_type_check
    CHECK (sale_type IS NULL OR sale_type IN ('venta', 'tienda', 'restaurante', 'terraza')),
  CONSTRAINT expected_payments_expiry_check CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS public.bank_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
  integration_id uuid REFERENCES public.bank_email_integrations(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'gmail',
  bank_name text,
  gmail_message_id text NOT NULL,
  gmail_thread_id text,
  transaction_reference text,
  transaction_fingerprint text,
  transaction_occurred_at timestamp with time zone,
  transaction_date date,
  sender_name text,
  sender_email text,
  sender_account_masked text,
  amount_cop bigint NOT NULL,
  email_subject text,
  email_received_at timestamp with time zone,
  detected_at timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'detected',
  matched_reservation_id uuid REFERENCES public.reservas(id) ON DELETE SET NULL,
  matched_room_id uuid REFERENCES public.habitaciones(id) ON DELETE SET NULL,
  matched_sale_id uuid,
  matched_sale_type text,
  matched_expected_payment_id uuid REFERENCES public.expected_payments(id) ON DELETE SET NULL,
  raw_content_hash text,
  parser_version text,
  review_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  reviewed_at timestamp with time zone,
  confirmed_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  confirmed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bank_payment_events_provider_check CHECK (provider IN ('gmail', 'simulation')),
  CONSTRAINT bank_payment_events_amount_check CHECK (amount_cop > 0),
  CONSTRAINT bank_payment_events_status_check
    CHECK (status IN ('detected', 'matched', 'confirmed', 'manual_review', 'rejected', 'duplicated')),
  CONSTRAINT bank_payment_events_relation_state_check CHECK (
    status NOT IN ('matched', 'confirmed')
    OR matched_expected_payment_id IS NOT NULL
    OR matched_reservation_id IS NOT NULL
    OR matched_room_id IS NOT NULL
    OR matched_sale_id IS NOT NULL
    OR COALESCE((metadata ->> 'relation_deleted')::boolean, false)
    OR COALESCE((metadata ->> 'relation_invalidated')::boolean, false)
  ),
  CONSTRAINT bank_payment_events_rejected_unlinked_check CHECK (
    status <> 'rejected'
    OR (
      matched_expected_payment_id IS NULL
      AND matched_reservation_id IS NULL
      AND matched_room_id IS NULL
      AND matched_sale_id IS NULL
      AND matched_sale_type IS NULL
    )
  ),
  CONSTRAINT bank_payment_events_confirmation_state_check CHECK (
    (status = 'confirmed' AND confirmed_at IS NOT NULL)
    OR (status <> 'confirmed' AND confirmed_at IS NULL AND confirmed_by IS NULL)
  ),
  CONSTRAINT bank_payment_events_sale_pair_check
    CHECK ((matched_sale_id IS NULL AND matched_sale_type IS NULL)
        OR (matched_sale_id IS NOT NULL AND matched_sale_type IS NOT NULL)),
  CONSTRAINT bank_payment_events_sale_target_exclusive_check
    CHECK (matched_sale_id IS NULL OR (matched_reservation_id IS NULL AND matched_room_id IS NULL)),
  CONSTRAINT bank_payment_events_sale_type_check
    CHECK (matched_sale_type IS NULL OR matched_sale_type IN ('venta', 'tienda', 'restaurante', 'terraza')),
  CONSTRAINT bank_payment_events_metadata_check CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT bank_payment_events_message_key UNIQUE (hotel_id, gmail_message_id)
);

CREATE TABLE IF NOT EXISTS public.bank_payment_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  action text NOT NULL,
  payment_event_id uuid REFERENCES public.bank_payment_events(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bank_payment_audit_log_action_check CHECK (action IN (
    'payment_detected', 'auto_matched', 'manual_confirmed', 'relation_changed',
    'payment_rejected', 'duplicate_detected', 'parse_error',
    'gmail_watch_renewed', 'gmail_watch_renewal_failed',
    'gmail_connected', 'gmail_connection_failed', 'gmail_disconnected',
    'matching_ambiguous', 'no_match', 'marked_reviewed',
    'expected_payment_created', 'expected_payment_cancelled'
  )),
  CONSTRAINT bank_payment_audit_log_details_check CHECK (jsonb_typeof(details) = 'object')
);

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.expected_payments'::regclass
       AND conname = 'expected_payments_matched_bank_payment_fkey'
  ) THEN
    ALTER TABLE public.expected_payments
      ADD CONSTRAINT expected_payments_matched_bank_payment_fkey
      FOREIGN KEY (matched_bank_payment_id)
      REFERENCES public.bank_payment_events(id)
      ON DELETE RESTRICT;
  END IF;
END;
$do$;

CREATE UNIQUE INDEX IF NOT EXISTS bank_payment_events_fingerprint_uidx
  ON public.bank_payment_events (hotel_id, provider, transaction_fingerprint)
  WHERE transaction_fingerprint IS NOT NULL AND btrim(transaction_fingerprint) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS bank_payment_events_bank_reference_uidx
  ON public.bank_payment_events (
    hotel_id,
    provider,
    (COALESCE(lower(btrim(bank_name)), '')),
    (lower(btrim(transaction_reference))),
    amount_cop,
    transaction_date
  )
  WHERE transaction_reference IS NOT NULL AND transaction_date IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS expected_payments_matched_event_uidx
  ON public.expected_payments (matched_bank_payment_id)
  WHERE matched_bank_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bank_payment_events_matched_expected_uidx
  ON public.bank_payment_events (matched_expected_payment_id)
  WHERE matched_expected_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bank_payment_events_hotel_status_detected_idx
  ON public.bank_payment_events (hotel_id, status, detected_at DESC);
CREATE INDEX IF NOT EXISTS bank_payment_events_received_idx
  ON public.bank_payment_events (hotel_id, email_received_at DESC);
CREATE INDEX IF NOT EXISTS bank_payment_events_reference_idx
  ON public.bank_payment_events (hotel_id, transaction_reference);
CREATE INDEX IF NOT EXISTS expected_payments_match_idx
  ON public.expected_payments (hotel_id, status, payment_method, expected_amount_cop, created_at);
CREATE INDEX IF NOT EXISTS expected_payments_expires_idx
  ON public.expected_payments (hotel_id, expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS bank_email_integrations_watch_idx
  ON public.bank_email_integrations (watch_status, watch_expiration);
CREATE INDEX IF NOT EXISTS bank_email_pubsub_claim_idx
  ON public.bank_email_pubsub_inbox (hotel_id, status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS bank_email_oauth_states_expiry_idx
  ON public.bank_email_oauth_states (state_hash, expires_at) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS bank_payment_audit_event_idx
  ON public.bank_payment_audit_log (payment_event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bank_payment_audit_hotel_idx
  ON public.bank_payment_audit_log (hotel_id, created_at DESC);

-- A partial unique index lets the notification writer safely upsert exactly one
-- individual notification per payment and recipient.  rol_destino remains NULL,
-- avoiding the legacy cross-hotel role policy on notificaciones.
CREATE UNIQUE INDEX IF NOT EXISTS bank_payment_notification_recipient_uidx
  ON public.notificaciones (hotel_id, usuario_id, entidad_tipo, entidad_id)
  WHERE entidad_tipo = 'bank_payment_event' AND usuario_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.bank_email_notification_is_visible(
  p_entity_type text,
  p_hotel_id uuid,
  p_usuario_id uuid,
  p_user_id uuid,
  p_entity_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
    v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel('Hotel Marena San Isidro');
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  IF p_hotel_id <> v_pilot_hotel_id
     OR NOT public.bank_email_user_has_pilot_access(p_hotel_id) THEN
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

CREATE OR REPLACE FUNCTION public.bank_email_guard_notification_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF COALESCE(auth.role(), '') IN ('anon', 'authenticated')
     AND (
       COALESCE(OLD.entidad_tipo, '') IN ('bank_payment_event', 'bank_payment_events', 'bank_email_integration')
       OR COALESCE(NEW.entidad_tipo, '') IN ('bank_payment_event', 'bank_payment_events', 'bank_email_integration')
     )
     AND (
       NEW.id IS DISTINCT FROM OLD.id
       OR NEW.hotel_id IS DISTINCT FROM OLD.hotel_id
       OR NEW.usuario_id IS DISTINCT FROM OLD.usuario_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.rol_destino IS DISTINCT FROM OLD.rol_destino
       OR NEW.tipo IS DISTINCT FROM OLD.tipo
       OR NEW.mensaje IS DISTINCT FROM OLD.mensaje
       OR NEW.entidad_tipo IS DISTINCT FROM OLD.entidad_tipo
       OR NEW.entidad_id IS DISTINCT FROM OLD.entidad_id
       OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
     ) THEN
    RAISE EXCEPTION 'Solo se puede cambiar el estado de lectura de una notificacion bancaria.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS bank_email_guard_notification_update_trg ON public.notificaciones;
CREATE TRIGGER bank_email_guard_notification_update_trg
BEFORE UPDATE ON public.notificaciones
FOR EACH ROW EXECUTE FUNCTION public.bank_email_guard_notification_update();

CREATE OR REPLACE FUNCTION public.bank_email_sale_belongs_to_hotel(
  p_sale_type text,
  p_sale_id uuid,
  p_hotel_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_sale_id IS NULL AND p_sale_type IS NULL THEN
    RETURN true;
  END IF;
  IF p_sale_id IS NULL OR p_sale_type IS NULL THEN
    RETURN false;
  END IF;

  CASE p_sale_type
    WHEN 'venta' THEN
      RETURN EXISTS (SELECT 1 FROM public.ventas v WHERE v.id = p_sale_id AND v.hotel_id = p_hotel_id);
    WHEN 'tienda' THEN
      RETURN EXISTS (SELECT 1 FROM public.ventas_tienda v WHERE v.id = p_sale_id AND v.hotel_id = p_hotel_id);
    WHEN 'restaurante' THEN
      RETURN EXISTS (SELECT 1 FROM public.ventas_restaurante v WHERE v.id = p_sale_id AND v.hotel_id = p_hotel_id);
    WHEN 'terraza' THEN
      RETURN EXISTS (SELECT 1 FROM public.terraza_pedidos v WHERE v.id = p_sale_id AND v.hotel_id = p_hotel_id);
    ELSE
      RETURN false;
  END CASE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_sale_is_payable(
  p_sale_type text,
  p_sale_id uuid,
  p_hotel_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.bank_email_sale_belongs_to_hotel(p_sale_type, p_sale_id, p_hotel_id) THEN
    RETURN false;
  END IF;
  CASE p_sale_type
    WHEN 'tienda' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.ventas_tienda v
         WHERE v.id = p_sale_id AND v.hotel_id = p_hotel_id
           AND lower(COALESCE(v.estado_pago, 'pendiente')) <> 'pagado'
      );
    WHEN 'restaurante' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.ventas_restaurante v
         WHERE v.id = p_sale_id AND v.hotel_id = p_hotel_id
           AND lower(COALESCE(v.estado_pago, 'pendiente')) <> 'pagado'
      );
    WHEN 'terraza' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.terraza_pedidos v
         WHERE v.id = p_sale_id AND v.hotel_id = p_hotel_id AND v.estado = 'abierto'
      );
    WHEN 'venta' THEN
      -- The legacy ventas table has no payment-state column.
      RETURN true;
    ELSE
      RETURN false;
  END CASE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_validate_expected_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reservation_room_id uuid;
BEGIN
  NEW.payment_method := lower(btrim(NEW.payment_method));
  NEW.sale_type := NULLIF(lower(btrim(COALESCE(NEW.sale_type, ''))), '');

  IF NEW.reservation_id IS NOT NULL THEN
    SELECT r.habitacion_id INTO v_reservation_room_id
      FROM public.reservas r
     WHERE r.id = NEW.reservation_id AND r.hotel_id = NEW.hotel_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'La reserva no pertenece al hotel del pago esperado.'; END IF;
  END IF;

  IF NEW.room_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.habitaciones h WHERE h.id = NEW.room_id AND h.hotel_id = NEW.hotel_id
  ) THEN
    RAISE EXCEPTION 'La habitacion no pertenece al hotel del pago esperado.';
  END IF;

  IF v_reservation_room_id IS NOT NULL AND NEW.room_id IS NOT NULL
     AND v_reservation_room_id IS DISTINCT FROM NEW.room_id THEN
    RAISE EXCEPTION 'La habitacion no corresponde a la reserva indicada.';
  END IF;

  IF NOT public.bank_email_sale_belongs_to_hotel(NEW.sale_type, NEW.sale_id, NEW.hotel_id) THEN
    RAISE EXCEPTION 'La venta no pertenece al hotel o su tipo no es valido.';
  END IF;

  IF NEW.created_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.usuarios u
     WHERE u.id = NEW.created_by AND u.hotel_id = NEW.hotel_id AND u.activo IS TRUE
  ) THEN
    RAISE EXCEPTION 'El creador no es un usuario activo del hotel piloto.';
  END IF;

  IF NEW.matched_bank_payment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.bank_payment_events e
     WHERE e.id = NEW.matched_bank_payment_id AND e.hotel_id = NEW.hotel_id
  ) THEN
    RAISE EXCEPTION 'El evento bancario relacionado no pertenece al hotel.';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_validate_payment_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reservation_room_id uuid;
  v_expected_amount bigint;
BEGIN
  NEW.matched_sale_type := NULLIF(lower(btrim(COALESCE(NEW.matched_sale_type, ''))), '');

  IF NEW.integration_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.bank_email_integrations i
     WHERE i.id = NEW.integration_id AND i.hotel_id = NEW.hotel_id
  ) THEN
    RAISE EXCEPTION 'La integracion no pertenece al hotel del evento.';
  END IF;

  IF NEW.matched_reservation_id IS NOT NULL THEN
    SELECT r.habitacion_id INTO v_reservation_room_id
      FROM public.reservas r
     WHERE r.id = NEW.matched_reservation_id AND r.hotel_id = NEW.hotel_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'La reserva relacionada no pertenece al hotel.'; END IF;
  END IF;

  IF NEW.matched_room_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.habitaciones h WHERE h.id = NEW.matched_room_id AND h.hotel_id = NEW.hotel_id
  ) THEN
    RAISE EXCEPTION 'La habitacion relacionada no pertenece al hotel.';
  END IF;

  IF v_reservation_room_id IS NOT NULL AND NEW.matched_room_id IS NOT NULL
     AND v_reservation_room_id IS DISTINCT FROM NEW.matched_room_id THEN
    RAISE EXCEPTION 'La habitacion no corresponde a la reserva relacionada.';
  END IF;

  IF NOT public.bank_email_sale_belongs_to_hotel(
    NEW.matched_sale_type, NEW.matched_sale_id, NEW.hotel_id
  ) THEN
    RAISE EXCEPTION 'La venta relacionada no pertenece al hotel o su tipo no es valido.';
  END IF;

  IF NEW.matched_expected_payment_id IS NOT NULL THEN
    SELECT ep.expected_amount_cop INTO v_expected_amount
      FROM public.expected_payments ep
     WHERE ep.id = NEW.matched_expected_payment_id AND ep.hotel_id = NEW.hotel_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El pago esperado no pertenece al hotel.'; END IF;
    IF v_expected_amount IS DISTINCT FROM NEW.amount_cop THEN
      RAISE EXCEPTION 'El monto del pago esperado no coincide con el evento bancario.';
    END IF;
  END IF;

  IF NEW.reviewed_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.usuarios u
     WHERE u.id = NEW.reviewed_by AND u.hotel_id = NEW.hotel_id AND u.activo IS TRUE
  ) THEN
    RAISE EXCEPTION 'El revisor no es un usuario activo del hotel.';
  END IF;

  IF NEW.confirmed_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.usuarios u
     WHERE u.id = NEW.confirmed_by AND u.hotel_id = NEW.hotel_id AND u.activo IS TRUE
  ) THEN
    RAISE EXCEPTION 'El confirmador no es un usuario activo del hotel.';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_validate_match_reciprocity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_expected public.expected_payments%rowtype;
  v_event public.bank_payment_events%rowtype;
  v_row_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row_id := OLD.id; ELSE v_row_id := NEW.id; END IF;

  IF TG_TABLE_NAME = 'expected_payments' THEN
    SELECT * INTO v_expected FROM public.expected_payments WHERE id = v_row_id;
    IF NOT FOUND OR v_expected.matched_bank_payment_id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO v_event
      FROM public.bank_payment_events
     WHERE id = v_expected.matched_bank_payment_id;
    IF NOT FOUND
       OR v_event.hotel_id IS DISTINCT FROM v_expected.hotel_id
       OR v_event.matched_expected_payment_id IS DISTINCT FROM v_expected.id
       OR v_event.status IS DISTINCT FROM v_expected.status THEN
      RAISE EXCEPTION 'La relacion entre pago esperado y evento bancario no es reciproca.';
    END IF;
  ELSE
    SELECT * INTO v_event FROM public.bank_payment_events WHERE id = v_row_id;
    IF NOT FOUND OR v_event.matched_expected_payment_id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO v_expected
      FROM public.expected_payments
     WHERE id = v_event.matched_expected_payment_id;
    IF NOT FOUND
       OR v_expected.hotel_id IS DISTINCT FROM v_event.hotel_id
       OR v_expected.matched_bank_payment_id IS DISTINCT FROM v_event.id
       OR v_expected.status IS DISTINCT FROM v_event.status THEN
      RAISE EXCEPTION 'La relacion entre evento bancario y pago esperado no es reciproca.';
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_cancel_pending_on_reservation_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pilot_hotel_id uuid;
  v_cancelled integer := 0;
  v_changed integer := 0;
  v_actor_id uuid;
BEGIN
  BEGIN
    v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel('Hotel Marena San Isidro');
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;

  -- Metadata-only edits to an existing receipt do not change the reservation
  -- balance and must not invalidate newly-created payment intents.
  IF TG_OP = 'UPDATE'
     AND (OLD.hotel_id, OLD.reserva_id, OLD.monto)
         IS NOT DISTINCT FROM (NEW.hotel_id, NEW.reserva_id, NEW.monto) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.hotel_id IS DISTINCT FROM v_pilot_hotel_id THEN
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE'
     AND NEW.hotel_id IS DISTINCT FROM v_pilot_hotel_id
     AND OLD.hotel_id IS DISTINCT FROM v_pilot_hotel_id THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_pilot_hotel_id::text || ':expected-matching',
    0
  ));

  IF NEW.hotel_id = v_pilot_hotel_id THEN
    UPDATE public.expected_payments
       SET status = 'cancelled', matched_bank_payment_id = NULL, updated_at = now()
     WHERE hotel_id = v_pilot_hotel_id
       AND reservation_id = NEW.reserva_id
       AND status = 'pending';
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    v_cancelled := v_cancelled + v_changed;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.hotel_id = v_pilot_hotel_id
     AND (OLD.hotel_id, OLD.reserva_id) IS DISTINCT FROM (NEW.hotel_id, NEW.reserva_id) THEN
    UPDATE public.expected_payments
       SET status = 'cancelled', matched_bank_payment_id = NULL, updated_at = now()
     WHERE hotel_id = v_pilot_hotel_id
       AND reservation_id = OLD.reserva_id
       AND status = 'pending';
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    v_cancelled := v_cancelled + v_changed;
  END IF;

  IF v_cancelled > 0 THEN
    SELECT u.id INTO v_actor_id
      FROM public.usuarios u
     WHERE u.id = NEW.usuario_id AND u.hotel_id = v_pilot_hotel_id;
    INSERT INTO public.bank_payment_audit_log (
      hotel_id, user_id, action, payment_event_id, details
    ) VALUES (
      v_pilot_hotel_id, v_actor_id, 'expected_payment_cancelled', NULL,
      jsonb_build_object(
        'reason', 'reservation_payment_recorded',
        'reservation_id', NEW.reserva_id,
        'cancelled_count', v_cancelled
      )
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_validate_integration_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.integration_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.bank_email_integrations i
     WHERE i.id = NEW.integration_id AND i.hotel_id = NEW.hotel_id
  ) THEN
    RAISE EXCEPTION 'La integracion referenciada no pertenece al hotel piloto.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_validate_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.payment_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.bank_payment_events e
     WHERE e.id = NEW.payment_event_id AND e.hotel_id = NEW.hotel_id
  ) THEN
    RAISE EXCEPTION 'El evento auditado no pertenece al hotel.';
  END IF;
  IF NEW.user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.usuarios u WHERE u.id = NEW.user_id AND u.hotel_id = NEW.hotel_id
  ) THEN
    RAISE EXCEPTION 'El usuario auditado no pertenece al hotel.';
  END IF;
  RETURN NEW;
END;
$function$;

DO $do$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'bank_email_integrations', 'bank_email_oauth_states', 'bank_email_pubsub_inbox',
    'expected_payments', 'bank_payment_events', 'bank_payment_audit_log'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS bank_email_assert_pilot_row_trg ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER bank_email_assert_pilot_row_trg BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bank_email_assert_pilot_row()',
      v_table
    );
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY[
    'bank_email_integrations', 'bank_email_pubsub_inbox', 'expected_payments', 'bank_payment_events'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS bank_email_set_updated_at_trg ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER bank_email_set_updated_at_trg BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bank_email_set_updated_at()',
      v_table
    );
  END LOOP;
END;
$do$;

DROP TRIGGER IF EXISTS bank_email_validate_expected_payment_trg ON public.expected_payments;
CREATE TRIGGER bank_email_validate_expected_payment_trg
BEFORE INSERT OR UPDATE ON public.expected_payments
FOR EACH ROW EXECUTE FUNCTION public.bank_email_validate_expected_payment();

DROP TRIGGER IF EXISTS bank_email_cancel_pending_on_reservation_payment_trg ON public.pagos_reserva;
CREATE TRIGGER bank_email_cancel_pending_on_reservation_payment_trg
AFTER INSERT OR UPDATE ON public.pagos_reserva
FOR EACH ROW EXECUTE FUNCTION public.bank_email_cancel_pending_on_reservation_payment();

DROP TRIGGER IF EXISTS bank_email_validate_payment_event_trg ON public.bank_payment_events;
CREATE TRIGGER bank_email_validate_payment_event_trg
BEFORE INSERT OR UPDATE ON public.bank_payment_events
FOR EACH ROW EXECUTE FUNCTION public.bank_email_validate_payment_event();

DROP TRIGGER IF EXISTS bank_email_expected_match_reciprocity_trg ON public.expected_payments;
CREATE CONSTRAINT TRIGGER bank_email_expected_match_reciprocity_trg
AFTER INSERT OR UPDATE OR DELETE ON public.expected_payments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.bank_email_validate_match_reciprocity();

DROP TRIGGER IF EXISTS bank_email_event_match_reciprocity_trg ON public.bank_payment_events;
CREATE CONSTRAINT TRIGGER bank_email_event_match_reciprocity_trg
AFTER INSERT OR UPDATE OR DELETE ON public.bank_payment_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.bank_email_validate_match_reciprocity();

DROP TRIGGER IF EXISTS bank_email_validate_pubsub_integration_trg ON public.bank_email_pubsub_inbox;
CREATE TRIGGER bank_email_validate_pubsub_integration_trg
BEFORE INSERT OR UPDATE ON public.bank_email_pubsub_inbox
FOR EACH ROW EXECUTE FUNCTION public.bank_email_validate_integration_link();

DROP TRIGGER IF EXISTS bank_email_validate_oauth_integration_trg ON public.bank_email_oauth_states;
CREATE TRIGGER bank_email_validate_oauth_integration_trg
BEFORE INSERT OR UPDATE ON public.bank_email_oauth_states
FOR EACH ROW EXECUTE FUNCTION public.bank_email_validate_integration_link();

DROP TRIGGER IF EXISTS bank_email_validate_audit_log_trg ON public.bank_payment_audit_log;
CREATE TRIGGER bank_email_validate_audit_log_trg
BEFORE INSERT OR UPDATE ON public.bank_payment_audit_log
FOR EACH ROW EXECUTE FUNCTION public.bank_email_validate_audit_log();

CREATE OR REPLACE FUNCTION public.bank_email_write_audit(
  p_hotel_id uuid,
  p_user_id uuid,
  p_action text,
  p_payment_event_id uuid DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_hotel_id IS DISTINCT FROM public.resolve_bank_email_pilot_hotel('Hotel Marena San Isidro') THEN
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

CREATE OR REPLACE FUNCTION public.create_expected_bank_payment(
  p_operation_id uuid,
  p_reservation_id uuid,
  p_expected_amount_cop bigint,
  p_payment_method text,
  p_actor_id uuid,
  p_expires_minutes integer DEFAULT 30,
  p_pilot_hotel_name text DEFAULT 'Hotel Marena San Isidro'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pilot_hotel_id uuid;
  v_actor public.usuarios%rowtype;
  v_reservation public.reservas%rowtype;
  v_existing public.expected_payments%rowtype;
  v_created public.expected_payments%rowtype;
  v_method text := lower(btrim(COALESCE(p_payment_method, '')));
  v_paid numeric := 0;
  v_pending numeric := 0;
  v_direct_committed numeric := 0;
  v_available bigint := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Esta funcion solo puede ejecutarse desde el servidor.' USING ERRCODE = '42501';
  END IF;
  IF p_operation_id IS NULL OR p_reservation_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Faltan identificadores requeridos.' USING ERRCODE = '22023';
  END IF;
  IF p_expected_amount_cop IS NULL OR p_expected_amount_cop <= 0 OR p_expected_amount_cop > 100000000 THEN
    RAISE EXCEPTION 'El monto esperado no es valido.' USING ERRCODE = '22003';
  END IF;
  IF v_method NOT IN ('llave', 'transferencia') THEN
    RAISE EXCEPTION 'El metodo esperado no es valido.' USING ERRCODE = '22023';
  END IF;
  IF p_expires_minutes IS NULL OR p_expires_minutes < 5 OR p_expires_minutes > 1440 THEN
    RAISE EXCEPTION 'La vigencia debe estar entre 5 y 1440 minutos.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));

  v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel(p_pilot_hotel_name);
  SELECT * INTO v_actor
    FROM public.usuarios u
   WHERE u.id = p_actor_id
     AND u.hotel_id = v_pilot_hotel_id
     AND u.activo IS TRUE;
  IF NOT FOUND OR NOT (
    lower(btrim(COALESCE(v_actor.rol::text, ''))) IN ('admin', 'superadmin', 'administrador')
    OR EXISTS (
      SELECT 1 FROM public.hoteles h
       WHERE h.id = v_pilot_hotel_id AND h.creado_por = p_actor_id
    )
  ) THEN
    RAISE EXCEPTION 'El actor no administra el hotel piloto.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
    FROM public.expected_payments ep
   WHERE ep.id = p_operation_id;
  IF FOUND THEN
    IF v_existing.hotel_id IS DISTINCT FROM v_pilot_hotel_id
       OR v_existing.reservation_id IS DISTINCT FROM p_reservation_id
       OR v_existing.expected_amount_cop IS DISTINCT FROM p_expected_amount_cop
       OR v_existing.payment_method IS DISTINCT FROM v_method
       OR v_existing.expires_at IS DISTINCT FROM
          v_existing.created_at + make_interval(mins => p_expires_minutes) THEN
      RAISE EXCEPTION 'La clave de idempotencia ya fue usada con otros datos.' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'idempotent', true,
      'expected_payment', jsonb_build_object(
        'id', v_existing.id,
        'reservation_id', v_existing.reservation_id,
        'room_id', v_existing.room_id,
        'expected_amount_cop', v_existing.expected_amount_cop,
        'payment_method', v_existing.payment_method,
        'status', v_existing.status,
        'expires_at', v_existing.expires_at,
        'created_at', v_existing.created_at
      )
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_pilot_hotel_id::text || ':expected-matching',
    0
  ));

  SELECT * INTO v_reservation
    FROM public.reservas r
   WHERE r.id = p_reservation_id
     AND r.hotel_id = v_pilot_hotel_id
     AND r.estado::text IN (
       'activa', 'check_in', 'ocupada', 'pendiente', 'reservada',
       'confirmada', 'tiempo agotado'
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no esta activa en el hotel piloto.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.expected_payments
     SET status = 'expired', updated_at = now()
   WHERE hotel_id = v_pilot_hotel_id
     AND reservation_id = p_reservation_id
     AND status = 'pending'
     AND expires_at < now();

  SELECT GREATEST(
           COALESCE(v_reservation.monto_pagado, 0),
           COALESCE(sum(pr.monto), 0)
         )
    INTO v_paid
    FROM public.pagos_reserva pr
   WHERE pr.hotel_id = v_pilot_hotel_id
     AND pr.reserva_id = p_reservation_id;
  SELECT COALESCE(sum(ep.expected_amount_cop), 0)
    INTO v_pending
    FROM public.expected_payments ep
   WHERE ep.hotel_id = v_pilot_hotel_id
     AND ep.reservation_id = p_reservation_id
     AND ep.status IN ('pending', 'matched', 'confirmed')
     AND (ep.status <> 'pending' OR ep.expires_at IS NULL OR ep.expires_at >= now());
  SELECT COALESCE(sum(e.amount_cop), 0)
    INTO v_direct_committed
    FROM public.bank_payment_events e
   WHERE e.hotel_id = v_pilot_hotel_id
     AND e.status IN ('matched', 'confirmed')
     AND e.matched_expected_payment_id IS NULL
     AND e.matched_reservation_id = p_reservation_id;
  v_available := GREATEST(
    0,
    floor(
      COALESCE(v_reservation.monto_total, 0)
      - COALESCE(v_paid, 0)
      - COALESCE(v_pending, 0)
      - COALESCE(v_direct_committed, 0)
    )::bigint
  );
  IF p_expected_amount_cop > v_available THEN
    RAISE EXCEPTION 'El monto supera el saldo disponible de la reserva.' USING ERRCODE = '22003';
  END IF;

  INSERT INTO public.expected_payments (
    id, hotel_id, reservation_id, room_id, expected_amount_cop,
    payment_method, status, created_by, expires_at
  ) VALUES (
    p_operation_id, v_pilot_hotel_id, v_reservation.id, v_reservation.habitacion_id,
    p_expected_amount_cop, v_method, 'pending', p_actor_id,
    now() + make_interval(mins => p_expires_minutes)
  ) RETURNING * INTO v_created;

  PERFORM public.bank_email_write_audit(
    v_pilot_hotel_id, p_actor_id, 'expected_payment_created', NULL,
    jsonb_build_object(
      'expected_payment_id', v_created.id,
      'reservation_id', v_created.reservation_id,
      'amount_cop', v_created.expected_amount_cop,
      'payment_method', v_created.payment_method,
      'expires_at', v_created.expires_at
    )
  );
  RETURN jsonb_build_object(
    'idempotent', false,
    'expected_payment', jsonb_build_object(
      'id', v_created.id,
      'reservation_id', v_created.reservation_id,
      'room_id', v_created.room_id,
      'expected_amount_cop', v_created.expected_amount_cop,
      'payment_method', v_created.payment_method,
      'status', v_created.status,
      'expires_at', v_created.expires_at,
      'created_at', v_created.created_at
    )
  );
END;
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
  v_reference text;
BEGIN
  SELECT * INTO v_event
    FROM public.bank_payment_events
   WHERE id = p_payment_event_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF COALESCE((v_event.metadata ->> 'is_test')::boolean, false) THEN RETURN; END IF;
  IF v_event.status IN ('duplicated') THEN RETURN; END IF;
  IF v_event.status = 'rejected' AND v_event.reviewed_by IS NULL THEN RETURN; END IF;

  v_amount := replace(to_char(v_event.amount_cop, 'FM999,999,999,999,990'), ',', '.');
  v_reference := CASE
    WHEN COALESCE(btrim(v_event.transaction_reference), '') = '' THEN ''
    ELSE E'\nReferencia: ***' || right(btrim(v_event.transaction_reference), 4)
  END;
  v_message := 'Pago bancario por $' || v_amount
    || CASE WHEN COALESCE(btrim(v_event.bank_name), '') = '' THEN '' ELSE E'\nBanco: ' || btrim(v_event.bank_name) END
    || v_reference
    || E'\nEstado: ' || v_event.status;

  INSERT INTO public.notificaciones (
    hotel_id, usuario_id, user_id, rol_destino, tipo, mensaje,
    entidad_tipo, entidad_id, leida, creado_en, actualizado_en
  )
  SELECT
    v_event.hotel_id, u.id, u.id, NULL,
    'general_info'::public.tipo_notificacion_enum,
    v_message, 'bank_payment_event', v_event.id, false, now(), now()
  FROM public.usuarios u
  WHERE u.hotel_id = v_event.hotel_id AND u.activo IS TRUE
  ON CONFLICT (hotel_id, usuario_id, entidad_tipo, entidad_id)
    WHERE entidad_tipo = 'bank_payment_event' AND usuario_id IS NOT NULL
  DO UPDATE SET
    mensaje = EXCLUDED.mensaje,
    leida = false,
    actualizado_en = now(),
    user_id = EXCLUDED.user_id,
    rol_destino = NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bank_email_handle_reservation_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pilot_hotel_id uuid;
  v_reason text;
  v_event_ids uuid[];
  v_all_event_ids uuid[];
  v_event_id uuid;
  v_cancelled integer := 0;
BEGIN
  BEGIN
    v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel('Hotel Marena San Isidro');
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;
  IF OLD.hotel_id IS DISTINCT FROM v_pilot_hotel_id THEN
    RETURN NEW;
  END IF;

  v_reason := CASE
    WHEN NEW.hotel_id IS DISTINCT FROM OLD.hotel_id THEN 'reservation_hotel_changed'
    WHEN NEW.estado::text NOT IN (
      'activa', 'check_in', 'ocupada', 'pendiente', 'reservada',
      'confirmada', 'tiempo agotado'
    ) THEN 'reservation_inactive'
    WHEN NEW.habitacion_id IS DISTINCT FROM OLD.habitacion_id THEN 'reservation_room_changed'
    WHEN NEW.monto_total IS DISTINCT FROM OLD.monto_total
      OR NEW.monto_pagado IS DISTINCT FROM OLD.monto_pagado THEN 'reservation_balance_changed'
    ELSE NULL
  END;
  IF v_reason IS NULL THEN
    RETURN NEW;
  END IF;

  -- Reservation UPDATE already owns the parent row. Other pilot ledger paths
  -- take this global lock without locking the reservation, so the trigger can
  -- safely invalidate stale intents after whichever operation was first.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_pilot_hotel_id::text || ':expected-matching',
    0
  ));

  SELECT array_agg(DISTINCT e.id ORDER BY e.id)
    INTO v_event_ids
    FROM public.bank_payment_events e
   WHERE e.hotel_id = v_pilot_hotel_id
     AND e.status = 'matched'
     AND (
       e.matched_reservation_id = OLD.id
       OR e.matched_expected_payment_id IN (
         SELECT ep.id
           FROM public.expected_payments ep
          WHERE ep.hotel_id = v_pilot_hotel_id
            AND ep.reservation_id = OLD.id
       )
     );

  IF NEW.hotel_id IS DISTINCT FROM OLD.hotel_id
     OR NEW.habitacion_id IS DISTINCT FROM OLD.habitacion_id THEN
    SELECT array_agg(DISTINCT event_id ORDER BY event_id)
      INTO v_all_event_ids
      FROM (
        SELECT unnest(COALESCE(v_event_ids, ARRAY[]::uuid[])) AS event_id
        UNION
        SELECT e.id
          FROM public.bank_payment_events e
         WHERE e.hotel_id = v_pilot_hotel_id
           AND e.matched_reservation_id = OLD.id
      ) affected;
  ELSE
    v_all_event_ids := v_event_ids;
  END IF;

  UPDATE public.bank_payment_events e
     SET status = 'manual_review',
         matched_expected_payment_id = NULL,
         matched_reservation_id = CASE
           WHEN NEW.hotel_id IS DISTINCT FROM OLD.hotel_id THEN NULL
           ELSE e.matched_reservation_id
         END,
         matched_room_id = CASE
           WHEN NEW.habitacion_id IS DISTINCT FROM OLD.habitacion_id THEN NULL
           ELSE e.matched_room_id
         END,
         review_reason = v_reason,
         metadata = e.metadata || jsonb_build_object(
           'reservation_invalidated', true,
           'reservation_invalidation_reason', v_reason,
           'reservation_invalidated_at', now()
         )
   WHERE e.id = ANY(COALESCE(v_event_ids, ARRAY[]::uuid[]));

  IF NEW.hotel_id IS DISTINCT FROM OLD.hotel_id
     OR NEW.habitacion_id IS DISTINCT FROM OLD.habitacion_id THEN
    UPDATE public.bank_payment_events e
       SET matched_reservation_id = CASE
             WHEN NEW.hotel_id IS DISTINCT FROM OLD.hotel_id THEN NULL
             ELSE e.matched_reservation_id
           END,
           matched_room_id = CASE
             WHEN NEW.habitacion_id IS DISTINCT FROM OLD.habitacion_id THEN NULL
             ELSE e.matched_room_id
           END,
           metadata = e.metadata || jsonb_build_object(
             'reservation_relation_changed', true,
             'relation_invalidated', true,
             'reservation_relation_change_reason', v_reason,
             'reservation_relation_changed_at', now()
           )
     WHERE e.hotel_id = v_pilot_hotel_id
       AND e.matched_reservation_id = OLD.id
       AND e.status <> 'matched';
  END IF;

  UPDATE public.expected_payments ep
     SET status = 'cancelled',
         matched_bank_payment_id = NULL,
         reservation_id = CASE
           WHEN NEW.hotel_id IS DISTINCT FROM OLD.hotel_id THEN NULL
           ELSE ep.reservation_id
         END,
         room_id = CASE
           WHEN NEW.habitacion_id IS DISTINCT FROM OLD.habitacion_id THEN NULL
           ELSE ep.room_id
         END,
         updated_at = now()
   WHERE ep.hotel_id = v_pilot_hotel_id
     AND ep.reservation_id = OLD.id
     AND ep.status IN ('pending', 'matched');
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  IF NEW.hotel_id IS DISTINCT FROM OLD.hotel_id
     OR NEW.habitacion_id IS DISTINCT FROM OLD.habitacion_id THEN
    UPDATE public.expected_payments ep
       SET reservation_id = CASE
             WHEN NEW.hotel_id IS DISTINCT FROM OLD.hotel_id THEN NULL
             ELSE ep.reservation_id
           END,
           room_id = CASE
             WHEN NEW.habitacion_id IS DISTINCT FROM OLD.habitacion_id THEN NULL
             ELSE ep.room_id
           END,
           updated_at = now()
     WHERE ep.hotel_id = v_pilot_hotel_id
       AND ep.reservation_id = OLD.id
       AND ep.status IN ('confirmed', 'cancelled', 'expired');
  END IF;

  IF v_cancelled > 0 THEN
    PERFORM public.bank_email_write_audit(
      v_pilot_hotel_id, NULL, 'expected_payment_cancelled', NULL,
      jsonb_build_object(
        'reason', v_reason,
        'reservation_id', OLD.id,
        'cancelled_count', v_cancelled
      )
    );
  END IF;
  FOREACH v_event_id IN ARRAY COALESCE(v_all_event_ids, ARRAY[]::uuid[]) LOOP
    PERFORM public.bank_email_write_audit(
      v_pilot_hotel_id, NULL, 'relation_changed', v_event_id,
      jsonb_build_object('reason', v_reason, 'reservation_id', OLD.id)
    );
  END LOOP;
  FOREACH v_event_id IN ARRAY COALESCE(v_event_ids, ARRAY[]::uuid[]) LOOP
    PERFORM public.bank_email_notify_payment_event(v_event_id);
  END LOOP;
  RETURN NEW;
END;
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
    v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel('Hotel Marena San Isidro');
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

DROP TRIGGER IF EXISTS bank_email_reservation_update_trg ON public.reservas;
CREATE TRIGGER bank_email_reservation_update_trg
BEFORE UPDATE OF hotel_id, habitacion_id, estado, monto_total, monto_pagado
ON public.reservas
FOR EACH ROW EXECUTE FUNCTION public.bank_email_handle_reservation_update();

DROP TRIGGER IF EXISTS bank_email_reservation_delete_trg ON public.reservas;
CREATE TRIGGER bank_email_reservation_delete_trg
BEFORE DELETE ON public.reservas
FOR EACH ROW EXECUTE FUNCTION public.bank_email_mark_deleted_relation();

DROP TRIGGER IF EXISTS bank_email_room_delete_trg ON public.habitaciones;
CREATE TRIGGER bank_email_room_delete_trg
BEFORE DELETE ON public.habitaciones
FOR EACH ROW EXECUTE FUNCTION public.bank_email_mark_deleted_relation();

CREATE OR REPLACE FUNCTION public.bank_email_after_payment_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_action text;
BEGIN
  v_action := CASE
    WHEN NEW.status = 'duplicated' THEN 'duplicate_detected'
    WHEN NEW.status = 'rejected' THEN 'payment_rejected'
    ELSE 'payment_detected'
  END;
  PERFORM public.bank_email_write_audit(
    NEW.hotel_id, NULL, v_action, NEW.id,
    jsonb_build_object(
      'provider', NEW.provider,
      'bank_name', COALESCE(NEW.bank_name, ''),
      'amount_cop', NEW.amount_cop,
      'status', NEW.status,
      'is_test', COALESCE((NEW.metadata ->> 'is_test')::boolean, false)
    )
  );
  PERFORM public.bank_email_notify_payment_event(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS bank_email_after_payment_insert_trg ON public.bank_payment_events;
CREATE TRIGGER bank_email_after_payment_insert_trg
AFTER INSERT ON public.bank_payment_events
FOR EACH ROW EXECUTE FUNCTION public.bank_email_after_payment_insert();

CREATE OR REPLACE FUNCTION public.claim_bank_email_pubsub_inbox(p_limit integer DEFAULT 10)
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
  v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel('Hotel Marena San Isidro');
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

CREATE OR REPLACE FUNCTION public.match_bank_payment_event(
  p_payment_event_id uuid,
  p_pilot_hotel_name text DEFAULT 'Hotel Marena San Isidro',
  p_window_minutes integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pilot_hotel_id uuid;
  v_event public.bank_payment_events%rowtype;
  v_expected public.expected_payments%rowtype;
  v_candidate_ids uuid[];
  v_count integer;
  v_payment_time timestamp with time zone;
BEGIN
  IF p_window_minutes IS NULL OR p_window_minutes < 1 OR p_window_minutes > 1440 THEN
    RAISE EXCEPTION 'La ventana debe estar entre 1 y 1440 minutos.' USING ERRCODE = '22023';
  END IF;
  v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel(p_pilot_hotel_name);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_pilot_hotel_id::text || ':expected-matching',
    0
  ));

  SELECT * INTO v_event
    FROM public.bank_payment_events
   WHERE id = p_payment_event_id
   FOR UPDATE;
  IF NOT FOUND OR v_event.hotel_id IS DISTINCT FROM v_pilot_hotel_id THEN
    RAISE EXCEPTION 'Evento bancario no encontrado en el hotel piloto.' USING ERRCODE = 'P0002';
  END IF;
  IF v_event.status IN ('matched', 'confirmed', 'rejected', 'duplicated') THEN
    RETURN jsonb_build_object('payment_event_id', v_event.id, 'status', v_event.status, 'idempotent', true);
  END IF;

  v_payment_time := COALESCE(v_event.transaction_occurred_at, v_event.email_received_at, v_event.detected_at);
  SELECT array_agg(x.id ORDER BY x.created_at, x.id::text)
    INTO v_candidate_ids
    FROM (
      SELECT ep.id, ep.created_at
        FROM public.expected_payments ep
       WHERE ep.hotel_id = v_pilot_hotel_id
         AND ep.status = 'pending'
         AND lower(btrim(ep.payment_method)) IN ('llave', 'transferencia')
         AND ep.expected_amount_cop = v_event.amount_cop
         AND ep.created_at BETWEEN
             v_payment_time - make_interval(mins => p_window_minutes)
             AND v_payment_time + make_interval(mins => p_window_minutes)
         AND (ep.expires_at IS NULL OR ep.expires_at >= v_payment_time)
         AND (
           public.bank_email_sale_is_payable(
             ep.sale_type, ep.sale_id, v_pilot_hotel_id
           ) AND ep.sale_id IS NOT NULL
           OR EXISTS (
             SELECT 1
               FROM public.reservas r
              WHERE r.id = ep.reservation_id
                AND r.hotel_id = v_pilot_hotel_id
                AND r.estado::text IN (
                  'activa', 'check_in', 'ocupada', 'pendiente', 'reservada',
                  'confirmada', 'tiempo agotado'
                )
           )
         )
       FOR UPDATE
    ) x;
  v_count := COALESCE(cardinality(v_candidate_ids), 0);

  IF v_count = 1 THEN
    SELECT * INTO v_expected FROM public.expected_payments WHERE id = v_candidate_ids[1];
    UPDATE public.expected_payments
       SET status = 'matched', matched_bank_payment_id = v_event.id
     WHERE id = v_expected.id;
    UPDATE public.bank_payment_events
       SET status = 'matched',
           matched_reservation_id = v_expected.reservation_id,
           matched_room_id = COALESCE(v_expected.room_id, (
             SELECT r.habitacion_id FROM public.reservas r WHERE r.id = v_expected.reservation_id
           )),
           matched_sale_id = v_expected.sale_id,
           matched_sale_type = v_expected.sale_type,
           matched_expected_payment_id = v_expected.id,
           review_reason = NULL,
           metadata = v_event.metadata || jsonb_build_object(
             'matching_completed', true,
             'matching_completed_at', now()
           )
     WHERE id = v_event.id
     RETURNING * INTO v_event;
    PERFORM public.bank_email_write_audit(
      v_event.hotel_id, NULL, 'auto_matched', v_event.id,
      jsonb_build_object('expected_payment_id', v_expected.id, 'window_minutes', p_window_minutes)
    );
  ELSIF v_count > 1 THEN
    UPDATE public.bank_payment_events
       SET status = 'manual_review',
           review_reason = 'multiple_expected_payments',
           metadata = v_event.metadata || jsonb_build_object(
             'matching_completed', true,
             'matching_completed_at', now()
           )
     WHERE id = v_event.id RETURNING * INTO v_event;
    PERFORM public.bank_email_write_audit(
      v_event.hotel_id, NULL, 'matching_ambiguous', v_event.id,
      jsonb_build_object('candidate_count', v_count, 'window_minutes', p_window_minutes)
    );
  ELSE
    UPDATE public.bank_payment_events
       SET status = 'detected',
           review_reason = 'no_expected_payment_match',
           metadata = v_event.metadata || jsonb_build_object(
             'matching_completed', true,
             'matching_completed_at', now()
           )
     WHERE id = v_event.id RETURNING * INTO v_event;
    PERFORM public.bank_email_write_audit(
      v_event.hotel_id, NULL, 'no_match', v_event.id,
      jsonb_build_object('window_minutes', p_window_minutes)
    );
  END IF;

  PERFORM public.bank_email_notify_payment_event(v_event.id);
  RETURN jsonb_build_object(
    'payment_event_id', v_event.id,
    'status', v_event.status,
    'candidate_count', v_count,
    'matched_expected_payment_id', v_event.matched_expected_payment_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.review_bank_payment_event(
  p_payment_event_id uuid,
  p_action text,
  p_actor_id uuid,
  p_reservation_id uuid DEFAULT NULL,
  p_room_id uuid DEFAULT NULL,
  p_sale_id uuid DEFAULT NULL,
  p_sale_type text DEFAULT NULL,
  p_expected_payment_id uuid DEFAULT NULL,
  p_review_reason text DEFAULT NULL,
  p_pilot_hotel_name text DEFAULT 'Hotel Marena San Isidro'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_id uuid := p_actor_id;
  v_pilot_hotel_id uuid;
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_event public.bank_payment_events%rowtype;
  v_expected public.expected_payments%rowtype;
  v_reservation_id uuid := p_reservation_id;
  v_room_id uuid := p_room_id;
  v_sale_id uuid := p_sale_id;
  v_sale_type text := p_sale_type;
  v_expected_payment_id uuid := p_expected_payment_id;
  v_old_relations jsonb;
  v_room_reservation_ids uuid[];
  v_payment_time timestamp with time zone;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Esta funcion solo puede ejecutarse desde el servidor.' USING ERRCODE = '42501';
  END IF;
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Falta el usuario verificado.' USING ERRCODE = '42501'; END IF;
  IF v_action NOT IN ('link', 'confirm', 'reject', 'mark_reviewed') THEN
    RAISE EXCEPTION 'Accion manual no valida.' USING ERRCODE = '22023';
  END IF;
  v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel(p_pilot_hotel_name);
  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios u
     WHERE u.id = v_actor_id
       AND u.hotel_id = v_pilot_hotel_id
       AND u.activo IS TRUE
  ) THEN
    RAISE EXCEPTION 'El usuario verificado no tiene acceso activo al hotel piloto.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_pilot_hotel_id::text || ':expected-matching',
    0
  ));

  SELECT * INTO v_event
    FROM public.bank_payment_events
   WHERE id = p_payment_event_id AND hotel_id = v_pilot_hotel_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evento bancario no encontrado.' USING ERRCODE = 'P0002'; END IF;
  IF v_event.status = 'duplicated' THEN RAISE EXCEPTION 'Un duplicado no puede revisarse.'; END IF;
  IF v_event.status = 'confirmed' AND v_action = 'confirm' THEN
    RETURN jsonb_build_object('payment_event', to_jsonb(v_event), 'idempotent', true);
  END IF;
  IF v_event.status IN ('confirmed', 'rejected') AND v_action <> 'mark_reviewed' THEN
    RAISE EXCEPTION 'El evento ya esta en un estado terminal y no admite esta transicion.'
      USING ERRCODE = '22023';
  END IF;
  v_payment_time := COALESCE(
    v_event.transaction_occurred_at,
    v_event.email_received_at,
    v_event.detected_at
  );

  v_old_relations := jsonb_build_object(
    'reservation_id', v_event.matched_reservation_id,
    'room_id', v_event.matched_room_id,
    'sale_id', v_event.matched_sale_id,
    'sale_type', v_event.matched_sale_type,
    'expected_payment_id', v_event.matched_expected_payment_id
  );

  IF v_action IN ('link', 'confirm') THEN
    IF v_action = 'confirm' AND v_event.status = 'matched'
       AND v_expected_payment_id IS NULL THEN
      v_expected_payment_id := v_event.matched_expected_payment_id;
    END IF;

    IF v_reservation_id IS NULL AND v_room_id IS NULL AND v_sale_id IS NULL
       AND v_expected_payment_id IS NULL THEN
      v_reservation_id := v_event.matched_reservation_id;
      v_room_id := v_event.matched_room_id;
      v_sale_id := v_event.matched_sale_id;
      v_sale_type := v_event.matched_sale_type;
      v_expected_payment_id := v_event.matched_expected_payment_id;
    END IF;

    IF v_expected_payment_id IS NOT NULL THEN
      SELECT * INTO v_expected
        FROM public.expected_payments ep
       WHERE ep.id = v_expected_payment_id AND ep.hotel_id = v_pilot_hotel_id
       FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Pago esperado no encontrado.'; END IF;
      IF v_expected.expected_amount_cop IS DISTINCT FROM v_event.amount_cop THEN
        RAISE EXCEPTION 'El monto del pago esperado no coincide.';
      END IF;
      IF lower(btrim(v_expected.payment_method)) NOT IN ('llave', 'transferencia') THEN
        RAISE EXCEPTION 'El metodo del pago esperado no admite relacion bancaria.' USING ERRCODE = '22023';
      END IF;
      IF v_expected.matched_bank_payment_id IS NOT NULL
         AND v_expected.matched_bank_payment_id IS DISTINCT FROM v_event.id THEN
        RAISE EXCEPTION 'El pago esperado ya esta relacionado con otro evento.';
      END IF;
      IF NOT (
        v_expected.status = 'pending'
        AND v_expected.matched_bank_payment_id IS NULL
        AND lower(btrim(v_expected.payment_method)) IN ('llave', 'transferencia')
        AND (v_expected.expires_at IS NULL OR v_expected.expires_at >= v_payment_time)
        AND v_expected.created_at >= v_payment_time - interval '1 day'
        AND v_expected.created_at <= v_payment_time + interval '1 day'
      ) AND NOT (
        v_expected.status IN ('matched', 'confirmed')
        AND v_expected.status = v_event.status
        AND v_expected.matched_bank_payment_id = v_event.id
      ) THEN
        RAISE EXCEPTION 'El pago esperado ya no esta vigente o no puede relacionarse.'
          USING ERRCODE = '22023';
      END IF;
      IF p_reservation_id IS NOT NULL
         AND p_reservation_id IS DISTINCT FROM v_expected.reservation_id THEN
        RAISE EXCEPTION 'La reserva enviada no coincide con el pago esperado.' USING ERRCODE = '22023';
      END IF;
      IF p_room_id IS NOT NULL AND p_room_id IS DISTINCT FROM v_expected.room_id THEN
        RAISE EXCEPTION 'La habitacion enviada no coincide con el pago esperado.' USING ERRCODE = '22023';
      END IF;
      IF p_sale_id IS NOT NULL AND p_sale_id IS DISTINCT FROM v_expected.sale_id THEN
        RAISE EXCEPTION 'La venta enviada no coincide con el pago esperado.' USING ERRCODE = '22023';
      END IF;
      IF p_sale_type IS NOT NULL
         AND lower(btrim(p_sale_type)) IS DISTINCT FROM v_expected.sale_type THEN
        RAISE EXCEPTION 'El tipo de venta no coincide con el pago esperado.' USING ERRCODE = '22023';
      END IF;
      IF NOT (
        v_expected.sale_id IS NOT NULL
        AND public.bank_email_sale_is_payable(
          v_expected.sale_type, v_expected.sale_id, v_pilot_hotel_id
        )
      ) AND NOT EXISTS (
        SELECT 1
          FROM public.reservas r
         WHERE r.id = v_expected.reservation_id
           AND r.hotel_id = v_pilot_hotel_id
           AND r.estado::text IN (
             'activa', 'check_in', 'ocupada', 'pendiente', 'reservada',
             'confirmada', 'tiempo agotado'
           )
      ) THEN
        RAISE EXCEPTION 'El pago esperado no tiene una reserva activa ni una venta vigente.'
          USING ERRCODE = '22023';
      END IF;
      v_reservation_id := v_expected.reservation_id;
      v_room_id := v_expected.room_id;
      v_sale_id := v_expected.sale_id;
      v_sale_type := v_expected.sale_type;
    END IF;

    IF v_reservation_id IS NULL AND v_room_id IS NOT NULL
       AND v_sale_id IS NULL AND v_expected_payment_id IS NULL THEN
      SELECT array_agg(r.id ORDER BY r.creado_en DESC, r.id::text)
        INTO v_room_reservation_ids
        FROM public.reservas r
       WHERE r.hotel_id = v_pilot_hotel_id
         AND r.habitacion_id = v_room_id
         AND r.estado::text IN (
           'activa', 'check_in', 'ocupada', 'pendiente', 'reservada',
           'confirmada', 'tiempo agotado'
         );
      IF COALESCE(cardinality(v_room_reservation_ids), 0) = 1 THEN
        v_reservation_id := v_room_reservation_ids[1];
      ELSE
        RAISE EXCEPTION 'La habitacion no tiene una unica reserva activa; selecciona la reserva exacta.';
      END IF;
    END IF;

    IF v_reservation_id IS NOT NULL AND v_room_id IS NULL THEN
      SELECT r.habitacion_id INTO v_room_id
        FROM public.reservas r
       WHERE r.id = v_reservation_id AND r.hotel_id = v_pilot_hotel_id;
    END IF;
    IF v_reservation_id IS NULL AND v_room_id IS NULL AND v_sale_id IS NULL
       AND v_expected_payment_id IS NULL THEN
      RAISE EXCEPTION 'Debes indicar una reserva, habitacion, venta o pago esperado.';
    END IF;

    IF v_reservation_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
          FROM public.reservas r
         WHERE r.id = v_reservation_id
           AND r.hotel_id = v_pilot_hotel_id
           AND r.estado::text IN (
             'activa', 'check_in', 'ocupada', 'pendiente', 'reservada',
             'confirmada', 'tiempo agotado'
           )
      ) THEN
        RAISE EXCEPTION 'La reserva seleccionada ya no esta activa.' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v_sale_id IS NOT NULL THEN
      IF NOT public.bank_email_sale_is_payable(
        v_sale_type, v_sale_id, v_pilot_hotel_id
      ) THEN
        RAISE EXCEPTION 'La venta seleccionada no existe, no pertenece al piloto o ya no esta pendiente.'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    -- Release the previous expected payment before cancelling direct targets.
    -- If the corrected direct target is the same reservation, this ordering
    -- prevents the old intent from being revived and counted twice.
    UPDATE public.expected_payments
       SET status = CASE
             WHEN expires_at IS NOT NULL AND expires_at < now() THEN 'expired'
             ELSE 'pending'
           END,
           matched_bank_payment_id = NULL
     WHERE matched_bank_payment_id = v_event.id
       AND id IS DISTINCT FROM v_expected_payment_id
       AND status IN ('matched', 'confirmed');

    IF v_expected_payment_id IS NULL AND (v_reservation_id IS NOT NULL OR v_room_id IS NOT NULL) THEN
      UPDATE public.expected_payments
         SET status = 'cancelled', matched_bank_payment_id = NULL, updated_at = now()
       WHERE hotel_id = v_pilot_hotel_id
         AND status = 'pending'
         AND (
           (v_reservation_id IS NOT NULL AND reservation_id = v_reservation_id)
           OR (v_reservation_id IS NULL AND v_room_id IS NOT NULL AND room_id = v_room_id)
         );
    END IF;

    IF v_expected_payment_id IS NOT NULL THEN
      UPDATE public.expected_payments
         SET status = CASE WHEN v_action = 'confirm' THEN 'confirmed' ELSE 'matched' END,
             matched_bank_payment_id = v_event.id
       WHERE id = v_expected_payment_id;
    END IF;

    UPDATE public.bank_payment_events
       SET status = CASE WHEN v_action = 'confirm' THEN 'confirmed' ELSE 'matched' END,
           matched_reservation_id = v_reservation_id,
           matched_room_id = v_room_id,
           matched_sale_id = v_sale_id,
           matched_sale_type = v_sale_type,
           matched_expected_payment_id = v_expected_payment_id,
           review_reason = NULLIF(btrim(COALESCE(p_review_reason, '')), ''),
           reviewed_by = v_actor_id,
           reviewed_at = now(),
           confirmed_by = CASE WHEN v_action = 'confirm' THEN v_actor_id ELSE NULL END,
           confirmed_at = CASE WHEN v_action = 'confirm' THEN now() ELSE NULL END
     WHERE id = v_event.id
     RETURNING * INTO v_event;

    PERFORM public.bank_email_write_audit(
      v_event.hotel_id, v_actor_id, 'relation_changed', v_event.id,
      jsonb_build_object(
        'before', v_old_relations,
        'after', jsonb_build_object(
          'reservation_id', v_event.matched_reservation_id,
          'room_id', v_event.matched_room_id,
          'sale_id', v_event.matched_sale_id,
          'sale_type', v_event.matched_sale_type,
          'expected_payment_id', v_event.matched_expected_payment_id
        )
      )
    );
    IF v_action = 'confirm' THEN
      PERFORM public.bank_email_write_audit(
        v_event.hotel_id, v_actor_id, 'manual_confirmed', v_event.id,
        jsonb_build_object('amount_cop', v_event.amount_cop)
      );
    END IF;
  ELSIF v_action = 'reject' THEN
    UPDATE public.expected_payments
       SET status = CASE
             WHEN expires_at IS NOT NULL AND expires_at < now() THEN 'expired'
             WHEN reservation_id IS NOT NULL AND NOT EXISTS (
               SELECT 1
                 FROM public.reservas r
                WHERE r.id = expected_payments.reservation_id
                  AND r.hotel_id = v_pilot_hotel_id
                  AND r.estado::text IN (
                    'activa', 'check_in', 'ocupada', 'pendiente', 'reservada',
                    'confirmada', 'tiempo agotado'
                  )
             ) THEN 'cancelled'
             ELSE 'pending'
           END,
           matched_bank_payment_id = NULL
     WHERE matched_bank_payment_id = v_event.id AND status IN ('matched', 'confirmed');
    UPDATE public.bank_payment_events
       SET status = 'rejected',
           matched_reservation_id = NULL,
           matched_room_id = NULL,
           matched_sale_id = NULL,
           matched_sale_type = NULL,
           matched_expected_payment_id = NULL,
           review_reason = COALESCE(NULLIF(btrim(COALESCE(p_review_reason, '')), ''), 'rejected_by_user'),
           reviewed_by = v_actor_id,
           reviewed_at = now(),
           confirmed_by = NULL,
           confirmed_at = NULL
     WHERE id = v_event.id RETURNING * INTO v_event;
    PERFORM public.bank_email_write_audit(
      v_event.hotel_id, v_actor_id, 'payment_rejected', v_event.id,
      jsonb_build_object('reason', v_event.review_reason, 'previous_relations', v_old_relations)
    );
  ELSE
    UPDATE public.bank_payment_events
       SET reviewed_by = v_actor_id,
           reviewed_at = now(),
           review_reason = COALESCE(NULLIF(btrim(COALESCE(p_review_reason, '')), ''), review_reason)
     WHERE id = v_event.id RETURNING * INTO v_event;
    PERFORM public.bank_email_write_audit(
      v_event.hotel_id, v_actor_id, 'marked_reviewed', v_event.id,
      jsonb_build_object('status', v_event.status)
    );
  END IF;

  PERFORM public.bank_email_notify_payment_event(v_event.id);
  RETURN jsonb_build_object('payment_event', to_jsonb(v_event));
END;
$function$;

ALTER TABLE public.bank_email_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_email_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_email_pubsub_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expected_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_payment_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_payment_events_select_pilot ON public.bank_payment_events;
CREATE POLICY bank_payment_events_select_pilot
ON public.bank_payment_events FOR SELECT TO authenticated
USING (public.bank_email_user_has_pilot_access(hotel_id));

DROP POLICY IF EXISTS expected_payments_select_pilot ON public.expected_payments;
CREATE POLICY expected_payments_select_pilot
ON public.expected_payments FOR SELECT TO authenticated
USING (public.bank_email_user_has_pilot_access(hotel_id));

-- Existing notification policies are permissive and some are role based. These
-- restrictive policies apply only to the new bank-payment entity type, keeping
-- every unrelated notification flow unchanged while closing cross-hotel reads
-- and preventing clients from forging a banking notification.
DROP POLICY IF EXISTS bank_payment_notifications_select_guard ON public.notificaciones;
CREATE POLICY bank_payment_notifications_select_guard
ON public.notificaciones AS RESTRICTIVE FOR SELECT TO authenticated
USING (public.bank_email_notification_is_visible(
  entidad_tipo, hotel_id, usuario_id, user_id, entidad_id
));

DROP POLICY IF EXISTS bank_payment_notifications_update_guard ON public.notificaciones;
CREATE POLICY bank_payment_notifications_update_guard
ON public.notificaciones AS RESTRICTIVE FOR UPDATE TO authenticated
USING (public.bank_email_notification_is_visible(
  entidad_tipo, hotel_id, usuario_id, user_id, entidad_id
))
WITH CHECK (public.bank_email_notification_is_visible(
  entidad_tipo, hotel_id, usuario_id, user_id, entidad_id
));

DROP POLICY IF EXISTS bank_payment_notifications_insert_guard ON public.notificaciones;
CREATE POLICY bank_payment_notifications_insert_guard
ON public.notificaciones AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (
  COALESCE(entidad_tipo, '') NOT IN ('bank_payment_event', 'bank_payment_events', 'bank_email_integration')
);

DROP POLICY IF EXISTS bank_payment_notifications_delete_guard ON public.notificaciones;
CREATE POLICY bank_payment_notifications_delete_guard
ON public.notificaciones AS RESTRICTIVE FOR DELETE TO authenticated
USING (
  COALESCE(entidad_tipo, '') NOT IN ('bank_payment_event', 'bank_payment_events', 'bank_email_integration')
);

-- Integration secrets, OAuth state, queue and audit are server-only.  Payment
-- mutations and reads are server/API-only; authenticated clients have no
-- direct table privileges, preventing exposure of raw Gmail/banking fields.
REVOKE ALL ON TABLE public.bank_email_integrations FROM anon, authenticated;
REVOKE ALL ON TABLE public.bank_email_oauth_states FROM anon, authenticated;
REVOKE ALL ON TABLE public.bank_email_pubsub_inbox FROM anon, authenticated;
REVOKE ALL ON TABLE public.bank_payment_audit_log FROM anon, authenticated;
REVOKE ALL ON TABLE public.bank_payment_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.expected_payments FROM anon, authenticated;
GRANT ALL ON TABLE
  public.bank_email_integrations,
  public.bank_email_oauth_states,
  public.bank_email_pubsub_inbox,
  public.bank_payment_audit_log,
  public.bank_payment_events,
  public.expected_payments
TO service_role;

REVOKE ALL ON FUNCTION public.resolve_bank_email_pilot_hotel(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_user_has_pilot_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_bank_email_pubsub_inbox(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_bank_payment_event(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_expected_bank_payment(uuid, uuid, bigint, text, uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_bank_payment_event(uuid, text, uuid, uuid, uuid, uuid, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_write_audit(uuid, uuid, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_notify_payment_event(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_sale_belongs_to_hotel(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_sale_is_payable(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_notification_is_visible(text, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_guard_notification_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_assert_pilot_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_validate_expected_payment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_validate_payment_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_validate_match_reciprocity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_cancel_pending_on_reservation_payment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_handle_reservation_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_mark_deleted_relation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_validate_integration_link() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_validate_audit_log() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bank_email_after_payment_insert() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.resolve_bank_email_pilot_hotel(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bank_email_user_has_pilot_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bank_email_notification_is_visible(text, uuid, uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_bank_email_pubsub_inbox(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_bank_payment_event(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_expected_bank_payment(uuid, uuid, bigint, text, uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_bank_payment_event(uuid, text, uuid, uuid, uuid, uuid, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bank_email_write_audit(uuid, uuid, text, uuid, jsonb) TO service_role;

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication p
     WHERE p.pubname = 'supabase_realtime' AND NOT p.puballtables
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'notificaciones'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notificaciones';
    END IF;
  END IF;
END;
$do$;

COMMIT;
