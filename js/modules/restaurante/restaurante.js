// js/modules/restaurante/restaurante.js
import { registrarEnBitacora } from '../../services/bitacoraservice.js';

// --- Module-Scoped Variables ---
let moduleRootListeners = [];
let currentTabListeners = [];

let currentHotelId = null;
let currentModuleUser = null;
let currentSupabaseInstance = null;

let platosCache = [];
let metodosPagoCache = [];
let ventaItems = []; // Current POS cart/order items
let ventasHistorialCache = []; // Cache for sales history

// --- UTILITIES ---
const formatCurrencyLocal = (value, currency = 'COP') => {
  if (typeof value !== 'number' || isNaN(value)) {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(0);
  }
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
};
const formatDateLocal = (dateStr, options = { dateStyle: 'medium', timeStyle: 'short' }) => {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? 'Fecha Inválida' : date.toLocaleString('es-CO', options);
};

// --- UI Helper Functions (Scoped) ---
function showRestauranteFeedback(feedbackEl, message, typeClass = 'success-indicator', duration = 3500) {
  if (!feedbackEl) return;
  feedbackEl.textContent = message;
  let bgColor = 'bg-green-100 border-green-300 text-green-700';
  if (typeClass === 'error-indicator') bgColor = 'bg-red-100 border-red-300 text-red-700';
  else if (typeClass === 'info-indicator') bgColor = 'bg-blue-100 border-blue-300 text-blue-700';
  
  feedbackEl.className = `feedback-message mt-2 mb-3 p-3 rounded-md border text-sm ${bgColor} visible`;
  feedbackEl.style.display = 'block';
  feedbackEl.setAttribute('aria-live', typeClass === 'error-indicator' ? 'assertive' : 'polite');

  if (typeClass === 'error-indicator' && duration === 0) {
    feedbackEl.setAttribute('tabindex', '-1');
    // No hacer focus automáticamente en todos los errores, puede ser molesto.
    // Considerar hacer focus solo si es un error de validación de un campo específico.
  }

  if (duration > 0) {
    setTimeout(() => clearRestauranteFeedback(feedbackEl), duration);
  }
}

function clearRestauranteFeedback(feedbackEl) {
  if (!feedbackEl) return;
  feedbackEl.textContent = '';
  feedbackEl.className = 'feedback-message mt-2 mb-3';
  feedbackEl.style.display = 'none';
  feedbackEl.removeAttribute('tabindex');
}

function showRestauranteLoading(loadingEl, show, message = "Cargando...") {
  if (!loadingEl) return;
  loadingEl.textContent = message;
  loadingEl.style.display = show ? 'block' : 'none';
  loadingEl.className = show ? 'loading-indicator p-3 my-3 text-sm bg-gray-100 text-gray-600 rounded-md text-center visible' : 'loading-indicator';
}

function setFormLoadingState(formEl, isLoading, submitButtonEl, originalButtonText, loadingText = "Procesando...") {
    if (!formEl || !submitButtonEl) return;
    const elements = formEl.elements;
    for (let i = 0; i < elements.length; i++) {
        elements[i].disabled = isLoading;
    }
    if (isLoading) {
        submitButtonEl.innerHTML = `<span class="spinner-border spinner-border-sm mr-2" role="status" aria-hidden="true"></span>${loadingText}`;
        submitButtonEl.classList.add('opacity-75', 'cursor-not-allowed');
    } else {
        submitButtonEl.innerHTML = originalButtonText;
        submitButtonEl.classList.remove('opacity-75', 'cursor-not-allowed');
    }
}

// --- POS (Point of Sale) Helper Functions ---
function handleUpdateCantidadVenta(itemIndex, onRenderCallback) {
  return (event) => {
    const nuevaCantidad = parseInt(event.target.value);
    if (isNaN(nuevaCantidad)) return;

    if (nuevaCantidad >= 1) {
      if (ventaItems[itemIndex]) {
        ventaItems[itemIndex].cantidad = nuevaCantidad;
      }
    } else {
      if (ventaItems[itemIndex]) {
        ventaItems.splice(itemIndex, 1);
      }
    }
    onRenderCallback();
  };
}

function handleRemoveItemVenta(itemIndex, onRenderCallback) {
  return () => {
    if (ventaItems[itemIndex]) {
      ventaItems.splice(itemIndex, 1);
    }
    onRenderCallback();
  };
}

// --- Tab Rendering Functions ---

