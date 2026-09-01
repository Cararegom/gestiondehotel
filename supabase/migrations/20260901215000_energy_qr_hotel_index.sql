-- Índice de soporte para la FK y búsquedas por hotel en secretos QR privados.
create index if not exists room_energy_qr_secrets_hotel_id_idx
  on private.room_energy_qr_secrets(hotel_id);
