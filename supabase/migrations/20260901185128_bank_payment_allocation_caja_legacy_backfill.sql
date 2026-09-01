-- Recover exact Caja links for legacy bank allocations only when the match is one-to-one.
-- Ambiguous historical relations are deliberately left without caja_id for manual review/protection.

with candidate_rows as (
  select
    a.id as allocation_id,
    c.id as caja_id
  from public.bank_payment_allocations a
  join public.bank_payment_events e
    on e.id = a.payment_event_id
   and e.hotel_id = a.hotel_id
  join public.caja c
    on c.hotel_id = a.hotel_id
   and c.tipo = 'ingreso'
   and c.monto::numeric = a.amount_cop::numeric
   and c.fecha_movimiento between coalesce(e.email_received_at, e.transaction_occurred_at, e.created_at) - interval '48 hours'
                             and coalesce(e.email_received_at, e.transaction_occurred_at, e.created_at) + interval '48 hours'
   and (
     (a.allocation_type = 'reservation' and a.reservation_id is not null and c.reserva_id = a.reservation_id)
     or (a.allocation_type = 'sale' and a.sale_type = 'tienda' and c.venta_tienda_id = a.sale_id)
     or (a.allocation_type = 'sale' and a.sale_type = 'restaurante' and c.venta_restaurante_id = a.sale_id)
     or (a.allocation_type = 'sale' and a.sale_type = 'terraza' and c.venta_terraza_id = a.sale_id)
   )
  join public.metodos_pago m
    on m.id = c.metodo_pago_id
   and m.hotel_id = c.hotel_id
   and m.activo is true
  join public.financial_accounts fa
    on fa.id = m.financial_account_id
   and fa.hotel_id = c.hotel_id
   and fa.active is true
   and fa.account_type = 'bank'
  where a.caja_id is null
    and not exists (
      select 1
      from public.bank_payment_allocations used
      where used.caja_id = c.id
    )
), one_candidate_per_allocation as (
  select allocation_id, (array_agg(caja_id))[1] as caja_id
  from candidate_rows
  group by allocation_id
  having count(*) = 1
), one_allocation_per_candidate as (
  select allocation_id, caja_id
  from (
    select
      allocation_id,
      caja_id,
      count(*) over (partition by caja_id) as allocation_count
    from one_candidate_per_allocation
  ) scoped
  where allocation_count = 1
)
update public.bank_payment_allocations a
set caja_id = safe.caja_id
from one_allocation_per_candidate safe
where a.id = safe.allocation_id
  and a.caja_id is null;
