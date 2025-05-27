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