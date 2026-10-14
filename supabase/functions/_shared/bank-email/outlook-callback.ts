import { buildAdminClient, isPilotAdministrator } from './server.ts';
import { getBankEmailHotel, validateHotelBankSettings } from './hotel-scope.ts';
import { buildOAuthRedirect, hashOAuthState } from './oauth-state.ts';
import { exchangeOutlookAuthorizationCode, getOutlookProfile, syncOutlookPayments } from './outlook-service.ts';
import type { BankEmailIntegrationRow } from './integration-service.ts';
import { getBankEmailIntegration } from './integration-service.ts';
import { encryptToken, getTokenEncryptionKey } from './token-crypto.ts';
import { isBankEmailProcessingEnabled, readBankEmailConfig } from './config.ts';
import { HttpError, safeErrorCode } from './http.ts';

export async function handleBankOutlookCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const redirect = (status: string, code?: string) => Response.redirect(buildOAuthRedirect({
    outlook_payment_status: status, ...(code ? { code } : {})
  }), 302);
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  if (url.searchParams.get('error')) return redirect('error', 'outlook_authorization_denied');
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  if (!code || code.length > 4096 || !state.startsWith('bank-outlook.') || state.length > 512) return redirect('error', 'invalid_oauth_callback');
  const admin = buildAdminClient();
  let auditHotelId: string | null = null;
  let auditUserId: string | null = null;
  try {
    if (!isBankEmailProcessingEnabled(readBankEmailConfig())) throw new HttpError(409, 'bank_email_integration_disabled', 'La integracion esta deshabilitada.');
    const now = new Date().toISOString();
    const { data: pending, error } = await admin.from('bank_email_oauth_states')
      .select('id,hotel_id,user_id,metadata').eq('state_hash', await hashOAuthState(state))
      .eq('provider', 'microsoft').is('consumed_at', null).gt('expires_at', now).maybeSingle();
    if (error || !pending) throw new HttpError(400, 'invalid_oauth_state', 'La autorizacion expiro.');
    const { data: consumed, error: consumeError } = await admin.from('bank_email_oauth_states')
      .update({ consumed_at: now }).eq('id', pending.id).is('consumed_at', null).select('id').maybeSingle();
    if (consumeError || !consumed) throw new HttpError(400, 'oauth_state_replayed', 'La autorizacion ya fue utilizada.');
    const hotel = await getBankEmailHotel(admin, pending.hotel_id);
    auditHotelId = hotel.id;
    auditUserId = pending.user_id;
    const [{ data: profile, error: profileError }, { data: userResult, error: userError }] = await Promise.all([
      admin.from('usuarios').select('id,hotel_id,rol,activo').eq('id', pending.user_id).maybeSingle(),
      admin.auth.admin.getUserById(pending.user_id)
    ]);
    if (profileError || userError || !profile || !userResult.user || profile.activo !== true || profile.hotel_id !== hotel.id ||
      !(await isPilotAdministrator(admin, { profile, user: userResult.user, accessToken: '' }, hotel.id))) {
      throw new HttpError(403, 'oauth_user_not_authorized', 'El administrador ya no esta autorizado.');
    }
    const settings = validateHotelBankSettings(pending.metadata);
    const tokens = await exchangeOutlookAuthorizationCode(code);
    if (!tokens.refresh_token || !tokens.scope?.split(/\s+/u).some(scope => /(?:^|\/)Mail\.Read$/iu.test(scope))) {
      throw new HttpError(409, 'outlook_mail_permission_missing', 'Autoriza la lectura del correo y conecta Outlook nuevamente.');
    }
    const profileInfo = await getOutlookProfile(tokens.access_token);
    const existing = await getBankEmailIntegration(admin, hotel.id, 'microsoft');
    const sameMailbox = existing?.connected_email.toLowerCase() === profileInfo.email;
    const key = getTokenEncryptionKey();
    const { data: stored, error: storeError } = await admin.from('bank_email_integrations').upsert({
      hotel_id: hotel.id, provider: 'microsoft', connected_email: profileInfo.email,
      access_token_encrypted: await encryptToken(tokens.access_token, key),
      refresh_token_encrypted: await encryptToken(tokens.refresh_token, key),
      token_expires_at: new Date(Date.now() + Math.max(60, tokens.expires_in || 3600) * 1000).toISOString(),
      gmail_label_name: 'Bandeja de entrada', gmail_label_id: null, gmail_history_id: null,
      bank_key: settings.bankKey, outlook_delta_link: sameMailbox ? existing?.outlook_delta_link || null : null,
      sync_lock_token: null, sync_locked_until: null, watch_status: 'pending', watch_renewal_failures: 0,
      last_error_code: null, created_by: pending.user_id, updated_at: now
    }, { onConflict: 'hotel_id,provider' }).select('*').single();
    if (storeError || !stored) throw new HttpError(409, 'outlook_integration_store_failed', 'No se pudo guardar Outlook. Usa una cuenta exclusiva de este hotel.');
    await admin.from('bank_payment_audit_log').insert({ hotel_id: hotel.id, user_id: pending.user_id,
      action: 'outlook_connected', details: { mailbox_replaced: Boolean(existing && !sameMailbox) } });
    try {
      await syncOutlookPayments(admin, hotel, stored as BankEmailIntegrationRow);
    } catch (error) {
      const errorCode = safeErrorCode(error, 'outlook_initial_sync_failed');
      await admin.from('bank_payment_audit_log').insert({ hotel_id: hotel.id, user_id: pending.user_id,
        action: 'outlook_sync_failed', details: { error_code: errorCode, initial_sync: true } });
      return redirect('connected_sync_pending', errorCode);
    }
    return redirect('success');
  } catch (error) {
    const code = safeErrorCode(error, 'outlook_callback_failed');
    console.error('[bank-outlook-callback]', { code });
    if (auditHotelId) await admin.from('bank_payment_audit_log').insert({ hotel_id: auditHotelId,
      user_id: auditUserId, action: 'outlook_connection_failed', details: { error_code: code } });
    return redirect('error', code);
  }
}
