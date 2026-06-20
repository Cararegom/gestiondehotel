-- Configuracion de Terraza: micheladas, propina sugerida y PDF.
-- Tambien marca cada item vendido como cerveza normal o michelada.

CREATE TABLE IF NOT EXISTS public.terraza_configuracion (
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  precio_michelada numeric(12,2) DEFAULT 0 NOT NULL,
  propina_sugerida_porcentaje numeric(5,2) DEFAULT 10 NOT NULL,
  permitir_descarga_pdf boolean DEFAULT true NOT NULL,
  creado_en timestamp with time zone DEFAULT now(),
  actualizado_en timestamp with time zone DEFAULT now(),
  CONSTRAINT terraza_configuracion_pkey PRIMARY KEY (hotel_id),
  CONSTRAINT terraza_configuracion_precio_michelada_check CHECK (precio_michelada >= 0),
  CONSTRAINT terraza_configuracion_propina_check CHECK (propina_sugerida_porcentaje >= 0 AND propina_sugerida_porcentaje <= 100)
);

ALTER TABLE public.terraza_configuracion ADD COLUMN IF NOT EXISTS precio_michelada numeric(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.terraza_configuracion ADD COLUMN IF NOT EXISTS propina_sugerida_porcentaje numeric(5,2) DEFAULT 10 NOT NULL;
ALTER TABLE public.terraza_configuracion ADD COLUMN IF NOT EXISTS permitir_descarga_pdf boolean DEFAULT true NOT NULL;
ALTER TABLE public.terraza_configuracion ADD COLUMN IF NOT EXISTS creado_en timestamp with time zone DEFAULT now();
ALTER TABLE public.terraza_configuracion ADD COLUMN IF NOT EXISTS actualizado_en timestamp with time zone DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'terraza_configuracion_precio_michelada_check') THEN
    ALTER TABLE public.terraza_configuracion
      ADD CONSTRAINT terraza_configuracion_precio_michelada_check CHECK (precio_michelada >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'terraza_configuracion_propina_check') THEN
    ALTER TABLE public.terraza_configuracion
      ADD CONSTRAINT terraza_configuracion_propina_check CHECK (propina_sugerida_porcentaje >= 0 AND propina_sugerida_porcentaje <= 100);
  END IF;
END $$;

DROP TRIGGER IF EXISTS set_timestamp_terraza_configuracion ON public.terraza_configuracion;
CREATE TRIGGER set_timestamp_terraza_configuracion
  BEFORE UPDATE ON public.terraza_configuracion
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp_actualizado_en();

ALTER TABLE public.terraza_configuracion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "TerrazaConfiguracion_hotel" ON public.terraza_configuracion;
CREATE POLICY "TerrazaConfiguracion_hotel" ON public.terraza_configuracion
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((hotel_id = public.get_current_user_hotel_id()) AND (hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid))
  WITH CHECK ((hotel_id = public.get_current_user_hotel_id()) AND (hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid));

INSERT INTO public.terraza_configuracion (
  hotel_id,
  precio_michelada,
  propina_sugerida_porcentaje,
  permitir_descarga_pdf
) VALUES (
  '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid,
  0,
  10,
  true
)
ON CONFLICT (hotel_id) DO NOTHING;

ALTER TABLE public.terraza_pedido_items ADD COLUMN IF NOT EXISTS precio_base numeric(12,2);
ALTER TABLE public.terraza_pedido_items ADD COLUMN IF NOT EXISTS precio_michelada numeric(12,2) DEFAULT 0;
ALTER TABLE public.terraza_pedido_items ADD COLUMN IF NOT EXISTS es_michelada boolean DEFAULT false;

UPDATE public.terraza_pedido_items
   SET precio_base = COALESCE(precio_base, precio_unitario, 0),
       precio_michelada = COALESCE(precio_michelada, 0),
       es_michelada = COALESCE(es_michelada, false);

ALTER TABLE public.terraza_pedido_items ALTER COLUMN precio_base SET DEFAULT 0;
ALTER TABLE public.terraza_pedido_items ALTER COLUMN precio_base SET NOT NULL;
ALTER TABLE public.terraza_pedido_items ALTER COLUMN precio_michelada SET DEFAULT 0;
ALTER TABLE public.terraza_pedido_items ALTER COLUMN precio_michelada SET NOT NULL;
ALTER TABLE public.terraza_pedido_items ALTER COLUMN es_michelada SET DEFAULT false;
ALTER TABLE public.terraza_pedido_items ALTER COLUMN es_michelada SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'terraza_pedido_items_precio_base_check') THEN
    ALTER TABLE public.terraza_pedido_items
      ADD CONSTRAINT terraza_pedido_items_precio_base_check CHECK (precio_base >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'terraza_pedido_items_precio_michelada_check') THEN
    ALTER TABLE public.terraza_pedido_items
      ADD CONSTRAINT terraza_pedido_items_precio_michelada_check CHECK (precio_michelada >= 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cerrar_pedido_terraza(
  p_pedido_id uuid,
  p_metodo_pago_id uuid,
  p_usuario_id uuid,
  p_turno_id uuid
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
  v_caja_id uuid;
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

  RETURN jsonb_build_object(
    'success', true,
    'pedido_id', p_pedido_id,
    'caja_id', v_caja_id,
    'total', v_total
  );
END;
$function$;
