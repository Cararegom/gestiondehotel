-- Fase 5: separa el estado de cobro de la elegibilidad para conciliacion.
-- Exclusivo de Hotel Marena San Isidro. No crea cobros ni modifica ventas/Caja.

CREATE OR REPLACE FUNCTION public.bank_email_sale_is_reconcilable(
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
DECLARE
  v_pilot_hotel_id uuid;
BEGIN
  v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel('Hotel Marena San Isidro');
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

REVOKE ALL ON FUNCTION public.bank_email_sale_is_reconcilable(text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bank_email_sale_is_reconcilable(text, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.bank_email_sale_is_reconcilable(text, uuid, uuid) IS
  'Indica si una venta del piloto puede verificarse contra banco sin depender de si ya fue cobrada.';

CREATE OR REPLACE FUNCTION public.replace_bank_payment_allocations(
  p_payment_event_id uuid,
  p_actor_id uuid,
  p_allocations jsonb,
  p_action text,
  p_review_reason text DEFAULT NULL,
  p_pilot_hotel_name text DEFAULT 'Hotel Marena San Isidro'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hotel_id uuid;
  v_event_snapshot public.bank_payment_events%rowtype;
  v_event public.bank_payment_events%rowtype;
  v_actor public.usuarios%rowtype;
  v_item jsonb;
  v_normalized jsonb := '[]'::jsonb;
  v_previous jsonb := '[]'::jsonb;
  v_type text;
  v_sale_type text;
  v_reservation_id uuid;
  v_room_id uuid;
  v_sale_id uuid;
  v_amount bigint;
  v_total bigint := 0;
  v_count integer;
  v_legacy_reservation uuid;
  v_legacy_room uuid;
  v_legacy_sale uuid;
  v_legacy_sale_type text;
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_reason text := NULLIF(btrim(COALESCE(p_review_reason, '')), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Esta funcion solo puede ejecutarse desde el servidor.'
      USING ERRCODE = '42501';
  END IF;

  IF lower(btrim(COALESCE(p_pilot_hotel_name, ''))) <> 'hotel marena san isidro' THEN
    RAISE EXCEPTION 'Hotel piloto no valido.' USING ERRCODE = '42501';
  END IF;

  IF v_action NOT IN ('link', 'confirm')
     OR jsonb_typeof(p_allocations) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'La distribucion enviada no es valida.' USING ERRCODE = '22023';
  END IF;

  v_count := jsonb_array_length(p_allocations);
  IF v_count < 1 OR v_count > 50 THEN
    RAISE EXCEPTION 'La distribucion debe contener entre 1 y 50 destinos.'
      USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NOT NULL AND length(v_reason) > 500 THEN
    RAISE EXCEPTION 'El motivo no puede superar 500 caracteres.' USING ERRCODE = '22023';
  END IF;

  v_hotel_id := public.resolve_bank_email_pilot_hotel('Hotel Marena San Isidro');

  SELECT * INTO v_actor
    FROM public.usuarios
   WHERE id = p_actor_id
     AND hotel_id = v_hotel_id
     AND activo IS TRUE;

  IF NOT FOUND
     OR lower(COALESCE(v_actor.rol::text, '')) NOT IN ('admin', 'superadmin', 'administrador') THEN
    RAISE EXCEPTION 'Solo un administrador puede conciliar pagos.' USING ERRCODE = '42501';
  END IF;

  -- Lectura inicial para validar todos los destinos sin destruir la distribucion.
  SELECT * INTO v_event_snapshot
    FROM public.bank_payment_events
   WHERE id = p_payment_event_id
     AND hotel_id = v_hotel_id;

  IF NOT FOUND OR v_event_snapshot.status IN ('duplicated', 'rejected') THEN
    RAISE EXCEPTION 'El pago bancario no admite esta distribucion.' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR COALESCE(v_item ->> 'amountCop', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Cada destino debe incluir un valor entero en COP.' USING ERRCODE = '22023';
    END IF;

    v_type := lower(btrim(COALESCE(v_item ->> 'type', '')));
    v_amount := (v_item ->> 'amountCop')::bigint;
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'Cada valor distribuido debe ser mayor que cero.' USING ERRCODE = '22023';
    END IF;
    v_total := v_total + v_amount;

    IF v_type = 'reservation' THEN
      BEGIN
        v_reservation_id := (v_item ->> 'reservationId')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'La reserva seleccionada no es valida.' USING ERRCODE = '22023';
      END;

      SELECT r.habitacion_id INTO v_room_id
        FROM public.reservas r
       WHERE r.id = v_reservation_id
         AND r.hotel_id = v_hotel_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La reserva seleccionada no pertenece al hotel.' USING ERRCODE = '22023';
      END IF;

      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_normalized) n
         WHERE n ->> 'allocation_type' = 'reservation'
           AND n ->> 'reservation_id' = v_reservation_id::text
      ) THEN
        RAISE EXCEPTION 'La reserva esta repetida en la distribucion.' USING ERRCODE = '22023';
      END IF;

      v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
        'allocation_type', 'reservation',
        'reservation_id', v_reservation_id,
        'room_id', v_room_id,
        'amount_cop', v_amount
      ));
    ELSIF v_type = 'sale' THEN
      BEGIN
        v_sale_id := (v_item ->> 'saleId')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'La venta seleccionada no es valida.' USING ERRCODE = '22023';
      END;
      v_sale_type := lower(btrim(COALESCE(v_item ->> 'saleType', '')));

      IF v_sale_type NOT IN ('tienda', 'restaurante', 'terraza', 'venta')
         OR NOT public.bank_email_sale_is_reconcilable(v_sale_type, v_sale_id, v_hotel_id) THEN
        RAISE EXCEPTION 'La venta no existe, no pertenece al piloto o no usa un metodo bancario conciliable.' USING ERRCODE = '22023';
      END IF;

      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_normalized) n
         WHERE n ->> 'allocation_type' = 'sale'
           AND n ->> 'sale_type' = v_sale_type
           AND n ->> 'sale_id' = v_sale_id::text
      ) THEN
        RAISE EXCEPTION 'Una venta esta repetida en la distribucion.' USING ERRCODE = '22023';
      END IF;

      v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
        'allocation_type', 'sale',
        'sale_id', v_sale_id,
        'sale_type', v_sale_type,
        'amount_cop', v_amount
      ));
    ELSE
      RAISE EXCEPTION 'Tipo de distribucion no reconocido.' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF v_total IS DISTINCT FROM v_event_snapshot.amount_cop THEN
    RAISE EXCEPTION 'La suma distribuida debe ser exactamente igual a la transferencia (%).',
      v_event_snapshot.amount_cop USING ERRCODE = '22023';
  END IF;

  -- Serializa escritores concurrentes y confirma que el evento no cambio durante
  -- la validacion previa.
  SELECT * INTO v_event
    FROM public.bank_payment_events
   WHERE id = p_payment_event_id
     AND hotel_id = v_hotel_id
   FOR UPDATE;

  IF NOT FOUND
     OR v_event.status IN ('duplicated', 'rejected')
     OR v_event.amount_cop IS DISTINCT FROM v_event_snapshot.amount_cop
     OR v_event.updated_at IS DISTINCT FROM v_event_snapshot.updated_at THEN
    RAISE EXCEPTION 'El pago bancario cambio mientras se validaba. Vuelve a abrirlo.'
      USING ERRCODE = '40001';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(a) - 'hotel_id' - 'created_by' ORDER BY a.created_at, a.id), '[]'::jsonb)
    INTO v_previous
    FROM public.bank_payment_allocations a
   WHERE a.payment_event_id = v_event.id;

  DELETE FROM public.bank_payment_allocations
   WHERE payment_event_id = v_event.id;

  INSERT INTO public.bank_payment_allocations (
    hotel_id, payment_event_id, allocation_type, reservation_id, room_id,
    sale_id, sale_type, amount_cop, created_by
  )
  SELECT
    v_hotel_id,
    v_event.id,
    n ->> 'allocation_type',
    CASE WHEN n ->> 'allocation_type' = 'reservation' THEN (n ->> 'reservation_id')::uuid END,
    CASE WHEN n ->> 'allocation_type' = 'reservation' THEN (n ->> 'room_id')::uuid END,
    CASE WHEN n ->> 'allocation_type' = 'sale' THEN (n ->> 'sale_id')::uuid END,
    CASE WHEN n ->> 'allocation_type' = 'sale' THEN n ->> 'sale_type' END,
    (n ->> 'amount_cop')::bigint,
    p_actor_id
  FROM jsonb_array_elements(v_normalized) n;

  -- Solo una allocation puede representarse sin perdida en las columnas legacy.
  IF v_count = 1 THEN
    v_item := v_normalized -> 0;
    IF v_item ->> 'allocation_type' = 'reservation' THEN
      v_legacy_reservation := (v_item ->> 'reservation_id')::uuid;
      v_legacy_room := (v_item ->> 'room_id')::uuid;
    ELSE
      v_legacy_sale := (v_item ->> 'sale_id')::uuid;
      v_legacy_sale_type := v_item ->> 'sale_type';
    END IF;
  END IF;

  UPDATE public.bank_payment_events
     SET status = CASE WHEN v_action = 'confirm' THEN 'confirmed' ELSE 'matched' END,
         matched_reservation_id = v_legacy_reservation,
         matched_room_id = v_legacy_room,
         matched_sale_id = v_legacy_sale,
         matched_sale_type = v_legacy_sale_type,
         matched_expected_payment_id = NULL,
         review_reason = v_reason,
         reviewed_by = p_actor_id,
         reviewed_at = now(),
         confirmed_by = CASE WHEN v_action = 'confirm' THEN p_actor_id ELSE NULL END,
         confirmed_at = CASE WHEN v_action = 'confirm' THEN now() ELSE NULL END,
         metadata = (
           COALESCE(metadata, '{}'::jsonb)
           - 'relation_deleted'
           - 'relation_invalidated'
         ) || jsonb_build_object(
           'allocation_count', v_count,
           'allocated_amount_cop', v_total,
           'allocation_source', 'bank_payment_allocations'
         ),
         updated_at = now()
   WHERE id = v_event.id
   RETURNING * INTO v_event;

  PERFORM public.bank_email_write_audit(
    v_hotel_id,
    p_actor_id,
    'multiple_allocation_changed',
    v_event.id,
    jsonb_build_object(
      'action', v_action,
      'reason', v_reason,
      'previous_allocations', v_previous,
      'new_allocations', v_normalized,
      'allocation_count', v_count,
      'amount_cop', v_total
    )
  );

  RETURN jsonb_build_object(
    'payment_event', to_jsonb(v_event),
    'allocations', (
      SELECT COALESCE(jsonb_agg(to_jsonb(a) - 'hotel_id' - 'created_by' ORDER BY a.created_at, a.id), '[]'::jsonb)
        FROM public.bank_payment_allocations a
       WHERE a.payment_event_id = v_event.id
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.replace_bank_payment_allocations(uuid, uuid, jsonb, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_bank_payment_allocations(uuid, uuid, jsonb, text, text, text)
  TO service_role;
