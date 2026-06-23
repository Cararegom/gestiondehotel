-- Reservas de Terraza con anticipo consumible contra inventario.

ALTER TABLE public.terraza_pedidos
  ADD COLUMN IF NOT EXISTS reserva_terraza_id uuid;

CREATE TABLE IF NOT EXISTS public.terraza_reservas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  mesa_id uuid NOT NULL REFERENCES public.terraza_mesas(id) ON DELETE RESTRICT,
  silla_numero integer,
  cliente_nombre text NOT NULL,
  cliente_telefono text,
  fecha_reserva timestamp with time zone NOT NULL,
  cantidad_personas integer DEFAULT 1 NOT NULL,
  anticipo_consumible numeric(12,2) DEFAULT 0 NOT NULL,
  saldo_consumido numeric(12,2) DEFAULT 0 NOT NULL,
  metodo_pago_id uuid REFERENCES public.metodos_pago(id) ON DELETE SET NULL,
  caja_anticipo_id uuid,
  pedido_id uuid,
  estado text DEFAULT 'reservada'::text NOT NULL,
  notas text,
  usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  cancelado_por_usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  fecha_cancelacion timestamp with time zone,
  creado_en timestamp with time zone DEFAULT now(),
  actualizado_en timestamp with time zone DEFAULT now(),
  CONSTRAINT terraza_reservas_pkey PRIMARY KEY (id),
  CONSTRAINT terraza_reservas_estado_check CHECK (estado IN ('reservada', 'en_curso', 'completada', 'cancelada')),
  CONSTRAINT terraza_reservas_silla_check CHECK (silla_numero IS NULL OR silla_numero > 0),
  CONSTRAINT terraza_reservas_personas_check CHECK (cantidad_personas > 0),
  CONSTRAINT terraza_reservas_anticipo_check CHECK (anticipo_consumible >= 0),
  CONSTRAINT terraza_reservas_saldo_check CHECK (saldo_consumido >= 0 AND saldo_consumido <= anticipo_consumible)
);

ALTER TABLE public.terraza_reservas ADD COLUMN IF NOT EXISTS caja_anticipo_id uuid;
ALTER TABLE public.terraza_reservas ADD COLUMN IF NOT EXISTS pedido_id uuid;
ALTER TABLE public.terraza_reservas ADD COLUMN IF NOT EXISTS cancelado_por_usuario_id uuid;
ALTER TABLE public.terraza_reservas ADD COLUMN IF NOT EXISTS fecha_cancelacion timestamp with time zone;

