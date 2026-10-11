import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0';
import type { NormalizedEmail, PilotHotel } from './types.ts';
import type { BankEmailIntegrationRow, AccessContext } from './integration-service.ts';
import { decryptToken, encryptToken, getTokenEncryptionKey } from './token-crypto.ts';
import { normalizeHeaders, parseAuthenticationResults, parseGmailMessage } from './gmail-message.ts';
import { bankEmailMatchesKey } from './hotel-scope.ts';
import { readBankEmailConfig } from './config.ts';
import { analyzeBankEmail, isConfiguredBankSender } from './payment-service.ts';
import { HttpError, safeErrorCode } from './http.ts';

const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const SCOPES = 'openid profile email offline_access User.Read Mail.Read';

function outlookConfig() {
  const clientId = Deno.env.get('OUTLOOK_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('OUTLOOK_CLIENT_SECRET') || '';
  const apiUrl = Deno.env.get('API_BASE_URL') || Deno.env.get('SUPABASE_URL') || '';
  if (!clientId || !clientSecret || !apiUrl) {
    throw new HttpError(503, 'outlook_oauth_not_configured', 'La conexion de Outlook requiere configurar Microsoft en el servidor.');
  }
  // Reuse the redirect URI registered for the existing Calendar integration.
  return { clientId, clientSecret, redirectUri: `${apiUrl.replace(/\/$/u, '')}/functions/v1/calendar-oauth-callback` };
}

export function buildOutlookAuthorizationUrl(state: string): string {
  const config = outlookConfig();
  const params = new URLSearchParams({ client_id: config.clientId, response_type: 'code',
    redirect_uri: config.redirectUri, response_mode: 'query', scope: SCOPES, state, prompt: 'consent' });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
}

interface OutlookTokens { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }

async function requestOutlookTokens(parameters: Record<string, string>): Promise<OutlookTokens> {
  const config = outlookConfig();
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...parameters }),
    signal: AbortSignal.timeout(20_000), redirect: 'error'
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new HttpError(409,
    data.error === 'invalid_grant' ? 'outlook_invalid_grant' : 'outlook_token_failed',
    'No se pudo autorizar Outlook. Conecta nuevamente la cuenta.');
  return data;
}

export function exchangeOutlookAuthorizationCode(code: string): Promise<OutlookTokens> {
  return requestOutlookTokens({ code, grant_type: 'authorization_code', redirect_uri: outlookConfig().redirectUri });
}

export function validateGraphUrl(value: string): string {
  const url = new URL(value);
  if (url.origin !== GRAPH_ORIGIN || url.username || url.password || !url.pathname.startsWith('/v1.0/me/')) {
    throw new HttpError(502, 'outlook_invalid_graph_link', 'Outlook devolvio un enlace de sincronizacion invalido.');
  }
  return url.toString();
}

