-- Fase 3/4 - Flujo operativo y trazabilidad del modulo de mantenimiento.
-- Objetivos:
-- 1) introducir ciclo profesional de revision/asignacion/proceso/resolucion/cierre;
-- 2) conservar compatibilidad con estados legacy;
-- 3) registrar historial inmutable por tarea;
-- 4) agregar SLA operativo por prioridad;
-- 5) centralizar transiciones y comentarios mediante RPC tenant-safe;
-- 6) mantener intactas las defensas de ocupacion/bloqueo de Fase 1.

ALTER TABLE public.tareas_mantenimiento
  ADD COLUMN IF NOT EXISTS revisada_en timestamptz,
  ADD COLUMN IF NOT EXISTS asignada_en timestamptz,
  ADD COLUMN IF NOT EXISTS iniciada_en timestamptz,
  ADD COLUMN IF NOT EXISTS resuelta_en timestamptz,
  ADD COLUMN IF NOT EXISTS cerrada_en timestamptz,
  ADD COLUMN IF NOT EXISTS cancelada_en timestamptz,
  ADD COLUMN IF NOT EXISTS sla_objetivo_minutos integer,
  ADD COLUMN IF NOT EXISTS vencimiento_at timestamptz,
  ADD COLUMN IF NOT EXISTS ultimo_cambio_por uuid;

ALTER TABLE public.tareas_mantenimiento
  DROP CONSTRAINT IF EXISTS tareas_mantenimiento_ultimo_cambio_por_fkey;
