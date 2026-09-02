-- Fase 1/4 - Saneamiento profesional del modulo de mantenimiento.
-- Objetivos:
-- 1) eliminar la escritura legacy [PROGRAMADO] y normalizar tipo;
-- 2) evitar duplicados por reintentos con solicitud_id;
-- 3) impedir que mantenimiento cancele/ocupe estancias de forma inconsistente;
-- 4) registrar correctamente quien completa una tarea;
-- 5) proteger nuevas evidencias en un bucket privado por hotel;
-- 6) agregar indices y RLS explicito por hotel.

ALTER TABLE public.tareas_mantenimiento
  ADD COLUMN IF NOT EXISTS categoria_mantenimiento text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS solicitud_id uuid;

-- Preservar como categoria la clasificacion historica antes de normalizar el impacto.
UPDATE public.tareas_mantenimiento
SET categoria_mantenimiento = tipo::text
WHERE tipo IS NOT NULL
  AND tipo::text IN ('general', 'piscina', 'habitacion', 'otro')
  AND COALESCE(NULLIF(BTRIM(categoria_mantenimiento), ''), 'general') = 'general';

-- Los registros legacy programados se reconocian mediante texto oculto.
UPDATE public.tareas_mantenimiento
SET tipo = 'programado'::public.tipo_tarea_enum
WHERE COALESCE(titulo, '') LIKE '%[PROGRAMADO]%'
   OR COALESCE(descripcion, '') LIKE '%[PROGRAMADO]%';

-- Todo registro historico restante era tratado por el frontend como bloqueante.
UPDATE public.tareas_mantenimiento
SET tipo = 'bloqueante'::public.tipo_tarea_enum
WHERE tipo IS NULL
   OR tipo::text NOT IN ('bloqueante', 'programado');

-- El marcador deja de formar parte de los datos de negocio.
UPDATE public.tareas_mantenimiento
SET titulo = BTRIM(REPLACE(COALESCE(titulo, ''), '[PROGRAMADO]', '')),
    descripcion = NULLIF(BTRIM(REPLACE(COALESCE(descripcion, ''), '[PROGRAMADO]', '')), '')
WHERE COALESCE(titulo, '') LIKE '%[PROGRAMADO]%'
   OR COALESCE(descripcion, '') LIKE '%[PROGRAMADO]%';

ALTER TABLE public.tareas_mantenimiento
  ALTER COLUMN tipo SET DEFAULT 'programado'::public.tipo_tarea_enum,
  ALTER COLUMN tipo SET NOT NULL;

-- Un usuario eliminado no debe borrar el historial de mantenimiento.
ALTER TABLE public.tareas_mantenimiento
  DROP CONSTRAINT IF EXISTS tareas_mantenimiento_creada_por_fkey,
  DROP CONSTRAINT IF EXISTS tareas_mantenimiento_asignada_a_fkey,
  DROP CONSTRAINT IF EXISTS tareas_mantenimiento_realizada_por_fkey;

ALTER TABLE public.tareas_mantenimiento
  ADD CONSTRAINT tareas_mantenimiento_creada_por_fkey
    FOREIGN KEY (creada_por) REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD CONSTRAINT tareas_mantenimiento_asignada_a_fkey
    FOREIGN KEY (asignada_a) REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD CONSTRAINT tareas_mantenimiento_realizada_por_fkey
    FOREIGN KEY (realizada_por) REFERENCES public.usuarios(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tareas_mantenimiento_prioridad_check'
      AND conrelid = 'public.tareas_mantenimiento'::regclass
  ) THEN
    ALTER TABLE public.tareas_mantenimiento
      ADD CONSTRAINT tareas_mantenimiento_prioridad_check
      CHECK (prioridad IS NULL OR prioridad BETWEEN 0 AND 3);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_tareas_mantenimiento_solicitud_id
  ON public.tareas_mantenimiento (solicitud_id)
  WHERE solicitud_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_tareas_mantenimiento_hotel_estado_fecha
  ON public.tareas_mantenimiento (hotel_id, estado, fecha_programada);

CREATE INDEX IF NOT EXISTS ix_tareas_mantenimiento_hotel_habitacion_estado
  ON public.tareas_mantenimiento (hotel_id, habitacion_id, estado)
  WHERE habitacion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_tareas_mantenimiento_hotel_asignada_estado
  ON public.tareas_mantenimiento (hotel_id, asignada_a, estado)
  WHERE asignada_a IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_tareas_mantenimiento_bloqueantes_abiertas
  ON public.tareas_mantenimiento (habitacion_id)
  WHERE tipo = 'bloqueante'::public.tipo_tarea_enum
    AND estado IN ('pendiente'::public.estado_tarea_enum, 'en_progreso'::public.estado_tarea_enum)
    AND habitacion_id IS NOT NULL;

