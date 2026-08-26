export type ReservationAllocationAmount = {
  payment_event_id?: unknown;
  reservation_id?: unknown;
  amount_cop?: unknown;
};

export function committedReservationTotals(
  allocations: ReservationAllocationAmount[],
  committedEventIds: ReadonlySet<string>
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const allocation of allocations) {
    const eventId = typeof allocation?.payment_event_id === 'string' ? allocation.payment_event_id : '';
    const reservationId = typeof allocation?.reservation_id === 'string' ? allocation.reservation_id : '';
    const amount = Number(allocation?.amount_cop);
    if (!eventId || !reservationId || !committedEventIds.has(eventId) || !Number.isSafeInteger(amount) || amount <= 0) continue;
    totals.set(reservationId, (totals.get(reservationId) || 0) + amount);
  }
  return totals;
}
