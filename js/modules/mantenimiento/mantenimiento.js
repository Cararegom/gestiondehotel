// Fachada estable del módulo de mantenimiento.
// La implementación se divide por responsabilidad para evitar volver a concentrar
// lógica de UI, persistencia, preventivos y evidencias en un solo archivo.
export { mount, unmount, showModalTarea } from './mantenimiento-ui.js';
