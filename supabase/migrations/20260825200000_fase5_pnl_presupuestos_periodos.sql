-- Fase 5: P&L shadow, presupuesto mensual y periodos financieros.
CREATE TABLE IF NOT EXISTS public.financial_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
  period_month date NOT NULL,
  revenue_budget numeric(14,2) NOT NULL DEFAULT 0 CHECK (revenue_budget >= 0),
  cogs_budget numeric(14,2) NOT NULL DEFAULT 0 CHECK (cogs_budget >= 0),
  opex_budget numeric(14,2) NOT NULL DEFAULT 0 CHECK (opex_budget >= 0),
  created_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, period_month),
  CHECK (period_month = date_trunc('month', period_month)::date)
);

CREATE TABLE IF NOT EXISTS public.financial_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
  period_month date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  closed_at timestamptz,
  reopened_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  reopened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, period_month),
  CHECK (period_month = date_trunc('month', period_month)::date)
);

ALTER TABLE public.financial_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financial_budgets_admin_select ON public.financial_budgets;
CREATE POLICY financial_budgets_admin_select ON public.financial_budgets
FOR SELECT TO authenticated
USING (public.usuario_actual_es_admin_hotel(hotel_id));

DROP POLICY IF EXISTS financial_periods_admin_select ON public.financial_periods;
CREATE POLICY financial_periods_admin_select ON public.financial_periods
FOR SELECT TO authenticated
USING (public.usuario_actual_es_admin_hotel(hotel_id));

REVOKE ALL ON public.financial_budgets, public.financial_periods FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.financial_budgets, public.financial_periods FROM authenticated;
GRANT SELECT ON public.financial_budgets, public.financial_periods TO authenticated, service_role;
GRANT ALL ON public.financial_budgets, public.financial_periods TO service_role;

CREATE OR REPLACE VIEW public.financial_transactions
WITH (security_invoker = true)
AS
SELECT
  ('cogs-revenue:' || ce.id::text) AS transaction_key,
  ce.hotel_id,
  ce.business_date,
  ce.occurred_at,
  'revenue'::text AS kind,
  ce.area,
  NULL::uuid AS cost_center_id,
  initcap(ce.area) AS category,
  ce.revenue::numeric AS amount,
  ce.item_name AS description,
  'cogs_entries'::text AS source_table,
  ce.id AS source_id
FROM public.cogs_entries ce
UNION ALL
SELECT
  ('cogs-cost:' || ce.id::text), ce.hotel_id, ce.business_date, ce.occurred_at,
  'cogs', ce.area, NULL::uuid, 'Costo de ventas', ce.total_cost, ce.item_name,
  'cogs_entries', ce.id
FROM public.cogs_entries ce
UNION ALL
SELECT
  ('cash-revenue:' || c.id::text), c.hotel_id,
  coalesce(c.business_date, public.fase1_business_date(coalesce(c.fecha_movimiento,c.creado_en,now()))),
  coalesce(c.fecha_movimiento,c.creado_en,now()), 'revenue',
  CASE
    WHEN c.pago_reserva_id IS NOT NULL OR c.reserva_id IS NOT NULL THEN 'rooms'
    WHEN lower(c.concepto) LIKE '%servicio%' THEN 'services'
    ELSE 'other'
  END,
  NULL::uuid,
  CASE
    WHEN c.pago_reserva_id IS NOT NULL OR c.reserva_id IS NOT NULL THEN 'Habitaciones y servicios'
    ELSE 'Otros ingresos'
  END,
  c.monto, c.concepto, 'caja', c.id
FROM public.caja c
WHERE c.tipo = 'ingreso'
  AND c.venta_tienda_id IS NULL
  AND c.venta_restaurante_id IS NULL
  AND c.venta_terraza_id IS NULL
  AND c.compra_tienda_id IS NULL
  AND c.original_movement_id IS NULL
UNION ALL
SELECT
  ('cash-reversal:' || r.id::text), r.hotel_id,
  coalesce(r.business_date, public.fase1_business_date(coalesce(r.fecha_movimiento,r.creado_en,now()))),
  coalesce(r.fecha_movimiento,r.creado_en,now()), 'revenue',
  CASE WHEN o.pago_reserva_id IS NOT NULL OR o.reserva_id IS NOT NULL THEN 'rooms' ELSE 'other' END,
  NULL::uuid, 'Reversiones de ingresos', -r.monto, r.concepto, 'caja', r.id
FROM public.caja r
JOIN public.caja o ON o.id = r.original_movement_id
WHERE r.source = 'caja_reversal'
  AND o.tipo = 'ingreso'
  AND o.venta_tienda_id IS NULL
  AND o.venta_restaurante_id IS NULL
  AND o.venta_terraza_id IS NULL
UNION ALL
SELECT
  ('expense:' || e.id::text), e.hotel_id, e.expense_date, e.created_at,
  'opex', 'operations', e.cost_center_id, ec.name, e.total_amount, e.description,
  'expenses', e.id
