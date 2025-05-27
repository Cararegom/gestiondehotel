// js/modules/habitaciones/habitaciones.js
import { 
    formatCurrency, 
    showAppFeedback, 
    clearAppFeedback,
    setFormLoadingState,
    showError, 
    showLoading 
} from '../../uiUtils.js';

// --- Helpers para horario de hotel ---
let hotelCheckin = "15:00";
let hotelCheckout = "12:00";

function parseTimeToDate(date, horaStr) {
  const d = new Date(date);
  const [h, m] = horaStr.split(':').map(x=>parseInt(x));
  d.setHours(h, m, 0, 0);
  return d;
}
function calcMinutesBetween(a, b) {
  return Math.round((b - a)/60000);
}
function calcularMinutosNoche(checkin, checkout) {
  // checkin/checkout string 'HH:MM'
  const now = new Date();
  const inDate = parseTimeToDate(now, checkin);
  let outDate = parseTimeToDate(now, checkout);
  // Si checkout es menor, es el día siguiente
  if (outDate <= inDate) outDate.setDate(outDate.getDate() + 1);
  return calcMinutesBetween(inDate, outDate);
}

// --- Module-Scoped Variables ---
let moduleListeners = [];
let currentHotelId = null;
let currentModuleUser = null; 
let currentSupabaseInstance = null;
let todosLosTiemposEstanciaCache = [];
let currentContainerEl = null; 

/**
 * Formatea minutos a un string legible (ej: "2h 30m").
 */
function formatMinutesToHoursMinutes(totalMinutes) {
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

// --- UI Helper Functions (Específicas del módulo) ---
function showHabitacionesFeedback(feedbackElement, message, type = 'success', duration = 3000) {
  if (!feedbackElement) {
    console.warn("Feedback element not provided to showHabitacionesFeedback");
    return;
  }
  feedbackElement.textContent = message;
  let typeClasses = 'bg-green-100 border-green-300 text-green-700';
  if (type === 'error') {
    typeClasses = 'bg-red-100 border-red-300 text-red-700';
  } else if (type === 'info') {
    typeClasses = 'bg-blue-100 border-blue-300 text-blue-700';
  }
  
  feedbackElement.className = `feedback-message p-3 my-2 text-sm rounded-md border ${typeClasses} visible`;
  feedbackElement.style.display = 'block';
  feedbackElement.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

  if (type === 'error' && feedbackElement.focus) {
    feedbackElement.setAttribute('tabindex', '-1'); 
    feedbackElement.focus();
  }

  if (duration > 0) {
    setTimeout(() => clearHabitacionesFeedbackLocal(feedbackElement), duration);
  }
}

function clearHabitacionesFeedbackLocal(feedbackElement) {
  if (!feedbackElement) return;
  feedbackElement.textContent = '';
  feedbackElement.style.display = 'none';
  feedbackElement.className = 'feedback-message'; 
  feedbackElement.removeAttribute('tabindex');
  feedbackElement.removeAttribute('aria-live');
}

function setTableLoadingState(tbodyEl, message = "Cargando...") {
    if (tbodyEl) {
        tbodyEl.innerHTML = `<tr><td colspan="100%" class="text-center p-3 text-gray-500">${message}</td></tr>`;
    }
}
function setTableEmptyState(tbodyEl, message = "No hay datos para mostrar.") {
    if (tbodyEl) {
        tbodyEl.innerHTML = `<tr><td colspan="100%" class="text-center p-3 text-gray-500">${message}</td></tr>`;
    }
}
function setTableErrorState(tbodyEl, message = "Error al cargar datos.") {
    if (tbodyEl) {
        tbodyEl.innerHTML = `<tr><td colspan="100%" class="text-red-600 text-center p-3">${message}</td></tr>`;
    }
}
// --- Lógica para Tiempos de Estancia ---
async function cargarYRenderizarTiemposEstancia(tbodyEl, supabaseInst, hotelId, feedbackEl) {
  if (!tbodyEl || !supabaseInst || !hotelId) {
    console.error("cargarYRenderizarTiemposEstancia: Faltan parámetros o hotelId es null. hotelId:", hotelId);
    setTableErrorState(tbodyEl, "Error: Hotel no identificado para cargar tiempos.");
    return;
  }
  setTableLoadingState(tbodyEl, "Cargando tiempos de estancia...");

  try {
    const { data: tiempos, error } = await supabaseInst
      .from('tiempos_estancia')
      .select('id, nombre, minutos, precio_adicional, activo, user_id')
      .eq('hotel_id', hotelId) 
      .order('minutos', { ascending: true });
    if (error) throw error;

    todosLosTiemposEstanciaCache = tiempos || [];
    tbodyEl.innerHTML = '';
    if (tiempos.length === 0) {
      setTableEmptyState(tbodyEl, "No hay tiempos de estancia creados para este hotel.");
    } else {
      tiempos.forEach(t => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-50";
        tr.dataset.tiempoId = t.id;
        tr.innerHTML = `
          <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${t.nombre}</td>
          <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${formatMinutesToHoursMinutes(t.minutos)}</td>
          <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${formatCurrency(t.precio_adicional)}</td>
          <td class="px-4 py-2 whitespace-nowrap text-sm">
            <span class="badge px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${t.activo ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
              ${t.activo ? 'Activo' : 'Inactivo'}
            </span>
          </td>
          <td class="px-4 py-2 whitespace-nowrap text-sm font-medium space-x-2">
            <button class="button button-outline button-small text-xs" data-accion="editar-tiempo" data-id="${t.id}" title="Editar ${t.nombre}">Editar</button>
            <button class="button button-small text-xs ${t.activo ? 'button-warning' : 'button-success'}" data-accion="toggle-activo-tiempo" data-id="${t.id}" data-estado-actual="${t.activo}" title="${t.activo ? 'Desactivar' : 'Activar'}">
              ${t.activo ? 'Desactivar' : 'Activar'}
            </button>
          </td>`;
        tbodyEl.appendChild(tr);
      });
    }
    if (currentContainerEl) {
        const selectHabitacionTiempos = currentContainerEl.querySelector('#habitacion-tiempos-estancia');
        if (selectHabitacionTiempos) populateTiemposEstanciaSelect(selectHabitacionTiempos);
    }
  } catch (err) {
    console.error('Error cargando tiempos de estancia:', err);
    setTableErrorState(tbodyEl, `Error al cargar tiempos: ${err.message}`);
    if(feedbackEl) showHabitacionesFeedback(feedbackEl, `Error al cargar tiempos de estancia: ${err.message}`, 'error');
  }
}

