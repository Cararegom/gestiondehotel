import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0';
import {
  assertSamePilotHotel,
  buildAdminClient,
  isPilotAdministrator,
  requireAuthenticatedProfile,
  requirePilotAdministrator,
  type AuthenticatedRequestContext
} from '../_shared/bank-email/server.ts';
import { getPilotHotel } from '../_shared/bank-email/pilot-hotel.ts';
import { readBankEmailConfig, assertBankEmailConfig } from '../_shared/bank-email/config.ts';
import { buildCorsHeaders, HttpError, jsonResponse, readJsonBody, safeErrorCode, safeErrorMessage } from '../_shared/bank-email/http.ts';
import { createOAuthState, hashOAuthState } from '../_shared/bank-email/oauth-state.ts';
import { buildGoogleAuthorizationUrl, revokeGoogleToken } from '../_shared/bank-email/google-oauth.ts';
import {
  getBankEmailIntegration,
  getValidGmailAccessToken,
  renewGmailWatch,
  recordWatchFailure
} from '../_shared/bank-email/integration-service.ts';
import { getGmailProfile, stopGmailWatch } from '../_shared/bank-email/gmail-api.ts';
import { decryptToken, getTokenEncryptionKey } from '../_shared/bank-email/token-crypto.ts';
import { parseGmailMessage } from '../_shared/bank-email/gmail-message.ts';
import { analyzeBankEmail } from '../_shared/bank-email/payment-service.ts';
import { maskReference } from '../_shared/bank-email/security.ts';

