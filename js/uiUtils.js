// js/uiUtils.js

import { APP_CONFIG, I18N_TEXTS } from './config.js';
// Swal se asume global o se debe importar si se maneja como módulo.

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

// ----- INICIO DE LA CORRECCIÓN -----
function getElement(elementOrId) {
  if (typeof elementOrId === 'string') {
    return document.getElementById(elementOrId);
  }
  return elementOrId;
}
// ----- FIN DE LA CORRECCIÓN -----

export function showLoading(elementOrId, message = 'Cargando...') {
  const element = getElement(elementOrId); // Corrección aplicada
  if (element) {
    element.textContent = message;
    element.className = 'loading-indicator p-3 my-3 text-sm bg-blue-100 border border-blue-300 text-blue-700 rounded-md visible';
    element.style.display = 'block';
    element.setAttribute('aria-live', 'polite');
  }
}

/**
 * Muestra un modal de error estético (SweetAlert2) y también un mensaje en la página.
 * @param {HTMLElement|string} elementOrId - El div o el ID del div donde se mostrará el mensaje.
 * @param {string} message - El mensaje de error.
 */
export function showError(elementOrId, message) {
  const element = getElement(elementOrId); // Corrección aplicada

  // 1. Muestra el modal estético usando la variable global 'Swal'
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      icon: 'error',
      title: 'Ocurrió un Error',
      text: message,
      confirmButtonText: 'OK',
      confirmButtonColor: '#3085d6'
    });
  } else {
    console.warn("SweetAlert2 (Swal) no está disponible. Mostrando error como alerta nativa.");
    alert(`Error: ${message}`);
  }

  // 2. Muestra también el mensaje en la página como recordatorio
  if (element) {
    element.textContent = message;
    element.className = 'feedback-message p-3 my-3 text-sm rounded-md border bg-red-100 border-red-300 text-red-700 visible';
    element.style.display = 'block';
    element.setAttribute('aria-live', 'assertive');
    element.setAttribute('tabindex', '-1');
    element.focus();
  }
}

export function clearFeedback(elementOrId) {
  const element = getElement(elementOrId); // Corrección aplicada
  if (element) {
    element.textContent = '';
    element.style.display = 'none';
    element.className = '';
    element.removeAttribute('tabindex');
    element.removeAttribute('aria-live');
  }
}

// --- FORMULARIO CARGANDO (para deshabilitar mientras procesa) ---
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
// En tu archivo uiUtils.js

/**
 * Formatea un valor numérico como moneda.
 * @param {number} value - El valor numérico a formatear.
 * @param {string} [simboloMoneda='$'] - El símbolo de la moneda a mostrar (ej. $, €, S/).
 * @param {string} [codigoISONacion='COP'] - El código de moneda ISO 4217 de 3 letras (ej. COP, USD).
 * @param {number} [decimales=0] - El número de decimales a mostrar.
 * @returns {string} - El valor formateado como string de moneda.
 */
