// js/modules/integraciones/integraciones.js

let moduleListeners = [];
let currentHotelId = null;
let supabaseInstance = null; // Asegúrate de que esta instancia de Supabase se pase y se asigne correctamente
let userObject = null; // Para guardar el objeto user completo si es necesario

// --- Funciones de UI (reutilizadas) ---
function showFeedback(feedbackEl, message, isError = false, duration = 4000) {
  if (!feedbackEl) return;
  feedbackEl.textContent = message;
  feedbackEl.className = `feedback-message mt-1 mb-1 p-2 rounded-md text-sm ${isError ? 'bg-red-100 text-red-700 border border-red-300' : 'bg-green-100 text-green-700 border border-green-300'} visible`;
  feedbackEl.style.display = 'block';
  if (duration > 0) {
    setTimeout(() => clearFeedback(feedbackEl), duration);
  }
}

function clearFeedback(feedbackEl) {
  if (!feedbackEl) return;
  feedbackEl.textContent = '';
  feedbackEl.style.display = 'none';
}

function setLoading(formEl, isLoading, buttonEl, originalButtonText = 'Guardar') {
  if (buttonEl) {
    buttonEl.disabled = isLoading;
    buttonEl.textContent = isLoading ? 'Procesando...' : originalButtonText;
  }
  if (formEl) { // Puede que solo pasemos el botón para acciones que no son de formulario
    Array.from(formEl.elements).forEach(el => {
      if (el.type !== 'submit' && el.type !== 'button') {
        el.disabled = isLoading;
      }
    });
  }
}
// --- Fin Funciones de UI ---

// --- SECCIÓN ALEGRA (Facturación Electrónica) ---
async function guardarConfiguracionAlegra(formEl, feedbackEl, buttonEl) {
  if (!currentHotelId || !supabaseInstance) {
    showFeedback(feedbackEl, 'Error: Hotel no identificado o Supabase no disponible.', true, 0);
    return;
  }
  setLoading(formEl, true, buttonEl, 'Guardando...');
  const originalButtonText = buttonEl.textContent; // Debe ser 'Guardar Configuración Alegra'
  const alegraUsuario = formEl.elements.alegra_usuario.value.trim();
  const alegraToken = formEl.elements.alegra_token.value.trim();
  const payload = {
    hotel_id: currentHotelId,
    facturador_nombre: 'Alegra',
    facturador_usuario: alegraUsuario,
    updated_at: new Date().toISOString(),
  };
  const tokenInput = formEl.elements.alegra_token;
  if (alegraToken && alegraToken !== '********') {
    payload.facturador_api_key = alegraToken;
  } else if (tokenInput.dataset.realValue) {
    payload.facturador_api_key = tokenInput.dataset.realValue;
  } else {
    payload.facturador_api_key = null;
  }
  try {
    const { error } = await supabaseInstance.from('integraciones_hotel')
      .upsert(payload, { onConflict: 'hotel_id, facturador_nombre' }); // Asumiendo que puedes tener config para varios facturadores
    if (error) throw error;
    showFeedback(feedbackEl, 'Configuración de Alegra guardada correctamente.', false);
    if (payload.facturador_api_key) {
        tokenInput.value = '********';
        tokenInput.dataset.realValue = payload.facturador_api_key;
    } else {
        tokenInput.value = '';
        delete tokenInput.dataset.realValue;
    }
  } catch (err) {
    console.error('Error guardando configuración de Alegra:', err);
    showFeedback(feedbackEl, `Error al guardar: ${err.message}`, true, 0);
  } finally {
    setLoading(formEl, false, buttonEl, originalButtonText || 'Guardar Configuración Alegra');
  }
}

