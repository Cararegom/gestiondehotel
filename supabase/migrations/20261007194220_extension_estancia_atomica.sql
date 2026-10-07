-- La extension completa se guarda en una transaccion; los clientes antiguos
-- deben recargar antes de volver a cobrar extensiones. No modifica datos historicos.

CREATE OR REPLACE FUNCTION public.procesar_pago_reserva_atomico(
  p_reserva_id uuid,
  p_monto numeric,
  p_metodo_pago_id uuid,
  p_turno_id uuid,
  p_client_operation_id uuid,
  p_occurred_at timestamptz DEFAULT now(),
  p_concepto text DEFAULT 'Pago de reserva'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_reserva public.reservas%rowtype; v_turno public.turnos%rowtype; v_pago public.pagos_reserva%rowtype; v_caja public.caja%rowtype; v_total numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida' USING ERRCODE='42501'; END IF;
  IF p_monto IS NULL OR p_monto<=0 OR p_client_operation_id IS NULL THEN
    RAISE EXCEPTION 'Monto positivo y client_operation_id son obligatorios' USING ERRCODE='22023';
  END IF;
  IF btrim(coalesce(p_concepto,'')) ~* '^Pago por (extensión|extension):' THEN
    RAISE EXCEPTION 'Recarga la aplicacion para registrar la extension de forma segura. No se registro ningun cobro.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_reserva FROM public.reservas WHERE id=p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva no encontrada' USING ERRCODE='P0002'; END IF;
  IF NOT public.fase1_actor_es_miembro_activo(v_reserva.hotel_id) THEN RAISE EXCEPTION 'Reserva fuera del hotel autorizado' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_pago FROM public.pagos_reserva WHERE hotel_id=v_reserva.hotel_id AND source='reservation_payment' AND client_operation_id=p_client_operation_id;
  IF FOUND THEN
    SELECT * INTO v_caja FROM public.caja WHERE pago_reserva_id=v_pago.id AND source='reservation_payment';
    IF v_pago.reserva_id IS DISTINCT FROM v_reserva.id OR v_pago.usuario_id IS DISTINCT FROM auth.uid()
       OR v_pago.monto IS DISTINCT FROM p_monto OR v_pago.metodo_pago_id IS DISTINCT FROM p_metodo_pago_id
       OR v_caja.turno_id IS DISTINCT FROM p_turno_id THEN
      RAISE EXCEPTION 'La operacion de pago ya fue usada con otros datos' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('pago_id',v_pago.id,'caja_id',v_caja.id,'monto_pagado',v_reserva.monto_pagado,'business_date',v_pago.business_date,'idempotent',true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.metodos_pago m WHERE m.id=p_metodo_pago_id AND m.hotel_id=v_reserva.hotel_id AND m.activo) THEN
    RAISE EXCEPTION 'Metodo de pago invalido para el hotel' USING ERRCODE='23503';
  END IF;
  SELECT * INTO v_turno FROM public.turnos WHERE id=p_turno_id FOR UPDATE;
  IF NOT FOUND OR v_turno.hotel_id IS DISTINCT FROM v_reserva.hotel_id OR v_turno.usuario_id IS DISTINCT FROM auth.uid() OR v_turno.estado<>'abierto' OR v_turno.fecha_cierre IS NOT NULL THEN
    RAISE EXCEPTION 'Turno activo propio del hotel requerido' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.pagos_reserva(hotel_id,reserva_id,monto,fecha_pago,metodo_pago_id,usuario_id,concepto,client_operation_id,source,business_date)
  VALUES(v_reserva.hotel_id,v_reserva.id,p_monto,coalesce(p_occurred_at,now()),p_metodo_pago_id,auth.uid(),p_concepto,p_client_operation_id,'reservation_payment',public.hotel_business_date(v_reserva.hotel_id, coalesce(p_occurred_at,now())))
  RETURNING * INTO v_pago;
  INSERT INTO public.caja(hotel_id,tipo,monto,concepto,fecha_movimiento,metodo_pago_id,usuario_id,reserva_id,pago_reserva_id,turno_id,client_operation_id,source,business_date)
  VALUES(v_reserva.hotel_id,'ingreso',p_monto,p_concepto,coalesce(p_occurred_at,now()),p_metodo_pago_id,auth.uid(),v_reserva.id,v_pago.id,v_turno.id,p_client_operation_id,'reservation_payment',public.hotel_business_date(v_reserva.hotel_id, coalesce(p_occurred_at,now())))
  RETURNING * INTO v_caja;
  SELECT coalesce(sum(p.monto),0) INTO v_total FROM public.pagos_reserva p WHERE p.reserva_id=v_reserva.id;
  UPDATE public.reservas SET monto_pagado=v_total,actualizado_en=now() WHERE id=v_reserva.id;
  INSERT INTO public.auditoria_operaciones(hotel_id,actor_id,accion,entidad,entity_id,after_data,client_operation_id)
  VALUES(v_reserva.hotel_id,auth.uid(),'reserva.pago_crear','pagos_reserva',v_pago.id,jsonb_build_object('monto',p_monto,'caja_id',v_caja.id,'business_date',v_pago.business_date),p_client_operation_id);
  RETURN jsonb_build_object('pago_id',v_pago.id,'caja_id',v_caja.id,'monto_pagado',v_total,'business_date',v_pago.business_date,'idempotent',false);
END $$;

REVOKE ALL ON FUNCTION public.procesar_pago_reserva_atomico(uuid,numeric,uuid,uuid,uuid,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.procesar_pago_reserva_atomico(uuid,numeric,uuid,uuid,uuid,timestamptz,text) TO authenticated, service_role;

CREATE UNIQUE INDEX IF NOT EXISTS caja_reservation_payment_link_uq
ON public.caja(hotel_id, pago_reserva_id)
WHERE tipo = 'ingreso' AND source = 'reservation_payment'
  AND original_movement_id IS NULL AND pago_reserva_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.extender_estancia_reserva_atomica(
  p_reserva_id uuid,
  p_fecha_fin_anterior timestamptz,
  p_nueva_fecha_fin timestamptz,
  p_monto numeric,
  p_descripcion text,
  p_pagos jsonb,
  p_turno_id uuid,
  p_client_operation_id uuid,
  p_notas text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_reserva public.reservas%rowtype;
  v_habitacion public.habitaciones%rowtype;
  v_turno public.turnos%rowtype;
  v_auditoria public.auditoria_operaciones%rowtype;
  v_pago jsonb;
  v_pagos jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_total_pagado numeric;
  v_pago_id uuid;
  v_caja_id uuid;
  v_primer_pago_id uuid;
  v_primera_caja_id uuid;
  v_pago_operacion_id uuid;
  v_resultados jsonb := '[]'::jsonb;
  v_servicio_id uuid;
  v_cronometro_id uuid;
  v_occurred_at timestamptz := coalesce(p_occurred_at, now());
  v_business_date date;
  v_request jsonb;
  v_resultado jsonb;
  v_concepto text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticacion requerida' USING ERRCODE = '42501';
  END IF;
  IF p_reserva_id IS NULL OR p_client_operation_id IS NULL
     OR p_fecha_fin_anterior IS NULL OR p_nueva_fecha_fin IS NULL
     OR NOT isfinite(p_fecha_fin_anterior) OR NOT isfinite(p_nueva_fecha_fin)
     OR p_nueva_fecha_fin <= p_fecha_fin_anterior THEN
    RAISE EXCEPTION 'EXTENSION_FECHAS_INVALIDAS' USING ERRCODE = '22023';
  END IF;
  IF p_monto IS NULL OR p_monto < 0 OR p_monto::text IN ('NaN', 'Infinity', '-Infinity')
     OR btrim(coalesce(p_descripcion, '')) = '' THEN
    RAISE EXCEPTION 'EXTENSION_MONTO_INVALIDO' USING ERRCODE = '22023';
  END IF;
  IF p_pagos IS NULL OR jsonb_typeof(p_pagos) <> 'array' THEN
    RAISE EXCEPTION 'EXTENSION_PAGOS_INVALIDOS' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_reserva FROM public.reservas
  WHERE id = p_reserva_id FOR UPDATE;
  IF NOT FOUND OR NOT public.fase1_actor_es_miembro_activo(v_reserva.hotel_id) THEN
    RAISE EXCEPTION 'A14_RESERVA_NO_AUTORIZADA' USING ERRCODE = '42501';
  END IF;
  FOR v_pago IN SELECT value FROM jsonb_array_elements(p_pagos) LOOP
    IF jsonb_typeof(v_pago) <> 'object'
       OR nullif(v_pago->>'metodo_pago_id', '') IS NULL
       OR coalesce((v_pago->>'monto')::numeric, 0) <= 0
       OR (v_pago->>'monto')::numeric::text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'EXTENSION_PAGOS_INVALIDOS' USING ERRCODE = '22023';
    END IF;
    v_pagos := v_pagos || jsonb_build_array(jsonb_build_object(
      'metodo_pago_id', (v_pago->>'metodo_pago_id')::uuid,
      'monto', (v_pago->>'monto')::numeric
    ));
    v_total := v_total + (v_pago->>'monto')::numeric;
  END LOOP;
  IF v_total IS DISTINCT FROM p_monto THEN
    RAISE EXCEPTION 'EXTENSION_PAGOS_INVALIDOS' USING ERRCODE = '22023';
  END IF;
  v_request := jsonb_build_object(
    'fecha_fin_anterior', p_fecha_fin_anterior, 'nueva_fecha_fin', p_nueva_fecha_fin,
    'monto', p_monto, 'descripcion', btrim(p_descripcion), 'pagos', v_pagos,
    'turno_id', p_turno_id, 'notas', nullif(btrim(p_notas), '')
  );
  SELECT * INTO v_auditoria FROM public.auditoria_operaciones
  WHERE hotel_id = v_reserva.hotel_id AND accion = 'reserva.extender'
    AND client_operation_id = p_client_operation_id;
  IF FOUND THEN
    IF v_auditoria.actor_id IS DISTINCT FROM auth.uid()
       OR v_auditoria.entity_id IS DISTINCT FROM v_reserva.id
       OR v_auditoria.after_data->'request' IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'EXTENSION_OPERACION_NO_AUTORIZADA' USING ERRCODE = '42501';
    END IF;
    RETURN (v_auditoria.after_data - 'request') || jsonb_build_object('idempotent', true);
  END IF;
  IF v_reserva.fecha_fin IS DISTINCT FROM p_fecha_fin_anterior THEN
    RAISE EXCEPTION 'EXTENSION_ESTANCIA_CAMBIO' USING ERRCODE = '40001';
  END IF;
  IF v_reserva.estado::text NOT IN ('activa', 'ocupada', 'check_in', 'tiempo agotado') THEN
    RAISE EXCEPTION 'EXTENSION_RESERVA_NO_ACTIVA' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_habitacion FROM public.habitaciones
  WHERE id = v_reserva.habitacion_id AND hotel_id = v_reserva.hotel_id FOR UPDATE;
  IF NOT FOUND OR v_habitacion.activo IS NOT TRUE
     OR v_habitacion.estado::text IN ('mantenimiento', 'bloqueada')
     OR public.mantenimiento_habitacion_tiene_bloqueo(v_habitacion.id)
     OR EXISTS (
       SELECT 1 FROM public.reservas r WHERE r.hotel_id = v_reserva.hotel_id
         AND r.habitacion_id = v_habitacion.id AND r.id <> v_reserva.id
         AND r.estado::text IN ('activa', 'ocupada', 'check_in', 'tiempo agotado')
     ) THEN
    RAISE EXCEPTION 'EXTENSION_HABITACION_NO_DISPONIBLE' USING ERRCODE = '22023';
  END IF;
  IF p_monto > 0 THEN
    SELECT * INTO v_turno FROM public.turnos WHERE id = p_turno_id FOR UPDATE;
    IF NOT FOUND OR v_turno.hotel_id IS DISTINCT FROM v_reserva.hotel_id
       OR v_turno.usuario_id IS DISTINCT FROM auth.uid()
       OR v_turno.estado <> 'abierto' OR v_turno.fecha_cierre IS NOT NULL THEN
      RAISE EXCEPTION 'Turno activo propio del hotel requerido' USING ERRCODE = '42501';
    END IF;
  END IF;
  FOR v_pago IN SELECT value FROM jsonb_array_elements(v_pagos) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.metodos_pago m
      WHERE m.id = (v_pago->>'metodo_pago_id')::uuid
        AND m.hotel_id = v_reserva.hotel_id AND m.activo
    ) THEN
      RAISE EXCEPTION 'Metodo de pago invalido para el hotel' USING ERRCODE = '23503';
    END IF;
  END LOOP;

  v_business_date := public.hotel_business_date(v_reserva.hotel_id, v_occurred_at);
  v_concepto := 'Pago por extensión: ' || btrim(p_descripcion)
    || ' - Cliente: ' || coalesce(v_reserva.cliente_nombre, 'Cliente General');
  FOR v_pago IN SELECT value FROM jsonb_array_elements(v_pagos) LOOP
    v_pago_operacion_id := gen_random_uuid();
    INSERT INTO public.pagos_reserva(
      hotel_id, reserva_id, monto, fecha_pago, metodo_pago_id, usuario_id,
      concepto, client_operation_id, source, business_date
    ) VALUES (
      v_reserva.hotel_id, v_reserva.id, (v_pago->>'monto')::numeric,
      v_occurred_at, (v_pago->>'metodo_pago_id')::uuid, auth.uid(),
      v_concepto, v_pago_operacion_id, 'reservation_payment', v_business_date
    ) RETURNING id INTO v_pago_id;
    INSERT INTO public.caja(
      hotel_id, tipo, monto, concepto, fecha_movimiento, metodo_pago_id,
      usuario_id, reserva_id, pago_reserva_id, turno_id,
      client_operation_id, source, business_date
    ) VALUES (
      v_reserva.hotel_id, 'ingreso', (v_pago->>'monto')::numeric, v_concepto,
      v_occurred_at, (v_pago->>'metodo_pago_id')::uuid, auth.uid(),
      v_reserva.id, v_pago_id, v_turno.id,
      v_pago_operacion_id, 'reservation_payment', v_business_date
    ) RETURNING id INTO v_caja_id;
    v_primer_pago_id := coalesce(v_primer_pago_id, v_pago_id);
    v_primera_caja_id := coalesce(v_primera_caja_id, v_caja_id);
    v_resultados := v_resultados || jsonb_build_array(jsonb_build_object(
      'pago_id', v_pago_id, 'caja_id', v_caja_id,
      'monto', (v_pago->>'monto')::numeric,
      'metodo_pago_id', (v_pago->>'metodo_pago_id')::uuid
    ));
    INSERT INTO public.auditoria_operaciones(
      hotel_id, actor_id, accion, entidad, entity_id, after_data, client_operation_id
    ) VALUES (
      v_reserva.hotel_id, auth.uid(), 'reserva.pago_crear', 'pagos_reserva', v_pago_id,
      jsonb_build_object('monto', (v_pago->>'monto')::numeric, 'caja_id', v_caja_id,
        'business_date', v_business_date, 'extension_operation_id', p_client_operation_id),
      v_pago_operacion_id
    );
  END LOOP;
  INSERT INTO public.servicios_x_reserva(
    hotel_id, reserva_id, descripcion_manual, cantidad, precio_cobrado,
    estado_pago, pago_reserva_id, caja_movimiento_id, fecha_servicio
  ) VALUES (
    v_reserva.hotel_id, v_reserva.id, 'Extensión: ' || btrim(p_descripcion), 1,
    p_monto, 'pagado', v_primer_pago_id, v_primera_caja_id, v_occurred_at
  ) RETURNING id INTO v_servicio_id;
  SELECT coalesce(sum(p.monto), 0) INTO v_total_pagado
  FROM public.pagos_reserva p WHERE p.reserva_id = v_reserva.id;
  UPDATE public.reservas SET fecha_fin = p_nueva_fecha_fin, estado = 'activa',
    monto_pagado = v_total_pagado,
    notas = CASE WHEN nullif(btrim(p_notas), '') IS NULL THEN notas
      ELSE concat_ws(E'\n', nullif(notas, ''), btrim(p_notas)) END,
    actualizado_en = now()
  WHERE id = v_reserva.id RETURNING * INTO v_reserva;

  SELECT id INTO v_cronometro_id FROM public.cronometros
  WHERE hotel_id = v_reserva.hotel_id AND reserva_id = v_reserva.id
    AND habitacion_id = v_habitacion.id AND activo
  ORDER BY creado_en DESC, id DESC LIMIT 1 FOR UPDATE;
  UPDATE public.cronometros SET activo = false, actualizado_en = now()
  WHERE hotel_id = v_reserva.hotel_id AND reserva_id = v_reserva.id AND activo
    AND id IS DISTINCT FROM v_cronometro_id;
  IF v_cronometro_id IS NOT NULL THEN
    UPDATE public.cronometros SET fecha_fin = p_nueva_fecha_fin, actualizado_en = now()
    WHERE id = v_cronometro_id;
  ELSE
    INSERT INTO public.cronometros(
      hotel_id, reserva_id, habitacion_id, fecha_inicio, fecha_fin, activo
    ) VALUES (
      v_reserva.hotel_id, v_reserva.id, v_habitacion.id,
      v_reserva.fecha_inicio, p_nueva_fecha_fin, true
    ) RETURNING id INTO v_cronometro_id;
  END IF;
  UPDATE public.habitaciones SET estado = 'ocupada', actualizado_en = now()
  WHERE id = v_habitacion.id;
  v_resultado := jsonb_build_object(
    'reserva', to_jsonb(v_reserva), 'pagos', v_resultados,
    'servicio_id', v_servicio_id, 'cronometro_id', v_cronometro_id, 'idempotent', false
  );
  INSERT INTO public.auditoria_operaciones(
    hotel_id, actor_id, accion, entidad, entity_id, before_data, after_data, client_operation_id
  ) VALUES (
    v_reserva.hotel_id, auth.uid(), 'reserva.extender', 'reservas', v_reserva.id,
    jsonb_build_object('fecha_fin', p_fecha_fin_anterior),
    v_resultado || jsonb_build_object('request', v_request), p_client_operation_id
  );
  RETURN v_resultado;
END;
$$;
REVOKE ALL ON FUNCTION public.extender_estancia_reserva_atomica(
  uuid,timestamptz,timestamptz,numeric,text,jsonb,uuid,uuid,text,timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extender_estancia_reserva_atomica(
  uuid,timestamptz,timestamptz,numeric,text,jsonb,uuid,uuid,text,timestamptz
) TO authenticated, service_role;
