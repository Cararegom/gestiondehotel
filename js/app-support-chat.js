import { supabase } from './supabaseClient.js';

const SUPABASE_FUNCTIONS_BASE = 'https://iikpqpdoslyduecibaij.supabase.co/functions/v1';
const CHATKIT_SESSION_ENDPOINT = `${SUPABASE_FUNCTIONS_BASE}/chatkit-session`;
const CHATKIT_SCRIPT_SRC = 'https://cdn.platform.openai.com/deployments/chatkit/chatkit.js';
const CHATKIT_DOMAIN_KEY = 'domain_pk_69c15fef533c819795015e543f83ff950af2fea964c34d54';

const INCIDENT_REPORT_FIELDS = [
  { key: 'modulo', labels: ['Modulo', 'Módulo'] },
  { key: 'pantallaFlujo', labels: ['Pantalla o flujo'] },
  { key: 'accionRealizada', labels: ['Accion realizada', 'Acción realizada'] },
  { key: 'resultadoEsperado', labels: ['Resultado esperado'] },
  { key: 'resultadoReal', labels: ['Resultado real'] },
  { key: 'mensajeError', labels: ['Mensaje de error'] },
  { key: 'dispositivoNavegador', labels: ['Dispositivo o navegador', 'Dispositivo', 'Navegador'] },
  { key: 'momentoAproximado', labels: ['Momento aproximado'] },
  { key: 'impactoOperativo', labels: ['Impacto operativo'] },
  { key: 'prioridadSugerida', labels: ['Prioridad sugerida'] }
];

const INCIDENT_REPORT_LABEL_PATTERN = INCIDENT_REPORT_FIELDS
  .flatMap(({ labels }) => labels)
  .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

const supportChatState = {
  mounted: false,
  initialized: false,
  initializing: false,
  initPromise: null,
  scriptPromise: null,
  observer: null,
  currentUserKey: null,
  currentUser: null,
  currentHotel: null,
  cachedClientSecret: null,
  clientSecretPromise: null,
  elements: null,
  reportScanTimer: null,
  reportStatusTimer: null,
  observedRoots: new Set(),
  savedIncidentFingerprints: new Set(),
  pendingIncidentFingerprints: new Set()
};

function getSupportChatUserKey(user, hotel) {
  const hotelId = hotel?.id || user?.user_metadata?.hotel_id || user?.app_metadata?.hotel_id || 'hotel';
  return `support_${hotelId}_${user?.id || 'guest'}`;
}

function ensureChatKitScript() {
  if (window.customElements?.get('openai-chatkit')) {
    return Promise.resolve();
  }

  if (supportChatState.scriptPromise) {
    return supportChatState.scriptPromise;
  }

  supportChatState.scriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${CHATKIT_SCRIPT_SRC}"]`);
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('No se pudo cargar ChatKit.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = CHATKIT_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar ChatKit.'));
    document.head.appendChild(script);
  });

  return supportChatState.scriptPromise;
}

async function waitForChatKitElement(timeoutMs = 15000) {
  await ensureChatKitScript();

  if (window.customElements?.get('openai-chatkit')) return;

  await Promise.race([
    window.customElements.whenDefined('openai-chatkit'),
    new Promise((_, reject) =>
      window.setTimeout(() => reject(new Error('ChatKit no estuvo listo a tiempo.')), timeoutMs)
    )
  ]);
}

