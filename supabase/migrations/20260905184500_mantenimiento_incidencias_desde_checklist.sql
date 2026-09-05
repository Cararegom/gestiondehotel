-- Convierte una novedad detectada dentro de un checklist general por habitaciones
-- en una tarea de mantenimiento independiente y vinculada a esa revisión.

ALTER TABLE public.mantenimiento_tarea_habitaciones
  ADD COLUMN IF NOT EXISTS incidencia_tarea_id uuid
  REFERENCES public.tareas_mantenimiento(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_mantenimiento_tarea_habitaciones_incidencia
  ON public.mantenimiento_tarea_habitaciones(incidencia_tarea_id)
  WHERE incidencia_tarea_id IS NOT NULL;

COMMENT ON COLUMN public.mantenimiento_tarea_habitaciones.incidencia_tarea_id IS
  'Tarea de mantenimiento creada para resolver la novedad encontrada en esta revisión de habitación.';

CREATE OR REPLACE FUNCTION public.mantenimiento_crear_incidencia_desde_habitacion(
  p_item_id uuid
)
RETURNS public.tareas_mantenimiento
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  v_item public.mantenimiento_tarea_habitaciones;
  v_parent public.tareas_mantenimiento;
  v_incident public.tareas_mantenimiento;
  v_actor uuid := auth.uid();
  v_created_by uuid;
BEGIN
  SELECT *
    INTO v_item
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
    RAISE EXCEPTION 'SIN_PERMISO_CREAR_INCIDENCIA_MANTENIMIENTO' USING ERRCODE = '42501';
  END IF;

  IF v_item.estado <> 'novedad' THEN
    RAISE EXCEPTION 'INCIDENCIA_REQUIERE_NOVEDAD: marca primero la habitación como Con novedad.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NULLIF(btrim(COALESCE(v_item.observacion, '')), '') IS NULL THEN
    RAISE EXCEPTION 'INCIDENCIA_REQUIERE_OBSERVACION: describe la novedad antes de crear la incidencia.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_item.incidencia_tarea_id IS NOT NULL THEN
    SELECT *
      INTO v_incident
      FROM public.tareas_mantenimiento
     WHERE id = v_item.incidencia_tarea_id
       AND hotel_id = v_item.hotel_id;

    IF FOUND THEN
      RETURN v_incident;
    END IF;
  END IF;

  SELECT *
    INTO v_parent
    FROM public.tareas_mantenimiento
   WHERE id = v_item.tarea_id
     AND hotel_id = v_item.hotel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TAREA_MANTENIMIENTO_ORIGEN_NO_ENCONTRADA' USING ERRCODE = 'P0002';
  END IF;

  v_created_by := CASE
    WHEN v_actor IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.usuarios u
      WHERE u.id = v_actor
        AND u.hotel_id = v_item.hotel_id
        AND u.activo IS DISTINCT FROM false
    ) THEN v_actor
    ELSE v_parent.creada_por
  END;

  INSERT INTO public.tareas_mantenimiento (
    hotel_id,
    titulo,
    descripcion,
    estado,
    tipo,
    fecha_programada,
    frecuencia,
    creada_por,
    asignada_a,
    habitacion_id,
    prioridad,
    adjuntos,
    categoria_mantenimiento,
    solicitud_id
  ) VALUES (
    v_item.hotel_id,
    format('Corregir novedad · Habitación %s', v_item.habitacion_nombre_snapshot),
    concat_ws(
      E'\n\n',
      format('Incidencia creada desde la revisión general "%s".', COALESCE(v_parent.titulo, 'Mantenimiento general')),
      'Hallazgo: ' || v_item.observacion,
      'Habitación: ' || v_item.habitacion_nombre_snapshot,
      'Tarea de origen: ' || v_item.tarea_id::text
    ),
    'pendiente'::public.estado_tarea_enum,
    'programado'::public.tipo_tarea_enum,
    public.hotel_business_date(v_item.hotel_id, now()),
    'unica'::public.frecuencia_tarea_enum,
    v_created_by,
    v_parent.asignada_a,
    v_item.habitacion_id,
    COALESCE(v_parent.prioridad, 1),
    '[]'::jsonb,
    COALESCE(v_parent.categoria_mantenimiento, 'general'),
    gen_random_uuid()
  )
  RETURNING * INTO v_incident;

  UPDATE public.mantenimiento_tarea_habitaciones
  SET incidencia_tarea_id = v_incident.id,
      actualizado_en = now()
  WHERE id = v_item.id;

  RETURN v_incident;
END;
$$;

REVOKE ALL ON FUNCTION public.mantenimiento_crear_incidencia_desde_habitacion(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mantenimiento_crear_incidencia_desde_habitacion(uuid)
  TO authenticated, service_role;

-- Una revisión general no puede darse por cerrada dejando novedades sin una
-- tarea concreta que se haga cargo de ellas. El control vive también en BD
-- para que no dependa solamente de la interfaz.
CREATE OR REPLACE FUNCTION public.mantenimiento_exigir_incidencias_novedades()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  v_faltantes integer := 0;
BEGIN
  IF public.mantenimiento_estado_canonico(NEW.estado::text) = 'cerrado'
     AND public.mantenimiento_estado_canonico(COALESCE(OLD.estado::text, 'pendiente')) <> 'cerrado' THEN
    SELECT count(*)
      INTO v_faltantes
      FROM public.mantenimiento_tarea_habitaciones mth
     WHERE mth.tarea_id = NEW.id
       AND mth.estado = 'novedad'
       AND mth.incidencia_tarea_id IS NULL;

    IF v_faltantes > 0 THEN
      RAISE EXCEPTION 'INCIDENCIAS_MANTENIMIENTO_PENDIENTES: hay % novedad(es) sin convertir en incidencia antes de cerrar la tarea.', v_faltantes
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mantenimiento_exigir_incidencias_novedades
  ON public.tareas_mantenimiento;
CREATE TRIGGER trg_mantenimiento_exigir_incidencias_novedades
BEFORE UPDATE OF estado ON public.tareas_mantenimiento
FOR EACH ROW
EXECUTE FUNCTION public.mantenimiento_exigir_incidencias_novedades();
