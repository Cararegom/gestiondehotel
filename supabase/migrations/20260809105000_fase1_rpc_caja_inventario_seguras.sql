-- Fase 1 / 06: endurecer RPC de caja y proveer ajuste especifico de stock.
-- Dependencias: authz, auditoria, business_date.
-- Riesgo: elimina excepcion superadmin transversal implicita.
-- Rollback logico: restaurar definiciones versionadas, sin tocar datos.
-- Tests: fase1-rpc-contracts.test.cjs.

CREATE OR REPLACE FUNCTION public.abrir_turno_con_apertura(p_hotel_id uuid,p_usuario_id uuid,p_monto_inicial numeric,p_fecha_movimiento timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_turno public.turnos%rowtype;
BEGIN
 IF auth.uid() IS NULL OR p_usuario_id IS DISTINCT FROM auth.uid() OR NOT public.fase1_actor_es_miembro_activo(p_hotel_id) THEN RAISE EXCEPTION 'Actor/hotel no autorizado' USING ERRCODE='42501'; END IF;
 IF p_monto_inicial IS NULL OR p_monto_inicial<0 THEN RAISE EXCEPTION 'Monto inicial invalido' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.turnos WHERE hotel_id=p_hotel_id AND usuario_id=auth.uid() AND estado='abierto') THEN RAISE EXCEPTION 'Ya existe turno abierto' USING ERRCODE='23505'; END IF;
 INSERT INTO public.turnos(hotel_id,usuario_id,fecha_apertura,estado) VALUES(p_hotel_id,auth.uid(),coalesce(p_fecha_movimiento,now()),'abierto') RETURNING * INTO v_turno;
 INSERT INTO public.caja(hotel_id,usuario_id,turno_id,tipo,concepto,monto,fecha_movimiento,source,business_date) VALUES(p_hotel_id,auth.uid(),v_turno.id,'apertura','Apertura de caja',p_monto_inicial,coalesce(p_fecha_movimiento,now()),'shift_open',public.fase1_business_date(coalesce(p_fecha_movimiento,now())));
 RETURN to_jsonb(v_turno);
END $$;

CREATE OR REPLACE FUNCTION public.registrar_movimiento_caja_atomico(p_hotel_id uuid,p_usuario_id uuid,p_turno_id uuid,p_tipo text,p_monto numeric,p_concepto text,p_metodo_pago_id uuid,p_fecha_movimiento timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_turno public.turnos%rowtype; v_mov public.caja%rowtype;
BEGIN
 IF auth.uid() IS NULL OR p_usuario_id<>auth.uid() OR NOT public.fase1_actor_es_miembro_activo(p_hotel_id) THEN RAISE EXCEPTION 'Actor/hotel no autorizado' USING ERRCODE='42501'; END IF;
 IF p_tipo NOT IN('ingreso','egreso','ajuste') OR p_monto IS NULL OR p_monto<=0 OR btrim(coalesce(p_concepto,''))='' THEN RAISE EXCEPTION 'Movimiento invalido' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_turno FROM public.turnos WHERE id=p_turno_id;
 IF NOT FOUND OR v_turno.hotel_id<>p_hotel_id OR v_turno.usuario_id<>auth.uid() OR v_turno.estado<>'abierto' THEN RAISE EXCEPTION 'Turno activo propio requerido' USING ERRCODE='42501'; END IF;
 IF p_metodo_pago_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.metodos_pago WHERE id=p_metodo_pago_id AND hotel_id=p_hotel_id AND activo) THEN RAISE EXCEPTION 'Metodo invalido' USING ERRCODE='23503'; END IF;
 INSERT INTO public.caja(hotel_id,usuario_id,turno_id,tipo,monto,concepto,metodo_pago_id,fecha_movimiento,source,business_date) VALUES(p_hotel_id,auth.uid(),p_turno_id,p_tipo::public.tipo_movimiento_caja_enum,p_monto,p_concepto,p_metodo_pago_id,coalesce(p_fecha_movimiento,now()),'manual_cash',public.fase1_business_date(coalesce(p_fecha_movimiento,now()))) RETURNING * INTO v_mov;
 RETURN to_jsonb(v_mov);
END $$;

CREATE OR REPLACE FUNCTION public.ajustar_stock_tienda_seguro(p_producto_id uuid,p_delta integer,p_reason text,p_client_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_p public.productos_tienda%rowtype; v_new int;
BEGIN
 IF auth.uid() IS NULL OR p_delta=0 OR p_client_operation_id IS NULL OR btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'Payload invalido' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_p FROM public.productos_tienda WHERE id=p_producto_id FOR UPDATE;
 IF NOT FOUND OR NOT public.fase1_actor_tiene_permiso(v_p.hotel_id,'inventario.ajustar') THEN RAISE EXCEPTION 'Producto/hotel no autorizado' USING ERRCODE='42501'; END IF;
 v_new:=v_p.stock_actual+p_delta; IF v_new<0 THEN RAISE EXCEPTION 'Stock insuficiente' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.auditoria_operaciones WHERE hotel_id=v_p.hotel_id AND accion='inventario.ajustar' AND client_operation_id=p_client_operation_id) THEN RETURN jsonb_build_object('producto_id',v_p.id,'stock_actual',v_p.stock_actual,'idempotent',true); END IF;
 UPDATE public.productos_tienda SET stock_actual=v_new,actualizado_en=now() WHERE id=v_p.id;
 INSERT INTO public.movimientos_inventario(hotel_id,producto_id,tipo_movimiento,cantidad,razon,usuario_responsable,stock_anterior,stock_nuevo,usuario_id,notas) VALUES(v_p.hotel_id,v_p.id,CASE WHEN p_delta>0 THEN 'INGRESO' ELSE 'SALIDA' END,abs(p_delta),p_reason,auth.uid()::text,v_p.stock_actual,v_new,auth.uid(),'fase1 ajuste seguro');
 INSERT INTO public.auditoria_operaciones(hotel_id,actor_id,accion,entidad,entity_id,before_data,after_data,reason,client_operation_id) VALUES(v_p.hotel_id,auth.uid(),'inventario.ajustar','productos_tienda',v_p.id,jsonb_build_object('stock_actual',v_p.stock_actual),jsonb_build_object('stock_actual',v_new),p_reason,p_client_operation_id);
 RETURN jsonb_build_object('producto_id',v_p.id,'stock_actual',v_new,'idempotent',false);
END $$;

DO $$ DECLARE sig regprocedure; BEGIN
 FOREACH sig IN ARRAY ARRAY[
  'public.abrir_turno_con_apertura(uuid,uuid,numeric,timestamptz)'::regprocedure,
  'public.registrar_movimiento_caja_atomico(uuid,uuid,uuid,text,numeric,text,uuid,timestamptz)'::regprocedure,
  'public.ajustar_stock_tienda_seguro(uuid,integer,text,uuid)'::regprocedure
 ] LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon',sig); EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',sig); END LOOP;
END $$;