FROM public.expenses e
JOIN public.expense_categories ec ON ec.id = e.category_id AND ec.hotel_id = e.hotel_id
WHERE e.status <> 'cancelled' AND ec.treatment = 'operating_expense';

REVOKE ALL ON public.financial_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.financial_transactions TO service_role;

CREATE OR REPLACE FUNCTION public.guardar_presupuesto_financiero(
  p_period_month date,
  p_revenue_budget numeric,
  p_cogs_budget numeric,
  p_opex_budget numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE v_actor public.usuarios%rowtype; v_month date; v_row public.financial_budgets%rowtype;
BEGIN
  SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR NOT public.usuario_actual_es_admin_hotel(v_actor.hotel_id) THEN
    RAISE EXCEPTION 'Solo administracion puede modificar presupuestos' USING ERRCODE='42501';
  END IF;
  v_month := date_trunc('month',p_period_month)::date;
  IF least(coalesce(p_revenue_budget,-1),coalesce(p_cogs_budget,-1),coalesce(p_opex_budget,-1)) < 0 THEN
    RAISE EXCEPTION 'Los presupuestos no pueden ser negativos' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.financial_budgets(hotel_id,period_month,revenue_budget,cogs_budget,opex_budget,created_by,updated_by)
  VALUES(v_actor.hotel_id,v_month,p_revenue_budget,p_cogs_budget,p_opex_budget,auth.uid(),auth.uid())
  ON CONFLICT(hotel_id,period_month) DO UPDATE SET
    revenue_budget=excluded.revenue_budget,cogs_budget=excluded.cogs_budget,
    opex_budget=excluded.opex_budget,updated_by=auth.uid(),updated_at=now()
  RETURNING * INTO v_row;
  INSERT INTO public.auditoria_operaciones(hotel_id,actor_id,accion,entidad,entity_id,after_data)
  VALUES(v_actor.hotel_id,auth.uid(),'presupuesto.guardar','financial_budgets',v_row.id,to_jsonb(v_row));
  RETURN to_jsonb(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cambiar_estado_periodo_financiero(p_period_month date,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE v_actor public.usuarios%rowtype; v_month date; v_row public.financial_periods%rowtype;
BEGIN
  SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR NOT public.usuario_actual_es_admin_hotel(v_actor.hotel_id) THEN
    RAISE EXCEPTION 'Solo administracion puede cerrar o reabrir periodos' USING ERRCODE='42501';
  END IF;
  IF p_status NOT IN ('open','closed') THEN RAISE EXCEPTION 'Estado de periodo invalido' USING ERRCODE='22023'; END IF;
  v_month := date_trunc('month',p_period_month)::date;
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
DECLARE v_actor public.usuarios%rowtype; v_revenue numeric; v_cogs numeric; v_opex numeric;
 v_areas jsonb; v_centers jsonb; v_transactions jsonb; v_budget jsonb; v_periods jsonb; v_quality jsonb;
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
  SELECT jsonb_build_object(
    'revenue',coalesce(sum(revenue_budget),0),
    'cogs',coalesce(sum(cogs_budget),0),
    'opex',coalesce(sum(opex_budget),0)
  )
  INTO v_budget FROM public.financial_budgets WHERE hotel_id=v_actor.hotel_id
    AND period_month BETWEEN date_trunc('month',p_from)::date AND date_trunc('month',p_to)::date;
  SELECT coalesce(jsonb_agg(jsonb_build_object('month',period_month,'status',status) ORDER BY period_month),'[]') INTO v_periods
  FROM public.financial_periods WHERE hotel_id=v_actor.hotel_id
    AND period_month BETWEEN date_trunc('month',p_from)::date AND date_trunc('month',p_to)::date;
  SELECT jsonb_build_object(
    'cogs_with_issues',(SELECT count(*) FROM public.cogs_entries WHERE hotel_id=v_actor.hotel_id AND business_date BETWEEN p_from AND p_to AND cost_issue IS NOT NULL),
    'uncosted_inventory',(SELECT count(*) FROM public.inventory_cost_balances WHERE hotel_id=v_actor.hotel_id AND cost_status<>'active'),
    'mode','shadow') INTO v_quality;
  RETURN jsonb_build_object('from',p_from,'to',p_to,'summary',jsonb_build_object(
    'revenue',round(v_revenue,2),'cogs',round(v_cogs,2),'gross_profit',round(v_revenue-v_cogs,2),
    'opex',round(v_opex,2),'operating_profit',round(v_revenue-v_cogs-v_opex,2)),
    'areas',v_areas,'cost_centers',v_centers,'transactions',v_transactions,'budget',v_budget,'periods',v_periods,'quality',v_quality);
END;
$function$;

REVOKE ALL ON FUNCTION public.guardar_presupuesto_financiero(date,numeric,numeric,numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.cambiar_estado_periodo_financiero(date,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.obtener_estado_resultados_shadow(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.guardar_presupuesto_financiero(date,numeric,numeric,numeric) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cambiar_estado_periodo_financiero(date,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.obtener_estado_resultados_shadow(date,date) TO authenticated,service_role;
