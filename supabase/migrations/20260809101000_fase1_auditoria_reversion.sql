-- Fase 1 / 02: auditoria uniforme y reversion financiera sin DELETE.
-- Dependencias: fase1_authz_rls_base, caja.
-- Riesgo: cambia la semantica de anulacion para operaciones nuevas.
-- Rollback logico: desactivar caller nuevo; conservar tablas/filas de auditoria y reversion.
-- Tests: fase1-security-migrations.test.cjs.

CREATE TABLE IF NOT EXISTS public.auditoria_operaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  accion text NOT NULL,
  entidad text NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  reason text,
  client_operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auditoria_operaciones_accion_not_blank CHECK (btrim(accion) <> ''),
  CONSTRAINT auditoria_operaciones_entidad_not_blank CHECK (btrim(entidad) <> '')
);
ALTER TABLE public.auditoria_operaciones ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS auditoria_operaciones_hotel_fecha_idx ON public.auditoria_operaciones(hotel_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS auditoria_operaciones_request_uq
ON public.auditoria_operaciones(hotel_id, accion, client_operation_id)
WHERE client_operation_id IS NOT NULL;
DROP POLICY IF EXISTS fase1_auditoria_select ON public.auditoria_operaciones;
CREATE POLICY fase1_auditoria_select ON public.auditoria_operaciones FOR SELECT TO authenticated
USING (public.fase1_actor_tiene_permiso(hotel_id,'finanzas.ver'));

CREATE TABLE IF NOT EXISTS public.caja_reversiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
  original_movement_id uuid NOT NULL REFERENCES public.caja(id) ON DELETE RESTRICT,
  reversal_movement_id uuid NOT NULL UNIQUE REFERENCES public.caja(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  client_operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, original_movement_id),
  UNIQUE (hotel_id, client_operation_id),
  CHECK (btrim(reason) <> '')
);
ALTER TABLE public.caja_reversiones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fase1_caja_reversiones_select ON public.caja_reversiones;
CREATE POLICY fase1_caja_reversiones_select ON public.caja_reversiones FOR SELECT TO authenticated
USING (public.fase1_actor_tiene_permiso(hotel_id,'finanzas.ver'));

