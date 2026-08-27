BEGIN;

CREATE TABLE IF NOT EXISTS public.hotel_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  feature_key text NOT NULL CHECK (feature_key ~ '^[a-z0-9_]{3,80}$'),
  enabled boolean NOT NULL DEFAULT false,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(configuration) = 'object'),
  enabled_at timestamptz,
  enabled_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, feature_key)
);

ALTER TABLE public.hotel_features ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hotel_features FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.hotel_features TO service_role;

INSERT INTO public.hotel_features(hotel_id, feature_key, enabled, enabled_at)
SELECT id, 'bank_reconciliation_v2', true, now()
FROM public.hoteles
WHERE lower(btrim(nombre)) = 'hotel marena san isidro'
ON CONFLICT (hotel_id, feature_key) DO UPDATE
SET enabled = true, enabled_at = coalesce(public.hotel_features.enabled_at, now()), updated_at = now();

DROP INDEX IF EXISTS public.bank_payment_events_fingerprint_uidx;
DROP INDEX IF EXISTS public.bank_payment_events_bank_reference_uidx;

DROP FUNCTION IF EXISTS public.actualizar_metodo_pago_caja(uuid, uuid);
CREATE FUNCTION public.actualizar_metodo_pago_caja(
  p_movimiento_id uuid,
  p_metodo_pago_id uuid,
  p_motivo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_movimiento public.caja%rowtype;
  v_metodo public.metodos_pago%rowtype;
  v_turno_estado text;
  v_rol_nombre text;
  v_rol_normalizado text;
  v_feature_enabled boolean := false;
  v_old_account_id uuid;
  v_new_account_id uuid;
  v_old_account_type text;
  v_new_account_type text;
  v_reason text;
  v_before jsonb;
  v_after jsonb;
  v_ledger_before jsonb;
  v_ledger_after jsonb;
  v_ledger_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo IS TRUE LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario no autorizado' USING ERRCODE='42501'; END IF;

  SELECT r.nombre INTO v_rol_nombre FROM public.usuarios_roles ur
  JOIN public.roles r ON r.id=ur.rol_id
  WHERE ur.usuario_id=auth.uid() AND ur.hotel_id=v_actor.hotel_id
  ORDER BY ur.creado_en DESC LIMIT 1;
  v_rol_normalizado := lower(coalesce(v_rol_nombre,v_actor.rol,''));
  IF v_rol_normalizado NOT IN ('recepcionista','administrador','admin','superadmin','gerente') THEN
    RAISE EXCEPTION 'Tu rol no puede cambiar metodos de pago en caja' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_movimiento FROM public.caja WHERE id=p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movimiento de caja no encontrado' USING ERRCODE='P0002'; END IF;
  IF v_movimiento.hotel_id IS DISTINCT FROM v_actor.hotel_id THEN
    RAISE EXCEPTION 'No puedes modificar movimientos de otro hotel' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_metodo FROM public.metodos_pago
  WHERE id=p_metodo_pago_id AND hotel_id=v_actor.hotel_id AND activo IS TRUE LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Metodo de pago invalido o inactivo para este hotel' USING ERRCODE='22023'; END IF;
  IF v_movimiento.metodo_pago_id IS NOT DISTINCT FROM p_metodo_pago_id THEN
    RETURN jsonb_build_object('id',v_movimiento.id,'metodo_pago_id',v_movimiento.metodo_pago_id,
      'sin_cambios',true,'ledger_sincronizado',true);
  END IF;

  SELECT enabled INTO v_feature_enabled FROM public.hotel_features
  WHERE hotel_id=v_movimiento.hotel_id AND feature_key='bank_reconciliation_v2';
  v_feature_enabled := coalesce(v_feature_enabled,false);
  IF v_feature_enabled AND v_movimiento.turno_id IS NOT NULL THEN
    SELECT estado::text INTO v_turno_estado FROM public.turnos WHERE id=v_movimiento.turno_id FOR SHARE;
    IF v_turno_estado='cerrado' THEN
      RAISE EXCEPTION 'No se puede cambiar el metodo de pago de un movimiento cuyo turno esta cerrado. Usa una reversion o ajuste administrativo.' USING ERRCODE='23514';
    END IF;
  END IF;

  v_old_account_id := public.fase2_ensure_method_account(v_movimiento.metodo_pago_id,v_movimiento.hotel_id,auth.uid());
  v_new_account_id := public.fase2_ensure_method_account(p_metodo_pago_id,v_movimiento.hotel_id,auth.uid());
  SELECT account_type INTO v_old_account_type FROM public.financial_accounts
   WHERE id=v_old_account_id AND hotel_id=v_movimiento.hotel_id;
  SELECT account_type INTO v_new_account_type FROM public.financial_accounts
   WHERE id=v_new_account_id AND hotel_id=v_movimiento.hotel_id;

  IF v_feature_enabled AND v_old_account_type='cash' AND v_new_account_type='bank' THEN
    v_reason := regexp_replace(btrim(coalesce(p_motivo,'')), '[[:cntrl:]]+', ' ', 'g');
    v_reason := regexp_replace(v_reason, '[[:space:]]+', ' ', 'g');
    IF v_reason='' THEN RAISE EXCEPTION 'El motivo es obligatorio para cambiar de efectivo a banco' USING ERRCODE='22023'; END IF;
    IF char_length(v_reason)>500 THEN RAISE EXCEPTION 'El motivo no puede superar 500 caracteres' USING ERRCODE='22023'; END IF;
  ELSE
    v_reason := nullif(regexp_replace(btrim(coalesce(p_motivo,'')), '[[:cntrl:]]+', ' ', 'g'),'');
  END IF;

  v_before:=to_jsonb(v_movimiento);
  SELECT to_jsonb(m) INTO v_ledger_before FROM public.account_movements m
  WHERE m.caja_id=v_movimiento.id FOR UPDATE;
  UPDATE public.caja SET metodo_pago_id=p_metodo_pago_id,actualizado_en=now()
  WHERE id=v_movimiento.id RETURNING * INTO v_movimiento;
  UPDATE public.account_movements SET metodo_pago_id=p_metodo_pago_id,account_id=v_new_account_id
  WHERE caja_id=v_movimiento.id AND hotel_id=v_movimiento.hotel_id;
  GET DIAGNOSTICS v_ledger_count=ROW_COUNT;
  IF v_ledger_before IS NOT NULL AND v_ledger_count<>1 THEN
    RAISE EXCEPTION 'No se pudo sincronizar el asiento financiero de Caja' USING ERRCODE='P0001';
  END IF;
  SELECT to_jsonb(m) INTO v_ledger_after FROM public.account_movements m WHERE m.caja_id=v_movimiento.id;
  v_after:=to_jsonb(v_movimiento);

  INSERT INTO public.auditoria_operaciones(hotel_id,actor_id,accion,entidad,entity_id,before_data,after_data,reason)
  VALUES(v_actor.hotel_id,auth.uid(),'caja.actualizar_metodo_pago','caja',v_movimiento.id,
    v_before || jsonb_build_object('financial_account_id',v_old_account_id,'account_type',v_old_account_type,'ledger',v_ledger_before),
    v_after || jsonb_build_object('financial_account_id',v_new_account_id,'account_type',v_new_account_type,'ledger',v_ledger_after,
      'turno_id',v_movimiento.turno_id,'changed_at',now()),
    coalesce(v_reason,'Cambio atomico de metodo de pago y cuenta financiera desde modulo Caja'));

  IF v_feature_enabled AND v_old_account_type='cash' AND v_new_account_type='bank' THEN
    BEGIN
      INSERT INTO public.notificaciones(hotel_id,usuario_id,user_id,rol_destino,tipo,mensaje,entidad_tipo,entidad_id)
      SELECT v_actor.hotel_id,u.id,u.id,NULL,'general_info'::public.tipo_notificacion_enum,
        'Cambio de efectivo a banco en Caja por '||coalesce(v_actor.nombre,v_actor.email,'usuario')||'. Motivo: '||v_reason,
        'caja_metodo_pago',v_movimiento.id
      FROM public.usuarios u WHERE u.hotel_id=v_actor.hotel_id AND u.activo IS TRUE
        AND (lower(coalesce(u.rol::text,'')) IN ('admin','administrador','superadmin','gerente') OR EXISTS(
          SELECT 1 FROM public.usuarios_roles ur JOIN public.roles r ON r.id=ur.rol_id
          WHERE ur.usuario_id=u.id AND ur.hotel_id=v_actor.hotel_id
            AND lower(r.nombre) IN ('admin','administrador','superadmin','gerente')))
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('id',v_movimiento.id,'metodo_pago_id',v_movimiento.metodo_pago_id,
    'financial_account_id',v_new_account_id,'sin_cambios',false,
    'ledger_sincronizado',v_ledger_before IS NULL OR v_ledger_count=1);
END;
$function$;

REVOKE ALL ON FUNCTION public.actualizar_metodo_pago_caja(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.actualizar_metodo_pago_caja(uuid,uuid,text) TO authenticated,service_role;

COMMIT;
