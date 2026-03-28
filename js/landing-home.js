document.addEventListener('DOMContentLoaded', () => {
  const SUPABASE_FUNCTIONS_BASE = 'https://iikpqpdoslyduecibaij.supabase.co/functions/v1';
  const CHATKIT_SESSION_ENDPOINT = `${SUPABASE_FUNCTIONS_BASE}/chatkit-session`;
  const CHATKIT_DOMAIN_KEY = 'domain_pk_69c15fef533c819795015e543f83ff950af2fea964c34d54';
  const LANDING_CHAT_VISITOR_KEY = 'gestionhotel.sales_chat_visitor_id';

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

  const salesChatState = {
    initialized: false,
    initializing: false,
    customizationObserver: null
  };
  let cachedClientSecret = null;
  let clientSecretPromise = null;

  function getLandingVisitorId() {
    const storedId = window.localStorage.getItem(LANDING_CHAT_VISITOR_KEY);
    if (storedId) return storedId;

    const generatedId = `landing_${crypto.randomUUID()}`;
    window.localStorage.setItem(LANDING_CHAT_VISITOR_KEY, generatedId);
    return generatedId;
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
      status.hidden = true;
    } catch (error) {
      console.error('Error inicializando el chat comercial:', error);
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
      await initializeSalesChat();
      return;
    }

    closeSalesChat();
  });

  closeButton?.addEventListener('click', closeSalesChat);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel && !panel.hidden) {
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
});
