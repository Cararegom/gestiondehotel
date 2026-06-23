-- El menu publico de Terraza debe mostrar todos los productos activos, no solo cervezas.

CREATE OR REPLACE FUNCTION public.obtener_menu_terraza_publico(p_hotel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hotel public.hoteles%rowtype;
  v_config public.configuracion_hotel%rowtype;
  v_terraza_config public.terraza_configuracion%rowtype;
  v_productos jsonb;
BEGIN
  SELECT * INTO v_hotel
    FROM public.hoteles
   WHERE id = p_hotel_id
     AND COALESCE(activo, true) = true
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hotel no disponible.';
  END IF;

  SELECT * INTO v_config
    FROM public.configuracion_hotel
   WHERE hotel_id = p_hotel_id
   LIMIT 1;

  SELECT * INTO v_terraza_config
    FROM public.terraza_configuracion
   WHERE hotel_id = p_hotel_id
   LIMIT 1;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'nombre', p.nombre,
      'descripcion', p.descripcion,
      'categoria', COALESCE(p.categoria, 'Terraza'),
      'precio', COALESCE(p.precio, 0),
      'imagen_url', p.imagen_url,
      'permite_michelada', COALESCE(p.permite_michelada, false),
      'disponible', COALESCE(p.stock_actual, 0) > 0
    )
    ORDER BY COALESCE(p.categoria, 'Terraza'), p.nombre
  ), '[]'::jsonb)
    INTO v_productos
    FROM public.terraza_productos p
   WHERE p.hotel_id = p_hotel_id
     AND COALESCE(p.activo, true) = true
     AND COALESCE(p.precio, 0) > 0;

  RETURN jsonb_build_object(
    'activo', true,
    'hotel', jsonb_build_object(
      'id', v_hotel.id,
      'nombre', COALESCE(v_config.nombre_hotel, v_hotel.nombre),
      'logo_url', COALESCE(v_config.logo_url, v_hotel.logo_url),
      'direccion', COALESCE(v_config.direccion_fiscal, v_hotel.direccion)
    ),
    'precio_michelada', COALESCE(v_terraza_config.precio_michelada, 0),
    'productos', v_productos
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.obtener_menu_terraza_publico(uuid) TO anon, authenticated;
