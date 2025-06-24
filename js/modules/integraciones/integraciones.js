// js/modules/integraciones/integraciones.js

let moduleListeners = [];
let currentHotelId = null;
let supabaseInstance = null;
let userObject = null;

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
  if (formEl) {
    Array.from(formEl.elements).forEach(el => {
      if (el.type !== 'submit' && el.type !== 'button') {
        el.disabled = isLoading;
      }
    });
  }
}

// --- LÓGICA DE CALENDARIOS (GOOGLE/OUTLOOK) ---

async function listarEventosGoogle(container, uiElements) {
  const lista = uiElements.google.listaEventosEl;
  lista.innerHTML = '<li class="text-gray-400 text-sm">Cargando eventos...</li>';
  try {
    const { data, error } = await supabaseInstance.functions.invoke('calendar-list-events', {
      body: { hotelId: currentHotelId, provider: 'google' }
    });
    if (error || !data || !Array.isArray(data.items)) {
      lista.innerHTML = '<li class="text-red-600 text-sm">No se pudieron obtener los eventos.</li>';
      return;
    }
    if (data.items.length === 0) {
      lista.innerHTML = '<li class="text-gray-500 text-sm">No hay eventos próximos.</li>';
      return;
    }
    lista.innerHTML = '';
    data.items.forEach(evento => {
      const li = document.createElement('li');
      li.className = 'flex justify-between items-center py-1 border-b border-gray-100';
      li.innerHTML = `
        <span>
          <strong>${evento.summary || 'Sin título'}</strong>
          <span class="ml-2 text-gray-500 text-xs">${evento.start?.dateTime?.replace('T', ' ').slice(0, 16) || evento.start?.date || ''}</span>
        </span>
      `;
      const btn = document.createElement('button');
      btn.textContent = 'Eliminar';
      btn.className = 'ml-3 px-2 py-1 rounded bg-red-100 text-red-700 text-xs hover:bg-red-200 transition';
      btn.onclick = async () => {
        if (confirm('¿Seguro que deseas borrar este evento?')) {
          btn.disabled = true;
          btn.textContent = 'Eliminando...';
          const { data: delData, error: delError } = await supabaseInstance.functions.invoke('calendar-delete-event', {
            body: { hotelId: currentHotelId, provider: 'google', eventId: evento.id }
          });
          if (delError) {
            alert('Error al eliminar evento: ' + delError.message);
            btn.disabled = false;
            btn.textContent = 'Eliminar';
            return;
          }
          li.remove();
        }
      };
      li.appendChild(btn);
      lista.appendChild(li);
    });
  } catch (err) {
    lista.innerHTML = '<li class="text-red-600 text-sm">Error al listar eventos.</li>';
  }
}



// ... (código existente, por ejemplo, después de listarEventosGoogle) ...

