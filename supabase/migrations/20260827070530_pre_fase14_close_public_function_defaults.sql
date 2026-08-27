revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

-- Unica superficie RPC anonima intencional: catalogos y pedido web validados.
grant execute on function public.crear_pedido_web_tienda(uuid, text, text, text, text, jsonb) to anon;
grant execute on function public.obtener_catalogo_tienda_web(uuid) to anon;
grant execute on function public.obtener_menu_terraza_publico(uuid) to anon;

-- El RPC legacy inseguro permanece cerrado incluso para authenticated.
revoke execute on function public.crear_usuario_con_perfil_y_roles_basico(text, text, text, uuid, uuid[], boolean)
  from public, anon, authenticated;
