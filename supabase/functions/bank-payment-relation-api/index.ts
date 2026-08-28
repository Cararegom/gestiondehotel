import { assertBankEmailConfig, isBankEmailProcessingEnabled, readBankEmailConfig } from '../_shared/bank-email/config.ts';
import { buildCorsHeaders, HttpError, jsonResponse, readJsonBody, safeErrorCode, safeErrorMessage } from '../_shared/bank-email/http.ts';
import { getPilotHotel } from '../_shared/bank-email/pilot-hotel.ts';
import { isBankReconciliationPaymentMethod } from '../_shared/bank-email/sale-reconciliation.ts';
import { buildAdminClient, isPilotOperationalUser, requireAuthenticatedProfile } from '../_shared/bank-email/server.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RELATABLE_STATUSES = ['detected', 'matched', 'manual_review'];
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

function requireUuid(value: unknown, label: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new HttpError(400, 'invalid_uuid', `${label} no es valido.`);
  }
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

function targetForMovement(row: CajaRow): { type: 'reservation'; reservationId: string; amountCop: number } | { type: 'sale'; saleId: string; saleType: string; amountCop: number } | null {
  const amountCop = safeAmount(row.monto);
  if (!amountCop) return null;
  const targets: Array<{ kind: string; id: string }> = [];
  if (row.reserva_id) targets.push({ kind: 'reservation', id: row.reserva_id });
  if (row.venta_tienda_id) targets.push({ kind: 'tienda', id: row.venta_tienda_id });
  if (row.venta_restaurante_id) targets.push({ kind: 'restaurante', id: row.venta_restaurante_id });
  if (row.venta_terraza_id) targets.push({ kind: 'terraza', id: row.venta_terraza_id });
  if (targets.length !== 1 || !UUID_PATTERN.test(targets[0].id)) return null;
  if (targets[0].kind === 'reservation') {
    return { type: 'reservation', reservationId: targets[0].id, amountCop };
  }
  return { type: 'sale', saleId: targets[0].id, saleType: targets[0].kind, amountCop };
}

async function requireOperationalContext(req: Request) {
  const config = readBankEmailConfig();
  assertBankEmailConfig(config);
  if (!isBankEmailProcessingEnabled(config)) {
    throw new HttpError(403, 'bank_integration_disabled', 'La integracion bancaria no esta habilitada.');
  }
  const admin = buildAdminClient();
  const pilot = await getPilotHotel(admin, config.pilotHotelName, config.pilotHotelId);
  const context = await requireAuthenticatedProfile(req, admin);
  if (context.profile.hotel_id !== pilot.id || !(await isPilotOperationalUser(admin, context, pilot.id))) {
    throw new HttpError(403, 'operational_role_required', 'Esta accion requiere recepcion o administracion del hotel piloto.');
  }
  return { admin, pilot, context };
}

async function getBankMethodIds(admin: ReturnType<typeof buildAdminClient>, hotelId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('metodos_pago')
    .select('id,nombre')
    .eq('hotel_id', hotelId)
    .eq('activo', true);
  if (error) throw Object.assign(new Error('No se pudieron consultar los metodos de pago.'), { code: 'payment_methods_lookup_failed' });
  return (data || [])
    .filter((row) => isBankReconciliationPaymentMethod(row.nombre))
    .map((row) => String(row.id));
}

async function getSafeEvent(admin: ReturnType<typeof buildAdminClient>, hotelId: string, paymentEventId: string) {
  const { data, error } = await admin
    .from('bank_payment_events')
    .select('id,amount_cop,status,email_received_at,created_at,updated_at')
    .eq('hotel_id', hotelId)
    .eq('id', paymentEventId)
    .maybeSingle();
  if (error) throw Object.assign(new Error('No se pudo consultar la transferencia.'), { code: 'payment_event_lookup_failed' });
  if (!data || !RELATABLE_STATUSES.includes(String(data.status))) {
    throw new HttpError(409, 'payment_not_relatable', 'La transferencia ya no admite relacion desde recepcion.');
  }
  const amountCop = safeAmount(data.amount_cop);
  if (!amountCop) throw new HttpError(409, 'payment_amount_invalid', 'El valor de la transferencia no es valido.');
  return {
    id: String(data.id),
    amountCop,
    status: String(data.status),
    receivedAt: safeDate(data.email_received_at || data.created_at),
    updatedAt: safeDate(data.updated_at)
  };
}

async function listTransfers(admin: ReturnType<typeof buildAdminClient>, hotelId: string) {
  const { data, error } = await admin
    .from('bank_payment_events')
    .select('id,amount_cop,status,email_received_at,created_at,updated_at')
    .eq('hotel_id', hotelId)
    .in('status', RELATABLE_STATUSES)
    .order('email_received_at', { ascending: false, nullsFirst: false })
    .limit(30);
  if (error) throw Object.assign(new Error('No se pudieron consultar las transferencias pendientes.'), { code: 'relation_list_failed' });
  return (data || []).map((row) => ({
    id: String(row.id),
    amountCop: safeAmount(row.amount_cop),
    status: String(row.status),
    receivedAt: safeDate(row.email_received_at || row.created_at),
    updatedAt: safeDate(row.updated_at)
  })).filter((row) => row.amountCop > 0);
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
    .eq('hotel_id', hotelId)
    .eq('tipo', 'ingreso')
    .in('metodo_pago_id', methodIds)
    .gte('fecha_movimiento', start)
    .lte('fecha_movimiento', end)
    .order('fecha_movimiento', { ascending: false })
    .limit(100);
  if (error) throw Object.assign(new Error('No se pudieron consultar los movimientos de Caja.'), { code: 'cash_candidates_failed' });

  return (data || []).map((raw) => {
    const row = raw as CajaRow;
    const target = targetForMovement(row);
    if (!target) return null;
    return {
      id: row.id,
      amountCop: target.amountCop,
      concept: String(row.concepto || 'Movimiento de Caja').slice(0, 180),
      occurredAt: safeDate(row.fecha_movimiento || row.creado_en),
      targetType: target.type === 'reservation' ? 'habitacion' : target.saleType
    };
  }).filter(Boolean);
}

