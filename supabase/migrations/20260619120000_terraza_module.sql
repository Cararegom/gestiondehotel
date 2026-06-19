-- Modulo Terraza habilitado solo para el hotel solicitado.
-- Hotel: 38373fa5-b953-4aa9-b4e9-25b9739be5f2

ALTER TYPE public.rol_usuario_enum ADD VALUE IF NOT EXISTS 'mesero';

CREATE TABLE IF NOT EXISTS public.terraza_mesas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  numero integer NOT NULL,
  nombre text NOT NULL,
  sillas integer DEFAULT 2 NOT NULL,
  tipo text DEFAULT 'mesa'::text NOT NULL,
  activo boolean DEFAULT true NOT NULL,
  creado_en timestamp with time zone DEFAULT now(),
  actualizado_en timestamp with time zone DEFAULT now(),
  CONSTRAINT terraza_mesas_pkey PRIMARY KEY (id),
  CONSTRAINT terraza_mesas_hotel_numero_key UNIQUE (hotel_id, numero),
  CONSTRAINT terraza_mesas_numero_check CHECK (numero > 0),
  CONSTRAINT terraza_mesas_sillas_check CHECK (sillas > 0),
  CONSTRAINT terraza_mesas_tipo_check CHECK (tipo IN ('mesa', 'sillas_sueltas'))
);

ALTER TABLE public.terraza_mesas ADD COLUMN IF NOT EXISTS tipo text DEFAULT 'mesa'::text NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'terraza_mesas_tipo_check') THEN
    ALTER TABLE public.terraza_mesas ADD CONSTRAINT terraza_mesas_tipo_check CHECK (tipo IN ('mesa', 'sillas_sueltas'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.terraza_productos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  descripcion text,
  categoria text DEFAULT 'Bebidas'::text NOT NULL,
  precio numeric(12,2) NOT NULL,
  stock_actual integer DEFAULT 0 NOT NULL,
  stock_minimo integer DEFAULT 0 NOT NULL,
  codigo_barras text,
  imagen_url text,
  tienda_producto_id uuid REFERENCES public.productos_tienda(id) ON DELETE SET NULL,
  activo boolean DEFAULT true NOT NULL,
  creado_en timestamp with time zone DEFAULT now(),
  actualizado_en timestamp with time zone DEFAULT now(),
  CONSTRAINT terraza_productos_pkey PRIMARY KEY (id),
  CONSTRAINT terraza_productos_hotel_nombre_key UNIQUE (hotel_id, nombre),
  CONSTRAINT terraza_productos_precio_check CHECK (precio >= 0),
  CONSTRAINT terraza_productos_stock_actual_check CHECK (stock_actual >= 0),
  CONSTRAINT terraza_productos_stock_minimo_check CHECK (stock_minimo >= 0)
);

ALTER TABLE public.terraza_productos ADD COLUMN IF NOT EXISTS stock_actual integer DEFAULT 0 NOT NULL;
ALTER TABLE public.terraza_productos ADD COLUMN IF NOT EXISTS stock_minimo integer DEFAULT 0 NOT NULL;
ALTER TABLE public.terraza_productos ADD COLUMN IF NOT EXISTS codigo_barras text;
ALTER TABLE public.terraza_productos ADD COLUMN IF NOT EXISTS imagen_url text;
ALTER TABLE public.terraza_productos ADD COLUMN IF NOT EXISTS tienda_producto_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'terraza_productos_stock_actual_check') THEN
    ALTER TABLE public.terraza_productos ADD CONSTRAINT terraza_productos_stock_actual_check CHECK (stock_actual >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'terraza_productos_stock_minimo_check') THEN
    ALTER TABLE public.terraza_productos ADD CONSTRAINT terraza_productos_stock_minimo_check CHECK (stock_minimo >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'terraza_productos_tienda_producto_id_fkey') THEN
    ALTER TABLE public.terraza_productos
      ADD CONSTRAINT terraza_productos_tienda_producto_id_fkey
      FOREIGN KEY (tienda_producto_id)
      REFERENCES public.productos_tienda(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.terraza_pedidos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  mesa_id uuid NOT NULL REFERENCES public.terraza_mesas(id) ON DELETE RESTRICT,
  silla_numero integer,
  usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  estado text DEFAULT 'abierto'::text NOT NULL,
  cliente_nombre text,
  notas text,
  total numeric(12,2) DEFAULT 0 NOT NULL,
  metodo_pago_id uuid REFERENCES public.metodos_pago(id) ON DELETE SET NULL,
  turno_id uuid REFERENCES public.turnos(id) ON DELETE SET NULL,
  fecha_apertura timestamp with time zone DEFAULT now(),
  fecha_cierre timestamp with time zone,
  creado_en timestamp with time zone DEFAULT now(),
  actualizado_en timestamp with time zone DEFAULT now(),
  CONSTRAINT terraza_pedidos_pkey PRIMARY KEY (id),
  CONSTRAINT terraza_pedidos_estado_check CHECK (estado IN ('abierto', 'pagado', 'cancelado')),
  CONSTRAINT terraza_pedidos_silla_check CHECK (silla_numero IS NULL OR silla_numero > 0)
);

