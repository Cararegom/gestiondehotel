-- Completa la ejecución de los planes preventivos:
-- 1) copia el checklist del plan a la descripción visible de cada tarea;
-- 2) si el administrador marcó evidencia obligatoria, impide cerrar sin adjuntos.

CREATE OR REPLACE FUNCTION public.preparar_tarea_desde_plan_mantenimiento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  v_plan public.mantenimiento_planes;
  v_checklist text;
BEGIN
  IF NEW.plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_plan
  FROM public.mantenimiento_planes
  WHERE id = NEW.plan_id
    AND hotel_id = NEW.hotel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAN_MANTENIMIENTO_INVALIDO' USING ERRCODE = 'P0001';
  END IF;

  SELECT string_agg(
           format('☐ %s', COALESCE(NULLIF(item->>'texto', ''), item #>> '{}')),
           E'\n'
           ORDER BY ord
         )
    INTO v_checklist
    FROM jsonb_array_elements(COALESCE(v_plan.checklist, '[]'::jsonb)) WITH ORDINALITY AS x(item, ord);

  NEW.descripcion := concat_ws(
    E'\n\n',
    NULLIF(btrim(COALESCE(NEW.descripcion, '')), ''),
    CASE
      WHEN NULLIF(v_checklist, '') IS NOT NULL
        THEN 'Checklist preventivo:' || E'\n' || v_checklist
      ELSE NULL
    END,
    CASE
      WHEN v_plan.requiere_evidencia
        THEN 'Evidencia requerida: adjunta al menos una foto o archivo antes de cerrar la tarea.'
      ELSE NULL
    END
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_preparar_tarea_desde_plan_mantenimiento ON public.tareas_mantenimiento;
CREATE TRIGGER trg_preparar_tarea_desde_plan_mantenimiento
BEFORE INSERT ON public.tareas_mantenimiento
FOR EACH ROW
WHEN (NEW.plan_id IS NOT NULL)
EXECUTE FUNCTION public.preparar_tarea_desde_plan_mantenimiento();

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
BEGIN
  SELECT *
    INTO v_task
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
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = p_asignada_a
      AND u.hotel_id = v_task.hotel_id
      AND u.activo IS DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION 'RESPONSABLE_MANTENIMIENTO_INVALIDO' USING ERRCODE = 'P0001';
  END IF;

  IF v_nuevo = 'asignado' AND COALESCE(p_asignada_a, v_task.asignada_a) IS NULL THEN
    RAISE EXCEPTION 'RESPONSABLE_MANTENIMIENTO_REQUERIDO' USING ERRCODE = 'P0001';
  END IF;

  IF v_nuevo = 'cerrado'
     AND v_task.plan_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.mantenimiento_planes mp
       WHERE mp.id = v_task.plan_id
         AND mp.hotel_id = v_task.hotel_id
         AND mp.requiere_evidencia
     )
     AND jsonb_array_length(COALESCE(v_task.adjuntos, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'EVIDENCIA_MANTENIMIENTO_REQUERIDA: adjunta al menos una foto o archivo antes de cerrar esta tarea.'
      USING ERRCODE = 'P0001';
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
