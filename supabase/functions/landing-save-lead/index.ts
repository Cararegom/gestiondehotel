import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('PROJECT_URL') ?? '';
const SERVICE_ROLE_KEY =
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

function sanitizeText(value: unknown, maxLength = 300) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function sanitizeMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 8000) {
    return { truncated: true };
  }
  return value;
}

function sanitizeRoomCount(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed);
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

  try {
    const payload = await req.json().catch(() => ({}));
    const email = sanitizeText(payload?.email, 180).toLowerCase();
    const whatsapp = sanitizeText(payload?.whatsapp, 80);

    if (!email && !whatsapp) {
      return jsonResponse({ error: 'Email o WhatsApp son obligatorios.' }, 400, origin);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const leadPayload = {
      source: sanitizeText(payload?.source, 80) || 'chatbot_comercial',
      full_name: sanitizeText(payload?.fullName ?? payload?.full_name, 180) || null,
      business_name: sanitizeText(payload?.businessName ?? payload?.business_name, 180) || null,
      country: sanitizeText(payload?.country, 120) || null,
      city: sanitizeText(payload?.city, 120) || null,
      room_count: sanitizeRoomCount(payload?.roomCount ?? payload?.room_count),
      email: email || null,
      whatsapp: whatsapp || null,
      interest: sanitizeText(payload?.interest, 200) || null,
      plan_interest: sanitizeText(payload?.planInterest ?? payload?.plan_interest, 120) || null,
      page_path: sanitizeText(payload?.pagePath, 300) || null,
      referrer: sanitizeText(payload?.referrer, 400) || null,
      notes: sanitizeText(payload?.notes, 1000) || null,
      metadata: sanitizeMetadata(payload?.metadata),
    };

    const { data, error } = await admin
      .from('landing_leads')
      .insert(leadPayload)
      .select('id')
      .single();

    if (error) {
      console.error('Error guardando landing lead:', error);
      return jsonResponse({ error: 'No fue posible guardar el lead.' }, 500, origin);
    }

    await admin.from('landing_conversion_events').insert({
      source: 'landing',
      event_name: 'lead_submitted',
      visitor_id: sanitizeText(payload?.visitorId, 120) || null,
      session_id: sanitizeText(payload?.sessionId, 120) || null,
      page_path: sanitizeText(payload?.pagePath, 300) || null,
      referrer: sanitizeText(payload?.referrer, 400) || null,
      utm_source: sanitizeText(payload?.utm_source ?? payload?.utmSource, 120) || null,
      utm_medium: sanitizeText(payload?.utm_medium ?? payload?.utmMedium, 120) || null,
      utm_campaign: sanitizeText(payload?.utm_campaign ?? payload?.utmCampaign, 120) || null,
      utm_term: sanitizeText(payload?.utm_term ?? payload?.utmTerm, 120) || null,
      utm_content: sanitizeText(payload?.utm_content ?? payload?.utmContent, 120) || null,
      metadata: {
        lead_id: data?.id ?? null,
        source: leadPayload.source,
        interest: leadPayload.interest,
        plan_interest: leadPayload.plan_interest,
      },
    });

    return jsonResponse({ ok: true, lead_id: data?.id ?? null }, 200, origin);
  } catch (error) {
    console.error('Error inesperado en landing-save-lead:', error);
    return jsonResponse({ error: 'Unexpected error.' }, 500, origin);
  }
});
