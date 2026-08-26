-- Representacion historica del grant de columna ya aplicado en produccion.
-- No concede UPDATE sobre monto, concepto, hotel, turno ni otras columnas.
GRANT UPDATE (metodo_pago_id) ON TABLE public.caja TO authenticated;
