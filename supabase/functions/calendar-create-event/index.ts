import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

async function decrypt(ciphertextB64, password) {
  try {
    const { iv, ct } = JSON.parse(atob(ciphertextB64));
    const pwUtf8 = new TextEncoder().encode(password);
    const pwHash = await crypto.subtle.digest('SHA-256', pwUtf8);
    const alg = { name: 'AES-GCM', iv: new Uint8Array(iv) };
    const key = await crypto.subtle.importKey('raw', pwHash, alg, false, ['decrypt']);
    const ptBuffer = await crypto.subtle.decrypt(alg, key, new Uint8Array(ct));
    return new TextDecoder().decode(ptBuffer);
  } catch (error) {
    console.error('[calendar-create-event] token_decrypt_failed');
    throw error;
  }
}

async function resolveHotelTimeZone(supabaseAdmin, hotelId) {
  const { data, error } = await supabaseAdmin.rpc('hotel_time_zone', { p_hotel_id: hotelId });
  if (error || !data) {
    console.error('[calendar-create-event] timezone_lookup_failed', { code: error?.code });
    throw new Error('No se pudo resolver la zona horaria configurada para el hotel.');
  }
  return String(data);
}

async function createGoogleCalendarEvent(accessToken, eventDetails, hotelTimeZone) {
  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      summary: eventDetails.summary,
      description: eventDetails.description,
      start: {
        dateTime: eventDetails.start,
        timeZone: hotelTimeZone
      },
      end: {
        dateTime: eventDetails.end,
        timeZone: hotelTimeZone
      }
    })
  });

  if (!response.ok) {
    const errorPayload = await response.text();
    console.error('[calendar-create-event] google_calendar_failed', { status: response.status });
    throw new Error(`Error con Google Calendar API (${response.status}): ${errorPayload.slice(0, 300)}`);
  }

  return await response.json();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let body;
    try {
      body = await req.json();
    } catch {
      throw new Error('Body JSON inválido o vacío.');
    }

    const { hotelId, provider, eventDetails } = body || {};
    if (!hotelId || !provider || !eventDetails) {
      throw new Error('hotelId, provider y eventDetails son requeridos.');
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    const hotelTimeZone = await resolveHotelTimeZone(supabaseAdmin, hotelId);

    const { data: dbTokenData, error: dbError } = await supabaseAdmin
      .from('oauth_tokens')
      .select('access_token_encrypted, expires_at')
      .eq('hotel_id', hotelId)
      .eq('provider', provider)
      .single();

    if (dbError || !dbTokenData) {
      console.error('[calendar-create-event] oauth_token_not_found', { code: dbError?.code });
      throw new Error('No se encontró un token de autorización para este hotel y proveedor.');
    }

    const encryptionKey = Deno.env.get('MY_ENCRYPTION_SECRET');
    if (!encryptionKey) {
      throw new Error('No está configurada la clave de cifrado del calendario.');
    }

    const accessToken = await decrypt(dbTokenData.access_token_encrypted, encryptionKey);

    let eventResult;
    if (provider === 'google') {
      eventResult = await createGoogleCalendarEvent(accessToken, eventDetails, hotelTimeZone);
      console.log('[calendar-create-event] google_event_created', { id: eventResult?.id || null });
    } else if (provider === 'outlook') {
      // La integración Outlook usa su función dedicada.
    } else {
      throw new Error('Proveedor de calendario no soportado.');
    }

    return new Response(JSON.stringify({
      message: 'Evento creado exitosamente',
      event: eventResult
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error('[calendar-create-event] request_failed', {
      message: error instanceof Error ? error.message : String(error)
    });
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error)
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
});
