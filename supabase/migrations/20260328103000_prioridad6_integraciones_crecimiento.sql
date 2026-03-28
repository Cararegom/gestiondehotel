CREATE TABLE IF NOT EXISTS public.landing_conversion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'landing',
  event_name text NOT NULL,
  visitor_id text,
  session_id text,
  page_path text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_landing_conversion_events_created_at
  ON public.landing_conversion_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_landing_conversion_events_event_name
  ON public.landing_conversion_events (event_name);

ALTER TABLE public.landing_conversion_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS landing_conversion_events_superadmin_select ON public.landing_conversion_events;
CREATE POLICY landing_conversion_events_superadmin_select
  ON public.landing_conversion_events
  FOR SELECT
  TO authenticated
  USING (public.actor_is_saas_superadmin());


CREATE TABLE IF NOT EXISTS public.landing_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'chatbot_comercial',
  status text NOT NULL DEFAULT 'nuevo',
  full_name text,
  business_name text,
  country text,
  city text,
  room_count integer,
  email citext,
  whatsapp text,
  interest text,
  plan_interest text,
  page_path text,
  referrer text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT landing_leads_status_check CHECK (status = ANY (ARRAY['nuevo', 'contactado', 'calificado', 'descartado'])),
  CONSTRAINT landing_leads_room_count_check CHECK (room_count IS NULL OR room_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_landing_leads_created_at
  ON public.landing_leads (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_landing_leads_status
  ON public.landing_leads (status);

CREATE INDEX IF NOT EXISTS idx_landing_leads_email
  ON public.landing_leads (email);

ALTER TABLE public.landing_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS landing_leads_superadmin_select ON public.landing_leads;
CREATE POLICY landing_leads_superadmin_select
  ON public.landing_leads
  FOR SELECT
  TO authenticated
  USING (public.actor_is_saas_superadmin());


CREATE TABLE IF NOT EXISTS public.integraciones_interes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  categoria text NOT NULL,
  proveedor text NOT NULL,
  estado text NOT NULL DEFAULT 'nuevo',
  source text NOT NULL DEFAULT 'modulo_integraciones',
  notas text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT integraciones_interes_estado_check CHECK (estado = ANY (ARRAY['nuevo', 'evaluando', 'priorizado', 'descartado', 'implementado']))
);

CREATE INDEX IF NOT EXISTS idx_integraciones_interes_hotel
  ON public.integraciones_interes (hotel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_integraciones_interes_proveedor
  ON public.integraciones_interes (proveedor);

ALTER TABLE public.integraciones_interes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integraciones_interes_select_hotel_or_superadmin ON public.integraciones_interes;
CREATE POLICY integraciones_interes_select_hotel_or_superadmin
  ON public.integraciones_interes
  FOR SELECT
  TO authenticated
  USING (
    public.actor_is_saas_superadmin()
    OR hotel_id = public.get_current_user_hotel_id_from_profile()
  );

DROP POLICY IF EXISTS integraciones_interes_insert_hotel_admin ON public.integraciones_interes;
CREATE POLICY integraciones_interes_insert_hotel_admin
  ON public.integraciones_interes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    hotel_id = public.get_current_user_hotel_id_from_profile()
    AND usuario_id = auth.uid()
    AND public.get_current_user_rol_from_profile() = ANY (ARRAY['admin'::public.rol_usuario_enum, 'superadmin'::public.rol_usuario_enum])
  );

DROP POLICY IF EXISTS integraciones_interes_update_superadmin ON public.integraciones_interes;
CREATE POLICY integraciones_interes_update_superadmin
  ON public.integraciones_interes
  FOR UPDATE
  TO authenticated
  USING (public.actor_is_saas_superadmin())
  WITH CHECK (public.actor_is_saas_superadmin());


CREATE TABLE IF NOT EXISTS public.grupos_hoteleros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  nombre text NOT NULL,
  slug text UNIQUE,
  descripcion text,
  activo boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL
);

ALTER TABLE public.grupos_hoteleros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grupos_hoteleros_superadmin_all ON public.grupos_hoteleros;
CREATE POLICY grupos_hoteleros_superadmin_all
  ON public.grupos_hoteleros
  FOR ALL
  TO authenticated
  USING (public.actor_is_saas_superadmin())
  WITH CHECK (public.actor_is_saas_superadmin());