CREATE TABLE IF NOT EXISTS public.terraza_pedido_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  pedido_id uuid NOT NULL REFERENCES public.terraza_pedidos(id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  producto_id uuid REFERENCES public.terraza_productos(id) ON DELETE SET NULL,
  producto_nombre text NOT NULL,
  cantidad integer NOT NULL,
  precio_unitario numeric(12,2) NOT NULL,
  subtotal numeric(12,2) NOT NULL,
  notas text,
  creado_en timestamp with time zone DEFAULT now(),
  actualizado_en timestamp with time zone DEFAULT now(),
  CONSTRAINT terraza_pedido_items_pkey PRIMARY KEY (id),
  CONSTRAINT terraza_pedido_items_cantidad_check CHECK (cantidad > 0),
  CONSTRAINT terraza_pedido_items_precio_check CHECK (precio_unitario >= 0),
  CONSTRAINT terraza_pedido_items_subtotal_check CHECK (subtotal >= 0)
);

CREATE INDEX IF NOT EXISTS idx_terraza_mesas_hotel ON public.terraza_mesas(hotel_id);
CREATE INDEX IF NOT EXISTS idx_terraza_productos_hotel ON public.terraza_productos(hotel_id, activo);
CREATE UNIQUE INDEX IF NOT EXISTS idx_terraza_productos_hotel_codigo_barras
  ON public.terraza_productos(hotel_id, codigo_barras)
  WHERE codigo_barras IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_terraza_pedidos_hotel_estado ON public.terraza_pedidos(hotel_id, estado);
