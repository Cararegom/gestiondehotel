-- Checklist operativo por habitación para tareas generales de mantenimiento.
-- Permite programar una sola tarea (por ejemplo revisar filtros de todos los aires)
-- y controlar el cumplimiento habitación por habitación.

ALTER TABLE public.mantenimiento_planes
  ADD COLUMN IF NOT EXISTS alcance text NOT NULL DEFAULT 'general';

UPDATE public.mantenimiento_planes
SET alcance = 'habitacion'
WHERE habitacion_id IS NOT NULL
  AND alcance = 'general';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mantenimiento_planes_alcance_check'
      AND conrelid = 'public.mantenimiento_planes'::regclass
  ) THEN
    ALTER TABLE public.mantenimiento_planes
      ADD CONSTRAINT mantenimiento_planes_alcance_check
      CHECK (alcance IN ('general', 'habitacion', 'todas_habitaciones'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.mantenimiento_tarea_habitaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  tarea_id uuid NOT NULL REFERENCES public.tareas_mantenimiento(id) ON DELETE CASCADE,
  habitacion_id uuid NOT NULL REFERENCES public.habitaciones(id) ON DELETE CASCADE,
  habitacion_nombre_snapshot text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente',
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  observacion text,
  evidencias jsonb NOT NULL DEFAULT '[]'::jsonb,
  revisada_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  revisada_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mantenimiento_tarea_habitaciones_estado_check
    CHECK (estado IN ('pendiente', 'revisada', 'novedad', 'no_aplica')),
  CONSTRAINT mantenimiento_tarea_habitaciones_checklist_check
    CHECK (jsonb_typeof(checklist) = 'array'),
  CONSTRAINT mantenimiento_tarea_habitaciones_evidencias_check
    CHECK (jsonb_typeof(evidencias) = 'array'),
  CONSTRAINT mantenimiento_tarea_habitacion_unica UNIQUE (tarea_id, habitacion_id)
);

CREATE INDEX IF NOT EXISTS ix_mantenimiento_tarea_habitaciones_tarea_estado
  ON public.mantenimiento_tarea_habitaciones(tarea_id, estado);
CREATE INDEX IF NOT EXISTS ix_mantenimiento_tarea_habitaciones_hotel_habitacion
  ON public.mantenimiento_tarea_habitaciones(hotel_id, habitacion_id);

ALTER TABLE public.mantenimiento_tarea_habitaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Mantenimiento checklist habitaciones lectura" ON public.mantenimiento_tarea_habitaciones;
CREATE POLICY "Mantenimiento checklist habitaciones lectura"
ON public.mantenimiento_tarea_habitaciones
FOR SELECT TO authenticated
USING (public.fase1_actor_es_miembro_activo(hotel_id));

DROP POLICY IF EXISTS "Mantenimiento checklist habitaciones actualizar" ON public.mantenimiento_tarea_habitaciones;
CREATE POLICY "Mantenimiento checklist habitaciones actualizar"
ON public.mantenimiento_tarea_habitaciones
FOR UPDATE TO authenticated
USING (
  public.fase1_actor_es_miembro_activo(hotel_id)
  AND (
    public.usuario_actual_es_admin_hotel(hotel_id)
    OR public.usuario_actual_es_mantenimiento_conserje()
  )
)
WITH CHECK (
  public.fase1_actor_es_miembro_activo(hotel_id)
  AND (
    public.usuario_actual_es_admin_hotel(hotel_id)
    OR public.usuario_actual_es_mantenimiento_conserje()
  )
);

REVOKE ALL ON public.mantenimiento_tarea_habitaciones FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON public.mantenimiento_tarea_habitaciones TO authenticated;
GRANT ALL ON public.mantenimiento_tarea_habitaciones TO service_role;

CREATE OR REPLACE FUNCTION public.mantenimiento_inicializar_habitaciones_tarea()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  v_plan public.mantenimiento_planes;
BEGIN
  IF NEW.plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_plan
  FROM public.mantenimiento_planes
  WHERE id = NEW.plan_id
    AND hotel_id = NEW.hotel_id;

  IF NOT FOUND OR v_plan.alcance <> 'todas_habitaciones' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.mantenimiento_tarea_habitaciones(
    hotel_id,
    tarea_id,
    habitacion_id,
    habitacion_nombre_snapshot,
    estado,
    checklist
  )
  SELECT
    NEW.hotel_id,
    NEW.id,
    h.id,
    h.nombre,
    'pendiente',
    COALESCE(v_plan.checklist, '[]'::jsonb)
  FROM public.habitaciones h
  WHERE h.hotel_id = NEW.hotel_id
    AND h.activo IS DISTINCT FROM false
  ON CONFLICT (tarea_id, habitacion_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inicializar_habitaciones_tarea ON public.tareas_mantenimiento;
CREATE TRIGGER trg_inicializar_habitaciones_tarea
AFTER INSERT ON public.tareas_mantenimiento
FOR EACH ROW
WHEN (NEW.plan_id IS NOT NULL)
EXECUTE FUNCTION public.mantenimiento_inicializar_habitaciones_tarea();

CREATE OR REPLACE FUNCTION public.mantenimiento_actualizar_habitacion_tarea(
  p_item_id uuid,
  p_estado text,
  p_checklist jsonb DEFAULT NULL,
  p_observacion text DEFAULT NULL
)
RETURNS public.mantenimiento_tarea_habitaciones
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  v_item public.mantenimiento_tarea_habitaciones;
  v_actor uuid := auth.uid();
BEGIN
  IF p_estado NOT IN ('pendiente', 'revisada', 'novedad', 'no_aplica') THEN
    RAISE EXCEPTION 'ESTADO_REVISION_HABITACION_INVALIDO' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item
  FROM public.mantenimiento_tarea_habitaciones
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REVISION_HABITACION_NO_ENCONTRADA' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.fase1_actor_es_miembro_activo(v_item.hotel_id)
     OR NOT (
       public.usuario_actual_es_admin_hotel(v_item.hotel_id)
       OR public.usuario_actual_es_mantenimiento_conserje()
     ) THEN
    RAISE EXCEPTION 'SIN_PERMISO_REVISION_HABITACION' USING ERRCODE = '42501';
  END IF;

  IF p_checklist IS NOT NULL AND jsonb_typeof(p_checklist) <> 'array' THEN
    RAISE EXCEPTION 'CHECKLIST_HABITACION_INVALIDO' USING ERRCODE = '22023';
  END IF;

  UPDATE public.mantenimiento_tarea_habitaciones
  SET estado = p_estado,
      checklist = COALESCE(p_checklist, checklist),
      observacion = NULLIF(btrim(COALESCE(p_observacion, '')), ''),
      revisada_por = CASE WHEN p_estado = 'pendiente' THEN NULL ELSE v_actor END,
      revisada_en = CASE WHEN p_estado = 'pendiente' THEN NULL ELSE now() END,
      actualizado_en = now()
  WHERE id = p_item_id
  RETURNING * INTO v_item;

  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.mantenimiento_actualizar_habitacion_tarea(uuid, text, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mantenimiento_actualizar_habitacion_tarea(uuid, text, jsonb, text)
  TO authenticated, service_role;

-- Reemplaza la transición vigente conservando evidencia obligatoria y agregando
-- el bloqueo de cierre cuando una tarea general aún tiene habitaciones pendientes.
CREATE OR REPLACE FUNCTION public.mantenimiento_transicionar_tarea(
  p_tarea_id uuid,
  p_estado_nuevo text,
  p_comentario text DEFAULT NULL,
  p_asignada_a uuid DEFAULT NULL
)
RETURNS public.tareas_mantenimiento
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_task public.tareas_mantenimiento;
  v_actual text;
  v_nuevo text;
  v_actor uuid := auth.uid();
  v_pendientes integer := 0;
BEGIN
  SELECT * INTO v_task
  FROM public.tareas_mantenimiento
  WHERE id = p_tarea_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TAREA_MANTENIMIENTO_NO_ENCONTRADA' USING ERRCODE = 'P0002';
  END IF;

  v_actual := public.mantenimiento_estado_canonico(v_task.estado::text);
  v_nuevo := public.mantenimiento_estado_canonico(p_estado_nuevo);

  IF NOT (
    (v_actual = 'pendiente' AND v_nuevo IN ('en_revision','en_proceso','cancelado')) OR
    (v_actual = 'en_revision' AND v_nuevo IN ('asignado','en_proceso','cancelado')) OR
    (v_actual = 'asignado' AND v_nuevo IN ('en_revision','en_proceso','cancelado')) OR
    (v_actual = 'en_proceso' AND v_nuevo IN ('resuelto','cancelado')) OR
    (v_actual = 'resuelto' AND v_nuevo IN ('cerrado','en_proceso')) OR
    (v_actual = 'cerrado' AND v_nuevo = 'en_proceso') OR
    (v_actual = 'cancelado' AND v_nuevo = 'pendiente') OR
    (v_actual = v_nuevo)
  ) THEN
    RAISE EXCEPTION 'TRANSICION_MANTENIMIENTO_INVALIDA: % -> %', v_actual, v_nuevo
      USING ERRCODE = 'P0001';
  END IF;

  IF p_asignada_a IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = p_asignada_a
      AND u.hotel_id = v_task.hotel_id
      AND u.activo IS DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION 'RESPONSABLE_MANTENIMIENTO_INVALIDO' USING ERRCODE = 'P0001';
  END IF;

  IF v_nuevo = 'asignado' AND COALESCE(p_asignada_a, v_task.asignada_a) IS NULL THEN
    RAISE EXCEPTION 'RESPONSABLE_MANTENIMIENTO_REQUERIDO' USING ERRCODE = 'P0001';
  END IF;

  IF v_nuevo = 'cerrado' AND v_task.plan_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.mantenimiento_planes mp
      WHERE mp.id = v_task.plan_id
        AND mp.hotel_id = v_task.hotel_id
        AND mp.requiere_evidencia
    ) AND jsonb_array_length(COALESCE(v_task.adjuntos, '[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION 'EVIDENCIA_MANTENIMIENTO_REQUERIDA: adjunta al menos una foto o archivo antes de cerrar esta tarea.'
        USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.mantenimiento_planes mp
      WHERE mp.id = v_task.plan_id
        AND mp.hotel_id = v_task.hotel_id
        AND mp.alcance = 'todas_habitaciones'
    ) THEN
      SELECT count(*) INTO v_pendientes
      FROM public.mantenimiento_tarea_habitaciones mth
      WHERE mth.tarea_id = v_task.id
        AND mth.estado = 'pendiente';

      IF v_pendientes > 0 THEN
        RAISE EXCEPTION 'HABITACIONES_MANTENIMIENTO_PENDIENTES: faltan % habitaciones por revisar antes de cerrar la tarea.', v_pendientes
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  PERFORM set_config('app.maintenance_comment', coalesce(trim(p_comentario), ''), true);

  UPDATE public.tareas_mantenimiento
  SET estado = v_nuevo::public.estado_tarea_enum,
      asignada_a = COALESCE(p_asignada_a, asignada_a),
      ultimo_cambio_por = CASE
        WHEN v_actor IS NOT NULL AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = v_actor)
          THEN v_actor
        ELSE ultimo_cambio_por
      END
  WHERE id = p_tarea_id
  RETURNING * INTO v_task;

  RETURN v_task;
END;
$$;