const PAYMENT_STATUSES = new Set(['detected', 'matched', 'confirmed', 'manual_review', 'rejected', 'duplicated']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const EVENT_PAGE_SIZE = 100;
const EVENT_PAGE_SIZE_MAX = 200;

interface RequestBody extends Record<string, unknown> {
  action?: unknown;
}

const CLIENT_EVENT_COLUMNS = [
  'id', 'hotel_id', 'provider', 'bank_name', 'transaction_reference', 'sender_name',
  'amount_cop', 'email_received_at', 'detected_at', 'status',
  'matched_reservation_id', 'matched_room_id', 'matched_sale_id', 'matched_sale_type',
  'matched_expected_payment_id', 'parser_version', 'review_reason', 'metadata',
  'reviewed_by', 'reviewed_at', 'confirmed_by', 'confirmed_at', 'created_at', 'updated_at'
].join(', ');

function safeRelatedUser(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  return { id: row.id || null, nombre: row.nombre || null };
}

function clientSafeEvent(row: Record<string, unknown>): Record<string, unknown> {
  const metadata = row.metadata && typeof row.metadata === 'object'
    ? row.metadata as Record<string, unknown>
    : {};
  const safe = { ...row };
  for (const field of [
    'transaction_reference', 'transaction_fingerprint', 'gmail_message_id',
    'gmail_thread_id', 'raw_content_hash', 'email_subject', 'integration_id',
    'sender_email'
  ]) delete safe[field];
  safe.transaction_reference_masked = maskReference(String(row.transaction_reference || ''));
  safe.metadata = {
    is_test: metadata.is_test === true,
    source: typeof metadata.source === 'string' ? metadata.source : null
  };
  safe.confirmed_by_user = safeRelatedUser(row.confirmed_by_user);
  safe.reviewed_by_user = safeRelatedUser(row.reviewed_by_user);
  return safe;
}

function asString(value: unknown, maxLength = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function asUuid(value: unknown): string | null {
  const normalized = asString(value, 80);
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function requireUuid(value: unknown, code: string): string {
  const id = asUuid(value);
  if (!id) throw new HttpError(400, code, 'El identificador no es valido.');
  return id;
}

function optionalUuid(value: unknown, code: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const id = asUuid(value);
  if (!id) throw new HttpError(400, code, 'El identificador no es valido.');
  return id;
}

function uniqueIds(values: unknown[]): string[] {
  return [...new Set(values.map(asUuid).filter((value): value is string => Boolean(value)))];
}

async function writeAudit(
  admin: SupabaseClient,
  hotelId: string,
  userId: string | null,
  action: string,
  details: Record<string, unknown> = {},
  paymentEventId: string | null = null
): Promise<void> {
  const { error } = await admin.from('bank_payment_audit_log').insert({
    hotel_id: hotelId,
    user_id: userId,
    action,
    payment_event_id: paymentEventId,
    details
  });
  if (error) console.error('[bank-email-audit]', { code: 'audit_write_failed', action });
}

async function enrichEvents(admin: SupabaseClient, pilotHotelId: string, rows: Record<string, unknown>[]) {
  const reservationIds = uniqueIds(rows.map((row) => row.matched_reservation_id));
  const roomIds = uniqueIds(rows.map((row) => row.matched_room_id));
  const userIds = uniqueIds(rows.flatMap((row) => [row.confirmed_by, row.reviewed_by]));

  const [reservationsResult, roomsResult, usersResult] = await Promise.all([
    reservationIds.length
      ? admin.from('reservas').select('id, cliente_nombre, habitacion_id, estado').eq('hotel_id', pilotHotelId).in('id', reservationIds)
      : Promise.resolve({ data: [], error: null }),
    roomIds.length
      ? admin.from('habitaciones').select('id, nombre, estado').eq('hotel_id', pilotHotelId).in('id', roomIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? admin.from('usuarios').select('id, nombre, correo, email').eq('hotel_id', pilotHotelId).in('id', userIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (reservationsResult.error || roomsResult.error || usersResult.error) {
    throw Object.assign(new Error('No se pudieron cargar las relaciones de los pagos.'), {
      code: 'payment_relations_lookup_failed'
    });
  }

  const reservations = new Map((reservationsResult.data || []).map((item) => [item.id, item]));
  const rooms = new Map((roomsResult.data || []).map((item) => [item.id, item]));
  const users = new Map((usersResult.data || []).map((item) => [item.id, item]));
  return rows.map((row) => ({
    ...row,
    matched_reservation: reservations.get(String(row.matched_reservation_id || '')) || null,
    matched_room: rooms.get(String(row.matched_room_id || '')) || null,
    confirmed_by_user: users.get(String(row.confirmed_by || '')) || null,
    reviewed_by_user: users.get(String(row.reviewed_by || '')) || null
  }));
}

async function listEvents(
  admin: SupabaseClient,
  pilotHotelId: string,
  body: RequestBody,
  singleId?: string
) {
  const offset = singleId ? 0 : boundedInteger(body.offset, 0, 0, 1_000_000);
  const limit = singleId ? 1 : boundedInteger(body.limit, EVENT_PAGE_SIZE, 1, EVENT_PAGE_SIZE_MAX);
  let query = admin
    .from('bank_payment_events')
    .select(CLIENT_EVENT_COLUMNS)
    .eq('hotel_id', pilotHotelId)
    .order('email_received_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false });
  if (singleId) query = query.eq('id', singleId);
  const status = asString(body.status, 40);
  if (status && PAYMENT_STATUSES.has(status)) query = query.eq('status', status);
  const dateFrom = asString(body.dateFrom, 10);
  const dateTo = asString(body.dateTo, 10);
  if (ISO_DAY_PATTERN.test(dateFrom)) query = query.gte('email_received_at', `${dateFrom}T00:00:00-05:00`);
  if (ISO_DAY_PATTERN.test(dateTo)) {
    const exclusiveEnd = new Date(`${dateTo}T00:00:00-05:00`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    query = query.lt('email_received_at', exclusiveEnd.toISOString());
  }
  query = query.range(offset, offset + limit);
  const { data, error } = await query;
  if (error) throw Object.assign(new Error('No se pudieron consultar los pagos bancarios.'), { code: 'payment_list_failed' });
  const rows = (data || []) as unknown as Record<string, unknown>[];
  const hasMore = !singleId && rows.length > limit;
  const visibleRows = rows.slice(0, limit);
  const enriched = await enrichEvents(admin, pilotHotelId, visibleRows);
  return {
    events: enriched.map(clientSafeEvent),
    hasMore,
    nextOffset: hasMore ? offset + visibleRows.length : null,
    limit
  };
}

async function getCandidates(admin: SupabaseClient, pilotHotelId: string, paymentEventId?: string) {
  let matchedExpectedPaymentId: string | null = null;
  let candidateAmountCop: number | null = null;
  let candidatePaymentTime = Date.now();
  if (paymentEventId) {
    const { data: event, error: eventError } = await admin
      .from('bank_payment_events')
      .select('id, hotel_id, matched_expected_payment_id, amount_cop, transaction_occurred_at, email_received_at, detected_at')
      .eq('id', paymentEventId)
      .eq('hotel_id', pilotHotelId)
      .maybeSingle();
    if (eventError || !event || event.hotel_id !== pilotHotelId) {
      throw new HttpError(404, 'payment_event_not_found', 'El pago bancario no existe.');
    }
    matchedExpectedPaymentId = event.matched_expected_payment_id;
    candidateAmountCop = Number(event.amount_cop);
    candidatePaymentTime = new Date(
      event.transaction_occurred_at || event.email_received_at || event.detected_at
    ).getTime();
    if (!Number.isFinite(candidatePaymentTime)) candidatePaymentTime = Date.now();
  }

  const activeReservationStates = ['activa', 'check_in', 'ocupada', 'pendiente', 'reservada', 'confirmada', 'tiempo agotado'];
  let expectedQuery = admin
    .from('expected_payments')
    .select('id, reservation_id, room_id, sale_id, sale_type, expected_amount_cop, payment_method, status, expires_at, created_at')
    .eq('hotel_id', pilotHotelId)
    .in('payment_method', ['llave', 'transferencia'])
    .order('created_at', { ascending: false })
    .limit(120);
  expectedQuery = matchedExpectedPaymentId
    ? expectedQuery.or(`status.eq.pending,id.eq.${matchedExpectedPaymentId}`)
    : expectedQuery.eq('status', 'pending');
  const [reservationsResult, paymentsResult, roomsResult, expectedResult, pendingExpectedResult, directCommittedResult, storeSalesResult, restaurantSalesResult, salesResult, terraceSalesResult] = await Promise.all([
    admin.from('reservas')
      .select('id, cliente_nombre, habitacion_id, monto_total, monto_pagado, estado, fecha_inicio, creado_en')
      .eq('hotel_id', pilotHotelId)
      .in('estado', activeReservationStates)
      .order('creado_en', { ascending: false })
      .limit(120),
    admin.from('pagos_reserva').select('reserva_id, monto').eq('hotel_id', pilotHotelId),
    admin.from('habitaciones').select('id, nombre, estado').eq('hotel_id', pilotHotelId).eq('activo', true).order('nombre'),
    expectedQuery,
    admin.from('expected_payments')
      .select('reservation_id, expected_amount_cop, status, expires_at')
      .eq('hotel_id', pilotHotelId)
      .in('status', ['pending', 'matched', 'confirmed']),
    admin.from('bank_payment_events')
      .select('matched_reservation_id, amount_cop')
      .eq('hotel_id', pilotHotelId)
      .in('status', ['matched', 'confirmed'])
      .is('matched_expected_payment_id', null),
    admin.from('ventas_tienda').select('id, total_venta, estado_pago, fecha, cliente_temporal').eq('hotel_id', pilotHotelId).or('estado_pago.is.null,estado_pago.neq.pagado').order('fecha', { ascending: false }).limit(50),
    admin.from('ventas_restaurante').select('id, monto_total, total_venta, estado_pago, fecha, nombre_cliente_temporal').eq('hotel_id', pilotHotelId).or('estado_pago.is.null,estado_pago.neq.pagado').order('fecha', { ascending: false }).limit(50),
    admin.from('ventas').select('id, total, fecha_venta').eq('hotel_id', pilotHotelId).order('fecha_venta', { ascending: false }).limit(50),
    admin.from('terraza_pedidos').select('id, total, estado, fecha_apertura, cliente_nombre').eq('hotel_id', pilotHotelId).eq('estado', 'abierto').order('fecha_apertura', { ascending: false }).limit(50)
  ]);
  const results = [reservationsResult, paymentsResult, roomsResult, expectedResult, pendingExpectedResult, directCommittedResult, storeSalesResult, restaurantSalesResult, salesResult, terraceSalesResult];
  if (results.some((result) => result.error)) {
    throw Object.assign(new Error('No se pudieron consultar las opciones de relacion.'), { code: 'candidate_lookup_failed' });
  }

  const storeSaleIds = (storeSalesResult.data || []).map((sale) => sale.id);
  const { data: storeDetails, error: storeDetailsError } = storeSaleIds.length
    ? await admin.from('detalle_ventas_tienda')
      .select('venta_id, producto_id, cantidad, precio_unitario_venta, subtotal')
      .eq('hotel_id', pilotHotelId)
      .in('venta_id', storeSaleIds)
    : { data: [], error: null };
  if (storeDetailsError) console.error('[bank-email-api]', { code: 'store_sale_details_lookup_failed' });
  const safeStoreDetails = storeDetailsError ? [] : (storeDetails || []);
  const productIds = uniqueIds(safeStoreDetails.map((detail) => detail.producto_id));
  const { data: storeProducts, error: storeProductsError } = productIds.length
    ? await admin.from('productos_tienda')
      .select('id, nombre')
      .eq('hotel_id', pilotHotelId)
      .in('id', productIds)
    : { data: [], error: null };
  if (storeProductsError) console.error('[bank-email-api]', { code: 'store_products_lookup_failed' });
  const storeProductNames = new Map((storeProductsError ? [] : (storeProducts || [])).map((product) => [product.id, product.nombre]));
  const storeItemsBySale = new Map<string, Record<string, unknown>[]>();
  for (const detail of safeStoreDetails) {
    const item = {
      product_id: detail.producto_id,
      name: storeProductNames.get(detail.producto_id) || 'Producto',
      quantity: Number(detail.cantidad || 0),
      unit_price: Number(detail.precio_unitario_venta || 0),
      subtotal: Number(detail.subtotal || 0)
    };
    storeItemsBySale.set(detail.venta_id, [...(storeItemsBySale.get(detail.venta_id) || []), item]);
  }

  const paidByReservation = new Map<string, number>();
  for (const payment of paymentsResult.data || []) {
    paidByReservation.set(
      payment.reserva_id,
      (paidByReservation.get(payment.reserva_id) || 0) + Number(payment.monto || 0)
    );
  }
  const pendingExpectedByReservation = new Map<string, number>();
  const now = Date.now();
  for (const expected of pendingExpectedResult.data || []) {
    const expiration = expected.expires_at ? new Date(expected.expires_at).getTime() : Number.POSITIVE_INFINITY;
    if (!expected.reservation_id || (expected.status === 'pending' && expiration < now)) continue;
    pendingExpectedByReservation.set(
      expected.reservation_id,
      (pendingExpectedByReservation.get(expected.reservation_id) || 0) + Number(expected.expected_amount_cop || 0)
    );
  }
  const roomMap = new Map((roomsResult.data || []).map((room) => [room.id, room]));
  const reservations = (reservationsResult.data || []).map((reservation) => {
    const directCommitted = (directCommittedResult.data || []).reduce((total, event) => {
      const relatesDirectly = event.matched_reservation_id === reservation.id;
      return total + (relatesDirectly ? Number(event.amount_cop || 0) : 0);
    }, 0);
    return {
      ...reservation,
      room: roomMap.get(reservation.habitacion_id) || null,
      outstanding_amount_cop: Math.max(0, Math.floor(
        Number(reservation.monto_total || 0) - Math.max(
        Number(reservation.monto_pagado || 0),
        paidByReservation.get(reservation.id) || 0
        ) - (pendingExpectedByReservation.get(reservation.id) || 0) - directCommitted
      ))
    };
  });
  const sales: Array<Record<string, unknown>> = [
    ...(storeSalesResult.data || []).map((sale) => {
      const items = storeItemsBySale.get(sale.id) || [];
      const itemLabel = items.map((item) => `${item.quantity} x ${item.name}`).join(' + ');
      return { ...sale, items, sale_type: 'tienda', label: `Tienda · ${itemLabel || sale.cliente_temporal || 'Venta sin detalle'}` };
    }),
    ...(restaurantSalesResult.data || []).map((sale) => ({ ...sale, sale_type: 'restaurante', label: `Restaurante · ${sale.nombre_cliente_temporal || sale.id}` })),
    ...(salesResult.data || []).map((sale) => ({ ...sale, sale_type: 'venta', label: `Venta · ${sale.id}` }))
  ];

  sales.push(
    ...(terraceSalesResult.data || []).map((sale) => ({
      ...sale,
      sale_type: 'terraza',
      label: `Terraza - ${sale.cliente_nombre || sale.id}`
    }))
  );

  const expectedPayments = (expectedResult.data || []).filter((item) => {
    if (item.id === matchedExpectedPaymentId) return true;
    const expiration = item.expires_at
      ? new Date(item.expires_at).getTime()
      : Number.POSITIVE_INFINITY;
    if (!paymentEventId) return expiration >= now;
    const createdAt = new Date(item.created_at).getTime();
    const withinMaximumWindow = Number.isFinite(createdAt)
      && createdAt >= candidatePaymentTime - 86_400_000
      && createdAt <= candidatePaymentTime + 86_400_000;
    return Number(item.expected_amount_cop) === candidateAmountCop
      && expiration >= candidatePaymentTime
      && withinMaximumWindow;
  });
  if (
    matchedExpectedPaymentId &&
    !expectedPayments.some((item) => item.id === matchedExpectedPaymentId)
  ) {
    const { data: currentExpected, error: currentExpectedError } = await admin
      .from('expected_payments')
      .select('id, reservation_id, room_id, sale_id, sale_type, expected_amount_cop, payment_method, status, expires_at, created_at')
      .eq('id', matchedExpectedPaymentId)
      .eq('hotel_id', pilotHotelId)
      .maybeSingle();
    if (currentExpectedError) {
      throw Object.assign(new Error('No se pudo consultar el pago esperado actual.'), { code: 'current_expected_payment_lookup_failed' });
    }
    if (currentExpected) expectedPayments.push(currentExpected);
  }

  return {
    reservations,
    rooms: roomsResult.data || [],
    sales,
    expectedPayments
  };
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function createSimulatedGmailMessage(body: RequestBody) {
  const subject = asString(body.subject, 500);
  const content = asString(body.body, 100_000);
  if (!subject || !content) throw new HttpError(400, 'simulation_content_required', 'Asunto y contenido son requeridos.');
  const from = asString(body.from, 320) || 'simulacion@example.invalid';
  const returnPath = asString(body.returnPath, 320);
  const authenticationResults = asString(body.authenticationResults, 4000);
  const received = asString(body.receivedAt, 80);
  const receivedAt = received && !Number.isNaN(new Date(received).getTime()) ? new Date(received) : new Date();
  const headers = [
    { name: 'Subject', value: subject },
    { name: 'From', value: from },
    { name: 'Date', value: receivedAt.toUTCString() }
  ];
  if (returnPath) headers.push({ name: 'Return-Path', value: returnPath });
  if (authenticationResults) headers.push({ name: 'Authentication-Results', value: authenticationResults });
  return parseGmailMessage({
    id: `simulation-${crypto.randomUUID()}`,
    threadId: null,
    historyId: null,
    internalDate: String(receivedAt.getTime()),
    labelIds: ['SIMULATION'],
    payload: {
      mimeType: 'text/plain',
      headers,
      body: { data: base64UrlEncode(content), size: content.length }
    }
  });
}

async function handlePilotAction(
  body: RequestBody,
  admin: SupabaseClient,
  context: AuthenticatedRequestContext
): Promise<Record<string, unknown>> {
  const config = readBankEmailConfig();
  assertBankEmailConfig(config);
  const pilotHotel = await getPilotHotel(admin, config.pilotHotelName);
  const action = asString(body.action, 80);

  if (action === 'pilot-status') {
    const eligible = context.profile.hotel_id === pilotHotel.id;
    return {
      eligible,
      integrationEnabled: config.enabled,
      isAdmin: eligible ? await isPilotAdministrator(admin, context, pilotHotel.id) : false,
      pilotHotelName: eligible ? pilotHotel.nombre : null
    };
  }

  assertSamePilotHotel(context, pilotHotel.id);

  if (action === 'list') {
    const page = await listEvents(admin, pilotHotel.id, body);
    return {
      events: page.events,
      pagination: { hasMore: page.hasMore, nextOffset: page.nextOffset, limit: page.limit }
    };
  }
  if (action === 'detail') {
    const paymentEventId = requireUuid(body.paymentEventId, 'invalid_payment_event_id');
    const { events: [event] } = await listEvents(admin, pilotHotel.id, body, paymentEventId);
    if (!event) throw new HttpError(404, 'payment_event_not_found', 'El pago bancario no existe.');
    return { event };
  }
  if (action === 'candidates') {
    const paymentEventId = requireUuid(body.paymentEventId, 'invalid_payment_event_id');
    return { candidates: await getCandidates(admin, pilotHotel.id, paymentEventId) };
  }
  if (action === 'manual-action') {
    if (!config.enabled) {
      throw new HttpError(409, 'bank_email_integration_disabled', 'La integracion bancaria esta deshabilitada.');
    }
    const paymentEventId = requireUuid(body.paymentEventId, 'invalid_payment_event_id');
    const requestedAction = asString(body.manualAction, 40);
    const actionMap: Record<string, string> = {
      relate: 'link',
      confirm: 'confirm',
      reject: 'reject',
      review: 'mark_reviewed'
    };
    const databaseAction = actionMap[requestedAction];
    if (!databaseAction) throw new HttpError(400, 'invalid_manual_action', 'La accion manual no esta permitida.');
    const allocations = Array.isArray(body.allocations) ? body.allocations : [];
    if (allocations.length && ['link', 'confirm'].includes(databaseAction)) {
      await requirePilotAdministrator(admin, context, pilotHotel.id);
      const normalizedAllocations = allocations.map((allocation) => {
        if (!allocation || typeof allocation !== 'object') throw new HttpError(400, 'invalid_allocation', 'La distribucion contiene un elemento invalido.');
        const row = allocation as Record<string, unknown>;
        const type = asString(row.type, 20).toLowerCase();
        const amountCop = Number(row.amountCop);
        if (!Number.isSafeInteger(amountCop) || amountCop <= 0) throw new HttpError(400, 'invalid_allocation_amount', 'Cada valor distribuido debe ser mayor que cero.');
        if (type === 'reservation') return { type, reservationId: requireUuid(row.reservationId, 'invalid_reservation_id'), amountCop };
        if (type === 'sale') {
          const saleType = asString(row.saleType, 20).toLowerCase();
          if (!['venta', 'tienda', 'restaurante', 'terraza'].includes(saleType)) throw new HttpError(400, 'invalid_sale_type', 'El tipo de venta no es valido.');
          return { type, saleId: requireUuid(row.saleId, 'invalid_sale_id'), saleType, amountCop };
        }
        throw new HttpError(400, 'invalid_allocation_type', 'El tipo de distribucion no es valido.');
      });
      const { data, error } = await admin.rpc('replace_bank_payment_allocations', {
        p_payment_event_id: paymentEventId,
        p_actor_id: context.user.id,
        p_allocations: normalizedAllocations,
        p_action: databaseAction,
        p_review_reason: asString(body.reviewReason, 500) || null,
        p_pilot_hotel_name: config.pilotHotelName
      });
      if (error) throw Object.assign(new Error(error.message || 'No se pudo distribuir el pago bancario.'), { code: 'multiple_allocation_failed' });
      const result = data && typeof data === 'object' ? data as Record<string, unknown> : {};
      return { result: { ...result, payment_event: result.payment_event && typeof result.payment_event === 'object' ? clientSafeEvent(result.payment_event as Record<string, unknown>) : null } };
    }
    const reservationId = optionalUuid(body.reservationId, 'invalid_reservation_id');
    const roomId = optionalUuid(body.roomId, 'invalid_room_id');
    const saleId = optionalUuid(body.saleId, 'invalid_sale_id');
    const expectedPaymentId = optionalUuid(body.expectedPaymentId, 'invalid_expected_payment_id');
    const saleType = asString(body.saleType, 80).toLowerCase() || null;
    if (Boolean(saleId) !== Boolean(saleType)) {
      throw new HttpError(400, 'invalid_sale_target', 'La venta y su tipo deben enviarse juntos.');
    }
    if (saleType && !['venta', 'tienda', 'restaurante', 'terraza'].includes(saleType)) {
      throw new HttpError(400, 'invalid_sale_type', 'El tipo de venta no es valido.');
    }
    if (saleId && (reservationId || roomId) && !expectedPaymentId) {
      throw new HttpError(400, 'ambiguous_relation_target', 'Selecciona una venta o una reserva/habitacion, no ambas.');
    }
    const { data, error } = await admin.rpc('review_bank_payment_event', {
      p_payment_event_id: paymentEventId,
      p_action: databaseAction,
      p_actor_id: context.user.id,
      p_reservation_id: reservationId,
      p_room_id: roomId,
      p_sale_id: saleId,
      p_sale_type: saleType,
      p_expected_payment_id: expectedPaymentId,
      p_review_reason: asString(body.reviewReason, 500) || null,
      p_pilot_hotel_name: config.pilotHotelName
    });
    if (error) throw Object.assign(new Error('No se pudo actualizar el pago bancario.'), { code: 'manual_action_failed' });
    const result = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    const paymentEvent = result.payment_event && typeof result.payment_event === 'object'
      ? clientSafeEvent(result.payment_event as Record<string, unknown>)
      : null;
    return { result: { ...result, payment_event: paymentEvent } };
  }
  if (action === 'simulate') {
    await requirePilotAdministrator(admin, context, pilotHotel.id);
    const email = createSimulatedGmailMessage(body);
    return analyzeBankEmail(admin, pilotHotel, email, config, {
      save: body.save === true,
      isTest: true,
      source: 'simulation',
      userId: context.user.id
    });
  }

  await requirePilotAdministrator(admin, context, pilotHotel.id);
  if (action === 'expected-payment-options') {
    return { candidates: await getCandidates(admin, pilotHotel.id) };
  }
  if (action === 'create-expected-payment') {
    if (!config.enabled) {
      throw new HttpError(409, 'bank_email_integration_disabled', 'La integracion bancaria esta deshabilitada.');
    }
    const operationId = requireUuid(body.operationId, 'invalid_operation_id');
    const reservationId = requireUuid(body.reservationId, 'invalid_reservation_id');
    const amountCop = Number(body.amountCop);
    const paymentMethod = asString(body.paymentMethod, 40).toLowerCase();
    const expiresMinutes = body.expiresMinutes === undefined ? 30 : Number(body.expiresMinutes);
    if (!Number.isSafeInteger(amountCop) || amountCop < config.minAmountCop || amountCop > config.maxAmountCop) {
      throw new HttpError(400, 'invalid_expected_amount', 'El monto esperado no esta dentro del rango permitido.');
    }
    if (!['llave', 'transferencia'].includes(paymentMethod)) {
      throw new HttpError(400, 'invalid_expected_method', 'Selecciona llave o transferencia.');
    }
    if (!Number.isSafeInteger(expiresMinutes) || expiresMinutes < 5 || expiresMinutes > 1440) {
      throw new HttpError(400, 'invalid_expected_expiration', 'La vigencia debe estar entre 5 y 1440 minutos.');
    }
    const { data, error } = await admin.rpc('create_expected_bank_payment', {
      p_operation_id: operationId,
      p_reservation_id: reservationId,
      p_expected_amount_cop: amountCop,
      p_payment_method: paymentMethod,
      p_actor_id: context.user.id,
      p_expires_minutes: expiresMinutes,
      p_pilot_hotel_name: config.pilotHotelName
    });
    if (error) {
      const databaseMessage = String(error.message || '');
      if (databaseMessage.includes('saldo disponible')) {
        throw new HttpError(409, 'expected_amount_exceeds_balance', 'El monto supera el saldo disponible de la reserva.');
      }
      if (databaseMessage.includes('reserva no esta activa')) {
        throw new HttpError(409, 'reservation_not_active', 'La reserva ya no esta activa.');
      }
      if (databaseMessage.includes('idempotencia')) {
        throw new HttpError(409, 'idempotency_conflict', 'La operacion fue reutilizada con datos diferentes.');
      }
      throw Object.assign(new Error('No se pudo crear el pago esperado para la reserva.'), {
        code: 'expected_payment_create_failed'
      });
    }
    return data && typeof data === 'object' ? data as Record<string, unknown> : {};
  }
  if (action === 'gmail-status') {
    const integration = await getBankEmailIntegration(admin, pilotHotel.id);
    return {
      integration: integration ? {
        connected: true,
        connectedEmail: integration.connected_email,
        labelName: integration.gmail_label_name,
        labelConfigured: Boolean(integration.gmail_label_id),
        watchStatus: integration.watch_status,
        watchExpiration: integration.watch_expiration,
        lastWatchRenewedAt: integration.last_watch_renewed_at,
        renewalFailures: integration.watch_renewal_failures,
        lastErrorCode: integration.last_error_code
      } : { connected: false }
    };
  }
  if (!config.enabled && ['oauth-start', 'renew-watch', 'test-connection'].includes(action)) {
    throw new HttpError(409, 'bank_email_integration_disabled', 'La integracion bancaria esta deshabilitada.');
  }
  if (action === 'oauth-start') {
    const state = createOAuthState();
    const stateHash = await hashOAuthState(state);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error } = await admin.from('bank_email_oauth_states').insert({
      state_hash: stateHash,
      hotel_id: pilotHotel.id,
      user_id: context.user.id,
      expires_at: expiresAt
    });
    if (error) throw Object.assign(new Error('No se pudo iniciar OAuth.'), { code: 'oauth_state_store_failed' });
    return { authUrl: buildGoogleAuthorizationUrl(state), expiresAt };
  }
  if (action === 'renew-watch') {
    const integration = await getBankEmailIntegration(admin, pilotHotel.id);
    if (!integration) throw new HttpError(409, 'gmail_not_connected', 'No hay una cuenta Gmail conectada.');
    try {
      const result = await renewGmailWatch(admin, integration);
      await writeAudit(admin, pilotHotel.id, context.user.id, 'gmail_watch_renewed', {
        expiration: result.integration.watch_expiration
      });
      return { watchStatus: result.integration.watch_status, watchExpiration: result.integration.watch_expiration };
    } catch (error) {
      await recordWatchFailure(admin, integration, safeErrorCode(error, 'gmail_watch_renewal_failed'));
      await writeAudit(admin, pilotHotel.id, context.user.id, 'gmail_watch_renewal_failed', {
        error_code: safeErrorCode(error, 'gmail_watch_renewal_failed')
      });
      throw error;
    }
  }
  if (action === 'test-connection') {
    const integration = await getBankEmailIntegration(admin, pilotHotel.id);
    if (!integration) throw new HttpError(409, 'gmail_not_connected', 'No hay una cuenta Gmail conectada.');
    try {
      const { accessToken } = await getValidGmailAccessToken(admin, integration);
      const profile = await getGmailProfile(accessToken);
      if (profile.emailAddress.trim().toLowerCase() !== integration.connected_email.trim().toLowerCase()) {
        throw Object.assign(new Error('La cuenta Gmail no coincide.'), { code: 'gmail_account_mismatch' });
      }
      return { ok: true, connectedEmail: integration.connected_email };
    } catch (error) {
      const code = safeErrorCode(error, 'gmail_connection_test_failed');
      await recordWatchFailure(admin, integration, code);
      await writeAudit(admin, pilotHotel.id, context.user.id, 'gmail_connection_test_failed', {
        error_code: code
      });
      if (code === 'google_invalid_grant') {
        throw new HttpError(
          409,
          code,
          'El permiso de Google vencio o fue revocado. Pulsa Conectar Gmail y autoriza nuevamente la cuenta.'
        );
      }
      throw error;
    }
  }
  if (action === 'disconnect') {
    const integration = await getBankEmailIntegration(admin, pilotHotel.id);
    if (!integration) return { disconnected: true };
    let watchStopped = false;
    let tokenRevoked = false;
    try {
      const { accessToken } = await getValidGmailAccessToken(admin, integration);
      watchStopped = await stopGmailWatch(accessToken).then(() => true).catch(() => false);
      const refreshToken = await decryptToken(integration.refresh_token_encrypted, getTokenEncryptionKey());
      tokenRevoked = await revokeGoogleToken(refreshToken).then(() => true).catch(() => false);
    } catch {
      // Deleting the encrypted local credentials is authoritative even if Google is unavailable.
    }
    const { error: queueError } = await admin
      .from('bank_email_pubsub_inbox')
      .update({ status: 'ignored', last_error_code: 'integration_disconnected' })
      .eq('hotel_id', pilotHotel.id)
      .eq('integration_id', integration.id)
      .in('status', ['pending', 'retry', 'failed', 'processing']);
    if (queueError) {
      throw Object.assign(new Error('No se pudo detener la cola de Gmail.'), { code: 'gmail_queue_stop_failed' });
    }
    const { error } = await admin
      .from('bank_email_integrations')
      .delete()
      .eq('id', integration.id)
      .eq('hotel_id', pilotHotel.id);
    if (error) throw Object.assign(new Error('No se pudo desconectar Gmail.'), { code: 'gmail_disconnect_failed' });
    await writeAudit(admin, pilotHotel.id, context.user.id, 'gmail_disconnected', {
      watch_stopped: watchStopped,
      token_revoked: tokenRevoked
    });
    return { disconnected: true };
  }

  throw new HttpError(400, 'unknown_action', 'La accion solicitada no existe.');
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCorsHeaders(origin) });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, origin);

  try {
    const body = await readJsonBody<RequestBody>(req);
    const admin = buildAdminClient();
    const context = await requireAuthenticatedProfile(req, admin);
    return jsonResponse(await handlePilotAction(body, admin, context), 200, origin);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const code = safeErrorCode(error, 'bank_email_api_failed');
    if (status >= 500) console.error('[bank-email-api]', { code });
    return jsonResponse({ error: code, message: safeErrorMessage(error) }, status, origin);
  }
});
