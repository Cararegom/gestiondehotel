-- Liquida consumos de una reserva sin reabrir UPDATE directo al navegador.
CREATE OR REPLACE FUNCTION public.liquidar_consumos_reserva_atomico(p_reserva_id uuid, p_pago_reserva_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_reserva public.reservas%rowtype; v_pago public.pagos_reserva%rowtype;
 v_servicios integer:=0; v_tienda integer:=0; v_restaurante integer:=0;
BEGIN
 IF auth.uid() IS NULL OR p_reserva_id IS NULL OR p_pago_reserva_id IS NULL THEN
   RAISE EXCEPTION 'Autenticacion, reserva y pago son obligatorios' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_reserva FROM public.reservas WHERE id=p_reserva_id FOR UPDATE;
 IF NOT FOUND OR NOT public.fase1_actor_es_miembro_activo(v_reserva.hotel_id) THEN
   RAISE EXCEPTION 'Reserva fuera del hotel autorizado' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_pago FROM public.pagos_reserva
 WHERE id=p_pago_reserva_id AND reserva_id=v_reserva.id AND hotel_id=v_reserva.hotel_id
   AND usuario_id=auth.uid() AND source='reservation_payment' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'El pago no corresponde a esta reserva o usuario' USING ERRCODE='42501'; END IF;

 UPDATE public.servicios_x_reserva SET estado_pago='pagado',pago_reserva_id=v_pago.id
 WHERE hotel_id=v_reserva.hotel_id AND reserva_id=v_reserva.id AND estado_pago IS DISTINCT FROM 'pagado';
 GET DIAGNOSTICS v_servicios=ROW_COUNT;
 UPDATE public.ventas_tienda SET estado_pago='pagado',actualizado_en=now()
 WHERE hotel_id=v_reserva.hotel_id AND reserva_id=v_reserva.id AND estado_pago IS DISTINCT FROM 'pagado';
 GET DIAGNOSTICS v_tienda=ROW_COUNT;
 UPDATE public.ventas_restaurante SET estado_pago='pagado'
 WHERE hotel_id=v_reserva.hotel_id AND reserva_id=v_reserva.id AND estado_pago IS DISTINCT FROM 'pagado';
 GET DIAGNOSTICS v_restaurante=ROW_COUNT;

 INSERT INTO public.auditoria_operaciones(hotel_id,actor_id,accion,entidad,entity_id,after_data,client_operation_id)
 VALUES(v_reserva.hotel_id,auth.uid(),'reserva.consumos_liquidar','reservas',v_reserva.id,
   jsonb_build_object('pago_reserva_id',v_pago.id,'servicios',v_servicios,'ventas_tienda',v_tienda,'ventas_restaurante',v_restaurante),
   v_pago.client_operation_id) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('reserva_id',v_reserva.id,'pago_reserva_id',v_pago.id,
   'servicios',v_servicios,'ventas_tienda',v_tienda,'ventas_restaurante',v_restaurante);
END $$;
REVOKE ALL ON FUNCTION public.liquidar_consumos_reserva_atomico(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.liquidar_consumos_reserva_atomico(uuid,uuid) TO authenticated,service_role;
