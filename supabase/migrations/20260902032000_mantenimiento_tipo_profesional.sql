-- Fase 1/4 - Mantenimiento profesional
-- Se agregan valores de impacto operativo al enum existente en una migracion
-- separada para que PostgreSQL pueda usarlos con seguridad en la siguiente transaccion.

ALTER TYPE public.tipo_tarea_enum ADD VALUE IF NOT EXISTS 'bloqueante';
ALTER TYPE public.tipo_tarea_enum ADD VALUE IF NOT EXISTS 'programado';
