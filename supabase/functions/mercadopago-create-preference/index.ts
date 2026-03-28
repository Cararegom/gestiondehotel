const MERCADOPAGO_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');
const MERCADOPAGO_WEBHOOK_URL =
  Deno.env.get('MERCADOPAGO_WEBHOOK_URL') ??
  'https://iikpqpdoslyduecibaij.supabase.co/functions/v1/mercadopagoWebhook';

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

function sanitizeString(value: unknown, maxLength = 140) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
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

  if (!MERCADOPAGO_ACCESS_TOKEN) {
    return jsonResponse({ error: 'MERCADOPAGO_ACCESS_TOKEN is not configured.' }, 500, origin);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const planId = sanitizeString(payload?.planId, 60);
    const planName = sanitizeString(payload?.planName, 80);
    const paymentType = sanitizeString(payload?.paymentType, 30);
    const hotelId = sanitizeString(payload?.hotelId, 80);
    const userEmail = sanitizeString(payload?.userEmail, 120) || 'noemail@example.com';
    const currentUrl = sanitizeString(payload?.currentUrl, 500) || 'https://gestiondehotel.com/';
    const amountUSD = Number.parseFloat(String(payload?.amountUSD ?? 0));

    if (!planId || !planName || !paymentType || !hotelId || !Number.isFinite(amountUSD) || amountUSD <= 0) {
      return jsonResponse({ error: 'Invalid payload.' }, 400, origin);
    }

    const unitPrice = Number.parseFloat(amountUSD.toFixed(2));
    const externalReference = `mp-${paymentType}-${hotelId}-${planId}-${Date.now()}`;

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: [
          {
            title: `Suscripcion ${planName} (${paymentType}) - Gestion de Hotel`,
            quantity: 1,
            currency_id: 'USD',
            unit_price: unitPrice
          }
        ],
        payer: {
          email: userEmail
        },
        external_reference: externalReference,
        notification_url: MERCADOPAGO_WEBHOOK_URL,
        back_urls: {
          success: currentUrl,
          pending: currentUrl,
          failure: currentUrl
        }
      })
    });

    const mpData = await mpResponse.json().catch(() => ({}));

    if (!mpResponse.ok || !mpData?.init_point) {
      console.error('Error creando preferencia en Mercado Pago:', mpData);
      return jsonResponse(
        {
          error: 'No se pudo crear la preferencia de pago en Mercado Pago.',
          detail: typeof mpData?.message === 'string' ? mpData.message : 'Unknown error'
        },
        502,
        origin
      );
    }

    return jsonResponse(
      {
        init_point: mpData.init_point,
        sandbox_init_point: mpData.sandbox_init_point ?? null,
        external_reference: externalReference
      },
      200,
      origin
    );
  } catch (error) {
    console.error('Error inesperado en mercadopago-create-preference:', error);
    return jsonResponse({ error: 'Unexpected error.' }, 500, origin);
  }
});
