// js/modules/reservas/reservas.js
import { requireAuth, getCurrentUser } from '../../authService.js';
import { showLoading, showError, clearFeedback } from '../../uiUtils.js';
import { mostrarFechaLocal } from '../../uiUtils.js';

// --- Module-Scoped Variables ---
let currentContainerEl = null;
let formEl = null;
let roomSelectEl = null;
let checkinInputEl = null;
let checkoutInputEl = null;
let submitButtonEl = null;
let loadingEl = null;
let feedbackEl = null;

let moduleListeners = [];
let currentSupabaseInstance = null;
let currentAuthUser = null;
let currentHotelId = null;

// --- UI Helper for Success Messages ---
function showSuccessFeedback(feedbackElement, message) {
  if (!feedbackElement) {
    console.warn("Feedback element not provided to showSuccessFeedback");
    return;
  }
  feedbackElement.textContent = message;
  feedbackElement.className = 'feedback-message p-3 my-3 text-sm bg-green-100 border border-green-300 text-green-700 rounded-md visible';
  feedbackElement.style.display = 'block';
  feedbackElement.setAttribute('aria-live', 'polite');
}

async function cargarHabitaciones(selectElement, localFeedbackEl, localLoadingEl, supabaseInstance, hotelId) {
  if (!selectElement || !localFeedbackEl || !localLoadingEl || !supabaseInstance || !hotelId) {
    console.error("cargarHabitaciones: Missing required parameters.");
    if (localFeedbackEl) showError(localFeedbackEl, 'Error interno al cargar habitaciones (parámetros faltantes).');
    return;
  }

  clearFeedback(localLoadingEl);
  clearFeedback(localFeedbackEl);
  showLoading(localLoadingEl, 'Cargando habitaciones disponibles...');
  selectElement.disabled = true;

  try {
    const { data: rooms, error: roomsError } = await supabaseInstance
      .from('habitaciones')
      .select('id, nombre, precio') // Asumiendo que la columna es 'precio'
      .eq('hotel_id', hotelId)
      .eq('estado', 'libre') 
      .eq('activo', true)    
      .order('nombre', { ascending: true });

    if (roomsError) throw roomsError;

    selectElement.innerHTML = '<option value="">-- Selecciona una habitación --</option>';
    if (rooms && rooms.length > 0) {
      rooms.forEach(room => {
        selectElement.insertAdjacentHTML('beforeend', `<option value="${room.id}">${room.nombre}</option>`);
      });
    } else {
      selectElement.innerHTML = '<option value="" disabled>No hay habitaciones disponibles</option>';
      showError(localFeedbackEl, 'Actualmente no hay habitaciones disponibles que coincidan con los criterios.');
    }
  } catch (err) {
    console.error('Error cargando habitaciones para reservas:', err);
    showError(localFeedbackEl, err.message || 'Error al cargar datos de habitaciones.');
    selectElement.innerHTML = '<option value="" disabled>Error al cargar habitaciones</option>';
  } finally {
    clearFeedback(localLoadingEl);
    selectElement.disabled = false;
  }
}

function validarFechas(checkinDateStr, checkoutDateStr) {
  const ci = new Date(checkinDateStr + "T00:00:00");
  const co = new Date(checkoutDateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0,0,0,0); 

  if (!(ci instanceof Date && !isNaN(ci)) || !(co instanceof Date && !isNaN(co))) {
    return false; 
  }
  if (ci < today) {
    return false; 
  }
  return ci < co; 
}

