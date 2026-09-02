-- Compatibilidad con el contrato histórico de turnos_programados.
-- `dia` sigue siendo NOT NULL aunque los lectores modernos usan fecha/tipo_turno.

CREATE OR REPLACE FUNCTION public.horario_publicar_borrador(
  p_borrador_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_borrador public.horario_borradores%ROWTYPE;
  v_usuarios uuid[];
  v_insertados integer := 0;
BEGIN
  SELECT * INTO v_borrador
  FROM public.horario_borradores
  WHERE id = p_borrador_id
  FOR UPDATE;

  IF v_borrador.id IS NULL THEN
    RAISE EXCEPTION 'HORARIO_BORRADOR_NO_ENCONTRADO' USING ERRCODE = 'P0001';
  END IF;

  IF v_borrador.estado <> 'borrador' THEN
    RAISE EXCEPTION 'HORARIO_BORRADOR_NO_PUBLICABLE' USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(jsonb_array_length(v_borrador.validacion->'conflictos'), 0) > 0
     AND coalesce((v_borrador.configuracion_snapshot->>'publicar_requiere_sin_conflictos')::boolean, true) THEN
    RAISE EXCEPTION 'HORARIO_TIENE_CONFLICTOS' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(DISTINCT usuario_id)
    INTO v_usuarios
  FROM public.horario_borrador_asignaciones
  WHERE borrador_id = p_borrador_id;

  IF coalesce(array_length(v_usuarios, 1), 0) = 0 THEN
    RAISE EXCEPTION 'HORARIO_SIN_ASIGNACIONES' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.turnos_programados
  WHERE hotel_id = v_borrador.hotel_id
    AND fecha BETWEEN v_borrador.fecha_inicio AND v_borrador.fecha_fin
    AND usuario_id = ANY(v_usuarios);

  INSERT INTO public.turnos_programados(
    hotel_id,
    fecha,
    dia,
    usuario_id,
    tipo_turno,
    generado_auto,
    plantilla_turno_id,
    horario_borrador_id
  )
  SELECT
    a.hotel_id,
    a.fecha,
    CASE extract(isodow FROM a.fecha)::int
      WHEN 1 THEN 'lunes'
      WHEN 2 THEN 'martes'
      WHEN 3 THEN 'miércoles'
      WHEN 4 THEN 'jueves'
      WHEN 5 THEN 'viernes'
      WHEN 6 THEN 'sábado'
      WHEN 7 THEN 'domingo'
    END,
    a.usuario_id,
    a.tipo_turno,
    a.origen <> 'manual',
    a.plantilla_turno_id,
    a.borrador_id
  FROM public.horario_borrador_asignaciones a
  WHERE a.borrador_id = p_borrador_id
  ORDER BY a.fecha, a.usuario_id;

  GET DIAGNOSTICS v_insertados = ROW_COUNT;

  UPDATE public.horario_borradores
  SET estado = 'publicado',
      publicado_por = p_actor_id,
      publicado_en = now(),
      actualizado_en = now()
  WHERE id = p_borrador_id;

  RETURN jsonb_build_object(
    'ok', true,
    'borrador_id', p_borrador_id,
    'filas_publicadas', v_insertados,
    'fecha_inicio', v_borrador.fecha_inicio,
    'fecha_fin', v_borrador.fecha_fin
  );
END;
$$;

REVOKE ALL ON FUNCTION public.horario_publicar_borrador(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.horario_publicar_borrador(uuid, uuid)
  TO service_role;
