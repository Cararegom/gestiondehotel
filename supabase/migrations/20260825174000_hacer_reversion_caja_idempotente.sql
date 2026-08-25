-- Una segunda solicitud sobre el mismo movimiento devuelve la reversión existente.
CREATE OR REPLACE FUNCTION public.revertir_movimiento_caja(
  p_original_movement_id uuid, p_reason text, p_client_operation_id uuid, p_approved_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_original public.caja%rowtype; v_reversal public.caja%rowtype; v_existing public.caja_reversiones%rowtype;
BEGIN
 IF auth.uid() IS NULL OR p_client_operation_id IS NULL OR btrim(coalesce(p_reason,''))='' THEN
   RAISE EXCEPTION 'Autenticacion, motivo y client_operation_id son obligatorios' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_original FROM public.caja WHERE id=p_original_movement_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Movimiento no encontrado' USING ERRCODE='P0002'; END IF;
 IF NOT public.fase1_actor_tiene_permiso(v_original.hotel_id,'finanzas.revertir') THEN
   RAISE EXCEPTION 'Sin permiso para revertir el movimiento' USING ERRCODE='42501';
 END IF;
 IF p_approved_by IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.usuarios u WHERE u.id=p_approved_by AND u.activo AND u.hotel_id=v_original.hotel_id
 ) THEN RAISE EXCEPTION 'Aprobador invalido para el hotel' USING ERRCODE='42501'; END IF;

 SELECT * INTO v_existing FROM public.caja_reversiones
 WHERE hotel_id=v_original.hotel_id
   AND (client_operation_id=p_client_operation_id OR original_movement_id=v_original.id)
 ORDER BY (client_operation_id=p_client_operation_id) DESC LIMIT 1;
 IF FOUND THEN
   RETURN jsonb_build_object('original_id',v_existing.original_movement_id,
     'reversal_id',v_existing.reversal_movement_id,'idempotent',true,'already_reverted',true);
 END IF;

 INSERT INTO public.caja(hotel_id,tipo,monto,concepto,fecha_movimiento,metodo_pago_id,usuario_id,reserva_id,pago_reserva_id,venta_tienda_id,turno_id,venta_restaurante_id,venta_terraza_id,reserva_terraza_id,original_movement_id,client_operation_id,source,business_date)
 VALUES(v_original.hotel_id,CASE WHEN v_original.tipo='ingreso' THEN 'egreso'::public.tipo_movimiento_caja_enum ELSE 'ingreso'::public.tipo_movimiento_caja_enum END,v_original.monto,'Reversion: '||p_reason,now(),v_original.metodo_pago_id,auth.uid(),v_original.reserva_id,v_original.pago_reserva_id,v_original.venta_tienda_id,v_original.turno_id,v_original.venta_restaurante_id,v_original.venta_terraza_id,v_original.reserva_terraza_id,v_original.id,p_client_operation_id,'caja_reversal',public.fase1_business_date(now()))
 RETURNING * INTO v_reversal;
 INSERT INTO public.caja_reversiones(hotel_id,original_movement_id,reversal_movement_id,reason,created_by,approved_by,client_operation_id)
 VALUES(v_original.hotel_id,v_original.id,v_reversal.id,p_reason,auth.uid(),p_approved_by,p_client_operation_id);
 INSERT INTO public.auditoria_operaciones(hotel_id,actor_id,accion,entidad,entity_id,before_data,after_data,reason,client_operation_id)
 VALUES(v_original.hotel_id,auth.uid(),'caja.revertir','caja',v_original.id,to_jsonb(v_original),to_jsonb(v_reversal),p_reason,p_client_operation_id);
 RETURN jsonb_build_object('original_id',v_original.id,'reversal_id',v_reversal.id,'idempotent',false,'already_reverted',false);
END $$;
REVOKE ALL ON FUNCTION public.revertir_movimiento_caja(uuid,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revertir_movimiento_caja(uuid,text,uuid,uuid) TO authenticated,service_role;
