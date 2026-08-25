-- Gestion segura y atomica de recetas; las escrituras directas permanecen revocadas.
CREATE OR REPLACE FUNCTION public.guardar_receta_plato_atomica(p_plato_id uuid,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 v_actor public.usuarios%rowtype; v_plato public.platos%rowtype; v_item jsonb;
 v_ingrediente public.ingredientes%rowtype; v_cantidad numeric; v_count integer:=0; v_seen uuid[]:=ARRAY[]::uuid[]; v_next_id bigint;
BEGIN
 IF auth.uid() IS NULL OR p_plato_id IS NULL OR jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' THEN
   RAISE EXCEPTION 'Datos de receta invalidos' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_actor FROM public.usuarios WHERE id=auth.uid() AND activo IS TRUE;
 SELECT * INTO v_plato FROM public.platos WHERE id=p_plato_id FOR UPDATE;
 IF v_actor.id IS NULL OR v_plato.id IS NULL OR v_plato.hotel_id IS DISTINCT FROM v_actor.hotel_id OR NOT public.fase1_actor_tiene_permiso(v_plato.hotel_id,'inventario.ajustar') THEN
   RAISE EXCEPTION 'No autorizado para configurar recetas' USING ERRCODE='42501';
 END IF;
 IF v_plato.activo AND jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 THEN
   RAISE EXCEPTION 'Un plato activo debe tener al menos un ingrediente' USING ERRCODE='23514';
 END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) LOOP
   v_cantidad:=coalesce((v_item->>'cantidad')::numeric,0);
   SELECT * INTO v_ingrediente FROM public.ingredientes WHERE id=(v_item->>'ingrediente_id')::uuid;
   IF v_ingrediente.id IS NULL OR v_ingrediente.hotel_id IS DISTINCT FROM v_plato.hotel_id OR v_cantidad<=0 THEN
     RAISE EXCEPTION 'Ingrediente o cantidad invalida en la receta' USING ERRCODE='22023';
   END IF;
   IF v_ingrediente.id=ANY(v_seen) THEN RAISE EXCEPTION 'No repitas ingredientes en la receta' USING ERRCODE='22023'; END IF;
   v_seen:=array_append(v_seen,v_ingrediente.id);
 END LOOP;
 LOCK TABLE public.platos_recetas IN EXCLUSIVE MODE;
 DELETE FROM public.platos_recetas WHERE plato_id=v_plato.id AND hotel_id=v_plato.hotel_id;
 SELECT coalesce(max(id),0)+1 INTO v_next_id FROM public.platos_recetas;
 FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) LOOP
   INSERT INTO public.platos_recetas(id,plato_id,hotel_id,ingrediente_id,cantidad)
   VALUES(v_next_id,v_plato.id,v_plato.hotel_id,(v_item->>'ingrediente_id')::uuid,(v_item->>'cantidad')::numeric);
   v_count:=v_count+1; v_next_id:=v_next_id+1;
 END LOOP;
 INSERT INTO public.auditoria_operaciones(hotel_id,actor_id,accion,entidad,entity_id,after_data)
 VALUES(v_plato.hotel_id,auth.uid(),'restaurante.receta_guardar','platos',v_plato.id,jsonb_build_object('ingredientes',v_count));
 RETURN jsonb_build_object('plato_id',v_plato.id,'ingredientes',v_count);
END $$;

REVOKE ALL ON FUNCTION public.guardar_receta_plato_atomica(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.guardar_receta_plato_atomica(uuid,jsonb) TO authenticated,service_role;
