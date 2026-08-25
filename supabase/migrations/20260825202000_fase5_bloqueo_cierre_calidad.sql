-- Fase 5: un periodo con ventas sin costo no puede declararse cerrado.
CREATE OR REPLACE FUNCTION public.cambiar_estado_periodo_financiero(p_period_month date,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_month date;
  v_row public.financial_periods%rowtype;
  v_cost_issues integer;
BEGIN
  SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR NOT public.usuario_actual_es_admin_hotel(v_actor.hotel_id) THEN
    RAISE EXCEPTION 'Solo administracion puede cerrar o reabrir periodos' USING ERRCODE='42501';
  END IF;
  IF p_status NOT IN ('open','closed') THEN
    RAISE EXCEPTION 'Estado de periodo invalido' USING ERRCODE='22023';
  END IF;
  v_month := date_trunc('month',p_period_month)::date;
  IF p_status='closed' THEN
    SELECT count(*) INTO v_cost_issues
    FROM public.cogs_entries
    WHERE hotel_id=v_actor.hotel_id
      AND business_date>=v_month
      AND business_date<(v_month+interval '1 month')::date
      AND cost_issue IS NOT NULL;
    IF v_cost_issues>0 THEN
      RAISE EXCEPTION 'No se puede cerrar el mes: existen % venta(s) con costo pendiente',v_cost_issues
        USING ERRCODE='23514',HINT='Configura la receta o costo faltante y recalcula el CMV desde Costeo y margen.';
    END IF;
  END IF;
  INSERT INTO public.financial_periods(hotel_id,period_month,status,closed_by,closed_at,reopened_by,reopened_at)
  VALUES(v_actor.hotel_id,v_month,p_status,
    CASE WHEN p_status='closed' THEN auth.uid() END,CASE WHEN p_status='closed' THEN now() END,
    CASE WHEN p_status='open' THEN auth.uid() END,CASE WHEN p_status='open' THEN now() END)
  ON CONFLICT(hotel_id,period_month) DO UPDATE SET status=excluded.status,
    closed_by=CASE WHEN excluded.status='closed' THEN auth.uid() ELSE financial_periods.closed_by END,
    closed_at=CASE WHEN excluded.status='closed' THEN now() ELSE financial_periods.closed_at END,
    reopened_by=CASE WHEN excluded.status='open' THEN auth.uid() ELSE financial_periods.reopened_by END,
    reopened_at=CASE WHEN excluded.status='open' THEN now() ELSE financial_periods.reopened_at END,updated_at=now()
  RETURNING * INTO v_row;
  INSERT INTO public.auditoria_operaciones(hotel_id,actor_id,accion,entidad,entity_id,after_data)
  VALUES(v_actor.hotel_id,auth.uid(),'periodo.'||p_status,'financial_periods',v_row.id,to_jsonb(v_row));
  RETURN to_jsonb(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.obtener_estado_resultados_shadow(p_from date,p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_revenue numeric;
  v_cogs numeric;
  v_opex numeric;
  v_areas jsonb;
  v_centers jsonb;
  v_transactions jsonb;
  v_budget jsonb;
  v_periods jsonb;
  v_quality jsonb;
  v_issues jsonb;
  v_sources jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR NOT public.usuario_actual_es_admin_hotel(v_actor.hotel_id) THEN
    RAISE EXCEPTION 'Solo administracion puede consultar el estado de resultados' USING ERRCODE='42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>731 THEN
    RAISE EXCEPTION 'Rango de fechas invalido o superior a dos anos' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(sum(amount) FILTER(WHERE kind='revenue'),0),coalesce(sum(amount) FILTER(WHERE kind='cogs'),0),coalesce(sum(amount) FILTER(WHERE kind='opex'),0)
  INTO v_revenue,v_cogs,v_opex FROM public.financial_transactions
  WHERE hotel_id=v_actor.hotel_id AND business_date BETWEEN p_from AND p_to;
  SELECT coalesce(jsonb_agg(x ORDER BY x.area),'[]') INTO v_areas FROM (
    SELECT area,round(coalesce(sum(amount) FILTER(WHERE kind='revenue'),0),2) revenue,
      round(coalesce(sum(amount) FILTER(WHERE kind='cogs'),0),2) cogs,
      round(coalesce(sum(amount) FILTER(WHERE kind='opex'),0),2) opex,
      round(coalesce(sum(amount) FILTER(WHERE kind='revenue'),0)-coalesce(sum(amount) FILTER(WHERE kind IN('cogs','opex')),0),2) result
    FROM public.financial_transactions WHERE hotel_id=v_actor.hotel_id AND business_date BETWEEN p_from AND p_to GROUP BY area
  ) x;
  SELECT coalesce(jsonb_agg(x ORDER BY x.opex DESC),'[]') INTO v_centers FROM (
    SELECT coalesce(cc.name,'Sin centro') center,round(sum(ft.amount),2) opex
    FROM public.financial_transactions ft LEFT JOIN public.cost_centers cc ON cc.id=ft.cost_center_id
    WHERE ft.hotel_id=v_actor.hotel_id AND ft.business_date BETWEEN p_from AND p_to AND ft.kind='opex'
    GROUP BY cc.name
  ) x;
  SELECT coalesce(jsonb_agg(x ORDER BY x.business_date DESC,x.occurred_at DESC),'[]') INTO v_transactions FROM (
    SELECT business_date,occurred_at,kind,area,category,amount,description,source_table,source_id
    FROM public.financial_transactions WHERE hotel_id=v_actor.hotel_id AND business_date BETWEEN p_from AND p_to
    ORDER BY business_date DESC,occurred_at DESC LIMIT 300
  ) x;
  SELECT jsonb_build_object('revenue',coalesce(sum(revenue_budget),0),'cogs',coalesce(sum(cogs_budget),0),'opex',coalesce(sum(opex_budget),0))
  INTO v_budget FROM public.financial_budgets WHERE hotel_id=v_actor.hotel_id
    AND period_month BETWEEN date_trunc('month',p_from)::date AND date_trunc('month',p_to)::date;
  SELECT coalesce(jsonb_agg(jsonb_build_object('month',period_month,'status',status) ORDER BY period_month),'[]') INTO v_periods
  FROM public.financial_periods WHERE hotel_id=v_actor.hotel_id
    AND period_month BETWEEN date_trunc('month',p_from)::date AND date_trunc('month',p_to)::date;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'business_date',business_date,'area',area,'item_id',item_id,'item_name',item_name,
    'revenue',revenue,'issue',cost_issue,'message',CASE cost_issue
      WHEN 'missing_recipe' THEN 'El plato no tiene receta configurada.'
      WHEN 'zero_ingredient_cost' THEN 'Uno o mas ingredientes no tienen costo activo.'
      ELSE 'La venta requiere revision de costo.' END
  ) ORDER BY business_date DESC,occurred_at DESC),'[]') INTO v_issues
  FROM public.cogs_entries WHERE hotel_id=v_actor.hotel_id AND business_date BETWEEN p_from AND p_to AND cost_issue IS NOT NULL;
  SELECT coalesce(jsonb_agg(x ORDER BY x.source_table,x.kind),'[]') INTO v_sources FROM (
    SELECT source_table,kind,count(*) movements,round(sum(amount),2) amount
    FROM public.financial_transactions
    WHERE hotel_id=v_actor.hotel_id AND business_date BETWEEN p_from AND p_to
    GROUP BY source_table,kind
  ) x;
  SELECT jsonb_build_object(
    'cogs_with_issues',jsonb_array_length(v_issues),
    'uncosted_inventory',(SELECT count(*) FROM public.inventory_cost_balances WHERE hotel_id=v_actor.hotel_id AND cost_status<>'active'),
    'issues',v_issues,'sources',v_sources,'can_close',jsonb_array_length(v_issues)=0,'mode','shadow') INTO v_quality;
  RETURN jsonb_build_object('from',p_from,'to',p_to,'summary',jsonb_build_object(
    'revenue',round(v_revenue,2),'cogs',round(v_cogs,2),'gross_profit',round(v_revenue-v_cogs,2),
    'opex',round(v_opex,2),'operating_profit',round(v_revenue-v_cogs-v_opex,2)),
    'areas',v_areas,'cost_centers',v_centers,'transactions',v_transactions,'budget',v_budget,'periods',v_periods,'quality',v_quality);
END;
$function$;

REVOKE ALL ON FUNCTION public.cambiar_estado_periodo_financiero(date,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.obtener_estado_resultados_shadow(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cambiar_estado_periodo_financiero(date,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.obtener_estado_resultados_shadow(date,date) TO authenticated,service_role;