async function handleReservaSubmit(event) {
  event.preventDefault();
  if (!loadingEl || !feedbackEl || !submitButtonEl || !roomSelectEl || !checkinInputEl || !checkoutInputEl || !formEl) {
    console.error("handleReservaSubmit: Elementos del DOM no están disponibles en el momento del submit.");
    if (feedbackEl) showError(feedbackEl, "Error interno del formulario de reservas (elementos faltantes en submit).");
    else alert("Error interno del formulario. Por favor, recargue la página.");
    return;
  }

  clearFeedback(loadingEl);
  clearFeedback(feedbackEl); 
  showLoading(loadingEl, 'Procesando reserva...');
  submitButtonEl.disabled = true;

  const roomId = roomSelectEl.value;
  const checkinDate = checkinInputEl.value;
  const checkoutDate = checkoutInputEl.value;

  if (!roomId || roomId === "") {
    showError(feedbackEl, 'Por favor, selecciona una habitación.');
    clearFeedback(loadingEl);
    submitButtonEl.disabled = false;
    return;
  }
  if (!checkinDate || !checkoutDate) {
    showError(feedbackEl, 'Las fechas de entrada y salida son obligatorias.');
    clearFeedback(loadingEl);
    submitButtonEl.disabled = false;
    return;
  }
  if (!validarFechas(checkinDate, checkoutDate)) {
    showError(feedbackEl, 'La fecha de entrada no puede ser en el pasado y la fecha de salida debe ser posterior a la de entrada.');
    clearFeedback(loadingEl);
    submitButtonEl.disabled = false;
    return;
  }

  try {
    const payload = {
      p_habitacion_id: roomId,
      p_fecha_inicio: checkinDate,
      p_fecha_fin: checkoutDate,
      p_usuario_id: currentAuthUser.id,
      p_cliente_nombre: formEl.elements.clienteNombre?.value || 'Cliente Por Definir',
      p_monto_total: 0, 
      p_estado: 'pendiente', 
    };
    console.log("Enviando a RPC registrar_reserva_webhook:", payload);

    const { error: rpcError } = await currentSupabaseInstance.rpc('registrar_reserva_webhook', payload);

    if (rpcError) throw rpcError;

    showSuccessFeedback(feedbackEl, '¡Reserva creada exitosamente!');
    formEl.reset(); 
    await cargarHabitaciones(roomSelectEl, feedbackEl, loadingEl, currentSupabaseInstance, currentHotelId);
  } catch (err) {
    console.error('Error creando reserva:', err);
    showError(feedbackEl, err.details || err.message || 'Ocurrió un error al crear la reserva. Por favor, intente de nuevo.');
  } finally {
    clearFeedback(loadingEl);
    if (submitButtonEl) submitButtonEl.disabled = false;
  }
}

