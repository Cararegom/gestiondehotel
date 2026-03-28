import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { google } from "npm:googleapis";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
// Desencriptar igual que tienes
async function decrypt(ciphertextB64, password) {
  const { iv, ct } = JSON.parse(atob(ciphertextB64));
  const pwUtf8 = new TextEncoder().encode(password);
  const pwHash = await crypto.subtle.digest('SHA-256', pwUtf8);
  const alg = {
    name: 'AES-GCM',
    iv: new Uint8Array(iv)
  };
  const key = await crypto.subtle.importKey('raw', pwHash, alg, false, [
    'decrypt'
  ]);
  const ptBuffer = await crypto.subtle.decrypt(alg, key, new Uint8Array(ct));
  return new TextDecoder().decode(ptBuffer);
}
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { hotelId } = await req.json();
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    // 1. Buscar tokens del hotel
    const { data: dbTokenData, error: tokenError } = await supabaseAdmin.from("oauth_tokens").select("access_token_encrypted, refresh_token_encrypted, expires_at").eq("hotel_id", hotelId).eq("provider", "google").single();
    if (!dbTokenData) throw new Error("Token no encontrado para este hotel");
    const ENCRYPTION_KEY = Deno.env.get("MY_ENCRYPTION_SECRET");
    let accessToken = await decrypt(dbTokenData.access_token_encrypted, ENCRYPTION_KEY);
    let refreshToken = await decrypt(dbTokenData.refresh_token_encrypted, ENCRYPTION_KEY);
    let expiresAt = dbTokenData.expires_at ? new Date(dbTokenData.expires_at).getTime() : 0;
    let now = Date.now();
    const oauth2Client = new google.auth.OAuth2(Deno.env.get("GOOGLE_CLIENT_ID"), Deno.env.get("GOOGLE_CLIENT_SECRET"));
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    // 2. Si expiró el token, refresca
    if (!accessToken || !refreshToken || expiresAt - now < 30000) {
      const tokens = await oauth2Client.refreshAccessToken();
      accessToken = tokens.credentials.access_token;
      expiresAt = tokens.credentials.expiry_date || now + 3600 * 1000;
      // Guarda el nuevo token y expires_at en la tabla
      const { error: updateError } = await supabaseAdmin.from("oauth_tokens").update({
        access_token_encrypted: btoa(JSON.stringify(await encrypt(accessToken, ENCRYPTION_KEY))),
        expires_at: new Date(expiresAt).toISOString()
      }).eq("hotel_id", hotelId).eq("provider", "google");
      if (updateError) console.error("No se pudo actualizar access_token:", updateError.message);
      oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken
      });
    }
    // 3. Llama la API
    const calendar = google.calendar({
      version: "v3",
      auth: oauth2Client
    });
    const { data } = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      maxResults: 100,
      singleEvents: true,
      orderBy: "startTime"
    });
    return new Response(JSON.stringify({
      events: data.items
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 400
    });
  }
});
// Opcional: si tienes encrypt como la inversa de decrypt
async function encrypt(plaintext, password) {
  const pwUtf8 = new TextEncoder().encode(password);
  const pwHash = await crypto.subtle.digest('SHA-256', pwUtf8);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const alg = {
    name: 'AES-GCM',
    iv: iv
  };
  const key = await crypto.subtle.importKey('raw', pwHash, alg, false, [
    'encrypt'
  ]);
  const ctBuffer = await crypto.subtle.encrypt(alg, key, new TextEncoder().encode(plaintext));
  return {
    iv: Array.from(iv),
    ct: Array.from(new Uint8Array(ctBuffer))
  };
}
