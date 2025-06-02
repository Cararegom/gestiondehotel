// ===================== TURNO SERVICE =====================
// Este objeto simple mantendrá el ID del turno activo de forma global.
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
   * Devuelve el ID del turno activo.
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
  }
};

/**
 * Consulta el turno activo de la base de datos y lo guarda en memoria.
 * @param {object} supabase - Instancia de supabase.
 * @param {string} hotelId - ID del hotel.
 * @param {string} usuarioId - ID del usuario.
 * @returns {object|null} El turno activo o null si no hay.
 */
export async function fetchTurnoActivo(supabase, hotelId, usuarioId) {
  if (!usuarioId || !hotelId) return null;
  const { data, error } = await supabase
    .from('turnos')
    .select('*')
    .eq('usuario_id', usuarioId)
    .eq('hotel_id', hotelId)
    .eq('estado', 'abierto')
    .maybeSingle();
  if (error) return null;
  if (data) turnoService.setActiveTurn(data.id);
  return data;
}

/**
 * Verifica si hay turno activo, muestra modal si no hay.
 * @param {object} supabase - Instancia de supabase.
 * @param {string} hotelId - ID del hotel.
 * @param {string} usuarioId - ID del usuario.
 * @returns {boolean} true si hay turno, false si no.
 */
export async function checkTurnoActivo(supabase, hotelId, usuarioId) {
  const turno = await fetchTurnoActivo(supabase, hotelId, usuarioId);
  if (!turno) {
    // NOTA: mostrarInfoModalGlobal debe estar global en tus módulos
    if (typeof mostrarInfoModalGlobal === 'function') {
      mostrarInfoModalGlobal(
        "Acción bloqueada: No hay un turno de caja abierto. Ábrelo desde el módulo de Caja.",
        "Turno Requerido"
      );
    } else {
      alert("Acción bloqueada: No hay un turno de caja abierto. Ábrelo desde el módulo de Caja.");
    }
    return false;
  }
  return true;
}
