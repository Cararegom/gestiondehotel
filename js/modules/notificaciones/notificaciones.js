// js/modules/notificaciones/notificaciones.js
import { getUserSession } from '../../authService.js';

// --- Campanita Global Variables ---
let globalNotificationSubscription = null;
let campanitaListeners = [];
let currentBellHotelId = null; // Almacenar hotelId usado por la campanita actual
let currentBellUserId = null; // Almacenar userId usado por la campanita actual

// --- Historial Page Variables ---
let moduleHistoryListeners = [];

const formatNotificationDate = (dateStr, options = { dateStyle: 'short', timeStyle: 'short' }) => {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? 'Fecha Inválida' : d.toLocaleString('es-CO', options);
};

// En: js/modules/notificaciones/notificaciones.js

// Añade esta variable de estado al inicio de tu archivo si no la tienes
let isCampanitaInitializing = false;

/**
 * Inicializa la campanita de notificaciones global.
 * Carga el HTML, obtiene los datos del usuario y las notificaciones,
 * y establece los listeners para la interactividad y las actualizaciones en tiempo real.
 *
 * @param {HTMLElement} bellContainer - El elemento contenedor donde se inyectará la campanita.
 * @param {object} supabaseInstance - La instancia activa del cliente de Supabase.
 */
export async function inicializarCampanitaGlobal(bellContainer, supabaseInstance) {
  // --- Bloqueo para evitar inicialización múltiple ---
  if (isCampanitaInitializing) {
    console.warn("Campanita: Intento de reinicialización bloqueado.");
    return;
  }
  isCampanitaInitializing = true;

  try {
    // 1. Obtener el usuario de forma asíncrona y segura
    const { user: currentUser } = await getUserSession();
    if (!currentUser) {
      console.warn('Campanita: Usuario no autenticado.');
      isCampanitaInitializing = false;
      return;
    }

    // 2. Obtener el hotel_id del usuario
    let hotelIdToUse;
    if (currentUser.user_metadata?.hotel_id) {
      hotelIdToUse = currentUser.user_metadata.hotel_id;
    } else {
      try {
        const { data: perfil } = await supabaseInstance.from('usuarios').select('hotel_id').eq('id', currentUser.id).single();
        if (!perfil?.hotel_id) throw new Error('Hotel ID no encontrado en perfil.');
        hotelIdToUse = perfil.hotel_id;
      } catch (err) {
        console.error('Campanita: Error crítico obteniendo HotelID.', err);
        isCampanitaInitializing = false;
        return;
      }
    }

    // 3. Limpiar listeners y suscripciones anteriores para evitar duplicados
    if (globalNotificationSubscription) {
      await supabaseInstance.removeChannel(globalNotificationSubscription);
      globalNotificationSubscription = null;
    }
    campanitaListeners.forEach(({ element, type, handler }) => element?.removeEventListener(type, handler));
    campanitaListeners = [];

    // 4. Almacenar IDs actuales para las operaciones
    currentBellHotelId = hotelIdToUse;
    currentBellUserId = currentUser.id;

    // 5. Inyectar el HTML completo de la campanita
    bellContainer.innerHTML = `
      <div id="notificaciones-icono-wrapper" class="relative inline-block text-left">
        <button id="notificaciones-toggle-btn" type="button" class="button-icon p-2 rounded-full hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500" aria-label="Notificaciones" aria-haspopup="true" aria-expanded="false">
          <svg class="h-6 w-6 text-gray-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
          <span id="notificaciones-badge-count" class="absolute top-0 right-0 block h-4 w-4 transform -translate-y-1/2 translate-x-1/2 rounded-full bg-red-500 text-white text-xs flex items-center justify-center" style="display:none;"></span>
        </button>
        <div id="notificaciones-dropdown-menu" class="dropdown-menu origin-top-right absolute right-0 mt-2 w-80 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 hidden z-50">
          <div class="py-1">
            <div class="px-4 py-2 text-sm text-gray-700 font-medium border-b border-gray-200">Notificaciones Recientes</div>
            <ul id="notificaciones-dropdown-list" class="max-h-80 overflow-y-auto"></ul>
            <div class="px-4 py-2 border-t border-gray-200 flex justify-between items-center">
              <button id="btn-marcar-todas-leidas-campana" class="text-xs text-indigo-600 hover:text-indigo-800 focus:outline-none">Marcar todas como leídas</button>
              <a href="#/notificaciones" id="link-ver-todas-notificaciones" class="text-xs text-indigo-600 hover:text-indigo-800">Ver todas</a>
            </div>
          </div>
        </div>
      </div>`;

    // 6. Seleccionar los elementos del DOM después de haberlos creado
    const bellButtonEl = bellContainer.querySelector('#notificaciones-toggle-btn');
    const dropdownMenuEl = bellContainer.querySelector('#notificaciones-dropdown-menu');
    const dropdownListEl = bellContainer.querySelector('#notificaciones-dropdown-list');
    const marcarTodasLeidasBtnEl = bellContainer.querySelector('#btn-marcar-todas-leidas-campana');
    const verTodasLinkEl = bellContainer.querySelector('#link-ver-todas-notificaciones');
    const badgeCountEl = bellContainer.querySelector('#notificaciones-badge-count');

    // 7. Definir las funciones de renderizado y carga de datos de forma anidada
    const renderNotificationsInDropdown = (notifications) => {
      const unreadCount = notifications.filter(n => !n.leida).length;
      if (badgeCountEl) {
        badgeCountEl.textContent = unreadCount > 9 ? '9+' : unreadCount;
        badgeCountEl.style.display = unreadCount > 0 ? 'flex' : 'none';
      }
      if (dropdownListEl) {
          if (notifications.length === 0) {
            dropdownListEl.innerHTML = '<li class="px-4 py-3 text-sm text-gray-500 text-center">No tienes notificaciones.</li>';
          } else {
            dropdownListEl.innerHTML = notifications.map(n => `
              <li class="dropdown-item block px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer ${n.leida ? '' : 'bg-indigo-50 font-medium'}" data-notificacion-id="${n.id}">
                <div class="flex items-start space-x-2">
                  <div class="noti-tipo-icon w-2 h-2 rounded-full mt-1.5 tipo-${n.tipo || 'default'}"></div>
                  <div class="flex-1">
                    <div class="noti-mensaje leading-tight">${n.mensaje}</div>
                    <div class="noti-fecha text-xs text-gray-400 mt-0.5">${formatNotificationDate(n.creado_en)}</div>
                  </div>
                  ${!n.leida ? '<div class="w-2 h-2 bg-indigo-500 rounded-full self-center ml-auto"></div>' : ''}
                </div>
              </li>`).join('');
          }
      }
    }

    const cargarYRenderizarNotificaciones = async () => {
      try {
        const { data: notifications, error } = await supabaseInstance
          .from('notificaciones')
          .select('id, mensaje, tipo, leida, creado_en')
          .eq('hotel_id', currentBellHotelId)
          .or(`usuario_id.eq.${currentUser.id},rol_destino.eq.${currentUser.app_metadata?.rol || 'recepcionista'}`)
          .order('creado_en', { ascending: false })
          .limit(7);
        if (error) throw error;
        renderNotificationsInDropdown(notifications || []);
      } catch (err) {
        console.error('Error cargando notificaciones para campanita:', err);
        if(dropdownListEl) dropdownListEl.innerHTML = '<li class="px-4 py-3 text-sm text-red-500 text-center">Error al cargar.</li>';
      }
    }

    // 8. Carga inicial de notificaciones
    await cargarYRenderizarNotificaciones();

    // 9. Definir y asignar los manejadores de eventos
    const toggleDropdownHandler = () => {
      dropdownMenuEl.classList.toggle('hidden');
      const isVisible = !dropdownMenuEl.classList.contains('hidden');
      bellButtonEl.setAttribute('aria-expanded', String(isVisible));
    };

    const marcarTodasHandler = async () => {
      try {
        await supabaseInstance.rpc('marcar_todas_mis_notificaciones_leidas');
        await cargarYRenderizarNotificaciones();
      } catch (e) { console.error("Error marcando todas como leídas:", e); }
    };

    const verTodasHandler = () => dropdownMenuEl.classList.add('hidden');

    bellButtonEl.addEventListener('click', toggleDropdownHandler);
    marcarTodasLeidasBtnEl.addEventListener('click', marcarTodasHandler);
    verTodasLinkEl.addEventListener('click', verTodasHandler);

    campanitaListeners.push({ element: bellButtonEl, type: 'click', handler: toggleDropdownHandler });
    campanitaListeners.push({ element: marcarTodasLeidasBtnEl, type: 'click', handler: marcarTodasHandler });
    campanitaListeners.push({ element: verTodasLinkEl, type: 'click', handler: verTodasHandler });

    // 10. Suscripción a eventos de Realtime
    const channelName = `notifications-h-${currentBellHotelId}-u-${currentBellUserId}`;
    globalNotificationSubscription = supabaseInstance.channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificaciones' }, payload => {
        console.log('Campanita: Notificación nueva recibida.', payload.new);
        cargarYRenderizarNotificaciones();
      })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') console.log(`Campanita: Conectado a ${channelName}.`);
        if (err) console.error(`Campanita: Error en suscripción a ${channelName}:`, err);
      });

  } finally {
    isCampanitaInitializing = false;
  }
}


