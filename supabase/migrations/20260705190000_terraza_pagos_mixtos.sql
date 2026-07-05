-- Cobro mixto atomico para Terraza. Reutiliza el cierre existente y divide
-- sus movimientos de Caja por metodo dentro de la misma transaccion.

ALTER TABLE public.terraza_pedidos
  ADD COLUMN IF NOT EXISTS pagos_mixtos jsonb DEFAULT '[]'::jsonb NOT NULL;

CREATE OR REPLACE FUNCTION public.cerrar_pedido_terraza_mixto(
  p_pedido_id uuid,
  p_usuario_id uuid,
  p_turno_id uuid,
  p_pagos jsonb,
  p_propina_monto numeric DEFAULT 0,
  p_propina_sugerida_monto numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pago jsonb;
  v_metodo_id uuid;
  v_primer_metodo_id uuid;
  v_monto_pago numeric(12,2);
  v_total_pagos numeric(12,2) := 0;
  v_total_esperado numeric(12,2);
  v_resultado jsonb;
  v_mov_consumo public.caja%rowtype;
  v_mov_propina public.caja%rowtype;
  v_restante_consumo numeric(12,2) := 0;
  v_restante_propina numeric(12,2) := 0;
  v_asignado numeric(12,2);
  v_restante_pago numeric(12,2);
  v_hotel_id uuid;
BEGIN
  IF jsonb_typeof(p_pagos) <> 'array' OR jsonb_array_length(p_pagos) < 2 THEN
    RAISE EXCEPTION 'El pago mixto requiere al menos dos metodos.';
  END IF;

  SELECT hotel_id INTO v_hotel_id
    FROM public.terraza_pedidos
   WHERE id = p_pedido_id;

  IF v_hotel_id IS NULL THEN
    RAISE EXCEPTION 'Pedido de Terraza no encontrado.';
  END IF;

  FOR v_pago IN SELECT value FROM jsonb_array_elements(p_pagos)
  LOOP
    BEGIN
      v_metodo_id := (v_pago->>'metodo_pago_id')::uuid;
      v_monto_pago := round((v_pago->>'monto')::numeric, 2);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Uno de los pagos mixtos no es valido.';
    END;

    IF v_monto_pago <= 0 THEN
      RAISE EXCEPTION 'Todos los montos del pago mixto deben ser mayores a cero.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.metodos_pago
       WHERE id = v_metodo_id
         AND hotel_id = v_hotel_id
         AND activo = true
    ) THEN
      RAISE EXCEPTION 'Uno de los metodos de pago no esta activo para este hotel.';
    END IF;

    IF v_primer_metodo_id IS NULL THEN
      v_primer_metodo_id := v_metodo_id;
    END IF;
    v_total_pagos := v_total_pagos + v_monto_pago;
  END LOOP;

  IF (
    SELECT count(DISTINCT (value->>'metodo_pago_id'))
      FROM jsonb_array_elements(p_pagos)
  ) <> jsonb_array_length(p_pagos) THEN
    RAISE EXCEPTION 'No repitas metodos en el pago mixto.';
  END IF;

  v_resultado := public.cerrar_pedido_terraza(
    p_pedido_id,
    v_primer_metodo_id,
    p_usuario_id,
    p_turno_id,
    p_propina_monto,
    p_propina_sugerida_monto
  );

  v_total_esperado := round(COALESCE((v_resultado->>'total_cobrado')::numeric, 0), 2);
  IF abs(v_total_pagos - v_total_esperado) >= 0.01 THEN
    RAISE EXCEPTION 'Los pagos (%) no coinciden con el total a cobrar (%).', v_total_pagos, v_total_esperado;
  END IF;

  IF v_resultado->>'caja_id' IS NOT NULL THEN
    SELECT * INTO v_mov_consumo
      FROM public.caja
     WHERE id = (v_resultado->>'caja_id')::uuid;
    v_restante_consumo := COALESCE(v_mov_consumo.monto, 0);
  END IF;

  IF v_resultado->>'caja_propina_id' IS NOT NULL THEN
    SELECT * INTO v_mov_propina
      FROM public.caja
     WHERE id = (v_resultado->>'caja_propina_id')::uuid;
    v_restante_propina := COALESCE(v_mov_propina.monto, 0);
  END IF;

  DELETE FROM public.caja
   WHERE id IN (v_mov_consumo.id, v_mov_propina.id);

  FOR v_pago IN SELECT value FROM jsonb_array_elements(p_pagos)
  LOOP
    v_metodo_id := (v_pago->>'metodo_pago_id')::uuid;
    v_restante_pago := round((v_pago->>'monto')::numeric, 2);

    IF v_restante_consumo > 0 AND v_restante_pago > 0 THEN
      v_asignado := LEAST(v_restante_pago, v_restante_consumo);
      INSERT INTO public.caja (
        hotel_id, usuario_id, turno_id, tipo, monto, metodo_pago_id,
        concepto, venta_terraza_id, fecha_movimiento
      ) VALUES (
        v_mov_consumo.hotel_id, v_mov_consumo.usuario_id, v_mov_consumo.turno_id,
        v_mov_consumo.tipo, v_asignado, v_metodo_id,
        left(v_mov_consumo.concepto || ' | Pago mixto', 250),
        v_mov_consumo.venta_terraza_id, v_mov_consumo.fecha_movimiento
      );
      v_restante_consumo := v_restante_consumo - v_asignado;
      v_restante_pago := v_restante_pago - v_asignado;
    END IF;

    IF v_restante_propina > 0 AND v_restante_pago > 0 THEN
      v_asignado := LEAST(v_restante_pago, v_restante_propina);
      INSERT INTO public.caja (
        hotel_id, usuario_id, turno_id, tipo, monto, metodo_pago_id,
        concepto, venta_terraza_id, fecha_movimiento
      ) VALUES (
        v_mov_propina.hotel_id, v_mov_propina.usuario_id, v_mov_propina.turno_id,
        v_mov_propina.tipo, v_asignado, v_metodo_id,
        left(v_mov_propina.concepto || ' | Pago mixto', 250),
        v_mov_propina.venta_terraza_id, v_mov_propina.fecha_movimiento
      );
      v_restante_propina := v_restante_propina - v_asignado;
      v_restante_pago := v_restante_pago - v_asignado;
    END IF;

    IF abs(v_restante_pago) >= 0.01 THEN
      RAISE EXCEPTION 'No se pudo distribuir completamente uno de los pagos.';
    END IF;
  END LOOP;

  IF abs(v_restante_consumo) >= 0.01 OR abs(v_restante_propina) >= 0.01 THEN
    RAISE EXCEPTION 'No se pudo distribuir completamente el cobro mixto.';
  END IF;

  UPDATE public.terraza_pedidos
     SET metodo_pago_id = NULL,
         pagos_mixtos = p_pagos,
         actualizado_en = now()
   WHERE id = p_pedido_id;

  RETURN (v_resultado - 'caja_id' - 'caja_propina_id') || jsonb_build_object(
    'pago_mixto', true,
    'pagos', p_pagos
  );
END;
$function$;
