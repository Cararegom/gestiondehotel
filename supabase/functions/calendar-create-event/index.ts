import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { google } from "npm:googleapis";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

async function decrypt(ciphertextB64, password) {
  try {
    const {iv, ct} = JSON.parse(atob(ciphertextB64));
    const pwUtf8 = new TextEncoder().encode(password);
    const pwHash = await crypto.subtle.digest('SHA-256', pwUtf8);
    const alg = { name: 'AES-GCM', iv: new Uint8Array(iv) };
    const key = await crypto.subtle.importKey('raw', pwHash, alg, false, ['decrypt']);
    const ptBuffer = await crypto.subtle.decrypt(alg, key, new Uint8Array(ct));
    const result = new TextDecoder().decode(ptBuffer);
    console.log("[decrypt] Token descifrado correctamente");
    return result;
  } catch (e) {
    console.error("[decrypt] Error al descifrar:", e);
    throw e;
  }
}

async function resolveHotelTimeZone(supabaseAdmin, hotelId) {
  const { data, error } = await supabaseAdmin.rpc('hotel_time_zone', { p_hotel_id: hotelId });
  if (error || !data) {
    console.error('[calendar-create-event] No se pudo resolver la zona horaria del hotel.', { code: error?.code });
    throw new Error('No se pudo resolver la zona horaria configurada para el hotel.');
  }
  return String(data);
}

serve(async (req) => {
  console.log("---- Nueva petición recibida ----");
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    let body;
    try {
      body = await req.json();
      console.log("[calendar-create-event] Body recibido:", body);
    } catch (e) {
      console.error("[calendar-create-event] Error leyendo body:", e);
      throw new Error("Body JSON inválido o vacío.");
    }
    const { hotelId, provider, eventDetails } = body || {};
    if (!hotelId || !provider || !eventDetails) {
      console.error("[calendar-create-event] Faltan datos:", { hotelId, provider, eventDetails });
      throw new Error("hotelId, provider y eventDetails son requeridos.");
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    const hotelTimeZone = await resolveHotelTimeZone(supabaseAdmin, hotelId);

    const { data: dbTokenData, error: dbError } = await supabaseAdmin
      .from("oauth_tokens")
      .select("access_token_encrypted, expires_at")
      .eq("hotel_id", hotelId)
      .eq("provider", provider)
      .single();
    console.log("[calendar-create-event] Token recuperado:", dbTokenData, dbError);
    if (dbError || !dbTokenData) {
      console.error("[calendar-create-event] No se encontró token en BD:", dbError);
      throw new Error("No se encontró un token de autorización para este hotel y proveedor.");
    }

    const ENCRYPTION_KEY = Deno.env.get("MY_ENCRYPTION_SECRET");
    let accessToken;
    try {
      accessToken = await decrypt(dbTokenData.access_token_encrypted, ENCRYPTION_KEY);
      console.log("[calendar-create-event] AccessToken descifrado (primeros 10):", accessToken?.slice(0, 10), "...[oculto]");
    } catch (e) {
      console.error("[calendar-create-event] Error al descifrar token:", e);
      throw new Error("Error al descifrar el token: " + e.message);
    }

    let eventResult;
    if (provider === 'google') {
      try {
        console.log("[calendar-create-event] Creando evento en Google Calendar...");
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: accessToken });
        const calendar = google.calendar({
          version: "v3",
          auth: oauth2Client
        });
        const { data } = await calendar.events.insert({
          calendarId: 'primary',
          requestBody: {
            summary: eventDetails.summary,
            description: eventDetails.description,
            start: { dateTime: eventDetails.start, timeZone: hotelTimeZone },
            end: { dateTime: eventDetails.end, timeZone: hotelTimeZone }
          }
        });
        eventResult = data;
        console.log("[calendar-create-event] Evento creado OK:", eventResult.id);
      } catch (googleError) {
        console.error("[calendar-create-event] Error con Google Calendar API:", googleError);
        throw new Error("Error con Google Calendar API: " + (googleError?.message || googleError));
      }
    } else if (provider === 'outlook') {
      // La integración Outlook usa su función dedicada.
    }

    return new Response(JSON.stringify({
      message: "Evento creado exitosamente",
      event: eventResult
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });

  } catch (error) {
    console.error("[calendar-create-event] ERROR GENERAL:", error);
    return new Response(JSON.stringify({
      error: error.message || error
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400
    });
  }
});
