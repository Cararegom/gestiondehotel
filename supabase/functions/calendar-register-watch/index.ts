// functions/calendar-register-watch/index.ts (o .js)
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GOOGLE_WEBHOOK_URL = "https://TU_EDGE_FUNCTION/calendar-webhook"; // Cambia esto por tu endpoint real

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

serve(async (req) => {
  try {
    const { hotel_id, calendar_id = "primary" } = await req.json();
    if (!hotel_id) return new Response("hotel_id es requerido", { status: 400 });

    // 1. Busca los tokens para este hotel
    const { data: tokenRow, error: errToken } = await supabase
      .from("oauth_tokens")
      .select("*")
      .eq("hotel_id", hotel_id)
      .eq("provider", "google")
      .single();
    if (errToken || !tokenRow) {
      return new Response("No se encontró el token para este hotel", { status: 400 });
    }

    // Desencripta si es necesario, o usa el campo directo
    const ACCESS_TOKEN = tokenRow.access_token_encrypted; // O desencripta si tu campo lo requiere

    // 2. Prepara el "watch" (suscripción push)
    const channelId = crypto.randomUUID();
    const body = {
      id: channelId,
      type: "web_hook",
      address: GOOGLE_WEBHOOK_URL,
      params: { ttl: "604800" } // máximo 7 días
    };

    // 3. Llama a la API de Google Calendar
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendar_id}/events/watch`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }
    );

    const result = await response.json();
    if (!response.ok) {
      console.error("Google Calendar watch error", result);
      return new Response("Error registrando watch: " + JSON.stringify(result), { status: 500 });
    }

    // 4. Guarda la integración (channelId, resourceId, hotel_id, calendar_id, fecha_expiracion, etc)
    await supabase.from("integraciones_calendar").insert([
      {
        hotel_id,
        calendar_id,
        channel_id: result.id || channelId,
        resource_id: result.resourceId,
        expiration: result.expiration ? new Date(Number(result.expiration)).toISOString() : null,
        status: "activo"
      }
    ]);

    return new Response(JSON.stringify({ ok: true, channelId, result }), { status: 200 });
  } catch (err) {
    console.error("Error calendar-register-watch:", err);
    return new Response("Error general: " + err.message, { status: 500 });
  }
});
