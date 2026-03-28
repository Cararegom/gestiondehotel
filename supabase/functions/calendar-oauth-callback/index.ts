import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { google } from "npm:googleapis";
// Utilidad de cifrado JS (AES-GCM)
async function encrypt(text, password) {
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
  const ptUint8 = new TextEncoder().encode(text);
  const ctBuffer = await crypto.subtle.encrypt(alg, key, ptUint8);
  return btoa(JSON.stringify({
    iv: Array.from(iv),
    ct: Array.from(new Uint8Array(ctBuffer))
  }));
}
serve(async (req)=>{
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  const SITE_URL = Deno.env.get("SITE_URL");
  const ENCRYPTION_KEY = Deno.env.get("MY_ENCRYPTION_SECRET");
  if (errorParam) {
    const errorDescription = url.searchParams.get("error_description") || "Error desconocido durante la autorización.";
    return Response.redirect(`${SITE_URL}#/integraciones?calendar_status=error&message=${encodeURIComponent(errorDescription)}`, 302);
  }
  if (!code || !state) {
    return new Response("Parámetros 'code' y 'state' son requeridos.", {
      status: 400
    });
  }
  let hotelId, provider;
  try {
    const parsed = JSON.parse(atob(state));
    hotelId = parsed.hotelId;
    provider = parsed.provider;
    if (!hotelId || !provider) throw new Error();
  } catch  {
    return new Response("Parámetro 'state' inválido.", {
      status: 400
    });
  }
  const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const REDIRECT_URI = `${Deno.env.get("API_BASE_URL")}/functions/v1/calendar-oauth-callback`;
  try {
    let tokens;
    let userEmail = null;
    let scopes = [];
    if (provider === "google") {
      const oauth2Client = new google.auth.OAuth2(Deno.env.get("GOOGLE_CLIENT_ID"), Deno.env.get("GOOGLE_CLIENT_SECRET"), REDIRECT_URI);
      const { tokens: gTokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(gTokens);
      const oauth2 = google.oauth2({
        version: "v2",
        auth: oauth2Client
      });
      const { data: userInfo } = await oauth2.userinfo.get();
      userEmail = userInfo.email;
      tokens = gTokens;
      scopes = gTokens.scope?.split(" ") ?? [];
    } else if (provider === "outlook") {
  // --- LÓGICA OUTLOOK ---
  const params = new URLSearchParams({
    client_id: Deno.env.get("OUTLOOK_CLIENT_ID"),
    client_secret: Deno.env.get("OUTLOOK_CLIENT_SECRET"),
    code: code,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI
  });
  const resp = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    body: params,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    }
  });
  const tokenData = await resp.json();
  if (!resp.ok) {
    throw new Error(tokenData.error_description || "No se pudo obtener el token de Outlook.");
  }
  tokens = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expiry_date: Date.now() + (tokenData.expires_in ? tokenData.expires_in * 1000 : 0)
  };
  scopes = tokenData.scope ? tokenData.scope.split(" ") : [];
  // Intentar obtener email del usuario usando Graph
  try {
    const profileResp = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: {
        "Authorization": `Bearer ${tokens.access_token}`
      }
    });
    const profileData = await profileResp.json();
    console.log("Perfil recibido de Outlook:", profileData);
    if (profileData.mail) userEmail = profileData.mail;
    else if (profileData.userPrincipalName) userEmail = profileData.userPrincipalName;
  } catch (e) {
    console.log("Error obteniendo perfil de Outlook:", e);
  }

    } else {
      throw new Error("Proveedor no soportado");
    }
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error("El proveedor no devolvió un access token o refresh token.");
    }
    // Cifrar tokens con JS (no SQL)
    const accessEncrypted = await encrypt(tokens.access_token, ENCRYPTION_KEY);
    const refreshEncrypted = await encrypt(tokens.refresh_token, ENCRYPTION_KEY);
    const { error: upErr } = await supabaseAdmin.from("oauth_tokens").upsert({
      hotel_id: hotelId,
      provider: provider,
      access_token_encrypted: accessEncrypted,
      refresh_token_encrypted: refreshEncrypted,
      user_email: userEmail,
      expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      scopes: scopes,
      updated_at: new Date().toISOString()
    }, {
      onConflict: "hotel_id, provider"
    });
    if (upErr) throw upErr;
    return Response.redirect(`${SITE_URL}#/integraciones?calendar_status=success&provider=${provider}`, 302);
  } catch (err) {
    console.error("Error en el callback de OAuth:", err);
    const msg = encodeURIComponent(err.message);
    const errUrl = `${SITE_URL}#/integraciones?calendar_status=error&message=${msg}`;
    return Response.redirect(errUrl, 302);
  }
});
