import { escapeHtml } from '../../security.js';
import {
  ACCOUNTING_INTEGRATIONS,
  OTA_INTEGRATIONS,
  renderCatalogCards,
  renderRequestList
} from './integrationCatalog.js';

let moduleListeners = [];
let currentHotelId = null;
let supabaseInstance = null;
let userObject = null;
let currentContainer = null;

function addEvt(element, type, handler) {
  if (!element) return;
  element.addEventListener(type, handler);
  moduleListeners.push({ element, type, handler });
}

function cleanupListeners() {
  moduleListeners.forEach(({ element, type, handler }) => {
    element?.removeEventListener(type, handler);
  });
  moduleListeners = [];
}

function showFeedback(feedbackEl, message, isError = false, duration = 4000) {
  if (!feedbackEl) return;
  feedbackEl.textContent = message;
  feedbackEl.className = `feedback-message mt-2 rounded-xl border px-4 py-3 text-sm ${
    isError
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }`;
  feedbackEl.style.display = 'block';
  if (feedbackEl.feedbackTimeout) {
    window.clearTimeout(feedbackEl.feedbackTimeout);
  }
  if (duration > 0) {
    feedbackEl.feedbackTimeout = window.setTimeout(() => clearFeedback(feedbackEl), duration);
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
    Array.from(formEl.elements).forEach((element) => {
      if (element.type !== 'submit' && element.type !== 'button') {
        element.disabled = isLoading;
      }
    });
  }
}

async function loadAlegraConfig(formEl, feedbackEl) {
  if (!formEl || !currentHotelId || !supabaseInstance) return;

  try {
    const { data, error } = await supabaseInstance
      .from('integraciones_hotel')
      .select('facturador_nombre, facturador_usuario, facturador_api_key')
      .eq('hotel_id', currentHotelId)
      .maybeSingle();

    if (error) throw error;

    const userInput = formEl.elements.alegra_usuario;
    const tokenInput = formEl.elements.alegra_token;
    userInput.value = data?.facturador_usuario || '';

    if (data?.facturador_api_key) {
      tokenInput.value = '********';
      tokenInput.dataset.realValue = data.facturador_api_key;
    } else {
      tokenInput.value = '';
      delete tokenInput.dataset.realValue;
    }

    if (data?.facturador_nombre) {
      showFeedback(feedbackEl, `Integracion fiscal activa con ${data.facturador_nombre}.`, false);
    }
  } catch (err) {
    console.error('Error cargando configuracion de Alegra:', err);
  }
}

async function requestIntegration(provider, category, feedbackEl) {
  if (!provider || !category || !supabaseInstance) return;

  const notes = window.prompt(
    `Cuentanos por que te interesa ${provider}. Este detalle ayuda a priorizar la integracion:`,
    ''
  ) || '';

  try {
    const { error } = await supabaseInstance.rpc('solicitar_integracion_hotel', {
      p_categoria: category,
      p_proveedor: provider,
      p_notas: notes,
      p_source: 'modulo_integraciones'
    });

    if (error) throw error;

    showFeedback(feedbackEl, `Solicitud registrada para ${provider}.`, false);
    await loadIntegrationRequests();
  } catch (err) {
    console.error('Error registrando solicitud de integracion:', err);
    showFeedback(feedbackEl, `No se pudo registrar la solicitud: ${err.message}`, true, 0);
  }
}

async function loadIntegrationRequests() {
  const listEl = currentContainer?.querySelector('#integration-request-list');
  if (!listEl || !supabaseInstance || !currentHotelId) return;

  listEl.innerHTML = `
    <div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
      Cargando solicitudes...
    </div>
  `;

  try {
    const { data, error } = await supabaseInstance
      .from('integraciones_interes')
      .select('id, created_at, categoria, proveedor, estado, notas')
      .eq('hotel_id', currentHotelId)
      .order('created_at', { ascending: false })
      .limit(8);

    if (error) throw error;
    listEl.innerHTML = renderRequestList(data || []);
  } catch (err) {
    console.error('Error cargando solicitudes de integracion:', err);
    listEl.innerHTML = `
      <div class="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        No se pudieron cargar las solicitudes: ${escapeHtml(err.message || 'Error desconocido')}
      </div>
    `;
  }
}

