-- Permite movimientos manuales fuera de turno cuando el cliente envia p_turno_id NULL.
-- Si se envia un turno, conserva la exigencia de que sea propio, del hotel y este abierto.
CREATE OR REPLACE FUNCTION public.registrar_movimiento_caja_atomico(
 p_hotel_id uuid,p_usuario_id uuid,p_turno_id uuid,p_tipo text,p_monto numeric,
 p_concepto text,p_metodo_pago_id uuid,p_fecha_movimiento timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_turno public.turnos%rowtype; v_mov public.caja%rowtype;
BEGIN
 IF auth.uid() IS NULL OR p_usuario_id IS DISTINCT FROM auth.uid() OR NOT public.fase1_actor_es_miembro_activo(p_hotel_id) THEN
   RAISE EXCEPTION 'Actor/hotel no autorizado' USING ERRCODE='42501';
 END IF;
 IF p_tipo NOT IN('ingreso','egreso','ajuste') OR p_monto IS NULL OR p_monto<=0 OR btrim(coalesce(p_concepto,''))='' THEN
   RAISE EXCEPTION 'Movimiento invalido' USING ERRCODE='22023';
 END IF;
 IF p_turno_id IS NOT NULL THEN
   SELECT * INTO v_turno FROM public.turnos WHERE id=p_turno_id;
   IF NOT FOUND OR v_turno.hotel_id IS DISTINCT FROM p_hotel_id OR v_turno.usuario_id IS DISTINCT FROM auth.uid() OR v_turno.estado<>'abierto' THEN
     RAISE EXCEPTION 'Turno activo propio requerido' USING ERRCODE='42501';
   END IF;
 END IF;
 IF p_metodo_pago_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.metodos_pago WHERE id=p_metodo_pago_id AND hotel_id=p_hotel_id AND activo IS TRUE
 ) THEN
   RAISE EXCEPTION 'Metodo invalido' USING ERRCODE='23503';
 END IF;
 INSERT INTO public.caja(hotel_id,usuario_id,turno_id,tipo,monto,concepto,metodo_pago_id,fecha_movimiento,source,business_date)
 VALUES(p_hotel_id,auth.uid(),p_turno_id,p_tipo::public.tipo_movimiento_caja_enum,p_monto,btrim(p_concepto),p_metodo_pago_id,
        coalesce(p_fecha_movimiento,now()),'manual_cash',public.fase1_business_date(coalesce(p_fecha_movimiento,now())))
 RETURNING * INTO v_mov;
 RETURN to_jsonb(v_mov);
END $$;

REVOKE ALL ON FUNCTION public.registrar_movimiento_caja_atomico(uuid,uuid,uuid,text,numeric,text,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.registrar_movimiento_caja_atomico(uuid,uuid,uuid,text,numeric,text,uuid,timestamptz) TO authenticated,service_role;
