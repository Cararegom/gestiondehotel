import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0';
import type { PilotHotel } from './types.ts';
import { HttpError } from './http.ts';

export interface HotelBankSettings {
  labelName: string;
  bankKey: string;
}

export function suggestedBankLabel(hotelName: string): string {
  const name = hotelName.normalize('NFKC').trim().replace(/^hotel\s+/iu, '').toLocaleUpperCase('es-CO');
  return `PAGOS HOTEL ${name}`.slice(0, 160);
}

export function validateHotelBankSettings(input: { labelName?: unknown; bankKey?: unknown }): HotelBankSettings {
  const labelName = typeof input.labelName === 'string' ? input.labelName.trim() : '';
  const bankKey = typeof input.bankKey === 'string' ? input.bankKey.trim() : '';
  const hasControlCharacter = (value: string) => [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  if (!labelName || labelName.length > 160 || hasControlCharacter(labelName)) {
    throw new HttpError(400, 'invalid_gmail_label', 'Escribe el nombre exacto de la etiqueta de Gmail.');
  }
  if (!bankKey || bankKey.length > 160 || /\s/u.test(bankKey) || hasControlCharacter(bankKey)) {
    throw new HttpError(400, 'invalid_bank_key', 'Escribe la llave bancaria exacta de este hotel.');
  }
  return { labelName, bankKey };
}

export function bankEmailMatchesKey(body: string, bankKey: string): boolean {
  if (!bankKey.trim()) return false;
  const escaped = bankKey.trim().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`\\bllave\\s+${escaped}(?=\\s|[.,;:]|$)`, 'iu').test(body.normalize('NFKC'));
}

// Callers provide IDs from a verified profile, one-use OAuth state or stored
// integration. A client-supplied hotel ID never establishes authorization.
export async function getBankEmailHotel(admin: SupabaseClient, hotelId: string | null): Promise<PilotHotel> {
  if (!hotelId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(hotelId)) {
    throw new HttpError(403, 'hotel_required', 'No se pudo identificar el hotel autorizado.');
  }
  const { data: hotel, error } = await admin.from('hoteles').select('id,nombre').eq('id', hotelId).maybeSingle();
  if (error) throw new HttpError(503, 'bank_hotel_lookup_failed', 'No se pudo consultar el hotel.');
  if (!hotel || hotel.id !== hotelId) throw new HttpError(403, 'bank_hotel_not_found', 'El hotel no esta disponible.');
  const { data: feature, error: featureError } = await admin.from('hotel_features').select('enabled')
    .eq('hotel_id', hotelId).eq('feature_key', 'bank_reconciliation_v2').maybeSingle();
  if (featureError) throw new HttpError(503, 'bank_feature_lookup_failed', 'No se pudo consultar la conciliacion bancaria.');
  if (feature?.enabled !== true) throw new HttpError(403, 'bank_feature_disabled', 'La conciliacion bancaria no esta habilitada para este hotel.');
  return { id: hotel.id, nombre: hotel.nombre };
}

export async function getHotelBankSettings(admin: SupabaseClient, hotel: PilotHotel): Promise<HotelBankSettings> {
  const { data, error } = await admin.from('hotel_features').select('configuration')
    .eq('hotel_id', hotel.id).eq('feature_key', 'bank_reconciliation_v2').single();
  if (error) throw new HttpError(503, 'bank_settings_lookup_failed', 'No se pudo consultar la configuracion bancaria.');
  const settings = data?.configuration || {};
  return {
    labelName: typeof settings.gmailLabelName === 'string' ? settings.gmailLabelName : suggestedBankLabel(hotel.nombre),
    bankKey: typeof settings.bankKey === 'string' ? settings.bankKey : ''
  };
}