CREATE INDEX IF NOT EXISTS idx_terraza_items_pedido ON public.terraza_pedido_items(pedido_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_terraza_pedido_abierto_mesa_silla
  ON public.terraza_pedidos (hotel_id, mesa_id, COALESCE(silla_numero, 0))
  WHERE estado = 'abierto';

DROP TRIGGER IF EXISTS set_timestamp_terraza_mesas ON public.terraza_mesas;
CREATE TRIGGER set_timestamp_terraza_mesas
  BEFORE UPDATE ON public.terraza_mesas
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp_actualizado_en();

DROP TRIGGER IF EXISTS set_timestamp_terraza_productos ON public.terraza_productos;
CREATE TRIGGER set_timestamp_terraza_productos
  BEFORE UPDATE ON public.terraza_productos
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp_actualizado_en();

DROP TRIGGER IF EXISTS set_timestamp_terraza_pedidos ON public.terraza_pedidos;
CREATE TRIGGER set_timestamp_terraza_pedidos
  BEFORE UPDATE ON public.terraza_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp_actualizado_en();

DROP TRIGGER IF EXISTS set_timestamp_terraza_pedido_items ON public.terraza_pedido_items;
CREATE TRIGGER set_timestamp_terraza_pedido_items
  BEFORE UPDATE ON public.terraza_pedido_items
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp_actualizado_en();

CREATE OR REPLACE FUNCTION public.recalcular_total_pedido_terraza()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido_id uuid;
BEGIN
  v_pedido_id := COALESCE(NEW.pedido_id, OLD.pedido_id);

  UPDATE public.terraza_pedidos
     SET total = (
       SELECT COALESCE(SUM(subtotal), 0)
         FROM public.terraza_pedido_items
        WHERE pedido_id = v_pedido_id
     ),
         actualizado_en = now()
   WHERE id = v_pedido_id;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS recalcular_total_pedido_terraza_ins ON public.terraza_pedido_items;
CREATE TRIGGER recalcular_total_pedido_terraza_ins
  AFTER INSERT ON public.terraza_pedido_items
  FOR EACH ROW EXECUTE FUNCTION public.recalcular_total_pedido_terraza();

DROP TRIGGER IF EXISTS recalcular_total_pedido_terraza_upd ON public.terraza_pedido_items;
CREATE TRIGGER recalcular_total_pedido_terraza_upd
  AFTER UPDATE ON public.terraza_pedido_items
  FOR EACH ROW EXECUTE FUNCTION public.recalcular_total_pedido_terraza();

DROP TRIGGER IF EXISTS recalcular_total_pedido_terraza_del ON public.terraza_pedido_items;
CREATE TRIGGER recalcular_total_pedido_terraza_del
  AFTER DELETE ON public.terraza_pedido_items
  FOR EACH ROW EXECUTE FUNCTION public.recalcular_total_pedido_terraza();

ALTER TABLE public.caja ADD COLUMN IF NOT EXISTS venta_terraza_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'caja_venta_terraza_id_fkey'
  ) THEN
    ALTER TABLE public.caja
      ADD CONSTRAINT caja_venta_terraza_id_fkey
      FOREIGN KEY (venta_terraza_id)
      REFERENCES public.terraza_pedidos(id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.terraza_mesas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terraza_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terraza_pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terraza_pedido_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "TerrazaMesas_hotel" ON public.terraza_mesas;
CREATE POLICY "TerrazaMesas_hotel" ON public.terraza_mesas
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((hotel_id = public.get_current_user_hotel_id()) AND (hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid))
  WITH CHECK ((hotel_id = public.get_current_user_hotel_id()) AND (hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid));

DROP POLICY IF EXISTS "TerrazaProductos_hotel" ON public.terraza_productos;
CREATE POLICY "TerrazaProductos_hotel" ON public.terraza_productos
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((hotel_id = public.get_current_user_hotel_id()) AND (hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid))
  WITH CHECK ((hotel_id = public.get_current_user_hotel_id()) AND (hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid));

DROP POLICY IF EXISTS "TerrazaPedidos_hotel" ON public.terraza_pedidos;
CREATE POLICY "TerrazaPedidos_hotel" ON public.terraza_pedidos
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((hotel_id = public.get_current_user_hotel_id()) AND (hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid))
  WITH CHECK ((hotel_id = public.get_current_user_hotel_id()) AND (hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid));

DROP POLICY IF EXISTS "TerrazaPedidoItems_hotel" ON public.terraza_pedido_items;
CREATE POLICY "TerrazaPedidoItems_hotel" ON public.terraza_pedido_items
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((hotel_id = public.get_current_user_hotel_id()) AND (hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid))
  WITH CHECK ((hotel_id = public.get_current_user_hotel_id()) AND (hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid));

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

  v_concepto := CASE
    WHEN v_pedido.mesa_tipo = 'sillas_sueltas' THEN 'Terraza Silla suelta ' || v_pedido.silla_numero
    ELSE 'Terraza Mesa ' || v_pedido.mesa_numero ||
      CASE
        WHEN v_pedido.silla_numero IS NULL THEN ''
        ELSE ' Silla ' || v_pedido.silla_numero
      END
    END;

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

CREATE OR REPLACE FUNCTION public.transferir_tienda_a_terraza(
  p_producto_tienda_id uuid,
  p_cantidad integer,
  p_usuario_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_tienda record;
  v_terraza public.terraza_productos%rowtype;
  v_terraza_id uuid;
  v_hotel_terraza constant uuid := '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para transferir inventario.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a cero.';
  END IF;

  SELECT * INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro perfil de usuario.';
  END IF;

  IF COALESCE(v_actor.rol::text, '') <> 'superadmin' AND p_usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No puedes transferir inventario a nombre de otro usuario.';
  END IF;

  SELECT p.*, c.nombre AS categoria_nombre
    INTO v_tienda
    FROM public.productos_tienda p
    LEFT JOIN public.categorias_producto c ON c.id = p.categoria_id
   WHERE p.id = p_producto_tienda_id
   FOR UPDATE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto de tienda no encontrado.';
  END IF;

  IF v_tienda.hotel_id <> v_hotel_terraza THEN
    RAISE EXCEPTION 'Terraza no esta habilitada para este hotel.';
  END IF;

  IF COALESCE(v_actor.rol::text, '') <> 'superadmin' AND v_actor.hotel_id IS DISTINCT FROM v_tienda.hotel_id THEN
    RAISE EXCEPTION 'No puedes mover inventario de otro hotel.';
  END IF;

  IF COALESCE(v_tienda.stock_actual, 0) < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente en Tienda para %. Disponible: %, requerido: %',
      v_tienda.nombre,
      COALESCE(v_tienda.stock_actual, 0),
      p_cantidad;
  END IF;

  SELECT *
    INTO v_terraza
    FROM public.terraza_productos
   WHERE hotel_id = v_tienda.hotel_id
     AND (
       tienda_producto_id = p_producto_tienda_id
       OR lower(nombre) = lower(v_tienda.nombre)
       OR (codigo_barras IS NOT NULL AND codigo_barras = v_tienda.codigo_barras)
     )
   LIMIT 1
   FOR UPDATE;

  UPDATE public.productos_tienda
     SET stock_actual = stock_actual - p_cantidad,
         actualizado_en = now()
   WHERE id = p_producto_tienda_id;

  IF v_terraza.id IS NOT NULL THEN
    UPDATE public.terraza_productos
       SET stock_actual = stock_actual + p_cantidad,
           precio = CASE WHEN precio <= 0 THEN COALESCE(v_tienda.precio_venta, v_tienda.precio, 0) ELSE precio END,
           categoria = COALESCE(NULLIF(categoria, ''), v_tienda.categoria_nombre, 'Bebidas'),
           codigo_barras = COALESCE(codigo_barras, v_tienda.codigo_barras),
           imagen_url = COALESCE(imagen_url, v_tienda.imagen_url),
           tienda_producto_id = p_producto_tienda_id,
           actualizado_en = now()
     WHERE id = v_terraza.id
     RETURNING id INTO v_terraza_id;
  ELSE
    INSERT INTO public.terraza_productos (
      hotel_id,
      nombre,
      descripcion,
      categoria,
      precio,
      stock_actual,
      stock_minimo,
      codigo_barras,
      imagen_url,
      tienda_producto_id,
      activo
    ) VALUES (
      v_tienda.hotel_id,
      v_tienda.nombre,
      v_tienda.descripcion,
      COALESCE(v_tienda.categoria_nombre, 'Bebidas'),
      COALESCE(v_tienda.precio_venta, v_tienda.precio, 0),
      p_cantidad,
      COALESCE(v_tienda.stock_minimo, 0),
      v_tienda.codigo_barras,
      v_tienda.imagen_url,
      p_producto_tienda_id,
      true
    )
    RETURNING id INTO v_terraza_id;
  END IF;

  INSERT INTO public.bitacora (hotel_id, usuario_id, modulo, accion, detalles)
  VALUES (
    v_tienda.hotel_id,
    p_usuario_id,
    'Terraza',
    'Transferencia Tienda a Terraza',
    jsonb_build_object(
      'producto_tienda_id', p_producto_tienda_id,
      'producto_terraza_id', v_terraza_id,
      'cantidad', p_cantidad
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'producto_tienda_id', p_producto_tienda_id,
    'producto_terraza_id', v_terraza_id,
    'cantidad', p_cantidad
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.transferir_terraza_a_tienda(
  p_producto_terraza_id uuid,
  p_cantidad integer,
  p_usuario_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_terraza public.terraza_productos%rowtype;
  v_tienda public.productos_tienda%rowtype;
  v_tienda_id uuid;
  v_reservado integer := 0;
  v_disponible integer := 0;
  v_hotel_terraza constant uuid := '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para transferir inventario.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a cero.';
  END IF;

  SELECT * INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro perfil de usuario.';
  END IF;

  IF COALESCE(v_actor.rol::text, '') <> 'superadmin' AND p_usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No puedes transferir inventario a nombre de otro usuario.';
  END IF;

  SELECT *
    INTO v_terraza
    FROM public.terraza_productos
   WHERE id = p_producto_terraza_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto de terraza no encontrado.';
  END IF;

  IF v_terraza.hotel_id <> v_hotel_terraza THEN
    RAISE EXCEPTION 'Terraza no esta habilitada para este hotel.';
  END IF;

  IF COALESCE(v_actor.rol::text, '') <> 'superadmin' AND v_actor.hotel_id IS DISTINCT FROM v_terraza.hotel_id THEN
    RAISE EXCEPTION 'No puedes mover inventario de otro hotel.';
  END IF;

  SELECT COALESCE(SUM(i.cantidad), 0)::integer
    INTO v_reservado
    FROM public.terraza_pedido_items i
    JOIN public.terraza_pedidos p ON p.id = i.pedido_id
   WHERE i.producto_id = p_producto_terraza_id
     AND p.estado = 'abierto';

  v_disponible := COALESCE(v_terraza.stock_actual, 0) - COALESCE(v_reservado, 0);

  IF v_disponible < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente en Terraza para %. Disponible: %, requerido: %',
      v_terraza.nombre,
      v_disponible,
      p_cantidad;
  END IF;

  SELECT *
    INTO v_tienda
    FROM public.productos_tienda
   WHERE hotel_id = v_terraza.hotel_id
     AND (
       id = v_terraza.tienda_producto_id
       OR lower(nombre) = lower(v_terraza.nombre)
       OR (codigo_barras IS NOT NULL AND codigo_barras = v_terraza.codigo_barras)
     )
   LIMIT 1
   FOR UPDATE;

  IF FOUND AND v_tienda.id IS NOT NULL THEN
    v_tienda_id := v_tienda.id;
  ELSE
    INSERT INTO public.productos_tienda (
      hotel_id,
      nombre,
      descripcion,
      precio,
      precio_venta,
      stock,
      stock_actual,
      stock_minimo,
      codigo_barras,
      imagen_url,
      activo
    ) VALUES (
      v_terraza.hotel_id,
      v_terraza.nombre,
      v_terraza.descripcion,
      COALESCE(v_terraza.precio, 0),
      COALESCE(v_terraza.precio, 0),
      0,
      0,
      COALESCE(v_terraza.stock_minimo, 0),
      v_terraza.codigo_barras,
      v_terraza.imagen_url,
      true
    )
    RETURNING id INTO v_tienda_id;
  END IF;

  UPDATE public.terraza_productos
     SET stock_actual = stock_actual - p_cantidad,
         tienda_producto_id = COALESCE(tienda_producto_id, v_tienda_id),
         actualizado_en = now()
   WHERE id = p_producto_terraza_id;

  UPDATE public.productos_tienda
     SET stock_actual = stock_actual + p_cantidad,
         actualizado_en = now()
   WHERE id = v_tienda_id;

  INSERT INTO public.bitacora (hotel_id, usuario_id, modulo, accion, detalles)
  VALUES (
    v_terraza.hotel_id,
    p_usuario_id,
    'Terraza',
    'Transferencia Terraza a Tienda',
    jsonb_build_object(
      'producto_terraza_id', p_producto_terraza_id,
      'producto_tienda_id', v_tienda_id,
      'cantidad', p_cantidad
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'producto_terraza_id', p_producto_terraza_id,
    'producto_tienda_id', v_tienda_id,
    'cantidad', p_cantidad
  );
END;
$function$;

INSERT INTO public.roles (nombre, descripcion)
VALUES ('Mesero/a', 'Atiende pedidos y cobros de la terraza.')
ON CONFLICT (nombre) DO UPDATE
  SET descripcion = EXCLUDED.descripcion;

INSERT INTO public.permisos (nombre, descripcion)
SELECT nombre, descripcion
FROM (VALUES
  ('terraza.ver', 'Ver el modulo Terraza.'),
  ('terraza.pedidos', 'Crear y editar pedidos de terraza.'),
  ('terraza.cobrar', 'Cobrar pedidos de terraza.')
) AS permisos_seed(nombre, descripcion)
WHERE NOT EXISTS (
  SELECT 1
    FROM public.permisos p
   WHERE p.nombre = permisos_seed.nombre
);

DO $$
DECLARE
  v_rol_id uuid;
  v_permiso_id uuid;
BEGIN
  SELECT id INTO v_rol_id
    FROM public.roles
   WHERE nombre = 'Mesero/a'
   LIMIT 1;

  FOR v_permiso_id IN
    SELECT id
      FROM public.permisos
     WHERE nombre IN ('terraza.ver', 'terraza.pedidos', 'terraza.cobrar')
  LOOP
    INSERT INTO public.roles_permisos (rol_id, permiso_id)
    SELECT v_rol_id, v_permiso_id
    WHERE NOT EXISTS (
      SELECT 1
        FROM public.roles_permisos
       WHERE rol_id = v_rol_id
         AND permiso_id = v_permiso_id
    );
  END LOOP;
END $$;

INSERT INTO public.terraza_mesas (hotel_id, numero, nombre, sillas, tipo)
SELECT '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid, numero, 'Mesa ' || numero, 2, 'mesa'
FROM generate_series(1, 5) AS numero
ON CONFLICT (hotel_id, numero) DO UPDATE
  SET nombre = EXCLUDED.nombre,
      sillas = EXCLUDED.sillas,
      tipo = EXCLUDED.tipo,
      activo = true;

INSERT INTO public.terraza_mesas (hotel_id, numero, nombre, sillas, tipo)
VALUES ('38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid, 99, 'Sillas sueltas', 12, 'sillas_sueltas')
ON CONFLICT (hotel_id, numero) DO UPDATE
  SET nombre = EXCLUDED.nombre,
      sillas = EXCLUDED.sillas,
      tipo = EXCLUDED.tipo,
      activo = true;

INSERT INTO public.terraza_productos (hotel_id, nombre, categoria, precio, descripcion)
VALUES
  ('38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid, 'Cerveza nacional', 'Cervezas', 0, 'Configura el precio antes de vender.'),
  ('38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid, 'Cerveza importada', 'Cervezas', 0, 'Configura el precio antes de vender.'),
  ('38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid, 'Michelada', 'Micheladas', 0, 'Configura el precio antes de vender.'),
  ('38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid, 'Ron', 'Tragos', 0, 'Configura el precio antes de vender.'),
  ('38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid, 'Whisky', 'Tragos', 0, 'Configura el precio antes de vender.'),
  ('38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid, 'Coctel de la casa', 'Cocteles', 0, 'Configura el precio antes de vender.')
ON CONFLICT (hotel_id, nombre) DO NOTHING;