ALTER TABLE public.caja ADD COLUMN IF NOT EXISTS reserva_terraza_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'terraza_pedidos_reserva_terraza_id_fkey') THEN
    ALTER TABLE public.terraza_pedidos
      ADD CONSTRAINT terraza_pedidos_reserva_terraza_id_fkey
      FOREIGN KEY (reserva_terraza_id)
      REFERENCES public.terraza_reservas(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'terraza_reservas_caja_anticipo_id_fkey') THEN
    ALTER TABLE public.terraza_reservas
      ADD CONSTRAINT terraza_reservas_caja_anticipo_id_fkey
      FOREIGN KEY (caja_anticipo_id)
      REFERENCES public.caja(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'terraza_reservas_pedido_id_fkey') THEN
    ALTER TABLE public.terraza_reservas
      ADD CONSTRAINT terraza_reservas_pedido_id_fkey
      FOREIGN KEY (pedido_id)
      REFERENCES public.terraza_pedidos(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'caja_reserva_terraza_id_fkey') THEN
    ALTER TABLE public.caja
      ADD CONSTRAINT caja_reserva_terraza_id_fkey
      FOREIGN KEY (reserva_terraza_id)
      REFERENCES public.terraza_reservas(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_terraza_reservas_hotel_fecha ON public.terraza_reservas(hotel_id, fecha_reserva);
CREATE INDEX IF NOT EXISTS idx_terraza_reservas_estado ON public.terraza_reservas(hotel_id, estado);
CREATE INDEX IF NOT EXISTS idx_terraza_reservas_mesa_estado ON public.terraza_reservas(hotel_id, mesa_id, COALESCE(silla_numero, 0), estado);

DROP TRIGGER IF EXISTS set_timestamp_terraza_reservas ON public.terraza_reservas;
CREATE TRIGGER set_timestamp_terraza_reservas
  BEFORE UPDATE ON public.terraza_reservas
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp_actualizado_en();

ALTER TABLE public.terraza_reservas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "TerrazaReservas_hotel" ON public.terraza_reservas;
CREATE POLICY "TerrazaReservas_hotel" ON public.terraza_reservas
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((hotel_id = public.get_current_user_hotel_id()) AND (hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid))
  WITH CHECK ((hotel_id = public.get_current_user_hotel_id()) AND (hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid));

CREATE OR REPLACE FUNCTION public.crear_reserva_terraza(
  p_hotel_id uuid,
  p_mesa_id uuid,
  p_silla_numero integer,
  p_cliente_nombre text,
  p_cliente_telefono text,
  p_fecha_reserva timestamp with time zone,
  p_cantidad_personas integer,
  p_anticipo_consumible numeric,
  p_metodo_pago_id uuid,
  p_usuario_id uuid,
  p_turno_id uuid,
  p_notas text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_turno public.turnos%rowtype;
  v_mesa public.terraza_mesas%rowtype;
  v_reserva_id uuid;
  v_caja_id uuid;
  v_anticipo numeric(12,2) := round(GREATEST(COALESCE(p_anticipo_consumible, 0), 0), 2);
  v_cliente text := btrim(COALESCE(p_cliente_nombre, ''));
  v_hotel_terraza constant uuid := '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para crear reservas de terraza.';
  END IF;

  IF p_hotel_id <> v_hotel_terraza THEN
    RAISE EXCEPTION 'El modulo Terraza no esta habilitado para este hotel.';
  END IF;

  IF v_cliente = '' THEN
    RAISE EXCEPTION 'El nombre del cliente es obligatorio.';
  END IF;

  IF p_fecha_reserva IS NULL THEN
    RAISE EXCEPTION 'La fecha de reserva es obligatoria.';
  END IF;

  IF COALESCE(p_cantidad_personas, 0) <= 0 THEN
    RAISE EXCEPTION 'La cantidad de personas debe ser mayor a cero.';
  END IF;

  SELECT * INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro perfil de usuario.';
  END IF;

  IF COALESCE(v_actor.rol::text, '') <> 'superadmin' AND v_actor.hotel_id IS DISTINCT FROM p_hotel_id THEN
    RAISE EXCEPTION 'No puedes crear reservas de otro hotel.';
  END IF;

  IF COALESCE(v_actor.rol::text, '') <> 'superadmin' AND p_usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No puedes crear reservas a nombre de otro usuario.';
  END IF;

  SELECT * INTO v_mesa
    FROM public.terraza_mesas
   WHERE id = p_mesa_id
     AND hotel_id = p_hotel_id
     AND activo = true
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mesa de terraza no encontrada.';
  END IF;

  IF p_silla_numero IS NOT NULL AND p_silla_numero > v_mesa.sillas THEN
    RAISE EXCEPTION 'La mesa seleccionada solo tiene % puesto(s).', v_mesa.sillas;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.terraza_reservas r
     WHERE r.hotel_id = p_hotel_id
       AND r.mesa_id = p_mesa_id
       AND COALESCE(r.silla_numero, 0) = COALESCE(p_silla_numero, 0)
       AND r.estado IN ('reservada', 'en_curso')
       AND abs(extract(epoch FROM (r.fecha_reserva - p_fecha_reserva))) < 7200
  ) THEN
    RAISE EXCEPTION 'Ya existe una reserva activa para esta ubicacion en una franja cercana.';
  END IF;

  IF v_anticipo > 0 THEN
    IF p_metodo_pago_id IS NULL THEN
      RAISE EXCEPTION 'Selecciona metodo de pago para el anticipo.';
    END IF;

    SELECT * INTO v_turno
      FROM public.turnos
     WHERE id = p_turno_id
       AND hotel_id = p_hotel_id
       AND usuario_id = p_usuario_id
       AND estado = 'abierto'
     LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No hay un turno de caja abierto para registrar el anticipo.';
    END IF;
  END IF;

  INSERT INTO public.terraza_reservas (
    hotel_id,
    mesa_id,
    silla_numero,
    cliente_nombre,
    cliente_telefono,
    fecha_reserva,
    cantidad_personas,
    anticipo_consumible,
    metodo_pago_id,
    usuario_id,
    notas
  ) VALUES (
    p_hotel_id,
    p_mesa_id,
    p_silla_numero,
    v_cliente,
    NULLIF(btrim(COALESCE(p_cliente_telefono, '')), ''),
    p_fecha_reserva,
    p_cantidad_personas,
    v_anticipo,
    p_metodo_pago_id,
    p_usuario_id,
    NULLIF(btrim(COALESCE(p_notas, '')), '')
  )
  RETURNING id INTO v_reserva_id;

  IF v_anticipo > 0 THEN
    INSERT INTO public.caja (
      hotel_id,
      usuario_id,
      turno_id,
      tipo,
      monto,
      metodo_pago_id,
      concepto,
      reserva_terraza_id
    ) VALUES (
      p_hotel_id,
      p_usuario_id,
      p_turno_id,
      'ingreso',
      v_anticipo,
      p_metodo_pago_id,
      left('Anticipo consumible Terraza - ' || v_mesa.nombre || ' - ' || v_cliente, 250),
      v_reserva_id
    )
    RETURNING id INTO v_caja_id;

    UPDATE public.terraza_reservas
       SET caja_anticipo_id = v_caja_id,
           actualizado_en = now()
     WHERE id = v_reserva_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reserva_id', v_reserva_id,
    'caja_id', v_caja_id,
    'anticipo_consumible', v_anticipo
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.activar_reserva_terraza(
  p_reserva_id uuid,
  p_usuario_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_reserva public.terraza_reservas%rowtype;
  v_pedido_id uuid;
  v_hotel_terraza constant uuid := '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para activar reservas de terraza.';
  END IF;

  SELECT * INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro perfil de usuario.';
  END IF;

  SELECT * INTO v_reserva
    FROM public.terraza_reservas
   WHERE id = p_reserva_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva de terraza no encontrada.';
  END IF;

  IF v_reserva.hotel_id <> v_hotel_terraza THEN
    RAISE EXCEPTION 'El modulo Terraza no esta habilitado para este hotel.';
  END IF;

  IF COALESCE(v_actor.rol::text, '') <> 'superadmin' AND v_actor.hotel_id IS DISTINCT FROM v_reserva.hotel_id THEN
    RAISE EXCEPTION 'No puedes activar reservas de otro hotel.';
  END IF;

  IF COALESCE(v_actor.rol::text, '') <> 'superadmin' AND p_usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No puedes activar reservas a nombre de otro usuario.';
  END IF;

  IF v_reserva.estado = 'en_curso' AND v_reserva.pedido_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'pedido_id', v_reserva.pedido_id,
      'mesa_id', v_reserva.mesa_id,
      'silla_numero', v_reserva.silla_numero
    );
  END IF;

  IF v_reserva.estado <> 'reservada' THEN
    RAISE EXCEPTION 'Esta reserva no esta disponible para activar.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.terraza_pedidos p
     WHERE p.hotel_id = v_reserva.hotel_id
       AND p.mesa_id = v_reserva.mesa_id
       AND COALESCE(p.silla_numero, 0) = COALESCE(v_reserva.silla_numero, 0)
       AND p.estado = 'abierto'
  ) THEN
    RAISE EXCEPTION 'Ya existe una cuenta abierta en esta mesa o silla.';
  END IF;

  INSERT INTO public.terraza_pedidos (
    hotel_id,
    mesa_id,
    silla_numero,
    usuario_id,
    estado,
    cliente_nombre,
    notas,
    reserva_terraza_id
  ) VALUES (
    v_reserva.hotel_id,
    v_reserva.mesa_id,
    v_reserva.silla_numero,
    p_usuario_id,
    'abierto',
    v_reserva.cliente_nombre,
    trim(both from COALESCE(v_reserva.notas || E'\n', '') || 'Reserva de terraza con anticipo consumible: ' || v_reserva.anticipo_consumible::text),
    v_reserva.id
  )
  RETURNING id INTO v_pedido_id;

  UPDATE public.terraza_reservas
     SET estado = 'en_curso',
         pedido_id = v_pedido_id,
         saldo_consumido = 0,
         actualizado_en = now()
   WHERE id = v_reserva.id;

  RETURN jsonb_build_object(
    'success', true,
    'pedido_id', v_pedido_id,
    'mesa_id', v_reserva.mesa_id,
    'silla_numero', v_reserva.silla_numero
  );
