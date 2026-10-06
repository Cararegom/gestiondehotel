-- C5: evita ventas web huerfanas y registra la salida de inventario sin duplicar CMV.
-- El pedido conserva los precios confirmados al crearse, pero la entrega solo se
-- completa si existe una estancia activa y toda la operacion puede confirmarse.

CREATE INDEX IF NOT EXISTS reservas_hotel_habitacion_estado_fecha_idx
  ON public.reservas(hotel_id, habitacion_id, estado, fecha_inicio DESC, id);

CREATE OR REPLACE FUNCTION public.actualizar_estado_pedido_web_tienda(
  p_pedido_id uuid,
  p_usuario_id uuid,
  p_estado text,
  p_notas_internas text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_pedido public.tienda_pedidos_web%rowtype;
  v_item record;
  v_reserva_id uuid;
  v_venta_id uuid;
  v_venta_existente public.ventas_tienda%rowtype;
  v_item_count integer := 0;
  v_expected_products integer := 0;
  v_locked_products integer := 0;
  v_total_items numeric := 0;
  v_stock_nuevo integer;
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

  SELECT *
  INTO v_actor
  FROM public.usuarios
  WHERE id = auth.uid()
    AND activo IS TRUE
    AND hotel_id IS NOT NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'C5_ACTOR_INACTIVO: usuario sin hotel activo'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_pedido
  FROM public.tienda_pedidos_web
  WHERE id = p_pedido_id
    AND hotel_id = v_actor.hotel_id
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
        SELECT v.reserva_id
        FROM public.ventas_tienda v
        WHERE v.id = v_pedido.venta_tienda_id
          AND v.hotel_id = v_pedido.hotel_id
      ),
      'idempotent', true
    );
  END IF;

  IF v_pedido.estado IN ('entregado', 'rechazado', 'cancelado') THEN
    RAISE EXCEPTION 'C5_PEDIDO_CERRADO: el pedido ya esta cerrado'
      USING ERRCODE = '23514';
  END IF;

  IF p_estado = 'entregado' THEN
    SELECT *
    INTO v_venta_existente
    FROM public.ventas_tienda v
    WHERE v.hotel_id = v_pedido.hotel_id
      AND v.source = 'store_web_order'
      AND v.client_operation_id = v_pedido.id
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.tienda_pedidos_web
      SET estado = 'entregado',
          notas_internas = NULLIF(btrim(COALESCE(p_notas_internas, '')), ''),
          gestionado_por_usuario_id = auth.uid(),
          venta_tienda_id = v_venta_existente.id,
          entregado_en = COALESCE(entregado_en, now()),
          actualizado_en = now()
      WHERE id = v_pedido.id;

      RETURN jsonb_build_object(
        'success', true,
        'pedido_id', v_pedido.id,
        'estado', 'entregado',
        'venta_tienda_id', v_venta_existente.id,
        'reserva_id', v_venta_existente.reserva_id,
        'idempotent', true
      );
    END IF;

    IF v_pedido.habitacion_id IS NULL THEN
      RAISE EXCEPTION 'C5_RESERVA_ACTIVA_REQUERIDA: el pedido no identifica una habitacion valida; verifica antes de entregar'
        USING ERRCODE = '23503';
    END IF;

    SELECT r.id
    INTO v_reserva_id
    FROM public.reservas r
    WHERE r.hotel_id = v_pedido.hotel_id
      AND r.habitacion_id = v_pedido.habitacion_id
      AND r.estado IN ('activa', 'ocupada', 'tiempo agotado')
    ORDER BY r.fecha_inicio DESC NULLS LAST, r.id DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'C5_RESERVA_ACTIVA_REQUERIDA: no hay una reserva activa en esta habitacion; verifica antes de entregar'
        USING ERRCODE = '23503';
    END IF;

    SELECT count(*)::integer,
           count(DISTINCT i.producto_id)::integer,
           COALESCE(sum(i.subtotal), 0)
    INTO v_item_count, v_expected_products, v_total_items
    FROM public.tienda_pedido_web_items i
    WHERE i.pedido_id = v_pedido.id;

    IF v_item_count = 0 THEN
      RAISE EXCEPTION 'C5_PEDIDO_SIN_ITEMS: el pedido no contiene productos'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.tienda_pedido_web_items i
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

    FOR v_item IN
      SELECT p.id AS producto_id,
             p.hotel_id,
             p.nombre,
             p.activo,
             p.stock_actual,
             items.cantidad
      FROM (
        SELECT i.producto_id, sum(i.cantidad)::integer AS cantidad
        FROM public.tienda_pedido_web_items i
        WHERE i.pedido_id = v_pedido.id
        GROUP BY i.producto_id
      ) items
      JOIN public.productos_tienda p ON p.id = items.producto_id
      ORDER BY p.id
      FOR UPDATE OF p
    LOOP
      v_locked_products := v_locked_products + 1;
      IF v_item.hotel_id IS DISTINCT FROM v_pedido.hotel_id OR v_item.activo IS NOT TRUE THEN
        RAISE EXCEPTION 'C5_PRODUCTO_NO_AUTORIZADO: producto inexistente o fuera del hotel'
          USING ERRCODE = '42501';
      END IF;
      IF COALESCE(v_item.stock_actual, 0) < v_item.cantidad THEN
        RAISE EXCEPTION 'C5_STOCK_INSUFICIENTE: stock insuficiente para %. Disponible: %, requerido: %',
          v_item.nombre,
          COALESCE(v_item.stock_actual, 0),
          v_item.cantidad
          USING ERRCODE = '23514';
      END IF;
    END LOOP;

    IF v_locked_products <> v_expected_products THEN
      RAISE EXCEPTION 'C5_PRODUCTO_NO_AUTORIZADO: uno de los productos ya no existe'
        USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.ventas_tienda (
      hotel_id,
      total_venta,
      usuario_id,
      fecha,
      reserva_id,
      habitacion_id,
      cliente_temporal,
      estado_pago,
      client_operation_id,
      business_date,
      source
    ) VALUES (
      v_pedido.hotel_id,
      round(v_total_items, 2),
      auth.uid(),
      now(),
      v_reserva_id,
      v_pedido.habitacion_id,
      COALESCE(v_pedido.cliente_nombre, 'Pedido web habitacion ' || v_pedido.habitacion_nombre),
      'pendiente',
      v_pedido.id,
      public.fase1_business_date(now()),
      'store_web_order'
    )
    RETURNING id INTO v_venta_id;

    INSERT INTO public.detalle_ventas_tienda (
      venta_id,
      producto_id,
      cantidad,
      precio_unitario_venta,
      subtotal,
      hotel_id,
      creado_en
    )
    SELECT v_venta_id,
           i.producto_id,
           i.cantidad,
           i.precio_unitario,
           i.subtotal,
           v_pedido.hotel_id,
           now()
    FROM public.tienda_pedido_web_items i
    WHERE i.pedido_id = v_pedido.id
    ORDER BY i.id;

    FOR v_item IN
      SELECT p.id AS producto_id,
             p.nombre,
             p.stock_actual,
             items.cantidad
      FROM (
        SELECT i.producto_id, sum(i.cantidad)::integer AS cantidad
        FROM public.tienda_pedido_web_items i
        WHERE i.pedido_id = v_pedido.id
        GROUP BY i.producto_id
      ) items
      JOIN public.productos_tienda p ON p.id = items.producto_id
      ORDER BY p.id
      FOR UPDATE OF p
    LOOP
      v_stock_nuevo := v_item.stock_actual - v_item.cantidad;

      UPDATE public.productos_tienda
      SET stock_actual = v_stock_nuevo,
          actualizado_en = now()
      WHERE id = v_item.producto_id
        AND hotel_id = v_pedido.hotel_id;

      INSERT INTO public.movimientos_inventario (
        hotel_id,
        producto_id,
        tipo_movimiento,
        cantidad,
        razon,
        usuario_responsable,
        stock_anterior,
        stock_nuevo,
        usuario_id,
        notas
      ) VALUES (
        v_pedido.hotel_id,
        v_item.producto_id,
        'SALIDA',
        v_item.cantidad,
        'venta_tienda_pedido_web',
        auth.uid()::text,
        v_item.stock_actual,
        v_stock_nuevo,
        auth.uid(),
        'pedido_web_id=' || v_pedido.id || ';venta_id=' || v_venta_id
      );
    END LOOP;

    INSERT INTO public.auditoria_operaciones (
      hotel_id,
      actor_id,
      accion,
      entidad,
      entity_id,
      after_data,
      client_operation_id
    ) VALUES (
      v_pedido.hotel_id,
      auth.uid(),
      'tienda.pedido_web_entregar',
      'tienda_pedidos_web',
      v_pedido.id,
      jsonb_build_object(
        'venta_tienda_id', v_venta_id,
        'reserva_id', v_reserva_id,
        'total', round(v_total_items, 2),
        'productos', v_expected_products
      ),
      v_pedido.id
    );
  END IF;

  UPDATE public.tienda_pedidos_web
  SET estado = p_estado,
      notas_internas = NULLIF(btrim(COALESCE(p_notas_internas, '')), ''),
      gestionado_por_usuario_id = auth.uid(),
      venta_tienda_id = COALESCE(v_venta_id, venta_tienda_id),
      aceptado_en = CASE
        WHEN p_estado IN ('aceptado', 'preparando') THEN COALESCE(aceptado_en, now())
        ELSE aceptado_en
      END,
      rechazado_en = CASE
        WHEN p_estado IN ('rechazado', 'cancelado') THEN COALESCE(rechazado_en, now())
        ELSE rechazado_en
      END,
      entregado_en = CASE
        WHEN p_estado = 'entregado' THEN COALESCE(entregado_en, now())
        ELSE entregado_en
      END,
      actualizado_en = now()
  WHERE id = v_pedido.id;

  RETURN jsonb_build_object(
    'success', true,
    'pedido_id', v_pedido.id,
    'estado', p_estado,
    'venta_tienda_id', v_venta_id,
    'reserva_id', v_reserva_id,
    'idempotent', false
  );
