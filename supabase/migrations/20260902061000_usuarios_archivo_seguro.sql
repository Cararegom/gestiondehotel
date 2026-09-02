-- Archivo seguro de empleados: conserva historial operativo y separa el ciclo de acceso.

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS archivado_en timestamptz,
  ADD COLUMN IF NOT EXISTS archivado_por uuid;

UPDATE public.usuarios
SET archivado_en = COALESCE(archivado_en, actualizado_en, creado_en, now())
WHERE activo IS FALSE
  AND archivado_en IS NULL;

CREATE INDEX IF NOT EXISTS ix_usuarios_hotel_activo_nombre
  ON public.usuarios (hotel_id, activo, nombre);

COMMENT ON COLUMN public.usuarios.archivado_en IS
  'Fecha en que el empleado fue retirado/archivado sin borrar su historial.';
COMMENT ON COLUMN public.usuarios.archivado_por IS
  'Usuario administrador que retiró al empleado. Se conserva como UUID de auditoría.';

-- Revisa TODAS las FK actuales que apuntan a public.usuarios para impedir
-- una eliminación física cuando exista historia operativa. Se excluyen solo
-- relaciones de configuración/acceso que son prescindibles al borrar una
-- cuenta creada por error.
CREATE OR REPLACE FUNCTION public.usuario_dependencias_operativas(p_usuario_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_ref record;
  v_count bigint;
  v_total bigint := 0;
  v_details jsonb := '{}'::jsonb;
BEGIN
  IF p_usuario_id IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'detalles', '{}'::jsonb);
  END IF;

  FOR v_ref IN
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      a.attname AS column_name
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ck.attnum
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.usuarios'::regclass
      AND n.nspname = 'public'
      AND c.relname NOT IN (
        'usuarios_roles',
        'usuarios_permisos',
        'notificaciones',
        'bank_email_oauth_states'
      )
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I.%I WHERE %I = $1',
      v_ref.schema_name,
      v_ref.table_name,
      v_ref.column_name
    ) INTO v_count USING p_usuario_id;

    IF v_count > 0 THEN
      v_total := v_total + v_count;
      v_details := v_details || jsonb_build_object(
        v_ref.table_name || '.' || v_ref.column_name,
        v_count
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'total', v_total,
    'tiene_historial', v_total > 0,
    'detalles', v_details
  );
END;
$$;

REVOKE ALL ON FUNCTION public.usuario_dependencias_operativas(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.usuario_dependencias_operativas(uuid)
  TO service_role;