function populateFormularioTiempoEstancia(formEl, tiempoData, btnCancelarEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.tiempoEstanciaIdEdit.value = tiempoData.id;
  formEl.elements.nombreTiempo.value = tiempoData.nombre;
  formEl.elements.minutosTiempo.value = tiempoData.minutos;
  formEl.elements.precioAdicionalTiempo.value = tiempoData.precio_adicional || 0;
  formEl.elements.activoTiempo.checked = tiempoData.activo;
  formEl.querySelector('#btn-guardar-tiempo-estancia').textContent = 'Actualizar Tiempo';
  if (btnCancelarEl) btnCancelarEl.style.display = 'inline-block';
  formEl.elements.nombreTiempo.focus();
}

function resetearFormularioTiempoEstancia(formEl, btnCancelarEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.tiempoEstanciaIdEdit.value = '';
  formEl.elements.activoTiempo.checked = true;
  formEl.querySelector('#btn-guardar-tiempo-estancia').textContent = '＋ Crear Tiempo';
  if (btnCancelarEl) btnCancelarEl.style.display = 'none';
  formEl.elements.nombreTiempo.focus();
}


// --- CAMBIO IMPORTANTE: Si el nombre contiene "noche", minutos se calculan según los horarios de hotel configurados
async function handleTiempoEstanciaSubmit(event, formEl, tbodyEl, feedbackEl, btnGuardarEl, btnCancelarEl) {
    event.preventDefault();
    if (feedbackEl) clearHabitacionesFeedbackLocal(feedbackEl);
    
    const formData = new FormData(formEl);
    const nombreValue = formData.get('nombreTiempo')?.trim();
    const minutosValue = formData.get('minutosTiempo');
    const precio_adicional = parseFloat(formData.get('precioAdicionalTiempo')) || 0;
    const idEdit = formData.get('tiempoEstanciaIdEdit');
    const activoValue = formEl.elements.activoTiempo.checked;

    // --- CAMBIO: Si es "Noche", calcula minutos automáticamente usando el horario del hotel
    let minutosParsed = parseInt(minutosValue);
    if (nombreValue && nombreValue.toLowerCase().includes('noche')) {
      minutosParsed = calcularMinutosNoche(hotelCheckin, hotelCheckout);
      formEl.elements.minutosTiempo.value = minutosParsed;
    }

    const originalButtonText = btnGuardarEl.textContent;
    setFormLoadingState(formEl, true, btnGuardarEl, originalButtonText, 'Guardando...');

    if (!nombreValue || !minutosParsed || isNaN(minutosParsed) || minutosParsed <= 0) {
      showHabitacionesFeedback(feedbackEl, 'Nombre y minutos (mayor a 0) son obligatorios.', 'error');
      setFormLoadingState(formEl, false, btnGuardarEl, originalButtonText);
      if (!nombreValue) formEl.elements.nombreTiempo.focus();
      else if (!minutosParsed || isNaN(minutosParsed) || minutosParsed <= 0) formEl.elements.minutosTiempo.focus();
      return;
    }

    if (!currentHotelId) {
        showHabitacionesFeedback(feedbackEl, 'Error: No se pudo determinar el hotel para guardar.', 'error');
        setFormLoadingState(formEl, false, btnGuardarEl, originalButtonText);
        return;
    }
    if (!currentModuleUser || !currentModuleUser.id) {
        showHabitacionesFeedback(feedbackEl, 'Error: Usuario no identificado. No se puede guardar.', 'error');
        setFormLoadingState(formEl, false, btnGuardarEl, originalButtonText);
        return;
    }

    const payload = {
  hotel_id: currentHotelId,
  nombre: nombreValue,
  minutos: minutosParsed,
  precio: precio_adicional,   // ← Aquí está la clave
  precio_adicional,           // (opcional, puedes dejarlo para no romper lógica vieja)
  activo: activoValue,
  user_id: currentModuleUser.id 
};

    try {
      if (idEdit) {
        const updateData = { ...payload };
        delete updateData.user_id; 
        delete updateData.hotel_id; 
        const { error } = await currentSupabaseInstance.from('tiempos_estancia')
          .update(updateData).eq('id', idEdit).eq('hotel_id', currentHotelId);
        if (error) throw error;
        showHabitacionesFeedback(feedbackEl, 'Tiempo de estancia actualizado.', 'success');
      } else {
        const { data, error } = await currentSupabaseInstance.from('tiempos_estancia').insert(payload).select().single();
        if (error) throw error; 
        showHabitacionesFeedback(feedbackEl, 'Tiempo de estancia creado.', 'success');
      }
      resetearFormularioTiempoEstancia(formEl, btnCancelarEl);
      await cargarYRenderizarTiemposEstancia(tbodyEl, currentSupabaseInstance, currentHotelId, feedbackEl);
    } catch (err) {
      console.error('Error guardando tiempo de estancia:', err); 
      showHabitacionesFeedback(feedbackEl, `Error al guardar tiempo: ${err.message}`, 'error', 0);
    } finally {
      setFormLoadingState(formEl, false, btnGuardarEl, originalButtonText);
    }
}