async function listarEventosOutlook(container, uiElements) {
  const lista = uiElements.outlook.listaEventosEl;
  lista.innerHTML = '<li class="text-gray-400 text-sm">Cargando eventos...</li>';
  try {
    // CAMBIO CLAVE: Invoca la nueva Edge Function para Outlook
    const { data, error } = await supabaseInstance.functions.invoke('outlook-calendar-events', {
      body: { hotelId: currentHotelId, action: 'list' } // 'action: list' para indicar que quieres listar
    });

    if (error || !data || !Array.isArray(data.items)) {
      lista.innerHTML = `<li class="text-red-600 text-sm">No se pudieron obtener los eventos de Outlook: ${error?.message || 'Error desconocido'}.</li>`;
      return;
    }
    if (data.items.length === 0) {
      lista.innerHTML = '<li class="text-gray-500 text-sm">No hay eventos próximos en Outlook.</li>';
      return;
    }

    lista.innerHTML = '';
    data.items.forEach(evento => {
      const li = document.createElement('li');
      li.className = 'flex justify-between items-center py-1 border-b border-gray-100';
      li.innerHTML = `
        <span>
          <strong>${evento.summary || 'Sin título'}</strong>
          <span class="ml-2 text-gray-500 text-xs">${evento.start?.dateTime?.replace('T', ' ').slice(0, 16) || evento.start?.date || ''}</span>
        </span>
      `;
      const btn = document.createElement('button');
      btn.textContent = 'Eliminar';
      btn.className = 'ml-3 px-2 py-1 rounded bg-red-100 text-red-700 text-xs hover:bg-red-200 transition';
      btn.onclick = async () => {
        if (confirm('¿Seguro que deseas borrar este evento de Outlook?')) {
          btn.disabled = true;
          btn.textContent = 'Eliminando...';
          // CAMBIO CLAVE: Invoca la nueva Edge Function para eliminar eventos de Outlook
          const { data: delData, error: delError } = await supabaseInstance.functions.invoke('outlook-calendar-events', {
            body: { hotelId: currentHotelId, action: 'delete', eventId: evento.id } // 'action: delete'
          });
          if (delError) {
            alert('Error al eliminar evento de Outlook: ' + delError.message);
            btn.disabled = false;
            btn.textContent = 'Eliminar';
            return;
          }
          li.remove();
        }
      };
      li.appendChild(btn);
      lista.appendChild(li);
    });
  } catch (err) {
    lista.innerHTML = `<li class="text-red-600 text-sm">Error al listar eventos de Outlook: ${err.message}.</li>`;
    console.error("Error en listarEventosOutlook:", err);
  }
}


// ... (dentro de la función verificarEstadoCalendarios)

async function verificarEstadoCalendarios(uiElements) {
    if (!currentHotelId || !supabaseInstance) {
        showFeedback(uiElements.mainFeedback, 'Error: Hotel no identificado.', true, 0);
        return;
    }
    showFeedback(uiElements.mainFeedback, 'Verificando estado de conexión de calendarios...', false, 0);

    try {
        const { data, error } = await supabaseInstance.functions.invoke('calendar-get-status', {
            body: { hotelId: currentHotelId }
        });
        if (error) throw error;

        // Actualizar UI de Google
        if (data.google.connected) {
            uiElements.google.statusEl.textContent = `✅ Conectado como: ${data.google.user_email}`;
            uiElements.google.connectBtn.style.display = 'none';
            uiElements.google.disconnectBtn.style.display = 'inline-block';
            uiElements.google.testForm.style.display = 'block';
            uiElements.google.listarBtn.style.display = 'inline-block';
            listarEventosGoogle(null, uiElements); // Se mantiene para Google
        } else {
            uiElements.google.statusEl.textContent = 'No conectado.';
            uiElements.google.connectBtn.style.display = 'inline-block';
            uiElements.google.disconnectBtn.style.display = 'none';
            uiElements.google.testForm.style.display = 'none';
            uiElements.google.listarBtn.style.display = 'none';
            uiElements.google.listaEventosEl.innerHTML = '';
        }

        // Actualizar UI de Outlook (igual que antes)
        if (data.outlook.connected) {
            uiElements.outlook.statusEl.textContent = `✅ Conectado como: ${data.outlook.user_email}`;
            uiElements.outlook.connectBtn.style.display = 'none';
            uiElements.outlook.disconnectBtn.style.display = 'inline-block';
            uiElements.outlook.testForm.style.display = 'block';
            // AÑADIR ESTAS LÍNEAS PARA OUTLOOK
            uiElements.outlook.listarBtn.style.display = 'inline-block'; // Mostrar el botón
            listarEventosOutlook(null, uiElements); // Llamar a listar eventos de Outlook
        } else {
            uiElements.outlook.statusEl.textContent = 'No conectado.';
            uiElements.outlook.connectBtn.style.display = 'inline-block';
            uiElements.outlook.disconnectBtn.style.display = 'none';
            uiElements.outlook.testForm.style.display = 'none';
            // AÑADIR ESTAS LÍNEAS PARA OUTLOOK
            uiElements.outlook.listarBtn.style.display = 'none'; // Ocultar el botón
            uiElements.outlook.listaEventosEl.innerHTML = ''; // Limpiar la lista
        }
        clearFeedback(uiElements.mainFeedback);

    } catch (err) {
        console.error('Error verificando estado de calendarios:', err);
        showFeedback(uiElements.mainFeedback, `Error al verificar estado: ${err.message}`, true, 0);
    }
}


