// js/services/BitacoraService.js

/**
 * Servicio universal para registrar movimientos en la bitácora del sistema hotelero.
 *
 * Uso recomendado:
 *   import { registrarEnBitacora } from '../services/BitacoraService.js';
 *   await registrarEnBitacora({ supabase, hotel_id, usuario_id, modulo, accion, detalles });
 */

/**
 * Registra una acción en la bitácora.
 * @param {object} params - Parámetros del registro.
 * @param {object} params.supabase - Instancia actual de Supabase.
 * @param {string} params.hotel_id - ID del hotel.
 * @param {string} params.usuario_id - ID del usuario (opcional para acciones automáticas).
 * @param {string} params.modulo - Módulo (ejemplo: 'Reservas', 'Caja', 'Habitaciones', etc).
 * @param {string} params.accion - Acción ejecutada (ejemplo: 'Venta', 'Limpieza', 'Cobro', etc).
 * @param {object|string} [params.detalles] - Objeto o string con detalles relevantes (JSON recomendado).
 * @returns {Promise} - Resultado de la inserción (no lanza error, muestra consola si falla).
 */
export async function registrarEnBitacora({
  supabase,
  hotel_id,
  usuario_id = null,
  modulo = 'General',
  accion = 'Sin acción',
  detalles = null
}) {
  try {
    const insertData = {
      hotel_id,
      usuario_id,
      modulo,
      accion,
      detalles,
      creado_en: new Date().toISOString() // Puedes quitar esto si la columna tiene default en SQL
    };
    const { error } = await supabase.from('bitacora').insert([insertData]);
    if (error) {
      console.warn('BitacoraService: Error registrando en bitácora', error, insertData);
    } else {
      // Opcional: console.log('Bitácora registrada:', accion, modulo, detalles);
    }
  } catch (e) {
    console.error('BitacoraService: Error inesperado', e);
  }
}
