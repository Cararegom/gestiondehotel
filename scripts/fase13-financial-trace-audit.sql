-- Auditoría read-only de la cadena Caja -> ledger dentro del período shadow.
WITH caja_shadow AS (
  SELECT c.*
  FROM public.caja c
  WHERE c.tipo::text IN ('ingreso', 'egreso')
    AND c.metodo_pago_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.financial_accounts a
      WHERE a.hotel_id = c.hotel_id AND c.creado_en >= a.shadow_started_at
    )
)
SELECT
  count(*) AS movimientos_shadow,
  count(*) FILTER (WHERE NOT EXISTS (
    SELECT 1 FROM public.account_movements m WHERE m.caja_id = c.id
  )) AS sin_ledger,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM public.account_movements m
    WHERE m.caja_id = c.id
      AND (
        m.hotel_id IS DISTINCT FROM c.hotel_id
        OR round(m.amount::numeric, 2) <> round(c.monto::numeric, 2)
        OR m.direction <> CASE WHEN c.tipo::text = 'ingreso' THEN 'in' ELSE 'out' END
      )
  )) AS divergentes
FROM caja_shadow c;

SELECT
  count(*) AS allocations,
  count(*) FILTER (WHERE a.hotel_id IS DISTINCT FROM e.hotel_id) AS hotel_divergente,
  count(*) FILTER (WHERE a.amount_cop <= 0) AS monto_invalido
FROM public.bank_payment_allocations a
JOIN public.bank_payment_events e ON e.id = a.payment_event_id;
