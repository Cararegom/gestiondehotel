// js/modules/restaurante/restaurante.js
// import { supabase } from '../../supabaseClient.js'; // Will use currentSupabaseInstance from mount
// Consider importing shared utilities if they exist, e.g., from '/js/uiUtils.js'
// import { crearNotificacion } from '../services/NotificationService.js'; // Example if needed

// --- Module-Scoped Variables ---
let moduleRootListeners = []; // Listeners for the main module structure (e.g., tab buttons)
let currentTabListeners = []; // Listeners specific to the content of the currently active tab

let currentHotelId = null;
let currentModuleUser = null;
let currentSupabaseInstance = null;

let platosCache = [];      // Cache for dishes/menu items
let metodosPagoCache = []; // Cache for payment methods
let ventaItems = [];       // Current POS cart/order items

// --- UTILITIES ---
const formatCurrencyLocal = (value, currency = 'COP') => {
  if (typeof value !== 'number' || isNaN(value)) {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency }).format(0);
  }
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency }).format(value);
};
const formatDateLocal = (dateStr, options = { dateStyle: 'short', timeStyle: 'short' }) => {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? 'Fecha Inválida' : date.toLocaleString('es-CO', options);
};

// --- UI Helper Functions (Scoped) ---
/**
 * Shows a feedback message.
 * @param {HTMLElement} feedbackEl - The feedback display element.
 * @param {string} message - The message to show.
 * @param {'success-indicator' | 'error-indicator' | 'info-indicator'} [typeClass='success-indicator'] - CSS class for feedback type.
 * @param {number} [duration=3000] - Duration in ms. 0 for indefinite.
 */
function showRestauranteFeedback(feedbackEl, message, typeClass = 'success-indicator', duration = 3000) {
  if (!feedbackEl) return;
  feedbackEl.textContent = message;
  let bgColor = 'bg-green-100 border-green-300 text-green-700'; // success
  if (typeClass === 'error-indicator') bgColor = 'bg-red-100 border-red-300 text-red-700';
  else if (typeClass === 'info-indicator') bgColor = 'bg-blue-100 border-blue-300 text-blue-700';
  
  feedbackEl.className = `feedback-message mt-2 mb-3 p-3 rounded-md border text-sm ${bgColor} visible`;
  feedbackEl.style.display = 'block';
  feedbackEl.setAttribute('aria-live', typeClass === 'error-indicator' ? 'assertive' : 'polite');

  if (typeClass === 'error-indicator') {
    feedbackEl.setAttribute('tabindex', '-1');
    feedbackEl.focus();
  }

  if (duration > 0) {
    setTimeout(() => clearRestauranteFeedback(feedbackEl), duration);
  }
}

/**
 * Clears the feedback message.
 * @param {HTMLElement} feedbackEl - The feedback display element.
 */
function clearRestauranteFeedback(feedbackEl) {
  if (!feedbackEl) return;
  feedbackEl.textContent = '';
  feedbackEl.className = 'feedback-message mt-2 mb-3'; // Reset classes
  feedbackEl.style.display = 'none';
  feedbackEl.removeAttribute('tabindex');
}

/**
 * Shows or hides a loading indicator.
 * @param {HTMLElement} loadingEl - The loading indicator element.
 * @param {boolean} show - True to show, false to hide.
 * @param {string} [message="Cargando..."] - Loading message.
 */
function showRestauranteLoading(loadingEl, show, message = "Cargando...") {
  if (!loadingEl) return;
  loadingEl.textContent = message;
  loadingEl.style.display = show ? 'block' : 'none';
  loadingEl.className = show ? 'loading-indicator p-3 my-3 text-sm bg-gray-100 text-gray-600 rounded-md text-center visible' : 'loading-indicator';
}


// --- POS (Point of Sale) Helper Functions ---
/**
 * Creates a handler to update item quantity in the POS cart.
 * @param {number} itemIndex - The index of the item in ventaItems.
 * @param {function} onRenderCallback - Callback function to re-render the POS items UI.
 */