async function listarEventosGoogle(uiElements) {
  const listEl = uiElements.google.listaEventosEl;
  listEl.innerHTML = '<li class="text-sm text-gray-400">Cargando eventos...</li>';

  try {
    const { data, error } = await supabaseInstance.functions.invoke('calendar-list-events', {
      body: { hotelId: currentHotelId, provider: 'google' }
    });

    if (error || !Array.isArray(data?.items)) {
      listEl.innerHTML = '<li class="text-sm text-red-600">No se pudieron obtener los eventos.</li>';
      return;
    }

    if (!data.items.length) {
      listEl.innerHTML = '<li class="text-sm text-gray-500">No hay eventos proximos.</li>';
      return;
    }

    listEl.innerHTML = data.items.map((evento) => `
      <li class="flex items-center justify-between gap-3 border-b border-gray-100 py-2">
        <span class="min-w-0 flex-1">
          <strong class="block truncate">${escapeHtml(evento.summary || 'Sin titulo')}</strong>
          <small class="text-gray-500">${escapeHtml(evento.start?.dateTime?.replace('T', ' ').slice(0, 16) || evento.start?.date || '')}</small>
        </span>
        <button type="button" class="delete-calendar-event rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200" data-provider="google" data-event-id="${escapeHtml(evento.id)}">
          Eliminar
        </button>
      </li>
    `).join('');
  } catch (err) {
    console.error('Error listando eventos de Google:', err);
    listEl.innerHTML = '<li class="text-sm text-red-600">Error al listar eventos.</li>';
  }
}

async function listarEventosOutlook(uiElements) {
  const listEl = uiElements.outlook.listaEventosEl;
  listEl.innerHTML = '<li class="text-sm text-gray-400">Cargando eventos...</li>';

  try {
    const { data, error } = await supabaseInstance.functions.invoke('outlook-calendar-events', {
      body: { hotelId: currentHotelId, action: 'list' }
    });

    if (error || !Array.isArray(data?.items)) {
      listEl.innerHTML = '<li class="text-sm text-red-600">No se pudieron obtener los eventos de Outlook.</li>';
      return;
    }

    if (!data.items.length) {
      listEl.innerHTML = '<li class="text-sm text-gray-500">No hay eventos proximos en Outlook.</li>';
      return;
    }

    listEl.innerHTML = data.items.map((evento) => `
      <li class="flex items-center justify-between gap-3 border-b border-gray-100 py-2">
        <span class="min-w-0 flex-1">
          <strong class="block truncate">${escapeHtml(evento.summary || 'Sin titulo')}</strong>
          <small class="text-gray-500">${escapeHtml(evento.start?.dateTime?.replace('T', ' ').slice(0, 16) || evento.start?.date || '')}</small>
        </span>
        <button type="button" class="delete-calendar-event rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200" data-provider="outlook" data-event-id="${escapeHtml(evento.id)}">
          Eliminar
        </button>
      </li>
    `).join('');
  } catch (err) {
    console.error('Error listando eventos de Outlook:', err);
    listEl.innerHTML = '<li class="text-sm text-red-600">Error al listar eventos.</li>';
  }
}

async function deleteCalendarEvent(provider, eventId, uiElements) {
  if (!provider || !eventId) return;
  if (!window.confirm('Estas seguro de que deseas eliminar este evento?')) return;

  const invokeConfig = provider === 'google'
    ? { fn: 'calendar-delete-event', body: { hotelId: currentHotelId, provider, eventId } }
    : { fn: 'outlook-calendar-events', body: { hotelId: currentHotelId, action: 'delete', eventId } };

  const { error } = await supabaseInstance.functions.invoke(invokeConfig.fn, {
    body: invokeConfig.body
  });

  if (error) {
    window.alert(`No se pudo eliminar el evento: ${error.message}`);
    return;
  }

  if (provider === 'google') {
    await listarEventosGoogle(uiElements);
  } else {
    await listarEventosOutlook(uiElements);
  }
}

