// js/modules/servicios/servicios.js

let moduleListeners = [];
let currentHotelId = null;
let currentModuleUser = null;
let currentSupabaseInstance = null;
let tiposServicioCache = [];
import { registrarEnBitacora } from '../../services/bitacoraservice.js';

const ACTIONS = {
  EDIT_TIPO: 'editar-tipo',
  TOGGLE_ACTIVO_TIPO: 'toggle-activo-tipo',
  EDIT_SERVICIO: 'editar-servicio',
  TOGGLE_ACTIVO_SERVICIO: 'toggle-activo-servicio',
};

const formatCurrencyLocal = (value, currency = 'COP') => {
  if (typeof value !== 'number' || isNaN(value)) {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency }).format(0);
  }
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency }).format(value);
};

function showServiciosFeedback(feedbackEl, message, typeClass = 'success-indicator', duration = 3000) {
  if (!feedbackEl) return;
  feedbackEl.textContent = message;
  let alertClasses = 'bg-green-100 border-green-300 text-green-700';
  if (typeClass === 'error-indicator') alertClasses = 'bg-red-100 border-red-300 text-red-700';
  else if (typeClass === 'info-indicator') alertClasses = 'bg-blue-100 border-blue-300 text-blue-700';
  feedbackEl.className = `feedback-message mt-2 mb-3 p-3 rounded-md border text-sm ${alertClasses} visible`;
  feedbackEl.style.display = 'block';
  feedbackEl.setAttribute('aria-live', typeClass === 'error-indicator' ? 'assertive' : 'polite');
  if (typeClass.includes('error-indicator')) {
    feedbackEl.setAttribute('tabindex', '-1');
    feedbackEl.focus();
  }
  if (duration > 0) setTimeout(() => clearServiciosFeedback(feedbackEl), duration);
}
function clearServiciosFeedback(feedbackEl) {
  if (!feedbackEl) return;
  feedbackEl.textContent = '';
  feedbackEl.className = 'feedback-message mt-2 mb-3';
  feedbackEl.style.display = 'none';
  feedbackEl.removeAttribute('tabindex');
}
function setFormLoadingState(formEl, isLoading, buttonEl, originalButtonText, loadingButtonText = 'Procesando...') {
  if (!formEl) return;
  if (buttonEl) {
    buttonEl.disabled = isLoading;
    buttonEl.textContent = isLoading ? loadingButtonText : originalButtonText;
    if (isLoading) buttonEl.classList.add('opacity-75', 'cursor-not-allowed');
    else buttonEl.classList.remove('opacity-75', 'cursor-not-allowed');
  }
  Array.from(formEl.elements).forEach(el => {
    if (el.type !== 'submit' && el.type !== 'button') el.disabled = isLoading;
  });
}