function handleUpdateCantidadVenta(itemIndex, onRenderCallback) {
  return (event) => {
    const nuevaCantidad = parseInt(event.target.value);
    if (isNaN(nuevaCantidad)) return; // Ignore if not a number

    if (nuevaCantidad >= 1) {
      if (ventaItems[itemIndex]) {
        ventaItems[itemIndex].cantidad = nuevaCantidad;
      }
    } else { // Quantity is 0 or less, remove item
      if (ventaItems[itemIndex]) {
        ventaItems.splice(itemIndex, 1);
      }
    }
    onRenderCallback(); // Re-render the cart items
  };
}

/**
 * Creates a handler to remove an item from the POS cart.
 * @param {number} itemIndex - The index of the item in ventaItems.
 * @param {function} onRenderCallback - Callback function to re-render the POS items UI.
 */
function handleRemoveItemVenta(itemIndex, onRenderCallback) {
  return () => {
    if (ventaItems[itemIndex]) {
      ventaItems.splice(itemIndex, 1);
    }
    onRenderCallback(); // Re-render the cart items
  };
}

// --- Tab Rendering Functions ---

/**
 * Renders the "Platos/Menú" tab content.
 * (Placeholder - Needs implementation)
 * @param {HTMLElement} tabContentEl - The container for this tab's content.
 * @param {object} supabaseInstance - The Supabase client instance.
 * @param {string} hotelId - The current hotel ID.
 */
async function renderPlatosTab(tabContentEl, supabaseInstance, hotelId) {
  tabContentEl.innerHTML = `<div class="p-4">
    <h3 class="text-lg font-semibold mb-2">Gestión de Menú/Platos</h3>
    <p class="text-gray-600">Aquí podrás agregar, editar y eliminar platos de tu restaurante.</p>
    <p class="mt-4 p-3 bg-yellow-100 text-yellow-700 rounded-md">Funcionalidad pendiente de implementación.</p>
    </div>`;
  // TODO: Implement CRUD for dishes (platos)
  // - Fetch existing dishes
  // - Form to add/edit dishes (name, description, price, category, active status, image_url)
  // - List of dishes with edit/delete buttons
}

/**
 * Renders the "Registrar Venta (POS)" tab content.
 * @param {HTMLElement} tabContentEl - The container for this tab's content.
 * @param {object} supabaseInstance - The Supabase client instance.
 * @param {string} hotelId - The current hotel ID.
 * @param {object} moduleUser - The current authenticated user.
 */
