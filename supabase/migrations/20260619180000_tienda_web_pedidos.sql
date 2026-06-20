ALTER TABLE public.configuracion_hotel
  ADD COLUMN IF NOT EXISTS tienda_whatsapp_numero text,
  ADD COLUMN IF NOT EXISTS tienda_web_activa boolean DEFAULT true NOT NULL;

CREATE TABLE IF NOT EXISTS public.tienda_pedidos_web (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  habitacion_nombre text NOT NULL,
  habitacion_id uuid REFERENCES public.habitaciones(id) ON DELETE SET NULL,
  cliente_nombre text,
  telefono_cliente text,
  observaciones text,
  estado text DEFAULT 'pendiente'::text NOT NULL,
  total numeric(12,2) DEFAULT 0 NOT NULL,
  whatsapp_numero text,
  whatsapp_mensaje text,
  notas_internas text,
  venta_tienda_id uuid REFERENCES public.ventas_tienda(id) ON DELETE SET NULL,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
  aceptado_en timestamp with time zone,
  rechazado_en timestamp with time zone,
  entregado_en timestamp with time zone,
  gestionado_por_usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  CONSTRAINT tienda_pedidos_web_pkey PRIMARY KEY (id),
  CONSTRAINT tienda_pedidos_web_estado_check CHECK (estado IN ('pendiente', 'aceptado', 'preparando', 'entregado', 'rechazado', 'cancelado')),
  CONSTRAINT tienda_pedidos_web_total_check CHECK (total >= 0)
);

CREATE TABLE IF NOT EXISTS public.tienda_pedido_web_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  pedido_id uuid NOT NULL REFERENCES public.tienda_pedidos_web(id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  producto_id uuid REFERENCES public.productos_tienda(id) ON DELETE SET NULL,
  producto_nombre text NOT NULL,
  cantidad integer NOT NULL,
  precio_unitario numeric(12,2) NOT NULL,
  subtotal numeric(12,2) NOT NULL,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT tienda_pedido_web_items_pkey PRIMARY KEY (id),
  CONSTRAINT tienda_pedido_web_items_cantidad_check CHECK (cantidad > 0),
  CONSTRAINT tienda_pedido_web_items_precio_check CHECK (precio_unitario >= 0),
  CONSTRAINT tienda_pedido_web_items_subtotal_check CHECK (subtotal >= 0)
);

CREATE INDEX IF NOT EXISTS idx_tienda_pedidos_web_hotel_estado
  ON public.tienda_pedidos_web(hotel_id, estado, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_tienda_pedido_web_items_pedido
  ON public.tienda_pedido_web_items(pedido_id);

DROP TRIGGER IF EXISTS set_timestamp_tienda_pedidos_web ON public.tienda_pedidos_web;
CREATE TRIGGER set_timestamp_tienda_pedidos_web
  BEFORE UPDATE ON public.tienda_pedidos_web
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp_actualizado_en();

ALTER TABLE public.tienda_pedidos_web ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tienda_pedido_web_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "TiendaPedidosWeb_hotel_auth" ON public.tienda_pedidos_web;
CREATE POLICY "TiendaPedidosWeb_hotel_auth" ON public.tienda_pedidos_web
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.usuarios u
       WHERE u.id = auth.uid()
         AND (u.hotel_id = tienda_pedidos_web.hotel_id OR COALESCE(u.rol::text, '') = 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.usuarios u
       WHERE u.id = auth.uid()
         AND (u.hotel_id = tienda_pedidos_web.hotel_id OR COALESCE(u.rol::text, '') = 'superadmin')
    )
  );

DROP POLICY IF EXISTS "TiendaPedidoWebItems_hotel_auth" ON public.tienda_pedido_web_items;
CREATE POLICY "TiendaPedidoWebItems_hotel_auth" ON public.tienda_pedido_web_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.usuarios u
       WHERE u.id = auth.uid()
         AND (u.hotel_id = tienda_pedido_web_items.hotel_id OR COALESCE(u.rol::text, '') = 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.usuarios u
       WHERE u.id = auth.uid()
         AND (u.hotel_id = tienda_pedido_web_items.hotel_id OR COALESCE(u.rol::text, '') = 'superadmin')
    )
  );