function buildSupportChatShell() {
  const existingRoot = document.getElementById('internal-support-chat-root');
  if (existingRoot) {
    return {
      root: existingRoot,
      launcher: existingRoot.querySelector('#internal-support-chat-launcher'),
      panel: existingRoot.querySelector('#internal-support-chat-panel'),
      closeButton: existingRoot.querySelector('#internal-support-chat-close'),
      status: existingRoot.querySelector('#internal-support-chat-status'),
      fallback: existingRoot.querySelector('#internal-support-chat-fallback'),
      chatElement: existingRoot.querySelector('#internal-support-chat')
    };
  }

  const root = document.createElement('div');
  root.id = 'internal-support-chat-root';
  root.innerHTML = `
    <button id="internal-support-chat-launcher" class="internal-support-chat-launcher" type="button" aria-expanded="false" aria-controls="internal-support-chat-panel">
      <span class="internal-support-chat-launcher__badge">Soporte tecnico</span>
      <span class="internal-support-chat-launcher__copy">
        <strong>¿Necesitas ayuda?</strong>
        <small>Habla con soporte</small>
      </span>
      <span class="internal-support-chat-launcher__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 10h8" />
          <path d="M8 14h5" />
          <path d="M6.5 5.5h11A2.5 2.5 0 0 1 20 8v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.1c-.66.49-1.6.02-1.6-.8v-2.3A2.5 2.5 0 0 1 3 15V8a2.5 2.5 0 0 1 2.5-2.5Z" />
        </svg>
      </span>
    </button>

    <section id="internal-support-chat-panel" class="internal-support-chat-panel" aria-label="Habla con soporte" hidden>
      <header class="internal-support-chat-panel__header">
        <div class="internal-support-chat-panel__avatar">V</div>
        <div class="internal-support-chat-panel__title">
          <strong>Valeria</strong>
          <span>Soporte operativo</span>
        </div>
        <button id="internal-support-chat-close" type="button" class="internal-support-chat-panel__close" aria-label="Cerrar chat">×</button>
      </header>
      <div id="internal-support-chat-status" class="internal-support-chat-status">Conectando con soporte...</div>
      <div id="internal-support-chat-fallback" class="internal-support-chat-fallback" hidden>
        <span>Si el chat no carga, escribe a <a href="mailto:support@gestiondehotel.com">support@gestiondehotel.com</a>.</span>
      </div>
      <openai-chatkit id="internal-support-chat"></openai-chatkit>
    </section>
  `;

  document.body.appendChild(root);

  return {
    root,
    launcher: root.querySelector('#internal-support-chat-launcher'),
    panel: root.querySelector('#internal-support-chat-panel'),
    closeButton: root.querySelector('#internal-support-chat-close'),
    status: root.querySelector('#internal-support-chat-status'),
    fallback: root.querySelector('#internal-support-chat-fallback'),
    chatElement: root.querySelector('#internal-support-chat')
  };
}

