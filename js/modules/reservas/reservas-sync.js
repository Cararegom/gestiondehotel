function parseEventoGoogle(evento) {
  if (!evento?.summary) return null;

  const summaryRegex = /Reserva\s*\|\s*Cliente:\s*([^|]+?)\s*\|\s*Room:\s*([^|]+?)\s*\|\s*Hu[eé]spedes:\s*(\d+)/i;
  const match = evento.summary.match(summaryRegex);
  if (!match) return null;

  const [, cliente_nombre, habitacion_nombre, cantidad_huespedes_str] = match;
  if (!cliente_nombre.trim() || !habitacion_nombre.trim()) return null;

  let telefono = null;
  let cedula = null;
  if (evento.description) {
    const telMatch = evento.description.match(/Tel[eé]fono:\s*([\d\s\-+]+)/i);
    if (telMatch) telefono = telMatch[1].trim();

    const cedulaMatch = evento.description.match(/C[eé]dula:\s*([A-Za-z0-9\-.]+)/i);
    if (cedulaMatch) cedula = cedulaMatch[1].trim();
  }

  return {
    cliente_nombre: cliente_nombre.trim(),
    cantidad_huespedes: parseInt(cantidad_huespedes_str, 10) || 1,
    habitacion_nombre: habitacion_nombre.trim(),
    telefono,
    cedula,
    fecha_inicio: evento.start?.dateTime || evento.start?.date,
    fecha_fin: evento.end?.dateTime || evento.end?.date,
    google_event_id: evento.id,
    descripcion: evento.description || '',
    origen_reserva: 'google_calendar'
  };
}

function parseEventoICal(evento, habitaciones) {
  if (!evento?.summary && !evento?.location) return null;

  let habitacionNombreDetectado = null;
  const roomRegex = /(?:Room|Habitacion)\s*:?\s*([^\s(]+)/i;
  const summaryMatch = evento.summary ? evento.summary.match(roomRegex) : null;
  const locationMatch = evento.location ? evento.location.match(roomRegex) : null;

  if (summaryMatch?.[1]) {
    habitacionNombreDetectado = summaryMatch[1].trim();
  } else if (locationMatch?.[1]) {
    habitacionNombreDetectado = locationMatch[1].trim();
  }

  if (!habitacionNombreDetectado) return null;

  const habitacionObj = (habitaciones || []).find(
    (habitacion) => habitacion.nombre.trim().toLowerCase() === habitacionNombreDetectado.toLowerCase()
  );

  if (!habitacionObj) {
    console.warn(`[Sync ICal] Evento de ${evento.summary} descartado. No se encontro habitacion con el nombre: "${habitacionNombreDetectado}"`);
    return null;
  }

  let cliente_nombre = String(evento.summary || '')
    .replace(roomRegex, '')
    .replace('(Imported)', '')
    .trim() || 'Reserva Externa';
  let cantidad_huespedes = 1;

  if (evento.description) {
    const huespedesMatch = evento.description.match(/Hu[eé]spedes?:\s*(\d+)/i);
    if (huespedesMatch) cantidad_huespedes = parseInt(huespedesMatch[1], 10);
  }

  return {
    cliente_nombre,
    cantidad_huespedes,
    habitacion_id: habitacionObj.id,
    fecha_inicio: evento.start?.dateTime || evento.start?.date,
    fecha_fin: evento.end?.dateTime || evento.end?.date,
    google_event_id: evento.id,
    origen_reserva: 'ical_google',
    descripcion: evento.description || ''
  };
}

export async function syncReservasConGoogleCalendar({
  supabase,
  hotelId,
  currentUserId,
  onNewReservations = null
}) {
  try {
    if (!hotelId || !supabase || !currentUserId) return;

    const [reservasResult, habitacionesResult] = await Promise.all([
      supabase.from('reservas').select('google_event_id').eq('hotel_id', hotelId).not('google_event_id', 'is', null),
      supabase.from('habitaciones').select('id, nombre').eq('hotel_id', hotelId)
    ]);

    if (reservasResult.error || habitacionesResult.error) {
      console.error('[Sync] Error obteniendo datos locales:', {
        reservError: reservasResult.error,
        habError: habitacionesResult.error
      });
      return;
    }

    const reservasActuales = reservasResult.data || [];
    const habitaciones = habitacionesResult.data || [];

    const { data: dataEventos, error: errorInvocacion } = await supabase.functions.invoke(
      'calendar-sync-events',
      { body: { hotelId } }
    );

    if (errorInvocacion) {
      console.error('CRITICO: Error al invocar la Edge Function:', errorInvocacion);
      return;
    }

    const eventosGoogle = dataEventos?.events;
    if (!Array.isArray(eventosGoogle)) return;

    let nuevasReservasInsertadas = 0;
    for (const evento of eventosGoogle) {
      if (evento.status === 'cancelled') continue;
      if (reservasActuales.some((reserva) => reserva.google_event_id === evento.id)) continue;

      let reservaParsed = parseEventoGoogle(evento) || parseEventoICal(evento, habitaciones);
      if (!reservaParsed) continue;

      if (!reservaParsed.habitacion_id && reservaParsed.habitacion_nombre) {
        const habitacionEncontrada = habitaciones.find(
          (habitacion) => habitacion.nombre.trim().toLowerCase() === reservaParsed.habitacion_nombre.toLowerCase()
        );

        if (habitacionEncontrada) {
          reservaParsed.habitacion_id = habitacionEncontrada.id;
        } else {
          console.warn(`[Sync] Evento descartado. No se encontro ID para habitacion nombrada: "${reservaParsed.habitacion_nombre}"`);
          continue;
        }
      }

      if (!reservaParsed.habitacion_id) continue;

      const reservaParaInsertar = {
        ...reservaParsed,
        hotel_id: hotelId,
        estado: 'reservada',
        monto_total: 0,
        monto_pagado: 0,
        usuario_id: currentUserId
      };
      delete reservaParaInsertar.descripcion;
      delete reservaParaInsertar.habitacion_nombre;

      const { data: insertData, error: insertError } = await supabase
        .from('reservas')
        .insert(reservaParaInsertar)
        .select()
        .single();

      if (insertError) {
        console.error('[Sync] ERROR AL INSERTAR EN SUPABASE:', insertError.message, '--> Objeto:', reservaParaInsertar);
      } else {
        nuevasReservasInsertadas += 1;
        reservasActuales.push({ google_event_id: insertData.google_event_id });
      }
    }

    if (nuevasReservasInsertadas > 0 && typeof onNewReservations === 'function') {
      await onNewReservations();
    }
  } catch (error) {
    console.error('Error catastrofico en syncReservasConGoogleCalendar:', error);
  }
}
