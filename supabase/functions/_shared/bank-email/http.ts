const DEFAULT_ALLOWED_ORIGINS = [
  'https://gestiondehotel.com',
  'https://www.gestiondehotel.com',
  'http://127.0.0.1:5500',
  'http://localhost:5500'
];

export function getAllowedOrigins(): Set<string> {
  const configured = (Deno.env.get('BANK_EMAIL_ALLOWED_ORIGINS') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return new Set(configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS);
}

export function buildCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigins = getAllowedOrigins();
  const allowOrigin = origin && allowedOrigins.has(origin)
    ? origin
    : 'https://gestiondehotel.com';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  origin: string | null = null,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
}

export function emptyResponse(status = 204): Response {
  return new Response(null, {
    status,
    headers: {
      'Cache-Control': 'no-store'
    }
  });
}

export async function readJsonBody<T extends Record<string, unknown>>(req: Request): Promise<T> {
  const contentType = req.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'content_type_not_supported', 'Se requiere application/json.');
  }

  try {
    return await req.json() as T;
  } catch {
    throw new HttpError(400, 'invalid_json', 'El cuerpo JSON no es valido.');
  }
}

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function safeErrorCode(error: unknown, fallback = 'unexpected_error'): string {
  if (error instanceof HttpError) return error.code;
  if (error && typeof error === 'object' && 'code' in error) {
    const value = String((error as { code?: unknown }).code || '');
    if (/^[a-z0-9_.-]{1,80}$/i.test(value)) return value.toLowerCase();
  }
  return fallback;
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  return 'No fue posible completar la operacion.';
}
