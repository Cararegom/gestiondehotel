// js/services/NotificationService.js

/**
 * Inserta una notificación en la tabla "notificaciones".
 * Asegúrate de que tu tabla tenga estas columnas:
 *   hotel_id, rol_destino, tipo, mensaje,
 *   entidad_tipo, entidad_id, user_id
 */

export async function crearNotificacion(supabase, {
  hotelId,
  rolDestino,
  tipo,
  mensaje,
  entidadTipo,
  entidadId,
  userId // este parámetro puede ser undefined
}) {
  if (!supabase || typeof supabase.from !== "function") {
    throw new Error("Supabase no válido en crearNotificacion");
  }

  // Validar campos requeridos
  if (!hotelId)      throw new Error("Falta hotelId en crearNotificacion");
  if (!rolDestino)   throw new Error("Falta rolDestino en crearNotificacion");
  if (!tipo)         throw new Error("Falta tipo en crearNotificacion");
  if (!mensaje)      throw new Error("Falta mensaje en crearNotificacion");
  if (!entidadTipo)  throw new Error("Falta entidadTipo en crearNotificacion");
  if (!entidadId)    throw new Error("Falta entidadId en crearNotificacion");

  // Armar payload
  const payload = {
    hotel_id:       hotelId,
    rol_destino:    rolDestino,
    tipo,
    mensaje,
    entidad_tipo:   entidadTipo,
    entidad_id:     entidadId,
    user_id:        userId ?? null // Si viene vacío, se manda como null
  };

  // Elimina campos vacíos para evitar problemas con constraints
  Object.keys(payload).forEach(key => {
    if (payload[key] === undefined) delete payload[key];
  });

  let { data, error } = await supabase
    .from('notificaciones')
    .insert([payload]);

  if (error) {
    const details = [error?.message, error?.details, error?.hint, error?.code]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (/\bentidad_tipo\b|\bentidad_id\b|\buser_id\b|column|schema|pgrst/.test(details)) {
      const legacyPayload = {
        hotel_id: hotelId,
        rol_destino: rolDestino,
        tipo,
        mensaje
      };

      if (userId) {
        legacyPayload.usuario_id = userId;
      }

      ({ data, error } = await supabase
        .from('notificaciones')
        .insert([legacyPayload]));
    }
  }

  if (error) {
    console.error('Error al insertar notificación:', error);
    throw new Error(`Error al insertar notificación: ${error.message}`);
  }
  return data;
}
