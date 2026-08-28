-- Indices de soporte para FKs, lectura de distribuciones y futuras validaciones
-- de doble conciliacion. Se separan porque la migracion principal ya fue aplicada.

CREATE INDEX IF NOT EXISTS bank_payment_allocations_payment_event_idx
  ON public.bank_payment_allocations(payment_event_id);

CREATE INDEX IF NOT EXISTS bank_payment_allocations_reservation_idx
  ON public.bank_payment_allocations(reservation_id)
  WHERE reservation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bank_payment_allocations_room_idx
  ON public.bank_payment_allocations(room_id)
  WHERE room_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bank_payment_allocations_sale_idx
  ON public.bank_payment_allocations(sale_type, sale_id)
  WHERE sale_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bank_payment_allocations_created_by_idx
  ON public.bank_payment_allocations(created_by);

CREATE INDEX IF NOT EXISTS bank_payment_audit_log_user_idx
  ON public.bank_payment_audit_log(user_id)
  WHERE user_id IS NOT NULL;
