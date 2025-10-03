// js/modules/cronometros/cronometros.js
// import { supabase } from '../../supabaseClient.js'; // Using supabaseInstance from mount
import {
  formatDateTime,
  // showLoading, // Not directly used, loading messages are custom HTML
  showError,
  clearFeedback
} from '/js/uiUtils.js';

let intervalosActivos = new Map(); // Stores active setInterval IDs, keyed by cronometro.id
let moduleListeners = []; // Stores event listeners added by this module

/**
 * Formats milliseconds into a string like "00h 00m 00s".
 * @param {number} ms - Milliseconds to format.
 * @returns {string} Formatted time string.
 */
function formatRemainingTime(ms) {
  if (ms <= 0) return "00h 00m 00s";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
}

/**
 * Starts or updates the countdown for a given cronometro.
 * @param {object} cronometro - The cronometro object (must have id, fecha_fin).
 * @param {HTMLElement} spanEl - The <span> element to display the remaining time.
 */
function iniciarOActualizarCuentaRegresiva(cronometro, spanEl) {
  if (!spanEl) {
    console.warn(`Span element for cronometro ${cronometro.id} not found.`);
    return;
  }
  if (!cronometro || !cronometro.id || !cronometro.fecha_fin) {
    console.error('Invalid cronometro object passed to countdown:', cronometro);
    spanEl.textContent = 'Error de datos';
    spanEl.className = 'tiempo-restante-valor text-danger font-weight-bold';
    return;
  }

  // Clear any existing interval for this cronometro
  if (intervalosActivos.has(cronometro.id)) {
    clearInterval(intervalosActivos.get(cronometro.id));
    intervalosActivos.delete(cronometro.id);
  }

  function actualizar() {
    const ahora = new Date();
    const fin = new Date(cronometro.fecha_fin);
    const diff = fin - ahora; // Difference in milliseconds

    const card = spanEl.closest('.habitacion-card');

    if (diff <= 0) {
      spanEl.textContent = 'Tiempo Vencido';
      spanEl.className = 'tiempo-restante-valor text-danger font-weight-bold';
      if (intervalosActivos.has(cronometro.id)) {
        clearInterval(intervalosActivos.get(cronometro.id));
        intervalosActivos.delete(cronometro.id);
      }
      if (card) {
        card.classList.add('tiempo-vencido');
        card.classList.remove('cronometro-activo');
        const extenderBtn = card.querySelector('button[data-accion="extender"]');
        if (extenderBtn) extenderBtn.disabled = true;
        const finalizarBtn = card.querySelector('button[data-accion="finalizar"]');
        // Optionally, change "Finalizar" text or disable if already handled by backend state
        // if (finalizarBtn) finalizarBtn.textContent = "Cerrar"; 
      }
    } else {
      spanEl.textContent = formatRemainingTime(diff);
      // Base class + conditional classes
      spanEl.className = 'tiempo-restante-valor'; // Reset classes
      if (diff < 5 * 60 * 1000 && diff > 0) { // Less than 5 minutes remaining
        spanEl.classList.add('text-warning', 'font-weight-bold');
      } else {
        spanEl.classList.add('text-success');
      }
      if (card) {
        card.classList.add('cronometro-activo');
        card.classList.remove('tiempo-vencido');
        const extenderBtn = card.querySelector('button[data-accion="extender"]');
        if (extenderBtn) extenderBtn.disabled = false;
      }
    }
  }

  actualizar(); // Initial call to set time immediately
  const intervalId = setInterval(actualizar, 1000);
  intervalosActivos.set(cronometro.id, intervalId);
}

/**
 * Renders the list of cronometros in the given container.
 * @param {HTMLElement} cronometrosContainer - The container to render into.
 * @param {Array<object>} data - Array of cronometro objects.
 */
