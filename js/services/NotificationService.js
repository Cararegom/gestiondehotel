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

export async function obtenerNombreActorNotificacion(supabase, actor) {
  const nombreSesion = (
    actor?.nombre ||
    actor?.name ||
    actor?.user_metadata?.nombre ||
    actor?.user_metadata?.name
  )?.trim();

  if (nombreSesion) return nombreSesion;

  if (actor?.id) {
    const { data: perfil, error } = await supabase
      .from('usuarios')
      .select('nombre, email')
      .eq('id', actor.id)
      .maybeSingle();

    if (error) {
      console.warn('No se pudo consultar el nombre del usuario para la notificación:', error);
    } else {
      const nombrePerfil = (perfil?.nombre || perfil?.email)?.trim();
      if (nombrePerfil) return nombrePerfil;
    }
  }

  return actor?.email?.trim() || 'Usuario desconocido';
}

export async function notificarHabitacionLiberada(supabase, {
  hotelId,
  habitacion,
  actor
}) {
  const nombreActor = await obtenerNombreActorNotificacion(supabase, actor);

  return crearNotificacion(supabase, {
    hotelId,
    rolDestino: 'camarera',
    tipo: 'general_info',
    mensaje: `La habitación '${habitacion.nombre}' fue liberada y pasó a limpieza. La liberó: ${nombreActor}.`,
    entidadTipo: 'habitacion',
    entidadId: habitacion.id,
    // Debe quedar por rol para que todo el equipo de limpieza pueda verla.
    userId: null
  });
}

export async function notificarHabitacionFueraDeLimpieza(supabase, {
  hotelId,
  habitacion,
  actor
}) {
  const nombreActor = await obtenerNombreActorNotificacion(supabase, actor);

  return crearNotificacion(supabase, {
    hotelId,
    rolDestino: 'recepcionista',
    tipo: 'limpieza_completada',
    mensaje: `La habitación '${habitacion.nombre}' salió de limpieza y está lista. La sacó de limpieza: ${nombreActor}.`,
    entidadTipo: 'habitacion',
    entidadId: habitacion.id,
    // Debe quedar por rol para que todo el equipo de recepción pueda verla.
    userId: null
  });
}
