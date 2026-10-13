import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0';
import type { PilotHotel } from './types.ts';
import { assertBankEmailConfig, readBankEmailConfig } from './config.ts';
import { getBankEmailIntegration, getValidGmailAccessToken } from './integration-service.ts';
import { getGmailProfile } from './gmail-api.ts';
import { HttpError } from './http.ts';
import { processGmailReferences, type GmailProcessingResult } from './queue.ts';

export interface GmailReplayRequest {
  hotelId: string;
  messageIds: string[];
}

export function parseGmailReplayRequest(body: unknown): GmailReplayRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_replay_request', 'La solicitud de recuperacion no es valida.');
  }
  const value = body as Record<string, unknown>;
  if (
    value.action !== 'replay-messages' ||
    typeof value.hotelId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.hotelId) ||
    !Array.isArray(value.messageIds) || value.messageIds.length < 1 || value.messageIds.length > 50 ||
    !value.messageIds.every(id => typeof id === 'string' && /^[0-9a-f]{10,64}$/u.test(id))
  ) {
    throw new HttpError(400, 'invalid_replay_request', 'Indica un hotel y entre 1 y 50 identificadores Gmail.');
  }
  return { hotelId: value.hotelId, messageIds: [...new Set(value.messageIds)] };
}

export async function replayGmailMessages(
  admin: SupabaseClient,
  pilotHotel: PilotHotel,
  messageIds: string[]
): Promise<GmailProcessingResult> {
  const request = parseGmailReplayRequest({ action: 'replay-messages', hotelId: pilotHotel.id, messageIds });
  const config = { ...readBankEmailConfig(), pilotHotelId: pilotHotel.id, pilotHotelName: pilotHotel.nombre };
  assertBankEmailConfig(config);
  if (!config.enabled) throw new HttpError(409, 'bank_email_integration_disabled', 'La integracion bancaria esta deshabilitada.');
  const integration = await getBankEmailIntegration(admin, pilotHotel.id);
  if (!integration) throw new HttpError(404, 'integration_not_found', 'El hotel no tiene una conexion Gmail.');
  if (!integration.bank_key) throw new HttpError(409, 'bank_key_required', 'Configura la llave bancaria del hotel.');
  const { accessToken } = await getValidGmailAccessToken(admin, integration);
  const profile = await getGmailProfile(accessToken);
  if (profile.emailAddress.trim().toLowerCase() !== integration.connected_email.trim().toLowerCase()) {
    throw new HttpError(409, 'gmail_account_mismatch', 'La cuenta Gmail no coincide con la integracion.');
  }
  // Replay explicit messages independently of the live history cursor. Advancing
  // or rewinding that cursor could lose concurrent push deliveries.
  return await processGmailReferences(
    admin, pilotHotel, integration, config, accessToken,
    request.messageIds.map(id => ({ id }))
  );
}
