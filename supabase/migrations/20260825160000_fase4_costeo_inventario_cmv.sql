-- Fase 4: costo promedio movil y CMV en modo shadow.
INSERT INTO public.permisos(nombre,descripcion)
SELECT v.nombre,v.descripcion FROM (VALUES
 ('costeo.ver','Consultar inventario valorizado y margen'),
 ('costeo.gestionar','Definir costos iniciales de inventario')
) v(nombre,descripcion) WHERE NOT EXISTS(SELECT 1 FROM public.permisos p WHERE p.nombre=v.nombre);

INSERT INTO public.roles_permisos(rol_id,permiso_id)
SELECT r.id,p.id FROM public.roles r JOIN public.permisos p ON p.nombre = ANY(CASE lower(r.nombre)
 WHEN 'administrador' THEN ARRAY['costeo.ver','costeo.gestionar']::text[]
 WHEN 'admin' THEN ARRAY['costeo.ver','costeo.gestionar']::text[]
 WHEN 'gerente' THEN ARRAY['costeo.ver','costeo.gestionar']::text[]
 WHEN 'propietario' THEN ARRAY['costeo.ver','costeo.gestionar']::text[]
 WHEN 'contabilidad' THEN ARRAY['costeo.ver']::text[] ELSE ARRAY[]::text[] END)
WHERE NOT EXISTS(SELECT 1 FROM public.roles_permisos rp WHERE rp.rol_id=r.id AND rp.permiso_id=p.id);

CREATE TABLE public.inventory_cost_balances(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE CASCADE,
 area text NOT NULL CHECK(area IN('store','terrace','restaurant')), item_id uuid NOT NULL, item_name text NOT NULL,
 quantity numeric NOT NULL DEFAULT 0 CHECK(quantity>=0), inventory_value numeric NOT NULL DEFAULT 0 CHECK(inventory_value>=0),
 average_unit_cost numeric NOT NULL DEFAULT 0 CHECK(average_unit_cost>=0),
 cost_status text NOT NULL DEFAULT 'uninitialized' CHECK(cost_status IN('uninitialized','active','estimated')),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(hotel_id,area,item_id)
);
CREATE TABLE public.inventory_valuation_movements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
 area text NOT NULL CHECK(area IN('store','terrace','restaurant')), item_id uuid NOT NULL, direction text NOT NULL CHECK(direction IN('in','out')),
 quantity numeric NOT NULL CHECK(quantity>0), unit_cost numeric NOT NULL CHECK(unit_cost>=0), total_cost numeric NOT NULL CHECK(total_cost>=0),
 source text NOT NULL, source_key text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(), business_date date NOT NULL,
 created_by uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(hotel_id,source_key)
);
CREATE TABLE public.cogs_entries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id uuid NOT NULL REFERENCES public.hoteles(id) ON DELETE RESTRICT,
 area text NOT NULL CHECK(area IN('store','terrace','restaurant')), source_document_id uuid NOT NULL, source_item_id uuid NOT NULL,
 item_id uuid NOT NULL, item_name text NOT NULL, quantity numeric NOT NULL CHECK(quantity>0), unit_cost numeric NOT NULL CHECK(unit_cost>=0),
 total_cost numeric NOT NULL CHECK(total_cost>=0), revenue numeric NOT NULL DEFAULT 0 CHECK(revenue>=0), margin numeric NOT NULL,
 cost_status text NOT NULL CHECK(cost_status IN('active','estimated')), business_date date NOT NULL, occurred_at timestamptz NOT NULL,
 source_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(hotel_id,source_key)
);

ALTER TABLE public.inventory_cost_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_valuation_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY fase4_cost_balances_select ON public.inventory_cost_balances FOR SELECT TO authenticated USING(public.fase1_actor_tiene_permiso(hotel_id,'costeo.ver'));
CREATE POLICY fase4_valuation_select ON public.inventory_valuation_movements FOR SELECT TO authenticated USING(public.fase1_actor_tiene_permiso(hotel_id,'costeo.ver'));
CREATE POLICY fase4_cogs_select ON public.cogs_entries FOR SELECT TO authenticated USING(public.fase1_actor_tiene_permiso(hotel_id,'costeo.ver'));
REVOKE ALL ON public.inventory_cost_balances,public.inventory_valuation_movements,public.cogs_entries FROM anon;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.inventory_cost_balances,public.inventory_valuation_movements,public.cogs_entries FROM authenticated;
GRANT SELECT ON public.inventory_cost_balances,public.inventory_valuation_movements,public.cogs_entries TO authenticated;

