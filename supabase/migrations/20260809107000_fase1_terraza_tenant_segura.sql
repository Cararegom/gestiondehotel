-- Fase 1 / 08: Terraza tenant-safe, sin UUID hardcodeado, y cobro mixto autenticado.
-- Dependencias: authz, auditoria, business_date.
-- Riesgo: reemplaza policies y funciones de cierre; validar reservas/anticipos/pagos mixtos en staging.
-- Rollback logico: restaurar definiciones 20260623/20260705; no reescribir datos.
-- Tests: fase1-security-migrations.test.cjs y fixtures Terraza.

DO $$ DECLARE t text; p record; BEGIN
 FOREACH t IN ARRAY ARRAY['terraza_configuracion','terraza_mesas','terraza_productos','terraza_pedidos','terraza_pedido_items','terraza_reservas'] LOOP
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',p.policyname,t); END LOOP;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.fase1_actor_es_miembro_activo(hotel_id))','fase1_'||t||'_select',t);
 END LOOP;
END $$;
CREATE POLICY fase1_terraza_pedidos_write ON public.terraza_pedidos FOR ALL TO authenticated USING(public.fase1_actor_tiene_permiso(hotel_id,'terraza.pedidos')) WITH CHECK(public.fase1_actor_tiene_permiso(hotel_id,'terraza.pedidos'));
CREATE POLICY fase1_terraza_items_write ON public.terraza_pedido_items FOR ALL TO authenticated USING(public.fase1_actor_tiene_permiso(hotel_id,'terraza.pedidos')) WITH CHECK(public.fase1_actor_tiene_permiso(hotel_id,'terraza.pedidos'));
CREATE POLICY fase1_terraza_reservas_write ON public.terraza_reservas FOR ALL TO authenticated USING(public.fase1_actor_tiene_permiso(hotel_id,'terraza.pedidos')) WITH CHECK(public.fase1_actor_tiene_permiso(hotel_id,'terraza.pedidos'));

