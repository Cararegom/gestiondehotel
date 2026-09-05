-- Indices de soporte para llaves foraneas del calendario de mantenimiento.
-- Evitan escaneos completos durante borrados/cambios de usuarios, habitaciones y planes.

CREATE INDEX IF NOT EXISTS ix_mantenimiento_planes_asignada_a
  ON public.mantenimiento_planes(asignada_a)
  WHERE asignada_a IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_mantenimiento_planes_creada_por
  ON public.mantenimiento_planes(creada_por)
  WHERE creada_por IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_mantenimiento_planes_habitacion_id
  ON public.mantenimiento_planes(habitacion_id)
  WHERE habitacion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_mantenimiento_plan_alertas_plan_id
  ON public.mantenimiento_plan_alertas_emitidas(plan_id);
