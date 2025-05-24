// js/uiUtils.js

import { APP_CONFIG, I18N_TEXTS } from './config.js'; // Asegúrate que config.js esté en la misma carpeta

// --- FEEDBACK GLOBAL ---
export function showAppFeedback(message, type = 'info', autoHide = true, duration = 5000) {
  const feedbackBanner = document.getElementById('app-global-feedback-banner');
  if (!feedbackBanner) {
    console.warn('Elemento #app-global-feedback-banner no encontrado.');
    return;
  }
  feedbackBanner.textContent = message;
  feedbackBanner.className = 'app-global-feedback fixed top-5 right-5 p-4 rounded-md shadow-lg z-50 text-sm';
  switch (type) {
    case 'success': feedbackBanner.classList.add('bg-green-100', 'border-green-400', 'text-green-700'); break;
    case 'error': feedbackBanner.classList.add('bg-red-100', 'border-red-400', 'text-red-700'); break;
    case 'warning': feedbackBanner.classList.add('bg-yellow-100', 'border-yellow-400', 'text-yellow-700'); break;
    case 'info': default: feedbackBanner.classList.add('bg-blue-100', 'border-blue-400', 'text-blue-700'); break;
  }
  feedbackBanner.style.display = 'block';
  feedbackBanner.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  if (type === 'error') {
      feedbackBanner.setAttribute('tabindex', '-1');
      feedbackBanner.focus();
  }
  if (autoHide) {
    setTimeout(() => clearAppFeedback(feedbackBanner), duration);
  }
}

export function clearAppFeedback(feedbackBannerParam) {
  const banner = feedbackBannerParam || document.getElementById('app-global-feedback-banner');
  if (banner) {
    banner.textContent = '';
    banner.style.display = 'none';
    banner.className = 'app-global-feedback'; 
    banner.removeAttribute('tabindex');
  }
}

// --- FEEDBACK LOCAL PARA COMPONENTES ---
export function showLoading(element, message = 'Cargando...') {
  if (element) {
    element.textContent = message;
    element.className = 'loading-indicator p-3 my-3 text-sm bg-blue-100 border border-blue-300 text-blue-700 rounded-md visible';
    element.style.display = 'block';
    element.setAttribute('aria-live', 'polite');
  }
}

export function showError(element, message, typeClass = 'error-indicator') {
  if (element) {
    element.textContent = message;
    let alertClasses = 'bg-red-100 border-red-300 text-red-700';
    if (typeClass === 'success-indicator') alertClasses = 'bg-green-100 border-green-300 text-green-700';
    else if (typeClass === 'info-indicator') alertClasses = 'bg-blue-100 border-blue-300 text-blue-700';
    element.className = `feedback-message p-3 my-3 text-sm rounded-md border ${alertClasses} visible`;
    element.style.display = 'block';
    element.setAttribute('aria-live', typeClass === 'error-indicator' ? 'assertive' : 'polite');
    if (typeClass === 'error-indicator') {
        element.setAttribute('tabindex', '-1'); 
        element.focus();
    }
  }
}

export function clearFeedback(element) {
  if (element) {
    element.textContent = '';
    element.style.display = 'none';
    element.className = ''; 
    element.removeAttribute('tabindex');
    element.removeAttribute('aria-live');
  }
}

// --- FORMULARIO CARGANDO (para deshabilitar mientras procesa) ---
/**
 * Deshabilita/habilita todos los campos del formulario mientras guarda, y actualiza el botón.
 */
export function setFormLoadingState(formEl, isLoading, buttonEl, originalButtonText, loadingButtonText = 'Procesando...') {
  if (!formEl) {
    console.warn("setFormLoadingState: formEl no proporcionado.");
    return;
  }
  if (buttonEl) {
    buttonEl.disabled = isLoading;
    buttonEl.textContent = isLoading ? loadingButtonText : originalButtonText;
    if (isLoading) {
      buttonEl.classList.add('opacity-75', 'cursor-not-allowed');
    } else {
      buttonEl.classList.remove('opacity-75', 'cursor-not-allowed');
    }
  }
  Array.from(formEl.elements).forEach(el => {
    if (el.type !== 'submit' && el.type !== 'button') { 
      el.disabled = isLoading;
    }
  });
}

// --- FECHAS Y MONEDAS ---
export function formatCurrency(value, currency = 'COP') {
  const numericValue = Number(value);
  if (isNaN(numericValue)) {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(0);
  }
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(numericValue);
}

export function formatDateShort(dateInput, locale = 'es-CO') {
  if (!dateInput) return 'N/A';
  try {
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return 'Fecha Inválida';
    return date.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch (error) { return 'Error de Fecha'; }
}

export function formatDateTime(dateInput, locale = 'es-CO', options = { dateStyle: 'short', timeStyle: 'short' }) {
  if (!dateInput) return 'N/A';
  try {
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return 'Fecha/Hora Inválida';
    return date.toLocaleString(locale, options);
  } catch (error) { return 'Error de Fecha/Hora'; }
}

// --- Otras utilidades rápidas ---
export function mostrarFechaLocal(fechaUtc) {
    if (!fechaUtc) return '-';
    return new Date(fechaUtc).toLocaleString();
}

// --- LOADING GLOBAL PARA OVERLAY ---
export function showGlobalLoading(message) {
  const overlay = document.getElementById('app-global-loading-overlay');
  if (overlay) {
    const messageEl = overlay.querySelector('p#global-loading-message');
    if (messageEl && message) messageEl.textContent = message;
    else if (messageEl) messageEl.textContent = 'Cargando...';
    overlay.style.display = 'flex';
  }
}

export function hideGlobalLoading() {
  const overlay = document.getElementById('app-global-loading-overlay');
  if (overlay) overlay.style.display = 'none';
}
// --- FEEDBACK DE ÉXITO GLOBAL ---
export function showSuccess(element, message, autoHide = true, duration = 4000) {
  if (element) {
    element.textContent = message;
    element.className = 'feedback-message p-3 my-3 text-sm rounded-md border bg-green-100 border-green-300 text-green-700 visible';
    element.style.display = 'block';
    element.setAttribute('aria-live', 'polite');
    if (autoHide) {
      setTimeout(() => {
        element.textContent = '';
        element.style.display = 'none';
        element.className = '';
      }, duration);
    }
  }
}
