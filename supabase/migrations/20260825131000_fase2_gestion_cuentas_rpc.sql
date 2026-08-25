CREATE OR REPLACE FUNCTION public.crear_cuenta_financiera(
 p_name text,p_account_type text,p_last_four text DEFAULT NULL,p_opening_balance numeric DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.usuarios%rowtype; v_account public.financial_accounts%rowtype;
BEGIN
 SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo IS TRUE;
 IF v_actor.hotel_id IS NULL OR NOT public.fase1_actor_tiene_permiso(v_actor.hotel_id,'finanzas.cuentas_gestionar') THEN RAISE EXCEPTION 'Sin permiso para gestionar cuentas' USING ERRCODE='42501'; END IF;
 IF btrim(coalesce(p_name,''))='' OR p_account_type NOT IN('cash','bank','wallet','clearing') OR (p_last_four IS NOT NULL AND p_last_four !~ '^[0-9]{4}$') THEN RAISE EXCEPTION 'Datos de cuenta inválidos' USING ERRCODE='22023'; END IF;
 INSERT INTO public.financial_accounts(hotel_id,name,account_type,last_four,opening_balance,created_by)
 VALUES(v_actor.hotel_id,btrim(p_name),p_account_type,p_last_four,coalesce(p_opening_balance,0),auth.uid()) RETURNING * INTO v_account;
 RETURN jsonb_build_object('account_id',v_account.id,'name',v_account.name);
END $$;
REVOKE ALL ON FUNCTION public.crear_cuenta_financiera(text,text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crear_cuenta_financiera(text,text,text,numeric) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.asignar_metodo_cuenta(p_metodo_id uuid,p_account_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.usuarios%rowtype;
BEGIN
 SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo IS TRUE;
 IF v_actor.hotel_id IS NULL OR NOT public.fase1_actor_tiene_permiso(v_actor.hotel_id,'finanzas.cuentas_gestionar')
 OR NOT EXISTS(SELECT 1 FROM public.metodos_pago WHERE id=p_metodo_id AND hotel_id=v_actor.hotel_id)
 OR NOT EXISTS(SELECT 1 FROM public.financial_accounts WHERE id=p_account_id AND hotel_id=v_actor.hotel_id AND active) THEN
  RAISE EXCEPTION 'Método o cuenta fuera del hotel autorizado' USING ERRCODE='42501';
 END IF;
 UPDATE public.metodos_pago SET financial_account_id=p_account_id WHERE id=p_metodo_id;
 RETURN jsonb_build_object('metodo_id',p_metodo_id,'account_id',p_account_id);
END $$;
REVOKE ALL ON FUNCTION public.asignar_metodo_cuenta(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.asignar_metodo_cuenta(uuid,uuid) TO authenticated,service_role;
