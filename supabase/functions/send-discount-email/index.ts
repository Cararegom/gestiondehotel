import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('PROJECT_URL') ?? '';
const SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  Deno.env.get('SERVICE_ROLE_KEY') ??
  Deno.env.get('SERVICE_ROLE') ??
  '';
const MAKE_DISCOUNT_EMAIL_WEBHOOK_URL =
  Deno.env.get('MAKE_DISCOUNT_EMAIL_WEBHOOK_URL') ??
  Deno.env.get('MAKE_CASH_CLOSE_WEBHOOK_URL') ??
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

function sanitizeString(input: unknown, maxLength = 5000) {
  return typeof input === 'string' ? input.trim().slice(0, maxLength) : '';
}

function buildAdminClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('Supabase service role is not configured.');
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
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

  if (!MAKE_DISCOUNT_EMAIL_WEBHOOK_URL) {
    return jsonResponse({ error: 'MAKE_DISCOUNT_EMAIL_WEBHOOK_URL is not configured.' }, 500, origin);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const recipient = sanitizeString(payload?.recipient, 200);
    const imageBase64 = sanitizeString(payload?.imageBase64, 2_000_000);
    const discountName = sanitizeString(payload?.discountName, 120) || 'Descuento';
    const hotelId = sanitizeString(payload?.hotelId, 80);

    if (!recipient || !recipient.includes('@')) {
      return jsonResponse({ error: 'recipient is required.' }, 400, origin);
    }
    if (!imageBase64) {
      return jsonResponse({ error: 'imageBase64 is required.' }, 400, origin);
    }
    if (!hotelId) {
      return jsonResponse({ error: 'hotelId is required.' }, 400, origin);
    }

    const admin = buildAdminClient();
    const { data: config } = await admin
      .from('configuracion_hotel')
      .select('correo_remitente')
      .eq('hotel_id', hotelId)
      .maybeSingle();

    const from = sanitizeString(config?.correo_remitente, 200) || 'no-reply@gestiondehotel.com';
    const subject = `Tu descuento: ${discountName}`;
    const html = `
      <div style="font-family:Arial,sans-serif;padding:24px;background:#f8fafc;color:#0f172a;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;">
          <h1 style="margin:0 0 12px;font-size:24px;color:#0f172a;">Gestion de Hotel</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Te compartimos tu descuento <strong>${discountName}</strong>.</p>
          <div style="text-align:center;padding:12px 0;">
            <img src="data:image/png;base64,${imageBase64}" alt="Descuento ${discountName}" style="max-width:100%;border-radius:12px;border:1px solid #e2e8f0;" />
          </div>
          <p style="margin:16px 0 0;font-size:13px;color:#64748b;">Este correo fue generado automaticamente desde Gestion de Hotel.</p>
        </div>
      </div>
    `;

    const webhookResponse = await fetch(MAKE_DISCOUNT_EMAIL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: recipient,
        from,
        subject,
        html,
      }),
    });

    if (!webhookResponse.ok) {
      const detail = await webhookResponse.text().catch(() => '');
      console.error('Error enviando correo de descuento:', detail);
      return jsonResponse({ error: 'request_failed' }, 502, origin);
    }

    return jsonResponse({ ok: true, sent: true }, 200, origin);
  } catch (error) {
    console.error('Error inesperado en send-discount-email:', error);
    return jsonResponse({ error: 'Unexpected error.' }, 500, origin);
  }
});
