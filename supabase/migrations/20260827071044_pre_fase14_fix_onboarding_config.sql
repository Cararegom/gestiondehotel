drop policy if exists "configuracion_hotel_admin_insert" on public.configuracion_hotel;
create policy "configuracion_hotel_admin_insert" on public.configuracion_hotel for insert to authenticated
  with check (
    public.usuario_actual_es_admin_hotel(hotel_id)
    or public.pre_fase14_can_bootstrap_profile(auth.uid(), hotel_id, 'admin')
  );
