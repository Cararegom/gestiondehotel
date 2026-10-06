-- C4: impide liquidar consumos con pagos insuficientes y conserva trazabilidad.
-- La deuda se recalcula en servidor con el mismo modelo del checkout:
-- hospedaje + servicios + tienda + restaurante - cobros directos de ventas.

ALTER TABLE public.ventas_tienda
  ADD COLUMN IF NOT EXISTS pago_reserva_id uuid;

ALTER TABLE public.ventas_restaurante
  ADD COLUMN IF NOT EXISTS pago_reserva_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.ventas_tienda'::regclass
      AND c.confrelid = 'public.pagos_reserva'::regclass
      AND c.contype = 'f'
      AND a.attname = 'pago_reserva_id'
  ) THEN
    ALTER TABLE public.ventas_tienda
      ADD CONSTRAINT ventas_tienda_pago_reserva_id_fkey
      FOREIGN KEY (pago_reserva_id)
      REFERENCES public.pagos_reserva(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.ventas_restaurante'::regclass
      AND c.confrelid = 'public.pagos_reserva'::regclass
      AND c.contype = 'f'
      AND a.attname = 'pago_reserva_id'
  ) THEN
    ALTER TABLE public.ventas_restaurante
      ADD CONSTRAINT ventas_restaurante_pago_reserva_id_fkey
      FOREIGN KEY (pago_reserva_id)
      REFERENCES public.pagos_reserva(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ventas_tienda_pago_reserva_idx
  ON public.ventas_tienda(pago_reserva_id, hotel_id)
  WHERE pago_reserva_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ventas_restaurante_pago_reserva_idx
  ON public.ventas_restaurante(pago_reserva_id, hotel_id)
  WHERE pago_reserva_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pagos_reserva_hotel_reserva_id_idx
  ON public.pagos_reserva(hotel_id, reserva_id, id);

CREATE INDEX IF NOT EXISTS servicios_reserva_hotel_reserva_id_idx
  ON public.servicios_x_reserva(hotel_id, reserva_id, id);

CREATE INDEX IF NOT EXISTS ventas_tienda_hotel_reserva_id_idx
  ON public.ventas_tienda(hotel_id, reserva_id, id);

CREATE INDEX IF NOT EXISTS ventas_restaurante_hotel_reserva_id_idx
  ON public.ventas_restaurante(hotel_id, reserva_id, id);

CREATE INDEX IF NOT EXISTS caja_hotel_venta_tienda_id_idx
  ON public.caja(hotel_id, venta_tienda_id, id)
  WHERE venta_tienda_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS caja_hotel_venta_restaurante_id_idx
  ON public.caja(hotel_id, venta_restaurante_id, id)
  WHERE venta_restaurante_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.liquidar_consumos_reserva_atomico(
  p_reserva_id uuid,
  p_pago_reserva_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_reserva public.reservas%rowtype;
  v_pago public.pagos_reserva%rowtype;
  v_servicios_pendientes uuid[] := ARRAY[]::uuid[];
  v_tienda_pendientes uuid[] := ARRAY[]::uuid[];
  v_restaurante_pendientes uuid[] := ARRAY[]::uuid[];
  v_total_servicios numeric := 0;
  v_total_tienda numeric := 0;
  v_total_restaurante numeric := 0;
  v_movimientos_tienda numeric := 0;
  v_movimientos_restaurante numeric := 0;
  v_pago_externo_tienda numeric := 0;
  v_pago_externo_restaurante numeric := 0;
  v_total_cargos numeric := 0;
  v_deuda_cobrable numeric := 0;
  v_total_pagos numeric := 0;
  v_saldo_pendiente numeric := 0;
  v_servicios integer := 0;
  v_tienda integer := 0;
  v_restaurante integer := 0;
BEGIN
  IF auth.uid() IS NULL OR p_reserva_id IS NULL OR p_pago_reserva_id IS NULL THEN
    RAISE EXCEPTION 'Autenticacion, reserva y pago son obligatorios'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_reserva
  FROM public.reservas
  WHERE id = p_reserva_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.fase1_actor_es_miembro_activo(v_reserva.hotel_id) THEN
    RAISE EXCEPTION 'Reserva fuera del hotel autorizado'
      USING ERRCODE = '42501';
  END IF;

  -- El pago atómico también bloquea primero la reserva. Este orden serializa
  -- pagos y liquidaciones de una misma cuenta antes de calcular la deuda.
  SELECT greatest(
    coalesce(sum(p.monto), 0),
    coalesce(v_reserva.monto_pagado, 0)
  )
  INTO v_total_pagos
  FROM (
    SELECT pr.id, pr.monto
    FROM public.pagos_reserva pr
    WHERE pr.hotel_id = v_reserva.hotel_id
      AND pr.reserva_id = v_reserva.id
    ORDER BY pr.id
    FOR UPDATE
  ) AS p;

  SELECT *
  INTO v_pago
  FROM public.pagos_reserva
  WHERE id = p_pago_reserva_id
    AND reserva_id = v_reserva.id
    AND hotel_id = v_reserva.hotel_id
    AND usuario_id = auth.uid()
    AND source = 'reservation_payment';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pago no corresponde a esta reserva o usuario'
      USING ERRCODE = '42501';
  END IF;

  -- Cada subconsulta bloquea y captura las filas que fueron incluidas en el
  -- cálculo. Los UPDATE finales usan esos UUID exactos, por lo que un consumo
  -- insertado concurrentemente permanece pendiente y nunca se liquida sin pago.
  SELECT
    coalesce(
      array_agg(s.id ORDER BY s.id)
        FILTER (WHERE s.estado_pago IS DISTINCT FROM 'pagado'),
      ARRAY[]::uuid[]
    ),
    coalesce(sum(coalesce(s.precio_cobrado, 0)), 0)
  INTO v_servicios_pendientes, v_total_servicios
  FROM (
    SELECT sxr.id, sxr.estado_pago, sxr.precio_cobrado
    FROM public.servicios_x_reserva sxr
    WHERE sxr.hotel_id = v_reserva.hotel_id
      AND sxr.reserva_id = v_reserva.id
    ORDER BY sxr.id
    FOR UPDATE
  ) AS s;

  SELECT
    coalesce(
      array_agg(t.id ORDER BY t.id)
        FILTER (WHERE t.estado_pago IS DISTINCT FROM 'pagado'),
      ARRAY[]::uuid[]
    ),
    coalesce(sum(coalesce(t.total_venta, 0)), 0)
  INTO v_tienda_pendientes, v_total_tienda
  FROM (
    SELECT vt.id, vt.estado_pago, vt.total_venta
    FROM public.ventas_tienda vt
    WHERE vt.hotel_id = v_reserva.hotel_id
      AND vt.reserva_id = v_reserva.id
    ORDER BY vt.id
    FOR UPDATE
  ) AS t;

  SELECT
    coalesce(
      array_agg(r.id ORDER BY r.id)
        FILTER (WHERE r.estado_pago IS DISTINCT FROM 'pagado'),
      ARRAY[]::uuid[]
    ),
    coalesce(sum(coalesce(r.monto_total, r.total_venta, 0)), 0)
  INTO v_restaurante_pendientes, v_total_restaurante
  FROM (
    SELECT vr.id, vr.estado_pago, vr.monto_total, vr.total_venta
    FROM public.ventas_restaurante vr
    WHERE vr.hotel_id = v_reserva.hotel_id
      AND vr.reserva_id = v_reserva.id
    ORDER BY vr.id
    FOR UPDATE
  ) AS r;

  SELECT coalesce(sum(
    CASE WHEN c.tipo::text = 'egreso'
      THEN -coalesce(c.monto, 0)
      ELSE coalesce(c.monto, 0)
    END
  ), 0)
  INTO v_movimientos_tienda
  FROM (
    SELECT mov.id, mov.tipo, mov.monto
    FROM public.caja mov
    JOIN public.ventas_tienda vt
      ON vt.id = mov.venta_tienda_id
     AND vt.hotel_id = v_reserva.hotel_id
     AND vt.reserva_id = v_reserva.id
    WHERE mov.hotel_id = v_reserva.hotel_id
    ORDER BY mov.id
    FOR UPDATE OF mov
  ) AS c;

  SELECT coalesce(sum(
    CASE WHEN c.tipo::text = 'egreso'
      THEN -coalesce(c.monto, 0)
      ELSE coalesce(c.monto, 0)
    END
  ), 0)
  INTO v_movimientos_restaurante
  FROM (
    SELECT mov.id, mov.tipo, mov.monto
    FROM public.caja mov
    JOIN public.ventas_restaurante vr
      ON vr.id = mov.venta_restaurante_id
     AND vr.hotel_id = v_reserva.hotel_id
     AND vr.reserva_id = v_reserva.id
    WHERE mov.hotel_id = v_reserva.hotel_id
    ORDER BY mov.id
    FOR UPDATE OF mov
  ) AS c;

  v_pago_externo_tienda := least(
    greatest(v_total_tienda, 0),
    greatest(v_movimientos_tienda, 0)
  );
  v_pago_externo_restaurante := least(
    greatest(v_total_restaurante, 0),
    greatest(v_movimientos_restaurante, 0)
  );
  v_total_cargos := greatest(
    coalesce(v_reserva.monto_total, 0)
      + v_total_servicios
      + v_total_tienda
      + v_total_restaurante,
    0
  );
  v_deuda_cobrable := greatest(
    v_total_cargos - v_pago_externo_tienda - v_pago_externo_restaurante,
    0
  );
  v_saldo_pendiente := greatest(v_deuda_cobrable - v_total_pagos, 0);

  IF v_total_pagos < v_deuda_cobrable THEN
    RAISE EXCEPTION
      'C4_PAGO_INSUFICIENTE: los pagos registrados (%) no cubren la deuda real (%)',
      v_total_pagos,
      v_deuda_cobrable
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.servicios_x_reserva
  SET estado_pago = 'pagado',
      pago_reserva_id = v_pago.id
  WHERE id = ANY (v_servicios_pendientes);
  GET DIAGNOSTICS v_servicios = ROW_COUNT;

  UPDATE public.ventas_tienda
  SET estado_pago = 'pagado',
      pago_reserva_id = v_pago.id,
      actualizado_en = now()
  WHERE id = ANY (v_tienda_pendientes);
  GET DIAGNOSTICS v_tienda = ROW_COUNT;

  UPDATE public.ventas_restaurante
  SET estado_pago = 'pagado',
      pago_reserva_id = v_pago.id
  WHERE id = ANY (v_restaurante_pendientes);
  GET DIAGNOSTICS v_restaurante = ROW_COUNT;

  INSERT INTO public.auditoria_operaciones(
    hotel_id,
    actor_id,
    accion,
    entidad,
    entity_id,
    after_data,
    client_operation_id
  )
  VALUES (
    v_reserva.hotel_id,
    auth.uid(),
    'reserva.consumos_liquidar',
    'reservas',
    v_reserva.id,
    jsonb_build_object(
      'pago_reserva_id', v_pago.id,
      'pago_monto', v_pago.monto,
      'total_pagos', v_total_pagos,
      'total_cargos', v_total_cargos,
      'pago_externo_tienda', v_pago_externo_tienda,
      'pago_externo_restaurante', v_pago_externo_restaurante,
      'deuda_cobrable', v_deuda_cobrable,
      'saldo_pendiente', v_saldo_pendiente,
      'servicios', v_servicios,
      'ventas_tienda', v_tienda,
      'ventas_restaurante', v_restaurante
    ),
    v_pago.client_operation_id
  )
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'reserva_id', v_reserva.id,
    'pago_reserva_id', v_pago.id,
    'pago_monto', v_pago.monto,
    'total_pagos', v_total_pagos,
    'total_cargos', v_total_cargos,
    'pago_externo_tienda', v_pago_externo_tienda,
    'pago_externo_restaurante', v_pago_externo_restaurante,
    'deuda_cobrable', v_deuda_cobrable,
    'saldo_pendiente', v_saldo_pendiente,
    'servicios', v_servicios,
    'ventas_tienda', v_tienda,
    'ventas_restaurante', v_restaurante,
    'idempotent', v_servicios = 0 AND v_tienda = 0 AND v_restaurante = 0
  );
END
$$;

REVOKE ALL ON FUNCTION public.liquidar_consumos_reserva_atomico(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.liquidar_consumos_reserva_atomico(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.liquidar_consumos_reserva_atomico(uuid, uuid) IS
  'Liquida consumos solo cuando los pagos acumulados cubren la deuda real recalculada en servidor.';
