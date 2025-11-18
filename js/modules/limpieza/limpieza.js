// js/modules/limpieza/limpieza.js
import { ROOM_STATUS_OPTIONS } from '../../config.js';
import { crearNotificacion } from '../../services/NotificationService.js';
import {
  showGlobalLoading,
  hideGlobalLoading,
  showAppFeedback,
  clearAppFeedback,
  formatCurrency, 
  showError,
  showSuccess,
  mostrarConfirmacion
} from '../../uiUtils.js';

let moduleListeners = [];
let currentHotelId = null;
let supabase = null;
let user = null;
let currentUserRole = 'limpieza'; 

// --- (Las funciones fetchPendientes, renderPendientes, confirmCleaningById no cambian) ---
async function fetchPendientes(listEl, feedbackEl) {
  clearAppFeedback(feedbackEl);
  showAppFeedback(feedbackEl, 'Cargando habitaciones pendientes de limpieza...', 'info');
  try {
    const { data, error } = await supabase
      .from('habitaciones')
      .select('id, nombre, tipo, estado, tipo_habitacion_id') 
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
          <button 
            data-id="${room.id}" 
            data-nombre="${room.nombre}" 
            data-tipo-id="${room.tipo_habitacion_id || ''}" class="btn-confirm-clean bg-green-500 hover:bg-green-600 text-white font-bold px-6 py-2 rounded-lg text-base shadow transition-all duration-150 hover:scale-105"
          >
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
async function confirmCleaningById(roomId, roomNombre, feedbackEl, listEl) {
  showGlobalLoading();
  try {
    const { data: updated, error: updErr } = await supabase
      .from('habitaciones')
      .update({ estado: ROOM_STATUS_OPTIONS.libre.key })
      .eq('id', roomId)
      .select('id,nombre')
      .single();
    if (updErr) throw updErr;
    await crearNotificacion(supabase, {
      hotelId: currentHotelId,
      rolDestino: 'recepcionista',
      tipo: 'limpieza_completada',
      mensaje: `La habitación '${updated.nombre}' ha sido marcada como limpia y está lista.`,
      entidadTipo: 'habitacion',
      entidadId: updated.id,
      generadaPorUsuarioId: user.id
    });
    showAppFeedback(feedbackEl, `Habitación <b>${updated.nombre}</b>: limpieza lista y confirmada 👌`, 'success');
    await fetchPendientes(listEl, feedbackEl);
  } catch (err) {
    console.error(err);
    showAppFeedback(feedbackEl, `Error al confirmar limpieza: ${err.message}`, 'error');
  } finally {
    hideGlobalLoading();
  }
}
// --- Fin funciones de limpieza ---


// =======================================================
// --- HISTORIAL DE ARTÍCULOS PRESTADOS (Recepción) ---
// =======================================================

function formatDateTime(dateStr, locale = 'es-CO', options = { dateStyle: 'medium', timeStyle: 'short' }) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? 'Fecha Inválida' : date.toLocaleString(locale, options);
}

async function showHistorialArticulosModal() {
    const modalEl = document.createElement('div');
    modalEl.id = 'historial-articulos-modal';
    modalEl.className = "fixed inset-0 z-[100] flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 pt-8 overflow-y-auto";
    modalEl.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-3xl p-6 m-auto relative animate-fadeIn" style="animation: fadeIn 0.2s;">
            <div class="flex justify-between items-center mb-4 pb-3 border-b">
                <h3 class="text-xl font-bold text-indigo-700">📜 Historial de Artículos Prestados (Recepción)</h3>
                <button id="btn-close-historial-modal" class="text-gray-500 hover:text-red-600 text-3xl leading-none">&times;</button>
            </div>
            <div id="historial-content" class="max-h-[60vh] overflow-y-auto">
                <p class="text-center text-gray-500 py-8">Cargando historial...</p>
            </div>
        </div>
    `;
    document.body.appendChild(modalEl);

    const closeModal = () => modalEl.remove();
    modalEl.querySelector('#btn-close-historial-modal').onclick = closeModal;
    modalEl.onclick = (e) => { if (e.target === modalEl) closeModal(); }; 

    try {
        const { data: historial, error } = await supabase
            .from('historial_articulos_prestados')
            .select(`*, usuarios(nombre), habitaciones(nombre)`)
            .eq('hotel_id', currentHotelId)
            .order('fecha_accion', { ascending: false }) 
            .limit(200);
        if (error) throw error;

        const contentEl = modalEl.querySelector('#historial-content');
        if (!historial || historial.length === 0) {
            contentEl.innerHTML = `<p class="text-center text-gray-500 py-8">No hay registros en el historial de artículos prestados.</p>`;
            return;
        }

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
                    ${historial.map(item => {
                        let badgeClass = '';
                        if (item.accion === 'prestado') badgeClass = 'bg-yellow-100 text-yellow-800';
                        else if (item.accion === 'devuelto') badgeClass = 'bg-green-100 text-green-800';
                        else if (item.accion === 'perdido') badgeClass = 'bg-red-100 text-red-800';
                        
                        return `
                        <tr class="hover:bg-gray-50">
                            <td class="p-2 whitespace-nowrap">${formatDateTime(item.fecha_accion)}</td>
                            <td class="p-2 font-semibold text-gray-800">${item.articulo_nombre}</td>
                            <td class="p-2">
                                <span class="px-2 py-0.5 rounded-full text-xs font-medium ${badgeClass}">
                                    ${item.accion}
                                </span>
                            </td>
                            <td class="p-2">${item.habitaciones?.nombre || 'N/A'}</td>
                            <td class="p-2">${item.usuarios?.nombre || 'Sistema'}</td>
                        </tr>
                    `}).join('')}
                </tbody>
            </table>
        `;
    } catch (err) {
        console.error("Error cargando historial de artículos:", err);
        modalEl.querySelector('#historial-content').innerHTML = `<p class="text-center text-red-500 py-8">Error al cargar el historial: ${err.message}</p>`;
    }
}

// =================================================================
// --- INICIO: GESTIÓN DE INVENTARIO (AMENIDADES Y LENCERÍA) ---
// =================================================================

