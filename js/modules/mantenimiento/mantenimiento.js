// Fachada estable del módulo de mantenimiento.
// Fase 2: la experiencia principal es mobile-first y conserva la misma API pública
// para que el mapa de habitaciones y el cargador de módulos no cambien su contrato.
export { mount, unmount, showModalTarea } from './mantenimiento-mobile-ui.js';
