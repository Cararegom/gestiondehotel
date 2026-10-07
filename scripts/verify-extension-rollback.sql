-- Runs against staging or production without leaving hotels, users, or payments.
CREATE TEMP TABLE extension_verification_result(result jsonb) ON COMMIT DROP;
DO $verify$
DECLARE
  v_hotel uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_room uuid := gen_random_uuid();
  v_reserva uuid := gen_random_uuid();
  v_shift uuid := gen_random_uuid();
  v_method uuid := gen_random_uuid();
  v_operation uuid := gen_random_uuid();
  v_first jsonb;
  v_retry jsonb;
  v_checks jsonb;
  v_stale_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.hoteles(id,nombre) VALUES(v_hotel,'Verificacion extension ' || v_hotel);
    INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
      VALUES(v_actor,v_actor::text || '@verification.invalid','{}'::jsonb,'{}'::jsonb);
    INSERT INTO public.usuarios(id,hotel_id,nombre,activo)
      VALUES(v_actor,v_hotel,'Verificacion recepcion',true)
      ON CONFLICT(id) DO UPDATE SET hotel_id=v_hotel,activo=true;
    INSERT INTO public.habitaciones(id,hotel_id,nombre,estado,activo)
      VALUES(v_room,v_hotel,'Verificacion 1','ocupada',true);
    INSERT INTO public.metodos_pago(id,hotel_id,nombre,activo)
      VALUES(v_method,v_hotel,'Efectivo verificacion',true);
    INSERT INTO public.turnos(id,hotel_id,usuario_id,estado)
      VALUES(v_shift,v_hotel,v_actor,'abierto');
    INSERT INTO public.reservas(id,hotel_id,habitacion_id,cliente_nombre,fecha_inicio,fecha_fin,estado,monto_total)
      VALUES(v_reserva,v_hotel,v_room,'Verificacion',now()-interval '1 hour',
        now()+interval '1 hour','activa',60000);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_actor,'role','authenticated')::text,true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_first := public.extender_estancia_reserva_atomica(v_reserva,now()+interval '1 hour',
      now()+interval '25 hours',60000,'1 noche',
      jsonb_build_array(jsonb_build_object('metodo_pago_id',v_method,'monto',60000)),
      v_shift,v_operation,NULL,now());
    v_retry := public.extender_estancia_reserva_atomica(v_reserva,now()+interval '1 hour',
      now()+interval '25 hours',60000,'1 noche',
      jsonb_build_array(jsonb_build_object('metodo_pago_id',v_method,'monto',60000)),
      v_shift,v_operation,NULL,now()+interval '1 minute');
    BEGIN
      PERFORM public.extender_estancia_reserva_atomica(v_reserva,now()+interval '1 hour',
        now()+interval '25 hours',60000,'1 noche',
        jsonb_build_array(jsonb_build_object('metodo_pago_id',v_method,'monto',60000)),
        v_shift,gen_random_uuid(),NULL,now());
    EXCEPTION WHEN serialization_failure THEN v_stale_blocked := true;
    END;
    IF NOT (v_retry->>'idempotent')::boolean OR v_first->'pagos' IS DISTINCT FROM v_retry->'pagos'
       OR NOT v_stale_blocked THEN
      RAISE EXCEPTION 'Extension retry verification failed';
    END IF;
    EXECUTE 'RESET ROLE';
    SELECT jsonb_build_object(
      'payments',(select count(*) from public.pagos_reserva where hotel_id=v_hotel),
      'cash_movements',(select count(*) from public.caja where hotel_id=v_hotel),
      'services',(select count(*) from public.servicios_x_reserva where hotel_id=v_hotel),
      'active_timers',(select count(*) from public.cronometros where hotel_id=v_hotel and activo),
      'paid',(select monto_pagado from public.reservas where id=v_reserva),
      'retry_idempotent',true,'stale_operation_blocked',v_stale_blocked
    ) INTO v_checks;
    IF v_checks->>'payments' <> '1' OR v_checks->>'cash_movements' <> '1'
       OR v_checks->>'services' <> '1' OR v_checks->>'active_timers' <> '1'
       OR (v_checks->>'paid')::numeric <> 60000 THEN
      RAISE EXCEPTION 'Extension state verification failed: %',v_checks;
    END IF;
    RAISE EXCEPTION 'Intentional rollback after verification' USING ERRCODE='PT001';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN NULL;
  END;
  IF EXISTS(select 1 from public.hoteles where id=v_hotel)
     OR EXISTS(select 1 from auth.users where id=v_actor) THEN
    RAISE EXCEPTION 'Verification rollback failed';
  END IF;
  INSERT INTO extension_verification_result(result) VALUES(v_checks || jsonb_build_object('rolled_back',true));
END;
$verify$;
SELECT result FROM extension_verification_result;
