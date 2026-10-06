import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('PROJECT_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  Deno.env.get('SERVICE_ROLE_KEY') ??
  Deno.env.get('SERVICE_ROLE') ??
  '';
const MAKE_CASH_CLOSE_WEBHOOK_URL = Deno.env.get('MAKE_CASH_CLOSE_WEBHOOK_URL') ?? '';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ALLOWED_BODY_FIELDS = new Set(['hotelId', 'subject', 'html', 'fallbackEmail']);
const ALLOWED_ORIGINS = new Set([
  'https://gestiondehotel.com',
  'https://www.gestiondehotel.com',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
]);

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function buildCorsHeaders(origin: string | null) {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://gestiondehotel.com';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'content-type, authorization, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
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

function readBearerToken(req: Request): string {
  const authorization = req.headers.get('authorization') || '';
  const match = /^Bearer\s+([^\s]+)$/iu.exec(authorization);
  if (!match?.[1]) {
    throw new HttpError(401, 'missing_authorization', 'Se requiere una sesion valida.');
  }
  return match[1];
}

function buildUserClient(accessToken: string): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('user_client_not_configured');
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Client-Info': 'gestiondehotel-cash-close-user',
      },
    },
  });
}

function buildAdminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('admin_client_not_configured');
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'gestiondehotel-cash-close-server' } },
  });
}

async function requireHotelMember(req: Request, hotelId: string): Promise<{ email: string }> {
  const accessToken = readBearerToken(req);
  const client = buildUserClient(accessToken);
  const { data: userResult, error: userError } = await client.auth.getUser(accessToken);
  if (userError || !userResult.user || userResult.user.is_anonymous) {
    throw new HttpError(401, 'invalid_session', 'La sesion no es valida o expiro.');
  }

  const { data: isMember, error: membershipError } = await client.rpc(
    'fase1_actor_es_miembro_activo',
    { p_hotel_id: hotelId },
  );
  if (membershipError) {
    throw new Error('hotel_membership_lookup_failed');
  }
  if (isMember !== true) {
    throw new HttpError(
      403,
      'hotel_membership_required',
      'No tienes autorizacion para enviar reportes de este hotel.',
    );
  }

  return { email: sanitizeString(userResult.user.email, 254) };
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const payload = await req.json();
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).some((key) => !ALLOWED_BODY_FIELDS.has(key))
  ) {
    throw new HttpError(400, 'invalid_request', 'La solicitud no es valida.');
  }
  return payload as Record<string, unknown>;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof SyntaxError) return 'invalid_json';
  return 'cash_close_report_failed';
}

export function createHandler() {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin');

    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: buildCorsHeaders(origin) });
    }
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Metodo no permitido.' }, 405, origin);
    }
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse({ error: 'Origen no permitido.' }, 403, origin);
    }

    try {
      const payload = await readBody(req);
      const hotelId = sanitizeString(payload.hotelId, 80);
      const subject = sanitizeString(payload.subject, 200);
      const html = sanitizeString(payload.html, 120_000);

      if (!UUID_PATTERN.test(hotelId)) {
        throw new HttpError(400, 'invalid_hotel_id', 'El hotel no es valido.');
      }
      if (!subject || !html) {
        throw new HttpError(400, 'missing_report', 'El asunto y el reporte son obligatorios.');
      }

      // Autenticar y autorizar antes de obtener service_role o leer otro hotel.
      const actor = await requireHotelMember(req, hotelId);
      if (!MAKE_CASH_CLOSE_WEBHOOK_URL) {
        throw new Error('cash_close_webhook_not_configured');
      }
      const admin = buildAdminClient();
      const { data: config, error: configError } = await admin
        .from('configuracion_hotel')
        .select('correo_reportes, correo_remitente')
        .eq('hotel_id', hotelId)
        .maybeSingle();

      if (configError) {
        throw new Error('cash_close_config_lookup_failed');
      }

      // El correo enviado por el navegador no es una autoridad. Si el hotel no
      // tiene destinatario configurado, solo se usa el email del JWT validado.
      let toCorreos = normalizeEmailList(sanitizeString(config?.correo_reportes, 500));
      if (!toCorreos) {
        toCorreos = normalizeEmailList(actor.email);
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
        console.error('[send-cash-close-report]', {
          code: 'cash_close_webhook_failed',
          status: reportResponse.status,
        });
        return jsonResponse({ sent: false, reason: 'request_failed' }, 502, origin);
      }

      return jsonResponse({ sent: true }, 200, origin);
    } catch (error) {
      const status = error instanceof HttpError
        ? error.status
        : error instanceof SyntaxError
          ? 400
          : 500;
      if (status >= 500) {
        console.error('[send-cash-close-report]', { code: safeErrorCode(error) });
      }
      const message = error instanceof HttpError
        ? error.message
        : error instanceof SyntaxError
          ? 'La solicitud no es valida.'
          : 'No fue posible enviar el reporte.';
      return jsonResponse({ error: message }, status, origin);
    }
  };
}

if (import.meta.main) Deno.serve(createHandler());
