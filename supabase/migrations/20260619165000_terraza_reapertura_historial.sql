ALTER TABLE public.terraza_pedidos
  ADD COLUMN IF NOT EXISTS fecha_cancelacion timestamp with time zone,
  ADD COLUMN IF NOT EXISTS cancelado_por_usuario_id uuid,
  ADD COLUMN IF NOT EXISTS motivo_cancelacion text,
  ADD COLUMN IF NOT EXISTS fecha_reapertura timestamp with time zone,
  ADD COLUMN IF NOT EXISTS reabierto_por_usuario_id uuid,
  ADD COLUMN IF NOT EXISTS motivo_reapertura text,
  ADD COLUMN IF NOT EXISTS reabierto_en_pedido_id uuid,
  ADD COLUMN IF NOT EXISTS pedido_origen_reapertura_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'terraza_pedidos_cancelado_por_usuario_id_fkey'
  ) THEN
    ALTER TABLE public.terraza_pedidos
      ADD CONSTRAINT terraza_pedidos_cancelado_por_usuario_id_fkey
      FOREIGN KEY (cancelado_por_usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'terraza_pedidos_reabierto_por_usuario_id_fkey'
  ) THEN
    ALTER TABLE public.terraza_pedidos
      ADD CONSTRAINT terraza_pedidos_reabierto_por_usuario_id_fkey
      FOREIGN KEY (reabierto_por_usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'terraza_pedidos_reabierto_en_pedido_id_fkey'
  ) THEN
    ALTER TABLE public.terraza_pedidos
      ADD CONSTRAINT terraza_pedidos_reabierto_en_pedido_id_fkey
      FOREIGN KEY (reabierto_en_pedido_id) REFERENCES public.terraza_pedidos(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'terraza_pedidos_pedido_origen_reapertura_id_fkey'
  ) THEN
    ALTER TABLE public.terraza_pedidos
      ADD CONSTRAINT terraza_pedidos_pedido_origen_reapertura_id_fkey
      FOREIGN KEY (pedido_origen_reapertura_id) REFERENCES public.terraza_pedidos(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_terraza_pedidos_reapertura_origen
  ON public.terraza_pedidos(pedido_origen_reapertura_id);

CREATE INDEX IF NOT EXISTS idx_terraza_pedidos_reapertura_destino
  ON public.terraza_pedidos(reabierto_en_pedido_id);

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
  v_caja_original record;
  v_nuevo_pedido_id uuid;
  v_total numeric(12,2);
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
   ORDER BY creado_en DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el movimiento de caja original para anular.';
  END IF;

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
    'total_anulado', COALESCE(v_caja_original.monto, v_total)
  );
END;
$function$;
