-- A17: unifica la recurrencia de mantenimiento en mantenimiento_planes.
-- Las tareas son ejecuciones: una tarea suelta es unica y una tarea de plan
-- usa personalizada. El navegador deja de crear la siguiente ocurrencia.

CREATE OR REPLACE FUNCTION public.mantenimiento_plan_primera_fecha_desde(
  p_fecha_ancla date,
  p_desde date,
  p_unidad text,
  p_intervalo integer
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  v_intervalo integer := GREATEST(COALESCE(p_intervalo, 1), 1);
  v_pasos integer := 0;
  v_candidata date;
  v_distancia_meses integer;
  v_distancia_anios integer;
BEGIN
  IF p_fecha_ancla IS NULL OR p_desde IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_desde <= p_fecha_ancla THEN
    RETURN p_fecha_ancla;
  END IF;

  CASE COALESCE(p_unidad, 'ninguna')
    WHEN 'dia' THEN
      v_pasos := ((p_desde - p_fecha_ancla) / v_intervalo)::integer;
      v_candidata := p_fecha_ancla + (v_pasos * v_intervalo);
    WHEN 'semana' THEN
      v_pasos := ((p_desde - p_fecha_ancla) / (v_intervalo * 7))::integer;
      v_candidata := p_fecha_ancla + (v_pasos * v_intervalo * 7);
    WHEN 'mes' THEN
      v_distancia_meses := (
        (EXTRACT(year FROM p_desde)::integer - EXTRACT(year FROM p_fecha_ancla)::integer) * 12
        + EXTRACT(month FROM p_desde)::integer
        - EXTRACT(month FROM p_fecha_ancla)::integer
      );
      v_pasos := GREATEST(v_distancia_meses / v_intervalo, 0);
      v_candidata := CASE
        WHEN v_pasos = 0 THEN p_fecha_ancla
        ELSE public.mantenimiento_plan_siguiente_fecha(
          p_fecha_ancla,
          p_fecha_ancla,
          'mes',
          v_pasos * v_intervalo
        )
      END;
    WHEN 'anio' THEN
      v_distancia_anios := EXTRACT(year FROM p_desde)::integer
        - EXTRACT(year FROM p_fecha_ancla)::integer;
      v_pasos := GREATEST(v_distancia_anios / v_intervalo, 0);
      v_candidata := CASE
        WHEN v_pasos = 0 THEN p_fecha_ancla
        ELSE public.mantenimiento_plan_siguiente_fecha(
          p_fecha_ancla,
          p_fecha_ancla,
          'anio',
          v_pasos * v_intervalo
        )
      END;
    WHEN 'ninguna' THEN
      RETURN NULL;
    ELSE
      RAISE EXCEPTION 'Unidad de recurrencia no valida: %', p_unidad USING ERRCODE = '22023';
  END CASE;

  IF v_candidata < p_desde THEN
    v_candidata := public.mantenimiento_plan_siguiente_fecha(
      v_candidata,
      p_fecha_ancla,
      p_unidad,
      v_intervalo
    );
  END IF;

  RETURN v_candidata;
END;
$$;

REVOKE ALL ON FUNCTION public.mantenimiento_plan_primera_fecha_desde(date, date, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mantenimiento_plan_primera_fecha_desde(date, date, text, integer)
  TO authenticated, service_role;

-- Cada configuracion legacy abierta se convierte en un solo plan. Si existen
-- varias ocurrencias abiertas de la misma rutina, todas se enlazan al mismo plan.
-- Duplicados para una misma fecha se conservan como tareas unicas para no borrar
-- ni alterar su estado operativo.
CREATE TEMP TABLE a17_mantenimiento_grupos_legacy ON COMMIT DROP AS
SELECT
  gen_random_uuid() AS plan_id,
  tm.hotel_id,
  tm.titulo,
  tm.descripcion,
  tm.tipo,
  COALESCE(tm.categoria_mantenimiento, 'general') AS categoria_mantenimiento,
  tm.frecuencia,
  tm.habitacion_id,
  tm.ubicacion_mantenimiento,
  tm.asignada_a,
  tm.creada_por,
  COALESCE(tm.prioridad, 1) AS prioridad,
  min(COALESCE(tm.fecha_programada, public.hotel_business_date(tm.hotel_id, now()))) AS fecha_ancla,
  max(COALESCE(tm.fecha_programada, public.hotel_business_date(tm.hotel_id, now()))) AS ultima_fecha
FROM public.tareas_mantenimiento tm
WHERE tm.plan_id IS NULL
  AND tm.frecuencia::text IN ('diaria', 'semanal', 'mensual')
  AND public.mantenimiento_estado_es_abierto(tm.estado::text)
GROUP BY
  tm.hotel_id,
  tm.titulo,
  tm.descripcion,
  tm.tipo,
  COALESCE(tm.categoria_mantenimiento, 'general'),
  tm.frecuencia,
  tm.habitacion_id,
  tm.ubicacion_mantenimiento,
  tm.asignada_a,
  tm.creada_por,
  COALESCE(tm.prioridad, 1);

INSERT INTO public.mantenimiento_planes(
  id,
  hotel_id,
  clase,
  titulo,
  descripcion,
  ubicacion,
  categoria_mantenimiento,
  prioridad,
  alcance,
  habitacion_id,
  asignada_a,
  creada_por,
  activo,
  fecha_inicio,
  recurrencia_unidad,
  recurrencia_intervalo,
  anticipaciones_dias,
  requiere_evidencia,
  checklist,
  proxima_fecha
)
SELECT
  g.plan_id,
  g.hotel_id,
  'preventivo',
  g.titulo,
  g.descripcion,
  g.ubicacion_mantenimiento,
  g.categoria_mantenimiento,
  g.prioridad,
  CASE WHEN g.habitacion_id IS NULL THEN 'general' ELSE 'habitacion' END,
  g.habitacion_id,
  g.asignada_a,
  g.creada_por,
  true,
  g.fecha_ancla,
  CASE g.frecuencia::text
    WHEN 'diaria' THEN 'dia'
    WHEN 'semanal' THEN 'semana'
    WHEN 'mensual' THEN 'mes'
  END,
  1,
  ARRAY[1, 0],
  false,
  '[]'::jsonb,
  public.mantenimiento_plan_primera_fecha_desde(
    g.fecha_ancla,
    GREATEST(
      g.ultima_fecha + 1,
      public.hotel_business_date(g.hotel_id, now())
    ),
    CASE g.frecuencia::text
      WHEN 'diaria' THEN 'dia'
      WHEN 'semanal' THEN 'semana'
      WHEN 'mensual' THEN 'mes'
    END,
    1
  )
FROM a17_mantenimiento_grupos_legacy g;

WITH candidatas AS (
  SELECT
    tm.id AS tarea_id,
    g.plan_id,
    row_number() OVER (
      PARTITION BY g.plan_id, tm.fecha_programada
      ORDER BY tm.creado_en, tm.id
    ) AS posicion_fecha
  FROM public.tareas_mantenimiento tm
  JOIN a17_mantenimiento_grupos_legacy g
    ON g.hotel_id = tm.hotel_id
   AND g.titulo = tm.titulo
   AND g.descripcion IS NOT DISTINCT FROM tm.descripcion
   AND g.tipo = tm.tipo
   AND g.categoria_mantenimiento = COALESCE(tm.categoria_mantenimiento, 'general')
   AND g.frecuencia = tm.frecuencia
   AND g.habitacion_id IS NOT DISTINCT FROM tm.habitacion_id
   AND g.ubicacion_mantenimiento IS NOT DISTINCT FROM tm.ubicacion_mantenimiento
   AND g.asignada_a IS NOT DISTINCT FROM tm.asignada_a
   AND g.creada_por IS NOT DISTINCT FROM tm.creada_por
   AND g.prioridad = COALESCE(tm.prioridad, 1)
  WHERE tm.plan_id IS NULL
    AND tm.frecuencia::text IN ('diaria', 'semanal', 'mensual')
    AND public.mantenimiento_estado_es_abierto(tm.estado::text)
)
UPDATE public.tareas_mantenimiento tm
SET plan_id = CASE WHEN c.posicion_fecha = 1 THEN c.plan_id ELSE NULL END,
    frecuencia = CASE
      WHEN c.posicion_fecha = 1 THEN 'personalizada'::public.frecuencia_tarea_enum
      ELSE 'unica'::public.frecuencia_tarea_enum
    END,
    actualizado_en = now()
FROM candidatas c
WHERE tm.id = c.tarea_id;

CREATE OR REPLACE FUNCTION public.validar_mantenimiento_recurrencia_unificada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF NEW.plan_id IS NULL
     AND COALESCE(NEW.frecuencia::text, 'unica') <> 'unica' THEN
    RAISE EXCEPTION 'A17_RECURRENCIA_REQUIERE_PLAN: programa la recurrencia en mantenimiento_planes.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.plan_id IS NOT NULL THEN
    IF COALESCE(NEW.frecuencia::text, '') <> 'personalizada' THEN
      RAISE EXCEPTION 'A17_FRECUENCIA_PLAN_INVALIDA: una ejecucion de plan debe usar frecuencia personalizada.'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.mantenimiento_planes mp
      WHERE mp.id = NEW.plan_id
        AND mp.hotel_id = NEW.hotel_id
    ) THEN
      RAISE EXCEPTION 'A17_PLAN_HOTEL_INVALIDO: el plan no pertenece al hotel de la tarea.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validar_mantenimiento_recurrencia_unificada()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validar_mantenimiento_recurrencia_unificada()
  TO service_role;

DROP TRIGGER IF EXISTS trg_validar_mantenimiento_recurrencia_unificada
  ON public.tareas_mantenimiento;
CREATE TRIGGER trg_validar_mantenimiento_recurrencia_unificada
BEFORE INSERT OR UPDATE OF hotel_id, plan_id, frecuencia
ON public.tareas_mantenimiento
FOR EACH ROW
EXECUTE FUNCTION public.validar_mantenimiento_recurrencia_unificada();

COMMENT ON FUNCTION public.validar_mantenimiento_recurrencia_unificada() IS
  'A17: garantiza un solo motor de recurrencia. Las tareas sueltas son unicas y las ejecuciones recurrentes pertenecen a mantenimiento_planes.';