async function renderPlatosTab(tabContentEl, supabaseInstance, hotelId) {
  currentTabListeners.forEach(({ element, type, handler }) => element.removeEventListener(type, handler));
  currentTabListeners = [];

  tabContentEl.innerHTML = `
    <div class="p-4">
      <div class="flex flex-col sm:flex-row justify-between items-center mb-4 gap-2">
        <h3 class="text-lg font-semibold">Gestión de Menú/Platos</h3>
        <button id="btn-nuevo-plato" class="button button-primary text-sm py-1.5 px-3 rounded-md w-full sm:w-auto">
          <span class="mr-1">🍴</span>Nuevo Plato
        </button>
      </div>
      <div id="platos-feedback" class="feedback-message" style="display:none;"></div>
      <div id="platos-loading" class="loading-indicator text-center py-3" style="display:none;">Cargando platos...</div>
      <div id="lista-platos-container" class="overflow-x-auto bg-white shadow rounded-md"></div>
    </div>

    <div id="modal-plato" class="modal-container fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center p-4 z-50" style="display:none;">
      <div class="modal-content bg-white p-5 rounded-lg shadow-xl w-full max-w-lg transform transition-all">
        <form id="form-plato">
          <div class="flex justify-between items-center mb-4">
            <h4 id="modal-plato-titulo" class="text-xl font-semibold">Nuevo Plato</h4>
            <button type="button" id="btn-cerrar-modal-plato" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
          </div>
          <input type="hidden" id="plato-id" name="id">
          <div class="mb-3">
            <label for="plato-nombre" class="block text-sm font-medium text-gray-700">Nombre del Plato *</label>
            <input type="text" id="plato-nombre" name="nombre" class="form-control mt-1" required>
          </div>
          <div class="mb-3">
            <label for="plato-descripcion" class="block text-sm font-medium text-gray-700">Descripción (Opcional)</label>
            <textarea id="plato-descripcion" name="descripcion" rows="2" class="form-control mt-1"></textarea>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
            <div>
              <label for="plato-precio" class="block text-sm font-medium text-gray-700">Precio (COP) *</label>
              <input type="number" id="plato-precio" name="precio" step="50" min="0" class="form-control mt-1" required placeholder="Ej: 15000">
            </div>
            <div>
              <label for="plato-categoria" class="block text-sm font-medium text-gray-700">Categoría (Opcional)</label>
              <input type="text" id="plato-categoria" name="categoria" class="form-control mt-1" placeholder="Ej: Bebidas, Entradas">
            </div>
          </div>
           <div class="mb-4">
            <label for="plato-activo" class="flex items-center cursor-pointer">
              <input type="checkbox" id="plato-activo" name="activo" class="form-checkbox h-5 w-5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500" checked>
              <span class="ml-2 text-sm text-gray-700">Activo (disponible en POS)</span>
            </label>
          </div>
          <div id="modal-plato-feedback" class="feedback-message my-2" style="display:none;"></div>
          <div class="flex justify-end gap-3 mt-5 pt-4 border-t">
            <button type="button" id="btn-cancelar-plato" class="button button-outline text-sm">Cancelar</button>
            <button type="submit" id="btn-guardar-plato" class="button button-success text-sm">Guardar Plato</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const btnNuevoPlato = tabContentEl.querySelector('#btn-nuevo-plato');
  const modalPlatoEl = tabContentEl.querySelector('#modal-plato');
  const formPlatoEl = tabContentEl.querySelector('#form-plato');
  const btnCancelarPlato = tabContentEl.querySelector('#btn-cancelar-plato');
  const btnCerrarModalPlato = tabContentEl.querySelector('#btn-cerrar-modal-plato');
  const platosLoadingEl = tabContentEl.querySelector('#platos-loading');
  const platosFeedbackEl = tabContentEl.querySelector('#platos-feedback');
  const modalPlatoFeedbackEl = tabContentEl.querySelector('#modal-plato-feedback');
  const modalPlatoTituloEl = tabContentEl.querySelector('#modal-plato-titulo');

  // --- LOG DE DIAGNÓSTICO ---
  console.log("¿Elemento del formulario encontrado?:", formPlatoEl);

  const openPlatoModal = (plato = null) => {
    formPlatoEl.reset();
    clearRestauranteFeedback(modalPlatoFeedbackEl);
    if (plato) {
      modalPlatoTituloEl.textContent = 'Editar Plato';
      formPlatoEl.elements['id'].value = plato.id;
      formPlatoEl.elements['nombre'].value = plato.nombre;
      formPlatoEl.elements['descripcion'].value = plato.descripcion || '';
      formPlatoEl.elements['precio'].value = plato.precio;
      formPlatoEl.elements['categoria'].value = plato.categoria || '';
      formPlatoEl.elements['activo'].checked = plato.activo;
    } else {
      modalPlatoTituloEl.textContent = 'Nuevo Plato';
      formPlatoEl.elements['activo'].checked = true;
    }
    modalPlatoEl.style.display = 'flex';
    setTimeout(() => formPlatoEl.elements['nombre'].focus(), 50);
  };

  const closePlatoModal = () => {
    modalPlatoEl.style.display = 'none';
  };

  const nuevoPlatoHandler = () => openPlatoModal();
  btnNuevoPlato.addEventListener('click', nuevoPlatoHandler);
  currentTabListeners.push({ element: btnNuevoPlato, type: 'click', handler: nuevoPlatoHandler });

  btnCancelarPlato.addEventListener('click', closePlatoModal);
  currentTabListeners.push({ element: btnCancelarPlato, type: 'click', handler: closePlatoModal });
  btnCerrarModalPlato.addEventListener('click', closePlatoModal);
  currentTabListeners.push({ element: btnCerrarModalPlato, type: 'click', handler: closePlatoModal });
  
  const modalBackdropHandler = (e) => { if (e.target === modalPlatoEl) closePlatoModal(); };
  modalPlatoEl.addEventListener('click', modalBackdropHandler);
  currentTabListeners.push({ element: modalPlatoEl, type: 'click', handler: modalBackdropHandler });

  async function cargarYRenderizarPlatos() {
    showRestauranteLoading(platosLoadingEl, true);
    clearRestauranteFeedback(platosFeedbackEl);
    try {
      const { data, error } = await supabaseInstance.from('platos')
        .select('*')
        .eq('hotel_id', hotelId)
        .order('categoria', { ascending: true, nullsFirst: false })
        .order('nombre', { ascending: true });
      if (error) throw error;
      platosCache = data || [];
      renderTablaPlatos(platosCache);
    } catch (err) {
      console.error("Error cargando platos:", err);
      showRestauranteFeedback(platosFeedbackEl, `Error al cargar platos: ${err.message}`, 'error-indicator', 0);
    } finally {
      showRestauranteLoading(platosLoadingEl, false);
    }
  }

  function renderTablaPlatos(platos) {
    const container = tabContentEl.querySelector('#lista-platos-container');
    if (platos.length === 0) {
      container.innerHTML = '<p class="text-center text-gray-500 py-6">No hay platos registrados. ¡Agrega el primero!</p>';
      return;
    }
    const table = document.createElement('table');
    table.className = 'tabla-estilizada w-full';
    table.innerHTML = `
      <thead class="bg-gray-50">
        <tr>
          <th class="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nombre</th>
          <th class="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Categoría</th>
          <th class="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Precio</th>
          <th class="px-4 py-2.5 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Activo</th>
          <th class="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
        </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-200">
        ${platos.map(p => `
          <tr data-id="${p.id}" class="hover:bg-gray-50">
            <td data-label="Nombre" class="px-4 py-3 whitespace-nowrap text-sm text-gray-700">${p.nombre}</td>
            <td data-label="Categoría" class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${p.categoria || 'N/A'}</td>
            <td data-label="Precio" class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${formatCurrencyLocal(p.precio)}</td>
            <td data-label="Activo" class="px-4 py-3 whitespace-nowrap text-center text-sm">
              ${p.activo ? '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Sí</span>' : '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">No</span>'}
            </td>
            <td data-label="Acciones" class="px-4 py-3 whitespace-nowrap text-right text-sm font-medium space-x-2">
              <button class="button button-outline button-icon-small btn-editar-plato p-1 rounded hover:bg-gray-100" title="Editar ${p.nombre}"><span class="text-base">✏️</span></button>
              <button class="button button-danger-outline button-icon-small btn-eliminar-plato p-1 rounded hover:bg-red-50" title="Eliminar ${p.nombre}"><span class="text-base">🗑️</span></button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    `;
    container.innerHTML = '';
    container.appendChild(table);

    table.querySelectorAll('.btn-editar-plato').forEach(btn => {
        const platoId = btn.closest('tr').dataset.id;
        const plato = platosCache.find(p => p.id === platoId);
        const handler = () => openPlatoModal(plato);
        btn.addEventListener('click', handler);
        currentTabListeners.push({ element: btn, type: 'click', handler });
    });
    table.querySelectorAll('.btn-eliminar-plato').forEach(btn => {
        const platoId = btn.closest('tr').dataset.id;
        const platoNombre = platosCache.find(p=>p.id === platoId)?.nombre || 'este plato';
        const handler = async () => {
            if (confirm(`¿Estás seguro de que quieres eliminar el plato "${platoNombre}"? Esta acción no se puede deshacer.`)) {
                showRestauranteLoading(platosLoadingEl, true, "Eliminando plato...");
                try {
                    const { error } = await supabaseInstance.from('platos').delete().match({ id: platoId, hotel_id: hotelId });
                    if (error) throw error;
                    showRestauranteFeedback(platosFeedbackEl, 'Plato eliminado correctamente.', 'success-indicator');
                    await registrarEnBitacora(supabaseInstance, hotelId, currentModuleUser.id, 'ELIMINAR_PLATO_RESTAURANTE', { platoId: platoId, nombre: platoNombre });
                    cargarYRenderizarPlatos();
                } catch (err) {
                    console.error("Error eliminando plato:", err);
                    showRestauranteFeedback(platosFeedbackEl, `Error al eliminar plato: ${err.message}`, 'error-indicator', 0);
                } finally {
                    showRestauranteLoading(platosLoadingEl, false);
                }
            }
        };
        btn.addEventListener('click', handler);
        currentTabListeners.push({ element: btn, type: 'click', handler });
    });
  }

  const formPlatoSubmitHandler = async (e) => {
    // --- LOG DE DIAGNÓSTICO ---
    console.log("¡Manejador de submit EJECUTADO!");
    e.preventDefault();

    clearRestauranteFeedback(modalPlatoFeedbackEl);
    const btnGuardar = formPlatoEl.querySelector('#btn-guardar-plato');
    const originalText = btnGuardar.textContent;

    const formData = new FormData(formPlatoEl);
    const platoData = {
      hotel_id: hotelId,
      nombre: formData.get('nombre')?.trim(),
      descripcion: formData.get('descripcion')?.trim() || null,
      precio: parseFloat((formData.get('precio') || '').replace(/,/g, '').trim()),
      categoria: formData.get('categoria')?.trim() || null,
      activo: formPlatoEl.elements['activo'].checked,
      actualizado_en: new Date().toISOString()
    };
    const platoId = formData.get('id');

    setFormLoadingState(formPlatoEl, true, btnGuardar, originalText, 'Guardando...');

    if (!platoData.nombre || isNaN(platoData.precio) || platoData.precio <= 0) {
      showRestauranteFeedback(modalPlatoFeedbackEl, 'Nombre y precio válido (>0) son requeridos.', 'error-indicator', 0);
      setFormLoadingState(formPlatoEl, false, btnGuardar, originalText);
      return;
    }

    try {
      let result;
      let bitacoraAccion;
      if (platoId) {
        result = await supabaseInstance.from('platos').update(platoData).match({ id: platoId, hotel_id: hotelId }).select();
        bitacoraAccion = 'EDITAR_PLATO_RESTAURANTE';
      } else {
        result = await supabaseInstance.from('platos').insert({...platoData, creado_en: new Date().toISOString()}).select();
        bitacoraAccion = 'NUEVO_PLATO_RESTAURANTE';
      }
      const { data, error } = result;
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("No se pudo guardar el plato o no se devolvieron datos.");
      
      await registrarEnBitacora(supabaseInstance, hotelId, currentModuleUser.id, bitacoraAccion, { platoId: data[0].id, nombre: data[0].nombre });
      showRestauranteFeedback(platosFeedbackEl, `Plato ${platoId ? 'actualizado' : 'creado'} correctamente.`, 'success-indicator');
      closePlatoModal();
      cargarYRenderizarPlatos();
    } catch (err) {
      console.error("Error guardando plato:", err);
      showRestauranteFeedback(modalPlatoFeedbackEl, `Error al guardar: ${err.message}`, 'error-indicator', 0);
    } finally {
      setFormLoadingState(formPlatoEl, false, btnGuardar, originalText);
    }
  };

  // Se adjunta el listener aquí
  formPlatoEl.addEventListener('submit', formPlatoSubmitHandler);
  currentTabListeners.push({ element: formPlatoEl, type: 'submit', handler: formPlatoSubmitHandler });

  await cargarYRenderizarPlatos();
}

async function renderRegistrarVentaTab(tabContentEl, supabaseInstance, hotelId, moduleUser) {
  // Limpia listeners previos
  currentTabListeners.forEach(({ element, type, handler }) => element.removeEventListener(type, handler));
  currentTabListeners = [];
  ventaItems = [];

  tabContentEl.innerHTML = `
    <section id="pos-restaurante" class="p-1 md:p-0">
      <div class="pos-layout grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="md:col-span-2 pos-platos-grid bg-gray-50 p-3 rounded-lg shadow max-h-[calc(100vh-250px)] md:max-h-[calc(100vh-200px)] overflow-y-auto">
          <div class="flex flex-col sm:flex-row justify-between items-center mb-3 gap-2">
            <h4 class="text-md font-semibold text-gray-700">Platos Disponibles</h4>
            <input type="text" id="pos-filtro-platos" class="form-control form-control-sm py-1.5 px-2 text-xs w-full sm:w-1/2 md:w-1/3 rounded-md border-gray-300" placeholder="Buscar plato...">
          </div>
          <div id="pos-platos-disponibles-render-area" class="min-h-[100px]">
          </div>
        </div>
        <div id="pos-pedido-actual" class="md:col-span-1 pos-pedido-card card bg-white rounded-lg shadow flex flex-col max-h-[calc(100vh-200px)]">
          <div class="card-header bg-gray-100 p-3 border-b"><h5 class="mb-0 text-md font-semibold text-gray-700">Pedido Actual</h5></div>
          <div class="card-body p-2 flex-grow overflow-y-auto">
            <div class="table-container">
              <table class="tabla-estilizada tabla-small w-full text-xs">
                <thead class="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th class="px-2 py-1.5 text-left">Plato</th>
                    <th class="px-2 py-1.5 text-left">P.U.</th>
                    <th class="px-1 py-1.5 text-center w-16">Cant.</th>
                    <th class="px-2 py-1.5 text-left">Subt.</th>
                    <th class="px-1 py-1.5"></th>
                  </tr>
                </thead>
                <tbody id="pos-pedido-items-body" class="divide-y divide-gray-200"></tbody>
              </table>
            </div>
          </div>
          <div class="card-footer p-3 border-t mt-auto">
            <h4 class="mb-2 text-lg font-bold text-right">Total: <span id="venta-restaurante-total" class="text-indigo-600">$0</span></h4>
            <form id="form-finalizar-venta-restaurante" class="space-y-3">
              <div class="form-group">
                <label for="venta-restaurante-modo" class="block text-xs font-medium text-gray-600">Modo de Venta *</label>
                <select id="venta-restaurante-modo" name="modoVenta" class="form-control form-control-sm mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-xs" required>
                  <option value="inmediato">Pago Inmediato</option>
                  <option value="habitacion">Cargar a Habitación</option>
                </select>
              </div>
              <div class="form-group" id="grupo-metodo-pago-restaurante">
                <label for="venta-restaurante-metodo-pago" class="block text-xs font-medium text-gray-600">Método de Pago *</label>
                <select id="venta-restaurante-metodo-pago" name="metodoPagoId" class="form-control form-control-sm mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-xs">
                  <option value="">Cargando...</option>
                </select>
              </div>
              <div class="form-group" id="grupo-habitacion-restaurante" style="display:none;">
                <label for="venta-restaurante-habitacion" class="block text-xs font-medium text-gray-600">Habitación a cargar *</label>
                <select id="venta-restaurante-habitacion" name="habitacionId" class="form-control form-control-sm mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-xs">
                  <option value="">Cargando...</option>
                </select>
              </div>
              <div class="form-group" id="grupo-cliente-restaurante">
                <label for="venta-restaurante-cliente" class="block text-xs font-medium text-gray-600">Cliente (Opcional)</label>
                <input type="text" id="venta-restaurante-cliente" name="clienteNombre" class="form-control form-control-sm mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-xs" placeholder="Nombre o # Habitación">
              </div>
              <button type="submit" id="btn-finalizar-venta-restaurante" class="button button-success button-block w-full py-2 px-4 rounded-md text-sm">Registrar Venta</button>
            </form>
          </div>
        </div>
      </div>
      <div id="posVentaFeedback" role="status" aria-live="polite" style="display:none;" class="feedback-message mt-3"></div>
    </section>`;

  // ELEMENTOS
  const posPlatosRenderAreaEl = tabContentEl.querySelector('#pos-platos-disponibles-render-area');
  const posPedidoItemsBodyEl = tabContentEl.querySelector('#pos-pedido-items-body');
  const formFinalizarVentaEl = tabContentEl.querySelector('#form-finalizar-venta-restaurante');
  const selectMetodoPagoVentaEl = tabContentEl.querySelector('#venta-restaurante-metodo-pago');
  const selectModoVentaEl = tabContentEl.querySelector('#venta-restaurante-modo');
  const selectHabitacionEl = tabContentEl.querySelector('#venta-restaurante-habitacion');
  const grupoMetodoPagoEl = tabContentEl.querySelector('#grupo-metodo-pago-restaurante');
  const grupoHabitacionEl = tabContentEl.querySelector('#grupo-habitacion-restaurante');
  const grupoClienteEl = tabContentEl.querySelector('#grupo-cliente-restaurante');
  const btnFinalizarVentaEl = tabContentEl.querySelector('#btn-finalizar-venta-restaurante');
  const posFeedbackEl = tabContentEl.querySelector('#posVentaFeedback');
  const filtroPlatosInputEl = tabContentEl.querySelector('#pos-filtro-platos');
  const restauranteLoadingEl = document.getElementById('restaurante-loading');

  let habitacionesOcupadas = [];

  showRestauranteLoading(restauranteLoadingEl, true, "Cargando datos del POS...");

  try {
    const [
      { data: platos, error: errPlatos },
      { data: metodos, error: errMetodos },
      { data: habitaciones, error: errHab }
    ] = await Promise.all([
      supabaseInstance.from('platos').select('*').eq('hotel_id', hotelId).eq('activo', true).order('nombre'),
      supabaseInstance.from('metodos_pago').select('id, nombre').eq('hotel_id', hotelId).eq('activo', true).order('nombre'),
      supabaseInstance.from('habitaciones').select('id, nombre').eq('hotel_id', hotelId).eq('estado', 'ocupada').order('nombre')
    ]);
    if (errPlatos) throw errPlatos;
    if (errMetodos) throw errMetodos;
    if (errHab) throw errHab;

    platosCache = platos || [];
    metodosPagoCache = metodos || [];
    habitacionesOcupadas = habitaciones || [];

    // Render platos
    renderPOSPlatosUI(posPlatosRenderAreaEl, platosCache, (plato) => {
      const existingItem = ventaItems.find(item => item.plato_id === plato.id);
      if (existingItem) {
        existingItem.cantidad++;
      } else {
        ventaItems.push({
          plato_id: plato.id,
          nombre_plato: plato.nombre,
          cantidad: 1,
          precio_unitario: plato.precio
        });
      }
      renderVentaItemsUI(posPedidoItemsBodyEl, posFeedbackEl);
    });

    // Render métodos de pago
    selectMetodoPagoVentaEl.innerHTML = metodosPagoCache.length > 0
      ? `<option value="">-- Seleccione Método --</option>` + metodosPagoCache.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('')
      : '<option value="" disabled>No hay métodos de pago activos</option>';

    // Render habitaciones ocupadas
    selectHabitacionEl.innerHTML = habitacionesOcupadas.length > 0
      ? `<option value="">-- Seleccione habitación --</option>` + habitacionesOcupadas.map(h => `<option value="${h.id}">${h.nombre}</option>`).join('')
      : '<option value="" disabled>No hay habitaciones ocupadas</option>';

    renderVentaItemsUI(posPedidoItemsBodyEl, posFeedbackEl);

  } catch (e) {
    console.error("Error crítico al cargar el POS:", e);
    showRestauranteFeedback(posFeedbackEl, `Error crítico al cargar el POS: ${e.message}`, 'error-indicator', 0);
  } finally {
    showRestauranteLoading(restauranteLoadingEl, false);
  }

  // Filtro de platos
  const filtroHandler = () => {
    const termino = filtroPlatosInputEl.value.toLowerCase();
    const platosFiltrados = platosCache.filter(plato =>
      plato.nombre.toLowerCase().includes(termino) ||
      (plato.categoria && plato.categoria.toLowerCase().includes(termino))
    );
    renderPOSPlatosUI(posPlatosRenderAreaEl, platosFiltrados, (plato) => {
      const existingItem = ventaItems.find(item => item.plato_id === plato.id);
      if (existingItem) existingItem.cantidad++;
      else ventaItems.push({ plato_id: plato.id, nombre_plato: plato.nombre, cantidad: 1, precio_unitario: plato.precio });
      renderVentaItemsUI(posPedidoItemsBodyEl, posFeedbackEl);
    });
  };
  filtroPlatosInputEl.addEventListener('input', filtroHandler);
  currentTabListeners.push({ element: filtroPlatosInputEl, type: 'input', handler: filtroHandler });

  // Lógica para mostrar/ocultar campos según modo de venta
  selectModoVentaEl.addEventListener('change', function () {
    const modo = selectModoVentaEl.value;
    if (modo === "inmediato") {
      grupoMetodoPagoEl.style.display = "";
      grupoHabitacionEl.style.display = "none";
      grupoClienteEl.style.display = "";
    } else if (modo === "habitacion") {
      grupoMetodoPagoEl.style.display = "none";
      grupoHabitacionEl.style.display = "";
      grupoClienteEl.style.display = "none";
    }
  });
  // Disparar cambio inicial para estado correcto de inputs
  selectModoVentaEl.dispatchEvent(new Event('change'));

  function renderVentaItemsUI(tbodyEl, feedbackElementForItems) {
    tbodyEl.innerHTML = '';
    let calculatedTotal = 0;

    if (ventaItems.length === 0) {
      tbodyEl.innerHTML = '<tr><td colspan="5" class="text-center p-3 text-gray-500 text-xs">Agrega platos al pedido.</td></tr>';
      tabContentEl.querySelector('#venta-restaurante-total').textContent = formatCurrencyLocal(0);
      btnFinalizarVentaEl.disabled = true;
      return;
    }
    btnFinalizarVentaEl.disabled = false;

    ventaItems.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.className = "border-b border-gray-200 hover:bg-gray-50";
      const itemSubtotal = item.cantidad * item.precio_unitario;
      calculatedTotal += itemSubtotal;
      tr.innerHTML = `
        <td class="px-2 py-1.5 text-xs font-medium text-gray-700">${item.nombre_plato}</td>
        <td class="px-2 py-1.5 text-xs">${formatCurrencyLocal(item.precio_unitario)}</td>
        <td class="px-1 py-1.5 text-center">
          <input type="number" class="form-control form-control-sm item-cantidad w-14 text-center text-xs p-1 border rounded-md" value="${item.cantidad}" min="0">
        </td>
        <td class="px-2 py-1.5 text-xs font-semibold">${formatCurrencyLocal(itemSubtotal)}</td>
        <td class="px-1 py-1.5 text-center">
          <button class="button button-danger-outline button-icon-small remove-item-btn p-1 rounded-md text-xs hover:bg-red-50" title="Eliminar ${item.nombre_plato}"><span class="text-base">🗑️</span></button>
        </td>
      `;
      tbodyEl.appendChild(tr);

      const cantidadInput = tr.querySelector('.item-cantidad');
      const removeItemBtn = tr.querySelector('.remove-item-btn');

      const updateQtyHandler = handleUpdateCantidadVenta(index, () => renderVentaItemsUI(tbodyEl, feedbackElementForItems));
      cantidadInput.addEventListener('change', updateQtyHandler);
      cantidadInput.addEventListener('input', updateQtyHandler);
      currentTabListeners.push({ element: cantidadInput, type: 'change', handler: updateQtyHandler });
      currentTabListeners.push({ element: cantidadInput, type: 'input', handler: updateQtyHandler });

      const removeItemHandler = handleRemoveItemVenta(index, () => renderVentaItemsUI(tbodyEl, feedbackElementForItems));
      removeItemBtn.addEventListener('click', removeItemHandler);
      currentTabListeners.push({ element: removeItemBtn, type: 'click', handler: removeItemHandler });
    });
    tabContentEl.querySelector('#venta-restaurante-total').textContent = formatCurrencyLocal(calculatedTotal);
  }

  // SUBMIT DE LA VENTA
  const finalizarVentaHandler = async (e) => {
    e.preventDefault();
    if (posFeedbackEl) clearRestauranteFeedback(posFeedbackEl);

    if (ventaItems.length === 0) {
      showRestauranteFeedback(posFeedbackEl, "El pedido está vacío. Agregue platos para continuar.", 'error-indicator');
      return;
    }

    const modo = selectModoVentaEl.value;

    // Pago inmediato
    if (modo === "inmediato") {
      const metodoPagoId = selectMetodoPagoVentaEl.value;
      if (!metodoPagoId) {
        showRestauranteFeedback(posFeedbackEl, "Por favor, seleccione un método de pago.", 'error-indicator');
        selectMetodoPagoVentaEl.focus();
        return;
      }

      const originalButtonText = "Registrar Venta";
      setFormLoadingState(formFinalizarVentaEl, true, btnFinalizarVentaEl, originalButtonText, 'Procesando...');

      const montoTotalVenta = ventaItems.reduce((sum, item) => sum + item.cantidad * item.precio_unitario, 0);
      const nombreClienteTemporal = formFinalizarVentaEl.elements.clienteNombre.value.trim() || null;
      const platosParaRpc = ventaItems.map(item => ({
        plato_id: item.plato_id,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
      }));

      try {
        const { data: rpcResult, error: rpcError } = await supabaseInstance.rpc('procesar_venta_restaurante_y_caja', {
          p_hotel_id: hotelId,
          p_usuario_id: moduleUser.id,
          p_metodo_pago_id: metodoPagoId,
          p_platos_vendidos: platosParaRpc,
          p_monto_total_venta: montoTotalVenta,
          p_nombre_cliente_temporal: nombreClienteTemporal
        });

        if (rpcError) throw rpcError;
        if (rpcResult && rpcResult.error === true) {
          throw new Error(rpcResult.message || 'Error devuelto por el servidor al procesar la venta.');
        }

        showRestauranteFeedback(posFeedbackEl, `Venta #${rpcResult?.venta_id || ''} registrada exitosamente.`, 'success-indicator', 5000);
        await registrarEnBitacora(supabaseInstance, hotelId, moduleUser.id, 'NUEVA_VENTA_RESTAURANTE_POS', { ventaId: rpcResult?.venta_id, monto: montoTotalVenta, cliente: nombreClienteTemporal });

        ventaItems = [];
        renderVentaItemsUI(posPedidoItemsBodyEl, posFeedbackEl);
        formFinalizarVentaEl.reset();
        selectMetodoPagoVentaEl.value = "";
        filtroPlatosInputEl.value = "";
      } catch (err) {
        console.error('Error finalizing restaurant sale:', err);
        showRestauranteFeedback(posFeedbackEl, `Error al finalizar la venta: ${err.message}`, 'error-indicator', 0);
      } finally {
        setFormLoadingState(formFinalizarVentaEl, false, btnFinalizarVentaEl, originalButtonText);
      }
      return;
    }

    // Cargar a habitación
    if (modo === "habitacion") {
      const habitacionId = selectHabitacionEl.value;
      if (!habitacionId) {
        showRestauranteFeedback(posFeedbackEl, "Seleccione una habitación a la que cargar el consumo.", 'error-indicator');
        selectHabitacionEl.focus();
        return;
      }

      setFormLoadingState(formFinalizarVentaEl, true, btnFinalizarVentaEl, "Registrar Venta", "Cargando...");

      // Buscar reserva activa en esa habitación
      let reservaId = null;
      try {
        const { data: reservas } = await supabaseInstance
          .from('reservas')
          .select('id')
          .eq('habitacion_id', habitacionId)
          .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
          .order('fecha_inicio', { ascending: false })
          .limit(1);

        if (reservas && reservas.length > 0) {
          reservaId = reservas[0].id;
        }
      } catch (err) {
        showRestauranteFeedback(posFeedbackEl, "Error buscando la reserva activa de la habitación.", 'error-indicator');
        setFormLoadingState(formFinalizarVentaEl, false, btnFinalizarVentaEl, "Registrar Venta");
        return;
      }

      if (!reservaId) {
        showRestauranteFeedback(posFeedbackEl, "No se encontró una reserva activa para esa habitación.", 'error-indicator');
        setFormLoadingState(formFinalizarVentaEl, false, btnFinalizarVentaEl, "Registrar Venta");
        return;
      }

      // Registra la venta en la tabla ventas_restaurante y asóciala a la reserva
      const montoTotalVenta = ventaItems.reduce((sum, item) => sum + item.cantidad * item.precio_unitario, 0);
      const platosParaInsert = ventaItems.map(item => ({
        venta_id: null, // se actualiza después
        plato_id: item.plato_id,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
        subtotal: item.cantidad * item.precio_unitario,
        hotel_id: hotelId,
        creado_en: new Date().toISOString()
      }));
console.log({
  hotel_id: hotelId,
  usuario_id: moduleUser.id,
  habitacion_id: habitacionId,
  reserva_id: reservaId,
  total_venta: montoTotalVenta,
  fecha: new Date().toISOString(),
  creado_en: new Date().toISOString()
});

      try {
        // 1. Registrar la venta principal
      const now = new Date().toISOString();
const { data: ventas, error: ventaError } = await supabaseInstance
  .from('ventas_restaurante')
  .insert([{
    hotel_id: hotelId,
    usuario_id: moduleUser.id,
    habitacion_id: habitacionId,
    reserva_id: reservaId,
    monto_total: montoTotalVenta,
    fecha_venta: now,
    creado_en: now,
    fecha: now, // este campo puede ser igual a now o como lo quieras manejar
    // total_venta: puedes omitirlo (queda null)
    // metodo_pago_id: null si carga a habitación
    // nombre_cliente_temporal: null si carga a habitación
  }])
  .select();
if (ventaError || !ventas?.[0]) throw new Error("Error guardando venta.");
const ventaId = ventas[0].id; // 

        // 2. Detalle de la venta
        for (let item of ventaItems) {
          await supabaseInstance.from('ventas_restaurante_items').insert([{
  venta_id: ventaId,
  plato_id: item.plato_id,
  cantidad: item.cantidad,
  precio_unitario_venta: item.precio_unitario, // nombre correcto en tu tabla
  subtotal: item.cantidad * item.precio_unitario,
  creado_en: now
}]);

        }

        showRestauranteFeedback(posFeedbackEl, `Consumo cargado exitosamente a la habitación.`, 'success-indicator', 3500);
        await registrarEnBitacora(supabaseInstance, hotelId, moduleUser.id, 'CONSUMO_HABITACION_RESTAURANTE', { ventaId, reservaId, habitacionId, monto: montoTotalVenta });

        ventaItems = [];
        renderVentaItemsUI(posPedidoItemsBodyEl, posFeedbackEl);
        formFinalizarVentaEl.reset();
        filtroPlatosInputEl.value = "";
      } catch (err) {
        showRestauranteFeedback(posFeedbackEl, `Error al cargar el consumo a la habitación: ${err.message}`, 'error-indicator');
      } finally {
        setFormLoadingState(formFinalizarVentaEl, false, btnFinalizarVentaEl, "Registrar Venta");
      }
    }
  };

  formFinalizarVentaEl.addEventListener('submit', finalizarVentaHandler);
  currentTabListeners.push({ element: formFinalizarVentaEl, type: 'submit', handler: finalizarVentaHandler });
}

