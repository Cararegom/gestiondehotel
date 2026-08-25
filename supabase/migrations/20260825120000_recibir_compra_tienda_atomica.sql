-- Recibe una orden de tienda, aumenta existencias y registra su pago en una sola transacción.
CREATE OR REPLACE FUNCTION public.recibir_compra_tienda_atomica(
  p_compra_id uuid,
  p_pagos jsonb,
  p_turno_id uuid,
  p_client_operation_id uuid,
  p_occurred_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_compra public.compras_tienda%rowtype;
  v_actor public.usuarios%rowtype;
  v_turno public.turnos%rowtype;
  v_detalle record;
  v_producto public.productos_tienda%rowtype;
  v_pago jsonb;
  v_metodo uuid;
  v_monto numeric;
  v_total_pagos numeric := 0;
  v_caja_ids jsonb := '[]'::jsonb;
  v_caja_id uuid;
  v_proveedor text;
BEGIN
  IF auth.uid() IS NULL OR p_client_operation_id IS NULL THEN
    RAISE EXCEPTION 'Autenticación y client_operation_id son obligatorios' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo IS TRUE;
  SELECT * INTO v_compra FROM public.compras_tienda WHERE id=p_compra_id FOR UPDATE;
  IF NOT FOUND OR v_actor.hotel_id IS DISTINCT FROM v_compra.hotel_id
     OR NOT public.fase1_actor_tiene_permiso(v_compra.hotel_id,'tienda.operar') THEN
    RAISE EXCEPTION 'Compra fuera del hotel autorizado' USING ERRCODE='42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.auditoria_operaciones
     WHERE hotel_id=v_compra.hotel_id AND accion='tienda.compra_recibir'
       AND client_operation_id=p_client_operation_id
  ) THEN
    RETURN jsonb_build_object('compra_id',v_compra.id,'estado',v_compra.estado,'idempotent',true);
  END IF;

  IF v_compra.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La compra no está pendiente' USING ERRCODE='23514';
  END IF;
  IF jsonb_typeof(p_pagos) <> 'array' OR jsonb_array_length(p_pagos)=0 THEN
    RAISE EXCEPTION 'Debe registrar al menos un pago' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(DISTINCT value->>'metodo_pago_id') FROM jsonb_array_elements(p_pagos))
     <> jsonb_array_length(p_pagos) THEN
    RAISE EXCEPTION 'Los métodos de pago no pueden repetirse' USING ERRCODE='23514';
  END IF;

  IF p_turno_id IS NOT NULL THEN
    SELECT * INTO v_turno FROM public.turnos WHERE id=p_turno_id FOR UPDATE;
    IF NOT FOUND OR v_turno.hotel_id IS DISTINCT FROM v_compra.hotel_id
       OR v_turno.usuario_id IS DISTINCT FROM auth.uid()
       OR v_turno.estado<>'abierto' OR v_turno.fecha_cierre IS NOT NULL THEN
      RAISE EXCEPTION 'Turno activo propio del hotel requerido' USING ERRCODE='42501';
    END IF;
  END IF;

  FOR v_pago IN SELECT value FROM jsonb_array_elements(p_pagos) LOOP
    v_metodo := (v_pago->>'metodo_pago_id')::uuid;
    v_monto := (v_pago->>'monto')::numeric;
    IF v_monto IS NULL OR v_monto<=0 OR NOT EXISTS(
      SELECT 1 FROM public.metodos_pago
       WHERE id=v_metodo AND hotel_id=v_compra.hotel_id AND activo IS TRUE
    ) THEN
      RAISE EXCEPTION 'Pago o método inválido para el hotel' USING ERRCODE='22023';
    END IF;
    v_total_pagos := v_total_pagos + v_monto;
  END LOOP;
  IF round(v_total_pagos,2) <> round(coalesce(v_compra.total_compra,0),2) THEN
    RAISE EXCEPTION 'El total de pagos no coincide con la compra' USING ERRCODE='23514';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.detalle_compras_tienda WHERE compra_id=v_compra.id) THEN
    RAISE EXCEPTION 'La compra no tiene detalles' USING ERRCODE='23514';
  END IF;
  FOR v_detalle IN
    SELECT * FROM public.detalle_compras_tienda WHERE compra_id=v_compra.id ORDER BY producto_id
  LOOP
    IF v_detalle.hotel_id IS DISTINCT FROM v_compra.hotel_id
       OR v_detalle.cantidad IS NULL OR v_detalle.cantidad<=0
       OR trunc(v_detalle.cantidad)<>v_detalle.cantidad THEN
      RAISE EXCEPTION 'Detalle de compra inválido' USING ERRCODE='23514';
    END IF;
    SELECT * INTO v_producto FROM public.productos_tienda
     WHERE id=v_detalle.producto_id AND hotel_id=v_compra.hotel_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto fuera del hotel autorizado' USING ERRCODE='42501'; END IF;
    UPDATE public.productos_tienda
       SET stock_actual=v_producto.stock_actual+v_detalle.cantidad::integer, actualizado_en=now()
     WHERE id=v_producto.id;
    UPDATE public.detalle_compras_tienda SET recibido=v_detalle.cantidad::integer WHERE id=v_detalle.id;
    INSERT INTO public.movimientos_inventario(
      hotel_id,producto_id,tipo_movimiento,cantidad,razon,usuario_responsable,
      stock_anterior,stock_nuevo,usuario_id,notas
    ) VALUES (
      v_compra.hotel_id,v_producto.id,'ingreso_compra',v_detalle.cantidad::integer,
      'Recepción de compra',coalesce(v_actor.nombre,auth.uid()::text),v_producto.stock_actual,
      v_producto.stock_actual+v_detalle.cantidad::integer,auth.uid(),
      'Recepción de OC #'||left(v_compra.id::text,8)
    );
  END LOOP;

  SELECT nombre INTO v_proveedor FROM public.proveedores WHERE id=v_compra.proveedor_id;
  FOR v_pago IN SELECT value FROM jsonb_array_elements(p_pagos) LOOP
    v_metodo := (v_pago->>'metodo_pago_id')::uuid;
    v_monto := (v_pago->>'monto')::numeric;
    INSERT INTO public.caja(
      hotel_id,tipo,monto,concepto,fecha_movimiento,metodo_pago_id,usuario_id,
      compra_tienda_id,turno_id,client_operation_id,source,business_date
    ) VALUES (
      v_compra.hotel_id,'egreso',v_monto,'Pago Compra a '||coalesce(v_proveedor,'N/A'),
      coalesce(p_occurred_at,now()),v_metodo,auth.uid(),v_compra.id,p_turno_id,
      p_client_operation_id,'purchase_payment:'||v_metodo::text,
      public.fase1_business_date(coalesce(p_occurred_at,now()))
    ) RETURNING id INTO v_caja_id;
    v_caja_ids := v_caja_ids || jsonb_build_array(v_caja_id);
  END LOOP;

  UPDATE public.compras_tienda
     SET estado='recibido', recibido_por_usuario_id=auth.uid(), fecha_recepcion=coalesce(p_occurred_at,now())
   WHERE id=v_compra.id;
  INSERT INTO public.auditoria_operaciones(
    hotel_id,actor_id,accion,entidad,entity_id,before_data,after_data,client_operation_id
  ) VALUES (
    v_compra.hotel_id,auth.uid(),'tienda.compra_recibir','compras_tienda',v_compra.id,
    to_jsonb(v_compra),jsonb_build_object('estado','recibido','total_pagado',v_total_pagos,'caja_ids',v_caja_ids),
    p_client_operation_id
  );
  RETURN jsonb_build_object('compra_id',v_compra.id,'estado','recibido','total_pagado',v_total_pagos,'caja_ids',v_caja_ids,'idempotent',false);
END $$;

REVOKE ALL ON FUNCTION public.recibir_compra_tienda_atomica(uuid,jsonb,uuid,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.recibir_compra_tienda_atomica(uuid,jsonb,uuid,uuid,timestamptz) TO authenticated,service_role;
