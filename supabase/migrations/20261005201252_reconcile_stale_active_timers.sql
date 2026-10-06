-- Production preflight for A13/A14.
--
-- Historical versions could leave cronometros.activo=true after checkout and
-- could create more than one active timer for a room.  A13/A14 deliberately
-- refuses to create its unique indexes while that invariant is broken.
-- This repair is idempotent and only closes:
--   1. timers already linked to a completed reservation; and
--   2. duplicate timers whose reservations are operational but every timer in
--      the duplicate group expired more than 30 days ago.
-- It never changes amounts, payments, guests, notes, or other financial data.

DO $$
DECLARE
  v_unresolved integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('reconcile_stale_active_timers'));

  LOCK TABLE public.cronometros IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.reservas IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.habitaciones IN SHARE ROW EXCLUSIVE MODE;

  UPDATE public.cronometros c
  SET activo = false,
      actualizado_en = now()
  FROM public.reservas r
  WHERE c.activo IS TRUE
    AND r.id = c.reserva_id
    AND r.hotel_id = c.hotel_id
    AND r.estado::text = 'completada';

  CREATE TEMP TABLE a13_stale_duplicate_rooms ON COMMIT DROP AS
  SELECT c.hotel_id, c.habitacion_id
  FROM public.cronometros c
  LEFT JOIN public.reservas r
    ON r.id = c.reserva_id
   AND r.hotel_id = c.hotel_id
  WHERE c.activo IS TRUE
  GROUP BY c.hotel_id, c.habitacion_id
  HAVING count(*) > 1
     AND bool_and(c.reserva_id IS NOT NULL)
     AND bool_and(c.fecha_fin < now() - interval '30 days')
     AND bool_and(r.estado::text IN ('activa', 'ocupada'));

  SELECT count(*)
  INTO v_unresolved
  FROM (
    SELECT c.hotel_id, c.habitacion_id
    FROM public.cronometros c
    WHERE c.activo IS TRUE
    GROUP BY c.hotel_id, c.habitacion_id
    HAVING count(*) > 1
  ) duplicates
  LEFT JOIN a13_stale_duplicate_rooms repairable
    ON repairable.hotel_id = duplicates.hotel_id
   AND repairable.habitacion_id = duplicates.habitacion_id
  WHERE repairable.hotel_id IS NULL;

  IF v_unresolved > 0 THEN
    RAISE EXCEPTION
      'A13_RECONCILIACION_REQUIERE_REVISION_MANUAL: % grupo(s) duplicado(s) no cumplen los criterios seguros',
      v_unresolved;
  END IF;

  UPDATE public.reservas r
  SET estado = 'completada'::public.estado_reserva_enum,
      actualizado_en = now()
  FROM public.cronometros c
  JOIN a13_stale_duplicate_rooms d
    ON d.hotel_id = c.hotel_id
   AND d.habitacion_id = c.habitacion_id
  WHERE c.activo IS TRUE
    AND r.id = c.reserva_id
    AND r.hotel_id = c.hotel_id
    AND r.estado::text IN ('activa', 'ocupada');

  UPDATE public.cronometros c
  SET activo = false,
      actualizado_en = now()
  FROM a13_stale_duplicate_rooms d
  WHERE c.activo IS TRUE
    AND c.hotel_id = d.hotel_id
    AND c.habitacion_id = d.habitacion_id;

  UPDATE public.habitaciones h
  SET estado = 'limpieza'::public.estado_habitacion_enum,
      actualizado_en = now()
  FROM a13_stale_duplicate_rooms d
  WHERE h.hotel_id = d.hotel_id
    AND h.id = d.habitacion_id
    AND h.estado::text IN ('ocupada', 'tiempo agotado', 'reservada');

  IF EXISTS (
    SELECT 1
    FROM public.cronometros c
    WHERE c.activo IS TRUE
    GROUP BY c.hotel_id, c.habitacion_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A13_RECONCILIACION_INCOMPLETA';
  END IF;
END;
$$;
