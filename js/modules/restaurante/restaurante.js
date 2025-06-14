// js/modules/restaurante/restaurante.js
import { registrarEnBitacora } from '../../services/bitacoraservice.js';
import { turnoService } from '../../services/turnoService.js';
import * as inventarioModule from './inventario.js';
import { getIngredientesList } from './inventario.js';

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
let activeSubmodule = null; // Para manejar submódulos como inventario

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

// =============================================================
// ===== INICIA NUEVO BLOQUE DE LÓGICA DE DESCUENTOS =========
// =============================================================

let descuentoAplicadoRestaurante = null;

// PEGA ESTE NUEVO BLOQUE DE CÓDIGO EN LUGAR DE LAS DOS FUNCIONES QUE BORRASTE

/**
 * Nueva función de búsqueda que encuentra descuentos automáticos Y por código.
 * @param {Array} itemsEnCarrito - Los items actuales en el pedido.
 * @param {string|null} codigoManual - El código que el usuario introduce manualmente.
 * @returns {Object|null} El mejor descuento aplicable o null.
 */
async function buscarDescuentosAplicables(itemsEnCarrito, codigoManual = null) {
    if (itemsEnCarrito.length === 0) return null;

    const categoriasEnCarrito = [...new Set(
        itemsEnCarrito.map(item => platosCache.find(p => p.id === item.plato_id)?.categoria_id).filter(Boolean)
    )];

    const ahora = new Date().toISOString();
console.log("[BUSCANDO DESCUENTO] Carrito:", itemsEnCarrito);
console.log("[BUSCANDO DESCUENTO] Categorías en carrito:", categoriasEnCarrito);
    let query = currentSupabaseInstance.from('descuentos').select('*')
        .eq('hotel_id', currentHotelId)
        .eq('activo', true)
        .or('fecha_inicio.is.null,fecha_inicio.lte.' + ahora) // Válido si no tiene fecha de inicio o ya empezó
        .or('fecha_fin.is.null,fecha_fin.gte.' + ahora) // Válido si no tiene fecha de fin o no ha terminado
        .or('usos_maximos.eq.0,usos_actuales.lt.usos_maximos');


    const orConditions = [
        'tipo_descuento_general.eq.automatico'
    ];
    if (codigoManual) {
        orConditions.push(`codigo.eq.${codigoManual.toUpperCase()}`);
    }
    query = query.or(orConditions.join(','));


    const { data: descuentos, error } = await query;

    if (error) {
        console.error("Error buscando descuentos:", error);
        return null;
    }
    if (!descuentos || descuentos.length === 0) {
        return null;
    }

    // Filtra los descuentos para encontrar el mejor aplicable
    for (const descuento of descuentos) {
        if (descuento.aplicabilidad === 'reserva_total' || descuento.aplicabilidad === 'categorias_restaurante') {
            if (descuento.aplicabilidad === 'categorias_restaurante') {
                const hayCoincidencia = descuento.habitaciones_aplicables.some(catId => categoriasEnCarrito.includes(catId));
                if (hayCoincidencia) return descuento; // Devuelve el primer descuento de categoría que coincida
            } else {
                return descuento; // Devuelve el primer descuento de venta total que encuentre
            }
        }
    }

    return null; // No se encontró ningún descuento aplicable
}


/**
 * Nueva función que maneja la lógica de aplicar descuentos, tanto manual como automáticamente.
 * @param {boolean} esBusquedaAutomatica - Si es true, no muestra mensajes de error si no encuentra nada.
 */
async function handleAplicarDescuentoRestaurante(esBusquedaAutomatica = false) {
    const feedbackEl = document.getElementById('feedback-descuento-restaurante');
    const codigoInput = document.getElementById('codigo-descuento-restaurante');
    const codigo = codigoInput.value;

    if (!esBusquedaAutomatica && !codigo) return; // No hacer nada si es un clic manual sin código

    feedbackEl.textContent = 'Buscando...';
    feedbackEl.className = 'text-xs mt-1 text-gray-500';

    descuentoAplicadoRestaurante = await buscarDescuentosAplicables(ventaItems, codigo || null);

    if (descuentoAplicadoRestaurante) {
        const tipoPromo = descuentoAplicadoRestaurante.tipo_descuento_general === 'automatico' ? 'Promoción automática' : 'Descuento';
        feedbackEl.textContent = `${tipoPromo} "${descuentoAplicadoRestaurante.nombre}" aplicado.`;
        feedbackEl.className = 'text-xs mt-1 text-green-600';
        if (descuentoAplicadoRestaurante.codigo) {
            codigoInput.value = descuentoAplicadoRestaurante.codigo;
        }
    } else {
        descuentoAplicadoRestaurante = null;
        if (!esBusquedaAutomatica) { // Solo mostrar error en búsqueda manual
            feedbackEl.textContent = 'Código no válido o no aplica a los productos del carrito.';
            feedbackEl.className = 'text-xs mt-1 text-red-600';
        } else {
            feedbackEl.textContent = ''; // Limpiar si la búsqueda automática no encontró nada
        }
    }
    renderVentaItemsUI(document.getElementById('pos-pedido-items-body'));
}

// =============================================================
// ===== FIN NUEVO BLOQUE DE LÓGICA DE DESCUENTOS =========
// =============================================================



