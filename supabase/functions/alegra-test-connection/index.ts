import {
  createAlegraHandler,
  jsonResponse,
  sanitizeString,
} from '../_shared/alegra-security.ts';

function buildAlegraAuthHeader(usuario: string, apiKey: string): string {
  return `Basic ${btoa(`${usuario}:${apiKey}`)}`;
}

export function createHandler() {
  return createAlegraHandler({
    name: 'alegra-test-connection',
    authorization: 'administrator',
    allowedFields: ['hotelId'],
    async action({ admin, hotelId, origin }) {
      const { data: config, error } = await admin
        .from('integraciones_hotel')
        .select('facturador_usuario, facturador_api_key')
        .eq('hotel_id', hotelId)
        .eq('facturador_nombre', 'Alegra')
        .maybeSingle();
      if (error) throw new Error('alegra_config_lookup_failed');

      const usuario = sanitizeString(config?.facturador_usuario, 200);
      const apiKey = sanitizeString(config?.facturador_api_key, 2000);
      if (!usuario || !apiKey) {
        return jsonResponse({
          ok: false,
          message: 'Faltan credenciales de Alegra para este hotel.',
        }, 400, origin);
      }

      const response = await fetch('https://api.alegra.com/api/v1/contacts?start=0&limit=1', {
        method: 'GET',
        headers: {
          Authorization: buildAlegraAuthHeader(usuario, apiKey),
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        console.error('[alegra-test-connection]', {
          code: 'alegra_provider_rejected_request',
          status: response.status,
        });
        return jsonResponse({
          ok: false,
          message: 'Alegra rechazo las credenciales o no esta disponible.',
        }, 200, origin);
      }

      return jsonResponse({
        ok: true,
        message: 'Conexion verificada correctamente con Alegra.',
      }, 200, origin);
    },
  });
}

if (import.meta.main) Deno.serve(createHandler());
