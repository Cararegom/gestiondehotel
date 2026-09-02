-- Fase 4/4 - Automatizacion operativa del modulo de mantenimiento.
-- Objetivos:
-- 1) emitir alertas idempotentes de SLA, preventivos y reincidencias;
-- 2) evitar una tormenta de alertas sobre tareas historicas al activar la fase;
-- 3) reutilizar el centro de notificaciones existente;
-- 4) ejecutar el barrido automaticamente cada 5 minutos con Supabase Cron.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS public.mantenimiento_configuracion (
  hotel_id uuid PRIMARY KEY REFERENCES public.hoteles(id) ON DELETE CASCADE,
  alertas_activas boolean NOT NULL DEFAULT true,
  anticipacion_sla_minutos integer NOT NULL DEFAULT 30,
  anticipacion_preventivo_horas integer NOT NULL DEFAULT 24,
  reincidencia_dias integer NOT NULL DEFAULT 30,
  reincidencia_umbral integer NOT NULL DEFAULT 3,
  activado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mantenimiento_config_anticipacion_sla_check CHECK (anticipacion_sla_minutos BETWEEN 5 AND 1440),
  CONSTRAINT mantenimiento_config_preventivo_check CHECK (anticipacion_preventivo_horas BETWEEN 1 AND 168),
  CONSTRAINT mantenimiento_config_reincidencia_dias_check CHECK (reincidencia_dias BETWEEN 7 AND 365),
  CONSTRAINT mantenimiento_config_reincidencia_umbral_check CHECK (reincidencia_umbral BETWEEN 2 AND 20)
);

-- La fecha de activacion protege a los hoteles existentes de una avalancha de
-- notificaciones por SLA calculados retrospectivamente en Fase 3.
INSERT INTO public.mantenimiento_configuracion(hotel_id)
SELECT h.id FROM public.hoteles h
ON CONFLICT (hotel_id) DO NOTHING;

ALTER TABLE public.mantenimiento_configuracion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Mantenimiento config select hotel" ON public.mantenimiento_configuracion;
DROP POLICY IF EXISTS "Mantenimiento config insert admin" ON public.mantenimiento_configuracion;
DROP POLICY IF EXISTS "Mantenimiento config update admin" ON public.mantenimiento_configuracion;

CREATE POLICY "Mantenimiento config select hotel"
ON public.mantenimiento_configuracion
FOR SELECT TO authenticated
USING (public.fase1_actor_es_miembro_activo(hotel_id));

CREATE POLICY "Mantenimiento config insert admin"
ON public.mantenimiento_configuracion
FOR INSERT TO authenticated
WITH CHECK (public.usuario_actual_es_admin_hotel(hotel_id) OR public.actor_is_saas_superadmin());

CREATE POLICY "Mantenimiento config update admin"
ON public.mantenimiento_configuracion
FOR UPDATE TO authenticated
USING (public.usuario_actual_es_admin_hotel(hotel_id) OR public.actor_is_saas_superadmin())
WITH CHECK (public.usuario_actual_es_admin_hotel(hotel_id) OR public.actor_is_saas_superadmin());

GRANT SELECT, INSERT, UPDATE ON public.mantenimiento_configuracion TO authenticated;
REVOKE ALL ON public.mantenimiento_configuracion FROM anon;

CREATE TABLE IF NOT EXISTS public.mantenimiento_alertas_emitidas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  tarea_id uuid NOT NULL REFERENCES public.tareas_mantenimiento(id) ON DELETE CASCADE,
  tipo_alerta text NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mantenimiento_alerta_tipo_check
    CHECK (tipo_alerta IN ('sla_proximo','sla_vencido','preventivo_proximo','reincidencia')),
  CONSTRAINT mantenimiento_alerta_unica UNIQUE (tarea_id, tipo_alerta)
);

CREATE INDEX IF NOT EXISTS ix_mantenimiento_alertas_hotel_fecha
  ON public.mantenimiento_alertas_emitidas(hotel_id, creado_en DESC);