async function iniciarConexionCalendario(provider, feedbackEl) {
  if (!currentHotelId || !supabaseInstance) {
    showFeedback(feedbackEl, 'Error: Hotel no identificado.', true, 0);
    return;
  }
  showFeedback(feedbackEl, `Redirigiendo a ${provider === 'google' ? 'Google' : 'Outlook'}...`, false, 0);

  try {
    const { data, error } = await supabaseInstance.functions.invoke('calendar-get-auth-url', {
      body: { hotelId: currentHotelId, provider: provider }
    });
    if (error) throw error;
    if (data.authUrl) {
      window.location.href = data.authUrl;
    } else {
      throw new Error('No se recibió URL de autorización.');
    }
  } catch (err) {
    console.error(`Error al iniciar conexión con ${provider}:`, err);
    showFeedback(feedbackEl, `Error: ${err.message}`, true, 0);
  }
}

async function desconectarCalendario(provider, buttonEl, feedbackEl, uiElements) {
    if (!currentHotelId || !supabaseInstance) { return; }
    if (!confirm(`¿Estás seguro de que deseas desconectar tu cuenta de ${provider === 'google' ? 'Google' : 'Outlook'}?`)) {
      return;
    }
    setLoading(null, true, buttonEl, 'Desconectando...');
    try {
        const { data, error } = await supabaseInstance.functions.invoke('calendar-disconnect', {
            body: { hotelId: currentHotelId, provider }
        });
        if (error) throw error;
        showFeedback(feedbackEl, data.message || 'Desconectado correctamente.', false);
        await verificarEstadoCalendarios(uiElements);
    } catch (err) {
        console.error(`Error al desconectar ${provider}:`, err);
        showFeedback(feedbackEl, `Error al desconectar: ${err.message}`, true, 0);
    } finally {
        setLoading(null, false, buttonEl, `Desconectar ${provider === 'google' ? 'Google' : 'Outlook'}`);
    }
}

async function crearEventoDePrueba(provider, formEl, buttonEl, feedbackEl, uiElements) {
    if (!currentHotelId || !supabaseInstance) { return; }
    setLoading(formEl, true, buttonEl, 'Creando...');
    clearFeedback(feedbackEl);
    try {
        const now = new Date();
        const start = new Date(now.getTime() + 60 * 60 * 1000);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        const eventDetails = {
            summary: formEl.elements.test_event_summary.value.trim() || `Reserva de Prueba Hotel`,
            description: `Este es un evento de prueba creado desde el software hotelero.`,
            start: start.toISOString(),
            end: end.toISOString(),
        };
        const { data, error } = await supabaseInstance.functions.invoke('calendar-create-event', {
            body: { hotelId: currentHotelId, provider, eventDetails }
        });
        if (error) throw error;
        showFeedback(feedbackEl, `✅ Evento de prueba creado exitosamente.`, false);
        formEl.reset();
        if(provider === "google") listarEventosGoogle(null, uiElements);
    } catch (err) {
        console.error(`Error creando evento de prueba en ${provider}:`, err, err?.response, err?.status, err?.body);
        showFeedback(feedbackEl, `Error al crear evento: ${err.message}`, true, 0);
    } finally {
        setLoading(formEl, false, buttonEl, 'Crear Evento de Prueba');
    }
}

// --- LÓGICA DE ALEGRA (igual que antes) ---

