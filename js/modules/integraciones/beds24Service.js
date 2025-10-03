// js/modules/integraciones/beds24Service.js

// URL de tu Edge Function en Supabase
const EDGE_URL = "https://iikpqpdoslyduecibaij.supabase.co/functions/v1/beds24proxy";

/**
 * Prueba la conexión a Beds24 usando la función Edge de Supabase.
 * @param {string} apiKey - Tu API Key de Beds24.
 * @param {string} propKey - Tu PropKey de Beds24.
 * @returns {Promise<{ok: boolean, mensaje: string}>}
 */
export async function probarConexionBeds24(apiKey, propKey) {
  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const to = from;
  try {
    const res = await fetch(EDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, propKey, from, to, limit: 1 })
    });
    const data = await res.json();
    if (data.ok && data.data && Array.isArray(data.data.bookings)) {
      return { ok: true, mensaje: "Conexión exitosa" };
    } else if (data.data && data.data.error) {
      return { ok: false, mensaje: `Beds24: ${data.data.error}` };
    } else {
      return { ok: false, mensaje: data.mensaje || 'Respuesta inesperada.' };
    }
  } catch (err) {
    return { ok: false, mensaje: err.message || 'Error de red.' };
  }
}

/**
 * Importa reservas desde Beds24 para el rango de hoy a hoy+30, usando la función Edge.
 * @param {string} apiKey - Tu API Key de Beds24.
 * @param {string} propKey - Tu PropKey de Beds24.
 * @param {string} hotelId - El ID del hotel (para guardar reservas en tu BD).
 * @param {object} supabase - Instancia de Supabase para guardar en la tabla reservas.
 * @returns {Promise<{ok: boolean, mensaje: string}>}
 */
export async function importarReservasBeds24(apiKey, propKey, hotelId, supabase) {
  // Rango de fechas: hoy a hoy + 30 días
  const fromDate = new Date();
  const toDate = new Date();
  toDate.setDate(fromDate.getDate() + 30);
  const from = fromDate.toISOString().slice(0, 10);
  const to = toDate.toISOString().slice(0, 10);

  try {
    // Pedimos las reservas a la Edge Function
    const res = await fetch(EDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, propKey, from, to })
    });
    const data = await res.json();
    if (!data.ok || !data.data || !Array.isArray(data.data.bookings)) {
      return { ok: false, mensaje: data.mensaje || "No se recibieron reservas válidas de Beds24." };
    }
    const bookings = data.data.bookings;
    if (bookings.length === 0) {
      return { ok: true, mensaje: "No hay reservas nuevas para importar." };
    }

    // Mapear datos para tu tabla reservas
    const reservasParaGuardar = bookings.map(r => ({
      hotel_id: hotelId,
      nombre_cliente: r.guestName || r.guestFirstName || 'Sin nombre',
      fecha_entrada: r.checkin || r.arrival || null,
      fecha_salida: r.checkout || r.departure || null,
      id_externo: r.bookingId?.toString() || r.id?.toString() || null,
      fuente: 'beds24'
    }));

    // Guardar en Supabase (upsert para evitar duplicados por id_externo/hotel_id)
    if (!supabase) {
      return { ok: false, mensaje: "Supabase instance no definida en importarReservasBeds24." };
    }
    const { error } = await supabase
      .from('reservas')
      .upsert(reservasParaGuardar, { onConflict: 'hotel_id,id_externo' });

    if (error) {
      return { ok: false, mensaje: `Error guardando en Supabase: ${error.message}` };
    }

    return { ok: true, mensaje: `${reservasParaGuardar.length} reservas importadas correctamente` };
  } catch (err) {
    return { ok: false, mensaje: err.message || 'Error de red.' };
  }
}
