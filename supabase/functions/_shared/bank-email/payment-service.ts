import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0';
import type {
  BankEmailConfig,
  BankParserRule,
  ExpectedPaymentCandidate,
  NormalizedEmail,
  PilotHotel
} from './types.ts';
import { assertPilotHotelScope } from './pilot-hotel.ts';
import { parseBankEmail } from './bankParsers/index.ts';
import { decideExpectedPaymentMatch } from './matching.ts';
import { hashSensitiveContent } from './security.ts';
import { bogotaCalendarBucket, transferFingerprint } from './idempotency.ts';

export interface AnalyzeBankEmailOptions {
  save: boolean;
  isTest?: boolean;
  source?: 'gmail' | 'simulation';
  userId?: string | null;
  integrationId?: string | null;
}

const BANCOLOMBIA_MARENA_RULE: BankParserRule = {
  id: 'bancolombia',
  bankName: 'Bancolombia',
  allowedFromAddresses: ['alertasynotificaciones@an.notificacionesbancolombia.com'],
  allowedFromDomains: ['an.notificacionesbancolombia.com'],
  allowedReturnPathDomains: ['an.notificacionesbancolombia.com'],
  allowedAuthenticationDomains: ['notificacionesbancolombia.com'],
  requireSpf: true,
  requireDkim: true,
  requireDmarc: true,
  expectedSubjectTerms: ['alertas y notificaciones'],
  expectedBodyTerms: ['recibiste una transferencia', 'recibiste un pago'],
  successExpressions: ['\\brecibiste\\s+(?:una\\s+transferencia|un\\s+pago)\\b'],
  amountExpressions: ['\\$\\s*([0-9][0-9.,]*)'],
  // Los cuatro digitos despues de "cuenta" identifican la cuenta receptora,
  // no la operacion. Gmail message id es la clave idempotente mientras el
  // banco no entregue una referencia unica de transferencia.
  referenceExpressions: [],
  payerNameExpressions: [
    'recibiste\\s+una\\s+transferencia\\s+por\\s+(?:COP\\s*|\\$\\s*)?[0-9][0-9.,]*\\s+de\\s+([^,;]+?)\\s+en\\s+tu\\s+cuenta',
    'recibiste\\s+un\\s+pago\\s+de\\s+([^,;]+?)\\s+por\\s+(?:COP\\s*|\\$\\s*)?[0-9][0-9.,]*\\s+en\\s+tu\\s+cuenta'
  ],
  parserVersion: 'bancolombia-marena-3.1.0'
};

export function parseConfiguredRules(): BankParserRule[] {
  const runtime = globalThis as typeof globalThis & {
    Deno?: { env?: { get(name: string): string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };
  const source = runtime.Deno?.env?.get('BANK_EMAIL_RULES_JSON')
    || runtime.process?.env?.BANK_EMAIL_RULES_JSON
    || '';
  let configured: BankParserRule[] = [];
  try {
    if (source.trim()) {
      const parsed = JSON.parse(source);
      if (Array.isArray(parsed) && parsed.length <= 30) {
        configured = parsed.filter((rule): rule is BankParserRule => {
          if (!rule || typeof rule !== 'object') return false;
          const candidate = rule as Record<string, unknown>;
          return typeof candidate.id === 'string' && typeof candidate.bankName === 'string';
        });
      }
    }
  } catch {
    configured = [];
  }
  return configured.some((rule) => rule.id.trim().toLowerCase() === 'bancolombia')
    ? configured
    : [BANCOLOMBIA_MARENA_RULE, ...configured];
}

function addressDomain(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1).trim().toLowerCase();
}

export function isConfiguredBankSender(email: NormalizedEmail): boolean {
  const address = String(email.fromAddress || '').trim().toLowerCase();
  if (!address) return false;
  const domain = addressDomain(address);
  return parseConfiguredRules().some((rule) => {
    const addresses = (rule.allowedFromAddresses || []).map((value) => value.trim().toLowerCase());
    const domains = (rule.allowedFromDomains || []).map((value) => value.trim().toLowerCase());
    return addresses.includes(address) || domains.some((allowed) =>
      domain === allowed || domain.endsWith(`.${allowed}`)
    );
  });
}

function domainFromAddress(address: string | null): string | null {
  if (!address) return null;
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1).toLowerCase() : null;
}

