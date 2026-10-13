import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0';
import { DEFAULT_BANK_TIME_ZONE, normalizeBankTimeZone } from './time-zone.ts';

export async function loadHotelOperationalTimeZone(admin: SupabaseClient, hotelId: string): Promise<string> {
  const { data, error } = await admin.rpc('hotel_time_zone', { p_hotel_id: hotelId });
  if (error) {
    throw Object.assign(new Error('No se pudo consultar la zona horaria del hotel.'), {
      code: 'hotel_time_zone_lookup_failed'
    });
  }
  return normalizeBankTimeZone(data, DEFAULT_BANK_TIME_ZONE);
}
