-- Automatizacion de planes y vencimientos de mantenimiento.
-- Genera tareas antes de la fecha prevista y envia recordatorios al encargado
-- de mantenimiento y a administracion sin depender de cuando se cierre la tarea anterior.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS public.mantenimiento_plan_alertas_emitidas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.mantenimiento_planes(id) ON DELETE CASCADE,
  tarea_id uuid NOT NULL REFERENCES public.tareas_mantenimiento(id) ON DELETE CASCADE,
  fecha_ocurrencia date NOT NULL,
  tipo_alerta text NOT NULL,
  dias_antes integer NOT NULL,
  rol_destino public.rol_usuario_enum NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mantenimiento_plan_alertas_tipo_check
    CHECK (tipo_alerta IN ('recordatorio', 'vence_hoy', 'vencido')),
  CONSTRAINT mantenimiento_plan_alertas_dias_check
    CHECK (dias_antes BETWEEN -1 AND 365),
  CONSTRAINT mantenimiento_plan_alerta_unica
    UNIQUE (tarea_id, tipo_alerta, dias_antes, rol_destino)
);

CREATE INDEX IF NOT EXISTS ix_mantenimiento_plan_alertas_hotel_fecha
  ON public.mantenimiento_plan_alertas_emitidas(hotel_id, creado_en DESC);

ALTER TABLE public.mantenimiento_plan_alertas_emitidas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Mantenimiento plan alertas internas" ON public.mantenimiento_plan_alertas_emitidas;
CREATE POLICY "Mantenimiento plan alertas internas"
ON public.mantenimiento_plan_alertas_emitidas
FOR ALL TO authenticated
USING (false)
WITH CHECK (false);
REVOKE ALL ON public.mantenimiento_plan_alertas_emitidas FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mantenimiento_plan_alertas_emitidas TO service_role;

