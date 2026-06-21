-- Salidas manuales de inventario de Tienda con autorizacion administrativa.

CREATE TABLE IF NOT EXISTS public.solicitudes_salida_inventario_tienda (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.productos_tienda(id) ON DELETE RESTRICT,
  cantidad integer NOT NULL,
  razon text NOT NULL,
  stock_actual_solicitud integer DEFAULT 0 NOT NULL,
  solicitado_por_usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  solicitado_por_nombre text,
  estado text DEFAULT 'pendiente' NOT NULL,
  autorizado_por_usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  autorizado_por_nombre text,
  autorizado_en timestamp with time zone,
  motivo_rechazo text,
  movimiento_inventario_id bigint REFERENCES public.movimientos_inventario(id) ON DELETE SET NULL,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT solicitudes_salida_inventario_tienda_pkey PRIMARY KEY (id),
  CONSTRAINT solicitudes_salida_inventario_tienda_cantidad_check CHECK (cantidad > 0),
  CONSTRAINT solicitudes_salida_inventario_tienda_estado_check CHECK (estado IN ('pendiente', 'aprobado', 'rechazado'))
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_salida_inv_hotel_estado
  ON public.solicitudes_salida_inventario_tienda(hotel_id, estado, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_solicitudes_salida_inv_producto
  ON public.solicitudes_salida_inventario_tienda(producto_id);

DROP TRIGGER IF EXISTS set_timestamp_solicitudes_salida_inventario_tienda
  ON public.solicitudes_salida_inventario_tienda;
CREATE TRIGGER set_timestamp_solicitudes_salida_inventario_tienda
  BEFORE UPDATE ON public.solicitudes_salida_inventario_tienda
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp_actualizado_en();

ALTER TABLE public.solicitudes_salida_inventario_tienda ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SolicitudesSalidaInventario_hotel_select" ON public.solicitudes_salida_inventario_tienda;
CREATE POLICY "SolicitudesSalidaInventario_hotel_select" ON public.solicitudes_salida_inventario_tienda
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.usuarios u
       WHERE u.id = auth.uid()
         AND (u.hotel_id = solicitudes_salida_inventario_tienda.hotel_id OR u.rol = 'superadmin')
    )
  );

DROP POLICY IF EXISTS "SolicitudesSalidaInventario_hotel_insert" ON public.solicitudes_salida_inventario_tienda;
CREATE POLICY "SolicitudesSalidaInventario_hotel_insert" ON public.solicitudes_salida_inventario_tienda
  FOR INSERT
  TO authenticated
  WITH CHECK (
    solicitado_por_usuario_id = auth.uid()
    AND EXISTS (
      SELECT 1
        FROM public.usuarios u
       WHERE u.id = auth.uid()
         AND (u.hotel_id = solicitudes_salida_inventario_tienda.hotel_id OR u.rol = 'superadmin')
    )
  );

CREATE OR REPLACE FUNCTION public.usuario_actual_es_admin_hotel(p_hotel_id uuid)
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
         lower(COALESCE(u.rol::text, '')) IN ('admin', 'administrador', 'superadmin')
         OR EXISTS (
           SELECT 1
             FROM public.usuarios_roles ur
             JOIN public.roles r ON r.id = ur.rol_id
            WHERE ur.usuario_id = u.id
              AND ur.hotel_id = p_hotel_id
              AND lower(COALESCE(r.nombre, '')) IN ('admin', 'administrador', 'superadmin')
         )
       )
  );
$function$;

