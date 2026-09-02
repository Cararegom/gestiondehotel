-- Fase 1/4 - Indices de auditoria de mantenimiento.
-- Los indices compuestos de operacion no cubren por si solos las FK hacia usuarios
-- porque la columna del usuario no es la primera del indice.

CREATE INDEX IF NOT EXISTS ix_tareas_mantenimiento_creada_por
  ON public.tareas_mantenimiento (creada_por)
  WHERE creada_por IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_tareas_mantenimiento_asignada_a
  ON public.tareas_mantenimiento (asignada_a)
  WHERE asignada_a IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_tareas_mantenimiento_realizada_por
  ON public.tareas_mantenimiento (realizada_por)
  WHERE realizada_por IS NOT NULL;