async function showModalConfirmarLimpieza(roomId, roomNombre, tipoHabitacionId, feedbackEl, listEl, buttonEl) {
    showGlobalLoading("Cargando inventarios...");
    
    const [amenidadesPromise, lenceriaPromise] = [
        supabase
            .from('amenidades_inventario')
            .select('id, nombre_item, stock_actual, cantidad_default')
            .eq('hotel_id', currentHotelId)
            .order('nombre_item'),
        supabase
            .from('inventario_lenceria')
            .select('id, nombre_item, stock_limpio_almacen')
            .eq('hotel_id', currentHotelId)
            .order('nombre_item')
    ];

    const [amenidadesRes, lenceriaRes] = await Promise.all([amenidadesPromise, lenceriaPromise]);
    hideGlobalLoading();
    
    if (amenidadesRes.error) {
        alert(`Error cargando amenidades: ${amenidadesRes.error.message}`);
        buttonEl.disabled = false; return;
    }
    if (lenceriaRes.error) {
        alert(`Error cargando lencería: ${lenceriaRes.error.message}`);
        buttonEl.disabled = false; return;
    }

    const itemsAmenidades = amenidadesRes.data || [];
    const itemsLenceria = lenceriaRes.data || [];
    
    const modalEl = document.createElement('div');
    modalEl.id = 'registro-inventario-modal';
    modalEl.className = "fixed inset-0 z-[100] flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 pt-8 overflow-y-auto";
    
    const amenidadesHtml = itemsAmenidades.length > 0 ? `
        <div id="tab-amenidades" class="tab-content space-y-3">
            ${itemsAmenidades.map(item => `
                <div class="grid grid-cols-3 items-center gap-2">
                    <label for="item-amenidad-${item.id}" class="col-span-2 text-gray-700 font-medium">${item.nombre_item}</label>
                    <input type="number" id="item-amenidad-${item.id}" name="amenidad_${item.id}" 
                           data-nombre="${item.nombre_item}" 
                           class="form-control text-center" 
                           min="0" value="${item.cantidad_default || 0}" placeholder="Cant.">
                </div>
            `).join('')}
        </div>
    ` : `<div id="tab-amenidades" class="tab-content"><p class="text-gray-500 italic p-4 text-center">No hay amenidades configuradas.<br>(Admin: Ir a 'Inventario Amenidades')</p></div>`;

    const lenceriaHtml = itemsLenceria.length > 0 ? `
        <div id="tab-lenceria" class="tab-content space-y-3" style="display:none;">
            <p class="text-xs text-gray-500 mb-2">Indique la cantidad de cada artículo que está reponiendo <strong>en esta limpieza</strong>.</p>
            ${itemsLenceria.map(item => `
                <div class="grid grid-cols-3 items-center gap-2">
                    <label for="item-lenceria-${item.id}" class="col-span-2 text-gray-700 font-medium">${item.nombre_item}</label>
                    <input type="number" id="item-lenceria-${item.id}" name="lenceria_${item.id}" 
                           data-nombre="${item.nombre_item}" 
                           class="form-control text-center" 
                           min="0" value="0" placeholder="Cant.">
                </div>
            `).join('')}
        </div>
    ` : `<div id="tab-lenceria" class="tab-content" style="display:none;"><p class="text-gray-500 italic p-4 text-center">No hay artículos de lencería creados.<br>(Admin: Ir a 'Gestión Lavandería')</p></div>`;

    modalEl.innerHTML = `
        <form id="form-inventario-limpieza" class="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 m-auto relative animate-fadeIn">
            <h3 class="text-xl font-bold text-teal-700 mb-1">Registrar Inventario Usado</h3>
            <p class="text-gray-600 mb-4">Habitación: <strong>${roomNombre}</strong></p>
            
            <div class="flex border-b mb-4">
                <button type="button" id="btn-tab-amenidades" class="tab-btn active py-2 px-4 font-semibold text-blue-600 border-b-2 border-blue-600">Amenidades</button>
                <button type="button" id="btn-tab-lenceria" class="tab-btn py-2 px-4 font-semibold text-gray-500">Ropa de Cama</button>
            </div>

            <div id="tab-content-container" class="max-h-[50vh] overflow-y-auto pr-2">
                ${amenidadesHtml}
                ${lenceriaHtml}
            </div>
            
            <div id="inventario-feedback" class="feedback-message mt-3"></div>

            <div class="flex gap-3 mt-6">
                <button type="button" id="btn-cancelar-inventario" class="button button-neutral flex-1">Cancelar</button>
                <button type="submit" class="button button-success flex-1 bg-green-600 hover:bg-green-700">Confirmar Limpieza</button>
            </div>
        </form>
    `;
    document.body.appendChild(modalEl);

    const tabAmenidades = modalEl.querySelector('#tab-amenidades');
    const tabLenceria = modalEl.querySelector('#tab-lenceria');
    const btnAmenidades = modalEl.querySelector('#btn-tab-amenidades');
    const btnLenceria = modalEl.querySelector('#btn-tab-lenceria');
    btnAmenidades.onclick = () => {
        tabAmenidades.style.display = 'block'; tabLenceria.style.display = 'none';
        btnAmenidades.classList.add('active', 'text-blue-600', 'border-blue-600');
        btnAmenidades.classList.remove('text-gray-500');
        btnLenceria.classList.remove('active', 'text-blue-600', 'border-blue-600');
        btnLenceria.classList.add('text-gray-500');
    };
    btnLenceria.onclick = () => {
        tabLenceria.style.display = 'block'; tabAmenidades.style.display = 'none';
        btnLenceria.classList.add('active', 'text-blue-600', 'border-blue-600');
        btnLenceria.classList.remove('text-gray-500');
        btnAmenidades.classList.remove('active', 'text-blue-600', 'border-blue-600');
        btnAmenidades.classList.add('text-gray-500');
    };
    if (itemsAmenidades.length === 0 && itemsLenceria.length > 0) {
        btnLenceria.click();
    }

    const formEl = modalEl.querySelector('#form-inventario-limpieza');
    const feedbackInventarioEl = modalEl.querySelector('#inventario-feedback');

    const closeModal = () => {
        if (document.body.contains(modalEl)) {
            document.body.removeChild(modalEl);
        }
        buttonEl.disabled = false;
    };
    modalEl.querySelector('#btn-cancelar-inventario').onclick = closeModal;

    formEl.onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(formEl);
        const amenidadesUsadas = [];
        const lenceriaUsada = [];
        let totalLenceria = 0; 
        for (const [key, cantidadStr] of formData.entries()) {
            const cantidad = parseInt(cantidadStr, 10);
            if (cantidad > 0) {
                if (key.startsWith('amenidad_')) {
                    amenidadesUsadas.push({ item_id: key.replace('amenidad_', ''), cantidad_usada: cantidad });
                } else if (key.startsWith('lenceria_')) {
                    lenceriaUsada.push({ item_id: key.replace('lenceria_', ''), cantidad_usada: cantidad });
                    totalLenceria += cantidad; 
                }
            }
        }
        const submitBtn = formEl.querySelector('button[type="submit"]');
        if (itemsLenceria.length > 0 && totalLenceria === 0) {
            showError(feedbackInventarioEl, "Validación: Debes registrar al menos un artículo de Ropa de Cama (Sábana, Funda, etc.) para confirmar la limpieza.");
            btnLenceria.click();
            return; 
        }
        submitBtn.disabled = true;
        submitBtn.textContent = "Guardando...";
        try {
            const promises = [];
            if (amenidadesUsadas.length > 0) promises.push(guardarLogAmenidades(roomId, amenidadesUsadas));
            if (lenceriaUsada.length > 0) promises.push(guardarLogLenceria(roomId, lenceriaUsada));
            await Promise.all(promises);
            if (document.body.contains(modalEl)) document.body.removeChild(modalEl);
            await confirmCleaningById(roomId, roomNombre, feedbackEl, listEl);
        } catch (err) {
            showError(feedbackInventarioEl, `Error: ${err.message}`);
            submitBtn.disabled = false;
            submitBtn.textContent = "Confirmar Limpieza";
        }
    };
}
async function guardarLogAmenidades(roomId, itemsUsados) {
    const logData = itemsUsados.map(item => ({
        hotel_id: currentHotelId,
        habitacion_id: roomId,
        item_id: item.item_id,
        cantidad_usada: item.cantidad_usada,
        usuario_id: user.id
    }));
    const { error: logError } = await supabase.from('log_amenidades_uso').insert(logData);
    if (logError) throw new Error(`Error en log de amenidades: ${logError.message}`);
    const stockPromises = itemsUsados.map(item => 
        supabase.rpc('restar_stock_amenidad', {
            item_id_param: item.item_id,
            cantidad_param: item.cantidad_usada
        })
    );
    await Promise.all(stockPromises);
}
async function guardarLogLenceria(roomId, itemsUsados) {
    const logData = itemsUsados.map(item => ({
        hotel_id: currentHotelId,
        habitacion_id: roomId,
        item_lenceria_id: item.item_id,
        cantidad_usada: item.cantidad_usada,
        usuario_id: user.id,
        estado_ciclo: 'enviado_a_lavanderia'
    }));
    const { error: logError } = await supabase.from('log_lenceria_uso').insert(logData);
    if (logError) throw new Error(`Error en log de lencería: ${logError.message}`);
    const stockPromises = itemsUsados.map(item => 
        supabase.rpc('mover_lenceria_a_lavanderia', {
            item_id_param: item.item_id,
            cantidad_param: item.cantidad_usada
        })
    );
    await Promise.all(stockPromises);
}

