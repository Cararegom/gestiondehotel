-- Fase 1 / 07: arqueo persistido por metodo y cierre auditado.
-- Dependencias: authz, auditoria, business_date.
-- Riesgo: nuevo caller debe enviar detalle completo del conteo.
-- Rollback logico: volver al RPC de cierre anterior antes de revocarlo.
-- Tests: fase1-rpc-contracts.test.cjs y business-date fixtures.

CREATE TABLE IF NOT EXISTS public.turno_arqueos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 turno_id uuid NOT NULL REFERENCES public.turnos(id) ON DELETE RESTRICT,
 hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
 metodo_pago_id uuid NOT NULL REFERENCES public.metodos_pago(id) ON DELETE RESTRICT,
 expected_amount numeric NOT NULL,
 counted_amount numeric NOT NULL,
 difference numeric GENERATED ALWAYS AS (counted_amount-expected_amount) STORED,
 note text,
 counted_by uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
 counted_at timestamptz NOT NULL DEFAULT now(),
 approved_by uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
 client_operation_id uuid NOT NULL,
 UNIQUE(turno_id,metodo_pago_id), UNIQUE(hotel_id,client_operation_id,metodo_pago_id),
 CHECK(expected_amount>=0), CHECK(counted_amount>=0)
);
ALTER TABLE public.turno_arqueos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fase1_turno_arqueos_select ON public.turno_arqueos;
CREATE POLICY fase1_turno_arqueos_select ON public.turno_arqueos FOR SELECT TO authenticated
USING(public.fase1_actor_tiene_permiso(hotel_id,'finanzas.ver') OR EXISTS(SELECT 1 FROM public.turnos t WHERE t.id=turno_id AND t.usuario_id=auth.uid() AND t.hotel_id=turno_arqueos.hotel_id));

CREATE OR REPLACE FUNCTION public.cerrar_turno_con_arqueo(p_turno_id uuid,p_arqueos jsonb,p_client_operation_id uuid,p_fecha_cierre timestamptz DEFAULT now(),p_approved_by uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_t public.turnos%rowtype; v_a jsonb; v_method uuid; v_counted numeric; v_expected numeric; v_total numeric:=0; v_existing int;
BEGIN
 IF auth.uid() IS NULL OR p_client_operation_id IS NULL OR jsonb_typeof(p_arqueos)<>'array' OR jsonb_array_length(p_arqueos)=0 THEN RAISE EXCEPTION 'Payload de arqueo invalido' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_t FROM public.turnos WHERE id=p_turno_id FOR UPDATE;
 IF NOT FOUND OR NOT public.fase1_actor_es_miembro_activo(v_t.hotel_id) THEN RAISE EXCEPTION 'Turno fuera del hotel autorizado' USING ERRCODE='42501'; END IF;
 IF v_t.usuario_id<>auth.uid() AND NOT public.fase1_actor_tiene_permiso(v_t.hotel_id,'finanzas.cerrar_turno') THEN RAISE EXCEPTION 'Sin permiso para cerrar turno ajeno' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO v_existing FROM public.turno_arqueos WHERE turno_id=v_t.id AND client_operation_id=p_client_operation_id;
 IF v_t.estado='cerrado' AND v_existing>0 THEN RETURN jsonb_build_object('turno_id',v_t.id,'idempotent',true); END IF;
 IF v_t.estado<>'abierto' OR v_t.fecha_cierre IS NOT NULL THEN RAISE EXCEPTION 'Turno no esta abierto' USING ERRCODE='23514'; END IF;
 IF p_approved_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.usuarios u WHERE u.id=p_approved_by AND u.hotel_id=v_t.hotel_id AND u.activo) THEN RAISE EXCEPTION 'Aprobador invalido' USING ERRCODE='42501'; END IF;
 FOR v_a IN SELECT value FROM jsonb_array_elements(p_arqueos) LOOP
  v_method:=(v_a->>'metodo_pago_id')::uuid; v_counted:=(v_a->>'counted_amount')::numeric;
  IF v_counted<0 OR NOT EXISTS(SELECT 1 FROM public.metodos_pago m WHERE m.id=v_method AND m.hotel_id=v_t.hotel_id) THEN RAISE EXCEPTION 'Metodo/conteo invalido' USING ERRCODE='22023'; END IF;
  SELECT greatest(coalesce(sum(CASE WHEN c.tipo IN('ingreso','apertura') THEN c.monto WHEN c.tipo='egreso' THEN -c.monto ELSE 0 END),0),0) INTO v_expected FROM public.caja c WHERE c.turno_id=v_t.id AND c.metodo_pago_id IS NOT DISTINCT FROM v_method;
  INSERT INTO public.turno_arqueos(turno_id,hotel_id,metodo_pago_id,expected_amount,counted_amount,note,counted_by,counted_at,approved_by,client_operation_id)
  VALUES(v_t.id,v_t.hotel_id,v_method,v_expected,v_counted,nullif(btrim(v_a->>'note'),''),auth.uid(),coalesce(p_fecha_cierre,now()),p_approved_by,p_client_operation_id);
  v_total:=v_total+v_counted;
 END LOOP;
 UPDATE public.turnos SET estado='cerrado',fecha_cierre=coalesce(p_fecha_cierre,now()),balance_final=v_total WHERE id=v_t.id;
 INSERT INTO public.auditoria_operaciones(hotel_id,actor_id,accion,entidad,entity_id,before_data,after_data,reason,client_operation_id) VALUES(v_t.hotel_id,auth.uid(),'turno.cerrar','turnos',v_t.id,to_jsonb(v_t),jsonb_build_object('balance_final',v_total,'business_date',public.fase1_business_date(coalesce(p_fecha_cierre,now()))),'Cierre con arqueo persistido',p_client_operation_id);
 RETURN jsonb_build_object('turno_id',v_t.id,'balance_final',v_total,'business_date',public.fase1_business_date(coalesce(p_fecha_cierre,now())),'idempotent',false);
END $$;
REVOKE ALL ON TABLE public.turno_arqueos FROM anon,authenticated;
GRANT SELECT ON public.turno_arqueos TO authenticated;
REVOKE ALL ON FUNCTION public.cerrar_turno_con_arqueo(uuid,jsonb,uuid,timestamptz,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cerrar_turno_con_arqueo(uuid,jsonb,uuid,timestamptz,uuid) TO authenticated,service_role;
