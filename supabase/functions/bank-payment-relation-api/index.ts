import { assertBankEmailConfig, isBankEmailProcessingEnabled, readBankEmailConfig } from '../_shared/bank-email/config.ts';
import { buildCorsHeaders, HttpError, jsonResponse, readJsonBody, safeErrorCode, safeErrorMessage } from '../_shared/bank-email/http.ts';
import { getPilotHotel } from '../_shared/bank-email/pilot-hotel.ts';
import { isBankReconciliationPaymentMethod } from '../_shared/bank-email/sale-reconciliation.ts';
import { buildAdminClient, isPilotOperationalUser, requireAuthenticatedProfile } from '../_shared/bank-email/server.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RELATABLE_STATUSES = ['detected', 'manual_review'];
const LEGACY_LINKED_STATUSES = new Set(['matched', 'manual_review', 'confirmed']);
const MAX_MOVEMENTS = 20;
const WINDOW_HOURS = 48;

type JsonBody = Record<string, unknown>;

type CajaRow = {
  id: string;
  monto: number | string;
  concepto: string | null;
  fecha_movimiento: string | null;
  creado_en: string | null;
  reserva_id: string | null;
  venta_tienda_id: string | null;
  venta_restaurante_id: string | null;
  venta_terraza_id: string | null;
};

type LegacyPaymentEvent = {
  status?: string | null;
  amount_cop?: number | string | null;
  email_received_at?: string | null;
  transaction_occurred_at?: string | null;
  created_at?: string | null;
  hotel_id?: string | null;
};

type LegacyAllocationRow = {
  payment_event_id?: string | null;
  allocation_type?: string | null;
  reservation_id?: string | null;
  sale_id?: string | null;
  sale_type?: string | null;
  amount_cop?: number | string | null;
  payment_event?: LegacyPaymentEvent | LegacyPaymentEvent[] | null;
};

type MovementRelationStatus = {
  linked: true;
  status: string;
  paymentEventId: string | null;
  amountCop: number;
  legacy: boolean;
  ambiguous?: boolean;
};

function requireUuid(value: unknown, label: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new HttpError(400, 'invalid_uuid', `${label} no es valido.`);
  return normalized;
}

function requireReason(value: unknown): string {
  const reason = String(value || '').replace(/\s+/g, ' ').trim();
  if (!reason) throw new HttpError(400, 'reason_required', 'Indica el motivo de la relacion.');
  if (reason.length > 500) throw new HttpError(400, 'reason_too_long', 'El motivo no puede superar 500 caracteres.');
  return reason;
}

function safeAmount(value: unknown): number {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
}

