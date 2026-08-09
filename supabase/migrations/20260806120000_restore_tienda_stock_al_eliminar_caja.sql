-- Devuelve al inventario los productos de una venta de Tienda cuando se elimina
-- su ultimo movimiento de Caja. Una venta puede tener varios movimientos por
-- pagos mixtos; por eso el stock se repone una sola vez, al eliminar el ultimo.
CREATE OR REPLACE FUNCTION public.registrar_y_eliminar_mov_caja(
  movimiento_id_param uuid,
  eliminado_por_usuario_id_param uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  movimiento_a_eliminar public.caja%rowtype;
  detalle record;
  v_stock_anterior integer;
  v_stock_nuevo integer;
  v_usuario_nombre text;
  v_es_ultimo_movimiento boolean := false;
BEGIN
  SELECT *
    INTO movimiento_a_eliminar
    FROM public.caja
   WHERE id = movimiento_id_param
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento de caja con id % no encontrado.', movimiento_id_param;
  END IF;

  SELECT nombre
    INTO v_usuario_nombre
    FROM public.usuarios
   WHERE id = eliminado_por_usuario_id_param;

  INSERT INTO public.log_caja_eliminados (
    movimiento_id_eliminado,
    datos_eliminados,
    eliminado_por_usuario_id,
    hotel_id
  )
  VALUES (
    movimiento_a_eliminar.id,
    row_to_json(movimiento_a_eliminar)::jsonb,
    eliminado_por_usuario_id_param,
    movimiento_a_eliminar.hotel_id
  );

  IF movimiento_a_eliminar.venta_tienda_id IS NOT NULL THEN
    -- Bloquea los movimientos de la venta para serializar eliminaciones
    -- concurrentes y decidir con seguridad si este es el ultimo pago.
    PERFORM id
      FROM public.caja
     WHERE venta_tienda_id = movimiento_a_eliminar.venta_tienda_id
     FOR UPDATE;

    SELECT NOT EXISTS (
      SELECT 1
        FROM public.caja
       WHERE venta_tienda_id = movimiento_a_eliminar.venta_tienda_id
         AND id <> movimiento_id_param
    )
    INTO v_es_ultimo_movimiento;

    IF v_es_ultimo_movimiento THEN
      FOR detalle IN
        SELECT producto_id, SUM(cantidad)::integer AS cantidad
          FROM public.detalle_ventas_tienda
         WHERE venta_id = movimiento_a_eliminar.venta_tienda_id
           AND hotel_id = movimiento_a_eliminar.hotel_id
         GROUP BY producto_id
      LOOP
        SELECT stock_actual
          INTO v_stock_anterior
          FROM public.productos_tienda
         WHERE id = detalle.producto_id
           AND hotel_id = movimiento_a_eliminar.hotel_id
         FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'No se encontro el producto % de la venta de tienda %.',
            detalle.producto_id, movimiento_a_eliminar.venta_tienda_id;
        END IF;

        v_stock_nuevo := v_stock_anterior + detalle.cantidad;

        UPDATE public.productos_tienda
           SET stock_actual = v_stock_nuevo,
               actualizado_en = now()
         WHERE id = detalle.producto_id;

        INSERT INTO public.movimientos_inventario (
          hotel_id,
          producto_id,
          tipo_movimiento,
          cantidad,
          razon,
          usuario_responsable,
          stock_anterior,
          stock_nuevo
        )
        VALUES (
          movimiento_a_eliminar.hotel_id,
          detalle.producto_id,
          'INGRESO',
          detalle.cantidad,
          format('Devolucion por eliminacion en Caja de venta Tienda %s', movimiento_a_eliminar.venta_tienda_id),
          COALESCE(v_usuario_nombre, eliminado_por_usuario_id_param::text),
          v_stock_anterior,
          v_stock_nuevo
        );
      END LOOP;
    END IF;
  END IF;

  DELETE FROM public.caja
   WHERE id = movimiento_id_param;
END;
$function$;

