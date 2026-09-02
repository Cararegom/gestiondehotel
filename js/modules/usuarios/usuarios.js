// Fachada estable del módulo Usuarios.
// Conserva toda la gestión legacy estable y sustituye únicamente el creador de horarios.
import * as legacy from './usuarios-legacy.js';
import { mountHorarioProfesional, unmountHorarioProfesional } from './horarios-profesional.js';

export async function mount(container, sbInstance, user, hotelId, planDetails) {
  await legacy.mount(container, sbInstance, user, hotelId, planDetails);
  await mountHorarioProfesional(container, sbInstance, user, hotelId);
}

export function unmount(container) {
  unmountHorarioProfesional();
  return legacy.unmount?.(container);
}