END;
$function$;

-- Los detalles de venta ya generan CMV. Este movimiento solo aporta trazabilidad
-- de stock y debe excluirse del trigger de ajustes para evitar doble costo.
CREATE OR REPLACE FUNCTION public.fase4_inventory_adjustment_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_delta numeric;
  v_name text;
  v_unit numeric;
BEGIN
  v_delta := COALESCE(NEW.stock_nuevo, 0) - COALESCE(NEW.stock_anterior, 0);
  IF v_delta = 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.producto_id IS NOT NULL
     AND COALESCE(NEW.razon, '') NOT IN (
       'venta_tienda_atomica',
       'venta_tienda_pedido_web',
       'Recepción de compra'
     )
     AND NEW.tipo_movimiento <> 'ingreso_compra' THEN
    SELECT nombre INTO v_name
    FROM public.productos_tienda
    WHERE id = NEW.producto_id;

    SELECT average_unit_cost INTO v_unit
    FROM public.inventory_cost_balances
    WHERE hotel_id = NEW.hotel_id
      AND area = 'store'
      AND item_id = NEW.producto_id;

    IF v_delta > 0 THEN
      PERFORM public.fase4_cost_in(
        NEW.hotel_id, 'store', NEW.producto_id, v_name, v_delta, COALESCE(v_unit, 0),
        'inventory_adjustment', 'store_adjustment:' || NEW.id, NEW.creado_en
      );
    ELSE
      PERFORM public.fase4_cost_out(
        NEW.hotel_id, 'store', NEW.producto_id, v_name, abs(v_delta),
        'inventory_adjustment', 'store_adjustment:' || NEW.id, NEW.creado_en
      );
    END IF;
  ELSIF NEW.ingrediente_id IS NOT NULL AND NEW.tipo_movimiento <> 'venta_plato' THEN
    SELECT nombre, costo_unitario INTO v_name, v_unit
    FROM public.ingredientes
    WHERE id = NEW.ingrediente_id;

    IF v_delta > 0 THEN
      PERFORM public.fase4_cost_in(
        NEW.hotel_id, 'restaurant', NEW.ingrediente_id, v_name, v_delta, COALESCE(v_unit, 0),
        'inventory_adjustment', 'restaurant_adjustment:' || NEW.id, NEW.creado_en
      );
    ELSE
      PERFORM public.fase4_cost_out(
        NEW.hotel_id, 'restaurant', NEW.ingrediente_id, v_name, abs(v_delta),
        'inventory_adjustment', 'restaurant_adjustment:' || NEW.id, NEW.creado_en
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.actualizar_estado_pedido_web_tienda(uuid, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actualizar_estado_pedido_web_tienda(uuid, uuid, text, text)
  TO authenticated, service_role;
