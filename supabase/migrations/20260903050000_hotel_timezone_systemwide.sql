-- Zona horaria única por hotel: Configuración es la fuente de verdad.
-- Corrige fecha operativa, dashboard, mantenimiento, alertas bancarias y horarios
-- sin reescribir movimientos históricos ya consolidados.

ALTER TABLE public.configuracion_hotel
  ADD COLUMN IF NOT EXISTS zona_horaria text;

UPDATE public.configuracion_hotel
SET zona_horaria = 'America/Bogota'
WHERE zona_horaria IS NULL OR btrim(zona_horaria) = '';

ALTER TABLE public.configuracion_hotel
  ALTER COLUMN zona_horaria SET DEFAULT 'America/Bogota',
  ALTER COLUMN zona_horaria SET NOT NULL;

ALTER TABLE public.configuracion_hotel
  DROP CONSTRAINT IF EXISTS configuracion_hotel_zona_horaria_no_vacia;
ALTER TABLE public.configuracion_hotel
  ADD CONSTRAINT configuracion_hotel_zona_horaria_no_vacia
  CHECK (btrim(zona_horaria) <> '');

CREATE OR REPLACE FUNCTION public.hotel_time_zone(p_hotel_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_zone text;
BEGIN
  IF p_hotel_id IS NOT NULL THEN
    SELECT tz.name
      INTO v_zone
      FROM public.configuracion_hotel c
      JOIN pg_catalog.pg_timezone_names tz ON tz.name = btrim(c.zona_horaria)
     WHERE c.hotel_id = p_hotel_id
     LIMIT 1;
  END IF;
  RETURN COALESCE(v_zone, 'America/Bogota');
END;
$$;

REVOKE ALL ON FUNCTION public.hotel_time_zone(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hotel_time_zone(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_configuracion_hotel_time_zone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.zona_horaria := COALESCE(NULLIF(btrim(NEW.zona_horaria), ''), public.hotel_time_zone(NULL));
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names tz
    WHERE tz.name = NEW.zona_horaria
  ) THEN
    RAISE EXCEPTION 'Zona horaria IANA no válida: %', NEW.zona_horaria USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_configuracion_hotel_time_zone() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_configuracion_hotel_time_zone() TO service_role;

DROP TRIGGER IF EXISTS trg_validate_configuracion_hotel_time_zone ON public.configuracion_hotel;
CREATE TRIGGER trg_validate_configuracion_hotel_time_zone
BEFORE INSERT OR UPDATE OF zona_horaria ON public.configuracion_hotel
FOR EACH ROW EXECUTE FUNCTION public.validate_configuracion_hotel_time_zone();

CREATE OR REPLACE FUNCTION public.hotel_business_date(
  p_hotel_id uuid,
  p_occurred_at timestamptz
)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT (p_occurred_at AT TIME ZONE public.hotel_time_zone(p_hotel_id))::date
$$;

REVOKE ALL ON FUNCTION public.hotel_business_date(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hotel_business_date(uuid, timestamptz) TO authenticated, service_role;

-- Helper legado: solo compatibilidad. Todas las escrituras activas se migran abajo
-- para que el hotel_id sea explícito en el cálculo de business_date.
CREATE OR REPLACE FUNCTION public.fase1_business_date(p_occurred_at timestamptz)
RETURNS date
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT public.hotel_business_date(NULL, p_occurred_at)
$$;

DO $$
DECLARE
  r record;
  v_def text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('abrir_turno_con_apertura', 'p_hotel_id'),
      ('cancelar_reserva_con_reversion', 'v_reserva.hotel_id'),
      ('cerrar_pedido_terraza', 'v_p.hotel_id'),
      ('cerrar_turno_con_arqueo', 'v_t.hotel_id'),
      ('crear_transferencia_cuenta', 'v_from.hotel_id'),
      ('fase2_project_caja_to_account', 'NEW.hotel_id'),
      ('fase4_cost_in', 'p_hotel'),
      ('fase4_cost_out', 'p_hotel'),
      ('fase4_restaurant_sale_cogs', 'v_sale.hotel_id'),
      ('fase4_store_sale_cogs', 'NEW.hotel_id'),
      ('fase4_terrace_sale_cogs', 'NEW.hotel_id'),
      ('pagar_gasto', 'v_expense.hotel_id'),
      ('procesar_pago_reserva_atomico', 'v_reserva.hotel_id'),
      ('procesar_venta_restaurante_atomica', 'v_actor.hotel_id'),
      ('procesar_venta_tienda_atomica', 'v_actor.hotel_id'),
      ('recibir_compra_tienda_atomica', 'v_compra.hotel_id'),
      ('registrar_movimiento_caja_atomico', 'p_hotel_id'),
      ('revertir_movimiento_caja', 'v_original.hotel_id')
    ) AS x(proname, hotel_expr)
  LOOP
    FOR v_def IN
      SELECT pg_catalog.pg_get_functiondef(p.oid)
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = r.proname
        AND p.prokind IN ('f', 'p')
        AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%public.fase1_business_date(%'
    LOOP
      v_def := replace(
        v_def,
        'public.fase1_business_date(',
        'public.hotel_business_date(' || r.hotel_expr || ', '
      );
      EXECUTE v_def;
    END LOOP;
  END LOOP;
END;
$$;

-- P&L: los registros legacy sin business_date se interpretan con la zona de su hotel.
DO $$
DECLARE
  v_def text;
BEGIN
  IF to_regclass('public.financial_transactions') IS NOT NULL THEN
    SELECT pg_catalog.pg_get_viewdef('public.financial_transactions'::regclass, true)
      INTO v_def;
    v_def := replace(
      v_def,
      'fase1_business_date(COALESCE(c.fecha_movimiento, c.creado_en, now()))',
      'hotel_business_date(c.hotel_id, COALESCE(c.fecha_movimiento, c.creado_en, now()))'
    );
    v_def := replace(
      v_def,
      'fase1_business_date(COALESCE(r.fecha_movimiento, r.creado_en, now()))',
      'hotel_business_date(r.hotel_id, COALESCE(r.fecha_movimiento, r.creado_en, now()))'
    );
    EXECUTE 'CREATE OR REPLACE VIEW public.financial_transactions WITH (security_invoker=true) AS ' || v_def;
  END IF;
END;
$$;

-- Dashboard: el día se corta a medianoche de la zona del hotel, luego se convierte a UTC.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(p.oid)
    INTO v_def
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'get_dashboard_metrics'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_hotel_id uuid'
   LIMIT 1;

  IF v_def IS NOT NULL THEN
    v_def := replace(v_def, '''America/Bogota''', 'public.hotel_time_zone(p_hotel_id)');
    v_def := regexp_replace(
      v_def,
      'v_today_start\s*:=\s*date_trunc\(''day'',\s*timezone\(v_user_timezone,\s*now\(\)\)\)\s*;',
      'v_today_start := date_trunc(''day'', now() AT TIME ZONE v_user_timezone) AT TIME ZONE v_user_timezone;',
      'i'
    );
    v_def := regexp_replace(
      v_def,
      'v_today_end\s*:=\s*v_today_start\s*\+\s*interval\s*''1 day''\s*;',
      'v_today_end := (date_trunc(''day'', now() AT TIME ZONE v_user_timezone) + interval ''1 day'') AT TIME ZONE v_user_timezone;',
      'i'
    );
    v_def := regexp_replace(
      v_def,
      'v_yesterday_start\s*:=\s*v_today_start\s*-\s*interval\s*''1 day''\s*;',
      'v_yesterday_start := (date_trunc(''day'', now() AT TIME ZONE v_user_timezone) - interval ''1 day'') AT TIME ZONE v_user_timezone;',
      'i'
    );
    EXECUTE v_def;
  END IF;
END;
$$;

-- Alertas bancarias y mantenimiento dejan de tener una zona fija propia.
DO $$
DECLARE
  v_def text;
  v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'bank_email_notify_payment_event'
  LIMIT 1;
  IF v_oid IS NOT NULL THEN
    v_def := pg_catalog.pg_get_functiondef(v_oid);
    v_def := replace(v_def, '''America/Bogota''', 'public.hotel_time_zone(v_event.hotel_id)');
    EXECUTE v_def;
  END IF;

  v_oid := NULL;
  SELECT p.oid INTO v_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mantenimiento_emitir_alertas'
  LIMIT 1;
  IF v_oid IS NOT NULL THEN
    v_def := pg_catalog.pg_get_functiondef(v_oid);
    v_def := replace(v_def, '''America/Bogota''', 'public.hotel_time_zone(tm.hotel_id)');
    EXECUTE v_def;
  END IF;

  v_oid := NULL;
  SELECT p.oid INTO v_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mantenimiento_metricas'
  LIMIT 1;
  IF v_oid IS NOT NULL THEN
    v_def := pg_catalog.pg_get_functiondef(v_oid);
    v_def := replace(v_def, '''America/Bogota''', 'public.hotel_time_zone(v_hotel)');
    EXECUTE v_def;
  END IF;

  v_oid := NULL;
  SELECT p.oid INTO v_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'preparar_tarea_mantenimiento_fase3'
  LIMIT 1;
  IF v_oid IS NOT NULL THEN
    v_def := pg_catalog.pg_get_functiondef(v_oid);
    v_def := replace(v_def, '''America/Bogota''', 'public.hotel_time_zone(NEW.hotel_id)');
    EXECUTE v_def;
  END IF;
END;
$$;

-- Configuración manda también sobre el motor profesional de horarios.
DO $$
BEGIN
  IF to_regclass('public.horario_configuracion') IS NOT NULL THEN
    UPDATE public.horario_configuracion hc
       SET zona_horaria = public.hotel_time_zone(hc.hotel_id)
     WHERE hc.zona_horaria IS DISTINCT FROM public.hotel_time_zone(hc.hotel_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.horario_forzar_zona_hotel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.zona_horaria := public.hotel_time_zone(NEW.hotel_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.horario_forzar_zona_hotel() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.horario_forzar_zona_hotel() TO service_role;

CREATE OR REPLACE FUNCTION public.sincronizar_zona_horaria_configuracion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF to_regclass('public.horario_configuracion') IS NOT NULL THEN
    UPDATE public.horario_configuracion
       SET zona_horaria = NEW.zona_horaria
     WHERE hotel_id = NEW.hotel_id
       AND zona_horaria IS DISTINCT FROM NEW.zona_horaria;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sincronizar_zona_horaria_configuracion() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_zona_horaria_configuracion() TO service_role;

DO $$
BEGIN
  IF to_regclass('public.horario_configuracion') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_horario_forzar_zona_hotel ON public.horario_configuracion;
    CREATE TRIGGER trg_horario_forzar_zona_hotel
      BEFORE INSERT OR UPDATE OF hotel_id, zona_horaria ON public.horario_configuracion
      FOR EACH ROW EXECUTE FUNCTION public.horario_forzar_zona_hotel();
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_sincronizar_zona_horaria_configuracion ON public.configuracion_hotel;
CREATE TRIGGER trg_sincronizar_zona_horaria_configuracion
AFTER INSERT OR UPDATE OF zona_horaria ON public.configuracion_hotel
FOR EACH ROW EXECUTE FUNCTION public.sincronizar_zona_horaria_configuracion();

COMMENT ON COLUMN public.configuracion_hotel.zona_horaria IS
  'Zona horaria IANA oficial del hotel. Es la fuente única para fechas, horas, cierres, reportes y cortes operativos.';
