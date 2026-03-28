ALTER TABLE public.tareas_mantenimiento
  ADD COLUMN IF NOT EXISTS adjuntos jsonb NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'operacion-evidencias',
  'operacion-evidencias',
  true,
  12582912,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Oper evidencias read" ON storage.objects;
DROP POLICY IF EXISTS "Oper evidencias insert" ON storage.objects;
DROP POLICY IF EXISTS "Oper evidencias update" ON storage.objects;
DROP POLICY IF EXISTS "Oper evidencias delete" ON storage.objects;

CREATE POLICY "Oper evidencias read"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'operacion-evidencias');

CREATE POLICY "Oper evidencias insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'operacion-evidencias');

CREATE POLICY "Oper evidencias update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'operacion-evidencias')
WITH CHECK (bucket_id = 'operacion-evidencias');

CREATE POLICY "Oper evidencias delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'operacion-evidencias');

CREATE OR REPLACE FUNCTION public.saas_dashboard_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_month_revenue numeric := 0;
  v_previous_month_revenue numeric := 0;
  v_growth_pct numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para consultar la consola SaaS.';
  END IF;

  IF NOT public.actor_is_saas_superadmin() THEN
    RAISE EXCEPTION 'Solo superadmin puede consultar la consola SaaS.';
  END IF;

  SELECT COALESCE(SUM(COALESCE(p.monto, 0)), 0)
    INTO v_current_month_revenue
    FROM public.pagos p
   WHERE date_trunc('month', p.fecha) = date_trunc('month', now());

  SELECT COALESCE(SUM(COALESCE(p.monto, 0)), 0)
    INTO v_previous_month_revenue
    FROM public.pagos p
   WHERE date_trunc('month', p.fecha) = date_trunc('month', now() - interval '1 month');

  IF v_previous_month_revenue <= 0 THEN
    v_growth_pct := CASE WHEN v_current_month_revenue > 0 THEN 100 ELSE 0 END;
  ELSE
    v_growth_pct := ROUND((((v_current_month_revenue - v_previous_month_revenue) / v_previous_month_revenue) * 100)::numeric, 2);
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'metrics', jsonb_build_object(
      'total_hoteles', (SELECT COUNT(*) FROM public.hoteles),
      'total_usuarios', (SELECT COUNT(*) FROM public.usuarios),
      'turnos_abiertos', (SELECT COUNT(*) FROM public.turnos WHERE estado = 'abierto' AND fecha_cierre IS NULL),
      'reservas_activas', (
        SELECT COUNT(*)
        FROM public.reservas
        WHERE estado IN ('activa', 'confirmada', 'reservada', 'ocupada', 'pendiente', 'check_in', 'tiempo agotado')
      ),
      'incidencias_chat', (
        SELECT COUNT(*)
        FROM public.bitacora
        WHERE accion IN ('REPORTE_INCIDENCIA_CHAT', 'REPORTE_INCIDENCIA_MANUAL')
      ),
      'errores_24h', (
        SELECT COUNT(*)
        FROM public.eventos_sistema
        WHERE level IN ('error', 'fatal')
          AND created_at >= now() - interval '24 hours'
      ),
      'hoteles_activos', (SELECT COUNT(*) FROM public.hoteles WHERE estado_suscripcion = 'activo'),
      'hoteles_trial', (SELECT COUNT(*) FROM public.hoteles WHERE estado_suscripcion = 'trial'),
      'hoteles_vencidos', (SELECT COUNT(*) FROM public.hoteles WHERE estado_suscripcion = 'vencido'),
      'hoteles_con_gracia', (
        SELECT COUNT(*)
        FROM public.hoteles
        WHERE gracia_hasta IS NOT NULL
          AND gracia_hasta >= now()
      ),
      'ingresos_mes_actual', COALESCE(v_current_month_revenue, 0),
      'ingresos_mes_anterior', COALESCE(v_previous_month_revenue, 0),
      'crecimiento_ingresos_pct', COALESCE(v_growth_pct, 0),
      'pagos_mes_actual', (
        SELECT COUNT(*)
        FROM public.pagos
        WHERE date_trunc('month', fecha) = date_trunc('month', now())
      )
    ),
    'recent_hotels', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT
          h.id,
          h.nombre,
          h.plan::text AS plan,
          h.estado_suscripcion,
          h.activo,
          h.creado_en,
          h.ciudad,
          h.pais,
          h.gracia_hasta
        FROM public.hoteles h
        ORDER BY h.creado_en DESC
        LIMIT 8
      ) x
    ), '[]'::jsonb),
    'recent_payments', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT p.id, p.hotel_id, h.nombre AS hotel_nombre, p.plan, p.monto, p.metodo_pago, p.fecha
        FROM public.pagos p
        LEFT JOIN public.hoteles h ON h.id = p.hotel_id
        ORDER BY p.fecha DESC NULLS LAST
        LIMIT 10
      ) x
    ), '[]'::jsonb),
    'recent_events', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT e.id, e.hotel_id, h.nombre AS hotel_nombre, e.level, e.source, e.event_type, e.message, e.route, e.created_at
        FROM public.eventos_sistema e
        LEFT JOIN public.hoteles h ON h.id = e.hotel_id
        ORDER BY e.created_at DESC
        LIMIT 20
      ) x
    ), '[]'::jsonb),
    'revenue_by_plan', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT
          COALESCE(p.plan, 'sin_plan') AS plan,
          COALESCE(SUM(COALESCE(p.monto, 0)), 0)::numeric AS revenue
        FROM public.pagos p
        WHERE date_trunc('month', p.fecha) = date_trunc('month', now())
        GROUP BY COALESCE(p.plan, 'sin_plan')
        ORDER BY revenue DESC
      ) x
    ), '[]'::jsonb),
    'monthly_income', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.month_start)
      FROM (
        SELECT
          month_start,
          to_char(month_start, 'YYYY-MM') AS period,
          COALESCE(SUM(COALESCE(p.monto, 0)), 0)::numeric AS revenue
        FROM generate_series(
          date_trunc('month', now()) - interval '5 months',
          date_trunc('month', now()),
          interval '1 month'
        ) month_start
        LEFT JOIN public.pagos p
          ON p.fecha >= month_start
         AND p.fecha < month_start + interval '1 month'
        GROUP BY month_start
        ORDER BY month_start
      ) x
    ), '[]'::jsonb),
    'security', public.rls_audit_summary()
  );
END;
$function$;
