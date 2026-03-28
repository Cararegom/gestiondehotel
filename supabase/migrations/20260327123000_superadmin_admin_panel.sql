ALTER TABLE public.hoteles
  ADD COLUMN IF NOT EXISTS gracia_hasta timestamp with time zone,
  ADD COLUMN IF NOT EXISTS gracia_motivo text,
  ADD COLUMN IF NOT EXISTS gracia_actualizada_en timestamp with time zone;

CREATE OR REPLACE FUNCTION public.is_whitelisted_saas_superadmin_email(p_email text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT lower(
    coalesce(
      nullif(btrim(coalesce(p_email, auth.jwt() ->> 'email')), ''),
      ''
    )
  ) IN ('cararegom@gmail.com');
$function$;

CREATE OR REPLACE FUNCTION public.actor_is_saas_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT
    public.is_whitelisted_saas_superadmin_email()
    OR EXISTS (
      SELECT 1
      FROM public.usuarios u
      WHERE u.id = auth.uid()
        AND (
          u.rol = 'superadmin'
          OR public.is_whitelisted_saas_superadmin_email(u.correo::text)
        )
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_current_user_hotel_id_from_profile()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN public.actor_is_saas_superadmin() THEN NULL::uuid
    ELSE COALESCE(
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'hotel_id', '')::uuid,
      (SELECT u.hotel_id FROM public.usuarios u WHERE u.id = auth.uid() LIMIT 1)
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.get_current_user_rol()
RETURNS public.rol_usuario_enum
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN public.actor_is_saas_superadmin() THEN 'superadmin'::public.rol_usuario_enum
    ELSE (
      SELECT NULLIF(u.rol, '')::public.rol_usuario_enum
      FROM public.usuarios u
      WHERE u.id = auth.uid()
      LIMIT 1
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.get_current_user_rol_from_profile()
RETURNS public.rol_usuario_enum
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN public.actor_is_saas_superadmin() THEN 'superadmin'::public.rol_usuario_enum
    ELSE COALESCE(
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'rol', ''),
      (SELECT NULLIF(u.rol, '') FROM public.usuarios u WHERE u.id = auth.uid() LIMIT 1)
    )::public.rol_usuario_enum
  END;
$function$;

CREATE OR REPLACE FUNCTION public.rls_audit_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para ver la auditoria de seguridad.';
  END IF;

  IF NOT public.actor_is_saas_superadmin() THEN
    RAISE EXCEPTION 'Solo superadmin puede consultar la auditoria de seguridad.';
  END IF;

  RETURN jsonb_build_object(
    'tables_without_rls',
    COALESCE((
      SELECT jsonb_agg(c.relname ORDER BY c.relname)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND NOT c.relrowsecurity
    ), '[]'::jsonb),
    'tables_with_rls_no_policies',
    COALESCE((
      SELECT jsonb_agg(table_name ORDER BY table_name)
      FROM (
        SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_policy p ON p.polrelid = c.oid
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relrowsecurity
        GROUP BY c.relname
        HAVING COUNT(p.polname) = 0
      ) q
    ), '[]'::jsonb),
    'policy_counts',
    COALESCE((
      SELECT jsonb_object_agg(table_name, policy_count)
      FROM (
        SELECT c.relname AS table_name, COUNT(p.polname)::int AS policy_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_policy p ON p.polrelid = c.oid
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
        GROUP BY c.relname
      ) q
    ), '{}'::jsonb)
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.saas_listar_hoteles();

CREATE OR REPLACE FUNCTION public.saas_listar_hoteles()
RETURNS TABLE (
  id uuid,
  nombre text,
  plan text,
  estado_suscripcion text,
  activo boolean,
  creado_en timestamp with time zone,
  ciudad text,
  pais text,
  correo text,
  telefono text,
  trial_fin timestamp with time zone,
  suscripcion_fin timestamp with time zone,
  gracia_hasta timestamp with time zone,
  ingresos_mes_actual numeric,
  total_usuarios bigint,
  ultimo_pago timestamp without time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para consultar hoteles.';
  END IF;

  IF NOT public.actor_is_saas_superadmin() THEN
    RAISE EXCEPTION 'Solo superadmin puede consultar el listado global de hoteles.';
  END IF;

  RETURN QUERY
  SELECT
    h.id,
    h.nombre,
    h.plan::text,
    h.estado_suscripcion,
    h.activo,
    h.creado_en,
    h.ciudad,
    h.pais,
    h.correo::text,
    h.telefono,
    h.trial_fin,
    h.suscripcion_fin,
    h.gracia_hasta,
    COALESCE((
      SELECT SUM(COALESCE(p.monto, 0))
      FROM public.pagos p
      WHERE p.hotel_id = h.id
        AND date_trunc('month', p.fecha) = date_trunc('month', now())
    ), 0)::numeric AS ingresos_mes_actual,
    COALESCE((
      SELECT COUNT(*)
      FROM public.usuarios u
      WHERE u.hotel_id = h.id
    ), 0)::bigint AS total_usuarios,
    (
      SELECT MAX(p.fecha)
      FROM public.pagos p
      WHERE p.hotel_id = h.id
    ) AS ultimo_pago
  FROM public.hoteles h
  ORDER BY h.creado_en DESC;
END;
$function$;

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
        WHERE accion = 'REPORTE_INCIDENCIA_CHAT'
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

CREATE OR REPLACE FUNCTION public.exportar_hotel_snapshot(p_hotel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para exportar datos.';
  END IF;

  SELECT *
    INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND AND NOT public.actor_is_saas_superadmin() THEN
    RAISE EXCEPTION 'No se encontro perfil de usuario para exportar.';
  END IF;

  IF NOT public.actor_is_saas_superadmin() AND p_hotel_id IS DISTINCT FROM v_actor.hotel_id THEN
    RAISE EXCEPTION 'No puedes exportar informacion de otro hotel.';
  END IF;

  RETURN jsonb_build_object(
    'exported_at', now(),
    'hotel', (
      SELECT to_jsonb(h)
      FROM public.hoteles h
      WHERE h.id = p_hotel_id
    ),
    'configuracion_hotel', COALESCE((
      SELECT to_jsonb(ch)
      FROM public.configuracion_hotel ch
      WHERE ch.hotel_id = p_hotel_id
    ), '{}'::jsonb),
    'usuarios', COALESCE((
      SELECT jsonb_agg(to_jsonb(u) ORDER BY u.creado_en DESC)
      FROM public.usuarios u
      WHERE u.hotel_id = p_hotel_id
    ), '[]'::jsonb),
    'habitaciones', COALESCE((
      SELECT jsonb_agg(to_jsonb(hb) ORDER BY hb.nombre)
      FROM public.habitaciones hb
      WHERE hb.hotel_id = p_hotel_id
    ), '[]'::jsonb),
    'tiempos_estancia', COALESCE((
      SELECT jsonb_agg(to_jsonb(te) ORDER BY te.nombre)
      FROM public.tiempos_estancia te
      WHERE te.hotel_id = p_hotel_id
    ), '[]'::jsonb),
    'metodos_pago', COALESCE((
      SELECT jsonb_agg(to_jsonb(mp) ORDER BY mp.nombre)
      FROM public.metodos_pago mp
      WHERE mp.hotel_id = p_hotel_id
    ), '[]'::jsonb),
    'clientes', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.creado_en DESC)
      FROM public.clientes c
      WHERE c.hotel_id = p_hotel_id
    ), '[]'::jsonb),
    'reservas', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.creado_en DESC)
      FROM public.reservas r
      WHERE r.hotel_id = p_hotel_id
    ), '[]'::jsonb),
    'caja', COALESCE((
      SELECT jsonb_agg(to_jsonb(cj) ORDER BY cj.creado_en DESC)
      FROM public.caja cj
      WHERE cj.hotel_id = p_hotel_id
    ), '[]'::jsonb),
    'tareas_mantenimiento', COALESCE((
      SELECT jsonb_agg(to_jsonb(tm) ORDER BY tm.creado_en DESC)
      FROM public.tareas_mantenimiento tm
      WHERE tm.hotel_id = p_hotel_id
    ), '[]'::jsonb),
    'servicios_adicionales', COALESCE((
      SELECT jsonb_agg(to_jsonb(sa) ORDER BY sa.nombre)
      FROM public.servicios_adicionales sa
      WHERE sa.hotel_id = p_hotel_id
    ), '[]'::jsonb),
    'productos_tienda', COALESCE((
      SELECT jsonb_agg(to_jsonb(pt) ORDER BY pt.nombre)
      FROM public.productos_tienda pt
      WHERE pt.hotel_id = p_hotel_id
    ), '[]'::jsonb),
    'ventas_tienda', COALESCE((
      SELECT jsonb_agg(to_jsonb(vt) ORDER BY vt.fecha DESC)
      FROM public.ventas_tienda vt
      WHERE vt.hotel_id = p_hotel_id
    ), '[]'::jsonb),
    'ventas_restaurante', COALESCE((
      SELECT jsonb_agg(to_jsonb(vr) ORDER BY vr.fecha DESC)
      FROM public.ventas_restaurante vr
      WHERE vr.hotel_id = p_hotel_id
    ), '[]'::jsonb),
    'integraciones_hotel', COALESCE((
      SELECT jsonb_agg(to_jsonb(ih))
      FROM public.integraciones_hotel ih
      WHERE ih.hotel_id = p_hotel_id
    ), '[]'::jsonb),
    'eventos_sistema', COALESCE((
      SELECT jsonb_agg(to_jsonb(es) ORDER BY es.created_at DESC)
      FROM public.eventos_sistema es
      WHERE es.hotel_id = p_hotel_id
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.saas_otorgar_dias_gracia(
  p_hotel_id uuid,
  p_dias integer,
  p_motivo text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hotel public.hoteles%rowtype;
  v_base timestamp with time zone;
  v_gracia_hasta timestamp with time zone;
  v_motivo text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para otorgar dias de gracia.';
  END IF;

  IF NOT public.actor_is_saas_superadmin() THEN
    RAISE EXCEPTION 'Solo superadmin puede otorgar dias de gracia.';
  END IF;

  IF p_hotel_id IS NULL THEN
    RAISE EXCEPTION 'Debes indicar el hotel al que quieres otorgar gracia.';
  END IF;

  IF p_dias IS NULL OR p_dias <= 0 OR p_dias > 90 THEN
    RAISE EXCEPTION 'Los dias de gracia deben estar entre 1 y 90.';
  END IF;

  SELECT *
    INTO v_hotel
    FROM public.hoteles
   WHERE id = p_hotel_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el hotel indicado.';
  END IF;

  v_base := GREATEST(
    now(),
    COALESCE(v_hotel.gracia_hasta, now()),
    COALESCE(v_hotel.suscripcion_fin, v_hotel.trial_fin, now())
  );
  v_gracia_hasta := v_base + make_interval(days => p_dias);
  v_motivo := NULLIF(BTRIM(COALESCE(p_motivo, '')), '');

  UPDATE public.hoteles
     SET gracia_hasta = v_gracia_hasta,
         gracia_motivo = v_motivo,
         gracia_actualizada_en = now()
   WHERE id = p_hotel_id;

  INSERT INTO public.bitacora (
    hotel_id,
    usuario_id,
    modulo,
    accion,
    detalles,
    creado_en
  ) VALUES (
    p_hotel_id,
    auth.uid(),
    'Ops SaaS',
    'DIAS_GRACIA_OTORGADOS',
    jsonb_build_object(
      'dias', p_dias,
      'motivo', COALESCE(v_motivo, ''),
      'gracia_hasta', v_gracia_hasta,
      'estado_suscripcion', v_hotel.estado_suscripcion
    ),
    now()
  );

  RETURN jsonb_build_object(
    'hotel_id', p_hotel_id,
    'hotel_nombre', v_hotel.nombre,
    'dias_otorgados', p_dias,
    'gracia_hasta', v_gracia_hasta,
    'motivo', COALESCE(v_motivo, '')
  );
END;
$function$;