async function renderRegistrarVentaTab(tabContentEl, supabaseInstance, hotelId, moduleUser) {
  // Clear listeners specific to this tab before re-rendering
  currentTabListeners.forEach(({ element, type, handler }) => element.removeEventListener(type, handler));
  currentTabListeners = [];
  ventaItems = []; // Reset cart for new POS session

  tabContentEl.innerHTML = `
    <section id="pos-restaurante" class="p-1 md:p-0">
      <div class="pos-layout grid grid-cols-1 md:grid-cols-3 gap-4">
        <div id="pos-platos-disponibles" class="md:col-span-2 pos-platos-grid bg-gray-50 p-3 rounded-lg shadow max-h-[70vh] overflow-y-auto">
          <h4 class="text-md font-semibold mb-3 text-gray-700">Platos Disponibles</h4>
          </div>
        <div id="pos-pedido-actual" class="md:col-span-1 pos-pedido-card card bg-white rounded-lg shadow">
          <div class="card-header bg-gray-100 p-3 border-b"><h5 class="mb-0 text-md font-semibold text-gray-700">Pedido Actual</h5></div>
          <div class="card-body p-2">
            <div class="table-container max-h-[250px] overflow-y-auto">
              <table class="tabla-estilizada tabla-small w-full text-xs">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-2 py-1 text-left">Plato</th>
                    <th class="px-2 py-1 text-left">P.U.</th>
                    <th class="px-1 py-1 text-center w-16">Cant.</th>
                    <th class="px-2 py-1 text-left">Subt.</th>
                    <th class="px-1 py-1"></th>
                  </tr>
                </thead>
                <tbody id="pos-pedido-items-body" class="divide-y divide-gray-200">
                  </tbody>
              </table>
            </div>
          </div>
          <div class="card-footer p-3 border-t">
            <h4 class="mb-2 text-lg font-bold text-right">Total: <span id="venta-restaurante-total" class="text-indigo-600">$0.00</span></h4>
            <form id="form-finalizar-venta-restaurante" class="space-y-3">
              <div class="form-group">
                <label for="venta-restaurante-metodo-pago" class="block text-xs font-medium text-gray-600">Método de Pago *</label>
                <select id="venta-restaurante-metodo-pago" name="metodoPagoId" class="form-control form-control-sm mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-xs" required>
                  <option value="">Cargando...</option>
                </select>
              </div>
              <div class="form-group">
                <label for="venta-restaurante-cliente" class="block text-xs font-medium text-gray-600">Cliente (Opcional)</label>
                <input type="text" id="venta-restaurante-cliente" name="clienteNombre" class="form-control form-control-sm mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-xs" placeholder="Nombre o # Habitación">
              </div>
              <button type="submit" id="btn-finalizar-venta-restaurante" class="button button-success button-block w-full py-2 px-4 rounded-md text-sm">Finalizar y Pagar</button>
            </form>
          </div>
        </div>
      </div>
      <div id="posVentaFeedback" role="status" aria-live="polite" style="display:none;" class="feedback-message mt-3"></div>
    </section>`;

  const posPlatosContainerEl = tabContentEl.querySelector('#pos-platos-disponibles');
  const posPedidoItemsBodyEl = tabContentEl.querySelector('#pos-pedido-items-body');
  const formFinalizarVentaEl = tabContentEl.querySelector('#form-finalizar-venta-restaurante');
  const selectMetodoPagoVentaEl = tabContentEl.querySelector('#venta-restaurante-metodo-pago');
  const btnFinalizarVentaEl = tabContentEl.querySelector('#btn-finalizar-venta-restaurante');
  const posFeedbackEl = tabContentEl.querySelector('#posVentaFeedback');
  const restauranteLoadingEl = document.getElementById('restaurante-loading'); // Assuming global loading for initial POS load

  showRestauranteLoading(restauranteLoadingEl, true, "Cargando datos del POS...");

  try {
    const [{ data: platos, error: errPlatos }, { data: metodos, error: errMetodos }] = await Promise.all([
      supabaseInstance.from('platos').select('*').eq('hotel_id', hotelId).eq('activo', true).order('nombre'),
      supabaseInstance.from('metodos_pago').select('id, nombre').eq('activo', true).order('nombre') // Assuming metodos_pago might be global or filtered by RLS
    ]);
    if (errPlatos) throw errPlatos;
    if (errMetodos) throw errMetodos;

    platosCache = platos || [];
    metodosPagoCache = metodos || [];

    renderPOSPlatosUI(posPlatosContainerEl, platosCache, (plato) => {
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
      renderVentaItemsUI(posPedidoItemsBodyEl, posFeedbackEl); // Pass feedbackEl for item-specific actions
    });

    selectMetodoPagoVentaEl.innerHTML = metodosPagoCache.length > 0
      ? `<option value="">-- Seleccione Método --</option>` + metodosPagoCache.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('')
      : '<option value="" disabled>No hay métodos de pago activos</option>';

    renderVentaItemsUI(posPedidoItemsBodyEl, posFeedbackEl); // Initial render of empty cart
  } catch (e) {
    showRestauranteFeedback(posFeedbackEl, `Error crítico al cargar el POS: ${e.message}`, 'error-indicator', 0);
  } finally {
    showRestauranteLoading(restauranteLoadingEl, false);
  }

  // --- Internal UI render function for POS cart items ---
  function renderVentaItemsUI(tbodyEl, feedbackElementForItems) {
    tbodyEl.innerHTML = ''; // Clear previous items and their listeners
    let calculatedTotal = 0;

    if (ventaItems.length === 0) {
      tbodyEl.innerHTML = '<tr><td colspan="5" class="text-center p-3 text-gray-500 text-xs">Agrega platos al pedido desde la izquierda.</td></tr>';
      tabContentEl.querySelector('#venta-restaurante-total').textContent = formatCurrencyLocal(0);
      btnFinalizarVentaEl.disabled = true; // Disable pay button if cart is empty
      return;
    }
    btnFinalizarVentaEl.disabled = false; // Enable pay button if cart has items

    ventaItems.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.className = "border-b border-gray-200 hover:bg-gray-50";
      const itemSubtotal = item.cantidad * item.precio_unitario;
      calculatedTotal += itemSubtotal;
      tr.innerHTML = `
        <td class="px-2 py-1.5 text-xs">${item.nombre_plato}</td>
        <td class="px-2 py-1.5 text-xs">${formatCurrencyLocal(item.precio_unitario)}</td>
        <td class="px-1 py-1.5 text-center">
          <input type="number" class="form-control form-control-sm item-cantidad w-14 text-center text-xs p-0.5 border rounded" value="${item.cantidad}" min="0">
        </td>
        <td class="px-2 py-1.5 text-xs">${formatCurrencyLocal(itemSubtotal)}</td>
        <td class="px-1 py-1.5 text-center">
          <button class="button button-danger button-icon-small remove-item-btn p-0.5 text-xs" title="Eliminar ${item.nombre_plato}">&times;</button>
        </td>
      `;
      tbodyEl.appendChild(tr);

      const cantidadInput = tr.querySelector('.item-cantidad');
      const removeItemBtn = tr.querySelector('.remove-item-btn');

      const updateQtyHandler = handleUpdateCantidadVenta(index, () => renderVentaItemsUI(tbodyEl, feedbackElementForItems));
      cantidadInput.addEventListener('change', updateQtyHandler);
      cantidadInput.addEventListener('input', updateQtyHandler); // For more responsive updates
      currentTabListeners.push({ element: cantidadInput, type: 'change', handler: updateQtyHandler });
      currentTabListeners.push({ element: cantidadInput, type: 'input', handler: updateQtyHandler });


      const removeItemHandler = handleRemoveItemVenta(index, () => renderVentaItemsUI(tbodyEl, feedbackElementForItems));
      removeItemBtn.addEventListener('click', removeItemHandler);
      currentTabListeners.push({ element: removeItemBtn, type: 'click', handler: removeItemHandler });
    });
    tabContentEl.querySelector('#venta-restaurante-total').textContent = formatCurrencyLocal(calculatedTotal);
  }
  // --- End Internal UI render function ---

  const finalizarVentaHandler = async (e) => {
    e.preventDefault();
    if(posFeedbackEl) clearRestauranteFeedback(posFeedbackEl);

    if (ventaItems.length === 0) {
      showRestauranteFeedback(posFeedbackEl, "El pedido está vacío. Agregue platos para continuar.", 'error-indicator');
      return;
    }
    const metodoPagoId = selectMetodoPagoVentaEl.value;
    if (!metodoPagoId) {
      showRestauranteFeedback(posFeedbackEl, "Por favor, seleccione un método de pago.", 'error-indicator');
      selectMetodoPagoVentaEl.focus();
      return;
    }

    const originalButtonText = btnFinalizarVentaEl.textContent;
    setFormLoadingState(formFinalizarVentaEl, true, btnFinalizarVentaEl, originalButtonText, 'Procesando Venta...');

    const montoTotalVenta = ventaItems.reduce((sum, item) => sum + item.cantidad * item.precio_unitario, 0);
    const nombreClienteTemporal = formFinalizarVentaEl.elements.clienteNombre.value.trim() || null;

    const platosParaRpc = ventaItems.map(item => ({
      plato_id: item.plato_id,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      // subtotal: item.cantidad * item.precio_unitario // Subtotal can be calculated by RPC too
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
      // The RPC might return { venta_id: ..., error: false, message: "..." } or throw on error.
      if (rpcResult && rpcResult.error === true) { // Check for logical error from RPC
          throw new Error(rpcResult.message || 'Error devuelto por el servidor al procesar la venta.');
      }

      showRestauranteFeedback(posFeedbackEl, `Venta #${rpcResult?.venta_id || ''} registrada exitosamente.`, 'success-indicator');
      ventaItems = []; // Clear cart
      renderVentaItemsUI(posPedidoItemsBodyEl, posFeedbackEl); // Re-render empty cart
      formFinalizarVentaEl.reset(); // Reset payment form
      selectMetodoPagoVentaEl.value = ""; // Reset select explicitly

    } catch (err) {
      console.error('Error finalizing restaurant sale:', err);
      showRestauranteFeedback(posFeedbackEl, `Error al finalizar la venta: ${err.message}`, 'error-indicator', 0);
    } finally {
      setFormLoadingState(formFinalizarVentaEl, false, btnFinalizarVentaEl, originalButtonText);
    }
  };
  formFinalizarVentaEl.addEventListener('submit', finalizarVentaHandler);
  currentTabListeners.push({ element: formFinalizarVentaEl, type: 'submit', handler: finalizarVentaHandler });
}

/**
 * Placeholder: Renders available dishes for POS selection.
 * @param {HTMLElement} containerEl - The container for dish cards.
 * @param {Array<object>} platos - Array of dish objects.
 * @param {function} onPlatoClickCallback - Callback when a dish is clicked.
 */
function renderPOSPlatosUI(containerEl, platos, onPlatoClickCallback) {
    containerEl.innerHTML = ''; // Clear previous
    if (!platos || platos.length === 0) {
        containerEl.innerHTML = '<p class="text-center text-gray-500 p-4">No hay platos activos disponibles en el menú.</p>';
        return;
    }
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-3'; // Responsive grid

    platos.forEach(plato => {
        const card = document.createElement('div');
        card.className = 'plato-card-pos bg-white p-2.5 rounded-lg shadow border border-gray-200 hover:shadow-md transition-shadow cursor-pointer flex flex-col justify-between';
        card.innerHTML = `
            <div>
                <h5 class="text-sm font-medium text-gray-800 truncate" title="${plato.nombre}">${plato.nombre}</h5>
                <p class="text-xs text-gray-500">${plato.categoria || 'General'}</p>
            </div>
            <p class="text-sm font-semibold text-indigo-600 mt-1">${formatCurrencyLocal(plato.precio)}</p>
        `;
        const clickHandler = () => onPlatoClickCallback(plato);
        card.addEventListener('click', clickHandler);
        currentTabListeners.push({ element: card, type: 'click', handler: clickHandler }); // Manage this listener
        grid.appendChild(card);
    });
    containerEl.appendChild(grid);
}


/**
 * Renders the "Historial de Ventas" tab content.
 * (Placeholder - Needs implementation)
 */
async function renderHistorialVentasTab(tabContentEl, supabaseInstance, hotelId) {
  tabContentEl.innerHTML = `<div class="p-4">
    <h3 class="text-lg font-semibold mb-2">Historial de Ventas del Restaurante</h3>
    <p class="text-gray-600">Aquí podrás ver un listado de todas las ventas realizadas.</p>
    <p class="mt-4 p-3 bg-yellow-100 text-yellow-700 rounded-md">Funcionalidad pendiente de implementación.</p>
  </div>`;
  // TODO: Implement fetching and displaying sales history
  // - Filters by date range, payment method, etc.
  // - Paginated list of sales
  // - Option to view details of a sale
}

/**
 * Renders the "Ingredientes/Inventario" tab content.
 * (Placeholder - Needs implementation)
 */
async function renderIngredientesTab(tabContentEl, supabaseInstance, hotelId) {
  tabContentEl.innerHTML = `<div class="p-4">
    <h3 class="text-lg font-semibold mb-2">Gestión de Ingredientes e Inventario</h3>
    <p class="text-gray-600">Aquí podrás gestionar el stock de tus ingredientes.</p>
    <p class="mt-4 p-3 bg-yellow-100 text-yellow-700 rounded-md">Funcionalidad pendiente de implementación.</p>
  </div>`;
  // TODO: Implement inventory management for ingredients
}


// --- Main Module Mount Function ---
/**
 * Mounts the restaurant module.
 * @param {HTMLElement} container - The main container for the module.
 * @param {object} sbInstance - The Supabase client instance.
 * @param {object} user - The current authenticated user.
 */
export async function mount(container, sbInstance, user) {
  unmount(container); // Clean up previous instance

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
    <div class="card restaurante-module shadow-lg rounded-lg">
      <div class="card-header bg-gray-100 p-3 md:p-4 border-b">
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center">
          <h2 class="text-xl font-semibold text-gray-800 mb-2 sm:mb-0">Gestión de Restaurante</h2>
          <nav class="module-tabs flex flex-wrap gap-1 sm:gap-2">
            <button class="tab-button button button-outline text-xs sm:text-sm py-1.5 px-2.5 rounded-md" data-tab="platos">Menú/Platos</button>
            <button class="tab-button button button-outline text-xs sm:text-sm py-1.5 px-2.5 rounded-md" data-tab="registrar-venta">Registrar Venta (POS)</button>
            <button class="tab-button button button-outline text-xs sm:text-sm py-1.5 px-2.5 rounded-md" data-tab="historial-ventas">Historial Ventas</button>
            <button class="tab-button button button-outline text-xs sm:text-sm py-1.5 px-2.5 rounded-md" data-tab="ingredientes">Inventario</button>
          </nav>
        </div>
      </div>
      <div class="card-body p-2 md:p-4">
        <div id="restaurante-feedback" role="status" aria-live="polite" style="display:none;" class="feedback-message mb-3"></div>
        <div id="restaurante-loading" class="loading-indicator text-center py-4" style="display:none;">Cargando...</div>
        <div id="restaurante-tab-content" class="mt-1">
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
    tabButtons.forEach(btn => btn.classList.remove('active', 'button-primary')); // Assuming 'active' or 'button-primary' for active tab
    const activeBtn = container.querySelector(`.module-tabs .tab-button[data-tab="${tabName}"]`);
    if (activeBtn) activeBtn.classList.add('active', 'button-primary');
    
    if (feedbackGlobalEl) clearRestauranteFeedback(feedbackGlobalEl);
    showRestauranteLoading(loadingGlobalEl, true, `Cargando pestaña ${tabName}...`);

    // Clear listeners from the previous tab's content
    currentTabListeners.forEach(({ element, type, handler }) => {
      if (element && typeof element.removeEventListener === 'function') {
        element.removeEventListener(type, handler);
      }
    });
    currentTabListeners = []; // Reset for the new tab

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
      tabContentEl.innerHTML = `<p class="p-4 text-center text-red-500">Error al cargar contenido.</p>`; // Show error in tab content
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

  // Load default tab (e.g., 'platos' or 'registrar-venta')
  switchTab('registrar-venta'); // Default to POS tab
}

/**
 * Unmounts the restaurant module, cleaning up listeners and state.
 * @param {HTMLElement} container - The main container of the module.
 */
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

  // Reset caches and global state for this module
  platosCache = [];
  metodosPagoCache = [];
  ventaItems = [];
  currentHotelId = null;
  currentModuleUser = null;
  currentSupabaseInstance = null;

  if (container && typeof container.innerHTML === 'string') {
    // Clear feedback and loading if they are part of the container and not handled by tab switching
    const feedbackEl = container.querySelector('#restaurante-feedback');
    if (feedbackEl) clearRestauranteFeedback(feedbackEl);
    const loadingEl = container.querySelector('#restaurante-loading');
    if (loadingEl) showRestauranteLoading(loadingEl, false);
    // container.innerHTML = ''; // Optionally clear all content
  }
  console.log('Restaurante module unmounted.');
}
