// js/modules/integraciones/integraciones.js

// import { supabase } from '../../supabaseClient.js'; // Will use supabaseInstance from mount
// Assuming uiUtils.js might have generic feedback functions, but this module uses its own.
// import { showAppFeedback, clearAppFeedback, setFormLoading } from '/js/uiUtils.js'; 

let moduleListeners = []; // To clean up listeners on unmount
let currentHotelId = null; // Stores the hotel ID for the current session

/**
 * Shows a feedback message within the integrations module.
 * @param {HTMLElement} feedbackEl The feedback display element.
 * @param {string} message The message to show.
 * @param {boolean} [isError=false] True if the message is an error, false for success/info.
 * @param {number} [duration=4000] Duration in ms to show the message. 0 for indefinite.
 */
function showIntegracionesFeedback(feedbackEl, message, isError = false, duration = 4000) {
  if (!feedbackEl) return;
  feedbackEl.textContent = message;
  feedbackEl.className = `feedback-message mt-1 mb-1 p-2 rounded-md text-sm ${isError ? 'bg-red-100 text-red-700 border border-red-300 error-indicator' : 'bg-green-100 text-green-700 border border-green-300 success-indicator'} visible`;
  feedbackEl.style.display = 'block';
  
  // For accessibility, focus on error messages so screen readers announce them.
  if (isError) {
    feedbackEl.setAttribute('tabindex', '-1'); // Make it focusable
    feedbackEl.focus();
  }

  if (duration > 0) {
    setTimeout(() => clearIntegracionesFeedback(feedbackEl), duration);
  }
}

/**
 * Clears the feedback message.
 * @param {HTMLElement} feedbackEl The feedback display element.
 */
function clearIntegracionesFeedback(feedbackEl) {
  if (!feedbackEl) return;
  feedbackEl.textContent = '';
  feedbackEl.className = 'feedback-message mt-1'; // Reset classes
  feedbackEl.style.display = 'none';
  feedbackEl.removeAttribute('tabindex');
}

/**
 * Controls the loading state of the integrations form.
 * @param {HTMLFormElement} formEl The form element.
 * @param {boolean} isLoading True if the form is loading, false otherwise.
 * @param {HTMLButtonElement} buttonEl The submit button of the form.
 * @param {string} [originalButtonText='Guardar Configuración'] The original text of the submit button.
 */
function setFormIntegracionesLoading(formEl, isLoading, buttonEl, originalButtonText = 'Guardar Configuración') {
  if (buttonEl) {
    buttonEl.disabled = isLoading;
    buttonEl.textContent = isLoading ? 'Guardando...' : originalButtonText;
  }
  // Disable/enable all form elements except the button itself (which is handled above)
  Array.from(formEl.elements).forEach(el => {
    if (el.type !== 'submit' && el.type !== 'button') { // Avoid re-disabling the submit button
        el.disabled = isLoading;
    }
  });
}

/**
 * Mounts the integrations module.
 * @param {HTMLElement} container The container element to render the module into.
 * @param {object} supabaseInstance The Supabase client instance (renamed from sb).
 * @param {object} user The current authenticated user object.
 */
