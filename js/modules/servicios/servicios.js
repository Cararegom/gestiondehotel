// js/modules/servicios/servicios.js
// import { supabase } from '../../supabaseClient.js'; // Will use currentSupabaseInstance from mount

// --- Module-Scoped Variables ---
let moduleListeners = [];
let currentHotelId = null;
let currentModuleUser = null;
let currentSupabaseInstance = null;
let tiposServicioCache = []; // Cache for populating the select in the additional services form

// --- UTILITIES ---
const formatCurrencyLocal = (value, currency = 'COP') => {
  if (typeof value !== 'number' || isNaN(value)) {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency }).format(0);
  }
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency }).format(value);
};

// --- UI Helper Functions (Scoped) ---
/**
 * Shows a feedback message.
 * @param {HTMLElement} feedbackEl - The feedback display element.
 * @param {string} message - The message to show.
 * @param {'success-indicator' | 'error-indicator' | 'info-indicator'} [typeClass='success-indicator'] - CSS class for feedback type.
 * @param {number} [duration=3000] - Duration in ms. 0 for indefinite.
 */
function showServiciosFeedback(feedbackEl, message, typeClass = 'success-indicator', duration = 3000) {
  if (!feedbackEl) {
    console.warn("Feedback element not provided to showServiciosFeedback");
    return;
  }
  feedbackEl.textContent = message;
  let alertClasses = 'bg-green-100 border-green-300 text-green-700'; // success
  if (typeClass === 'error-indicator') {
    alertClasses = 'bg-red-100 border-red-300 text-red-700';
  } else if (typeClass === 'info-indicator') {
    alertClasses = 'bg-blue-100 border-blue-300 text-blue-700';
  }
  feedbackEl.className = `feedback-message mt-2 mb-3 p-3 rounded-md border text-sm ${alertClasses} visible`;
  feedbackEl.style.display = 'block';
  feedbackEl.setAttribute('aria-live', typeClass === 'error-indicator' ? 'assertive' : 'polite');

  if (typeClass.includes('error-indicator')) {
    feedbackEl.setAttribute('tabindex', '-1');
    feedbackEl.focus();
  }
  if (duration > 0) {
    setTimeout(() => clearServiciosFeedback(feedbackEl), duration);
  }
}

/**
 * Clears the feedback message.
 * @param {HTMLElement} feedbackEl - The feedback display element.
 */
function clearServiciosFeedback(feedbackEl) {
  if (!feedbackEl) return;
  feedbackEl.textContent = '';
  feedbackEl.className = 'feedback-message mt-2 mb-3'; // Reset classes
  feedbackEl.style.display = 'none';
  feedbackEl.removeAttribute('tabindex');
}

/**
 * Sets the loading state for a form.
 * @param {HTMLFormElement} formEl - The form element.
 * @param {boolean} isLoading - True if loading, false otherwise.
 * @param {HTMLButtonElement} buttonEl - The submit button.
 * @param {string} originalButtonText - The button's original text.
 * @param {string} [loadingButtonText='Procesando...'] - Text for the button when loading.
 */
function setFormLoadingState(formEl, isLoading, buttonEl, originalButtonText, loadingButtonText = 'Procesando...') {
  if (!formEl) return;
  if (buttonEl) {
    buttonEl.disabled = isLoading;
    buttonEl.textContent = isLoading ? loadingButtonText : originalButtonText;
    if(isLoading) buttonEl.classList.add('opacity-75', 'cursor-not-allowed');
    else buttonEl.classList.remove('opacity-75', 'cursor-not-allowed');
  }
  Array.from(formEl.elements).forEach(el => {
    if (el.type !== 'submit' && el.type !== 'button') { // Avoid re-disabling the submit button
        el.disabled = isLoading;
    }
  });
}

// --- Logic for Service Categories (Tipos de Servicio) ---
/**
 * Loads and renders service categories into a table and a select element.
 * @param {HTMLElement} tbodyEl - The tbody element for the categories table.
 * @param {HTMLSelectElement} selectServicioTipoEl - The select element for service categories (in the additional services form).
 * @param {object} supabaseInstance - The Supabase client instance.
 * @param {string} hotelId - The current hotel ID.
 */
