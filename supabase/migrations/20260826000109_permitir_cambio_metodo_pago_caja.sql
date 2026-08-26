-- Representacion historica de la migracion ya aplicada en produccion.
-- La funcion limita el cambio a metodo_pago_id, valida actor/tenant y audita.

CREATE OR REPLACE FUNCTION public.actualizar_metodo_pago_caja(p_movimiento_id uuid, p_metodo_pago_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor public.usuarios%rowtype;
  v_movimiento public.caja%rowtype;
  v_metodo public.metodos_pago%rowtype;
  v_rol_nombre text;
  v_rol_normalizado text;
  v_before jsonb;
  v_after jsonb;
begin
  if auth.uid() is null then
    raise exception 'Usuario no autenticado' using errcode = '42501';
  end if;

  select * into v_actor
  from public.usuarios
  where id = auth.uid() and activo is true
  limit 1;

  if not found then
    raise exception 'Usuario no autorizado' using errcode = '42501';
  end if;

  select r.nombre into v_rol_nombre
  from public.usuarios_roles ur
  join public.roles r on r.id = ur.rol_id
  where ur.usuario_id = auth.uid()
    and ur.hotel_id = v_actor.hotel_id
  order by ur.creado_en desc
  limit 1;

  v_rol_normalizado := lower(coalesce(v_rol_nombre, v_actor.rol, ''));

  if v_rol_normalizado not in ('recepcionista','administrador','admin','superadmin','gerente') then
    raise exception 'Tu rol no puede cambiar métodos de pago en caja' using errcode = '42501';
  end if;

  select * into v_movimiento
  from public.caja
  where id = p_movimiento_id
  for update;

  if not found then
    raise exception 'Movimiento de caja no encontrado' using errcode = 'P0002';
  end if;

  if v_movimiento.hotel_id is distinct from v_actor.hotel_id then
    raise exception 'No puedes modificar movimientos de otro hotel' using errcode = '42501';
  end if;

  select * into v_metodo
  from public.metodos_pago
  where id = p_metodo_pago_id
    and hotel_id = v_actor.hotel_id
    and activo is true
  limit 1;

  if not found then
    raise exception 'Método de pago inválido o inactivo para este hotel' using errcode = '22023';
  end if;

  if v_movimiento.metodo_pago_id is not distinct from p_metodo_pago_id then
    return jsonb_build_object(
      'id', v_movimiento.id,
      'metodo_pago_id', v_movimiento.metodo_pago_id,
      'sin_cambios', true
    );
  end if;

  v_before := to_jsonb(v_movimiento);

  update public.caja
  set metodo_pago_id = p_metodo_pago_id,
      actualizado_en = now()
  where id = v_movimiento.id
  returning * into v_movimiento;

  v_after := to_jsonb(v_movimiento);

  if to_regclass('public.auditoria_operaciones') is not null then
    insert into public.auditoria_operaciones(
      hotel_id,
      actor_id,
      accion,
      entidad,
      entity_id,
      before_data,
      after_data,
      reason
    ) values (
      v_actor.hotel_id,
      auth.uid(),
      'caja.actualizar_metodo_pago',
      'caja',
      v_movimiento.id,
      v_before,
      v_after,
      'Cambio de método de pago desde módulo Caja'
    );
  end if;

  return jsonb_build_object(
    'id', v_movimiento.id,
    'metodo_pago_id', v_movimiento.metodo_pago_id,
    'sin_cambios', false
  );
end;
$function$

REVOKE ALL ON FUNCTION public.actualizar_metodo_pago_caja(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actualizar_metodo_pago_caja(uuid, uuid) TO authenticated, service_role;

