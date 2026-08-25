import { buildAdminClient } from '../_shared/bank-email/server.ts';
import { getPilotHotel } from '../_shared/bank-email/pilot-hotel.ts';
import { readBankEmailConfig, assertBankEmailConfig, isBankEmailProcessingEnabled } from '../_shared/bank-email/config.ts';
import { emptyResponse, jsonResponse, safeErrorCode } from '../_shared/bank-email/http.ts';
import { getBankEmailIntegration, recordWatchFailure, renewGmailWatch } from '../_shared/bank-email/integration-service.ts';
import { processPendingPubSubInbox } from '../_shared/bank-email/queue.ts';

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
  try {
    assertBankEmailConfig(config);
    const pilotHotel = await getPilotHotel(admin, config.pilotHotelName);
    const queueResult = await processPendingPubSubInbox(admin, pilotHotel, 50);
    const integration = await getBankEmailIntegration(admin, pilotHotel.id);
    if (!integration) return jsonResponse({ ok: true, skipped: 'gmail_not_connected', queue: queueResult });

    const expiration = integration.watch_expiration ? new Date(integration.watch_expiration).getTime() : 0;
    const renewBefore = Date.now() + 48 * 60 * 60 * 1000;
    if (integration.watch_status === 'active' && expiration > renewBefore) {
      return jsonResponse({ ok: true, skipped: 'watch_still_valid', queue: queueResult });
    }

    try {
      const renewed = await renewGmailWatch(admin, integration);
      await writeAudit(admin, pilotHotel.id, 'gmail_watch_renewed', {
        expiration: renewed.integration.watch_expiration,
        automated: true
      });
      return jsonResponse({
        ok: true,
        watchStatus: renewed.integration.watch_status,
        watchExpiration: renewed.integration.watch_expiration,
        queue: queueResult
      });
    } catch (error) {
      const code = safeErrorCode(error, 'gmail_watch_renewal_failed');
      await recordWatchFailure(admin, integration, code);
      const failures = Number(integration.watch_renewal_failures || 0) + 1;
      await writeAudit(admin, pilotHotel.id, 'gmail_watch_renewal_failed', {
        error_code: code,
        consecutive_failures: failures,
        automated: true
      });
      await alertRepeatedWatchFailure(admin, pilotHotel.id, failures);
      return jsonResponse({ ok: false, error: code, queue: queueResult }, 503);
    }
  } catch (error) {
    const code = safeErrorCode(error, 'gmail_watch_cron_failed');
    console.error('[gmail-watch-renew]', { code });
    return jsonResponse({ ok: false, error: code }, 503);
  }
});
