-- A13 + A14: ciclo operativo de la estancia atomico, idempotente y tenant-safe.
--
-- La creacion inmediata, el check-in y el checkout bloquean las filas que
-- gobiernan la habitacion y confirman reserva, habitacion y cronometro juntos.
-- Los indices parciales impiden mas de un cronometro activo por habitacion o
-- reserva, incluso si un caller futuro intenta escribir por otra ruta.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.cronometros c
    WHERE c.activo IS TRUE
    GROUP BY c.hotel_id, c.habitacion_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A13_CRONOMETROS_ACTIVOS_DUPLICADOS_HABITACION';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cronometros c
    WHERE c.activo IS TRUE AND c.reserva_id IS NOT NULL
    GROUP BY c.hotel_id, c.reserva_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A13_CRONOMETROS_ACTIVOS_DUPLICADOS_RESERVA';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS cronometros_hotel_habitacion_activo_uq
  ON public.cronometros(hotel_id, habitacion_id)
  WHERE activo IS TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS cronometros_hotel_reserva_activo_uq
  ON public.cronometros(hotel_id, reserva_id)
  WHERE activo IS TRUE AND reserva_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crear_estancia_atomica(
  p_reserva jsonb,
  p_client_operation_id uuid,
  p_pagos jsonb DEFAULT '[]'::jsonb,
  p_turno_id uuid DEFAULT NULL,
  p_concepto_pago text DEFAULT 'Pago de reserva',
  p_occurred_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_hotel_id uuid;
  v_habitacion_id uuid;
  v_cliente_id uuid;
  v_tiempo_estancia_id uuid;
  v_metodo_pago_id uuid;
  v_descuento_id uuid;
  v_fecha_inicio timestamptz;
  v_fecha_fin timestamptz;
  v_monto_total numeric;
  v_habitacion public.habitaciones%rowtype;
  v_reserva public.reservas%rowtype;
  v_cronometro public.cronometros%rowtype;
  v_descuento public.descuentos%rowtype;
  v_auditoria public.auditoria_operaciones%rowtype;
  v_pago jsonb;
  v_pago_resultado jsonb;
  v_resultado jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'A13_AUTENTICACION_REQUERIDA' USING ERRCODE = '42501';
  END IF;
  IF p_client_operation_id IS NULL THEN
    RAISE EXCEPTION 'A13_OPERACION_REQUERIDA' USING ERRCODE = '22023';
  END IF;
  IF coalesce(jsonb_typeof(p_reserva), '') <> 'object' THEN
    RAISE EXCEPTION 'A13_RESERVA_INVALIDA' USING ERRCODE = '22023';
  END IF;
  IF coalesce(jsonb_typeof(coalesce(p_pagos, '[]'::jsonb)), '') <> 'array' THEN
    RAISE EXCEPTION 'A13_PAGOS_INVALIDOS' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_hotel_id := nullif(p_reserva->>'hotel_id', '')::uuid;
    v_habitacion_id := nullif(p_reserva->>'habitacion_id', '')::uuid;
    v_cliente_id := nullif(p_reserva->>'cliente_id', '')::uuid;
    v_tiempo_estancia_id := nullif(p_reserva->>'tiempo_estancia_id', '')::uuid;
    v_metodo_pago_id := nullif(p_reserva->>'metodo_pago_id', '')::uuid;
    v_descuento_id := nullif(p_reserva->>'descuento_aplicado_id', '')::uuid;
    v_fecha_inicio := nullif(p_reserva->>'fecha_inicio', '')::timestamptz;
    v_fecha_fin := nullif(p_reserva->>'fecha_fin', '')::timestamptz;
    v_monto_total := coalesce(nullif(p_reserva->>'monto_total', '')::numeric, 0);
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'A13_DATOS_RESERVA_INVALIDOS' USING ERRCODE = '22023';
  END;

  IF v_hotel_id IS NULL OR v_habitacion_id IS NULL
     OR btrim(coalesce(p_reserva->>'cliente_nombre', '')) = ''
     OR v_fecha_inicio IS NULL OR v_fecha_fin IS NULL OR v_fecha_fin <= v_fecha_inicio
     OR v_monto_total < 0
     OR coalesce(nullif(p_reserva->>'cantidad_huespedes', '')::integer, 1) < 1 THEN
    RAISE EXCEPTION 'A13_DATOS_RESERVA_INVALIDOS' USING ERRCODE = '22023';
  END IF;
  IF NOT public.fase1_actor_es_miembro_activo(v_hotel_id) THEN
    RAISE EXCEPTION 'A13_HOTEL_NO_AUTORIZADO' USING ERRCODE = '42501';
  END IF;

  -- Serializa reintentos incluso si un cliente reutiliza el mismo UUID con
  -- un payload diferente o para otra habitacion del mismo hotel.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_hotel_id::text || ':reserva.estancia_crear:' || p_client_operation_id::text, 0)
  );

  SELECT * INTO v_auditoria
  FROM public.auditoria_operaciones a
  WHERE a.hotel_id = v_hotel_id
    AND a.accion = 'reserva.estancia_crear'
    AND a.client_operation_id = p_client_operation_id;

  IF FOUND THEN
    IF v_auditoria.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'A13_OPERACION_PERTENECE_A_OTRO_USUARIO' USING ERRCODE = '42501';
    END IF;
    RETURN coalesce(v_auditoria.after_data, '{}'::jsonb)
      || jsonb_build_object('idempotent', true);
  END IF;

  SELECT * INTO v_habitacion
  FROM public.habitaciones h
  WHERE h.id = v_habitacion_id AND h.hotel_id = v_hotel_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A13_HABITACION_NO_ENCONTRADA' USING ERRCODE = 'P0002';
  END IF;
  IF v_habitacion.activo IS NOT TRUE OR v_habitacion.estado <> 'libre'::public.estado_habitacion_enum THEN
    RAISE EXCEPTION 'A13_HABITACION_NO_DISPONIBLE' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cronometros c
    WHERE c.hotel_id = v_hotel_id
      AND c.habitacion_id = v_habitacion_id
      AND c.activo IS TRUE
  ) OR EXISTS (
    SELECT 1 FROM public.reservas r
    WHERE r.hotel_id = v_hotel_id
      AND r.habitacion_id = v_habitacion_id
      AND r.estado::text IN ('activa', 'ocupada', 'check_in', 'tiempo agotado')
  ) THEN
    RAISE EXCEPTION 'A13_HABITACION_CON_ESTANCIA_ACTIVA' USING ERRCODE = '55000';
  END IF;

  IF v_cliente_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.id = v_cliente_id AND c.hotel_id = v_hotel_id AND c.activo IS TRUE
    ) THEN
      RAISE EXCEPTION 'A13_CLIENTE_NO_AUTORIZADO' USING ERRCODE = '23503';
    END IF;
  ELSE
    INSERT INTO public.clientes(hotel_id, nombre, documento, telefono)
    VALUES (
      v_hotel_id,
      btrim(p_reserva->>'cliente_nombre'),
      nullif(btrim(coalesce(p_reserva->>'cedula', '')), ''),
      nullif(btrim(coalesce(p_reserva->>'telefono', '')), '')
    )
    RETURNING id INTO v_cliente_id;
  END IF;

  IF v_tiempo_estancia_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tiempos_estancia t
    WHERE t.id = v_tiempo_estancia_id AND t.hotel_id = v_hotel_id AND t.activo IS TRUE
  ) THEN
    RAISE EXCEPTION 'A13_TIEMPO_ESTANCIA_NO_AUTORIZADO' USING ERRCODE = '23503';
  END IF;
  IF v_metodo_pago_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.metodos_pago m
    WHERE m.id = v_metodo_pago_id AND m.hotel_id = v_hotel_id AND m.activo IS TRUE
  ) THEN
    RAISE EXCEPTION 'A13_METODO_PAGO_NO_AUTORIZADO' USING ERRCODE = '23503';
  END IF;

  IF v_descuento_id IS NOT NULL THEN
    SELECT * INTO v_descuento
    FROM public.descuentos d
    WHERE d.id = v_descuento_id AND d.hotel_id = v_hotel_id
    FOR UPDATE;
    IF NOT FOUND OR v_descuento.activo IS NOT TRUE
       OR (v_descuento.fecha_inicio IS NOT NULL AND v_descuento.fecha_inicio > coalesce(p_occurred_at, now()))
       OR (coalesce(v_descuento.fecha_fin, v_descuento.expiracion) IS NOT NULL
           AND coalesce(v_descuento.fecha_fin, v_descuento.expiracion) < coalesce(p_occurred_at, now()))
       OR (v_descuento.usos_maximos > 0 AND v_descuento.usos_actuales >= v_descuento.usos_maximos) THEN
      RAISE EXCEPTION 'A13_DESCUENTO_NO_DISPONIBLE' USING ERRCODE = '23503';
    END IF;
  END IF;

  IF jsonb_array_length(coalesce(p_pagos, '[]'::jsonb)) > 0 AND p_turno_id IS NULL THEN
    RAISE EXCEPTION 'A13_TURNO_REQUERIDO_PARA_PAGOS' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.reservas(
    hotel_id, habitacion_id, cliente_id, cliente_nombre,
    cliente_cedula, cliente_telefono, cedula, telefono,
    tiempo_estancia_id, fecha_inicio, fecha_fin, cantidad_huespedes,
    monto_total, monto_pagado, metodo_pago_id, estado,
    tipo_duracion, cantidad_duracion, monto_estancia_base,
    monto_estancia_base_sin_impuestos, monto_impuestos_estancia,
    porcentaje_impuestos_aplicado, nombre_impuesto_aplicado,
    descuento_aplicado_id, monto_descontado, usuario_id, notas, origen_reserva
  ) VALUES (
    v_hotel_id, v_habitacion_id, v_cliente_id, btrim(p_reserva->>'cliente_nombre'),
    nullif(btrim(coalesce(p_reserva->>'cedula', '')), ''),
    nullif(btrim(coalesce(p_reserva->>'telefono', '')), ''),
    nullif(btrim(coalesce(p_reserva->>'cedula', '')), ''),
    nullif(btrim(coalesce(p_reserva->>'telefono', '')), ''),
    v_tiempo_estancia_id, v_fecha_inicio, v_fecha_fin,
    coalesce(nullif(p_reserva->>'cantidad_huespedes', '')::integer, 1),
    v_monto_total, 0, v_metodo_pago_id, 'ocupada'::public.estado_reserva_enum,
    nullif(p_reserva->>'tipo_duracion', ''),
    coalesce(nullif(p_reserva->>'cantidad_duracion', '')::integer, 0),
    coalesce(nullif(p_reserva->>'monto_estancia_base', '')::numeric, 0),
    nullif(p_reserva->>'monto_estancia_base_sin_impuestos', '')::numeric,
    coalesce(nullif(p_reserva->>'monto_impuestos_estancia', '')::numeric, 0),
    nullif(p_reserva->>'porcentaje_impuestos_aplicado', '')::numeric,
    nullif(p_reserva->>'nombre_impuesto_aplicado', ''),
    v_descuento_id,
    coalesce(nullif(p_reserva->>'monto_descontado', '')::numeric, 0),
    v_actor_id,
    nullif(btrim(coalesce(p_reserva->>'notas', '')), ''),
    coalesce(nullif(p_reserva->>'origen_reserva', ''), 'directa')
  )
  RETURNING * INTO v_reserva;

  UPDATE public.habitaciones h
  SET estado = 'ocupada'::public.estado_habitacion_enum,
      actualizado_en = now()
  WHERE h.id = v_habitacion_id
    AND h.hotel_id = v_hotel_id
    AND h.estado = 'libre'::public.estado_habitacion_enum
  RETURNING * INTO v_habitacion;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A13_HABITACION_CAMBIO_DURANTE_CREACION' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.cronometros(
    hotel_id, reserva_id, habitacion_id, fecha_inicio, fecha_fin, activo
  ) VALUES (
    v_hotel_id, v_reserva.id, v_habitacion_id, v_fecha_inicio, v_fecha_fin, true
  )
  RETURNING * INTO v_cronometro;

  IF v_descuento_id IS NOT NULL THEN
    UPDATE public.descuentos
    SET usos_actuales = usos_actuales + 1
    WHERE id = v_descuento_id AND hotel_id = v_hotel_id;
  END IF;

  FOR v_pago IN SELECT value FROM jsonb_array_elements(coalesce(p_pagos, '[]'::jsonb))
  LOOP
    IF coalesce(jsonb_typeof(v_pago), '') <> 'object'
       OR coalesce(nullif(v_pago->>'monto', '')::numeric, 0) <= 0
       OR nullif(v_pago->>'metodo_pago_id', '') IS NULL
       OR nullif(v_pago->>'client_operation_id', '') IS NULL THEN
      RAISE EXCEPTION 'A13_PAGO_INVALIDO' USING ERRCODE = '22023';
    END IF;

    SELECT public.procesar_pago_reserva_atomico(
      v_reserva.id,
      (v_pago->>'monto')::numeric,
      (v_pago->>'metodo_pago_id')::uuid,
      p_turno_id,
      (v_pago->>'client_operation_id')::uuid,
      coalesce(p_occurred_at, now()),
      coalesce(nullif(p_concepto_pago, ''), 'Pago de reserva')
    ) INTO v_pago_resultado;
  END LOOP;

  SELECT * INTO v_reserva FROM public.reservas WHERE id = v_reserva.id;
  v_resultado := jsonb_build_object(
    'reserva', to_jsonb(v_reserva),
    'habitacion', to_jsonb(v_habitacion),
    'cronometro_id', v_cronometro.id,
    'idempotent', false
  );

  INSERT INTO public.auditoria_operaciones(
    hotel_id, actor_id, accion, entidad, entity_id, after_data, client_operation_id
  ) VALUES (
    v_hotel_id, v_actor_id, 'reserva.estancia_crear', 'reservas',
    v_reserva.id, v_resultado, p_client_operation_id
  );

  RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.realizar_checkin_reserva_atomico(
  p_reserva_id uuid,
  p_client_operation_id uuid,
  p_started_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_reserva public.reservas%rowtype;
  v_reserva_anterior public.reservas%rowtype;
  v_habitacion public.habitaciones%rowtype;
  v_cronometro public.cronometros%rowtype;
  v_auditoria public.auditoria_operaciones%rowtype;
  v_inicio timestamptz := coalesce(p_started_at, now());
  v_fin timestamptz;
  v_resultado jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'A14_AUTENTICACION_REQUERIDA' USING ERRCODE = '42501';
  END IF;
  IF p_reserva_id IS NULL OR p_client_operation_id IS NULL THEN
    RAISE EXCEPTION 'A14_CHECKIN_DATOS_REQUERIDOS' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_reserva
  FROM public.reservas r
  WHERE r.id = p_reserva_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public.fase1_actor_es_miembro_activo(v_reserva.hotel_id) THEN
    RAISE EXCEPTION 'A14_RESERVA_NO_AUTORIZADA' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_reserva.hotel_id::text || ':reserva.checkin:' || p_client_operation_id::text, 0)
  );
  SELECT * INTO v_auditoria
  FROM public.auditoria_operaciones a
  WHERE a.hotel_id = v_reserva.hotel_id
    AND a.accion = 'reserva.checkin'
    AND a.client_operation_id = p_client_operation_id;
  IF FOUND THEN
    IF v_auditoria.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'A14_OPERACION_PERTENECE_A_OTRO_USUARIO' USING ERRCODE = '42501';
    END IF;
    RETURN coalesce(v_auditoria.after_data, '{}'::jsonb)
      || jsonb_build_object('idempotent', true);
  END IF;

  IF v_reserva.estado::text NOT IN ('reservada', 'confirmada', 'pendiente')
     OR v_reserva.fecha_fin <= v_reserva.fecha_inicio THEN
    RAISE EXCEPTION 'A14_RESERVA_NO_DISPONIBLE_PARA_CHECKIN' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_habitacion
  FROM public.habitaciones h
  WHERE h.id = v_reserva.habitacion_id AND h.hotel_id = v_reserva.hotel_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A14_HABITACION_NO_ENCONTRADA' USING ERRCODE = 'P0002';
  END IF;
  IF v_habitacion.activo IS NOT TRUE
     OR v_habitacion.estado::text NOT IN ('libre', 'reservada') THEN
    RAISE EXCEPTION 'A14_HABITACION_NO_DISPONIBLE_PARA_CHECKIN' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reservas r
    WHERE r.hotel_id = v_reserva.hotel_id
      AND r.habitacion_id = v_reserva.habitacion_id
      AND r.id <> v_reserva.id
      AND r.estado::text IN ('activa', 'ocupada', 'check_in', 'tiempo agotado')
  ) OR EXISTS (
    SELECT 1 FROM public.cronometros c
    WHERE c.hotel_id = v_reserva.hotel_id
      AND c.habitacion_id = v_reserva.habitacion_id
      AND c.activo IS TRUE
  ) THEN
    RAISE EXCEPTION 'A14_HABITACION_CON_ESTANCIA_ACTIVA' USING ERRCODE = '55000';
  END IF;

  v_reserva_anterior := v_reserva;
  v_fin := v_inicio + (v_reserva.fecha_fin - v_reserva.fecha_inicio);

  UPDATE public.reservas
  SET estado = 'activa'::public.estado_reserva_enum,
      fecha_inicio = v_inicio,
      fecha_fin = v_fin,
      actualizado_en = now()
  WHERE id = v_reserva.id AND hotel_id = v_reserva.hotel_id
  RETURNING * INTO v_reserva;

  UPDATE public.habitaciones
  SET estado = 'ocupada'::public.estado_habitacion_enum,
      actualizado_en = now()
  WHERE id = v_habitacion.id AND hotel_id = v_reserva.hotel_id
  RETURNING * INTO v_habitacion;

  INSERT INTO public.cronometros(
    hotel_id, reserva_id, habitacion_id, fecha_inicio, fecha_fin, activo
  ) VALUES (
    v_reserva.hotel_id, v_reserva.id, v_habitacion.id, v_inicio, v_fin, true
  )
  RETURNING * INTO v_cronometro;

  v_resultado := jsonb_build_object(
    'reserva', to_jsonb(v_reserva),
    'habitacion', to_jsonb(v_habitacion),
    'cronometro_id', v_cronometro.id,
    'idempotent', false
  );
  INSERT INTO public.auditoria_operaciones(
    hotel_id, actor_id, accion, entidad, entity_id,
    before_data, after_data, client_operation_id
  ) VALUES (
    v_reserva.hotel_id, v_actor_id, 'reserva.checkin', 'reservas', v_reserva.id,
    to_jsonb(v_reserva_anterior), v_resultado, p_client_operation_id
  );
  RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalizar_estancia_reserva_atomica(
  p_reserva_id uuid,
  p_client_operation_id uuid,
  p_finished_at timestamptz DEFAULT now(),
  p_monto_pagado_final numeric DEFAULT NULL,
  p_estado_final text DEFAULT 'completada'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_reserva public.reservas%rowtype;
  v_reserva_anterior public.reservas%rowtype;
  v_habitacion public.habitaciones%rowtype;
  v_auditoria public.auditoria_operaciones%rowtype;
  v_final timestamptz := coalesce(p_finished_at, now());
  v_cronometros_cerrados integer := 0;
  v_resultado jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'A14_AUTENTICACION_REQUERIDA' USING ERRCODE = '42501';
  END IF;
  IF p_reserva_id IS NULL OR p_client_operation_id IS NULL
     OR p_estado_final NOT IN ('completada', 'finalizada')
     OR (p_monto_pagado_final IS NOT NULL AND p_monto_pagado_final < 0) THEN
    RAISE EXCEPTION 'A14_CHECKOUT_DATOS_INVALIDOS' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_reserva
  FROM public.reservas r
  WHERE r.id = p_reserva_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public.fase1_actor_es_miembro_activo(v_reserva.hotel_id) THEN
    RAISE EXCEPTION 'A14_RESERVA_NO_AUTORIZADA' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_reserva.hotel_id::text || ':reserva.checkout:' || p_client_operation_id::text, 0)
  );
  SELECT * INTO v_auditoria
  FROM public.auditoria_operaciones a
  WHERE a.hotel_id = v_reserva.hotel_id
    AND a.accion = 'reserva.checkout'
    AND a.client_operation_id = p_client_operation_id;
  IF FOUND THEN
    IF v_auditoria.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'A14_OPERACION_PERTENECE_A_OTRO_USUARIO' USING ERRCODE = '42501';
    END IF;
    RETURN coalesce(v_auditoria.after_data, '{}'::jsonb)
      || jsonb_build_object('idempotent', true);
  END IF;

  IF v_reserva.estado::text NOT IN ('activa', 'ocupada', 'tiempo agotado') THEN
    RAISE EXCEPTION 'A14_RESERVA_NO_DISPONIBLE_PARA_CHECKOUT' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_habitacion
  FROM public.habitaciones h
  WHERE h.id = v_reserva.habitacion_id AND h.hotel_id = v_reserva.hotel_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A14_HABITACION_NO_ENCONTRADA' USING ERRCODE = 'P0002';
  END IF;
  IF v_habitacion.estado::text NOT IN ('ocupada', 'tiempo agotado') THEN
    RAISE EXCEPTION 'A14_HABITACION_NO_DISPONIBLE_PARA_CHECKOUT' USING ERRCODE = '55000';
  END IF;

  v_reserva_anterior := v_reserva;
  UPDATE public.reservas
  SET estado = p_estado_final::public.estado_reserva_enum,
      fecha_fin = v_final,
      monto_pagado = coalesce(p_monto_pagado_final, monto_pagado),
      actualizado_en = now()
  WHERE id = v_reserva.id AND hotel_id = v_reserva.hotel_id
  RETURNING * INTO v_reserva;

  UPDATE public.cronometros
  SET activo = false,
      fecha_fin = v_final,
      actualizado_en = now()
  WHERE hotel_id = v_reserva.hotel_id
    AND reserva_id = v_reserva.id
    AND habitacion_id = v_habitacion.id
    AND activo IS TRUE;
  GET DIAGNOSTICS v_cronometros_cerrados = ROW_COUNT;

  UPDATE public.habitaciones
  SET estado = 'limpieza'::public.estado_habitacion_enum,
      actualizado_en = now()
  WHERE id = v_habitacion.id AND hotel_id = v_reserva.hotel_id
  RETURNING * INTO v_habitacion;
  IF v_habitacion.estado <> 'limpieza'::public.estado_habitacion_enum THEN
    RAISE EXCEPTION 'A14_HABITACION_NO_PUDO_PASAR_A_LIMPIEZA' USING ERRCODE = '55000';
  END IF;

  v_resultado := jsonb_build_object(
    'reserva', to_jsonb(v_reserva),
    'habitacion', to_jsonb(v_habitacion),
    'cronometros_cerrados', v_cronometros_cerrados,
    'idempotent', false
  );
  INSERT INTO public.auditoria_operaciones(
    hotel_id, actor_id, accion, entidad, entity_id,
    before_data, after_data, client_operation_id
  ) VALUES (
    v_reserva.hotel_id, v_actor_id, 'reserva.checkout', 'reservas', v_reserva.id,
    to_jsonb(v_reserva_anterior), v_resultado, p_client_operation_id
  );
  RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.forzar_limpieza_habitacion_atomica(
  p_habitacion_id uuid,
  p_client_operation_id uuid,
  p_finished_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_habitacion public.habitaciones%rowtype;
  v_habitacion_anterior public.habitaciones%rowtype;
  v_auditoria public.auditoria_operaciones%rowtype;
  v_cronometros_cerrados integer := 0;
  v_resultado jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'A14_AUTENTICACION_REQUERIDA' USING ERRCODE = '42501';
  END IF;
  IF p_habitacion_id IS NULL OR p_client_operation_id IS NULL THEN
    RAISE EXCEPTION 'A14_LIMPIEZA_FORZADA_DATOS_REQUERIDOS' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_habitacion
  FROM public.habitaciones h
  WHERE h.id = p_habitacion_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public.fase1_actor_es_miembro_activo(v_habitacion.hotel_id) THEN
    RAISE EXCEPTION 'A14_HABITACION_NO_AUTORIZADA' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_habitacion.hotel_id::text || ':habitacion.limpieza_forzada:' || p_client_operation_id::text, 0)
  );
  SELECT * INTO v_auditoria
  FROM public.auditoria_operaciones a
  WHERE a.hotel_id = v_habitacion.hotel_id
    AND a.accion = 'habitacion.limpieza_forzada'
    AND a.client_operation_id = p_client_operation_id;
  IF FOUND THEN
    IF v_auditoria.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'A14_OPERACION_PERTENECE_A_OTRO_USUARIO' USING ERRCODE = '42501';
    END IF;
    RETURN coalesce(v_auditoria.after_data, '{}'::jsonb)
      || jsonb_build_object('idempotent', true);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reservas r
    WHERE r.hotel_id = v_habitacion.hotel_id
      AND r.habitacion_id = v_habitacion.id
      AND r.estado::text IN ('activa', 'ocupada', 'check_in', 'tiempo agotado')
  ) THEN
    RAISE EXCEPTION 'A14_LIMPIEZA_FORZADA_RESERVA_ACTIVA' USING ERRCODE = '55000';
  END IF;
  IF v_habitacion.estado::text NOT IN ('ocupada', 'tiempo agotado', 'reservada') THEN
    RAISE EXCEPTION 'A14_LIMPIEZA_FORZADA_ESTADO_INVALIDO' USING ERRCODE = '55000';
  END IF;

  v_habitacion_anterior := v_habitacion;
  UPDATE public.cronometros
  SET activo = false,
      fecha_fin = coalesce(p_finished_at, now()),
      actualizado_en = now()
  WHERE hotel_id = v_habitacion.hotel_id
    AND habitacion_id = v_habitacion.id
    AND activo IS TRUE;
  GET DIAGNOSTICS v_cronometros_cerrados = ROW_COUNT;

  UPDATE public.habitaciones
  SET estado = 'limpieza'::public.estado_habitacion_enum,
      actualizado_en = now()
  WHERE id = v_habitacion.id AND hotel_id = v_habitacion.hotel_id
  RETURNING * INTO v_habitacion;
  IF v_habitacion.estado <> 'limpieza'::public.estado_habitacion_enum THEN
    RAISE EXCEPTION 'A14_HABITACION_NO_PUDO_PASAR_A_LIMPIEZA' USING ERRCODE = '55000';
  END IF;

  v_resultado := jsonb_build_object(
    'habitacion', to_jsonb(v_habitacion),
    'cronometros_cerrados', v_cronometros_cerrados,
    'idempotent', false
  );
  INSERT INTO public.auditoria_operaciones(
    hotel_id, actor_id, accion, entidad, entity_id,
    before_data, after_data, client_operation_id
  ) VALUES (
    v_habitacion.hotel_id, v_actor_id, 'habitacion.limpieza_forzada',
    'habitaciones', v_habitacion.id, to_jsonb(v_habitacion_anterior),
    v_resultado, p_client_operation_id
  );
  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.crear_estancia_atomica(jsonb,uuid,jsonb,uuid,text,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.realizar_checkin_reserva_atomico(uuid,uuid,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalizar_estancia_reserva_atomica(uuid,uuid,timestamptz,numeric,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.forzar_limpieza_habitacion_atomica(uuid,uuid,timestamptz) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.crear_estancia_atomica(jsonb,uuid,jsonb,uuid,text,timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.realizar_checkin_reserva_atomico(uuid,uuid,timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalizar_estancia_reserva_atomica(uuid,uuid,timestamptz,numeric,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.forzar_limpieza_habitacion_atomica(uuid,uuid,timestamptz) TO authenticated, service_role;
