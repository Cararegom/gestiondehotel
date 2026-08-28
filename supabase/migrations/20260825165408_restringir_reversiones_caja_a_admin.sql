-- Revertir ingresos/egresos es una atribucion exclusiva de administradores.
-- La comprobacion se hace en servidor y no depende del rol enviado por el navegador.
CREATE OR REPLACE FUNCTION public.fase1_actor_tiene_permiso(p_hotel_id uuid, p_permiso text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN p_permiso = 'finanzas.revertir' THEN
      public.usuario_actual_es_admin_hotel(p_hotel_id)
    ELSE
      public.fase1_actor_es_miembro_activo(p_hotel_id)
      AND COALESCE((
        SELECT up.permitido
        FROM public.usuarios_permisos up
        JOIN public.permisos p ON p.id = up.permiso_id
        WHERE up.usuario_id = auth.uid() AND p.nombre = p_permiso
        LIMIT 1
      ), EXISTS (
        SELECT 1
        FROM public.usuarios_roles ur
        JOIN public.roles_permisos rp ON rp.rol_id = ur.rol_id
        JOIN public.permisos p ON p.id = rp.permiso_id
        WHERE ur.usuario_id = auth.uid()
          AND ur.hotel_id = p_hotel_id
          AND p.nombre = p_permiso
      ))
  END;
$function$;

-- El catalogo tambien debe reflejar la regla; Gerente conserva consulta y cierre,
-- pero deja de tener el permiso de reversion.
DELETE FROM public.roles_permisos rp
USING public.roles r, public.permisos p
WHERE rp.rol_id = r.id
  AND rp.permiso_id = p.id
  AND p.nombre = 'finanzas.revertir'
  AND lower(btrim(r.nombre)) NOT IN ('admin', 'administrador', 'superadmin');

REVOKE ALL ON FUNCTION public.fase1_actor_tiene_permiso(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fase1_actor_tiene_permiso(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fase1_actor_tiene_permiso(uuid, text) IS
  'Autoriza permisos por hotel; finanzas.revertir exige siempre rol administrativo autoritativo.';