function normalizeSupportText(value) {
  return String(value || '')
    .replace(/\u200B/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractIncidentField(text, labels) {
  const labelPattern = labels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const fieldPattern = new RegExp(
    `(?:^|\\n|[\\-•*]\\s*)(${labelPattern}):\\s*([\\s\\S]*?)(?=\\n(?:[\\-•*]\\s*)?(?:${INCIDENT_REPORT_LABEL_PATTERN}):|$)`,
    'i'
  );
  const match = text.match(fieldPattern);
  return normalizeSupportText(match?.[2] || '');
}

function parseIncidentReport(text) {
  const normalizedText = normalizeSupportText(text);
  const report = {
    rawText: normalizedText
  };

  for (const field of INCIDENT_REPORT_FIELDS) {
    report[field.key] = extractIncidentField(normalizedText, field.labels);
  }

  report.fieldCount = INCIDENT_REPORT_FIELDS.reduce(
    (count, field) => count + (report[field.key] ? 1 : 0),
    0
  );

  return report;
}

function looksLikeIncidentReportText(text) {
  const normalizedText = normalizeSupportText(text);
  if (!normalizedText || normalizedText.length < 140 || normalizedText.length > 2200) {
    return false;
  }

  const report = parseIncidentReport(normalizedText);
  return Boolean(
    report.fieldCount >= 5 &&
    report.modulo &&
    report.accionRealizada &&
    report.resultadoReal &&
    (report.impactoOperativo || report.prioridadSugerida)
  );
}

function collectIncidentReportCandidates(root, results = new Set()) {
  if (!root) return results;

  const nodes = [];
  if (root.nodeType === Node.ELEMENT_NODE || root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    nodes.push(root);
    if (typeof root.querySelectorAll === 'function') {
      root.querySelectorAll('*').forEach((element) => nodes.push(element));
    }
  }

  for (const node of nodes) {
    if (node !== root && node.shadowRoot) {
      collectIncidentReportCandidates(node.shadowRoot, results);
    }

    const text = normalizeSupportText(node.textContent);
    if (looksLikeIncidentReportText(text)) {
      results.add(text);
    }
  }

  return results;
}

function buildIncidentFingerprint(report) {
  return [
    report.modulo,
    report.pantallaFlujo,
    report.accionRealizada,
    report.resultadoReal,
    report.mensajeError,
    report.dispositivoNavegador,
    report.prioridadSugerida
  ]
    .map((value) => normalizeSupportText(value).toLowerCase())
    .join('|');
}

function showSupportChatStatusMessage(message, state = 'info', autoHideMs = 4200) {
  const status = supportChatState.elements?.status;
  if (!status) return;

  window.clearTimeout(supportChatState.reportStatusTimer);
  status.hidden = false;
  status.dataset.state = state;
  status.textContent = message;

  if (autoHideMs > 0) {
    supportChatState.reportStatusTimer = window.setTimeout(() => {
      if (status.dataset.state === state) {
        status.hidden = true;
      }
    }, autoHideMs);
  }
}

async function saveIncidentReport(report) {
  const hotelId =
    supportChatState.currentHotel?.id ||
    supportChatState.currentUser?.user_metadata?.hotel_id ||
    supportChatState.currentUser?.app_metadata?.hotel_id;
  const userId = supportChatState.currentUser?.id || null;
  const fingerprint = buildIncidentFingerprint(report);

  if (!hotelId || !fingerprint) return;
  if (supportChatState.savedIncidentFingerprints.has(fingerprint) || supportChatState.pendingIncidentFingerprints.has(fingerprint)) {
    return;
  }

  supportChatState.pendingIncidentFingerprints.add(fingerprint);

  try {
    const detalles = {
      origen: 'chat_soporte_valeria',
      capturado_automaticamente: true,
      usuario_chat: userId,
      hotel_id: hotelId,
      modulo_afectado: report.modulo || null,
      pantalla_o_flujo: report.pantallaFlujo || null,
      accion_realizada: report.accionRealizada || null,
      resultado_esperado: report.resultadoEsperado || null,
      resultado_real: report.resultadoReal || null,
      mensaje_error: report.mensajeError || null,
      dispositivo_o_navegador: report.dispositivoNavegador || null,
      momento_aproximado: report.momentoAproximado || null,
      impacto_operativo: report.impactoOperativo || null,
      prioridad_sugerida: report.prioridadSugerida || null,
      reporte_texto: report.rawText
    };

    const { error } = await supabase
      .from('bitacora')
      .insert([{
        hotel_id: hotelId,
        usuario_id: userId,
        modulo: 'Soporte interno',
        accion: 'REPORTE_INCIDENCIA_CHAT',
        detalles,
        creado_en: new Date().toISOString()
      }]);

    if (error) {
      throw error;
    }

    supportChatState.savedIncidentFingerprints.add(fingerprint);
    showSupportChatStatusMessage('Reporte guardado automaticamente en la bitacora de soporte.', 'success');
  } catch (error) {
    console.error('Error guardando reporte automatico de soporte:', error);
    showSupportChatStatusMessage('No se pudo guardar el reporte automaticamente. Puedes escalarlo por soporte.', 'error', 5200);
  } finally {
    supportChatState.pendingIncidentFingerprints.delete(fingerprint);
  }
}

function scheduleIncidentScan(chatElement) {
  window.clearTimeout(supportChatState.reportScanTimer);
  supportChatState.reportScanTimer = window.setTimeout(async () => {
    const candidates = [...collectIncidentReportCandidates(chatElement)].sort((a, b) => a.length - b.length);
    for (const candidateText of candidates) {
      const parsedReport = parseIncidentReport(candidateText);
      if (parsedReport.fieldCount >= 5) {
        await saveIncidentReport(parsedReport);
      }
    }
  }, 180);
}

function patchChatKitCopyInRoot(root) {
  if (!root?.querySelectorAll) return;

  const textReplacements = [
    [/Enviar mensaje a la IA/gi, 'Escribe tu mensaje a Valeria'],
    [/Enviar mensaje a IA/gi, 'Escribe tu mensaje a Valeria'],
    [/Message the AI/gi, 'Escribe tu mensaje a Valeria'],
    [/Send message to AI/gi, 'Escribe tu mensaje a Valeria'],
    [/AI/gi, 'Valeria'],
    [/IA/gi, 'Valeria']
  ];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const visitedShadowRoots = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;

    if (node.nodeType === Node.TEXT_NODE) {
      const originalText = node.textContent;
      if (!originalText) continue;

      let nextText = originalText;
      for (const [pattern, replacement] of textReplacements) {
        nextText = nextText.replace(pattern, replacement);
      }

      if (nextText !== originalText) {
        node.textContent = nextText;
      }
      continue;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const element = node;
    if (element.shadowRoot && !visitedShadowRoots.includes(element.shadowRoot)) {
      visitedShadowRoots.push(element.shadowRoot);
      patchChatKitCopyInRoot(element.shadowRoot);
    }

    const placeholder = element.getAttribute?.('placeholder');
    if (placeholder && /ia|ai/i.test(placeholder)) {
      element.setAttribute('placeholder', 'Escribe tu mensaje a Valeria');
    }
  }
}

function bindSupportObserverTargets(root) {
  if (!root || !supportChatState.observer || supportChatState.observedRoots.has(root)) return;

  supportChatState.observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['placeholder', 'aria-label', 'title']
  });
  supportChatState.observedRoots.add(root);

  if (typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('*').forEach((element) => {
    if (element.shadowRoot) {
      bindSupportObserverTargets(element.shadowRoot);
    }
  });
}

function startCustomizationObserver(chatElement) {
  if (!chatElement || supportChatState.observer) return;

  const runPatch = () => {
    bindSupportObserverTargets(chatElement);
    patchChatKitCopyInRoot(chatElement);
    scheduleIncidentScan(chatElement);
  };
  runPatch();

  supportChatState.observer = new MutationObserver(() => runPatch());
  bindSupportObserverTargets(chatElement);

  window.setTimeout(runPatch, 400);
  window.setTimeout(runPatch, 1200);
  window.setTimeout(runPatch, 2600);
}

async function fetchClientSecret(currentClientSecret = null) {
  const response = await fetch(CHATKIT_SESSION_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      visitorId: supportChatState.currentUserKey,
      currentClientSecret,
      origin: window.location.origin,
      pathname: window.location.pathname,
      source: 'internal',
      channel: 'support'
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.client_secret) {
    throw new Error(payload.error || 'No fue posible iniciar el chat de soporte.');
  }

  return payload.client_secret;
}

async function ensureClientSecret(currentClientSecret = null) {
  if (currentClientSecret) {
    supportChatState.cachedClientSecret = currentClientSecret;
    return currentClientSecret;
  }

  if (supportChatState.cachedClientSecret) {
    return supportChatState.cachedClientSecret;
  }

  if (!supportChatState.clientSecretPromise) {
    supportChatState.clientSecretPromise = fetchClientSecret().then((clientSecret) => {
      supportChatState.cachedClientSecret = clientSecret;
      return clientSecret;
    }).finally(() => {
      supportChatState.clientSecretPromise = null;
    });
  }

  return supportChatState.clientSecretPromise;
}

function openSupportChat() {
  const panel = supportChatState.elements?.panel;
  const launcher = supportChatState.elements?.launcher;
  const status = supportChatState.elements?.status;
  const fallback = supportChatState.elements?.fallback;
  if (!panel || !launcher) return;

  panel.hidden = false;
  launcher.setAttribute('aria-expanded', 'true');
  document.body.classList.add('internal-support-chat-open');

  if (!supportChatState.initialized) {
    if (fallback) fallback.hidden = true;
    if (status) {
      status.hidden = false;
      status.dataset.state = 'loading';
      status.textContent = 'Conectando con soporte...';
    }
  }
}

function closeSupportChat() {
  const panel = supportChatState.elements?.panel;
  const launcher = supportChatState.elements?.launcher;
  if (!panel || !launcher) return;

  panel.hidden = true;
  launcher.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('internal-support-chat-open');
}

async function initializeSupportWidget({ silent = false } = {}) {
  const chatElement = supportChatState.elements?.chatElement;
  const status = supportChatState.elements?.status;
  const fallback = supportChatState.elements?.fallback;

  if (!chatElement) return;
  if (supportChatState.initialized) return;
  if (supportChatState.initializing && supportChatState.initPromise) {
    if (!silent) {
      if (fallback) fallback.hidden = true;
      if (status) {
        status.hidden = false;
        status.dataset.state = 'loading';
        status.textContent = 'Conectando con soporte...';
      }
    }
    return supportChatState.initPromise;
  }

  supportChatState.initializing = true;
  if (fallback) fallback.hidden = true;
  if (status && !silent) {
    status.hidden = false;
    status.dataset.state = 'loading';
    status.textContent = 'Conectando con soporte...';
  }

  supportChatState.initPromise = (async () => {
  try {
    await waitForChatKitElement();
    const apiOptions = {
      async getClientSecret(currentClientSecret) {
        return ensureClientSecret(currentClientSecret);
      }
    };

    if (['gestiondehotel.com', 'www.gestiondehotel.com'].includes(window.location.hostname)) {
      apiOptions.domainKey = CHATKIT_DOMAIN_KEY;
    }

    await chatElement.setOptions({
      api: apiOptions,
      frameTitle: 'Soporte interno',
      header: {
        title: {
          text: 'Valeria'
        }
      },
      startScreen: {
        greeting: '¿En qué te ayudo dentro del sistema?',
        prompts: [
          {
            label: 'Crear usuario',
            prompt: 'Como creo un usuario para mi recepcionista y donde asigno el rol correcto.'
          },
          {
            label: 'Check-in reserva',
            prompt: 'Explicame paso a paso como hacer check-in de una reserva desde el sistema.'
          },
          {
            label: 'Liberar habitacion',
            prompt: 'Como libero una habitacion y que debo revisar antes del check-out.'
          },
          {
            label: 'Reportar una falla',
            prompt: 'Quiero reportar una falla en el sistema y necesito que me ayudes a estructurar el caso.'
          }
        ]
      },
      composer: {
        placeholder: 'Escribe tu mensaje a Valeria'
      }
    });

    supportChatState.initialized = true;
    bindSupportObserverTargets(chatElement);
    patchChatKitCopyInRoot(chatElement);
    scheduleIncidentScan(chatElement);
    if (status) status.hidden = true;
    startCustomizationObserver(chatElement);
  } catch (error) {
    console.error('Error inicializando el chat interno de soporte:', error);
    const panelVisible = Boolean(supportChatState.elements?.panel && !supportChatState.elements.panel.hidden);
    if (status) status.hidden = true;
    if (fallback && (!silent || panelVisible)) fallback.hidden = false;
  } finally {
    supportChatState.initializing = false;
    supportChatState.initPromise = null;
  }
  })();

  return supportChatState.initPromise;
}

function attachShellEvents() {
  const { launcher, closeButton, panel } = supportChatState.elements;
  if (!launcher || launcher.dataset.bound === 'true') return;

  launcher.dataset.bound = 'true';
  launcher.addEventListener('click', async () => {
    const shouldOpen = panel?.hidden ?? true;
    if (shouldOpen) {
      openSupportChat();
      await initializeSupportWidget();
      return;
    }

    closeSupportChat();
  });

  closeButton?.addEventListener('click', closeSupportChat);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel && !panel.hidden) {
      closeSupportChat();
    }
  });
}