CREATE OR REPLACE FUNCTION public.mantenimiento_generar_tareas_planes(
  p_ahora timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  v_plan record;
  v_hoy date;
  v_horizonte date;
  v_max_anticipacion integer;
  v_fecha date;
  v_siguiente date;
  v_frecuencia public.frecuencia_tarea_enum;
  v_inserted uuid;
  v_total integer := 0;
  v_guard integer;
BEGIN
  FOR v_plan IN
    SELECT mp.*
    FROM public.mantenimiento_planes mp
    WHERE mp.activo
      AND mp.proxima_fecha IS NOT NULL
    ORDER BY mp.hotel_id, mp.proxima_fecha, mp.id
  LOOP
    v_hoy := public.hotel_business_date(v_plan.hotel_id, p_ahora);
    SELECT COALESCE(max(x), 0)
      INTO v_max_anticipacion
      FROM unnest(v_plan.anticipaciones_dias) AS x;

    v_horizonte := v_hoy + GREATEST(v_max_anticipacion, 0);
    v_fecha := v_plan.proxima_fecha;
    v_guard := 0;

    WHILE v_fecha IS NOT NULL
      AND v_fecha <= v_horizonte
      AND (v_plan.fecha_fin IS NULL OR v_fecha <= v_plan.fecha_fin)
    LOOP
      v_guard := v_guard + 1;
      IF v_guard > 500 THEN
        RAISE EXCEPTION 'Se excedio el limite de ocurrencias para el plan %', v_plan.id;
      END IF;

      v_frecuencia := CASE
        WHEN v_plan.recurrencia_unidad = 'ninguna' THEN 'unica'::public.frecuencia_tarea_enum
        WHEN v_plan.recurrencia_unidad = 'dia' AND v_plan.recurrencia_intervalo = 1 THEN 'diaria'::public.frecuencia_tarea_enum
        WHEN v_plan.recurrencia_unidad = 'semana' AND v_plan.recurrencia_intervalo = 1 THEN 'semanal'::public.frecuencia_tarea_enum
        WHEN v_plan.recurrencia_unidad = 'mes' AND v_plan.recurrencia_intervalo = 1 THEN 'mensual'::public.frecuencia_tarea_enum
        ELSE 'personalizada'::public.frecuencia_tarea_enum
      END;

      v_inserted := NULL;
      INSERT INTO public.tareas_mantenimiento(
        hotel_id,
        titulo,
        descripcion,
        estado,
        tipo,
        fecha_programada,
        fecha_completada,
        frecuencia,
        ultima_realizacion,
        creada_por,
        asignada_a,
        realizada_por,
        habitacion_id,
        prioridad,
        adjuntos,
        categoria_mantenimiento,
        solicitud_id,
        plan_id,
        ubicacion_mantenimiento
      )
      VALUES (
        v_plan.hotel_id,
        v_plan.titulo,
        v_plan.descripcion,
        'pendiente'::public.estado_tarea_enum,
        'programado'::public.tipo_tarea_enum,
        v_fecha,
        NULL,
        v_frecuencia,
        NULL,
        v_plan.creada_por,
        v_plan.asignada_a,
        NULL,
        v_plan.habitacion_id,
        v_plan.prioridad,
        '[]'::jsonb,
        v_plan.categoria_mantenimiento,
        gen_random_uuid(),
        v_plan.id,
        v_plan.ubicacion
      )
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_inserted;

      IF v_inserted IS NOT NULL THEN
        v_total := v_total + 1;
      END IF;

      v_siguiente := public.mantenimiento_plan_siguiente_fecha(
        v_fecha,
        v_plan.fecha_inicio,
        v_plan.recurrencia_unidad,
        v_plan.recurrencia_intervalo
      );

      IF v_siguiente IS NOT NULL
         AND v_plan.fecha_fin IS NOT NULL
         AND v_siguiente > v_plan.fecha_fin THEN
        v_siguiente := NULL;
      END IF;

      v_fecha := v_siguiente;
    END LOOP;

    UPDATE public.mantenimiento_planes
       SET proxima_fecha = v_fecha,
           actualizado_en = now()
     WHERE id = v_plan.id
       AND proxima_fecha IS NOT DISTINCT FROM v_plan.proxima_fecha;
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.mantenimiento_generar_tareas_planes(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mantenimiento_generar_tareas_planes(timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.mantenimiento_emitir_alertas_planes(
  p_ahora timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  v_item record;
  v_hoy date;
  v_dias integer;
  v_role public.rol_usuario_enum;
  v_inserted uuid;
  v_tipo_alerta text;
  v_tipo_notificacion public.tipo_notificacion_enum;
  v_mensaje text;
  v_total integer := 0;
BEGIN
  FOR v_item IN
    SELECT
      tm.id AS tarea_id,
      tm.hotel_id,
      tm.fecha_programada,
      tm.estado,
      mp.id AS plan_id,
      mp.clase,
      mp.titulo,
      mp.ubicacion,
      mp.anticipaciones_dias
    FROM public.tareas_mantenimiento tm
    JOIN public.mantenimiento_planes mp ON mp.id = tm.plan_id
    WHERE mp.activo
      AND tm.fecha_programada IS NOT NULL
      AND public.mantenimiento_estado_es_abierto(tm.estado::text)
  LOOP
    v_hoy := public.hotel_business_date(v_item.hotel_id, p_ahora);

    FOR v_dias IN
      SELECT DISTINCT x
      FROM unnest(v_item.anticipaciones_dias) AS x
      WHERE x BETWEEN 0 AND 365
      ORDER BY x DESC
    LOOP
      IF v_hoy = (v_item.fecha_programada - v_dias) THEN
        v_tipo_alerta := CASE WHEN v_dias = 0 THEN 'vence_hoy' ELSE 'recordatorio' END;
        v_tipo_notificacion := CASE
          WHEN v_dias = 0 THEN 'urgencia_operativa'::public.tipo_notificacion_enum
          ELSE 'tarea_mantenimiento'::public.tipo_notificacion_enum
        END;

        IF v_item.clase = 'vencimiento' THEN
          v_mensaje := CASE
            WHEN v_dias = 0 THEN format(
              'Vence hoy: %s%s · %s.',
              v_item.titulo,
              CASE WHEN v_item.ubicacion IS NOT NULL THEN ' · ' || v_item.ubicacion ELSE '' END,
              to_char(v_item.fecha_programada, 'DD/MM/YYYY')
            )
            ELSE format(
              'Vencimiento proximo: %s%s vence en %s dias · %s.',
              v_item.titulo,
              CASE WHEN v_item.ubicacion IS NOT NULL THEN ' · ' || v_item.ubicacion ELSE '' END,
              v_dias,
              to_char(v_item.fecha_programada, 'DD/MM/YYYY')
            )
          END;
        ELSE
          v_mensaje := CASE
            WHEN v_dias = 0 THEN format(
              'Mantenimiento programado para hoy: %s%s.',
              v_item.titulo,
              CASE WHEN v_item.ubicacion IS NOT NULL THEN ' · ' || v_item.ubicacion ELSE '' END
            )
            ELSE format(
              'Mantenimiento proximo: %s%s · faltan %s dias.',
              v_item.titulo,
              CASE WHEN v_item.ubicacion IS NOT NULL THEN ' · ' || v_item.ubicacion ELSE '' END,
              v_dias
            )
          END;
        END IF;

        FOREACH v_role IN ARRAY ARRAY[
          'mantenimiento'::public.rol_usuario_enum,
          'admin'::public.rol_usuario_enum
        ]
        LOOP
          v_inserted := NULL;
          INSERT INTO public.mantenimiento_plan_alertas_emitidas(
            hotel_id,
            plan_id,
            tarea_id,
            fecha_ocurrencia,
            tipo_alerta,
            dias_antes,
            rol_destino
          )
          VALUES (
            v_item.hotel_id,
            v_item.plan_id,
            v_item.tarea_id,
            v_item.fecha_programada,
            v_tipo_alerta,
            v_dias,
            v_role
          )
          ON CONFLICT (tarea_id, tipo_alerta, dias_antes, rol_destino) DO NOTHING
          RETURNING id INTO v_inserted;

          IF v_inserted IS NOT NULL THEN
            INSERT INTO public.notificaciones(
              hotel_id,
              rol_destino,
              tipo,
              mensaje,
              leida,
              entidad_tipo,
              entidad_id,
              creado_en,
              actualizado_en
            )
            VALUES (
              v_item.hotel_id,
              v_role,
              v_tipo_notificacion,
              v_mensaje,
              false,
              'tarea_mantenimiento',
              v_item.tarea_id,
              p_ahora,
              p_ahora
            );
            v_total := v_total + 1;
          END IF;
        END LOOP;
      END IF;
    END LOOP;

    IF v_hoy > v_item.fecha_programada THEN
      v_mensaje := format(
        '%s vencido: %s%s · debia realizarse el %s.',
        CASE WHEN v_item.clase = 'vencimiento' THEN 'Vencimiento' ELSE 'Mantenimiento' END,
        v_item.titulo,
        CASE WHEN v_item.ubicacion IS NOT NULL THEN ' · ' || v_item.ubicacion ELSE '' END,
        to_char(v_item.fecha_programada, 'DD/MM/YYYY')
      );

      FOREACH v_role IN ARRAY ARRAY[
        'mantenimiento'::public.rol_usuario_enum,
        'admin'::public.rol_usuario_enum
      ]
      LOOP
        v_inserted := NULL;
        INSERT INTO public.mantenimiento_plan_alertas_emitidas(
          hotel_id,
          plan_id,
          tarea_id,
          fecha_ocurrencia,
          tipo_alerta,
          dias_antes,
          rol_destino
        )
        VALUES (
          v_item.hotel_id,
          v_item.plan_id,
          v_item.tarea_id,
          v_item.fecha_programada,
          'vencido',
          -1,
          v_role
        )
        ON CONFLICT (tarea_id, tipo_alerta, dias_antes, rol_destino) DO NOTHING
        RETURNING id INTO v_inserted;

        IF v_inserted IS NOT NULL THEN
          INSERT INTO public.notificaciones(
            hotel_id,
            rol_destino,
            tipo,
            mensaje,
            leida,
            entidad_tipo,
            entidad_id,
            creado_en,
            actualizado_en
          )
          VALUES (
            v_item.hotel_id,
            v_role,
            'urgencia_operativa'::public.tipo_notificacion_enum,
            v_mensaje,
            false,
            'tarea_mantenimiento',
            v_item.tarea_id,
            p_ahora,
            p_ahora
          );
          v_total := v_total + 1;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.mantenimiento_emitir_alertas_planes(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mantenimiento_emitir_alertas_planes(timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.mantenimiento_calendario_tick(
  p_ahora timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $$
DECLARE
  v_generadas integer;
  v_alertas integer;
BEGIN
  v_generadas := public.mantenimiento_generar_tareas_planes(p_ahora);
  v_alertas := public.mantenimiento_emitir_alertas_planes(p_ahora);

  RETURN jsonb_build_object(
    'tareas_generadas', v_generadas,
    'alertas_emitidas', v_alertas,
    'ejecutado_en', p_ahora
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mantenimiento_calendario_tick(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mantenimiento_calendario_tick(timestamptz)
  TO service_role;

-- El mismo nombre de job mantiene la programacion idempotente si la migracion
-- se vuelve a ejecutar. La logica usa la zona horaria oficial de cada hotel.
SELECT cron.schedule(
  'mantenimiento-calendario-planes',
  '*/15 * * * *',
  'SELECT public.mantenimiento_calendario_tick();'
);