export function desmontarCampanitaGlobal(supabaseInstance) {
  console.log("Campanita: desmontarCampanitaGlobal llamado.");
  const wrapper = document.getElementById('notificaciones-icono-wrapper');
  if (wrapper) {
    wrapper.remove();
  }

  campanitaListeners.forEach(({ element, type, handler, options }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler, options);
    }
  });
  campanitaListeners = [];

  if (globalNotificationSubscription && supabaseInstance && typeof supabaseInstance.removeChannel === 'function') {
    const channelTopic = globalNotificationSubscription.topic; // Guardar topic antes de que la referencia se pierda
    console.log("Campanita: Intentando desuscribir canal Realtime existente:", channelTopic);
    supabaseInstance.removeChannel(globalNotificationSubscription)
      .then((status) => console.log(`Campanita: Canal Realtime ${channelTopic} desuscrito, estado:`, status))
      .catch(err => console.error(`Campanita: Error desuscribiendo canal Realtime ${channelTopic}:`, err));
  } else {
    console.log("Campanita: No había suscripción Realtime activa para desmontar o supabaseInstance no disponible.");
  }
  globalNotificationSubscription = null; // Asegurarse de resetear
  currentBellHotelId = null; // Resetear hotelId de la campanita
  currentBellUserId = null; // Resetear userId de la campanita
}