export async function mount(container, supabaseInstance, user) {
  // Reset global state for this module instance
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

  // Determine hotelId
  currentHotelId = user?.user_metadata?.hotel_id;
  if (!currentHotelId && user?.id) {
    try {
      const { data: perfil, error: perfilError } = await supabaseInstance.from('usuarios').select('hotel_id').eq('id', user.id).single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError; // PGRST116: No rows returned
      currentHotelId = perfil?.hotel_id;
    } catch (err) {
        console.error("Error fetching hotel_id for integrations module:", err);
        // Do not show feedback here yet, let the next check handle it.
    }
  }

  if (!currentHotelId) {
    showIntegracionesFeedback(feedbackDivEl, 'Error: Hotel no identificado. No se pueden cargar ni guardar las configuraciones de integración.', true, 0);
    formEl.querySelectorAll('input, button').forEach(el => el.disabled = true);
    return;
  }

  /**
   * Loads existing integration settings into the form.
   */
  async function cargarConfiguracionesExistentes() {
    setFormIntegracionesLoading(formEl, true, submitButtonEl, 'Cargando...');
    try {
      const { data, error } = await supabaseInstance.from('integraciones_hotel')
        .select('*')
        .eq('hotel_id', currentHotelId)
        .maybeSingle(); // Use maybeSingle to handle cases where no config exists yet

      if (error) throw error;

      if (data) {
        formEl.elements.webhook_reservas.value = data.webhook_reservas || '';
        if (data.api_channel_manager) {
          formEl.elements.api_channel_manager.value = '********';
          formEl.elements.api_channel_manager.dataset.realValue = data.api_channel_manager; // Store actual value
        } else {
          formEl.elements.api_channel_manager.value = '';
          delete formEl.elements.api_channel_manager.dataset.realValue;
        }
        formEl.elements.crm_url.value = data.crm_url || '';
        if (data.crm_token) {
          formEl.elements.crm_token.value = '********';
          formEl.elements.crm_token.dataset.realValue = data.crm_token; // Store actual value
        } else {
          formEl.elements.crm_token.value = '';
          delete formEl.elements.crm_token.dataset.realValue;
        }
      } else {
        // No existing config, form remains empty or with defaults
         formEl.elements.api_channel_manager.value = '';
         delete formEl.elements.api_channel_manager.dataset.realValue;
         formEl.elements.crm_token.value = '';
         delete formEl.elements.crm_token.dataset.realValue;
      }
    } catch (err) {
      console.error('Error loading integration settings:', err);
      showIntegracionesFeedback(feedbackDivEl, `Error al cargar configuraciones: ${err.message}`, true, 0);
    } finally {
      setFormIntegracionesLoading(formEl, false, submitButtonEl, 'Guardar Configuración');
    }
  }
  await cargarConfiguracionesExistentes();

  // Form Submit Handler
  const formSubmitHandler = async (e) => {
    e.preventDefault();
    clearIntegracionesFeedback(feedbackDivEl);
    const originalButtonText = submitButtonEl.textContent; // Store original text before changing to "Guardando..."
    setFormIntegracionesLoading(formEl, true, submitButtonEl, 'Guardando...');
    
    const formData = new FormData(formEl);
    const payload = {
      hotel_id: currentHotelId,
      webhook_reservas: formData.get('webhook_reservas')?.trim() || null,
      crm_url: formData.get('crm_url')?.trim() || null,
      updated_at: new Date().toISOString(),
    };

    // Handle API Key for Channel Manager
    const apiKeyInput = formData.get('api_channel_manager')?.trim();
    if (apiKeyInput && apiKeyInput !== '********') {
      payload.api_channel_manager = apiKeyInput;
    } else if (formEl.elements.api_channel_manager.dataset.realValue) {
      payload.api_channel_manager = formEl.elements.api_channel_manager.dataset.realValue;
    } else {
      payload.api_channel_manager = null; // Explicitly set to null if empty and no previous value
    }

    // Handle CRM Token
    const crmTokenInput = formData.get('crm_token')?.trim();
    if (crmTokenInput && crmTokenInput !== '********') {
      payload.crm_token = crmTokenInput;
    } else if (formEl.elements.crm_token.dataset.realValue) {
      payload.crm_token = formEl.elements.crm_token.dataset.realValue;
    } else {
      payload.crm_token = null; // Explicitly set to null if empty and no previous value
    }

    try {
      const { error: upsertError } = await supabaseInstance.from('integraciones_hotel')
        .upsert(payload, { onConflict: 'hotel_id' }); // Upsert based on hotel_id

      if (upsertError) throw upsertError;

      showIntegracionesFeedback(feedbackDivEl, 'Configuración guardada correctamente.', false);

      // After successful save, update the display for sensitive fields
      if (payload.api_channel_manager) {
        formEl.elements.api_channel_manager.value = '********';
        formEl.elements.api_channel_manager.dataset.realValue = payload.api_channel_manager;
      } else {
         formEl.elements.api_channel_manager.value = ''; // Clear if it was set to null
         delete formEl.elements.api_channel_manager.dataset.realValue;
      }
      if (payload.crm_token) {
        formEl.elements.crm_token.value = '********';
        formEl.elements.crm_token.dataset.realValue = payload.crm_token;
      } else {
        formEl.elements.crm_token.value = ''; // Clear if it was set to null
        delete formEl.elements.crm_token.dataset.realValue;
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

/**
 * Unmounts the integrations module, cleaning up listeners.
 */
export function unmount() {
  moduleListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
        element.removeEventListener(type, handler);
    }
  });
  moduleListeners = [];
  currentHotelId = null; // Reset hotel ID
  console.log('Integraciones module unmounted and listeners cleaned up.');
}
