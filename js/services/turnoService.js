// ===================== TURNO SERVICE =====================
let activeTurnId = null;

export const turnoService = {
  /**
   * Establece el ID del turno cuando se abre uno nuevo.
   * @param {string} turnoId El UUID del turno que se acaba de abrir.
   */
  setActiveTurn(turnoId) {
    activeTurnId = turnoId;
    console.log(`✅ Turno Service: Turno activo establecido a ${turnoId}`);
  },

  /**
   * Devuelve el ID del turno activo guardado en memoria.
   * @returns {string|null} El UUID del turno activo, o null si no hay ninguno.
   */
  getActiveTurnId() {
    return activeTurnId;
  },

  /**
   * Limpia el ID del turno cuando se cierra.
   */
  clearActiveTurn() {
    activeTurnId = null;
    console.log("❌ Turno Service: Turno activo limpiado.");
  },

  /**
   * (NUEVA FUNCIÓN AÑADIDA)
   * Busca y devuelve el turno que está actualmente abierto para un usuario específico desde la BD.
   * @param {object} supabase - La instancia del cliente de Supabase.
   * @param {string} usuarioId - El ID del usuario para el cual buscar el turno.
   * @param {string} hotelId - El ID del hotel actual.
   * @returns {Promise<object|null>} El objeto del turno si se encuentra, o null si no hay ninguno abierto.
   */
  async getTurnoAbierto(supabase, usuarioId, hotelId) {
    if (!supabase || !usuarioId || !hotelId) {
      console.error("Faltan parámetros para buscar el turno abierto.");
      return null;
    }

    try {
      const { data: turno, error } = await supabase
        .from('turnos')
        .select('*')
        .eq('hotel_id', hotelId)
        .eq('usuario_id', usuarioId)
        .eq('estado', 'abierto')
        .limit(1)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          console.log("No se encontró un turno abierto para el usuario.");
          return null;
        }
        throw error;
      }

      // Si encontramos un turno, actualizamos el ID en memoria también
      if (turno) {
        this.setActiveTurn(turno.id);
      }
      
      return turno;

    } catch (err) {
      console.error("Error en servicio getTurnoAbierto:", err.message);
      throw err;
    }
  }
};

// Puedes decidir si mantienes estas funciones separadas o integras su lógica donde se necesiten.
// Por ahora, las dejamos como estaban.

/**
 * Consulta el turno activo de la base de datos y lo guarda en memoria.
 * @param {object} supabase - Instancia de supabase.
 * @param {string} hotelId - ID del hotel.
 * @param {string} usuarioId - ID del usuario.
 * @returns {object|null} El turno activo o null si no hay.
 */
export async function fetchTurnoActivo(supabase, hotelId, usuarioId) {
  // Ahora esta función puede usar la nueva función centralizada
  return await turnoService.getTurnoAbierto(supabase, usuarioId, hotelId);
}

/**
 * Verifica si hay turno activo, muestra modal si no hay.
 * @param {object} supabase - Instancia de supabase.
 * @param {string} hotelId - ID del hotel.
 * @param {string} usuarioId - ID del usuario.
 * @returns {boolean} true si hay turno, false si no.
 */
export async function checkTurnoActivo(supabase, hotelId, usuarioId) {
  const turno = await turnoService.getTurnoAbierto(supabase, usuarioId, hotelId);
  if (!turno) {
    const mensaje = "Acción bloqueada: No hay un turno de caja abierto. Ábrelo desde el módulo de Caja.";
    if (typeof mostrarInfoModalGlobal === 'function') {
      mostrarInfoModalGlobal(mensaje, "Turno Requerido");
    } else {
      alert(mensaje);
    }
    return false;
  }
  return true;
}