import { buildAdminClient } from '../_shared/bank-email/server.ts';
import { getPilotHotel } from '../_shared/bank-email/pilot-hotel.ts';
import { exchangeGoogleAuthorizationCode, revokeGoogleToken } from '../_shared/bank-email/google-oauth.ts';
import { decryptToken, encryptToken, getTokenEncryptionKey } from '../_shared/bank-email/token-crypto.ts';
import { getGmailProfile, stopGmailWatch } from '../_shared/bank-email/gmail-api.ts';
import {
  getBankEmailIntegration,
  getValidGmailAccessToken,
  renewGmailWatch,
  type BankEmailIntegrationRow
} from '../_shared/bank-email/integration-service.ts';
import { buildOAuthRedirect, hashOAuthState } from '../_shared/bank-email/oauth-state.ts';
import { safeErrorCode } from '../_shared/bank-email/http.ts';
import { isBankEmailProcessingEnabled, readBankEmailConfig } from '../_shared/bank-email/config.ts';

function redirectResult(status: string, code?: string): Response {
  const parameters: Record<string, string> = { gmail_payment_status: status };
  if (code) parameters.code = code;
  return Response.redirect(buildOAuthRedirect(parameters), 302);
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const url = new URL(req.url);
  if (url.searchParams.get('error')) return redirectResult('error', 'google_authorization_denied');
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  if (!code || !state || code.length > 4096 || state.length > 512) {
    return redirectResult('error', 'invalid_oauth_callback');
  }

  const admin = buildAdminClient();
  let auditHotelId: string | null = null;
  let auditUserId: string | null = null;

  try {
    const config = readBankEmailConfig();
    if (!isBankEmailProcessingEnabled(config)) {
      throw Object.assign(new Error('La integracion bancaria esta deshabilitada.'), {
        code: 'bank_email_integration_disabled'
      });
    }
    const stateHash = await hashOAuthState(state);
    const now = new Date().toISOString();
    const { data: pendingState, error: stateError } = await admin
      .from('bank_email_oauth_states')
      .select('id, hotel_id, user_id, expires_at, consumed_at')
      .eq('state_hash', stateHash)
      .is('consumed_at', null)
      .gt('expires_at', now)
      .maybeSingle();
    if (stateError || !pendingState) {
      throw Object.assign(new Error('El estado OAuth no es valido o expiro.'), { code: 'invalid_oauth_state' });
    }

    const { data: consumed, error: consumeError } = await admin
      .from('bank_email_oauth_states')
      .update({ consumed_at: now })
      .eq('id', pendingState.id)
      .is('consumed_at', null)
      .select('id')
      .maybeSingle();
    if (consumeError || !consumed) {
      throw Object.assign(new Error('El estado OAuth ya fue utilizado.'), { code: 'oauth_state_replayed' });
    }

    const pilotHotel = await getPilotHotel(admin, config.pilotHotelName);
    if (pendingState.hotel_id !== pilotHotel.id) {
      throw Object.assign(new Error('El estado OAuth no pertenece al hotel piloto.'), {
        code: 'oauth_state_hotel_mismatch'
      });
    }
    auditHotelId = pilotHotel.id;
    auditUserId = pendingState.user_id;

    const { data: profile, error: profileError } = await admin
      .from('usuarios')
      .select('id, hotel_id, rol, activo')
      .eq('id', pendingState.user_id)
      .maybeSingle();
    const role = String(profile?.rol || '').trim().toLowerCase();
    const { data: hotel } = await admin
      .from('hoteles')
      .select('creado_por')
      .eq('id', pilotHotel.id)
      .maybeSingle();
    const isAdministrator = ['admin', 'superadmin', 'administrador'].includes(role) ||
      hotel?.creado_por === pendingState.user_id;
    if (
      profileError || !profile || profile.activo !== true ||
      profile.hotel_id !== pilotHotel.id || !isAdministrator
    ) {
      throw Object.assign(new Error('El administrador OAuth ya no esta autorizado.'), {
        code: 'oauth_user_not_authorized'
      });
    }

    const tokens = await exchangeGoogleAuthorizationCode(code);
    if (!tokens.refresh_token) {
      throw Object.assign(new Error('Google no devolvio refresh token.'), {
        code: 'google_refresh_token_missing'
      });
    }
    const gmailProfile = await getGmailProfile(tokens.access_token);
    const encryptionKey = getTokenEncryptionKey();
    const expiresAt = new Date(Date.now() + Math.max(60, tokens.expires_in || 3600) * 1000).toISOString();
    const labelName = Deno.env.get('GMAIL_PAYMENT_LABEL') || 'PAGOS HOTEL MARENA';
    const existingIntegration = await getBankEmailIntegration(admin, pilotHotel.id);
    const sameMailbox = existingIntegration?.connected_email.trim().toLowerCase() ===
      gmailProfile.emailAddress.trim().toLowerCase();
    let previousAccessToken: string | null = null;
    let previousRefreshToken: string | null = null;
    if (existingIntegration && !sameMailbox) {
      try {
        const previousToken = await getValidGmailAccessToken(admin, existingIntegration);
        previousAccessToken = previousToken.accessToken;
        previousRefreshToken = await decryptToken(
          previousToken.integration.refresh_token_encrypted,
          encryptionKey
        );
      } catch {
        // Local replacement remains authoritative if the previous grant is already unusable.
      }
    }

    const { data: integration, error: integrationError } = await admin
      .from('bank_email_integrations')
      .upsert({
        hotel_id: pilotHotel.id,
        provider: 'google',
        connected_email: gmailProfile.emailAddress,
        access_token_encrypted: await encryptToken(tokens.access_token, encryptionKey),
        refresh_token_encrypted: await encryptToken(tokens.refresh_token, encryptionKey),
        token_expires_at: expiresAt,
        gmail_label_name: labelName,
        gmail_label_id: sameMailbox ? existingIntegration?.gmail_label_id || null : null,
        gmail_history_id: sameMailbox ? existingIntegration?.gmail_history_id || null : null,
        watch_expiration: null,
        watch_status: 'pending',
        watch_renewal_failures: 0,
        last_error_code: null,
        created_by: pendingState.user_id,
        updated_at: now
      }, { onConflict: 'hotel_id,provider' })
      .select('*')
      .single();
    if (integrationError || !integration || integration.hotel_id !== pilotHotel.id) {
      throw Object.assign(new Error('No se pudo guardar la conexion Gmail.'), {
        code: 'gmail_integration_store_failed'
      });
    }

    if (existingIntegration && !sameMailbox) {
      if (previousAccessToken) await stopGmailWatch(previousAccessToken).catch(() => undefined);
      if (previousRefreshToken) await revokeGoogleToken(previousRefreshToken).catch(() => undefined);
    }

    let redirectStatus = 'success';
    let redirectCode = '';
    try {
      await renewGmailWatch(admin, integration as BankEmailIntegrationRow);
    } catch (watchError) {
      redirectStatus = 'connected_watch_pending';
      redirectCode = safeErrorCode(watchError, 'gmail_watch_failed');
    }

    await admin.from('bank_payment_audit_log').insert({
      hotel_id: pilotHotel.id,
      user_id: pendingState.user_id,
      action: 'gmail_connected',
      payment_event_id: null,
      details: {
        watch_status: redirectStatus,
        error_code: redirectCode || null,
        mailbox_replaced: Boolean(existingIntegration && !sameMailbox)
      }
    });

    return redirectResult(redirectStatus, redirectCode || undefined);
  } catch (error) {
    const errorCode = safeErrorCode(error, 'oauth_callback_failed');
    console.error('[gmail-oauth-callback]', { code: errorCode });
    if (auditHotelId) {
      await admin.from('bank_payment_audit_log').insert({
        hotel_id: auditHotelId,
        user_id: auditUserId,
        action: 'gmail_connection_failed',
        payment_event_id: null,
        details: { error_code: errorCode }
      });
    }
    return redirectResult('error', errorCode);
  }
});
