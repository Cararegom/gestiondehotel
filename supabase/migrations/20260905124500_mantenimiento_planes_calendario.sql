-- Calendario profesional de mantenimiento y planes preventivos.
-- Esta migracion separa la programacion (plan) de cada ejecucion (tarea).
-- Un plan conserva la regla estable: semanal, cada 15 dias, cada N meses,
-- vencimiento puntual, recordatorios, evidencia y checklist.

CREATE TABLE IF NOT EXISTS public.mantenimiento_planes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  clase text NOT NULL DEFAULT 'preventivo',
  titulo text NOT NULL,
  descripcion text,
  ubicacion text,
  categoria_mantenimiento text NOT NULL DEFAULT 'general',
  prioridad integer NOT NULL DEFAULT 1,
  habitacion_id uuid REFERENCES public.habitaciones(id) ON DELETE SET NULL,
  asignada_a uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creada_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  activo boolean NOT NULL DEFAULT true,
  fecha_inicio date NOT NULL,
  hora_programada time without time zone,
  recurrencia_unidad text NOT NULL DEFAULT 'ninguna',
  recurrencia_intervalo integer NOT NULL DEFAULT 1,
  fecha_fin date,
  anticipaciones_dias integer[] NOT NULL DEFAULT ARRAY[1, 0],
  requiere_evidencia boolean NOT NULL DEFAULT false,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  proxima_fecha date,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mantenimiento_planes_clase_check
    CHECK (clase IN ('tarea', 'preventivo', 'vencimiento')),
  CONSTRAINT mantenimiento_planes_titulo_check
    CHECK (length(btrim(titulo)) BETWEEN 1 AND 180),
  CONSTRAINT mantenimiento_planes_prioridad_check
    CHECK (prioridad BETWEEN 0 AND 3),
  CONSTRAINT mantenimiento_planes_recurrencia_unidad_check
    CHECK (recurrencia_unidad IN ('ninguna', 'dia', 'semana', 'mes', 'anio')),
  CONSTRAINT mantenimiento_planes_recurrencia_intervalo_check
    CHECK (recurrencia_intervalo BETWEEN 1 AND 365),
  CONSTRAINT mantenimiento_planes_fecha_fin_check
    CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
  CONSTRAINT mantenimiento_planes_anticipaciones_check
    CHECK (cardinality(anticipaciones_dias) BETWEEN 1 AND 10),
  CONSTRAINT mantenimiento_planes_checklist_check
    CHECK (jsonb_typeof(checklist) = 'array')
);

COMMENT ON TABLE public.mantenimiento_planes IS
  'Programaciones maestras de mantenimiento. Las ejecuciones se materializan en tareas_mantenimiento.';
COMMENT ON COLUMN public.mantenimiento_planes.clase IS
  'tarea=actividad puntual; preventivo=rutina preventiva; vencimiento=elemento con fecha critica.';
COMMENT ON COLUMN public.mantenimiento_planes.recurrencia_unidad IS
  'Unidad de repeticion anclada a fecha_inicio. La fecha no depende de cuando se complete una tarea.';
COMMENT ON COLUMN public.mantenimiento_planes.recurrencia_intervalo IS
  'Cantidad de unidades entre ocurrencias: 15/dia = cada 15 dias, 3/mes = cada 3 meses.';
COMMENT ON COLUMN public.mantenimiento_planes.anticipaciones_dias IS
  'Dias antes de cada ocurrencia en los que se emiten recordatorios. Puede incluir 0 para el mismo dia.';

CREATE INDEX IF NOT EXISTS ix_mantenimiento_planes_hotel_activo_fecha
  ON public.mantenimiento_planes(hotel_id, activo, proxima_fecha);

CREATE INDEX IF NOT EXISTS ix_mantenimiento_planes_hotel_responsable
  ON public.mantenimiento_planes(hotel_id, asignada_a)
  WHERE asignada_a IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_mantenimiento_planes_hotel_clase
  ON public.mantenimiento_planes(hotel_id, clase, fecha_inicio);

