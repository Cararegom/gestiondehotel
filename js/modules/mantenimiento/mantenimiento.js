// Contrato público estable: mount, unmount, showModalTarea.
import { mount as baseMount, unmount as baseUnmount, showModalTarea } from './mantenimiento-analytics-ui.js';
import { mountMaintenanceIncidentActions, unmountMaintenanceIncidentActions } from './mantenimiento-incidencias-ui.js';

export async function mount(container, supabase, currentUser, hotelId) {
  await baseMount(container, supabase, currentUser, hotelId);
  mountMaintenanceIncidentActions(container, supabase, currentUser, hotelId);
}
export function unmount() { unmountMaintenanceIncidentActions(); baseUnmount(); }
export { showModalTarea };
