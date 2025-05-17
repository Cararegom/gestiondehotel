// js/modules/limpieza/limpieza.js
import { ROOM_STATUS_OPTIONS } from '../../config.js';
import { crearNotificacion } from '../../services/NotificationService.js';
import {
  showGlobalLoading,
  hideGlobalLoading,
  showAppFeedback,
  clearAppFeedback
} from '../../uiUtils.js';

let moduleListeners = [];
let currentHotelId = null;
let supabase = null;
let user = null;

/**
 * Carga y muestra la lista de habitaciones en estado "limpieza"
 */
async function fetchPendientes(listEl, feedbackEl) {
  clearAppFeedback(feedbackEl);
  showAppFeedback(feedbackEl, 'Cargando habitaciones pendientes de limpieza...', 'info');
  try {
    const { data, error } = await supabase
      .from('habitaciones')
      .select('id, nombre')
      .eq('hotel_id', currentHotelId)
      .eq('estado', ROOM_STATUS_OPTIONS.limpieza.key)
      .order('nombre');
    if (error) throw error;
    renderPendientes(data, listEl, feedbackEl);
  } catch (err) {
    console.error(err);
    showAppFeedback(feedbackEl, 'Error cargando las habitaciones pendientes', 'error');
  }
}

/**
 * Dibuja cada tarjeta pendiente con su botón de confirmar limpieza
 */
function renderPendientes(pendientes, listEl, feedbackEl) {
  listEl.innerHTML = '';
  clearAppFeedback(feedbackEl);

  if (!pendientes || pendientes.length === 0) {
    showAppFeedback(feedbackEl, 'No hay habitaciones pendientes de limpieza', 'info');
    return;
  }

  pendientes.forEach(room => {
    const card = document.createElement('div');
    card.className = 'pending-card p-4 mb-3 border rounded flex justify-between items-center';
    card.innerHTML = `
      <span class="font-medium">${room.nombre}</span>
      <button data-id="${room.id}" class="btn-confirm-clean button button-small button-primary text-sm">
        Confirmar Limpieza
      </button>
    `;
    listEl.appendChild(card);
  });
}

/**
 * Confirma la limpieza: actualiza estado a "libre", notifica al recepcionista
 */
async function confirmCleaningById(roomId, roomNombre, feedbackEl, listEl) {
  showGlobalLoading();
  try {
    // Actualizar sólo el estado a "libre"
    const { data: updated, error: updErr } = await supabase
      .from('habitaciones')
      .update({ estado: ROOM_STATUS_OPTIONS.libre.key })
      .eq('id', roomId)
      .select('id,nombre')
      .single();
    if (updErr) throw updErr;

    // Crear notificación para recepción
    await crearNotificacion(supabase, {
      hotelId: currentHotelId,
      rolDestino: 'recepcionista',
      tipo: 'limpieza_completada',
      mensaje: `La habitación '${updated.nombre}' ha sido marcada como limpia y está lista.`,
      entidadTipo: 'habitacion',
      entidadId: updated.id,
      generadaPorUsuarioId: user.id
    });

    showAppFeedback(feedbackEl, `Limpieza de '${updated.nombre}' confirmada.`, 'success');

    // Refrescar la lista de pendientes
    await fetchPendientes(listEl, feedbackEl);

  } catch (err) {
    console.error(err);
    showAppFeedback(feedbackEl, `Error al confirmar limpieza: ${err.message}`, 'error');
  } finally {
    hideGlobalLoading();
  }
}

/**
 * Monta el módulo de limpieza en pantalla
 */
export async function mount(container, supabaseInst, currentUser) {
  // Limpiar listeners previos
  moduleListeners.forEach(({ el, evt, fn }) => el.removeEventListener(evt, fn));
  moduleListeners = [];

  supabase = supabaseInst;
  user = currentUser;

  // Obtener hotel_id
  currentHotelId = user.user_metadata?.hotel_id;
  if (!currentHotelId) {
    const { data: perfil, error } = await supabase
      .from('usuarios')
      .select('hotel_id')
      .eq('id', user.id)
      .single();
    if (!error) currentHotelId = perfil.hotel_id;
  }
  if (!currentHotelId) {
    container.innerHTML = `<p class="p-4 bg-red-100 text-red-700 rounded">Error: Hotel no identificado.</p>`;
    return;
  }

  // Renderizar UI
  container.innerHTML = `
    <div class="card max-w-lg mx-auto shadow-lg rounded-lg">
      <div class="card-header bg-gray-100 p-4 border-b">
        <h2 class="text-xl font-semibold text-gray-800">Gestión de Limpieza de Habitaciones</h2>
      </div>
      <div class="card-body p-4">
        <h3 class="font-medium mb-2">Habitaciones Pendientes de Limpieza</h3>
        <div id="pendientes-feedback" class="mb-2"></div>
        <div id="pendientes-list"></div>
      </div>
    </div>
  `;

  const pendientesListEl   = container.querySelector('#pendientes-list');
  const pendientesFeedback = container.querySelector('#pendientes-feedback');

  // 1) Cargar pendientes de limpieza
  await fetchPendientes(pendientesListEl, pendientesFeedback);

  // 2) Delegar click en "Confirmar Limpieza"
  const onPendingClick = e => {
    if (e.target.matches('.btn-confirm-clean')) {
      const id = e.target.dataset.id;
      const nombre = e.target.closest('.pending-card').querySelector('span').textContent;
      confirmCleaningById(id, nombre, pendientesFeedback, pendientesListEl);
    }
  };
  pendientesListEl.addEventListener('click', onPendingClick);
  moduleListeners.push({ el: pendientesListEl, evt: 'click', fn: onPendingClick });
}

/**
 * Desmonta el módulo y limpia listeners
 */
export function unmount() {
  moduleListeners.forEach(({ el, evt, fn }) => el.removeEventListener(evt, fn));
  moduleListeners = [];
}