async function cargarYRenderizarTiposServicio(tbodyEl, selectServicioTipoEl, supabaseInstance, hotelId) {
  if (!hotelId) {
    console.error("Hotel ID missing for cargarYRenderizarTiposServicio");
    if (tbodyEl) tbodyEl.innerHTML = `<tr><td colspan="3" class="text-center p-2 text-red-600">Error: Hotel no identificado.</td></tr>`;
    if (selectServicioTipoEl) selectServicioTipoEl.innerHTML = `<option value="" disabled>Error</option>`;
    return;
  }

  if (tbodyEl) tbodyEl.innerHTML = `<tr><td colspan="3" class="text-center p-3 text-gray-500">Cargando categorías...</td></tr>`;
  if (selectServicioTipoEl) selectServicioTipoEl.innerHTML = `<option value="">Cargando categorías...</option>`;

  try {
    const { data: tipos, error } = await supabaseInstance
      .from('tipos_servicio')
      .select('id, nombre, activo')
      .eq('hotel_id', hotelId)
      .order('nombre', { ascending: true });
    if (error) throw error;

    tiposServicioCache = tipos || [];

    // Render table for service categories
    if (tbodyEl) {
      tbodyEl.innerHTML = '';
      if (tiposServicioCache.length === 0) {
        tbodyEl.innerHTML = `<tr><td colspan="3" class="text-center p-3 text-gray-500">No hay categorías de servicio creadas.</td></tr>`;
      } else {
        tiposServicioCache.forEach(tipo => {
          const tr = document.createElement('tr');
          tr.className = "hover:bg-gray-50";
          tr.dataset.tipoId = tipo.id;
          tr.innerHTML = `
            <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${tipo.nombre}</td>
            <td class="px-4 py-2 whitespace-nowrap text-sm">
              <span class="badge px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${tipo.activo ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                ${tipo.activo ? 'Activo' : 'Inactivo'}
              </span>
            </td>
            <td class="px-4 py-2 whitespace-nowrap text-sm font-medium space-x-2">
              <button class="button button-outline button-small text-xs" data-accion="editar-tipo" data-id="${tipo.id}" title="Editar ${tipo.nombre}">Editar</button>
              <button class="button button-small text-xs ${tipo.activo ? 'button-warning' : 'button-success'}" data-accion="toggle-activo-tipo" data-id="${tipo.id}" data-estado-actual="${tipo.activo}" title="${tipo.activo ? 'Desactivar' : 'Activar'}">
                ${tipo.activo ? 'Desactivar' : 'Activar'}
              </button>
            </td>`;
          tbodyEl.appendChild(tr);
        });
      }
    }

    // Populate select element (for additional services form)
    if (selectServicioTipoEl) {
      const activeTipos = tiposServicioCache.filter(t => t.activo);
      selectServicioTipoEl.innerHTML = activeTipos.length > 0
        ? `<option value="">-- Seleccione una Categoría --</option>` + activeTipos.map(t => `<option value="${t.id}">${t.nombre}</option>`).join('')
        : `<option value="" disabled>No hay categorías activas. Cree una primero.</option>`;
    }
  } catch (err) {
    console.error('Error loading service categories:', err);
    if (tbodyEl) tbodyEl.innerHTML = `<tr><td colspan="3" class="text-red-600 text-center p-3">Error al cargar categorías: ${err.message}</td></tr>`;
    if (selectServicioTipoEl) selectServicioTipoEl.innerHTML = `<option value="" disabled>Error al cargar categorías</option>`;
  }
}

/**
 * Populates the service category form for editing.
 * @param {HTMLFormElement} formEl - The form element.
 * @param {object} tipoServicioData - The service category data.
 * @param {HTMLButtonElement} btnCancelarEl - The cancel button.
 */