// Reemplaza tu función renderHistorialCompleto existente con esta versión

async function renderHistorialCompleto(pageContainer, supabaseInstance, hotelId, currentUser) { // <-- CAMBIO 1: Recibe el objeto 'currentUser' completo
    pageContainer.innerHTML = `<div class="card shadow-lg rounded-lg"><div class="card-body p-4 md:p-6"><p class="loading-indicator text-center py-8 text-gray-500">Cargando historial de notificaciones...</p></div></div>`;
    
    try {
        // CAMBIO 2: Obtenemos el rol y el ID directamente del objeto 'currentUser' que nos llega como argumento.
        const currentUserRole = currentUser?.app_metadata?.rol || 'recepcionista';
        const userId = currentUser.id;
        
        // La consulta ahora usa las variables locales 'userId' y 'currentUserRole'
        const { data: notifications, error } = await supabaseInstance
            .from('notificaciones')
            .select('id, mensaje, tipo, leida, creado_en, entidad_tipo, entidad_id')
            .eq('hotel_id', hotelId)
            .or(`usuario_id.eq.${userId},rol_destino.eq.${currentUserRole}`) // La lógica de la consulta no cambia
            .order('creado_en', { ascending: false })
            .limit(100);

        if (error) throw error;

        // El resto del código para renderizar la tabla no necesita cambios.
        pageContainer.innerHTML = `
        <div class="card shadow-lg rounded-lg">
            <div class="card-header bg-gray-100 p-4 border-b">
              <h2 class="text-xl font-semibold text-gray-800">Historial de Notificaciones</h2>
            </div>
            <div class="card-body p-0 md:p-2">
              <div class="table-container overflow-x-auto">
                <table class="tabla-estilizada w-full min-w-full divide-y divide-gray-200">
                  <thead class="bg-gray-50">
                    <tr>
                      <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
                      <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mensaje</th>
                      <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tipo</th>
                      <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                      <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Acción</th>
                    </tr>
                  </thead>
                  <tbody id="historial-notificaciones-tbody" class="bg-white divide-y divide-gray-200">
                    ${notifications.length === 0 ? '<tr><td colspan="5" class="px-4 py-4 text-center text-sm text-gray-500">No hay notificaciones en tu historial.</td></tr>' : ''}
                  </tbody>
                </table>
              </div>
            </div>
        </div>`;
        
        const tbodyEl = pageContainer.querySelector('#historial-notificaciones-tbody');
        
        if (tbodyEl && notifications.length > 0) {
            notifications.forEach(n => {
                const tr = document.createElement('tr');
                tr.className = n.leida ? 'bg-white hover:bg-gray-50' : 'bg-indigo-50 hover:bg-indigo-100 font-medium';
                tr.innerHTML = `
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${formatNotificationDate(n.creado_en)}</td>
                    <td class="px-4 py-3 whitespace-normal text-sm text-gray-900">${n.mensaje}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm">
                        <span class="badge tipo-${n.tipo || 'default'} px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            n.tipo === 'error' ? 'bg-red-100 text-red-800' : 
                            n.tipo === 'alerta' ? 'bg-yellow-100 text-yellow-800' : 
                            n.tipo === 'limpieza_completada' ? 'bg-green-100 text-green-800' :
                            'bg-blue-100 text-blue-800'
                        }">${n.tipo || 'General'}</span>
                    </td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm ${n.leida ? 'text-gray-500' : 'text-indigo-600'}">${n.leida ? 'Leída' : 'No Leída'}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm font-medium">
                        ${!n.leida ? `<button class="button button-small button-link text-indigo-600 hover:text-indigo-900 marcar-leida-historial" data-id="${n.id}">Marcar Leída</button>` : ''}
                    </td>
                `;
                tbodyEl.appendChild(tr);
            });

            const tbodyClickListener = async (event) => {
                const target = event.target.closest('.marcar-leida-historial');
                if (target) {
                    const notificacionId = target.dataset.id;
                    target.disabled = true; 
                    target.textContent = 'Marcando...';
                    try {
                        const { error: updateError } = await supabaseInstance.from('notificaciones')
                            .update({ leida: true, actualizado_en: new Date().toISOString() })
                            .eq('id', notificacionId)
                            .eq('hotel_id', hotelId); 
                        if (updateError) throw updateError;
                        // Volver a renderizar todo para mostrar el cambio
                        await renderHistorialCompleto(pageContainer, supabaseInstance, hotelId, currentUser); // Volvemos a pasar currentUser
                    } catch (err) {
                        console.error("Error al marcar como leída desde el historial:", err);
                        target.disabled = false;
                        target.textContent = 'Marcar Leída';
                    }
                }
            };
            tbodyEl.addEventListener('click', tbodyClickListener);
            moduleHistoryListeners.push({element: tbodyEl, type: 'click', handler: tbodyClickListener});
        }

    } catch (error) {
        console.error('Error cargando el historial de notificaciones:', error);
        pageContainer.innerHTML = `<div class="card shadow-lg rounded-lg"><div class="card-body p-4 md:p-6"><p class="error-indicator text-center py-8 text-red-600">Error al cargar el historial: ${error.message}</p></div></div>`;
    }
}


