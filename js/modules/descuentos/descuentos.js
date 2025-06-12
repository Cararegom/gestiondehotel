// js/modules/descuentos/descuentos.js
import { formatCurrency, formatDateShort, showError, showSuccess, clearFeedback, setFormLoadingState } from '/js/uiUtils.js';

let moduleListeners = []; // Centralized array for event listeners
let currentHotelId = null; // Stores the hotel ID for the current session of this module
let todasLasHabitaciones = [];


/**
 * Loads and renders the list of discounts.
 * @param {HTMLElement} tbodyEl The tbody element to render discounts into.
 * @param {object} supabaseInstance The Supabase client instance.
 * @param {string} hotelId The ID of the current hotel.
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
        todasLasHabitaciones = data || [];
        selectEl.innerHTML = todasLasHabitaciones.map(h => `<option value="${h.id}">${h.nombre}</option>`).join('');
        console.log(`[Descuentos.js] ${todasLasHabitaciones.length} habitaciones cargadas en el selector.`);
    } catch (err) {
        console.error("Error cargando habitaciones para el selector de descuentos:", err);
        selectEl.innerHTML = '<option disabled>Error al cargar habitaciones</option>';
    }
}

/**
 * Muestra u oculta el campo de selección de habitaciones según la aplicabilidad.
 */
function toggleHabitacionesSelect(aplicabilidadValue) {
    const container = document.getElementById('habitaciones-especificas-container');
    const select = document.getElementById('habitaciones_aplicables');
    if (!container || !select) return;

    if (aplicabilidadValue === 'habitaciones_especificas') {
        container.style.display = 'block';
        select.required = true;
    } else {
        container.style.display = 'none';
        select.required = false;
    }
}

