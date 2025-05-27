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

// --- CARGA Y MUESTRA PENDIENTES ---
async function fetchPendientes(listEl, feedbackEl) {
  clearAppFeedback(feedbackEl);
  showAppFeedback(feedbackEl, 'Cargando habitaciones pendientes de limpieza...', 'info');
  try {
    const { data, error } = await supabase
      .from('habitaciones')
      .select('id, nombre, tipo, estado')
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

// --- DIBUJA TARJETAS BONITAS ---
function renderPendientes(pendientes, listEl, feedbackEl) {
  listEl.innerHTML = '';
  clearAppFeedback(feedbackEl);

  if (!pendientes || pendientes.length === 0) {
    listEl.innerHTML = `
      <div class="flex flex-col items-center mt-6 mb-8 text-blue-400">
        <svg width="72" height="72" fill="none" viewBox="0 0 72 72"><rect width="72" height="72" rx="16" fill="#E5EFFF"/><path d="M26 41c0 4.418 4.925 8 11 8s11-3.582 11-8" stroke="#60A5FA" stroke-width="2"/><ellipse cx="37" cy="36" rx="12" ry="13" fill="#BAE6FD"/><ellipse cx="36" cy="36" rx="10" ry="11" fill="#E0F2FE"/><circle cx="36" cy="36" r="8" fill="#3B82F6"/><path d="M33.5 36.5l2 2 3.5-3.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>
        <div class="mt-3 font-semibold text-lg">¡Todo limpio! No hay habitaciones pendientes</div>
      </div>
    `;
    return;
  }

  listEl.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
      ${pendientes.map(room => `
        <div class="limpieza-card animate-fadeIn p-5 bg-blue-50 rounded-xl shadow flex flex-col md:flex-row items-center gap-4 border border-blue-100">
          <div class="flex flex-col items-center justify-center">
            <div class="bg-blue-200 rounded-full p-4 text-4xl mb-1 shadow-inner">🧹</div>
            <div class="text-xs text-blue-500 mt-1 uppercase tracking-wide">PENDIENTE</div>
          </div>
          <div class="flex-1 w-full md:w-auto text-center md:text-left">
            <div class="text-xl font-bold text-blue-900">${room.nombre}</div>
            <div class="text-blue-600 text-sm mb-1">${room.tipo ? room.tipo : ""}</div>
          </div>
          <button data-id="${room.id}" class="btn-confirm-clean bg-green-500 hover:bg-green-600 text-white font-bold px-6 py-2 rounded-lg text-base shadow transition-all duration-150 hover:scale-105">
            ✔ Confirmar Limpieza
          </button>
        </div>
      `).join('')}
    </div>
    <style>
      @keyframes fadeIn { from { opacity:0; transform:translateY(30px);} to { opacity:1; transform:none;} }
      .animate-fadeIn { animation: fadeIn 0.35s;}
    </style>
  `;
}

// --- CONFIRMAR LIMPIEZA ---
async function confirmCleaningById(roomId, roomNombre, feedbackEl, listEl) {
  showGlobalLoading();
  try {
    // Actualizar estado a "libre"
    const { data: updated, error: updErr } = await supabase
      .from('habitaciones')
      .update({ estado: ROOM_STATUS_OPTIONS.libre.key })
      .eq('id', roomId)
      .select('id,nombre')
      .single();
    if (updErr) throw updErr;

    // Notifica recepción
    await crearNotificacion(supabase, {
      hotelId: currentHotelId,
      rolDestino: 'recepcionista',
      tipo: 'limpieza_completada',
      mensaje: `La habitación '${updated.nombre}' ha sido marcada como limpia y está lista.`,
      entidadTipo: 'habitacion',
      entidadId: updated.id,
      generadaPorUsuarioId: user.id
    });

    showAppFeedback(
      feedbackEl,
      `Habitación <b>${updated.nombre}</b>: limpieza lista y confirmada 👌`,
      'success'
    );
    await fetchPendientes(listEl, feedbackEl);
  } catch (err) {
    console.error(err);
    showAppFeedback(feedbackEl, `Error al confirmar limpieza: ${err.message}`, 'error');
  } finally {
    hideGlobalLoading();
  }
}

// --- MONTAR EL MÓDULO ---
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
    <div class="card max-w-2xl mx-auto shadow-xl rounded-2xl bg-white">
      <div class="card-header bg-gradient-to-r from-blue-100 via-blue-50 to-white p-6 rounded-t-2xl border-b flex flex-col md:flex-row items-center justify-between">
        <h2 class="text-2xl font-bold text-blue-900 flex items-center gap-2">🧽 Gestión de Limpieza</h2>
        <div class="text-blue-600 mt-2 md:mt-0 font-medium text-sm">Haz clic en el botón cuando la habitación esté lista</div>
      </div>
      <div class="card-body p-6">
        <h3 class="font-semibold text-lg mb-3 text-blue-700">Habitaciones pendientes</h3>
        <div id="pendientes-feedback" class="mb-3"></div>
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
      e.target.disabled = true;
      const id = e.target.dataset.id;
      const nombre = e.target.closest('.limpieza-card').querySelector('.text-xl').textContent;
      confirmCleaningById(id, nombre, pendientesFeedback, pendientesListEl)
        .finally(() => { e.target.disabled = false; });
    }
  };
  pendientesListEl.addEventListener('click', onPendingClick);
  moduleListeners.push({ el: pendientesListEl, evt: 'click', fn: onPendingClick });
}

// --- DESMONTAR ---
export function unmount() {
  moduleListeners.forEach(({ el, evt, fn }) => el.removeEventListener(evt, fn));
  moduleListeners = [];
}
