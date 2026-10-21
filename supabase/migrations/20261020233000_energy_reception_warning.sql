-- Aviso visual configurable a recepción por control de energía sin completar.
-- No altera el plazo de vencimiento ni el histórico de verificaciones.
ALTER TABLE public.configuracion_hotel
  ADD COLUMN IF NOT EXISTS energy_reception_warning_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS energy_reception_warning_minutes integer NOT NULL DEFAULT 5;

ALTER TABLE public.configuracion_hotel
  DROP CONSTRAINT IF EXISTS configuracion_hotel_energy_reception_warning_minutes_check;
ALTER TABLE public.configuracion_hotel
  ADD CONSTRAINT configuracion_hotel_energy_reception_warning_minutes_check
  CHECK (energy_reception_warning_minutes BETWEEN 1 AND 1440);

COMMENT ON COLUMN public.configuracion_hotel.energy_reception_warning_enabled
  IS 'Activa el recordatorio visual a recepcionistas con sesión abierta, sin correo adicional.';
COMMENT ON COLUMN public.configuracion_hotel.energy_reception_warning_minutes
  IS 'Minutos transcurridos desde la creación de la verificación pendiente para mostrar el recordatorio visual.';

-- Habilitar inicialmente solo el Hotel OK (Marena San Isidro).
UPDATE public.configuracion_hotel
SET energy_reception_warning_enabled = true,
    energy_reception_warning_minutes = 5,
    actualizado_en = now()
WHERE hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid;
