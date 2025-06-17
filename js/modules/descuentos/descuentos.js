// js/modules/descuentos/descuentos.js
import { formatCurrency, formatDateShort, showError, showSuccess, clearFeedback, setFormLoadingState, showConfirmationModal } from '/js/uiUtils.js';

let moduleListeners = []; // Centralized array for event listeners
let currentHotelId = null; // Stores the hotel ID for the current session of this module

/**
 * =================================================================================
 * NUEVA FUNCIÓN: Generador de Tarjeta de Descuento
 * Crea un modal con una representación visual del descuento, descargable y enviable.
 * Requiere la librería html2canvas para la descarga de imagen.
 * <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
 * =================================================================================
 */
/**
 * =================================================================================
 * FUNCIÓN COMPLETA Y CORREGIDA: Generador de Tarjeta de Descuento
 * Crea un modal con una tarjeta de descuento, la clona para una captura de imagen
 * de alta calidad y permite descargarla o enviarla por email.
 * Requiere la librería html2canvas: <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
 * =================================================================================
 */
async function generateDiscountCard(discount, logoUrl, supabaseInstance) {
    // 1. Dibuja el modal en la página
    const modalHtml = `
    <div id="card-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:1050; backdrop-filter: blur(5px);">
      <div class="card" style="max-width: 450px; width: 90%; background: transparent; border: none; box-shadow: none;">
        
        <div id="discount-card-container" 
             style="
                background-color: #1a202c;
                background-image: radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0);
                background-size: 25px 25px;
             "
             class="text-white rounded-2xl shadow-2xl overflow-hidden font-sans flex flex-col justify-between h-[580px]">
            
            <div class="p-6 text-center border-b border-gray-700">
                ${logoUrl ? `<img src="${logoUrl}" alt="Logo del Hotel" class="max-h-16 object-contain mx-auto"/>` : `<div class="h-16"></div>`}
            </div>

            <div class="p-6 text-center flex-grow flex flex-col justify-center">
                <h4 class="text-2xl font-light text-gray-300 tracking-wider">${discount.nombre}</h4>
                <p class="text-7xl font-bold my-3 text-white tracking-tighter">${discount.tipo === 'porcentaje' ? `${discount.valor}%` : formatCurrency(discount.valor)}</p>
                <p class="text-xl font-semibold bg-clip-text text-transparent bg-gradient-to-r from-yellow-300 to-amber-500">DE DESCUENTO</p>
            </div>

            <div class="bg-black bg-opacity-20 p-6 text-center">
                ${discount.codigo 
                    ? `<div>
                         <p class="text-sm text-gray-400">Usa este código en tu próxima visita:</p>
                         <p class="font-mono text-3xl bg-gray-700 text-white rounded-lg px-6 py-2 my-2 inline-block border border-gray-600 shadow-inner">${discount.codigo}</p>
                       </div>` 
                    : `<p class="text-lg font-semibold text-gray-200">Promoción Automática</p>`
                }
                <div class="text-xs text-gray-400 mt-4">
                  <p><strong>Válido:</strong> ${discount.fecha_inicio ? `Del ${formatDateShort(discount.fecha_inicio)} al ${formatDateShort(discount.fecha_fin)}` : 'Contactar para validez'}</p>
                </div>
            </div>
        </div>

        <div class="mt-4 p-4 bg-white rounded-lg shadow-lg flex flex-wrap items-center gap-2">
            <button id="download-card-btn" class="button button-primary">Descargar</button>
            <input type="email" id="email-recipient-input" placeholder="correo@cliente.com" class="form-control flex-grow" />
            <button id="email-card-btn" class="button button-success">Enviar</button>
            <button id="modal-close-btn" class="button button-neutral ml-auto">Cerrar</button>
        </div>
        <div id="email-feedback" class="text-sm mt-2 p-2 bg-white rounded"></div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 2. Obtener referencias a los elementos del modal
    const modal = document.getElementById('card-modal');
    const emailFeedbackEl = document.getElementById('email-feedback');
    const downloadBtn = document.getElementById('download-card-btn');
    const emailBtn = document.getElementById('email-card-btn');
    const closeBtn = document.getElementById('modal-close-btn');

    // 3. Función de limpieza para remover el modal y el clon
    const cleanup = () => {
        const clone = document.getElementById('discount-card-for-download');
        if (clone) clone.remove();
        modal.remove();
    };
    
    // Asignar eventos de cierre
    closeBtn.onclick = cleanup;
    modal.onclick = (e) => { 
        if (e.target.id === 'card-modal') cleanup(); 
    };

    // 4. Lógica para descargar la tarjeta (usa un clon para calidad)
    downloadBtn.onclick = async () => {
        const cardOriginal = document.getElementById('discount-card-container');
        if (!cardOriginal) return;

        // Crear clon, posicionarlo fuera de pantalla y darle un ancho fijo
        const cardClone = cardOriginal.cloneNode(true);
        cardClone.id = 'discount-card-for-download';
        cardClone.style.position = 'absolute';
        cardClone.style.left = '-9999px';
        cardClone.style.width = '450px';
        document.body.appendChild(cardClone);

        try {
            const canvas = await html2canvas(cardClone, { scale: 2, useCORS: true });
            const link = document.createElement('a');
            link.download = `descuento-${discount.nombre.replace(/\s+/g, '-')}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch (error) {
            console.error("Error al generar la imagen:", error);
            alert("Hubo un error al generar la imagen de la tarjeta.");
        } finally {
            // Limpiar después de la operación
            cleanup();
        }
    };

    // 5. Lógica para enviar por email
    emailBtn.onclick = async (e) => {
        const button = e.currentTarget;
        const recipient = document.getElementById('email-recipient-input').value;
        if (!recipient) {
            emailFeedbackEl.textContent = 'Por favor, ingresa un email.';
            emailFeedbackEl.className = 'text-sm mt-2 text-red-600';
            return;
        }
        button.disabled = true;
        button.textContent = 'Enviando...';
        emailFeedbackEl.textContent = '';

        // Clonar la tarjeta para la captura
        const cardOriginal = document.getElementById('discount-card-container');
        if (!cardOriginal) return;
        const cardClone = cardOriginal.cloneNode(true);
        cardClone.id = 'discount-card-for-download';
        cardClone.style.position = 'absolute';
        cardClone.style.left = '-9999px';
        cardClone.style.width = '450px';
        document.body.appendChild(cardClone);

        try {
            const canvas = await html2canvas(cardClone, { scale: 2, useCORS: true });
            const imageBase64 = canvas.toDataURL().split('base64,')[1];

            const { error } = await supabaseInstance.functions.invoke('send-discount-email', {
                body: { recipient, imageBase64, discountName: discount.nombre, hotelId: currentHotelId }
            });

            if (error) throw error;
            emailFeedbackEl.textContent = '¡Email enviado con éxito!';
            emailFeedbackEl.className = 'text-sm mt-2 text-green-700';
            document.getElementById('email-recipient-input').value = '';
        } catch (err) {
            console.error("Error sending discount email:", err);
            emailFeedbackEl.textContent = `Error al enviar: ${err.message}`;
            emailFeedbackEl.className = 'text-sm mt-2 text-red-600';
        } finally {
            button.disabled = false;
            button.textContent = 'Enviar';
            // Siempre limpiar el clon
            const clone = document.getElementById('discount-card-for-download');
            if (clone) clone.remove();
        }
    };
}

