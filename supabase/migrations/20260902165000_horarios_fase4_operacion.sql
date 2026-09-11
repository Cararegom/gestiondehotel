-- Creador profesional de horarios - Fase 4/4
-- Autopreparación segura: puede crear un borrador futuro cuando un administrador
-- entra al módulo dentro de la ventana configurada. Nunca publica automáticamente.

ALTER TABLE public.horario_configuracion
  ADD COLUMN IF NOT EXISTS autopreparar_activo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS autopreparar_periodo text NOT NULL DEFAULT 'semana',
  ADD COLUMN IF NOT EXISTS autopreparar_dias_anticipacion smallint NOT NULL DEFAULT 3;

ALTER TABLE public.horario_configuracion
  DROP CONSTRAINT IF EXISTS horario_configuracion_autopreparar_periodo_check,
  ADD CONSTRAINT horario_configuracion_autopreparar_periodo_check
    CHECK (autopreparar_periodo IN ('semana', 'mes')),
  DROP CONSTRAINT IF EXISTS horario_configuracion_autopreparar_dias_check,
  ADD CONSTRAINT horario_configuracion_autopreparar_dias_check
    CHECK (autopreparar_dias_anticipacion BETWEEN 1 AND 14);

-- Ayuda a evitar duplicados al comprobar si el periodo futuro ya tiene
-- borrador o publicación. No modifica ni deduplica historia existente.
CREATE INDEX IF NOT EXISTS ix_horario_borradores_hotel_rango_estado
  ON public.horario_borradores(hotel_id, fecha_inicio, fecha_fin, estado);

-- Las solicitudes operativas se consultan por hotel/estado/fechas desde
-- horario-operations. El índice parcial histórico se mantiene intacto.
CREATE INDEX IF NOT EXISTS ix_horario_solicitudes_hotel_activo_fechas
  ON public.horario_solicitudes(hotel_id, fecha_inicio, fecha_fin)
  WHERE activo IS TRUE;
