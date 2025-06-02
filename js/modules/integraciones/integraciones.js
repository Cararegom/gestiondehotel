// js/modules/integraciones/integraciones.js

let moduleListeners = [];
let currentHotelId = null;

function showIntegracionesFeedback(feedbackEl, message, isError = false, duration = 4000) {
  if (!feedbackEl) return;
  feedbackEl.textContent = message;
  feedbackEl.className = `feedback-message mt-1 mb-1 p-2 rounded-md text-sm ${isError ? 'bg-red-100 text-red-700 border border-red-300 error-indicator' : 'bg-green-100 text-green-700 border border-green-300 success-indicator'} visible`;
  feedbackEl.style.display = 'block';
  if (isError) {
    feedbackEl.setAttribute('tabindex', '-1');
    feedbackEl.focus();
  }
  if (duration > 0) {
    setTimeout(() => clearIntegracionesFeedback(feedbackEl), duration);
  }
}

function clearIntegracionesFeedback(feedbackEl) {
  if (!feedbackEl) return;
  feedbackEl.textContent = '';
  feedbackEl.className = 'feedback-message mt-1';
  feedbackEl.style.display = 'none';
  feedbackEl.removeAttribute('tabindex');
}

function setFormIntegracionesLoading(formEl, isLoading, buttonEl, originalButtonText = 'Guardar Configuración') {
  if (buttonEl) {
    buttonEl.disabled = isLoading;
    buttonEl.textContent = isLoading ? 'Guardando...' : originalButtonText;
  }
  Array.from(formEl.elements).forEach(el => {
    if (el.type !== 'submit' && el.type !== 'button') {
      el.disabled = isLoading;
    }
  });
}