function renderPOSPlatosUI(containerEl, platos, onPlatoClickCallback) {
    containerEl.innerHTML = '';
    if (!platos || platos.length === 0) {
        containerEl.innerHTML = '<p class="text-center text-gray-500 p-4">No hay platos activos que coincidan con la búsqueda.</p>';
        return;
    }
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-3';

    platos.forEach(plato => {
        const card = document.createElement('div');
        card.className = 'plato-card-pos bg-white p-2.5 rounded-lg shadow border border-gray-200 hover:shadow-lg hover:border-indigo-500 transition-all cursor-pointer flex flex-col justify-between h-full';
        card.innerHTML = `
            <div>
                <h5 class="text-sm font-semibold text-gray-800 truncate" title="${plato.nombre}">${plato.nombre}</h5>
                <p class="text-xs text-gray-500 mb-1">${plato.categoria || 'General'}</p>
            </div>
            <p class="text-md font-bold text-indigo-600 mt-1.5 self-end">${formatCurrencyLocal(plato.precio)}</p>
        `;
        const clickHandler = () => onPlatoClickCallback(plato);
        card.addEventListener('click', clickHandler);
        // No es necesario agregar estos listeners a currentTabListeners si se limpian con containerEl.innerHTML = ''
        // Sin embargo, si los elementos de plato fueran más complejos y tuvieran listeners internos, sí sería necesario.
        grid.appendChild(card);
    });
    containerEl.appendChild(grid);
}


