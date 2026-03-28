import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('PROJECT_URL');
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  Deno.env.get('SERVICE_ROLE_KEY') ??
  Deno.env.get('SERVICE_ROLE');

const ALLOWED_ORIGINS = new Set([
  'https://gestiondehotel.com',
  'https://www.gestiondehotel.com',
  'http://127.0.0.1:5500',
  'http://localhost:5500'
]);

function buildCorsHeaders(origin: string | null) {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://gestiondehotel.com';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'content-type, authorization, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(origin),
      'Content-Type': 'application/json'
    }
  });
}

function sanitizeString(value: unknown, maxLength = 280) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function buildSupabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin credentials are not configured.');
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
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
    const usuario = sanitizeString(payload?.usuario, 180);
    const apiKeyInput = typeof payload?.apiKey === 'string' ? payload.apiKey : null;

    if (!hotelId) {
      return jsonResponse({ error: 'hotelId is required.' }, 400, origin);
    }

    const supabaseAdmin = buildSupabaseAdmin();
    const upsertPayload: Record<string, unknown> = {
      hotel_id: hotelId,
      facturador_nombre: 'Alegra',
      facturador_usuario: usuario || null,
      updated_at: new Date().toISOString()
    };

    if (apiKeyInput !== null) {
      const apiKey = apiKeyInput.trim();
      upsertPayload.facturador_api_key = apiKey || null;
    }

    const { error } = await supabaseAdmin
      .from('integraciones_hotel')
      .upsert(upsertPayload, { onConflict: 'hotel_id, facturador_nombre' });

    if (error) {
      console.error('Error guardando configuración de Alegra:', error);
      return jsonResponse({ error: 'No se pudo guardar la configuración de Alegra.', detail: error.message }, 500, origin);
    }

    return jsonResponse(
      {
        ok: true,
        message: 'Configuración de Alegra guardada correctamente.',
        masked: Boolean(upsertPayload.facturador_api_key)
      },
      200,
      origin
    );
  } catch (error) {
    console.error('Error inesperado en alegra-save-config:', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error.' }, 500, origin);
  }
});
