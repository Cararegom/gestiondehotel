-- Creador profesional de horarios - Fase 1/4
-- Sustituye la dependencia del workflow/VM por un modelo nativo en Supabase.
-- Los horarios generados viven primero como borrador y solo llegan a
-- turnos_programados cuando un administrador los publica.

CREATE TABLE IF NOT EXISTS public.horario_configuracion (
  hotel_id uuid PRIMARY KEY REFERENCES public.hoteles(id) ON DELETE CASCADE,
  modalidad smallint NOT NULL DEFAULT 12 CHECK (modalidad IN (8, 12)),
  zona_horaria text NOT NULL DEFAULT 'America/Bogota',
  descanso_minimo_horas numeric(4,1) NOT NULL DEFAULT 11 CHECK (descanso_minimo_horas BETWEEN 6 AND 24),
  descansos_minimos_semana smallint NOT NULL DEFAULT 1 CHECK (descansos_minimos_semana BETWEEN 1 AND 6),
  max_turnos_consecutivos smallint NOT NULL DEFAULT 6 CHECK (max_turnos_consecutivos BETWEEN 1 AND 14),
  max_noches_consecutivas smallint NOT NULL DEFAULT 3 CHECK (max_noches_consecutivas BETWEEN 1 AND 7),
  equilibrar_noches boolean NOT NULL DEFAULT true,
  equilibrar_fines_semana boolean NOT NULL DEFAULT true,
  permitir_turnos_extendidos boolean NOT NULL DEFAULT false,
  publicar_requiere_sin_conflictos boolean NOT NULL DEFAULT true,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL
);

INSERT INTO public.horario_configuracion(hotel_id, modalidad)
SELECT h.id, CASE WHEN coalesce(ch.tipo_turno_global, 12) = 8 THEN 8 ELSE 12 END
FROM public.hoteles h
LEFT JOIN public.configuracion_hotel ch ON ch.hotel_id = h.id
ON CONFLICT (hotel_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.horario_plantillas_turno (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  nombre text NOT NULL,
  hora_inicio time NOT NULL,
  hora_fin time NOT NULL,
  duracion_minutos integer NOT NULL CHECK (duracion_minutos BETWEEN 60 AND 1440),
  es_nocturno boolean NOT NULL DEFAULT false,
  es_extendido boolean NOT NULL DEFAULT false,
  grupo text NOT NULL DEFAULT 'normal' CHECK (grupo IN ('normal', 'extendido')),
  activo boolean NOT NULL DEFAULT true,
  orden smallint NOT NULL DEFAULT 0,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, codigo)
);

CREATE INDEX IF NOT EXISTS ix_horario_plantillas_hotel_grupo
  ON public.horario_plantillas_turno(hotel_id, activo, grupo, orden);

CREATE TABLE IF NOT EXISTS public.horario_solicitudes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  fecha_inicio date NOT NULL,
  fecha_fin date NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('no_disponible','descanso','turno_fijo','preferir_turno','evitar_turno')),
  plantilla_turno_id uuid REFERENCES public.horario_plantillas_turno(id) ON DELETE SET NULL,
  obligatorio boolean NOT NULL DEFAULT true,
  motivo text,
  activo boolean NOT NULL DEFAULT true,
  creado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CHECK (fecha_fin >= fecha_inicio),
  CHECK ((tipo IN ('turno_fijo','preferir_turno','evitar_turno') AND plantilla_turno_id IS NOT NULL)
      OR tipo IN ('no_disponible','descanso'))
);

CREATE INDEX IF NOT EXISTS ix_horario_solicitudes_hotel_usuario_fechas
  ON public.horario_solicitudes(hotel_id, usuario_id, fecha_inicio, fecha_fin)
  WHERE activo IS TRUE;

CREATE TABLE IF NOT EXISTS public.horario_borradores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  fecha_inicio date NOT NULL,
  fecha_fin date NOT NULL,
  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','publicado','descartado')),
  modalidad smallint NOT NULL CHECK (modalidad IN (8,12)),
  origen text NOT NULL DEFAULT 'generado' CHECK (origen IN ('generado','reorganizado','manual')),
  configuracion_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  validacion jsonb NOT NULL DEFAULT '{"conflictos":[],"advertencias":[]}'::jsonb,
  calidad numeric(5,2),
  generado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  publicado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  publicado_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CHECK (fecha_fin >= fecha_inicio),
  CHECK ((fecha_fin - fecha_inicio) <= 62)
);

CREATE INDEX IF NOT EXISTS ix_horario_borradores_hotel_estado_fecha
  ON public.horario_borradores(hotel_id, estado, fecha_inicio DESC);

