-- Los administradores del hotel pueden corregir montos vinculados en turnos abiertos.
-- La edición histórica conserva el permiso del titular o superadministrador.
do $migration$
declare
  v_definicion text := pg_get_functiondef(
    'public.editar_movimiento_caja_admin(uuid,text,numeric,text,uuid,timestamptz,text)'::regprocedure
  );
  v_restriccion constant text := $bloque$    if v_vinculado and not v_puede_corregir_vinculados then
      raise exception 'CAJA_EDICION_VINCULADO: la correccion del monto de reservas o ventas requiere ser propietario del hotel o superadministrador'
        using errcode = '23514';
    end if;
$bloque$;
begin
  if strpos(v_definicion, v_restriccion) = 0 then
    raise exception 'No se encontró el control esperado de montos vinculados en editar_movimiento_caja_admin';
  end if;

  v_definicion := replace(v_definicion, v_restriccion, '');
  v_definicion := replace(v_definicion, 'v_puede_corregir_vinculados', 'v_puede_corregir_historico');
  v_definicion := replace(v_definicion, $anterior$  -- El propietario registrado en hoteles.creado_por recibe la misma capacidad
  -- de correccion avanzada que el superadmin SaaS, pero SOLO para su hotel.
  -- Un administrador que no es titular conserva las restricciones ordinarias.
$anterior$, $actual$  -- El titular registrado en hoteles.creado_por puede corregir el historial de su hotel.
$actual$);
  execute v_definicion;
end;
$migration$;