CREATE TABLE IF NOT EXISTS public.grupo_hoteles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  grupo_id uuid NOT NULL REFERENCES public.grupos_hoteleros(id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  CONSTRAINT grupo_hoteles_unique_grupo_hotel UNIQUE (grupo_id, hotel_id),
  CONSTRAINT grupo_hoteles_unique_hotel UNIQUE (hotel_id)
);

ALTER TABLE public.grupo_hoteles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grupo_hoteles_superadmin_all ON public.grupo_hoteles;
CREATE POLICY grupo_hoteles_superadmin_all
  ON public.grupo_hoteles
  FOR ALL
  TO authenticated
  USING (public.actor_is_saas_superadmin())
  WITH CHECK (public.actor_is_saas_superadmin());


CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_integraciones_interes_touch_updated_at ON public.integraciones_interes;
CREATE TRIGGER tr_integraciones_interes_touch_updated_at
BEFORE UPDATE ON public.integraciones_interes
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS tr_grupos_hoteleros_touch_updated_at ON public.grupos_hoteleros;
CREATE TRIGGER tr_grupos_hoteleros_touch_updated_at
BEFORE UPDATE ON public.grupos_hoteleros
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();


CREATE OR REPLACE FUNCTION public.solicitar_integracion_hotel(
  p_categoria text,
  p_proveedor text,
  p_notas text DEFAULT NULL::text,
  p_source text DEFAULT 'modulo_integraciones'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_record public.integraciones_interes%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para solicitar una integracion.';
  END IF;

  SELECT *
    INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro perfil de usuario para registrar la solicitud.';
  END IF;

  IF v_actor.hotel_id IS NULL THEN
    RAISE EXCEPTION 'Tu usuario no tiene hotel asociado.';
  END IF;

  IF v_actor.rol NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Solo administradores del hotel pueden solicitar integraciones.';
  END IF;

  IF COALESCE(BTRIM(p_categoria), '') = '' THEN
    RAISE EXCEPTION 'La categoria es obligatoria.';
  END IF;

  IF COALESCE(BTRIM(p_proveedor), '') = '' THEN
    RAISE EXCEPTION 'El proveedor es obligatorio.';
  END IF;

  INSERT INTO public.integraciones_interes (
    hotel_id,
    usuario_id,
    categoria,
    proveedor,
    estado,
    source,
    notas
  ) VALUES (
    v_actor.hotel_id,
    auth.uid(),
    BTRIM(p_categoria),
    BTRIM(p_proveedor),
    'nuevo',
    COALESCE(NULLIF(BTRIM(p_source), ''), 'modulo_integraciones'),
    NULLIF(BTRIM(p_notas), '')
  )
  RETURNING * INTO v_record;

  RETURN jsonb_build_object(
    'id', v_record.id,
    'hotel_id', v_record.hotel_id,
    'categoria', v_record.categoria,
    'proveedor', v_record.proveedor,
    'estado', v_record.estado,
    'created_at', v_record.created_at
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.saas_recent_landing_leads(p_limit integer DEFAULT 12)
RETURNS TABLE (
  id uuid,
  created_at timestamp with time zone,
  full_name text,
  business_name text,
  country text,
  city text,
  room_count integer,
  email text,
  whatsapp text,
  interest text,
  plan_interest text,
  status text,
  source text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para consultar leads.';
  END IF;

  IF NOT public.actor_is_saas_superadmin() THEN
    RAISE EXCEPTION 'Solo superadmin puede consultar leads de la landing.';
  END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.created_at,
    l.full_name,
    l.business_name,
    l.country,
    l.city,
    l.room_count,
    l.email::text,
    l.whatsapp,
    l.interest,
    l.plan_interest,
    l.status,
    l.source
  FROM public.landing_leads l
  ORDER BY l.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50);
END;
$function$;


CREATE OR REPLACE FUNCTION public.saas_listar_integraciones_interes(p_limit integer DEFAULT 20)
RETURNS TABLE (
  id uuid,
  created_at timestamp with time zone,
  hotel_id uuid,
  hotel_nombre text,
  usuario_id uuid,
  usuario_correo text,
  categoria text,
  proveedor text,
  estado text,
  source text,
  notas text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para consultar solicitudes de integracion.';
  END IF;

  IF NOT public.actor_is_saas_superadmin() THEN
    RAISE EXCEPTION 'Solo superadmin puede consultar solicitudes de integracion.';
  END IF;

  RETURN QUERY
  SELECT
    ii.id,
    ii.created_at,
    ii.hotel_id,
    h.nombre AS hotel_nombre,
    ii.usuario_id,
    u.correo::text AS usuario_correo,
    ii.categoria,
    ii.proveedor,
    ii.estado,
    ii.source,
    ii.notas
  FROM public.integraciones_interes ii
  LEFT JOIN public.hoteles h ON h.id = ii.hotel_id
  LEFT JOIN public.usuarios u ON u.id = ii.usuario_id
  ORDER BY ii.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
END;
$function$;


CREATE OR REPLACE FUNCTION public.saas_usage_by_hotel()
RETURNS TABLE (
  hotel_id uuid,
  hotel_nombre text,
  plan text,
  habitaciones_activas bigint,
  usuarios_activos bigint,
  reservas_30d bigint,
  movimientos_caja_30d bigint,
  ventas_tienda_30d bigint,
  ventas_restaurante_30d bigint,
  incidencias_30d bigint,
  errores_30d bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para consultar uso por hotel.';
  END IF;

  IF NOT public.actor_is_saas_superadmin() THEN
    RAISE EXCEPTION 'Solo superadmin puede consultar uso por hotel.';
  END IF;

  RETURN QUERY
  SELECT
    h.id AS hotel_id,
    h.nombre AS hotel_nombre,
    h.plan::text AS plan,
    COALESCE((SELECT COUNT(*) FROM public.habitaciones hb WHERE hb.hotel_id = h.id AND COALESCE(hb.activo, true)), 0)::bigint AS habitaciones_activas,
    COALESCE((SELECT COUNT(*) FROM public.usuarios u WHERE u.hotel_id = h.id AND COALESCE(u.activo, true)), 0)::bigint AS usuarios_activos,
    COALESCE((SELECT COUNT(*) FROM public.reservas r WHERE r.hotel_id = h.id AND r.creado_en >= now() - interval '30 days'), 0)::bigint AS reservas_30d,
    COALESCE((SELECT COUNT(*) FROM public.caja c WHERE c.hotel_id = h.id AND c.creado_en >= now() - interval '30 days'), 0)::bigint AS movimientos_caja_30d,
    COALESCE((SELECT COUNT(*) FROM public.ventas_tienda vt WHERE vt.hotel_id = h.id AND vt.fecha >= now() - interval '30 days'), 0)::bigint AS ventas_tienda_30d,
    COALESCE((SELECT COUNT(*) FROM public.ventas_restaurante vr WHERE vr.hotel_id = h.id AND vr.fecha >= now() - interval '30 days'), 0)::bigint AS ventas_restaurante_30d,
    COALESCE((SELECT COUNT(*) FROM public.bitacora b WHERE b.hotel_id = h.id AND b.accion IN ('REPORTE_INCIDENCIA_CHAT', 'REPORTE_INCIDENCIA_MANUAL') AND b.creado_en >= now() - interval '30 days'), 0)::bigint AS incidencias_30d,
    COALESCE((SELECT COUNT(*) FROM public.eventos_sistema es WHERE es.hotel_id = h.id AND es.level IN ('error', 'fatal') AND es.created_at >= now() - interval '30 days'), 0)::bigint AS errores_30d
  FROM public.hoteles h
  ORDER BY reservas_30d DESC, h.nombre ASC;
END;
$function$;


CREATE OR REPLACE FUNCTION public.saas_resumen_grupos_hoteleros()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para consultar grupos hoteleros.';
  END IF;

  IF NOT public.actor_is_saas_superadmin() THEN
    RAISE EXCEPTION 'Solo superadmin puede consultar grupos hoteleros.';
  END IF;

  RETURN jsonb_build_object(
    'total_grupos', (SELECT COUNT(*) FROM public.grupos_hoteleros WHERE activo = true),
    'hoteles_agrupados', (SELECT COUNT(*) FROM public.grupo_hoteles),
    'hoteles_sin_grupo', (
      SELECT COUNT(*)
      FROM public.hoteles h
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.grupo_hoteles gh
        WHERE gh.hotel_id = h.id
      )
    )
  );
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
      ),
      'landing_leads_30d', (
        SELECT COUNT(*)
        FROM public.landing_leads
        WHERE created_at >= now() - interval '30 days'
      ),
      'solicitudes_integracion_pendientes', (
        SELECT COUNT(*)
        FROM public.integraciones_interes
        WHERE estado IN ('nuevo', 'evaluando', 'priorizado')
      ),
      'grupos_hoteleros_activos', (
        SELECT COUNT(*)
        FROM public.grupos_hoteleros
        WHERE activo = true
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
    'group_summary', public.saas_resumen_grupos_hoteleros()
  );
END;
$function$;
