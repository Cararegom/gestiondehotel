export type SaleAllocationAmount = {
  payment_event_id?: unknown;
  sale_id?: unknown;
  sale_type?: unknown;
  amount_cop?: unknown;
};

export function activeSaleAllocationTotals(
  allocations: SaleAllocationAmount[],
  activeEventIds: ReadonlySet<string>,
  excludedEventId?: string | null
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const allocation of allocations) {
    const eventId = typeof allocation?.payment_event_id === 'string' ? allocation.payment_event_id : '';
    const saleId = typeof allocation?.sale_id === 'string' ? allocation.sale_id : '';
    const saleType = typeof allocation?.sale_type === 'string' ? allocation.sale_type.trim().toLowerCase() : '';
    const amount = Number(allocation?.amount_cop);
    if (!eventId || eventId === excludedEventId || !activeEventIds.has(eventId)) continue;
    if (!saleId || !saleType || !Number.isSafeInteger(amount) || amount <= 0) continue;
    const key = `${saleType}:${saleId}`;
    totals.set(key, (totals.get(key) || 0) + amount);
  }
  return totals;
}

export function saleAvailableAmount(total: unknown, allocated: unknown): number {
  const safeTotal = Number(total);
  const safeAllocated = Number(allocated);
  if (!Number.isFinite(safeTotal) || safeTotal <= 0) return 0;
  return Math.max(0, Math.floor(safeTotal) - (Number.isFinite(safeAllocated) ? Math.max(0, Math.floor(safeAllocated)) : 0));
}
