-- Extiende el costeo shadow a ajustes manuales de Tienda y Restaurante.
CREATE OR REPLACE FUNCTION public.fase4_inventory_adjustment_cost() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_delta numeric; v_name text; v_unit numeric;
BEGIN
 v_delta:=coalesce(NEW.stock_nuevo,0)-coalesce(NEW.stock_anterior,0); IF v_delta=0 THEN RETURN NEW; END IF;
 IF NEW.producto_id IS NOT NULL AND coalesce(NEW.razon,'') NOT IN('venta_tienda_atomica','Recepción de compra') AND NEW.tipo_movimiento<>'ingreso_compra' THEN
   SELECT nombre INTO v_name FROM public.productos_tienda WHERE id=NEW.producto_id;
   SELECT average_unit_cost INTO v_unit FROM public.inventory_cost_balances WHERE hotel_id=NEW.hotel_id AND area='store' AND item_id=NEW.producto_id;
   IF v_delta>0 THEN PERFORM public.fase4_cost_in(NEW.hotel_id,'store',NEW.producto_id,v_name,v_delta,coalesce(v_unit,0),'inventory_adjustment','store_adjustment:'||NEW.id,NEW.creado_en);
   ELSE PERFORM public.fase4_cost_out(NEW.hotel_id,'store',NEW.producto_id,v_name,abs(v_delta),'inventory_adjustment','store_adjustment:'||NEW.id,NEW.creado_en); END IF;
 ELSIF NEW.ingrediente_id IS NOT NULL AND NEW.tipo_movimiento<>'venta_plato' THEN
   SELECT nombre,costo_unitario INTO v_name,v_unit FROM public.ingredientes WHERE id=NEW.ingrediente_id;
   IF v_delta>0 THEN PERFORM public.fase4_cost_in(NEW.hotel_id,'restaurant',NEW.ingrediente_id,v_name,v_delta,coalesce(v_unit,0),'inventory_adjustment','restaurant_adjustment:'||NEW.id,NEW.creado_en);
   ELSE PERFORM public.fase4_cost_out(NEW.hotel_id,'restaurant',NEW.ingrediente_id,v_name,abs(v_delta),'inventory_adjustment','restaurant_adjustment:'||NEW.id,NEW.creado_en); END IF;
 END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fase4_inventory_adjustment_cost ON public.movimientos_inventario;
CREATE TRIGGER fase4_inventory_adjustment_cost AFTER INSERT ON public.movimientos_inventario FOR EACH ROW EXECUTE FUNCTION public.fase4_inventory_adjustment_cost();