ALTER TABLE public.tareas_mantenimiento
  ADD COLUMN IF NOT EXISTS plan_id uuid,
  ADD COLUMN IF NOT EXISTS ubicacion_mantenimiento text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tareas_mantenimiento_plan_id_fkey'
      AND conrelid = 'public.tareas_mantenimiento'::regclass
  ) THEN
    ALTER TABLE public.tareas_mantenimiento
      ADD CONSTRAINT tareas_mantenimiento_plan_id_fkey
      FOREIGN KEY (plan_id)
      REFERENCES public.mantenimiento_planes(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_tareas_mantenimiento_plan_fecha
  ON public.tareas_mantenimiento(plan_id, fecha_programada)
  WHERE plan_id IS NOT NULL AND fecha_programada IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_tareas_mantenimiento_hotel_plan
  ON public.tareas_mantenimiento(hotel_id, plan_id)
  WHERE plan_id IS NOT NULL;

-- La recurrencia siempre se calcula sobre la fecha prevista anterior y el ancla
-- original. Asi, si una tarea del lunes se completa el martes, la siguiente sigue
-- siendo el lunes que corresponde.
CREATE OR REPLACE FUNCTION public.mantenimiento_plan_siguiente_fecha(
  p_fecha_actual date,
  p_fecha_ancla date,
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
  v_month_start date;
  v_last_day date;
  v_anchor_day integer;
  v_anchor_month integer;
  v_target_year integer;
BEGIN
  IF p_fecha_actual IS NULL OR p_fecha_ancla IS NULL THEN
    RETURN NULL;
  END IF;

  CASE COALESCE(p_unidad, 'ninguna')
    WHEN 'ninguna' THEN
      RETURN NULL;
    WHEN 'dia' THEN
      RETURN p_fecha_actual + v_intervalo;
    WHEN 'semana' THEN
      RETURN p_fecha_actual + (v_intervalo * 7);
    WHEN 'mes' THEN
      v_anchor_day := EXTRACT(day FROM p_fecha_ancla)::integer;
      v_month_start := (
        date_trunc('month', p_fecha_actual::timestamp)
        + make_interval(months => v_intervalo)
      )::date;
      v_last_day := (date_trunc('month', v_month_start::timestamp) + interval '1 month - 1 day')::date;
      RETURN v_month_start
        + (LEAST(v_anchor_day, EXTRACT(day FROM v_last_day)::integer) - 1);
    WHEN 'anio' THEN
      v_anchor_day := EXTRACT(day FROM p_fecha_ancla)::integer;
      v_anchor_month := EXTRACT(month FROM p_fecha_ancla)::integer;
      v_target_year := EXTRACT(year FROM p_fecha_actual)::integer + v_intervalo;
      v_month_start := make_date(v_target_year, v_anchor_month, 1);
      v_last_day := (date_trunc('month', v_month_start::timestamp) + interval '1 month - 1 day')::date;
      RETURN v_month_start
        + (LEAST(v_anchor_day, EXTRACT(day FROM v_last_day)::integer) - 1);
    ELSE
      RAISE EXCEPTION 'Unidad de recurrencia no valida: %', p_unidad USING ERRCODE = '22023';
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.mantenimiento_plan_siguiente_fecha(date, date, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mantenimiento_plan_siguiente_fecha(date, date, text, integer)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validar_mantenimiento_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  v_item integer;
BEGIN
  NEW.titulo := btrim(NEW.titulo);
  NEW.descripcion := NULLIF(btrim(COALESCE(NEW.descripcion, '')), '');
  NEW.ubicacion := NULLIF(btrim(COALESCE(NEW.ubicacion, '')), '');
  NEW.categoria_mantenimiento := COALESCE(NULLIF(btrim(NEW.categoria_mantenimiento), ''), 'general');
  NEW.recurrencia_intervalo := GREATEST(COALESCE(NEW.recurrencia_intervalo, 1), 1);
  NEW.anticipaciones_dias := ARRAY(
    SELECT DISTINCT value
    FROM unnest(COALESCE(NEW.anticipaciones_dias, ARRAY[1, 0])) AS value
    WHERE value BETWEEN 0 AND 365
    ORDER BY value DESC
  );

  IF cardinality(NEW.anticipaciones_dias) = 0 THEN
    NEW.anticipaciones_dias := ARRAY[0];
  END IF;

  IF NEW.recurrencia_unidad = 'ninguna' THEN
    NEW.recurrencia_intervalo := 1;
  END IF;

  IF NEW.clase = 'vencimiento' AND NEW.recurrencia_unidad <> 'ninguna' THEN
    -- Un vencimiento puede repetirse (por ejemplo recarga anual de extintor),
    -- por eso no se fuerza a unica. Solo se conserva la semantica de alerta.
    NULL;
  END IF;

  IF NEW.habitacion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.habitaciones h
    WHERE h.id = NEW.habitacion_id
      AND h.hotel_id = NEW.hotel_id
  ) THEN
    RAISE EXCEPTION 'La habitacion no pertenece al hotel del plan.' USING ERRCODE = '23514';
  END IF;

  IF NEW.asignada_a IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = NEW.asignada_a
      AND u.hotel_id = NEW.hotel_id
  ) THEN
    RAISE EXCEPTION 'El responsable no pertenece al hotel del plan.' USING ERRCODE = '23514';
  END IF;

  IF NEW.creada_por IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = NEW.creada_por
      AND u.hotel_id = NEW.hotel_id
  ) THEN
    RAISE EXCEPTION 'El creador no pertenece al hotel del plan.' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.creada_por IS NULL
       AND auth.uid() IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.usuarios u
         WHERE u.id = auth.uid() AND u.hotel_id = NEW.hotel_id
       ) THEN
      NEW.creada_por := auth.uid();
    END IF;
    NEW.proxima_fecha := COALESCE(NEW.proxima_fecha, NEW.fecha_inicio);
    NEW.creado_en := COALESCE(NEW.creado_en, now());
  ELSIF NEW.fecha_inicio IS DISTINCT FROM OLD.fecha_inicio
     OR NEW.recurrencia_unidad IS DISTINCT FROM OLD.recurrencia_unidad
     OR NEW.recurrencia_intervalo IS DISTINCT FROM OLD.recurrencia_intervalo
     OR NEW.fecha_fin IS DISTINCT FROM OLD.fecha_fin THEN
    NEW.proxima_fecha := NEW.fecha_inicio;
  END IF;

  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validar_mantenimiento_plan()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validar_mantenimiento_plan() TO service_role;

