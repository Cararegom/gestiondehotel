-- A15 + A16: una sola implementacion para ventas de tienda y ajustes atomicos.
--
-- El nucleo privado conserva dos politicas de precio explicitas:
--   * catalogo: POS usa el precio vigente del producto;
--   * congelado: pedidos web respetan el precio confirmado al crear el pedido.
-- Ambos caminos comparten locks, detalle de venta, descuento de stock, movimiento,
-- idempotencia y auditoria. Los ajustes manuales usan la RPC segura existente,
-- endurecida para devolver el estado confirmado por el servidor.

CREATE OR REPLACE FUNCTION public.tienda_crear_venta_atomica_core(
  p_hotel_id uuid,
  p_actor_id uuid,
  p_items jsonb,
  p_pagos jsonb,
  p_modo text,
  p_turno_id uuid,
  p_client_operation_id uuid,
  p_reserva_id uuid,
  p_habitacion_id uuid,
  p_cliente_temporal text,
  p_descuento_id uuid,
  p_price_mode text,
  p_source text,
  p_total_esperado numeric,
  p_occurred_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.usuarios%rowtype;
  v_venta public.ventas_tienda%rowtype;
  v_producto record;
  v_descuento record;
  v_item jsonb;
  v_pago jsonb;
  v_items_agrupados jsonb := '[]'::jsonb;
  v_items_validados jsonb := '[]'::jsonb;
  v_pagos_validados jsonb := '[]'::jsonb;
  v_productos_esperados integer := 0;
  v_productos_bloqueados integer := 0;
  v_cantidad integer;
  v_precio numeric;
  v_subtotal numeric := 0;
  v_monto_descuento numeric := 0;
  v_total numeric := 0;
  v_total_pagos numeric := 0;
  v_stock_anterior integer;
  v_stock_nuevo integer;
  v_metodo_id uuid;
  v_monto_pago numeric;
  v_razon_movimiento text;
  v_accion_auditoria text;
  v_entidad_auditoria text;
  v_resultado jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_actor_id IS DISTINCT FROM auth.uid()
     OR p_hotel_id IS NULL OR p_client_operation_id IS NULL THEN
    RAISE EXCEPTION 'A15_AUTENTICACION_REQUERIDA'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_actor
  FROM public.usuarios u
  WHERE u.id = p_actor_id
    AND u.hotel_id = p_hotel_id
    AND u.activo IS TRUE;

  IF NOT FOUND OR NOT public.fase1_actor_tiene_permiso(p_hotel_id, 'tienda.operar') THEN
    RAISE EXCEPTION 'A15_SIN_PERMISO_TIENDA'
      USING ERRCODE = '42501';
  END IF;

  IF p_modo NOT IN ('inmediato', 'habitacion')
     OR p_price_mode NOT IN ('catalogo', 'congelado')
     OR p_source NOT IN ('store_atomic', 'store_web_order')
     OR (p_source = 'store_atomic' AND p_price_mode <> 'catalogo')
     OR (p_source = 'store_web_order' AND p_price_mode <> 'congelado')
     OR coalesce(jsonb_typeof(p_items), '') <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A15_PARAMETROS_VENTA_INVALIDOS'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_hotel_id::text || ':tienda.venta:' || p_source || ':' || p_client_operation_id::text, 0)
  );

  SELECT * INTO v_venta
  FROM public.ventas_tienda v
  WHERE v.hotel_id = p_hotel_id
    AND v.source = p_source
    AND v.client_operation_id = p_client_operation_id;

  IF FOUND THEN
    IF v_venta.usuario_id IS DISTINCT FROM p_actor_id THEN
      RAISE EXCEPTION 'A15_OPERACION_NO_AUTORIZADA'
        USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object(
      'venta_id', v_venta.id,
      'total', v_venta.total_venta,
      'business_date', v_venta.business_date,
      'reserva_id', v_venta.reserva_id,
      'idempotent', true
    );
  END IF;

  IF p_modo = 'habitacion' THEN
    IF p_reserva_id IS NULL OR p_habitacion_id IS NULL THEN
      RAISE EXCEPTION 'A15_RESERVA_ACTIVA_REQUERIDA'
        USING ERRCODE = '23503';
    END IF;

    PERFORM 1
    FROM public.reservas r
    WHERE r.id = p_reserva_id
      AND r.hotel_id = p_hotel_id
      AND r.habitacion_id = p_habitacion_id
      AND r.estado::text IN ('activa', 'ocupada', 'tiempo agotado')
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A15_RESERVA_ACTIVA_REQUERIDA'
        USING ERRCODE = '23503';
    END IF;

    IF coalesce(jsonb_typeof(coalesce(p_pagos, '[]'::jsonb)), '') <> 'array'
       OR jsonb_array_length(coalesce(p_pagos, '[]'::jsonb)) <> 0 THEN
      RAISE EXCEPTION 'A15_CARGO_HABITACION_NO_ACEPTA_PAGOS'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    PERFORM 1
    FROM public.turnos t
    WHERE t.id = p_turno_id
      AND t.hotel_id = p_hotel_id
      AND t.usuario_id = p_actor_id
      AND t.estado = 'abierto'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A15_TURNO_ACTIVO_PROPIO_REQUERIDO'
        USING ERRCODE = '42501';
    END IF;

    IF coalesce(jsonb_typeof(p_pagos), '') <> 'array'
       OR jsonb_array_length(p_pagos) = 0 THEN
      RAISE EXCEPTION 'A15_PAGOS_REQUERIDOS'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  BEGIN
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) AS raw(item)
      WHERE jsonb_typeof(raw.item) <> 'object'
         OR nullif(raw.item->>'producto_id', '') IS NULL
         OR nullif(raw.item->>'cantidad', '') IS NULL
         OR (raw.item->>'cantidad')::integer <= 0
         OR (
           p_price_mode = 'congelado'
           AND (
             nullif(raw.item->>'precio_unitario', '') IS NULL
             OR (raw.item->>'precio_unitario')::numeric < 0
           )
         )
    ) THEN
      RAISE EXCEPTION 'A15_ITEMS_INVALIDOS' USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'producto_id', grouped.producto_id,
          'cantidad', grouped.cantidad,
          'precio_unitario', grouped.precio_unitario
        ) ORDER BY grouped.producto_id
      ),
      '[]'::jsonb
    )
    INTO v_items_agrupados
    FROM (
      SELECT
        (raw.item->>'producto_id')::uuid AS producto_id,
        sum((raw.item->>'cantidad')::integer)::integer AS cantidad,
        CASE
          WHEN p_price_mode = 'congelado'
            AND count(DISTINCT (raw.item->>'precio_unitario')::numeric) = 1
          THEN min((raw.item->>'precio_unitario')::numeric)
          WHEN p_price_mode = 'catalogo' THEN NULL
          ELSE NULL
        END AS precio_unitario,
        count(DISTINCT (raw.item->>'precio_unitario')::numeric)
          FILTER (WHERE p_price_mode = 'congelado') AS precios_distintos
      FROM jsonb_array_elements(p_items) AS raw(item)
      GROUP BY (raw.item->>'producto_id')::uuid
    ) AS grouped;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'A15_ITEMS_INVALIDOS' USING ERRCODE = '22023';
  END;

  IF p_price_mode = 'congelado' AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_items_agrupados) AS normalized(item)
    WHERE normalized.item->>'precio_unitario' IS NULL
  ) THEN
    RAISE EXCEPTION 'A15_PRECIOS_CONGELADOS_INCONSISTENTES'
      USING ERRCODE = '23514';
  END IF;

  v_productos_esperados := jsonb_array_length(v_items_agrupados);

  FOR v_producto IN
    SELECT
      p.*,
      (normalized.item->>'cantidad')::integer AS cantidad_solicitada,
      nullif(normalized.item->>'precio_unitario', '')::numeric AS precio_solicitado
    FROM jsonb_array_elements(v_items_agrupados) AS normalized(item)
    JOIN public.productos_tienda p
      ON p.id = (normalized.item->>'producto_id')::uuid
    ORDER BY p.id
    FOR UPDATE OF p
  LOOP
    v_productos_bloqueados := v_productos_bloqueados + 1;

    IF v_producto.hotel_id IS DISTINCT FROM p_hotel_id OR v_producto.activo IS NOT TRUE THEN
      IF p_source = 'store_web_order' THEN
        RAISE EXCEPTION 'C5_PRODUCTO_NO_AUTORIZADO: producto inexistente o fuera del hotel'
          USING ERRCODE = '42501';
      END IF;
      RAISE EXCEPTION 'A15_PRODUCTO_NO_AUTORIZADO'
        USING ERRCODE = '42501';
    END IF;

    v_cantidad := v_producto.cantidad_solicitada;
    v_stock_anterior := coalesce(v_producto.stock_actual, 0);
    IF v_stock_anterior < v_cantidad THEN
      IF p_source = 'store_web_order' THEN
        RAISE EXCEPTION 'C5_STOCK_INSUFICIENTE: stock insuficiente para %. Disponible: %, requerido: %',
          v_producto.nombre, v_stock_anterior, v_cantidad
          USING ERRCODE = '23514';
      END IF;
      RAISE EXCEPTION 'A15_STOCK_INSUFICIENTE'
        USING ERRCODE = '23514';
    END IF;

    v_precio := CASE
      WHEN p_price_mode = 'congelado' THEN v_producto.precio_solicitado
      ELSE coalesce(v_producto.precio_venta, v_producto.precio, 0)
    END;

    v_subtotal := v_subtotal + round(v_precio * v_cantidad, 2);
    v_items_validados := v_items_validados || jsonb_build_array(jsonb_build_object(
      'producto_id', v_producto.id,
      'cantidad', v_cantidad,
      'precio_unitario', v_precio,
      'stock_anterior', v_stock_anterior
    ));
  END LOOP;

  IF v_productos_bloqueados <> v_productos_esperados THEN
    IF p_source = 'store_web_order' THEN
      RAISE EXCEPTION 'C5_PRODUCTO_NO_AUTORIZADO: uno de los productos ya no existe'
        USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'A15_PRODUCTO_NO_AUTORIZADO'
      USING ERRCODE = '42501';
  END IF;

  v_subtotal := round(v_subtotal, 2);
  IF p_total_esperado IS NOT NULL AND v_subtotal <> round(p_total_esperado, 2) THEN
    IF p_source = 'store_web_order' THEN
      RAISE EXCEPTION 'C5_PEDIDO_INCONSISTENTE: los items no coinciden con el total confirmado'
        USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION 'A15_TOTAL_ESPERADO_NO_COINCIDE'
      USING ERRCODE = '23514';
  END IF;

  IF p_descuento_id IS NOT NULL THEN
    IF p_source <> 'store_atomic' THEN
      RAISE EXCEPTION 'A15_DESCUENTO_NO_PERMITIDO_EN_ORIGEN'
        USING ERRCODE = '22023';
    END IF;

    SELECT d.* INTO v_descuento
    FROM public.descuentos d
    WHERE d.id = p_descuento_id
      AND d.hotel_id = p_hotel_id
    FOR UPDATE;

    IF NOT FOUND OR v_descuento.activo IS NOT TRUE
       OR (v_descuento.fecha_inicio IS NOT NULL AND v_descuento.fecha_inicio > coalesce(p_occurred_at, now()))
       OR (v_descuento.fecha_fin IS NOT NULL AND v_descuento.fecha_fin < coalesce(p_occurred_at, now()))
       OR (v_descuento.usos_maximos > 0 AND v_descuento.usos_actuales >= v_descuento.usos_maximos) THEN
      RAISE EXCEPTION 'A15_DESCUENTO_INVALIDO'
        USING ERRCODE = '23514';
    END IF;

    v_monto_descuento := CASE v_descuento.tipo::text
      WHEN 'porcentaje' THEN least(v_subtotal, v_subtotal * v_descuento.valor / 100)
      ELSE least(v_subtotal, v_descuento.valor)
    END;
  END IF;

  v_total := round(v_subtotal - coalesce(v_monto_descuento, 0), 2);

  IF p_modo = 'inmediato' THEN
    FOR v_pago IN SELECT value FROM jsonb_array_elements(p_pagos)
    LOOP
      BEGIN
        v_metodo_id := nullif(v_pago->>'metodo_pago_id', '')::uuid;
        v_monto_pago := nullif(v_pago->>'monto', '')::numeric;
      EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
          RAISE EXCEPTION 'A15_PAGO_INVALIDO' USING ERRCODE = '22023';
      END;

      IF v_metodo_id IS NULL OR v_monto_pago IS NULL OR v_monto_pago <= 0
         OR NOT EXISTS (
           SELECT 1 FROM public.metodos_pago m
           WHERE m.id = v_metodo_id AND m.hotel_id = p_hotel_id AND m.activo IS TRUE
         ) THEN
        RAISE EXCEPTION 'A15_PAGO_INVALIDO'
          USING ERRCODE = '22023';
      END IF;
      v_total_pagos := v_total_pagos + v_monto_pago;
      v_pagos_validados := v_pagos_validados || jsonb_build_array(jsonb_build_object(
        'metodo_pago_id', v_metodo_id,
        'monto', v_monto_pago
      ));
    END LOOP;

    IF round(v_total_pagos, 2) <> v_total THEN
      RAISE EXCEPTION 'A15_TOTAL_PAGOS_NO_COINCIDE'
        USING ERRCODE = '23514';
    END IF;

    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'metodo_pago_id', grouped.metodo_pago_id,
          'monto', grouped.monto
        ) ORDER BY grouped.metodo_pago_id
      ),
      '[]'::jsonb
    )
    INTO v_pagos_validados
    FROM (
      SELECT
        (validated.item->>'metodo_pago_id')::uuid AS metodo_pago_id,
        round(sum((validated.item->>'monto')::numeric), 2) AS monto
      FROM jsonb_array_elements(v_pagos_validados) AS validated(item)
      GROUP BY (validated.item->>'metodo_pago_id')::uuid
    ) AS grouped;
  END IF;

  INSERT INTO public.ventas_tienda(
    hotel_id, total_venta, metodo_pago_id, usuario_id, fecha,
    reserva_id, habitacion_id, cliente_temporal, estado_pago,
    descuento_id, monto_descuento, client_operation_id, business_date, source
  ) VALUES (
    p_hotel_id,
    v_total,
    CASE
      WHEN jsonb_array_length(v_pagos_validados) = 1
      THEN (v_pagos_validados->0->>'metodo_pago_id')::uuid
      ELSE NULL
    END,
    p_actor_id,
    coalesce(p_occurred_at, now()),
    p_reserva_id,
    p_habitacion_id,
    p_cliente_temporal,
    CASE WHEN p_modo = 'inmediato' THEN 'pagado' ELSE 'pendiente' END,
    p_descuento_id,
    v_monto_descuento,
    p_client_operation_id,
    public.fase1_business_date(coalesce(p_occurred_at, now())),
    p_source
  )
  RETURNING * INTO v_venta;

  v_razon_movimiento := CASE p_source
    WHEN 'store_web_order' THEN 'venta_tienda_pedido_web'
    ELSE 'venta_tienda_atomica'
  END;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items_validados)
  LOOP
    v_cantidad := (v_item->>'cantidad')::integer;
    v_precio := (v_item->>'precio_unitario')::numeric;
    v_stock_anterior := (v_item->>'stock_anterior')::integer;
    v_stock_nuevo := v_stock_anterior - v_cantidad;

    INSERT INTO public.detalle_ventas_tienda(
      venta_id, producto_id, cantidad, precio_unitario_venta,
      subtotal, hotel_id, creado_en
    ) VALUES (
      v_venta.id,
      (v_item->>'producto_id')::uuid,
      v_cantidad,
      v_precio,
      round(v_precio * v_cantidad, 2),
      p_hotel_id,
      coalesce(p_occurred_at, now())
    );

    UPDATE public.productos_tienda
    SET stock_actual = v_stock_nuevo,
        actualizado_en = now()
    WHERE id = (v_item->>'producto_id')::uuid
      AND hotel_id = p_hotel_id
      AND stock_actual = v_stock_anterior;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A15_STOCK_CAMBIO_DURANTE_VENTA'
        USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.movimientos_inventario(
      hotel_id, producto_id, tipo_movimiento, cantidad, razon,
      usuario_responsable, stock_anterior, stock_nuevo, usuario_id, notas
    ) VALUES (
      p_hotel_id,
      (v_item->>'producto_id')::uuid,
      'SALIDA',
      v_cantidad,
      v_razon_movimiento,
      p_actor_id::text,
      v_stock_anterior,
      v_stock_nuevo,
      p_actor_id,
      CASE p_source
        WHEN 'store_web_order' THEN 'pedido_web_id=' || p_client_operation_id || ';venta_id=' || v_venta.id
        ELSE 'venta_id=' || v_venta.id
      END
    );
  END LOOP;

  IF p_descuento_id IS NOT NULL THEN
    UPDATE public.descuentos
    SET usos_actuales = usos_actuales + 1
    WHERE id = p_descuento_id AND hotel_id = p_hotel_id;
  END IF;

  IF p_modo = 'inmediato' THEN
    FOR v_pago IN SELECT value FROM jsonb_array_elements(v_pagos_validados)
    LOOP
      INSERT INTO public.caja(
        hotel_id, tipo, monto, concepto, fecha_movimiento,
        metodo_pago_id, usuario_id, venta_tienda_id, turno_id,
        client_operation_id, source, business_date
      ) VALUES (
        p_hotel_id,
        'ingreso',
        (v_pago->>'monto')::numeric,
        'Venta tienda atomica',
        coalesce(p_occurred_at, now()),
        (v_pago->>'metodo_pago_id')::uuid,
        p_actor_id,
        v_venta.id,
        p_turno_id,
        p_client_operation_id,
        'store_atomic:' || (v_pago->>'metodo_pago_id'),
        public.fase1_business_date(coalesce(p_occurred_at, now()))
      );
    END LOOP;
  END IF;

  v_accion_auditoria := CASE p_source
    WHEN 'store_web_order' THEN 'tienda.pedido_web_entregar'
    ELSE 'tienda.venta_crear'
  END;
  v_entidad_auditoria := CASE p_source
    WHEN 'store_web_order' THEN 'tienda_pedidos_web'
    ELSE 'ventas_tienda'
  END;
  v_resultado := jsonb_build_object(
    'venta_id', v_venta.id,
    'total', v_total,
    'business_date', v_venta.business_date,
    'reserva_id', v_venta.reserva_id,
    'productos', v_productos_esperados,
    'idempotent', false
  );

  INSERT INTO public.auditoria_operaciones(
    hotel_id, actor_id, accion, entidad, entity_id, after_data, client_operation_id
  ) VALUES (
    p_hotel_id,
    p_actor_id,
    v_accion_auditoria,
    v_entidad_auditoria,
    CASE WHEN p_source = 'store_web_order' THEN p_client_operation_id ELSE v_venta.id END,
    v_resultado,
    p_client_operation_id
  );

  RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.procesar_venta_tienda_atomica(
  p_items jsonb,
  p_pagos jsonb,
  p_modo text,
  p_turno_id uuid,
  p_client_operation_id uuid,
  p_reserva_id uuid DEFAULT NULL,
  p_habitacion_id uuid DEFAULT NULL,
  p_cliente_temporal text DEFAULT NULL,
  p_descuento_id uuid DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.usuarios%rowtype;
BEGIN
  SELECT * INTO v_actor
  FROM public.usuarios u
  WHERE u.id = auth.uid() AND u.activo IS TRUE;

  IF NOT FOUND OR v_actor.hotel_id IS NULL THEN
    RAISE EXCEPTION 'A15_ACTOR_SIN_HOTEL_ACTIVO'
      USING ERRCODE = '42501';
  END IF;

  RETURN public.tienda_crear_venta_atomica_core(
    v_actor.hotel_id,
    auth.uid(),
    p_items,
    coalesce(p_pagos, '[]'::jsonb),
    p_modo,
    p_turno_id,
    p_client_operation_id,
    p_reserva_id,
    p_habitacion_id,
    p_cliente_temporal,
    p_descuento_id,
    'catalogo',
    'store_atomic',
    NULL,
    coalesce(p_occurred_at, now())
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.actualizar_estado_pedido_web_tienda(
  p_pedido_id uuid,
  p_usuario_id uuid,
  p_estado text,
  p_notas_internas text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.usuarios%rowtype;
  v_pedido public.tienda_pedidos_web%rowtype;
  v_reserva_id uuid;
  v_items jsonb;
  v_item_count integer := 0;
  v_total_items numeric := 0;
  v_venta_resultado jsonb;
  v_venta_id uuid;
  v_idempotent boolean := false;
BEGIN
  IF auth.uid() IS NULL OR p_pedido_id IS NULL OR p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'C5_AUTENTICACION_REQUERIDA: usuario y pedido son obligatorios'
      USING ERRCODE = '42501';
  END IF;

  IF p_usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'C5_USUARIO_NO_COINCIDE: no puedes gestionar pedidos a nombre de otro usuario'
      USING ERRCODE = '42501';
  END IF;

  IF p_estado IS NULL OR p_estado NOT IN ('aceptado', 'preparando', 'entregado', 'rechazado', 'cancelado') THEN
    RAISE EXCEPTION 'C5_ESTADO_NO_PERMITIDO: estado de pedido invalido'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_actor
  FROM public.usuarios u
  WHERE u.id = auth.uid() AND u.activo IS TRUE AND u.hotel_id IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'C5_ACTOR_INACTIVO: usuario sin hotel activo'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pedido
  FROM public.tienda_pedidos_web p
  WHERE p.id = p_pedido_id AND p.hotel_id = v_actor.hotel_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'C5_PEDIDO_NO_AUTORIZADO: pedido no encontrado para el hotel autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.fase1_actor_tiene_permiso(v_pedido.hotel_id, 'tienda.operar') THEN
    RAISE EXCEPTION 'C5_SIN_PERMISO_TIENDA: no tienes permiso para gestionar pedidos de tienda'
      USING ERRCODE = '42501';
  END IF;

  IF v_pedido.estado = p_estado THEN
    RETURN jsonb_build_object(
      'success', true,
      'pedido_id', v_pedido.id,
      'estado', v_pedido.estado,
      'venta_tienda_id', v_pedido.venta_tienda_id,
      'reserva_id', (
        SELECT v.reserva_id FROM public.ventas_tienda v
        WHERE v.id = v_pedido.venta_tienda_id AND v.hotel_id = v_pedido.hotel_id
      ),
      'idempotent', true
    );
  END IF;

  IF v_pedido.estado IN ('entregado', 'rechazado', 'cancelado') THEN
    RAISE EXCEPTION 'C5_PEDIDO_CERRADO: el pedido ya esta cerrado'
      USING ERRCODE = '23514';
  END IF;

  IF p_estado = 'entregado' THEN
    IF v_pedido.habitacion_id IS NULL THEN
      RAISE EXCEPTION 'C5_RESERVA_ACTIVA_REQUERIDA: el pedido no identifica una habitacion valida; verifica antes de entregar'
        USING ERRCODE = '23503';
    END IF;

    SELECT r.id INTO v_reserva_id
    FROM public.reservas r
    WHERE r.hotel_id = v_pedido.hotel_id
      AND r.habitacion_id = v_pedido.habitacion_id
      AND r.estado::text IN ('activa', 'ocupada', 'tiempo agotado')
    ORDER BY r.fecha_inicio DESC NULLS LAST, r.id DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'C5_RESERVA_ACTIVA_REQUERIDA: no hay una reserva activa en esta habitacion; verifica antes de entregar'
        USING ERRCODE = '23503';
    END IF;

    SELECT
      count(*)::integer,
      coalesce(sum(i.subtotal), 0),
      jsonb_agg(
        jsonb_build_object(
          'producto_id', i.producto_id,
          'cantidad', i.cantidad,
          'precio_unitario', i.precio_unitario
        ) ORDER BY i.id
      )
    INTO v_item_count, v_total_items, v_items
    FROM public.tienda_pedido_web_items i
    WHERE i.pedido_id = v_pedido.id;

    IF v_item_count = 0 THEN
      RAISE EXCEPTION 'C5_PEDIDO_SIN_ITEMS: el pedido no contiene productos'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.tienda_pedido_web_items i
      WHERE i.pedido_id = v_pedido.id
        AND (
          i.hotel_id IS DISTINCT FROM v_pedido.hotel_id
          OR i.producto_id IS NULL
          OR i.cantidad <= 0
          OR i.precio_unitario < 0
          OR i.subtotal <> round(i.cantidad * i.precio_unitario, 2)
        )
    ) OR round(v_total_items, 2) <> round(v_pedido.total, 2) THEN
      RAISE EXCEPTION 'C5_PEDIDO_INCONSISTENTE: los items no coinciden con el total confirmado'
        USING ERRCODE = '23514';
    END IF;

    v_venta_resultado := public.tienda_crear_venta_atomica_core(
      v_pedido.hotel_id,
      auth.uid(),
      v_items,
      '[]'::jsonb,
      'habitacion',
      NULL,
      v_pedido.id,
      v_reserva_id,
      v_pedido.habitacion_id,
      coalesce(v_pedido.cliente_nombre, 'Pedido web habitacion ' || v_pedido.habitacion_nombre),
      NULL,
      'congelado',
      'store_web_order',
      v_pedido.total,
      now()
    );
    v_venta_id := (v_venta_resultado->>'venta_id')::uuid;
    v_idempotent := coalesce((v_venta_resultado->>'idempotent')::boolean, false);
  END IF;

  UPDATE public.tienda_pedidos_web
  SET estado = p_estado,
      notas_internas = nullif(btrim(coalesce(p_notas_internas, '')), ''),
      gestionado_por_usuario_id = auth.uid(),
      venta_tienda_id = coalesce(v_venta_id, venta_tienda_id),
      aceptado_en = CASE
        WHEN p_estado IN ('aceptado', 'preparando') THEN coalesce(aceptado_en, now())
        ELSE aceptado_en
      END,
      rechazado_en = CASE
        WHEN p_estado IN ('rechazado', 'cancelado') THEN coalesce(rechazado_en, now())
        ELSE rechazado_en
      END,
      entregado_en = CASE
        WHEN p_estado = 'entregado' THEN coalesce(entregado_en, now())
        ELSE entregado_en
      END,
      actualizado_en = now()
  WHERE id = v_pedido.id AND hotel_id = v_pedido.hotel_id;

  RETURN jsonb_build_object(
    'success', true,
    'pedido_id', v_pedido.id,
    'estado', p_estado,
    'venta_tienda_id', v_venta_id,
    'reserva_id', v_reserva_id,
    'idempotent', v_idempotent
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ajustar_stock_tienda_seguro(
  p_producto_id uuid,
  p_delta integer,
  p_reason text,
  p_client_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_producto public.productos_tienda%rowtype;
  v_auditoria public.auditoria_operaciones%rowtype;
  v_stock_anterior integer;
  v_stock_nuevo integer;
  v_movimiento_id bigint;
  v_resultado jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_producto_id IS NULL OR p_delta = 0
     OR p_client_operation_id IS NULL OR btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'A16_AJUSTE_INVALIDO'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_producto
  FROM public.productos_tienda p
  WHERE p.id = p_producto_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.fase1_actor_tiene_permiso(v_producto.hotel_id, 'inventario.ajustar') THEN
    RAISE EXCEPTION 'A16_PRODUCTO_NO_AUTORIZADO'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_auditoria
  FROM public.auditoria_operaciones a
  WHERE a.hotel_id = v_producto.hotel_id
    AND a.accion = 'inventario.ajustar'
    AND a.client_operation_id = p_client_operation_id;

  IF FOUND THEN
    IF v_auditoria.actor_id IS DISTINCT FROM auth.uid()
       OR v_auditoria.entity_id IS DISTINCT FROM v_producto.id THEN
      RAISE EXCEPTION 'A16_OPERACION_NO_AUTORIZADA'
        USING ERRCODE = '42501';
    END IF;
    RETURN coalesce(v_auditoria.after_data, '{}'::jsonb)
      || jsonb_build_object('idempotent', true);
  END IF;

  v_stock_anterior := coalesce(v_producto.stock_actual, 0);
  v_stock_nuevo := v_stock_anterior + p_delta;
  IF v_stock_nuevo < 0 THEN
    RAISE EXCEPTION 'A16_STOCK_INSUFICIENTE: disponible %, ajuste %', v_stock_anterior, p_delta
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.productos_tienda
  SET stock_actual = v_stock_nuevo,
      actualizado_en = now()
  WHERE id = v_producto.id AND hotel_id = v_producto.hotel_id;

  INSERT INTO public.movimientos_inventario(
    hotel_id, producto_id, tipo_movimiento, cantidad, razon,
    usuario_responsable, stock_anterior, stock_nuevo, usuario_id, notas
  ) VALUES (
    v_producto.hotel_id,
    v_producto.id,
    CASE WHEN p_delta > 0 THEN 'INGRESO' ELSE 'SALIDA' END,
    abs(p_delta),
    btrim(p_reason),
    auth.uid()::text,
    v_stock_anterior,
    v_stock_nuevo,
    auth.uid(),
    'ajuste_tienda_atomico'
  )
  RETURNING id INTO v_movimiento_id;

  v_resultado := jsonb_build_object(
    'producto_id', v_producto.id,
    'movimiento_id', v_movimiento_id,
    'tipo_movimiento', CASE WHEN p_delta > 0 THEN 'INGRESO' ELSE 'SALIDA' END,
    'cantidad', abs(p_delta),
    'stock_anterior', v_stock_anterior,
    'stock_actual', v_stock_nuevo,
    'idempotent', false
  );

  INSERT INTO public.auditoria_operaciones(
    hotel_id, actor_id, accion, entidad, entity_id,
    before_data, after_data, reason, client_operation_id
  ) VALUES (
    v_producto.hotel_id,
    auth.uid(),
    'inventario.ajustar',
    'productos_tienda',
    v_producto.id,
    jsonb_build_object('stock_actual', v_stock_anterior),
    v_resultado,
    btrim(p_reason),
    p_client_operation_id
  );

  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.tienda_crear_venta_atomica_core(
  uuid,uuid,jsonb,jsonb,text,uuid,uuid,uuid,uuid,text,uuid,text,text,numeric,timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.procesar_venta_tienda_atomica(
  jsonb,jsonb,text,uuid,uuid,uuid,uuid,text,uuid,timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.procesar_venta_tienda_atomica(
  jsonb,jsonb,text,uuid,uuid,uuid,uuid,text,uuid,timestamptz
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.actualizar_estado_pedido_web_tienda(uuid,uuid,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actualizar_estado_pedido_web_tienda(uuid,uuid,text,text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.ajustar_stock_tienda_seguro(uuid,integer,text,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajustar_stock_tienda_seguro(uuid,integer,text,uuid)
  TO authenticated, service_role;
