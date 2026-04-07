ALTER TABLE public.hoteles
  ADD COLUMN IF NOT EXISTS suscripcion_inicio timestamp with time zone,
  ADD COLUMN IF NOT EXISTS plan_pendiente text,
  ADD COLUMN IF NOT EXISTS plan_pendiente_id integer,
  ADD COLUMN IF NOT EXISTS plan_pendiente_desde timestamp with time zone;

ALTER TABLE public.hoteles
  DROP CONSTRAINT IF EXISTS hoteles_plan_pendiente_id_fkey;

ALTER TABLE public.hoteles
  ADD CONSTRAINT hoteles_plan_pendiente_id_fkey
  FOREIGN KEY (plan_pendiente_id)
  REFERENCES public.planes(id)
  ON DELETE SET NULL;

ALTER TABLE public.pagos
  ADD COLUMN IF NOT EXISTS checkout_reference text,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS payment_type text,
  ADD COLUMN IF NOT EXISTS billing_period text,
  ADD COLUMN IF NOT EXISTS moneda text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_checkout_reference_unique
  ON public.pagos (checkout_reference)
  WHERE checkout_reference IS NOT NULL;