function renderCronometros(cronometrosContainer, data) {
  if (!cronometrosContainer) {
    console.error("Cronometros container not found for rendering.");
    return;
  }
  cronometrosContainer.innerHTML = ''; // Clear previous content

  if (!data || data.length === 0) {
    cronometrosContainer.innerHTML = '<p class="text-center p-2">No hay cronómetros activos en este momento.</p>';
    return;
  }

  data.forEach(item => {
    const card = document.createElement('div');
    // Ensure 'estado-ocupada' or similar is relevant or dynamically set if needed
    card.className = 'habitacion-card estado-ocupada cronometro-activo';
    card.dataset.cronometroId = item.id;
    if(item.habitacion_id) card.dataset.habitacionId = item.habitacion_id;

    const habitacionNombre = item.habitaciones?.nombre || (item.habitacion_id ? `Habitación ${item.habitacion_id.slice(0, 6)}...` : 'N/A');

    card.innerHTML = `
      <h3 class="text-lg font-semibold mb-1">${habitacionNombre}</h3>
      <p class="text-sm mb-1"><strong>Finaliza:</strong> ${formatDateTime(item.fecha_fin)}</p>
      <p class="text-sm mb-2">
        <strong>Tiempo Restante:</strong> 
        <span id="tiempo-restante-${item.id}" class="tiempo-restante-valor">Calculando...</span>
      </p>
      <div class="form-actions flex justify-around items-center mt-2">
        <button class="button button-accent button-small py-1 px-2" data-accion="extender" data-id="${item.id}">Extender</button>
        <button class="button button-danger button-small py-1 px-2" data-accion="finalizar" data-id="${item.id}">Finalizar</button>
      </div>
      <div id="feedback-${item.id}" class="feedback-inline mt-1 text-xs" role="status" style="display:none;"></div>
    `;
    cronometrosContainer.appendChild(card);

    const spanTiempoRestante = card.querySelector(`#tiempo-restante-${item.id}`);
    iniciarOActualizarCuentaRegresiva(item, spanTiempoRestante);
  });
}

/**
 * Fetches cronometros from Supabase and renders them.
 * @param {HTMLElement} cronometrosContainer - The container for cronometros.
 * @param {string} hotelId - The ID of the current hotel.
 * @param {object} supabaseInstance - The Supabase client instance.
 * @param {HTMLElement} feedbackGlobalEl - Global feedback element for this module.
 */
async function cargarYRenderizarCronometros(cronometrosContainer, hotelId, supabaseInstance, feedbackGlobalEl) {
  if (!cronometrosContainer) return;
  
  cronometrosContainer.innerHTML = '<p class="loading-indicator visible p-2 text-center">Cargando cronómetros...</p>';
  if (feedbackGlobalEl) clearFeedback(feedbackGlobalEl);

  try {
    const { data, error } = await supabaseInstance
      .from('cronometros')
      .select(`
        id,
        habitacion_id,
        fecha_fin,
        activo,
        habitaciones (nombre) 
      `)
      .eq('hotel_id', hotelId)
      .eq('activo', true) // Only fetch active cronometers
      .order('fecha_fin', { ascending: true });

    if (error) throw error;

    renderCronometros(cronometrosContainer, data);
    if (data.length === 0 && feedbackGlobalEl) {
        // No showError, as it's not an error, just no data. renderCronometros handles the message.
    }

  } catch (err) {
    console.error('Error loading cronometros:', err);
    cronometrosContainer.innerHTML = `<p class="error-indicator visible p-2 text-center text-danger">Error al cargar cronómetros: ${err.message}</p>`;
    if (feedbackGlobalEl) showError(feedbackGlobalEl, `Error al cargar datos: ${err.message}`);
  }
}

// --- Funciones de Acción (Implementar Lógica) ---

/**
 * PLACEHOLDER: Extends a cronometro.
 * You need to implement this function.
 * It might involve showing a modal to get extension duration,
 * then updating Supabase and re-rendering.
 */