export async function mount(container, supabaseInstance, authUser) {
  unmount(); 

  currentContainerEl = container;
  currentSupabaseInstance = supabaseInstance;
  currentAuthUser = authUser;

  console.log("Reservas.mount: currentContainerEl ANTES de innerHTML:", currentContainerEl);

  if (!currentAuthUser || !currentAuthUser.id) {
      console.warn("Reservas: Usuario no autenticado.");
      currentContainerEl.innerHTML = '<p class="p-4 text-red-600">Acceso denegado. Por favor, inicie sesión.</p>';
      return;
  }

  currentHotelId = currentAuthUser?.user_metadata?.hotel_id;
  if (!currentHotelId && currentAuthUser?.id) {
    try {
      const { data: perfil, error: perfilError } = await currentSupabaseInstance
        .from('usuarios')
        .select('hotel_id')
        .eq('id', currentAuthUser.id)
        .single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError;
      currentHotelId = perfil?.hotel_id;
    } catch (err) {
      console.error("Reservas: Error fetching hotel_id from profile:", err);
    }
  }

  const htmlContent = `
    <div class="reserva-module max-w-2xl mx-auto p-4 md:p-6 bg-white shadow-xl rounded-lg">
      <h2 class="text-2xl font-semibold text-gray-800 mb-6 text-center">Crear Nueva Reserva</h2>
      
      <div id="reservaLoadingIndicator" class="loading-indicator my-3 p-3 text-sm bg-blue-100 border border-blue-300 text-blue-700 rounded-md" style="display:none;" aria-live="polite"></div>
      <div id="reservaFeedbackMessage" class="feedback-message my-3" style="display:none;" aria-live="assertive"></div> 
      
      <form id="reserva-form" class="space-y-6">
        <div>
          <label for="roomSelect" class="block text-sm font-medium text-gray-700 mb-1">Habitación Disponible *</label>
          <select id="roomSelect" name="roomId" class="form-select mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" required>
            <option value="">-- Selecciona una habitación --</option>
          </select>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label for="checkin" class="block text-sm font-medium text-gray-700 mb-1">Fecha de Entrada *</label>
            <input type="date" id="checkin" name="checkinDate" class="form-input mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" required />
          </div>
          <div>
            <label for="checkout" class="block text-sm font-medium text-gray-700 mb-1">Fecha de Salida *</label>
            <input type="date" id="checkout" name="checkoutDate" class="form-input mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" required />
          </div>
        </div>
        <div>
            <label for="clienteNombre" class="block text-sm font-medium text-gray-700 mb-1">Nombre del Cliente</label>
            <input type="text" id="clienteNombre" name="clienteNombre" class="form-input mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm sm:text-sm" placeholder="Nombre completo del huésped principal" />
        </div>
        <div>
            <label for="numeroHuespedes" class="block text-sm font-medium text-gray-700 mb-1">Número de Huéspedes</label>
            <input type="number" id="numeroHuespedes" name="numeroHuespedes" class="form-input mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm sm:text-sm" min="1" value="1" />
        </div>
        
        <div>
          <button type="submit" id="btnReserva" class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50">
            Confirmar Reserva
          </button>
        </div>
      </form>
    </div>`;
  
  currentContainerEl.innerHTML = htmlContent;

  // Usar requestAnimationFrame para asegurar que el DOM se haya actualizado
  requestAnimationFrame(async () => {
    console.log('Reservas.mount: Dentro de requestAnimationFrame.');
    console.log('Reservas.mount: Contenido de currentContainerEl DESPUÉS de innerHTML y ANTES de querySelector:', currentContainerEl.innerHTML);

    formEl = currentContainerEl.querySelector('#reserva-form');
    roomSelectEl = currentContainerEl.querySelector('#roomSelect');
    checkinInputEl = currentContainerEl.querySelector('#checkin');
    checkoutInputEl = currentContainerEl.querySelector('#checkout');
    submitButtonEl = currentContainerEl.querySelector('#btnReserva');
    loadingEl = currentContainerEl.querySelector('#reservaLoadingIndicator'); 
    feedbackEl = currentContainerEl.querySelector('#reservaFeedbackMessage');  

    console.log("Reservas.mount: formEl (después de querySelector en rAF):", formEl);

    if (!currentHotelId) {
      if (feedbackEl) showError(feedbackEl, 'Error crítico: No se pudo identificar el hotel. No se pueden crear reservas.');
      if (formEl) formEl.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
      return;
    }

    if (!formEl || !roomSelectEl || !checkinInputEl || !checkoutInputEl || !submitButtonEl || !loadingEl || !feedbackEl) {
      console.error("Reservas: Uno o más elementos del DOM del formulario no fueron encontrados después de renderizar (dentro de rAF). Verifica los IDs en el HTML y el contenido de currentContainerEl.");
      if(feedbackEl) showError(feedbackEl, "Error interno: No se pudo inicializar el formulario de reservas. Faltan elementos (rAF).");
      return;
    }

    await cargarHabitaciones(roomSelectEl, feedbackEl, loadingEl, currentSupabaseInstance, currentHotelId);

    if (formEl) {
      formEl.addEventListener('submit', handleReservaSubmit);
      moduleListeners.push({ element: formEl, type: 'submit', handler: handleReservaSubmit });
    } else {
      console.error("Reservas: formEl sigue siendo null ANTES de añadir el event listener para submit (dentro de rAF).");
      if(feedbackEl) showError(feedbackEl, "Error crítico: El formulario principal de reservas no se encontró en el DOM (rAF).");
    }
    
    const todayStr = new Date().toISOString().split('T')[0];
    if (checkinInputEl) checkinInputEl.setAttribute('min', todayStr);
    
    if (checkinInputEl && checkoutInputEl) {
      const updateCheckoutMinDate = () => {
        if (checkinInputEl.value) {
            const nextDay = new Date(checkinInputEl.value + "T00:00:00"); // Asegurar que se interpreta como local
            nextDay.setDate(nextDay.getDate() + 1); 
            checkoutInputEl.setAttribute('min', nextDay.toISOString().split('T')[0]);
            if (checkoutInputEl.value && new Date(checkoutInputEl.value + "T00:00:00") <= new Date(checkinInputEl.value + "T00:00:00")) {
                checkoutInputEl.value = nextDay.toISOString().split('T')[0];
            }
        } else {
            checkoutInputEl.setAttribute('min', todayStr);
        }
      };
      checkinInputEl.addEventListener('change', updateCheckoutMinDate);
      moduleListeners.push({ element: checkinInputEl, type: 'change', handler: updateCheckoutMinDate });
      // Establecer el mínimo inicial para checkout
      if (!checkinInputEl.value) {
         checkoutInputEl.setAttribute('min', todayStr);
      } else {
         updateCheckoutMinDate(); // Llamar para establecer el min basado en la fecha de checkin actual si existe
      }
    }
  }); // Fin de requestAnimationFrame
}

export function unmount() {
  moduleListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = [];

  if (currentContainerEl) {
    currentContainerEl.innerHTML = '';
  }
  currentContainerEl = null;
  formEl = null;
  roomSelectEl = null;
  checkinInputEl = null;
  checkoutInputEl = null;
  submitButtonEl = null;
  loadingEl = null;
  feedbackEl = null;
  currentSupabaseInstance = null;
  currentAuthUser = null;
  currentHotelId = null;

  console.log("Módulo de Reservas desmontado.");
}
