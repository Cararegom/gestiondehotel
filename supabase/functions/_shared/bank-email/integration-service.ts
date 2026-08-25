import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0';
import { decryptToken, encryptToken, getTokenEncryptionKey } from './token-crypto.ts';
import { refreshGoogleAccessToken } from './google-oauth.ts';
import {
  findGmailLabel,
  getGmailProfile,
  registerGmailWatch,
  type GmailProfile
} from './gmail-api.ts';

export interface BankEmailIntegrationRow {
  id: string;
  hotel_id: string;
  provider: string;
  connected_email: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string | null;
  gmail_label_name: string;
  gmail_label_id: string | null;
  gmail_history_id: string | null;
  watch_expiration: string | null;
  watch_status: string;
  watch_renewal_failures: number;
  last_watch_renewed_at: string | null;
  last_error_code: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccessContext {
  accessToken: string;
  integration: BankEmailIntegrationRow;
}

export async function getBankEmailIntegration(
  admin: SupabaseClient,
  pilotHotelId: string
): Promise<BankEmailIntegrationRow | null> {
  const { data, error } = await admin
    .from('bank_email_integrations')
    .select('*')
    .eq('hotel_id', pilotHotelId)
    .eq('provider', 'google')
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error('No se pudo consultar la integracion de Gmail.'), {
      code: 'integration_lookup_failed'
    });
  }
  if (data && data.hotel_id !== pilotHotelId) {
    throw Object.assign(new Error('La integracion no pertenece al hotel piloto.'), {
      code: 'integration_hotel_mismatch'
    });
  }
  return data as BankEmailIntegrationRow | null;
}

export async function getValidGmailAccessToken(
  admin: SupabaseClient,
  integration: BankEmailIntegrationRow
): Promise<AccessContext> {
  const encryptionKey = getTokenEncryptionKey();
  const refreshToken = await decryptToken(integration.refresh_token_encrypted, encryptionKey);
  let accessToken = await decryptToken(integration.access_token_encrypted, encryptionKey);
  const expiresAt = integration.token_expires_at ? new Date(integration.token_expires_at).getTime() : 0;

  if (!expiresAt || expiresAt - Date.now() <= 5 * 60 * 1000) {
    const refreshed = await refreshGoogleAccessToken(refreshToken);
    accessToken = refreshed.access_token;
    const nextExpiresAt = new Date(Date.now() + Math.max(60, refreshed.expires_in || 3600) * 1000).toISOString();
    const { data, error } = await admin
      .from('bank_email_integrations')
      .update({
        access_token_encrypted: await encryptToken(accessToken, encryptionKey),
        token_expires_at: nextExpiresAt,
        last_error_code: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', integration.id)
      .eq('hotel_id', integration.hotel_id)
      .select('*')
      .single();
    if (error || !data) {
      throw Object.assign(new Error('No se pudo guardar el token renovado.'), {
        code: 'refreshed_token_store_failed'
      });
    }
    return { accessToken, integration: data as BankEmailIntegrationRow };
  }

  return { accessToken, integration };
}

export async function renewGmailWatch(
  admin: SupabaseClient,
  integration: BankEmailIntegrationRow
): Promise<{ integration: BankEmailIntegrationRow; profile: GmailProfile }> {
  const { accessToken, integration: freshIntegration } = await getValidGmailAccessToken(admin, integration);
  const profile = await getGmailProfile(accessToken);
  if (
    profile.emailAddress.trim().toLowerCase() !==
    freshIntegration.connected_email.trim().toLowerCase()
  ) {
    throw Object.assign(new Error('La cuenta Gmail no coincide con la integracion guardada.'), {
      code: 'gmail_account_mismatch'
    });
  }

  const labelName = Deno.env.get('GMAIL_PAYMENT_LABEL') || freshIntegration.gmail_label_name;
  const label = await findGmailLabel(accessToken, labelName);
  if (!label) {
    await admin
      .from('bank_email_integrations')
      .update({
        gmail_label_name: labelName,
        gmail_label_id: null,
        watch_status: 'label_missing',
        last_error_code: 'gmail_label_missing',
        updated_at: new Date().toISOString()
      })
      .eq('id', freshIntegration.id)
      .eq('hotel_id', freshIntegration.hotel_id);
    throw Object.assign(new Error('No existe la etiqueta Gmail requerida.'), {
      code: 'gmail_label_missing'
    });
  }

  const topicName = Deno.env.get('GOOGLE_PUBSUB_TOPIC') || '';
  if (!topicName) {
    throw Object.assign(new Error('GOOGLE_PUBSUB_TOPIC no esta configurada.'), {
      code: 'missing_google_pubsub_topic'
    });
  }

  const watch = await registerGmailWatch(accessToken, topicName, label.id);
  const patch: Record<string, unknown> = {
    gmail_label_name: labelName,
    gmail_label_id: label.id,
    watch_expiration: new Date(Number(watch.expiration)).toISOString(),
    watch_status: 'active',
    watch_renewal_failures: 0,
    last_watch_renewed_at: new Date().toISOString(),
    last_error_code: null,
    updated_at: new Date().toISOString()
  };
  if (!freshIntegration.gmail_history_id) patch.gmail_history_id = watch.historyId;

  const { data, error } = await admin
    .from('bank_email_integrations')
    .update(patch)
    .eq('id', freshIntegration.id)
    .eq('hotel_id', freshIntegration.hotel_id)
    .select('*')
    .single();
  if (error || !data) {
    throw Object.assign(new Error('No se pudo guardar el estado de Gmail Watch.'), {
      code: 'gmail_watch_store_failed'
    });
  }
  return { integration: data as BankEmailIntegrationRow, profile };
}

export async function recordWatchFailure(
  admin: SupabaseClient,
  integration: BankEmailIntegrationRow,
  errorCode: string
): Promise<void> {
  const nextFailures = Number(integration.watch_renewal_failures || 0) + 1;
  const { error } = await admin
    .from('bank_email_integrations')
    .update({
      watch_status: nextFailures >= 3 ? 'error' : 'renewal_pending',
      watch_renewal_failures: nextFailures,
      last_error_code: errorCode.slice(0, 80),
      updated_at: new Date().toISOString()
    })
    .eq('id', integration.id)
    .eq('hotel_id', integration.hotel_id);
  if (error) {
    throw Object.assign(new Error('No se pudo registrar el fallo de Gmail Watch.'), {
      code: 'watch_failure_store_failed'
    });
  }
}
