(function installEnergyModuleRecovery() {
  const ENERGY_ROUTE = '#/control-energia';

  function isEnergyRoute() {
    return String(window.location.hash || '').startsWith(ENERGY_ROUTE);
  }

  function hideLoadingOverlay() {
    const overlay = document.getElementById('app-global-loading-overlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.style.display = 'none';
  }

  function showRecovery() {
    hideLoadingOverlay();
    const app = document.getElementById('app-container');
    if (!app) return;
    app.innerHTML = '<div style="max-width:560px;margin:32px auto;padding:24px;border-radius:18px;background:#fff7ed;color:#7c2d12;box-shadow:0 8px 30px rgba(0,0,0,.08);font-family:Arial,sans-serif"><h2 style="margin:0 0 10px;font-size:22px">⚡ No se pudo cargar Control de Energía</h2><p style="line-height:1.5;margin:0 0 16px">El navegador recibió una copia inválida o desactualizada del módulo. Actualiza la aplicación y vuelve a intentarlo.</p><button id="energy-module-retry" type="button" style="border:0;border-radius:12px;background:#ea580c;color:white;font-weight:700;padding:12px 18px;cursor:pointer">Actualizar y volver a intentar</button></div>';

    const retry = document.getElementById('energy-module-retry');
    if (retry) {
      retry.addEventListener('click', function () {
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
          navigator.serviceWorker.getRegistration().then(function (registration) {
            if (registration && registration.update) return registration.update();
            return null;
          }).catch(function () {}).finally(function () {
            window.location.reload();
          });
        } else {
          window.location.reload();
        }
      });
    }
  }

  window.addEventListener('unhandledrejection', function (event) {
    if (!isEnergyRoute()) return;
    const reason = event && event.reason;
    const text = String((reason && reason.message) || reason || '');
    if (
      (typeof SyntaxError !== 'undefined' && reason instanceof SyntaxError) ||
      text.includes('dynamically imported module') ||
      text.includes('Failed to fetch') ||
      text.includes('Unexpected token')
    ) {
      showRecovery();
    }
  });

  window.addEventListener('error', function (event) {
    if (!isEnergyRoute()) return;
    const text = String((event && event.message) || '');
    if (text.includes('Unexpected token') || text.includes('module')) showRecovery();
  });
})();