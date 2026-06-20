-- La configuracion de Terraza puede leerla el equipo del hotel,
-- pero solo administradores/superadmin pueden modificarla.

CREATE OR REPLACE FUNCTION public.usuario_actual_es_admin_terraza(p_hotel_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.usuarios u
     WHERE u.id = auth.uid()
       AND (u.hotel_id = p_hotel_id OR u.rol = 'superadmin')
       AND (
         u.rol IN ('admin', 'superadmin')
         OR EXISTS (
           SELECT 1
             FROM public.usuarios_roles ur
             JOIN public.roles r ON r.id = ur.rol_id
            WHERE ur.usuario_id = u.id
              AND ur.hotel_id = p_hotel_id
              AND lower(r.nombre) IN ('admin', 'administrador')
         )
       )
  );
$function$;

DROP POLICY IF EXISTS "TerrazaConfiguracion_hotel" ON public.terraza_configuracion;
DROP POLICY IF EXISTS "TerrazaConfiguracion_select_hotel" ON public.terraza_configuracion;
DROP POLICY IF EXISTS "TerrazaConfiguracion_insert_admin" ON public.terraza_configuracion;
DROP POLICY IF EXISTS "TerrazaConfiguracion_update_admin" ON public.terraza_configuracion;
DROP POLICY IF EXISTS "TerrazaConfiguracion_delete_admin" ON public.terraza_configuracion;

CREATE POLICY "TerrazaConfiguracion_select_hotel" ON public.terraza_configuracion
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((hotel_id = public.get_current_user_hotel_id()) AND (hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid));

CREATE POLICY "TerrazaConfiguracion_insert_admin" ON public.terraza_configuracion
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (
    (hotel_id = public.get_current_user_hotel_id())
    AND (hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid)
    AND public.usuario_actual_es_admin_terraza(hotel_id)
  );

CREATE POLICY "TerrazaConfiguracion_update_admin" ON public.terraza_configuracion
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (
    (hotel_id = public.get_current_user_hotel_id())
    AND (hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid)
    AND public.usuario_actual_es_admin_terraza(hotel_id)
  )
  WITH CHECK (
    (hotel_id = public.get_current_user_hotel_id())
    AND (hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid)
    AND public.usuario_actual_es_admin_terraza(hotel_id)
  );

CREATE POLICY "TerrazaConfiguracion_delete_admin" ON public.terraza_configuracion
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (
    (hotel_id = public.get_current_user_hotel_id())
    AND (hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid)
    AND public.usuario_actual_es_admin_terraza(hotel_id)
  );