/**
 * Carga las habitaciones activas del hotel en un selector.
 */
async function loadHabitacionesParaSelector(selectEl, supabaseInstance, hotelId) {
    console.log('[Descuentos.js] Cargando habitaciones para el selector...');
    if (!selectEl) return;
    try {
        const { data, error } = await supabaseInstance
            .from('habitaciones')
            .select('id, nombre')
            .eq('hotel_id', hotelId)
            .eq('activo', true)
            .order('nombre');
        
        if (error) throw error;
        selectEl.innerHTML = data.map(h => `<option value="${h.id}">${h.nombre}</option>`).join('');
    } catch (err) {
        console.error("Error cargando habitaciones para el selector:", err);
        selectEl.innerHTML = '<option disabled>Error al cargar habitaciones</option>';
    }
}

/**
 * Carga los clientes del hotel en un selector.
 */
// Carga los clientes del hotel en un selector.
async function loadClientesParaSelector(selectEl, supabaseInstance, hotelId) {
    if (!selectEl) return;
    try {
        const { data, error } = await supabaseInstance
            .from('clientes') // Asumiendo que tu tabla se llama 'clientes'
            .select('id, nombre') // Corregido: Se elimina la columna 'apellido'
            .eq('hotel_id', hotelId)
            .order('nombre');
        
        if (error) throw error;
        selectEl.innerHTML = '<option value="">Seleccione un cliente...</option>' + 
                             data.map(c => `<option value="${c.id}">${c.nombre}</option>`).join(''); // Corregido: Se elimina c.apellido
    } catch (err) {
        console.error("Error cargando clientes para el selector:", err);
        selectEl.innerHTML = '<option disabled>Error al cargar clientes</option>';
    }
}


// INICIA CÓDIGO A PEGAR

/**
 * Carga los servicios adicionales activos del hotel en un selector.
 */
async function loadServiciosParaSelector(selectEl, supabaseInstance, hotelId) {
    if (!selectEl) return;
    try {
        const { data, error } = await supabaseInstance
            .from('servicios_adicionales')
            .select('id, nombre')
            .eq('hotel_id', hotelId)
            .eq('activo', true)
            .order('nombre');
        
        if (error) throw error;
        selectEl.innerHTML = data.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
    } catch (err) {
        console.error("Error cargando servicios para el selector:", err);
        selectEl.innerHTML = '<option disabled>Error al cargar servicios</option>';
    }
}

/**
 * Carga los productos activos de la tienda en un selector.
 */
async function loadProductosParaSelector(selectEl, supabaseInstance, hotelId) {
    if (!selectEl) return;
    try {
        const { data, error } = await supabaseInstance
            .from('productos_tienda')
            .select('id, nombre')
            .eq('hotel_id', hotelId)
            .eq('activo', true)
            .order('nombre');
        
        if (error) throw error;
        selectEl.innerHTML = data.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
    } catch (err) {
        console.error("Error cargando productos para el selector:", err);
        selectEl.innerHTML = '<option disabled>Error al cargar productos</option>';
    }
}



// INICIA CÓDIGO A PEGAR

/**
 * Carga las categorías activas del restaurante en un selector.
 */
async function loadCategoriasRestauranteParaSelector(selectEl, supabaseInstance, hotelId) {
    if (!selectEl) return;
    try {
        const { data, error } = await supabaseInstance
            .from('categorias_producto') // La tabla de categorías del restaurante
            .select('id, nombre')
            .eq('hotel_id', hotelId)
            .eq('activa', true)
            .order('nombre');
        
        if (error) throw error;
        selectEl.innerHTML = data.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
    } catch (err) {
        console.error("Error cargando categorías de restaurante para el selector:", err);
        selectEl.innerHTML = '<option disabled>Error al cargar categorías</option>';
    }
}


