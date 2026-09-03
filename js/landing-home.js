document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('landing-js');
  const SUPABASE_FUNCTIONS_BASE = 'https://iikpqpdoslyduecibaij.supabase.co/functions/v1';
  const CHATKIT_SESSION_ENDPOINT = `${SUPABASE_FUNCTIONS_BASE}/chatkit-session`;
  const LANDING_TRACK_EVENT_ENDPOINT = `${SUPABASE_FUNCTIONS_BASE}/landing-track-event`;
  const CHATKIT_SCRIPT_SRC = 'https://cdn.platform.openai.com/deployments/chatkit/chatkit.js';
  const CHATKIT_DOMAIN_KEY = 'domain_pk_69c15fef533c819795015e543f83ff950af2fea964c34d54';
  const LANDING_CHAT_VISITOR_KEY = 'gestionhotel.sales_chat_visitor_id';
  const LANDING_SESSION_KEY = 'gestionhotel.landing_session_id';
  const LANDING_UTM_KEY = 'gestionhotel.landing_utm_first_touch';

  const planes = {
    lite: { cop: 99000, usd: 25 },
    pro: { cop: 149000, usd: 38 },
    max: { cop: 199000, usd: 50 }
  };
  const WELCOME_PROMO_DISCOUNT = 0.5;

  const monedaSwitch = document.getElementById('monedaSwitch');
  const periodoSwitch = document.getElementById('periodoSwitch');
  const planNodes = Object.fromEntries(
    Object.keys(planes).map((plan) => [
      plan,
      {
        price: document.getElementById(`price-${plan}`),
        period: document.getElementById(`period-${plan}`),
        promoNote: document.getElementById(`promo-note-${plan}`)
      }
    ])
  );

  function formatLandingCurrency(value, currency) {
    if (currency === 'USD') {
      return value.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0
      });
    }

    return value.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0
    });
  }

  function updateLabels(isCop, isAnnual) {
    document.getElementById('label-usd')?.classList.toggle('active', !isCop);
    document.getElementById('label-cop')?.classList.toggle('active', isCop);
    document.getElementById('label-mensual')?.classList.toggle('active', !isAnnual);
    document.getElementById('label-anual')?.classList.toggle('active', isAnnual);
  }

  function updatePrices() {
    if (!monedaSwitch || !periodoSwitch) return;

    const isCop = monedaSwitch.checked;
    const isAnnual = periodoSwitch.checked;
    const currency = isCop ? 'cop' : 'usd';
    const currencyCode = isCop ? 'COP' : 'USD';

    updateLabels(isCop, isAnnual);

    Object.keys(planes).forEach((plan) => {
      const priceMonthly = planes[plan][currency];
      const promoMonthlyPrice = priceMonthly * WELCOME_PROMO_DISCOUNT;
      const priceAnnual = priceMonthly * 10;
      const displayPrice = isAnnual ? priceAnnual : promoMonthlyPrice;
      const periodText = isAnnual ? '/año' : '/mes';

      const planNode = planNodes[plan];
      if (!planNode?.price || !planNode?.period) return;

      planNode.price.textContent = formatLandingCurrency(displayPrice, currencyCode);
      planNode.period.textContent = periodText;

      const promoNote = planNode.promoNote;
      if (promoNote) {
        const regularMonthlyPrice = planes[plan][currency];
        if (isAnnual) {
          promoNote.innerHTML = `
            <strong>Pago anual:</strong> equivale a 10 mensualidades de ${formatLandingCurrency(regularMonthlyPrice, currencyCode)}.
          `;
        } else {
          promoNote.innerHTML = `
            <strong>Precio promocional:</strong> aplica a los 3 primeros pagos mensuales. Luego ${formatLandingCurrency(regularMonthlyPrice, currencyCode)}/mes.
          `;
        }
      }
    });
  }

  monedaSwitch?.addEventListener('change', updatePrices);
  periodoSwitch?.addEventListener('change', updatePrices);
  updatePrices();

  function initializeLandingMotion() {
    const revealElements = document.querySelectorAll('.reveal');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion || !('IntersectionObserver' in window)) {
      revealElements.forEach((element) => element.classList.add('is-visible'));
      return;
    }

    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    revealElements.forEach((element) => revealObserver.observe(element));
  }

  function initializeLandingNavigation() {
    const navbar = document.querySelector('.landing-navbar');
    const navbarCollapse = document.getElementById('navbarNav');
    const updateNavbar = () => navbar?.classList.toggle('is-scrolled', window.scrollY > 20);

    updateNavbar();
    window.addEventListener('scroll', updateNavbar, { passive: true });

    navbarCollapse?.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        if (!navbarCollapse.classList.contains('show') || !window.bootstrap?.Collapse) return;
        window.bootstrap.Collapse.getOrCreateInstance(navbarCollapse).hide();
      });
    });
  }

  initializeLandingMotion();
  initializeLandingNavigation();

  const launcher = document.getElementById('sales-chat-launcher');
  const panel = document.getElementById('sales-chat-panel');
  const closeButton = document.getElementById('sales-chat-close');
  const status = document.getElementById('sales-chat-status');
  const fallback = document.getElementById('sales-chat-fallback');
  const chatMount = document.getElementById('landing-sales-chat-mount');
  let chatElement = null;

  const salesChatState = {
    initialized: false,
    initializing: false,
    customizationObserver: null,
    initPromise: null,
    scriptPromise: null,
    sessionWarmed: false,
    widgetWarmIntentBound: false,
    observedRoots: new Set()
  };
  let cachedClientSecret = null;
  let cachedClientSecretAt = 0;
  let clientSecretPromise = null;

  function ensureChatKitScript() {
    if (window.customElements?.get('openai-chatkit')) {
      return Promise.resolve();
    }

    if (salesChatState.scriptPromise) {
      return salesChatState.scriptPromise;
    }

    salesChatState.scriptPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector(`script[src="${CHATKIT_SCRIPT_SRC}"]`);
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(), { once: true });
        existingScript.addEventListener('error', () => reject(new Error('No se pudo cargar ChatKit.')), { once: true });

        if (window.customElements?.get('openai-chatkit')) {
          resolve();
        }
        return;
      }

      const script = document.createElement('script');
      script.src = CHATKIT_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('No se pudo cargar ChatKit.'));
      document.head.appendChild(script);
    });

    return salesChatState.scriptPromise;
  }

  function ensureStorageValue(storage, key, prefix) {
    const storedValue = storage.getItem(key);
    if (storedValue) return storedValue;

    const generatedValue = `${prefix}_${crypto.randomUUID()}`;
    storage.setItem(key, generatedValue);
    return generatedValue;
  }

  function getLandingVisitorId() {
    return ensureStorageValue(window.localStorage, LANDING_CHAT_VISITOR_KEY, 'landing');
  }

  function getLandingSessionId() {
    return ensureStorageValue(window.sessionStorage, LANDING_SESSION_KEY, 'session');
  }

  function getFirstTouchUtm() {
    const params = new URLSearchParams(window.location.search);
    const currentUtm = {
      utm_source: params.get('utm_source') || '',
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || '',
      utm_term: params.get('utm_term') || '',
      utm_content: params.get('utm_content') || ''
    };

    const hasCurrentData = Object.values(currentUtm).some(Boolean);
    if (hasCurrentData) {
      window.localStorage.setItem(LANDING_UTM_KEY, JSON.stringify(currentUtm));
      return currentUtm;
    }

    try {
      return JSON.parse(window.localStorage.getItem(LANDING_UTM_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  async function postLandingPayload(endpoint, payload, { keepalive = false } = {}) {
    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      keepalive,
      body: JSON.stringify(payload)
    });
  }

  function trackLandingEvent(eventName, metadata = {}, { keepalive = false } = {}) {
    const utm = getFirstTouchUtm();
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: eventName,
      landing_metadata: metadata
    });

    if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      return Promise.resolve();
    }

    return postLandingPayload(LANDING_TRACK_EVENT_ENDPOINT, {
      eventName,
      source: 'landing',
      visitorId: getLandingVisitorId(),
      sessionId: getLandingSessionId(),
      pagePath: `${window.location.pathname}${window.location.hash || ''}`,
      referrer: document.referrer || '',
      ...utm,
      metadata
    }, { keepalive }).catch((error) => {
      console.warn(`No se pudo registrar el evento ${eventName}:`, error);
    });
  }

  function bindLandingConversionTracking() {
    trackLandingEvent('landing_view', {
      title: document.title,
      host: window.location.hostname
    }, { keepalive: true });

    monedaSwitch?.addEventListener('change', () => {
      trackLandingEvent('pricing_currency_changed', {
        currency: monedaSwitch.checked ? 'COP' : 'USD'
      }, { keepalive: true });
    });

    periodoSwitch?.addEventListener('change', () => {
      trackLandingEvent('pricing_period_changed', {
        period: periodoSwitch.checked ? 'annual' : 'monthly'
      }, { keepalive: true });
    });

    document.querySelectorAll('[data-analytics]').forEach((element) => {
      element.addEventListener('click', () => {
        const eventName = element.getAttribute('data-analytics');
        if (!eventName) return;

        trackLandingEvent(eventName, {
          plan_id: element.getAttribute('data-plan-id') || '',
          cta_location: element.getAttribute('data-cta-location') || '',
          cta_label: (element.textContent || '').trim().slice(0, 120)
        }, { keepalive: true });
      });
    });

    const observedEvents = document.querySelectorAll('[data-observe-event]');
    if (!observedEvents.length) return;

    if (!('IntersectionObserver' in window)) {
      observedEvents.forEach((section) => {
        trackLandingEvent(section.getAttribute('data-observe-event'), {}, { keepalive: true });
      });
      return;
    }

    const eventObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const eventName = entry.target.getAttribute('data-observe-event');
        if (eventName) trackLandingEvent(eventName, {}, { keepalive: true });
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.35 });

    observedEvents.forEach((section) => eventObserver.observe(section));
  }

  function setLauncherExpanded(isExpanded) {
    launcher?.setAttribute('aria-expanded', String(isExpanded));
  }

  function openSalesChat() {
    if (!panel) return;
    panel.hidden = false;
    setLauncherExpanded(true);
    document.body.classList.add('sales-chat-open');
  }

  function closeSalesChat() {
    if (!panel) return;
    panel.hidden = true;
    setLauncherExpanded(false);
    document.body.classList.remove('sales-chat-open');
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

  async function fetchClientSecret(currentClientSecret = null) {
    const response = await fetch(CHATKIT_SESSION_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        visitorId: getLandingVisitorId(),
        currentClientSecret,
        origin: window.location.origin,
        pathname: window.location.pathname,
        source: 'landing'
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.client_secret) {
      throw new Error(payload.error || 'No fue posible iniciar el chat comercial.');
    }

    return payload.client_secret;
  }

  function invalidateSalesClientSecret() {
    cachedClientSecret = null;
    cachedClientSecretAt = 0;
    clientSecretPromise = null;
    salesChatState.sessionWarmed = false;
  }

  async function ensureClientSecret(currentClientSecret = null) {
    if (currentClientSecret) {
      cachedClientSecret = currentClientSecret;
      cachedClientSecretAt = Date.now();
      return currentClientSecret;
    }

    if (cachedClientSecret && (Date.now() - cachedClientSecretAt) < 60000) {
      return cachedClientSecret;
    }

    if (cachedClientSecret) {
      invalidateSalesClientSecret();
    }

    if (!clientSecretPromise) {
      clientSecretPromise = fetchClientSecret().then((clientSecret) => {
        cachedClientSecret = clientSecret;
        cachedClientSecretAt = Date.now();
        return clientSecret;
      }).finally(() => {
        clientSecretPromise = null;
      });
    }

    return clientSecretPromise;
  }

  function buildSalesChatOptions() {
    const apiOptions = {
      async getClientSecret(currentClientSecret) {
        return ensureClientSecret(currentClientSecret);
      }
    };

    if (['gestiondehotel.com', 'www.gestiondehotel.com'].includes(window.location.hostname)) {
      apiOptions.domainKey = CHATKIT_DOMAIN_KEY;
    }

    return {
      api: apiOptions,
      frameTitle: 'Chat con Laura',
      header: {
        title: {
          text: 'Laura'
        }
      },
      startScreen: {
        greeting: '¿Qué quieres resolver hoy?',
        prompts: [
          {
            label: 'Prueba gratis',
            prompt: 'Explicame como funciona la prueba gratis y que pasa despues del primer mes.'
          },
          {
            label: 'Qué plan me conviene',
            prompt: 'Quiero saber que plan me conviene segun la cantidad de habitaciones y lo que necesito operar.'
          },
          {
            label: 'Cuánto pago después',
            prompt: 'Quiero entender cuanto pagaria despues del mes gratis y como funciona la promocion de los 3 meses al 50%.'
          },
          {
            label: 'Pagos internacionales',
            prompt: 'Quiero saber si puedo contratar desde mi pais y como se veria el cobro internacional.'
          }
        ]
      },
      composer: {
        placeholder: 'Escribe tu mensaje a Laura'
      }
    };
  }

  async function configureSalesChatElement(targetChatElement) {
    await waitForChatKitElement();
    await targetChatElement.setOptions(buildSalesChatOptions());
  }

  function patchChatKitCopyInRoot(root) {
    if (!root?.querySelectorAll) return;

    const textReplacements = [
      [/Enviar mensaje a la IA/gi, 'Escribe tu mensaje a Laura'],
      [/Enviar mensaje a IA/gi, 'Escribe tu mensaje a Laura'],
      [/Message the AI/gi, 'Escribe tu mensaje a Laura'],
      [/Send message to AI/gi, 'Escribe tu mensaje a Laura'],
      [/AI/gi, 'Laura']
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
        element.setAttribute('placeholder', 'Escribe tu mensaje a Laura');
      }

      const ariaLabel = element.getAttribute?.('aria-label');
      if (ariaLabel && /ia|ai/i.test(ariaLabel)) {
        element.setAttribute(
          'aria-label',
          ariaLabel
            .replace(/Enviar mensaje a la IA/gi, 'Enviar mensaje a Laura')
            .replace(/AI/gi, 'Laura')
            .replace(/IA/gi, 'Laura')
        );
      }

      const title = element.getAttribute?.('title');
      if (title && /ia|ai/i.test(title)) {
        element.setAttribute(
          'title',
          title
            .replace(/Enviar mensaje a la IA/gi, 'Enviar mensaje a Laura')
            .replace(/AI/gi, 'Laura')
            .replace(/IA/gi, 'Laura')
        );
      }
    }
  }

  function resetSalesChatCustomizationObserver() {
    if (salesChatState.customizationObserver) {
      salesChatState.customizationObserver.disconnect();
      salesChatState.customizationObserver = null;
    }

    salesChatState.observedRoots.clear();
  }

  function replaceSalesChatElement() {
    if (!chatMount) return chatElement;

    resetSalesChatCustomizationObserver();

    const nextChatElement = document.createElement('openai-chatkit');
    nextChatElement.id = 'landing-sales-chat';
    if (chatElement?.parentNode) {
      chatElement.replaceWith(nextChatElement);
    } else {
      chatMount.replaceChildren(nextChatElement);
    }
    chatElement = nextChatElement;
    salesChatState.initialized = false;

    return nextChatElement;
  }

  function ensureSalesChatElement() {
    if (chatElement?.isConnected) return chatElement;
    return replaceSalesChatElement();
  }

  function shadowRootLooksMounted(root) {
    if (!root) return false;

    if (root.querySelector('textarea, input[placeholder], [role="textbox"], [contenteditable="true"]')) {
      return true;
    }

    if (root.querySelector('iframe, form, main, section, article, [data-state], [data-testid], [class*="composer"], [class*="prompt"]')) {
      return true;
    }

    const promptButtons = [...root.querySelectorAll('button')]
      .filter((button) => String(button.textContent || '').trim().length >= 2);
    if (promptButtons.length >= 1) {
      return true;
    }

    const directChildren = [...root.children];
    if (directChildren.length >= 2) {
      return true;
    }

    return false;
  }

  function chatElementLooksRendered(targetChatElement) {
    if (!targetChatElement) return false;

    const shadowRoot = targetChatElement.shadowRoot;
    if (shadowRootLooksMounted(shadowRoot)) {
      return true;
    }

    if (shadowRoot) {
      const nestedShadowHosts = [...shadowRoot.querySelectorAll('*')]
        .filter((element) => element.shadowRoot);

      if (nestedShadowHosts.some((element) => shadowRootLooksMounted(element.shadowRoot))) {
        return true;
      }
    }

    const bounds = typeof targetChatElement.getBoundingClientRect === 'function'
      ? targetChatElement.getBoundingClientRect()
      : null;
    if (bounds && bounds.height >= 220 && (shadowRoot?.children?.length || targetChatElement.children.length)) {
      return true;
    }

    return false;
  }

  async function waitForSalesChatRender(targetChatElement, timeoutMs = 7000) {
    const startedAt = Date.now();

    while ((Date.now() - startedAt) < timeoutMs) {
      if (chatElementLooksRendered(targetChatElement)) {
        return true;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 140));
    }

    return chatElementLooksRendered(targetChatElement);
  }

  function bindSalesObserverTargets(root) {
    if (!root || !salesChatState.customizationObserver || salesChatState.observedRoots.has(root)) return;

    salesChatState.customizationObserver.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'aria-label', 'title']
    });
    salesChatState.observedRoots.add(root);

    if (typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('*').forEach((element) => {
      if (element.shadowRoot) {
        bindSalesObserverTargets(element.shadowRoot);
      }
    });
  }

  function startChatKitCustomization() {
    if (!chatElement || salesChatState.customizationObserver) return;

    const runPatch = () => {
      bindSalesObserverTargets(chatElement);
      patchChatKitCopyInRoot(chatElement);
    };
    runPatch();

    salesChatState.customizationObserver = new MutationObserver(() => {
      runPatch();
    });

    bindSalesObserverTargets(chatElement);

    window.setTimeout(runPatch, 400);
    window.setTimeout(runPatch, 1200);
    window.setTimeout(runPatch, 2600);
  }

  async function initializeSalesChat({ silent = false } = {}) {
    if (!chatMount) return;
    if (salesChatState.initialized) return;
    if (salesChatState.initPromise) {
      if (!silent) {
        fallback.hidden = true;
        status.hidden = false;
        status.textContent = 'Conectando con Laura...';
      }
      return salesChatState.initPromise;
    }

    salesChatState.initializing = true;
    fallback.hidden = true;

    if (!silent) {
      status.hidden = false;
      status.textContent = 'Conectando con Laura...';
    }

    salesChatState.initPromise = (async () => {
      try {
        let targetChatElement = ensureSalesChatElement();
        await configureSalesChatElement(targetChatElement);

        let rendered = await waitForSalesChatRender(targetChatElement);
        if (!rendered) {
          invalidateSalesClientSecret();
          targetChatElement = replaceSalesChatElement();
          await configureSalesChatElement(targetChatElement);
          rendered = await waitForSalesChatRender(targetChatElement, 8500);
        }

        if (!rendered) {
          throw new Error('El chat comercial no termino de renderizarse.');
        }

        salesChatState.initialized = true;
        bindSalesObserverTargets(targetChatElement);
        patchChatKitCopyInRoot(targetChatElement);
        startChatKitCustomization();
        trackLandingEvent('sales_chat_ready', {
          source: 'chatkit',
          prompts: 4
        }, { keepalive: true });
        status.hidden = true;
      } catch (error) {
        console.error('Error inicializando el chat comercial:', error);
        invalidateSalesClientSecret();
        trackLandingEvent('sales_chat_failed', {
          message: error.message || 'Error desconocido'
        }, { keepalive: true });
        const panelVisible = Boolean(panel && !panel.hidden);
        if (status) {
          status.hidden = false;
          status.textContent = 'No pudimos abrir el chat en este momento.';
        }
        if (fallback && (!silent || panelVisible)) {
          fallback.hidden = false;
        }
      } finally {
        salesChatState.initializing = false;
        salesChatState.initPromise = null;
      }
    })();

    return salesChatState.initPromise;
  }

  function warmUpChatSession() {
    if (salesChatState.sessionWarmed && cachedClientSecret && (Date.now() - cachedClientSecretAt) < 60000) return;
    ensureClientSecret().then(() => {
      salesChatState.sessionWarmed = true;
    }).catch((error) => {
      salesChatState.sessionWarmed = false;
      console.warn('No se pudo precalentar la sesión de Laura:', error);
    });
  }

  function bindSalesChatIntentWarmup() {
    if (!launcher || salesChatState.widgetWarmIntentBound) return;
    salesChatState.widgetWarmIntentBound = true;

    const onceWarm = () => {
      warmUpChatSession();
    };

    launcher.addEventListener('pointerenter', onceWarm, { once: true });
    launcher.addEventListener('focus', onceWarm, { once: true });
    launcher.addEventListener('touchstart', onceWarm, { once: true, passive: true });
  }

  launcher?.addEventListener('click', async () => {
    const shouldOpen = panel?.hidden ?? true;

    if (shouldOpen) {
      openSalesChat();
      trackLandingEvent('sales_chat_opened', { origin: 'launcher' }, { keepalive: true });
      await initializeSalesChat();
      return;
    }

    trackLandingEvent('sales_chat_closed', { origin: 'launcher' }, { keepalive: true });
    closeSalesChat();
  });

  closeButton?.addEventListener('click', () => {
    trackLandingEvent('sales_chat_closed', { origin: 'close_button' }, { keepalive: true });
    closeSalesChat();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel && !panel.hidden) {
      trackLandingEvent('sales_chat_closed', { origin: 'escape' }, { keepalive: true });
      closeSalesChat();
    }
  });

  bindSalesChatIntentWarmup();

  bindLandingConversionTracking();
});
