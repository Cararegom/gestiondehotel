-- Fase 4/4 - Indicadores gerenciales del modulo de mantenimiento.
-- Devuelve un resumen tenant-safe de carga, SLA, reincidencias, categorias,
-- responsables y preventivos proximos sin exponer datos de otros hoteles.

CREATE OR REPLACE FUNCTION public.mantenimiento_metricas(p_dias integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_hotel uuid := public.get_current_user_hotel_id();
  v_dias integer := greatest(7, least(coalesce(p_dias, 30), 365));
  v_desde timestamptz := now() - make_interval(days => greatest(7, least(coalesce(p_dias, 30), 365)));
  v_total_sla integer;
  v_cumple_sla integer;
BEGIN
  IF v_hotel IS NULL THEN
    RAISE EXCEPTION 'MANTENIMIENTO_HOTEL_NO_RESUELTO' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*),
         count(*) FILTER (
           WHERE coalesce(tm.cerrada_en, tm.fecha_completada) <= tm.vencimiento_at
         )
    INTO v_total_sla, v_cumple_sla
    FROM public.tareas_mantenimiento tm
   WHERE tm.hotel_id = v_hotel
     AND public.mantenimiento_estado_canonico(tm.estado::text) = 'cerrado'
     AND coalesce(tm.cerrada_en, tm.fecha_completada) >= v_desde
     AND tm.vencimiento_at IS NOT NULL;

  RETURN jsonb_build_object(
    'periodo_dias', v_dias,
    'resumen', jsonb_build_object(
      'abiertas', (
        SELECT count(*)
        FROM public.tareas_mantenimiento tm
        WHERE tm.hotel_id = v_hotel
          AND public.mantenimiento_estado_es_abierto(tm.estado::text)
      ),
      'vencidas', (
        SELECT count(*)
        FROM public.tareas_mantenimiento tm
        WHERE tm.hotel_id = v_hotel
          AND public.mantenimiento_estado_es_abierto(tm.estado::text)
          AND tm.vencimiento_at < now()
      ),
      'sin_asignar', (
        SELECT count(*)
        FROM public.tareas_mantenimiento tm
        WHERE tm.hotel_id = v_hotel
          AND public.mantenimiento_estado_es_abierto(tm.estado::text)
          AND tm.asignada_a IS NULL
      ),
      'cerradas_periodo', (
        SELECT count(*)
        FROM public.tareas_mantenimiento tm
        WHERE tm.hotel_id = v_hotel
          AND public.mantenimiento_estado_canonico(tm.estado::text) = 'cerrado'
          AND coalesce(tm.cerrada_en, tm.fecha_completada) >= v_desde
      ),
      'cumplimiento_sla_pct', CASE
        WHEN v_total_sla = 0 THEN NULL
        ELSE round((v_cumple_sla::numeric * 100) / v_total_sla, 1)
      END,
      'tiempo_promedio_resolucion_min', (
        SELECT round(avg(
          extract(epoch from (coalesce(tm.cerrada_en, tm.fecha_completada) - tm.creado_en)) / 60.0
        ))
        FROM public.tareas_mantenimiento tm
        WHERE tm.hotel_id = v_hotel
          AND public.mantenimiento_estado_canonico(tm.estado::text) = 'cerrado'
          AND coalesce(tm.cerrada_en, tm.fecha_completada) >= v_desde
          AND coalesce(tm.cerrada_en, tm.fecha_completada) IS NOT NULL
      ),
      'preventivos_7d', (
        SELECT count(*)
        FROM public.tareas_mantenimiento tm
        WHERE tm.hotel_id = v_hotel
          AND public.mantenimiento_estado_es_abierto(tm.estado::text)
          AND tm.frecuencia::text IN ('diaria','semanal','mensual')
          AND tm.fecha_programada BETWEEN
              (now() AT TIME ZONE 'America/Bogota')::date
              AND ((now() AT TIME ZONE 'America/Bogota')::date + 7)
      )
    ),
    'reincidencias', (
      SELECT coalesce(
        jsonb_agg(to_jsonb(x) ORDER BY x.reportes DESC, x.habitacion_nombre),
        '[]'::jsonb
      )
      FROM (
        SELECT tm.habitacion_id,
               h.nombre AS habitacion_nombre,
               coalesce(tm.categoria_mantenimiento, 'general') AS categoria,
               count(*)::int AS reportes
        FROM public.tareas_mantenimiento tm
        LEFT JOIN public.habitaciones h ON h.id = tm.habitacion_id
        WHERE tm.hotel_id = v_hotel
          AND tm.habitacion_id IS NOT NULL
          AND tm.creado_en >= v_desde
        GROUP BY tm.habitacion_id,
                 h.nombre,
                 coalesce(tm.categoria_mantenimiento, 'general')
        HAVING count(*) >= 2
        ORDER BY count(*) DESC, h.nombre
        LIMIT 6
      ) x
    ),
    'categorias', (
      SELECT coalesce(
        jsonb_agg(to_jsonb(x) ORDER BY x.reportes DESC, x.categoria),
        '[]'::jsonb
      )
      FROM (
        SELECT coalesce(tm.categoria_mantenimiento, 'general') AS categoria,
               count(*)::int AS reportes
        FROM public.tareas_mantenimiento tm
        WHERE tm.hotel_id = v_hotel
          AND tm.creado_en >= v_desde
        GROUP BY coalesce(tm.categoria_mantenimiento, 'general')
        ORDER BY count(*) DESC
        LIMIT 6
      ) x
    ),
    'responsables', (
      SELECT coalesce(
        jsonb_agg(to_jsonb(x) ORDER BY x.abiertas DESC, x.nombre),
        '[]'::jsonb
      )
      FROM (
        SELECT tm.asignada_a AS usuario_id,
               coalesce(u.nombre, u.correo, u.email, 'Sin nombre') AS nombre,
               count(*)::int AS abiertas,
               count(*) FILTER (WHERE tm.vencimiento_at < now())::int AS vencidas
        FROM public.tareas_mantenimiento tm
        LEFT JOIN public.usuarios u ON u.id = tm.asignada_a
        WHERE tm.hotel_id = v_hotel
          AND tm.asignada_a IS NOT NULL
          AND public.mantenimiento_estado_es_abierto(tm.estado::text)
        GROUP BY tm.asignada_a, u.nombre, u.correo, u.email
        ORDER BY count(*) DESC
        LIMIT 8
      ) x
    ),
    'preventivos', (
      SELECT coalesce(
        jsonb_agg(to_jsonb(x) ORDER BY x.fecha_programada, x.titulo),
        '[]'::jsonb
      )
      FROM (
        SELECT tm.id,
               tm.titulo,
               tm.fecha_programada,
               tm.prioridad,
               h.nombre AS habitacion_nombre
        FROM public.tareas_mantenimiento tm
        LEFT JOIN public.habitaciones h ON h.id = tm.habitacion_id
        WHERE tm.hotel_id = v_hotel
          AND public.mantenimiento_estado_es_abierto(tm.estado::text)
          AND tm.frecuencia::text IN ('diaria','semanal','mensual')
          AND tm.fecha_programada BETWEEN
              (now() AT TIME ZONE 'America/Bogota')::date
              AND ((now() AT TIME ZONE 'America/Bogota')::date + 7)
        ORDER BY tm.fecha_programada, tm.prioridad DESC
        LIMIT 8
      ) x
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mantenimiento_metricas(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mantenimiento_metricas(integer)
  TO authenticated, service_role;
