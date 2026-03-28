BEGIN;

CREATE TABLE IF NOT EXISTS public.eventos_sistema (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NULL REFERENCES public.hoteles(id) ON DELETE SET NULL,
  usuario_id uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  scope text NOT NULL DEFAULT 'hotel',
  source text NOT NULL,
  level text NOT NULL,
  event_type text NOT NULL,
  message text NOT NULL,
  route text NULL,
  user_agent text NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT eventos_sistema_level_check CHECK (level IN ('debug', 'info', 'warn', 'error', 'fatal')),
  CONSTRAINT eventos_sistema_scope_check CHECK (scope IN ('hotel', 'saas', 'landing', 'backend'))
);

CREATE INDEX IF NOT EXISTS eventos_sistema_created_at_idx
  ON public.eventos_sistema (created_at DESC);

CREATE INDEX IF NOT EXISTS eventos_sistema_hotel_id_idx
  ON public.eventos_sistema (hotel_id);

CREATE INDEX IF NOT EXISTS eventos_sistema_level_idx
  ON public.eventos_sistema (level);

ALTER TABLE public.eventos_sistema ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eventos_sistema_insert_own ON public.eventos_sistema;
CREATE POLICY eventos_sistema_insert_own
ON public.eventos_sistema
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = usuario_id
  AND EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = auth.uid()
      AND (
        u.rol = 'superadmin'
        OR hotel_id IS NULL
        OR u.hotel_id = hotel_id
      )
  )
);

DROP POLICY IF EXISTS eventos_sistema_select_scope ON public.eventos_sistema;
CREATE POLICY eventos_sistema_select_scope
ON public.eventos_sistema
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = auth.uid()
      AND (
        u.rol = 'superadmin'
        OR (eventos_sistema.hotel_id IS NOT NULL AND u.hotel_id = eventos_sistema.hotel_id)
      )
  )
);

