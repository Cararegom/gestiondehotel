// Ruta: js/modules/notificaciones/campanita.js

import { getCurrentUser } from '../../authService.js';

let globalNotificationSubscription = null;
let campanitaListeners = [];
let isCampanitaInitializing = false;

const formatNotificationDate = (dateStr) => {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? 'Fecha Inválida' : d.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
};

export async function inicializarCampanitaGlobal(bellContainer, supabaseInstance) {
  if (isCampanitaInitializing) {
    console.warn("Campanita: Inicialización bloqueada (proceso ya en curso).");
    return;
  }
  isCampanitaInitializing = true;

  try {
    console.log("Campanita: Iniciando...");
    const currentUser = getCurrentUser();
    if (!currentUser) {
      isCampanitaInitializing = false;
      return;
    }

    let hotelIdToUse = currentUser.user_metadata?.hotel_id;
    if (!hotelIdToUse) {
        try {
          const { data: perfil } = await supabaseInstance.from('usuarios').select('hotel_id').eq('id', currentUser.id).single();
          if (perfil?.hotel_id) hotelIdToUse = perfil.hotel_id;
          else throw new Error("Hotel ID no encontrado en perfil de usuario.");
        } catch (err) {
          console.error(err.message);
          isCampanitaInitializing = false;
          return;
        }
    }

    if (globalNotificationSubscription) {
      await supabaseInstance.removeChannel(globalNotificationSubscription);
    }
    campanitaListeners.forEach(({ element, type, handler }) => element.removeEventListener(type, handler));
    campanitaListeners = [];

    bellContainer.innerHTML = `
      <div id="notificaciones-icono-wrapper" class="relative">
        <button id="notificaciones-toggle-btn" class="button-icon p-2 rounded-full hover:bg-gray-200">
          <svg class="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
          <span id="notificaciones-badge-count" class="absolute top-0 right-0 block h-4 w-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center" style="display:none;"></span>
        </button>
        <div id="notificaciones-dropdown-menu" class="dropdown-menu absolute right-0 mt-2 w-80 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 hidden z-50">
          </div>
      </div>`;

    // El resto de la lógica de la campanita (renderizado, listeners, etc.) iría aquí.
    // Por ahora, nos enfocamos en el historial.

  } finally {
    isCampanitaInitializing = false;
  }
}