function resetSupportSessionForUser(userKey) {
  if (supportChatState.currentUserKey === userKey) return;

  supportChatState.currentUserKey = userKey;
  supportChatState.cachedClientSecret = null;
  supportChatState.clientSecretPromise = null;
  supportChatState.initPromise = null;
  supportChatState.initialized = false;
  supportChatState.savedIncidentFingerprints.clear();
  supportChatState.pendingIncidentFingerprints.clear();
  window.clearTimeout(supportChatState.reportScanTimer);

  const chatElement = supportChatState.elements?.chatElement;
  if (chatElement) {
    chatElement.innerHTML = '';
  }
}

export async function initInternalSupportChat(user, hotel) {
  if (!user) return;

  if (!supportChatState.mounted) {
    supportChatState.elements = buildSupportChatShell();
    attachShellEvents();
    supportChatState.mounted = true;
  }

  supportChatState.currentUser = user;
  supportChatState.currentHotel = hotel;
  resetSupportSessionForUser(getSupportChatUserKey(user, hotel));

  const warmUpChat = () => {
    ensureClientSecret().catch((error) => {
      console.warn('No se pudo precalentar la sesion de soporte:', error);
    });
    initializeSupportWidget({ silent: true }).catch((error) => {
      console.warn('No se pudo precargar el widget de soporte:', error);
    });
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => warmUpChat(), { timeout: 3000 });
  } else {
    window.setTimeout(warmUpChat, 1200);
  }
}

export async function openInternalSupportChat() {
  if (!supportChatState.mounted || !supportChatState.elements) {
    return false;
  }

  openSupportChat();
  await initializeSupportWidget();
  return true;
}

export function destroyInternalSupportChat() {
  closeSupportChat();

  if (supportChatState.observer) {
    supportChatState.observer.disconnect();
    supportChatState.observer = null;
  }
  supportChatState.observedRoots.clear();

  supportChatState.cachedClientSecret = null;
  supportChatState.clientSecretPromise = null;
  supportChatState.initPromise = null;
  supportChatState.initialized = false;
  supportChatState.initializing = false;
  supportChatState.currentUserKey = null;
  supportChatState.currentUser = null;
  supportChatState.currentHotel = null;
  supportChatState.savedIncidentFingerprints.clear();
  supportChatState.pendingIncidentFingerprints.clear();
  window.clearTimeout(supportChatState.reportScanTimer);
  window.clearTimeout(supportChatState.reportStatusTimer);

  if (supportChatState.elements?.root) {
    supportChatState.elements.root.remove();
  }

  supportChatState.elements = null;
  supportChatState.mounted = false;
}
