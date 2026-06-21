-- Ajustes operativos de Terraza:
-- - Mesa 6 con dos sillones.
-- - Deteccion mas flexible de roles para transferencias.
-- - Productos tipo cerveza existentes habilitados para michelada.

CREATE OR REPLACE FUNCTION public.normalizar_texto_transferencia(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT replace(
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(lower(trim(COALESCE(p_value, ''))), chr(225), 'a'),
              chr(233), 'e'
            ),
            chr(237), 'i'
          ),
          chr(243), 'o'
        ),
        chr(250), 'u'
      ),
      chr(252), 'u'
    ),
    chr(241), 'n'
  );
$function$;

INSERT INTO public.terraza_mesas (hotel_id, numero, nombre, sillas, tipo, activo)
VALUES ('38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid, 6, 'Mesa 6 - Sillones', 2, 'mesa', true)
ON CONFLICT (hotel_id, numero) DO UPDATE
  SET nombre = EXCLUDED.nombre,
      sillas = EXCLUDED.sillas,
      tipo = EXCLUDED.tipo,
      activo = true,
      actualizado_en = now();

UPDATE public.terraza_productos
   SET permite_michelada = true,
       actualizado_en = now()
 WHERE hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid
   AND (
     public.normalizar_texto_transferencia(categoria) LIKE '%cerve%'
     OR public.normalizar_texto_transferencia(categoria) LIKE '%beer%'
     OR public.normalizar_texto_transferencia(nombre) LIKE '%cerve%'
     OR public.normalizar_texto_transferencia(nombre) LIKE '%beer%'
     OR public.normalizar_texto_transferencia(nombre) LIKE '%corona%'
     OR public.normalizar_texto_transferencia(nombre) LIKE '%aguila%'
     OR public.normalizar_texto_transferencia(nombre) LIKE '%poker%'
     OR public.normalizar_texto_transferencia(nombre) LIKE '%club colombia%'
     OR public.normalizar_texto_transferencia(nombre) LIKE '%costena%'
     OR public.normalizar_texto_transferencia(nombre) LIKE '%heineken%'
     OR public.normalizar_texto_transferencia(nombre) LIKE '%budweiser%'
     OR public.normalizar_texto_transferencia(nombre) LIKE '%stella%'
     OR public.normalizar_texto_transferencia(nombre) LIKE '%modelo%'
   );

CREATE OR REPLACE FUNCTION public.usuario_actual_tiene_rol_transferencia(
  p_hotel_id uuid,
  p_roles text[]
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH actor_roles AS (
    SELECT public.normalizar_texto_transferencia(u.rol::text) AS role_key
      FROM public.usuarios u
     WHERE u.id = auth.uid()
       AND (u.hotel_id = p_hotel_id OR u.rol = 'superadmin')

    UNION

    SELECT public.normalizar_texto_transferencia(r.nombre) AS role_key
      FROM public.usuarios u
      JOIN public.usuarios_roles ur ON ur.usuario_id = u.id
      JOIN public.roles r ON r.id = ur.rol_id
     WHERE u.id = auth.uid()
       AND (u.hotel_id = p_hotel_id OR u.rol = 'superadmin')
       AND ur.hotel_id = p_hotel_id
  ),
  canonical_roles AS (
    SELECT CASE
      WHEN role_key = 'recepcion' THEN 'recepcionista'
      ELSE role_key
    END AS role_key
    FROM actor_roles
  )
  SELECT EXISTS (
    SELECT 1
      FROM canonical_roles
     WHERE role_key = ANY (p_roles)
  );
$function$;