function populateTiemposEstanciaSelect(selectEl, selectedIds = []) {
    if (!selectEl) return;
    const activeTiempos = todosLosTiemposEstanciaCache.filter(t => t.activo);
    selectEl.innerHTML = activeTiempos.length > 0
        ? activeTiempos.map(t => {
            const durationString = formatMinutesToHoursMinutes(t.minutos);
            return `<option value="${t.id}" ${selectedIds.includes(t.id.toString()) ? 'selected' : ''}>${t.nombre} (${durationString})</option>`;
          }).join('')
        : `<option value="" disabled>No hay tiempos activos. Defínalos primero.</option>`;
}
// --- Lógica para Habitaciones ---
async function renderHabitaciones(habitacionesContainer, supabaseInst, hotelId, feedbackEl) {
  if (!habitacionesContainer) {
    console.error("RenderHabitaciones: habitacionesContainer no encontrado.");
    if (feedbackEl) showHabitacionesFeedback(feedbackEl, "Error interno: Contenedor de habitaciones no disponible.", "error");
    return;
  }
  if (!hotelId) {
    console.error("RenderHabitaciones: hotelId es undefined. No se puede cargar habitaciones.");
    setTableErrorState(habitacionesContainer, "Error: Hotel no identificado para cargar habitaciones.");
    if (feedbackEl) showHabitacionesFeedback(feedbackEl, "Error: Hotel no identificado para cargar habitaciones.", "error");
    return;
  }
  setTableLoadingState(habitacionesContainer, "Cargando habitaciones...");
  if (feedbackEl) clearHabitacionesFeedbackLocal(feedbackEl);

  try {
  const { data: habitaciones, error } = await supabaseInst
    .from('habitaciones')
    .select(`
      id, nombre, tipo, precio, estado, activo, amenidades,
      habitacion_tiempos_permitidos (
        tiempo_estancia_id,
        tiempos_estancia (id, nombre, minutos)
      )
    `)
    .eq('hotel_id', hotelId)
    .order('nombre', { ascending: true });

  if (error) throw error;
  habitacionesContainer.innerHTML = '';

  // --- Ordena numéricamente por el número de habitación extraído del nombre ---
  habitaciones.sort((a, b) => {
    const getNumber = nombre => {
      const match = nombre.match(/\d+/);
      return match ? parseInt(match[0], 10) : 0;
    };
    return getNumber(a.nombre) - getNumber(b.nombre);
  });

  // ...el resto de tu lógica de render


    if (error) throw error;
    habitacionesContainer.innerHTML = '';

    if (!habitaciones || habitaciones.length === 0) {
      setTableEmptyState(habitacionesContainer, "No hay habitaciones registradas para este hotel.");
      return;
    }

    habitaciones.forEach(h => {
      const card = document.createElement('div');
      card.className = `habitacion-card card p-3 rounded shadow-sm estado-${h.estado || 'desconocido'} ${h.activo ? 'activa' : 'inactiva'}`;
      card.dataset.habitacionId = h.id;

      const estadoDisplay = h.estado ? h.estado.charAt(0).toUpperCase() + h.estado.slice(1) : 'Desconocido';
      const nombresTiemposEstancia = h.habitacion_tiempos_permitidos && h.habitacion_tiempos_permitidos.length > 0
        ? h.habitacion_tiempos_permitidos.map(htp => htp.tiempos_estancia?.nombre || 'Tiempo desc.').join(', ')
        : 'No asignados';

      card.innerHTML = `
        <div class="card-body">
          <div class="flex justify-between items-center mb-2">
            <h4 class="text-lg font-semibold mb-0 habitacion-nombre">${h.nombre} (${h.tipo || 'N/A'})</h4>
            <span class="badge estado-${h.estado || 'desconocido'} ${h.activo ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'} text-xs px-2 py-1 rounded-full">${estadoDisplay} ${h.activo ? '' : '(Inactiva)'}</span>
          </div>
          <p class="text-sm text-gray-600">Precio: ${h.precio ? formatCurrency(h.precio) : 'No definido'}</p>
          <p class="text-sm text-gray-600">Amenidades: ${h.amenidades && h.amenidades.length > 0 ? h.amenidades.join(', ') : 'Ninguna'}</p>
          <p class="text-xs text-gray-500 mt-1">Tiempos Permitidos: ${nombresTiemposEstancia}</p>
          <div class="habitacion-acciones mt-3 flex gap-2">
            <button data-accion="editar-habitacion" data-id="${h.id}" class="button button-outline button-small text-xs">Editar</button>
            <button data-accion="eliminar-habitacion" data-id="${h.id}" class="button button-danger button-small text-xs">Eliminar</button>
          </div>
        </div>
      `;
      habitacionesContainer.appendChild(card);
    });
  } catch (err) {
    console.error('Error loading rooms:', err);
    setTableErrorState(habitacionesContainer, `Error al cargar habitaciones: ${err.message}`);
    if (feedbackEl) showHabitacionesFeedback(feedbackEl, `Error al cargar habitaciones: ${err.message}`, 'error');
  }
}