DROP TRIGGER IF EXISTS trg_validar_mantenimiento_plan ON public.mantenimiento_planes;
CREATE TRIGGER trg_validar_mantenimiento_plan
BEFORE INSERT OR UPDATE
ON public.mantenimiento_planes
FOR EACH ROW
EXECUTE FUNCTION public.validar_mantenimiento_plan();

ALTER TABLE public.mantenimiento_planes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Mantenimiento planes select hotel" ON public.mantenimiento_planes;
DROP POLICY IF EXISTS "Mantenimiento planes insert admin" ON public.mantenimiento_planes;
DROP POLICY IF EXISTS "Mantenimiento planes update admin" ON public.mantenimiento_planes;
DROP POLICY IF EXISTS "Mantenimiento planes delete admin" ON public.mantenimiento_planes;

CREATE POLICY "Mantenimiento planes select hotel"
ON public.mantenimiento_planes
FOR SELECT TO authenticated
USING (public.fase1_actor_es_miembro_activo(hotel_id));

CREATE POLICY "Mantenimiento planes insert admin"
ON public.mantenimiento_planes
FOR INSERT TO authenticated
WITH CHECK (
  public.usuario_actual_es_admin_hotel(hotel_id)
  OR public.actor_is_saas_superadmin()
);

CREATE POLICY "Mantenimiento planes update admin"
ON public.mantenimiento_planes
FOR UPDATE TO authenticated
USING (
  public.usuario_actual_es_admin_hotel(hotel_id)
  OR public.actor_is_saas_superadmin()
)
WITH CHECK (
  public.usuario_actual_es_admin_hotel(hotel_id)
  OR public.actor_is_saas_superadmin()
);

CREATE POLICY "Mantenimiento planes delete admin"
ON public.mantenimiento_planes
FOR DELETE TO authenticated
USING (
  public.usuario_actual_es_admin_hotel(hotel_id)
  OR public.actor_is_saas_superadmin()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mantenimiento_planes TO authenticated;
GRANT ALL ON public.mantenimiento_planes TO service_role;
REVOKE ALL ON public.mantenimiento_planes FROM anon;
