import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('PROJECT_URL') ?? '';
const SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  Deno.env.get('SERVICE_ROLE_KEY') ??
  Deno.env.get('SERVICE_ROLE') ??
  '';
const MAKE_CASH_CLOSE_WEBHOOK_URL = Deno.env.get('MAKE_CASH_CLOSE_WEBHOOK_URL') ?? '';

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

function sanitizeString(input: unknown, maxLength = 5000) {
  return typeof input === 'string' ? input.trim().slice(0, maxLength) : '';
}

function normalizeEmailList(raw: string) {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.includes('@'))
    .join(',');
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

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'Supabase service role is not configured.' }, 500, origin);
  }

  if (!MAKE_CASH_CLOSE_WEBHOOK_URL) {
    return jsonResponse({ error: 'MAKE_CASH_CLOSE_WEBHOOK_URL is not configured.' }, 500, origin);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const hotelId = sanitizeString(payload?.hotelId, 80);
    const subject = sanitizeString(payload?.subject, 200);
    const html = sanitizeString(payload?.html, 120000);
    const fallbackEmail = sanitizeString(payload?.fallbackEmail, 200);

    if (!hotelId) {
      return jsonResponse({ error: 'hotelId is required.' }, 400, origin);
    }
    if (!subject || !html) {
      return jsonResponse({ error: 'subject and html are required.' }, 400, origin);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: config, error: configError } = await admin
      .from('configuracion_hotel')
      .select('correo_reportes, correo_remitente')
      .eq('hotel_id', hotelId)
      .maybeSingle();

    if (configError) {
      console.error('Error obteniendo configuracion_hotel para reporte de caja:', configError);
      return jsonResponse({ error: 'No fue posible obtener la configuracion del hotel.' }, 500, origin);
    }

    let toCorreos = normalizeEmailList(sanitizeString(config?.correo_reportes, 500));
    if (!toCorreos) {
      toCorreos = normalizeEmailList(fallbackEmail);
    }

    if (!toCorreos) {
      return jsonResponse({ sent: false, reason: 'invalid_destination' }, 200, origin);
    }

    const fromCorreo =
      sanitizeString(config?.correo_remitente, 200) || 'no-reply@gestiondehotel.com';

    const reportResponse = await fetch(MAKE_CASH_CLOSE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: toCorreos,
        from: fromCorreo,
        subject,
        html,
      }),
    });

    if (!reportResponse.ok) {
      const reportText = await reportResponse.text().catch(() => '');
      console.error('Error enviando reporte de caja a Make:', reportText);
      return jsonResponse({ sent: false, reason: 'request_failed' }, 502, origin);
    }

    return jsonResponse({ sent: true }, 200, origin);
  } catch (error) {
    console.error('Error inesperado en send-cash-close-report:', error);
    return jsonResponse({ error: 'Unexpected error.' }, 500, origin);
  }
});
