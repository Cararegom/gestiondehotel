-- Fase 1/4 - La tarea bloqueante es la fuente de verdad del estado operativo.
-- Si otro flujo intenta sacar una habitacion de mantenimiento mientras sigue
-- existiendo un bloqueo abierto, la habitacion permanece en mantenimiento.
-- Intentar ocuparla sigue siendo un error explicito.

CREATE OR REPLACE FUNCTION public.impedir_ocupar_habitacion_en_mantenimiento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado
     AND public.mantenimiento_habitacion_tiene_bloqueo(NEW.id) THEN
    IF NEW.estado IN (
      'ocupada'::public.estado_habitacion_enum,
      'tiempo agotado'::public.estado_habitacion_enum
    ) THEN
      RAISE EXCEPTION 'HABITACION_BLOQUEADA_MANTENIMIENTO: existe un mantenimiento bloqueante abierto.'
        USING ERRCODE = 'P0001';
    END IF;

    NEW.estado := 'mantenimiento'::public.estado_habitacion_enum;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_impedir_ocupar_habitacion_en_mantenimiento ON public.habitaciones;
CREATE TRIGGER trg_impedir_ocupar_habitacion_en_mantenimiento
BEFORE UPDATE OF estado ON public.habitaciones
FOR EACH ROW
EXECUTE FUNCTION public.impedir_ocupar_habitacion_en_mantenimiento();
