function operationStorage() {
  try { return window.sessionStorage; } catch (_) { return null; }
}
export function getStableOperationId(scope) {
  const key = `fase1-operation:${scope}`;
  const storage = operationStorage();
  const existing = storage?.getItem(key);
  if (existing) return existing;
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  storage?.setItem(key, id);
  return id;
}
export function completeStableOperation(scope) { operationStorage()?.removeItem(`fase1-operation:${scope}`); }
export function buildOperationScope(kind, payload) {
  const normalized = JSON.stringify(payload, Object.keys(payload || {}).sort());
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) hash = Math.imul(hash ^ normalized.charCodeAt(i), 16777619);
  return `${kind}:${(hash >>> 0).toString(16)}`;
}

export async function procesarPagoReservaAtomico(supabase, {
  reservaId, monto, metodoPagoId, turnoId, concepto, operationKey = null, occurredAt = new Date().toISOString()
}) {
  const scope = buildOperationScope('pago-reserva', { reservaId, monto, metodoPagoId, turnoId, concepto, operationKey });
  const { data, error } = await supabase.rpc('procesar_pago_reserva_atomico', {
    p_reserva_id: reservaId,
    p_monto: monto,
    p_metodo_pago_id: metodoPagoId,
    p_turno_id: turnoId,
    p_concepto: concepto,
    p_client_operation_id: getStableOperationId(scope),
    p_occurred_at: occurredAt
  });
  if (error) throw error;
  const pagoReservaId = data?.pago_reserva_id || data?.pago_id;
  if (!pagoReservaId) throw new Error('El RPC de pago no devolvió el identificador del pago.');
  completeStableOperation(scope);
  return { ...data, pago_reserva_id: pagoReservaId };
}

export async function procesarPagosReservaAtomicos(supabase, {
  reservaId, pagos, turnoId, concepto, operationKey = null, occurredAt = new Date().toISOString()
}) {
  const resultados = [];
  for (let index = 0; index < pagos.length; index += 1) {
    const pago = pagos[index];
    resultados.push(await procesarPagoReservaAtomico(supabase, {
      reservaId,
      monto: pago.monto,
      metodoPagoId: pago.metodo_pago_id,
      turnoId,
      concepto,
      operationKey: `${operationKey || 'lote'}:${index}`,
      occurredAt
    }));
  }
  return resultados;
}