function populateForm(formEl, selectTiemposEl, habitacionData, btnCancelarEl, btnGuardarEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.habitacionIdEdit.value = habitacionData.id;
  formEl.elements.nombre.value = habitacionData.nombre || '';
  formEl.elements.tipo.value = habitacionData.tipo || '';
  formEl.elements.precio.value = habitacionData.precio || '';
  formEl.elements.estado.value = habitacionData.estado || 'libre';
  formEl.elements.amenidades.value = habitacionData.amenidades?.join(', ') || '';
  formEl.elements.activo.checked = habitacionData.activo === undefined ? true : habitacionData.activo;

  const selectedTiempoIds = habitacionData.habitacion_tiempos_permitidos?.map(htp => htp.tiempo_estancia_id.toString()) || [];
  populateTiemposEstanciaSelect(selectTiemposEl, selectedTiempoIds);

  if (btnCancelarEl) btnCancelarEl.style.display = 'inline-block';
  if (btnGuardarEl) btnGuardarEl.textContent = 'Actualizar Habitación';
  formEl.elements.nombre.focus();
}

function resetForm(formEl, selectTiemposEl, btnCancelarEl, btnGuardarEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.habitacionIdEdit.value = '';
  formEl.elements.activo.checked = true;
  populateTiemposEstanciaSelect(selectTiemposEl);
  if (btnCancelarEl) btnCancelarEl.style.display = 'none';
  if (btnGuardarEl) btnGuardarEl.textContent = '＋ Crear Habitación';
  formEl.elements.nombre.focus();
}

async function handleHabitacionSubmit(event, formEl, selectTiemposEl, listaContainerEl, feedbackEl, btnGuardarEl, btnCancelarEl) {
    event.preventDefault();
    if (feedbackEl) clearHabitacionesFeedbackLocal(feedbackEl);
    const formData = new FormData(formEl);
    const nombreHabitacion = formData.get('nombre')?.trim();
    if (!nombreHabitacion) {
        if (feedbackEl) showHabitacionesFeedback(feedbackEl, 'El nombre de la habitación es obligatorio.', 'error', true);
        formEl.elements.nombre.focus();
        return;
    }
    
    const precioInput = formData.get('precio');
const precioHabitacion = precioInput !== '' && !isNaN(parseFloat(precioInput)) ? parseFloat(precioInput) : null;

const precioAdicionalHuesped = formData.get('precio_adicional_huesped');
const precioAdicional = precioAdicionalHuesped !== '' && !isNaN(parseFloat(precioAdicionalHuesped))
  ? parseFloat(precioAdicionalHuesped)
  : 0;

const habitacionPayload = {
  nombre: nombreHabitacion,
  tipo: formData.get('tipo')?.trim() || null,
  precio: precioHabitacion,
  precio_adicional_huesped: precioAdicional,  // ← ¡Aquí está el nuevo campo!
  estado: formData.get('estado'),
  amenidades: formData.get('amenidades')?.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) || null,
  hotel_id: currentHotelId,
  activo: formEl.elements.activo.checked
};


    const selectedTiempoIds = Array.from(selectTiemposEl.selectedOptions).map(o => o.value);
    const editId = formData.get('habitacionIdEdit');
    const originalButtonText = btnGuardarEl.textContent;
    setFormLoadingState(formEl, true, btnGuardarEl, originalButtonText, 'Guardando...');
    try {
      let savedRoomId = editId;
      if (editId) {
        const { data, error } = await currentSupabaseInstance.from('habitaciones')
          .update(habitacionPayload).eq('id', editId).eq('hotel_id', currentHotelId)
          .select('id').single();
        if (error) throw error;
        savedRoomId = data.id;
        if (feedbackEl) showHabitacionesFeedback(feedbackEl, 'Habitación actualizada.', 'success');
      } else {
        const { data, error } = await currentSupabaseInstance.from('habitaciones')
          .insert(habitacionPayload).select('id').single();
        if (error) throw error;
        savedRoomId = data.id;
        if (feedbackEl) showHabitacionesFeedback(feedbackEl, 'Habitación creada.', 'success');
      }
      if (savedRoomId) {
        await currentSupabaseInstance.from('habitacion_tiempos_permitidos').delete().eq('habitacion_id', savedRoomId).eq('hotel_id', currentHotelId);
        if (selectedTiempoIds.length > 0) {
          const tiemposToInsert = selectedTiempoIds.map(tiempoId => ({
            habitacion_id: savedRoomId, tiempo_estancia_id: tiempoId, hotel_id: currentHotelId
          }));
          await currentSupabaseInstance.from('habitacion_tiempos_permitidos').insert(tiemposToInsert);
        }
      }
      resetForm(formEl, selectTiemposEl, btnCancelarEl, btnGuardarEl);
      await renderHabitaciones(listaContainerEl, currentSupabaseInstance, currentHotelId, feedbackEl);
    } catch (err) {
      console.error('Error saving room:', err);
      if (feedbackEl) showHabitacionesFeedback(feedbackEl, `Error al guardar habitación: ${err.message}`, 'error', true);
    } finally {
      setFormLoadingState(formEl, false, btnGuardarEl, originalButtonText);
    }
}

// --- Render Configuración de Horarios ---
async function renderHorariosConfig(container, supabaseInst, hotelId, feedbackEl) {
    const { data: hotel, error } = await supabaseInst.from('hoteles')
        .select('checkin_hora, checkout_hora').eq('id', hotelId).single();
    if (error) {
        feedbackEl.textContent = "No se pudo cargar configuración de horarios.";
        return;
    }
    hotelCheckin = hotel?.checkin_hora || "15:00";
    hotelCheckout = hotel?.checkout_hora || "12:00";
    container.innerHTML = `
      <form id="form-horarios-hotel" class="flex flex-col md:flex-row gap-2 mb-4 items-center">
        <label><b>Check-in:</b> <input id="checkin-hotel" type="time" value="${hotelCheckin}" class="form-control"></label>
        <label><b>Check-out:</b> <input id="checkout-hotel" type="time" value="${hotelCheckout}" class="form-control"></label>
        <button type="submit" class="button button-primary ml-3">Guardar Horarios</button>
      </form>
      <div class="text-xs text-gray-500 ml-1">Horarios aplican para la opción “Noche”</div>
    `;
    const form = container.querySelector('#form-horarios-hotel');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const inVal = form['checkin-hotel'].value || "15:00";
      const outVal = form['checkout-hotel'].value || "12:00";
      const { error } = await supabaseInst.from('hoteles')
        .update({ checkin_hora: inVal, checkout_hora: outVal }).eq('id', hotelId);
      if (!error) {
        hotelCheckin = inVal; hotelCheckout = outVal;
        feedbackEl.textContent = "Horarios guardados ✔️";
        setTimeout(()=>{feedbackEl.textContent=""}, 1200);
      } else {
        feedbackEl.textContent = "Error guardando horarios";
      }
    };
}

