import { buildAdminClient } from '../_shared/bank-email/server.ts';
import { getBankEmailHotel } from '../_shared/bank-email/hotel-scope.ts';
import type { BankEmailIntegrationRow } from '../_shared/bank-email/integration-service.ts';
import { readBankEmailConfig, isBankEmailProcessingEnabled } from '../_shared/bank-email/config.ts';
import { emptyResponse, HttpError, jsonResponse, safeErrorCode } from '../_shared/bank-email/http.ts';
import { recordWatchFailure, renewGmailWatch } from '../_shared/bank-email/integration-service.ts';
import { processPendingPubSubInbox } from '../_shared/bank-email/queue.ts';
import { parseGmailReplayRequest, replayGmailMessages } from '../_shared/bank-email/gmail-replay.ts';

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function cronAuthorized(req: Request): boolean {
  const expected = Deno.env.get('CRON_SECRET') || '';
  if (expected.length < 24) return false;
  const explicit = req.headers.get('x-cron-secret') || '';
  const bearer = /^Bearer\s+([^\s]+)$/iu.exec(req.headers.get('authorization') || '')?.[1] || '';
  return constantTimeEqual(explicit || bearer, expected);
}

async function writeAudit(
  admin: ReturnType<typeof buildAdminClient>,
  hotelId: string,
  action: string,
  details: Record<string, unknown>
) {
  await admin.from('bank_payment_audit_log').insert({
    hotel_id: hotelId,
    user_id: null,
    action,
    payment_event_id: null,
    details
  });
}

async function alertRepeatedWatchFailure(
  admin: ReturnType<typeof buildAdminClient>,
  pilotHotelId: string,
  failures: number
) {
  if (failures < 3) return;
  const [{ data: users }, { data: hotel }] = await Promise.all([
    admin
    .from('usuarios')
    .select('id, rol')
    .eq('hotel_id', pilotHotelId)
    .eq('activo', true),
    admin.from('hoteles').select('creado_por').eq('id', pilotHotelId).maybeSingle()
  ]);
  const recipients = (users || []).filter((user) =>
    ['admin', 'superadmin', 'administrador'].includes(String(user.rol || '').toLowerCase()) ||
    user.id === hotel?.creado_por
  );
  if (!recipients.length) return;
  const rows = recipients.map((user) => ({
    hotel_id: pilotHotelId,
    usuario_id: user.id,
    user_id: user.id,
    rol_destino: null,
    tipo: 'sistema_alerta',
    mensaje: 'La renovacion de Gmail Watch fallo varias veces. Revisa Configuracion > Integraciones > Correo de pagos.',
    leida: false,
    entidad_tipo: 'bank_email_integration',
    entidad_id: null
  }));
  await admin.from('notificaciones').insert(rows);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const config = readBankEmailConfig();
  if (!isBankEmailProcessingEnabled(config)) return emptyResponse(204);
  if (!cronAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, 401);

  const admin = buildAdminClient();
  // Existing cron callers may send an empty body. Recovery uses the same secret
  // authentication and retrieves every message from the hotel's own integration.
  let body: unknown = {};
  try {
    const text = await req.text();
    if (text.length > 16_384) return jsonResponse({ error: 'request_too_large' }, 413);
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  if (body && typeof body === 'object' && 'action' in body) {
    try {
      const request = parseGmailReplayRequest(body);
      const hotel = await getBankEmailHotel(admin, request.hotelId);
      const result = await replayGmailMessages(admin, hotel, request.messageIds);
      return jsonResponse({ ok: true, hotelId: hotel.id, ...result });
    } catch (error) {
      return jsonResponse({ ok: false, error: safeErrorCode(error, 'gmail_replay_failed') }, error instanceof HttpError ? error.status : 503);
    }
  }
  const { data: integrations, error: lookupError } = await admin.from('bank_email_integrations').select('*').eq('provider', 'google');
  if (lookupError) return jsonResponse({ ok: false, error: 'integration_lookup_failed' }, 503);
  const results: { integrationId: string; ok: boolean; error?: string }[] = [];
  for (const integration of (integrations || []) as BankEmailIntegrationRow[]) {
    try {
      const pilotHotel = await getBankEmailHotel(admin, integration.hotel_id);
      await processPendingPubSubInbox(admin, pilotHotel, 50);
      const expiration = new Date(integration.watch_expiration || '').getTime();
      if (integration.watch_status !== 'active' || !Number.isFinite(expiration) || expiration <= Date.now() + 48 * 60 * 60 * 1000) {
        const renewed = await renewGmailWatch(admin, integration);
        await writeAudit(admin, pilotHotel.id, 'gmail_watch_renewed', { expiration: renewed.integration.watch_expiration, automated: true });
      }
      results.push({ integrationId: integration.id, ok: true });
    } catch (error) {
      const code = safeErrorCode(error, 'gmail_watch_renewal_failed');
      await recordWatchFailure(admin, integration, code);
      const failures = Number(integration.watch_renewal_failures || 0) + 1;
      await writeAudit(admin, integration.hotel_id, 'gmail_watch_renewal_failed', { error_code: code, consecutive_failures: failures, automated: true });
      await alertRepeatedWatchFailure(admin, integration.hotel_id, failures);
      results.push({ integrationId: integration.id, ok: false, error: code });
    }
  }
  return jsonResponse({ ok: results.every(result => result.ok), results });
});
