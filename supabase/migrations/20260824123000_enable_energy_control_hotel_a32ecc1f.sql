-- Habilita Control de Energia para el establecimiento solicitado.
-- La insercion es idempotente y conserva el resto de su configuracion.
INSERT INTO public.configuracion_hotel (
  hotel_id,
  energy_control_enabled
)
VALUES (
  'a32ecc1f-9821-4448-8d36-8463bf542149'::uuid,
  true
)
ON CONFLICT (hotel_id) DO UPDATE
SET energy_control_enabled = EXCLUDED.energy_control_enabled,
    actualizado_en = now();