export async function outlookGraphGet(accessToken: string, pathOrUrl: string): Promise<Record<string, unknown>> {
  const url = validateGraphUrl(pathOrUrl.startsWith('/') ? `${GRAPH_ORIGIN}/v1.0/me${pathOrUrl}` : pathOrUrl);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`,
    Prefer: 'outlook.body-content-type="text", IdType="ImmutableId", odata.maxpagesize=25' },
    signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!response.ok) throw Object.assign(new HttpError(response.status === 401 ? 409 : 502,
    response.status === 410 ? 'outlook_delta_expired' : 'outlook_graph_failed',
    'No se pudo consultar el correo de Outlook.'), { upstreamStatus: response.status });
  return await response.json();
}

export async function getOutlookProfile(accessToken: string): Promise<{ email: string }> {
  const data = await outlookGraphGet(accessToken, '/?$select=mail,userPrincipalName');
  const email = String(data.mail || data.userPrincipalName || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new HttpError(409, 'outlook_email_missing', 'Microsoft no devolvio la direccion de correo.');
  return { email };
}

export async function getValidOutlookAccessToken(admin: SupabaseClient, integration: BankEmailIntegrationRow): Promise<AccessContext> {
  if (integration.provider !== 'microsoft') throw new HttpError(403, 'outlook_provider_mismatch', 'La conexion no pertenece a Outlook.');
  const key = getTokenEncryptionKey();
  let accessToken = await decryptToken(integration.access_token_encrypted, key);
  const expiry = new Date(integration.token_expires_at || '').getTime();
  if (!Number.isFinite(expiry) || expiry <= Date.now() + 300_000) {
    const tokens = await requestOutlookTokens({ grant_type: 'refresh_token',
      refresh_token: await decryptToken(integration.refresh_token_encrypted, key), scope: SCOPES });
    accessToken = tokens.access_token;
    const patch: Record<string, unknown> = {
      access_token_encrypted: await encryptToken(accessToken, key),
      token_expires_at: new Date(Date.now() + Math.max(60, tokens.expires_in || 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString()
    };
    if (tokens.refresh_token) patch.refresh_token_encrypted = await encryptToken(tokens.refresh_token, key);
    const { data, error } = await admin.from('bank_email_integrations').update(patch)
      .eq('id', integration.id).eq('hotel_id', integration.hotel_id).eq('provider', 'microsoft').select('*').single();
    if (error || !data) throw new HttpError(503, 'outlook_token_store_failed', 'No se pudo renovar la conexion.');
    return { accessToken, integration: data };
  }
  return { accessToken, integration };
}

export interface OutlookMessage {
  id?: string; subject?: string; receivedDateTime?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  body?: { content?: string; contentType?: string };
  internetMessageHeaders?: { name: string; value: string }[];
  '@removed'?: unknown;
}

export function parseOutlookMessage(message: OutlookMessage): NormalizedEmail {
  const headers = [...(message.internetMessageHeaders || [])];
  if (!headers.some(h => h.name.toLowerCase() === 'from')) headers.push({ name: 'From', value: message.from?.emailAddress?.address || '' });
  if (!headers.some(h => h.name.toLowerCase() === 'subject')) headers.push({ name: 'Subject', value: message.subject || '' });
  let binary = '';
  for (const byte of new TextEncoder().encode(message.body?.content || '')) binary += String.fromCharCode(byte);
  const normalized = parseGmailMessage({ id: message.id ? `outlook:${message.id}` : '',
    internalDate: String(new Date(message.receivedDateTime || '').getTime()), payload: { headers,
      mimeType: message.body?.contentType?.toLowerCase() === 'html' ? 'text/html' : 'text/plain',
      body: { data: btoa(binary) } } });
  normalized.authentication = parseAuthenticationResults(normalizeHeaders(headers), 'microsoft');
  return normalized;
}

function initialDeltaLink(integration: BankEmailIntegrationRow): string {
  // Start at connection time; reconnection/recovery retains seven days, IDs deduplicate retries.
  const since = new Date(Math.max(new Date(integration.created_at).getTime() - 600_000, Date.now() - 7 * 86_400_000)).toISOString();
  const params = new URLSearchParams({ '$select': 'id,from,subject,body,receivedDateTime,internetMessageHeaders',
    '$filter': `receivedDateTime ge ${since}` });
  return `${GRAPH_ORIGIN}/v1.0/me/mailFolders/inbox/messages/delta?${params}`;
}

export async function syncOutlookPayments(admin: SupabaseClient, hotel: PilotHotel, integration: BankEmailIntegrationRow): Promise<{ processed: number; more: boolean; busy?: boolean }> {
  if (integration.hotel_id !== hotel.id || integration.provider !== 'microsoft') throw new HttpError(403, 'outlook_hotel_mismatch', 'La conexion no pertenece al hotel.');
  if (!integration.bank_key) throw new HttpError(409, 'bank_key_required', 'Configura la llave bancaria del hotel.');
  const { data: lock, error: lockError } = await admin.rpc('claim_bank_outlook_sync', { p_hotel_id: hotel.id, p_integration_id: integration.id });
  if (lockError) throw new HttpError(503, 'outlook_sync_lock_failed', 'No se pudo iniciar la sincronizacion.');
  if (!lock) return { processed: 0, more: false, busy: true };
  let processed = 0;
  let more = false;
  try {
    const { accessToken, integration: fresh } = await getValidOutlookAccessToken(admin, integration);
    const profile = await getOutlookProfile(accessToken);
    if (profile.email !== fresh.connected_email.toLowerCase()) throw new HttpError(409, 'outlook_account_mismatch', 'La cuenta Outlook no coincide.');
    let link = fresh.outlook_delta_link || initialDeltaLink(fresh);
    const config = { ...readBankEmailConfig(), pilotHotelId: hotel.id, pilotHotelName: hotel.nombre, gmailPaymentLabel: fresh.gmail_label_name };
    for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
      let page;
      try { page = await outlookGraphGet(accessToken, link); }
      catch (error) {
        if (safeErrorCode(error) !== 'outlook_delta_expired') throw error;
        link = initialDeltaLink(fresh);
        page = await outlookGraphGet(accessToken, link);
      }
      for (const message of (Array.isArray(page.value) ? page.value : []) as OutlookMessage[]) {
        if (!message.id || message['@removed']) continue;
        const email = parseOutlookMessage(message);
        if (!isConfiguredBankSender(email) || !bankEmailMatchesKey(email.textBody, fresh.bank_key)) continue;
        await analyzeBankEmail(admin, hotel, email, config, { save: true, source: 'outlook',
          bankKey: fresh.bank_key, integrationId: fresh.id, userId: null });
        processed += 1;
      }
      const next = String(page['@odata.nextLink'] || page['@odata.deltaLink'] || '');
      if (!next) throw new HttpError(502, 'outlook_delta_link_missing', 'Outlook no devolvio el cursor de sincronizacion.');
      link = validateGraphUrl(next);
      const { data: changed, error } = await admin.from('bank_email_integrations').update({
        outlook_delta_link: link, watch_status: 'active', last_watch_renewed_at: new Date().toISOString(),
        last_error_code: null, updated_at: new Date().toISOString()
      }).eq('id', fresh.id).eq('hotel_id', hotel.id).eq('sync_lock_token', lock).select('id').maybeSingle();
      if (error || !changed) throw new HttpError(503, 'outlook_cursor_store_failed', 'No se pudo guardar la sincronizacion.');
      more = Boolean(page['@odata.nextLink']);
      if (!more) break;
    }
    return { processed, more };
  } catch (error) {
    await admin.from('bank_email_integrations').update({ watch_status: 'error', last_error_code: safeErrorCode(error, 'outlook_sync_failed') })
      .eq('id', integration.id).eq('hotel_id', hotel.id).eq('sync_lock_token', lock);
    throw error;
  } finally {
    await admin.from('bank_email_integrations').update({ sync_lock_token: null, sync_locked_until: null })
      .eq('id', integration.id).eq('hotel_id', hotel.id).eq('sync_lock_token', lock);
  }
}