-- RLS explicito: autenticacion + aislamiento por hotel para lectura y escritura.
ALTER TABLE public.tareas_mantenimiento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "TareasMantenimiento_hotel" ON public.tareas_mantenimiento;
DROP POLICY IF EXISTS "Tareas mantenimiento select hotel" ON public.tareas_mantenimiento;
DROP POLICY IF EXISTS "Tareas mantenimiento insert hotel" ON public.tareas_mantenimiento;
DROP POLICY IF EXISTS "Tareas mantenimiento update hotel" ON public.tareas_mantenimiento;
DROP POLICY IF EXISTS "Tareas mantenimiento delete hotel" ON public.tareas_mantenimiento;

CREATE POLICY "Tareas mantenimiento select hotel"
ON public.tareas_mantenimiento
FOR SELECT TO authenticated
USING (hotel_id = public.get_current_user_hotel_id());

CREATE POLICY "Tareas mantenimiento insert hotel"
ON public.tareas_mantenimiento
FOR INSERT TO authenticated
WITH CHECK (hotel_id = public.get_current_user_hotel_id());

CREATE POLICY "Tareas mantenimiento update hotel"
ON public.tareas_mantenimiento
FOR UPDATE TO authenticated
USING (hotel_id = public.get_current_user_hotel_id())
WITH CHECK (hotel_id = public.get_current_user_hotel_id());

CREATE POLICY "Tareas mantenimiento delete hotel"
ON public.tareas_mantenimiento
FOR DELETE TO authenticated
USING (hotel_id = public.get_current_user_hotel_id());

-- Fuente de verdad para saber si una habitacion tiene bloqueo operativo.
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
      AND tm.estado IN ('pendiente'::public.estado_tarea_enum, 'en_progreso'::public.estado_tarea_enum)
  );
$$;

REVOKE ALL ON FUNCTION public.mantenimiento_habitacion_tiene_bloqueo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mantenimiento_habitacion_tiene_bloqueo(uuid) TO authenticated, service_role;

-- Normaliza auditoria de completado y evita crear un bloqueo sobre una estancia activa.
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

  IF NEW.estado = 'completada'::public.estado_tarea_enum THEN
    NEW.fecha_completada := COALESCE(NEW.fecha_completada, now());
    NEW.ultima_realizacion := COALESCE(NEW.ultima_realizacion, now());
    IF NEW.realizada_por IS NULL AND v_actor IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = v_actor) THEN
      NEW.realizada_por := v_actor;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.estado = 'completada'::public.estado_tarea_enum THEN
    NEW.fecha_completada := NULL;
    NEW.realizada_por := NULL;
  END IF;

  IF NEW.habitacion_id IS NOT NULL
     AND NEW.tipo = 'bloqueante'::public.tipo_tarea_enum
     AND NEW.estado IN ('pendiente'::public.estado_tarea_enum, 'en_progreso'::public.estado_tarea_enum) THEN

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

DROP TRIGGER IF EXISTS trg_validar_tarea_mantenimiento_operativa ON public.tareas_mantenimiento;
CREATE TRIGGER trg_validar_tarea_mantenimiento_operativa
BEFORE INSERT OR UPDATE OF estado, tipo, habitacion_id, fecha_completada, realizada_por
ON public.tareas_mantenimiento
FOR EACH ROW
EXECUTE FUNCTION public.validar_tarea_mantenimiento_operativa();

