-- Incorpora automaticamente al costeo los productos e ingredientes creados despues del corte inicial.
CREATE OR REPLACE FUNCTION public.fase4_seed_new_inventory_item() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_area text:=TG_ARGV[0]; v_cost numeric:=0;
BEGIN
 IF v_area='restaurant' THEN v_cost:=coalesce(NEW.costo_unitario,0);
 ELSIF v_area='terrace' AND NEW.tienda_producto_id IS NOT NULL THEN
   SELECT average_unit_cost INTO v_cost FROM public.inventory_cost_balances WHERE hotel_id=NEW.hotel_id AND area='store' AND item_id=NEW.tienda_producto_id;
   v_cost:=coalesce(v_cost,0);
 END IF;
 INSERT INTO public.inventory_cost_balances(hotel_id,area,item_id,item_name,quantity,inventory_value,average_unit_cost,cost_status)
 VALUES(NEW.hotel_id,v_area,NEW.id,NEW.nombre,NEW.stock_actual,NEW.stock_actual*v_cost,v_cost,CASE WHEN v_cost>0 THEN 'active' ELSE 'uninitialized' END)
 ON CONFLICT(hotel_id,area,item_id) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER fase4_seed_store_item AFTER INSERT ON public.productos_tienda FOR EACH ROW EXECUTE FUNCTION public.fase4_seed_new_inventory_item('store');
CREATE TRIGGER fase4_seed_terrace_item AFTER INSERT ON public.terraza_productos FOR EACH ROW EXECUTE FUNCTION public.fase4_seed_new_inventory_item('terrace');
CREATE TRIGGER fase4_seed_restaurant_item AFTER INSERT ON public.ingredientes FOR EACH ROW EXECUTE FUNCTION public.fase4_seed_new_inventory_item('restaurant');