ALTER TABLE public.mantenimiento_alertas_emitidas ENABLE ROW LEVEL SECURITY;
-- Tabla interna de deduplicacion: ningun cliente necesita leerla o escribirla.
REVOKE ALL ON public.mantenimiento_alertas_emitidas FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.mantenimiento_emitir_alertas(
  p_ahora timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_task record;
  v_inserted uuid;
  v_total integer := 0;
  v_recurrencias integer;
BEGIN
  -- Los hoteles creados despues de esta migracion se activan de forma perezosa
  -- en su primer barrido, sin requerir un trigger privilegiado sobre hoteles.
  INSERT INTO public.mantenimiento_configuracion(hotel_id, activado_en)
  SELECT h.id, p_ahora
  FROM public.hoteles h
  LEFT JOIN public.mantenimiento_configuracion c ON c.hotel_id = h.id
  WHERE c.hotel_id IS NULL
  ON CONFLICT (hotel_id) DO NOTHING;

  -- SLA proximo a vencer.
  FOR v_task IN
    SELECT tm.*, c.anticipacion_sla_minutos, h.nombre AS habitacion_nombre
    FROM public.tareas_mantenimiento tm
    JOIN public.mantenimiento_configuracion c
      ON c.hotel_id = tm.hotel_id
     AND c.alertas_activas
    LEFT JOIN public.habitaciones h ON h.id = tm.habitacion_id
    WHERE tm.creado_en >= c.activado_en
      AND public.mantenimiento_estado_es_abierto(tm.estado::text)
      AND tm.vencimiento_at > p_ahora
      AND tm.vencimiento_at <= p_ahora + make_interval(mins => c.anticipacion_sla_minutos)
  LOOP
    v_inserted := NULL;
    INSERT INTO public.mantenimiento_alertas_emitidas(hotel_id, tarea_id, tipo_alerta)
    VALUES (v_task.hotel_id, v_task.id, 'sla_proximo')
    ON CONFLICT (tarea_id, tipo_alerta) DO NOTHING
    RETURNING id INTO v_inserted;

    IF v_inserted IS NOT NULL THEN
      INSERT INTO public.notificaciones(
        hotel_id, rol_destino, tipo, mensaje, leida,
        entidad_tipo, entidad_id, creado_en, actualizado_en
      )
      VALUES (
        v_task.hotel_id,
        'mantenimiento'::public.rol_usuario_enum,
        'mantenimiento'::public.tipo_notificacion_enum,
        format(
          'Mantenimiento próximo a vencer: %s%s.',
          v_task.titulo,
          CASE WHEN v_task.habitacion_nombre IS NOT NULL
            THEN ' · ' || v_task.habitacion_nombre ELSE '' END
        ),
        false,
        'tarea_mantenimiento',
        v_task.id,
        p_ahora,
        p_ahora
      );
      v_total := v_total + 1;
    END IF;
  END LOOP;

  -- SLA vencido.
  FOR v_task IN
    SELECT tm.*, h.nombre AS habitacion_nombre
    FROM public.tareas_mantenimiento tm
    JOIN public.mantenimiento_configuracion c
      ON c.hotel_id = tm.hotel_id
     AND c.alertas_activas
    LEFT JOIN public.habitaciones h ON h.id = tm.habitacion_id
    WHERE tm.creado_en >= c.activado_en
      AND public.mantenimiento_estado_es_abierto(tm.estado::text)
      AND tm.vencimiento_at <= p_ahora
  LOOP
    v_inserted := NULL;
    INSERT INTO public.mantenimiento_alertas_emitidas(hotel_id, tarea_id, tipo_alerta)
    VALUES (v_task.hotel_id, v_task.id, 'sla_vencido')
    ON CONFLICT (tarea_id, tipo_alerta) DO NOTHING
    RETURNING id INTO v_inserted;

    IF v_inserted IS NOT NULL THEN
      INSERT INTO public.notificaciones(
        hotel_id, rol_destino, tipo, mensaje, leida,
        entidad_tipo, entidad_id, creado_en, actualizado_en
      )
      VALUES (
        v_task.hotel_id,
        'mantenimiento'::public.rol_usuario_enum,
        'urgencia_operativa'::public.tipo_notificacion_enum,
        format(
          'SLA vencido en mantenimiento: %s%s.',
          v_task.titulo,
          CASE WHEN v_task.habitacion_nombre IS NOT NULL
            THEN ' · ' || v_task.habitacion_nombre ELSE '' END
        ),
        false,
        'tarea_mantenimiento',
        v_task.id,
        p_ahora,
        p_ahora
      );
      v_total := v_total + 1;
    END IF;
  END LOOP;

  -- Preventivo programado dentro de la ventana configurada.
  FOR v_task IN
    SELECT tm.*, c.anticipacion_preventivo_horas, h.nombre AS habitacion_nombre
    FROM public.tareas_mantenimiento tm
    JOIN public.mantenimiento_configuracion c
      ON c.hotel_id = tm.hotel_id
     AND c.alertas_activas
    LEFT JOIN public.habitaciones h ON h.id = tm.habitacion_id
    WHERE tm.creado_en >= c.activado_en
      AND public.mantenimiento_estado_es_abierto(tm.estado::text)
      AND tm.frecuencia::text IN ('diaria','semanal','mensual')
      AND tm.fecha_programada IS NOT NULL
      AND (tm.fecha_programada::timestamp AT TIME ZONE 'America/Bogota') >=
          date_trunc('day', p_ahora AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota'
      AND (tm.fecha_programada::timestamp AT TIME ZONE 'America/Bogota') <=
          p_ahora + make_interval(hours => c.anticipacion_preventivo_horas)
  LOOP
    v_inserted := NULL;
    INSERT INTO public.mantenimiento_alertas_emitidas(hotel_id, tarea_id, tipo_alerta)
    VALUES (v_task.hotel_id, v_task.id, 'preventivo_proximo')
    ON CONFLICT (tarea_id, tipo_alerta) DO NOTHING
    RETURNING id INTO v_inserted;

    IF v_inserted IS NOT NULL THEN
      INSERT INTO public.notificaciones(
        hotel_id, rol_destino, tipo, mensaje, leida,
        entidad_tipo, entidad_id, creado_en, actualizado_en
      )
      VALUES (
        v_task.hotel_id,
        'mantenimiento'::public.rol_usuario_enum,
        'tarea_mantenimiento'::public.tipo_notificacion_enum,
        format(
          'Mantenimiento preventivo próximo: %s%s · %s.',
          v_task.titulo,
          CASE WHEN v_task.habitacion_nombre IS NOT NULL
            THEN ' · ' || v_task.habitacion_nombre ELSE '' END,
          to_char(v_task.fecha_programada, 'DD/MM/YYYY')
        ),
        false,
        'tarea_mantenimiento',
        v_task.id,
        p_ahora,
        p_ahora
      );
      v_total := v_total + 1;
    END IF;
  END LOOP;

  -- Reincidencia: misma habitacion + categoria repetida dentro de la ventana.
  FOR v_task IN
    SELECT tm.*, c.reincidencia_dias, c.reincidencia_umbral,
           h.nombre AS habitacion_nombre
    FROM public.tareas_mantenimiento tm
    JOIN public.mantenimiento_configuracion c
      ON c.hotel_id = tm.hotel_id
     AND c.alertas_activas
    LEFT JOIN public.habitaciones h ON h.id = tm.habitacion_id
    WHERE tm.creado_en >= c.activado_en
      AND tm.habitacion_id IS NOT NULL
      AND public.mantenimiento_estado_es_abierto(tm.estado::text)
  LOOP
    SELECT count(*)
      INTO v_recurrencias
      FROM public.tareas_mantenimiento prev
     WHERE prev.hotel_id = v_task.hotel_id
       AND prev.habitacion_id = v_task.habitacion_id
       AND coalesce(prev.categoria_mantenimiento, 'general') =
           coalesce(v_task.categoria_mantenimiento, 'general')
       AND prev.creado_en >= p_ahora - make_interval(days => v_task.reincidencia_dias)
       AND prev.creado_en <= p_ahora;

    IF v_recurrencias >= v_task.reincidencia_umbral THEN
      v_inserted := NULL;
      INSERT INTO public.mantenimiento_alertas_emitidas(hotel_id, tarea_id, tipo_alerta)
      VALUES (v_task.hotel_id, v_task.id, 'reincidencia')
      ON CONFLICT (tarea_id, tipo_alerta) DO NOTHING
      RETURNING id INTO v_inserted;

      IF v_inserted IS NOT NULL THEN
        INSERT INTO public.notificaciones(
          hotel_id, rol_destino, tipo, mensaje, leida,
          entidad_tipo, entidad_id, creado_en, actualizado_en
        )
        VALUES (
          v_task.hotel_id,
          'mantenimiento'::public.rol_usuario_enum,
          'mantenimiento_requerido'::public.tipo_notificacion_enum,
          format(
            'Reincidencia detectada en %s: %s reportes de %s en %s días.',
            coalesce(v_task.habitacion_nombre, 'habitación'),
            v_recurrencias,
            coalesce(v_task.categoria_mantenimiento, 'general'),
            v_task.reincidencia_dias
          ),
          false,
          'tarea_mantenimiento',
          v_task.id,
          p_ahora,
          p_ahora
        );
        v_total := v_total + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.mantenimiento_emitir_alertas(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mantenimiento_emitir_alertas(timestamptz)
  TO service_role;

-- Supabase Cron / pg_cron: el nombre estable hace la programacion idempotente.
DO $$
BEGIN
  PERFORM cron.schedule(
    'mantenimiento-alertas-fase4',
    '*/5 * * * *',
    'SELECT public.mantenimiento_emitir_alertas();'
  );
END $$;
