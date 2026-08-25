-- Fase 1 / 10: retirar caminos legacy DESPUES de activar callers y pasar pruebas.
-- Dependencias: migraciones 01-09 y frontend Fase 1.
-- Riesgo alto: no aplicar antes del cutover validado.
-- Rollback logico: volver a conceder solo permisos concretos y restaurar funciones desde version anterior.
-- Tests: suite completa y smoke tests de todos los modulos.

REVOKE ALL ON FUNCTION public.increment(text,text,uuid,integer) FROM PUBLIC,anon,authenticated;
DROP FUNCTION IF EXISTS public.increment(text,text,uuid,integer);

REVOKE ALL ON FUNCTION public.registrar_y_eliminar_mov_caja(uuid,uuid) FROM PUBLIC,anon,authenticated;
DROP FUNCTION IF EXISTS public.registrar_y_eliminar_mov_caja(uuid,uuid);

REVOKE ALL ON FUNCTION public.cerrar_turno_con_balance(uuid,uuid,numeric,timestamptz) FROM PUBLIC,anon,authenticated;

REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.caja,public.pagos_reserva,public.detalle_ventas_tienda,public.ventas_restaurante_items,public.movimientos_inventario,public.bitacora,public.log_caja_eliminados,public.caja_movimientos_eliminados,public.pagos_cargos,public.auditoria_operaciones,public.caja_reversiones,public.turno_arqueos FROM anon,authenticated;
REVOKE ALL ON public.ventas_tienda,public.productos_tienda,public.proveedores,public.ventas_restaurante,public.ingredientes,public.platos,public.platos_recetas FROM anon;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.ventas_tienda,public.ventas_restaurante FROM authenticated;
REVOKE DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.productos_tienda,public.proveedores,public.ingredientes,public.platos,public.platos_recetas FROM authenticated;

-- Lecturas operativas siguen sujetas a RLS; escrituras financieras nuevas pasan por RPC.
GRANT SELECT ON public.caja,public.pagos_reserva,public.ventas_tienda,public.detalle_ventas_tienda,public.productos_tienda,public.proveedores,public.ventas_restaurante,public.ventas_restaurante_items,public.ingredientes,public.platos,public.platos_recetas,public.movimientos_inventario,public.turnos,public.turno_arqueos TO authenticated;
