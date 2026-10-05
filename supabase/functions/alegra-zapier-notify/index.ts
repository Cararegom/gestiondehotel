import {
  createAlegraHandler,
  HttpError,
  jsonResponse,
  sanitizeString,
} from '../_shared/alegra-security.ts';

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid_sale_data', 'Los datos de la venta son requeridos.');
  }
  return value as Record<string, unknown>;
}

function validatedWebhookUrl(value: unknown): string | null {
  const candidate = sanitizeString(value, 1000);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function createHandler() {
  return createAlegraHandler({
    name: 'alegra-zapier-notify',
    authorization: 'member',
    allowedFields: ['hotelId', 'datosVenta'],
    async action({ admin, hotelId, origin, payload }) {
      const datosVenta = requireObject(payload.datosVenta);
      const { data: hotel, error } = await admin
        .from('hoteles')
        .select('alegra_webhook_url')
        .eq('id', hotelId)
        .maybeSingle();
      if (error) throw new Error('alegra_webhook_lookup_failed');

      const webhookUrl = validatedWebhookUrl(hotel?.alegra_webhook_url);
      if (!webhookUrl) {
        return jsonResponse({
          ok: true,
          skipped: true,
          message: 'El hotel no tiene un webhook HTTPS de Alegra configurado.',
        }, 200, origin);
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datosVenta),
      });
      if (!response.ok) {
        console.error('[alegra-zapier-notify]', {
          code: 'alegra_webhook_rejected_request',
          status: response.status,
        });
        return jsonResponse({
          error: 'El webhook externo de Alegra respondio con error.',
        }, 502, origin);
      }

      return jsonResponse({ ok: true, skipped: false }, 200, origin);
    },
  });
}

if (import.meta.main) Deno.serve(createHandler());
