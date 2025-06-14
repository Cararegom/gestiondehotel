// js/modules/descuentos/descuentos.js
import { formatCurrency, formatDateShort, showError, showSuccess, clearFeedback, setFormLoadingState } from '/js/uiUtils.js';

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
async function generateDiscountCard(discount, logoUrl, supabaseInstance) {
    // 1. Crear y mostrar el modal
    const modalHtml = `
        <div id="card-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:1050;">
          <div class="card" style="max-width: 500px; width: 90%; animation: fadeIn 0.3s;">
            <div class="card-header flex justify-between items-center">
                <h3>Tarjeta de Descuento</h3>
                <button id="modal-close-btn" class="button button-icon" title="Cerrar">&times;</button>
            </div>
            <div class="card-body">
              <div id="discount-card-container" class="bg-white p-4 rounded-lg shadow-lg border-dashed border-gray-400">
                <div class="flex justify-between items-start mb-4">
                  <h4 class="text-xl font-bold">${discount.nombre}</h4>
                  ${logoUrl ? `<img src="${logoUrl}" alt="Logo del Hotel" class="max-h-16 object-contain"/>` : '<div class="max-h-16"></div>'}
                </div>
                <div class="text-center my-8">
                  <p class="text-lg">¡Tienes un descuento de!</p>
                  <p class="text-5xl font-bold my-2 text-primary">${discount.tipo === 'porcentaje' ? `${discount.valor}%` : formatCurrency(discount.valor)}</p>
                </div>
                <div class="text-center">
                  <p>${discount.tipo_descuento_general === 'codigo' ? 'Usa el código:' : 'Promoción Automática'}</p>
                  ${discount.codigo ? `<p class="text-2xl font-mono bg-slate-100 p-2 my-2 inline-block">${discount.codigo}</p>` : ''}
                </div>
                <div class="text-xs text-gray-500 mt-6">
                  <p><strong>Válido:</strong> ${discount.fecha_inicio ? `Del ${formatDateShort(discount.fecha_inicio)} al ${formatDateShort(discount.fecha_fin)}` : 'Contactar para validez'}</p>
                  ${(discount.usos_maximos || 0) > 0 ? `<p><strong>Usos restantes:</strong> ${discount.usos_maximos - (discount.usos_actuales || 0)}</p>`: ''}
                  <p>Aplican términos y condiciones.</p>
                </div>
              </div>
              <div class="mt-4 flex flex-wrap items-center gap-2">
                <button id="download-card-btn" class="button button-primary">Descargar</button>
                <input type="email" id="email-recipient-input" placeholder="correo@cliente.com" class="form-control flex-grow" />
                <button id="email-card-btn" class="button button-success">Enviar</button>
              </div>
              <div id="email-feedback" class="text-sm mt-2"></div>
            </div>
          </div>
        </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // 2. Lógica de los botones del modal
    const modal = document.getElementById('card-modal');
    const emailFeedbackEl = document.getElementById('email-feedback');

    document.getElementById('modal-close-btn').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target.id === 'card-modal') modal.remove(); };

    // Lógica para Descargar
    document.getElementById('download-card-btn').onclick = () => {
        const cardElement = document.getElementById('discount-card-container');
        html2canvas(cardElement).then(canvas => {
            const link = document.createElement('a');
            link.download = `descuento-${discount.nombre.replace(/\s+/g, '-')}.png`;
            link.href = canvas.toDataURL();
            link.click();
        });
    };

    // Lógica para Enviar por Email (usando Supabase Edge Function)
    document.getElementById('email-card-btn').onclick = async (e) => {
        const button = e.currentTarget;
        const recipient = document.getElementById('email-recipient-input').value;
        if (!recipient) {
            emailFeedbackEl.textContent = 'Por favor, ingresa un email.';
            emailFeedbackEl.className = 'text-sm mt-2 text-danger';
            return;
        }
        button.disabled = true;
        button.textContent = 'Enviando...';
        emailFeedbackEl.textContent = '';

        try {
            const cardElement = document.getElementById('discount-card-container');
            const canvas = await html2canvas(cardElement);
            const imageBase64 = canvas.toDataURL().split('base64,')[1];

            // IMPORTANTE: Debes crear una Edge Function en Supabase llamada 'send-discount-email'
            const { error } = await supabaseInstance.functions.invoke('send-discount-email', {
                body: { 
                    recipient, 
                    imageBase64, 
                    discountName: discount.nombre, 
                    hotelId: currentHotelId // Pasa el ID del hotel para obtener más datos si es necesario
                }
            });

            if (error) throw error;
            emailFeedbackEl.textContent = '¡Email enviado con éxito!';
            emailFeedbackEl.className = 'text-sm mt-2 text-success';
            document.getElementById('email-recipient-input').value = '';
        } catch (err) {
            console.error("Error sending discount email:", err);
            emailFeedbackEl.textContent = `Error al enviar: ${err.message}`;
            emailFeedbackEl.className = 'text-sm mt-2 text-danger';
        } finally {
            button.disabled = false;
            button.textContent = 'Enviar';
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
async function loadAndRenderDiscounts(tbodyEl, supabaseInstance, hotelId) {
  if (!tbodyEl || !hotelId) {
    tbodyEl.innerHTML = `<tr><td colspan="8" class="text-center p-2 text-danger">Error: No se pudo cargar la información.</td></tr>`;
    return;
  }
  tbodyEl.innerHTML = `<tr><td colspan="8" class="text-center p-2"><span class="loading-indicator visible">Cargando...</span></td></tr>`;
  
  try {
    // 1. Obtenemos solo los descuentos, SIN el join a clientes
    const { data: discounts, error: discountsError } = await supabaseInstance
      .from('descuentos')
      .select('*') // Cambiado: ya no intentamos hacer el join aquí
      .eq('hotel_id', hotelId)
      .order('created_at', { ascending: false });

    if (discountsError) throw discountsError;

    tbodyEl.innerHTML = '';
    if (!discounts.length) {
      tbodyEl.innerHTML = `<tr><td colspan="8" class="text-center p-2">No hay descuentos configurados. Crea el primero.</td></tr>`;
      return;
    }

    // 2. Recolectamos los IDs de los clientes que tienen descuentos
    const clienteIds = discounts
      .map(d => d.cliente_id)
      .filter(id => id !== null); // Filtramos los que no son nulos

    let clientMap = new Map();

    // 3. Si hay IDs de clientes, hacemos UNA sola consulta para traer todos sus nombres
    if (clienteIds.length > 0) {
        const { data: clientes, error: clientsError } = await supabaseInstance
            .from('clientes')
            .select('id, nombre')
            .in('id', clienteIds); // 'in' trae todos los clientes cuyos IDs están en el array

        if (clientsError) throw clientsError;

        // 4. Creamos un mapa para buscar nombres de cliente fácilmente (id -> nombre)
        clientMap = new Map(clientes.map(c => [c.id, c.nombre]));
    }

    // 5. Renderizamos la tabla usando el mapa para encontrar los nombres
    discounts.forEach(d => {
      const tr = document.createElement('tr');
      tr.dataset.id = d.id;

      // ... (código para valorDisplay, usosDisplay no cambia) ...
      const valorDisplay = d.tipo === 'porcentaje' ? `${d.valor}%` : formatCurrency(d.valor);
      const usosDisplay = `${d.usos_actuales || 0} / ${(d.usos_maximos || 0) === 0 ? '∞' : d.usos_maximos}`;
      
      let nombreCodigoDisplay = `<strong>${d.nombre}</strong>`;
      if (d.codigo) {
        nombreCodigoDisplay += `<br><span class="text-sm text-gray-600 font-mono">${d.codigo}</span>`;
      }

      let aplicabilidadDisplay = '';
      switch (d.tipo_descuento_general) {
        case 'codigo': aplicabilidadDisplay = 'Por Código'; break;
        case 'automatico': aplicabilidadDisplay = 'Automático'; break;
        case 'cliente_especifico': 
            // Usamos el mapa para buscar el nombre
            const clientName = clientMap.get(d.cliente_id) || 'N/A';
            aplicabilidadDisplay = `Cliente: ${clientName}`;
            break;
        default: aplicabilidadDisplay = 'General';
      }

      let fechasDisplay = 'N/A';
      if(d.fecha_inicio && d.fecha_fin) {
          fechasDisplay = `${formatDateShort(d.fecha_inicio)} - ${formatDateShort(d.fecha_fin)}`;
      } else if (d.fecha_fin) {
          fechasDisplay = `Hasta ${formatDateShort(d.fecha_fin)}`;
      }

      tr.innerHTML = `
        <td>${nombreCodigoDisplay}</td>
        <td>${aplicabilidadDisplay}</td>
        <td>${valorDisplay}</td>
        <td>${fechasDisplay}</td>
        <td>${usosDisplay}</td>
        <td><span class="badge ${d.activo ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${d.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td class="actions-cell">
    <button class="button button-outline button-small" data-action="edit" data-id="${d.id}" title="Editar">Editar</button>
    <button class="button button-small ${d.activo ? 'button-warning' : 'button-success'}" data-action="toggle" data-id="${d.id}" data-active="${d.activo}" title="${d.activo ? 'Desactivar' : 'Activar'}">${d.activo ? 'Desactivar' : 'Activar'}</button>
    <button class="button button-info button-small" data-action="card" data-id="${d.id}" title="Crear Tarjeta">Tarjeta</button>
    ${(d.usos_actuales || 0) === 0 ? `<button class="button button-danger button-small" data-action="delete" data-id="${d.id}" title="Eliminar">Eliminar</button>` : ''}
    </td>`;
      tbodyEl.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading discounts:', err);
    tbodyEl.innerHTML = `<tr><td colspan="8" class="text-danger text-center p-2">Error al cargar descuentos: ${err.message}</td></tr>`;
  }
}/**
 * Popula el formulario para editar un descuento existente.
 */
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
export async function mount(container, supabaseInstance, currentUser) {
    console.log('[Descuentos.js] Montando el módulo de descuentos...');
    unmount(container);

    // Se añade un contenedor para el modal que evita conflictos
    container.innerHTML = `
    <div id="descuentos-module-content">
      <div class="card">
        <div class="card-header"><h2>Gestión de Descuentos y Promociones</h2></div>
        <div class="card-body">
          <div id="descuentos-feedback" role="status" aria-live="polite" class="mb-2" style="min-height: 24px;"></div>
          
          <h3 id="form-descuento-titulo" class="text-lg font-semibold mb-2">Crear Nuevo Descuento</h3>
          <form id="form-descuento" class="form mb-4 p-4 border rounded-lg bg-slate-50" novalidate>
            <input type="hidden" id="descuento-id-edit" name="id" />

            <div class="form-row grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
              <div class="form-group">
                <label for="nombre" class="form-label">Nombre o Descripción *</label>
                <input type="text" id="nombre" name="nombre" class="form-control" required maxlength="100" placeholder="Ej: Promo Verano Familiar"/>
              </div>
              <div class="form-group">
                <label for="tipo_descuento_general" class="form-label">Tipo de Promoción *</label>
                <select id="tipo_descuento_general" name="tipo_descuento_general" class="form-control" required>
                  <option value="codigo">Por Código (manual)</option>
                  <option value="automatico">Automática (por fecha)</option>
                  <option value="cliente_especifico">Para Cliente Específico</option>
                </select>
              </div>
              <div class="form-group" id="codigo-container">
                <label for="codigo" class="form-label">Código del Cupón *</label>
                <input type="text" id="codigo" name="codigo" class="form-control" required maxlength="50" placeholder="EJ: INVIERNO25"/>
              </div>
              <div class="form-group" id="cliente-container" style="display: none;">
                <label for="cliente" class="form-label">Seleccionar Cliente *</label>
                <select id="cliente" name="cliente_id" class="form-control" required></select>
              </div>
            </div>
            
            <div class="form-row grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div class="form-group">
                <label for="tipo" class="form-label">Descuento en *</label>
                <select id="tipo" name="tipo" class="form-control" required>
                  <option value="porcentaje">Porcentaje (%)</option>
                  <option value="fijo">Monto Fijo ($)</option>
                </select>
              </div>
              <div class="form-group">
                <label for="valor" class="form-label">Valor *</label>
                <input type="number" id="valor" name="valor" class="form-control" required min="0" step="0.01" />
              </div>
              <div class="form-group">
                  <label for="usos_maximos" class="form-label">Límite de Usos (0 para ilimitado)</label>
                  <input type="number" id="usos_maximos" name="usos_maximos" class="form-control" min="0" value="0" placeholder="0" />
              </div>
            </div>

            <div id="rango-fechas-container" class="form-row grid grid-cols-1 md:grid-cols-2 gap-4 mb-4" style="display: none;">
              <div class="form-group">
                <label for="fecha_inicio" class="form-label">Fecha de Inicio *</label>
                <input type="date" id="fecha_inicio" name="fecha_inicio" class="form-control" />
              </div>
              <div class="form-group">
                <label for="fecha_fin" class="form-label">Fecha de Fin *</label>
                <input type="date" id="fecha_fin" name="fecha_fin" class="form-control" />
              </div>
            </div>

            <div id="aplicabilidad-container" class="form-row grid grid-cols-1 md:grid-cols-2 gap-4 mb-4" style="display: none;">
              <div class="form-group">
                  <label for="aplicabilidad" class="form-label">Aplicar a *</label>
                  <select id="aplicabilidad" name="aplicabilidad" class="form-control">
    <option value="reserva_total">Toda la reserva de Alojamiento</option>
    <option value="habitaciones_especificas">Habitaciones Específicas</option>
    <option value="servicios_adicionales">Servicios Adicionales Específicos</option>
    <option value="productos_tienda">Productos de Tienda Específicos</option>
    <option value="categorias_restaurante">Categorías de Restaurante Específicas</option>
</select>
              </div>
              <div class="form-group items-container" id="items-habitaciones_especificas-container" style="display: none;">
    <label for="habitaciones_aplicables" class="form-label">Seleccionar Habitaciones Aplicables*</label>
    <p class="form-helper-text mb-2">Para seleccionar varios, mantén presionada la tecla 'Ctrl' (o 'Cmd' en Mac). Para un rango, usa 'Shift'.</p>
    <select id="habitaciones_aplicables" name="habitaciones_aplicables" class="form-control" multiple size="4"></select>
</div>
            </div>
<div class="form-group items-container" id="items-servicios_adicionales-container" style="display: none;">
    <label for="items_servicios_adicionales" class="form-label">Seleccionar Servicios Aplicables*</label>
    <p class="form-helper-text mb-2">Para seleccionar varios, mantén presionada la tecla 'Ctrl' (o 'Cmd' en Mac). Para un rango, usa 'Shift'.</p>
    <select id="items_servicios_adicionales" class="form-control" multiple size="5"></select>
</div>
<div class="form-group items-container" id="items-productos_tienda-container" style="display: none;">
    <label for="items_productos_tienda" class="form-label">Seleccionar Productos Aplicables*</label>
    <p class="form-helper-text mb-2">Para seleccionar varios, mantén presionada la tecla 'Ctrl' (o 'Cmd' en Mac). Para un rango, usa 'Shift'.</p>
    <select id="items_productos_tienda" class="form-control" multiple size="5"></select>
</div>
<div class="form-group items-container" id="items-categorias_restaurante-container" style="display: none;">
    <label for="items_categorias_restaurante" class="form-label">Seleccionar Categorías de Restaurante*</label>
    <p class="form-helper-text mb-2">Para seleccionar varios, mantén presionada la tecla 'Ctrl' (o 'Cmd' en Mac). Para un rango, usa 'Shift'.</p>
    <select id="items_categorias_restaurante" class="form-control" multiple size="5"></select>
</div>

            <div class="form-group mb-4">
              <div class="flex items-center">
                <input type="checkbox" id="activo" name="activo" class="form-check-input" checked />
                <label for="activo" class="ml-2">Activo</label>
              </div>
            </div>

            <div class="form-actions flex items-center gap-3">
              <button type="submit" id="btn-guardar-descuento" class="button button-primary">Guardar Descuento</button>
              <button type="button" id="btn-cancelar-edicion-descuento" class="button button-outline" style="display:none;">Cancelar Edición</button>
            </div>
          </form>
          <hr class="my-4"/>

          <h3 class="text-lg font-semibold mb-2">Descuentos y Promociones Existentes</h3>
          <div class="table-container overflow-x-auto">
            <table class="tabla-estilizada w-full">
              <thead>
                <tr>
                  <th>Nombre / Código</th><th>Tipo Promoción</th><th>Valor</th><th>Fechas</th><th>Usos</th><th>Estado</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody id="tabla-descuentos-body"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    <div id="modal-container"></div>`;

  const moduleContent = container.querySelector('#descuentos-module-content');
  const feedbackEl = moduleContent.querySelector('#descuentos-feedback');
  const formEl = moduleContent.querySelector('#form-descuento');
  const tbodyEl = moduleContent.querySelector('#tabla-descuentos-body');
  const btnGuardarEl = moduleContent.querySelector('#btn-guardar-descuento');
  const btnCancelarEl = moduleContent.querySelector('#btn-cancelar-edicion-descuento');
  const formTitleEl = moduleContent.querySelector('#form-descuento-titulo');

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
      } else if (action === 'delete') {
         if ((discount.usos_actuales || 0) > 0) {
            showError(feedbackEl, 'No se puede eliminar un descuento que ya ha sido utilizado.');
            return;
          }
        if (confirm(`¿Eliminar permanentemente el descuento "${discount.nombre}"?`)) {
          const { error } = await supabaseInstance.from('descuentos').delete().eq('id', discountId);
          if (error) throw error;
          showSuccess(feedbackEl, 'Descuento eliminado.');
          await loadAndRenderDiscounts(tbodyEl, supabaseInstance, currentHotelId);
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