async function guardarConfiguracionAlegra(formEl, feedbackEl, buttonEl) {
  if (!currentHotelId || !supabaseInstance) {
    showFeedback(feedbackEl, 'Error: Hotel no identificado o Supabase no disponible.', true, 0);
    return;
  }
  setLoading(formEl, true, buttonEl, 'Guardando...');
  const originalButtonText = buttonEl.textContent;
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
      .upsert(payload, { onConflict: 'hotel_id, facturador_nombre' });
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

// --- FUNCIÓN PRINCIPAL DEL MÓDULO ---

export async function mount(container, sbInstance, user) {
  console.log('[Integraciones.js] Montando el módulo de integraciones...');
  unmount();

  supabaseInstance = sbInstance;
  userObject = user;
  currentHotelId = null;

  container.innerHTML = `
    <div class="card">
      <div class="card-header"><h2 class="text-xl font-semibold">Configuración de Integraciones Externas</h2></div>
      <div class="card-body">
        <p class="text-gray-600 text-sm mb-4">
          Conecta tu sistema hotelero con plataformas externas para automatizar y sincronizar datos.
        </p>
        <fieldset class="config-section p-4 border rounded-md mt-6">
            <legend class="text-lg font-medium text-gray-900 px-2">📅 Sincronización de Calendarios</legend>
            <p class="text-sm text-gray-500 px-2 mb-4">Conecta un calendario para sincronizar reservas y disponibilidad.</p>
            <div id="calendar-main-feedback" role="alert" aria-live="assertive" style="display:none;" class="mt-2 mb-2"></div>
            <div class="p-4 border rounded-md mb-4 bg-gray-50">
                <h4 class="font-semibold text-gray-800">Google Calendar</h4>
                <p id="google-status-text" class="text-sm text-gray-600 my-2">Verificando estado...</p>
                <div class="flex flex-wrap items-center gap-4">
                    <button type="button" id="btn-connect-google" class="button button-primary py-2 px-4 rounded-md">Conectar con Google</button>
                    <button type="button" id="btn-disconnect-google" class="button button-danger py-2 px-4 rounded-md" style="display:none;">Desconectar Google</button>
                    <button type="button" id="btn-listar-google" class="button button-accent py-2 px-4 rounded-md" style="display:none;">Ver Eventos</button>
                </div>
                <form id="google-test-form" style="display:none;" class="mt-4 p-3 border-t">
                     <p class="text-sm font-medium mb-2">Probar la conexión:</p>
                     <div class="flex items-center gap-2">
                         <input type="text" name="test_event_summary" placeholder="Título del evento de prueba" class="form-control text-sm flex-grow">
                         <button type="submit" class="button button-secondary py-1 px-3 text-sm">Crear Evento</button>
                     </div>
                     <div id="google-test-feedback" class="mt-2 text-sm"></div>
                </form>
                <ul id="google-lista-eventos" class="mt-4 text-sm space-y-1"></ul>
            </div>
            <div class="p-4 border rounded-md bg-gray-50">
                <h4 class="font-semibold text-gray-800">Outlook Calendar</h4>
                <p id="outlook-status-text" class="text-sm text-gray-600 my-2">Verificando estado...</p>
                <div class="flex flex-wrap items-center gap-4">
                    <button type="button" id="btn-connect-outlook" class="button button-primary py-2 px-4 rounded-md">Conectar con Outlook</button>
                    <button type="button" id="btn-disconnect-outlook" class="button button-danger py-2 px-4 rounded-md" style="display:none;">Desconectar Outlook</button>
                    <button type="button" id="btn-listar-outlook" class="button button-accent py-2 px-4 rounded-md" style="display:none;">Ver Eventos</button>
                </div>
                <form id="outlook-test-form" style="display:none;" class="mt-4 p-3 border-t">
                     <p class="text-sm font-medium mb-2">Probar la conexión:</p>
                     <div class="flex items-center gap-2">
                         <input type="text" name="test_event_summary" placeholder="Título del evento de prueba" class="form-control text-sm flex-grow">
                         <button type="submit" class="button button-secondary py-1 px-3 text-sm">Crear Evento</button>
                     </div>
                     <div id="outlook-test-feedback" class="mt-2 text-sm"></div>
                </form>
                <ul id="outlook-lista-eventos" class="mt-4 text-sm space-y-1"></ul>
            </div>
        </fieldset>
        <!-- Aquí va la NUEVA integración Zapier/Alegra -->
        <fieldset class="config-section p-4 border rounded-md mt-8">
          <legend class="text-lg font-medium text-gray-900 px-2 flex items-center gap-2">
            Alegra (Facturación Electrónica vía Zapier)
            <img src="https://static.alegra.com/assets/img/icon-alegra.svg" alt="Alegra" style="width:22px;height:22px;vertical-align:middle;" />
          </legend>
          <p class="text-sm text-gray-500 px-2 mb-3">
            Conecta tu sistema con Alegra para emitir facturas electrónicas automáticas en tu cuenta de hotel.<br>
            <b>¿Cómo funciona?</b><br>
            Cada hotel puede conectar su propia cuenta de Alegra vía <a href="https://zapier.com" target="_blank" class="text-blue-700 underline">Zapier</a>.<br>
            Solo debes pegar el enlace de tu Webhook personalizado (debe empezar por <code>https://hooks.zapier.com/</code>).
          </p>
          <ol class="list-decimal ml-6 mb-3 text-gray-700 text-sm">
            <li>Crea una cuenta gratuita en <a href="https://zapier.com" target="_blank" class="text-blue-700 underline">Zapier</a> y conecta tu cuenta de Alegra.</li>
            <li>Crea un Zap: selecciona "Webhooks by Zapier" (Catch Hook) y copia la URL.</li>
            <li>Pega aquí la URL de tu Webhook:</li>
          </ol>
          <input type="url" id="alegra-webhook-url" class="form-control my-2" placeholder="https://hooks.zapier.com/..." autocomplete="off" />
          <button class="button button-primary mb-2" id="guardar-alegra-webhook">Guardar Webhook</button>
          <div id="alegra-feedback" class="my-2 text-sm"></div>
          <details class="mt-4 mb-1 bg-blue-50 p-3 rounded">
            <summary class="font-semibold text-blue-700 cursor-pointer">¿Qué datos se envían?</summary>
            <pre class="bg-gray-100 rounded p-2 text-xs mt-2 overflow-x-auto">
{
  "cliente": { "nombre": "Juan Pérez", "documento": "123456789" },
  "productos": [
    { "nombre": "Habitación 101", "cantidad": 1, "precio": 40000 },
    { "nombre": "Mini Bar", "cantidad": 2, "precio": 9000 }
  ],
  "total": 58000,
  "fecha": "2025-06-23T10:50:00Z"
}
            </pre>
            <span class="block mt-2 text-blue-800">
              En tu Zap solo tienes que mapear los campos (cliente, productos, total, fecha) en la acción de Alegra.
            </span>
          </details>
        </fieldset>
      </div>
    </div>
  `;

  // Cargar hotelId
  currentHotelId = userObject?.user_metadata?.hotel_id;
  if (!currentHotelId && userObject?.id) {
    try {
      const { data: perfil } = await supabaseInstance.from('usuarios').select('hotel_id').eq('id', userObject.id).single();
      currentHotelId = perfil?.hotel_id;
    } catch (err) {
      console.error("Error fetching hotel_id:", err);
    }
  }

  if (!currentHotelId) {
    container.querySelector('.card-body').innerHTML = '<p class="text-red-600">Error: Hotel no identificado. No se pueden gestionar las integraciones.</p>';
    return;
  }
  
  const addEvt = (el, type, handler) => {
    if (!el) return;
    el.addEventListener(type, handler);
    moduleListeners.push({ element: el, type, handler });
  };
  
  // --- Lógica y Listeners de Calendarios ---
  const calendarUiElements = {
      mainFeedback: container.querySelector('#calendar-main-feedback'),
      google: {
        statusEl: container.querySelector('#google-status-text'),
        connectBtn: container.querySelector('#btn-connect-google'),
        disconnectBtn: container.querySelector('#btn-disconnect-google'),
        listarBtn: container.querySelector('#btn-listar-google'),
        testForm: container.querySelector('#google-test-form'),
        testFeedbackEl: container.querySelector('#google-test-feedback'),
        listaEventosEl: container.querySelector('#google-lista-eventos')
      },
      outlook: { 
        statusEl: container.querySelector('#outlook-status-text'),
        connectBtn: container.querySelector('#btn-connect-outlook'),
        disconnectBtn: container.querySelector('#btn-disconnect-outlook'),
        testForm: container.querySelector('#outlook-test-form'),
        testFeedbackEl: container.querySelector('#outlook-test-feedback'),
        listarBtn: container.querySelector('#btn-listar-outlook'),
        listaEventosEl: container.querySelector('#outlook-lista-eventos')
      },
  };

  addEvt(calendarUiElements.google.connectBtn, 'click', () => iniciarConexionCalendario('google', calendarUiElements.google.statusEl));
  addEvt(calendarUiElements.google.disconnectBtn, 'click', (e) => desconectarCalendario('google', e.target, calendarUiElements.google.statusEl, calendarUiElements));
  addEvt(calendarUiElements.google.testForm, 'submit', (e) => { e.preventDefault(); crearEventoDePrueba('google', e.target, e.target.querySelector('button'), calendarUiElements.google.testFeedbackEl, calendarUiElements); });
  addEvt(calendarUiElements.google.listarBtn, 'click', () => listarEventosGoogle(null, calendarUiElements));

  addEvt(calendarUiElements.outlook.connectBtn, 'click', () => iniciarConexionCalendario('outlook', calendarUiElements.outlook.statusEl));
  addEvt(calendarUiElements.outlook.disconnectBtn, 'click', (e) => desconectarCalendario('outlook', e.target, calendarUiElements.outlook.statusEl, calendarUiElements));
  addEvt(calendarUiElements.outlook.testForm, 'submit', (e) => { e.preventDefault(); crearEventoDePrueba('outlook', e.target, e.target.querySelector('button'), calendarUiElements.outlook.testFeedbackEl, calendarUiElements); });
  addEvt(calendarUiElements.outlook.listarBtn, 'click', () => listarEventosOutlook(null, calendarUiElements));

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('calendar_status')) {
    const status = urlParams.get('calendar_status');
    const provider = urlParams.get('provider');
    const message = urlParams.get('message') || '';
    showFeedback(calendarUiElements.mainFeedback, status === 'success' ? `Conexión con ${provider} exitosa.` : `Falló la autorización con ${provider}: ${message}`, status !== 'success', 5000);
    window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
  }
  await verificarEstadoCalendarios(calendarUiElements);

  // --- Zapier/Alegra: lógica de carga y guardado del webhook ---
  const alegraWebhookInput = container.querySelector("#alegra-webhook-url");
  const alegraSaveBtn = container.querySelector("#guardar-alegra-webhook");
  const alegraFeedback = container.querySelector("#alegra-feedback");
  let { data: alegraData } = await supabaseInstance
    .from("hoteles")
    .select("alegra_webhook_url")
    .eq("id", currentHotelId)
    .single();
  if (alegraData?.alegra_webhook_url) alegraWebhookInput.value = alegraData.alegra_webhook_url;

  alegraSaveBtn.onclick = async () => {
    const url = alegraWebhookInput.value.trim();
    alegraFeedback.textContent = "";
    alegraFeedback.className = "my-2 text-sm";
    if (!url.startsWith("https://hooks.zapier.com/")) {
      alegraFeedback.textContent = "URL inválida de Zapier. Debe empezar por https://hooks.zapier.com/";
      alegraFeedback.classList.add("text-red-600");
      return;
    }
    alegraFeedback.textContent = "Guardando...";
    alegraFeedback.classList.add("text-gray-600");
    const { error } = await supabaseInstance
      .from("hoteles")
      .update({ alegra_webhook_url: url })
      .eq("id", currentHotelId);
    if (error) {
      alegraFeedback.textContent = "Error al guardar. Intenta de nuevo.";
      alegraFeedback.classList.add("text-red-600");
    } else {
      alegraFeedback.textContent = "¡Webhook guardado! Ahora puedes facturar automáticamente con tu Zap.";
      alegraFeedback.classList.add("text-green-600");
    }
  };
}



export function unmount() {
  moduleListeners.forEach(({ element, type, handler }) => {
    element?.removeEventListener(type, handler);
  });
  moduleListeners = [];
  currentHotelId = null;
  supabaseInstance = null;
  userObject = null;
  console.log('Integraciones module unmounted and listeners cleaned up.');
}