function safeDate(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function safeSenderName(value: unknown): string | null {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  return name ? name.slice(0, 160) : null;
}

function targetForMovement(row: CajaRow): { type: 'reservation'; reservationId: string; amountCop: number } | { type: 'sale'; saleId: string; saleType: string; amountCop: number } | null {
  const amountCop = safeAmount(row.monto);
  if (!amountCop) return null;
  const targets: Array<{ kind: string; id: string }> = [];
  if (row.reserva_id) targets.push({ kind: 'reservation', id: row.reserva_id });
  if (row.venta_tienda_id) targets.push({ kind: 'tienda', id: row.venta_tienda_id });
  if (row.venta_restaurante_id) targets.push({ kind: 'restaurante', id: row.venta_restaurante_id });
  if (row.venta_terraza_id) targets.push({ kind: 'terraza', id: row.venta_terraza_id });
  if (targets.length !== 1 || !UUID_PATTERN.test(targets[0].id)) return null;
  if (targets[0].kind === 'reservation') return { type: 'reservation', reservationId: targets[0].id, amountCop };
  return { type: 'sale', saleId: targets[0].id, saleType: targets[0].kind, amountCop };
}

function legacyAllocationMatchesMovement(allocation: LegacyAllocationRow, movement: CajaRow): boolean {
  const target = targetForMovement(movement);
  if (!target || safeAmount(allocation.amount_cop) !== target.amountCop) return false;
  if (target.type === 'reservation') {
    if (String(allocation.allocation_type || '') !== 'reservation' || String(allocation.reservation_id || '') !== target.reservationId) return false;
  } else if (
    String(allocation.allocation_type || '') !== 'sale'
    || String(allocation.sale_id || '') !== target.saleId
    || String(allocation.sale_type || '') !== target.saleType
  ) {
    return false;
  }

  const event = Array.isArray(allocation.payment_event) ? allocation.payment_event[0] : allocation.payment_event;
  const eventStatus = String(event?.status || '');
  if (!event || !LEGACY_LINKED_STATUSES.has(eventStatus)) return false;
  const movementAt = new Date(String(movement.fecha_movimiento || movement.creado_en || '')).getTime();
  const eventAt = new Date(String(event.email_received_at || event.transaction_occurred_at || event.created_at || '')).getTime();
  return Number.isFinite(movementAt) && Number.isFinite(eventAt)
    && Math.abs(movementAt - eventAt) <= WINDOW_HOURS * 60 * 60 * 1000;
}

async function requireOperationalContext(req: Request) {
  const config = readBankEmailConfig();
  assertBankEmailConfig(config);
  if (!isBankEmailProcessingEnabled(config)) throw new HttpError(403, 'bank_integration_disabled', 'La integracion bancaria no esta habilitada.');
  const admin = buildAdminClient();
  const pilot = await getPilotHotel(admin, config.pilotHotelName, config.pilotHotelId);
  const context = await requireAuthenticatedProfile(req, admin);
  if (context.profile.hotel_id !== pilot.id || !(await isPilotOperationalUser(admin, context, pilot.id))) {
    throw new HttpError(403, 'operational_role_required', 'Esta accion requiere recepcion o administracion del hotel piloto.');
  }
  return { admin, pilot, context };
}

async function getBankMethodIds(admin: ReturnType<typeof buildAdminClient>, hotelId: string): Promise<string[]> {
  const { data, error } = await admin.from('metodos_pago').select('id,nombre').eq('hotel_id', hotelId).eq('activo', true);
  if (error) throw Object.assign(new Error('No se pudieron consultar los metodos de pago.'), { code: 'payment_methods_lookup_failed' });
  return (data || []).filter((row) => isBankReconciliationPaymentMethod(row.nombre)).map((row) => String(row.id));
}

async function eventHasCashLink(admin: ReturnType<typeof buildAdminClient>, hotelId: string, paymentEventId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('bank_payment_allocations')
    .select('id')
    .eq('hotel_id', hotelId)
    .eq('payment_event_id', paymentEventId)
    .not('caja_id', 'is', null)
    .limit(1);
  if (error) throw Object.assign(new Error('No se pudo validar la relacion con Caja.'), { code: 'cash_link_lookup_failed' });
  return Boolean(data?.length);
}

async function getSafeEvent(admin: ReturnType<typeof buildAdminClient>, hotelId: string, paymentEventId: string) {
  const { data, error } = await admin
    .from('bank_payment_events')
    .select('id,amount_cop,status,sender_name,email_received_at,created_at,updated_at')
    .eq('hotel_id', hotelId)
    .eq('id', paymentEventId)
    .maybeSingle();
  if (error) throw Object.assign(new Error('No se pudo consultar la transferencia.'), { code: 'payment_event_lookup_failed' });
  if (!data || !RELATABLE_STATUSES.includes(String(data.status))) {
    throw new HttpError(409, 'payment_not_relatable', 'La transferencia ya no admite relacion desde recepcion.');
  }
  if (await eventHasCashLink(admin, hotelId, paymentEventId)) {
    throw new HttpError(409, 'payment_already_linked_to_cash', 'La transferencia ya esta conciliada con un movimiento de Caja.');
  }
  const amountCop = safeAmount(data.amount_cop);
  if (!amountCop) throw new HttpError(409, 'payment_amount_invalid', 'El valor de la transferencia no es valido.');
  return {
    id: String(data.id),
    amountCop,
    status: String(data.status),
    senderName: safeSenderName(data.sender_name),
    receivedAt: safeDate(data.email_received_at || data.created_at),
    updatedAt: safeDate(data.updated_at)
  };
}

async function listTransfers(admin: ReturnType<typeof buildAdminClient>, hotelId: string) {
  const { data, error } = await admin
    .from('bank_payment_events')
    .select('id,amount_cop,status,sender_name,email_received_at,created_at,updated_at')
    .eq('hotel_id', hotelId)
    .in('status', RELATABLE_STATUSES)
    .order('email_received_at', { ascending: false, nullsFirst: false })
    .limit(30);
  if (error) throw Object.assign(new Error('No se pudieron consultar las transferencias pendientes.'), { code: 'relation_list_failed' });
  const eventIds = (data || []).map((row) => String(row.id));
  const { data: links, error: linksError } = eventIds.length
    ? await admin.from('bank_payment_allocations').select('payment_event_id').eq('hotel_id', hotelId).in('payment_event_id', eventIds).not('caja_id', 'is', null)
    : { data: [], error: null };
  if (linksError) throw Object.assign(new Error('No se pudieron validar las transferencias ya conciliadas.'), { code: 'relation_cash_links_failed' });
  const linkedEvents = new Set((links || []).map((row) => String(row.payment_event_id)));
  return (data || []).filter((row) => !linkedEvents.has(String(row.id))).map((row) => ({
    id: String(row.id),
    amountCop: safeAmount(row.amount_cop),
    status: String(row.status),
    senderName: safeSenderName(row.sender_name),
    receivedAt: safeDate(row.email_received_at || row.created_at),
    updatedAt: safeDate(row.updated_at)
  })).filter((row) => row.amountCop > 0);
}

async function listMovementStatuses(admin: ReturnType<typeof buildAdminClient>, hotelId: string, movementIds: string[]) {
  if (!movementIds.length) return {};
  const { data, error } = await admin
    .from('bank_payment_allocations')
    .select('caja_id,payment_event_id,payment_event:bank_payment_events!inner(status,amount_cop,hotel_id)')
    .eq('hotel_id', hotelId)
    .eq('payment_event.hotel_id', hotelId)
    .in('caja_id', movementIds);
  if (error) throw Object.assign(new Error('No se pudo consultar el estado de conciliacion de Caja.'), { code: 'movement_status_lookup_failed' });

  const statuses: Record<string, MovementRelationStatus> = {};
  for (const row of data || []) {
    const event = Array.isArray(row.payment_event) ? row.payment_event[0] : row.payment_event;
    if (!row.caja_id || !event) continue;
    statuses[String(row.caja_id)] = {
      linked: true,
      status: String(event.status || ''),
      paymentEventId: String(row.payment_event_id || ''),
      amountCop: safeAmount(event.amount_cop),
      legacy: false
    };
  }

  const unresolvedIds = movementIds.filter((id) => !statuses[id]);
  if (!unresolvedIds.length) return statuses;

  const [{ data: movementRows, error: movementError }, { data: legacyAllocations, error: legacyError }] = await Promise.all([
    admin
      .from('caja')
      .select('id,monto,concepto,fecha_movimiento,creado_en,reserva_id,venta_tienda_id,venta_restaurante_id,venta_terraza_id')
      .eq('hotel_id', hotelId)
      .in('id', unresolvedIds),
    admin
      .from('bank_payment_allocations')
      .select('payment_event_id,allocation_type,reservation_id,sale_id,sale_type,amount_cop,payment_event:bank_payment_events!inner(status,email_received_at,transaction_occurred_at,created_at,hotel_id)')
      .eq('hotel_id', hotelId)
      .eq('payment_event.hotel_id', hotelId)
      .is('caja_id', null)
  ]);
  if (movementError || legacyError) throw Object.assign(new Error('No se pudo proteger la conciliacion historica de Caja.'), { code: 'legacy_cash_link_lookup_failed' });

  const legacyRows = (legacyAllocations || []) as LegacyAllocationRow[];
  for (const raw of movementRows || []) {
    const movement = raw as CajaRow;
    const matches = legacyRows.filter((allocation) => legacyAllocationMatchesMovement(allocation, movement));
    if (!matches.length) continue;
    const firstEvent = Array.isArray(matches[0].payment_event) ? matches[0].payment_event[0] : matches[0].payment_event;
    statuses[movement.id] = {
      linked: true,
      status: matches.length === 1 ? String(firstEvent?.status || 'manual_review') : 'manual_review',
      paymentEventId: matches.length === 1 ? String(matches[0].payment_event_id || '') : null,
      amountCop: safeAmount(movement.monto),
      legacy: true,
      ambiguous: matches.length > 1
    };
  }

  return statuses;
}

async function listCashCandidates(admin: ReturnType<typeof buildAdminClient>, hotelId: string, event: Awaited<ReturnType<typeof getSafeEvent>>) {
  const methodIds = await getBankMethodIds(admin, hotelId);
  if (!methodIds.length) return [];
  const center = new Date(event.receivedAt || Date.now()).getTime();
  const start = new Date(center - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const end = new Date(center + WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('caja')
    .select('id,monto,concepto,fecha_movimiento,creado_en,reserva_id,venta_tienda_id,venta_restaurante_id,venta_terraza_id')
    .eq('hotel_id', hotelId).eq('tipo', 'ingreso').in('metodo_pago_id', methodIds)
    .gte('fecha_movimiento', start).lte('fecha_movimiento', end).order('fecha_movimiento', { ascending: false }).limit(100);
  if (error) throw Object.assign(new Error('No se pudieron consultar los movimientos de Caja.'), { code: 'cash_candidates_failed' });
  const ids = (data || []).map((row) => String(row.id));
  const used = await listMovementStatuses(admin, hotelId, ids);
  return (data || []).map((raw) => {
    const row = raw as CajaRow;
    if (used[row.id]) return null;
    const target = targetForMovement(row);
    if (!target) return null;
    return { id: row.id, amountCop: target.amountCop, concept: String(row.concepto || 'Movimiento de Caja').slice(0, 180), occurredAt: safeDate(row.fecha_movimiento || row.creado_en), targetType: target.type === 'reservation' ? 'habitacion' : target.saleType };
  }).filter(Boolean);
}

async function buildAllocationsFromMovements(admin: ReturnType<typeof buildAdminClient>, hotelId: string, event: Awaited<ReturnType<typeof getSafeEvent>>, movementIds: string[]) {
  const methodIds = await getBankMethodIds(admin, hotelId);
  if (!methodIds.length) throw new HttpError(409, 'bank_payment_method_missing', 'No hay metodos bancarios configurados.');
  const { data, error } = await admin
    .from('caja')
    .select('id,monto,concepto,fecha_movimiento,creado_en,reserva_id,venta_tienda_id,venta_restaurante_id,venta_terraza_id,metodo_pago_id,tipo')
    .eq('hotel_id', hotelId).eq('tipo', 'ingreso').in('metodo_pago_id', methodIds).in('id', movementIds);
  if (error) throw Object.assign(new Error('No se pudieron validar los movimientos seleccionados.'), { code: 'selected_cash_lookup_failed' });
  if ((data || []).length !== movementIds.length) throw new HttpError(400, 'cash_selection_invalid', 'Uno o mas movimientos seleccionados no son validos para este hotel.');
  const alreadyLinked = await listMovementStatuses(admin, hotelId, movementIds);
  if (Object.keys(alreadyLinked).length) throw new HttpError(409, 'cash_movement_already_reconciled', 'Uno de los movimientos de Caja ya esta conciliado con otra transferencia.');

  const normalized = (data || []).map((raw) => {
    const row = raw as CajaRow;
    const target = targetForMovement(row);
    return target ? { ...target, cajaId: row.id } : null;
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (normalized.length !== movementIds.length) throw new HttpError(400, 'cash_target_invalid', 'Un movimiento no tiene un destino bancario conciliable.');
  const targetKeys = normalized.map((item) => item.type === 'reservation' ? `reservation:${item.reservationId}` : `sale:${item.saleType}:${item.saleId}`);
  if (new Set(targetKeys).size !== targetKeys.length) throw new HttpError(400, 'duplicate_relation_target', 'Hay movimientos repetidos para el mismo destino.');
  const total = normalized.reduce((sum, item) => sum + item.amountCop, 0);
  if (total !== event.amountCop) throw new HttpError(400, 'relation_total_mismatch', `Los movimientos seleccionados deben sumar exactamente ${event.amountCop} COP.`);
  return normalized;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: buildCorsHeaders(origin) });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, origin);

  try {
    const body = await readJsonBody<JsonBody>(req);
    const action = String(body.action || '').trim().toLowerCase();
    const { admin, pilot, context } = await requireOperationalContext(req);

    if (action === 'status') return jsonResponse({ eligible: true, canRelatePayments: true }, 200, origin);
    if (action === 'list') return jsonResponse({ transfers: await listTransfers(admin, pilot.id) }, 200, origin);
    if (action === 'movement-statuses') {
      const rawIds = Array.isArray(body.movementIds) ? body.movementIds : [];
      const movementIds = [...new Set(rawIds.map((value) => requireUuid(value, 'El movimiento de Caja')))];
      return jsonResponse({ statuses: await listMovementStatuses(admin, pilot.id, movementIds.slice(0, 200)) }, 200, origin);
    }
    if (action === 'cash-candidates') {
      const paymentEventId = requireUuid(body.paymentEventId, 'La transferencia');
      const event = await getSafeEvent(admin, pilot.id, paymentEventId);
      return jsonResponse({ transfer: event, movements: await listCashCandidates(admin, pilot.id, event) }, 200, origin);
    }
    if (action === 'relate') {
      const paymentEventId = requireUuid(body.paymentEventId, 'La transferencia');
      const rawIds = Array.isArray(body.movementIds) ? body.movementIds : [];
      const movementIds = [...new Set(rawIds.map((value) => requireUuid(value, 'El movimiento de Caja')))];
      if (!movementIds.length || movementIds.length > MAX_MOVEMENTS) throw new HttpError(400, 'movement_selection_required', `Selecciona entre 1 y ${MAX_MOVEMENTS} movimientos de Caja.`);
      const reason = requireReason(body.reason);
      const event = await getSafeEvent(admin, pilot.id, paymentEventId);
      const allocations = await buildAllocationsFromMovements(admin, pilot.id, event, movementIds);
      const { error } = await admin.rpc('replace_bank_payment_allocations_from_caja', {
        p_payment_event_id: paymentEventId,
        p_actor_id: context.user.id,
        p_allocations: allocations,
        p_action: 'link',
        p_review_reason: reason,
        p_pilot_hotel_name: pilot.nombre
      });
      if (error) {
        if (String(error.code || '') === '23505') throw new HttpError(409, 'cash_movement_already_reconciled', 'Ese movimiento de Caja ya fue conciliado con otra transferencia.');
        throw Object.assign(new Error('No se pudo guardar la relacion bancaria.'), { code: String(error.code || 'relation_rpc_failed').toLowerCase() });
      }
      return jsonResponse({ ok: true, status: 'matched', paymentEventId, allocationCount: allocations.length, amountCop: event.amountCop }, 200, origin);
    }

    throw new HttpError(400, 'unsupported_action', 'Accion no soportada.');
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return jsonResponse({ error: safeErrorCode(error), message: safeErrorMessage(error) }, status, origin);
  }
});