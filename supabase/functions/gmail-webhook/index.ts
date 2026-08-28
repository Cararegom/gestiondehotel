import { buildAdminClient } from '../_shared/bank-email/server.ts';
import { getPilotHotel } from '../_shared/bank-email/pilot-hotel.ts';
import { verifyPubSubOidc } from '../_shared/bank-email/pubsub-oidc.ts';
import { emptyResponse, jsonResponse, readJsonBody, safeErrorCode } from '../_shared/bank-email/http.ts';
import { processPendingPubSubInbox } from '../_shared/bank-email/queue.ts';
import { isBankEmailProcessingEnabled, readBankEmailConfig } from '../_shared/bank-email/config.ts';

interface PubSubEnvelope {
  message?: {
    data?: string;
    messageId?: string;
    message_id?: string;
    publishTime?: string;
  };
  subscription?: string;
}

interface GmailPushData {
  emailAddress?: string;
  historyId?: string;
}

function decodeBase64Json(value: string): GmailPushData | null {
  try {
    const decoded = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === 'object' ? parsed as GmailPushData : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const config = readBankEmailConfig();
  if (!isBankEmailProcessingEnabled(config)) return emptyResponse(204);

  try {
    await verifyPubSubOidc(req);
  } catch (error) {
    console.warn('[gmail-webhook]', { code: safeErrorCode(error, 'pubsub_unauthorized') });
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  let envelope: PubSubEnvelope;
  try {
    envelope = await readJsonBody<PubSubEnvelope & Record<string, unknown>>(req);
  } catch {
    return emptyResponse(204);
  }

  const pubsubMessageId = String(envelope.message?.messageId || envelope.message?.message_id || '').trim();
  const pushData = decodeBase64Json(String(envelope.message?.data || ''));
  const emailAddress = String(pushData?.emailAddress || '').trim().toLowerCase();
  const historyId = String(pushData?.historyId || '').trim();
  if (!pubsubMessageId || !emailAddress || !/^\d+$/u.test(historyId)) {
    return emptyResponse(204);
  }

  const admin = buildAdminClient();
  try {
    const pilotHotel = await getPilotHotel(admin, config.pilotHotelName);
    const { data: integration, error: integrationError } = await admin
      .from('bank_email_integrations')
      .select('id, hotel_id, connected_email')
      .eq('hotel_id', pilotHotel.id)
      .eq('provider', 'google')
      .maybeSingle();
    if (integrationError) {
      console.error('[gmail-webhook]', { code: 'integration_lookup_failed' });
      return jsonResponse({ error: 'temporary_failure' }, 503);
    }
    if (
      !integration || integration.hotel_id !== pilotHotel.id ||
      String(integration.connected_email || '').trim().toLowerCase() !== emailAddress
    ) {
      return emptyResponse(204);
    }

    const { data: queued, error: queueError } = await admin
      .from('bank_email_pubsub_inbox')
      .upsert({
        hotel_id: pilotHotel.id,
        integration_id: integration.id,
        pubsub_message_id: pubsubMessageId,
        email_address: emailAddress,
        history_id: historyId,
        status: 'pending',
        next_attempt_at: new Date().toISOString()
      }, {
        onConflict: 'pubsub_message_id',
        ignoreDuplicates: true
      })
      .select('id')
      .maybeSingle();
    if (queueError) {
      console.error('[gmail-webhook]', { code: 'pubsub_inbox_store_failed' });
      return jsonResponse({ error: 'temporary_failure' }, 503);
    }

    let shouldProcess = Boolean(queued?.id);
    if (!shouldProcess) {
      const { data: existingQueue, error: existingQueueError } = await admin
        .from('bank_email_pubsub_inbox')
        .select('id, hotel_id, status, next_attempt_at')
        .eq('pubsub_message_id', pubsubMessageId)
        .eq('hotel_id', pilotHotel.id)
        .maybeSingle();
      if (existingQueueError) {
        console.error('[gmail-webhook]', { code: 'pubsub_inbox_lookup_failed' });
        return jsonResponse({ error: 'temporary_failure' }, 503);
      }
      const retryAt = existingQueue?.next_attempt_at ? new Date(existingQueue.next_attempt_at).getTime() : 0;
      shouldProcess = Boolean(
        existingQueue?.hotel_id === pilotHotel.id &&
        ['pending', 'retry', 'failed'].includes(existingQueue?.status || '') &&
        (!retryAt || retryAt <= Date.now())
      );
    }

    if (shouldProcess) {
      const task = processPendingPubSubInbox(admin, pilotHotel, 25).catch((error) => {
        console.error('[gmail-webhook-background]', { code: safeErrorCode(error, 'queue_processing_failed') });
      });
      const edgeRuntime = (globalThis as unknown as {
        EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void };
      }).EdgeRuntime;
      if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(task);
      else await task;
    }

    return emptyResponse(204);
  } catch (error) {
    console.error('[gmail-webhook]', { code: safeErrorCode(error, 'webhook_failed') });
    return jsonResponse({ error: 'temporary_failure' }, 503);
  }
});