async function showModalGestionLavanderia() {
    const hotelId = currentHotelId; 
    const isAdmin = ['admin', 'administrador'].includes(currentUserRole?.toLowerCase());

    if (!hotelId) return alert("Error crítico: Hotel ID no encontrado.");

    const modalEl = document.createElement('div');
    modalEl.id = 'gestion-lavanderia-modal';
    modalEl.className = "fixed inset-0 z-[100] flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 pt-8 overflow-y-auto";
    modalEl.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-6xl p-6 m-auto relative animate-fadeIn"> 
            <div class="flex justify-between items-center mb-4 pb-3 border-b">
                <h3 class="text-xl font-bold text-blue-700">🧺 Gestión de Lavandería y Lencería</h3>
                <button id="btn-close-gestion-modal" class="text-gray-500 hover:text-red-600 text-3xl leading-none">&times;</button>
            </div>
            <div id="gestion-lenceria-feedback" class="feedback-message mb-3"></div>
            
            <div class="mb-6">
                <h4 class="font-semibold text-lg text-gray-800 mb-2">Estado del Inventario</h4>
                <div id="stock-lenceria-container" class="max-h-[30vh] overflow-y-auto pr-2 border rounded p-3 bg-gray-50">
                    <p class="text-center text-gray-500">Cargando stock...</p>
                </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <form id="form-crear-lenceria" class="p-4 border rounded shadow-sm bg-green-50 relative">
                    ${!isAdmin ? '<div class="absolute inset-0 bg-gray-100/50 flex items-center justify-center text-gray-500 font-bold z-10">Solo Admin</div>' : ''}
                    <h4 class="font-semibold text-lg text-green-800 mb-3">✨ Crear Lencería</h4>
                    <div class="mb-3"><label>Nombre:</label><input type="text" name="nombre_item" class="form-control" required></div>
                    <div class="mb-3"><label>Stock Total:</label><input type="number" name="stock_total" class="form-control" required></div>
                    <div class="mb-3"><label>Mínimo:</label><input type="number" name="stock_minimo" class="form-control" required></div>
                    <button type="submit" class="button button-success w-full" ${!isAdmin ? 'disabled' : ''}>Crear</button>
                </form>
                <form id="form-recibir-lavanderia" class="p-4 border rounded shadow-sm bg-blue-50">
                    <h4 class="font-semibold text-lg text-blue-800 mb-3">✅ Recibir Limpio</h4>
                    <div class="mb-3"><label>Item:</label><select id="select-item-recibir" name="item_id" class="form-control" required></select></div>
                    <div class="mb-3"><label>Cantidad:</label><input type="number" name="cantidad" class="form-control" required></div>
                    <button type="submit" class="button button-info w-full">Confirmar</button>
                </form>
                <form id="form-reportar-perdida" class="p-4 border rounded shadow-sm bg-red-50">
                    <h4 class="font-semibold text-lg text-red-800 mb-3">🚨 Reportar Pérdida</h4>
                    <div class="mb-3"><label>Item:</label><select id="select-item-perdida" name="item_id" class="form-control" required></select></div>
                    <div class="mb-3"><label>Cantidad:</label><input type="number" name="cantidad" class="form-control" required></div>
                    <div class="mb-3"><label>Motivo:</label><input type="text" name="motivo" class="form-control"></div>
                    <button type="submit" class="button button-danger w-full">Reportar</button>
                </form>
            </div>
        </div>`;
    
    document.body.appendChild(modalEl);
    const closeModal = () => modalEl.remove();
    modalEl.querySelector('#btn-close-gestion-modal').onclick = closeModal;
    
    const stockContainerEl = modalEl.querySelector('#stock-lenceria-container');
    const feedbackEl = modalEl.querySelector('#gestion-lenceria-feedback');
    // Selectores y forms
    const selectRecibir = modalEl.querySelector('#select-item-recibir');
    const selectPerdida = modalEl.querySelector('#select-item-perdida');
    const formCrear = modalEl.querySelector('#form-crear-lenceria');
    const formRecibir = modalEl.querySelector('#form-recibir-lavanderia');
    const formPerdida = modalEl.querySelector('#form-reportar-perdida');

    let itemsActuales = [];

    async function cargarStock() {
        stockContainerEl.innerHTML = 'Cargando...';
        const { data: items, error } = await supabase.from('inventario_lenceria').select('*').eq('hotel_id', hotelId).order('nombre_item');
        if(error) { stockContainerEl.innerHTML = 'Error'; return; }
        itemsActuales = items;

        stockContainerEl.innerHTML = `
            <table class="w-full text-sm">
                <thead class="bg-gray-100"><tr><th>Artículo</th><th>Limpio</th><th>Lavandería</th><th>Total</th>${isAdmin?'<th>Acción</th>':''}</tr></thead>
                <tbody class="divide-y">
                    ${items.map(i => `
                        <tr>
                            <td class="p-2">${i.nombre_item}</td>
                            <td class="p-2 text-center font-bold ${i.stock_limpio_almacen<=i.stock_minimo_alerta?'text-red-500':'text-green-600'}">${i.stock_limpio_almacen}</td>
                            <td class="p-2 text-center text-yellow-600 font-bold">${i.stock_en_lavanderia}</td>
                            <td class="p-2 text-center">${i.stock_total}</td>
                            ${isAdmin ? `<td class="p-2 text-center"><button class="btn-delete-lenceria text-red-500 hover:text-red-700" data-id="${i.id}" data-nombre="${i.nombre_item}">🗑️</button></td>` : ''}
                        </tr>`).join('')}
                </tbody>
            </table>`;

        // Listener Eliminar
        if(isAdmin) {
            stockContainerEl.querySelectorAll('.btn-delete-lenceria').forEach(btn => {
                btn.onclick = async () => {
                    const nombre = btn.dataset.nombre;
                    const id = btn.dataset.id;
                    // USANDO LA NUEVA ALERTA
                    const ok = await mostrarConfirmacion('¿Eliminar Lencería?', `Vas a borrar <b>"${nombre}"</b> del sistema.`);
                    if(ok) {
                        const { error } = await supabase.from('inventario_lenceria').delete().eq('id', id);
                        if(error) showError(feedbackEl, error.message);
                        else { showSuccess(feedbackEl, "Eliminado."); await cargarStock(); }
                    }
                };
            });
        }
        // Llenar selects
        const enLavanderia = items.filter(i=>i.stock_en_lavanderia>0);
        const enAlmacen = items.filter(i=>i.stock_limpio_almacen>0);
        selectRecibir.innerHTML = '<option value="">Seleccione</option>' + enLavanderia.map(i=>`<option value="${i.id}">${i.nombre_item} (${i.stock_en_lavanderia})</option>`).join('');
        selectPerdida.innerHTML = '<option value="">Seleccione</option>' + enAlmacen.map(i=>`<option value="${i.id}">${i.nombre_item} (${i.stock_limpio_almacen})</option>`).join('');
    }

    // Eventos Forms (simplificados)
    formCrear.onsubmit = async (e) => {
        e.preventDefault(); 
        const f = new FormData(formCrear);
        await supabase.from('inventario_lenceria').insert({ hotel_id: hotelId, nombre_item: f.get('nombre_item'), stock_total: f.get('stock_total'), stock_limpio_almacen: f.get('stock_total'), stock_minimo_alerta: f.get('stock_minimo') });
        showSuccess(feedbackEl, "Creado."); formCrear.reset(); await cargarStock();
    };
    formRecibir.onsubmit = async (e) => {
        e.preventDefault(); const f = new FormData(formRecibir);
        await supabase.rpc('recibir_lote_de_lavanderia', { item_id_param: f.get('item_id'), cantidad_param: f.get('cantidad') });
        showSuccess(feedbackEl, "Recibido."); formRecibir.reset(); await cargarStock();
    };
    formPerdida.onsubmit = async (e) => {
        e.preventDefault(); const f = new FormData(formPerdida);
        await supabase.rpc('reportar_perdida_lenceria', { item_id_param: f.get('item_id'), cantidad_param: f.get('cantidad') });
        await supabase.from('log_lenceria_uso').insert({ hotel_id: hotelId, item_lenceria_id: f.get('item_id'), cantidad_usada: f.get('cantidad'), usuario_id: user.id, estado_ciclo: 'reportado_perdido', notas: f.get('motivo') });
        showSuccess(feedbackEl, "Reportado."); formPerdida.reset(); await cargarStock();
    };

    await cargarStock();
}

async function showModalGestionInventario() {
    const hotelId = currentHotelId;
    const isAdmin = ['admin', 'administrador'].includes(currentUserRole?.toLowerCase());

    if (!hotelId) return alert("Error crítico: No se pudo identificar el ID del hotel.");

    const modalEl = document.createElement('div');
    modalEl.id = 'gestion-inventario-modal';
    modalEl.className = "fixed inset-0 z-[100] flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 pt-8 overflow-y-auto";
    
    modalEl.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-5xl p-6 m-auto relative animate-fadeIn">
            <div class="flex justify-between items-center mb-4 pb-3 border-b">
                <h3 class="text-xl font-bold text-teal-700">📦 Gestión de Inventario de Amenidades</h3>
                <button id="btn-close-gestion-modal" class="text-gray-500 hover:text-red-600 text-3xl leading-none">&times;</button>
            </div>
            
            <div id="gestion-inventario-feedback" class="feedback-message mb-3"></div>

            <div class="mb-6">
                <h4 class="font-semibold text-lg text-gray-800 mb-2">Stock Actual</h4>
                <div id="stock-actual-container" class="max-h-[35vh] overflow-y-auto pr-2 border rounded p-3 bg-gray-50">
                    <p class="text-center text-gray-500">Cargando stock...</p>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <form id="form-add-stock" class="p-4 border rounded shadow-sm bg-blue-50">
                    <h4 class="font-semibold text-lg text-blue-800 mb-3">⚖️ Ajuste de Stock (Admin)</h4>
                    <div class="mb-3">
                        <label class="form-label">Artículo:</label>
                        <select id="select-item-stock" name="item_id" class="form-control" required><option value="">-- Cargando --</option></select>
                    </div>
                    <div class="mb-3">
                        <label class="form-label">Cantidad a Ajustar:</label>
                        <div class="text-xs text-gray-500 mb-1">Positivo para añadir, Negativo para quitar.</div>
                        <input type="number" id="input-cantidad-stock" name="cantidad" class="form-control" required placeholder="Ej: 50 o -10">
                    </div>
                    <div class="mb-3">
                         <label class="form-label">Motivo:</label>
                         <input type="text" id="input-motivo-ajuste" name="motivo" class="form-control" placeholder="Ej: Compra mensual..." required>
                    </div>
                    <button type="submit" class="button button-accent w-full" ${!isAdmin ? 'disabled' : ''}>
                        ${isAdmin ? 'Registrar Movimiento' : 'Solo Administradores'}
                    </button>
                </form>

                <form id="form-create-item" class="p-4 border rounded shadow-sm">
                    <h4 class="font-semibold text-lg text-gray-800 mb-3">✨ Crear Nueva Amenidad</h4>
                    <div class="mb-3">
                        <label class="form-label">Nombre del Artículo:</label>
                        <input type="text" id="input-nombre-item" name="nombre_item" class="form-control" required placeholder="Ej: Acondicionador">
                    </div>
                    <div class="mb-3">
                        <label class="form-label">Stock Inicial:</label>
                        <input type="number" id="input-stock-inicial" name="stock_inicial" class="form-control" min="0" value="0" required>
                    </div>
                    <button type="submit" class="button button-info w-full" ${!isAdmin ? 'disabled' : ''}>Crear Artículo</button>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(modalEl);

    const closeModal = () => modalEl.remove();
    modalEl.querySelector('#btn-close-gestion-modal').onclick = closeModal;

    const stockContainerEl = modalEl.querySelector('#stock-actual-container');
    const selectStockEl = modalEl.querySelector('#select-item-stock');
    const feedbackEl = modalEl.querySelector('#gestion-inventario-feedback');
    const formAddStockEl = modalEl.querySelector('#form-add-stock');
    const formCreateItemEl = modalEl.querySelector('#form-create-item');

    async function cargarStock() {
        stockContainerEl.innerHTML = `<p class="text-center text-gray-500">Cargando stock...</p>`;
        selectStockEl.innerHTML = `<option value="">-- Cargando artículos --</option>`;
        
        const { data: items, error } = await supabase
            .from('amenidades_inventario')
            .select('id, nombre_item, stock_actual, cantidad_default, stock_minimo_alerta')
            .eq('hotel_id', hotelId)
            .order('nombre_item');

        if (error) {
            stockContainerEl.innerHTML = `<p class="text-center text-red-500">Error: ${error.message}</p>`;
            return;
        }

        if (items.length === 0) {
            stockContainerEl.innerHTML = `<p class="text-center text-gray-500 italic">No hay artículos.</p>`;
            selectStockEl.innerHTML = `<option value="">-- No hay artículos --</option>`;
            return;
        }

        stockContainerEl.innerHTML = `
            <table class="w-full text-sm">
                <thead class="bg-gray-100"><tr class="text-left text-gray-600">
                    <th class="py-2 px-2">Artículo</th>
                    <th class="py-2 px-2 text-center">Stock</th>
                    <th class="py-2 px-2 text-center">Uso Default</th>
                    <th class="py-2 px-2 text-center">Mínimo</th>
                    ${isAdmin ? '<th class="py-2 px-2 text-center">Acciones</th>' : ''}
                </tr></thead>
                <tbody id="stock-list-body">
                    ${items.map(item => `
                        <tr class="border-b last:border-b-0">
                            <td class="py-1.5 px-2 font-medium">${item.nombre_item}</td>
                            <td class="py-1.5 px-2 text-center font-bold text-lg ${item.stock_actual <= item.stock_minimo_alerta ? 'text-red-500' : 'text-green-600'}">${item.stock_actual}</td>
                            <td class="py-1.5 px-2 text-center"><input type="number" class="form-control text-center w-20 default-qty-input" data-item-id="${item.id}" value="${item.cantidad_default || 0}" min="0"></td>
                            <td class="py-1.5 px-2 text-center"><input type="number" class="form-control text-center w-20 min-stock-input" data-item-id="${item.id}" value="${item.stock_minimo_alerta || 0}" min="0"></td>
                            ${isAdmin ? `
                            <td class="py-1.5 px-2 text-center">
                                <button class="btn-delete-amenidad text-red-500 hover:text-red-700 transition-colors p-1" data-id="${item.id}" data-nombre="${item.nombre_item}" title="Eliminar">
                                    🗑️
                                </button>
                            </td>` : ''}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <button id="btn-save-item-settings" class="button button-info w-full mt-3">Guardar Cambios (Default y Mínimos)</button>
        `;

        selectStockEl.innerHTML = '<option value="">-- Seleccione un artículo --</option>' + items.map(item => `<option value="${item.id}">${item.nombre_item}</option>`).join('');
    }

    // Listeners de formularios (Crear y Ajustar)
    formCreateItemEl.onsubmit = async (e) => {
        e.preventDefault();
        if (!isAdmin) return showError(feedbackEl, "No tienes permisos.");
        const formData = new FormData(formCreateItemEl);
        const nombre = formData.get('nombre_item').trim();
        const stock = parseInt(formData.get('stock_inicial'), 10);
        if (!nombre) return showError(feedbackEl, "Nombre requerido.");

        const { error } = await supabase.from('amenidades_inventario').insert({ hotel_id: hotelId, nombre_item: nombre, stock_actual: stock });
        if (error) showError(feedbackEl, error.message);
        else { showSuccess(feedbackEl, "Creado correctamente."); formCreateItemEl.reset(); await cargarStock(); }
    };

    formAddStockEl.onsubmit = async (e) => {
        e.preventDefault();
        if (!isAdmin) return showError(feedbackEl, "No tienes permisos.");
        const formData = new FormData(formAddStockEl);
        const itemId = formData.get('item_id');
        const cantidad = parseInt(formData.get('cantidad'), 10);
        if (!itemId || !cantidad) return showError(feedbackEl, "Datos inválidos.");

        const { data: itemData } = await supabase.from('amenidades_inventario').select('stock_actual').eq('id', itemId).single();
        const nuevoStock = itemData.stock_actual + cantidad;
        if (nuevoStock < 0) return showError(feedbackEl, "El stock no puede ser negativo.");

        await supabase.from('amenidades_inventario').update({ stock_actual: nuevoStock }).eq('id', itemId);
        await supabase.from('log_amenidades_uso').insert({ hotel_id: hotelId, item_id: itemId, cantidad_usada: cantidad * -1, usuario_id: user.id });
        
        showSuccess(feedbackEl, "Stock ajustado.");
        formAddStockEl.reset();
        await cargarStock();
    };

    // Listener de Tabla (Eliminar y Guardar)
    stockContainerEl.addEventListener('click', async (e) => {
        if (e.target.id === 'btn-save-item-settings') {
            const btn = e.target; btn.textContent = "Guardando...";
            const updates = [];
            modalEl.querySelectorAll('#stock-list-body tr').forEach(row => {
                const def = row.querySelector('.default-qty-input'), min = row.querySelector('.min-stock-input');
                if(def && min) updates.push({ item_id: def.dataset.itemId, default_qty: parseInt(def.value)||0, min_alert_qty: parseInt(min.value)||0 });
            });
            await supabase.rpc('actualizar_amenidades_settings', { updates });
            showSuccess(feedbackEl, 'Configuración guardada.');
            await cargarStock();
        }

        const btnDelete = e.target.closest('.btn-delete-amenidad');
        if (btnDelete) {
            if (!isAdmin) return;
            const id = btnDelete.dataset.id;
            const nombre = btnDelete.dataset.nombre;
            
            // USANDO LA NUEVA ALERTA
            const confirmado = await mostrarConfirmacion('¿Eliminar Amenidad?', `Se eliminará <b>"${nombre}"</b> permanentemente.`);
            
            if (confirmado) {
                const { error } = await supabase.from('amenidades_inventario').delete().eq('id', id);
                if (error) showError(feedbackEl, `Error: ${error.message}`);
                else { showSuccess(feedbackEl, "Eliminado."); await cargarStock(); }
            }
        }
    });

    await cargarStock();
}

async function showModalReporteConsumo() {
    const modalEl = document.createElement('div');
    modalEl.id = 'reporte-consumo-modal';
    modalEl.className = "fixed inset-0 z-[100] flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 pt-8 overflow-y-auto";
    const hoy = new Date(), hace30Dias = new Date(new Date().setDate(hoy.getDate() - 30));
    const fechaFinDefault = hoy.toISOString().split('T')[0], fechaInicioDefault = hace30Dias.toISOString().split('T')[0];
    modalEl.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl p-6 m-auto relative animate-fadeIn">
            <div class="flex justify-between items-center mb-4 pb-3 border-b">
                <h3 class="text-xl font-bold text-cyan-700">📈 Reporte de Consumo de Amenidades</h3>
                <button id="btn-close-reporte-modal" class="text-gray-500 hover:text-red-600 text-3xl leading-none">&times;</button>
            </div>
            <div class="flex flex-col md:flex-row gap-4 items-center mb-4 p-3 bg-gray-50 rounded-lg">
                <label for="reporte-fecha-inicio" class="font-semibold">Desde:</label>
                <input type="date" id="reporte-fecha-inicio" class="form-control" value="${fechaInicioDefault}">
                <label for="reporte-fecha-fin" class="font-semibold">Hasta:</label>
                <input type="date" id="reporte-fecha-fin" class="form-control" value="${fechaFinDefault}">
                <button id="btn-generar-reporte" class="button button-info w-full md:w-auto">Generar Reporte</button>
            </div>
            <div id="reporte-consumo-feedback" class="feedback-message mb-3"></div>
            <div id="reporte-consumo-content" class="max-h-[60vh] overflow-y-auto pr-2">
                <p class="text-center text-gray-500 py-8">Configure el rango de fechas y presione "Generar Reporte".</p>
            </div>
        </div>
    `;
    document.body.appendChild(modalEl);
    const closeModal = () => modalEl.remove();
    modalEl.querySelector('#btn-close-reporte-modal').onclick = closeModal;
    const btnGenerar = modalEl.querySelector('#btn-generar-reporte');
    const contentEl = modalEl.querySelector('#reporte-consumo-content');
    const feedbackEl = modalEl.querySelector('#reporte-consumo-feedback');
    btnGenerar.onclick = async () => {
        const fechaInicio = modalEl.querySelector('#reporte-fecha-inicio').value;
        const fechaFin = modalEl.querySelector('#reporte-fecha-fin').value;
        if (!fechaInicio || !fechaFin) {
            showError(feedbackEl, "Debe seleccionar una fecha de inicio y fin."); return;
        }
        const fechaFinAjustada = `${fechaFin}T23:59:59`;
        btnGenerar.disabled = true; btnGenerar.textContent = "Cargando...";
        contentEl.innerHTML = `<p class="text-center text-gray-500 py-8">Cargando datos del reporte...</p>`;
        clearAppFeedback(feedbackEl);
        try {
            const { data: logs, error } = await supabase
                .from('log_amenidades_uso')
                .select(`cantidad_usada, fecha_uso, amenidades_inventario ( nombre_item ), usuarios ( nombre )`)
                .eq('hotel_id', currentHotelId)
                .gte('fecha_uso', fechaInicio)
                .lte('fecha_uso', fechaFinAjustada);
            if (error) throw error;
            if (logs.length === 0) {
                contentEl.innerHTML = `<p class="text-center text-gray-500 py-8">No se encontraron consumos en ese rango de fechas.</p>`;
                btnGenerar.disabled = false; btnGenerar.textContent = "Generar Reporte";
                return;
            }
            const consumoPorItem = {}, consumoPorUsuario = {};
            logs.forEach(log => {
                const itemName = log.amenidades_inventario?.nombre_item || 'Desconocido';
                const userName = log.usuarios?.nombre || 'Desconocido';
                const cantidad = log.cantidad_usada;
                consumoPorItem[itemName] = (consumoPorItem[itemName] || 0) + cantidad;
                consumoPorUsuario[userName] = (consumoPorUsuario[userName] || 0) + cantidad;
            });
            const itemsOrdenados = Object.entries(consumoPorItem).sort(([,a],[,b]) => b - a);
            const usuariosOrdenados = Object.entries(consumoPorUsuario).sort(([,a],[,b]) => b - a);
            contentEl.innerHTML = `
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <h4 class="font-semibold text-lg text-gray-800 mb-2">Total Consumido por Artículo</h4>
                        <table class="w-full text-sm">
                            <thead class="bg-gray-100"><tr class="text-left text-gray-600"><th class="py-2 px-2">Artículo</th><th class="py-2 px-2 text-right">Cantidad Total</th></tr></thead>
                            <tbody class="divide-y">
                                ${itemsOrdenados.map(([nombre, cant]) => `<tr><td class="py-1.5 px-2 font-medium">${nombre}</td><td class="py-1.5 px-2 text-right font-bold">${cant}</td></tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div>
                        <h4 class="font-semibold text-lg text-gray-800 mb-2">Total Registrado por Empleado</h4>
                        <table class="w-full text-sm">
                            <thead class="bg-gray-100"><tr class="text-left text-gray-600"><th class="py-2 px-2">Empleado</th><th class="py-2 px-2 text-right">Total Items</th></tr></thead>
                            <tbody class="divide-y">
                                ${usuariosOrdenados.map(([nombre, cant]) => `<tr><td class="py-1.5 px-2 font-medium">${nombre}</td><td class="py-1.5 px-2 text-right font-bold">${cant}</td></tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } catch (err) {
            showError(feedbackEl, `Error al generar reporte: ${err.message}`);
            contentEl.innerHTML = `<p class="text-center text-red-500 py-8">Error al cargar datos.</p>`;
        } finally {
            btnGenerar.disabled = false; btnGenerar.textContent = "Generar Reporte";
        }
    };
}
async function showModalReporteLenceria() {
    const modalEl = document.createElement('div');
    modalEl.id = 'reporte-lenceria-modal';
    modalEl.className = "fixed inset-0 z-[100] flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 pt-8 overflow-y-auto";
    const hoy = new Date(), hace30Dias = new Date(new Date().setDate(hoy.getDate() - 30));
    const fechaFinDefault = hoy.toISOString().split('T')[0], fechaInicioDefault = hace30Dias.toISOString().split('T')[0];
    modalEl.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-5xl p-6 m-auto relative animate-fadeIn"> <div class="flex justify-between items-center mb-4 pb-3 border-b">
                <h3 class="text-xl font-bold text-blue-700">📊 Reporte de Ciclo de Lencería</h3>
                <button id="btn-close-reporte-modal" class="text-gray-500 hover:text-red-600 text-3xl leading-none">&times;</button>
            </div>
            <div class="flex flex-col md:flex-row gap-4 items-center mb-4 p-3 bg-gray-50 rounded-lg">
                <label for="reporte-fecha-inicio" class="font-semibold">Desde:</label>
                <input type="date" id="reporte-fecha-inicio" class="form-control" value="${fechaInicioDefault}">
                <label for="reporte-fecha-fin" class="font-semibold">Hasta:</label>
                <input type="date" id="reporte-fecha-fin" class="form-control" value="${fechaFinDefault}">
                <button id="btn-generar-reporte" class="button button-info w-full md:w-auto">Generar Reporte</button>
            </div>
            <div id="reporte-lenceria-feedback" class="feedback-message mb-3"></div>
            <div id="reporte-lenceria-content" class="max-h-[60vh] overflow-y-auto pr-2">
                <p class="text-center text-gray-500 py-8">Configure el rango de fechas y presione "Generar Reporte".</p>
            </div>
        </div>
    `;
    document.body.appendChild(modalEl);
    const closeModal = () => modalEl.remove();
    modalEl.querySelector('#btn-close-reporte-modal').onclick = closeModal;
    const btnGenerar = modalEl.querySelector('#btn-generar-reporte');
    const contentEl = modalEl.querySelector('#reporte-lenceria-content');
    const feedbackEl = modalEl.querySelector('#reporte-lenceria-feedback');
    btnGenerar.onclick = async () => {
        const fechaInicio = modalEl.querySelector('#reporte-fecha-inicio').value;
        const fechaFin = modalEl.querySelector('#reporte-fecha-fin').value;
        if (!fechaInicio || !fechaFin) {
            showError(feedbackEl, "Debe seleccionar una fecha de inicio y fin."); return;
        }
        const fechaFinAjustada = `${fechaFin}T23:59:59`;
        btnGenerar.disabled = true; btnGenerar.textContent = "Cargando...";
        contentEl.innerHTML = `<p class="text-center text-gray-500 py-8">Cargando datos del reporte...</p>`;
        clearAppFeedback(feedbackEl);
        try {
            const { data: logs, error } = await supabase
                .from('log_lenceria_uso')
                .select(`
                    cantidad_usada, fecha_uso, estado_ciclo, notas,
                    inventario_lenceria ( nombre_item ),
                    usuarios ( nombre ),
                    habitaciones ( nombre )
                `)
                .eq('hotel_id', currentHotelId)
                .gte('fecha_uso', fechaInicio)
                .lte('fecha_uso', fechaFinAjustada)
                .order('fecha_uso', { ascending: false }); 
            if (error) throw error;
            if (logs.length === 0) {
                contentEl.innerHTML = `<p class="text-center text-gray-500 py-8">No se encontraron movimientos de lencería en ese rango de fechas.</p>`;
                btnGenerar.disabled = false; btnGenerar.textContent = "Generar Reporte";
                return;
            }
            contentEl.innerHTML = `
                <table class="w-full text-sm text-left table-auto">
                    <thead class="bg-gray-100 text-gray-600 uppercase text-xs sticky top-0">
                        <tr>
                            <th class="p-2">Fecha/Hora</th>
                            <th class="p-2">Habitación</th>
                            <th class="p-2">Artículo</th>
                            <th class="p-2 text-center">Cantidad</th>
                            <th class="p-2">Estado</th>
                            <th class="p-2">Registrado Por</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200">
                        ${logs.map(log => {
                            const itemName = log.inventario_lenceria?.nombre_item || 'Desconocido';
                            const userName = log.usuarios?.nombre || 'Desconocido';
                            const roomName = log.habitaciones?.nombre || 'N/A (Pérdida)';
                            let estadoBadge = '';
                            if (log.estado_ciclo === 'enviado_a_lavanderia') {
                                estadoBadge = `<span class="badge bg-yellow-100 text-yellow-800">A Lavandería</span>`;
                            } else if (log.estado_ciclo === 'reportado_perdido') {
                                estadoBadge = `<span class="badge bg-red-100 text-red-800">Pérdida</span>`;
                            } else {
                                estadoBadge = `<span class="badge">${log.estado_ciclo}</span>`;
                            }
                            return `
                                <tr class="hover:bg-gray-50">
                                    <td class="p-2 whitespace-nowrap">${formatDateTime(log.fecha_uso)}</td>
                                    <td class="p-2">${roomName}</td>
                                    <td class="p-2 font-medium text-gray-800">${itemName}</td>
                                    <td class="p-2 text-center font-bold">${log.cantidad_usada}</td>
                                    <td class="p-2">${estadoBadge}</td>
                                    <td class="p-2">${userName}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
        } catch (err) {
            showError(feedbackEl, `Error al generar reporte: ${err.message}`);
            contentEl.innerHTML = `<p class="text-center text-red-500 py-8">Error al cargar datos.</p>`;
        } finally {
            btnGenerar.disabled = false; btnGenerar.textContent = "Generar Reporte";
        }
    };
    btnGenerar.click();
}
async function showModalReporteInventario() {
    const modalEl = document.createElement('div');
    modalEl.id = 'reporte-inventario-modal';
    modalEl.className = "fixed inset-0 z-[100] flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 pt-8 overflow-y-auto";
    modalEl.innerHTML = `<div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl p-6 m-auto relative animate-fadeIn"><p class="text-center text-gray-500 py-8">Cargando reporte de stock...</p></div>`;
    document.body.appendChild(modalEl);
    try {
        // --- MODIFICADO: Añadido inventario_prestables ---
        const [amenidadesRes, lenceriaRes, prestablesRes] = await Promise.all([
            supabase.from('amenidades_inventario').select('*').eq('hotel_id', currentHotelId).order('nombre_item'),
            supabase.from('inventario_lenceria').select('*').eq('hotel_id', currentHotelId).order('nombre_item'),
            supabase.from('inventario_prestables').select('*').eq('hotel_id', currentHotelId).order('nombre_item') // <-- NUEVO
        ]);

        if (amenidadesRes.error) throw amenidadesRes.error;
        if (lenceriaRes.error) throw lenceriaRes.error;
        if (prestablesRes.error) throw prestablesRes.error; // <-- NUEVO

        const amenidades = amenidadesRes.data || [];
        const lenceria = lenceriaRes.data || [];
        const prestables = prestablesRes.data || []; // <-- NUEVO

        const amenidadesHtml = amenidades.length > 0 ? `
            <table class="w-full text-sm">
                <thead class="bg-gray-100"><tr class="text-left text-gray-600">
                    <th class="py-2 px-2">Amenidad</th>
                    <th class="py-2 px-2 text-center">Stock Actual</th>
                    <th class="py-2 px-2 text-center">Alerta Mínima</th>
                </tr></thead>
                <tbody class="divide-y">
                    ${amenidades.map(item => `
                        <tr>
                            <td class="py-1.5 px-2 font-medium">${item.nombre_item}</td>
                            <td class="py-1.5 px-2 text-center font-bold text-lg ${item.stock_actual <= item.stock_minimo_alerta ? 'text-red-500' : 'text-gray-700'}">${item.stock_actual}</td>
                            <td class="py-1.5 px-2 text-center text-gray-500">${item.stock_minimo_alerta}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        ` : `<p class="text-gray-500 italic text-center p-3">No hay amenidades creadas.</p>`;
        
        const lenceriaHtml = lenceria.length > 0 ? `
            <table class="w-full text-sm">
                <thead class="bg-gray-100"><tr class="text-left text-gray-600">
                    <th class="py-2 px-2">Artículo Lencería</th>
                    <th class="py-2 px-2 text-center">Limpio (Almacén)</th>
                    <th class="py-2 px-2 text-center">En Lavandería</th>
                    <th class="py-2 px-2 text-center">Stock Total</th>
                </tr></thead>
                <tbody class="divide-y">
                    ${lenceria.map(item => `
                        <tr>
                            <td class="py-1.5 px-2 font-medium">${item.nombre_item}</td>
                            <td class="py-1.5 px-2 text-center font-bold text-lg ${item.stock_limpio_almacen <= item.stock_minimo_alerta ? 'text-red-500' : 'text-green-600'}" title="Mínimo: ${item.stock_minimo_alerta}">${item.stock_limpio_almacen}</td>
                            <td class="py-1.5 px-2 text-center text-yellow-600">${item.stock_en_lavanderia}</td>
                            <td class="py-1.5 px-2 text-center text-gray-700">${item.stock_total}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        ` : `<p class="text-gray-500 italic text-center p-3">No hay lencería creada.</p>`;

        // --- NUEVO: HTML para Artículos Prestables ---
        const prestablesHtml = prestables.length > 0 ? `
            <table class="w-full text-sm">
                <thead class="bg-gray-100"><tr class="text-left text-gray-600">
                    <th class="py-2 px-2">Artículo Prestable</th>
                    <th class="py-2 px-2 text-center">Disponible</th>
                    <th class="py-2 px-2 text-center">Prestado</th>
                    <th class="py-2 px-2 text-center">Stock Total</th>
                </tr></thead>
                <tbody class="divide-y">
                    ${prestables.map(item => {
                        const prestado = item.stock_total - item.stock_disponible;
                        return `
                        <tr>
                            <td class="py-1.5 px-2 font-medium">${item.nombre_item}</td>
                            <td class="py-1.5 px-2 text-center font-bold text-lg ${item.stock_disponible <= item.stock_minimo_alerta ? 'text-red-500' : 'text-green-600'}" title="Mínimo: ${item.stock_minimo_alerta}">${item.stock_disponible}</td>
                            <td class="py-1.5 px-2 text-center text-yellow-600">${prestado}</td>
                            <td class="py-1.5 px-2 text-center text-gray-700">${item.stock_total}</td>
                        </tr>
                    `}).join('')}
                </tbody>
            </table>
        ` : `<p class="text-gray-500 italic text-center p-3">No hay artículos prestables creados.</p>`;

        modalEl.innerHTML = `
            <div class="bg-white rounded-xl shadow-2xl w-full max-w-6xl p-6 m-auto relative animate-fadeIn"> <div class="flex justify-between items-center mb-4 pb-3 border-b">
                    <h3 class="text-xl font-bold text-gray-800">📊 Reporte de Estado de Inventario</h3>
                    <button id="btn-close-reporte-modal" class="text-gray-500 hover:text-red-600 text-3xl leading-none">&times;</button>
                </div>
                <div class="max-h-[70vh] overflow-y-auto pr-2 grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div>
                        <h4 class="font-semibold text-lg text-teal-700 mb-2">Amenidades (Consumibles)</h4>
                        ${amenidadesHtml}
                    </div>
                    <div>
                        <h4 class="font-semibold text-lg text-blue-700 mb-2">Lencería (Reutilizable)</h4>
                        ${lenceriaHtml}
                    </div>
                    <div>
                        <h4 class="font-semibold text-lg text-indigo-700 mb-2">Préstamos (Reutilizable)</h4>
                        ${prestablesHtml}
                    </div>
                </div>
            </div>
        `;
        modalEl.querySelector('#btn-close-reporte-modal').onclick = () => modalEl.remove();

    } catch (err) {
        modalEl.innerHTML = `<div class="bg-white rounded-xl p-6 m-auto"><p class="text-red-500">Error al cargar: ${err.message}</p></div>`;
    }
}
async function imprimirConteoFisico() {
    showGlobalLoading("Preparando hoja de conteo...");
    try {
        // --- MODIFICADO: Añadido inventario_prestables ---
        const [amenidadesRes, lenceriaRes, prestablesRes] = await Promise.all([
            supabase.from('amenidades_inventario').select('nombre_item, stock_actual').eq('hotel_id', currentHotelId).order('nombre_item'),
            supabase.from('inventario_lenceria').select('nombre_item, stock_limpio_almacen').eq('hotel_id', currentHotelId).order('nombre_item'),
            supabase.from('inventario_prestables').select('nombre_item, stock_disponible').eq('hotel_id', currentHotelId).order('nombre_item') // <-- NUEVO
        ]);
        hideGlobalLoading();

        if (amenidadesRes.error || lenceriaRes.error || prestablesRes.error) throw new Error(amenidadesRes.error?.message || lenceriaRes.error?.message || prestablesRes.error?.message);

        const amenidades = amenidadesRes.data || [];
        const lenceria = lenceriaRes.data || [];
        const prestables = prestablesRes.data || []; // <-- NUEVO

        const styles = `
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { text-align: center; font-size: 20px; border-bottom: 2px solid #000; padding-bottom: 10px; }
            h2 { font-size: 16px; margin-top: 30px; border-bottom: 1px solid #ccc; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th, td { border: 1px solid #999; padding: 8px; font-size: 12px; }
            th { background-color: #f0f0f0; text-align: left; }
            .stock-sistema { text-align: center; width: 100px; }
            .conteo-fisico { width: 100px; }
            @media print { body { margin: 10px; } h1 { font-size: 18px; } h2 { font-size: 14px; } th, td { font-size: 11px; padding: 5px; } }
        `;
        const renderTable = (title, items, stockField) => {
            let rows = items.map(item => `
                <tr>
                    <td>${item.nombre_item}</td>
                    <td class="stock-sistema">${item[stockField]}</td>
                    <td class="conteo-fisico"></td>
                </tr>
            `).join('');
            if (items.length === 0) rows = '<tr><td colspan="3" style="text-align:center;font-style:italic;">No hay artículos.</td></tr>';
            return `
                <h2>${title}</h2>
                <table>
                    <thead><tr><th>Artículo</th><th>Stock Sistema</th><th>Conteo Físico</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            `;
        };
        const htmlContent = `
            <html><head><title>Hoja de Conteo de Inventario</title><style>${styles}</style></head>
            <body>
                <h1>Hoja de Conteo de Inventario Físico</h1>
                <p><strong>Fecha:</strong> ${new Date().toLocaleDateString('es-CO')}&nbsp;&nbsp;&nbsp;&nbsp;<strong>Contado por:</strong> _________________________</p>
                ${renderTable('Amenidades (Consumibles)', amenidades, 'stock_actual')}
                ${renderTable('Lencería (Almacén Limpio)', lenceria, 'stock_limpio_almacen')}
                ${renderTable('Artículos Prestables (Almacén)', prestables, 'stock_disponible')} </body></html>
        `;

        const printWindow = window.open('', '_blank');
        printWindow.document.open();
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        setTimeout(() => printWindow.print(), 500);
    } catch (err) {
        hideGlobalLoading();
        alert(`Error al generar la hoja de conteo: ${err.message}`);
    }
}


// --- ¡NUEVA FUNCIÓN! ---
// Muestra un modal para GESTIONAR el inventario de ARTÍCULOS PRESTABLES (Solo Admin)
async function showModalGestionPrestables() {
    const hotelId = currentHotelId;
    const isAdmin = ['admin', 'administrador'].includes(currentUserRole?.toLowerCase());

    const modalEl = document.createElement('div');
    modalEl.id = 'gestion-prestables-modal';
    modalEl.className = "fixed inset-0 z-[100] flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 pt-8 overflow-y-auto";
    modalEl.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl p-6 m-auto relative animate-fadeIn">
            <div class="flex justify-between items-center mb-4 pb-3 border-b">
                <h3 class="text-xl font-bold text-indigo-700">📦 Inventario de Préstamos</h3>
                <button id="btn-close-gestion-modal" class="text-gray-500 hover:text-red-600 text-3xl leading-none">&times;</button>
            </div>
            <div id="gestion-prestables-feedback" class="feedback-message mb-3"></div>
            
            <div class="mb-6">
                <h4 class="font-semibold text-lg text-gray-800 mb-2">Stock Actual</h4>
                <div id="stock-prestables-container" class="max-h-[30vh] overflow-y-auto pr-2 border rounded p-3 bg-gray-50">
                    <p class="text-center text-gray-500">Cargando stock...</p>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <form id="form-add-stock-prestable" class="p-4 border rounded shadow-sm bg-indigo-50">
                    <h4 class="font-semibold text-lg text-indigo-800 mb-3">🛠️ Ajustar Stock</h4>
                    <div class="mb-3"><label>Item:</label><select id="select-item-stock-prestable" name="item_id" class="form-control" required></select></div>
                    <div class="mb-3"><label>Cantidad:</label><input type="number" name="cantidad" class="form-control" required placeholder="Positivo/Negativo"></div>
                    <button type="submit" class="button button-accent w-full" ${!isAdmin?'disabled':''}>Ajustar</button>
                </form>
                <form id="form-create-item-prestable" class="p-4 border rounded shadow-sm">
                    <h4 class="font-semibold text-lg text-gray-800 mb-3">✨ Crear Nuevo</h4>
                    <div class="mb-3"><label>Nombre:</label><input type="text" name="nombre_item" class="form-control" required></div>
                    <div class="grid grid-cols-2 gap-4">
                        <div><label>Inicial:</label><input type="number" name="stock_inicial" class="form-control" required></div>
                        <div><label>Mínimo:</label><input type="number" name="stock_minimo" class="form-control" required></div>
                    </div>
                    <button type="submit" class="button button-info w-full" ${!isAdmin?'disabled':''}>Crear</button>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(modalEl);
    const closeModal = () => modalEl.remove();
    modalEl.querySelector('#btn-close-gestion-modal').onclick = closeModal;

    const stockContainerEl = modalEl.querySelector('#stock-prestables-container');
    const feedbackEl = modalEl.querySelector('#gestion-prestables-feedback');
    const selectStock = modalEl.querySelector('#select-item-stock-prestable');
    const formAdd = modalEl.querySelector('#form-add-stock-prestable');
    const formCreate = modalEl.querySelector('#form-create-item-prestable');

    async function cargarStock() {
        stockContainerEl.innerHTML = 'Cargando...';
        const { data: items, error } = await supabase.from('inventario_prestables').select('*').eq('hotel_id', hotelId).order('nombre_item');
        if(error) { stockContainerEl.innerHTML = 'Error'; return; }

        stockContainerEl.innerHTML = `
            <table class="w-full text-sm">
                <thead class="bg-gray-100"><tr><th>Artículo</th><th>Disp.</th><th>Prest.</th><th>Total</th>${isAdmin?'<th>Acción</th>':''}</tr></thead>
                <tbody class="divide-y">
                    ${items.map(i => {
                        const prestado = i.stock_total - i.stock_disponible;
                        return `
                        <tr>
                            <td class="p-2 font-medium">${i.nombre_item}</td>
                            <td class="p-2 text-center font-bold ${i.stock_disponible<=i.stock_minimo_alerta?'text-red-500':'text-green-600'}">${i.stock_disponible}</td>
                            <td class="p-2 text-center text-yellow-600">${prestado}</td>
                            <td class="p-2 text-center text-gray-500">${i.stock_total}</td>
                            ${isAdmin ? `<td class="p-2 text-center"><button class="btn-delete-prestable text-red-500 hover:text-red-700" data-id="${i.id}" data-nombre="${i.nombre_item}">🗑️</button></td>` : ''}
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>`;
        
        if(isAdmin) {
            stockContainerEl.querySelectorAll('.btn-delete-prestable').forEach(btn => {
                btn.onclick = async () => {
                    const id = btn.dataset.id;
                    const nombre = btn.dataset.nombre;
                    // USANDO LA NUEVA ALERTA
                    const ok = await mostrarConfirmacion('¿Eliminar Artículo?', `Se borrará <b>"${nombre}"</b> del sistema.`);
                    if(ok) {
                        const { error } = await supabase.from('inventario_prestables').delete().eq('id', id);
                        if(error) showError(feedbackEl, error.message);
                        else { showSuccess(feedbackEl, "Eliminado."); await cargarStock(); }
                    }
                };
            });
        }
        selectStock.innerHTML = '<option value="">Seleccione</option>' + items.map(i => `<option value="${i.id}">${i.nombre_item}</option>`).join('');
    }

    formCreate.onsubmit = async (e) => {
        e.preventDefault(); const f = new FormData(formCreate);
        await supabase.from('inventario_prestables').insert({ hotel_id: hotelId, nombre_item: f.get('nombre_item'), stock_total: f.get('stock_inicial'), stock_disponible: f.get('stock_inicial'), stock_minimo_alerta: f.get('stock_minimo') });
        showSuccess(feedbackEl, "Creado."); formCreate.reset(); await cargarStock();
    };

    formAdd.onsubmit = async (e) => {
        e.preventDefault(); const f = new FormData(formAdd);
        await supabase.rpc('anadir_stock_prestable', { p_item_id: f.get('item_id'), p_cantidad: f.get('cantidad') });
        showSuccess(feedbackEl, "Ajustado."); formAdd.reset(); await cargarStock();
    };

    await cargarStock();
}


// --- MONTAR EL MÓDULO ---
export async function mount(container, supabaseInst, currentUser) {
  moduleListeners.forEach(({ el, evt, fn }) => el.removeEventListener(evt, fn));
  moduleListeners = [];

  supabase = supabaseInst;
  user = currentUser;

  currentHotelId = user.user_metadata?.hotel_id;
  currentUserRole = 'limpieza';
  
  if (!currentHotelId) {
    const { data: perfil, error } = await supabase
      .from('usuarios')
      .select('hotel_id, rol')
      .eq('id', user.id)
      .single();
    if (!error && perfil) {
        currentHotelId = perfil.hotel_id;
        currentUserRole = perfil.rol;
    }
  }
  
  console.log(`[Limpieza Module] Rol de usuario detectado: ${currentUserRole}`);

  if (!currentHotelId) {
    container.innerHTML = `<p class="p-4 bg-red-100 text-red-700 rounded">Error: Hotel no identificado.</p>`;
    return;
  }

  const isAdmin = ['admin', 'administrador'].includes(currentUserRole?.toLowerCase() || 'limpieza');

  container.innerHTML = `
  <div class="w-full px-2 py-8">
    <div class="bg-white rounded-2xl shadow-xl p-6 mb-4 flex flex-col md:flex-row items-center justify-between gap-4">
        
        <div class="flex-grow text-center md:text-left">
            <h2 class="text-2xl font-bold text-blue-900 flex items-center gap-2">🧽 Gestión de Limpieza e Inventario</h2>
            <div class="text-blue-600 mt-2 font-medium text-sm">Confirme la limpieza y reporte el uso de inventario.</div>
        </div>
        
        <div class="flex flex-col md:flex-row gap-3 items-center">
            
            <button id="btn-ver-historial-articulos" class="button button-info-light whitespace-nowrap">
                📜 Historial Préstamos
            </button>
            
            ${isAdmin ? `
                <div class="relative group">
                    <button id="btn-admin-acciones" class="button button-primary flex items-center gap-2">
                        <span>🛠️ Acciones de Admin</span>
                        <svg class="w-4 h-4 transition-transform group-hover:rotate-180" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.23 8.29a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
                        </svg>
                    </button>

                    <div class="absolute z-30 right-0 mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-xl p-2 hidden group-hover:block group-focus-within:block">
                        
                        <div class="px-2 py-1 text-xs font-semibold text-gray-500 uppercase">Gestión de Inventario</div>
                        <button id="btn-gestionar-inventario-amenidades" class="dropdown-item">
                            📦 Inventario Amenidades
                        </button>
                        <button id="btn-gestionar-lavanderia" class="dropdown-item">
                            🧺 Gestión Lavandería
                        </button>
                        <button id="btn-gestionar-inventario-prestables" class="dropdown-item">
                            🔌 Inventario Préstamos
                        </button>

                        <div class="border-t border-gray-100 my-2"></div>

                        <div class="px-2 py-1 text-xs font-semibold text-gray-500 uppercase">Reportes y Utilidades</div>
                        <button id="btn-ver-reporte-consumo" class="dropdown-item">
                            📈 Reporte Consumo
                        </button>
                        <button id="btn-ver-reporte-lenceria" class="dropdown-item">
                            📊 Reporte Lencería
                        </button>
                        <button id="btn-ver-reporte-inventario" class="dropdown-item">
                            📋 Reporte Stock
                        </button>
                        <button id="btn-imprimir-conteo" class="dropdown-item">
                            🖨️ Imprimir Conteo
                        </button>
                    </div>
                </div>
            ` : ''}
        </div>
    </div>
    
    <h3 class="font-semibold text-lg mb-3 text-blue-700">Habitaciones pendientes</h3>
    <div id="pendientes-feedback" class="mb-3"></div>
    <div id="pendientes-list"></div>
  </div>
`;
  
  const styleEl = document.createElement('style');
  styleEl.innerHTML = `
    .button-info-light { background-color: #e0f2fe; color: #0284c7; font-weight: 600; padding: 0.5rem 1rem; border-radius: 0.5rem; transition: all 0.2s; }
    .button-info-light:hover { background-color: #bae6fd; }
    .button-warning-light { background-color: #fffbeb; color: #d97706; font-weight: 600; padding: 0.5rem 1rem; border-radius: 0.5rem; transition: all 0.2s; }
    .button-warning-light:hover { background-color: #fef3c7; }
    .button-success-light { background-color: #f0fdf4; color: #16a34a; font-weight: 600; padding: 0.5rem 1rem; border-radius: 0.5rem; transition: all 0.2s; }
    .button-success-light:hover { background-color: #dcfce7; }
    .button-accent-light { background-color: #eef2ff; color: #4f46e5; font-weight: 600; padding: 0.5rem 1rem; border-radius: 0.5rem; transition: all 0.2s; }
    .button-accent-light:hover { background-color: #e0e7ff; }
  `;
  document.head.appendChild(styleEl);

  const pendientesListEl   = container.querySelector('#pendientes-list');
  const pendientesFeedback = container.querySelector('#pendientes-feedback');
  const btnHistorial = container.querySelector('#btn-ver-historial-articulos');
  const btnGestionarInventario = container.querySelector('#btn-gestionar-inventario-amenidades');
  const btnReporteConsumo = container.querySelector('#btn-ver-reporte-consumo'); 
  const btnGestionarLavanderia = container.querySelector('#btn-gestionar-lavanderia');
  const btnReporteLenceria = container.querySelector('#btn-ver-reporte-lenceria'); 
  const btnReporteInventario = container.querySelector('#btn-ver-reporte-inventario'); 
  const btnImprimirConteo = container.querySelector('#btn-imprimir-conteo'); 
  const btnGestionarPrestables = container.querySelector('#btn-gestionar-inventario-prestables'); // <-- NUEVO

  await fetchPendientes(pendientesListEl, pendientesFeedback);
  
  const onPendingClick = e => {
    if (e.target.matches('.btn-confirm-clean')) {
      e.target.disabled = true;
      const id = e.target.dataset.id;
      const nombre = e.target.dataset.nombre;
      const tipoId = e.target.dataset.tipoId; 
      showModalConfirmarLimpieza(id, nombre, tipoId, pendientesFeedback, pendientesListEl, e.target);
    }
  };
  pendientesListEl.addEventListener('click', onPendingClick);
  moduleListeners.push({ el: pendientesListEl, evt: 'click', fn: onPendingClick });

  const onHistorialClick = (e) => showHistorialArticulosModal(); 
  btnHistorial.addEventListener('click', onHistorialClick);
  moduleListeners.push({ el: btnHistorial, evt: 'click', fn: onHistorialClick });
  
  if (isAdmin) {
      if (btnGestionarInventario) {
          const fn = (e) => showModalGestionInventario();
          btnGestionarInventario.addEventListener('click', fn);
          moduleListeners.push({ el: btnGestionarInventario, evt: 'click', fn: fn });
      }
      if (btnReporteConsumo) {
          const fn = (e) => showModalReporteConsumo();
          btnReporteConsumo.addEventListener('click', fn);
          moduleListeners.push({ el: btnReporteConsumo, evt: 'click', fn: fn });
      }
      if (btnGestionarLavanderia) {
          const fn = (e) => showModalGestionLavanderia();
          btnGestionarLavanderia.addEventListener('click', fn);
          moduleListeners.push({ el: btnGestionarLavanderia, evt: 'click', fn: fn });
      }
      if (btnReporteLenceria) {
          const fn = (e) => showModalReporteLenceria();
          btnReporteLenceria.addEventListener('click', fn);
          moduleListeners.push({ el: btnReporteLenceria, evt: 'click', fn: fn });
      }
      if (btnReporteInventario) {
          const fn = (e) => showModalReporteInventario();
          btnReporteInventario.addEventListener('click', fn);
          moduleListeners.push({ el: btnReporteInventario, evt: 'click', fn: fn });
      }
      if (btnImprimirConteo) {
          const fn = (e) => imprimirConteoFisico();
          btnImprimirConteo.addEventListener('click', fn);
          moduleListeners.push({ el: btnImprimirConteo, evt: 'click', fn: fn });
      }
      // --- NUEVO LISTENER ---
      if (btnGestionarPrestables) {
          const fn = (e) => showModalGestionPrestables();
          btnGestionarPrestables.addEventListener('click', fn);
          moduleListeners.push({ el: btnGestionarPrestables, evt: 'click', fn: fn });
      }
  }
}

// --- DESMONTAR ---
export function unmount() {
  moduleListeners.forEach(({ el, evt, fn }) => el.removeEventListener(evt, fn));
  moduleListeners = [];
  supabase = null;
  user = null;
  currentHotelId = null;
  currentUserRole = 'limpieza';
}