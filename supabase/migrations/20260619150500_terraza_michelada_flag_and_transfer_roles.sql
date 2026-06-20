-- Productos de Terraza que pueden venderse como michelada.
-- Transferencias Tienda/Terraza con responsabilidad por rol y turno abierto.

ALTER TABLE public.terraza_productos ADD COLUMN IF NOT EXISTS permite_michelada boolean DEFAULT false NOT NULL;

UPDATE public.terraza_productos
   SET permite_michelada = true,
       actualizado_en = now()
 WHERE hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid
   AND (
     lower(COALESCE(categoria, '')) LIKE '%cerve%'
     OR lower(COALESCE(nombre, '')) LIKE '%corona%'
   );

CREATE OR REPLACE FUNCTION public.usuario_actual_tiene_rol_transferencia(
  p_hotel_id uuid,
  p_roles text[]
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.usuarios u
     WHERE u.id = auth.uid()
       AND (u.hotel_id = p_hotel_id OR u.rol = 'superadmin')
       AND (
         lower(COALESCE(u.rol::text, '')) = ANY (p_roles)
         OR EXISTS (
           SELECT 1
             FROM public.usuarios_roles ur
             JOIN public.roles r ON r.id = ur.rol_id
            WHERE ur.usuario_id = u.id
              AND ur.hotel_id = p_hotel_id
              AND lower(r.nombre) = ANY (p_roles)
         )
       )
  );
$function$;

CREATE OR REPLACE FUNCTION public.usuario_tiene_turno_abierto_transferencia(
  p_hotel_id uuid,
  p_usuario_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.turnos t
     WHERE t.hotel_id = p_hotel_id
       AND t.usuario_id = p_usuario_id
       AND t.estado = 'abierto'
  );
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
  v_permite_michelada boolean := false;
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

  IF NOT public.usuario_actual_tiene_rol_transferencia(v_tienda.hotel_id, ARRAY['recepcionista', 'admin', 'administrador', 'superadmin']) THEN
    RAISE EXCEPTION 'Solo recepcion o administracion puede enviar inventario de Tienda a Terraza.';
  END IF;

  IF NOT public.usuario_tiene_turno_abierto_transferencia(v_tienda.hotel_id, p_usuario_id) THEN
    RAISE EXCEPTION 'Debes tener un turno de caja abierto para enviar inventario a Terraza.';
  END IF;

  IF COALESCE(v_tienda.stock_actual, 0) < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente en Tienda para %. Disponible: %, requerido: %',
      v_tienda.nombre,
      COALESCE(v_tienda.stock_actual, 0),
      p_cantidad;
  END IF;

  v_permite_michelada :=
    lower(COALESCE(v_tienda.categoria_nombre, '')) LIKE '%cerve%'
    OR lower(COALESCE(v_tienda.nombre, '')) LIKE '%corona%';

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
           permite_michelada = permite_michelada OR v_permite_michelada,
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
      permite_michelada,
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
      v_permite_michelada,
      true
    )
    RETURNING id INTO v_terraza_id;
  END IF;

  INSERT INTO public.bitacora (hotel_id, usuario_id, modulo, accion, detalles)
  VALUES (
    v_tienda.hotel_id,
    p_usuario_id,
    'Tienda',
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

  IF NOT public.usuario_actual_tiene_rol_transferencia(v_terraza.hotel_id, ARRAY['mesero', 'mesero/a', 'mesera', 'admin', 'administrador', 'superadmin']) THEN
    RAISE EXCEPTION 'Solo mesero o administracion puede devolver inventario de Terraza a Tienda.';
  END IF;

  IF NOT public.usuario_tiene_turno_abierto_transferencia(v_terraza.hotel_id, p_usuario_id) THEN
    RAISE EXCEPTION 'Debes tener un turno de caja abierto para devolver inventario a Tienda.';
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
    'Tienda',
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
