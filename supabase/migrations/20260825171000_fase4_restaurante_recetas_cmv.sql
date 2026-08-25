-- Evita margenes ficticios en Restaurante cuando un plato no tiene receta.
ALTER TABLE public.cogs_entries ADD COLUMN IF NOT EXISTS cost_issue text;

CREATE OR REPLACE FUNCTION public.fase4_restaurant_sale_cogs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 v_sale public.ventas_restaurante%rowtype; v_plato public.platos%rowtype; v_recipe record;
 v_qty numeric; v_cost numeric; v_total numeric:=0; v_status text:='active'; v_recipe_count integer:=0;
BEGIN
 SELECT * INTO v_sale FROM public.ventas_restaurante WHERE id=NEW.venta_id;
 SELECT * INTO v_plato FROM public.platos WHERE id=NEW.plato_id;
 SELECT count(*) INTO v_recipe_count FROM public.platos_recetas
  WHERE plato_id=NEW.plato_id AND hotel_id=v_sale.hotel_id;
 IF v_recipe_count=0 THEN
   RAISE EXCEPTION 'El plato % no tiene receta. Configura sus ingredientes antes de venderlo.',v_plato.nombre USING ERRCODE='23514';
 END IF;
 FOR v_recipe IN
   SELECT pr.ingrediente_id,pr.cantidad,i.nombre,i.stock_actual
   FROM public.platos_recetas pr JOIN public.ingredientes i ON i.id=pr.ingrediente_id
   WHERE pr.plato_id=NEW.plato_id AND pr.hotel_id=v_sale.hotel_id AND i.hotel_id=v_sale.hotel_id
   FOR UPDATE OF i
 LOOP
   v_qty:=v_recipe.cantidad*NEW.cantidad;
   IF v_recipe.stock_actual<v_qty THEN RAISE EXCEPTION 'Stock insuficiente del ingrediente %',v_recipe.nombre USING ERRCODE='23514'; END IF;
   UPDATE public.ingredientes SET stock_actual=stock_actual-v_qty,actualizado_en=now() WHERE id=v_recipe.ingrediente_id;
   v_cost:=public.fase4_cost_out(v_sale.hotel_id,'restaurant',v_recipe.ingrediente_id,v_recipe.nombre,v_qty,'restaurant_sale','restaurant_item:'||NEW.id||':'||v_recipe.ingrediente_id,coalesce(v_sale.fecha,now()));
   v_total:=v_total+(v_qty*v_cost);
   IF (SELECT cost_status FROM public.inventory_cost_balances WHERE hotel_id=v_sale.hotel_id AND area='restaurant' AND item_id=v_recipe.ingrediente_id)<>'active' THEN v_status:='estimated'; END IF;
 END LOOP;
 INSERT INTO public.cogs_entries(hotel_id,area,source_document_id,source_item_id,item_id,item_name,quantity,unit_cost,total_cost,revenue,margin,cost_status,business_date,occurred_at,source_key,cost_issue)
 VALUES(v_sale.hotel_id,'restaurant',NEW.venta_id,NEW.id,NEW.plato_id,v_plato.nombre,NEW.cantidad,CASE WHEN NEW.cantidad=0 THEN 0 ELSE v_total/NEW.cantidad END,v_total,NEW.subtotal,NEW.subtotal-v_total,v_status,coalesce(v_sale.business_date,public.fase1_business_date(coalesce(v_sale.fecha,now()))),coalesce(v_sale.fecha,now()),'restaurant_sale_item:'||NEW.id,NULL);
 RETURN NEW;
END $$;

-- Identifica, sin inventar costos, los registros historicos afectados.
UPDATE public.cogs_entries c
SET cost_status='estimated',
    cost_issue=CASE
      WHEN NOT EXISTS(SELECT 1 FROM public.platos_recetas pr WHERE pr.plato_id=c.item_id AND pr.hotel_id=c.hotel_id) THEN 'missing_recipe'
      ELSE 'zero_ingredient_cost'
    END
WHERE c.area='restaurant' AND c.total_cost=0 AND c.cost_issue IS NULL;

CREATE OR REPLACE FUNCTION public.reprocesar_cmv_restaurante(p_cogs_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 v_actor public.usuarios%rowtype; v_entry public.cogs_entries%rowtype; v_recipe record;
 v_qty numeric; v_cost numeric; v_total numeric:=0; v_count integer:=0; v_status text:='active';
BEGIN
 SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo IS TRUE;
 SELECT * INTO v_entry FROM public.cogs_entries WHERE id=p_cogs_id FOR UPDATE;
 IF v_entry.id IS NULL OR v_entry.hotel_id IS DISTINCT FROM v_actor.hotel_id OR NOT public.fase1_actor_tiene_permiso(v_entry.hotel_id,'costeo.gestionar') THEN
   RAISE EXCEPTION 'Registro de costo no autorizado' USING ERRCODE='42501';
 END IF;
 IF v_entry.area<>'restaurant' OR v_entry.total_cost<>0 OR v_entry.cost_issue IS NULL THEN
   RAISE EXCEPTION 'El registro no requiere reproceso' USING ERRCODE='22023';
 END IF;
 FOR v_recipe IN
   SELECT pr.ingrediente_id,pr.cantidad,i.nombre,i.stock_actual
   FROM public.platos_recetas pr JOIN public.ingredientes i ON i.id=pr.ingrediente_id
   WHERE pr.plato_id=v_entry.item_id AND pr.hotel_id=v_entry.hotel_id AND i.hotel_id=v_entry.hotel_id
   FOR UPDATE OF i
 LOOP
   v_count:=v_count+1; v_qty:=v_recipe.cantidad*v_entry.quantity;
   IF v_recipe.stock_actual<v_qty THEN RAISE EXCEPTION 'Stock insuficiente del ingrediente % para recalcular',v_recipe.nombre USING ERRCODE='23514'; END IF;
   UPDATE public.ingredientes SET stock_actual=stock_actual-v_qty,actualizado_en=now() WHERE id=v_recipe.ingrediente_id;
   v_cost:=public.fase4_cost_out(v_entry.hotel_id,'restaurant',v_recipe.ingrediente_id,v_recipe.nombre,v_qty,'restaurant_sale_reprocess','restaurant_reprocess:'||v_entry.id||':'||v_recipe.ingrediente_id,v_entry.occurred_at);
   v_total:=v_total+(v_qty*v_cost);
   IF (SELECT cost_status FROM public.inventory_cost_balances WHERE hotel_id=v_entry.hotel_id AND area='restaurant' AND item_id=v_recipe.ingrediente_id)<>'active' THEN v_status:='estimated'; END IF;
 END LOOP;
 IF v_count=0 THEN RAISE EXCEPTION 'El plato sigue sin receta. Agrega sus ingredientes y cantidades primero.' USING ERRCODE='23514'; END IF;
 UPDATE public.cogs_entries SET unit_cost=v_total/v_entry.quantity,total_cost=v_total,margin=revenue-v_total,cost_status=v_status,cost_issue=NULL WHERE id=v_entry.id;
 RETURN jsonb_build_object('cogs_id',v_entry.id,'total_cost',v_total,'margin',v_entry.revenue-v_total,'ingredients',v_count);
END $$;

REVOKE ALL ON FUNCTION public.reprocesar_cmv_restaurante(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reprocesar_cmv_restaurante(uuid) TO authenticated,service_role;
