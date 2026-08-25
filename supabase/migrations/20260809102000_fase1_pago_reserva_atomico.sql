-- Fase 1 / 03: pago de reserva atomico, idempotente y tenant-safe.
-- Dependencias: authz base, auditoria/reversion, turnos, metodos_pago.
-- Riesgo: callers deben enviar turno activo y UUID de operacion estable.
-- Rollback logico: desactivar feature flag; columnas son aditivas y no se borran.
-- Tests: fase1-rpc-contracts.test.cjs; branch/staging con reintento y rollback.

ALTER TABLE public.pagos_reserva ADD COLUMN IF NOT EXISTS client_operation_id uuid;
ALTER TABLE public.pagos_reserva ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.pagos_reserva ADD COLUMN IF NOT EXISTS business_date date;
CREATE UNIQUE INDEX IF NOT EXISTS pagos_reserva_source_operation_uq
ON public.pagos_reserva(hotel_id, source, client_operation_id)
WHERE client_operation_id IS NOT NULL AND source IS NOT NULL;

CREATE OR REPLACE FUNCTION public.procesar_pago_reserva_atomico(
  p_reserva_id uuid,
  p_monto numeric,
  p_metodo_pago_id uuid,
  p_turno_id uuid,
  p_client_operation_id uuid,
  p_occurred_at timestamptz DEFAULT now(),
  p_concepto text DEFAULT 'Pago de reserva'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_reserva public.reservas%rowtype; v_turno public.turnos%rowtype; v_pago public.pagos_reserva%rowtype; v_caja public.caja%rowtype; v_total numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticacion requerida' USING ERRCODE='42501'; END IF;
  IF p_monto IS NULL OR p_monto<=0 OR p_client_operation_id IS NULL THEN
    RAISE EXCEPTION 'Monto positivo y client_operation_id son obligatorios' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_reserva FROM public.reservas WHERE id=p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva no encontrada' USING ERRCODE='P0002'; END IF;
  IF NOT public.fase1_actor_es_miembro_activo(v_reserva.hotel_id) THEN RAISE EXCEPTION 'Reserva fuera del hotel autorizado' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_pago FROM public.pagos_reserva WHERE hotel_id=v_reserva.hotel_id AND source='reservation_payment' AND client_operation_id=p_client_operation_id;
  IF FOUND THEN
    SELECT * INTO v_caja FROM public.caja WHERE pago_reserva_id=v_pago.id AND source='reservation_payment';
    RETURN jsonb_build_object('pago_id',v_pago.id,'caja_id',v_caja.id,'idempotent',true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.metodos_pago m WHERE m.id=p_metodo_pago_id AND m.hotel_id=v_reserva.hotel_id AND m.activo) THEN
    RAISE EXCEPTION 'Metodo de pago invalido para el hotel' USING ERRCODE='23503';
  END IF;
  SELECT * INTO v_turno FROM public.turnos WHERE id=p_turno_id FOR UPDATE;
  IF NOT FOUND OR v_turno.hotel_id IS DISTINCT FROM v_reserva.hotel_id OR v_turno.usuario_id IS DISTINCT FROM auth.uid() OR v_turno.estado<>'abierto' OR v_turno.fecha_cierre IS NOT NULL THEN
    RAISE EXCEPTION 'Turno activo propio del hotel requerido' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.pagos_reserva(hotel_id,reserva_id,monto,fecha_pago,metodo_pago_id,usuario_id,concepto,client_operation_id,source,business_date)
  VALUES(v_reserva.hotel_id,v_reserva.id,p_monto,coalesce(p_occurred_at,now()),p_metodo_pago_id,auth.uid(),p_concepto,p_client_operation_id,'reservation_payment',public.fase1_business_date(coalesce(p_occurred_at,now())))
  RETURNING * INTO v_pago;
  INSERT INTO public.caja(hotel_id,tipo,monto,concepto,fecha_movimiento,metodo_pago_id,usuario_id,reserva_id,pago_reserva_id,turno_id,client_operation_id,source,business_date)
  VALUES(v_reserva.hotel_id,'ingreso',p_monto,p_concepto,coalesce(p_occurred_at,now()),p_metodo_pago_id,auth.uid(),v_reserva.id,v_pago.id,v_turno.id,p_client_operation_id,'reservation_payment',public.fase1_business_date(coalesce(p_occurred_at,now())))
  RETURNING * INTO v_caja;
  SELECT coalesce(sum(p.monto),0) INTO v_total FROM public.pagos_reserva p WHERE p.reserva_id=v_reserva.id;
  UPDATE public.reservas SET monto_pagado=v_total,actualizado_en=now() WHERE id=v_reserva.id;
  INSERT INTO public.auditoria_operaciones(hotel_id,actor_id,accion,entidad,entity_id,after_data,client_operation_id)
  VALUES(v_reserva.hotel_id,auth.uid(),'reserva.pago_crear','pagos_reserva',v_pago.id,jsonb_build_object('monto',p_monto,'caja_id',v_caja.id,'business_date',v_pago.business_date),p_client_operation_id);
  RETURN jsonb_build_object('pago_id',v_pago.id,'caja_id',v_caja.id,'monto_pagado',v_total,'business_date',v_pago.business_date,'idempotent',false);
END $$;

REVOKE ALL ON FUNCTION public.procesar_pago_reserva_atomico(uuid,numeric,uuid,uuid,uuid,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.procesar_pago_reserva_atomico(uuid,numeric,uuid,uuid,uuid,timestamptz,text) TO authenticated, service_role;