END;
$function$;

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
  v_reserva public.terraza_reservas%rowtype;
  v_actor public.usuarios%rowtype;
  v_turno public.turnos%rowtype;
  v_total numeric(12,2);
  v_propina_monto numeric(12,2) := round(GREATEST(COALESCE(p_propina_monto, 0), 0), 2);
  v_propina_sugerida numeric(12,2) := round(GREATEST(COALESCE(p_propina_sugerida_monto, 0), 0), 2);
  v_anticipo_aplicado numeric(12,2) := 0;
  v_consumo_a_cobrar numeric(12,2) := 0;
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

  IF v_pedido.reserva_terraza_id IS NOT NULL THEN
    SELECT * INTO v_reserva
      FROM public.terraza_reservas
     WHERE id = v_pedido.reserva_terraza_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se encontro la reserva asociada a esta cuenta.';
    END IF;

    v_anticipo_aplicado := LEAST(v_total, GREATEST(v_reserva.anticipo_consumible - v_reserva.saldo_consumido, 0));
  END IF;

  v_consumo_a_cobrar := GREATEST(v_total - v_anticipo_aplicado, 0);

  IF (v_consumo_a_cobrar + v_propina_monto) > 0 AND p_metodo_pago_id IS NULL THEN
    RAISE EXCEPTION 'Selecciona metodo de pago para el saldo pendiente.';
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
  IF v_anticipo_aplicado > 0 THEN
    v_concepto := v_concepto || ' | Anticipo aplicado ' || v_anticipo_aplicado::text;
  END IF;

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

  IF v_pedido.reserva_terraza_id IS NOT NULL THEN
    UPDATE public.terraza_reservas
       SET estado = 'completada',
           pedido_id = p_pedido_id,
           saldo_consumido = LEAST(anticipo_consumible, saldo_consumido + v_anticipo_aplicado),
           actualizado_en = now()
     WHERE id = v_pedido.reserva_terraza_id;
  END IF;

  IF v_consumo_a_cobrar > 0 THEN
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
      v_consumo_a_cobrar,
      p_metodo_pago_id,
      v_concepto,
      p_pedido_id
    )
    RETURNING id INTO v_caja_id;
  END IF;

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
    'anticipo_aplicado', v_anticipo_aplicado,
    'saldo_consumo_cobrado', v_consumo_a_cobrar,
    'propina_monto', v_propina_monto,
    'total_cobrado', v_consumo_a_cobrar + v_propina_monto
  );
END;
$function$;
