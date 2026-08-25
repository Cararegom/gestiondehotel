-- Fase 1 / 04: venta de tienda atomica e idempotente.
-- Dependencias: authz, auditoria, columnas business_date de caja.
-- Riesgo: precios y descuento pasan a ser autoritativos en backend.
-- Rollback logico: feature flag al flujo anterior antes de revocacion legacy.
-- Tests: fase1-rpc-contracts.test.cjs y escenarios de branch/staging.

ALTER TABLE public.ventas_tienda ADD COLUMN IF NOT EXISTS client_operation_id uuid;
ALTER TABLE public.ventas_tienda ADD COLUMN IF NOT EXISTS business_date date;
ALTER TABLE public.ventas_tienda ADD COLUMN IF NOT EXISTS source text;
CREATE UNIQUE INDEX IF NOT EXISTS ventas_tienda_source_operation_uq
ON public.ventas_tienda(hotel_id,source,client_operation_id)
WHERE client_operation_id IS NOT NULL AND source IS NOT NULL;

CREATE OR REPLACE FUNCTION public.procesar_venta_tienda_atomica(
  p_items jsonb,
  p_pagos jsonb,
  p_modo text,
  p_turno_id uuid,
  p_client_operation_id uuid,
  p_reserva_id uuid DEFAULT NULL,
  p_habitacion_id uuid DEFAULT NULL,
  p_cliente_temporal text DEFAULT NULL,
  p_descuento_id uuid DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
DECLARE v_actor public.usuarios%rowtype; v_venta public.ventas_tienda%rowtype; v_item jsonb; v_pago jsonb; v_producto public.productos_tienda%rowtype; v_turno public.turnos%rowtype;
 v_subtotal numeric:=0; v_descuento numeric:=0; v_total numeric; v_payment_total numeric:=0; v_qty int; v_price numeric; v_method uuid; v_amount numeric; v_new_stock int;
BEGIN
 IF auth.uid() IS NULL OR p_client_operation_id IS NULL THEN RAISE EXCEPTION 'Autenticacion y client_operation_id requeridos' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo IS TRUE;
 IF NOT FOUND OR v_actor.hotel_id IS NULL OR NOT public.fase1_actor_tiene_permiso(v_actor.hotel_id,'tienda.operar') THEN RAISE EXCEPTION 'Sin permiso de tienda' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_venta FROM public.ventas_tienda WHERE hotel_id=v_actor.hotel_id AND source='store_atomic' AND client_operation_id=p_client_operation_id;
 IF FOUND THEN RETURN jsonb_build_object('venta_id',v_venta.id,'total',v_venta.total_venta,'idempotent',true); END IF;
 IF p_modo NOT IN ('inmediato','habitacion') OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Modo o items invalidos' USING ERRCODE='22023'; END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
   v_qty:=coalesce((v_item->>'cantidad')::int,0);
   IF v_qty<=0 THEN RAISE EXCEPTION 'Cantidad invalida' USING ERRCODE='22023'; END IF;
   SELECT * INTO v_producto FROM public.productos_tienda WHERE id=(v_item->>'producto_id')::uuid FOR UPDATE;
   IF NOT FOUND OR v_producto.hotel_id IS DISTINCT FROM v_actor.hotel_id OR NOT v_producto.activo THEN RAISE EXCEPTION 'Producto invalido para el hotel' USING ERRCODE='42501'; END IF;
   IF v_producto.stock_actual<v_qty THEN RAISE EXCEPTION 'Stock insuficiente para %',v_producto.id USING ERRCODE='23514'; END IF;
   v_subtotal:=v_subtotal+(coalesce(v_producto.precio_venta,v_producto.precio)*v_qty);
 END LOOP;
 IF p_descuento_id IS NOT NULL THEN
   SELECT CASE d.tipo::text WHEN 'porcentaje' THEN least(v_subtotal,v_subtotal*d.valor/100) ELSE least(v_subtotal,d.valor) END
   INTO v_descuento FROM public.descuentos d WHERE d.id=p_descuento_id AND d.hotel_id=v_actor.hotel_id AND d.activo
    AND (d.fecha_inicio IS NULL OR d.fecha_inicio<=coalesce(p_occurred_at,now())) AND (d.fecha_fin IS NULL OR d.fecha_fin>=coalesce(p_occurred_at,now()))
    AND (d.usos_maximos=0 OR d.usos_actuales<d.usos_maximos);
   IF NOT FOUND THEN RAISE EXCEPTION 'Descuento invalido' USING ERRCODE='23514'; END IF;
 END IF;
 v_total:=round(v_subtotal-coalesce(v_descuento,0),2);
 IF p_modo='habitacion' THEN
   IF p_reserva_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.reservas r WHERE r.id=p_reserva_id AND r.hotel_id=v_actor.hotel_id) THEN RAISE EXCEPTION 'Reserva invalida para cargo' USING ERRCODE='23503'; END IF;
   IF coalesce(jsonb_array_length(p_pagos),0)<>0 THEN RAISE EXCEPTION 'Cargo a habitacion no acepta pagos inmediatos' USING ERRCODE='22023'; END IF;
 ELSE
   SELECT * INTO v_turno FROM public.turnos WHERE id=p_turno_id FOR UPDATE;
   IF NOT FOUND OR v_turno.hotel_id<>v_actor.hotel_id OR v_turno.usuario_id<>auth.uid() OR v_turno.estado<>'abierto' THEN RAISE EXCEPTION 'Turno activo propio requerido' USING ERRCODE='42501'; END IF;
   IF jsonb_typeof(p_pagos)<>'array' OR jsonb_array_length(p_pagos)=0 THEN RAISE EXCEPTION 'Pagos requeridos' USING ERRCODE='22023'; END IF;
   FOR v_pago IN SELECT value FROM jsonb_array_elements(p_pagos) LOOP
     v_method:=(v_pago->>'metodo_pago_id')::uuid; v_amount:=(v_pago->>'monto')::numeric;
     IF v_amount<=0 OR NOT EXISTS(SELECT 1 FROM public.metodos_pago m WHERE m.id=v_method AND m.hotel_id=v_actor.hotel_id AND m.activo) THEN RAISE EXCEPTION 'Pago invalido' USING ERRCODE='22023'; END IF;
     v_payment_total:=v_payment_total+v_amount;
   END LOOP;
   IF round(v_payment_total,2)<>v_total THEN RAISE EXCEPTION 'La suma de pagos no coincide con el total' USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO public.ventas_tienda(hotel_id,total_venta,metodo_pago_id,usuario_id,fecha,reserva_id,habitacion_id,cliente_temporal,estado_pago,descuento_id,monto_descuento,client_operation_id,business_date,source)
 VALUES(v_actor.hotel_id,v_total,CASE WHEN jsonb_array_length(coalesce(p_pagos,'[]'))=1 THEN (p_pagos->0->>'metodo_pago_id')::uuid ELSE NULL END,auth.uid(),coalesce(p_occurred_at,now()),p_reserva_id,p_habitacion_id,p_cliente_temporal,CASE WHEN p_modo='inmediato' THEN 'pagado' ELSE 'pendiente' END,p_descuento_id,v_descuento,p_client_operation_id,public.fase1_business_date(coalesce(p_occurred_at,now())),'store_atomic') RETURNING * INTO v_venta;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
   v_qty:=(v_item->>'cantidad')::int;
   SELECT * INTO v_producto FROM public.productos_tienda WHERE id=(v_item->>'producto_id')::uuid FOR UPDATE;
   v_price:=coalesce(v_producto.precio_venta,v_producto.precio); v_new_stock:=v_producto.stock_actual-v_qty;
   INSERT INTO public.detalle_ventas_tienda(venta_id,producto_id,cantidad,precio_unitario_venta,subtotal,hotel_id,creado_en) VALUES(v_venta.id,v_producto.id,v_qty,v_price,v_price*v_qty,v_actor.hotel_id,coalesce(p_occurred_at,now()));
   UPDATE public.productos_tienda SET stock_actual=v_new_stock,actualizado_en=now() WHERE id=v_producto.id;
   INSERT INTO public.movimientos_inventario(hotel_id,producto_id,tipo_movimiento,cantidad,razon,usuario_responsable,stock_anterior,stock_nuevo,usuario_id,notas) VALUES(v_actor.hotel_id,v_producto.id,'SALIDA',v_qty,'venta_tienda_atomica',auth.uid()::text,v_producto.stock_actual,v_new_stock,auth.uid(),'venta_id='||v_venta.id);
 END LOOP;
 IF p_descuento_id IS NOT NULL THEN UPDATE public.descuentos SET usos_actuales=usos_actuales+1 WHERE id=p_descuento_id; END IF;
 IF p_modo='inmediato' THEN FOR v_pago IN SELECT value FROM jsonb_array_elements(p_pagos) LOOP
   INSERT INTO public.caja(hotel_id,tipo,monto,concepto,fecha_movimiento,metodo_pago_id,usuario_id,venta_tienda_id,turno_id,client_operation_id,source,business_date)
   VALUES(v_actor.hotel_id,'ingreso',(v_pago->>'monto')::numeric,'Venta tienda atomica',coalesce(p_occurred_at,now()),(v_pago->>'metodo_pago_id')::uuid,auth.uid(),v_venta.id,v_turno.id,p_client_operation_id,'store_atomic:'||(v_pago->>'metodo_pago_id'),public.fase1_business_date(coalesce(p_occurred_at,now())));
 END LOOP; END IF;
 INSERT INTO public.auditoria_operaciones(hotel_id,actor_id,accion,entidad,entity_id,after_data,client_operation_id) VALUES(v_actor.hotel_id,auth.uid(),'tienda.venta_crear','ventas_tienda',v_venta.id,jsonb_build_object('total',v_total,'modo',p_modo),p_client_operation_id);
 RETURN jsonb_build_object('venta_id',v_venta.id,'total',v_total,'business_date',v_venta.business_date,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.procesar_venta_tienda_atomica(jsonb,jsonb,text,uuid,uuid,uuid,uuid,text,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.procesar_venta_tienda_atomica(jsonb,jsonb,text,uuid,uuid,uuid,uuid,text,uuid,timestamptz) TO authenticated,service_role;
