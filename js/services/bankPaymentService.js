const BANK_EMAIL_API_FUNCTION = 'bank-email-api';

export const BANK_PAYMENT_STATUSES = Object.freeze([
  'detected',
  'matched',
  'confirmed',
  'manual_review',
  'rejected',
  'duplicated'
]);

const MANUAL_ACTIONS = new Set(['confirm', 'relate', 'reject', 'review']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function requireSupabase(supabase) {
  if (!supabase?.functions?.invoke) {
    throw new Error('Cliente de servicios no disponible.');
  }
}

function requireActiveHotel(hotelId) {
  if (!isUuid(hotelId)) {
    throw new Error('No se pudo verificar el hotel activo.');
  }
}

function safeServerMessage(value, fallback) {
  const message = String(value || '').replace(/\s+/g, ' ').trim();
  if (!message || message.length > 240 || /(token|secret|authorization|refresh[_ -]?token|raw[_ -]?content)/i.test(message)) {
    return fallback;
  }
  return message;
}

async function invokeBankEmailApi(supabase, action, payload = {}) {
  requireSupabase(supabase);

  const { data, error } = await supabase.functions.invoke(BANK_EMAIL_API_FUNCTION, {
    body: { action, ...payload }
  });

  if (error) {
    let serverMessage = '';
    try {
      const response = error.context;
      if (response && typeof response.clone === 'function') {
        const body = await response.clone().json();
        serverMessage = body?.message || body?.error || '';
      }
    } catch {
      // Algunas versiones del cliente no exponen el cuerpo de la respuesta.
    }
    throw new Error(safeServerMessage(
      serverMessage || error.message,
      'No se pudo completar la operacion bancaria.'
    ));
  }

  if (data?.error) {
    throw new Error(safeServerMessage(data.message || data.error, 'La operacion bancaria fue rechazada.'));
  }

  return data && typeof data === 'object' ? data : {};
}

function normalizeDateFilter(value) {
  const normalized = String(value || '').trim();
  return ISO_DATE_PATTERN.test(normalized) ? normalized : null;
}

function normalizeOptionalUuid(value) {
  return isUuid(value) ? String(value) : null;
}

function normalizeOptionalText(value, maxLength = 500) {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeGoogleOAuthUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizePageSize(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 200 ? parsed : 100;
}

export function isUuid(value) {
  return UUID_PATTERN.test(String(value || '').trim());
}

export async function getBankPaymentPilotStatus(supabase, hotelId) {
  requireActiveHotel(hotelId);
  const data = await invokeBankEmailApi(supabase, 'pilot-status');

  return {
    eligible: data.eligible === true,
    integrationEnabled: data.integrationEnabled === true,
    isAdmin: data.isAdmin === true,
    pilotHotelName: normalizeOptionalText(data.pilotHotelName, 160),
    canAccess: data.eligible === true && data.integrationEnabled === true
  };
}

export async function getBankPaymentGmailStatus(supabase) {
  const data = await invokeBankEmailApi(supabase, 'gmail-status');
  const integration = data.integration && typeof data.integration === 'object'
    ? data.integration
    : {};

  return {
    connected: integration.connected === true,
    connectedEmail: normalizeOptionalText(integration.connectedEmail, 320),
    labelName: normalizeOptionalText(integration.labelName, 160),
    labelConfigured: integration.labelConfigured === true,
    watchStatus: normalizeOptionalText(integration.watchStatus, 80),
    watchExpiration: normalizeOptionalText(integration.watchExpiration, 80),
    lastWatchRenewedAt: normalizeOptionalText(integration.lastWatchRenewedAt, 80),
    renewalFailures: normalizeNonNegativeInteger(integration.renewalFailures),
    lastErrorCode: normalizeOptionalText(integration.lastErrorCode, 120)
  };
}

export async function startBankPaymentGmailOAuth(supabase) {
  const data = await invokeBankEmailApi(supabase, 'oauth-start');
  const authUrl = normalizeGoogleOAuthUrl(data.authUrl);
  if (!authUrl) throw new Error('No se recibio una URL segura de autorizacion de Google.');
  return { authUrl, expiresAt: normalizeOptionalText(data.expiresAt, 80) };
}

export async function renewBankPaymentGmailWatch(supabase) {
  const data = await invokeBankEmailApi(supabase, 'renew-watch');
  return {
    watchStatus: normalizeOptionalText(data.watchStatus, 80),
    watchExpiration: normalizeOptionalText(data.watchExpiration, 80)
  };
}

export async function testBankPaymentGmailConnection(supabase) {
  const data = await invokeBankEmailApi(supabase, 'test-connection');
  return {
    ok: data.ok === true,
    connectedEmail: normalizeOptionalText(data.connectedEmail, 320)
  };
}

export async function disconnectBankPaymentGmail(supabase) {
  const data = await invokeBankEmailApi(supabase, 'disconnect');
  return { disconnected: data.disconnected === true };
}

export async function listBankPaymentEvents(supabase, hotelId, filters = {}) {
  requireActiveHotel(hotelId);
  const status = BANK_PAYMENT_STATUSES.includes(filters.status) ? filters.status : null;
  const offset = normalizeNonNegativeInteger(filters.offset);
  const limit = normalizePageSize(filters.limit);
  const data = await invokeBankEmailApi(supabase, 'list', {
    status,
    dateFrom: normalizeDateFilter(filters.dateFrom),
    dateTo: normalizeDateFilter(filters.dateTo),
    offset,
    limit
  });

  const events = Array.isArray(data.events) ? data.events : [];
  const pagination = data.pagination && typeof data.pagination === 'object' ? data.pagination : {};
  const hasMore = pagination.hasMore === true;
  const candidateOffset = normalizeNonNegativeInteger(pagination.nextOffset);
  return {
    events,
    hasMore,
    nextOffset: hasMore && candidateOffset > offset ? candidateOffset : hasMore ? offset + events.length : null
  };
}

export async function getBankExpectedPaymentOptions(supabase, hotelId) {
  requireActiveHotel(hotelId);
  const data = await invokeBankEmailApi(supabase, 'expected-payment-options');
  const source = data.candidates && typeof data.candidates === 'object' ? data.candidates : {};
  return {
    reservations: Array.isArray(source.reservations) ? source.reservations : [],
    rooms: Array.isArray(source.rooms) ? source.rooms : [],
    sales: Array.isArray(source.sales) ? source.sales : []
  };
}

export async function createBankExpectedPayment(supabase, hotelId, input = {}) {
  requireActiveHotel(hotelId);
  if (!isUuid(input.operationId)) throw new Error('No se pudo generar una clave de operacion valida.');
  if (!isUuid(input.reservationId)) throw new Error('Selecciona una reserva valida.');
  const amountCop = Number(input.amountCop);
  if (!Number.isSafeInteger(amountCop) || amountCop <= 0) throw new Error('Escribe un monto entero mayor que cero.');
  const paymentMethod = normalizeOptionalText(input.paymentMethod, 40)?.toLowerCase();
  if (!['llave', 'transferencia'].includes(paymentMethod)) throw new Error('Selecciona llave o transferencia.');
  const expiresMinutes = Number(input.expiresMinutes ?? 30);
  if (!Number.isSafeInteger(expiresMinutes) || expiresMinutes < 5 || expiresMinutes > 1440) {
    throw new Error('La vigencia debe estar entre 5 y 1440 minutos.');
  }
  const data = await invokeBankEmailApi(supabase, 'create-expected-payment', {
    operationId: input.operationId,
    reservationId: input.reservationId,
    amountCop,
    paymentMethod,
    expiresMinutes
  });
  return {
    expectedPayment: data.expected_payment || data.expectedPayment || null,
    idempotent: data.idempotent === true
  };
}

export async function getBankPaymentDetail(supabase, hotelId, paymentEventId) {
  requireActiveHotel(hotelId);
  if (!isUuid(paymentEventId)) throw new Error('Identificador de pago invalido.');

  const data = await invokeBankEmailApi(supabase, 'detail', { paymentEventId });
  return data.event || data.paymentEvent || data.detail || null;
}

export async function getBankPaymentCandidates(supabase, hotelId, paymentEventId) {
  requireActiveHotel(hotelId);
  if (!isUuid(paymentEventId)) throw new Error('Identificador de pago invalido.');

  const data = await invokeBankEmailApi(supabase, 'candidates', { paymentEventId });
  const source = data.candidates && typeof data.candidates === 'object' ? data.candidates : data;

  return {
    reservations: Array.isArray(source.reservations) ? source.reservations : [],
    rooms: Array.isArray(source.rooms) ? source.rooms : [],
    sales: Array.isArray(source.sales) ? source.sales : [],
    expectedPayments: Array.isArray(source.expectedPayments) ? source.expectedPayments : []
  };
}

export async function submitBankPaymentManualAction(supabase, hotelId, input = {}) {
  requireActiveHotel(hotelId);
  if (!isUuid(input.paymentEventId)) throw new Error('Identificador de pago invalido.');
  if (!MANUAL_ACTIONS.has(input.manualAction)) throw new Error('Accion manual no permitida.');

  const payload = {
    paymentEventId: input.paymentEventId,
    manualAction: input.manualAction,
    reservationId: normalizeOptionalUuid(input.reservationId),
    roomId: normalizeOptionalUuid(input.roomId),
    saleId: normalizeOptionalUuid(input.saleId),
    saleType: normalizeOptionalText(input.saleType, 80),
    expectedPaymentId: normalizeOptionalUuid(input.expectedPaymentId),
    reviewReason: normalizeOptionalText(input.reviewReason, 500)
  };

  if (payload.manualAction === 'relate' && !payload.reservationId && !payload.roomId && !payload.saleId && !payload.expectedPaymentId) {
    throw new Error('Selecciona una reserva, habitacion, venta o pago esperado para relacionar.');
  }

  if (payload.manualAction === 'reject' && !payload.reviewReason) {
    throw new Error('Indica el motivo del rechazo.');
  }

  return invokeBankEmailApi(supabase, 'manual-action', payload);
}

export async function simulateBankPaymentEmail(supabase, hotelId, input = {}) {
  requireActiveHotel(hotelId);
  const subject = normalizeOptionalText(input.subject, 500);
  const body = normalizeOptionalText(input.body, 100000);
  if (!subject) throw new Error('Escribe el asunto del correo simulado.');
  if (!body) throw new Error('Escribe el contenido del correo simulado.');

  return invokeBankEmailApi(supabase, 'simulate', {
    subject,
    body,
    from: normalizeOptionalText(input.from, 320),
    returnPath: normalizeOptionalText(input.returnPath, 320),
    authenticationResults: normalizeOptionalText(input.authenticationResults, 4000),
    receivedAt: normalizeOptionalText(input.receivedAt, 80),
    save: input.save === true
  });
}

export function subscribeToBankPaymentEvents(supabase, hotelId, onChange) {
  requireActiveHotel(hotelId);
  if (!supabase?.channel) return null;

  const channel = supabase
    .channel(`bank-payments-h-${hotelId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notificaciones',
        filter: `hotel_id=eq.${hotelId}`
      },
      (payload) => {
        const entityType = payload?.new?.entidad_tipo || payload?.old?.entidad_tipo;
        if (['bank_payment_event', 'bank_payment_events'].includes(entityType)) onChange?.();
      }
    )
    .subscribe();

  return {
    channel,
    async unsubscribe() {
      await supabase.removeChannel(channel);
    }
  };
}