async function probarConexionAlegra(feedbackEl, buttonEl) {
  if (!currentHotelId || !supabaseInstance) { showFeedback(feedbackEl, 'Error: Hotel no identificado.', true, 0); return; }
  setLoading(null, true, buttonEl, 'Probando...');
  const originalButtonText = buttonEl.textContent;
  showFeedback(feedbackEl, 'Iniciando prueba de conexión con Alegra...', false, 0);
  try {
    const { data, error } = await supabaseInstance.functions.invoke('alegra-test-connection', {
      body: { hotelId: currentHotelId },
    });
    if (error) throw error;
    if (data.ok) {
      showFeedback(feedbackEl, `✅ Conexión con Alegra exitosa: ${data.message || ''}`, false);
    } else {
      showFeedback(feedbackEl, `❌ Falló la conexión con Alegra: ${data.message || 'Error desconocido.'}`, true, 0);
    }
  } catch (err) {
    console.error('Error en prueba de conexión Alegra:', err);
    showFeedback(feedbackEl, `Error al probar conexión: ${err.message || err}`, true, 0);
  } finally {
    setLoading(null, false, buttonEl, originalButtonText || 'Probar Conexión');
  }
}

async function generarFacturaPruebaAlegra(feedbackEl, buttonEl) {
  if (!currentHotelId || !supabaseInstance) { showFeedback(feedbackEl, 'Error: Hotel no identificado.', true, 0); return; }
  setLoading(null, true, buttonEl, 'Generando...');
  const originalButtonText = buttonEl.textContent;
  showFeedback(feedbackEl, 'Enviando factura de prueba a Alegra...', false, 0);
  const datosFacturaEjemplo = {
    cliente: { nombre: "Cliente de Prueba", email: "cliente@prueba.com", identificacion: "123456789" },
    items: [ { nombre: "Producto Prueba 1", precio: 10000, cantidad: 1 } ],
  };
  try {
    const { data, error } = await supabaseInstance.functions.invoke('alegra-crear-factura', {
      body: { hotelId: currentHotelId, facturaData: datosFacturaEjemplo },
    });
    if (error) throw error;
    if (data.ok) {
      showFeedback(feedbackEl, `✅ Factura de prueba generada/enviada: ${data.message || ''} (ID: ${data.facturaId || ''})`, false);
    } else {
      showFeedback(feedbackEl, `❌ Error al generar factura: ${data.message || 'Error desconocido.'}`, true, 0);
    }
  } catch (err) {
    console.error('Error generando factura de prueba Alegra:', err);
    showFeedback(feedbackEl, `Error al generar factura: ${err.message || err}`, true, 0);
  } finally {
    setLoading(null, false, buttonEl, originalButtonText || 'Generar Factura de Prueba');
  }
}
// --- FIN SECCIÓN ALEGRA ---

// --- SECCIÓN CLOUDBEDS (Channel Manager) ---
async function iniciarConexionCloudbeds() {
    if (!currentHotelId || !supabaseInstance) {
        showFeedback(document.getElementById('cloudbeds-status-feedback'), 'Error: Hotel no identificado. No se puede iniciar la conexión.', true, 0);
        return;
    }
    showFeedback(document.getElementById('cloudbeds-status-feedback'), 'Redirigiendo a Cloudbeds para autorización...', false, 0);

    // 1. (Backend) Tu backend debería tener un endpoint que genere la URL de autorización de Cloudbeds.
    //    Este endpoint construiría la URL con tu client_id, redirect_uri, scope, y un state (para seguridad).
    // 2. (Frontend) Llamas a ese endpoint para obtener la URL y luego rediriges.
    //    O, si la URL es suficientemente estática (excepto el 'state'), podrías construirla aquí,
    //    pero es mejor que el backend la prepare.

    try {
        // EJEMPLO: Llamada a una función de Supabase que devuelve la URL de autorización
        const { data, error } = await supabaseInstance.functions.invoke('cloudbeds-get-auth-url', {
            body: { hotelId: currentHotelId } // Enviar hotelId para generar 'state' si es necesario
        });

        if (error) throw error;

        if (data.authUrl) {
            window.location.href = data.authUrl; // Redirigir al usuario a Cloudbeds
        } else {
            showFeedback(document.getElementById('cloudbeds-status-feedback'), 'Error al obtener la URL de autorización de Cloudbeds.', true, 0);
        }
    } catch (err) {
        console.error('Error al iniciar conexión con Cloudbeds:', err);
        showFeedback(document.getElementById('cloudbeds-status-feedback'), `Error: ${err.message}`, true, 0);
    }
}