async function extenderCronometro(cronometroId, habitacionId, hotelId, feedbackElement, supabaseInstance, cronometrosContainer, feedbackGlobalEl) {
  if (feedbackElement) showLoading(feedbackElement, "Procesando extensión...");
  console.log(`Extender cronómetro: ${cronometroId}, Habitación: ${habitacionId}`);
  
  // Example: Prompt for extension time (e.g., in minutes)
  const extensionMinutos = prompt("¿Cuántos minutos desea extender? (ej: 30, 60)", "30");
  if (extensionMinutos === null) { // User cancelled
    if (feedbackElement) clearFeedback(feedbackElement);
    return;
  }
  
  const extensionMs = parseInt(extensionMinutos) * 60 * 1000;
  if (isNaN(extensionMs) || extensionMs <= 0) {
    if (feedbackElement) showError(feedbackElement, "Tiempo de extensión inválido.");
    setTimeout(() => clearFeedback(feedbackElement), 3000);
    return;
  }

  try {
    // 1. Get current cronometro to calculate new fecha_fin
    const { data: currentCronometro, error: fetchError } = await supabaseInstance
        .from('cronometros')
        .select('fecha_fin')
        .eq('id', cronometroId)
        .single();

    if (fetchError) throw fetchError;
    if (!currentCronometro) throw new Error("Cronómetro no encontrado.");

    const nuevaFechaFin = new Date(new Date(currentCronometro.fecha_fin).getTime() + extensionMs);

    // 2. Update Supabase
    const { error: updateError } = await supabaseInstance
      .from('cronometros')
      .update({ fecha_fin: nuevaFechaFin.toISOString(), updated_at: new Date().toISOString() })
      .eq('id', cronometroId);

    if (updateError) throw updateError;

    if (feedbackElement) {
        showError(feedbackElement, "¡Extendido!", "success-indicator"); // Using showError for success message styling
        setTimeout(() => clearFeedback(feedbackElement), 2000);
    }
    // 3. Refresh all cronometros or just update this one
    await cargarYRenderizarCronometros(cronometrosContainer, hotelId, supabaseInstance, feedbackGlobalEl);

  } catch (err) {
    console.error("Error extendiendo cronómetro:", err);
    if (feedbackElement) showError(feedbackElement, `Error: ${err.message}`);
  }
}

/**
 * PLACEHOLDER: Finalizes a cronometro.
 * You need to implement this function.
 * It should set 'activo = false' in Supabase and potentially update room status,
 * then re-render.
 */
