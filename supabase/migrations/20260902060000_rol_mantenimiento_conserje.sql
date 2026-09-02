-- Rol operativo Mantenimiento / Conserje.
-- Alcance: mantenimiento, mapa hotel en solo lectura, control de energia operativo
-- y notificaciones. No concede privilegios administrativos ni financieros.

CREATE OR REPLACE FUNCTION public.es_nombre_rol_mantenimiento_conserje(p_nombre text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT lower(trim(coalesce(p_nombre, ''))) = 'mantenimiento'
      OR lower(trim(coalesce(p_nombre, ''))) LIKE '%mantenimiento%'
      OR lower(trim(coalesce(p_nombre, ''))) LIKE '%conserje%';
$$;

REVOKE ALL ON FUNCTION public.es_nombre_rol_mantenimiento_conserje(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.es_nombre_rol_mantenimiento_conserje(text) TO authenticated, service_role;

INSERT INTO public.roles(nombre, descripcion)
VALUES (
  'Mantenimiento / Conserje',
  'Personal operativo de mantenimiento: mapa de habitaciones solo lectura, mantenimiento y control de energia.'
)
ON CONFLICT (nombre) DO UPDATE
SET descripcion = EXCLUDED.descripcion;

-- El permiso de mantenimiento queda asociado al rol. El mapa restringido y
-- Control de Energia se autorizan mediante funciones especificas y no heredan
-- permisos de recepcion, caja o administracion.
INSERT INTO public.roles_permisos(rol_id, permiso_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permisos p ON p.nombre = 'ver_mantenimiento'
WHERE r.nombre = 'Mantenimiento / Conserje'
  AND NOT EXISTS (
    SELECT 1
    FROM public.roles_permisos rp
    WHERE rp.rol_id = r.id
      AND rp.permiso_id = p.id
  );

CREATE OR REPLACE FUNCTION public.usuario_actual_es_mantenimiento_conserje()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = auth.uid()
      AND u.activo IS DISTINCT FROM false
      AND (
        lower(trim(coalesce(u.rol, ''))) = 'mantenimiento'
        OR EXISTS (
          SELECT 1
          FROM public.usuarios_roles ur
          JOIN public.roles r ON r.id = ur.rol_id
          WHERE ur.usuario_id = u.id
            AND ur.hotel_id = u.hotel_id
            AND public.es_nombre_rol_mantenimiento_conserje(r.nombre)
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.usuario_actual_es_mantenimiento_conserje() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usuario_actual_es_mantenimiento_conserje() TO authenticated, service_role;

-- Compatibilidad temporal con componentes antiguos que todavia leen usuarios.rol.
-- El catalogo usuarios_roles sigue siendo la fuente autoritativa del rol.
CREATE OR REPLACE FUNCTION public.sincronizar_rol_legacy_mantenimiento_conserje()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_usuario_id uuid := coalesce(NEW.usuario_id, OLD.usuario_id);
  v_tiene_mantenimiento boolean := false;
BEGIN
  IF v_usuario_id IS NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios_roles ur
    JOIN public.roles r ON r.id = ur.rol_id
    WHERE ur.usuario_id = v_usuario_id
      AND public.es_nombre_rol_mantenimiento_conserje(r.nombre)
  ) INTO v_tiene_mantenimiento;

  IF v_tiene_mantenimiento THEN
    UPDATE public.usuarios
    SET rol = 'mantenimiento'
    WHERE id = v_usuario_id
      AND lower(trim(coalesce(rol, ''))) NOT IN ('admin', 'administrador', 'superadmin');
  ELSE
    UPDATE public.usuarios
    SET rol = 'usuario'
    WHERE id = v_usuario_id
      AND lower(trim(coalesce(rol, ''))) = 'mantenimiento';
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.sincronizar_rol_legacy_mantenimiento_conserje() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_rol_legacy_mantenimiento_conserje() TO service_role;

DROP TRIGGER IF EXISTS trg_sync_rol_legacy_mantenimiento_conserje ON public.usuarios_roles;
CREATE TRIGGER trg_sync_rol_legacy_mantenimiento_conserje
AFTER INSERT OR UPDATE OF rol_id, usuario_id, hotel_id OR DELETE
ON public.usuarios_roles
FOR EACH ROW
EXECUTE FUNCTION public.sincronizar_rol_legacy_mantenimiento_conserje();

-- Sincroniza cualquier asignacion existente si la migracion se vuelve a aplicar
-- en un entorno que ya tenga usuarios con el nuevo rol.
UPDATE public.usuarios u
SET rol = 'mantenimiento'
WHERE lower(trim(coalesce(u.rol, ''))) NOT IN ('admin', 'administrador', 'superadmin')
  AND EXISTS (
    SELECT 1
    FROM public.usuarios_roles ur
    JOIN public.roles r ON r.id = ur.rol_id
    WHERE ur.usuario_id = u.id
      AND ur.hotel_id = u.hotel_id
      AND public.es_nombre_rol_mantenimiento_conserje(r.nombre)
  );

-- RPC de mapa estrictamente limitado: no devuelve nombres de huespedes,
-- valores, pagos, documentos, consumos ni articulos prestados.
CREATE OR REPLACE FUNCTION public.mapa_mantenimiento_conserje()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_hotel_id uuid;
  v_result jsonb;
BEGIN
  IF NOT public.usuario_actual_es_mantenimiento_conserje() THEN
    RAISE EXCEPTION 'NO_AUTORIZADO' USING ERRCODE = 'P0001';
  END IF;

  SELECT u.hotel_id
  INTO v_hotel_id
  FROM public.usuarios u
  WHERE u.id = auth.uid()
    AND u.activo IS DISTINCT FROM false;

  IF v_hotel_id IS NULL THEN
    RAISE EXCEPTION 'HOTEL_NO_RESUELTO' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', h.id,
        'nombre', h.nombre,
        'piso', h.piso,
        'estado', CASE
          WHEN r.id IS NOT NULL
               AND r.tipo_duracion IS DISTINCT FROM 'abierta'
               AND r.fecha_fin IS NOT NULL
               AND r.fecha_fin <= now()
            THEN 'tiempo agotado'
          WHEN r.id IS NOT NULL THEN 'ocupada'
          ELSE h.estado::text
        END,
        'reserva', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
          'estado', r.estado::text,
          'fecha_inicio', r.fecha_inicio,
          'fecha_fin', r.fecha_fin,
          'tipo_duracion', r.tipo_duracion
        ) END
      )
      ORDER BY
        CASE
          WHEN h.piso::text ~ '^[0-9]+$' THEN h.piso::text::integer
          ELSE 2147483647
        END,
        h.nombre
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.habitaciones h
  LEFT JOIN LATERAL (
    SELECT rr.id, rr.estado, rr.fecha_inicio, rr.fecha_fin, rr.tipo_duracion
    FROM public.reservas rr
    WHERE rr.hotel_id = h.hotel_id
      AND rr.habitacion_id = h.id
      AND rr.estado::text IN ('activa', 'ocupada', 'tiempo agotado')
    ORDER BY rr.fecha_inicio DESC
    LIMIT 1
  ) r ON true
  WHERE h.hotel_id = v_hotel_id
    AND h.activo IS DISTINCT FROM false;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.mapa_mantenimiento_conserje() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mapa_mantenimiento_conserje() TO authenticated, service_role;

-- Control de Energia: el nuevo rol puede ejecutar el control fisico, pero no
-- obtiene privilegios de administrador ni de generacion/configuracion de QR.
CREATE OR REPLACE FUNCTION public.energy_actor_allowed(p_admin_only boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = auth.uid()
      AND u.activo = true
      AND (
        CASE WHEN p_admin_only THEN
          lower(trim(coalesce(u.rol, ''))) IN ('admin', 'administrador')
          OR EXISTS (
            SELECT 1
            FROM public.usuarios_roles ur
            JOIN public.roles r ON r.id = ur.rol_id
            WHERE ur.usuario_id = u.id
              AND ur.hotel_id = u.hotel_id
              AND lower(trim(r.nombre)) IN ('admin', 'administrador')
          )
          OR EXISTS (
            SELECT 1 FROM public.hoteles h
            WHERE h.id = u.hotel_id AND h.creado_por = u.id
          )
        ELSE
          lower(trim(coalesce(u.rol, ''))) IN (
            'admin', 'administrador', 'recepcionista', 'camarera', 'mantenimiento'
          )
          OR EXISTS (
            SELECT 1
            FROM public.usuarios_roles ur
            JOIN public.roles r ON r.id = ur.rol_id
            WHERE ur.usuario_id = u.id
              AND ur.hotel_id = u.hotel_id
              AND (
                lower(trim(r.nombre)) IN ('admin', 'administrador', 'recepcionista', 'camarera', 'mantenimiento')
                OR public.es_nombre_rol_mantenimiento_conserje(r.nombre)
              )
          )
          OR EXISTS (
            SELECT 1 FROM public.hoteles h
            WHERE h.id = u.hotel_id AND h.creado_por = u.id
          )
        END
      )
  );
$$;

REVOKE ALL ON FUNCTION public.energy_actor_allowed(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.energy_actor_allowed(boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.energy_actor_role_label()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT coalesce(
    (
      SELECT r.nombre
      FROM public.usuarios_roles ur
      JOIN public.roles r ON r.id = ur.rol_id
      WHERE ur.usuario_id = u.id
        AND ur.hotel_id = u.hotel_id
        AND (
          lower(trim(r.nombre)) IN ('admin', 'administrador', 'recepcionista', 'camarera', 'mantenimiento')
          OR public.es_nombre_rol_mantenimiento_conserje(r.nombre)
        )
      ORDER BY CASE
        WHEN lower(trim(r.nombre)) IN ('administrador', 'admin') THEN 1
        WHEN lower(trim(r.nombre)) = 'recepcionista' THEN 2
        WHEN lower(trim(r.nombre)) = 'camarera' THEN 3
        WHEN public.es_nombre_rol_mantenimiento_conserje(r.nombre) THEN 4
        ELSE 9
      END,
      r.nombre
      LIMIT 1
    ),
    nullif(trim(u.rol), ''),
    'usuario'
  )
  FROM public.usuarios u
  WHERE u.id = auth.uid()
    AND u.activo = true;
$$;

REVOKE ALL ON FUNCTION public.energy_actor_role_label() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.energy_actor_role_label() TO service_role;
