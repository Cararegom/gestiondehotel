// functions/calendar-webhook/index.ts (o .js si usas JS)
import { serve } from 'https://deno.land/std/http/server.ts';
// Si necesitas client de Supabase, también:
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

serve(async (req) => {
  const channelId = req.headers.get("X-Goog-Channel-ID");
  const resourceState = req.headers.get("X-Goog-Resource-State"); // "exists", "not_exists", "sync"
  const resourceId = req.headers.get("X-Goog-Resource-ID");
  const body = await req.text();
  
  // Log de headers para debug
  console.log("[Google Webhook] Headers:", {
    channelId, resourceId, resourceState,
    'Content-Type': req.headers.get("Content-Type")
  });
  
  // Google manda primero un "sync" para iniciar la suscripción. Solo responder OK.
  if (resourceState === "sync") {
    return new Response("SYNC OK", { status: 200 });
  }
  
  // TODO: Busca en tu tabla de integraciones qué hotel es según channelId o resourceId
  // Ejemplo: let { data: integracion } = await supabase.from('integraciones_calendar').select('*').eq('channel_id', channelId).single();

  // Ahora, consulta los eventos del calendario y sincronízalos con reservas internas
  // (puedes llamar tu función calendar-sync-events con el hotelId para que reutilice lógica)

  // Ejemplo (pseudo-código):
  // const { data: syncResult, error } = await supabase.functions.invoke('calendar-sync-events', { body: { hotelId: integracion.hotel_id } });
  // if (error) console.error("Error sincronizando eventos calendar:", error.message);

  console.log("[Google Webhook] Evento procesado para canal:", channelId);
  return new Response("OK", { status: 200 });
});
