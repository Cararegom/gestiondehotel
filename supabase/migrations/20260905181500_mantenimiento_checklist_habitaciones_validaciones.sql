-- Validaciones de integridad para el alcance y el checklist por habitación.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mantenimiento_planes_alcance_habitacion_check'
      AND conrelid = 'public.mantenimiento_planes'::regclass
  ) THEN
    ALTER TABLE public.mantenimiento_planes
      ADD CONSTRAINT mantenimiento_planes_alcance_habitacion_check
      CHECK (
        (alcance = 'habitacion' AND habitacion_id IS NOT NULL)
        OR (alcance IN ('general', 'todas_habitaciones') AND habitacion_id IS NULL)
      );
  END IF;
END $$;

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
  v_checklist jsonb;
  v_observacion text;
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

  v_checklist := COALESCE(p_checklist, v_item.checklist, '[]'::jsonb);
  v_observacion := NULLIF(btrim(COALESCE(p_observacion, '')), '');

  IF p_estado = 'revisada' AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_checklist) AS x(item)
    WHERE COALESCE((item->>'obligatorio')::boolean, true)
      AND COALESCE((item->>'completado')::boolean, false) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'CHECKLIST_HABITACION_INCOMPLETO: completa todos los puntos obligatorios antes de marcar la habitación como revisada.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_estado = 'novedad' AND v_observacion IS NULL THEN
    RAISE EXCEPTION 'OBSERVACION_NOVEDAD_REQUERIDA: describe la novedad encontrada en la habitación.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.mantenimiento_tarea_habitaciones
  SET estado = p_estado,
      checklist = v_checklist,
      observacion = v_observacion,
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