ALTER TABLE public.caja ADD COLUMN IF NOT EXISTS original_movement_id uuid REFERENCES public.caja(id) ON DELETE RESTRICT;
ALTER TABLE public.caja ADD COLUMN IF NOT EXISTS client_operation_id uuid;
ALTER TABLE public.caja ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.caja ADD COLUMN IF NOT EXISTS business_date date;
CREATE UNIQUE INDEX IF NOT EXISTS caja_source_operation_uq
ON public.caja(hotel_id, source, client_operation_id)
WHERE client_operation_id IS NOT NULL AND source IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fase1_business_date(p_occurred_at timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$ SELECT (p_occurred_at AT TIME ZONE 'America/Bogota')::date $$;

CREATE OR REPLACE FUNCTION public.revertir_movimiento_caja(
  p_original_movement_id uuid,
  p_reason text,
  p_client_operation_id uuid,
  p_approved_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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
  IF p_approved_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.usuarios u WHERE u.id=p_approved_by AND u.activo AND u.hotel_id=v_original.hotel_id
  ) THEN RAISE EXCEPTION 'Aprobador invalido para el hotel' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_existing FROM public.caja_reversiones
  WHERE hotel_id=v_original.hotel_id AND client_operation_id=p_client_operation_id;
  IF FOUND THEN
    RETURN (SELECT jsonb_build_object('reversal_id',r.reversal_movement_id,'idempotent',true) FROM public.caja_reversiones r WHERE r.id=v_existing.id);
  END IF;
  IF EXISTS (SELECT 1 FROM public.caja_reversiones WHERE original_movement_id=v_original.id) THEN
    RAISE EXCEPTION 'El movimiento ya fue revertido' USING ERRCODE='23505';
  END IF;
  INSERT INTO public.caja(hotel_id,tipo,monto,concepto,fecha_movimiento,metodo_pago_id,usuario_id,reserva_id,pago_reserva_id,venta_tienda_id,turno_id,venta_restaurante_id,venta_terraza_id,reserva_terraza_id,original_movement_id,client_operation_id,source,business_date)
  VALUES(v_original.hotel_id,CASE WHEN v_original.tipo='ingreso' THEN 'egreso'::public.tipo_movimiento_caja_enum ELSE 'ingreso'::public.tipo_movimiento_caja_enum END,v_original.monto,'Reversion: '||p_reason,now(),v_original.metodo_pago_id,auth.uid(),v_original.reserva_id,v_original.pago_reserva_id,v_original.venta_tienda_id,v_original.turno_id,v_original.venta_restaurante_id,v_original.venta_terraza_id,v_original.reserva_terraza_id,v_original.id,p_client_operation_id,'caja_reversal',public.fase1_business_date(now()))
  RETURNING * INTO v_reversal;
  INSERT INTO public.caja_reversiones(hotel_id,original_movement_id,reversal_movement_id,reason,created_by,approved_by,client_operation_id)
  VALUES(v_original.hotel_id,v_original.id,v_reversal.id,p_reason,auth.uid(),p_approved_by,p_client_operation_id);
  INSERT INTO public.auditoria_operaciones(hotel_id,actor_id,accion,entidad,entity_id,before_data,after_data,reason,client_operation_id)
  VALUES(v_original.hotel_id,auth.uid(),'caja.revertir','caja',v_original.id,to_jsonb(v_original),to_jsonb(v_reversal),p_reason,p_client_operation_id);
  RETURN jsonb_build_object('original_id',v_original.id,'reversal_id',v_reversal.id,'idempotent',false);
END $$;

REVOKE ALL ON TABLE public.auditoria_operaciones, public.caja_reversiones FROM anon, authenticated;
GRANT SELECT ON TABLE public.auditoria_operaciones, public.caja_reversiones TO authenticated;
REVOKE ALL ON FUNCTION public.revertir_movimiento_caja(uuid,text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revertir_movimiento_caja(uuid,text,uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancelar_reserva_con_reversion(
  p_reserva_id uuid, p_reason text, p_client_operation_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_reserva public.reservas%rowtype; v_mov public.caja%rowtype; v_reversal public.caja%rowtype; v_count int:=0;
BEGIN
  IF auth.uid() IS NULL OR p_client_operation_id IS NULL OR btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'Autenticacion, motivo y operacion requeridos' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_reserva FROM public.reservas WHERE id=p_reserva_id FOR UPDATE;
  IF NOT FOUND OR NOT public.fase1_actor_tiene_permiso(v_reserva.hotel_id,'finanzas.revertir') THEN RAISE EXCEPTION 'Reserva inexistente o sin permiso' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.auditoria_operaciones WHERE hotel_id=v_reserva.hotel_id AND accion='reserva.cancelar' AND client_operation_id=p_client_operation_id) THEN RETURN jsonb_build_object('reserva_id',v_reserva.id,'idempotent',true); END IF;
  FOR v_mov IN SELECT c.* FROM public.caja c JOIN public.pagos_reserva p ON p.id=c.pago_reserva_id WHERE p.reserva_id=v_reserva.id AND c.hotel_id=v_reserva.hotel_id AND NOT EXISTS(SELECT 1 FROM public.caja_reversiones cr WHERE cr.original_movement_id=c.id) FOR UPDATE OF c LOOP
    INSERT INTO public.caja(hotel_id,tipo,monto,concepto,fecha_movimiento,metodo_pago_id,usuario_id,reserva_id,pago_reserva_id,turno_id,original_movement_id,client_operation_id,source,business_date)
    VALUES(v_reserva.hotel_id,'egreso',v_mov.monto,'Reversion por cancelacion: '||p_reason,now(),v_mov.metodo_pago_id,auth.uid(),v_reserva.id,v_mov.pago_reserva_id,v_mov.turno_id,v_mov.id,gen_random_uuid(),'reservation_cancel_reversal',public.fase1_business_date(now())) RETURNING * INTO v_reversal;
    INSERT INTO public.caja_reversiones(hotel_id,original_movement_id,reversal_movement_id,reason,created_by,client_operation_id) VALUES(v_reserva.hotel_id,v_mov.id,v_reversal.id,p_reason,auth.uid(),v_reversal.client_operation_id);
    v_count:=v_count+1;
  END LOOP;
  UPDATE public.reservas SET estado='cancelada',actualizado_en=now(),cancelado_por_usuario_id=auth.uid(),fecha_cancelacion=now() WHERE id=v_reserva.id;
  UPDATE public.habitaciones SET estado='libre' WHERE id=v_reserva.habitacion_id AND hotel_id=v_reserva.hotel_id;
  INSERT INTO public.auditoria_operaciones(hotel_id,actor_id,accion,entidad,entity_id,before_data,after_data,reason,client_operation_id) VALUES(v_reserva.hotel_id,auth.uid(),'reserva.cancelar','reservas',v_reserva.id,to_jsonb(v_reserva),jsonb_build_object('estado','cancelada','reversiones',v_count),p_reason,p_client_operation_id);
  RETURN jsonb_build_object('reserva_id',v_reserva.id,'reversiones',v_count,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.cancelar_reserva_con_reversion(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancelar_reserva_con_reversion(uuid,text,uuid) TO authenticated,service_role;