function poblarFormularioTipoServicio(formEl, tipoServicioData, btnCancelarEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.tipoServicioIdEdit.value = tipoServicioData.id;
  formEl.elements.nombreTipo.value = tipoServicioData.nombre;
  // Assuming 'activo' checkbox for category form, if not, this needs adjustment
  // formEl.elements.activoTipo.checked = tipoServicioData.activo; 
  formEl.querySelector('#btn-guardar-tipo-servicio').textContent = 'Actualizar Categoría';
  if (btnCancelarEl) btnCancelarEl.style.display = 'inline-block';
  formEl.elements.nombreTipo.focus();
}

/**
 * Resets the service category form.
 * @param {HTMLFormElement} formEl - The form element.
 * @param {HTMLButtonElement} btnCancelarEl - The cancel button.
 */
function resetearFormularioTipoServicio(formEl, btnCancelarEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.tipoServicioIdEdit.value = '';
  formEl.querySelector('#btn-guardar-tipo-servicio').textContent = 'Guardar Categoría';
  if (btnCancelarEl) btnCancelarEl.style.display = 'none';
  formEl.elements.nombreTipo.focus();
}

// --- Logic for Additional Services ---
/**
 * Loads and renders additional services into a table.
 * @param {HTMLElement} tbodyEl - The tbody element for the services table.
 * @param {object} supabaseInstance - The Supabase client instance.
 * @param {string} hotelId - The current hotel ID.
 */
