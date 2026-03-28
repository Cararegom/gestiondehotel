import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { google } from "npm:googleapis";

// === Variables CORS ===
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// === Función de DESCIFRADO ===
async function decrypt(ciphertextB64, password) {
  const { iv, ct } = JSON.parse(atob(ciphertextB64));
  const pwUtf8 = new TextEncoder().encode(password);
  const pwHash = await crypto.subtle.digest('SHA-256', pwUtf8);
  const alg = { name: 'AES-GCM', iv: new Uint8Array(iv) };
  const key = await crypto.subtle.importKey('raw', pwHash, alg, false, ['decrypt']);
  const ptBuffer = await crypto.subtle.decrypt(alg, key, new Uint8Array(ct));
  return new TextDecoder().decode(ptBuffer);
}

// === Función de CIFRADO para guardar el nuevo token ===
async function encrypt(text, password) {
  const pwUtf8 = new TextEncoder().encode(password);
  const pwHash = await crypto.subtle.digest('SHA-256', pwUtf8);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const alg = { name: 'AES-GCM', iv: iv };
  const key = await crypto.subtle.importKey('raw', pwHash, alg, false, ['encrypt']);
  const ptUint8 = new TextEncoder().encode(text);
  const ctBuffer = await crypto.subtle.encrypt(alg, key, ptUint8);
  return btoa(JSON.stringify({ iv: Array.from(iv), ct: Array.from(new Uint8Array(ctBuffer)) }));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const { hotelId, provider } = await req.json();
    if (!hotelId || !provider) throw new Error("hotelId y provider requeridos.");

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: dbTokenData } = await supabaseAdmin
      .from("oauth_tokens")
      .select("access_token_encrypted, refresh_token_encrypted")
      .eq("hotel_id", hotelId)
      .eq("provider", provider)
      .single();

    if (!dbTokenData) throw new Error("No hay token registrado para este hotel/proveedor.");
    const ENCRYPTION_KEY = Deno.env.get("MY_ENCRYPTION_SECRET");
    const accessToken = await decrypt(dbTokenData.access_token_encrypted, ENCRYPTION_KEY);
    const refreshToken = await decrypt(dbTokenData.refresh_token_encrypted, ENCRYPTION_KEY);

    const oauth2Client = new google.auth.OAuth2(
      Deno.env.get("GOOGLE_CLIENT_ID"),
      Deno.env.get("GOOGLE_CLIENT_SECRET")
    );
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    let data;
    try {
      // Intenta listar eventos normalmente
      ({ data } = await calendar.events.list({
        calendarId: 'primary',
        timeMin: new Date().toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: 'startTime'
      }));
    } catch (err) {
      // Si el access_token expiró, refresca usando el refresh_token
      if (err.response && err.response.status === 401 && refreshToken) {
        const { credentials } = await oauth2Client.refreshAccessToken();
        if (!credentials.access_token) throw new Error("No se pudo refrescar access_token.");
        // Cifra y guarda el nuevo token
        const newAccessEncrypted = await encrypt(credentials.access_token, ENCRYPTION_KEY);
        await supabaseAdmin
          .from("oauth_tokens")
          .update({ access_token_encrypted: newAccessEncrypted, updated_at: new Date().toISOString() })
          .eq("hotel_id", hotelId)
          .eq("provider", provider);
        // Intenta de nuevo la consulta
        oauth2Client.setCredentials({
          access_token: credentials.access_token,
          refresh_token: refreshToken,
        });
        ({ data } = await calendar.events.list({
          calendarId: 'primary',
          timeMin: new Date().toISOString(),
          maxResults: 10,
          singleEvents: true,
          orderBy: 'startTime'
        }));
      } else {
        throw err;
      }
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });
  } catch (error) {
    console.error("calendar-list-events error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400
    });
  }
});
