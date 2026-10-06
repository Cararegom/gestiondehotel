-- Recuperada de produccion (supabase_migrations.schema_migrations, version
-- 20260902235818): se aplico directamente en la base sin archivo en el repo.
create index if not exists idx_clientes_hotel_id on public.clientes(hotel_id);