async function verificarEstadoCalendarios(uiElements) {
  showFeedback(uiElements.mainFeedback, 'Verificando estado de los calendarios...', false, 0);

  try {
    const { data, error } = await supabaseInstance.functions.invoke('calendar-get-status', {
      body: { hotelId: currentHotelId }
    });
    if (error) throw error;

    const googleConnected = Boolean(data?.google?.connected);
    uiElements.google.statusEl.textContent = googleConnected
      ? `Conectado como: ${data.google.user_email}`
      : 'No conectado.';
    uiElements.google.connectBtn.style.display = googleConnected ? 'none' : 'inline-block';
    uiElements.google.disconnectBtn.style.display = googleConnected ? 'inline-block' : 'none';
    uiElements.google.testForm.style.display = googleConnected ? 'block' : 'none';
    if (googleConnected) {
      await listarEventosGoogle(uiElements);
    } else {
      uiElements.google.listaEventosEl.innerHTML = '';
    }

    const outlookConnected = Boolean(data?.outlook?.connected);
    uiElements.outlook.statusEl.textContent = outlookConnected
      ? `Conectado como: ${data.outlook.user_email}`
      : 'No conectado.';
    uiElements.outlook.connectBtn.style.display = outlookConnected ? 'none' : 'inline-block';
    uiElements.outlook.disconnectBtn.style.display = outlookConnected ? 'inline-block' : 'none';
    uiElements.outlook.testForm.style.display = outlookConnected ? 'block' : 'none';
    if (outlookConnected) {
      await listarEventosOutlook(uiElements);
    } else {
      uiElements.outlook.listaEventosEl.innerHTML = '';
    }

    clearFeedback(uiElements.mainFeedback);
  } catch (err) {
    console.error('Error verificando estado de calendarios:', err);
    showFeedback(uiElements.mainFeedback, `No se pudo verificar el estado: ${err.message}`, true, 0);
  }
}

async function iniciarConexionCalendario(provider, feedbackEl) {
  showFeedback(feedbackEl, `Redirigiendo a ${provider === 'google' ? 'Google' : 'Outlook'}...`, false, 0);

  try {
    const { data, error } = await supabaseInstance.functions.invoke('calendar-get-auth-url', {
      body: { hotelId: currentHotelId, provider }
    });
    if (error) throw error;
    if (!data?.authUrl) throw new Error('No se recibio la URL de autorizacion.');
    window.location.href = data.authUrl;
  } catch (err) {
    console.error(`Error al iniciar conexion con ${provider}:`, err);
    showFeedback(feedbackEl, `No se pudo iniciar la conexion: ${err.message}`, true, 0);
  }
}

async function desconectarCalendario(provider, buttonEl, feedbackEl, uiElements) {
  if (!window.confirm(`Estas seguro de que deseas desconectar ${provider === 'google' ? 'Google' : 'Outlook'}?`)) {
    return;
  }

  setLoading(null, true, buttonEl, 'Desconectando...');
  try {
    const { data, error } = await supabaseInstance.functions.invoke('calendar-disconnect', {
      body: { hotelId: currentHotelId, provider }
    });
    if (error) throw error;
    showFeedback(feedbackEl, data?.message || 'Desconectado correctamente.', false);
    await verificarEstadoCalendarios(uiElements);
  } catch (err) {
    console.error(`Error al desconectar ${provider}:`, err);
    showFeedback(feedbackEl, `No se pudo desconectar: ${err.message}`, true, 0);
  } finally {
    setLoading(null, false, buttonEl, 'Desconectar');
  }
}