async function finalizarCronometro(cronometroId, habitacionId, hotelId, feedbackElement, supabaseInstance, cronometrosContainer, feedbackGlobalEl) {
  if (feedbackElement) showLoading(feedbackElement, "Finalizando...");
  console.log(`Finalizar cronómetro: ${cronometroId}, Habitación: ${habitacionId}`);

  // Confirmation before finalizing
  if (!confirm(`¿Está seguro de que desea finalizar el tiempo para esta habitación?`)) {
      if (feedbackElement) clearFeedback(feedbackElement);
      return;
  }

  try {
    // Update Supabase: set activo = false
    const { error } = await supabaseInstance
      .from('cronometros')
      .update({ activo: false, fecha_finalizado_manual: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', cronometroId);

    if (error) throw error;

    // Optional: Update related room status if applicable
    // if (habitacionId) {
    //   await supabaseInstance.from('habitaciones').update({ estado_id: ID_ESTADO_DISPONIBLE_LIMPIEZA })
    //     .eq('id', habitacionId);
    // }

    if (feedbackElement) {
        showError(feedbackElement, "¡Finalizado!", "success-indicator");
        setTimeout(() => clearFeedback(feedbackElement), 2000);
    }
    // Refresh the list of cronometros
    await cargarYRenderizarCronometros(cronometrosContainer, hotelId, supabaseInstance, feedbackGlobalEl);

  } catch (err) {
    console.error("Error finalizando cronómetro:", err);
    if (feedbackElement) showError(feedbackElement, `Error: ${err.message}`);
  }
}


export async function mount(container, supabaseInstance, currentUser) {
  if (!container || !supabaseInstance || !currentUser) {
    console.error("Cronometros module: Container, Supabase instance, or current user is missing.");
    if (container) container.innerHTML = "<p class='text-danger p-2'>Error de inicialización del módulo de cronómetros.</p>";
    return;
  }

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2 class="text-xl font-semibold">Cronómetros Activos</h2>
      </div>
      <div class="card-body">
        <div id="cronometros-global-feedback" role="status" aria-live="polite" class="mb-2" style="min-height: 24px;"></div>
        <div id="cronometros-contenedor" class="grid-habitaciones grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          </div>
      </div>
    </div>
  `;

  const cronometrosContainer = container.querySelector('#cronometros-contenedor');
  const feedbackGlobalEl = container.querySelector('#cronometros-global-feedback');

  let hotelId = currentUser.user_metadata?.hotel_id;
  if (!hotelId) {
    try {
      const { data: perfil, error: perfilError } = await supabaseInstance
        .from('usuarios')
        .select('hotel_id')
        .eq('id', currentUser.id)
        .single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError;
      hotelId = perfil?.hotel_id;
    } catch (err) {
      console.error("Error fetching hotel_id for cronometros:", err);
    }
  }

  if (!hotelId) {
    showError(feedbackGlobalEl, 'Error: Hotel no identificado. No se pueden cargar los cronómetros.');
    cronometrosContainer.innerHTML = '<p class="text-danger text-center p-2">Hotel no identificado.</p>';
    return;
  }

  // Clean up listeners from any previous mount
  unmount(container); // Call unmount to clear old listeners and intervals

  // Event delegation for action buttons within cronometro cards
  const handleCronometroActionClick = async (event) => {
    const button = event.target.closest('button[data-accion]');
    if (!button) return;

    const cronometroId = button.dataset.id;
    const accion = button.dataset.accion;
    const cardElement = button.closest('.habitacion-card');
    const habitacionId = cardElement?.dataset.habitacionId;
    const inlineFeedbackEl = cardElement ? cardElement.querySelector(`#feedback-${cronometroId}`) : null;

    if (!cronometroId) return;

    button.disabled = true; // Disable button to prevent double clicks

    if (accion === 'extender') {
      await extenderCronometro(cronometroId, habitacionId, hotelId, inlineFeedbackEl, supabaseInstance, cronometrosContainer, feedbackGlobalEl);
    } else if (accion === 'finalizar') {
      await finalizarCronometro(cronometroId, habitacionId, hotelId, inlineFeedbackEl, supabaseInstance, cronometrosContainer, feedbackGlobalEl);
    }
    
    // Re-enable button if it still exists (it might be removed if card re-renders)
    const stillExistsButton = document.querySelector(`button[data-id="${cronometroId}"][data-accion="${accion}"]`);
    if (stillExistsButton) stillExistsButton.disabled = false;
  };

  cronometrosContainer.addEventListener('click', handleCronometroActionClick);
  moduleListeners.push({ element: cronometrosContainer, type: 'click', handler: handleCronometroActionClick });

  // Initial load
  await cargarYRenderizarCronometros(cronometrosContainer, hotelId, supabaseInstance, feedbackGlobalEl);
}

export function unmount(container) { // container param is for consistency, not strictly used if IDs are unique
  // Clear all active intervals
  intervalosActivos.forEach(intervalId => clearInterval(intervalId));
  intervalosActivos.clear();

  // Remove all event listeners added by this module
  moduleListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = []; // Reset the array for the current mount

  // Optional: Clear the container's content if this module is truly being removed
  // if (container) container.innerHTML = '';
  console.log('Cronometros module unmounted, intervals and listeners cleared.');
}
