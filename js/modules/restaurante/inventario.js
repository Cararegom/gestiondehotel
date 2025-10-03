// js/modules/inventario/inventario.js

// Importaciones de utilidades y servicios que ya usas en otros módulos.
import { showLoading, showError, showSuccess } from '../../uiUtils.js';
import { crearNotificacion } from '../../services/NotificationService.js';
import { registrarEnBitacora } from '../../services/bitacoraservice.js';

// Variables para el módulo
let supabase = null;
let currentUser = null;
let hotelId = null;
let moduleListeners = []; // Para limpiar eventos al desmontar

/**
 * Función principal que se ejecuta al cargar el módulo.
 */
export async function mount(container, supabaseInstance, user, p_hotelId) {
  console.log("INVENTARIO: Montando módulo...");
  supabase = supabaseInstance;
  currentUser = user;
  hotelId = p_hotelId;

  if (!hotelId) {
    container.innerHTML = `<p class="error-indicator">Error crítico: No se pudo identificar el hotel del usuario.</p>`;
    console.error("INVENTARIO: No se pudo obtener hotelId.");
    return;
  }

  // Renderizado del HTML base del módulo
  container.innerHTML = `
    <h2 class="text-2xl font-bold mb-6 flex items-center gap-2">📦 <span>Inventario del Restaurante</span></h2>
    <div class="mb-4 flex flex-row gap-2 flex-wrap items-center">
      <input type="text" id="filtro-ingrediente" class="form-control w-auto rounded-lg" placeholder="Buscar ingrediente...">
      <button id="btn-stock-bajo" class="button button-outline border-yellow-500 text-yellow-600 hover:bg-yellow-50">Ver Stock Bajo</button>
      <button id="btn-nueva-ingrediente" class="button button-success ml-auto">+ Nuevo Ingrediente</button>
    </div>
    <div id="inventario-list-container" class="mt-4"></div>
  `;

  // Asignar eventos a los botones principales
  const filtroInput = container.querySelector('#filtro-ingrediente');
  const btnStockBajo = container.querySelector('#btn-stock-bajo');
  const btnNuevo = container.querySelector('#btn-nueva-ingrediente');

  const onFiltro = () => cargarYRenderizarIngredientes({
      nombre: filtroInput.value.trim()
  });
  const onStockBajo = () => cargarYRenderizarIngredientes({
      stockBajo: true
  });
  const onNuevo = () => showModalIngrediente(null);

  filtroInput.addEventListener('input', onFiltro);
  btnStockBajo.addEventListener('click', onStockBajo);
  btnNuevo.addEventListener('click', onNuevo);

  moduleListeners.push({ element: filtroInput, type: 'input', handler: onFiltro });
  moduleListeners.push({ element: btnStockBajo, type: 'click', handler: onStockBajo });
  moduleListeners.push({ element: btnNuevo, type: 'click', handler: onNuevo });


  // Carga inicial de los ingredientes
  await cargarYRenderizarIngredientes();
}

/**
 * Función que se ejecuta al abandonar el módulo para limpiar recursos.
 */
export function unmount() {
  console.log("INVENTARIO: Desmontando módulo y limpiando listeners...");
  moduleListeners.forEach(({ element, type, handler }) => {
    element.removeEventListener(type, handler);
  });
  moduleListeners = [];
  supabase = null;
  currentUser = null;
  hotelId = null;
}


/**
 * Obtiene los ingredientes desde Supabase y los muestra en una tabla.
 * @param {object} filtros - Opciones para filtrar la consulta.
 */
async function cargarYRenderizarIngredientes(filtros = {}) {
  const container = document.getElementById('inventario-list-container');
  if (!container) return;

  container.innerHTML = `<p class="loading-indicator">Cargando ingredientes...</p>`;

  try {
    let query = supabase.from('ingredientes').select('*').eq('hotel_id', hotelId).order('nombre');

    if (filtros.nombre) {
      query = query.ilike('nombre', `%${filtros.nombre}%`);
    }
    const { data: ingredientes, error } = await query;
if (error) throw error;

// 👇 Filtra por stock bajo solo en el frontend si se solicita
let ingredientesFiltrados = ingredientes;
if (filtros.stockBajo) {
  ingredientesFiltrados = ingredientes.filter(ing => Number(ing.stock_actual) <= Number(ing.stock_minimo));
}

renderTablaIngredientes(container, ingredientesFiltrados);

  } catch (error) {
    console.error("INVENTARIO: Error cargando ingredientes:", error);
    container.innerHTML = `<p class="error-indicator">Error al cargar ingredientes: ${error.message}</p>`;
  }
}

/**
 * Dibuja la tabla de ingredientes en el contenedor especificado.
 * @param {HTMLElement} container - El elemento donde se dibujará la tabla.
 * @param {Array} ingredientes - El array de ingredientes a mostrar.
 */
