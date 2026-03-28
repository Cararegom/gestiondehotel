import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('PROJECT_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  Deno.env.get('SERVICE_ROLE_KEY') ??
  Deno.env.get('SERVICE_ROLE') ??
  '';

const ALLOWED_ORIGINS = new Set([
  'https://gestiondehotel.com',
  'https://www.gestiondehotel.com',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
]);

function buildCorsHeaders(origin: string | null) {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://gestiondehotel.com';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'content-type, authorization, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(origin),
      'Content-Type': 'application/json',
    },
  });
}

function sanitizeString(input: unknown, maxLength = 500) {
  return typeof input === 'string' ? input.trim().slice(0, maxLength) : '';
}

function createAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase service role is not configured.');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function buildAlegraAuthHeader(usuario: string, apiKey: string) {
  return `Basic ${btoa(`${usuario}:${apiKey}`)}`;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: buildCorsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, origin);
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse({ error: 'Origin not allowed.' }, 403, origin);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const hotelId = sanitizeString(payload?.hotelId, 80);

    if (!hotelId) {
      return jsonResponse({ ok: false, message: 'hotelId es requerido.' }, 400, origin);
    }

    const supabaseAdmin = createAdminClient();
    const { data: config, error: configError } = await supabaseAdmin
      .from('integraciones_hotel')
      .select('facturador_usuario, facturador_api_key')
      .eq('hotel_id', hotelId)
      .eq('facturador_nombre', 'Alegra')
      .maybeSingle();

    if (configError) {
      console.error('Error obteniendo configuracion de Alegra:', configError);
      return jsonResponse({ ok: false, message: 'No se pudo leer la configuracion de Alegra.' }, 500, origin);
    }

    const usuario = sanitizeString(config?.facturador_usuario, 200);
    const apiKey = sanitizeString(config?.facturador_api_key, 200);

    if (!usuario || !apiKey) {
      return jsonResponse(
        { ok: false, message: 'Faltan credenciales de Alegra para este hotel.' },
        400,
        origin,
      );
    }

    const response = await fetch('https://api.alegra.com/api/v1/contacts?start=0&limit=1', {
      method: 'GET',
      headers: {
        Authorization: buildAlegraAuthHeader(usuario, apiKey),
        Accept: 'application/json',
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        sanitizeString((data as { message?: string })?.message, 300) ||
        `Alegra respondio con estado ${response.status}.`;
      return jsonResponse({ ok: false, message }, 200, origin);
    }

    return jsonResponse(
      {
        ok: true,
        message: `Credenciales validas para ${usuario}. Conexion verificada con Alegra.`,
      },
      200,
      origin,
    );
  } catch (error) {
    console.error('Error inesperado en alegra-test-connection:', error);
    return jsonResponse({ ok: false, message: 'Unexpected error.' }, 500, origin);
  }
});
