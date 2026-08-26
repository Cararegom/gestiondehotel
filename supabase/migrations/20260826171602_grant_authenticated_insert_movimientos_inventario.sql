-- Snapshot historico de una migracion aplicada previamente en produccion.
-- No volver a ejecutar solo para sincronizar el repositorio.

GRANT INSERT ON TABLE public.movimientos_inventario TO authenticated;