function renderTablaIngredientes(container, ingredientes) {
  if (ingredientes.length === 0) {
    container.innerHTML = `<div class="p-4 text-center text-gray-500 bg-gray-50 rounded-lg">No se encontraron ingredientes con stock bajo.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="overflow-auto rounded-xl shadow-md bg-white">
      <table class="min-w-full table-auto border-collapse text-sm">
        <thead class="bg-gray-100 border-b">
          <tr>
            <th class="py-3 px-3 text-left">Ingrediente</th>
            <th class="py-3 px-3 text-center">Stock Actual</th>
            <th class="py-3 px-3 text-center">Stock Mínimo</th>
            <th class="py-3 px-3 text-center">Costo Unitario</th>
            <th class="py-3 px-3 text-center">Acciones</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200">
          ${ingredientes.map(ing => {
            const stockClass = ing.stock_actual <= ing.stock_minimo ? 'text-red-600 font-bold' : 'text-gray-800';
            return `
              <tr class="hover:bg-blue-50 transition">
                <td class="py-2 px-3 font-semibold">${ing.nombre}</td>
                <td class="py-2 px-3 text-center ${stockClass}">${ing.stock_actual} ${ing.unidad_medida}</td>
                <td class="py-2 px-3 text-center">${ing.stock_minimo} ${ing.unidad_medida}</td>
                <td class="py-2 px-3 text-center">${(ing.costo_unitario || 0).toLocaleString('es-CO', {style:'currency', currency:'COP'})} / ${ing.unidad_medida}</td>
                <td class="py-2 px-3 text-center space-x-2">
                  <button class="button button-outline button-small btn-edit-ing" data-id="${ing.id}">Editar</button>
                  <button class="button button-secondary button-small btn-adjust-stock" data-id="${ing.id}">Ajustar Stock</button>
                </td>
              </tr>
            `
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Asignar eventos a los botones de la tabla
  container.querySelectorAll('.btn-edit-ing').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const ingrediente = ingredientes.find(i => i.id === id);
      showModalIngrediente(ingrediente);
    };
  });

  container.querySelectorAll('.btn-adjust-stock').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const ingrediente = ingredientes.find(i => i.id === id);
      showModalAjusteStock(ingrediente);
    };
  });
}

/**
 * Muestra un modal para crear o editar un ingrediente.
 * @param {object|null} ingrediente - El objeto ingrediente para editar, o null para crear uno nuevo.
 */
function showModalIngrediente(ingrediente = null) {
  const modalContainer = document.createElement('div');
  modalContainer.className = "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4";

  modalContainer.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 relative animate-fadeIn">
      <h3 class="text-xl font-bold mb-5">${ingrediente ? 'Editar' : 'Nuevo'} Ingrediente</h3>
      <form id="form-ingrediente">
        <input type="hidden" name="id" value="${ingrediente?.id || ''}">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="form-label required">Nombre</label>
            <input name="nombre" type="text" class="form-control" value="${ingrediente?.nombre || ''}" required>
          </div>
          <div>
            <label class="form-label required">Unidad de Medida</label>
            <input name="unidad_medida" type="text" class="form-control" value="${ingrediente?.unidad_medida || ''}" placeholder="kg, lt, unidades" required>
          </div>

          ${!ingrediente ? `
            <div>
              <label class="form-label">Stock Inicial</label>
              <input name="stock_actual" type="number" step="any" class="form-control" value="0">
            </div>
          ` : ''}
          
          <div>
            <label class="form-label">Stock Mínimo (Alerta)</label>
            <input name="stock_minimo" type="number" step="any" class="form-control" value="${ingrediente?.stock_minimo || 0}">
          </div>
          <div>
            <label class="form-label">Costo por Unidad</label>
            <input name="costo_unitario" type="number" step="any" class="form-control" value="${ingrediente?.costo_unitario || 0}">
          </div>
        </div>
        <div class="flex justify-end gap-3 mt-6 pt-4 border-t">
          <button type="button" class="button button-secondary btn-cancel">Cancelar</button>
          <button type="submit" class="button button-primary">Guardar Cambios</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modalContainer);

  const form = modalContainer.querySelector('#form-ingrediente');
  const closeModal = () => document.body.removeChild(modalContainer);

  modalContainer.querySelector('.btn-cancel').onclick = closeModal;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const id = formData.get('id');
    const dataToSave = {
      hotel_id: hotelId,
      nombre: formData.get('nombre'),
      unidad_medida: formData.get('unidad_medida'),
      stock_minimo: parseFloat(formData.get('stock_minimo') || 0),
      costo_unitario: parseFloat(formData.get('costo_unitario') || 0),
    };

    try {
      if (id) { // Actualizar
        const { error } = await supabase.from('ingredientes').update(dataToSave).eq('id', id);
        if (error) throw error;
      } else { // Crear
        // ACTUALIZACIÓN 1: Incluir stock_actual al crear
        dataToSave.stock_actual = parseFloat(formData.get('stock_actual') || 0);
        const { error } = await supabase.from('ingredientes').insert(dataToSave);
        if (error) throw error;
      }
      console.log("INVENTARIO: Ingrediente guardado exitosamente.");
      closeModal();
      cargarYRenderizarIngredientes();
    } catch (error) {
      console.error("INVENTARIO: Error guardando ingrediente:", error);
      alert(`Error al guardar: ${error.message}`);
    }
  };
}

/**
 * Muestra un modal para ajustar el stock de un ingrediente.
 * @param {object} ingrediente - El ingrediente cuyo stock se va a ajustar.
 */
function showModalAjusteStock(ingrediente) {
  const modalContainer = document.createElement('div');
  modalContainer.className = "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4";

  modalContainer.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative animate-fadeIn">
      <h3 class="text-xl font-bold mb-1">Ajustar Stock</h3>
      <p class="text-gray-600 mb-4">Ingrediente: <strong>${ingrediente.nombre}</strong></p>
      <form id="form-ajuste-stock">
        <div>
          <label class="form-label required">Tipo de Movimiento</label>
          <select name="tipo_movimiento" id="tipo_movimiento_selector" class="form-control" required>
            <option value="entrada_compra">Entrada por Compra (Sumar al stock)</option>
            <option value="merma">Salida por Merma/Desperdicio (Restar del stock)</option>
            <option value="ajuste_conteo">Ajuste por Conteo Físico (Establecer stock exacto)</option>
          </select>
        </div>
        <div class="mt-4">
          <label class="form-label required">Cantidad (${ingrediente.unidad_medida})</label>
          <input name="cantidad" type="number" step="any" class="form-control" required>
          <p id="ayuda_cantidad" class="text-xs text-gray-500 mt-1">Introduce la cantidad que vas a sumar al inventario.</p>
        </div>
        <div class="mt-4">
          <label class="form-label">Notas (Opcional)</label>
          <textarea name="notas" class="form-control" rows="2" placeholder="Ej: Pedido proveedor X, producto dañado..."></textarea>
        </div>
        <div class="flex justify-end gap-3 mt-6 pt-4 border-t">
          <button type="button" class="button button-secondary btn-cancel">Cancelar</button>
          <button type="submit" class="button button-primary">Registrar Movimiento</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modalContainer);
  
  const tipoMovimientoSelector = modalContainer.querySelector('#tipo_movimiento_selector');
  const ayudaCantidadEl = modalContainer.querySelector('#ayuda_cantidad');

  // Función para actualizar el texto de ayuda
  const actualizarAyuda = () => {
    const seleccion = tipoMovimientoSelector.value;
    if (seleccion === 'entrada_compra') {
      ayudaCantidadEl.textContent = 'Introduce la cantidad que entra. Se sumará al stock actual.';
    } else if (seleccion === 'merma') {
      ayudaCantidadEl.textContent = 'Introduce la cantidad que sale. Se restará del stock actual.';
    } else if (seleccion === 'ajuste_conteo') {
      ayudaCantidadEl.textContent = 'Introduce la cantidad total contada. El stock se establecerá en este nuevo valor.';
    }
  };

  // Asignar evento y llamar una vez para el estado inicial
  tipoMovimientoSelector.addEventListener('change', actualizarAyuda);
  actualizarAyuda();


  const form = modalContainer.querySelector('#form-ajuste-stock');
  const closeModal = () => document.body.removeChild(modalContainer);

  modalContainer.querySelector('.btn-cancel').onclick = closeModal;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const tipo = formData.get('tipo_movimiento');
    const cantidad = parseFloat(formData.get('cantidad'));
    const notas = formData.get('notas');

    if (isNaN(cantidad) || cantidad < 0) {
      alert("La cantidad debe ser un número positivo o cero.");
      return;
    }

    // El RPC es la forma más segura de hacer esto para evitar "race conditions"
    const { error } = await supabase.rpc('ajustar_stock_ingrediente', {
        p_ingrediente_id: ingrediente.id,
        p_cantidad_ajuste: cantidad,
        p_tipo_movimiento: tipo,
        p_usuario_id: currentUser.id,
        p_notas: notas
    });

    if (error) {
      console.error("INVENTARIO: Error en RPC ajustar_stock_ingrediente:", error);
      alert(`Error al ajustar stock: ${error.message}`);
    } else {
      console.log("INVENTARIO: Movimiento de inventario registrado exitosamente.");
      closeModal();
      cargarYRenderizarIngredientes(); // Recargar la lista para ver el nuevo stock
    }
  };
}
// Añade esta función a tu archivo: js/modules/inventario/inventario.js

/**
 * Devuelve una lista de todos los ingredientes para ser usados en otros módulos.
 * @param {object} supabaseClient - La instancia de Supabase.
 * @param {string} hotelId - El ID del hotel actual.
 * @returns {Promise<Array>} - Una promesa que se resuelve con la lista de ingredientes.
 */
export async function getIngredientesList(supabaseClient, hotelId) {
    console.log("INVENTARIO: Solicitada lista de ingredientes...");
    const { data, error } = await supabaseClient
        .from('ingredientes')
        .select('id, nombre, unidad_medida')
        .eq('hotel_id', hotelId)
        .order('nombre');

    if (error) {
        console.error("INVENTARIO: Error obteniendo lista de ingredientes:", error);
        return [];
    }
    return data;
}