function sanitizedMetadata(
  email: NormalizedEmail,
  parsed: ReturnType<typeof parseBankEmail>,
  options: AnalyzeBankEmailOptions
): Record<string, unknown> {
  return {
    is_test: options.isTest === true,
    source: options.source || 'gmail',
    parser_id: parsed.parserId,
    parser_reasons: parsed.reasons.slice(0, 20),
    sender_domain: domainFromAddress(email.fromAddress),
    return_path_domain: domainFromAddress(email.returnPathAddress),
    authentication: {
      spf: email.authentication.spf,
      dkim: email.authentication.dkim,
      dmarc: email.authentication.dmarc,
      spf_domain: email.authentication.spfDomain,
      dkim_domain: email.authentication.dkimDomain,
      dmarc_domain: email.authentication.dmarcDomain
    },
    gmail_label_ids: email.labelIds.slice(0, 20)
  };
}

async function writeAudit(
  admin: SupabaseClient,
  hotelId: string,
  action: string,
  paymentEventId: string | null,
  userId: string | null,
  details: Record<string, unknown>
): Promise<void> {
  const { error } = await admin.from('bank_payment_audit_log').insert({
    hotel_id: hotelId,
    user_id: userId,
    action,
    payment_event_id: paymentEventId,
    details
  });
  if (error) console.error('[bank-payment-audit]', { code: 'audit_write_failed', action });
}

async function loadExpectedCandidates(
  admin: SupabaseClient,
  pilotHotelId: string,
  amountCop: number,
  receivedAt: string,
  windowMinutes: number
): Promise<ExpectedPaymentCandidate[]> {
  const center = new Date(receivedAt);
  const start = new Date(center.getTime() - windowMinutes * 60_000).toISOString();
  const end = new Date(center.getTime() + windowMinutes * 60_000).toISOString();
  const { data, error } = await admin
    .from('expected_payments')
    .select('id, hotel_id, reservation_id, room_id, sale_id, expected_amount_cop, payment_method, status, expires_at, created_at')
    .eq('hotel_id', pilotHotelId)
    .eq('expected_amount_cop', amountCop)
    .eq('status', 'pending')
    .in('payment_method', ['llave', 'transferencia'])
    .gte('created_at', start)
    .lte('created_at', end)
    .limit(50);
  if (error) throw Object.assign(new Error('No se pudieron consultar los pagos esperados.'), { code: 'expected_payment_lookup_failed' });
  return (data || []).map((row) => ({
    id: row.id,
    hotelId: row.hotel_id,
    expectedAmountCop: Number(row.expected_amount_cop),
    paymentMethod: row.payment_method,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    reservationId: row.reservation_id,
    roomId: row.room_id,
    saleId: row.sale_id
  }));
}

async function findExistingDuplicate(
  admin: SupabaseClient,
  hotelId: string,
  provider: 'gmail' | 'simulation',
  gmailMessageId: string,
  fingerprint: string | null
) {
  const query = admin
    .from('bank_payment_events')
    .select('*')
    .eq('hotel_id', hotelId)
    .eq('gmail_message_id', gmailMessageId)
    .limit(1);
  let { data, error } = await query;
  if (error) throw error;
  if (data?.[0]) return data[0];
  if (!fingerprint) return null;
  ({ data, error } = await admin
    .from('bank_payment_events')
    .select('*')
    .eq('hotel_id', hotelId)
    .eq('provider', provider)
    .eq('transaction_fingerprint', fingerprint)
    .limit(1));
  if (error) throw error;
  return data?.[0] || null;
}

function hasCompletedMatching(event: Record<string, unknown>): boolean {
  const metadata = event.metadata;
  return Boolean(
    metadata && typeof metadata === 'object' &&
    (metadata as Record<string, unknown>).matching_completed === true
  );
}

