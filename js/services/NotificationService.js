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
  userId
}) {
  if (!supabase || typeof supabase.from !== "function") {
    throw new Error("Supabase no válido en crearNotificacion");
  }
  const payload = {
    hotel_id:       hotelId,
    rol_destino:    rolDestino,
    tipo,
    mensaje,
    entidad_tipo:   entidadTipo,
    entidad_id:     entidadId,
    user_id:        userId,
  };

  const { data, error } = await supabase
    .from('notificaciones')
    .insert([payload]); // CORRECTO: debe ser array

  if (error) {
    console.error('Error al insertar notificación:', error);
    throw new Error(`Error al insertar notificación: ${error.message}`);
  }
  return data;
}