CREATE OR REPLACE FUNCTION public.registrar_evento_sistema(
  p_hotel_id uuid,
  p_usuario_id uuid,
  p_scope text,
  p_source text,
  p_level text,
  p_event_type text,
  p_message text,
  p_route text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_evento_id uuid;
  v_hotel_resuelto uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para registrar eventos.';
  END IF;

  IF p_usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No puedes registrar eventos a nombre de otro usuario.';
  END IF;

  SELECT *
    INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro perfil de usuario para registrar eventos.';
  END IF;

  IF p_level NOT IN ('debug', 'info', 'warn', 'error', 'fatal') THEN
    RAISE EXCEPTION 'Nivel de evento invalido: %', p_level;
  END IF;

  IF COALESCE(BTRIM(p_source), '') = '' THEN
    RAISE EXCEPTION 'El origen del evento es obligatorio.';
  END IF;

  IF COALESCE(BTRIM(p_event_type), '') = '' THEN
    RAISE EXCEPTION 'El tipo de evento es obligatorio.';
  END IF;

  IF COALESCE(BTRIM(p_message), '') = '' THEN
    RAISE EXCEPTION 'El mensaje del evento es obligatorio.';
  END IF;

  v_hotel_resuelto := COALESCE(p_hotel_id, v_actor.hotel_id);

  IF v_actor.rol <> 'superadmin' AND v_hotel_resuelto IS DISTINCT FROM v_actor.hotel_id THEN
    RAISE EXCEPTION 'No puedes registrar eventos fuera de tu hotel.';
  END IF;

  INSERT INTO public.eventos_sistema (
    hotel_id,
    usuario_id,
    scope,
    source,
    level,
    event_type,
    message,
    route,
    user_agent,
    details
  ) VALUES (
    v_hotel_resuelto,
    p_usuario_id,
    COALESCE(NULLIF(BTRIM(p_scope), ''), 'hotel'),
    BTRIM(p_source),
    p_level,
    BTRIM(p_event_type),
    BTRIM(p_message),
    NULLIF(BTRIM(p_route), ''),
    NULLIF(BTRIM(p_user_agent), ''),
    COALESCE(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_evento_id;

  RETURN v_evento_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.abrir_turno_con_apertura(
  p_hotel_id uuid,
  p_usuario_id uuid,
  p_monto_inicial numeric,
  p_fecha_movimiento timestamp with time zone DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_turno public.turnos%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para abrir turno.';
  END IF;

  IF p_usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No puedes abrir turnos a nombre de otro usuario.';
  END IF;

  IF p_monto_inicial < 0 THEN
    RAISE EXCEPTION 'El monto inicial no puede ser negativo.';
  END IF;

  SELECT *
    INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro perfil de usuario para abrir turno.';
  END IF;

  IF v_actor.rol <> 'superadmin' AND p_hotel_id IS DISTINCT FROM v_actor.hotel_id THEN
    RAISE EXCEPTION 'No puedes abrir turnos fuera de tu hotel.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.turnos t
    WHERE t.hotel_id = p_hotel_id
      AND t.usuario_id = p_usuario_id
      AND t.estado = 'abierto'
      AND t.fecha_cierre IS NULL
  ) THEN
    RAISE EXCEPTION 'Ya existe un turno abierto para este usuario.';
  END IF;

  INSERT INTO public.turnos (
    hotel_id,
    usuario_id,
    fecha_apertura,
    estado
  ) VALUES (
    p_hotel_id,
    p_usuario_id,
    COALESCE(p_fecha_movimiento, now()),
    'abierto'
  )
  RETURNING * INTO v_turno;

  INSERT INTO public.caja (
    hotel_id,
    usuario_id,
    turno_id,
    tipo,
    concepto,
    monto,
    fecha_movimiento
  ) VALUES (
    p_hotel_id,
    p_usuario_id,
    v_turno.id,
    'apertura',
    'Apertura de caja',
    p_monto_inicial,
    COALESCE(p_fecha_movimiento, now())
  );

  RETURN to_jsonb(v_turno);
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_movimiento_caja_atomico(
  p_hotel_id uuid,
  p_usuario_id uuid,
  p_turno_id uuid,
  p_tipo text,
  p_monto numeric,
  p_concepto text,
  p_metodo_pago_id uuid,
  p_fecha_movimiento timestamp with time zone DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_turno public.turnos%rowtype;
  v_movimiento public.caja%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para registrar movimientos.';
  END IF;

  SELECT *
    INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro perfil de usuario para registrar movimientos.';
  END IF;

  IF v_actor.rol <> 'superadmin' AND p_usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No puedes registrar movimientos a nombre de otro usuario.';
  END IF;

  IF v_actor.rol <> 'superadmin' AND p_hotel_id IS DISTINCT FROM v_actor.hotel_id THEN
    RAISE EXCEPTION 'No puedes registrar movimientos fuera de tu hotel.';
  END IF;

  IF p_tipo NOT IN ('apertura', 'ingreso', 'egreso', 'ajuste', 'cierre') THEN
    RAISE EXCEPTION 'Tipo de movimiento invalido: %', p_tipo;
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor que cero.';
  END IF;

  IF COALESCE(BTRIM(p_concepto), '') = '' THEN
    RAISE EXCEPTION 'El concepto es obligatorio.';
  END IF;

  IF p_metodo_pago_id IS NULL THEN
    RAISE EXCEPTION 'El metodo de pago es obligatorio.';
  END IF;

  IF p_turno_id IS NOT NULL THEN
    SELECT *
      INTO v_turno
      FROM public.turnos
     WHERE id = p_turno_id
       AND hotel_id = p_hotel_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se encontro el turno especificado.';
    END IF;

    IF v_turno.estado <> 'abierto' OR v_turno.fecha_cierre IS NOT NULL THEN
      RAISE EXCEPTION 'El turno ya no esta abierto.';
    END IF;

    IF v_actor.rol NOT IN ('admin', 'superadmin') AND v_turno.usuario_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'No puedes registrar movimientos en un turno de otro usuario.';
    END IF;
  END IF;

  INSERT INTO public.caja (
    hotel_id,
    usuario_id,
    turno_id,
    tipo,
    concepto,
    monto,
    metodo_pago_id,
    fecha_movimiento
  ) VALUES (
    p_hotel_id,
    COALESCE(p_usuario_id, auth.uid()),
    p_turno_id,
    p_tipo::public.tipo_movimiento_caja_enum,
    BTRIM(p_concepto),
    p_monto,
    p_metodo_pago_id,
    COALESCE(p_fecha_movimiento, now())
  )
  RETURNING * INTO v_movimiento;

  RETURN to_jsonb(v_movimiento);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cerrar_turno_con_balance(
  p_turno_id uuid,
  p_usuario_id uuid,
  p_balance_final numeric,
  p_fecha_cierre timestamp with time zone DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_turno public.turnos%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para cerrar turnos.';
  END IF;

  SELECT *
    INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro perfil de usuario para cerrar turnos.';
  END IF;

  SELECT *
    INTO v_turno
    FROM public.turnos
   WHERE id = p_turno_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el turno a cerrar.';
  END IF;

  IF v_actor.rol <> 'superadmin' AND v_actor.hotel_id IS DISTINCT FROM v_turno.hotel_id THEN
    RAISE EXCEPTION 'No puedes cerrar turnos fuera de tu hotel.';
  END IF;

  IF v_actor.rol NOT IN ('admin', 'superadmin') AND auth.uid() IS DISTINCT FROM v_turno.usuario_id THEN
    RAISE EXCEPTION 'No puedes cerrar el turno de otro usuario.';
  END IF;

  IF v_turno.fecha_cierre IS NOT NULL OR v_turno.estado = 'cerrado' THEN
    RAISE EXCEPTION 'El turno ya se encuentra cerrado.';
  END IF;

  UPDATE public.turnos
     SET estado = 'cerrado',
         fecha_cierre = COALESCE(p_fecha_cierre, now()),
         balance_final = p_balance_final
   WHERE id = p_turno_id
   RETURNING * INTO v_turno;

  RETURN to_jsonb(v_turno);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rls_audit_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para ver la auditoria de seguridad.';
  END IF;

  SELECT *
    INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND OR v_actor.rol <> 'superadmin' THEN
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

CREATE OR REPLACE FUNCTION public.saas_listar_hoteles()
RETURNS TABLE (
  id uuid,
  nombre text,
  plan text,
  estado_suscripcion text,
  activo boolean,
  creado_en timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para consultar hoteles.';
  END IF;

  SELECT *
    INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND OR v_actor.rol <> 'superadmin' THEN
    RAISE EXCEPTION 'Solo superadmin puede consultar el listado global de hoteles.';
  END IF;

  RETURN QUERY
  SELECT h.id, h.nombre, h.plan::text, h.estado_suscripcion, h.activo, h.creado_en
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
  v_actor public.usuarios%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para consultar la consola SaaS.';
  END IF;

  SELECT *
    INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND OR v_actor.rol <> 'superadmin' THEN
    RAISE EXCEPTION 'Solo superadmin puede consultar la consola SaaS.';
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
      )
    ),
    'recent_hotels', COALESCE((
      SELECT jsonb_agg(to_jsonb(x))
      FROM (
        SELECT h.id, h.nombre, h.plan::text AS plan, h.estado_suscripcion, h.activo, h.creado_en
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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro perfil de usuario para exportar.';
  END IF;

  IF v_actor.rol <> 'superadmin' AND p_hotel_id IS DISTINCT FROM v_actor.hotel_id THEN
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

COMMIT;