ALTER TABLE public.tareas_mantenimiento
  ADD CONSTRAINT tareas_mantenimiento_ultimo_cambio_por_fkey
  FOREIGN KEY (ultimo_cambio_por) REFERENCES public.usuarios(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tareas_mantenimiento_sla_check'
      AND conrelid = 'public.tareas_mantenimiento'::regclass
  ) THEN
    ALTER TABLE public.tareas_mantenimiento
      ADD CONSTRAINT tareas_mantenimiento_sla_check
      CHECK (sla_objetivo_minutos IS NULL OR sla_objetivo_minutos BETWEEN 5 AND 10080);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mantenimiento_estado_canonico(p_estado text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT CASE lower(coalesce(trim(p_estado), 'pendiente'))
    WHEN 'en_progreso' THEN 'en_proceso'
    WHEN 'completada' THEN 'cerrado'
    WHEN 'cancelada' THEN 'cancelado'
    ELSE lower(coalesce(trim(p_estado), 'pendiente'))
  END;
$$;

CREATE OR REPLACE FUNCTION public.mantenimiento_estado_es_abierto(p_estado text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT public.mantenimiento_estado_canonico(p_estado) IN (
    'pendiente', 'en_revision', 'asignado', 'en_proceso', 'resuelto'
  );
$$;

CREATE OR REPLACE FUNCTION public.mantenimiento_sla_por_prioridad(p_prioridad integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT CASE coalesce(p_prioridad, 1)
    WHEN 3 THEN 30
    WHEN 2 THEN 120
    WHEN 1 THEN 480
    ELSE 1440
  END;
$$;

REVOKE ALL ON FUNCTION public.mantenimiento_estado_canonico(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mantenimiento_estado_es_abierto(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mantenimiento_sla_por_prioridad(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mantenimiento_estado_canonico(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mantenimiento_estado_es_abierto(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mantenimiento_sla_por_prioridad(integer) TO authenticated, service_role;

-- Canonizar registros historicos sin borrar los valores antiguos del enum.
UPDATE public.tareas_mantenimiento
SET estado = CASE estado::text
  WHEN 'en_progreso' THEN 'en_proceso'::public.estado_tarea_enum
  WHEN 'completada' THEN 'cerrado'::public.estado_tarea_enum
  WHEN 'cancelada' THEN 'cancelado'::public.estado_tarea_enum
  ELSE estado
END
WHERE estado::text IN ('en_progreso', 'completada', 'cancelada');

-- SLA por prioridad: urgente 30m, alta 2h, media 8h, baja 24h.
UPDATE public.tareas_mantenimiento
SET sla_objetivo_minutos = COALESCE(sla_objetivo_minutos, public.mantenimiento_sla_por_prioridad(prioridad)),
    vencimiento_at = COALESCE(
      vencimiento_at,
      GREATEST(
        COALESCE(creado_en, now()),
        COALESCE(fecha_programada::timestamp AT TIME ZONE 'America/Bogota', COALESCE(creado_en, now()))
      ) + make_interval(mins => COALESCE(sla_objetivo_minutos, public.mantenimiento_sla_por_prioridad(prioridad)))
    )
WHERE public.mantenimiento_estado_es_abierto(estado::text);

CREATE TABLE IF NOT EXISTS public.mantenimiento_historial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  tarea_id uuid NOT NULL REFERENCES public.tareas_mantenimiento(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  evento text NOT NULL,
  estado_anterior text,
  estado_nuevo text,
  comentario text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mantenimiento_historial_evento_check
    CHECK (evento IN ('creada','estado','asignacion','actualizacion','comentario'))
);

CREATE INDEX IF NOT EXISTS ix_mantenimiento_historial_tarea_fecha
  ON public.mantenimiento_historial (tarea_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS ix_mantenimiento_historial_hotel_fecha
  ON public.mantenimiento_historial (hotel_id, creado_en DESC);

ALTER TABLE public.mantenimiento_historial ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Mantenimiento historial select hotel" ON public.mantenimiento_historial;
DROP POLICY IF EXISTS "Mantenimiento historial insert hotel" ON public.mantenimiento_historial;
CREATE POLICY "Mantenimiento historial select hotel"
ON public.mantenimiento_historial
FOR SELECT TO authenticated
USING (hotel_id = public.get_current_user_hotel_id());
CREATE POLICY "Mantenimiento historial insert hotel"
ON public.mantenimiento_historial
FOR INSERT TO authenticated
WITH CHECK (hotel_id = public.get_current_user_hotel_id());

CREATE OR REPLACE FUNCTION public.preparar_tarea_mantenimiento_fase3()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_canonical text;
  v_base timestamptz;
BEGIN
  v_canonical := public.mantenimiento_estado_canonico(NEW.estado::text);
  NEW.estado := v_canonical::public.estado_tarea_enum;

  IF NEW.sla_objetivo_minutos IS NULL THEN
    NEW.sla_objetivo_minutos := public.mantenimiento_sla_por_prioridad(NEW.prioridad);
  END IF;

  IF TG_OP = 'INSERT'
     OR NEW.prioridad IS DISTINCT FROM OLD.prioridad
     OR NEW.fecha_programada IS DISTINCT FROM OLD.fecha_programada THEN
    IF public.mantenimiento_estado_es_abierto(NEW.estado::text) THEN
      v_base := GREATEST(
        COALESCE(NEW.creado_en, now()),
        COALESCE(NEW.fecha_programada::timestamp AT TIME ZONE 'America/Bogota', COALESCE(NEW.creado_en, now()))
      );
      NEW.vencimiento_at := v_base + make_interval(mins => NEW.sla_objetivo_minutos);
    END IF;
  END IF;

  IF v_actor IS NOT NULL AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = v_actor) THEN
    NEW.ultimo_cambio_por := v_actor;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estado = 'en_revision'::public.estado_tarea_enum THEN NEW.revisada_en := COALESCE(NEW.revisada_en, now()); END IF;
    IF NEW.estado = 'asignado'::public.estado_tarea_enum THEN NEW.asignada_en := COALESCE(NEW.asignada_en, now()); END IF;
    IF NEW.estado = 'en_proceso'::public.estado_tarea_enum THEN NEW.iniciada_en := COALESCE(NEW.iniciada_en, now()); END IF;
    IF NEW.estado = 'resuelto'::public.estado_tarea_enum THEN NEW.resuelta_en := COALESCE(NEW.resuelta_en, now()); END IF;
    IF NEW.estado = 'cerrado'::public.estado_tarea_enum THEN
      NEW.cerrada_en := COALESCE(NEW.cerrada_en, now());
      NEW.fecha_completada := COALESCE(NEW.fecha_completada, NEW.cerrada_en);
      IF NEW.realizada_por IS NULL AND v_actor IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = v_actor) THEN
        NEW.realizada_por := v_actor;
      END IF;
    END IF;
    IF NEW.estado = 'cancelado'::public.estado_tarea_enum THEN NEW.cancelada_en := COALESCE(NEW.cancelada_en, now()); END IF;
  ELSE
    IF NEW.asignada_a IS DISTINCT FROM OLD.asignada_a AND NEW.asignada_a IS NOT NULL THEN
      NEW.asignada_en := now();
    END IF;

    IF NEW.estado IS DISTINCT FROM OLD.estado THEN
      IF NEW.estado = 'en_revision'::public.estado_tarea_enum THEN NEW.revisada_en := COALESCE(NEW.revisada_en, now()); END IF;
      IF NEW.estado = 'asignado'::public.estado_tarea_enum THEN NEW.asignada_en := COALESCE(NEW.asignada_en, now()); END IF;
      IF NEW.estado = 'en_proceso'::public.estado_tarea_enum THEN
        NEW.iniciada_en := COALESCE(NEW.iniciada_en, now());
        IF OLD.estado::text IN ('resuelto','cerrado','completada') THEN
          NEW.resuelta_en := NULL;
          NEW.cerrada_en := NULL;
          NEW.fecha_completada := NULL;
          NEW.realizada_por := NULL;
        END IF;
      END IF;
      IF NEW.estado = 'resuelto'::public.estado_tarea_enum THEN NEW.resuelta_en := COALESCE(NEW.resuelta_en, now()); END IF;
      IF NEW.estado = 'cerrado'::public.estado_tarea_enum THEN
        NEW.cerrada_en := COALESCE(NEW.cerrada_en, now());
        NEW.fecha_completada := COALESCE(NEW.fecha_completada, NEW.cerrada_en);
        NEW.ultima_realizacion := COALESCE(NEW.ultima_realizacion, NEW.cerrada_en);
        IF NEW.realizada_por IS NULL AND v_actor IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = v_actor) THEN
          NEW.realizada_por := v_actor;
        END IF;
      END IF;
      IF NEW.estado = 'cancelado'::public.estado_tarea_enum THEN NEW.cancelada_en := COALESCE(NEW.cancelada_en, now()); END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_preparar_tarea_mantenimiento_fase3 ON public.tareas_mantenimiento;
CREATE TRIGGER trg_preparar_tarea_mantenimiento_fase3
BEFORE INSERT OR UPDATE ON public.tareas_mantenimiento
FOR EACH ROW EXECUTE FUNCTION public.preparar_tarea_mantenimiento_fase3();

CREATE OR REPLACE FUNCTION public.registrar_historial_tarea_mantenimiento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := COALESCE(auth.uid(), NEW.ultimo_cambio_por, NEW.realizada_por, NEW.creada_por);
  v_comment text := NULLIF(current_setting('app.maintenance_comment', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.mantenimiento_historial(
      hotel_id, tarea_id, actor_id, evento, estado_nuevo, comentario, metadata
    )
    VALUES (
      NEW.hotel_id, NEW.id, v_actor, 'creada', NEW.estado::text, v_comment,
      jsonb_build_object('prioridad', NEW.prioridad, 'tipo', NEW.tipo::text, 'asignada_a', NEW.asignada_a)
    );
    RETURN NEW;
  END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    INSERT INTO public.mantenimiento_historial(
      hotel_id, tarea_id, actor_id, evento, estado_anterior, estado_nuevo, comentario
    )
    VALUES (NEW.hotel_id, NEW.id, v_actor, 'estado', OLD.estado::text, NEW.estado::text, v_comment);
  END IF;

  IF NEW.asignada_a IS DISTINCT FROM OLD.asignada_a THEN
    INSERT INTO public.mantenimiento_historial(
      hotel_id, tarea_id, actor_id, evento, estado_anterior, estado_nuevo, comentario, metadata
    )
    VALUES (
      NEW.hotel_id, NEW.id, v_actor, 'asignacion', OLD.estado::text, NEW.estado::text, v_comment,
      jsonb_build_object('asignada_anterior', OLD.asignada_a, 'asignada_nueva', NEW.asignada_a)
    );
  END IF;

  IF NEW.prioridad IS DISTINCT FROM OLD.prioridad
     OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.fecha_programada IS DISTINCT FROM OLD.fecha_programada
     OR NEW.habitacion_id IS DISTINCT FROM OLD.habitacion_id THEN
    INSERT INTO public.mantenimiento_historial(
      hotel_id, tarea_id, actor_id, evento, estado_anterior, estado_nuevo, comentario, metadata
    )
    VALUES (
      NEW.hotel_id, NEW.id, v_actor, 'actualizacion', OLD.estado::text, NEW.estado::text, v_comment,
      jsonb_build_object(
        'prioridad_anterior', OLD.prioridad,
        'prioridad_nueva', NEW.prioridad,
        'tipo_anterior', OLD.tipo::text,
        'tipo_nuevo', NEW.tipo::text,
        'fecha_programada_anterior', OLD.fecha_programada,
        'fecha_programada_nueva', NEW.fecha_programada,
        'habitacion_anterior', OLD.habitacion_id,
        'habitacion_nueva', NEW.habitacion_id
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registrar_historial_tarea_mantenimiento ON public.tareas_mantenimiento;
CREATE TRIGGER trg_registrar_historial_tarea_mantenimiento
AFTER INSERT OR UPDATE ON public.tareas_mantenimiento
FOR EACH ROW EXECUTE FUNCTION public.registrar_historial_tarea_mantenimiento();

-- Bloqueo operativo ahora considera todos los estados abiertos del nuevo flujo.
CREATE OR REPLACE FUNCTION public.mantenimiento_habitacion_tiene_bloqueo(p_habitacion_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tareas_mantenimiento tm
    WHERE tm.habitacion_id = p_habitacion_id
      AND tm.tipo = 'bloqueante'::public.tipo_tarea_enum
      AND public.mantenimiento_estado_es_abierto(tm.estado::text)
  );
$$;

-- Conserva las protecciones de Fase 1, adaptadas al estado cerrado canonico.
CREATE OR REPLACE FUNCTION public.validar_tarea_mantenimiento_operativa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_room_estado text;
  v_has_active_stay boolean := false;
BEGIN
  IF NEW.creada_por IS NULL AND v_actor IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = v_actor) THEN
    NEW.creada_por := v_actor;
  END IF;

  IF NEW.estado = 'cerrado'::public.estado_tarea_enum THEN
    NEW.fecha_completada := COALESCE(NEW.fecha_completada, now());
    NEW.ultima_realizacion := COALESCE(NEW.ultima_realizacion, now());
    IF NEW.realizada_por IS NULL AND v_actor IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = v_actor) THEN
      NEW.realizada_por := v_actor;
    END IF;
  ELSIF TG_OP = 'UPDATE'
        AND OLD.estado::text IN ('cerrado','completada')
        AND NEW.estado = 'en_proceso'::public.estado_tarea_enum THEN
    NEW.fecha_completada := NULL;
    NEW.realizada_por := NULL;
  END IF;

  IF NEW.habitacion_id IS NOT NULL
     AND NEW.tipo = 'bloqueante'::public.tipo_tarea_enum
     AND public.mantenimiento_estado_es_abierto(NEW.estado::text) THEN

    SELECT h.estado::text
      INTO v_room_estado
      FROM public.habitaciones h
     WHERE h.id = NEW.habitacion_id
       AND h.hotel_id = NEW.hotel_id;

    SELECT EXISTS (
      SELECT 1
      FROM public.reservas r
      WHERE r.habitacion_id = NEW.habitacion_id
        AND r.hotel_id = NEW.hotel_id
        AND r.estado::text IN ('activa', 'ocupada', 'check_in', 'tiempo agotado')
    ) INTO v_has_active_stay;

    IF v_room_estado IN ('ocupada', 'tiempo agotado') OR v_has_active_stay THEN
      RAISE EXCEPTION 'MANTENIMIENTO_HABITACION_OCUPADA: no se puede bloquear una habitacion con estancia activa.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.mantenimiento_agregar_comentario(
  p_tarea_id uuid,
  p_comentario text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_task public.tareas_mantenimiento;
  v_id uuid;
  v_actor uuid := auth.uid();
BEGIN
  IF NULLIF(trim(p_comentario), '') IS NULL THEN
    RAISE EXCEPTION 'COMENTARIO_MANTENIMIENTO_VACIO' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_task
  FROM public.tareas_mantenimiento
  WHERE id = p_tarea_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TAREA_MANTENIMIENTO_NO_ENCONTRADA' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.mantenimiento_historial(
    hotel_id, tarea_id, actor_id, evento, estado_anterior, estado_nuevo, comentario
  )
  VALUES (
    v_task.hotel_id,
    v_task.id,
    CASE WHEN EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = v_actor) THEN v_actor ELSE NULL END,
    'comentario',
    v_task.estado::text,
    v_task.estado::text,
    trim(p_comentario)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mantenimiento_transicionar_tarea(uuid,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mantenimiento_agregar_comentario(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mantenimiento_transicionar_tarea(uuid,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mantenimiento_agregar_comentario(uuid,text) TO authenticated;

CREATE INDEX IF NOT EXISTS ix_tareas_mantenimiento_hotel_estado_sla
  ON public.tareas_mantenimiento (hotel_id, estado, vencimiento_at);
CREATE INDEX IF NOT EXISTS ix_tareas_mantenimiento_responsable_estado_sla
  ON public.tareas_mantenimiento (hotel_id, asignada_a, estado, vencimiento_at)
  WHERE asignada_a IS NOT NULL;
