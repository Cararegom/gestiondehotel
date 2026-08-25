import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0';
import type { PilotHotel } from './types.ts';
import { readBankEmailConfig, assertBankEmailConfig, isBankEmailProcessingEnabled } from './config.ts';
import { getBankEmailIntegration, getValidGmailAccessToken } from './integration-service.ts';
import {
  getGmailMessage,
  listGmailHistory,
  listLabeledMessageIdsForRecovery,
  type GmailMessageReference
} from './gmail-api.ts';
import { parseGmailMessage } from './gmail-message.ts';
import { analyzeBankEmail, isConfiguredBankSender } from './payment-service.ts';
import { safeErrorCode } from './http.ts';
import { isTerminalMissingGmailMessage, shouldDeadLetterPubSubInboxItem } from './pubsub.ts';

interface InboxRow {
  id: string;
  hotel_id: string;
  integration_id: string | null;
  pubsub_message_id: string;
  email_address: string;
  history_id: string;
  status: string;
  attempts: number;
}

const GMAIL_WATCH_LABEL_ID = 'INBOX';

function compareHistoryIds(left: string | null, right: string): number {
  try {
    const leftValue = BigInt(left || '0');
    const rightValue = BigInt(right);
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  } catch {
    return String(left || '').localeCompare(right);
  }
}

async function advanceHistoryCursor(
  admin: SupabaseClient,
  integrationId: string,
  pilotHotelId: string,
  historyId: string
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data: row, error: readError } = await admin
      .from('bank_email_integrations')
      .select('gmail_history_id')
      .eq('id', integrationId)
      .eq('hotel_id', pilotHotelId)
      .maybeSingle();
    if (readError || !row) throw Object.assign(new Error('No se pudo leer el cursor Gmail.'), { code: 'gmail_cursor_read_failed' });
    const current = row.gmail_history_id as string | null;
    if (compareHistoryIds(current, historyId) >= 0) return;
    let update = admin
      .from('bank_email_integrations')
      .update({ gmail_history_id: historyId, updated_at: new Date().toISOString() })
      .eq('id', integrationId)
      .eq('hotel_id', pilotHotelId);
    update = current === null ? update.is('gmail_history_id', null) : update.eq('gmail_history_id', current);
    const { data: changed, error: updateError } = await update.select('id').maybeSingle();
    if (updateError) throw Object.assign(new Error('No se pudo actualizar el cursor Gmail.'), { code: 'gmail_cursor_update_failed' });
    if (changed) return;
  }
  throw Object.assign(new Error('El cursor Gmail cambio concurrentemente.'), { code: 'gmail_cursor_conflict' });
}