async function cargarYRenderizarServiciosAdicionales(tbodyEl, supabaseInstance, hotelId) {
  if (!hotelId) {
    console.error("Hotel ID missing for cargarYRenderizarServiciosAdicionales");
    if (tbodyEl) tbodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-2 text-red-600">Error: Hotel no identificado.</td></tr>`;
    return;
  }
  if (!tbodyEl) {
    console.error("Table body for additional services not found.");
    return;
  }
  tbodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-3 text-gray-500">Cargando servicios adicionales...</td></tr>`;
  try {
    const { data: servicios, error } = await supabaseInstance
      .from('servicios_adicionales')
      .select(`id, nombre, precio, activo, tipo_id, tipos_servicio(nombre)`) // Join with tipos_servicio
      .eq('hotel_id', hotelId)
      .order('nombre', { ascending: true });
    if (error) throw error;

    tbodyEl.innerHTML = '';
    if (servicios.length === 0) {
      tbodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-3 text-gray-500">No hay servicios adicionales creados.</td></tr>`;
      return;
    }
    servicios.forEach(s => {
      const tr = document.createElement('tr');
      tr.className = "hover:bg-gray-50";
      tr.dataset.servicioId = s.id;
      tr.innerHTML = `
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${s.nombre}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${s.tipos_servicio?.nombre || 'Sin Categoría'}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${formatCurrencyLocal(s.precio)}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm">
          <span class="badge px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${s.activo ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
            ${s.activo ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td class="px-4 py-2 whitespace-nowrap text-sm font-medium space-x-2">
          <button class="button button-outline button-small text-xs" data-accion="editar-servicio" data-id="${s.id}" title="Editar ${s.nombre}">Editar</button>
          <button class="button button-small text-xs ${s.activo ? 'button-warning' : 'button-success'}" data-accion="toggle-activo-servicio" data-id="${s.id}" data-estado-actual="${s.activo}" title="${s.activo ? 'Desactivar' : 'Activar'}">
            ${s.activo ? 'Desactivar' : 'Activar'}
          </button>
        </td>`;
      tbodyEl.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading additional services:', err);
    tbodyEl.innerHTML = `<tr><td colspan="5" class="text-red-600 text-center p-3">Error al cargar servicios: ${err.message}</td></tr>`;
  }
}

/**
 * Populates the additional service form for editing.
 * @param {HTMLFormElement} formEl - The form element.
 * @param {object} servicioData - The service data.
 * @param {HTMLElement} formTitleEl - The HMTL element for the form title.
 * @param {HTMLButtonElement} btnCancelarEl - The cancel button.
 */
function poblarFormularioServicio(formEl, servicioData, formTitleEl, btnCancelarEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.servicioIdEdit.value = servicioData.id;
  if (formTitleEl) formTitleEl.textContent = `Editando Servicio: ${servicioData.nombre}`;
  formEl.elements.nombreServicio.value = servicioData.nombre;
  formEl.elements.tipo_id.value = servicioData.tipo_id || '';
  formEl.elements.precioServicio.value = servicioData.precio;
  formEl.elements.activoServicio.checked = servicioData.activo;
  formEl.querySelector('#btn-guardar-servicio').textContent = 'Actualizar Servicio';
  if (btnCancelarEl) btnCancelarEl.style.display = 'inline-block';
  formEl.elements.nombreServicio.focus();
}

/**
 * Resets the additional service form.
 * @param {HTMLFormElement} formEl - The form element.
 * @param {HTMLElement} formTitleEl - The HMTL element for the form title.
 * @param {HTMLButtonElement} btnCancelarEl - The cancel button.
 */
function resetearFormularioServicio(formEl, formTitleEl, btnCancelarEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.servicioIdEdit.value = '';
  if (formTitleEl) formTitleEl.textContent = 'Agregar Nuevo Servicio Adicional';
  formEl.querySelector('#btn-guardar-servicio').textContent = 'Guardar Servicio';
  if (btnCancelarEl) btnCancelarEl.style.display = 'none';
  formEl.elements.nombreServicio.focus();
}

// --- Main Module Mount Function ---
/**
 * Mounts the services module.
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
      const { data: perfil, error: perfilError } = await currentSupabaseInstance
        .from('usuarios').select('hotel_id').eq('id', currentModuleUser.id).single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError;
      currentHotelId = perfil?.hotel_id;
    } catch (e) {
      console.error('Servicios Module: Error fetching hotelId from profile:', e);
    }
  }

  // Full HTML structure for the module
  container.innerHTML = `
    <div class="card servicios-module shadow-lg rounded-lg">
      <div class="card-header bg-gray-100 p-4 border-b">
        <h2 class="text-xl font-semibold text-gray-800">Gestión de Servicios Adicionales</h2>
      </div>
      <div class="card-body p-4 md:p-6 space-y-8">
        <div id="servicios-feedback" role="status" aria-live="polite" style="display:none;" class="feedback-message mb-4"></div>

        <section id="section-tipos-servicio" class="p-4 border rounded-md bg-gray-50 shadow-sm">
          <h3 class="text-lg font-semibold text-gray-700 mb-3">Categorías de Servicios</h3>
          <form id="form-tipo-servicio" class="form space-y-3 mb-4" novalidate>
            <input type="hidden" id="tipoServicioIdEdit" name="tipoServicioIdEdit" />
            <div>
              <label for="nombreTipo" class="block text-sm font-medium text-gray-600">Nombre de la Categoría *</label>
              <input type="text" id="nombreTipo" name="nombreTipo" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" required maxlength="100" />
            </div>
            <div class="form-actions flex items-center gap-3">
              <button type="submit" id="btn-guardar-tipo-servicio" class="button button-primary text-sm py-2 px-3 rounded-md">Guardar Categoría</button>
              <button type="button" id="btn-cancelar-edicion-tipo" class="button button-outline text-sm py-2 px-3 rounded-md" style="display:none;">Cancelar</button>
            </div>
          </form>
          <div class="table-container overflow-x-auto">
            <table class="tabla-estilizada w-full min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nombre Categoría</th>
                  <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                  <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody id="tabla-tipos-servicio-body" class="bg-white divide-y divide-gray-200"></tbody>
            </table>
          </div>
        </section>

        <hr class="my-6"/>

        <section id="section-servicios-adicionales" class="p-4 border rounded-md bg-gray-50 shadow-sm">
          <h3 id="form-servicio-adicional-titulo" class="text-lg font-semibold text-gray-700 mb-3">Agregar Nuevo Servicio Adicional</h3>
          <form id="form-servicio-adicional" class="form grid grid-cols-1 md:grid-cols-2 gap-4 mb-4" novalidate>
            <input type="hidden" id="servicioIdEdit" name="servicioIdEdit" />
            <div class="form-group">
              <label for="nombreServicio" class="block text-sm font-medium text-gray-600">Nombre del Servicio *</label>
              <input type="text" id="nombreServicio" name="nombreServicio" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" required maxlength="150" />
            </div>
            <div class="form-group">
              <label for="servicio-tipo" class="block text-sm font-medium text-gray-600">Categoría del Servicio</label>
              <select id="servicio-tipo" name="tipo_id" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm">
                <option value="">Cargando categorías...</option>
              </select>
            </div>
            <div class="form-group">
              <label for="precioServicio" class="block text-sm font-medium text-gray-600">Precio *</label>
              <input type="number" id="precioServicio" name="precioServicio" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" required min="0" step="0.01" />
            </div>
            <div class="form-group flex items-center pt-6">
              <input type="checkbox" id="activoServicio" name="activoServicio" class="form-check-input h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" checked />
              <label for="activoServicio" class="ml-2 block text-sm text-gray-900">Servicio Activo</label>
            </div>
            <div class="form-actions md:col-span-2 flex items-center gap-3 mt-2">
              <button type="submit" id="btn-guardar-servicio" class="button button-primary text-sm py-2 px-3 rounded-md">Guardar Servicio</button>
              <button type="button" id="btn-cancelar-edicion-servicio" class="button button-outline text-sm py-2 px-3 rounded-md" style="display:none;">Cancelar</button>
            </div>
          </form>
          <div class="table-container overflow-x-auto">
            <table class="tabla-estilizada w-full min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Servicio</th>
                  <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Categoría</th>
                  <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Precio</th>
                  <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                  <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody id="tabla-servicios-adicionales-body" class="bg-white divide-y divide-gray-200"></tbody>
            </table>
          </div>
        </section>
      </div>
    </div>`;

  // DOM Element References (scoped to container)
  const feedbackGlobalEl = container.querySelector('#servicios-feedback');
  
  const formTipoServicioEl = container.querySelector('#form-tipo-servicio');
  const tablaTiposServicioBodyEl = container.querySelector('#tabla-tipos-servicio-body');
  const btnGuardarTipoServicioEl = container.querySelector('#btn-guardar-tipo-servicio');
  const btnCancelarEdicionTipoEl = container.querySelector('#btn-cancelar-edicion-tipo');

  const formServicioAdicionalEl = container.querySelector('#form-servicio-adicional');
  const tablaServiciosAdicionalesBodyEl = container.querySelector('#tabla-servicios-adicionales-body');
  const selectServicioTipoEl = container.querySelector('#servicio-tipo'); // For the services form
  const btnGuardarServicioEl = container.querySelector('#btn-guardar-servicio');
  const btnCancelarEdicionServicioEl = container.querySelector('#btn-cancelar-edicion-servicio');
  const formServicioAdicionalTitleEl = container.querySelector('#form-servicio-adicional-titulo');


  if (!currentHotelId) {
    showServiciosFeedback(feedbackGlobalEl, 'Error crítico: No se pudo determinar el hotel. Módulo deshabilitado.', 'error-indicator', 0);
    // Disable all forms if hotelId is missing
    if(formTipoServicioEl) formTipoServicioEl.querySelectorAll('input, button, select').forEach(el => el.disabled = true);
    if(formServicioAdicionalEl) formServicioAdicionalEl.querySelectorAll('input, button, select').forEach(el => el.disabled = true);
    return;
  }

  // --- Event Handlers & Logic for Service Categories (Tipos de Servicio) ---
  const tipoServicioFormSubmitHandler = async (event) => {
    event.preventDefault();
    clearServiciosFeedback(feedbackGlobalEl);
    const originalButtonText = btnGuardarTipoServicioEl.textContent;
    setFormLoadingState(formTipoServicioEl, true, btnGuardarTipoServicioEl, originalButtonText, 'Guardando...');

    const formData = new FormData(formTipoServicioEl);
    const idEdit = formData.get('tipoServicioIdEdit');
    const nombreTipo = formData.get('nombreTipo')?.trim();

    if (!nombreTipo) {
      showServiciosFeedback(feedbackGlobalEl, 'El nombre de la categoría es obligatorio.', 'error-indicator');
      setFormLoadingState(formTipoServicioEl, false, btnGuardarTipoServicioEl, originalButtonText);
      formTipoServicioEl.elements.nombreTipo.focus();
      return;
    }

    const payload = {
      hotel_id: currentHotelId,
      nombre: nombreTipo,
      activo: true // By default, new categories are active. Add checkbox if needed.
    };

    try {
      if (idEdit) { // Update
        const { error } = await currentSupabaseInstance.from('tipos_servicio')
          .update(payload).eq('id', idEdit).eq('hotel_id', currentHotelId);
        if (error) throw error;
        showServiciosFeedback(feedbackGlobalEl, 'Categoría actualizada exitosamente.', 'success-indicator');
      } else { // Create
        const { error } = await currentSupabaseInstance.from('tipos_servicio').insert(payload);
        if (error) throw error;
        showServiciosFeedback(feedbackGlobalEl, 'Categoría creada exitosamente.', 'success-indicator');
      }
      resetearFormularioTipoServicio(formTipoServicioEl, btnCancelarEdicionTipoEl);
      await cargarYRenderizarTiposServicio(tablaTiposServicioBodyEl, selectServicioTipoEl, currentSupabaseInstance, currentHotelId);
    } catch (err) {
      console.error('Error saving service category:', err);
      showServiciosFeedback(feedbackGlobalEl, `Error al guardar categoría: ${err.message}`, 'error-indicator', 0);
    } finally {
      setFormLoadingState(formTipoServicioEl, false, btnGuardarTipoServicioEl, originalButtonText);
    }
  };
  formTipoServicioEl.addEventListener('submit', tipoServicioFormSubmitHandler);
  moduleListeners.push({ element: formTipoServicioEl, type: 'submit', handler: tipoServicioFormSubmitHandler });

  btnCancelarEdicionTipoEl.addEventListener('click', () => {
    resetearFormularioTipoServicio(formTipoServicioEl, btnCancelarEdicionTipoEl);
    clearServiciosFeedback(feedbackGlobalEl);
  });
  moduleListeners.push({ element: btnCancelarEdicionTipoEl, type: 'click', handler: () => resetearFormularioTipoServicio(formTipoServicioEl, btnCancelarEdicionTipoEl) });
  
  // Event delegation for actions on the service categories table
  const tablaTiposServicioClickHandler = async (event) => {
    const button = event.target.closest('button[data-accion]');
    if (!button) return;

    const tipoId = button.dataset.id;
    const accion = button.dataset.accion;
    clearServiciosFeedback(feedbackGlobalEl);

    if (accion === 'editar-tipo') {
      const tipoToEdit = tiposServicioCache.find(t => t.id.toString() === tipoId);
      if (tipoToEdit) {
        poblarFormularioTipoServicio(formTipoServicioEl, tipoToEdit, btnCancelarEdicionTipoEl);
        window.scrollTo({ top: formTipoServicioEl.offsetTop - 20, behavior: 'smooth' });
      } else {
        showServiciosFeedback(feedbackGlobalEl, 'Categoría no encontrada para editar.', 'error-indicator');
      }
    } else if (accion === 'toggle-activo-tipo') {
      const estadoActual = button.dataset.estadoActual === 'true';
      try {
        const { error } = await currentSupabaseInstance.from('tipos_servicio')
          .update({ activo: !estadoActual }).eq('id', tipoId).eq('hotel_id', currentHotelId);
        if (error) throw error;
        showServiciosFeedback(feedbackGlobalEl, `Categoría ${!estadoActual ? 'activada' : 'desactivada'}.`, 'success-indicator');
        await cargarYRenderizarTiposServicio(tablaTiposServicioBodyEl, selectServicioTipoEl, currentSupabaseInstance, currentHotelId);
      } catch (err) {
        showServiciosFeedback(feedbackGlobalEl, `Error al cambiar estado: ${err.message}`, 'error-indicator', 0);
      }
    }
  };
  tablaTiposServicioBodyEl.addEventListener('click', tablaTiposServicioClickHandler);
  moduleListeners.push({ element: tablaTiposServicioBodyEl, type: 'click', handler: tablaTiposServicioClickHandler });


  // --- Event Handlers & Logic for Additional Services ---
  const servicioAdicionalFormSubmitHandler = async (event) => {
    event.preventDefault();
    clearServiciosFeedback(feedbackGlobalEl);
    const originalButtonText = btnGuardarServicioEl.textContent;
    setFormLoadingState(formServicioAdicionalEl, true, btnGuardarServicioEl, originalButtonText, 'Guardando...');

    const formData = new FormData(formServicioAdicionalEl);
    const idEdit = formData.get('servicioIdEdit');
    const nombreServicio = formData.get('nombreServicio')?.trim();
    const precioServicio = parseFloat(formData.get('precioServicio'));

    if (!nombreServicio) {
      showServiciosFeedback(feedbackGlobalEl, 'El nombre del servicio es obligatorio.', 'error-indicator');
      setFormLoadingState(formServicioAdicionalEl, false, btnGuardarServicioEl, originalButtonText);
      formServicioAdicionalEl.elements.nombreServicio.focus();
      return;
    }
    if (isNaN(precioServicio) || precioServicio < 0) {
      showServiciosFeedback(feedbackGlobalEl, 'El precio del servicio debe ser un número positivo.', 'error-indicator');
      setFormLoadingState(formServicioAdicionalEl, false, btnGuardarServicioEl, originalButtonText);
      formServicioAdicionalEl.elements.precioServicio.focus();
      return;
    }
    
    const payload = {
      hotel_id: currentHotelId,
      nombre: nombreServicio,
      tipo_id: formData.get('tipo_id') || null,
      precio: precioServicio,
      activo: formServicioAdicionalEl.elements.activoServicio.checked
    };

    try {
      if (idEdit) { // Update
        const { error } = await currentSupabaseInstance.from('servicios_adicionales')
          .update(payload).eq('id', idEdit).eq('hotel_id', currentHotelId);
        if (error) throw error;
        showServiciosFeedback(feedbackGlobalEl, 'Servicio actualizado exitosamente.', 'success-indicator');
      } else { // Create
        const { error } = await currentSupabaseInstance.from('servicios_adicionales').insert(payload);
        if (error) throw error;
        showServiciosFeedback(feedbackGlobalEl, 'Servicio creado exitosamente.', 'success-indicator');
      }
      resetearFormularioServicio(formServicioAdicionalEl, formServicioAdicionalTitleEl, btnCancelarEdicionServicioEl);
      await cargarYRenderizarServiciosAdicionales(tablaServiciosAdicionalesBodyEl, currentSupabaseInstance, currentHotelId);
    } catch (err) {
      console.error('Error saving additional service:', err);
      showServiciosFeedback(feedbackGlobalEl, `Error al guardar servicio: ${err.message}`, 'error-indicator', 0);
    } finally {
      setFormLoadingState(formServicioAdicionalEl, false, btnGuardarServicioEl, originalButtonText);
    }
  };
  formServicioAdicionalEl.addEventListener('submit', servicioAdicionalFormSubmitHandler);
  moduleListeners.push({ element: formServicioAdicionalEl, type: 'submit', handler: servicioAdicionalFormSubmitHandler });
  
  btnCancelarEdicionServicioEl.addEventListener('click', () => {
    resetearFormularioServicio(formServicioAdicionalEl, formServicioAdicionalTitleEl, btnCancelarEdicionServicioEl);
    clearServiciosFeedback(feedbackGlobalEl);
  });
  moduleListeners.push({ element: btnCancelarEdicionServicioEl, type: 'click', handler: () => resetearFormularioServicio(formServicioAdicionalEl, formServicioAdicionalTitleEl, btnCancelarEdicionServicioEl) });

  // Event delegation for actions on the additional services table
  const tablaServiciosAdicionalesClickHandler = async (event) => {
    const button = event.target.closest('button[data-accion]');
    if (!button) return;

    const servicioId = button.dataset.id;
    const accion = button.dataset.accion;
    clearServiciosFeedback(feedbackGlobalEl);

    if (accion === 'editar-servicio') {
        try {
            const { data: servicioToEdit, error } = await currentSupabaseInstance.from('servicios_adicionales')
                .select('*, tipos_servicio(nombre)') // Ensure you fetch all needed data for the form
                .eq('id', servicioId)
                .eq('hotel_id', currentHotelId)
                .single();
            if (error) throw error;
            if (servicioToEdit) {
                poblarFormularioServicio(formServicioAdicionalEl, servicioToEdit, formServicioAdicionalTitleEl, btnCancelarEdicionServicioEl);
                 window.scrollTo({ top: formServicioAdicionalEl.offsetTop - 20, behavior: 'smooth' });
            } else {
                showServiciosFeedback(feedbackGlobalEl, 'Servicio no encontrado para editar.', 'error-indicator');
            }
        } catch (err) {
            showServiciosFeedback(feedbackGlobalEl, `Error al cargar servicio para editar: ${err.message}`, 'error-indicator', 0);
        }
    } else if (accion === 'toggle-activo-servicio') {
      const estadoActual = button.dataset.estadoActual === 'true';
      try {
        const { error } = await currentSupabaseInstance.from('servicios_adicionales')
          .update({ activo: !estadoActual }).eq('id', servicioId).eq('hotel_id', currentHotelId);
        if (error) throw error;
        showServiciosFeedback(feedbackGlobalEl, `Servicio ${!estadoActual ? 'activado' : 'desactivado'}.`, 'success-indicator');
        await cargarYRenderizarServiciosAdicionales(tablaServiciosAdicionalesBodyEl, currentSupabaseInstance, currentHotelId);
      } catch (err) {
        showServiciosFeedback(feedbackGlobalEl, `Error al cambiar estado del servicio: ${err.message}`, 'error-indicator', 0);
      }
    }
  };
  tablaServiciosAdicionalesBodyEl.addEventListener('click', tablaServiciosAdicionalesClickHandler);
  moduleListeners.push({ element: tablaServiciosAdicionalesBodyEl, type: 'click', handler: tablaServiciosAdicionalesClickHandler });


  // Initial data load
  setFormLoadingState(formTipoServicioEl, true, btnGuardarTipoServicioEl, 'Guardar Categoría', 'Cargando...');
  setFormLoadingState(formServicioAdicionalEl, true, btnGuardarServicioEl, 'Guardar Servicio', 'Cargando...');
  
  await cargarYRenderizarTiposServicio(tablaTiposServicioBodyEl, selectServicioTipoEl, currentSupabaseInstance, currentHotelId);
  await cargarYRenderizarServiciosAdicionales(tablaServiciosAdicionalesBodyEl, currentSupabaseInstance, currentHotelId);
  
  setFormLoadingState(formTipoServicioEl, false, btnGuardarTipoServicioEl, 'Guardar Categoría');
  setFormLoadingState(formServicioAdicionalEl, false, btnGuardarServicioEl, 'Guardar Servicio');
  formTipoServicioEl.elements.nombreTipo.focus();
}

/**
 * Unmounts the services module, cleaning up listeners and state.
 * @param {HTMLElement} container - The main container of the module.
 */
export function unmount(container) {
  moduleListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = [];

  // Reset module-scoped variables
  currentHotelId = null;
  tiposServicioCache = [];
  currentModuleUser = null;
  currentSupabaseInstance = null;

  if (container && typeof container.innerHTML === 'string') {
    container.innerHTML = ''; // Clear the container's content
  }
  console.log('Servicios module unmounted.');
}
