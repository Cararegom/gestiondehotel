let pwaContainer = null;
let deferredInstallPrompt = null;
let activeRegistration = null;

function getContainer() {
  if (pwaContainer) return pwaContainer;
  pwaContainer = document.getElementById('app-pwa-hub');
  return pwaContainer;
}

function renderPWAHub() {
  const container = getContainer();
  if (!container) return;

  const offline = !navigator.onLine;
  const canInstall = Boolean(deferredInstallPrompt);
  const canRefresh = Boolean(activeRegistration?.waiting);

  if (!offline && !canInstall && !canRefresh) {
    container.innerHTML = '';
    container.hidden = true;
    return;
  }

  container.hidden = false;
  container.innerHTML = `
    <div class="app-pwa-banner ${offline ? 'is-offline' : 'is-online'}" role="status" aria-live="polite">
      <div class="app-pwa-banner__copy">
        <strong>${offline ? 'Sin conexión activa' : 'La app ya se puede instalar'}</strong>
        <span>${offline
          ? 'Puedes seguir consultando datos recientes y volver a sincronizar cuando regrese internet.'
          : (canRefresh
              ? 'Hay una versión nueva lista para actualizar.'
              : 'Instálala para abrirla como app y mejorar la respuesta en móvil.')}</span>
      </div>
      <div class="app-pwa-banner__actions">
        ${canInstall ? '<button type="button" id="app-pwa-install-btn" class="button button-primary app-touch-button">Instalar</button>' : ''}
        ${canRefresh ? '<button type="button" id="app-pwa-refresh-btn" class="button button-neutral app-touch-button">Actualizar</button>' : ''}
      </div>
    </div>
  `;

  const installBtn = container.querySelector('#app-pwa-install-btn');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      try {
        await deferredInstallPrompt.userChoice;
      } finally {
        deferredInstallPrompt = null;
        renderPWAHub();
      }
    }, { once: true });
  }

  const refreshBtn = container.querySelector('#app-pwa-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      activeRegistration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    }, { once: true });
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;

  const registration = await navigator.serviceWorker.register('/sw.js');
  activeRegistration = registration;

  if (registration.waiting) {
    renderPWAHub();
  }

  registration.addEventListener('updatefound', () => {
    const installingWorker = registration.installing;
    if (!installingWorker) return;

    installingWorker.addEventListener('statechange', () => {
      if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
        renderPWAHub();
      }
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    renderPWAHub();
  });

  return registration;
}

export async function initPWAExperience() {
  if (typeof window === 'undefined') return;

  window.addEventListener('online', renderPWAHub);
  window.addEventListener('offline', renderPWAHub);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    renderPWAHub();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    renderPWAHub();
  });

  try {
    await registerServiceWorker();
  } catch (error) {
    console.warn('[PWA] No se pudo registrar el service worker:', error?.message || error);
  }

  renderPWAHub();
}
