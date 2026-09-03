-- Zona horaria IANA por hotel para que los cortes diarios no dependan de UTC ni del navegador.
-- Los hoteles ya existentes pertenecen al despliegue colombiano actual, por eso se inicializan
-- en America/Bogota. Las altas nuevas quedan sin valor hasta que Configuracion guarde la zona.

ALTER TABLE public.configuracion_hotel
  ADD COLUMN IF NOT EXISTS zona_horaria text;

UPDATE public.configuracion_hotel
SET zona_horaria = 'America/Bogota'
WHERE zona_horaria IS NULL OR btrim(zona_horaria) = '';

ALTER TABLE public.configuracion_hotel
  DROP CONSTRAINT IF EXISTS configuracion_hotel_zona_horaria_no_vacia;

ALTER TABLE public.configuracion_hotel
  ADD CONSTRAINT configuracion_hotel_zona_horaria_no_vacia
  CHECK (zona_horaria IS NULL OR btrim(zona_horaria) <> '');

COMMENT ON COLUMN public.configuracion_hotel.zona_horaria IS
  'Zona horaria IANA del hotel (ej. America/Bogota, America/Mexico_City, Europe/Madrid). Se usa para cortes de reportes y fechas operativas.';

-- Helper nuevo para código de servidor que necesite obtener la fecha de negocio por hotel.
-- Se conserva fase1_business_date(timestamptz) por compatibilidad con RPC existentes.
CREATE OR REPLACE FUNCTION public.hotel_business_date(
  p_hotel_id uuid,
  p_occurred_at timestamptz
) RETURNS date
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT (
    p_occurred_at AT TIME ZONE COALESCE(
      (
        SELECT tz.name
        FROM public.configuracion_hotel c
        JOIN pg_catalog.pg_timezone_names tz
          ON tz.name = c.zona_horaria
        WHERE c.hotel_id = p_hotel_id
        LIMIT 1
      ),
      'America/Bogota'
    )
  )::date
$$;

REVOKE ALL ON FUNCTION public.hotel_business_date(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hotel_business_date(uuid, timestamptz) TO authenticated, service_role;