CREATE TABLE IF NOT EXISTS public.horario_borrador_asignaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrador_id uuid NOT NULL REFERENCES public.horario_borradores(id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
  fecha date NOT NULL,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  plantilla_turno_id uuid REFERENCES public.horario_plantillas_turno(id) ON DELETE RESTRICT,
  tipo_turno text NOT NULL,
  bloqueado boolean NOT NULL DEFAULT false,
  origen text NOT NULL DEFAULT 'auto' CHECK (origen IN ('auto','manual','solicitud')),
  motivo jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (borrador_id, fecha, usuario_id),
  CHECK ((tipo_turno = 'descanso' AND plantilla_turno_id IS NULL)
      OR (tipo_turno <> 'descanso' AND plantilla_turno_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ix_horario_asignaciones_borrador_fecha
  ON public.horario_borrador_asignaciones(borrador_id, fecha, tipo_turno);
CREATE INDEX IF NOT EXISTS ix_horario_asignaciones_usuario_fecha
  ON public.horario_borrador_asignaciones(hotel_id, usuario_id, fecha);

ALTER TABLE public.turnos_programados
  ADD COLUMN IF NOT EXISTS plantilla_turno_id uuid REFERENCES public.horario_plantillas_turno(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS horario_borrador_id uuid REFERENCES public.horario_borradores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_turnos_programados_horario_borrador
  ON public.turnos_programados(horario_borrador_id)
  WHERE horario_borrador_id IS NOT NULL;

-- RLS
ALTER TABLE public.horario_configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horario_plantillas_turno ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horario_solicitudes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horario_borradores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horario_borrador_asignaciones ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.horario_configuracion, public.horario_plantillas_turno,
  public.horario_solicitudes, public.horario_borradores,
  public.horario_borrador_asignaciones FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.horario_configuracion,
  public.horario_plantillas_turno, public.horario_solicitudes,
  public.horario_borradores, public.horario_borrador_asignaciones TO authenticated;

CREATE POLICY "horario_config_select" ON public.horario_configuracion
FOR SELECT TO authenticated USING (public.fase1_actor_es_miembro_activo(hotel_id));
CREATE POLICY "horario_config_admin_insert" ON public.horario_configuracion
FOR INSERT TO authenticated WITH CHECK (public.usuario_actual_es_admin_hotel(hotel_id));
CREATE POLICY "horario_config_admin_update" ON public.horario_configuracion
FOR UPDATE TO authenticated USING (public.usuario_actual_es_admin_hotel(hotel_id))
WITH CHECK (public.usuario_actual_es_admin_hotel(hotel_id));
CREATE POLICY "horario_config_admin_delete" ON public.horario_configuracion
FOR DELETE TO authenticated USING (public.usuario_actual_es_admin_hotel(hotel_id));

CREATE POLICY "horario_plantillas_select" ON public.horario_plantillas_turno
FOR SELECT TO authenticated USING (public.fase1_actor_es_miembro_activo(hotel_id));
CREATE POLICY "horario_plantillas_admin_insert" ON public.horario_plantillas_turno
FOR INSERT TO authenticated WITH CHECK (public.usuario_actual_es_admin_hotel(hotel_id));
CREATE POLICY "horario_plantillas_admin_update" ON public.horario_plantillas_turno
FOR UPDATE TO authenticated USING (public.usuario_actual_es_admin_hotel(hotel_id))
WITH CHECK (public.usuario_actual_es_admin_hotel(hotel_id));
CREATE POLICY "horario_plantillas_admin_delete" ON public.horario_plantillas_turno
FOR DELETE TO authenticated USING (public.usuario_actual_es_admin_hotel(hotel_id));

CREATE POLICY "horario_solicitudes_select" ON public.horario_solicitudes
FOR SELECT TO authenticated USING (
  public.fase1_actor_es_miembro_activo(hotel_id)
  AND (usuario_id = auth.uid() OR public.usuario_actual_es_admin_hotel(hotel_id))
);
CREATE POLICY "horario_solicitudes_insert" ON public.horario_solicitudes
FOR INSERT TO authenticated WITH CHECK (
  public.fase1_actor_es_miembro_activo(hotel_id)
  AND (usuario_id = auth.uid() OR public.usuario_actual_es_admin_hotel(hotel_id))
);
CREATE POLICY "horario_solicitudes_update" ON public.horario_solicitudes
FOR UPDATE TO authenticated USING (
  public.fase1_actor_es_miembro_activo(hotel_id)
  AND (usuario_id = auth.uid() OR public.usuario_actual_es_admin_hotel(hotel_id))
) WITH CHECK (
  public.fase1_actor_es_miembro_activo(hotel_id)
  AND (usuario_id = auth.uid() OR public.usuario_actual_es_admin_hotel(hotel_id))
);
CREATE POLICY "horario_solicitudes_delete" ON public.horario_solicitudes
FOR DELETE TO authenticated USING (
  public.fase1_actor_es_miembro_activo(hotel_id)
  AND (usuario_id = auth.uid() OR public.usuario_actual_es_admin_hotel(hotel_id))
);

CREATE POLICY "horario_borradores_admin_select" ON public.horario_borradores
FOR SELECT TO authenticated USING (public.usuario_actual_es_admin_hotel(hotel_id));
CREATE POLICY "horario_borradores_admin_insert" ON public.horario_borradores
FOR INSERT TO authenticated WITH CHECK (public.usuario_actual_es_admin_hotel(hotel_id));
CREATE POLICY "horario_borradores_admin_update" ON public.horario_borradores
FOR UPDATE TO authenticated USING (public.usuario_actual_es_admin_hotel(hotel_id))
WITH CHECK (public.usuario_actual_es_admin_hotel(hotel_id));
CREATE POLICY "horario_borradores_admin_delete" ON public.horario_borradores
FOR DELETE TO authenticated USING (public.usuario_actual_es_admin_hotel(hotel_id));

CREATE POLICY "horario_asignaciones_admin_select" ON public.horario_borrador_asignaciones
FOR SELECT TO authenticated USING (public.usuario_actual_es_admin_hotel(hotel_id));
CREATE POLICY "horario_asignaciones_admin_insert" ON public.horario_borrador_asignaciones
FOR INSERT TO authenticated WITH CHECK (public.usuario_actual_es_admin_hotel(hotel_id));
CREATE POLICY "horario_asignaciones_admin_update" ON public.horario_borrador_asignaciones
FOR UPDATE TO authenticated USING (public.usuario_actual_es_admin_hotel(hotel_id))
WITH CHECK (public.usuario_actual_es_admin_hotel(hotel_id));
CREATE POLICY "horario_asignaciones_admin_delete" ON public.horario_borrador_asignaciones
FOR DELETE TO authenticated USING (public.usuario_actual_es_admin_hotel(hotel_id));