function toggleFormVisibility(formEl) {
    const tipoGeneral = formEl.tipo_descuento_general.value;
    const aplicabilidad = formEl.aplicabilidad.value;

    const setVisibility = (containerId, isVisible, isRequired = true) => {
        const container = formEl.querySelector(`#${containerId}-container`);
        if (container) container.style.display = isVisible ? 'block' : 'none';
        const input = formEl.querySelector(`#${containerId.split('-')[0]}`);
        if (input) input.required = isVisible && isRequired;
    };

    setVisibility('codigo', tipoGeneral === 'codigo');
    setVisibility('cliente', tipoGeneral === 'cliente_especifico');
    setVisibility('rango-fechas', tipoGeneral === 'automatico');
    
    const aplicabilidadContainer = formEl.querySelector('#aplicabilidad-container');
    if (aplicabilidadContainer) {
        aplicabilidadContainer.style.display = tipoGeneral !== 'cliente_especifico' ? 'block' : 'none';
    }

    // Ocultar todos los selectores de items específicos primero
    formEl.querySelectorAll('.items-container').forEach(el => el.style.display = 'none');

    // Mostrar solo el selector relevante y poner required SOLO si es categorias_restaurante
    if (tipoGeneral !== 'cliente_especifico') {
        const containerToShow = formEl.querySelector(`#items-${aplicabilidad}-container`);
        if(containerToShow) {
            containerToShow.style.display = 'block';
            // Si es categorias_restaurante, obligar selección
            if (aplicabilidad === 'categorias_restaurante') {
                const selectCategorias = formEl.querySelector('#items_categorias_restaurante');
                if (selectCategorias) selectCategorias.required = true;
            } else {
                const selectCategorias = formEl.querySelector('#items_categorias_restaurante');
                if (selectCategorias) selectCategorias.required = false;
            }
        }
    }
}
/**
 * Carga y renderiza la lista de descuentos.
 */
// Carga y renderiza la lista de descuentos.
/**
 * Carga y renderiza la lista de descuentos (VERSIÓN TEMPORAL SIN JOIN)
 */
// REEMPLAZA ESTA FUNCIÓN COMPLETA EN descuentos.js

