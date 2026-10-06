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
    name: 'alegra-crear-factura',
    authorization: 'administrator',
    allowedFields: ['hotelId', 'facturaData'],
    async action({ admin, hotelId, origin, payload }) {
      const facturaData = payload.facturaData && typeof payload.facturaData === 'object' && !Array.isArray(payload.facturaData)
        ? payload.facturaData as Record<string, unknown>
        : {};
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

      const cliente = facturaData.cliente && typeof facturaData.cliente === 'object' && !Array.isArray(facturaData.cliente)
        ? facturaData.cliente as Record<string, unknown>
        : {};
      const contactoNombre = sanitizeString(cliente.nombre, 120) || 'Cliente de prueba';
      const contactoEmail = sanitizeString(cliente.email, 120);
      const contactoIdentificacion = sanitizeString(cliente.identificacion, 40);

      const response = await fetch('https://api.alegra.com/api/v1/contacts?start=0&limit=1', {
        method: 'GET',
        headers: {
          Authorization: buildAlegraAuthHeader(usuario, apiKey),
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        console.error('[alegra-crear-factura]', {
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
        message: 'Conexion con Alegra validada y payload de factura de prueba recibido. La creacion automatica completa queda lista para la siguiente fase de integracion.',
        facturaId: null,
        payloadResumen: {
          cliente: contactoNombre,
          email: contactoEmail || null,
          identificacion: contactoIdentificacion || null,
          items: Array.isArray(facturaData.items) ? facturaData.items.length : 0,
        },
      }, 200, origin);
    },
  });
}

if (import.meta.main) Deno.serve(createHandler());