async function markInbox(
  admin: SupabaseClient,
  row: InboxRow,
  status: 'processed' | 'failed' | 'ignored',
  errorCode: string | null = null
): Promise<void> {
  const attempts = Math.max(1, Number(row.attempts || 1));
  const retryDelayMinutes = Math.min(360, 2 ** Math.min(attempts, 8));
  const finalStatus = status === 'failed' && shouldDeadLetterPubSubInboxItem(attempts)
    ? 'dead_letter'
    : status;
  const patch: Record<string, unknown> = {
    status: finalStatus,
    last_error_code: errorCode,
    processed_at: ['processed', 'ignored', 'dead_letter'].includes(finalStatus) ? new Date().toISOString() : null,
    next_attempt_at: finalStatus === 'failed'
      ? new Date(Date.now() + retryDelayMinutes * 60_000).toISOString()
      : new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const { error } = await admin
    .from('bank_email_pubsub_inbox')
    .update(patch)
    .eq('id', row.id)
    .eq('hotel_id', row.hotel_id);
  if (error) throw Object.assign(new Error('No se pudo actualizar la bandeja Pub/Sub.'), { code: 'pubsub_inbox_update_failed' });
}

async function alertQueueDeadLetter(admin: SupabaseClient, pilotHotelId: string): Promise<void> {
  const [{ data: users }, { data: hotel }] = await Promise.all([
    admin.from('usuarios').select('id, rol').eq('hotel_id', pilotHotelId).eq('activo', true),
    admin.from('hoteles').select('creado_por').eq('id', pilotHotelId).maybeSingle()
  ]);
  const recipients = (users || []).filter((user) =>
    ['admin', 'superadmin', 'administrador'].includes(String(user.rol || '').toLowerCase()) ||
    user.id === hotel?.creado_por
  );
  if (!recipients.length) return;
  await admin.from('notificaciones').insert(recipients.map((user) => ({
    hotel_id: pilotHotelId,
    usuario_id: user.id,
    user_id: user.id,
    rol_destino: null,
    tipo: 'sistema_alerta',
    mensaje: 'La cola de correos bancarios requiere revision manual. No se omitieron mensajes; revisa la integracion antes de reanudarla.',
    leida: false,
    entidad_tipo: 'bank_email_integration',
    entidad_id: null
  })));
}

async function collectMessageReferences(
  accessToken: string,
  startHistoryId: string,
  targetHistoryId: string,
  labelId: string
): Promise<GmailMessageReference[]> {
  const messages = new Map<string, GmailMessageReference>();
  let pageToken: string | undefined;
  let pageCount = 0;
  try {
    do {
      const page = await listGmailHistory(accessToken, startHistoryId, labelId, pageToken);
      for (const history of page.history || []) {
        for (const added of history.messagesAdded || []) {
          if (added.message?.id) messages.set(added.message.id, added.message);
        }
      }
      pageToken = page.nextPageToken;
      pageCount += 1;
      if (pageCount >= 20 && pageToken) {
        throw Object.assign(new Error('El historial Gmail excede el limite seguro.'), { code: 'gmail_history_too_large' });
      }
    } while (pageToken);
  } catch (error) {
    if ((error as { status?: number })?.status !== 404) throw error;
    for (const message of await listLabeledMessageIdsForRecovery(accessToken, labelId, 500)) {
      if (message.id) messages.set(message.id, message);
    }
  }
  if (compareHistoryIds(startHistoryId, targetHistoryId) > 0) return [];
  return [...messages.values()];
}

async function processInboxRow(
  admin: SupabaseClient,
  pilotHotel: PilotHotel,
  row: InboxRow
): Promise<void> {
  if (row.hotel_id !== pilotHotel.id) throw Object.assign(new Error('Inbox fuera del hotel piloto.'), { code: 'pubsub_hotel_mismatch' });
  const integration = await getBankEmailIntegration(admin, pilotHotel.id);
  if (!integration || integration.id !== row.integration_id) {
    await markInbox(admin, row, 'ignored', 'integration_not_found');
    return;
  }
  if (integration.connected_email.trim().toLowerCase() !== row.email_address.trim().toLowerCase()) {
    await markInbox(admin, row, 'ignored', 'gmail_account_mismatch');
    return;
  }
  const config = readBankEmailConfig();
  assertBankEmailConfig(config);
  const { accessToken } = await getValidGmailAccessToken(admin, integration);
  if (!integration.gmail_history_id) {
    await advanceHistoryCursor(admin, integration.id, pilotHotel.id, row.history_id);
    await markInbox(admin, row, 'processed');
    return;
  }

  const references = await collectMessageReferences(
    accessToken,
    integration.gmail_history_id,
    row.history_id,
    GMAIL_WATCH_LABEL_ID
  );
  for (const reference of references) {
    let resource;
    try {
      resource = await getGmailMessage(accessToken, reference.id);
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (!isTerminalMissingGmailMessage(status)) throw error;
      await admin.from('bank_payment_audit_log').insert({
        hotel_id: pilotHotel.id,
        user_id: null,
        action: 'parse_error',
        payment_event_id: null,
        details: { error_code: 'gmail_message_unavailable', http_status: status }
      });
      continue;
    }
    if (!resource.labelIds?.includes(GMAIL_WATCH_LABEL_ID)) continue;
    let normalized;
    try {
      normalized = parseGmailMessage(resource as never);
    } catch {
      await admin.from('bank_payment_audit_log').insert({
        hotel_id: pilotHotel.id,
        user_id: null,
        action: 'parse_error',
        payment_event_id: null,
        details: { error_code: 'gmail_message_parse_failed' }
      });
      continue;
    }
    if (!isConfiguredBankSender(normalized)) continue;
    await analyzeBankEmail(admin, pilotHotel, normalized, config, {
      save: true,
      isTest: false,
      source: 'gmail',
      integrationId: integration.id,
      userId: null
    });
  }

  await advanceHistoryCursor(admin, integration.id, pilotHotel.id, row.history_id);
  await markInbox(admin, row, 'processed');
}

export async function processPendingPubSubInbox(
  admin: SupabaseClient,
  pilotHotel: PilotHotel,
  limit = 25
): Promise<{ claimed: number; processed: number; failed: number }> {
  const config = readBankEmailConfig();
  if (!isBankEmailProcessingEnabled(config)) return { claimed: 0, processed: 0, failed: 0 };
  const { data, error } = await admin.rpc('claim_bank_email_pubsub_inbox', {
    p_limit: Math.min(Math.max(Math.trunc(limit), 1), 100)
  });
  if (error) throw Object.assign(new Error('No se pudo reclamar la bandeja Pub/Sub.'), { code: 'pubsub_inbox_claim_failed' });
  const rows = (Array.isArray(data) ? data : []) as InboxRow[];
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.hotel_id !== pilotHotel.id) {
      await markInbox(admin, row, 'ignored', 'outside_pilot_hotel');
      continue;
    }
    try {
      await processInboxRow(admin, pilotHotel, row);
      processed += 1;
    } catch (error) {
      failed += 1;
      const code = safeErrorCode(error, 'pubsub_processing_failed');
      console.error('[bank-email-queue]', { code, inbox_id: row.id });
      await markInbox(admin, row, 'failed', code);
      if (shouldDeadLetterPubSubInboxItem(row.attempts)) {
        await admin
          .from('bank_email_integrations')
          .update({
            watch_status: 'error',
            last_error_code: 'pubsub_dead_letter',
            updated_at: new Date().toISOString()
          })
          .eq('hotel_id', pilotHotel.id)
          .eq('id', row.integration_id);
        await admin.from('bank_payment_audit_log').insert({
          hotel_id: pilotHotel.id,
          user_id: null,
          action: 'parse_error',
          payment_event_id: null,
          details: { error_code: 'pubsub_dead_letter', cause_code: code }
        });
        await alertQueueDeadLetter(admin, pilotHotel.id);
      }
    }
  }
  return { claimed: rows.length, processed, failed };
}
