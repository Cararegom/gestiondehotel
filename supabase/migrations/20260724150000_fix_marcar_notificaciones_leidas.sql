CREATE OR REPLACE FUNCTION public.marcar_todas_mis_notificaciones_leidas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.usuarios%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para actualizar notificaciones.';
  END IF;

  SELECT *
    INTO v_actor
    FROM public.usuarios
   WHERE id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el perfil del usuario actual.';
  END IF;

  UPDATE public.notificaciones AS n
     SET leida = true,
         actualizado_en = now()
   WHERE n.hotel_id = v_actor.hotel_id
     AND n.leida = false
     AND (
       v_actor.rol::text IN ('admin', 'superadmin')
       OR n.usuario_id = auth.uid()
       OR (
         n.usuario_id IS NULL
         AND n.rol_destino::text = v_actor.rol::text
       )
     );
END;
$function$;

REVOKE ALL ON FUNCTION public.marcar_todas_mis_notificaciones_leidas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_todas_mis_notificaciones_leidas() TO authenticated;
