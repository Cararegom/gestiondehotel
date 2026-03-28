document.addEventListener('DOMContentLoaded', () => {
  const SUPABASE_FUNCTIONS_BASE = 'https://iikpqpdoslyduecibaij.supabase.co/functions/v1';
  const CHATKIT_SESSION_ENDPOINT = `${SUPABASE_FUNCTIONS_BASE}/chatkit-session`;
  const LANDING_TRACK_EVENT_ENDPOINT = `${SUPABASE_FUNCTIONS_BASE}/landing-track-event`;
  const LANDING_SAVE_LEAD_ENDPOINT = `${SUPABASE_FUNCTIONS_BASE}/landing-save-lead`;
  const CHATKIT_DOMAIN_KEY = 'domain_pk_69c15fef533c819795015e543f83ff950af2fea964c34d54';
  const LANDING_CHAT_VISITOR_KEY = 'gestionhotel.sales_chat_visitor_id';
  const LANDING_SESSION_KEY = 'gestionhotel.landing_session_id';
  const LANDING_UTM_KEY = 'gestionhotel.landing_utm_first_touch';

  const testimonials = [
    {
      name: 'Laura Cárdenas',
      role: 'Propietaria, Hotel Paraíso Azul',
      content:
        'Desde que usamos Gestión de Hotel, nuestras reservas por horas se dispararon un 40%. El sistema es súper fácil de usar y el soporte siempre está ahí. ¡Lo recomiendo a ojos cerrados!',
      image: 'icons/testimonio-laura-cardenas.png'
    },
    {
      name: 'Ricardo Morales',
      role: 'Gerente, Motel El Descanso',
      content:
        'Antes perdíamos mucho tiempo con la caja y las facturas. Ahora todo es automático y sin errores. La integración con WhatsApp es una maravilla para confirmar reservas. ¡Un alivio total!',
      image: 'icons/testimonio-ricardo-morales.png'
    },
    {
      name: 'Sofía Peña',
      role: 'Administradora, Hostal Aventura',
      content:
        'Lo que más me gusta es el mapa de habitaciones y lo fácil que es ver la disponibilidad. El primer mes gratis nos convenció y ahora no podríamos vivir sin él. ¡Gracias, Gestión de Hotel!',
      image: 'icons/testimonio-sofia-pena.png'
    }
  ];

  const carouselEl = document.getElementById('testimonial-carousel');
  const carouselInner = document.querySelector('#testimonial-carousel .carousel-inner');

  if (carouselEl && carouselInner) {
    testimonials.forEach((testimonial, index) => {
      const item = document.createElement('div');
      item.className = `carousel-item ${index === 0 ? 'active' : ''}`;
      item.innerHTML = `
        <div class="card testimonial-card border-0 hotel-shadow-lg bg-white text-center p-4 p-md-5">
          <img
            src="${testimonial.image}"
            alt="Foto de ${testimonial.name}"
            class="rounded-circle mx-auto mb-3"
            style="width: 70px; height: 70px; border: 3px solid var(--hotel-blue); object-fit: cover;"
            loading="lazy"
            decoding="async"
          >
          <p class="fs-5 fst-italic text-secondary mb-4">"${testimonial.content}"</p>
          <div>
            <p class="fw-bold mb-0">${testimonial.name}</p>
            <p class="text-secondary small mb-0">${testimonial.role}</p>
          </div>
        </div>
      `;
      carouselInner.appendChild(item);
    });

    if (window.bootstrap?.Carousel) {
      const testimonialCarousel = new window.bootstrap.Carousel(carouselEl, {
        interval: 6000,
        ride: 'carousel'
      });

      const prevBtn = document.getElementById('prev-testimonial');
      const nextBtn = document.getElementById('next-testimonial');
      prevBtn?.addEventListener('click', () => testimonialCarousel.prev());
      nextBtn?.addEventListener('click', () => testimonialCarousel.next());
    }
  }

  const planes = {
    lite: { cop: 99000, usd: 25, original_cop: 149000, original_usd: 40 },
    pro: { cop: 149000, usd: 38, original_cop: 229000, original_usd: 60 },
    max: { cop: 199000, usd: 50, original_cop: 299000, original_usd: 75 }
  };
  const WELCOME_PROMO_DISCOUNT = 0.5;

  const monedaSwitch = document.getElementById('monedaSwitch');
  const periodoSwitch = document.getElementById('periodoSwitch');

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
    const originalCurrencyKey = isCop ? 'original_cop' : 'original_usd';
    const currencyCode = isCop ? 'COP' : 'USD';

    updateLabels(isCop, isAnnual);

    Object.keys(planes).forEach((plan) => {
      const priceMonthly = planes[plan][currency];
      const promoMonthlyPrice = priceMonthly * WELCOME_PROMO_DISCOUNT;
      const priceAnnual = priceMonthly * 10;
      const displayPrice = isAnnual ? priceAnnual : promoMonthlyPrice;
      const originalPriceMonthly = planes[plan][originalCurrencyKey];
      const originalPriceAnnual = originalPriceMonthly * 10;
      const displayOriginalPrice = isAnnual ? originalPriceAnnual : originalPriceMonthly;
      const periodText = isAnnual ? '/año' : '/mes';

      document.getElementById(`price-${plan}`).textContent = formatLandingCurrency(displayPrice, currencyCode);

      const originalPriceElement = document.getElementById(`price-original-${plan}`);
      if (originalPriceElement) {
        originalPriceElement.textContent = formatLandingCurrency(displayOriginalPrice, currencyCode);
        originalPriceElement.style.display = isAnnual ? '' : 'none';
      }

      document.getElementById(`period-${plan}`).textContent = periodText;

      const promoNote = document.getElementById(`promo-note-${plan}`);
      if (promoNote) {
        const regularMonthlyPrice = planes[plan][currency];
        if (isAnnual) {
          promoNote.innerHTML = `
            <div class="promo-inline-kicker">Promo mensual para cuentas nuevas</div>
            <div class="promo-inline-copy">Mes 1 gratis y meses 2 al 4 al 50% en modalidad mensual.</div>
            <div class="promo-inline-footnote">Luego del 3er mes promocional pagas la tarifa regular de ${formatLandingCurrency(regularMonthlyPrice, currencyCode)}/mes. Si eliges anual, se mantienen 2 meses gratis.</div>
          `;
        } else {
          promoNote.innerHTML = `
            <div class="promo-inline-kicker">Mes 1 gratis</div>
            <div class="promo-inline-copy">El precio grande de arriba corresponde al valor promocional de los meses 2 al 4.</div>
            <div class="promo-inline-footnote">Despues del 3er mes promocional pagas la tarifa regular de ${formatLandingCurrency(regularMonthlyPrice, currencyCode)}/mes.</div>
          `;
        }
      }
    });
  }

  monedaSwitch?.addEventListener('change', updatePrices);
  periodoSwitch?.addEventListener('change', updatePrices);
  updatePrices();

  const launcher = document.getElementById('sales-chat-launcher');
  const panel = document.getElementById('sales-chat-panel');
  const closeButton = document.getElementById('sales-chat-close');
  const status = document.getElementById('sales-chat-status');
  const fallback = document.getElementById('sales-chat-fallback');
  const chatElement = document.getElementById('landing-sales-chat');
  const leadToggle = document.getElementById('sales-chat-lead-toggle');
  const leadForm = document.getElementById('sales-chat-lead-form');
  const leadFeedback = document.getElementById('sales-chat-lead-feedback');

  const salesChatState = {
    initialized: false,
    initializing: false,
    customizationObserver: null
  };
  let cachedClientSecret = null;
  let clientSecretPromise = null;

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

  function setLeadFeedback(message, isError = false) {
    if (!leadFeedback) return;
    leadFeedback.hidden = !message;
    leadFeedback.textContent = message || '';
    leadFeedback.className = `sales-chat-lead-feedback ${isError ? 'is-error' : 'is-success'}`;
  }

  function setLeadFormExpanded(isExpanded) {
    if (!leadForm || !leadToggle) return;
    leadForm.hidden = !isExpanded;
    leadToggle.setAttribute('aria-expanded', String(isExpanded));
    leadToggle.textContent = isExpanded
      ? 'Ocultar formulario de contacto'
      : 'Quiero que me contacten';
  }

  function bindLandingConversionTracking() {
    trackLandingEvent('page_view', {
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

    document.querySelectorAll('[data-bs-target="#registroModal"]').forEach((element) => {
      element.addEventListener('click', () => {
        trackLandingEvent('open_registration_modal', {
          cta_label: (element.textContent || '').trim().slice(0, 120)
        }, { keepalive: true });
      });
    });

    document.querySelectorAll('a[href="#pricing"]').forEach((element) => {
      element.addEventListener('click', () => {
        trackLandingEvent('view_pricing_section', {
          cta_label: (element.textContent || '').trim().slice(0, 120)
        }, { keepalive: true });
      });
    });

    document.querySelectorAll('a[href="#demo-video"]').forEach((element) => {
      element.addEventListener('click', () => {
        trackLandingEvent('open_demo_section', {
          cta_label: (element.textContent || '').trim().slice(0, 120)
        }, { keepalive: true });
      });
    });

    document.querySelectorAll('.plan-button-select').forEach((element) => {
      element.addEventListener('click', () => {
        trackLandingEvent('select_plan_from_landing', {
          plan_id: element.getAttribute('data-plan-id') || '',
          cta_label: (element.textContent || '').trim().slice(0, 120)
        }, { keepalive: true });
      });
    });
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

  async function ensureClientSecret(currentClientSecret = null) {
    if (currentClientSecret) {
      cachedClientSecret = currentClientSecret;
      return currentClientSecret;
    }

    if (cachedClientSecret) {
      return cachedClientSecret;
    }

    if (!clientSecretPromise) {
      clientSecretPromise = fetchClientSecret().then((clientSecret) => {
        cachedClientSecret = clientSecret;
        return clientSecret;
      }).finally(() => {
        clientSecretPromise = null;
      });
    }

    return clientSecretPromise;
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

  function startChatKitCustomization() {
    if (!chatElement || salesChatState.customizationObserver) return;

    const runPatch = () => patchChatKitCopyInRoot(chatElement);
    runPatch();

    salesChatState.customizationObserver = new MutationObserver(() => {
      runPatch();
    });

    salesChatState.customizationObserver.observe(chatElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'aria-label', 'title']
    });

    if (chatElement.shadowRoot) {
      salesChatState.customizationObserver.observe(chatElement.shadowRoot, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['placeholder', 'aria-label', 'title']
      });
    }

    window.setTimeout(runPatch, 400);
    window.setTimeout(runPatch, 1200);
    window.setTimeout(runPatch, 2600);
  }

  async function initializeSalesChat({ silent = false } = {}) {
    if (!chatElement || salesChatState.initialized || salesChatState.initializing) return;

    salesChatState.initializing = true;
    fallback.hidden = true;

    if (!silent) {
      status.hidden = false;
      status.textContent = 'Conectando con Laura...';
    }

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
        frameTitle: 'Chat con Laura',
        header: {
          title: {
            text: 'Laura'
          }
        },
        startScreen: {
          greeting: '¿Que quieres resolver hoy?',
          prompts: [
            {
              label: 'Como funciona la prueba gratis',
              prompt: 'Explicame como funciona la prueba gratis y que pasa despues del primer mes.'
            },
            {
              label: 'Que plan me conviene',
              prompt: 'Quiero saber que plan me conviene segun la cantidad de habitaciones y lo que necesito operar.'
            },
            {
              label: 'Cuanto pagaria despues',
              prompt: 'Quiero entender cuanto pagaria despues del mes gratis y como funciona la promocion de los 3 meses al 50%.'
            },
            {
              label: 'Si sirve para mi hotel',
              prompt: 'Quiero saber si este sistema realmente se adapta a mi hotel y que problemas me ayudaria a resolver antes de comprar.'
            }
          ]
        },
        composer: {
          placeholder: 'Escribe tu mensaje a Laura'
        }
      });

      salesChatState.initialized = true;
      startChatKitCustomization();
      trackLandingEvent('sales_chat_ready', {
        source: 'chatkit',
        prompts: 4
      }, { keepalive: true });
      status.hidden = true;
    } catch (error) {
      console.error('Error inicializando el chat comercial:', error);
      trackLandingEvent('sales_chat_failed', {
        message: error.message || 'Error desconocido'
      }, { keepalive: true });
      if (!silent) {
        status.hidden = true;
        fallback.hidden = false;
      }
    } finally {
      salesChatState.initializing = false;
    }
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

  leadToggle?.addEventListener('click', () => {
    const nextExpandedState = leadForm?.hidden ?? true;
    setLeadFormExpanded(nextExpandedState);
    if (nextExpandedState) {
      trackLandingEvent('sales_chat_lead_form_opened', { source: 'chat_panel' }, { keepalive: true });
    }
  });

  leadForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = leadForm.querySelector('button[type="submit"]');
    if (!submitButton) return;

    const fullName = leadForm.elements.full_name?.value?.trim() || '';
    const businessName = leadForm.elements.business_name?.value?.trim() || '';
    const email = leadForm.elements.email?.value?.trim() || '';
    const whatsapp = leadForm.elements.whatsapp?.value?.trim() || '';
    const country = leadForm.elements.country?.value?.trim() || '';
    const roomCount = leadForm.elements.room_count?.value || '';
    const notes = leadForm.elements.notes?.value?.trim() || '';

    if (!email && !whatsapp) {
      setLeadFeedback('Comparte al menos un correo o WhatsApp para poder contactarte.', true);
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Guardando...';
    setLeadFeedback('');

    try {
      const response = await postLandingPayload(LANDING_SAVE_LEAD_ENDPOINT, {
        source: 'chatbot_comercial',
        visitorId: getLandingVisitorId(),
        sessionId: getLandingSessionId(),
        fullName,
        businessName,
        email,
        whatsapp,
        country,
        roomCount: roomCount ? Number(roomCount) : null,
        interest: 'contacto_comercial',
        pagePath: `${window.location.pathname}${window.location.hash || ''}`,
        referrer: document.referrer || '',
        notes,
        metadata: {
          channel: 'chat_panel',
          panel_open: !(panel?.hidden ?? true)
        },
        ...getFirstTouchUtm()
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'No fue posible guardar tu contacto.');
      }

      setLeadFeedback('Perfecto. Ya guardamos tus datos para que el equipo comercial te contacte.', false);
      trackLandingEvent('sales_chat_lead_saved', {
        has_email: Boolean(email),
        has_whatsapp: Boolean(whatsapp),
        room_count: roomCount ? Number(roomCount) : null
      }, { keepalive: true });
      leadForm.reset();
      setLeadFormExpanded(false);
    } catch (error) {
      console.error('Error guardando lead comercial:', error);
      setLeadFeedback(error.message || 'No pudimos guardar tu contacto.', true);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Quiero que me contacten';
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel && !panel.hidden) {
      trackLandingEvent('sales_chat_closed', { origin: 'escape' }, { keepalive: true });
      closeSalesChat();
    }
  });

  const warmUpChat = () => {
    ensureClientSecret().catch((error) => {
      console.warn('No se pudo precalentar la sesion de Laura:', error);
    });
    initializeSalesChat({ silent: true }).catch((error) => {
      console.warn('No se pudo precargar el widget de Laura:', error);
    });
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => warmUpChat(), { timeout: 3000 });
  } else {
    window.setTimeout(warmUpChat, 1200);
  }

  bindLandingConversionTracking();
  setLeadFormExpanded(false);
});