async function buildAllocationsFromMovements(
  admin: ReturnType<typeof buildAdminClient>,
  hotelId: string,
  event: Awaited<ReturnType<typeof getSafeEvent>>,
  movementIds: string[]
) {
  const methodIds = await getBankMethodIds(admin, hotelId);
  if (!methodIds.length) throw new HttpError(409, 'bank_payment_method_missing', 'No hay metodos bancarios configurados.');
  const { data, error } = await admin
    .from('caja')
    .select('id,monto,concepto,fecha_movimiento,creado_en,reserva_id,venta_tienda_id,venta_restaurante_id,venta_terraza_id,metodo_pago_id,tipo')
    .eq('hotel_id', hotelId)
    .eq('tipo', 'ingreso')
    .in('metodo_pago_id', methodIds)
    .in('id', movementIds);
  if (error) throw Object.assign(new Error('No se pudieron validar los movimientos seleccionados.'), { code: 'selected_cash_lookup_failed' });
  if ((data || []).length !== movementIds.length) {
    throw new HttpError(400, 'cash_selection_invalid', 'Uno o mas movimientos seleccionados no son validos para este hotel.');
  }

  const allocations = (data || []).map((raw) => targetForMovement(raw as CajaRow));
  if (allocations.some((item) => !item)) {
    throw new HttpError(400, 'cash_target_invalid', 'Un movimiento no tiene un destino bancario conciliable.');
  }
  const normalized = allocations.filter((item): item is NonNullable<typeof item> => Boolean(item));
  const targetKeys = normalized.map((item) => item.type === 'reservation'
    ? `reservation:${item.reservationId}`
    : `sale:${item.saleType}:${item.saleId}`);
  if (new Set(targetKeys).size !== targetKeys.length) {
    throw new HttpError(400, 'duplicate_relation_target', 'Hay movimientos repetidos para el mismo destino.');
  }
  const total = normalized.reduce((sum, item) => sum + item.amountCop, 0);
  if (total !== event.amountCop) {
    throw new HttpError(400, 'relation_total_mismatch', `Los movimientos seleccionados deben sumar exactamente ${event.amountCop} COP.`);
  }
  return normalized;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: buildCorsHeaders(origin) });
  }
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, origin);

  try {
    const body = await readJsonBody<JsonBody>(req);
    const action = String(body.action || '').trim().toLowerCase();
    const { admin, pilot, context } = await requireOperationalContext(req);

    if (action === 'status') {
      return jsonResponse({ eligible: true, canRelatePayments: true }, 200, origin);
    }

    if (action === 'list') {
      return jsonResponse({ transfers: await listTransfers(admin, pilot.id) }, 200, origin);
    }

    if (action === 'cash-candidates') {
      const paymentEventId = requireUuid(body.paymentEventId, 'La transferencia');
      const event = await getSafeEvent(admin, pilot.id, paymentEventId);
      const movements = await listCashCandidates(admin, pilot.id, event);
      return jsonResponse({ transfer: event, movements }, 200, origin);
    }

    if (action === 'relate') {
      const paymentEventId = requireUuid(body.paymentEventId, 'La transferencia');
      const rawIds = Array.isArray(body.movementIds) ? body.movementIds : [];
      const movementIds = [...new Set(rawIds.map((value) => requireUuid(value, 'El movimiento de Caja')))];
      if (!movementIds.length || movementIds.length > MAX_MOVEMENTS) {
        throw new HttpError(400, 'movement_selection_required', `Selecciona entre 1 y ${MAX_MOVEMENTS} movimientos de Caja.`);
      }
      const reason = requireReason(body.reason);
      const event = await getSafeEvent(admin, pilot.id, paymentEventId);
      const allocations = await buildAllocationsFromMovements(admin, pilot.id, event, movementIds);
      const { error } = await admin.rpc('replace_bank_payment_allocations', {
        p_payment_event_id: paymentEventId,
        p_actor_id: context.user.id,
        p_allocations: allocations,
        p_action: 'link',
        p_review_reason: reason,
        p_pilot_hotel_name: pilot.nombre
      });
      if (error) {
        throw Object.assign(new Error('No se pudo guardar la relacion bancaria.'), {
          code: String(error.code || 'relation_rpc_failed').toLowerCase()
        });
      }
      return jsonResponse({
        ok: true,
        status: 'matched',
        paymentEventId,
        allocationCount: allocations.length,
        amountCop: event.amountCop
      }, 200, origin);
    }

    throw new HttpError(400, 'unsupported_action', 'Accion no soportada.');
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return jsonResponse({ error: safeErrorCode(error), message: safeErrorMessage(error) }, status, origin);
  }
});