async function verificarEstadoCloudbeds(statusFeedbackEl, detailsEl, connectButtonEl, disconnectButtonEl, testButtonEl) {
  if (!currentHotelId || !supabaseInstance) {
    showFeedback(statusFeedbackEl, 'Error: Hotel no identificado.', true, 0);
    return;
  }
  showFeedback(statusFeedbackEl, 'Verificando estado de Cloudbeds...', false, 0);

  try {
    const { data, error } = await supabaseInstance.functions.invoke('cloudbeds-check-status', {
      body: { hotelId: currentHotelId }
    });

    if (error) throw error;

    if (data.isConnected) {
      showFeedback(statusFeedbackEl, '✅ Conectado a Cloudbeds.', false);
      if(detailsEl) detailsEl.textContent = `Conectado como: ${data.hotelName || 'Hotel Cloudbeds'}. Property ID: ${data.propertyId || 'N/A'}`;
      if(connectButtonEl) connectButtonEl.style.display = 'none';
      if(disconnectButtonEl) disconnectButtonEl.style.display = 'inline-block';
      if(testButtonEl) testButtonEl.disabled = false;
    } else {
      showFeedback(statusFeedbackEl, 'No conectado a Cloudbeds.', false);
      if(detailsEl) detailsEl.textContent = '';
      if(connectButtonEl) connectButtonEl.style.display = 'inline-block';
      if(disconnectButtonEl) disconnectButtonEl.style.display = 'none';
      if(testButtonEl) testButtonEl.disabled = true;
    }
  } catch (err) {
    console.error('Error verificando estado de Cloudbeds:', err);
    showFeedback(statusFeedbackEl, `Error: ${err.message}`, true, 0);
    if(detailsEl) detailsEl.textContent = '';
    if(connectButtonEl) connectButtonEl.style.display = 'inline-block';
    if(disconnectButtonEl) disconnectButtonEl.style.display = 'none';
    if(testButtonEl) testButtonEl.disabled = true;
  }
}

async function desconectarCloudbeds(statusFeedbackEl, detailsEl, connectButtonEl, disconnectButtonEl, testButtonEl) {
    if (!currentHotelId || !supabaseInstance) {
        showFeedback(statusFeedbackEl, 'Error: Hotel no identificado.', true, 0);
        return;
    }
    const confirmation = confirm("¿Estás seguro de que deseas desconectar Cloudbeds? Esto eliminará la autorización para acceder a tus datos de Cloudbeds.");
    if (!confirmation) return;

    setLoading(null, true, disconnectButtonEl, 'Desconectando...');
    showFeedback(statusFeedbackEl, 'Desconectando de Cloudbeds...', false, 0);

    try {
        const { data, error } = await supabaseInstance.functions.invoke('cloudbeds-disconnect', {
            body: { hotelId: currentHotelId }
        });

        if (error) throw error;

        showFeedback(statusFeedbackEl, data.message || 'Desconectado correctamente.', false);
        verificarEstadoCloudbeds(statusFeedbackEl, detailsEl, connectButtonEl, disconnectButtonEl, testButtonEl); // Actualizar UI

    } catch (err) {
        console.error('Error al desconectar Cloudbeds:', err);
        showFeedback(statusFeedbackEl, `Error al desconectar: ${err.message}`, true, 0);
        setLoading(null, false, disconnectButtonEl, 'Desconectar Cloudbeds');
    }
}

async function probarConexionCloudbeds(feedbackEl, buttonEl) {
    if (!currentHotelId || !supabaseInstance) { showFeedback(feedbackEl, 'Error: Hotel no identificado.', true, 0); return; }
    setLoading(null, true, buttonEl, 'Probando...');
    const originalButtonText = buttonEl.textContent;
    showFeedback(feedbackEl, 'Iniciando prueba de conexión con Cloudbeds API...', false, 0);
    try {
        const { data, error } = await supabaseInstance.functions.invoke('cloudbeds-api-test', { // Nueva función de backend
            body: { hotelId: currentHotelId },
        });
        if (error) throw error;
        if (data.ok) {
            showFeedback(feedbackEl, `✅ API de Cloudbeds respondió: ${data.message || 'OK'}`, false);
        } else {
            showFeedback(feedbackEl, `❌ Falló la prueba con API de Cloudbeds: ${data.message || 'Error desconocido.'}`, true, 0);
        }
    } catch (err) {
        console.error('Error en prueba de API Cloudbeds:', err);
        showFeedback(feedbackEl, `Error al probar API: ${err.message || err}`, true, 0);
    } finally {
        setLoading(null, false, buttonEl, originalButtonText || 'Probar API Cloudbeds');
    }
}
// --- FIN SECCIÓN CLOUDBEDS ---