CREATE OR REPLACE FUNCTION public.cerrar_pedido_terraza(p_pedido_id uuid,p_metodo_pago_id uuid,p_usuario_id uuid,p_turno_id uuid,p_propina_monto numeric DEFAULT 0,p_propina_sugerida_monto numeric DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_p record; v_r public.terraza_reservas%rowtype; v_t public.turnos%rowtype; v_item record; v_total numeric; v_tip numeric:=round(greatest(coalesce(p_propina_monto,0),0),2); v_advance numeric:=0; v_charge numeric; v_cash uuid; v_tip_cash uuid; v_concept text;
BEGIN
 IF auth.uid() IS NULL OR p_usuario_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Actor invalido' USING ERRCODE='42501'; END IF;
 SELECT p.*,m.numero mesa_numero,m.nombre mesa_nombre,m.tipo mesa_tipo INTO v_p FROM public.terraza_pedidos p JOIN public.terraza_mesas m ON m.id=p.mesa_id WHERE p.id=p_pedido_id FOR UPDATE OF p;
 IF NOT FOUND OR NOT public.fase1_actor_tiene_permiso(v_p.hotel_id,'terraza.cobrar') THEN RAISE EXCEPTION 'Pedido/hotel no autorizado' USING ERRCODE='42501'; END IF;
 IF v_p.estado<>'abierto' THEN RAISE EXCEPTION 'Pedido no abierto' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_t FROM public.turnos WHERE id=p_turno_id;
 IF NOT FOUND OR v_t.hotel_id<>v_p.hotel_id OR v_t.usuario_id<>auth.uid() OR v_t.estado<>'abierto' THEN RAISE EXCEPTION 'Turno activo propio requerido' USING ERRCODE='42501'; END IF;
 SELECT coalesce(sum(subtotal),0) INTO v_total FROM public.terraza_pedido_items WHERE pedido_id=v_p.id;
 IF v_total<=0 THEN RAISE EXCEPTION 'Pedido sin consumos' USING ERRCODE='23514'; END IF;
 IF v_p.reserva_terraza_id IS NOT NULL THEN SELECT * INTO v_r FROM public.terraza_reservas WHERE id=v_p.reserva_terraza_id AND hotel_id=v_p.hotel_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Reserva Terraza invalida' USING ERRCODE='23503'; END IF; v_advance:=least(v_total,greatest(v_r.anticipo_consumible-v_r.saldo_consumido,0)); END IF;
 v_charge:=greatest(v_total-v_advance,0);
 IF (v_charge+v_tip)>0 AND NOT EXISTS(SELECT 1 FROM public.metodos_pago m WHERE m.id=p_metodo_pago_id AND m.hotel_id=v_p.hotel_id AND m.activo) THEN RAISE EXCEPTION 'Metodo invalido' USING ERRCODE='23503'; END IF;
 FOR v_item IN SELECT i.producto_id,max(i.producto_nombre) nombre,sum(i.cantidad)::int cantidad,p.stock_actual FROM public.terraza_pedido_items i JOIN public.terraza_productos p ON p.id=i.producto_id WHERE i.pedido_id=v_p.id AND i.producto_id IS NOT NULL GROUP BY i.producto_id,p.stock_actual FOR UPDATE OF p LOOP
  IF v_item.stock_actual<v_item.cantidad THEN RAISE EXCEPTION 'Stock insuficiente en Terraza para %',v_item.nombre USING ERRCODE='23514'; END IF;
  UPDATE public.terraza_productos SET stock_actual=stock_actual-v_item.cantidad,actualizado_en=now() WHERE id=v_item.producto_id;
 END LOOP;
 v_concept:=left('Terraza '||coalesce(v_p.mesa_nombre,v_p.mesa_numero::text)||CASE WHEN v_advance>0 THEN ' | Anticipo '||v_advance ELSE '' END,250);
 UPDATE public.terraza_pedidos SET estado='pagado',total=v_total,propina_sugerida_monto=greatest(coalesce(p_propina_sugerida_monto,0),0),propina_monto=v_tip,metodo_pago_id=p_metodo_pago_id,turno_id=v_t.id,usuario_id=auth.uid(),fecha_cierre=now(),actualizado_en=now() WHERE id=v_p.id;
 IF v_p.reserva_terraza_id IS NOT NULL THEN UPDATE public.terraza_reservas SET estado='completada',pedido_id=v_p.id,saldo_consumido=least(anticipo_consumible,saldo_consumido+v_advance),actualizado_en=now() WHERE id=v_p.reserva_terraza_id; END IF;
 IF v_charge>0 THEN INSERT INTO public.caja(hotel_id,usuario_id,turno_id,tipo,monto,metodo_pago_id,concepto,venta_terraza_id,source,business_date) VALUES(v_p.hotel_id,auth.uid(),v_t.id,'ingreso',v_charge,p_metodo_pago_id,v_concept,v_p.id,'terrace_sale',public.fase1_business_date(now())) RETURNING id INTO v_cash; END IF;
 IF v_tip>0 THEN INSERT INTO public.caja(hotel_id,usuario_id,turno_id,tipo,monto,metodo_pago_id,concepto,venta_terraza_id,source,business_date) VALUES(v_p.hotel_id,auth.uid(),v_t.id,'ingreso',v_tip,p_metodo_pago_id,'Propina voluntaria - Terraza',v_p.id,'terrace_tip',public.fase1_business_date(now())) RETURNING id INTO v_tip_cash; END IF;
 RETURN jsonb_build_object('success',true,'pedido_id',v_p.id,'caja_id',v_cash,'caja_propina_id',v_tip_cash,'total',v_total,'anticipo_aplicado',v_advance,'saldo_consumo_cobrado',v_charge,'propina_monto',v_tip,'total_cobrado',v_charge+v_tip);
END $$;

CREATE OR REPLACE FUNCTION public.cerrar_pedido_terraza_mixto(p_pedido_id uuid,p_usuario_id uuid,p_turno_id uuid,p_pagos jsonb,p_propina_monto numeric DEFAULT 0,p_propina_sugerida_monto numeric DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_pago jsonb; v_method uuid; v_amount numeric; v_total numeric:=0; v_first uuid; v_result jsonb; v_consumption numeric; v_tip numeric; v_remain numeric; v_alloc numeric; v_cash uuid; v_tip_cash uuid; v_first_consumption boolean:=true; v_first_tip boolean:=true; v_hotel uuid;
BEGIN
 IF auth.uid() IS NULL OR p_usuario_id<>auth.uid() OR jsonb_typeof(p_pagos)<>'array' OR jsonb_array_length(p_pagos)<2 THEN RAISE EXCEPTION 'Pago mixto/actor invalido' USING ERRCODE='22023'; END IF;
 SELECT hotel_id INTO v_hotel FROM public.terraza_pedidos WHERE id=p_pedido_id;
 IF v_hotel IS NULL OR NOT public.fase1_actor_tiene_permiso(v_hotel,'terraza.cobrar') THEN RAISE EXCEPTION 'Pedido no autorizado' USING ERRCODE='42501'; END IF;
 IF (SELECT count(DISTINCT value->>'metodo_pago_id') FROM jsonb_array_elements(p_pagos))<>jsonb_array_length(p_pagos) THEN RAISE EXCEPTION 'Metodos repetidos' USING ERRCODE='23514'; END IF;
 FOR v_pago IN SELECT value FROM jsonb_array_elements(p_pagos) LOOP v_method:=(v_pago->>'metodo_pago_id')::uuid; v_amount:=(v_pago->>'monto')::numeric; IF v_amount<=0 OR NOT EXISTS(SELECT 1 FROM public.metodos_pago m WHERE m.id=v_method AND m.hotel_id=v_hotel AND m.activo) THEN RAISE EXCEPTION 'Pago invalido' USING ERRCODE='22023'; END IF; v_first:=coalesce(v_first,v_method); v_total:=v_total+v_amount; END LOOP;
 v_result:=public.cerrar_pedido_terraza(p_pedido_id,v_first,auth.uid(),p_turno_id,p_propina_monto,p_propina_sugerida_monto);
 IF round(v_total,2)<>round((v_result->>'total_cobrado')::numeric,2) THEN RAISE EXCEPTION 'Pagos no coinciden con total' USING ERRCODE='23514'; END IF;
 v_consumption:=coalesce((v_result->>'saldo_consumo_cobrado')::numeric,0); v_tip:=coalesce((v_result->>'propina_monto')::numeric,0); v_cash:=(v_result->>'caja_id')::uuid; v_tip_cash:=(v_result->>'caja_propina_id')::uuid;
 FOR v_pago IN SELECT value FROM jsonb_array_elements(p_pagos) LOOP v_method:=(v_pago->>'metodo_pago_id')::uuid; v_remain:=(v_pago->>'monto')::numeric;
  IF v_consumption>0 AND v_remain>0 THEN v_alloc:=least(v_remain,v_consumption); IF v_first_consumption THEN UPDATE public.caja SET monto=v_alloc,metodo_pago_id=v_method,source='terrace_sale_mixed' WHERE id=v_cash; v_first_consumption:=false; ELSE INSERT INTO public.caja(hotel_id,usuario_id,turno_id,tipo,monto,metodo_pago_id,concepto,venta_terraza_id,source,business_date) SELECT hotel_id,usuario_id,turno_id,tipo,v_alloc,v_method,concepto,venta_terraza_id,'terrace_sale_mixed',business_date FROM public.caja WHERE id=v_cash; END IF; v_consumption:=v_consumption-v_alloc; v_remain:=v_remain-v_alloc; END IF;
  IF v_tip>0 AND v_remain>0 THEN v_alloc:=least(v_remain,v_tip); IF v_first_tip THEN UPDATE public.caja SET monto=v_alloc,metodo_pago_id=v_method,source='terrace_tip_mixed' WHERE id=v_tip_cash; v_first_tip:=false; ELSE INSERT INTO public.caja(hotel_id,usuario_id,turno_id,tipo,monto,metodo_pago_id,concepto,venta_terraza_id,source,business_date) SELECT hotel_id,usuario_id,turno_id,tipo,v_alloc,v_method,concepto,venta_terraza_id,'terrace_tip_mixed',business_date FROM public.caja WHERE id=v_tip_cash; END IF; v_tip:=v_tip-v_alloc; v_remain:=v_remain-v_alloc; END IF;
  IF abs(v_remain)>=0.01 THEN RAISE EXCEPTION 'No se pudo distribuir pago' USING ERRCODE='23514'; END IF;
 END LOOP;
 UPDATE public.terraza_pedidos SET metodo_pago_id=NULL,pagos_mixtos=p_pagos,actualizado_en=now() WHERE id=p_pedido_id;
 RETURN (v_result-'caja_id'-'caja_propina_id')||jsonb_build_object('pago_mixto',true,'pagos',p_pagos);
END $$;
REVOKE ALL ON FUNCTION public.cerrar_pedido_terraza(uuid,uuid,uuid,uuid,numeric,numeric),public.cerrar_pedido_terraza_mixto(uuid,uuid,uuid,jsonb,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cerrar_pedido_terraza(uuid,uuid,uuid,uuid,numeric,numeric),public.cerrar_pedido_terraza_mixto(uuid,uuid,uuid,jsonb,numeric,numeric) TO authenticated,service_role;
