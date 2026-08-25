-- Fase 1 / 05: restaurante seguro, atomico e idempotente; sin CMV.
-- Dependencias: authz, auditoria, business_date.
-- Riesgo: precio autoritativo pasa a platos.precio.
-- Rollback logico: desactivar feature flag antes de revocacion legacy.
-- Tests: fase1-rpc-contracts.test.cjs y branch/staging.

ALTER TABLE public.ventas_restaurante ADD COLUMN IF NOT EXISTS client_operation_id uuid;
ALTER TABLE public.ventas_restaurante ADD COLUMN IF NOT EXISTS business_date date;
ALTER TABLE public.ventas_restaurante ADD COLUMN IF NOT EXISTS source text;
CREATE UNIQUE INDEX IF NOT EXISTS ventas_rest_source_operation_uq ON public.ventas_restaurante(hotel_id,source,client_operation_id) WHERE client_operation_id IS NOT NULL AND source IS NOT NULL;

CREATE OR REPLACE FUNCTION public.procesar_venta_restaurante_atomica(
 p_items jsonb,p_pagos jsonb,p_modo text,p_turno_id uuid,p_client_operation_id uuid,
 p_reserva_id uuid DEFAULT NULL,p_habitacion_id uuid DEFAULT NULL,p_cliente_temporal text DEFAULT NULL,
 p_descuento_id uuid DEFAULT NULL,p_occurred_at timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.usuarios%rowtype; v_venta public.ventas_restaurante%rowtype; v_turno public.turnos%rowtype; v_plato public.platos%rowtype; v_item jsonb; v_pago jsonb; v_total numeric:=0; v_subtotal numeric:=0; v_discount numeric:=0; v_tax numeric:=0; v_tax_rate numeric:=0; v_tax_included boolean:=false; v_tax_name text; v_payments numeric:=0; v_qty int; v_amount numeric; v_method uuid; v_discount_row public.descuentos%rowtype; v_affected numeric:=0;
BEGIN
 IF auth.uid() IS NULL OR p_client_operation_id IS NULL THEN RAISE EXCEPTION 'Autenticacion y operacion requeridas' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo IS TRUE;
 IF NOT FOUND OR v_actor.hotel_id IS NULL OR NOT public.fase1_actor_tiene_permiso(v_actor.hotel_id,'restaurante.operar') THEN RAISE EXCEPTION 'Sin permiso de restaurante' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_venta FROM public.ventas_restaurante WHERE hotel_id=v_actor.hotel_id AND source='restaurant_atomic' AND client_operation_id=p_client_operation_id;
 IF FOUND THEN RETURN jsonb_build_object('venta_id',v_venta.id,'total',coalesce(v_venta.total_venta,v_venta.monto_total),'idempotent',true); END IF;
 IF p_modo NOT IN('inmediato','habitacion') OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Payload invalido' USING ERRCODE='22023'; END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
   v_qty:=coalesce((v_item->>'cantidad')::int,0); SELECT * INTO v_plato FROM public.platos WHERE id=(v_item->>'plato_id')::uuid;
   IF v_qty<=0 OR NOT FOUND OR v_plato.hotel_id<>v_actor.hotel_id OR NOT v_plato.activo THEN RAISE EXCEPTION 'Plato/cantidad invalido' USING ERRCODE='22023'; END IF;
   v_subtotal:=v_subtotal+(v_plato.precio*v_qty);
 END LOOP;
 IF p_descuento_id IS NOT NULL THEN
   SELECT * INTO v_discount_row FROM public.descuentos d WHERE d.id=p_descuento_id AND d.hotel_id=v_actor.hotel_id AND d.activo IS TRUE AND (d.fecha_inicio IS NULL OR d.fecha_inicio<=coalesce(p_occurred_at,now())) AND (d.fecha_fin IS NULL OR d.fecha_fin>=coalesce(p_occurred_at,now())) AND (d.expiracion IS NULL OR d.expiracion>=coalesce(p_occurred_at,now())) AND (d.usos_maximos=0 OR d.usos_actuales<d.usos_maximos) FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Descuento invalido' USING ERRCODE='22023'; END IF;
   IF v_discount_row.aplicabilidad::text IN ('reserva_total','venta_total') THEN v_affected:=v_subtotal;
   ELSIF v_discount_row.aplicabilidad::text='categorias_restaurante' THEN
     SELECT coalesce(sum(p.precio*(x.value->>'cantidad')::int),0) INTO v_affected FROM jsonb_array_elements(p_items) x JOIN public.platos p ON p.id=(x.value->>'plato_id')::uuid WHERE p.categoria_id::text=ANY(coalesce(v_discount_row.habitaciones_aplicables,'{}'));
   ELSE RAISE EXCEPTION 'Descuento no aplicable a restaurante' USING ERRCODE='22023'; END IF;
   v_discount:=CASE WHEN v_discount_row.tipo::text='fijo' THEN v_discount_row.valor ELSE v_affected*(v_discount_row.valor/100) END;
   v_discount:=least(v_subtotal,greatest(v_discount,0));
 END IF;
 SELECT coalesce(c.impuesto_porcentaje_restaurante,0),coalesce(c.impuesto_restaurante_incluido,false),coalesce(c.impuesto_nombre_restaurante,'Impuesto') INTO v_tax_rate,v_tax_included,v_tax_name FROM public.configuracion_hotel c WHERE c.hotel_id=v_actor.hotel_id;
 v_total:=v_subtotal-v_discount;
 IF v_tax_rate>0 THEN
   IF v_tax_included THEN v_tax:=v_total-(v_total/(1+(v_tax_rate/100)));
   ELSE v_tax:=v_total*(v_tax_rate/100); v_total:=v_total+v_tax; END IF;
 END IF;
 v_total:=round(v_total,2); v_discount:=round(v_discount,2); v_tax:=round(v_tax,2);
 IF p_modo='habitacion' THEN
   IF p_reserva_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.reservas r WHERE r.id=p_reserva_id AND r.hotel_id=v_actor.hotel_id) THEN RAISE EXCEPTION 'Reserva invalida' USING ERRCODE='23503'; END IF;
   IF coalesce(jsonb_array_length(p_pagos),0)<>0 THEN RAISE EXCEPTION 'Cargo a habitacion no acepta pago inmediato' USING ERRCODE='22023'; END IF;
 ELSE
   SELECT * INTO v_turno FROM public.turnos WHERE id=p_turno_id FOR UPDATE;
   IF NOT FOUND OR v_turno.hotel_id<>v_actor.hotel_id OR v_turno.usuario_id<>auth.uid() OR v_turno.estado<>'abierto' THEN RAISE EXCEPTION 'Turno activo propio requerido' USING ERRCODE='42501'; END IF;
   IF jsonb_typeof(p_pagos)<>'array' OR jsonb_array_length(p_pagos)=0 THEN RAISE EXCEPTION 'Pagos requeridos' USING ERRCODE='22023'; END IF;
   FOR v_pago IN SELECT value FROM jsonb_array_elements(p_pagos) LOOP
     v_method:=(v_pago->>'metodo_pago_id')::uuid; v_amount:=(v_pago->>'monto')::numeric;
     IF v_amount<=0 OR NOT EXISTS(SELECT 1 FROM public.metodos_pago m WHERE m.id=v_method AND m.hotel_id=v_actor.hotel_id AND m.activo) THEN RAISE EXCEPTION 'Pago invalido' USING ERRCODE='22023'; END IF;
     v_payments:=v_payments+v_amount;
   END LOOP;
   IF round(v_payments,2)<>round(v_total,2) THEN RAISE EXCEPTION 'Pagos no coinciden con total' USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO public.ventas_restaurante(hotel_id,usuario_id,fecha_venta,monto_total,metodo_pago_id,nombre_cliente_temporal,habitacion_id,reserva_id,total_venta,fecha,estado_pago,descuento_aplicado_id,monto_descontado,monto_impuestos,porcentaje_impuestos_aplicado,nombre_impuesto_aplicado,client_operation_id,business_date,source)
 VALUES(v_actor.hotel_id,auth.uid(),coalesce(p_occurred_at,now()),v_total,CASE WHEN jsonb_array_length(coalesce(p_pagos,'[]'))=1 THEN (p_pagos->0->>'metodo_pago_id')::uuid ELSE NULL END,p_cliente_temporal,p_habitacion_id,p_reserva_id,v_total,coalesce(p_occurred_at,now()),CASE WHEN p_modo='inmediato' THEN 'pagado' ELSE 'pendiente_cargo_habitacion' END,p_descuento_id,v_discount,v_tax,v_tax_rate,v_tax_name,p_client_operation_id,public.fase1_business_date(coalesce(p_occurred_at,now())),'restaurant_atomic') RETURNING * INTO v_venta;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
   v_qty:=(v_item->>'cantidad')::int; SELECT * INTO v_plato FROM public.platos WHERE id=(v_item->>'plato_id')::uuid;
   INSERT INTO public.ventas_restaurante_items(venta_id,plato_id,cantidad,precio_unitario_venta,subtotal,creado_en) VALUES(v_venta.id,v_plato.id,v_qty,v_plato.precio,v_plato.precio*v_qty,coalesce(p_occurred_at,now()));
 END LOOP;
 IF p_modo='inmediato' THEN FOR v_pago IN SELECT value FROM jsonb_array_elements(p_pagos) LOOP
   INSERT INTO public.caja(hotel_id,tipo,monto,concepto,fecha_movimiento,metodo_pago_id,usuario_id,turno_id,venta_restaurante_id,client_operation_id,source,business_date)
   VALUES(v_actor.hotel_id,'ingreso',(v_pago->>'monto')::numeric,'Venta restaurante atomica',coalesce(p_occurred_at,now()),(v_pago->>'metodo_pago_id')::uuid,auth.uid(),v_turno.id,v_venta.id,p_client_operation_id,'restaurant_atomic:'||(v_pago->>'metodo_pago_id'),public.fase1_business_date(coalesce(p_occurred_at,now())));
 END LOOP; END IF;
 IF p_descuento_id IS NOT NULL THEN UPDATE public.descuentos SET usos_actuales=usos_actuales+1 WHERE id=p_descuento_id; END IF;
 INSERT INTO public.auditoria_operaciones(hotel_id,actor_id,accion,entidad,entity_id,after_data,client_operation_id) VALUES(v_actor.hotel_id,auth.uid(),'restaurante.venta_crear','ventas_restaurante',v_venta.id,jsonb_build_object('total',v_total,'modo',p_modo),p_client_operation_id);
 RETURN jsonb_build_object('venta_id',v_venta.id,'subtotal',v_subtotal,'descuento',v_discount,'impuesto',v_tax,'total',v_total,'business_date',v_venta.business_date,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.procesar_venta_restaurante_atomica(jsonb,jsonb,text,uuid,uuid,uuid,uuid,text,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.procesar_venta_restaurante_atomica(jsonb,jsonb,text,uuid,uuid,uuid,uuid,text,uuid,timestamptz) TO authenticated,service_role;
