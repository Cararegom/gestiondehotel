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
  v_date text;
  v_hour text;
BEGIN
  SELECT * INTO v_event
    FROM public.bank_payment_events
   WHERE id = p_payment_event_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF COALESCE((v_event.metadata ->> 'is_test')::boolean, false) THEN RETURN; END IF;
  IF v_event.status IN ('duplicated') THEN RETURN; END IF;
  IF v_event.status = 'rejected' AND v_event.reviewed_by IS NULL THEN RETURN; END IF;

  v_amount := replace(to_char(v_event.amount_cop, 'FM999,999,999,999,990'), ',', '.');
  v_sender := COALESCE(NULLIF(btrim(v_event.sender_name), ''), 'Remitente no identificado');
  v_payment_time := COALESCE(
    v_event.transaction_occurred_at,
    v_event.email_received_at,
    v_event.detected_at
  );
  v_date := to_char(v_payment_time AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY');
  v_hour := lower(to_char(v_payment_time AT TIME ZONE 'America/Bogota', 'HH12:MI a.m.'));

  v_message := 'Transferencia recibida en la llave @hotelok'
    || E'\nMonto: $' || v_amount
    || E'\nRemitente: ' || v_sender
    || E'\nFecha: ' || v_date
    || E'\nHora: ' || v_hour;

  INSERT INTO public.notificaciones (
    hotel_id, usuario_id, user_id, rol_destino, tipo, mensaje,
    entidad_tipo, entidad_id, leida, creado_en, actualizado_en
  )
  SELECT
    v_event.hotel_id, u.id, u.id, NULL,
    'general_info'::public.tipo_notificacion_enum,
    v_message, 'bank_payment_event', v_event.id, false, now(), now()
  FROM public.usuarios u
  WHERE u.hotel_id = v_event.hotel_id
    AND u.activo IS TRUE
    AND lower(COALESCE(u.rol::text, '')) IN ('recepcionista', 'recepcion', 'admin', 'administrador')
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

REVOKE ALL ON FUNCTION public.bank_email_notify_payment_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bank_email_notify_payment_event(uuid) TO service_role;
