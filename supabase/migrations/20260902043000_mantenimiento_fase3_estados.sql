-- Fase 3/4 - Estados profesionales del flujo de mantenimiento.
-- Se conservan los valores legacy del enum para compatibilidad, pero los nuevos
-- flujos usan los estados canonicos definidos aqui.

ALTER TYPE public.estado_tarea_enum ADD VALUE IF NOT EXISTS 'en_revision';
ALTER TYPE public.estado_tarea_enum ADD VALUE IF NOT EXISTS 'asignado';
ALTER TYPE public.estado_tarea_enum ADD VALUE IF NOT EXISTS 'en_proceso';
ALTER TYPE public.estado_tarea_enum ADD VALUE IF NOT EXISTS 'resuelto';
ALTER TYPE public.estado_tarea_enum ADD VALUE IF NOT EXISTS 'cerrado';
ALTER TYPE public.estado_tarea_enum ADD VALUE IF NOT EXISTS 'cancelado';