async function matchStoredPaymentEvent(
  admin: SupabaseClient,
  pilotHotel: PilotHotel,
  paymentEventId: string,
  config: BankEmailConfig
): Promise<{ event: Record<string, unknown>; match: unknown }> {
  const { data: match, error: matchError } = await admin.rpc('match_bank_payment_event', {
    p_payment_event_id: paymentEventId,
    p_pilot_hotel_name: config.pilotHotelName,
    p_window_minutes: config.matchWindowMinutes
  });
  if (matchError) {
    throw Object.assign(new Error('No se pudo relacionar el pago esperado.'), {
      code: 'payment_match_failed'
    });
  }

  const { data: event, error: refreshError } = await admin
    .from('bank_payment_events')
    .select('*')
    .eq('id', paymentEventId)
    .eq('hotel_id', pilotHotel.id)
    .single();
  if (refreshError || !event || event.hotel_id !== pilotHotel.id) {
    throw Object.assign(new Error('No se pudo recargar el pago.'), {
      code: 'payment_reload_failed'
    });
  }
  return { event, match };
}

export async function analyzeBankEmail(
  admin: SupabaseClient,
  pilotHotel: PilotHotel,
  email: NormalizedEmail,
  config: BankEmailConfig,
  options: AnalyzeBankEmailOptions
): Promise<Record<string, unknown>> {
  assertPilotHotelScope(pilotHotel.id, pilotHotel);
  if (options.save && !config.enabled) {
    throw Object.assign(new Error('La integracion bancaria esta deshabilitada.'), {
      code: 'bank_email_integration_disabled'
    });
  }
  const parsed = parseBankEmail(email, config, parseConfiguredRules());
  const receivedAt = email.receivedAt || new Date().toISOString();
  const transactionOccurredAt = parsed.transactionOccurredAt || receivedAt;
  const provider = options.source || 'gmail';
  const rawContentHash = await hashSensitiveContent(`${email.subject}\n${email.textBody}`);

  if (!parsed.amountCop || !Number.isSafeInteger(parsed.amountCop) || parsed.amountCop <= 0) {
    if (options.save) {
      await writeAudit(admin, pilotHotel.id, 'parse_error', null, options.userId || null, {
        parser_id: parsed.parserId,
        reasons: parsed.reasons.slice(0, 20),
        raw_content_hash: rawContentHash,
        is_test: options.isTest === true
      });
    }
    return {
      saved: false,
      parsed,
      match: null,
      wouldBeSaved: null,
      reason: 'amount_not_available'
    };
  }

  const fingerprint = parsed.transactionReference
    ? await transferFingerprint({
        hotelId: pilotHotel.id,
        bankName: parsed.bankName,
        transactionReference: parsed.transactionReference,
        amountCop: parsed.amountCop,
        receivedAt: transactionOccurredAt
      })
    : null;
  const expectedCandidates = await loadExpectedCandidates(
    admin,
    pilotHotel.id,
    parsed.amountCop,
    transactionOccurredAt,
    config.matchWindowMinutes
  );
  const matchPreview = decideExpectedPaymentMatch({
    hotelId: pilotHotel.id,
    amountCop: parsed.amountCop,
    receivedAt: transactionOccurredAt
  }, expectedCandidates, { windowMinutes: config.matchWindowMinutes });

  let previewStatus: string = parsed.disposition;
  let previewExpectedPaymentId: string | null = null;
  if (parsed.disposition === 'detected') {
    previewStatus = matchPreview.status;
    previewExpectedPaymentId = matchPreview.matchedExpectedPaymentId;
  }
  const metadata = sanitizedMetadata(email, parsed, options);
  if (options.isTest === true) {
    metadata.match_preview = {
      status: previewStatus,
      expected_payment_id: previewExpectedPaymentId,
      candidate_count: matchPreview.candidateIds.length,
      reason: matchPreview.reason
    };
    metadata.matching_skipped_for_test = true;
  }
  const payload: Record<string, unknown> = {
    hotel_id: pilotHotel.id,
    integration_id: options.integrationId || null,
    provider,
    bank_name: parsed.bankName,
    gmail_message_id: email.gmailMessageId,
    gmail_thread_id: email.gmailThreadId,
    transaction_reference: parsed.transactionReference,
    sender_name: parsed.senderName,
    sender_account_masked: null,
    amount_cop: parsed.amountCop,
    email_subject: email.subject.slice(0, 500),
    email_received_at: receivedAt,
    transaction_occurred_at: transactionOccurredAt,
    transaction_date: bogotaCalendarBucket(transactionOccurredAt),
    status: parsed.disposition,
    matched_expected_payment_id: null,
    raw_content_hash: rawContentHash,
    transaction_fingerprint: fingerprint,
    parser_version: parsed.parserVersion,
    review_reason: parsed.reviewReason,
    metadata
  };
  if (payload.hotel_id !== pilotHotel.id) throw new Error('BANK_EMAIL_OUTSIDE_PILOT_HOTEL');

  const wouldBeSaved = {
    ...payload,
    status: options.isTest === true ? parsed.disposition : previewStatus,
    matched_expected_payment_id: options.isTest === true ? null : previewExpectedPaymentId
  };
  if (!options.save) {
    return { saved: false, parsed, match: matchPreview, wouldBeSaved };
  }

  const existing = await findExistingDuplicate(admin, pilotHotel.id, provider, email.gmailMessageId, fingerprint);
  if (existing) {
    await writeAudit(admin, pilotHotel.id, 'duplicate_detected', existing.id, options.userId || null, {
      duplicate_gmail_message_id: email.gmailMessageId,
      transaction_fingerprint: fingerprint,
      is_test: options.isTest === true
    });
    if (
      provider === 'gmail' && parsed.disposition === 'detected' &&
      existing.status === 'detected' && !hasCompletedMatching(existing)
    ) {
      const recovered = await matchStoredPaymentEvent(admin, pilotHotel, existing.id, config);
      return {
        saved: false,
        duplicated: true,
        recovered: true,
        parsed,
        event: recovered.event,
        match: recovered.match,
        wouldBeSaved
      };
    }
    return { saved: false, duplicated: true, parsed, event: existing, match: null, wouldBeSaved };
  }

  const { data: inserted, error: insertError } = await admin
    .from('bank_payment_events')
    .insert(payload)
    .select('*')
    .single();
  if (insertError || !inserted) {
    if (insertError?.code === '23505') {
      const duplicate = await findExistingDuplicate(admin, pilotHotel.id, provider, email.gmailMessageId, fingerprint);
      await writeAudit(admin, pilotHotel.id, 'duplicate_detected', duplicate?.id || null, options.userId || null, {
        duplicate_gmail_message_id: email.gmailMessageId,
        transaction_fingerprint: fingerprint,
        is_test: options.isTest === true
      });
      if (
        duplicate && provider === 'gmail' && parsed.disposition === 'detected' &&
        duplicate.status === 'detected' && !hasCompletedMatching(duplicate)
      ) {
        const recovered = await matchStoredPaymentEvent(admin, pilotHotel, duplicate.id, config);
        return {
          saved: false,
          duplicated: true,
          recovered: true,
          parsed,
          event: recovered.event,
          match: recovered.match,
          wouldBeSaved
        };
      }
      return { saved: false, duplicated: true, parsed, event: duplicate, match: null, wouldBeSaved };
    }
    throw Object.assign(new Error('No se pudo guardar el evento bancario.'), { code: 'payment_event_insert_failed' });
  }
  if (inserted.hotel_id !== pilotHotel.id) throw new Error('BANK_EMAIL_OUTSIDE_PILOT_HOTEL');

  let event = inserted;
  let match: unknown = matchPreview;
  if (parsed.disposition === 'detected' && options.isTest !== true) {
    const matched = await matchStoredPaymentEvent(admin, pilotHotel, inserted.id, config);
    event = matched.event;
    match = matched.match;
  }

  return { saved: true, parsed, event, match, wouldBeSaved };
}