-- Sincroniza el estado de la habitacion sin tocar reservas ni cronometros.
CREATE OR REPLACE FUNCTION public.sincronizar_habitacion_mantenimiento(p_habitacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_habitacion_id IS NULL THEN
    RETURN;
  END IF;

  IF public.mantenimiento_habitacion_tiene_bloqueo(p_habitacion_id) THEN
    UPDATE public.habitaciones
       SET estado = 'mantenimiento'::public.estado_habitacion_enum
     WHERE id = p_habitacion_id
       AND estado NOT IN ('ocupada'::public.estado_habitacion_enum, 'tiempo agotado'::public.estado_habitacion_enum);
  ELSE
    UPDATE public.habitaciones
       SET estado = 'limpieza'::public.estado_habitacion_enum
     WHERE id = p_habitacion_id
       AND estado = 'mantenimiento'::public.estado_habitacion_enum;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sincronizar_habitacion_mantenimiento(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sincronizar_habitacion_mantenimiento(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_sincronizar_tarea_mantenimiento_habitacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sincronizar_habitacion_mantenimiento(OLD.habitacion_id);
    RETURN OLD;
  END IF;

  PERFORM public.sincronizar_habitacion_mantenimiento(NEW.habitacion_id);
  IF TG_OP = 'UPDATE' AND OLD.habitacion_id IS DISTINCT FROM NEW.habitacion_id THEN
    PERFORM public.sincronizar_habitacion_mantenimiento(OLD.habitacion_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sincronizar_tarea_mantenimiento_habitacion ON public.tareas_mantenimiento;
CREATE TRIGGER trg_sincronizar_tarea_mantenimiento_habitacion
AFTER INSERT OR DELETE OR UPDATE OF estado, tipo, habitacion_id
ON public.tareas_mantenimiento
FOR EACH ROW
EXECUTE FUNCTION public.trg_sincronizar_tarea_mantenimiento_habitacion();

-- Una habitacion con bloqueo abierto no puede pasar a ocupada por otro flujo del sistema.
CREATE OR REPLACE FUNCTION public.impedir_ocupar_habitacion_en_mantenimiento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.estado IN ('ocupada'::public.estado_habitacion_enum, 'tiempo agotado'::public.estado_habitacion_enum)
     AND NEW.estado IS DISTINCT FROM OLD.estado
     AND public.mantenimiento_habitacion_tiene_bloqueo(NEW.id) THEN
    RAISE EXCEPTION 'HABITACION_BLOQUEADA_MANTENIMIENTO: existe un mantenimiento bloqueante abierto.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_impedir_ocupar_habitacion_en_mantenimiento ON public.habitaciones;
CREATE TRIGGER trg_impedir_ocupar_habitacion_en_mantenimiento
BEFORE UPDATE OF estado ON public.habitaciones
FOR EACH ROW
EXECUTE FUNCTION public.impedir_ocupar_habitacion_en_mantenimiento();

-- Defensa adicional: tampoco se puede activar/check-in una reserva en una habitacion bloqueada.
CREATE OR REPLACE FUNCTION public.impedir_activar_reserva_en_mantenimiento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.habitacion_id IS NOT NULL
     AND NEW.estado::text IN ('activa', 'ocupada', 'check_in', 'tiempo agotado')
     AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM NEW.estado OR OLD.habitacion_id IS DISTINCT FROM NEW.habitacion_id)
     AND public.mantenimiento_habitacion_tiene_bloqueo(NEW.habitacion_id) THEN
    RAISE EXCEPTION 'HABITACION_BLOQUEADA_MANTENIMIENTO: la reserva no puede activarse mientras exista un mantenimiento bloqueante.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_impedir_activar_reserva_en_mantenimiento ON public.reservas;
CREATE TRIGGER trg_impedir_activar_reserva_en_mantenimiento
BEFORE INSERT OR UPDATE OF estado, habitacion_id ON public.reservas
FOR EACH ROW
EXECUTE FUNCTION public.impedir_activar_reserva_en_mantenimiento();

-- Evidencias nuevas de mantenimiento: bucket privado y aislado por el primer segmento hotel_id.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mantenimiento-evidencias',
  'mantenimiento-evidencias',
  false,
  12582912,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Mant evidencias select hotel" ON storage.objects;
DROP POLICY IF EXISTS "Mant evidencias insert hotel" ON storage.objects;
DROP POLICY IF EXISTS "Mant evidencias update hotel" ON storage.objects;
DROP POLICY IF EXISTS "Mant evidencias delete hotel" ON storage.objects;

CREATE POLICY "Mant evidencias select hotel"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'mantenimiento-evidencias'
  AND (
    split_part(name, '/', 1) = public.get_current_user_hotel_id()::text
    OR public.actor_is_saas_superadmin()
  )
);

CREATE POLICY "Mant evidencias insert hotel"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'mantenimiento-evidencias'
  AND split_part(name, '/', 1) = public.get_current_user_hotel_id()::text
);

CREATE POLICY "Mant evidencias update hotel"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'mantenimiento-evidencias'
  AND split_part(name, '/', 1) = public.get_current_user_hotel_id()::text
)
WITH CHECK (
  bucket_id = 'mantenimiento-evidencias'
  AND split_part(name, '/', 1) = public.get_current_user_hotel_id()::text
);

CREATE POLICY "Mant evidencias delete hotel"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'mantenimiento-evidencias'
  AND split_part(name, '/', 1) = public.get_current_user_hotel_id()::text
);