export function formatCurrency(value, simboloMoneda = '$', codigoISONacion = 'COP', decimales = 0) {
    if (typeof value !== 'number' || isNaN(value)) {
        value = 0;
    }

    const isValidISOCode = typeof codigoISONacion === 'string' && /^[A-Z]{3}$/i.test(codigoISONacion);
    const safeISOCode = isValidISOCode ? codigoISONacion.toUpperCase() : 'USD';

    try {
        const formatter = new Intl.NumberFormat('es-CO', {
            style: 'currency',
            currency: safeISOCode,
            minimumFractionDigits: decimales,
            maximumFractionDigits: decimales,
        });
        
        let formattedString = formatter.format(value);
        const parts = formatter.formatToParts(value);
        const currencyPart = parts.find(part => part.type === 'currency');

        if (currencyPart && currencyPart.value !== simboloMoneda) {
            formattedString = formattedString.replace(currencyPart.value, simboloMoneda);
        } else if (!currencyPart && formattedString.includes(safeISOCode)) {
            formattedString = formattedString.replace(safeISOCode, simboloMoneda);
        }
        
        return formattedString;

    } catch (e) {
        console.warn(`Error en Intl.NumberFormat con código '${safeISOCode}'. Usando fallback de formateo manual. Error: ${e.message}`);
        let numeroFormateado = Number(value).toFixed(decimales);
        const [entero, decimalStr] = numeroFormateado.split('.');
        const enteroFormateado = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        return decimales > 0 && decimalStr ? `${simboloMoneda} ${enteroFormateado},${decimalStr}` : `${simboloMoneda} ${enteroFormateado}`;
    }
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

// --- FEEDBACK DE ÉXITO ---
export function showSuccess(elementOrId, message, autoHide = true, duration = 4000) {
  const element = getElement(elementOrId); // Corrección aplicada
  if (element) {
    element.textContent = message;
    element.className = 'feedback-message p-3 my-3 text-sm rounded-md border bg-green-100 border-green-300 text-green-700 visible';
    element.style.display = 'block';
    element.setAttribute('aria-live', 'polite');
    if (autoHide) {
      setTimeout(() => {
        if (element && element.textContent === message) {
            clearFeedback(element);
        }
      }, duration);
    }
  }
}

/**
 * Formatea minutos a un string legible (ej: "2h 30m").
 * @param {number} totalMinutes - Total de minutos.
 * @returns {string} - String formateado.
 */
export function formatMinutesToHoursMinutes(totalMinutes) {
    if (typeof totalMinutes !== 'number' || isNaN(totalMinutes) || totalMinutes < 0) {
        return 'N/A';
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    let durationString = '';
    if (hours > 0) durationString += `${hours}h `;
    if (minutes > 0) durationString += `${minutes}m`;
    if (durationString === '') durationString = '0m';
    return durationString.trim();
}

/**
 * Llama a la función de la base de datos para incrementar el contador de un descuento.
 * Esta es la función centralizada y correcta.
 * @param {SupabaseClient} supabase - La instancia activa de Supabase.
 * @param {string} descuentoId - El UUID del descuento que se utilizó.
 */
export async function registrarUsoDescuento(supabase, descuentoId) {
    // Si no se pasó un ID de descuento, no hacemos nada.
    if (!descuentoId) return;

    try {
        // La llamada RPC estandarizada con el nombre de parámetro correcto.
        const { error } = await supabase.rpc('incrementar_uso_descuento', {
            descuento_id_param: descuentoId
        });

        if (error) {
            // Este error ya no debería ocurrir, pero lo dejamos por si acaso.
            console.error('Error al registrar el uso del descuento:', error);
        } else {
            console.log(`Uso registrado exitosamente para el descuento ID: ${descuentoId}`);
        }
    } catch (err) {
        console.error('Excepción al intentar registrar el uso del descuento:', err);
    }
}

// Agrega esta función a tu archivo /js/uiUtils.js

/**
 * Muestra un modal de confirmación moderno y profesional.
 * @param {string} title - El título del modal.
 * @param {string} text - El texto o HTML del cuerpo del modal.
 * @param {string} confirmButtonText - El texto para el botón de confirmación.
 * @returns {Promise<boolean>} - Una promesa que resuelve a `true` si el usuario confirma, `false` si cancela.
 */
export async function showConfirmationModal({
    title = '¿Estás seguro?',
    text = 'Esta acción no se puede revertir.',
    confirmButtonText = 'Sí, continuar'
}) {
    const result = await Swal.fire({
        title: title,
        html: text, // Usamos 'html' para permitir etiquetas como <strong>
        icon: 'warning',
        iconColor: '#f59e0b', // Un color ámbar para la advertencia
        showCancelButton: true,
        confirmButtonColor: '#dc2626', // Rojo para acciones destructivas
        cancelButtonColor: '#6b7280',  // Gris para cancelar
        confirmButtonText: confirmButtonText,
        cancelButtonText: 'Cancelar',
        customClass: {
            popup: 'rounded-xl shadow-lg',
            confirmButton: 'button button-danger py-2 px-5',
            cancelButton: 'button button-neutral py-2 px-5'
        },
        buttonsStyling: false // Importante para que tome nuestras clases
    });
    return result.isConfirmed;
}
export async function notificarAlegraViaZapier(supabase, hotelId, datosVenta) {
  const { data } = await supabase
    .from("hoteles")
    .select("alegra_webhook_url")
    .eq("id", hotelId)
    .single();
  const urlWebhook = data?.alegra_webhook_url;
  if (!urlWebhook) return; // Si el hotel no lo configuró, simplemente no se envía

  try {
    await fetch(urlWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datosVenta),
    });
  } catch (err) {
    // Puedes mostrar feedback al usuario si lo deseas, pero lo normal es solo loguear el error
    console.warn("No se pudo notificar a Zapier/Alegra:", err);
  }
}
