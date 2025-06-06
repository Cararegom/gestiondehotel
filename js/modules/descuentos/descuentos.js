// js/modules/descuentos/descuentos.js
import { formatCurrency, formatDateShort, showLoading, showError, clearFeedback } from '/js/uiUtils.js';

let moduleListeners = []; // Centralized array for event listeners
let currentHotelId = null; // Stores the hotel ID for the current session of this module

/**
 * Placeholder for setFormLoadingState.
 * Implement this in uiUtils.js or define it properly here.
 * @param {HTMLFormElement} formEl The form element.
 * @param {boolean} isLoading True if the form is loading, false otherwise.
 * @param {HTMLButtonElement} submitButton The submit button of the form.
 */
function setFormLoadingState(formEl, isLoading, submitButton) {
  if (!formEl || !submitButton) return;
  const formElements = formEl.elements;
  for (let i = 0; i < formElements.length; i++) {
    formElements[i].disabled = isLoading;
  }
  if (isLoading) {
    submitButton.textContent = 'Guardando...';
    // Consider adding a visual loading indicator to the button or form
  } else {
    // Reset button text based on whether it's an edit or create form
    const discountId = formEl.querySelector('#descuento-id-edit')?.value;
    submitButton.textContent = discountId ? 'Actualizar' : 'Guardar Descuento';
  }
}


