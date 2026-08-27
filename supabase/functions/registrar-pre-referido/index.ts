import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type'
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Metodo no permitido.' }, 405);

  try {
    const authorization = req.headers.get('Authorization') || '';
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Autenticacion requerida.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Servicio no configurado.' }, 503);

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: 'Sesion invalida.' }, 401);

    const { ref, nombre_hotel: nombreHotel } = await req.json();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const cleanName = String(nombreHotel || '').trim().slice(0, 160);
    if (!uuidRegex.test(String(ref || '')) || cleanName.length < 2 || ref === authData.user.id) {
      return json({ error: 'Datos de referido invalidos.' }, 400);
    }

    const { data: referrer } = await admin.from('usuarios').select('id').eq('id', ref).maybeSingle();
    if (!referrer) return json({ error: 'Referido no valido.' }, 400);

    const { error } = await admin.from('referidos').insert({
      referidor_id: ref,
      nombre_hotel_referido: cleanName,
      estado: 'trial',
      recompensa_otorgada: false
    });
    if (error) return json({ error: 'No fue posible registrar el referido.' }, 500);
    return json({ success: true });
  } catch {
    return json({ error: 'Solicitud invalida.' }, 400);
  }
});
