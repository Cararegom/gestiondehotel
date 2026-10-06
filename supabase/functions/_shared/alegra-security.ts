import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('PROJECT_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  Deno.env.get('SERVICE_ROLE_KEY') ??
  Deno.env.get('SERVICE_ROLE') ??
  '';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ALLOWED_ORIGINS = new Set([
  'https://gestiondehotel.com',
  'https://www.gestiondehotel.com',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
]);

export type AlegraAuthorization = 'member' | 'administrator';

export interface AlegraRequestContext {
  admin: SupabaseClient;
  hotelId: string;
  origin: string | null;
  payload: Record<string, unknown>;
  userId: string;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

interface HandlerOptions {
  allowedFields: readonly string[];
  authorization: AlegraAuthorization;
  name: string;
  action: (context: AlegraRequestContext) => Promise<Response>;
}

function requiredConfiguration(value: string): string {
  if (!value) throw new Error('alegra_service_not_configured');
  return value;
}

function buildUserClient(accessToken: string): SupabaseClient {
  return createClient(
    requiredConfiguration(SUPABASE_URL),
    requiredConfiguration(SUPABASE_ANON_KEY),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Client-Info': 'gestiondehotel-alegra-user',
        },
      },
    },
  );
}

function buildAdminClient(): SupabaseClient {
  return createClient(
    requiredConfiguration(SUPABASE_URL),
    requiredConfiguration(SUPABASE_SERVICE_ROLE_KEY),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'X-Client-Info': 'gestiondehotel-alegra-server' } },
    },
  );
}

function readBearerToken(req: Request): string {
  const match = /^Bearer\s+([^\s]+)$/iu.exec(req.headers.get('authorization') || '');
  if (!match?.[1]) {
    throw new HttpError(401, 'missing_authorization', 'Se requiere una sesion valida.');
  }
  return match[1];
}

async function authorize(
  req: Request,
  hotelId: string,
  authorization: AlegraAuthorization,
): Promise<{ admin: SupabaseClient; userId: string }> {
  const accessToken = readBearerToken(req);
  const userClient = buildUserClient(accessToken);
  const { data: userResult, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !userResult.user?.id || userResult.user.is_anonymous) {
    throw new HttpError(401, 'invalid_session', 'La sesion no es valida o expiro.');
  }

  const { data: isMember, error: membershipError } = await userClient.rpc(
    'fase1_actor_es_miembro_activo',
    { p_hotel_id: hotelId },
  );
  if (membershipError) throw new Error('alegra_membership_lookup_failed');
  if (isMember !== true) {
    throw new HttpError(403, 'hotel_membership_required', 'No tienes acceso a este hotel.');
  }

  if (authorization === 'administrator') {
    const { data: isAdministrator, error: administratorError } = await userClient.rpc(
      'usuario_actual_es_admin_hotel',
      { p_hotel_id: hotelId },
    );
    if (administratorError) throw new Error('alegra_administrator_lookup_failed');
    if (isAdministrator !== true) {
      throw new HttpError(403, 'administrator_required', 'Esta accion requiere un administrador del hotel.');
    }
  }

  // service_role solo se obtiene despues de validar JWT, hotel y alcance.
  return { admin: buildAdminClient(), userId: userResult.user.id };
}

export function buildCorsHeaders(origin: string | null) {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://gestiondehotel.com';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'content-type, authorization, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  origin: string | null = null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

export function sanitizeString(value: unknown, maxLength = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

async function readPayload(req: Request, allowedFields: readonly string[]): Promise<Record<string, unknown>> {
  const payload = await req.json();
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).some((key) => !allowedFields.includes(key))
  ) {
    throw new HttpError(400, 'invalid_request', 'La solicitud no es valida.');
  }
  return payload as Record<string, unknown>;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof SyntaxError) return 'invalid_json';
  return 'alegra_request_failed';
}

export function createAlegraHandler(options: HandlerOptions) {
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
      const payload = await readPayload(req, options.allowedFields);
      const hotelId = sanitizeString(payload.hotelId, 80);
      if (!UUID_PATTERN.test(hotelId)) {
        throw new HttpError(400, 'invalid_hotel_id', 'El hotel no es valido.');
      }

      const actor = await authorize(req, hotelId, options.authorization);
      return await options.action({ ...actor, hotelId, origin, payload });
    } catch (error) {
      const status = error instanceof HttpError
        ? error.status
        : error instanceof SyntaxError
          ? 400
          : 500;
      if (status >= 500) {
        console.error(`[${options.name}]`, { code: safeErrorCode(error) });
      }
      const message = error instanceof HttpError
        ? error.message
        : error instanceof SyntaxError
          ? 'La solicitud no es valida.'
          : 'No fue posible completar la operacion con Alegra.';
      return jsonResponse({ error: message }, status, origin);
    }
  };
}
