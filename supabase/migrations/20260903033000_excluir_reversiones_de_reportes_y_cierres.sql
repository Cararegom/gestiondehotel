-- Las reversiones administrativas conservan toda su trazabilidad, pero no deben
-- contabilizarse como ingresos/egresos operativos ni aparecer en reportes/cierres.
--
-- La fuente de verdad sigue siendo caja + caja_reversiones. La columna
-- afecta_reportes materializa esa semántica para que TODAS las lecturas del
-- navegador (Reportes, Caja, Dashboard y correo de cierre) reciban únicamente
-- movimientos financieros vigentes. Service role y funciones SECURITY DEFINER
-- conservan acceso al histórico completo para auditoría y conciliación.

ALTER TABLE public.caja
  ADD COLUMN IF NOT EXISTS afecta_reportes boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.caja.afecta_reportes IS
  'true si el movimiento forma parte de la caja operativa; false para original+contramovimiento de una reversión administrativa.';

-- Backfill: las reversiones ya existentes dejan de afectar inmediatamente todos
-- los reportes históricos. Se marcan tanto el movimiento original como el
-- contramovimiento técnico de reversión.
UPDATE public.caja AS c
SET afecta_reportes = false
WHERE c.afecta_reportes IS DISTINCT FROM false
  AND EXISTS (
    SELECT 1
    FROM public.caja_reversiones AS cr
    WHERE cr.hotel_id = c.hotel_id
      AND (
        cr.original_movement_id = c.id
        OR cr.reversal_movement_id = c.id
      )
  );

-- Una fila técnica de reversión nunca debe quedar visible entre movimientos
-- operativos, incluso durante el mismo flujo transaccional antes de crear el
-- vínculo en caja_reversiones.
CREATE OR REPLACE FUNCTION public.caja_forzar_reversion_tecnica_fuera_reportes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.original_movement_id IS NOT NULL THEN
    NEW.afecta_reportes := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_caja_forzar_reversion_tecnica_fuera_reportes ON public.caja;
CREATE TRIGGER trg_caja_forzar_reversion_tecnica_fuera_reportes
BEFORE INSERT OR UPDATE OF original_movement_id, afecta_reportes
ON public.caja
FOR EACH ROW
EXECUTE FUNCTION public.caja_forzar_reversion_tecnica_fuera_reportes();

-- Cuando se registra una reversión, el original también debe salir de la caja
-- operativa. Esto cubre todas las reversiones futuras sin depender del texto del
-- concepto ni de un source concreto.
CREATE OR REPLACE FUNCTION public.caja_marcar_par_revertido_fuera_reportes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.caja
  SET afecta_reportes = false
  WHERE hotel_id = NEW.hotel_id
    AND id IN (NEW.original_movement_id, NEW.reversal_movement_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_caja_marcar_par_revertido_fuera_reportes ON public.caja_reversiones;
CREATE TRIGGER trg_caja_marcar_par_revertido_fuera_reportes
AFTER INSERT
ON public.caja_reversiones
FOR EACH ROW
EXECUTE FUNCTION public.caja_marcar_par_revertido_fuera_reportes();

-- No exponemos las funciones de trigger como superficie RPC.
REVOKE ALL ON FUNCTION public.caja_forzar_reversion_tecnica_fuera_reportes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.caja_marcar_par_revertido_fuera_reportes() FROM PUBLIC, anon, authenticated;

-- Política RESTRICTIVE: se combina con Caja_hotel (membresía tenant-aware).
-- Así las consultas existentes a public.caja no necesitan filtros repetidos y
-- ningún módulo puede volver a sumar por accidente una reversión administrativa.
DROP POLICY IF EXISTS caja_solo_movimientos_operativos ON public.caja;
CREATE POLICY caja_solo_movimientos_operativos
ON public.caja
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (afecta_reportes);

CREATE INDEX IF NOT EXISTS caja_operativa_hotel_fecha_idx
ON public.caja (hotel_id, fecha_movimiento DESC)
WHERE afecta_reportes;