export async function mount(container, sbInstance, user) {
  supabaseInstance = sbInstance;
  userObject = user; // Guardar el objeto user
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

        <fieldset class="config-section p-4 border rounded-md mt-4">
            <legend class="text-lg font-medium text-gray-900 px-2">Cloudbeds (Channel Manager)</legend>
            <div id="cloudbeds-status-feedback" role="alert" aria-live="assertive" style="display:none;" class="mt-2 mb-2"></div>
            <p id="cloudbeds-connection-details" class="text-sm text-gray-600 px-2 mb-3"></p>
            <div class="form-actions mt-2 flex flex-wrap items-center gap-4">
                <button type="button" id="btnConectarCloudbeds" class="button button-primary py-2 px-4 rounded-md">Conectar con Cloudbeds</button>
                <button type="button" id="btnDesconectarCloudbeds" class="button button-danger py-2 px-4 rounded-md" style="display:none;">Desconectar Cloudbeds</button>
                <button type="button" id="btnProbarCloudbedsAPI" class="button button-secondary py-2 px-4 rounded-md" disabled>Probar API Cloudbeds</button>
            </div>
             <div id="cloudbeds-test-feedback" class="ml-2 mt-2 text-sm"></div>
            <small class="form-text text-gray-500 mt-2 block px-2">
                Al conectar, serás redirigido a Cloudbeds para autorizar la conexión.
            </small>
        </fieldset>
        
        <form id="form-alegra" novalidate class="space-y-6 mt-6">
          <fieldset class="config-section p-4 border rounded-md">
            <legend class="text-lg font-medium text-gray-900 px-2">Alegra (Facturación Electrónica)</legend>
            <p class="text-sm text-gray-500 px-2 mb-3">Configura tus credenciales de Alegra.</p>
            <div class="form-group mt-2">
              <label for="alegra_usuario" class="block text-sm font-medium text-gray-700">Usuario de Alegra (correo)</label>
              <input type="email" id="alegra_usuario" name="alegra_usuario" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" autocomplete="username" />
            </div>
            <div class="form-group mt-4">
              <label for="alegra_token" class="block text-sm font-medium text-gray-700">Token API de Alegra</label>
              <input type="password" id="alegra_token" name="alegra_token" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm" autocomplete="new-password" />
              <small class="form-text text-gray-500 mt-1">
                Ingresa el token si deseas cambiarlo. Se mostrará '********' si ya está configurado.
              </small>
            </div>
            <div id="alegra-config-feedback" role="alert" aria-live="assertive" style="display:none;" class="mt-2"></div>
            <div class="form-actions mt-6 flex items-center gap-4">
              <button type="submit" id="btnGuardarAlegra" class="button button-primary py-2 px-4 rounded-md">Guardar Configuración Alegra</button>
            </div>
          </fieldset>
        </form>
        <div class="mt-6 p-4 border rounded-md">
            <h3 class="text-md font-medium text-gray-900 px-2 mb-3">Acciones Alegra</h3>
            <div class="flex items-center gap-2 mt-4">
                <button type="button" id="btnProbarAlegra" class="button button-secondary px-4 py-2 rounded-md">Probar Conexión con Alegra</button>
                <div id="alegra-test-feedback" class="ml-2 text-sm"></div>
            </div>
            <div class="flex items-center gap-2 mt-4">
                <button type="button" id="btnFacturaPruebaAlegra" class="button button-accent px-4 py-2 rounded-md">Generar Factura de Prueba (Alegra)</button>
                <div id="alegra-invoice-feedback" class="ml-2 text-sm"></div>
            </div>
        </div>
      </div>
    </div>
  `;

  // Cargar hotelId
  currentHotelId = userObject?.user_metadata?.hotel_id;
  if (!currentHotelId && userObject?.id) {
    try {
      const { data: perfil, error: perfilError } = await supabaseInstance.from('usuarios').select('hotel_id').eq('id', userObject.id).single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError;
      currentHotelId = perfil?.hotel_id;
    } catch (err) {
      console.error("Error fetching hotel_id for integrations module:", err);
    }
  }

  // Elementos comunes
  const mainFeedbackEl = container.querySelector('.card-body > p'); // Para errores generales del módulo

  // Elementos Alegra
  const formAlegraEl = container.querySelector('#form-alegra');
  const alegraConfigFeedbackEl = container.querySelector('#alegra-config-feedback');
  const btnGuardarAlegraEl = container.querySelector('#btnGuardarAlegra');
  const btnProbarAlegraEl = container.querySelector('#btnProbarAlegra');
  const alegraTestFeedbackEl = container.querySelector('#alegra-test-feedback');
  const btnFacturaPruebaAlegraEl = container.querySelector('#btnFacturaPruebaAlegra');
  const alegraInvoiceFeedbackEl = container.querySelector('#alegra-invoice-feedback');

  // Elementos Cloudbeds
  const btnConectarCloudbedsEl = container.querySelector('#btnConectarCloudbeds');
  const btnDesconectarCloudbedsEl = container.querySelector('#btnDesconectarCloudbeds');
  const btnProbarCloudbedsAPIEl = container.querySelector('#btnProbarCloudbedsAPI');
  const cloudbedsStatusFeedbackEl = container.querySelector('#cloudbeds-status-feedback');
  const cloudbedsConnectionDetailsEl = container.querySelector('#cloudbeds-connection-details');
  const cloudbedsTestFeedbackEl = container.querySelector('#cloudbeds-test-feedback');

  if (!currentHotelId) {
    if (mainFeedbackEl) showFeedback(mainFeedbackEl, 'Error: Hotel no identificado. No se pueden gestionar las integraciones.', true, 0);
    container.querySelectorAll('input, button, select').forEach(el => el.disabled = true);
    return;
  }

  // Cargar configuraciones y estados existentes
  async function cargarConfiguracionAlegraExistente() {
    if (!formAlegraEl || !btnGuardarAlegraEl) return; // Si el form no existe, no hacer nada
    setLoading(formAlegraEl, true, btnGuardarAlegraEl, 'Cargando...');
    try {
      const { data, error } = await supabaseInstance.from('integraciones_hotel')
        .select('facturador_usuario, facturador_api_key')
        .eq('hotel_id', currentHotelId)
        .eq('facturador_nombre', 'Alegra')
        .maybeSingle();
      if (error) throw error;
      if (data) {
        if (formAlegraEl.elements.alegra_usuario) formAlegraEl.elements.alegra_usuario.value = data.facturador_usuario || '';
        if (formAlegraEl.elements.alegra_token) {
          if (data.facturador_api_key) {
            formAlegraEl.elements.alegra_token.value = '********';
            formAlegraEl.elements.alegra_token.dataset.realValue = data.facturador_api_key;
          } else { formAlegraEl.elements.alegra_token.value = ''; delete formAlegraEl.elements.alegra_token.dataset.realValue; }
        }
      }
    } catch (err) {
      console.error('Error cargando configuración de Alegra:', err);
      if(alegraConfigFeedbackEl) showFeedback(alegraConfigFeedbackEl, `Error al cargar config. Alegra: ${err.message}`, true, 0);
    } finally {
      setLoading(formAlegraEl, false, btnGuardarAlegraEl, 'Guardar Configuración Alegra');
    }
  }
  
  if (formAlegraEl) { // Solo cargar y añadir listeners si la sección Alegra está en el DOM
    await cargarConfiguracionAlegraExistente();
    const alegraFormSubmitHandler = (e) => { e.preventDefault(); guardarConfiguracionAlegra(formAlegraEl, alegraConfigFeedbackEl, btnGuardarAlegraEl); };
    formAlegraEl.addEventListener('submit', alegraFormSubmitHandler);
    moduleListeners.push({ element: formAlegraEl, type: 'submit', handler: alegraFormSubmitHandler });

    if (btnProbarAlegraEl) {
      const probarAlegraHandler = () => probarConexionAlegra(alegraTestFeedbackEl, btnProbarAlegraEl);
      btnProbarAlegraEl.addEventListener('click', probarAlegraHandler);
      moduleListeners.push({ element: btnProbarAlegraEl, type: 'click', handler: probarAlegraHandler });
    }
    if (btnFacturaPruebaAlegraEl) {
      const facturaPruebaAlegraHandler = () => generarFacturaPruebaAlegra(alegraInvoiceFeedbackEl, btnFacturaPruebaAlegraEl);
      btnFacturaPruebaAlegraEl.addEventListener('click', facturaPruebaAlegraHandler);
      moduleListeners.push({ element: btnFacturaPruebaAlegraEl, type: 'click', handler: facturaPruebaAlegraHandler });
    }
  }

  // Lógica Cloudbeds
  if (btnConectarCloudbedsEl) { // Solo añadir listeners si la sección Cloudbeds está en el DOM
    await verificarEstadoCloudbeds(cloudbedsStatusFeedbackEl, cloudbedsConnectionDetailsEl, btnConectarCloudbedsEl, btnDesconectarCloudbedsEl, btnProbarCloudbedsAPIEl);
    
    const conectarCloudbedsHandler = () => iniciarConexionCloudbeds();
    btnConectarCloudbedsEl.addEventListener('click', conectarCloudbedsHandler);
    moduleListeners.push({ element: btnConectarCloudbedsEl, type: 'click', handler: conectarCloudbedsHandler });

    if(btnDesconectarCloudbedsEl) {
        const desconectarCloudbedsHandler = () => desconectarCloudbeds(cloudbedsStatusFeedbackEl, cloudbedsConnectionDetailsEl, btnConectarCloudbedsEl, btnDesconectarCloudbedsEl, btnProbarCloudbedsAPIEl);
        btnDesconectarCloudbedsEl.addEventListener('click', desconectarCloudbedsHandler);
        moduleListeners.push({ element: btnDesconectarCloudbedsEl, type: 'click', handler: desconectarCloudbedsHandler });
    }
    if(btnProbarCloudbedsAPIEl && cloudbedsTestFeedbackEl) {
        const probarCloudbedsAPIHandler = () => probarConexionCloudbeds(cloudbedsTestFeedbackEl, btnProbarCloudbedsAPIEl);
        btnProbarCloudbedsAPIEl.addEventListener('click', probarCloudbedsAPIHandler);
        moduleListeners.push({ element: btnProbarCloudbedsAPIEl, type: 'click', handler: probarCloudbedsAPIHandler });
    }
  }

  // Verificar si hay algún parámetro en la URL después de una redirección de OAuth
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('cloudbeds_oauth_status')) {
    const status = urlParams.get('cloudbeds_oauth_status');
    const message = urlParams.get('message') || '';
    if (status === 'success') {
        showFeedback(cloudbedsStatusFeedbackEl, message || 'Conexión con Cloudbeds exitosa. Verificando estado final...', false);
    } else {
        showFeedback(cloudbedsStatusFeedbackEl, message || 'Falló la autorización con Cloudbeds.', true, 0);
    }
    // Limpiar parámetros de la URL para no mostrarlos repetidamente
    window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    // Volver a verificar el estado para actualizar la UI correctamente
    if (btnConectarCloudbedsEl) { // Asegurarse de que los elementos existen
        await verificarEstadoCloudbeds(cloudbedsStatusFeedbackEl, cloudbedsConnectionDetailsEl, btnConectarCloudbedsEl, btnDesconectarCloudbedsEl, btnProbarCloudbedsAPIEl);
    }
  }
}

export function unmount() {
  moduleListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = [];
  currentHotelId = null;
  supabaseInstance = null;
  userObject = null;
  console.log('Integraciones module unmounted and listeners cleaned up.');
}