/**
 * Loads and renders the list of discounts.
 * @param {HTMLElement} tbodyEl The tbody element to render discounts into.
 * @param {object} supabaseInstance The Supabase client instance.
 * @param {string} hotelId The ID of the current hotel.
 */
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

    discounts.forEach(d => {
      const tr = document.createElement('tr');
      tr.dataset.id = d.id; // For easier access if needed

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
        <td><span class="badge estado-${d.activo ? 'activo' : 'inactivo'}">${d.activo ? 'Activo' : 'Inactivo'}</span></td>
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
  formEl.reset(); // Clear previous values and validation states
  formEl.codigo.value = discount.codigo;
  formEl.tipo.value = discount.tipo;
  formEl.valor.value = discount.valor;
  // Format date for input type="date" which expects YYYY-MM-DD
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
 */
function resetForm(formEl, formTitleEl, cancelButtonEl) {
  formEl.reset();
  formEl.querySelector('#descuento-id-edit').value = ''; // Clear hidden ID
  if (formTitleEl) formTitleEl.textContent = 'Crear Nuevo Descuento';
  formEl.querySelector('#btn-guardar-descuento').textContent = 'Guardar Descuento';
  if (cancelButtonEl) cancelButtonEl.style.display = 'none';
  formEl.codigo.focus();
  clearFeedback('descuentos-feedback'); // Clear any previous feedback
}

export async function mount(container, supabaseInstance, currentUser) {
  // Clear previous listeners and state if mount is called again
  unmount(container);

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><h2>Gestión de Descuentos</h2></div>
      <div class="card-body">
        <div id="descuentos-feedback" role="status" aria-live="polite" class="mb-2" style="min-height: 24px;"></div>
        
        <h3 id="form-descuento-titulo" class="text-lg font-semibold mb-2">Crear Nuevo Descuento</h3>
        <form id="form-descuento" class="form mb-4 p-3 border rounded" novalidate>
          <input type="hidden" id="descuento-id-edit" name="id" />
          <div class="form-row grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
            <div class="form-group">
              <label for="codigo" class="block text-sm font-medium text-gray-700">Código *</label>
              <input type="text" id="codigo" name="codigo" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" required maxlength="50" />
            </div>
            <div class="form-group">
              <label for="tipo" class="block text-sm font-medium text-gray-700">Tipo *</label>
              <select id="tipo" name="tipo" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" required>
                <option value="fijo">Monto Fijo</option>
                <option value="porcentaje">Porcentaje</option>
              </select>
            </div>
            <div class="form-group">
              <label for="valor" class="block text-sm font-medium text-gray-700">Valor *</label>
              <input type="number" id="valor" name="valor" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" required min="0" step="0.01" />
            </div>
          </div>
          <div class="form-row grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
            <div class="form-group">
              <label for="expiracion" class="block text-sm font-medium text-gray-700">Fecha de Expiración</label>
              <input type="date" id="expiracion" name="expiracion" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" />
            </div>
            <div class="form-group">
              <label for="usos_maximos" class="block text-sm font-medium text-gray-700">Límite de Usos (0 para ilimitado)</label>
              <input type="number" id="usos_maximos" name="usos_maximos" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" min="0" placeholder="0" />
            </div>
          </div>
          <div class="form-group mb-4">
            <div class="flex items-center">
              <input type="checkbox" id="activo" name="activo" class="form-check-input h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" checked />
              <label for="activo" class="ml-2 block text-sm text-gray-900">Activo</label>
            </div>
          </div>
          <div class="form-actions flex items-center gap-3">
            <button type="submit" id="btn-guardar-descuento" class="button button-primary">Guardar Descuento</button>
            <button type="button" id="btn-cancelar-edicion-descuento" class="button button-outline" style="display:none;">Cancelar Edición</button>
          </div>
        </form>
        <hr class="my-4"/>
        <h3 class="text-lg font-semibold mb-2">Descuentos Existentes</h3>
        <div class="table-container overflow-x-auto">
          <table class="tabla-estilizada w-full">
            <thead>
              <tr>
                <th>Código</th><th>Tipo</th><th>Valor</th><th>Expiración</th>
                <th>Usos (Actual/Máx)</th><th>Estado</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody id="tabla-descuentos-body"></tbody>
          </table>
        </div>
      </div>
    </div>`;

  const feedbackElId = 'descuentos-feedback'; // ID for the feedback element
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
      showError(feedbackElId, 'Error crítico: No se pudo determinar el hotel del usuario.', 'error', true);
      return;
    }
  }
  if (!currentHotelId) {
    showError(feedbackElId, 'No se pudo determinar el hotel. La gestión de descuentos está deshabilitada.', 'error', true);
    if (formEl) formEl.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
    return;
  }

  // Form Submit Handler
  const formSubmitHandler = async (event) => {
    event.preventDefault();
    clearFeedback(feedbackElId);
    setFormLoadingState(formEl, true, btnGuardarEl);

    const formData = new FormData(formEl);
    const discountId = formData.get('id');
    const codigoInput = formData.get('codigo')?.trim().toUpperCase();
    const valorInput = parseFloat(formData.get('valor'));

    if (!codigoInput) {
        showError(feedbackElId, 'El código del descuento es obligatorio.', 'error');
        setFormLoadingState(formEl, false, btnGuardarEl);
        formEl.codigo.focus();
        return;
    }
    if (isNaN(valorInput) || valorInput < 0) {
        showError(feedbackElId, 'El valor del descuento debe ser un número positivo.', 'error');
        setFormLoadingState(formEl, false, btnGuardarEl);
        formEl.valor.focus();
        return;
    }
    if (formData.get('tipo') === 'porcentaje' && valorInput > 100) {
        showError(feedbackElId, 'El valor del porcentaje no puede ser mayor a 100.', 'error');
        setFormLoadingState(formEl, false, btnGuardarEl);
        formEl.valor.focus();
        return;
    }


    const payload = {
      hotel_id: currentHotelId,
      codigo: codigoInput,
      tipo: formData.get('tipo'),
      valor: valorInput,
      // Ensure date is handled correctly: input type="date" gives YYYY-MM-DD.
      // Appending time and converting to ISOString for UTC end of day.
      expiracion: formData.get('expiracion') ? new Date(formData.get('expiracion') + 'T23:59:59.999Z').toISOString() : null,
      usos_maximos: parseInt(formData.get('usos_maximos')) || 0, // 0 for unlimited
      activo: formEl.activo.checked // Directly from checkbox element state
    };

    try {
      if (discountId) { // Update existing discount
        const { error } = await supabaseInstance.from('descuentos').update(payload).eq('id', discountId).eq('hotel_id', currentHotelId);
        if (error) throw error;
        showError(feedbackElId, 'Descuento actualizado exitosamente.', 'success', true);
      } else { // Create new discount
        // Check if code already exists for this hotel
        const { data: existingDiscount, error: existError } = await supabaseInstance.from('descuentos')
          .select('id')
          .eq('hotel_id', currentHotelId)
          .eq('codigo', payload.codigo)
          .maybeSingle();
        if (existError) throw existError;
        if (existingDiscount) {
          throw new Error(`El código de descuento '${payload.codigo}' ya existe para este hotel.`);
        }
        // Add usos_actuales for new discounts
        payload.usos_actuales = 0; 
        const { error } = await supabaseInstance.from('descuentos').insert(payload);
        if (error) throw error;
        showError(feedbackElId, 'Descuento creado exitosamente.', 'success', true);
      }
      resetForm(formEl, formTitleEl, btnCancelarEl);
      await loadAndRenderDiscounts(tbodyEl, supabaseInstance, currentHotelId);
    } catch (err) {
      console.error('Error saving discount:', err);
      showError(feedbackElId, `Error al guardar: ${err.message}`, 'error', true);
    } finally {
      setFormLoadingState(formEl, false, btnGuardarEl);
    }
  };
  formEl.addEventListener('submit', formSubmitHandler);
  moduleListeners.push({ element: formEl, type: 'submit', handler: formSubmitHandler });

  // Table Click Handler (for edit, toggle, delete)
  const tableClickListener = async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const discountId = button.dataset.id;
    const action = button.dataset.action;
    clearFeedback(feedbackElId);

    try {
      if (action === 'edit') {
        const { data: discountToEdit, error } = await supabaseInstance.from('descuentos').select('*').eq('id', discountId).eq('hotel_id', currentHotelId).single();
        if (error) throw error;
        if (discountToEdit) {
            populateForm(formEl, discountToEdit, formTitleEl, btnCancelarEl);
        } else {
            showError(feedbackElId, 'Descuento no encontrado para editar.', 'error');
        }
      } else if (action === 'toggle') {
        const currentActiveState = button.dataset.active === 'true';
        const { error } = await supabaseInstance.from('descuentos').update({ activo: !currentActiveState }).eq('id', discountId).eq('hotel_id', currentHotelId);
        if (error) throw error;
        showError(feedbackElId, `Descuento ${!currentActiveState ? 'activado' : 'desactivado'}.`, 'success');
        await loadAndRenderDiscounts(tbodyEl, supabaseInstance, currentHotelId);
      } else if (action === 'delete') {
        if (confirm(`¿Está seguro de que desea eliminar permanentemente este descuento? Esta acción no se puede deshacer.`)) {
          // Double check usos_actuales before deleting, though UI should prevent button if > 0
          const { data: discountCheck, error: checkError } = await supabaseInstance.from('descuentos')
            .select('usos_actuales')
            .eq('id', discountId)
            .eq('hotel_id', currentHotelId)
            .single();

          if (checkError || !discountCheck) throw (checkError || new Error("Descuento no encontrado para verificación."));

          if ((discountCheck.usos_actuales || 0) > 0) {
            showError(feedbackElId, 'No se puede eliminar un descuento que ya ha sido utilizado.', 'error');
            return;
          }

          const { error } = await supabaseInstance.from('descuentos').delete().eq('id', discountId).eq('hotel_id', currentHotelId);
          if (error) throw error;
          showError(feedbackElId, 'Descuento eliminado.', 'success');
          await loadAndRenderDiscounts(tbodyEl, supabaseInstance, currentHotelId);
          resetForm(formEl, formTitleEl, btnCancelarEl); // Reset if the deleted one was being edited
        }
      }
    } catch (err) {
      console.error(`Error performing action ${action} on discount ${discountId}:`, err);
      showError(feedbackElId, `Error en acción '${action}': ${err.message}`, 'error');
    }
  };
  tbodyEl.addEventListener('click', tableClickListener);
  moduleListeners.push({ element: tbodyEl, type: 'click', handler: tableClickListener });

  // Cancel Edit Button Handler
  const cancelEditHandler = () => {
    resetForm(formEl, formTitleEl, btnCancelarEl);
  };
  btnCancelarEl.addEventListener('click', cancelEditHandler);
  moduleListeners.push({ element: btnCancelarEl, type: 'click', handler: cancelEditHandler });

  // Initial load of discounts
  await loadAndRenderDiscounts(tbodyEl, supabaseInstance, currentHotelId);
  formEl.codigo.focus(); // Focus on the first input field
}

export function unmount(container) { // container can be used if elements are not globally unique by ID
  moduleListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = []; // Clear the listeners array
  currentHotelId = null; // Reset hotel ID
  
  // Optional: Clear the container's content if this module is truly being removed
  // if (container && typeof container.innerHTML === 'string') {
  //   container.innerHTML = '';
  // }
  console.log('Descuentos module unmounted and listeners cleaned up.');
}