async function loadAndRenderDiscounts(tbodyEl, supabaseInstance, hotelId, showAll = false) {
    if (!tbodyEl || !hotelId) {
        tbodyEl.innerHTML = `<tr><td colspan="7" class="text-center p-4 text-red-500">Error: No se pudo cargar la información.</td></tr>`;
        return;
    }
    tbodyEl.innerHTML = `<tr><td colspan="7" class="text-center p-4 text-slate-500">Cargando...</td></tr>`;
  
    try {
        // Construimos la consulta base
        let query = supabaseInstance
            .from('descuentos')
            .select('*')
            .eq('hotel_id', hotelId);

        // AÑADIMOS EL FILTRO CONDICIONAL
        // Si showAll es `false` (el valor por defecto), solo mostramos los activos.
        if (!showAll) {
            query = query.eq('activo', true);
        }

        // Añadimos el ordenamiento al final
        query = query.order('created_at', { ascending: false });

        // Ejecutamos la consulta ya construida
        const { data: discounts, error: discountsError } = await query;

        if (discountsError) throw discountsError;

        if (!discounts.length) {
            tbodyEl.innerHTML = `<tr><td colspan="7" class="text-center p-4 text-slate-500">No hay descuentos para mostrar.</td></tr>`;
            return;
        }

        const clienteIds = discounts.map(d => d.cliente_id).filter(id => id !== null);
        let clientMap = new Map();

        if (clienteIds.length > 0) {
            const { data: clientes, error: clientsError } = await supabaseInstance
                .from('clientes')
                .select('id, nombre')
                .in('id', clienteIds);
            if (clientsError) throw clientsError;
            clientMap = new Map(clientes.map(c => [c.id, c.nombre]));
        }

        // Limpiamos el tbody antes de renderizar las nuevas filas
        tbodyEl.innerHTML = ''; 
    
        discounts.forEach(d => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-50";
            tr.dataset.id = d.id;

            const valorDisplay = d.tipo === 'porcentaje' ? `${d.valor}%` : formatCurrency(d.valor);
            const usosDisplay = `${d.usos_actuales || 0} / ${(d.usos_maximos || 0) === 0 ? '∞' : d.usos_maximos}`;
      
            let tipoDisplay = '';
            let nombreDisplay = `<div class="font-medium text-slate-900">${d.nombre}</div>`;

            switch (d.tipo_descuento_general) {
                case 'codigo': 
                    tipoDisplay = 'Por Código';
                    if (d.codigo) {
                        nombreDisplay += `<div class="text-slate-500 font-mono text-xs inline-block bg-blue-100 text-blue-800 px-2 py-0.5 rounded mt-1">${d.codigo}</div>`;
                    }
                    break;
                case 'automatico': tipoDisplay = 'Automático'; break;
                case 'cliente_especifico': 
                    const clientName = clientMap.get(d.cliente_id) || 'N/A';
                    tipoDisplay = `Cliente Específico`;
                    nombreDisplay += `<div class="text-slate-500 text-xs inline-block bg-purple-100 text-purple-800 px-2 py-0.5 rounded mt-1">👤 ${clientName}</div>`;
                    break;
                default: tipoDisplay = 'General';
            }

            let fechasDisplay = '<span class="text-slate-400">N/A</span>';
            if (d.fecha_inicio && d.fecha_fin) {
                fechasDisplay = `${formatDateShort(d.fecha_inicio)} - ${formatDateShort(d.fecha_fin)}`;
            } else if (d.fecha_fin) {
                fechasDisplay = `Hasta ${formatDateShort(d.fecha_fin)}`;
            }

            const estadoBadge = d.activo
                ? `<span class="inline-flex items-center gap-x-1.5 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700"><svg class="h-1.5 w-1.5 fill-green-500" viewBox="0 0 6 6"><circle cx="3" cy="3" r="3" /></svg>Activo</span>`
                : `<span class="inline-flex items-center gap-x-1.5 rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-700"><svg class="h-1.5 w-1.5 fill-red-500" viewBox="0 0 6 6"><circle cx="3" cy="3" r="3" /></svg>Inactivo</span>`;

            tr.innerHTML = `
                <td class="px-6 py-4">${nombreDisplay}</td>
                <td class="px-6 py-4 text-slate-700">${tipoDisplay}</td>
                <td class="px-6 py-4 font-semibold text-slate-900">${valorDisplay}</td>
                <td class="px-6 py-4 text-slate-700">${fechasDisplay}</td>
                <td class="px-6 py-4 text-slate-700">${usosDisplay}</td>
                <td class="px-6 py-4 text-center">${estadoBadge}</td>
                <td class="px-6 py-4 text-center">
                    <div class="flex items-center justify-center gap-x-2">
                        <button data-action="edit" data-id="${d.id}" title="Editar" class="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded-md">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" /></svg>
                        </button>
                        <button data-action="toggle" data-id="${d.id}" title="${d.activo ? 'Desactivar' : 'Activar'}" class="p-1.5 text-slate-500 hover:text-green-600 hover:bg-slate-100 rounded-md">
                           ${d.activo 
                                ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" /></svg>` 
                                : `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>`}
                        </button>
                        <button data-action="card" data-id="${d.id}" title="Crear Tarjeta de Descuento" class="p-1.5 text-slate-500 hover:text-purple-600 hover:bg-slate-100 rounded-md">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V8a2 2 0 00-2-2h-5L9 4H4zm0 2h4.586l1 1H16v6H4V6z" /></svg>
                        </button>
                        ${(d.usos_actuales || 0) === 0 ? `<button data-action="delete" data-id="${d.id}" title="Eliminar" class="p-1.5 text-slate-500 hover:text-red-600 hover:bg-slate-100 rounded-md">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>
                        </button>` : ''}
                    </div>
                </td>
            `;
            tbodyEl.appendChild(tr);
        });
    } catch (err) {
        console.error('Error loading discounts:', err);
        tbodyEl.innerHTML = `<tr><td colspan="7" class="text-center p-4 text-red-500">Error al cargar descuentos: ${err.message}</td></tr>`;
    }
} 


function populateForm(formEl, discount, formTitleEl, cancelButtonEl) {
  formEl.reset();
  formEl.querySelector('#descuento-id-edit').value = discount.id;
  
  formEl.nombre.value = discount.nombre || '';
  formEl.tipo_descuento_general.value = discount.tipo_descuento_general;
  
  // Disparamos el cambio para ajustar la visibilidad del formulario
  toggleFormVisibility(formEl);

  if (discount.codigo) formEl.codigo.value = discount.codigo;
  if (discount.cliente_id) formEl.cliente.value = discount.cliente_id;
  
  formEl.tipo.value = discount.tipo;
  formEl.valor.value = discount.valor;

  formEl.fecha_inicio.value = discount.fecha_inicio ? new Date(discount.fecha_inicio).toISOString().split('T')[0] : '';
  formEl.fecha_fin.value = discount.fecha_fin ? new Date(discount.fecha_fin).toISOString().split('T')[0] : '';

  formEl.usos_maximos.value = discount.usos_maximos || 0;
  
  if (discount.aplicabilidad) formEl.aplicabilidad.value = discount.aplicabilidad;
  if (discount.habitaciones_aplicables && discount.habitaciones_aplicables.length > 0) {
      Array.from(formEl.habitaciones_aplicables.options).forEach(option => {
          option.selected = discount.habitaciones_aplicables.includes(option.value);
      });
  }
  
  // Disparamos de nuevo para asegurar que el sub-selector de habitaciones se muestre
  toggleFormVisibility(formEl);

  formEl.activo.checked = discount.activo;
  
  if (formTitleEl) formTitleEl.textContent = `Editando: ${discount.nombre}`;
  formEl.querySelector('#btn-guardar-descuento').textContent = 'Actualizar Descuento';
  if (cancelButtonEl) cancelButtonEl.style.display = 'inline-block';
  formEl.nombre.focus();
}

/**
 * Resetea el formulario al estado inicial.
 */
function resetForm(formEl, formTitleEl, cancelButtonEl, feedbackEl) {
  formEl.reset();
  formEl.querySelector('#descuento-id-edit').value = '';
  if (formTitleEl) formTitleEl.textContent = 'Crear Nuevo Descuento';
  formEl.querySelector('#btn-guardar-descuento').textContent = 'Guardar Descuento';
  if (cancelButtonEl) cancelButtonEl.style.display = 'none';
  toggleFormVisibility(formEl);
  formEl.nombre.focus();
  clearFeedback(feedbackEl);
}


/**
 * =================================================================================
 * FUNCIÓN PRINCIPAL: mount
 * Construye la UI del módulo y conecta todos los eventos.
 * =================================================================================
 */
// REEMPLAZA ESTE BLOQUE DE CÓDIGO EN TU ARCHIVO descuentos.js

/**
 * =================================================================================
 * FUNCIÓN PRINCIPAL: mount
 * Construye la UI del módulo y conecta todos los eventos.
 * =================================================================================
 */
export async function mount(container, supabaseInstance, currentUser) {
    console.log('[Descuentos.js] Montando el módulo de descuentos...');
    unmount(container);

    // Se añade un contenedor para el modal que evita conflictos
    container.innerHTML = `
    <div id="descuentos-module-container" class="bg-slate-50 min-h-full">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
    
            <div>
                <h1 class="text-4xl font-extrabold text-slate-900 tracking-tight">Gestión de Promociones</h1>
                <p class="mt-2 text-lg text-slate-600">Crea, edita y administra todos los descuentos y códigos para tu hotel.</p>
            </div>
    
            <div id="form-card" class="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
                <div class="divide-y divide-slate-200">
                    <div class="px-6 py-5">
                        <h2 id="form-descuento-titulo" class="text-xl font-bold text-slate-800">Crear Nuevo Descuento</h2>
                    </div>
    
                    <div class="px-6 py-6">
                        <form id="form-descuento" class="space-y-8" novalidate>
                            <input type="hidden" id="descuento-id-edit" name="id" />
    
                            <div class="space-y-6">
                                <h3 class="text-base font-semibold text-slate-800 border-b border-slate-200 pb-2">1. Información Básica</h3>
                                <div class="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-6">
                                    <div class="form-group lg:col-span-1">
                                        <label for="nombre" class="form-label font-semibold">Nombre de la promo *</label>
                                        <input type="text" id="nombre" name="nombre" class="form-control" required maxlength="100" placeholder="Ej: Descuento Fin de Semana"/>
                                    </div>
                                    <div class="form-group lg:col-span-1">
                                        <label for="tipo_descuento_general" class="form-label font-semibold">Tipo de Promoción *</label>
                                        <select id="tipo_descuento_general" name="tipo_descuento_general" class="form-control" required>
                                            <option value="codigo">Por Código (manual)</option>
                                            <option value="automatico">Automática (por fecha)</option>
                                            <option value="cliente_especifico">Para Cliente Específico</option>
                                        </select>
                                    </div>
                                    <div class="form-group lg:col-span-1" id="codigo-container">
                                        <label for="codigo" class="form-label font-semibold">Código *</label>
                                        <input type="text" id="codigo" name="codigo" class="form-control uppercase" required maxlength="50" placeholder="FINDE25"/>
                                    </div>
                                    <div class="form-group lg:col-span-2" id="cliente-container" style="display: none;">
                                        <label for="cliente" class="form-label font-semibold">Cliente Específico *</label>
                                        <select id="cliente" name="cliente_id" class="form-control" required></select>
                                    </div>
                                </div>
                            </div>
    
                            <div class="space-y-6">
                                 <h3 class="text-base font-semibold text-slate-800 border-b border-slate-200 pb-2">2. Valor y Condiciones</h3>
                                 <div class="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-6">
                                    <div class="form-group">
                                        <label for="tipo" class="form-label font-semibold">Tipo de Valor *</label>
                                        <select id="tipo" name="tipo" class="form-control" required>
                                            <option value="porcentaje">Porcentaje (%)</option>
                                            <option value="fijo">Monto Fijo ($)</option>
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label for="valor" class="form-label font-semibold">Valor del Descuento *</label>
                                        <input type="number" id="valor" name="valor" class="form-control" required min="0" step="0.01" />
                                    </div>
                                    <div class="form-group">
                                        <label for="usos_maximos" class="form-label font-semibold">Límite de Usos</label>
                                        <input type="number" id="usos_maximos" name="usos_maximos" class="form-control" min="0" value="0" placeholder="0 para ilimitado"/>
                                    </div>
                                 </div>
                            </div>
    
                            <div class="space-y-6">
                                <h3 class="text-base font-semibold text-slate-800 border-b border-slate-200 pb-2">3. Aplicabilidad y Vigencia</h3>
                                <div id="rango-fechas-container" class="grid grid-cols-1 sm:grid-cols-2 gap-x-8" style="display: none;">
                                    <div class="form-group">
                                        <label for="fecha_inicio" class="form-label font-semibold">Válido Desde *</label>
                                        <input type="date" id="fecha_inicio" name="fecha_inicio" class="form-control" />
                                    </div>
                                    <div class="form-group">
                                        <label for="fecha_fin" class="form-label font-semibold">Válido Hasta *</label>
                                        <input type="date" id="fecha_fin" name="fecha_fin" class="form-control" />
                                    </div>
                                </div>
                                <div id="aplicabilidad-container" class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6" style="display: none;">
                                    <div class="form-group">
                                        <label for="aplicabilidad" class="form-label font-semibold">Aplicar a *</label>
                                        <select id="aplicabilidad" name="aplicabilidad" class="form-control">
                                            <option value="reserva_total">Toda la reserva de Alojamiento</option>
                                            <option value="habitaciones_especificas">Habitaciones Específicas</option>
                                            <option value="servicios_adicionales">Servicios Adicionales Específicos</option>
                                            <option value="productos_tienda">Productos de Tienda Específicos</option>
                                            <option value="categorias_restaurante">Categorías de Restaurante Específicas</option>
                                        </select>
                                    </div>
                                    <div class="space-y-6">
                                        <div class="form-group items-container" id="items-habitaciones_especificas-container" style="display: none;">
                                            <label for="habitaciones_aplicables" class="form-label font-semibold">Habitaciones Aplicables*</label>
                                            <p class="form-helper-text">Mantén 'Ctrl' o 'Cmd' para selección múltiple.</p>
                                            <select id="habitaciones_aplicables" name="habitaciones_aplicables" class="form-control" multiple size="5"></select>
                                        </div>
                                        <div class="form-group items-container" id="items-servicios_adicionales-container" style="display: none;">
                                            <label for="items_servicios_adicionales" class="form-label font-semibold">Servicios Aplicables*</label>
                                            <p class="form-helper-text">Mantén 'Ctrl' o 'Cmd' para selección múltiple.</p>
                                            <select id="items_servicios_adicionales" name="items_servicios_adicionales" class="form-control" multiple size="5"></select>
                                        </div>
                                        <div class="form-group items-container" id="items-productos_tienda-container" style="display: none;">
                                            <label for="items_productos_tienda" class="form-label font-semibold">Productos Aplicables*</label>
                                            <p class="form-helper-text">Mantén 'Ctrl' o 'Cmd' para selección múltiple.</p>
                                            <select id="items_productos_tienda" name="items_productos_tienda" class="form-control" multiple size="5"></select>
                                        </div>
                                        <div class="form-group items-container" id="items-categorias_restaurante-container" style="display: none;">
                                            <label for="items_categorias_restaurante" class="form-label font-semibold">Categorías de Restaurante*</label>
                                            <p class="form-helper-text">Mantén 'Ctrl' o 'Cmd' para selección múltiple.</p>
                                            <select id="items_categorias_restaurante" name="items_categorias_restaurante" class="form-control" multiple size="5"></select>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </form>
                    </div>
    
                    <div class="px-6 py-4 bg-slate-50 flex items-center justify-between">
                        <div class="form-group flex items-center">
                            <input type="checkbox" id="activo" name="activo" class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" checked />
                            <label for="activo" class="ml-3 block text-sm font-medium text-slate-700">Activar este descuento</label>
                        </div>
                        <div class="form-actions flex items-center gap-x-4">
                            <button type="button" id="btn-cancelar-edicion-descuento" class="button button-neutral py-2 px-4" style="display:none;">Cancelar</button>
                            <button type="submit" form="form-descuento" id="btn-guardar-descuento" class="button button-primary py-2 px-5 font-semibold">Guardar Descuento</button>
                        </div>
                    </div>
                </div>
            </div>
    
           <div id="table-card" class="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
    <div class="px-6 py-5 border-b border-slate-200">
        <div class="flex flex-wrap items-center justify-between gap-4">
            <h3 class="text-xl font-bold text-slate-800">Descuentos Existentes</h3>
            <div class="flex items-center">
                <input id="show-inactive-discounts-checkbox" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500">
                <label for="show-inactive-discounts-checkbox" class="ml-2 block text-sm font-medium text-slate-700">Mostrar inactivos</label>
            </div>
        </div>
        <div id="descuentos-feedback" role="status" aria-live="polite" class="mt-2" style="min-height: 24px;"></div>
    </div>
    </div>
                <div class="table-container overflow-x-auto">
                    <table class="w-full text-sm text-left">
                        <thead class="text-xs text-slate-600 uppercase bg-slate-100">
                            <tr>
                                <th scope="col" class="px-6 py-3">Nombre / Código</th>
                                <th scope="col" class="px-6 py-3">Tipo</th>
                                <th scope="col" class="px-6 py-3">Valor</th>
                                <th scope="col" class="px-6 py-3">Vigencia</th>
                                <th scope="col" class="px-6 py-3">Uso</th>
                                <th scope="col" class="px-6 py-3 text-center">Estado</th>
                                <th scope="col" class="px-6 py-3 text-center">Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="tabla-descuentos-body" class="divide-y divide-slate-200">
                            </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
    <div id="modal-container"></div>
    `;

    // ▼▼▼ ¡ESTA ES LA CORRECCIÓN CLAVE! ▼▼▼
    // Buscamos los elementos directamente en el 'document' después de que
    // el innerHTML ha sido renderizado. Esto garantiza que siempre se encuentren.
    const feedbackEl = document.getElementById('descuentos-feedback');
    const formEl = document.getElementById('form-descuento');
    const tbodyEl = document.getElementById('tabla-descuentos-body');
    const btnGuardarEl = document.getElementById('btn-guardar-descuento');
    const btnCancelarEl = document.getElementById('btn-cancelar-edicion-descuento');
    const formTitleEl = document.getElementById('form-descuento-titulo');

    // Comprobación de seguridad para evitar errores si algo falla catastróficamente
    if (!feedbackEl || !formEl || !tbodyEl || !btnGuardarEl || !btnCancelarEl || !formTitleEl) {
        console.error("Error crítico: Uno o más elementos esenciales del DOM no se encontraron después de renderizar el módulo de descuentos.");
        container.innerHTML = `<p class="error-box">Error al inicializar el módulo. Por favor, recargue la página.</p>`;
        return;
    }

    // Determine hotelId
    // ... (El resto de tu función 'mount' continúa desde aquí sin cambios) ...

  // Determine hotelId
  try {
    const { data: { user } } = await supabaseInstance.auth.getUser();
    currentHotelId = user?.user_metadata?.hotel_id;
    if (!currentHotelId && user?.id) {
        const { data: perfil, error: perfilError } = await supabaseInstance.from('usuarios').select('hotel_id').eq('id', user.id).single();
        if (perfilError) throw perfilError;
        currentHotelId = perfil?.hotel_id;
    }
  } catch (err) {
      console.error("Error crítico obteniendo hotel_id:", err);
      showError(feedbackEl, 'Error crítico: No se pudo determinar el hotel del usuario.');
      return;
  }
  if (!currentHotelId) {
    showError(feedbackEl, 'No se pudo determinar el hotel. La gestión de descuentos está deshabilitada.');
    formEl.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
    return;
  }

  // Carga inicial de datos para selectores
  await loadHabitacionesParaSelector(formEl.querySelector('#habitaciones_aplicables'), supabaseInstance, currentHotelId);
  await loadClientesParaSelector(formEl.querySelector('#cliente'), supabaseInstance, currentHotelId);
await loadServiciosParaSelector(formEl.querySelector('#items_servicios_adicionales'), supabaseInstance, currentHotelId);
await loadProductosParaSelector(formEl.querySelector('#items_productos_tienda'), supabaseInstance, currentHotelId);
await loadCategoriasRestauranteParaSelector(formEl.querySelector('#items_categorias_restaurante'), supabaseInstance, currentHotelId);

const showInactiveCheckbox = document.getElementById('show-inactive-discounts-checkbox');
if (showInactiveCheckbox) {
    const checkboxChangeHandler = async (event) => {
        const showAll = event.target.checked;
        await loadAndRenderDiscounts(tbodyEl, supabaseInstance, currentHotelId, showAll);
    };
    showInactiveCheckbox.addEventListener('change', checkboxChangeHandler);
    // Guardamos el listener para poder limpiarlo después
    moduleListeners.push({ element: showInactiveCheckbox, type: 'change', handler: checkboxChangeHandler });
}
  // Lógica de visibilidad del formulario
  const visibilityHandler = () => toggleFormVisibility(formEl);
  formEl.tipo_descuento_general.addEventListener('change', visibilityHandler);
  formEl.aplicabilidad.addEventListener('change', visibilityHandler);
  moduleListeners.push({ element: formEl.tipo_descuento_general, type: 'change', handler: visibilityHandler });
  moduleListeners.push({ element: formEl.aplicabilidad, type: 'change', handler: visibilityHandler });
  toggleFormVisibility(formEl); // Llamada inicial

  // Form Submit Handler
const formSubmitHandler = async (event) => {
    event.preventDefault();
    clearFeedback(feedbackEl);
    
    const formData = new FormData(formEl);
    const originalButtonText = formData.get('id') ? 'Actualizar Descuento' : 'Guardar Descuento';
    setFormLoadingState(formEl, true, btnGuardarEl, originalButtonText, 'Guardando...');
    
    const discountId = formData.get('id');
    const valorInput = parseFloat(formData.get('valor'));
    
    if (isNaN(valorInput) || valorInput < 0) {
        showError(feedbackEl, 'El valor del descuento debe ser un número positivo.');
        setFormLoadingState(formEl, false, btnGuardarEl, originalButtonText);
        formEl.valor.focus();
        return;
    }

    const tipoGeneral = formData.get('tipo_descuento_general');
    const payload = {
      hotel_id: currentHotelId,
      nombre: formData.get('nombre').trim(),
      tipo_descuento_general: tipoGeneral,
      tipo: formData.get('tipo'),
      valor: valorInput,
      usos_maximos: parseInt(formData.get('usos_maximos')) || 0,
      activo: formEl.activo.checked,
      codigo: null,
      cliente_id: null,
      fecha_inicio: null,
      fecha_fin: null,
      aplicabilidad: null, // Esta es la columna para el TIPO de aplicabilidad
      habitaciones_aplicables: null // Esta es la columna para el ARRAY de IDs
    };

    if (tipoGeneral === 'codigo') {
        payload.codigo = formData.get('codigo')?.trim().toUpperCase();
        payload.aplicabilidad = formData.get('aplicabilidad'); // <-- AÑADE ESTA LÍNEA
        if (!payload.codigo) { 
            showError(feedbackEl, 'El código es obligatorio para este tipo de promoción.');
            setFormLoadingState(formEl, false, btnGuardarEl, originalButtonText);
            return; 
        }
  
    } else if (tipoGeneral === 'cliente_especifico') {
        payload.cliente_id = formData.get('cliente_id');
        if (!payload.cliente_id) { 
            showError(feedbackEl, 'Debe seleccionar un cliente para este tipo de promoción.');
            setFormLoadingState(formEl, false, btnGuardarEl, originalButtonText);
            return; 
        }
    } else if (tipoGeneral === 'automatico') {
        if(formData.get('fecha_inicio')) payload.fecha_inicio = new Date(formData.get('fecha_inicio')).toISOString();
        if(formData.get('fecha_fin')) payload.fecha_fin = new Date(formData.get('fecha_fin') + 'T23:59:59.999Z').toISOString();
    }

    const aplicabilidad = formData.get('aplicabilidad');
    payload.aplicabilidad = aplicabilidad; 

    let items_aplicables = null;

    // Se determina de qué selector múltiple se obtienen los datos
    if (aplicabilidad === 'habitaciones_especificas') {
        items_aplicables = Array.from(formEl.habitaciones_aplicables.selectedOptions).map(opt => opt.value);
    } else if (aplicabilidad === 'servicios_adicionales') {
        const selectServicios = formEl.querySelector('#items_servicios_adicionales');
        items_aplicables = Array.from(selectServicios.selectedOptions).map(opt => opt.value);
    } else if (aplicabilidad === 'productos_tienda') {
        const selectProductos = formEl.querySelector('#items_productos_tienda');
        items_aplicables = Array.from(selectProductos.selectedOptions).map(opt => opt.value);
    } else if (aplicabilidad === 'categorias_restaurante') {
        const selectCategorias = formEl.querySelector('#items_categorias_restaurante');
        items_aplicables = Array.from(selectCategorias.selectedOptions).map(opt => opt.value);
    }

    // ▼▼▼ ¡ESTA ES LA CORRECCIÓN CLAVE! ▼▼▼
    // Basado en tu esquema, todos los arrays de IDs (sean de habitaciones, servicios, etc.)
    // se guardan en la única columna disponible: 'habitaciones_aplicables'.
    if (items_aplicables && items_aplicables.length > 0) {
        payload.habitaciones_aplicables = items_aplicables;
    }
    
    try {
      if (discountId) {
        const { error } = await supabaseInstance.from('descuentos').update(payload).eq('id', discountId);
        if (error) throw error;
        showSuccess(feedbackEl, 'Descuento actualizado exitosamente.');
      } else {
        payload.usos_actuales = 0; 
        const { error } = await supabaseInstance.from('descuentos').insert(payload);
        if (error) throw error;
        showSuccess(feedbackEl, 'Descuento creado exitosamente.');
      }
      resetForm(formEl, formTitleEl, btnCancelarEl, feedbackEl);
      await loadAndRenderDiscounts(tbodyEl, supabaseInstance, currentHotelId);
    } catch (err) {
      console.error('Error saving discount:', err);
      showError(feedbackEl, `Error al guardar: ${err.message}`);
    } finally {
      setFormLoadingState(formEl, false, btnGuardarEl, originalButtonText);
    }
};


  formEl.addEventListener('submit', formSubmitHandler);
  moduleListeners.push({ element: formEl, type: 'submit', handler: formSubmitHandler });

  // Table Click Handler
  const tableClickListener = async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const discountId = button.dataset.id;
    const action = button.dataset.action;
    clearFeedback(feedbackEl);

    try {
      const { data: discount, error: fetchError } = await supabaseInstance
    .from('descuentos').select('*, clientes(id, nombre)').eq('id', discountId).single();
      if(fetchError) throw fetchError;

      if (action === 'edit') {
        populateForm(formEl, discount, formTitleEl, btnCancelarEl);
        window.scrollTo({ top: formEl.offsetTop - 20, behavior: 'smooth' });
      } else if (action === 'toggle') {
        const { error } = await supabaseInstance.from('descuentos').update({ activo: !discount.activo }).eq('id', discountId);
        if (error) throw error;
        showSuccess(feedbackEl, `Descuento ${!discount.activo ? 'activado' : 'desactivado'}.`);
        await loadAndRenderDiscounts(tbodyEl, supabaseInstance, currentHotelId);
      // ...
} else if (action === 'delete') {
    if ((discount.usos_actuales || 0) > 0) {
        showError(feedbackEl, 'No se puede eliminar un descuento que ya ha sido utilizado.');
        return;
    }

    // Llamamos a nuestro nuevo modal de confirmación
    const confirmed = await showConfirmationModal({
        title: 'Confirmar Eliminación',
        text: `¿Realmente deseas eliminar el descuento "<strong>${discount.nombre}</strong>"?<br><br>Esta acción no se puede deshacer.`,
        confirmButtonText: 'Sí, ¡Eliminar!'
    });

    // Si el usuario confirmó, procedemos a eliminar
    if (confirmed) {
        try {
            const { error } = await supabaseInstance.from('descuentos').delete().eq('id', discountId);
            if (error) throw error;
            showSuccess(feedbackEl, 'Descuento eliminado exitosamente.');
            await loadAndRenderDiscounts(tbodyEl, supabaseInstance, currentHotelId);
        } catch (err) {
            console.error('Error al eliminar el descuento:', err);
            showError(feedbackEl, `Error al eliminar: ${err.message}`);
        }
    }

      } else if (action === 'card') {
        const { data: hotelData } = await supabaseInstance.from('configuracion_hotel').select('logo_url').eq('hotel_id', currentHotelId).single();
        await generateDiscountCard(discount, hotelData?.logo_url, supabaseInstance);
      }
    } catch (err) {
      console.error(`Error en acción ${action}:`, err);
      showError(feedbackEl, `Error en acción '${action}': ${err.message}`);
    }
  };
  tbodyEl.addEventListener('click', tableClickListener);
  moduleListeners.push({ element: tbodyEl, type: 'click', handler: tableClickListener });

  // Cancel Edit Button Handler
  const cancelEditHandler = () => resetForm(formEl, formTitleEl, btnCancelarEl, feedbackEl);
  btnCancelarEl.addEventListener('click', cancelEditHandler);
  moduleListeners.push({ element: btnCancelarEl, type: 'click', handler: cancelEditHandler });

  // Initial load
  await loadAndRenderDiscounts(tbodyEl, supabaseInstance, currentHotelId);
  formEl.nombre.focus();
}

/**
 * Limpia todos los listeners y resetea el estado del módulo.
 */
export function unmount(container) {
  moduleListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = [];
  currentHotelId = null;
  
  // Asegurarse de remover cualquier modal que haya quedado abierto
  const modal = document.getElementById('card-modal');
  if (modal) modal.remove();
  
  // Limpiar el contenido del contenedor principal
  if (container) container.innerHTML = '';
  
  console.log('[Descuentos.js] Módulo desmontado y listeners limpiados.');
}