// --- Main Module Mount Function ---
export async function mount(container, supabaseInst, user) {
  console.log("[Habitaciones/mount] Iniciando montaje...");
  unmount();

  currentContainerEl = container;
  currentSupabaseInstance = supabaseInst;
  currentModuleUser = user;
  currentHotelId = null;

  let tempHotelId = user?.user_metadata?.hotel_id;
  if (!tempHotelId && user?.id) {
    try {
      const { data: perfil, error: perfilError } = await supabaseInst
        .from('usuarios').select('hotel_id').eq('id', user.id).single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError;
      tempHotelId = perfil?.hotel_id;
    } catch (err) {
      console.error("Habitaciones Module: Error fetching hotelId from profile:", err);
    }
  }
  currentHotelId = tempHotelId;

  container.innerHTML = `
    <div class="card habitaciones-module shadow-lg rounded-2xl overflow-hidden">
  <div class="card-header bg-gradient-to-tr from-blue-50 to-white p-5 border-b border-blue-100">
    <h2 class="text-2xl font-bold text-blue-900 tracking-tight flex items-center gap-2">
      <svg width="28" height="28" fill="none" stroke="#2061a9" stroke-width="2" viewBox="0 0 24 24" class="inline"><rect x="4" y="9" width="16" height="7" rx="2" stroke="#2061a9" stroke-width="2"/><path d="M8 9V7a4 4 0 1 1 8 0v2" stroke="#2061a9" stroke-width="2"/><circle cx="8.5" cy="13.5" r="1" fill="#2061a9"/><circle cx="15.5" cy="13.5" r="1" fill="#2061a9"/></svg>
      Gestión de Hotel: Habitaciones y Tiempos de Estancia
    </h2>
  </div>
  <div class="card-body p-6 md:p-10 space-y-10 bg-gradient-to-tr from-blue-50 via-white to-white">
    <div id="habitaciones-global-feedback" role="status" aria-live="polite" class="feedback-message mb-3" style="min-height: 24px;"></div>
    <div id="config-horarios-hotel"></div>

    <!-- TIEMPOS DE ESTANCIA -->
    <section id="section-tiempos-estancia" class="p-6 border border-blue-100 rounded-2xl bg-white shadow mb-6">
      <h3 class="text-xl font-bold text-blue-800 mb-5 flex items-center gap-2">
        <svg width="20" height="20" fill="none" stroke="#2061a9" stroke-width="2" viewBox="0 0 24 24" class="inline"><rect x="4" y="9" width="16" height="7" rx="2" stroke="#2061a9" stroke-width="2"/><path d="M8 9V7a4 4 0 1 1 8 0v2" stroke="#2061a9" stroke-width="2"/><circle cx="8.5" cy="13.5" r="1" fill="#2061a9"/><circle cx="15.5" cy="13.5" r="1" fill="#2061a9"/></svg>
        Administrar Tiempos de Estancia
      </h3>
      <form id="form-tiempo-estancia" class="form space-y-3 mb-6 bg-blue-50 rounded-xl p-5" novalidate>
        <input type="hidden" id="tiempoEstanciaIdEdit" name="tiempoEstanciaIdEdit" />
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">

          <div>
            <label for="nombreTiempo" class="block text-base font-semibold text-blue-900 mb-1">Nombre del Tiempo *</label>
            <input type="text" id="nombreTiempo" name="nombreTiempo" class="form-control w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100" required maxlength="100" placeholder="Ej: 6 Horas, Noche Completa"/>
          </div>
          <div>
            <label for="minutosTiempo" class="block text-base font-semibold text-blue-900 mb-1">Duración (Minutos) *</label>
            <input type="number" id="minutosTiempo" name="minutosTiempo" class="form-control w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100" required min="1" placeholder="Ej: 360"/>
          </div>
          <div>
            <label for="precioAdicionalTiempo" class="block text-base font-semibold text-blue-900 mb-1">Precio Adicional (Opcional)</label>
            <input type="number" id="precioAdicionalTiempo" name="precioAdicionalTiempo" class="form-control w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100" min="0" step="0.01" placeholder="0.00"/>
          </div>
        </div>
        <div class="form-group flex items-center mt-2">
          <input type="checkbox" id="activoTiempo" name="activoTiempo" class="form-check-input h-5 w-5 text-blue-700 border-gray-300 rounded focus:ring-2 focus:ring-blue-200 mr-2" checked />
          <label for="activoTiempo" class="text-base font-semibold text-blue-900">Activo</label>
        </div>
        <div class="form-actions flex items-center gap-3 mt-2">
          <button type="submit" id="btn-guardar-tiempo-estancia" class="button bg-blue-700 hover:bg-blue-900 text-white py-2 px-6 rounded-xl shadow transition-all duration-200 text-base font-semibold">＋ Crear Tiempo</button>
          <button type="button" id="btn-cancelar-edicion-tiempo" class="button bg-white border border-blue-300 text-blue-800 py-2 px-6 rounded-xl shadow hover:bg-blue-50 transition-all duration-200 text-base font-semibold" style="display:none;">Cancelar</button>
        </div>
      </form>
      <h4 class="text-lg font-semibold text-blue-700 mb-2">Tiempos de Estancia Existentes</h4>
      <div class="table-container overflow-x-auto rounded-xl border border-blue-100 shadow">
        <table class="tabla-estilizada w-full min-w-full divide-y divide-gray-200">
          <thead class="bg-blue-50">
            <tr>
              <th class="px-4 py-2 text-left text-xs font-bold text-blue-700 uppercase tracking-wider">Nombre</th>
              <th class="px-4 py-2 text-left text-xs font-bold text-blue-700 uppercase tracking-wider">Duración</th>
              <th class="px-4 py-2 text-left text-xs font-bold text-blue-700 uppercase tracking-wider">Precio Adic.</th>
              <th class="px-4 py-2 text-left text-xs font-bold text-blue-700 uppercase tracking-wider">Estado</th>
              <th class="px-4 py-2 text-left text-xs font-bold text-blue-700 uppercase tracking-wider">Acciones</th>
            </tr>
          </thead>
          <tbody id="tabla-tiempos-estancia-body" class="bg-white divide-y divide-gray-200"></tbody>
        </table>
      </div>
    </section>

    <hr class="my-8 border-t-2 border-blue-100"/>

    <!-- HABITACIONES -->
    <section id="section-habitaciones" class="p-6 border border-blue-100 rounded-2xl bg-white shadow">
      <h3 class="text-xl font-bold text-blue-900 mb-5 flex items-center gap-2">
        <svg width="24" height="24" fill="none" stroke="#2061a9" stroke-width="2" viewBox="0 0 24 24" class="inline"><rect x="4" y="9" width="16" height="7" rx="2" stroke="#2061a9" stroke-width="2"/><path d="M8 9V7a4 4 0 1 1 8 0v2" stroke="#2061a9" stroke-width="2"/><circle cx="8.5" cy="13.5" r="1" fill="#2061a9"/><circle cx="15.5" cy="13.5" r="1" fill="#2061a9"/></svg>
        Administrar Habitaciones
      </h3>
      <form id="form-crear-habitacion" class="form mb-8 bg-blue-50 rounded-xl p-6 space-y-5" novalidate>
        <input type="hidden" name="habitacionIdEdit" />
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <label for="hab-nombre" class="block text-base font-semibold text-blue-900 mb-1">Nombre Habitación *</label>
            <input type="text" name="nombre" id="hab-nombre" class="form-control w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100" required />
          </div>
          <div>
            <label for="hab-tipo" class="block text-base font-semibold text-blue-900 mb-1">Tipo</label>
            <input type="text" name="tipo" id="hab-tipo" class="form-control w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </div>
          <div>
            <label for="hab-precio" class="block text-base font-semibold text-blue-900 mb-1">Precio Base *</label>
            <input type="number" name="precio" id="hab-precio" class="form-control w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100" min="0" step="0.01" required />
          </div>
          <div>
            <label for="hab-precio-adicional" class="block text-base font-semibold text-blue-900 mb-1">Precio por huésped adicional</label>
            <input type="number" name="precio_adicional_huesped" id="hab-precio-adicional" class="form-control w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100" min="0" step="0.01" placeholder="0.00" />
            <small class="text-xs text-blue-700">Se aplica desde la 3ra persona</small>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label for="hab-estado" class="block text-base font-semibold text-blue-900 mb-1">Estado Inicial *</label>
            <select name="estado" id="hab-estado" class="form-control w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100" required>
              <option value="libre">Libre</option>
              <option value="limpieza">En Limpieza</option>
              <option value="mantenimiento">En Mantenimiento</option>
              <option value="bloqueada">Bloqueada</option>
            </select>
          </div>
          <div>
            <label for="hab-amenidades" class="block text-base font-semibold text-blue-900 mb-1">Amenidades (separadas por coma)</label>
            <input type="text" name="amenidades" id="hab-amenidades" class="form-control w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100" placeholder="Ej: Wifi, TV, AC" />
          </div>
        </div>
        <div class="mb-3">
          <label for="habitacion-tiempos-estancia" class="block text-base font-semibold text-blue-900 mb-1">Tiempos de Estancia Permitidos</label>
          <select multiple name="tiempos_estancia_ids_select" id="habitacion-tiempos-estancia" class="form-control w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100" size="4"></select>
          <small class="text-xs text-blue-700">Mantén Ctrl (o Cmd en Mac) para seleccionar múltiples.</small>
        </div>
        <div class="flex items-center mb-3 space-x-2">
          <input type="checkbox" id="hab-activo" name="activo" class="form-check-input h-5 w-5 text-blue-700 border-gray-300 rounded focus:ring-2 focus:ring-blue-200" checked />
          <label for="hab-activo" class="block text-base font-semibold text-blue-900">Activa</label>
        </div>
        <div class="flex items-center gap-4 mt-6">
          <button type="submit" id="btn-guardar-habitacion" class="button bg-blue-700 hover:bg-blue-900 text-white py-2 px-6 rounded-xl shadow transition-all duration-200 text-base font-semibold">＋ Crear Habitación</button>
          <button type="button" id="btn-cancelar-edicion-habitacion" class="button bg-white border border-blue-300 text-blue-800 py-2 px-6 rounded-xl shadow hover:bg-blue-50 transition-all duration-200 text-base font-semibold" style="display:none;">Cancelar Edición</button>
        </div>
      </form>
      <h4 class="text-lg font-semibold text-blue-700 mb-4 mt-8">Listado de Habitaciones Existentes</h4>
      <div id="habitaciones-lista-container" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">

    </section>
  </div>
</div>
`;

  const feedbackGlobalEl = container.querySelector('#habitaciones-global-feedback');
  const configHorariosEl = container.querySelector('#config-horarios-hotel');
  const formTiempoEstanciaEl = container.querySelector('#form-tiempo-estancia');
  const tablaTiemposEstanciaBodyEl = container.querySelector('#tabla-tiempos-estancia-body');
  const btnGuardarTiempoEstanciaEl = container.querySelector('#btn-guardar-tiempo-estancia');
  const btnCancelarEdicionTiempoEl = container.querySelector('#btn-cancelar-edicion-tiempo');
  const formHabitacionEl = container.querySelector('#form-crear-habitacion');
  const selectHabitacionTiemposEl = container.querySelector('#habitacion-tiempos-estancia');
  const listaHabitacionesContainerEl = container.querySelector('#habitaciones-lista-container');
  const btnGuardarHabitacionEl = container.querySelector('#btn-guardar-habitacion');
  const btnCancelarEdicionHabitacionEl = container.querySelector('#btn-cancelar-edicion-habitacion');

  if (!currentHotelId) {
    if (feedbackGlobalEl) showHabitacionesFeedback(feedbackGlobalEl, 'Error crítico: Hotel no identificado.', 'error', 0);
    if(formTiempoEstanciaEl) formTiempoEstanciaEl.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
    if(formHabitacionEl) formHabitacionEl.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
    return;
  }

  // Render configuración de horarios arriba de todo
  if (configHorariosEl) await renderHorariosConfig(configHorariosEl, currentSupabaseInstance, currentHotelId, feedbackGlobalEl);

  if (!formTiempoEstanciaEl || !tablaTiemposEstanciaBodyEl || !btnGuardarTiempoEstanciaEl || !btnCancelarEdicionTiempoEl ||
      !formHabitacionEl || !selectHabitacionTiemposEl || !listaHabitacionesContainerEl || !btnGuardarHabitacionEl || !btnCancelarEdicionHabitacionEl ||
      !feedbackGlobalEl) {
      console.error("Habitaciones.mount: Faltan elementos DOM esenciales para el módulo.");
      if(feedbackGlobalEl) showHabitacionesFeedback(feedbackGlobalEl, "Error interno: No se pudo inicializar el módulo.", "error", 0);
      return;
  }

  // --- Lógica y Listeners para Tiempos de Estancia ---
  const tiempoEstanciaSubmitHandler = (e) => handleTiempoEstanciaSubmit(e, formTiempoEstanciaEl, tablaTiemposEstanciaBodyEl, feedbackGlobalEl, btnGuardarTiempoEstanciaEl, btnCancelarEdicionTiempoEl);
  formTiempoEstanciaEl.addEventListener('submit', tiempoEstanciaSubmitHandler);
  moduleListeners.push({ element: formTiempoEstanciaEl, type: 'submit', handler: tiempoEstanciaSubmitHandler });

  const cancelTiempoHandler = () => {
    resetearFormularioTiempoEstancia(formTiempoEstanciaEl, btnCancelarEdicionTiempoEl);
    if(feedbackGlobalEl) clearHabitacionesFeedbackLocal(feedbackGlobalEl);
  };
  btnCancelarEdicionTiempoEl.addEventListener('click', cancelTiempoHandler);
  moduleListeners.push({ element: btnCancelarEdicionTiempoEl, type: 'click', handler: cancelTiempoHandler });

  const tablaTiemposClickHandler = async (e) => {
    const button = e.target.closest('button[data-accion]');
    if (!button) return;
    const tiempoId = button.dataset.id;
    const accion = button.dataset.accion;
    if (feedbackGlobalEl) clearHabitacionesFeedbackLocal(feedbackGlobalEl);

    const originalButtonText = button.textContent;
    button.disabled = true;
    button.textContent = '...';

    if (accion === 'editar-tiempo') {
      const tiempoToEdit = todosLosTiemposEstanciaCache.find(t => t.id.toString() === tiempoId);
      if (tiempoToEdit) {
        populateFormularioTiempoEstancia(formTiempoEstanciaEl, tiempoToEdit, btnCancelarEdicionTiempoEl);
        window.scrollTo({ top: formTiempoEstanciaEl.offsetTop - 20, behavior: 'smooth' });
      } else {
        showHabitacionesFeedback(feedbackGlobalEl, 'Tiempo de estancia no encontrado.', 'error');
      }
      button.disabled = false;
      button.textContent = originalButtonText;
    } else if (accion === 'toggle-activo-tiempo') {
      const estadoActual = button.dataset.estadoActual === 'true';
      try {
        await currentSupabaseInstance.from('tiempos_estancia').update({ activo: !estadoActual }).eq('id', tiempoId).eq('hotel_id', currentHotelId);
        showHabitacionesFeedback(feedbackGlobalEl, `Tiempo de estancia ${!estadoActual ? 'activado' : 'desactivado'}.`, 'success');
        await cargarYRenderizarTiemposEstancia(tablaTiemposEstanciaBodyEl, currentSupabaseInstance, currentHotelId, feedbackGlobalEl);
      } catch (err) {
        showHabitacionesFeedback(feedbackGlobalEl, `Error al cambiar estado: ${err.message}`, 'error', 0);
      }
    }
  };
  tablaTiemposEstanciaBodyEl.addEventListener('click', tablaTiemposClickHandler);
  moduleListeners.push({ element: tablaTiemposEstanciaBodyEl, type: 'click', handler: tablaTiemposClickHandler });

  // --- Lógica y Listeners para Habitaciones ---
  const habitacionSubmitHandler = (e) => handleHabitacionSubmit(e, formHabitacionEl, selectHabitacionTiemposEl, listaHabitacionesContainerEl, feedbackGlobalEl, btnGuardarHabitacionEl, btnCancelarEdicionHabitacionEl);
  formHabitacionEl.addEventListener('submit', habitacionSubmitHandler);
  moduleListeners.push({ element: formHabitacionEl, type: 'submit', handler: habitacionSubmitHandler });

  const cancelHabitacionHandler = () => {
    resetForm(formHabitacionEl, selectHabitacionTiemposEl, btnCancelarEdicionHabitacionEl, btnGuardarHabitacionEl);
    if(feedbackGlobalEl) clearHabitacionesFeedbackLocal(feedbackGlobalEl);
  };
  btnCancelarEdicionHabitacionEl.addEventListener('click', cancelHabitacionHandler);
  moduleListeners.push({ element: btnCancelarEdicionHabitacionEl, type: 'click', handler: cancelHabitacionHandler });

  const listaHabitacionesClickHandler = async (e) => {
    const button = e.target.closest('button[data-accion]');
    if (!button) return;

    const habitacionId = button.dataset.id;
    const accion = button.dataset.accion;
    if (feedbackGlobalEl) clearHabitacionesFeedbackLocal(feedbackGlobalEl);

    const originalButtonText = button.textContent;
    button.disabled = true;
    button.textContent = '...';

    if (accion === 'editar-habitacion') {
      showHabitacionesFeedback(feedbackGlobalEl, 'Cargando datos de la habitación...', 'info');
      try {
        const { data: habitacionData, error } = await currentSupabaseInstance
          .from('habitaciones')
          .select('*, habitacion_tiempos_permitidos(tiempo_estancia_id)')
          .eq('id', habitacionId)
          .eq('hotel_id', currentHotelId)
          .single();
        if (error) throw error;
        if (habitacionData) {
          populateForm(formHabitacionEl, selectHabitacionTiemposEl, habitacionData, btnCancelarEdicionHabitacionEl, btnGuardarHabitacionEl);
          window.scrollTo({ top: formHabitacionEl.offsetTop - 20, behavior: 'smooth' });
        } else {
          showHabitacionesFeedback(feedbackGlobalEl, 'Habitación no encontrada.', 'error');
        }
      } catch (err) {
        console.error('Error fetching room for edit:', err);
        showHabitacionesFeedback(feedbackGlobalEl, `Error al cargar habitación: ${err.message}`, 'error');
      } finally {
          if (feedbackGlobalEl && feedbackGlobalEl.textContent.includes('Cargando datos')) clearHabitacionesFeedbackLocal(feedbackGlobalEl);
          button.disabled = false;
          button.textContent = originalButtonText;
      }
    } else if (accion === 'eliminar-habitacion') {
      const habitacionCard = button.closest('.habitacion-card');
      const nombreHabitacion = habitacionCard?.querySelector('.habitacion-nombre')?.textContent || habitacionId;
      if (confirm(`¿Está seguro de que desea eliminar la habitación "${nombreHabitacion}"? Esta acción no se puede deshacer.`)) {
        showHabitacionesFeedback(feedbackGlobalEl, 'Eliminando habitación...', 'info', 0);
        try {
          await currentSupabaseInstance.from('habitacion_tiempos_permitidos').delete().eq('habitacion_id', habitacionId).eq('hotel_id', currentHotelId);
          const { error } = await currentSupabaseInstance.from('habitaciones').delete().eq('id', habitacionId).eq('hotel_id', currentHotelId);
          if (error) throw error;
          showHabitacionesFeedback(feedbackGlobalEl, 'Habitación eliminada exitosamente.', 'success');
          await renderHabitaciones(listaHabitacionesContainerEl, currentSupabaseInstance, currentHotelId, feedbackGlobalEl);
          if (formHabitacionEl.elements.habitacionIdEdit.value === habitacionId) {
            resetForm(formHabitacionEl, selectTiemposEl, btnCancelarEdicionHabitacionEl, btnGuardarHabitacionEl);
          }
        } catch (err) {
          console.error('Error deleting room:', err);
          showHabitacionesFeedback(feedbackGlobalEl, `Error al eliminar habitación: ${err.message}`, 'error', 0);
          button.disabled = false;
          button.textContent = originalButtonText;
        }
      } else {
        button.disabled = false;
        button.textContent = originalButtonText;
      }
    } else {
      button.disabled = false;
      button.textContent = originalButtonText;
    }
  };
  listaHabitacionesContainerEl.addEventListener('click', listaHabitacionesClickHandler);
  moduleListeners.push({ element: listaHabitacionesContainerEl, type: 'click', handler: listaHabitacionesClickHandler });

  // Carga inicial de datos
  await cargarYRenderizarTiemposEstancia(tablaTiemposEstanciaBodyEl, currentSupabaseInstance, currentHotelId, feedbackGlobalEl);
  await renderHabitaciones(listaHabitacionesContainerEl, currentSupabaseInstance, currentHotelId, feedbackGlobalEl);

  resetearFormularioTiempoEstancia(formTiempoEstanciaEl, btnCancelarEdicionTiempoEl);
  resetForm(formHabitacionEl, selectHabitacionTiemposEl, btnCancelarEdicionHabitacionEl, btnGuardarHabitacionEl);

  if(formTiempoEstanciaEl && formTiempoEstanciaEl.elements.nombreTiempo) formTiempoEstanciaEl.elements.nombreTiempo.focus();
  console.log("[Habitaciones/mount] Montaje completado.");
}

export function unmount() {
  console.log("Habitaciones.unmount: Limpiando listeners y estado...");
  moduleListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = [];
  currentHotelId = null;
  currentModuleUser = null;
  currentSupabaseInstance = null;
  todosLosTiemposEstanciaCache = [];
  currentContainerEl = null;
  console.log('Habitaciones module unmounted.');
}