async function renderHistorialVentasTab(tabContentEl, supabaseInstance, hotelId) {
  currentTabListeners.forEach(({ element, type, handler }) => element.removeEventListener(type, handler));
  currentTabListeners = [];

  tabContentEl.innerHTML = `
    <div class="p-4">
      <h3 class="text-lg font-semibold mb-4">Historial de Ventas del Restaurante</h3>
      <div id="historial-feedback" class="feedback-message" style="display:none;"></div>
      <div id="historial-loading" class="loading-indicator text-center py-3" style="display:none;">Cargando historial...</div>
      <div class="mb-4 flex flex-col sm:flex-row gap-3">
          <input type="date" id="filtro-fecha-inicio-historial" class="form-control form-control-sm py-1.5 px-2 text-xs rounded-md border-gray-300">
          <input type="date" id="filtro-fecha-fin-historial" class="form-control form-control-sm py-1.5 px-2 text-xs rounded-md border-gray-300">
          <button id="btn-filtrar-historial" class="button button-primary text-sm py-1.5 px-3 rounded-md">Filtrar</button>
      </div>
      <div id="lista-historial-ventas-container" class="overflow-x-auto bg-white shadow rounded-md"></div>
    </div>`;

  const historialLoadingEl = tabContentEl.querySelector('#historial-loading');
  const historialFeedbackEl = tabContentEl.querySelector('#historial-feedback');
  const container = tabContentEl.querySelector('#lista-historial-ventas-container');
  const btnFiltrar = tabContentEl.querySelector('#btn-filtrar-historial');
  const fechaInicioInput = tabContentEl.querySelector('#filtro-fecha-inicio-historial');
  const fechaFinInput = tabContentEl.querySelector('#filtro-fecha-fin-historial');

  async function cargarYRenderizarHistorial(fechaInicio, fechaFin) {
    showRestauranteLoading(historialLoadingEl, true);
    clearRestauranteFeedback(historialFeedbackEl);
    try {
      let query = supabaseInstance.from('ventas_restaurante')
        .select(`
          id,
          fecha_venta,
          monto_total,
          nombre_cliente_temporal,
          metodos_pago (nombre),
          ventas_restaurante_items (
            cantidad,
            precio_unitario_venta,
            subtotal,
            platos (nombre)
          )
        `)
        .eq('hotel_id', hotelId)
        .order('fecha_venta', { ascending: false });

        if (fechaInicio) {
            query = query.gte('fecha_venta', `${fechaInicio}T00:00:00.000Z`);
        }
        if (fechaFin) {
            query = query.lte('fecha_venta', `${fechaFin}T23:59:59.999Z`);
        }

      const { data, error } = await query;
      if (error) throw error;
      ventasHistorialCache = data || [];
      renderTablaHistorial(ventasHistorialCache);
    } catch (err) {
      console.error("Error cargando historial de ventas:", err);
      showRestauranteFeedback(historialFeedbackEl, `Error al cargar historial: ${err.message}`, 'error-indicator', 0);
      container.innerHTML = '<p class="text-center text-red-500 py-4">Error al cargar el historial.</p>';
    } finally {
      showRestauranteLoading(historialLoadingEl, false);
    }
  }

  function renderTablaHistorial(ventas) {
    if (ventas.length === 0) {
      container.innerHTML = '<p class="text-center text-gray-500 py-6">No hay ventas registradas para el periodo seleccionado.</p>';
      return;
    }
    const table = document.createElement('table');
    table.className = 'tabla-estilizada w-full';
    table.innerHTML = `
      <thead class="bg-gray-50">
        <tr>
          <th class="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">ID Venta</th>
          <th class="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
          <th class="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Cliente</th>
          <th class="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Método Pago</th>
          <th class="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
          <th class="px-3 py-2.5 text-center text-xs font-medium text-gray-500 uppercase">Detalles</th>
        </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-200">
        ${ventas.map(v => `
          <tr data-id="${v.id}" class="hover:bg-gray-50">
            <td class="px-3 py-3 whitespace-nowrap text-xs text-gray-500 truncate" title="${v.id}">${v.id.substring(0,8)}...</td>
            <td class="px-3 py-3 whitespace-nowrap text-xs text-gray-700">${formatDateLocal(v.fecha_venta)}</td>
            <td class="px-3 py-3 whitespace-nowrap text-xs text-gray-700">${v.nombre_cliente_temporal || 'N/A'}</td>
            <td class="px-3 py-3 whitespace-nowrap text-xs text-gray-500">${v.metodos_pago?.nombre || 'N/A'}</td>
            <td class="px-3 py-3 whitespace-nowrap text-xs text-gray-800 font-semibold text-right">${formatCurrencyLocal(v.monto_total)}</td>
            <td class="px-3 py-3 whitespace-nowrap text-center">
                <button class="button button-outline button-icon-small btn-ver-detalles-venta p-1 rounded text-xs" title="Ver Detalles">👁️</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    `;
    container.innerHTML = '';
    container.appendChild(table);

    table.querySelectorAll('.btn-ver-detalles-venta').forEach(btn => {
        const ventaId = btn.closest('tr').dataset.id;
        const venta = ventasHistorialCache.find(v => v.id === ventaId);
        const handler = () => mostrarDetallesVentaModal(venta);
        btn.addEventListener('click', handler);
        currentTabListeners.push({ element: btn, type: 'click', handler });
    });
  }
  
  const filtrarHistorialHandler = () => {
      const fechaInicio = fechaInicioInput.value;
      const fechaFin = fechaFinInput.value;
      cargarYRenderizarHistorial(fechaInicio, fechaFin);
  };

  btnFiltrar.addEventListener('click', filtrarHistorialHandler);
  currentTabListeners.push({ element: btnFiltrar, type: 'click', handler: filtrarHistorialHandler});

  // Carga inicial sin filtros de fecha (o con un rango por defecto)
  const hoy = new Date();
  const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
  fechaInicioInput.value = primerDiaMes;
  fechaFinInput.value = hoy.toISOString().split('T')[0];
  cargarYRenderizarHistorial(fechaInicioInput.value, fechaFinInput.value);
}

function mostrarDetallesVentaModal(venta) {
    // Reutilizar o crear un nuevo modal para detalles
    let modalDetallesEl = document.getElementById('modal-detalles-venta-restaurante');
    if (!modalDetallesEl) {
        modalDetallesEl = document.createElement('div');
        modalDetallesEl.id = 'modal-detalles-venta-restaurante';
        modalDetallesEl.className = 'modal-container fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center p-4 z-[60]'; // Higher z-index
        document.body.appendChild(modalDetallesEl); // Append to body to ensure it's on top
    }

    const itemsHtml = venta.ventas_restaurante_items.map(item => `
        <tr class="border-b">
            <td class="py-1.5 px-2 text-xs">${item.platos?.nombre || 'Plato no encontrado'}</td>
            <td class="py-1.5 px-2 text-xs text-center">${item.cantidad}</td>
            <td class="py-1.5 px-2 text-xs text-right">${formatCurrencyLocal(item.precio_unitario_venta)}</td>
            <td class="py-1.5 px-2 text-xs text-right font-medium">${formatCurrencyLocal(item.subtotal)}</td>
        </tr>
    `).join('');

    modalDetallesEl.innerHTML = `
        <div class="modal-content bg-white p-5 rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
            <div class="flex justify-between items-center mb-3 pb-2 border-b">
                <h4 class="text-lg font-semibold">Detalles de Venta #${venta.id.substring(0,8)}...</h4>
                <button type="button" class="btn-cerrar-detalles-modal text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
            </div>
            <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-3">
                <div><strong>Fecha:</strong> ${formatDateLocal(venta.fecha_venta)}</div>
                <div><strong>Cliente:</strong> ${venta.nombre_cliente_temporal || 'N/A'}</div>
                <div><strong>Método Pago:</strong> ${venta.metodos_pago?.nombre || 'N/A'}</div>
                <div><strong>Total Venta:</strong> <span class="font-bold text-indigo-600">${formatCurrencyLocal(venta.monto_total)}</span></div>
            </div>
            <h5 class="text-md font-medium mt-4 mb-1.5">Items Vendidos:</h5>
            <table class="w-full text-left">
                <thead class="bg-gray-100">
                    <tr>
                        <th class="py-1.5 px-2 text-xs font-medium">Plato</th>
                        <th class="py-1.5 px-2 text-xs font-medium text-center">Cant.</th>
                        <th class="py-1.5 px-2 text-xs font-medium text-right">P.U.</th>
                        <th class="py-1.5 px-2 text-xs font-medium text-right">Subtotal</th>
                    </tr>
                </thead>
                <tbody>${itemsHtml}</tbody>
            </table>
            <div class="mt-4 pt-3 border-t text-right">
                <button type="button" class="btn-cerrar-detalles-modal button button-outline text-sm">Cerrar</button>
            </div>
        </div>
    `;
    modalDetallesEl.style.display = 'flex';

    const cerrarModalHandler = () => {
        modalDetallesEl.style.display = 'none';
        // Considerar remover el modal del DOM si se crea dinámicamente cada vez
        // modalDetallesEl.remove();
    };
    
    modalDetallesEl.querySelectorAll('.btn-cerrar-detalles-modal').forEach(btn => {
        btn.addEventListener('click', cerrarModalHandler);
        // No añadir a currentTabListeners si el modal es global y se limpia de otra forma
    });
    modalDetallesEl.addEventListener('click', (e) => {
        if (e.target === modalDetallesEl) cerrarModalHandler();
    });
}


async function renderIngredientesTab(tabContentEl, supabaseInstance, hotelId) {
  tabContentEl.innerHTML = `<div class="p-4">
    <h3 class="text-lg font-semibold mb-2">Gestión de Ingredientes e Inventario</h3>
    <p class="text-gray-600">Aquí podrás gestionar el stock de tus ingredientes.</p>
    <p class="mt-4 p-3 bg-yellow-100 text-yellow-700 rounded-md">Funcionalidad pendiente de implementación.</p>
  </div>`;
}


// --- Main Module Mount Function ---
export async function mount(container, sbInstance, user) {
  unmount(container);

  currentSupabaseInstance = sbInstance;
  currentModuleUser = user;

  currentHotelId = currentModuleUser?.user_metadata?.hotel_id;
  if (!currentHotelId && currentModuleUser?.id) {
    try {
      const { data: perfil, error: perfilError } = await currentSupabaseInstance.from('usuarios').select('hotel_id').eq('id', currentModuleUser.id).single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError;
      currentHotelId = perfil?.hotel_id;
    } catch (err) {
        console.error("Restaurante Module: Error fetching hotel_id from profile:", err);
    }
  }
  
  container.innerHTML = `
    <div class="card restaurante-module shadow-lg rounded-lg bg-gray-50">
      <div class="card-header bg-white p-3 md:p-4 border-b rounded-t-lg">
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center">
          <h2 class="text-xl font-semibold text-gray-800 mb-2 sm:mb-0 flex items-center"><span class="text-2xl mr-2">🍴</span>Gestión de Restaurante</h2>
          <nav class="module-tabs flex flex-wrap gap-1 sm:gap-2">
            <button class="tab-button button button-outline text-xs sm:text-sm py-1.5 px-2.5 rounded-md" data-tab="registrar-venta">Registrar Venta (POS)</button>
            <button class="tab-button button button-outline text-xs sm:text-sm py-1.5 px-2.5 rounded-md" data-tab="platos">Menú/Platos</button>
            <button class="tab-button button button-outline text-xs sm:text-sm py-1.5 px-2.5 rounded-md" data-tab="historial-ventas">Historial Ventas</button>
            <button class="tab-button button button-outline text-xs sm:text-sm py-1.5 px-2.5 rounded-md" data-tab="ingredientes">Inventario</button>
          </nav>
        </div>
      </div>
      <div class="card-body p-0 md:p-1">
        <div id="restaurante-feedback" role="status" aria-live="polite" style="display:none;" class="feedback-message m-4"></div>
        <div id="restaurante-loading" class="loading-indicator text-center py-4" style="display:none;">Cargando...</div>
        <div id="restaurante-tab-content" class="mt-1 bg-white shadow-sm rounded-b-lg min-h-[60vh]">
        </div>
      </div>
    </div>`;
  
  const feedbackGlobalEl = container.querySelector('#restaurante-feedback');
  const loadingGlobalEl = container.querySelector('#restaurante-loading');

  if (!currentHotelId) {
    showRestauranteFeedback(feedbackGlobalEl, 'Error crítico: No se pudo determinar el hotel. Módulo de restaurante deshabilitado.', 'error-indicator', 0);
    container.querySelectorAll('button, input, select, textarea').forEach(el => el.disabled = true);
    return;
  }

  const tabContentEl = container.querySelector('#restaurante-tab-content');
  const tabButtons = container.querySelectorAll('.module-tabs .tab-button');

  const switchTab = async (tabName) => {
    tabButtons.forEach(btn => {
        btn.classList.remove('active', 'button-primary', 'bg-indigo-600', 'text-white', 'border-indigo-600');
        btn.classList.add('button-outline', 'text-gray-700', 'hover:bg-gray-100');
    });
    const activeBtn = container.querySelector(`.module-tabs .tab-button[data-tab="${tabName}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active', 'button-primary', 'bg-indigo-600', 'text-white', 'border-indigo-600');
        activeBtn.classList.remove('button-outline', 'text-gray-700', 'hover:bg-gray-100');
    }
    
    if (feedbackGlobalEl) clearRestauranteFeedback(feedbackGlobalEl);
    showRestauranteLoading(loadingGlobalEl, true, `Cargando pestaña ${tabName}...`);

    currentTabListeners.forEach(({ element, type, handler }) => {
      if (element && typeof element.removeEventListener === 'function') {
        element.removeEventListener(type, handler);
      }
    });
    currentTabListeners = [];

    try {
      if (tabName === 'platos') {
        await renderPlatosTab(tabContentEl, currentSupabaseInstance, currentHotelId);
      } else if (tabName === 'registrar-venta') {
        await renderRegistrarVentaTab(tabContentEl, currentSupabaseInstance, currentHotelId, currentModuleUser);
      } else if (tabName === 'historial-ventas') {
        await renderHistorialVentasTab(tabContentEl, currentSupabaseInstance, currentHotelId);
      } else if (tabName === 'ingredientes') {
        await renderIngredientesTab(tabContentEl, currentSupabaseInstance, currentHotelId);
      } else {
        tabContentEl.innerHTML = `<p class="p-4 text-center text-gray-500">Pestaña "${tabName}" no implementada aún.</p>`;
      }
    } catch (err) {
      console.error(`Error loading tab ${tabName}:`, err);
      showRestauranteFeedback(feedbackGlobalEl, `Error al cargar la pestaña ${tabName}: ${err.message}`, 'error-indicator', 0);
      tabContentEl.innerHTML = `<div class="p-4 text-center text-red-500">Error al cargar contenido de la pestaña. Revise la consola para más detalles.</div>`;
    } finally {
      showRestauranteLoading(loadingGlobalEl, false);
    }
  };

  tabButtons.forEach(button => {
    const tabName = button.dataset.tab;
    const tabButtonHandler = () => switchTab(tabName);
    button.addEventListener('click', tabButtonHandler);
    moduleRootListeners.push({ element: button, type: 'click', handler: tabButtonHandler });
  });

  switchTab('registrar-venta');
}

export function unmount(container) {
  moduleRootListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleRootListeners = [];

  currentTabListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  currentTabListeners = [];

  platosCache = [];
  metodosPagoCache = [];
  ventaItems = [];
  ventasHistorialCache = [];
  currentHotelId = null;
  currentModuleUser = null;
  currentSupabaseInstance = null;

  // Limpiar modales globales si existen y fueron añadidos al body
  const modalDetallesVenta = document.getElementById('modal-detalles-venta-restaurante');
  if (modalDetallesVenta) modalDetallesVenta.remove();


  if (container && typeof container.innerHTML === 'string') {
    const feedbackEl = container.querySelector('#restaurante-feedback');
    if (feedbackEl) clearRestauranteFeedback(feedbackEl);
    const loadingEl = container.querySelector('#restaurante-loading');
    if (loadingEl) showRestauranteLoading(loadingEl, false);
    // container.innerHTML = ''; // Evitar limpiar si se va a reutilizar el contenedor principal
  }
  console.log('Restaurante module unmounted.');
}