CREATE OR REPLACE FUNCTION public.normalizar_numero_whatsapp(p_numero text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT NULLIF(regexp_replace(COALESCE(p_numero, ''), '[^0-9]', '', 'g'), '');
$function$;

CREATE OR REPLACE FUNCTION public.obtener_catalogo_tienda_web(p_hotel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hotel public.hoteles%rowtype;
  v_config public.configuracion_hotel%rowtype;
  v_productos jsonb;
BEGIN
  SELECT * INTO v_hotel
    FROM public.hoteles
   WHERE id = p_hotel_id
     AND COALESCE(activo, true) = true
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hotel no disponible.';
  END IF;

  SELECT * INTO v_config
    FROM public.configuracion_hotel
   WHERE hotel_id = p_hotel_id
   LIMIT 1;

  IF COALESCE(v_config.tienda_web_activa, true) = false THEN
    RETURN jsonb_build_object(
      'activo', false,
      'hotel', jsonb_build_object('id', v_hotel.id, 'nombre', COALESCE(v_config.nombre_hotel, v_hotel.nombre))
    );
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'nombre', p.nombre,
      'descripcion', p.descripcion,
      'precio_venta', COALESCE(p.precio_venta, p.precio, 0),
      'stock_actual', p.stock_actual,
      'imagen_url', p.imagen_url,
      'categoria', COALESCE(c.nombre, 'Tienda')
    )
    ORDER BY COALESCE(c.nombre, 'Tienda'), p.nombre
  ), '[]'::jsonb)
    INTO v_productos
    FROM public.productos_tienda p
    LEFT JOIN public.categorias_producto c ON c.id = p.categoria_id
   WHERE p.hotel_id = p_hotel_id
     AND COALESCE(p.activo, true) = true
     AND COALESCE(p.stock_actual, 0) > 0
     AND COALESCE(p.precio_venta, p.precio, 0) > 0;

  RETURN jsonb_build_object(
    'activo', true,
    'hotel', jsonb_build_object(
      'id', v_hotel.id,
      'nombre', COALESCE(v_config.nombre_hotel, v_hotel.nombre),
      'logo_url', COALESCE(v_config.logo_url, v_hotel.logo_url)
    ),
    'whatsapp_numero', public.normalizar_numero_whatsapp(COALESCE(v_config.tienda_whatsapp_numero, v_hotel.telefono)),
    'productos', v_productos
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_pedido_web_tienda(
  p_hotel_id uuid,
  p_habitacion_nombre text,
  p_cliente_nombre text,
  p_telefono_cliente text,
  p_observaciones text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_config public.configuracion_hotel%rowtype;
  v_hotel public.hoteles%rowtype;
  v_pedido_id uuid;
  v_habitacion_id uuid;
  v_total numeric(12,2) := 0;
  v_item jsonb;
  v_producto public.productos_tienda%rowtype;
  v_producto_id uuid;
  v_cantidad integer;
  v_subtotal numeric(12,2);
  v_whatsapp_numero text;
  v_mensaje text;
  v_lineas text := '';
  v_codigo text;
BEGIN
  IF p_hotel_id IS NULL THEN
    RAISE EXCEPTION 'Hotel no identificado.';
  END IF;

  IF btrim(COALESCE(p_habitacion_nombre, '')) = '' THEN
    RAISE EXCEPTION 'La habitacion es obligatoria.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El pedido no tiene productos.';
  END IF;

  IF jsonb_array_length(p_items) > 30 THEN
    RAISE EXCEPTION 'El pedido supera el limite de productos.';
  END IF;

  SELECT * INTO v_hotel
    FROM public.hoteles
   WHERE id = p_hotel_id
     AND COALESCE(activo, true) = true
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hotel no disponible.';
  END IF;

  SELECT * INTO v_config
    FROM public.configuracion_hotel
   WHERE hotel_id = p_hotel_id
   LIMIT 1;

  IF COALESCE(v_config.tienda_web_activa, true) = false THEN
    RAISE EXCEPTION 'La tienda web no esta activa para este hotel.';
  END IF;

  SELECT id INTO v_habitacion_id
    FROM public.habitaciones
   WHERE hotel_id = p_hotel_id
     AND lower(btrim(nombre)) = lower(btrim(p_habitacion_nombre))
   LIMIT 1;

  INSERT INTO public.tienda_pedidos_web (
    hotel_id,
    habitacion_nombre,
    habitacion_id,
    cliente_nombre,
    telefono_cliente,
    observaciones,
    estado,
    whatsapp_numero
  ) VALUES (
    p_hotel_id,
    btrim(p_habitacion_nombre),
    v_habitacion_id,
    NULLIF(btrim(COALESCE(p_cliente_nombre, '')), ''),
    NULLIF(btrim(COALESCE(p_telefono_cliente, '')), ''),
    NULLIF(btrim(COALESCE(p_observaciones, '')), ''),
    'pendiente',
    public.normalizar_numero_whatsapp(COALESCE(v_config.tienda_whatsapp_numero, v_hotel.telefono))
  )
  RETURNING id, whatsapp_numero INTO v_pedido_id, v_whatsapp_numero;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::uuid;
    v_cantidad := GREATEST(1, LEAST(COALESCE((v_item->>'cantidad')::integer, 1), 99));

    SELECT * INTO v_producto
      FROM public.productos_tienda
     WHERE id = v_producto_id
       AND hotel_id = p_hotel_id
       AND COALESCE(activo, true) = true
       AND COALESCE(stock_actual, 0) > 0
     LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Uno de los productos ya no esta disponible.';
    END IF;

    IF v_cantidad > COALESCE(v_producto.stock_actual, 0) THEN
      RAISE EXCEPTION 'Stock insuficiente para %. Disponible: %', v_producto.nombre, v_producto.stock_actual;
    END IF;

    v_subtotal := v_cantidad * COALESCE(v_producto.precio_venta, v_producto.precio, 0);
    v_total := v_total + v_subtotal;
    v_lineas := v_lineas || E'\n' || '- ' || v_cantidad::text || ' x ' || v_producto.nombre || ' = $' || to_char(v_subtotal, 'FM999G999G999G990');

    INSERT INTO public.tienda_pedido_web_items (
      pedido_id,
      hotel_id,
      producto_id,
      producto_nombre,
      cantidad,
      precio_unitario,
      subtotal
    ) VALUES (
      v_pedido_id,
      p_hotel_id,
      v_producto.id,
      v_producto.nombre,
      v_cantidad,
      COALESCE(v_producto.precio_venta, v_producto.precio, 0),
      v_subtotal
    );
  END LOOP;

  v_codigo := upper(left(v_pedido_id::text, 8));
  v_mensaje := 'Hola, quiero hacer este pedido de tienda para la habitacion ' || btrim(p_habitacion_nombre) ||
    E'\n\nPedido #' || v_codigo ||
    v_lineas ||
    E'\n\nTotal: $' || to_char(v_total, 'FM999G999G999G990') ||
    CASE WHEN NULLIF(btrim(COALESCE(p_cliente_nombre, '')), '') IS NOT NULL THEN E'\nCliente: ' || btrim(p_cliente_nombre) ELSE '' END ||
    CASE WHEN NULLIF(btrim(COALESCE(p_observaciones, '')), '') IS NOT NULL THEN E'\nObservaciones: ' || btrim(p_observaciones) ELSE '' END;

  UPDATE public.tienda_pedidos_web
     SET total = v_total,
         whatsapp_mensaje = v_mensaje,
         actualizado_en = now()
   WHERE id = v_pedido_id;

  INSERT INTO public.notificaciones (
    hotel_id,
    rol_destino,
    tipo,
    mensaje,
    entidad_tipo,
    entidad_id
  ) VALUES (
    p_hotel_id,
    'recepcionista',
    'general_info',
    'Nuevo pedido web de tienda para habitacion ' || btrim(p_habitacion_nombre) || ' por $' || to_char(v_total, 'FM999G999G999G990'),
    'tienda_pedido_web',
    v_pedido_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'pedido_id', v_pedido_id,
    'codigo', v_codigo,
    'total', v_total,
    'whatsapp_numero', v_whatsapp_numero,
    'whatsapp_mensaje', v_mensaje
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.actualizar_estado_pedido_web_tienda(
  p_pedido_id uuid,
  p_usuario_id uuid,
  p_estado text,
  p_notas_internas text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_pedido public.tienda_pedidos_web%rowtype;
  v_item record;
  v_producto public.productos_tienda%rowtype;
  v_venta_id uuid;
  v_reserva_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para gestionar pedidos web.';
  END IF;

  SELECT * INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro perfil de usuario.';
  END IF;

  IF COALESCE(v_actor.rol::text, '') <> 'superadmin' AND p_usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No puedes gestionar pedidos a nombre de otro usuario.';
  END IF;

  SELECT * INTO v_pedido
    FROM public.tienda_pedidos_web
   WHERE id = p_pedido_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido web no encontrado.';
  END IF;

  IF COALESCE(v_actor.rol::text, '') <> 'superadmin' AND v_actor.hotel_id IS DISTINCT FROM v_pedido.hotel_id THEN
    RAISE EXCEPTION 'No puedes gestionar pedidos de otro hotel.';
  END IF;

  IF p_estado NOT IN ('aceptado', 'preparando', 'entregado', 'rechazado', 'cancelado') THEN
    RAISE EXCEPTION 'Estado no permitido.';
  END IF;

  IF v_pedido.estado IN ('entregado', 'rechazado', 'cancelado') THEN
    RAISE EXCEPTION 'Este pedido ya esta cerrado.';
  END IF;

  IF p_estado = 'entregado' THEN
    SELECT r.id INTO v_reserva_id
      FROM public.reservas r
     WHERE r.hotel_id = v_pedido.hotel_id
       AND r.habitacion_id = v_pedido.habitacion_id
       AND r.estado IN ('activa', 'check_in', 'ocupada')
     ORDER BY r.fecha_inicio DESC NULLS LAST
     LIMIT 1;

    FOR v_item IN
      SELECT * FROM public.tienda_pedido_web_items WHERE pedido_id = p_pedido_id
    LOOP
      SELECT * INTO v_producto
        FROM public.productos_tienda
       WHERE id = v_item.producto_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Producto no encontrado: %', v_item.producto_nombre;
      END IF;

      IF COALESCE(v_producto.stock_actual, 0) < v_item.cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente para %. Disponible: %, requerido: %',
          v_item.producto_nombre,
          v_producto.stock_actual,
          v_item.cantidad;
      END IF;
    END LOOP;

    INSERT INTO public.ventas_tienda (
      hotel_id,
      usuario_id,
      habitacion_id,
      reserva_id,
      total_venta,
      fecha,
      cliente_temporal,
      estado_pago,
      creado_en
    ) VALUES (
      v_pedido.hotel_id,
      p_usuario_id,
      v_pedido.habitacion_id,
      v_reserva_id,
      v_pedido.total,
      now(),
      COALESCE(v_pedido.cliente_nombre, 'Pedido web habitacion ' || v_pedido.habitacion_nombre),
      'pendiente',
      now()
    )
    RETURNING id INTO v_venta_id;

    FOR v_item IN
      SELECT * FROM public.tienda_pedido_web_items WHERE pedido_id = p_pedido_id
    LOOP
      INSERT INTO public.detalle_ventas_tienda (
        venta_id,
        producto_id,
        cantidad,
        precio_unitario_venta,
        subtotal,
        hotel_id,
        creado_en
      ) VALUES (
        v_venta_id,
        v_item.producto_id,
        v_item.cantidad,
        v_item.precio_unitario,
        v_item.subtotal,
        v_pedido.hotel_id,
        now()
      );

      UPDATE public.productos_tienda
         SET stock_actual = stock_actual - v_item.cantidad,
             actualizado_en = now()
       WHERE id = v_item.producto_id;
    END LOOP;
  END IF;

  UPDATE public.tienda_pedidos_web
     SET estado = p_estado,
         notas_internas = NULLIF(btrim(COALESCE(p_notas_internas, '')), ''),
         gestionado_por_usuario_id = p_usuario_id,
         venta_tienda_id = COALESCE(v_venta_id, venta_tienda_id),
         aceptado_en = CASE WHEN p_estado IN ('aceptado', 'preparando') THEN now() ELSE aceptado_en END,
         rechazado_en = CASE WHEN p_estado IN ('rechazado', 'cancelado') THEN now() ELSE rechazado_en END,
         entregado_en = CASE WHEN p_estado = 'entregado' THEN now() ELSE entregado_en END,
         actualizado_en = now()
   WHERE id = p_pedido_id;

  RETURN jsonb_build_object(
    'success', true,
    'pedido_id', p_pedido_id,
    'estado', p_estado,
    'venta_tienda_id', v_venta_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.obtener_catalogo_tienda_web(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crear_pedido_web_tienda(uuid, text, text, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_estado_pedido_web_tienda(uuid, uuid, text, text) TO authenticated;
