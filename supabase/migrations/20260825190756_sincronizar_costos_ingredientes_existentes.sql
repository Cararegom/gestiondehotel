-- Repara fichas cuyo costo quedo en cero aunque el kardex valorizado ya tenia costo activo.
UPDATE public.ingredientes i
SET costo_unitario=b.average_unit_cost,actualizado_en=now()
FROM public.inventory_cost_balances b
WHERE b.hotel_id=i.hotel_id AND b.area='restaurant' AND b.item_id=i.id
  AND coalesce(i.costo_unitario,0)=0 AND b.average_unit_cost>0;
