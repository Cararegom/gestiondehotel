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
        <svg width="72" height="72" fill="none" viewBox="0 0 72 72"><rect width="72" height="72" rx="16" fill="#E5EFFF"/><path d="M26 41c0 4.418 4.925 8 11 8s11-3.582 11-8" stroke="#60A5FA" stroke-width="2"/><ellipse cx="37" cy="36" rx="12" ry="13" fill="#BAE6FD"/><ellipse cx="36" cy="36"rx="10" ry="11" fill="#E0F2FE"/><circle cx="36" cy="36" r="8" fill="#3B82F6"/><path d="M33.5 36.5l2 2 3.5-3.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>
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

// =======================================================
// --- INICIO: NUEVAS FUNCIONES PARA HISTORIAL DE ARTÍCULOS ---
// =======================================================

/**
 * Ayudante para formatear fechas de forma legible.
 */
function formatDateTime(dateStr, locale = 'es-CO', options = { dateStyle: 'medium', timeStyle: 'short' }) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? 'Fecha Inválida' : date.toLocaleString(locale, options);
}

/**
 * Muestra un modal con el historial de artículos prestados y devueltos.
 */
async function showHistorialArticulosModal() {
    // 1. Crear y mostrar modal con estado de carga
    const modalEl = document.createElement('div');
    modalEl.id = 'historial-articulos-modal';
    // Usamos document.body para asegurar que se superponga a todo
    modalEl.className = "fixed inset-0 z-[100] flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 pt-8 overflow-y-auto";
    modalEl.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-3xl p-6 m-auto relative animate-fadeIn" style="animation: fadeIn 0.2s;">
            <div class="flex justify-between items-center mb-4 pb-3 border-b">
                <h3 class="text-xl font-bold text-indigo-700">📜 Historial de Artículos Prestados</h3>
                <button id="btn-close-historial-modal" class="text-gray-500 hover:text-red-600 text-3xl leading-none">&times;</button>
            </div>
            <div id="historial-content" class="max-h-[60vh] overflow-y-auto">
                <p class="text-center text-gray-500 py-8">Cargando historial...</p>
            </div>
        </div>
    `;
    document.body.appendChild(modalEl);

    const closeModal = () => {
        if (document.body.contains(modalEl)) {
            document.body.removeChild(modalEl);
        }
    };
    modalEl.querySelector('#btn-close-historial-modal').onclick = closeModal;
    modalEl.onclick = (e) => { if (e.target === modalEl) closeModal(); }; // Clic en el fondo

    // 2. Cargar los datos del historial
    try {
        // Consultamos el historial, uniendo con 'usuarios' y 'habitaciones' para obtener los nombres
        const { data: historial, error } = await supabase
            .from('historial_articulos_prestados')
            .select(`
                *,
                usuarios ( nombre ),
                habitaciones ( nombre )
            `)
            .eq('hotel_id', currentHotelId)
            .order('fecha_accion', { ascending: false }) // Los más nuevos primero
            .limit(200); // Límite de 200 registros

        if (error) throw error;

        const contentEl = modalEl.querySelector('#historial-content');
        if (!historial || historial.length === 0) {
            contentEl.innerHTML = `<p class="text-center text-gray-500 py-8">No hay registros en el historial de artículos.</p>`;
            return;
        }

        // 3. Renderizar la tabla con los datos
        contentEl.innerHTML = `
            <table class="w-full text-sm text-left table-auto">
                <thead class="bg-gray-100 text-gray-600 uppercase text-xs">
                    <tr>
                        <th class="p-2">Fecha/Hora</th>
                        <th class="p-2">Artículo</th>
                        <th class="p-2">Acción</th>
                        <th class="p-2">Habitación</th>
                        <th class="p-2">Recepcionista</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                    ${historial.map(item => `
                        <tr class="hover:bg-gray-50">
                            <td class="p-2 whitespace-nowrap">${formatDateTime(item.fecha_accion)}</td>
                            <td class="p-2 font-semibold text-gray-800">${item.articulo_nombre}</td>
                            <td class="p-2">
                                <span class="px-2 py-0.5 rounded-full text-xs font-medium ${
                                    item.accion === 'prestado'
                                        ? 'bg-yellow-100 text-yellow-800' // Prestado en amarillo
                                        : 'bg-green-100 text-green-800'   // Devuelto en verde
                                }">
                                    ${item.accion}
                                </span>
                            </td>
                            <td class="p-2">${item.habitaciones?.nombre || 'N/A'}</td>
                            <td class="p-2">${item.usuarios?.nombre || 'Sistema'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

    } catch (err) {
        console.error("Error cargando historial de artículos:", err);
        modalEl.querySelector('#historial-content').innerHTML = `<p class="text-center text-red-500 py-8">Error al cargar el historial: ${err.message}</p>`;
    }
}

// =====================================================
// --- FIN: NUEVAS FUNCIONES PARA HISTORIAL DE ARTÍCULOS ---
// =====================================================


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

  // Renderizar UI --- (BLOQUE MODIFICADO) ---
  container.innerHTML = `
  <div class="w-full px-2 py-8">
    <div class="bg-white rounded-2xl shadow-xl p-6 mb-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div class="flex-grow text-center md:text-left">
            <h2 class="text-2xl font-bold text-blue-900 flex items-center gap-2">🧽 Gestión de Limpieza</h2>
            <div class="text-blue-600 mt-2 font-medium text-sm">Haz clic en el botón cuando la habitación esté lista</div>
        </div>
        <button id="btn-ver-historial-articulos" class="bg-indigo-500 hover:bg-indigo-600 text-white font-bold px-5 py-2 rounded-lg text-base shadow transition-all duration-150 w-full md:w-auto">
            📜 Ver Historial de Artículos
        </button>
    </div>
    <h3 class="font-semibold text-lg mb-3 text-blue-700">Habitaciones pendientes</h3>
    <div id="pendientes-feedback" class="mb-3"></div>
    <div id="pendientes-list"></div>
  </div>
`;

  const pendientesListEl   = container.querySelector('#pendientes-list');
  const pendientesFeedback = container.querySelector('#pendientes-feedback');
  // --- (NUEVA LÍNEA) ---
  const btnHistorial = container.querySelector('#btn-ver-historial-articulos');

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

  // --- (NUEVO BLOQUE DE CÓDIGO) ---
  // 3) Delegar click en "Ver Historial"
  const onHistorialClick = (e) => {
    // Llamamos a la nueva función que creamos
    showHistorialArticulosModal(); 
  };
  btnHistorial.addEventListener('click', onHistorialClick);
  moduleListeners.push({ el: btnHistorial, evt: 'click', fn: onHistorialClick });
  // --- (FIN DEL NUEVO BLOQUE) ---
}

// --- DESMONTAR ---
export function unmount() {
  moduleListeners.forEach(({ el, evt, fn }) => el.removeEventListener(evt, fn));
  moduleListeners = [];
}