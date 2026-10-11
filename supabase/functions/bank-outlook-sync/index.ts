import { buildAdminClient } from '../_shared/bank-email/server.ts';
import { getBankEmailHotel } from '../_shared/bank-email/hotel-scope.ts';
import { syncOutlookPayments } from '../_shared/bank-email/outlook-service.ts';
import type { BankEmailIntegrationRow } from '../_shared/bank-email/integration-service.ts';
import { bankCronAuthorized } from '../_shared/bank-email/cron-auth.ts';
import { isBankEmailProcessingEnabled, readBankEmailConfig } from '../_shared/bank-email/config.ts';
import { emptyResponse, jsonResponse, safeErrorCode } from '../_shared/bank-email/http.ts';

Deno.serve(async req => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  if (!bankCronAuthorized(req)) return jsonResponse({ error: 'unauthorized' }, 401);
  if (!isBankEmailProcessingEnabled(readBankEmailConfig())) return emptyResponse(204);
  const admin = buildAdminClient();
  const { data: rows, error } = await admin.from('bank_email_integrations').select('*').eq('provider', 'microsoft');
  if (error) return jsonResponse({ error: 'outlook_integrations_lookup_failed' }, 503);
  let synced = 0;
  let failed = 0;
  // A failure in one hotel's grant never prevents another hotel's sync.
  for (const integration of (rows || []) as BankEmailIntegrationRow[]) {
    try {
      const hotel = await getBankEmailHotel(admin, integration.hotel_id);
      await syncOutlookPayments(admin, hotel, integration);
      synced += 1;
    } catch (error) {
      failed += 1;
      const code = safeErrorCode(error, 'outlook_sync_failed');
      console.error('[bank-outlook-sync]', { code, integration_id: integration.id });
      await admin.from('bank_payment_audit_log').insert({ hotel_id: integration.hotel_id,
        user_id: null, action: 'outlook_sync_failed', details: { error_code: code } });
    }
  }
  return jsonResponse({ ok: failed === 0, synced, failed });
});
