-- Permite distribuir una transferencia entre una reserva y varias ventas sin crear cobros nuevos.
CREATE TABLE IF NOT EXISTS public.bank_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  payment_event_id uuid NOT NULL REFERENCES public.bank_payment_events(id) ON DELETE CASCADE,
  allocation_type text NOT NULL CHECK (allocation_type IN ('reservation', 'sale')),
  reservation_id uuid REFERENCES public.reservas(id) ON DELETE RESTRICT,
  room_id uuid REFERENCES public.habitaciones(id) ON DELETE RESTRICT,
  sale_id uuid,
  sale_type text CHECK (sale_type IN ('tienda', 'restaurante', 'terraza', 'venta')),
  amount_cop bigint NOT NULL CHECK (amount_cop > 0),
  created_by uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_payment_allocation_target_check CHECK (
    (allocation_type = 'reservation' AND reservation_id IS NOT NULL AND sale_id IS NULL AND sale_type IS NULL)
    OR (allocation_type = 'sale' AND reservation_id IS NULL AND sale_id IS NOT NULL AND sale_type IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS bank_payment_allocations_event_idx
  ON public.bank_payment_allocations(hotel_id, payment_event_id);

ALTER TABLE public.bank_payment_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bank_payment_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bank_payment_allocations TO service_role;

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
  v_event public.bank_payment_events%rowtype;
  v_actor public.usuarios%rowtype;
  v_item jsonb;
  v_type text;
  v_sale_type text;
  v_reservation_id uuid;
  v_room_id uuid;
  v_sale_id uuid;
  v_amount bigint;
  v_total bigint := 0;
  v_first_reservation uuid;
  v_first_room uuid;
  v_first_sale uuid;
  v_first_sale_type text;
  v_count integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Esta funcion solo puede ejecutarse desde el servidor.' USING ERRCODE='42501';
  END IF;
  IF lower(coalesce(p_action, '')) NOT IN ('link', 'confirm') OR jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'La distribucion enviada no es valida.' USING ERRCODE='22023';
  END IF;
  v_hotel_id := public.resolve_bank_email_pilot_hotel(p_pilot_hotel_name);
  SELECT * INTO v_actor FROM public.usuarios
   WHERE id=p_actor_id AND hotel_id=v_hotel_id AND activo IS TRUE;
  IF NOT FOUND OR lower(coalesce(v_actor.rol::text,'')) NOT IN ('admin','superadmin','administrador') THEN
    RAISE EXCEPTION 'Solo un administrador puede conciliar pagos.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_event FROM public.bank_payment_events
   WHERE id=p_payment_event_id AND hotel_id=v_hotel_id FOR UPDATE;
  IF NOT FOUND OR v_event.status IN ('duplicated','rejected') THEN
    RAISE EXCEPTION 'El pago bancario no admite esta distribucion.' USING ERRCODE='22023';
  END IF;

  DELETE FROM public.bank_payment_allocations WHERE payment_event_id=v_event.id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations)
  LOOP
    v_count := v_count + 1;
    IF v_count > 50 THEN RAISE EXCEPTION 'La distribucion supera el maximo permitido.'; END IF;
    v_type := lower(coalesce(v_item->>'type',''));
    v_amount := (v_item->>'amountCop')::bigint;
    IF v_amount <= 0 THEN RAISE EXCEPTION 'Cada valor distribuido debe ser mayor que cero.'; END IF;
    v_total := v_total + v_amount;
    IF v_type='reservation' THEN
      v_reservation_id := (v_item->>'reservationId')::uuid;
      SELECT habitacion_id INTO v_room_id FROM public.reservas
       WHERE id=v_reservation_id AND hotel_id=v_hotel_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'La reserva seleccionada no pertenece al hotel.'; END IF;
      INSERT INTO public.bank_payment_allocations(hotel_id,payment_event_id,allocation_type,reservation_id,room_id,amount_cop,created_by)
      VALUES(v_hotel_id,v_event.id,'reservation',v_reservation_id,v_room_id,v_amount,p_actor_id);
      v_first_reservation := coalesce(v_first_reservation,v_reservation_id);
      v_first_room := coalesce(v_first_room,v_room_id);
    ELSIF v_type='sale' THEN
      v_sale_id := (v_item->>'saleId')::uuid;
      v_sale_type := lower(coalesce(v_item->>'saleType',''));
      IF NOT public.bank_email_sale_is_payable(v_sale_type,v_sale_id,v_hotel_id) THEN
        RAISE EXCEPTION 'Una venta seleccionada no existe o ya no esta disponible.';
      END IF;
      INSERT INTO public.bank_payment_allocations(hotel_id,payment_event_id,allocation_type,sale_id,sale_type,amount_cop,created_by)
      VALUES(v_hotel_id,v_event.id,'sale',v_sale_id,v_sale_type,v_amount,p_actor_id);
      v_first_sale := coalesce(v_first_sale,v_sale_id);
      v_first_sale_type := coalesce(v_first_sale_type,v_sale_type);
    ELSE
      RAISE EXCEPTION 'Tipo de distribucion no reconocido.';
    END IF;
  END LOOP;
  IF v_count=0 OR v_total IS DISTINCT FROM v_event.amount_cop THEN
    RAISE EXCEPTION 'La suma distribuida debe ser exactamente igual a la transferencia (%).', v_event.amount_cop;
  END IF;
  UPDATE public.bank_payment_events SET
    status=CASE WHEN lower(p_action)='confirm' THEN 'confirmed' ELSE 'matched' END,
    matched_reservation_id=v_first_reservation, matched_room_id=v_first_room,
    matched_sale_id=v_first_sale, matched_sale_type=v_first_sale_type,
    matched_expected_payment_id=NULL,
    review_reason=nullif(btrim(coalesce(p_review_reason,'')),''),
    reviewed_by=p_actor_id, reviewed_at=now(),
    confirmed_by=CASE WHEN lower(p_action)='confirm' THEN p_actor_id END,
    confirmed_at=CASE WHEN lower(p_action)='confirm' THEN now() END,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('allocation_count',v_count,'allocated_amount_cop',v_total),
    updated_at=now()
  WHERE id=v_event.id RETURNING * INTO v_event;
  PERFORM public.bank_email_write_audit(v_hotel_id,p_actor_id,'multiple_allocation_changed',v_event.id,
    jsonb_build_object('action',lower(p_action),'allocation_count',v_count,'amount_cop',v_total));
  RETURN jsonb_build_object('payment_event',to_jsonb(v_event),'allocations',p_allocations);
END;
$function$;

REVOKE ALL ON FUNCTION public.replace_bank_payment_allocations(uuid,uuid,jsonb,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replace_bank_payment_allocations(uuid,uuid,jsonb,text,text,text) TO service_role;