async function crearEventoDePrueba(provider, formEl, buttonEl, feedbackEl, uiElements) {
  setLoading(formEl, true, buttonEl, 'Creando...');
  clearFeedback(feedbackEl);

  try {
    const now = new Date();
    const start = new Date(now.getTime() + 60 * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const eventDetails = {
      summary: formEl.elements.test_event_summary.value.trim() || 'Reserva de prueba Gestion de Hotel',
      description: 'Evento de prueba generado desde Integraciones.',
      start: start.toISOString(),
      end: end.toISOString()
    };

    const { error } = await supabaseInstance.functions.invoke('calendar-create-event', {
      body: { hotelId: currentHotelId, provider, eventDetails }
    });
    if (error) throw error;

    showFeedback(feedbackEl, 'Evento de prueba creado correctamente.', false);
    formEl.reset();

    if (provider === 'google') {
      await listarEventosGoogle(uiElements);
    } else {
      await listarEventosOutlook(uiElements);
    }
  } catch (err) {
    console.error(`Error creando evento en ${provider}:`, err);
    showFeedback(feedbackEl, `No se pudo crear el evento: ${err.message}`, true, 0);
  } finally {
    setLoading(formEl, false, buttonEl, 'Crear evento');
  }
}

async function guardarConfiguracionAlegra(formEl, feedbackEl, buttonEl) {
  setLoading(formEl, true, buttonEl, 'Guardando...');
  const alegraUsuario = formEl.elements.alegra_usuario.value.trim();
  const tokenInput = formEl.elements.alegra_token;
  const alegraToken = tokenInput.value.trim();
  let apiKey = null;

  if (alegraToken && alegraToken !== '********') {
    apiKey = alegraToken;
  } else if (tokenInput.dataset.realValue) {
    apiKey = tokenInput.dataset.realValue;
  }

  try {
    const { error } = await supabaseInstance.functions.invoke('alegra-save-config', {
      body: {
        hotelId: currentHotelId,
        usuario: alegraUsuario,
        apiKey
      }
    });
    if (error) throw error;

    if (apiKey) {
      tokenInput.value = '********';
      tokenInput.dataset.realValue = apiKey;
    } else {
      tokenInput.value = '';
      delete tokenInput.dataset.realValue;
    }
    showFeedback(feedbackEl, 'Configuracion de Alegra guardada correctamente.', false);
  } catch (err) {
    console.error('Error guardando configuracion de Alegra:', err);
    showFeedback(feedbackEl, `No se pudo guardar: ${err.message}`, true, 0);
  } finally {
    setLoading(formEl, false, buttonEl, 'Guardar configuracion');
  }
}

async function probarConexionAlegra(feedbackEl, buttonEl) {
  setLoading(null, true, buttonEl, 'Probando...');
  try {
    const { data, error } = await supabaseInstance.functions.invoke('alegra-test-connection', {
      body: { hotelId: currentHotelId }
    });
    if (error) throw error;

    if (data?.ok) {
      showFeedback(feedbackEl, data.message || 'Conexion con Alegra exitosa.', false);
    } else {
      showFeedback(feedbackEl, data?.message || 'Alegra no respondio como se esperaba.', true, 0);
    }
  } catch (err) {
    console.error('Error probando conexion con Alegra:', err);
    showFeedback(feedbackEl, `No se pudo probar la conexion: ${err.message}`, true, 0);
  } finally {
    setLoading(null, false, buttonEl, 'Probar conexion');
  }
}

async function generarFacturaPruebaAlegra(feedbackEl, buttonEl) {
  setLoading(null, true, buttonEl, 'Generando...');
  try {
    const { data, error } = await supabaseInstance.functions.invoke('alegra-crear-factura', {
      body: {
        hotelId: currentHotelId,
        facturaData: {
          cliente: {
            nombre: 'Cliente de prueba',
            email: 'cliente@prueba.com',
            identificacion: '123456789'
          },
          items: [{ nombre: 'Hospedaje de prueba', precio: 10000, cantidad: 1 }]
        }
      }
    });
    if (error) throw error;

    if (data?.ok) {
      showFeedback(feedbackEl, `Factura de prueba enviada correctamente${data.facturaId ? ` (ID ${data.facturaId})` : ''}.`, false);
    } else {
      showFeedback(feedbackEl, data?.message || 'No se pudo generar la factura de prueba.', true, 0);
    }
  } catch (err) {
    console.error('Error generando factura de prueba:', err);
    showFeedback(feedbackEl, `No se pudo generar la factura: ${err.message}`, true, 0);
  } finally {
    setLoading(null, false, buttonEl, 'Factura de prueba');
  }
}

function renderModuleLayout() {
  currentContainer.innerHTML = `
    <div class="space-y-6 p-4 md:p-8">
      <section class="rounded-[28px] bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-6 text-white shadow-2xl">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p class="text-xs uppercase tracking-[0.35em] text-blue-200">Integraciones</p>
            <h1 class="mt-2 text-3xl font-black">Centro de integraciones y crecimiento</h1>
            <p class="mt-2 max-w-3xl text-sm text-blue-100">Gestiona calendarios, habilita facturacion con Alegra y deja trazabilidad real de las integraciones contables, fiscales y OTA que tu hotel necesita.</p>
          </div>
          <div class="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-blue-50 backdrop-blur">
            Lo activo, lo solicitado y lo que esta en evaluacion queda concentrado aqui.
          </div>
        </div>
        <div id="calendar-main-feedback" role="alert" aria-live="assertive" style="display:none;" class="mt-4"></div>
      </section>

      <section class="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Calendarios conectados</p>
          <h2 class="mt-1 text-xl font-bold text-slate-900">Google y Outlook</h2>
          <p class="mt-2 text-sm text-slate-600">Sincroniza reservas, evita sobreventa y valida la conexion con eventos de prueba.</p>
          <div class="mt-5 space-y-4">
            <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 class="text-lg font-bold text-slate-900">Google Calendar</h3>
                  <p id="google-status-text" class="mt-1 text-sm text-slate-500">Verificando estado...</p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button type="button" id="btn-connect-google" class="button button-primary py-2 px-4 rounded-md">Conectar</button>
                  <button type="button" id="btn-disconnect-google" class="button button-danger py-2 px-4 rounded-md" style="display:none;">Desconectar</button>
                  <button type="button" id="btn-listar-google" class="button button-accent py-2 px-4 rounded-md">Ver eventos</button>
                </div>
              </div>
              <form id="google-test-form" style="display:none;" class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                <p class="mb-2 text-sm font-medium">Probar la conexion</p>
                <div class="flex items-center gap-2">
                  <input type="text" name="test_event_summary" placeholder="Titulo del evento de prueba" class="form-control text-sm flex-grow">
                  <button type="submit" class="button button-secondary py-1 px-3 text-sm">Crear evento</button>
                </div>
                <div id="google-test-feedback" class="mt-2 text-sm"></div>
              </form>
              <ul id="google-lista-eventos" class="mt-4 text-sm space-y-1"></ul>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 class="text-lg font-bold text-slate-900">Outlook Calendar</h3>
                  <p id="outlook-status-text" class="mt-1 text-sm text-slate-500">Verificando estado...</p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button type="button" id="btn-connect-outlook" class="button button-primary py-2 px-4 rounded-md">Conectar</button>
                  <button type="button" id="btn-disconnect-outlook" class="button button-danger py-2 px-4 rounded-md" style="display:none;">Desconectar</button>
                  <button type="button" id="btn-listar-outlook" class="button button-accent py-2 px-4 rounded-md">Ver eventos</button>
                </div>
              </div>
              <form id="outlook-test-form" style="display:none;" class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                <p class="mb-2 text-sm font-medium">Probar la conexion</p>
                <div class="flex items-center gap-2">
                  <input type="text" name="test_event_summary" placeholder="Titulo del evento de prueba" class="form-control text-sm flex-grow">
                  <button type="submit" class="button button-secondary py-1 px-3 text-sm">Crear evento</button>
                </div>
                <div id="outlook-test-feedback" class="mt-2 text-sm"></div>
              </form>
              <ul id="outlook-lista-eventos" class="mt-4 text-sm space-y-1"></ul>
            </div>
          </div>
        </article>

        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Fiscal / contable</p>
          <h2 class="mt-1 text-xl font-bold text-slate-900">Alegra y roadmap fiscal</h2>
          <p class="mt-2 text-sm text-slate-600">Mantiene la configuracion real de Alegra y deja priorizadas otras conexiones contables o tributarias.</p>
          <form id="alegra-config-form" class="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <label class="mb-1 block text-sm font-semibold text-slate-700">Usuario de Alegra</label>
              <input type="text" name="alegra_usuario" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-300" placeholder="correo o usuario">
            </div>
            <div>
              <label class="mb-1 block text-sm font-semibold text-slate-700">Token / API key</label>
              <input type="password" name="alegra_token" class="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-300" placeholder="Token seguro de Alegra">
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="submit" id="alegra-save-btn" class="button button-primary py-2 px-4 rounded-md">Guardar configuracion</button>
              <button type="button" id="alegra-test-btn" class="button button-secondary py-2 px-4 rounded-md">Probar conexion</button>
              <button type="button" id="alegra-invoice-btn" class="button button-accent py-2 px-4 rounded-md">Factura de prueba</button>
            </div>
            <div id="alegra-feedback" style="display:none;" class="mt-2"></div>
          </form>
        </article>
      </section>

      <section class="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Catalogo fiscal</p>
              <h2 class="mt-1 text-xl font-bold text-slate-900">Integraciones contables y fiscales</h2>
            </div>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">Prioriza por hotel</span>
          </div>
          <div class="mt-4 grid gap-4 md:grid-cols-2">
            ${renderCatalogCards(ACCOUNTING_INTEGRATIONS)}
          </div>
        </article>

        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-xs uppercase tracking-[0.25em] text-slate-400">OTAs / channel manager</p>
              <h2 class="mt-1 text-xl font-bold text-slate-900">Linea futura evaluada</h2>
            </div>
            <span class="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">Evaluacion viva</span>
          </div>
          <p class="mt-2 text-sm text-slate-600">Aqui dejamos priorizados los conectores que mas pueden elevar ocupacion, reducir carga manual y aumentar el valor comercial del SaaS.</p>
          <div class="mt-4 grid gap-4 md:grid-cols-2">
            ${renderCatalogCards(OTA_INTEGRATIONS)}
          </div>
        </article>
      </section>

      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Historial del hotel</p>
            <h2 class="mt-1 text-xl font-bold text-slate-900">Solicitudes registradas</h2>
            <p class="mt-2 text-sm text-slate-600">Todo lo que tu hotel pida desde integraciones queda visible aqui para seguimiento comercial y de producto.</p>
          </div>
          <div id="integration-request-feedback" style="display:none;" class="w-full md:max-w-md"></div>
        </div>
        <div id="integration-request-list" class="mt-4"></div>
      </section>
    </div>
  `;
}

export async function mount(container, sbInstance, user) {
  console.log('[Integraciones.js] Montando el modulo de integraciones...');
  unmount();

  supabaseInstance = sbInstance;
  userObject = user;
  currentContainer = container;
  currentHotelId = userObject?.user_metadata?.hotel_id || null;

  if (!currentHotelId && userObject?.id) {
    try {
      const { data: perfil } = await supabaseInstance.from('usuarios').select('hotel_id').eq('id', userObject.id).single();
      currentHotelId = perfil?.hotel_id;
    } catch (err) {
      console.error('Error fetching hotel_id:', err);
    }
  }

  if (!currentHotelId) {
    container.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-red-700 shadow-sm">No se pudo identificar el hotel actual para gestionar integraciones.</div>';
    return;
  }

  renderModuleLayout();

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
    }
  };

  addEvt(calendarUiElements.google.connectBtn, 'click', () => iniciarConexionCalendario('google', calendarUiElements.google.statusEl));
  addEvt(calendarUiElements.google.disconnectBtn, 'click', (e) => desconectarCalendario('google', e.target, calendarUiElements.google.statusEl, calendarUiElements));
  addEvt(calendarUiElements.google.testForm, 'submit', (e) => { e.preventDefault(); crearEventoDePrueba('google', e.target, e.target.querySelector('button'), calendarUiElements.google.testFeedbackEl, calendarUiElements); });
  addEvt(calendarUiElements.google.listarBtn, 'click', () => listarEventosGoogle(calendarUiElements));

  addEvt(calendarUiElements.outlook.connectBtn, 'click', () => iniciarConexionCalendario('outlook', calendarUiElements.outlook.statusEl));
  addEvt(calendarUiElements.outlook.disconnectBtn, 'click', (e) => desconectarCalendario('outlook', e.target, calendarUiElements.outlook.statusEl, calendarUiElements));
  addEvt(calendarUiElements.outlook.testForm, 'submit', (e) => { e.preventDefault(); crearEventoDePrueba('outlook', e.target, e.target.querySelector('button'), calendarUiElements.outlook.testFeedbackEl, calendarUiElements); });
  addEvt(calendarUiElements.outlook.listarBtn, 'click', () => listarEventosOutlook(calendarUiElements));

  addEvt(calendarUiElements.google.listaEventosEl, 'click', (event) => {
    const button = event.target.closest('.delete-calendar-event');
    if (button) deleteCalendarEvent(button.dataset.provider, button.dataset.eventId, calendarUiElements);
  });
  addEvt(calendarUiElements.outlook.listaEventosEl, 'click', (event) => {
    const button = event.target.closest('.delete-calendar-event');
    if (button) deleteCalendarEvent(button.dataset.provider, button.dataset.eventId, calendarUiElements);
  });

  const alegraForm = container.querySelector('#alegra-config-form');
  const alegraFeedback = container.querySelector('#alegra-feedback');
  const alegraSaveBtn = container.querySelector('#alegra-save-btn');
  const alegraTestBtn = container.querySelector('#alegra-test-btn');
  const alegraInvoiceBtn = container.querySelector('#alegra-invoice-btn');
  const requestFeedback = container.querySelector('#integration-request-feedback');

  addEvt(alegraForm, 'submit', (event) => {
    event.preventDefault();
    guardarConfiguracionAlegra(alegraForm, alegraFeedback, alegraSaveBtn);
  });
  addEvt(alegraTestBtn, 'click', () => probarConexionAlegra(alegraFeedback, alegraTestBtn));
  addEvt(alegraInvoiceBtn, 'click', () => generarFacturaPruebaAlegra(alegraFeedback, alegraInvoiceBtn));

  container.querySelectorAll('.integration-request-btn').forEach((button) => {
    addEvt(button, 'click', () => requestIntegration(button.dataset.provider, button.dataset.category, requestFeedback));
  });

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('calendar_status')) {
    const status = urlParams.get('calendar_status');
    const provider = urlParams.get('provider');
    const message = urlParams.get('message') || '';
    showFeedback(calendarUiElements.mainFeedback, status === 'success' ? `Conexion con ${provider} exitosa.` : `Fallo la autorizacion con ${provider}: ${message}`, status !== 'success', 5000);
    window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
  }

  await Promise.all([
    verificarEstadoCalendarios(calendarUiElements),
    loadAlegraConfig(alegraForm, alegraFeedback),
    loadIntegrationRequests()
  ]);
}

export function unmount() {
  cleanupListeners();
  currentHotelId = null;
  supabaseInstance = null;
  userObject = null;
  currentContainer = null;
}
