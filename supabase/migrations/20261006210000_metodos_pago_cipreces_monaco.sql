-- Configuracion de metodos de pago (decidido por el dueno del SaaS):
--   * CIPRECES no tenia ningun metodo de pago, por lo que no podia abrir ni cerrar
--     turnos (M5 exige Efectivo y al menos un metodo en el arqueo): se crea Efectivo.
--   * MONACO'S tenia un metodo llamado "NEQUI, EFECTIVO" ademas de "Efectivo":
--     se renombra a "Nequi" para que no se confunda con efectivo. Conserva su id,
--     su cuenta financiera y su movimiento historico.
-- Ambos cambios quedan en auditoria_operaciones a nombre del creador del hotel.

begin;

do $config$
declare
  c_cipreces constant uuid := 'e86ca698-1102-45ed-ba40-854278171132';
  c_monaco constant uuid := '2bc1985c-48ad-4e7b-a01a-266627b22a36';
  c_monaco_metodo constant uuid := 'ab736f76-ecd9-453a-ae0d-4c35bc96995e';
  v_actor uuid;
  v_metodo uuid;
begin
  -- CIPRECES: Efectivo
  if not exists (
    select 1 from public.metodos_pago
     where hotel_id = c_cipreces and lower(btrim(nombre)) = 'efectivo'
  ) then
    select h.creado_por into v_actor
      from public.hoteles h
      join public.usuarios u on u.id = h.creado_por
     where h.id = c_cipreces;

    insert into public.metodos_pago(hotel_id, nombre, activo)
    values (c_cipreces, 'Efectivo', true)
    returning id into v_metodo;

    if v_actor is not null then
      insert into public.auditoria_operaciones(hotel_id, actor_id, accion, entidad, entity_id, after_data, reason)
      values (c_cipreces, v_actor, 'metodos_pago.crear_efectivo_soporte', 'metodos_pago', v_metodo,
              jsonb_build_object('nombre', 'Efectivo', 'activo', true),
              'Migracion 20261006210000: el hotel no tenia metodos de pago y no podia operar turnos');
    end if;
  end if;

  -- MONACO'S: "NEQUI, EFECTIVO" -> "Nequi"
  if exists (
    select 1 from public.metodos_pago
     where id = c_monaco_metodo and hotel_id = c_monaco and nombre = 'NEQUI, EFECTIVO'
  ) then
    if exists (
      select 1 from public.metodos_pago
       where hotel_id = c_monaco and lower(btrim(nombre)) = 'nequi'
    ) then
      raise exception 'MONACO ya tiene un metodo Nequi; revisar manualmente';
    end if;

    select h.creado_por into v_actor
      from public.hoteles h
      join public.usuarios u on u.id = h.creado_por
     where h.id = c_monaco;

    update public.metodos_pago set nombre = 'Nequi' where id = c_monaco_metodo;

    if v_actor is not null then
      insert into public.auditoria_operaciones(hotel_id, actor_id, accion, entidad, entity_id, before_data, after_data, reason)
      values (c_monaco, v_actor, 'metodos_pago.renombrar_soporte', 'metodos_pago', c_monaco_metodo,
              jsonb_build_object('nombre', 'NEQUI, EFECTIVO'),
              jsonb_build_object('nombre', 'Nequi'),
              'Migracion 20261006210000: el nombre mezclaba Nequi y Efectivo; el hotel ya tiene un metodo Efectivo separado');
    end if;
  end if;
end
$config$;

commit;
