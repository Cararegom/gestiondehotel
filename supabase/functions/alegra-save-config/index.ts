import {
  createAlegraHandler,
  jsonResponse,
  sanitizeString,
} from '../_shared/alegra-security.ts';

export function createHandler() {
  return createAlegraHandler({
    name: 'alegra-save-config',
    authorization: 'administrator',
    allowedFields: ['hotelId', 'usuario', 'apiKey'],
    async action({ admin, hotelId, origin, payload }) {
      const usuario = sanitizeString(payload.usuario, 180);
      const apiKeyInput = typeof payload.apiKey === 'string' ? payload.apiKey : null;
      const upsertPayload: Record<string, unknown> = {
        hotel_id: hotelId,
        facturador_nombre: 'Alegra',
        facturador_usuario: usuario || null,
        updated_at: new Date().toISOString(),
      };

      if (apiKeyInput !== null) {
        const apiKey = apiKeyInput.trim().slice(0, 2000);
        upsertPayload.facturador_api_key = apiKey || null;
      }

      const { error } = await admin
        .from('integraciones_hotel')
        .upsert(upsertPayload, { onConflict: 'hotel_id' });
      if (error) throw new Error('alegra_config_save_failed');

      return jsonResponse({
        ok: true,
        message: 'Configuracion de Alegra guardada correctamente.',
        masked: Boolean(upsertPayload.facturador_api_key),
      }, 200, origin);
    },
  });
}

if (import.meta.main) Deno.serve(createHandler());
