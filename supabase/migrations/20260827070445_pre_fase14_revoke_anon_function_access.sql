-- Las funciones SECURITY DEFINER tampoco se publican por defecto.
revoke execute on all functions in schema public from anon;
grant execute on function public.crear_pedido_web_tienda(uuid, text, text, text, text, jsonb) to anon;
grant execute on function public.obtener_catalogo_tienda_web(uuid) to anon;
grant execute on function public.obtener_menu_terraza_publico(uuid) to anon;