// En: js/modules/notificaciones/notificaciones.js
// Reemplaza tu función mount actual con esta versión

export async function mount(pageContainer, supabaseInstance, currentUser) {
  // --- INICIO DEL BLOQUE DE VALIDACIÓN CORREGIDO ---
  // Nos aseguramos de que currentUser exista Y tenga un .id antes de hacer nada.
  if (!currentUser || !currentUser.id) {
    console.error("Notifications Page Mount: Se intentó montar la página sin un usuario válido.", currentUser);
    pageContainer.innerHTML = `<p class="error-indicator visible p-4 bg-red-100 text-red-700 rounded">Error: No se puede cargar la página de notificaciones porque no se ha proporcionado un usuario válido.</p>`;
    return; // Detenemos la ejecución si no hay un usuario apropiado.
  }
  // --- FIN DEL BLOQUE DE VALIDACIÓN ---

  unmount(pageContainer); 

  let currentHistoryHotelId = currentUser?.user_metadata?.hotel_id;
  let currentHistoryUserId = currentUser.id; // Ahora esto es seguro

  if (!currentHistoryHotelId && currentHistoryUserId) {
    try {
      const { data: perfil, error } = await supabaseInstance.from('usuarios').select('hotel_id').eq('id', currentHistoryUserId).single();
      if (error && error.code !== 'PGRST116') throw error;
      if (perfil) currentHistoryHotelId = perfil.hotel_id;
    } catch (err) {
        console.error("Notifications Page: Error fetching hotel_id from profile:", err);
    }
  }

  // Esta validación secundaria ahora es un refuerzo.
  if (!currentHistoryHotelId || !currentHistoryUserId) {
    pageContainer.innerHTML = '<p class="error-indicator visible p-4 bg-red-100 text-red-700 rounded">No se puede cargar la página de notificaciones. Faltan datos del usuario o del hotel.</p>';
    return;
  }

  if (window.location.hash.startsWith('#/notificaciones')) {
    // La llamada a renderHistorialCompleto ahora es segura porque hemos validado 'currentUser' antes.
    await renderHistorialCompleto(pageContainer, supabaseInstance, currentHistoryHotelId, currentUser);
  }
}
export function unmount(pageContainer) { 
  moduleHistoryListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleHistoryListeners = [];
  console.log('Notification history page unmounted.');
}
