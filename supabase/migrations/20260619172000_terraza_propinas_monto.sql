ALTER TABLE public.terraza_pedidos
  ADD COLUMN IF NOT EXISTS propina_sugerida_monto numeric(12,2) DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS propina_monto numeric(12,2) DEFAULT 0 NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'terraza_pedidos_propina_sugerida_check') THEN
    ALTER TABLE public.terraza_pedidos
      ADD CONSTRAINT terraza_pedidos_propina_sugerida_check CHECK (propina_sugerida_monto >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'terraza_pedidos_propina_monto_check') THEN
    ALTER TABLE public.terraza_pedidos
      ADD CONSTRAINT terraza_pedidos_propina_monto_check CHECK (propina_monto >= 0);
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.cerrar_pedido_terraza(uuid, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.cerrar_pedido_terraza(
  p_pedido_id uuid,
  p_metodo_pago_id uuid,
  p_usuario_id uuid,
  p_turno_id uuid,
  p_propina_monto numeric DEFAULT 0,
  p_propina_sugerida_monto numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido record;
  v_actor public.usuarios%rowtype;
  v_turno public.turnos%rowtype;
  v_total numeric(12,2);
  v_propina_monto numeric(12,2) := round(GREATEST(COALESCE(p_propina_monto, 0), 0), 2);
  v_propina_sugerida numeric(12,2) := round(GREATEST(COALESCE(p_propina_sugerida_monto, 0), 0), 2);
  v_caja_id uuid;
  v_caja_propina_id uuid;
  v_ubicacion text;
  v_detalle_items text;
  v_concepto text;
  v_item record;
  v_hotel_terraza constant uuid := '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para cobrar pedidos de terraza.';
  END IF;

  SELECT * INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro perfil de usuario.';
  END IF;

  SELECT p.*, m.numero AS mesa_numero, m.nombre AS mesa_nombre, m.tipo AS mesa_tipo
    INTO v_pedido
    FROM public.terraza_pedidos p
    JOIN public.terraza_mesas m ON m.id = p.mesa_id
   WHERE p.id = p_pedido_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de terraza no encontrado.';
  END IF;

  IF v_pedido.hotel_id <> v_hotel_terraza THEN
    RAISE EXCEPTION 'El modulo Terraza no esta habilitado para este hotel.';
  END IF;

  IF COALESCE(v_actor.rol::text, '') <> 'superadmin' AND v_actor.hotel_id IS DISTINCT FROM v_pedido.hotel_id THEN
    RAISE EXCEPTION 'No puedes cobrar pedidos de otro hotel.';
  END IF;

  IF COALESCE(v_actor.rol::text, '') <> 'superadmin' AND p_usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No puedes registrar cobros a nombre de otro usuario.';
  END IF;

  IF v_pedido.estado <> 'abierto' THEN
    RAISE EXCEPTION 'Este pedido ya no esta abierto.';
  END IF;

  SELECT * INTO v_turno
    FROM public.turnos
   WHERE id = p_turno_id
     AND hotel_id = v_pedido.hotel_id
     AND usuario_id = p_usuario_id
     AND estado = 'abierto'
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay un turno de caja abierto para este usuario.';
  END IF;

  SELECT COALESCE(SUM(subtotal), 0)
    INTO v_total
    FROM public.terraza_pedido_items
   WHERE pedido_id = p_pedido_id;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'No se puede cobrar un pedido sin consumos.';
  END IF;

  FOR v_item IN
    SELECT
      pedido_items.producto_id,
      pedido_items.producto_nombre,
      pedido_items.cantidad,
      p.stock_actual
    FROM (
      SELECT
        producto_id,
        MAX(producto_nombre) AS producto_nombre,
        SUM(cantidad)::integer AS cantidad
      FROM public.terraza_pedido_items
      WHERE pedido_id = p_pedido_id
        AND producto_id IS NOT NULL
      GROUP BY producto_id
    ) pedido_items
    JOIN public.terraza_productos p ON p.id = pedido_items.producto_id
    FOR UPDATE OF p
  LOOP
    IF v_item.stock_actual < v_item.cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente en Terraza para %. Disponible: %, requerido: %',
        v_item.producto_nombre,
        v_item.stock_actual,
        v_item.cantidad;
    END IF;

    UPDATE public.terraza_productos
       SET stock_actual = stock_actual - v_item.cantidad,
           actualizado_en = now()
     WHERE id = v_item.producto_id;
  END LOOP;

  v_ubicacion := CASE
    WHEN v_pedido.mesa_tipo = 'sillas_sueltas' THEN 'Terraza Silla suelta ' || v_pedido.silla_numero
    ELSE 'Terraza Mesa ' || v_pedido.mesa_numero ||
      CASE
        WHEN v_pedido.silla_numero IS NULL THEN ''
        ELSE ' Silla ' || v_pedido.silla_numero
      END
    END;

  SELECT string_agg(
           item.cantidad::text || 'x ' || item.producto_nombre ||
           CASE WHEN item.es_michelada THEN ' Michelada' ELSE '' END,
           ', ' ORDER BY item.creado_en
         )
    INTO v_detalle_items
    FROM public.terraza_pedido_items item
   WHERE item.pedido_id = p_pedido_id;

  v_concepto := v_ubicacion || COALESCE(': ' || v_detalle_items, '');

  IF length(v_concepto) > 250 THEN
    v_concepto := left(v_concepto, 247) || '...';
  END IF;

  UPDATE public.terraza_pedidos
     SET estado = 'pagado',
         total = v_total,
         propina_sugerida_monto = v_propina_sugerida,
         propina_monto = v_propina_monto,
         metodo_pago_id = p_metodo_pago_id,
         turno_id = p_turno_id,
         usuario_id = COALESCE(p_usuario_id, usuario_id),
         fecha_cierre = now(),
         actualizado_en = now()
   WHERE id = p_pedido_id;

  INSERT INTO public.caja (
    hotel_id,
    usuario_id,
    turno_id,
    tipo,
    monto,
    metodo_pago_id,
    concepto,
    venta_terraza_id
  ) VALUES (
    v_pedido.hotel_id,
    p_usuario_id,
    p_turno_id,
    'ingreso',
    v_total,
    p_metodo_pago_id,
    v_concepto,
    p_pedido_id
  )
  RETURNING id INTO v_caja_id;

  IF v_propina_monto > 0 THEN
    INSERT INTO public.caja (
      hotel_id,
      usuario_id,
      turno_id,
      tipo,
      monto,
      metodo_pago_id,
      concepto,
      venta_terraza_id
    ) VALUES (
      v_pedido.hotel_id,
      p_usuario_id,
      p_turno_id,
      'ingreso',
      v_propina_monto,
      p_metodo_pago_id,
      left('Propina voluntaria - ' || v_ubicacion, 250),
      p_pedido_id
    )
    RETURNING id INTO v_caja_propina_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'pedido_id', p_pedido_id,
    'caja_id', v_caja_id,
    'caja_propina_id', v_caja_propina_id,
    'total', v_total,
    'propina_monto', v_propina_monto,
    'total_con_propina', v_total + v_propina_monto
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reabrir_pedido_terraza(
  p_pedido_id uuid,
  p_usuario_id uuid,
  p_turno_id uuid,
  p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_turno public.turnos%rowtype;
  v_pedido record;
  v_caja_original public.caja%rowtype;
  v_propina_original public.caja%rowtype;
  v_nuevo_pedido_id uuid;
  v_total numeric(12,2);
  v_propina_monto numeric(12,2);
  v_motivo text := btrim(COALESCE(p_motivo, ''));
  v_ubicacion text;
  v_item record;
  v_hotel_terraza constant uuid := '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para reabrir cuentas de terraza.';
  END IF;

  IF v_motivo = '' THEN
    RAISE EXCEPTION 'El motivo de reapertura es obligatorio.';
  END IF;

  SELECT * INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro perfil de usuario.';
  END IF;

  SELECT p.*, m.numero AS mesa_numero, m.nombre AS mesa_nombre, m.tipo AS mesa_tipo
    INTO v_pedido
    FROM public.terraza_pedidos p
    JOIN public.terraza_mesas m ON m.id = p.mesa_id
   WHERE p.id = p_pedido_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cuenta de terraza no encontrada.';
  END IF;

  IF v_pedido.hotel_id <> v_hotel_terraza THEN
    RAISE EXCEPTION 'El modulo Terraza no esta habilitado para este hotel.';
  END IF;

  IF COALESCE(v_actor.rol::text, '') <> 'superadmin' AND v_actor.hotel_id IS DISTINCT FROM v_pedido.hotel_id THEN
    RAISE EXCEPTION 'No puedes reabrir cuentas de otro hotel.';
  END IF;

  IF COALESCE(v_actor.rol::text, '') <> 'superadmin' AND p_usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No puedes reabrir cuentas a nombre de otro usuario.';
  END IF;

  IF v_pedido.estado <> 'pagado' THEN
    RAISE EXCEPTION 'Solo se pueden reabrir cuentas pagadas.';
  END IF;

  IF v_pedido.reabierto_en_pedido_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta cuenta ya fue reabierta anteriormente.';
  END IF;

  SELECT * INTO v_turno
    FROM public.turnos
   WHERE id = p_turno_id
     AND hotel_id = v_pedido.hotel_id
     AND usuario_id = p_usuario_id
     AND estado = 'abierto'
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay un turno de caja abierto para reabrir esta cuenta.';
  END IF;

  IF v_pedido.turno_id IS DISTINCT FROM p_turno_id THEN
    RAISE EXCEPTION 'Solo se puede reabrir la cuenta en el mismo turno donde fue cobrada.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.terraza_pedidos p
     WHERE p.hotel_id = v_pedido.hotel_id
       AND p.mesa_id = v_pedido.mesa_id
       AND COALESCE(p.silla_numero, 0) = COALESCE(v_pedido.silla_numero, 0)
       AND p.estado = 'abierto'
  ) THEN
    RAISE EXCEPTION 'Ya existe una cuenta abierta en esta mesa o silla.';
  END IF;

  SELECT *
    INTO v_caja_original
    FROM public.caja
   WHERE venta_terraza_id = p_pedido_id
     AND tipo = 'ingreso'
     AND lower(COALESCE(concepto, '')) NOT LIKE '%propina%'
   ORDER BY creado_en DESC
   LIMIT 1;

  IF v_caja_original.id IS NULL THEN
    RAISE EXCEPTION 'No se encontro el movimiento de caja original para anular.';
  END IF;

  SELECT *
    INTO v_propina_original
    FROM public.caja
   WHERE venta_terraza_id = p_pedido_id
     AND tipo = 'ingreso'
     AND lower(COALESCE(concepto, '')) LIKE '%propina%'
   ORDER BY creado_en DESC
   LIMIT 1;

  v_propina_monto := COALESCE(v_propina_original.monto, v_pedido.propina_monto, 0);

  SELECT COALESCE(SUM(subtotal), v_pedido.total, 0)
    INTO v_total
    FROM public.terraza_pedido_items
   WHERE pedido_id = p_pedido_id;

  IF COALESCE(v_total, 0) <= 0 THEN
    RAISE EXCEPTION 'No se puede reabrir una cuenta sin consumos.';
  END IF;

  FOR v_item IN
    SELECT
      pedido_items.producto_id,
      pedido_items.producto_nombre,
      pedido_items.cantidad
    FROM (
      SELECT
        producto_id,
        MAX(producto_nombre) AS producto_nombre,
        SUM(cantidad)::integer AS cantidad
      FROM public.terraza_pedido_items
      WHERE pedido_id = p_pedido_id
        AND producto_id IS NOT NULL
      GROUP BY producto_id
    ) pedido_items
    JOIN public.terraza_productos p ON p.id = pedido_items.producto_id
    FOR UPDATE OF p
  LOOP
    UPDATE public.terraza_productos
       SET stock_actual = stock_actual + v_item.cantidad,
           actualizado_en = now()
     WHERE id = v_item.producto_id;
  END LOOP;

  INSERT INTO public.terraza_pedidos (
    hotel_id,
    mesa_id,
    silla_numero,
    usuario_id,
    estado,
    cliente_nombre,
    notas,
    pedido_origen_reapertura_id
  ) VALUES (
    v_pedido.hotel_id,
    v_pedido.mesa_id,
    v_pedido.silla_numero,
    p_usuario_id,
    'abierto',
    v_pedido.cliente_nombre,
    trim(both from COALESCE(v_pedido.notas || E'\n', '') || 'Reabierta desde cuenta ' || p_pedido_id::text || '. Motivo: ' || v_motivo),
    p_pedido_id
  )
  RETURNING id INTO v_nuevo_pedido_id;

  INSERT INTO public.terraza_pedido_items (
    pedido_id,
    hotel_id,
    producto_id,
    producto_nombre,
    cantidad,
    precio_unitario,
    subtotal,
    notas,
    es_michelada,
    precio_base,
    precio_michelada
  )
  SELECT
    v_nuevo_pedido_id,
    hotel_id,
    producto_id,
    producto_nombre,
    cantidad,
    precio_unitario,
    subtotal,
    notas,
    COALESCE(es_michelada, false),
    COALESCE(precio_base, precio_unitario),
    COALESCE(precio_michelada, 0)
  FROM public.terraza_pedido_items
  WHERE pedido_id = p_pedido_id;

  v_ubicacion := CASE
    WHEN v_pedido.mesa_tipo = 'sillas_sueltas' THEN 'Terraza Silla suelta ' || v_pedido.silla_numero
    ELSE 'Terraza Mesa ' || v_pedido.mesa_numero ||
      CASE
        WHEN v_pedido.silla_numero IS NULL THEN ''
        ELSE ' Silla ' || v_pedido.silla_numero
      END
    END;

  INSERT INTO public.caja (
    hotel_id,
    usuario_id,
    turno_id,
    tipo,
    monto,
    metodo_pago_id,
    concepto,
    venta_terraza_id
  ) VALUES (
    v_pedido.hotel_id,
    p_usuario_id,
    p_turno_id,
    'egreso',
    COALESCE(v_caja_original.monto, v_total),
    v_caja_original.metodo_pago_id,
    left('Anulacion por reapertura - ' || v_ubicacion || ': ' || v_motivo, 250),
    p_pedido_id
  );

  IF COALESCE(v_propina_monto, 0) > 0 THEN
    INSERT INTO public.caja (
      hotel_id,
      usuario_id,
      turno_id,
      tipo,
      monto,
      metodo_pago_id,
      concepto,
      venta_terraza_id
    ) VALUES (
      v_pedido.hotel_id,
      p_usuario_id,
      p_turno_id,
      'egreso',
      v_propina_monto,
      COALESCE(v_propina_original.metodo_pago_id, v_caja_original.metodo_pago_id),
      left('Anulacion propina voluntaria - ' || v_ubicacion || ': ' || v_motivo, 250),
      p_pedido_id
    );
  END IF;

  UPDATE public.terraza_pedidos
     SET estado = 'cancelado',
         fecha_cancelacion = now(),
         cancelado_por_usuario_id = p_usuario_id,
         motivo_cancelacion = 'Reapertura: ' || v_motivo,
         fecha_reapertura = now(),
         reabierto_por_usuario_id = p_usuario_id,
         motivo_reapertura = v_motivo,
         reabierto_en_pedido_id = v_nuevo_pedido_id,
         actualizado_en = now()
   WHERE id = p_pedido_id;

  RETURN jsonb_build_object(
    'success', true,
    'pedido_original_id', p_pedido_id,
    'nuevo_pedido_id', v_nuevo_pedido_id,
    'mesa_id', v_pedido.mesa_id,
    'silla_numero', v_pedido.silla_numero,
    'total_anulado', COALESCE(v_caja_original.monto, v_total),
    'propina_anulada', COALESCE(v_propina_monto, 0)
  );
END;
$function$;
