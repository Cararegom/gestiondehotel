import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { google } from "npm:googleapis";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

async function decrypt(ciphertextB64, password) {
  const {iv, ct} = JSON.parse(atob(ciphertextB64));
  const pwUtf8 = new TextEncoder().encode(password);
  const pwHash = await crypto.subtle.digest('SHA-256', pwUtf8);
  const alg = { name: 'AES-GCM', iv: new Uint8Array(iv) };
  const key = await crypto.subtle.importKey('raw', pwHash, alg, false, ['decrypt']);
  const ptBuffer = await crypto.subtle.decrypt(alg, key, new Uint8Array(ct));
  return new TextDecoder().decode(ptBuffer);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const { hotelId, provider, eventId } = await req.json();
    if (!hotelId || !provider || !eventId) {
      throw new Error("hotelId, provider y eventId son requeridos.");
    }
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "", 
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    const { data: dbTokenData } = await supabaseAdmin
      .from("oauth_tokens")
      .select("access_token_encrypted")
      .eq("hotel_id", hotelId)
      .eq("provider", provider)
      .single();
    if (!dbTokenData) throw new Error("No se encontró token para el hotel/proveedor.");

    const ENCRYPTION_KEY = Deno.env.get("MY_ENCRYPTION_SECRET");
    const accessToken = await decrypt(dbTokenData.access_token_encrypted, ENCRYPTION_KEY);
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const calendar = google.calendar({
      version: "v3",
      auth: oauth2Client
    });

    // BORRAR el evento
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: eventId
    });

    return new Response(JSON.stringify({
      ok: true,
      message: "Evento eliminado correctamente.",
      eventId: eventId
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400
    });
  }
});
