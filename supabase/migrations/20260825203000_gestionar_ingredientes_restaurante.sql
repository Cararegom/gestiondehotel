-- Escritura autorizada de ingredientes y sincronizacion de su costo valorizado.
CREATE OR REPLACE FUNCTION public.gestionar_ingrediente_restaurante(
  p_ingrediente_id uuid, p_nombre text, p_unidad_medida text,
  p_stock_actual numeric, p_stock_minimo numeric, p_costo_unitario numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
  v_before public.ingredientes%rowtype;
  v_after public.ingredientes%rowtype;
  v_unit text:=lower(btrim(coalesce(p_unidad_medida,'')));
BEGIN
  SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR NOT public.fase1_actor_tiene_permiso(v_actor.hotel_id,'inventario.ajustar') THEN
    RAISE EXCEPTION 'No autorizado para gestionar ingredientes' USING ERRCODE='42501';
  END IF;
  IF btrim(coalesce(p_nombre,''))='' OR v_unit NOT IN ('unidad','gr','kg','ml','lt','oz','lb','porcion') THEN
    RAISE EXCEPTION 'Nombre o unidad de medida invalida' USING ERRCODE='22023';
  END IF;
  IF p_stock_actual IS NULL OR p_stock_actual<0 OR p_stock_minimo IS NULL OR p_stock_minimo<0 OR p_costo_unitario IS NULL OR p_costo_unitario<0 THEN
    RAISE EXCEPTION 'Stock y costo deben ser valores iguales o mayores que cero' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.ingredientes i WHERE i.hotel_id=v_actor.hotel_id
    AND lower(btrim(i.nombre))=lower(btrim(p_nombre)) AND (p_ingrediente_id IS NULL OR i.id<>p_ingrediente_id)) THEN
    RAISE EXCEPTION 'Ya existe un ingrediente con ese nombre' USING ERRCODE='23505';
  END IF;
  IF p_ingrediente_id IS NULL THEN
    INSERT INTO public.ingredientes(hotel_id,nombre,unidad_medida,stock_actual,stock_minimo,costo_unitario)
    VALUES(v_actor.hotel_id,btrim(p_nombre),v_unit,p_stock_actual,p_stock_minimo,p_costo_unitario)
    RETURNING * INTO v_after;
  ELSE
    SELECT * INTO v_before FROM public.ingredientes WHERE id=p_ingrediente_id FOR UPDATE;
    IF NOT FOUND OR v_before.hotel_id IS DISTINCT FROM v_actor.hotel_id THEN
      RAISE EXCEPTION 'Ingrediente no encontrado o fuera del hotel' USING ERRCODE='42501';
    END IF;
    IF v_before.unidad_medida IS DISTINCT FROM v_unit AND EXISTS(
      SELECT 1 FROM public.platos_recetas pr WHERE pr.hotel_id=v_before.hotel_id AND pr.ingrediente_id=v_before.id
    ) THEN
      RAISE EXCEPTION 'No puedes cambiar la unidad mientras el ingrediente forme parte de una receta. Retiralo de la receta, cambia la unidad y vuelve a agregarlo.' USING ERRCODE='23514';
    END IF;
    UPDATE public.ingredientes SET nombre=btrim(p_nombre),unidad_medida=v_unit,stock_actual=p_stock_actual,
      stock_minimo=p_stock_minimo,costo_unitario=p_costo_unitario,actualizado_en=now()
    WHERE id=v_before.id RETURNING * INTO v_after;
  END IF;
  INSERT INTO public.inventory_cost_balances(hotel_id,area,item_id,item_name,quantity,inventory_value,average_unit_cost,cost_status,updated_at)
  VALUES(v_after.hotel_id,'restaurant',v_after.id,v_after.nombre,v_after.stock_actual,
    v_after.stock_actual*v_after.costo_unitario,v_after.costo_unitario,
    CASE WHEN v_after.costo_unitario>0 THEN 'active' ELSE 'uninitialized' END,now())
  ON CONFLICT(hotel_id,area,item_id) DO UPDATE SET item_name=excluded.item_name,quantity=excluded.quantity,
    inventory_value=excluded.inventory_value,average_unit_cost=excluded.average_unit_cost,
    cost_status=excluded.cost_status,updated_at=now();
  INSERT INTO public.auditoria_operaciones(hotel_id,actor_id,accion,entidad,entity_id,before_data,after_data,reason)
  VALUES(v_after.hotel_id,auth.uid(),CASE WHEN p_ingrediente_id IS NULL THEN 'restaurante.ingrediente_crear' ELSE 'restaurante.ingrediente_editar' END,
    'ingredientes',v_after.id,CASE WHEN p_ingrediente_id IS NULL THEN NULL ELSE to_jsonb(v_before) END,to_jsonb(v_after),
    CASE WHEN p_ingrediente_id IS NOT NULL AND v_before.unidad_medida IS DISTINCT FROM v_after.unidad_medida
      THEN 'Cambio de unidad con equivalencia de stock informada por el usuario' ELSE 'Gestion de ficha y costo unitario' END);
  RETURN jsonb_build_object('ingrediente',to_jsonb(v_after),'average_unit_cost',v_after.costo_unitario,
    'inventory_value',v_after.stock_actual*v_after.costo_unitario);
END;
$function$;

REVOKE ALL ON FUNCTION public.gestionar_ingrediente_restaurante(uuid,text,text,numeric,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gestionar_ingrediente_restaurante(uuid,text,text,numeric,numeric,numeric) TO authenticated,service_role;