CREATE OR REPLACE FUNCTION public.solicitar_salida_inventario_tienda(
  p_producto_id uuid,
  p_cantidad integer,
  p_razon text,
  p_usuario_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_producto public.productos_tienda%rowtype;
  v_solicitud_id uuid;
  v_nombre text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para solicitar salida de inventario.';
  END IF;

  IF p_usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No puedes solicitar salidas a nombre de otro usuario.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a cero.';
  END IF;

  IF btrim(COALESCE(p_razon, '')) = '' THEN
    RAISE EXCEPTION 'Debes indicar la razon de la salida.';
  END IF;

  SELECT * INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro perfil del usuario.';
  END IF;

  SELECT * INTO v_producto
    FROM public.productos_tienda
   WHERE id = p_producto_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado.';
  END IF;

  IF COALESCE(v_actor.rol::text, '') <> 'superadmin' AND v_actor.hotel_id IS DISTINCT FROM v_producto.hotel_id THEN
    RAISE EXCEPTION 'No puedes solicitar salidas de otro hotel.';
  END IF;

  IF COALESCE(v_producto.stock_actual, 0) < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente. Disponible: %, solicitado: %', COALESCE(v_producto.stock_actual, 0), p_cantidad;
  END IF;

  v_nombre := COALESCE(NULLIF(v_actor.nombre, ''), NULLIF(v_actor.email, ''), auth.uid()::text);

  INSERT INTO public.solicitudes_salida_inventario_tienda (
    hotel_id,
    producto_id,
    cantidad,
    razon,
    stock_actual_solicitud,
    solicitado_por_usuario_id,
    solicitado_por_nombre
  )
  VALUES (
    v_producto.hotel_id,
    p_producto_id,
    p_cantidad,
    btrim(p_razon),
    COALESCE(v_producto.stock_actual, 0),
    auth.uid(),
    v_nombre
  )
  RETURNING id INTO v_solicitud_id;

  RETURN jsonb_build_object('success', true, 'solicitud_id', v_solicitud_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.aprobar_salida_inventario_tienda(
  p_solicitud_id uuid,
  p_admin_usuario_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin public.usuarios%rowtype;
  v_solicitud public.solicitudes_salida_inventario_tienda%rowtype;
  v_producto public.productos_tienda%rowtype;
  v_stock_anterior integer;
  v_stock_nuevo integer;
  v_movimiento_id bigint;
  v_admin_nombre text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para aprobar salidas.';
  END IF;

  IF p_admin_usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No puedes aprobar salidas a nombre de otro usuario.';
  END IF;

  SELECT * INTO v_solicitud
    FROM public.solicitudes_salida_inventario_tienda
   WHERE id = p_solicitud_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada.';
  END IF;

  IF v_solicitud.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La solicitud ya fue procesada.';
  END IF;

  IF NOT public.usuario_actual_es_admin_hotel(v_solicitud.hotel_id) THEN
    RAISE EXCEPTION 'Solo administracion puede aprobar salidas de inventario.';
  END IF;

  SELECT * INTO v_admin
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  v_admin_nombre := COALESCE(NULLIF(v_admin.nombre, ''), NULLIF(v_admin.email, ''), auth.uid()::text);

  SELECT * INTO v_producto
    FROM public.productos_tienda
   WHERE id = v_solicitud.producto_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto de la solicitud no encontrado.';
  END IF;

  v_stock_anterior := COALESCE(v_producto.stock_actual, 0);
  IF v_stock_anterior < v_solicitud.cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente al aprobar. Disponible: %, solicitado: %', v_stock_anterior, v_solicitud.cantidad;
  END IF;

  v_stock_nuevo := v_stock_anterior - v_solicitud.cantidad;

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
    v_solicitud.hotel_id,
    v_solicitud.producto_id,
    'SALIDA',
    v_solicitud.cantidad,
    v_solicitud.razon,
    COALESCE(v_solicitud.solicitado_por_nombre, 'Usuario') || ' / Autorizado por ' || v_admin_nombre,
    v_stock_anterior,
    v_stock_nuevo
  )
  RETURNING id INTO v_movimiento_id;

  UPDATE public.productos_tienda
     SET stock_actual = v_stock_nuevo,
         actualizado_en = now()
   WHERE id = v_solicitud.producto_id;

  UPDATE public.solicitudes_salida_inventario_tienda
     SET estado = 'aprobado',
         autorizado_por_usuario_id = auth.uid(),
         autorizado_por_nombre = v_admin_nombre,
         autorizado_en = now(),
         movimiento_inventario_id = v_movimiento_id
   WHERE id = p_solicitud_id;

  RETURN jsonb_build_object(
    'success', true,
    'solicitud_id', p_solicitud_id,
    'movimiento_id', v_movimiento_id,
    'stock_nuevo', v_stock_nuevo
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rechazar_salida_inventario_tienda(
  p_solicitud_id uuid,
  p_admin_usuario_id uuid,
  p_motivo text DEFAULT 'No autorizado'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin public.usuarios%rowtype;
  v_solicitud public.solicitudes_salida_inventario_tienda%rowtype;
  v_admin_nombre text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para rechazar salidas.';
  END IF;

  IF p_admin_usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No puedes rechazar salidas a nombre de otro usuario.';
  END IF;

  SELECT * INTO v_solicitud
    FROM public.solicitudes_salida_inventario_tienda
   WHERE id = p_solicitud_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada.';
  END IF;

  IF v_solicitud.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La solicitud ya fue procesada.';
  END IF;

  IF NOT public.usuario_actual_es_admin_hotel(v_solicitud.hotel_id) THEN
    RAISE EXCEPTION 'Solo administracion puede rechazar salidas de inventario.';
  END IF;

  SELECT * INTO v_admin
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  v_admin_nombre := COALESCE(NULLIF(v_admin.nombre, ''), NULLIF(v_admin.email, ''), auth.uid()::text);

  UPDATE public.solicitudes_salida_inventario_tienda
     SET estado = 'rechazado',
         autorizado_por_usuario_id = auth.uid(),
         autorizado_por_nombre = v_admin_nombre,
         autorizado_en = now(),
         motivo_rechazo = COALESCE(NULLIF(btrim(p_motivo), ''), 'No autorizado')
   WHERE id = p_solicitud_id;

  RETURN jsonb_build_object('success', true, 'solicitud_id', p_solicitud_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.usuario_actual_es_admin_hotel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.solicitar_salida_inventario_tienda(uuid, integer, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aprobar_salida_inventario_tienda(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rechazar_salida_inventario_tienda(uuid, uuid, text) TO authenticated;
