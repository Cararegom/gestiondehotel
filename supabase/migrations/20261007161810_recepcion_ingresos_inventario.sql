-- Recepcion puede registrar entradas auditadas de inventario en su hotel.
-- El permiso de ajustar/sacar inventario y las autorizaciones de salida se conservan.
INSERT INTO public.permisos (nombre, descripcion)
SELECT 'inventario.ingresar', 'Registrar entradas auditadas de inventario del hotel asignado'
WHERE NOT EXISTS (
  SELECT 1 FROM public.permisos WHERE nombre = 'inventario.ingresar'
);

INSERT INTO public.roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permisos p ON p.nombre = 'inventario.ingresar'
WHERE lower(btrim(r.nombre)) IN ('recepcionista', 'admin', 'administrador', 'superadmin')
  AND NOT EXISTS (
    SELECT 1 FROM public.roles_permisos rp
    WHERE rp.rol_id = r.id AND rp.permiso_id = p.id
  );

CREATE OR REPLACE FUNCTION public.ajustar_stock_tienda_seguro(
  p_producto_id uuid,
  p_delta integer,
  p_reason text,
  p_client_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_producto public.productos_tienda%rowtype;
  v_auditoria public.auditoria_operaciones%rowtype;
  v_stock_anterior integer;
  v_stock_nuevo integer;
  v_movimiento_id bigint;
  v_resultado jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_producto_id IS NULL OR p_delta = 0
     OR p_client_operation_id IS NULL OR btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'A16_AJUSTE_INVALIDO'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_producto
  FROM public.productos_tienda p
  WHERE p.id = p_producto_id
  FOR UPDATE;

  IF NOT FOUND OR NOT (
    public.fase1_actor_tiene_permiso(v_producto.hotel_id, 'inventario.ajustar')
    OR (
      p_delta > 0
      AND public.fase1_actor_tiene_permiso(v_producto.hotel_id, 'inventario.ingresar')
    )
  ) THEN
    RAISE EXCEPTION 'A16_PRODUCTO_NO_AUTORIZADO'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_auditoria
  FROM public.auditoria_operaciones a
  WHERE a.hotel_id = v_producto.hotel_id
    AND a.accion = 'inventario.ajustar'
    AND a.client_operation_id = p_client_operation_id;

  IF FOUND THEN
    IF v_auditoria.actor_id IS DISTINCT FROM auth.uid()
       OR v_auditoria.entity_id IS DISTINCT FROM v_producto.id THEN
      RAISE EXCEPTION 'A16_OPERACION_NO_AUTORIZADA'
        USING ERRCODE = '42501';
    END IF;
    RETURN coalesce(v_auditoria.after_data, '{}'::jsonb)
      || jsonb_build_object('idempotent', true);
  END IF;

  v_stock_anterior := coalesce(v_producto.stock_actual, 0);
  v_stock_nuevo := v_stock_anterior + p_delta;
  IF v_stock_nuevo < 0 THEN
    RAISE EXCEPTION 'A16_STOCK_INSUFICIENTE: disponible %, ajuste %', v_stock_anterior, p_delta
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.productos_tienda
  SET stock_actual = v_stock_nuevo,
      actualizado_en = now()
  WHERE id = v_producto.id AND hotel_id = v_producto.hotel_id;

  INSERT INTO public.movimientos_inventario(
    hotel_id, producto_id, tipo_movimiento, cantidad, razon,
    usuario_responsable, stock_anterior, stock_nuevo, usuario_id, notas
  ) VALUES (
    v_producto.hotel_id,
    v_producto.id,
    CASE WHEN p_delta > 0 THEN 'INGRESO' ELSE 'SALIDA' END,
    abs(p_delta),
    btrim(p_reason),
    auth.uid()::text,
    v_stock_anterior,
    v_stock_nuevo,
    auth.uid(),
    'ajuste_tienda_atomico'
  )
  RETURNING id INTO v_movimiento_id;

  v_resultado := jsonb_build_object(
    'producto_id', v_producto.id,
    'movimiento_id', v_movimiento_id,
    'tipo_movimiento', CASE WHEN p_delta > 0 THEN 'INGRESO' ELSE 'SALIDA' END,
    'cantidad', abs(p_delta),
    'stock_anterior', v_stock_anterior,
    'stock_actual', v_stock_nuevo,
    'idempotent', false
  );

  INSERT INTO public.auditoria_operaciones(
    hotel_id, actor_id, accion, entidad, entity_id,
    before_data, after_data, reason, client_operation_id
  ) VALUES (
    v_producto.hotel_id,
    auth.uid(),
    'inventario.ajustar',
    'productos_tienda',
    v_producto.id,
    jsonb_build_object('stock_actual', v_stock_anterior),
    v_resultado,
    btrim(p_reason),
    p_client_operation_id
  );

  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.ajustar_stock_tienda_seguro(uuid,integer,text,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajustar_stock_tienda_seguro(uuid,integer,text,uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.ajustar_stock_tienda_seguro(uuid,integer,text,uuid) IS
  'Ajustes atomicos por hotel: inventario.ingresar solo permite entradas positivas; las salidas requieren inventario.ajustar.';
