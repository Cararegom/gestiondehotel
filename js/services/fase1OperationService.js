const memoryOperations = new Map();
const pendingPayments = new Map();

function operationStorage() {
  try { return window.sessionStorage; } catch (_) { return null; }
}
export function getStableOperationId(scope) {
  const key = `fase1-operation:${scope}`;
  const storage = operationStorage();
  let existing = memoryOperations.get(key);
  try { existing = storage?.getItem(key) || existing; } catch (_) { /* Storage can be disabled. */ }
  if (existing) return existing;
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  memoryOperations.set(key, id);
  try { storage?.setItem(key, id); } catch (_) { /* Keep retries stable in memory. */ }
  return id;
}
export function completeStableOperation(scope) {
  const key = `fase1-operation:${scope}`;
  memoryOperations.delete(key);
  try { operationStorage()?.removeItem(key); } catch (_) { /* Storage can be disabled. */ }
}
export function buildOperationScope(kind, payload) {
  const normalized = JSON.stringify(payload, Object.keys(payload || {}).sort());
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) hash = Math.imul(hash ^ normalized.charCodeAt(i), 16777619);
  return `${kind}:${(hash >>> 0).toString(16)}`;
}

function paymentScope({ reservaId, monto, metodoPagoId, turnoId, concepto, operationKey = null }) {
  return buildOperationScope('pago-reserva', { reservaId, monto, metodoPagoId, turnoId, concepto, operationKey });
}

export async function procesarPagoReservaAtomico(supabase, options) {
  const scope = paymentScope(options);
  if (pendingPayments.has(scope)) return pendingPayments.get(scope);
  const request = submitReservationPayment(supabase, options, scope);
  pendingPayments.set(scope, request);
  try { return await request; } finally { pendingPayments.delete(scope); }
}

async function submitReservationPayment(supabase, {
  reservaId, monto, metodoPagoId, turnoId, concepto, occurredAt = new Date().toISOString(),
  completeOperation = true
}, scope) {
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
  if (completeOperation) completeStableOperation(scope);
  return { ...data, pago_reserva_id: pagoReservaId };
}

export async function procesarPagosReservaAtomicos(supabase, {
  reservaId, pagos, turnoId, concepto, operationKey = null, occurredAt = new Date().toISOString()
}) {
  const resultados = [];
  const scopes = [];
  for (let index = 0; index < pagos.length; index += 1) {
    const pago = pagos[index];
    const options = {
      reservaId,
      monto: pago.monto,
      metodoPagoId: pago.metodo_pago_id,
      turnoId,
      concepto,
      operationKey: `${operationKey || 'lote'}:${index}`,
      occurredAt,
      completeOperation: false
    };
    scopes.push(paymentScope(options));
    resultados.push(await procesarPagoReservaAtomico(supabase, options));
  }
  scopes.forEach(completeStableOperation);
  return resultados;
}
