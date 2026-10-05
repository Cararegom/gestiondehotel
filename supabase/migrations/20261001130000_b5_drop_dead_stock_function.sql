-- B5: retirar la funcion obsoleta que apuntaba al modelo antiguo de recetas.
-- Los flujos vigentes de restaurante e inventario no la invocan.

drop function if exists public.descontar_stock_por_venta(bigint, uuid, integer);
