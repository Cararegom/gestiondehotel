BEGIN;

CREATE OR REPLACE FUNCTION public.actualizar_metodo_pago_caja(
  p_movimiento_id uuid,
  p_metodo_pago_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_movimiento public.caja%rowtype;
  v_metodo public.metodos_pago%rowtype;
  v_rol_nombre text;
  v_rol_normalizado text;
  v_before jsonb;
  v_after jsonb;
  v_account_id uuid;
  v_ledger_before jsonb;
  v_ledger_after jsonb;
  v_ledger_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
     AND activo IS TRUE
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT r.nombre INTO v_rol_nombre
    FROM public.usuarios_roles ur
    JOIN public.roles r ON r.id = ur.rol_id
   WHERE ur.usuario_id = auth.uid()
     AND ur.hotel_id = v_actor.hotel_id
   ORDER BY ur.creado_en DESC
   LIMIT 1;
  v_rol_normalizado := lower(coalesce(v_rol_nombre, v_actor.rol, ''));
  IF v_rol_normalizado NOT IN ('recepcionista', 'administrador', 'admin', 'superadmin', 'gerente') THEN
    RAISE EXCEPTION 'Tu rol no puede cambiar metodos de pago en caja' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_movimiento
    FROM public.caja
   WHERE id = p_movimiento_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento de caja no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_movimiento.hotel_id IS DISTINCT FROM v_actor.hotel_id THEN
    RAISE EXCEPTION 'No puedes modificar movimientos de otro hotel' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_metodo
    FROM public.metodos_pago
   WHERE id = p_metodo_pago_id
     AND hotel_id = v_actor.hotel_id
     AND activo IS TRUE
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Metodo de pago invalido o inactivo para este hotel' USING ERRCODE = '22023';
  END IF;

  IF v_movimiento.metodo_pago_id IS NOT DISTINCT FROM p_metodo_pago_id THEN
    RETURN jsonb_build_object(
      'id', v_movimiento.id,
      'metodo_pago_id', v_movimiento.metodo_pago_id,
      'sin_cambios', true,
      'ledger_sincronizado', true
    );
  END IF;

  v_before := to_jsonb(v_movimiento);
  SELECT to_jsonb(m) INTO v_ledger_before
    FROM public.account_movements m
   WHERE m.caja_id = v_movimiento.id
   FOR UPDATE;

  v_account_id := public.fase2_ensure_method_account(
    p_metodo_pago_id,
    v_movimiento.hotel_id,
    auth.uid()
  );

  UPDATE public.caja
     SET metodo_pago_id = p_metodo_pago_id,
         actualizado_en = now()
   WHERE id = v_movimiento.id
   RETURNING * INTO v_movimiento;

  UPDATE public.account_movements
     SET metodo_pago_id = p_metodo_pago_id,
         account_id = v_account_id
   WHERE caja_id = v_movimiento.id
     AND hotel_id = v_movimiento.hotel_id;
  GET DIAGNOSTICS v_ledger_count = ROW_COUNT;

  IF v_ledger_before IS NOT NULL AND v_ledger_count <> 1 THEN
    RAISE EXCEPTION 'No se pudo sincronizar el asiento financiero de Caja' USING ERRCODE = 'P0001';
  END IF;

  SELECT to_jsonb(m) INTO v_ledger_after
    FROM public.account_movements m
   WHERE m.caja_id = v_movimiento.id;
  v_after := to_jsonb(v_movimiento);

  INSERT INTO public.auditoria_operaciones(
    hotel_id, actor_id, accion, entidad, entity_id,
    before_data, after_data, reason
  ) VALUES (
    v_actor.hotel_id,
    auth.uid(),
    'caja.actualizar_metodo_pago',
    'caja',
    v_movimiento.id,
    v_before || jsonb_build_object('ledger', v_ledger_before),
    v_after || jsonb_build_object('ledger', v_ledger_after),
    'Cambio atomico de metodo de pago y cuenta financiera desde modulo Caja'
  );

  RETURN jsonb_build_object(
    'id', v_movimiento.id,
    'metodo_pago_id', v_movimiento.metodo_pago_id,
    'financial_account_id', v_account_id,
    'sin_cambios', false,
    'ledger_sincronizado', v_ledger_before IS NULL OR v_ledger_count = 1
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.actualizar_metodo_pago_caja(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actualizar_metodo_pago_caja(uuid, uuid) TO authenticated, service_role;

-- El navegador ya no necesita UPDATE directo: toda edicion pasa por el RPC atomico.
REVOKE UPDATE (metodo_pago_id) ON public.caja FROM authenticated;

-- Reparacion acotada: solo reasigna cuenta/metodo en asientos ya vinculados a Caja.
DO $repair$
DECLARE
  v_row record;
  v_account_id uuid;
BEGIN
  FOR v_row IN
    SELECT c.id AS caja_id, c.hotel_id, c.metodo_pago_id, c.usuario_id
      FROM public.caja c
      JOIN public.account_movements m ON m.caja_id = c.id
      JOIN public.metodos_pago mp ON mp.id = c.metodo_pago_id AND mp.hotel_id = c.hotel_id
     WHERE m.hotel_id = c.hotel_id
       AND (m.metodo_pago_id IS DISTINCT FROM c.metodo_pago_id
         OR m.account_id IS DISTINCT FROM mp.financial_account_id)
     FOR UPDATE OF c, m
  LOOP
    v_account_id := public.fase2_ensure_method_account(
      v_row.metodo_pago_id,
      v_row.hotel_id,
      v_row.usuario_id
    );
    UPDATE public.account_movements
       SET metodo_pago_id = v_row.metodo_pago_id,
           account_id = v_account_id
     WHERE caja_id = v_row.caja_id
       AND hotel_id = v_row.hotel_id;
  END LOOP;
END;
$repair$;

COMMIT;
