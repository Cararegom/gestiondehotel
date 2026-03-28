import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { google } from "npm:googleapis";
// Define las cabeceras CORS una sola vez para reutilizarlas
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Manejo de la solicitud preflight OPTIONS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { provider, hotelId } = await req.json();
    const API_BASE_URL = Deno.env.get("API_BASE_URL");
    if (!provider || !hotelId) {
      throw new Error("El proveedor y el ID del hotel son requeridos.");
    }
    if (!API_BASE_URL) {
      throw new Error("La variable de entorno API_BASE_URL no está configurada.");
    }
    const REDIRECT_URI = `${API_BASE_URL}/functions/v1/calendar-oauth-callback`;
    const state = btoa(JSON.stringify({
      hotelId,
      provider
    }));
    let authUrl = "";
    if (provider === 'google') {
      const oauth2Client = new google.auth.OAuth2(Deno.env.get("GOOGLE_CLIENT_ID"), Deno.env.get("GOOGLE_CLIENT_SECRET"), REDIRECT_URI);
      authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/userinfo.email'
        ],
        state: state
      });
    } else if (provider === 'outlook') {
      const tenant = 'common';
      const clientId = Deno.env.get("OUTLOOK_CLIENT_ID");
      console.log('OUTLOOK_CLIENT_ID cargado:', clientId); // Así es como se debe loguear
      const outlookAuthEndpoint = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        response_mode: 'query',
        scope: 'openid profile email offline_access User.Read Calendars.ReadWrite',
        state: state
      });
      authUrl = `${outlookAuthEndpoint}?${params.toString()}`;
    // --- FIN DE LA LÓGICA AÑADIDA ---
    } else {
      throw new Error("Proveedor no soportado.");
    }
    // Asegurarse de que la authUrl no esté vacía antes de responder
    if (!authUrl) {
      throw new Error(`No se pudo generar la URL de autorización para el proveedor: ${provider}`);
    }
    return new Response(JSON.stringify({
      authUrl
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error("Error en la función calendar-get-auth-url:", error);
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
