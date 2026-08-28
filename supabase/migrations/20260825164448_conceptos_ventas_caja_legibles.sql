-- Convierte el concepto tecnico de las ventas atomicas en un resumen util para Caja.
-- El detalle se toma de las filas ya validadas y guardadas por cada venta.
CREATE OR REPLACE FUNCTION public.asignar_concepto_venta_caja()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_detalle text;
BEGIN
  IF NEW.venta_tienda_id IS NOT NULL THEN
    SELECT string_agg(
      format('%s x %s', detalle.cantidad, producto.nombre),
      ', ' ORDER BY detalle.creado_en, detalle.id
    )
    INTO v_detalle
    FROM public.detalle_ventas_tienda AS detalle
    JOIN public.productos_tienda AS producto ON producto.id = detalle.producto_id
    WHERE detalle.venta_id = NEW.venta_tienda_id;

    IF nullif(btrim(v_detalle), '') IS NOT NULL THEN
      NEW.concepto := left(
        CASE WHEN NEW.source = 'caja_reversal' OR NEW.original_movement_id IS NOT NULL THEN 'Reversión · ' ELSE '' END
        || 'Tienda: ' || v_detalle,
        500
      );
    END IF;
  ELSIF NEW.venta_restaurante_id IS NOT NULL THEN
    SELECT string_agg(
      format('%s x %s', detalle.cantidad, plato.nombre),
      ', ' ORDER BY detalle.creado_en, detalle.id
    )
    INTO v_detalle
    FROM public.ventas_restaurante_items AS detalle
    JOIN public.platos AS plato ON plato.id = detalle.plato_id
    WHERE detalle.venta_id = NEW.venta_restaurante_id;

    IF nullif(btrim(v_detalle), '') IS NOT NULL THEN
      NEW.concepto := left(
        CASE WHEN NEW.source = 'caja_reversal' OR NEW.original_movement_id IS NOT NULL THEN 'Reversión · ' ELSE '' END
        || 'Restaurante: ' || v_detalle,
        500
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS caja_concepto_venta_legible ON public.caja;
CREATE TRIGGER caja_concepto_venta_legible
BEFORE INSERT ON public.caja
FOR EACH ROW
WHEN (NEW.venta_tienda_id IS NOT NULL OR NEW.venta_restaurante_id IS NOT NULL)
EXECUTE FUNCTION public.asignar_concepto_venta_caja();

REVOKE ALL ON FUNCTION public.asignar_concepto_venta_caja() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asignar_concepto_venta_caja() FROM anon;
REVOKE ALL ON FUNCTION public.asignar_concepto_venta_caja() FROM authenticated;

COMMENT ON FUNCTION public.asignar_concepto_venta_caja() IS
  'Trigger interno: resume cantidades y nombres de productos o platos en el concepto de Caja.';