async function loadAndRenderDiscounts(tbodyEl, supabaseInstance, hotelId) {
  if (!tbodyEl) {
    console.error("Discount table body element not found.");
    return;
  }
  if (!hotelId) {
    console.error("Hotel ID is not set for loading discounts.");
    tbodyEl.innerHTML = `<tr><td colspan="7" class="text-center p-2 text-danger">Error: Hotel no identificado.</td></tr>`;
    return;
  }

  tbodyEl.innerHTML = `<tr><td colspan="7" class="text-center p-2"><span class="loading-indicator visible">Cargando descuentos...</span></td></tr>`;
  
  try {
    const { data: discounts, error } = await supabaseInstance
      .from('descuentos')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    tbodyEl.innerHTML = ''; // Clear loading message or previous content
    if (!discounts.length) {
      tbodyEl.innerHTML = `<tr><td colspan="7" class="text-center p-2">No hay descuentos configurados.</td></tr>`;
      return;
    }

    const { data: { user } } = await supabaseInstance.auth.getUser(); // Método correcto para obtener el usuario actual
    
    discounts.forEach(d => {
      const tr = document.createElement('tr');
      tr.dataset.id = d.id;

      const valorDisplay = d.tipo === 'porcentaje'
        ? `${d.valor}%`
        : formatCurrency(d.valor);
      
      const usosDisplay = `${d.usos_actuales || 0} / ${(d.usos_maximos || 0) === 0 ? '∞' : d.usos_maximos}`;
      
      tr.innerHTML = `
        <td><strong>${d.codigo}</strong></td>
        <td>${d.tipo.charAt(0).toUpperCase() + d.tipo.slice(1)}</td>
        <td>${valorDisplay}</td>
        <td>${d.expiracion ? formatDateShort(d.expiracion) : 'N/A'}</td>
        <td>${usosDisplay}</td>
        <td><span class="badge ${d.activo ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${d.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td class="actions-cell">
          <button class="button button-outline button-small" data-action="edit" data-id="${d.id}" title="Editar ${d.codigo}">Editar</button>
          <button class="button button-small ${d.activo ? 'button-warning' : 'button-success'}" data-action="toggle" data-id="${d.id}" data-active="${d.activo}" title="${d.activo ? 'Desactivar' : 'Activar'} ${d.codigo}">
            ${d.activo ? 'Desactivar' : 'Activar'}
          </button>
          ${(d.usos_actuales || 0) === 0 ? `<button class="button button-danger button-small" data-action="delete" data-id="${d.id}" title="Eliminar ${d.codigo}">Eliminar</button>` : ''}
        </td>`;
      tbodyEl.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading discounts:', err);
    tbodyEl.innerHTML = `<tr><td colspan="7" class="text-danger text-center p-2">Error al cargar descuentos: ${err.message}</td></tr>`;
  }
}

/**
 * Populates the form for editing a discount.
 * @param {HTMLFormElement} formEl The form element.
 * @param {object} discount The discount data to populate the form with.
 * @param {HTMLElement} formTitleEl The element displaying the form title.
 * @param {HTMLButtonElement} cancelButtonEl The cancel button element.
 */
function populateForm(formEl, discount, formTitleEl, cancelButtonEl) {
  formEl.reset();
  formEl.codigo.value = discount.codigo;
  formEl.tipo.value = discount.tipo;
  formEl.valor.value = discount.valor;
  formEl.expiracion.value = discount.expiracion
    ? new Date(discount.expiracion).toISOString().split('T')[0]
    : '';
  formEl.usos_maximos.value = discount.usos_maximos || 0;
  formEl.activo.checked = discount.activo;
  
  formEl.querySelector('#descuento-id-edit').value = discount.id;
  if (formTitleEl) formTitleEl.textContent = `Editando Descuento: ${discount.codigo}`;
  formEl.querySelector('#btn-guardar-descuento').textContent = 'Actualizar Descuento';
  if (cancelButtonEl) cancelButtonEl.style.display = 'inline-block';
  formEl.codigo.focus();
}

/**
 * Resets the form to its initial state for creating a new discount.
 * @param {HTMLFormElement} formEl The form element.
 * @param {HTMLElement} formTitleEl The element displaying the form title.
 * @param {HTMLButtonElement} cancelButtonEl The cancel button element.
 * @param {HTMLElement} feedbackEl The feedback element to clear.
 */
function resetForm(formEl, formTitleEl, cancelButtonEl, feedbackEl) {
  formEl.reset();
  formEl.querySelector('#descuento-id-edit').value = '';
  if (formTitleEl) formTitleEl.textContent = 'Crear Nuevo Descuento';
  formEl.querySelector('#btn-guardar-descuento').textContent = 'Guardar Descuento';
  if (cancelButtonEl) cancelButtonEl.style.display = 'none';
  formEl.codigo.focus();
  clearFeedback(feedbackEl);
}

export async function mount(container, supabaseInstance, currentUser) {
    console.log('[Descuentos.js] Montando el módulo de descuentos...');
    unmount(container);

    container.innerHTML = `
    <div class="card">
      <div class="card-header"><h2>Gestión de Descuentos y Promociones</h2></div>
      <div class="card-body">
        <div id="descuentos-feedback" role="status" aria-live="polite" class="mb-2" style="min-height: 24px;"></div>
        
        <h3 id="form-descuento-titulo" class="text-lg font-semibold mb-2">Crear Nuevo Descuento</h3>
        <form id="form-descuento" class="form mb-4 p-4 border rounded-lg bg-slate-50" novalidate>
          <input type="hidden" id="descuento-id-edit" name="id" />

          <div class="form-row grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div class="form-group">
              <label for="tipo_descuento_general" class="form-label">Tipo de Descuento *</label>
              <select id="tipo_descuento_general" name="tipo_descuento_general" class="form-control" required>
                <option value="por_codigo">Por Código (manual)</option>
                <option value="automatico">Automático (por fecha)</option>
              </select>
            </div>
            <div class="form-group" id="codigo-container">
              <label for="codigo" class="form-label">Código *</label>
              <input type="text" id="codigo" name="codigo" class="form-control" required maxlength="50" placeholder="EJ: INVIERNO25"/>
            </div>
             <div class="form-group">
              <label for="nombre_descuento" class="form-label">Nombre o Descripción *</label>
              <input type="text" id="nombre_descuento" name="nombre" class="form-control" required maxlength="100" placeholder="Ej: Descuento de Verano"/>
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
                    <option value="todas_las_habitaciones">Todas las habitaciones</option>
                    <option value="habitaciones_especificas">Habitaciones específicas</option>
                </select>
            </div>
            <div class="form-group" id="habitaciones-especificas-container" style="display: none;">
                <label for="habitaciones_aplicables" class="form-label">Seleccionar Habitaciones *</label>
                <select id="habitaciones_aplicables" name="habitaciones_aplicables" class="form-control" multiple size="4"></select>
            </div>
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
                <th>Nombre / Código</th><th>Tipo</th><th>Valor</th><th>Aplicabilidad</th><th>Fechas</th><th>Usos</th><th>Estado</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody id="tabla-descuentos-body"></tbody>
          </table>
        </div>
      </div>
    </div>`;

  const feedbackEl = container.querySelector('#descuentos-feedback');
  const formEl = container.querySelector('#form-descuento');
  const tbodyEl = container.querySelector('#tabla-descuentos-body');
  const btnGuardarEl = container.querySelector('#btn-guardar-descuento');
  const btnCancelarEl = container.querySelector('#btn-cancelar-edicion-descuento');
  const formTitleEl = container.querySelector('#form-descuento-titulo');

  // Determine hotelId
  currentHotelId = currentUser?.user_metadata?.hotel_id;
  if (!currentHotelId && currentUser?.id) {
    try {
      const { data: perfil, error: perfilError } = await supabaseInstance.from('usuarios').select('hotel_id').eq('id', currentUser.id).single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError;
      currentHotelId = perfil?.hotel_id;
    } catch (err) {
      console.error("Error fetching hotel_id for discounts module:", err);
      showError(feedbackEl, 'Error crítico: No se pudo determinar el hotel del usuario.');
      return;
    }
  }
  if (!currentHotelId) {
    showError(feedbackEl, 'No se pudo determinar el hotel. La gestión de descuentos está deshabilitada.');
    if (formEl) formEl.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
    return;
  }

  // Form Submit Handler
  const formSubmitHandler = async (event) => {
    event.preventDefault();
    clearFeedback(feedbackEl);
    
    const formData = new FormData(formEl);
    const originalButtonText = formData.get('id') ? 'Actualizar Descuento' : 'Guardar Descuento';
    setFormLoadingState(formEl, true, btnGuardarEl, originalButtonText, 'Guardando...');
    
    const discountId = formData.get('id');
    const codigoInput = formData.get('codigo')?.trim().toUpperCase();
    const valorInput = parseFloat(formData.get('valor'));

    if (!codigoInput) {
        showError(feedbackEl, 'El código del descuento es obligatorio.');
        setFormLoadingState(formEl, false, btnGuardarEl, originalButtonText);
        formEl.codigo.focus();
        return;
    }
    if (isNaN(valorInput) || valorInput < 0) {
        showError(feedbackEl, 'El valor del descuento debe ser un número positivo.');
        setFormLoadingState(formEl, false, btnGuardarEl, originalButtonText);
        formEl.valor.focus();
        return;
    }
    if (formData.get('tipo') === 'porcentaje' && valorInput > 100) {
        showError(feedbackEl, 'El valor del porcentaje no puede ser mayor a 100.');
        setFormLoadingState(formEl, false, btnGuardarEl, originalButtonText);
        formEl.valor.focus();
        return;
    }

    const payload = {
      hotel_id: currentHotelId,
      codigo: codigoInput,
      tipo: formData.get('tipo'),
      valor: valorInput,
      expiracion: formData.get('expiracion') ? new Date(formData.get('expiracion') + 'T23:59:59.999Z').toISOString() : null,
      usos_maximos: parseInt(formData.get('usos_maximos')) || 0,
      activo: formEl.activo.checked
    };

    try {
      if (discountId) {
        const { error } = await supabaseInstance.from('descuentos').update(payload).eq('id', discountId).eq('hotel_id', currentHotelId);
        if (error) throw error;
        showSuccess(feedbackEl, 'Descuento actualizado exitosamente.');
      } else {
        const { data: existingDiscount, error: existError } = await supabaseInstance.from('descuentos')
          .select('id')
          .eq('hotel_id', currentHotelId)
          .eq('codigo', payload.codigo)
          .maybeSingle();
        if (existError) throw existError;
        if (existingDiscount) {
          throw new Error(`El código de descuento '${payload.codigo}' ya existe para este hotel.`);
        }
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
      if (action === 'edit') {
        const { data: discountToEdit, error } = await supabaseInstance.from('descuentos').select('*').eq('id', discountId).eq('hotel_id', currentHotelId).single();
        if (error) throw error;
        if (discountToEdit) {
            populateForm(formEl, discountToEdit, formTitleEl, btnCancelarEl);
        } else {
            showError(feedbackEl, 'Descuento no encontrado para editar.');
        }
      } else if (action === 'toggle') {
        const currentActiveState = button.dataset.active === 'true';
        const { error } = await supabaseInstance.from('descuentos').update({ activo: !currentActiveState }).eq('id', discountId).eq('hotel_id', currentHotelId);
        if (error) throw error;
        showSuccess(feedbackEl, `Descuento ${!currentActiveState ? 'activado' : 'desactivado'}.`);
        await loadAndRenderDiscounts(tbodyEl, supabaseInstance, currentHotelId);
      } else if (action === 'delete') {
        if (confirm(`¿Está seguro de que desea eliminar permanentemente este descuento? Esta acción no se puede deshacer.`)) {
          const { data: discountCheck, error: checkError } = await supabaseInstance.from('descuentos')
            .select('usos_actuales')
            .eq('id', discountId)
            .eq('hotel_id', currentHotelId)
            .single();

          if (checkError || !discountCheck) throw (checkError || new Error("Descuento no encontrado para verificación."));

          if ((discountCheck.usos_actuales || 0) > 0) {
            showError(feedbackEl, 'No se puede eliminar un descuento que ya ha sido utilizado.');
            return;
          }

          const { error } = await supabaseInstance.from('descuentos').delete().eq('id', discountId).eq('hotel_id', currentHotelId);
          if (error) throw error;
          showSuccess(feedbackEl, 'Descuento eliminado.');
          await loadAndRenderDiscounts(tbodyEl, supabaseInstance, currentHotelId);
          resetForm(formEl, formTitleEl, btnCancelarEl, feedbackEl);
        }
      }
    } catch (err) {
      console.error(`Error performing action ${action} on discount ${discountId}:`, err);
      showError(feedbackEl, `Error en acción '${action}': ${err.message}`);
    }
  };
  tbodyEl.addEventListener('click', tableClickListener);
  moduleListeners.push({ element: tbodyEl, type: 'click', handler: tableClickListener });

  // Cancel Edit Button Handler
  const cancelEditHandler = () => {
    resetForm(formEl, formTitleEl, btnCancelarEl, feedbackEl);
  };
  btnCancelarEl.addEventListener('click', cancelEditHandler);
  moduleListeners.push({ element: btnCancelarEl, type: 'click', handler: cancelEditHandler });

  // Initial load
  await loadAndRenderDiscounts(tbodyEl, supabaseInstance, currentHotelId);
  formEl.codigo.focus();
}

export function unmount(container) {
  moduleListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = [];
  currentHotelId = null;
  console.log('Descuentos module unmounted and listeners cleaned up.');
}