-- Usa el precio de compra de la ficha como costo inicial de Tienda.
-- Cuando ya existen recepciones valorizadas, prevalece el promedio movil.
CREATE OR REPLACE FUNCTION public.fase4_seed_new_inventory_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_area text:=TG_ARGV[0]; v_cost numeric:=0;
BEGIN
 IF v_area='store' THEN v_cost:=coalesce(NEW.precio,0);
 ELSIF v_area='restaurant' THEN v_cost:=coalesce(NEW.costo_unitario,0);
 ELSIF v_area='terrace' AND NEW.tienda_producto_id IS NOT NULL THEN
   SELECT average_unit_cost INTO v_cost FROM public.inventory_cost_balances WHERE hotel_id=NEW.hotel_id AND area='store' AND item_id=NEW.tienda_producto_id;
   v_cost:=coalesce(v_cost,0);
 END IF;
 INSERT INTO public.inventory_cost_balances(hotel_id,area,item_id,item_name,quantity,inventory_value,average_unit_cost,cost_status)
 VALUES(NEW.hotel_id,v_area,NEW.id,NEW.nombre,NEW.stock_actual,NEW.stock_actual*v_cost,v_cost,CASE WHEN v_cost>0 THEN 'active' ELSE 'uninitialized' END)
 ON CONFLICT(hotel_id,area,item_id) DO NOTHING;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fase4_sync_store_reference_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 -- La ficha manda hasta la primera compra recibida; despues manda el promedio movil.
 IF coalesce(NEW.precio,0)>0 AND NOT EXISTS(
   SELECT 1 FROM public.inventory_valuation_movements m
   WHERE m.hotel_id=NEW.hotel_id AND m.area='store' AND m.item_id=NEW.id AND m.source='purchase_receipt'
 ) THEN
   UPDATE public.inventory_cost_balances
   SET item_name=NEW.nombre,quantity=NEW.stock_actual,average_unit_cost=NEW.precio,
       inventory_value=NEW.stock_actual*NEW.precio,cost_status='active',updated_at=now()
   WHERE hotel_id=NEW.hotel_id AND area='store' AND item_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fase4_sync_store_reference_cost ON public.productos_tienda;
CREATE TRIGGER fase4_sync_store_reference_cost AFTER UPDATE OF precio,nombre ON public.productos_tienda
FOR EACH ROW EXECUTE FUNCTION public.fase4_sync_store_reference_cost();

-- Repara productos existentes que aun no tienen compras recibidas valorizadas.
UPDATE public.inventory_cost_balances b
SET item_name=p.nombre,quantity=p.stock_actual,average_unit_cost=p.precio,
    inventory_value=p.stock_actual*p.precio,cost_status='active',updated_at=now()
FROM public.productos_tienda p
WHERE b.hotel_id=p.hotel_id AND b.area='store' AND b.item_id=p.id AND coalesce(p.precio,0)>0
  AND NOT EXISTS(
    SELECT 1 FROM public.inventory_valuation_movements m
    WHERE m.hotel_id=b.hotel_id AND m.area='store' AND m.item_id=b.item_id AND m.source='purchase_receipt'
  );