// --- UI Helper Functions ---
function showRestauranteFeedback(feedbackEl, message, typeClass = 'success-indicator', duration = 3500) {
    if (!feedbackEl) return;
    feedbackEl.textContent = message;
    let bgColor = 'bg-green-100 border-green-300 text-green-700';
    if (typeClass === 'error-indicator') bgColor = 'bg-red-100 border-red-300 text-red-700';
    else if (typeClass === 'info-indicator') bgColor = 'bg-blue-100 border-blue-300 text-blue-700';

    feedbackEl.className = `feedback-message mt-2 mb-3 p-3 rounded-md border text-sm ${bgColor} visible`;
    feedbackEl.style.display = 'block';

    if (duration > 0) {
        setTimeout(() => clearRestauranteFeedback(feedbackEl), duration);
    }
}

function clearRestauranteFeedback(feedbackEl) {
    if (!feedbackEl) return;
    feedbackEl.textContent = '';
    feedbackEl.className = 'feedback-message mt-2 mb-3';
    feedbackEl.style.display = 'none';
}

function showRestauranteLoading(loadingEl, show, message = "Cargando...") {
    if (!loadingEl) return;
    loadingEl.textContent = message;
    loadingEl.style.display = show ? 'block' : 'none';
    loadingEl.className = show ? 'loading-indicator p-3 my-3 text-sm bg-gray-100 text-gray-600 rounded-md text-center visible' : 'loading-indicator';
}