async function cargarYRenderizarTiposServicio(tbodyEl, selectServicioTipoEl, supabaseInstance, hotelId) {
  if (!hotelId) {
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
              <button class="button button-outline button-small text-xs" data-accion="${ACTIONS.EDIT_TIPO}" data-id="${tipo.id}" title="Editar ${tipo.nombre}">Editar</button>
              <button class="button button-small text-xs ${tipo.activo ? 'button-warning' : 'button-success'}" data-accion="${ACTIONS.TOGGLE_ACTIVO_TIPO}" data-id="${tipo.id}" data-estado-actual="${tipo.activo}" title="${tipo.activo ? 'Desactivar' : 'Activar'}">
                ${tipo.activo ? 'Desactivar' : 'Activar'}
              </button>
            </td>`;
          tbodyEl.appendChild(tr);
        });
      }
    }
    if (selectServicioTipoEl) {
      const activeTipos = tiposServicioCache.filter(t => t.activo);
      selectServicioTipoEl.innerHTML = activeTipos.length > 0
        ? `<option value="">-- Seleccione una Categoría --</option>` + activeTipos.map(t => `<option value="${t.id}">${t.nombre}</option>`).join('')
        : `<option value="" disabled>No hay categorías activas. Cree una primero.</option>`;
    }
  } catch (err) {
    if (tbodyEl) tbodyEl.innerHTML = `<tr><td colspan="3" class="text-red-600 text-center p-3">Error al cargar categorías: ${err.message}</td></tr>`;
    if (selectServicioTipoEl) selectServicioTipoEl.innerHTML = `<option value="" disabled>Error al cargar categorías</option>`;
  }
}

function poblarFormularioTipoServicio(formEl, tipoServicioData, btnCancelarEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.tipoServicioIdEdit.value = tipoServicioData.id;
  formEl.elements.nombreTipo.value = tipoServicioData.nombre;
  formEl.querySelector('#btn-guardar-tipo-servicio').textContent = 'Actualizar Categoría';
  if (btnCancelarEl) btnCancelarEl.style.display = 'inline-block';
  formEl.elements.nombreTipo.focus();
}
function resetearFormularioTipoServicio(formEl, btnCancelarEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.tipoServicioIdEdit.value = '';
  formEl.querySelector('#btn-guardar-tipo-servicio').textContent = 'Guardar Categoría';
  if (btnCancelarEl) btnCancelarEl.style.display = 'none';
  formEl.elements.nombreTipo.focus();
}

async function cargarYRenderizarServiciosAdicionales(tbodyEl, supabaseInstance, hotelId) {
  if (!hotelId) {
    if (tbodyEl) tbodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-2 text-red-600">Error: Hotel no identificado.</td></tr>`;
    return;
  }
  if (!tbodyEl) return;
  tbodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-3 text-gray-500">Cargando servicios adicionales...</td></tr>`;
  try {
    const { data: servicios, error } = await supabaseInstance
      .from('servicios_adicionales')
      .select(`id, nombre, precio, activo, tipo_id, tipos_servicio(nombre)`)
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
          <button class="button button-outline button-small text-xs" data-accion="${ACTIONS.EDIT_SERVICIO}" data-id="${s.id}" title="Editar ${s.nombre}">Editar</button>
          <button class="button button-small text-xs ${s.activo ? 'button-warning' : 'button-success'}" data-accion="${ACTIONS.TOGGLE_ACTIVO_SERVICIO}" data-id="${s.id}" data-estado-actual="${s.activo}" title="${s.activo ? 'Desactivar' : 'Activar'}">
            ${s.activo ? 'Desactivar' : 'Activar'}
          </button>
        </td>`;
      tbodyEl.appendChild(tr);
    });
  } catch (err) {
    tbodyEl.innerHTML = `<tr><td colspan="5" class="text-red-600 text-center p-3">Error al cargar servicios: ${err.message}</td></tr>`;
  }
}

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
function resetearFormularioServicio(formEl, formTitleEl, btnCancelarEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.servicioIdEdit.value = '';
  if (formTitleEl) formTitleEl.textContent = 'Agregar Nuevo Servicio Adicional';
  formEl.querySelector('#btn-guardar-servicio').textContent = 'Guardar Servicio';
  if (btnCancelarEl) btnCancelarEl.style.display = 'none';
  formEl.elements.nombreServicio.focus();
}

// MAIN EXPORT
export async function mount(container, sbInstance, user) {
  if (!container) return;
  unmount(container);

  currentSupabaseInstance = sbInstance;
  currentModuleUser = user;
  if (!currentModuleUser || !currentSupabaseInstance) {
    container.innerHTML = `<div class="p-4 text-red-600">Error crítico: Faltan datos de inicialización para el módulo de servicios.</div>`;
    return;
  }
  currentHotelId = currentModuleUser?.user_metadata?.hotel_id;
  if (!currentHotelId && currentModuleUser?.id) {
    try {
      const { data: perfil, error: perfilError } = await currentSupabaseInstance
        .from('usuarios').select('hotel_id').eq('id', currentModuleUser.id).single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError;
      currentHotelId = perfil?.hotel_id;
    } catch (e) { }
  }
  container.innerHTML = `
    <div class="card servicios-module shadow-lg rounded-lg">
      <div class="card-header bg-gray-100 p-4 border-b">
        <h2 class="text-xl font-semibold text-gray-800">Gestión de Servicios Adicionales</h2>
      </div>
      <div class="card-body p-4 md:p-6 space-y-8">
        <div id="servicios-feedback" role="status" aria-live="polite" style="display:none;" class="feedback-message mb-4"></div>
        <section id="section-tipos-servicio" class="p-4 border rounded-md bg-gray-50 shadow-sm">
          <h3 class="text-lg font-semibold text-gray-700 mb-3">Categorías de Servicios</h3>
          <form id="form-tipo-servicio" class="form space-y-3 mb-4" novalidate autocomplete="off">
            <input type="hidden" id="tipoServicioIdEdit" name="tipoServicioIdEdit" />
            <div>
              <label for="nombreTipo" class="block text-sm font-medium text-gray-600">Nombre de la Categoría *</label>
              <input type="text" id="nombreTipo" name="nombreTipo" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" required maxlength="100" autocomplete="off" />
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
          <form id="form-servicio-adicional" class="form grid grid-cols-1 md:grid-cols-2 gap-4 mb-4" novalidate autocomplete="off">
            <input type="hidden" id="servicioIdEdit" name="servicioIdEdit" />
            <div class="form-group">
              <label for="nombreServicio" class="block text-sm font-medium text-gray-600">Nombre del Servicio *</label>
              <input type="text" id="nombreServicio" name="nombreServicio" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" required maxlength="150" autocomplete="off" />
            </div>
            <div class="form-group">
              <label for="servicio-tipo" class="block text-sm font-medium text-gray-600">Categoría del Servicio</label>
              <select id="servicio-tipo" name="tipo_id" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm">
                <option value="">Cargando categorías...</option>
              </select>
            </div>
            <div class="form-group">
              <label for="precioServicio" class="block text-sm font-medium text-gray-600">Precio *</label>
              <input type="number" id="precioServicio" name="precioServicio" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" required min="0" step="0.01" autocomplete="off" />
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

  // DOMS
  const feedbackGlobalEl = container.querySelector('#servicios-feedback');
  const formTipoServicioEl = container.querySelector('#form-tipo-servicio');
  const tablaTiposServicioBodyEl = container.querySelector('#tabla-tipos-servicio-body');
  const btnGuardarTipoServicioEl = container.querySelector('#btn-guardar-tipo-servicio');
  const btnCancelarEdicionTipoEl = container.querySelector('#btn-cancelar-edicion-tipo');
  const formServicioAdicionalEl = container.querySelector('#form-servicio-adicional');
  const tablaServiciosAdicionalesBodyEl = container.querySelector('#tabla-servicios-adicionales-body');
  const selectServicioTipoEl = container.querySelector('#servicio-tipo');
  const btnGuardarServicioEl = container.querySelector('#btn-guardar-servicio');
  const btnCancelarEdicionServicioEl = container.querySelector('#btn-cancelar-edicion-servicio');
  const formServicioAdicionalTitleEl = container.querySelector('#form-servicio-adicional-titulo');

  if (!currentHotelId) {
    showServiciosFeedback(feedbackGlobalEl, 'Error crítico: No se pudo determinar el hotel. Módulo deshabilitado.', 'error-indicator', 0);
    if (formTipoServicioEl) Array.from(formTipoServicioEl.elements).forEach(el => el.disabled = true);
    if (formServicioAdicionalEl) Array.from(formServicioAdicionalEl.elements).forEach(el => el.disabled = true);
    return;
  }

  // --- FORM HANDLER CATEGORIA ---
  const tipoServicioFormSubmitHandler = async (event) => {
    event.preventDefault();
    clearServiciosFeedback(feedbackGlobalEl);
    const originalButtonText = btnGuardarTipoServicioEl.textContent;
    setFormLoadingState(formTipoServicioEl, true, btnGuardarTipoServicioEl, originalButtonText, 'Guardando...');
    // Aquí la diferencia CLAVE respecto a FormData:

   

    const nombreTipoInput = formTipoServicioEl.querySelector('[name="nombreTipo"]');
    const nombreTipo = nombreTipoInput ? nombreTipoInput.value.trim() : '';
    const idEdit = formTipoServicioEl.querySelector('[name="tipoServicioIdEdit"]')?.value;

    // debug: verás el valor real en consola SIEMPRE
    console.log('DEBUG NOMBRE TIPO:', nombreTipo, '|');

    if (!nombreTipo) {
      showServiciosFeedback(feedbackGlobalEl, 'El nombre de la categoría es obligatorio.', 'error-indicator');
      setFormLoadingState(formTipoServicioEl, false, btnGuardarTipoServicioEl, originalButtonText);
      if(nombreTipoInput) nombreTipoInput.focus();
      return;
    }
    const payload = {
      hotel_id: currentHotelId,
      nombre: nombreTipo
    };
    if (!idEdit) payload.activo = true;
    try {
      let bitacoraAccion = '';
       console.log('Usuario autenticado:', currentModuleUser);
console.log('Payload a insertar:', {
  hotel_id: currentHotelId,
  nombre: nombreTipo
});
      if (idEdit) {
        const { error } = await currentSupabaseInstance.from('tipos_servicio')
          .update({ nombre: nombreTipo }).eq('id', idEdit).eq('hotel_id', currentHotelId);
        if (error) throw error;
        showServiciosFeedback(feedbackGlobalEl, 'Categoría actualizada exitosamente.', 'success-indicator');
        bitacoraAccion = 'UPDATE_TIPO_SERVICIO';
      } else {
        const { data, error } = await currentSupabaseInstance.from('tipos_servicio').insert(payload).select().single();
        if (error) throw error;
        showServiciosFeedback(feedbackGlobalEl, 'Categoría creada exitosamente.', 'success-indicator');
        bitacoraAccion = 'CREATE_TIPO_SERVICIO';
        if (data && currentModuleUser?.id && currentHotelId) registrarEnBitacora(currentModuleUser.id, currentHotelId, bitacoraAccion, `Categoría ID ${data.id}: ${nombreTipo}`);
      }
      if (idEdit && currentModuleUser?.id && currentHotelId) registrarEnBitacora(currentModuleUser.id, currentHotelId, bitacoraAccion, `Categoría ID ${idEdit} actualizada: ${nombreTipo}`);
      resetearFormularioTipoServicio(formTipoServicioEl, btnCancelarEdicionTipoEl);
      await cargarYRenderizarTiposServicio(tablaTiposServicioBodyEl, selectServicioTipoEl, currentSupabaseInstance, currentHotelId);
    } catch (err) {
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

  const tablaTiposServicioClickHandler = async (event) => {
    const button = event.target.closest('button[data-accion]');
    if (!button) return;
    const tipoId = button.dataset.id;
    const accion = button.dataset.accion;
    clearServiciosFeedback(feedbackGlobalEl);
    if (accion === ACTIONS.EDIT_TIPO) {
      const tipoToEdit = tiposServicioCache.find(t => t.id.toString() === tipoId);
      if (tipoToEdit) {
        poblarFormularioTipoServicio(formTipoServicioEl, tipoToEdit, btnCancelarEdicionTipoEl);
        formTipoServicioEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        showServiciosFeedback(feedbackGlobalEl, 'Categoría no encontrada para editar.', 'error-indicator');
      }
    } else if (accion === ACTIONS.TOGGLE_ACTIVO_TIPO) {
      const estadoActual = button.dataset.estadoActual === 'true';
      try {
        const { error } = await currentSupabaseInstance.from('tipos_servicio')
          .update({ activo: !estadoActual }).eq('id', tipoId).eq('hotel_id', currentHotelId);
        if (error) throw error;
        showServiciosFeedback(feedbackGlobalEl, `Categoría ${!estadoActual ? 'activada' : 'desactivada'}.`, 'success-indicator');
        if (currentModuleUser?.id && currentHotelId) registrarEnBitacora(currentModuleUser.id, currentHotelId, 'TOGGLE_TIPO_SERVICIO_STATUS', `Categoría ID ${tipoId} estado cambiado a ${!estadoActual}`);
        await cargarYRenderizarTiposServicio(tablaTiposServicioBodyEl, selectServicioTipoEl, currentSupabaseInstance, currentHotelId);
      } catch (err) {
        showServiciosFeedback(feedbackGlobalEl, `Error al cambiar estado: ${err.message}`, 'error-indicator', 0);
      }
    }
  };
  tablaTiposServicioBodyEl.addEventListener('click', tablaTiposServicioClickHandler);
  moduleListeners.push({ element: tablaTiposServicioBodyEl, type: 'click', handler: tablaTiposServicioClickHandler });

  // Servicios adicionales
  const servicioAdicionalFormSubmitHandler = async (event) => {
    event.preventDefault();
    clearServiciosFeedback(feedbackGlobalEl);
    const originalButtonText = btnGuardarServicioEl.textContent;
    setFormLoadingState(formServicioAdicionalEl, true, btnGuardarServicioEl, originalButtonText, 'Guardando...');
    const nombreServicioInput = formServicioAdicionalEl.querySelector('[name="nombreServicio"]');
    const nombreServicio = nombreServicioInput ? nombreServicioInput.value.trim() : '';
    const precioServicioInput = formServicioAdicionalEl.querySelector('[name="precioServicio"]');
    const precioServicio = precioServicioInput ? parseFloat(precioServicioInput.value) : NaN;
    const idEdit = formServicioAdicionalEl.querySelector('[name="servicioIdEdit"]')?.value;
    const tipoIdInput = formServicioAdicionalEl.querySelector('[name="tipo_id"]');
    const tipoId = tipoIdInput ? tipoIdInput.value : null;
    const activoServicioInput = formServicioAdicionalEl.querySelector('[name="activoServicio"]');
    const activoServicio = activoServicioInput ? activoServicioInput.checked : false;

    if (!nombreServicio) {
      showServiciosFeedback(feedbackGlobalEl, 'El nombre del servicio es obligatorio.', 'error-indicator');
      setFormLoadingState(formServicioAdicionalEl, false, btnGuardarServicioEl, originalButtonText);
      if(nombreServicioInput) nombreServicioInput.focus();
      return;
    }
    if (isNaN(precioServicio) || precioServicio < 0) {
      showServiciosFeedback(feedbackGlobalEl, 'El precio del servicio debe ser un número positivo.', 'error-indicator');
      setFormLoadingState(formServicioAdicionalEl, false, btnGuardarServicioEl, originalButtonText);
      if(precioServicioInput) precioServicioInput.focus();
      return;
    }
    const payload = {
      hotel_id: currentHotelId,
      nombre: nombreServicio,
      tipo_id: tipoId || null,
      precio: precioServicio,
      activo: activoServicio
    };
    try {
      let bitacoraAccion = '';
      if (idEdit) {
        const { error } = await currentSupabaseInstance.from('servicios_adicionales')
          .update(payload).eq('id', idEdit).eq('hotel_id', currentHotelId);
        if (error) throw error;
        showServiciosFeedback(feedbackGlobalEl, 'Servicio actualizado exitosamente.', 'success-indicator');
        bitacoraAccion = 'UPDATE_SERVICIO_ADICIONAL';
      } else {
        const { data, error } = await currentSupabaseInstance.from('servicios_adicionales').insert(payload).select().single();
        if (error) throw error;
        showServiciosFeedback(feedbackGlobalEl, 'Servicio creado exitosamente.', 'success-indicator');
        bitacoraAccion = 'CREATE_SERVICIO_ADICIONAL';
        if (data && currentModuleUser?.id && currentHotelId) registrarEnBitacora(currentModuleUser.id, currentHotelId, bitacoraAccion, `Servicio ID ${data.id}: ${nombreServicio}`);
      }
      if (idEdit && currentModuleUser?.id && currentHotelId) registrarEnBitacora(currentModuleUser.id, currentHotelId, bitacoraAccion, `Servicio ID ${idEdit} actualizado: ${nombreServicio}`);
      resetearFormularioServicio(formServicioAdicionalEl, formServicioAdicionalTitleEl, btnCancelarEdicionServicioEl);
      await cargarYRenderizarServiciosAdicionales(tablaServiciosAdicionalesBodyEl, currentSupabaseInstance, currentHotelId);
    } catch (err) {
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

  const tablaServiciosAdicionalesClickHandler = async (event) => {
    const button = event.target.closest('button[data-accion]');
    if (!button) return;
    const servicioId = button.dataset.id;
    const accion = button.dataset.accion;
    clearServiciosFeedback(feedbackGlobalEl);
    if (accion === ACTIONS.EDIT_SERVICIO) {
      try {
        const { data: servicioToEdit, error } = await currentSupabaseInstance.from('servicios_adicionales')
          .select('*, tipos_servicio(nombre)')
          .eq('id', servicioId)
          .eq('hotel_id', currentHotelId)
          .single();
        if (error) throw error;
        if (servicioToEdit) {
          poblarFormularioServicio(formServicioAdicionalEl, servicioToEdit, formServicioAdicionalTitleEl, btnCancelarEdicionServicioEl);
          formServicioAdicionalEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          showServiciosFeedback(feedbackGlobalEl, 'Servicio no encontrado para editar.', 'error-indicator');
        }
      } catch (err) {
        showServiciosFeedback(feedbackGlobalEl, `Error al cargar servicio para editar: ${err.message}`, 'error-indicator', 0);
      }
    } else if (accion === ACTIONS.TOGGLE_ACTIVO_SERVICIO) {
      const estadoActual = button.dataset.estadoActual === 'true';
      try {
        const { error } = await currentSupabaseInstance.from('servicios_adicionales')
          .update({ activo: !estadoActual }).eq('id', servicioId).eq('hotel_id', currentHotelId);
        if (error) throw error;
        showServiciosFeedback(feedbackGlobalEl, `Servicio ${!estadoActual ? 'activado' : 'desactivado'}.`, 'success-indicator');
        if (currentModuleUser?.id && currentHotelId) registrarEnBitacora(currentModuleUser.id, currentHotelId, 'TOGGLE_SERVICIO_STATUS', `Servicio ID ${servicioId} estado cambiado a ${!estadoActual}`);
        await cargarYRenderizarServiciosAdicionales(tablaServiciosAdicionalesBodyEl, currentSupabaseInstance, currentHotelId);
      } catch (err) {
        showServiciosFeedback(feedbackGlobalEl, `Error al cambiar estado del servicio: ${err.message}`, 'error-indicator', 0);
      }
    }
  };
  tablaServiciosAdicionalesBodyEl.addEventListener('click', tablaServiciosAdicionalesClickHandler);
  moduleListeners.push({ element: tablaServiciosAdicionalesBodyEl, type: 'click', handler: tablaServiciosAdicionalesClickHandler });

  // Inicializa datos
  setFormLoadingState(formTipoServicioEl, true, btnGuardarTipoServicioEl, 'Guardar Categoría', 'Cargando...');
  setFormLoadingState(formServicioAdicionalEl, true, btnGuardarServicioEl, 'Guardar Servicio', 'Cargando...');
  await cargarYRenderizarTiposServicio(tablaTiposServicioBodyEl, selectServicioTipoEl, currentSupabaseInstance, currentHotelId);
  await cargarYRenderizarServiciosAdicionales(tablaServiciosAdicionalesBodyEl, currentSupabaseInstance, currentHotelId);
  setFormLoadingState(formTipoServicioEl, false, btnGuardarTipoServicioEl, 'Guardar Categoría');
  setFormLoadingState(formServicioAdicionalEl, false, btnGuardarServicioEl, 'Guardar Servicio');
  if (formTipoServicioEl.elements.nombreTipo) formTipoServicioEl.elements.nombreTipo.focus();
}

export function unmount(container) {
  moduleListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') element.removeEventListener(type, handler);
  });
  moduleListeners = [];
  currentHotelId = null;
  tiposServicioCache = [];
  currentModuleUser = null;
  currentSupabaseInstance = null;
  if (container && typeof container.innerHTML === 'string') container.innerHTML = '';
  console.log('Servicios module unmounted.');
}