INSERT INTO public.inventory_cost_balances(hotel_id,area,item_id,item_name,quantity,inventory_value,average_unit_cost,cost_status)
SELECT hotel_id,'store',id,nombre,stock_actual,0,0,'uninitialized' FROM public.productos_tienda ON CONFLICT DO NOTHING;
INSERT INTO public.inventory_cost_balances(hotel_id,area,item_id,item_name,quantity,inventory_value,average_unit_cost,cost_status)
SELECT hotel_id,'terrace',id,nombre,stock_actual,0,0,'uninitialized' FROM public.terraza_productos ON CONFLICT DO NOTHING;
INSERT INTO public.inventory_cost_balances(hotel_id,area,item_id,item_name,quantity,inventory_value,average_unit_cost,cost_status)
SELECT hotel_id,'restaurant',id,nombre,stock_actual,stock_actual*coalesce(costo_unitario,0),coalesce(costo_unitario,0),CASE WHEN coalesce(costo_unitario,0)>0 THEN 'active' ELSE 'uninitialized' END FROM public.ingredientes ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.fase4_cost_in(p_hotel uuid,p_area text,p_item uuid,p_name text,p_qty numeric,p_unit numeric,p_source text,p_key text,p_at timestamptz)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v public.inventory_cost_balances%rowtype; v_value numeric; v_qty numeric; v_avg numeric;
BEGIN
 IF p_qty<=0 OR p_unit<0 THEN RAISE EXCEPTION 'Entrada de costo invalida'; END IF;
 SELECT * INTO v FROM public.inventory_cost_balances WHERE hotel_id=p_hotel AND area=p_area AND item_id=p_item FOR UPDATE;
 IF NOT FOUND THEN INSERT INTO public.inventory_cost_balances(hotel_id,area,item_id,item_name) VALUES(p_hotel,p_area,p_item,p_name) RETURNING * INTO v; END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_valuation_movements WHERE hotel_id=p_hotel AND source_key=p_key) THEN RETURN v.average_unit_cost; END IF;
 v_qty:=v.quantity+p_qty; v_value:=v.inventory_value+(p_qty*p_unit); v_avg:=CASE WHEN v_qty=0 THEN 0 ELSE v_value/v_qty END;
 UPDATE public.inventory_cost_balances SET item_name=p_name,quantity=v_qty,inventory_value=v_value,average_unit_cost=v_avg,cost_status=CASE WHEN p_unit>0 THEN 'active' ELSE cost_status END,updated_at=now() WHERE id=v.id;
 INSERT INTO public.inventory_valuation_movements(hotel_id,area,item_id,direction,quantity,unit_cost,total_cost,source,source_key,occurred_at,business_date,created_by)
 VALUES(p_hotel,p_area,p_item,'in',p_qty,p_unit,p_qty*p_unit,p_source,p_key,coalesce(p_at,now()),public.fase1_business_date(coalesce(p_at,now())),auth.uid());
 RETURN v_avg;
END $$;

CREATE OR REPLACE FUNCTION public.fase4_cost_out(p_hotel uuid,p_area text,p_item uuid,p_name text,p_qty numeric,p_source text,p_key text,p_at timestamptz)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v public.inventory_cost_balances%rowtype; v_cost numeric; v_total numeric; v_new_qty numeric; v_status text;
BEGIN
 IF p_qty<=0 THEN RAISE EXCEPTION 'Salida de costo invalida'; END IF;
 SELECT * INTO v FROM public.inventory_cost_balances WHERE hotel_id=p_hotel AND area=p_area AND item_id=p_item FOR UPDATE;
 IF NOT FOUND THEN INSERT INTO public.inventory_cost_balances(hotel_id,area,item_id,item_name) VALUES(p_hotel,p_area,p_item,p_name) RETURNING * INTO v; END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_valuation_movements WHERE hotel_id=p_hotel AND source_key=p_key) THEN RETURN v.average_unit_cost; END IF;
 v_cost:=v.average_unit_cost; v_total:=p_qty*v_cost; v_new_qty:=greatest(v.quantity-p_qty,0); v_status:=CASE WHEN v.cost_status='active' AND v.quantity>=p_qty THEN 'active' ELSE 'estimated' END;
 UPDATE public.inventory_cost_balances SET item_name=p_name,quantity=v_new_qty,inventory_value=greatest(v.inventory_value-v_total,0),cost_status=v_status,updated_at=now() WHERE id=v.id;
 INSERT INTO public.inventory_valuation_movements(hotel_id,area,item_id,direction,quantity,unit_cost,total_cost,source,source_key,occurred_at,business_date,created_by)
 VALUES(p_hotel,p_area,p_item,'out',p_qty,v_cost,v_total,p_source,p_key,coalesce(p_at,now()),public.fase1_business_date(coalesce(p_at,now())),auth.uid());
 RETURN v_cost;