function setFormLoadingState(formEl, isLoading, submitButtonEl, originalButtonText = "Guardar", loadingText = "Procesando...") {
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
/**
 * Dibuja las tarjetas de los platos disponibles en el TPV, ahora con imágenes.
 */
function renderPOSPlatosUI(containerEl, platos, onPlatoClickCallback) {
    containerEl.innerHTML = '';
    if (!platos?.length) {
        containerEl.innerHTML = '<p class="p-4 text-center text-gray-500">No hay platos que coincidan.</p>';
        return;
    }
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-3';

    const placeholderImg = 'https://via.placeholder.com/150'; // Imagen por defecto si un plato no tiene foto

    platos.forEach(plato => {
        const card = document.createElement('div');
        // Se quita el padding general para que la imagen ocupe todo el ancho.
        card.className = 'plato-card-pos bg-white rounded-lg shadow border hover:shadow-lg hover:border-indigo-500 transition-all cursor-pointer flex flex-col h-full overflow-hidden';
        
        // --- INICIO DE LA MODIFICACIÓN ---
        card.innerHTML = `
            <img src="${plato.imagen_url || placeholderImg}" alt="${plato.nombre}" class="w-full h-24 object-cover">
            <div class="p-2 flex flex-col flex-grow">
                <h5 class="text-sm font-semibold text-gray-800 truncate flex-grow" title="${plato.nombre}">${plato.nombre}</h5>
                <p class="text-md font-bold text-indigo-600 mt-1 self-end">${formatCurrencyLocal(plato.precio)}</p>
            </div>
        `;
        // --- FIN DE LA MODIFICACIÓN ---

        card.addEventListener('click', () => onPlatoClickCallback(plato));
        grid.appendChild(card);
    });
    containerEl.appendChild(grid);
}

// --- POS (Point of Sale) Helper Functions ---


// --- POS (Point of Sale) Helper Functions ---
function handleUpdateCantidadVenta(itemIndex, onRenderCallback) {
    return (event) => {
        const nuevaCantidad = parseInt(event.target.value);
        if (isNaN(nuevaCantidad)) return;
        if (nuevaCantidad >= 1) {
            if (ventaItems[itemIndex]) ventaItems[itemIndex].cantidad = nuevaCantidad;
        } else {
            // Si la cantidad es 0 o menos, eliminamos el item del carrito
            if (ventaItems[itemIndex]) ventaItems.splice(itemIndex, 1);
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

// --- TABS RENDERING ---
// REEMPLAZA TODA TU FUNCIÓN renderVentaItemsUI CON ESTA VERSIÓN CORREGIDA
function renderVentaItemsUI(tbodyEl) {
    if (!tbodyEl) return;
    tbodyEl.innerHTML = '';
    let subtotalBruto = 0;

    // Elementos UI
    const totalDisplayEl = document.getElementById('venta-restaurante-total');
    const descuentoResumenEl = document.getElementById('descuento-resumen-restaurante');
    const btnFinalizarVentaEl = document.getElementById('btn-finalizar-venta-restaurante');
        console.log("[RESTAURANTE] Descuento detectado:", descuentoAplicadoRestaurante);
    const feedbackDescuentoEl = document.getElementById('feedback-descuento-restaurante');

    if (ventaItems.length === 0) {
        tbodyEl.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-gray-500">Agrega platos al pedido.</td></tr>';
        if(btnFinalizarVentaEl) btnFinalizarVentaEl.disabled = true;
        if(totalDisplayEl) totalDisplayEl.textContent = formatCurrencyLocal(0);
        if(descuentoResumenEl) descuentoResumenEl.style.display = 'none';
        if(feedbackDescuentoEl) feedbackDescuentoEl.textContent = '';
        descuentoAplicadoRestaurante = null; // Limpia el descuento si el carrito está vacío
        return;
    }
    
    if(btnFinalizarVentaEl) btnFinalizarVentaEl.disabled = false;

    // Renderiza los items del carrito
    ventaItems.forEach((item, index) => {
        const subtotalItem = item.cantidad * item.precio_unitario;
        subtotalBruto += subtotalItem;
        const tr = document.createElement('tr');
        tr.className = "border-b";
        tr.innerHTML = `
            <td class="py-2 px-1 font-medium text-slate-700">${item.nombre_plato}</td>
            <td class="py-2 px-1 text-center">
                <input type="number" class="form-control-sm item-cantidad w-16 text-center" value="${item.cantidad}" min="0">
            </td>
            <td class="py-2 px-1 text-right">${formatCurrencyLocal(subtotalItem)}</td>
            <td class="py-2 px-1 text-center">
                <button class="button-danger-outline button-icon-small remove-item-btn" title="Eliminar">&times;</button>
            </td>
        `;
        tbodyEl.appendChild(tr);

        // Eventos para cantidad y eliminar
        const cantidadInput = tr.querySelector('.item-cantidad');
        const removeButton = tr.querySelector('.remove-item-btn');
        if (cantidadInput) {
            cantidadInput.addEventListener('change', handleUpdateCantidadVenta(index, () => renderVentaItemsUI(tbodyEl)));
            cantidadInput.addEventListener('input', handleUpdateCantidadVenta(index, () => renderVentaItemsUI(tbodyEl)));
        }
        if (removeButton) {
            removeButton.addEventListener('click', handleRemoveItemVenta(index, () => renderVentaItemsUI(tbodyEl)));
        }
    });

    // Cálculo de descuento
    let montoDescontado = 0;
    if (descuentoAplicadoRestaurante) {
        let subtotalAfectado = 0;
        const aplicabilidad = descuentoAplicadoRestaurante.aplicabilidad;
        const itemsAplicables = descuentoAplicadoRestaurante.items_aplicables || [];

        if (aplicabilidad === 'reserva_total' || aplicabilidad === 'venta_total') {
            subtotalAfectado = subtotalBruto;
        } else if (aplicabilidad === 'categorias_restaurante') {
            ventaItems.forEach(item => {
                const platoInfo = platosCache.find(p => p.id === item.plato_id);
                if (platoInfo && itemsAplicables.includes(platoInfo.categoria_id)) {
                    subtotalAfectado += item.cantidad * item.precio_unitario;
                }
            });
        }
        montoDescontado = (descuentoAplicadoRestaurante.tipo === 'fijo')
            ? parseFloat(descuentoAplicadoRestaurante.valor)
            : subtotalAfectado * (parseFloat(descuentoAplicadoRestaurante.valor) / 100);
        montoDescontado = Math.min(subtotalBruto, montoDescontado);

        if (descuentoResumenEl && montoDescontado > 0) {
            const valorSpan = descuentoResumenEl.querySelector('#descuento-valor');
            if(valorSpan) valorSpan.textContent = `-${formatCurrencyLocal(montoDescontado)}`;
            descuentoResumenEl.style.display = 'flex';
        } else if (descuentoResumenEl) {
            descuentoResumenEl.style.display = 'none';
        }
    } else {
        if (descuentoResumenEl) descuentoResumenEl.style.display = 'none';
    }

    const totalFinal = subtotalBruto - montoDescontado;
    if(totalDisplayEl) totalDisplayEl.textContent = formatCurrencyLocal(totalFinal);
}

// --- TABS RENDERING ---

async function renderPlatosTab(tabContentEl, supabaseInstance, hotelId) {
    console.log("RESTAURANTE: Renderizando pestaña de Platos y Recetas...");
    currentTabListeners.forEach(({ element, type, handler }) => element?.removeEventListener(type, handler));
    currentTabListeners = [];

    tabContentEl.innerHTML = `
      <div class="p-4">
        <div class="flex flex-col sm:flex-row justify-between items-center mb-4 gap-2">
            <h3 class="text-lg font-semibold">Gestión de Menú y Recetas</h3>
            <button id="btn-nuevo-plato" class="button button-primary text-sm">
                <span class="mr-1">🍴</span>Nuevo Plato
            </button>
        </div>
        <div id="platos-feedback" class="feedback-message my-2" style="display:none;"></div>
        <div id="platos-loading" class="loading-indicator text-center py-3" style="display:none;"></div>
        <div id="lista-platos-container" class="overflow-x-auto bg-white shadow rounded-md"></div>
      </div>
      <div id="modal-plato" class="modal-container fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center p-4 z-50" style="display:none;"></div>
    `;

    const btnNuevoPlato = tabContentEl.querySelector('#btn-nuevo-plato');
    const modalPlatoEl = tabContentEl.querySelector('#modal-plato');
    const platosLoadingEl = tabContentEl.querySelector('#platos-loading');
    const platosFeedbackEl = tabContentEl.querySelector('#platos-feedback');
    let ingredientesDisponibles = [];

    const closePlatoModal = () => {
        if (modalPlatoEl) modalPlatoEl.style.display = 'none';
    };

    const openPlatoModal = async (plato = null) => {
        let recetaActual = [];
        const placeholderImg = 'https://via.placeholder.com/150'; // Puedes cambiar esto por una URL a una imagen por defecto

        modalPlatoEl.innerHTML = `
            <div class="modal-content bg-white p-5 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
              <form id="form-plato" class="flex flex-col flex-grow">
                <div class="flex justify-between items-center mb-4 pb-3 border-b">
                  <h4 class="text-xl font-semibold">${plato ? 'Editar' : 'Nuevo'} Plato</h4>
                  <button type="button" class="btn-cerrar-modal-plato text-gray-400 hover:text-gray-600 text-3xl">&times;</button>
                </div>
                <div class="flex-grow overflow-y-auto pr-2 grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="md:col-span-2 space-y-4">
                        <input type="hidden" name="id" value="${plato?.id || ''}">
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div><label class="form-label required">Nombre</label><input type="text" name="nombre" class="form-control" value="${plato?.nombre || ''}" required></div>
                            <div><label class="form-label">Categoría</label><input type="text" name="categoria" class="form-control" value="${plato?.categoria || ''}"></div>
                            <div><label class="form-label required">Precio</label><input type="number" name="precio" step="50" min="0" class="form-control" value="${plato?.precio || ''}" required></div>
                            <div class="pt-6"><label class="flex items-center"><input type="checkbox" name="activo" class="form-checkbox" ${plato?.activo ?? true ? 'checked' : ''}><span class="ml-2">Activo</span></label></div>
                        </div>
                        <div><label class="form-label">Descripción</label><textarea name="descripcion" rows="2" class="form-control">${plato?.descripcion || ''}</textarea></div>
                        <div class="pt-4 border-t">
                           <h5 class="text-md font-semibold mb-2">Receta del Plato</h5>
                           <div id="receta-items-list" class="space-y-2 mb-3 p-2 bg-gray-50 rounded-md border min-h-[40px]"></div>
                           <div class="flex items-end gap-2 p-2 bg-gray-100 rounded-b-md">
                              <div class="flex-grow"><label class="text-xs">Ingrediente</label><select id="select-ingrediente-receta" class="form-control form-control-sm"></select></div>
                              <div><label id="label-cantidad-receta" class="text-xs">Cantidad</label><input type="number" id="cantidad-ingrediente-receta" step="any" class="form-control form-control-sm w-24" placeholder="Cant."></div>
                              <button type="button" id="btn-add-ingrediente-receta" class="button button-primary button-small">Añadir</button>
                           </div>
                        </div>
                    </div>
                    <div class="md:col-span-1 space-y-2">
                        <label class="form-label">Foto del Plato</label>
                        <img id="plato-imagen-preview" src="${plato?.imagen_url || placeholderImg}" alt="Vista previa" class="w-full h-48 object-cover rounded-md bg-gray-200">
                        <input type="file" name="imagen" id="plato-imagen-input" class="form-control text-sm" accept="image/png, image/jpeg, image/webp">
                        <p class="text-xs text-gray-500">Sube una imagen para el plato (opcional).</p>
                    </div>
                </div>
                <div id="modal-plato-feedback" class="feedback-message my-2" style="display:none;"></div>
                <div class="flex justify-end gap-3 mt-5 pt-4 border-t">
                  <button type="button" class="btn-cerrar-modal-plato button button-danger">Cancelar</button>
                  <button type="submit" id="btn-guardar-plato" class="button button-success">Guardar Cambios</button>
                </div>
              </form>
            </div>`;
        modalPlatoEl.style.display = 'flex';

        const formPlatoEl = modalPlatoEl.querySelector('#form-plato');
        const modalFeedbackEl = modalPlatoEl.querySelector('#modal-plato-feedback');
        
        const selectIngredienteEl = modalPlatoEl.querySelector('#select-ingrediente-receta');
        const cantidadInputEl = modalPlatoEl.querySelector('#cantidad-ingrediente-receta');
        const btnAddIngrediente = modalPlatoEl.querySelector('#btn-add-ingrediente-receta');
        const recetaItemsListEl = modalPlatoEl.querySelector('#receta-items-list');

        const imagenInput = modalPlatoEl.querySelector('#plato-imagen-input');
        const imagenPreview = modalPlatoEl.querySelector('#plato-imagen-preview');

        imagenInput.onchange = () => {
            const file = imagenInput.files[0];
            if (file) {
                imagenPreview.src = URL.createObjectURL(file);
            }
        };

        const renderRecetaUI = () => {
            recetaItemsListEl.innerHTML = '';
            if (recetaActual.length === 0) {
                recetaItemsListEl.innerHTML = '<p class="text-xs text-center text-gray-500 py-2">Añade ingredientes.</p>';
                return;
            }
            recetaActual.forEach((item, index) => {
                const info = ingredientesDisponibles.find(i => i.id === item.ingrediente_id);
                const itemEl = document.createElement('div');
                itemEl.className = 'flex justify-between items-center bg-white p-2 rounded border text-sm';
                itemEl.innerHTML = `<span>${info?.nombre}</span><div class="flex items-center gap-2"><span class="font-semibold">${item.cantidad} ${info?.unidad_medida}</span><button type="button" data-index="${index}" class="btn-remove-receta-item text-red-500">&times;</button></div>`;
                recetaItemsListEl.appendChild(itemEl);
            });
            recetaItemsListEl.querySelectorAll('.btn-remove-receta-item').forEach(btn => {
                btn.onclick = (e) => {
                    recetaActual.splice(parseInt(e.currentTarget.dataset.index), 1);
                    renderRecetaUI();
                };
            });
        };

        ingredientesDisponibles = await getIngredientesList(supabaseInstance, hotelId);
        selectIngredienteEl.innerHTML = '<option value="">Seleccionar...</option>' + ingredientesDisponibles.map(ing => `<option value="${ing.id}" data-unidad="${ing.unidad_medida}">${ing.nombre}</option>`).join('');
        
        if (plato?.id) {
            const { data } = await supabaseInstance.from('platos_recetas').select('*').eq('plato_id', plato.id);
            recetaActual = data?.map(item => ({ ingrediente_id: item.ingrediente_id, cantidad: item.cantidad })) || [];
        }
        renderRecetaUI();

        btnAddIngrediente.onclick = () => {
            const id = selectIngredienteEl.value;
            const cant = parseFloat(cantidadInputEl.value);
            if (!id || isNaN(cant) || cant <= 0 || recetaActual.some(i => i.ingrediente_id === id)) return;
            recetaActual.push({ ingrediente_id: id, cantidad: cant });
            renderRecetaUI();
            selectIngredienteEl.value = '';
            cantidadInputEl.value = '';
        };
        
        modalPlatoEl.querySelectorAll('.btn-cerrar-modal-plato').forEach(btn => btn.onclick = closePlatoModal);
        
        formPlatoEl.onsubmit = async (e) => {
            e.preventDefault();
            const formData = new FormData(formPlatoEl);
            const platoId = formData.get('id');
            const submitButton = formPlatoEl.querySelector('#btn-guardar-plato');
            
            setFormLoadingState(formPlatoEl, true, submitButton, "Guardar Cambios", "Guardando...");
            try {
                let imagenUrl = plato?.imagen_url || null;
                const imagenFile = formData.get('imagen');

                if (imagenFile && imagenFile.size > 0) {
                    const filePath = `public/${hotelId}/plato_${Date.now()}_${imagenFile.name.replace(/\s/g, '_')}`;
                    const { error: uploadError } = await supabaseInstance.storage.from('platos-imagenes').upload(filePath, imagenFile);
                    if (uploadError) throw uploadError;
                    const { data: urlData } = supabaseInstance.storage.from('platos-imagenes').getPublicUrl(filePath);
                    imagenUrl = urlData.publicUrl;
                }

                const platoData = {
                    hotel_id: hotelId,
                    nombre: formData.get('nombre'),
                    categoria: formData.get('categoria') || null,
                    precio: parseFloat(formData.get('precio')),
                    activo: formData.get('activo') === 'on',
                    descripcion: formData.get('descripcion') || null,
                    imagen_url: imagenUrl
                };

                let savedPlatoId = platoId;
                if (platoId) {
                    const { error } = await supabaseInstance.from('platos').update(platoData).eq('id', platoId);
                    if (error) throw error;
                } else {
                    const { data, error } = await supabaseInstance.from('platos').insert(platoData).select('id').single();
                    if (error) throw error;
                    savedPlatoId = data.id;
                }

                await supabaseInstance.from('platos_recetas').delete().eq('plato_id', savedPlatoId);
                if (recetaActual.length > 0) {
                    const recetaData = recetaActual.map(item => ({ plato_id: savedPlatoId, hotel_id: hotelId, ...item }));
                    const { error } = await supabaseInstance.from('platos_recetas').insert(recetaData);
                    if (error) throw error;
                }
                
                showRestauranteFeedback(platosFeedbackEl, '¡Plato guardado!', 'success-indicator');
                closePlatoModal();
                cargarYRenderizarPlatos();

            } catch (err) {
                showRestauranteFeedback(modalFeedbackEl, err.message, 'error-indicator', 0);
            } finally {
                setFormLoadingState(formPlatoEl, false, submitButton, "Guardar Cambios");
            }
        };
    };

    const renderTablaPlatos = (platos) => {
        const container = tabContentEl.querySelector('#lista-platos-container');
        if (!platos?.length) {
            container.innerHTML = '<p class="text-center text-gray-500 py-6">No hay platos registrados.</p>';
            return;
        }
        container.innerHTML = `
            <table class="tabla-estilizada w-full">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="p-2 text-left">Imagen</th>
                        <th class="p-2 text-left">Nombre</th>
                        <th class="p-2 text-left">Categoría</th>
                        <th class="p-2 text-right">Precio</th>
                        <th class="p-2 text-center">Activo</th>
                        <th class="p-2 text-center">Acciones</th>
                    </tr>
                </thead>
                <tbody class="divide-y">
                    ${platos.map(p => `
                        <tr data-id="${p.id}" class="hover:bg-gray-50">
                            <td class="p-2">
                                <img src="${p.imagen_url || 'https://via.placeholder.com/150'}" alt="${p.nombre}" class="w-12 h-12 rounded-md object-cover bg-gray-200">
                            </td>
                            <td class="p-2 font-medium">${p.nombre}</td>
                            <td class="p-2">${p.categoria || 'N/A'}</td>
                            <td class="p-2 text-right">${formatCurrencyLocal(p.precio)}</td>
                            <td class="p-2 text-center"><span class="px-2 py-1 text-xs rounded-full ${p.activo ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${p.activo ? 'Sí' : 'No'}</span></td>
                            <td class="p-2 text-center"><button class="button button-outline button-small btn-editar-plato">Editar</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;

        container.querySelectorAll('.btn-editar-plato').forEach(btn => {
            btn.onclick = () => {
                const plato = platosCache.find(p => p.id === btn.closest('tr').dataset.id);
                openPlatoModal(plato);
            };
        });
    };

    const cargarYRenderizarPlatos = async () => {
        showRestauranteLoading(platosLoadingEl, true);
        try {
            const { data, error } = await supabaseInstance.from('platos').select('*').eq('hotel_id', hotelId).order('nombre');
            if (error) throw error;
            platosCache = data || [];
            renderTablaPlatos(platosCache);
        } catch (err) {
            showRestauranteFeedback(platosFeedbackEl, `Error: ${err.message}`, 'error-indicator', 0);
        } finally {
            showRestauranteLoading(platosLoadingEl, false);
        }
    };

    btnNuevoPlato.addEventListener('click', () => openPlatoModal(null));
    await cargarYRenderizarPlatos();
}



async function renderRegistrarVentaTab(tabContentEl, supabaseInstance, hotelId, moduleUser) {
    currentTabListeners.forEach(({ element, type, handler }) => element?.removeEventListener(type, handler));
    currentTabListeners = [];
    ventaItems = [];

    tabContentEl.innerHTML = `
      <section id="pos-restaurante" class="p-4 sm:p-6 lg:p-8 bg-slate-100 dark:bg-slate-900">

    <div class="pos-layout grid grid-cols-1 lg:grid-cols-5 gap-6 lg:items-start">

        <div class="lg:col-span-3 pos-platos-grid bg-white dark:bg-slate-800 p-4 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 flex flex-col h-[calc(100vh-150px)]">
            <div class="flex flex-col sm:flex-row justify-between items-center mb-4 pb-4 border-b border-slate-200 dark:border-slate-700">
                <h4 class="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2 sm:mb-0">Platos Disponibles</h4>
                <div class="relative w-full sm:w-64">
                    <span class="absolute inset-y-0 left-0 flex items-center pl-3">
                        <svg class="w-5 h-5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    </span>
                    <input type="text" id="pos-filtro-platos" class="form-control w-full pl-10 pr-4 py-2 text-sm border-slate-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white" placeholder="Buscar plato...">
                </div>
            </div>
            <div id="pos-platos-disponibles-render-area" class="flex-grow overflow-y-auto pr-2 -mr-2"></div>
        </div>

        <div class="lg:col-span-2 pos-pedido-card bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 flex flex-col h-fit max-h-[calc(100vh-150px)]">
            
            <div class="card-header p-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3 flex-shrink-0">
                <svg class="w-6 h-6 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
                <h5 class="font-bold text-xl text-slate-800 dark:text-slate-100">Pedido Actual</h5>
            </div>
            
            <div class="flex-grow overflow-y-auto p-4 space-y-6">
                
                <table class="w-full text-sm">
                    <thead>
                        <tr>
                            <th class="p-2 text-left font-medium text-slate-500 dark:text-slate-400">Plato</th>
                            <th class="p-2 text-center font-medium text-slate-500 dark:text-slate-400 w-16">Cant.</th>
                            <th class="p-2 text-right font-medium text-slate-500 dark:text-slate-400">Subtotal</th>
                            <th class="w-8"></th>
                        </tr>
                    </thead>
                    <tbody id="pos-pedido-items-body" class="divide-y divide-slate-200 dark:divide-slate-700">
                        </tbody>
                </table>
                
                <form id="form-finalizar-venta-restaurante" class="space-y-4">
                    <div>
                        <label for="codigo-descuento-restaurante" class="form-label text-xs mb-1">Código de Descuento</label>
                        <div class="flex items-center gap-2">
                            <input type="text" id="codigo-descuento-restaurante" class="form-control form-control-sm flex-grow" placeholder="CÓDIGO...">
                            <button type="button" id="btn-aplicar-descuento-restaurante" class="button button-info button-small">Aplicar</button>
                        </div>
                        <div id="feedback-descuento-restaurante" class="text-xs mt-1 h-4"></div>
                        <div id="descuento-resumen-restaurante" class="flex justify-between text-sm font-semibold text-green-600 dark:text-green-500 mt-2" style="display: none;">
                            <span>Descuento Aplicado:</span>
                            <span id="descuento-valor">-$0.00</span>
                        </div>
                    </div>

                    <div>
                        <label for="venta-restaurante-modo" class="form-label text-sm font-medium text-slate-700 dark:text-slate-300">Modo de Venta</label>
                        <select id="venta-restaurante-modo" name="modoVenta" class="form-control mt-1" required>
                            <option value="inmediato">Pago Inmediato</option>
                            <option value="habitacion">Cargar a Habitación</option>
                        </select>
                    </div>
                    <div id="grupo-metodo-pago-restaurante">
                        <label for="venta-restaurante-metodo-pago" class="form-label text-sm font-medium text-slate-700 dark:text-slate-300">Método de Pago</label>
                        <select id="venta-restaurante-metodo-pago" name="metodoPagoId" class="form-control mt-1"></select>
                    </div>
                    <div id="grupo-habitacion-restaurante" style="display:none;">
                        <label for="venta-restaurante-habitacion" class="form-label text-sm font-medium text-slate-700 dark:text-slate-300">Habitación</label>
                        <select id="venta-restaurante-habitacion" name="habitacionId" class="form-control mt-1"></select>
                    </div>
                    <div>
                        <label for="venta-restaurante-cliente" class="form-label text-sm font-medium text-slate-700 dark:text-slate-300">Cliente (Opcional)</label>
                        <input type="text" id="venta-restaurante-cliente" name="clienteNombre" class="form-control mt-1" placeholder="Nombre o # Hab.">
                    </div>
                </form>
            </div>

            <div class="card-footer p-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
                <div class="flex justify-between items-baseline mb-4">
                    <span class="text-lg font-bold text-slate-700 dark:text-slate-200">Total:</span>
                    <span id="venta-restaurante-total" class="text-3xl font-extrabold text-blue-600 dark:text-blue-500">$0</span>
                </div>
                <button type="submit" form="form-finalizar-venta-restaurante" id="btn-finalizar-venta-restaurante" class="button button-success w-full py-3 text-base font-bold flex items-center justify-center gap-2">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                    Registrar Venta
                </button>
            </div>
        </div>
    </div>
    <div id="posVentaFeedback" style="display:none;" class="feedback-message mt-4"></div>
</section>`;

    // --- Obtener referencias de UI ---
    const posPlatosRenderAreaEl = tabContentEl.querySelector('#pos-platos-disponibles-render-area');
    const posPedidoItemsBodyEl = tabContentEl.querySelector('#pos-pedido-items-body');
    const formFinalizarVentaEl = tabContentEl.querySelector('#form-finalizar-venta-restaurante');
    const selectMetodoPagoVentaEl = tabContentEl.querySelector('#venta-restaurante-metodo-pago');
    const selectModoVentaEl = tabContentEl.querySelector('#venta-restaurante-modo');
    const selectHabitacionEl = tabContentEl.querySelector('#venta-restaurante-habitacion');
    const grupoMetodoPagoEl = tabContentEl.querySelector('#grupo-metodo-pago-restaurante');
    const grupoHabitacionEl = tabContentEl.querySelector('#grupo-habitacion-restaurante');
    const btnFinalizarVentaEl = tabContentEl.querySelector('#btn-finalizar-venta-restaurante');
    const posFeedbackEl = tabContentEl.querySelector('#posVentaFeedback');
    const filtroPlatosInputEl = tabContentEl.querySelector('#pos-filtro-platos');
    const btnAplicarDescuento = tabContentEl.querySelector('#btn-aplicar-descuento-restaurante');

    // --- Listeners Descuento ---
    if (btnAplicarDescuento) {
        btnAplicarDescuento.addEventListener('click', handleAplicarDescuentoRestaurante);
        currentTabListeners.push({ element: btnAplicarDescuento, type: 'click', handler: handleAplicarDescuentoRestaurante });
    }

    // --- Cargar datos y renderizar POS ---
    const restauranteLoadingEl = document.getElementById('restaurante-loading');
    showRestauranteLoading(restauranteLoadingEl, true, "Cargando POS...");
    try {
        const [ { data: platos }, { data: metodos }, { data: habitaciones } ] = await Promise.all([
            supabaseInstance.from('platos').select('*').eq('hotel_id', hotelId).eq('activo', true).order('nombre'),
            supabaseInstance.from('metodos_pago').select('id, nombre').eq('hotel_id', hotelId).eq('activo', true).order('nombre'),
            supabaseInstance.from('habitaciones').select('id, nombre').eq('hotel_id', hotelId).eq('estado', 'ocupada').order('nombre')
        ]);
        platosCache = platos || [];
        metodosPagoCache = metodos || [];
        renderPOSPlatosUI(posPlatosRenderAreaEl, platosCache, plato => {
            const item = ventaItems.find(i => i.plato_id === plato.id);
            if(item) item.cantidad++; else ventaItems.push({ plato_id: plato.id, nombre_plato: plato.nombre, cantidad: 1, precio_unitario: plato.precio });
            renderVentaItemsUI(posPedidoItemsBodyEl);
        });
        selectMetodoPagoVentaEl.innerHTML = `<option value="mixto" selected>Pago Mixto</option>` + metodosPagoCache.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('');
        selectHabitacionEl.innerHTML = (habitaciones || []).length > 0 ? `<option value="">Seleccione</option>` + habitaciones.map(h => `<option value="${h.id}">${h.nombre}</option>`).join('') : '<option disabled>No hay habitaciones ocupadas</option>';
        renderVentaItemsUI(posPedidoItemsBodyEl);
    } catch (e) {
        showRestauranteFeedback(posFeedbackEl, `Error al cargar POS: ${e.message}`, 'error-indicator', 0);
    } finally {
        showRestauranteLoading(restauranteLoadingEl, false);
    }

    filtroPlatosInputEl.oninput = () => {
        const platosFiltrados = platosCache.filter(p => p.nombre.toLowerCase().includes(filtroPlatosInputEl.value.toLowerCase()));
        renderPOSPlatosUI(posPlatosRenderAreaEl, platosFiltrados, plato => {
            const item = ventaItems.find(i => i.plato_id === plato.id);
            if(item) item.cantidad++; else ventaItems.push({ plato_id: plato.id, nombre_plato: plato.nombre, cantidad: 1, precio_unitario: plato.precio });
            renderVentaItemsUI(posPedidoItemsBodyEl);
        });
    };

    selectModoVentaEl.onchange = () => {
        grupoMetodoPagoEl.style.display = selectModoVentaEl.value === "inmediato" ? "" : "none";
        grupoHabitacionEl.style.display = selectModoVentaEl.value === "habitacion" ? "" : "none";
    };
    selectModoVentaEl.dispatchEvent(new Event('change'));

    // --- Handler Finalizar Venta ---
    const finalizarVentaHandler = async (e) => {
        e.preventDefault();
        clearRestauranteFeedback(posFeedbackEl);
        if (ventaItems.length === 0) { showRestauranteFeedback(posFeedbackEl, "El pedido está vacío.", 'error-indicator'); return; }

        const modo = selectModoVentaEl.value;
        const totalVenta = ventaItems.reduce((acc, item) => acc + item.cantidad * item.precio_unitario, 0);
        const cliente = formFinalizarVentaEl.elements.clienteNombre.value.trim() || null;

        if (modo === "inmediato") {
            const metodoId = selectMetodoPagoVentaEl.value;
            if (metodoId === "mixto") {
                await mostrarModalPagoMixtoRestaurante(totalVenta, metodosPagoCache, async (pagos) => {
                    if (pagos) await registrarVentaRestauranteConPagos({ pagos, montoTotalVenta: totalVenta, nombreClienteTemporal: cliente });
                });
            } else {
                await registrarVentaRestauranteConPagos({ pagos: [{ metodo_pago_id: metodoId, monto: totalVenta }], montoTotalVenta: totalVenta, nombreClienteTemporal: cliente });
            }
        } else { // Cargar a habitación
            const habitacionId = selectHabitacionEl.value;
            if (!habitacionId) { showRestauranteFeedback(posFeedbackEl, "Seleccione una habitación.", 'error-indicator'); return; }
            
            setFormLoadingState(formFinalizarVentaEl, true, btnFinalizarVentaEl, "Registrar Venta", "Cargando...");
            try {
                const { data: reserva, error: errRes } = await supabaseInstance.from('reservas').select('id').eq('habitacion_id', habitacionId).in('estado', ['activa', 'ocupada']).limit(1).single();
                if (errRes) throw new Error("No hay reserva activa en la habitación.");
                const { data: ventaData, error: errVenta } = await supabaseInstance.from('ventas_restaurante').insert({
                    hotel_id: hotelId, usuario_id: moduleUser.id, habitacion_id: habitacionId,
                    reserva_id: reserva.id, monto_total: totalVenta,
                }).select().single();
                if(errVenta) throw errVenta;
                
                const itemsParaInsertar = ventaItems.map(item => ({ 
                    venta_id: ventaData.id, 
                    plato_id: item.plato_id, 
                    cantidad: item.cantidad, 
                    precio_unitario_venta: item.precio_unitario, 
                    subtotal: item.precio_unitario * item.cantidad 
                }));
                await supabaseInstance.from('ventas_restaurante_items').insert(itemsParaInsertar);
                
                showRestauranteFeedback(posFeedbackEl, `Consumo cargado a la habitación.`, 'success-indicator');
                ventaItems = []; renderVentaItemsUI(posPedidoItemsBodyEl); formFinalizarVentaEl.reset();
            } catch (err) {
                showRestauranteFeedback(posFeedbackEl, err.message, 'error-indicator');
            } finally {
                setFormLoadingState(formFinalizarVentaEl, false, btnFinalizarVentaEl, "Registrar Venta");
            }
        }
    };
    // Agrega el handler UNA SOLA VEZ
    formFinalizarVentaEl.addEventListener('submit', finalizarVentaHandler);
    currentTabListeners.push({ element: formFinalizarVentaEl, type: 'submit', handler: finalizarVentaHandler });
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

    const hoy = new Date();
    const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
    fechaInicioInput.value = primerDiaMes;
    fechaFinInput.value = hoy.toISOString().split('T')[0];
    cargarYRenderizarHistorial(fechaInicioInput.value, fechaFinInput.value);
  }

function mostrarDetallesVentaModal(venta) {
      let modalDetallesEl = document.getElementById('modal-detalles-venta-restaurante');
      if (!modalDetallesEl) {
          modalDetallesEl = document.createElement('div');
          modalDetallesEl.id = 'modal-detalles-venta-restaurante';
          modalDetallesEl.className = 'modal-container fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center p-4 z-[60]';
          document.body.appendChild(modalDetallesEl);
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
      
      const cerrarModalHandler = () => { modalDetallesEl.style.display = 'none'; };
      modalDetallesEl.querySelectorAll('.btn-cerrar-detalles-modal').forEach(btn => btn.addEventListener('click', cerrarModalHandler));
      modalDetallesEl.addEventListener('click', (e) => { if (e.target === modalDetallesEl) cerrarModalHandler(); });
}

async function renderInventarioTab(tabContentEl, supabaseInstance, hotelId, currentUser) {
    await inventarioModule.mount(tabContentEl, supabaseInstance, currentUser, hotelId);
}

// --- Main Module Mount & Unmount ---
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
              <button class="tab-button button button-outline text-xs sm:text-sm py-1.5 px-2.5 rounded-md" data-tab="inventario">Inventario</button>
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
            btn.classList.toggle('active', btn.dataset.tab === tabName);
            btn.classList.toggle('button-primary', btn.dataset.tab === tabName);
        });

        if (activeSubmodule && activeSubmodule.unmount) {
            activeSubmodule.unmount();
            activeSubmodule = null;
        }
        
        showRestauranteLoading(loadingGlobalEl, true, `Cargando pestaña ${tabName}...`);

        try {
            if (tabName === 'platos') {
                await renderPlatosTab(tabContentEl, currentSupabaseInstance, currentHotelId);
            } else if (tabName === 'registrar-venta') {
                await renderRegistrarVentaTab(tabContentEl, currentSupabaseInstance, currentHotelId, currentModuleUser);
            } else if (tabName === 'historial-ventas') {
                await renderHistorialVentasTab(tabContentEl, currentSupabaseInstance, currentHotelId);
            } else if (tabName === 'inventario') {
                await renderInventarioTab(tabContentEl, currentSupabaseInstance, currentHotelId, currentModuleUser);
                activeSubmodule = inventarioModule;
            }
        } catch (err) {
            console.error(`Error loading tab ${tabName}:`, err);
            showRestauranteFeedback(feedbackGlobalEl, `Error al cargar la pestaña: ${err.message}`, 'error-indicator', 0);
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
    moduleRootListeners.forEach(({ element, type, handler }) => element?.removeEventListener(type, handler));
    moduleRootListeners = [];
    currentTabListeners.forEach(({ element, type, handler }) => element?.removeEventListener(type, handler));
    currentTabListeners = [];
    platosCache = [];
    metodosPagoCache = [];
    ventaItems = [];
    ventasHistorialCache = [];
    currentHotelId = null;
    currentModuleUser = null;
    currentSupabaseInstance = null;
    if (activeSubmodule && activeSubmodule.unmount) {
        activeSubmodule.unmount();
        activeSubmodule = null;
    }
    const modalDetallesVenta = document.getElementById('modal-detalles-venta-restaurante');
    if (modalDetallesVenta) modalDetallesVenta.remove();
    console.log('Restaurante module unmounted.');
}