export async function mount(container, supabaseInstance, user) {
  currentHotelId = null;
  moduleListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = [];

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><h2 class="text-xl font-semibold">Configuración de Integraciones Externas</h2></div>
      <div class="card-body">
        <p class="text-gray-600 text-sm mb-4">
          Conecta tu sistema hotelero con plataformas externas para automatizar y sincronizar datos.
        </p>
        <form id="form-integraciones" novalidate class="space-y-6">
          <!-- CHANNEL MANAGER -->
          <fieldset class="config-section p-4 border rounded-md">
            <legend class="text-lg font-medium text-gray-900 px-2">Reservas Externas (Channel Manager)</legend>
            <div class="form-group mt-2">
              <label for="webhook_reservas" class="block text-sm font-medium text-gray-700">Webhook para Nuevas Reservas</label>
              <input type="url" id="webhook_reservas" name="webhook_reservas" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" placeholder="https://tu-proveedor.com/api/hotel/reservas" />
              <small class="form-text text-gray-500 mt-1">URL donde tu sistema recibirá notificaciones de nuevas reservas (ej. desde tu Channel Manager).</small>
            </div>
            <div class="form-group mt-4">
              <label for="api_channel_manager" class="block text-sm font-medium text-gray-700">API Key del Channel Manager</label>
              <input type="password" id="api_channel_manager" name="api_channel_manager" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" autocomplete="new-password" />
              <small class="form-text text-gray-500 mt-1">
                Ingresa la API key si deseas cambiarla. Se mostrará '********' si ya está configurada.
              </small>
            </div>
          </fieldset>

          <!-- CRM -->
          <fieldset class="config-section p-4 border rounded-md">
            <legend class="text-lg font-medium text-gray-900 px-2">CRM Externo</legend>
            <div class="form-group mt-2">
              <label for="crm_url" class="block text-sm font-medium text-gray-700">URL de la API del CRM</label>
              <input type="url" id="crm_url" name="crm_url" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" placeholder="https://api.tu-crm.com/v1" />
            </div>
            <div class="form-group mt-4">
              <label for="crm_token" class="block text-sm font-medium text-gray-700">Token de Autenticación del CRM</label>
              <input type="password" id="crm_token" name="crm_token" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" autocomplete="new-password" />
              <small class="form-text text-gray-500 mt-1">
                Ingresa el token si deseas cambiarlo. Se mostrará '********' si ya está configurado.
              </small>
            </div>
          </fieldset>

          <!-- FACTURADOR ELECTRÓNICO -->
          <fieldset id="facturacion-electronica" class="config-section p-4 border rounded-md">
  <legend class="text-lg font-medium text-gray-900 px-2">Facturación Electrónica</legend>
  <div class="form-group mt-2">
    <label for="facturador_nombre" class="block text-sm font-medium text-gray-700">Proveedor de Facturación</label>
    <select id="facturador_nombre" name="facturador_nombre" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm">
      <option value="">Selecciona...</option>
      <option value="Alegra">Alegra</option>
      <option value="Siigo">Siigo</option>
      <option value="Facturatech">Facturatech</option>
    </select>
  </div>
  
  <!-- Los campos siguientes solo deben mostrarse si se elige "Alegra" -->
  <div id="alegra-fields" style="display:none;">
    <div class="form-group mt-4">
      <label for="facturador_usuario" class="block text-sm font-medium text-gray-700">Usuario de Alegra (correo)</label>
      <input type="text" id="facturador_usuario" name="facturador_usuario" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm" />
    </div>
    <div class="form-group mt-4">
      <label for="facturador_api_key" class="block text-sm font-medium text-gray-700">Token de Alegra</label>
      <input type="password" id="facturador_api_key" name="facturador_api_key" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm" autocomplete="new-password" />
    </div>
    <div class="form-group mt-4">
      <label for="facturador_api_url" class="block text-sm font-medium text-gray-700">URL de la API</label>
      <input type="url" id="facturador_api_url" name="facturador_api_url" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm bg-gray-100" value="https://api.alegra.com/api/v1/" readonly disabled />
    </div>
  </div>
</fieldset>


          <div id="integraciones-feedback" role="alert" aria-live="assertive" style="display:none;" class="mt-2"></div>
          <div class="form-actions mt-6">
            <button type="submit" id="btnGuardarIntegraciones" class="button button-primary py-2 px-4 rounded-md">Guardar Configuración</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const formEl = container.querySelector('#form-integraciones');
  const feedbackDivEl = container.querySelector('#integraciones-feedback');
  const submitButtonEl = container.querySelector('#btnGuardarIntegraciones');
document.getElementById('facturador_nombre').addEventListener('change', function() {
  const alegraFields = document.getElementById('alegra-fields');
  if (this.value === 'Alegra') {
    alegraFields.style.display = 'block';
    // Si quieres, puedes autollenar el URL de Alegra aquí si no está.
    document.getElementById('facturador_api_url').value = 'https://api.alegra.com/api/v1/';
  } else {
    alegraFields.style.display = 'none';
  }
});

  currentHotelId = user?.user_metadata?.hotel_id;
  if (!currentHotelId && user?.id) {
    try {
      const { data: perfil, error: perfilError } = await supabaseInstance.from('usuarios').select('hotel_id').eq('id', user.id).single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError;
      currentHotelId = perfil?.hotel_id;
    } catch (err) {
      console.error("Error fetching hotel_id for integrations module:", err);
    }
  }

  if (!currentHotelId) {
    showIntegracionesFeedback(feedbackDivEl, 'Error: Hotel no identificado. No se pueden cargar ni guardar las configuraciones de integración.', true, 0);
    formEl.querySelectorAll('input, button, select').forEach(el => el.disabled = true);
    return;
  }

  async function cargarConfiguracionesExistentes() {
    setFormIntegracionesLoading(formEl, true, submitButtonEl, 'Cargando...');
    try {
      const { data, error } = await supabaseInstance.from('integraciones_hotel')
        .select('*')
        .eq('hotel_id', currentHotelId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        formEl.elements.webhook_reservas.value = data.webhook_reservas || '';
        if (data.api_channel_manager) {
          formEl.elements.api_channel_manager.value = '********';
          formEl.elements.api_channel_manager.dataset.realValue = data.api_channel_manager;
        } else {
          formEl.elements.api_channel_manager.value = '';
          delete formEl.elements.api_channel_manager.dataset.realValue;
        }
        formEl.elements.crm_url.value = data.crm_url || '';
        if (data.crm_token) {
          formEl.elements.crm_token.value = '********';
          formEl.elements.crm_token.dataset.realValue = data.crm_token;
        } else {
          formEl.elements.crm_token.value = '';
          delete formEl.elements.crm_token.dataset.realValue;
        }

        // FACTURADOR ELECTRÓNICO
        formEl.elements.facturador_nombre.value = data.facturador_nombre || '';
        formEl.elements.facturador_api_url.value = data.facturador_api_url || '';
        if (data.facturador_api_key) {
          formEl.elements.facturador_api_key.value = '********';
          formEl.elements.facturador_api_key.dataset.realValue = data.facturador_api_key;
        } else {
          formEl.elements.facturador_api_key.value = '';
          delete formEl.elements.facturador_api_key.dataset.realValue;
        }
        formEl.elements.facturador_usuario.value = data.facturador_usuario || '';
        formEl.elements.facturador_empresa.value = data.facturador_empresa || '';
      } else {
        formEl.elements.api_channel_manager.value = '';
        delete formEl.elements.api_channel_manager.dataset.realValue;
        formEl.elements.crm_token.value = '';
        delete formEl.elements.crm_token.dataset.realValue;
        formEl.elements.facturador_api_key.value = '';
        delete formEl.elements.facturador_api_key.dataset.realValue;
      }
    } catch (err) {
      console.error('Error loading integration settings:', err);
      showIntegracionesFeedback(feedbackDivEl, `Error al cargar configuraciones: ${err.message}`, true, 0);
    } finally {
      setFormIntegracionesLoading(formEl, false, submitButtonEl, 'Guardar Configuración');
    }
  }
  await cargarConfiguracionesExistentes();

  const formSubmitHandler = async (e) => {
    e.preventDefault();
    clearIntegracionesFeedback(feedbackDivEl);
    const originalButtonText = submitButtonEl.textContent;
    setFormIntegracionesLoading(formEl, true, submitButtonEl, 'Guardando...');

    const formData = new FormData(formEl);
    const payload = {
      hotel_id: currentHotelId,
      webhook_reservas: formData.get('webhook_reservas')?.trim() || null,
      crm_url: formData.get('crm_url')?.trim() || null,
      facturador_nombre: formData.get('facturador_nombre')?.trim() || null,
      facturador_api_url: formData.get('facturador_api_url')?.trim() || null,
      facturador_usuario: formData.get('facturador_usuario')?.trim() || null,
      facturador_empresa: formData.get('facturador_empresa')?.trim() || null,
      updated_at: new Date().toISOString(),
    };

    // Channel Manager API Key
    const apiKeyInput = formData.get('api_channel_manager')?.trim();
    if (apiKeyInput && apiKeyInput !== '********') {
      payload.api_channel_manager = apiKeyInput;
    } else if (formEl.elements.api_channel_manager.dataset.realValue) {
      payload.api_channel_manager = formEl.elements.api_channel_manager.dataset.realValue;
    } else {
      payload.api_channel_manager = null;
    }

    // CRM Token
    const crmTokenInput = formData.get('crm_token')?.trim();
    if (crmTokenInput && crmTokenInput !== '********') {
      payload.crm_token = crmTokenInput;
    } else if (formEl.elements.crm_token.dataset.realValue) {
      payload.crm_token = formEl.elements.crm_token.dataset.realValue;
    } else {
      payload.crm_token = null;
    }

    // Facturador API Key
    const facturadorApiKeyInput = formData.get('facturador_api_key')?.trim();
    if (facturadorApiKeyInput && facturadorApiKeyInput !== '********') {
      payload.facturador_api_key = facturadorApiKeyInput;
    } else if (formEl.elements.facturador_api_key.dataset.realValue) {
      payload.facturador_api_key = formEl.elements.facturador_api_key.dataset.realValue;
    } else {
      payload.facturador_api_key = null;
    }

    try {
      const { error: upsertError } = await supabaseInstance.from('integraciones_hotel')
        .upsert(payload, { onConflict: 'hotel_id' });

      if (upsertError) throw upsertError;

      showIntegracionesFeedback(feedbackDivEl, 'Configuración guardada correctamente.', false);

      if (payload.api_channel_manager) {
        formEl.elements.api_channel_manager.value = '********';
        formEl.elements.api_channel_manager.dataset.realValue = payload.api_channel_manager;
      } else {
        formEl.elements.api_channel_manager.value = '';
        delete formEl.elements.api_channel_manager.dataset.realValue;
      }
      if (payload.crm_token) {
        formEl.elements.crm_token.value = '********';
        formEl.elements.crm_token.dataset.realValue = payload.crm_token;
      } else {
        formEl.elements.crm_token.value = '';
        delete formEl.elements.crm_token.dataset.realValue;
      }
      if (payload.facturador_api_key) {
        formEl.elements.facturador_api_key.value = '********';
        formEl.elements.facturador_api_key.dataset.realValue = payload.facturador_api_key;
      } else {
        formEl.elements.facturador_api_key.value = '';
        delete formEl.elements.facturador_api_key.dataset.realValue;
      }

    } catch (err) {
      console.error('Error saving integration settings:', err);
      showIntegracionesFeedback(feedbackDivEl, `Error al guardar: ${err.message}`, true, 0);
    } finally {
      setFormIntegracionesLoading(formEl, false, submitButtonEl, originalButtonText);
    }
  };

  formEl.addEventListener('submit', formSubmitHandler);
  moduleListeners.push({ element: formEl, type: 'submit', handler: formSubmitHandler });
}

export function unmount() {
  moduleListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = [];
  currentHotelId = null;
  console.log('Integraciones module unmounted and listeners cleaned up.');
}