END $$;

CREATE OR REPLACE FUNCTION public.establecer_costo_inicial_inventario(p_area text,p_item_id uuid,p_unit_cost numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.usuarios%rowtype; v public.inventory_cost_balances%rowtype;
BEGIN
 SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo IS TRUE;
 SELECT * INTO v FROM public.inventory_cost_balances WHERE hotel_id=v_actor.hotel_id AND area=p_area AND item_id=p_item_id FOR UPDATE;
 IF v.id IS NULL OR NOT public.fase1_actor_tiene_permiso(v.hotel_id,'costeo.gestionar') THEN RAISE EXCEPTION 'Inventario no autorizado' USING ERRCODE='42501'; END IF;
 IF p_unit_cost IS NULL OR p_unit_cost<0 THEN RAISE EXCEPTION 'Costo unitario invalido' USING ERRCODE='22023'; END IF;
 UPDATE public.inventory_cost_balances SET average_unit_cost=p_unit_cost,inventory_value=quantity*p_unit_cost,cost_status='active',updated_at=now() WHERE id=v.id;
 RETURN jsonb_build_object('item_id',v.item_id,'quantity',v.quantity,'average_unit_cost',p_unit_cost,'inventory_value',v.quantity*p_unit_cost);
END $$;

CREATE OR REPLACE FUNCTION public.fase4_store_purchase_cost() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_product public.productos_tienda%rowtype; v_delta numeric;
BEGIN
 v_delta:=coalesce(NEW.recibido,0)-coalesce(OLD.recibido,0); IF v_delta<=0 THEN RETURN NEW; END IF;
 SELECT * INTO v_product FROM public.productos_tienda WHERE id=NEW.producto_id;
 PERFORM public.fase4_cost_in(NEW.hotel_id,'store',NEW.producto_id,v_product.nombre,v_delta,coalesce(NEW.precio_unitario,0),'purchase_receipt','purchase_detail:'||NEW.id||':'||NEW.recibido,now());
 RETURN NEW;
END $$;
CREATE TRIGGER fase4_store_purchase_cost AFTER UPDATE OF recibido ON public.detalle_compras_tienda FOR EACH ROW EXECUTE FUNCTION public.fase4_store_purchase_cost();

CREATE OR REPLACE FUNCTION public.fase4_store_sale_cogs() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_product public.productos_tienda%rowtype; v_sale public.ventas_tienda%rowtype; v_cost numeric; v_status text;
BEGIN
 SELECT * INTO v_product FROM public.productos_tienda WHERE id=NEW.producto_id; SELECT * INTO v_sale FROM public.ventas_tienda WHERE id=NEW.venta_id;
 v_cost:=public.fase4_cost_out(NEW.hotel_id,'store',NEW.producto_id,v_product.nombre,NEW.cantidad,'store_sale','store_sale_item:'||NEW.id,coalesce(v_sale.fecha,now()));
 SELECT CASE WHEN cost_status='active' THEN 'active' ELSE 'estimated' END INTO v_status FROM public.inventory_cost_balances WHERE hotel_id=NEW.hotel_id AND area='store' AND item_id=NEW.producto_id;
 INSERT INTO public.cogs_entries(hotel_id,area,source_document_id,source_item_id,item_id,item_name,quantity,unit_cost,total_cost,revenue,margin,cost_status,business_date,occurred_at,source_key)
 VALUES(NEW.hotel_id,'store',NEW.venta_id,NEW.id,NEW.producto_id,v_product.nombre,NEW.cantidad,v_cost,v_cost*NEW.cantidad,NEW.subtotal,NEW.subtotal-(v_cost*NEW.cantidad),v_status,coalesce(v_sale.business_date,public.fase1_business_date(coalesce(v_sale.fecha,now()))),coalesce(v_sale.fecha,now()),'store_sale_item:'||NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER fase4_store_sale_cogs AFTER INSERT ON public.detalle_ventas_tienda FOR EACH ROW EXECUTE FUNCTION public.fase4_store_sale_cogs();

CREATE OR REPLACE FUNCTION public.fase4_restaurant_sale_cogs() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_sale public.ventas_restaurante%rowtype; v_plato public.platos%rowtype; v_recipe record; v_qty numeric; v_cost numeric; v_total numeric:=0; v_status text:='active';
BEGIN
 SELECT * INTO v_sale FROM public.ventas_restaurante WHERE id=NEW.venta_id; SELECT * INTO v_plato FROM public.platos WHERE id=NEW.plato_id;
 FOR v_recipe IN SELECT pr.ingrediente_id,pr.cantidad,i.nombre,i.stock_actual FROM public.platos_recetas pr JOIN public.ingredientes i ON i.id=pr.ingrediente_id WHERE pr.plato_id=NEW.plato_id FOR UPDATE OF i LOOP
   v_qty:=v_recipe.cantidad*NEW.cantidad; IF v_recipe.stock_actual<v_qty THEN RAISE EXCEPTION 'Stock insuficiente del ingrediente %',v_recipe.nombre USING ERRCODE='23514'; END IF;
   UPDATE public.ingredientes SET stock_actual=stock_actual-v_qty,actualizado_en=now() WHERE id=v_recipe.ingrediente_id;
   v_cost:=public.fase4_cost_out(v_sale.hotel_id,'restaurant',v_recipe.ingrediente_id,v_recipe.nombre,v_qty,'restaurant_sale','restaurant_item:'||NEW.id||':'||v_recipe.ingrediente_id,coalesce(v_sale.fecha,now())); v_total:=v_total+(v_qty*v_cost);
   IF (SELECT cost_status FROM public.inventory_cost_balances WHERE hotel_id=v_sale.hotel_id AND area='restaurant' AND item_id=v_recipe.ingrediente_id)<>'active' THEN v_status:='estimated'; END IF;
 END LOOP;
 INSERT INTO public.cogs_entries(hotel_id,area,source_document_id,source_item_id,item_id,item_name,quantity,unit_cost,total_cost,revenue,margin,cost_status,business_date,occurred_at,source_key)
 VALUES(v_sale.hotel_id,'restaurant',NEW.venta_id,NEW.id,NEW.plato_id,v_plato.nombre,NEW.cantidad,CASE WHEN NEW.cantidad=0 THEN 0 ELSE v_total/NEW.cantidad END,v_total,NEW.subtotal,NEW.subtotal-v_total,v_status,coalesce(v_sale.business_date,public.fase1_business_date(coalesce(v_sale.fecha,now()))),coalesce(v_sale.fecha,now()),'restaurant_sale_item:'||NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER fase4_restaurant_sale_cogs AFTER INSERT ON public.ventas_restaurante_items FOR EACH ROW EXECUTE FUNCTION public.fase4_restaurant_sale_cogs();

CREATE OR REPLACE FUNCTION public.fase4_terrace_sale_cogs() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_item record; v_cost numeric; v_status text;
BEGIN
 IF OLD.estado IS DISTINCT FROM 'pagado' AND NEW.estado='pagado' THEN
  FOR v_item IN SELECT i.*,p.nombre FROM public.terraza_pedido_items i JOIN public.terraza_productos p ON p.id=i.producto_id WHERE i.pedido_id=NEW.id AND i.producto_id IS NOT NULL LOOP
   v_cost:=public.fase4_cost_out(NEW.hotel_id,'terrace',v_item.producto_id,v_item.nombre,v_item.cantidad,'terrace_sale','terrace_sale_item:'||v_item.id,coalesce(NEW.fecha_cierre,now()));
   SELECT CASE WHEN cost_status='active' THEN 'active' ELSE 'estimated' END INTO v_status FROM public.inventory_cost_balances WHERE hotel_id=NEW.hotel_id AND area='terrace' AND item_id=v_item.producto_id;
   INSERT INTO public.cogs_entries(hotel_id,area,source_document_id,source_item_id,item_id,item_name,quantity,unit_cost,total_cost,revenue,margin,cost_status,business_date,occurred_at,source_key)
   VALUES(NEW.hotel_id,'terrace',NEW.id,v_item.id,v_item.producto_id,v_item.nombre,v_item.cantidad,v_cost,v_cost*v_item.cantidad,v_item.subtotal,v_item.subtotal-(v_cost*v_item.cantidad),v_status,public.fase1_business_date(coalesce(NEW.fecha_cierre,now())),coalesce(NEW.fecha_cierre,now()),'terrace_sale_item:'||v_item.id);
  END LOOP;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER fase4_terrace_sale_cogs AFTER UPDATE OF estado ON public.terraza_pedidos FOR EACH ROW EXECUTE FUNCTION public.fase4_terrace_sale_cogs();

CREATE OR REPLACE FUNCTION public.fase4_transfer_cost() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_store uuid; v_terrace uuid; v_qty numeric; v_store_name text; v_terrace_name text; v_cost numeric; v_store_physical numeric; v_terrace_physical numeric; v_store_tracked numeric; v_terrace_tracked numeric;
BEGIN
 IF NEW.accion NOT IN('Transferencia Tienda a Terraza','Transferencia Terraza a Tienda') THEN RETURN NEW; END IF;
 v_store:=(NEW.detalles->>'producto_tienda_id')::uuid; v_terrace:=(NEW.detalles->>'producto_terraza_id')::uuid; v_qty:=(NEW.detalles->>'cantidad')::numeric;
 SELECT nombre,stock_actual INTO v_store_name,v_store_physical FROM public.productos_tienda WHERE id=v_store AND hotel_id=NEW.hotel_id;
 SELECT nombre,stock_actual INTO v_terrace_name,v_terrace_physical FROM public.terraza_productos WHERE id=v_terrace AND hotel_id=NEW.hotel_id;
 SELECT quantity INTO v_store_tracked FROM public.inventory_cost_balances WHERE hotel_id=NEW.hotel_id AND area='store' AND item_id=v_store;
 SELECT quantity INTO v_terrace_tracked FROM public.inventory_cost_balances WHERE hotel_id=NEW.hotel_id AND area='terrace' AND item_id=v_terrace;
 IF v_qty<=0 OR v_store_name IS NULL OR v_terrace_name IS NULL THEN RAISE EXCEPTION 'Transferencia sin datos de costo validos'; END IF;
 IF NEW.accion='Transferencia Tienda a Terraza' THEN
   IF coalesce(v_store_tracked,0)-v_store_physical<v_qty OR v_terrace_physical-coalesce(v_terrace_tracked,0)<v_qty THEN RAISE EXCEPTION 'La transferencia fisica no coincide con su bitacora'; END IF;
   v_cost:=public.fase4_cost_out(NEW.hotel_id,'store',v_store,v_store_name,v_qty,'inventory_transfer','transfer_store_out:'||NEW.id,NEW.creado_en);
   PERFORM public.fase4_cost_in(NEW.hotel_id,'terrace',v_terrace,v_terrace_name,v_qty,v_cost,'inventory_transfer','transfer_terrace_in:'||NEW.id,NEW.creado_en);
 ELSE
   IF coalesce(v_terrace_tracked,0)-v_terrace_physical<v_qty OR v_store_physical-coalesce(v_store_tracked,0)<v_qty THEN RAISE EXCEPTION 'La devolucion fisica no coincide con su bitacora'; END IF;
   v_cost:=public.fase4_cost_out(NEW.hotel_id,'terrace',v_terrace,v_terrace_name,v_qty,'inventory_transfer','transfer_terrace_out:'||NEW.id,NEW.creado_en);
   PERFORM public.fase4_cost_in(NEW.hotel_id,'store',v_store,v_store_name,v_qty,v_cost,'inventory_transfer','transfer_store_in:'||NEW.id,NEW.creado_en);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fase4_transfer_cost AFTER INSERT ON public.bitacora FOR EACH ROW EXECUTE FUNCTION public.fase4_transfer_cost();

REVOKE ALL ON FUNCTION public.fase4_cost_in(uuid,text,uuid,text,numeric,numeric,text,text,timestamptz),public.fase4_cost_out(uuid,text,uuid,text,numeric,text,text,timestamptz),public.establecer_costo_inicial_inventario(text,uuid,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.establecer_costo_inicial_inventario(text,uuid,numeric) TO authenticated,service_role;
