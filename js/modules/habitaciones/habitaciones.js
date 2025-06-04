// js/modules/habitaciones/habitaciones.js
import {
    formatCurrency,
    setFormLoadingState,
    showError, 
    showSuccess,
    showLoading, 
    clearFeedback 
} from '../../uiUtils.js';
import { registrarEnBitacora } from '../../services/bitacoraservice.js';

// --- Variables a nivel de módulo ---
let moduleListeners = [];
let currentHotelId = null;
let currentModuleUser = null;
let currentSupabaseInstance = null;
let todosLosTiemposEstanciaCache = [];
let currentContainerEl = null;
let activePlanDetails = null;

// Horarios por defecto, se intentarán cargar desde la configuración del hotel
let hotelCheckinTimeConfig = "15:00";
let hotelCheckoutTimeConfig = "12:00";

// --- Funciones de Utilidad Específicas del Módulo ---

/**
 * Parsea una hora en formato "HH:MM" y la aplica a una fecha dada.
 * @param {Date} date - La fecha base.
 * @param {string} horaStr - La hora en formato "HH:MM".
 * @returns {Date} - La fecha con la hora aplicada.
 */
function parseTimeToDate(date, horaStr) {
  const d = new Date(date);
  if (horaStr && typeof horaStr === 'string' && horaStr.includes(':')) {
    const [h, m] = horaStr.split(':').map(x => parseInt(x, 10));
    if (!isNaN(h) && !isNaN(m)) {
      d.setHours(h, m, 0, 0);
    } else {
      console.warn(`[Habitaciones] Formato de hora inválido: ${horaStr}. Usando medianoche.`);
      d.setHours(0, 0, 0, 0);
    }
  } else {
    console.warn(`[Habitaciones] Hora no proporcionada o en formato incorrecto: ${horaStr}. Usando medianoche.`);
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

/**
 * Calcula la diferencia en minutos entre dos fechas.
 * @param {Date} a - Fecha de inicio.
 * @param {Date} b - Fecha de fin.
 * @returns {number} - Diferencia en minutos.
 */
function calcMinutesBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

/**
 * Calcula los minutos para un tiempo de estancia de tipo "Noche"
 * basado en los horarios de check-in y check-out cargados desde la configuración del hotel.
 * @returns {number} - Duración de la noche en minutos.
 */
function calcularMinutosNocheDesdeConfig() {
  const now = new Date();
  const inDate = parseTimeToDate(now, hotelCheckinTimeConfig);
  let outDate = parseTimeToDate(now, hotelCheckoutTimeConfig);
  if (outDate <= inDate) {
    outDate.setDate(outDate.getDate() + 1);
  }
  const duration = calcMinutesBetween(inDate, outDate);
  console.log(`[Habitaciones] Duración de 'Noche' calculada: ${duration} mins (Check-in: ${hotelCheckinTimeConfig}, Check-out: ${hotelCheckoutTimeConfig})`);
  return duration;
}

/**
 * Formatea minutos a un string legible (ej: "2h 30m").
 * @param {number} totalMinutes - Total de minutos.
 * @returns {string} - String formateado.
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
function showHabitacionesFeedback(feedbackElement, message, type = 'success', duration = 3500) {
  if (!feedbackElement) {
    console.warn("Elemento de feedback no proporcionado a showHabitacionesFeedback");
    if (type === 'error') alert(`Error: ${message}`);
    else console.log(`Feedback Habitaciones (${type}): ${message}`);
    return;
  }
  feedbackElement.textContent = message;
  let typeClasses = 'bg-green-100 border-green-300 text-green-700'; // success
  if (type === 'error') {
    typeClasses = 'bg-red-100 border-red-300 text-red-700';
  } else if (type === 'info') {
    typeClasses = 'bg-blue-100 border-blue-300 text-blue-700';
  }
  
  feedbackElement.className = `feedback-message p-3 my-2 text-sm rounded-md border ${typeClasses} visible`;
  feedbackElement.style.display = 'block';
  feedbackElement.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

  if (duration > 0) {
    setTimeout(() => clearHabitacionesFeedbackLocal(feedbackElement), duration);
  }
}

function clearHabitacionesFeedbackLocal(feedbackElement) {
  if (!feedbackElement) return;
  feedbackElement.textContent = '';
  feedbackElement.style.display = 'none';
  feedbackElement.className = 'feedback-message'; 
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
async function cargarYRenderizarTiemposEstancia(tbodyEl, feedbackEl) {
  if (!tbodyEl || !currentSupabaseInstance || !currentHotelId) {
    console.error("cargarYRenderizarTiemposEstancia: Faltan parámetros o currentHotelId es null. currentHotelId:", currentHotelId);
    setTableErrorState(tbodyEl, "Error: Hotel no identificado para cargar tiempos.");
    return;
  }
  setTableLoadingState(tbodyEl, "Cargando tiempos de estancia...");

  try {
    const { data: tiempos, error } = await currentSupabaseInstance
      .from('tiempos_estancia')
      .select('id, nombre, minutos, precio, activo') 
      .eq('hotel_id', currentHotelId) 
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
          <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${formatCurrency(t.precio)}</td>
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
    const selectHabitacionTiempos = currentContainerEl?.querySelector('#habitacion-tiempos-estancia');
    if (selectHabitacionTiempos) populateTiemposEstanciaSelect(selectHabitacionTiempos);
    
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
  formEl.elements.precioTiempo.value = tiempoData.precio || 0;
  formEl.elements.activoTiempo.checked = tiempoData.activo;
  formEl.querySelector('#btn-guardar-tiempo-estancia').textContent = 'Actualizar Tiempo';
  if (btnCancelarEl) btnCancelarEl.style.display = 'inline-block';
  
  // Si el nombre incluye "noche", deshabilitar minutos
  if (tiempoData.nombre && tiempoData.nombre.toLowerCase().includes('noche')) {
    formEl.elements.minutosTiempo.disabled = true;
  } else {
    formEl.elements.minutosTiempo.disabled = false;
  }
  formEl.elements.nombreTiempo.focus();
}

function resetearFormularioTiempoEstancia(formEl, btnCancelarEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.tiempoEstanciaIdEdit.value = '';
  formEl.elements.activoTiempo.checked = true;
  formEl.querySelector('#btn-guardar-tiempo-estancia').textContent = '＋ Crear Tiempo';
  if (btnCancelarEl) btnCancelarEl.style.display = 'none';
  formEl.elements.minutosTiempo.disabled = false; // Siempre re-habilitar al resetear
  formEl.elements.nombreTiempo.focus();
}

async function handleTiempoEstanciaSubmit(event, formEl, tbodyEl, feedbackEl, btnGuardarEl, btnCancelarEl) {
    event.preventDefault();
    if (feedbackEl) clearHabitacionesFeedbackLocal(feedbackEl);
    
    const formData = new FormData(formEl);
    const nombreValue = formData.get('nombreTiempo')?.trim();
    let minutosValue = formData.get('minutosTiempo');
    const precioValue = parseFloat(formData.get('precioTiempo')) || 0;
    const idEdit = formData.get('tiempoEstanciaIdEdit');
    const activoValue = formEl.elements.activoTiempo.checked;

    let minutosParsed;
    if (nombreValue && nombreValue.toLowerCase().includes('noche')) {
      minutosParsed = calcularMinutosNocheDesdeConfig();
      formEl.elements.minutosTiempo.value = minutosParsed; 
      formEl.elements.minutosTiempo.disabled = true;
    } else {
      minutosParsed = parseInt(minutosValue, 10);
      formEl.elements.minutosTiempo.disabled = false;
    }

    const originalButtonText = btnGuardarEl.textContent;
    setFormLoadingState(formEl, true, btnGuardarEl, originalButtonText, 'Guardando...');

    if (!nombreValue || isNaN(minutosParsed) || minutosParsed <= 0) {
      showHabitacionesFeedback(feedbackEl, 'Nombre y duración válida (minutos > 0) son obligatorios.', 'error');
      setFormLoadingState(formEl, false, btnGuardarEl, originalButtonText);
      if (!nombreValue) formEl.elements.nombreTiempo.focus();
      else formEl.elements.minutosTiempo.focus();
      return;
    }
    if (isNaN(precioValue) || precioValue < 0) {
        showHabitacionesFeedback(feedbackEl, 'El precio debe ser un número no negativo.', 'error');
        setFormLoadingState(formEl, false, btnGuardarEl, originalButtonText);
        formEl.elements.precioTiempo.focus();
        return;
    }

    const payload = {
      hotel_id: currentHotelId,
      nombre: nombreValue,
      minutos: minutosParsed,
      precio: precioValue,
      activo: activoValue,
      user_id: currentModuleUser.id 
    };

    try {
      let accionBitacora = '';
      let detallesBitacora = {};
      if (idEdit) {
        const updateData = { ...payload };
        delete updateData.user_id; delete updateData.hotel_id; 
        const { error } = await currentSupabaseInstance.from('tiempos_estancia')
          .update(updateData).eq('id', idEdit).eq('hotel_id', currentHotelId);
        if (error) throw error;
        showHabitacionesFeedback(feedbackEl, 'Tiempo de estancia actualizado.', 'success');
        accionBitacora = 'ACTUALIZAR_TIEMPO_ESTANCIA';
        detallesBitacora = { tiempo_id: idEdit, nombre: nombreValue };
      } else {
        const { data, error } = await currentSupabaseInstance.from('tiempos_estancia').insert(payload).select().single();
        if (error) throw error; 
        showHabitacionesFeedback(feedbackEl, 'Tiempo de estancia creado.', 'success');
        accionBitacora = 'CREAR_TIEMPO_ESTANCIA';
        detallesBitacora = { tiempo_id: data.id, nombre: nombreValue };
      }
      await registrarEnBitacora({ supabase: currentSupabaseInstance, hotel_id: currentHotelId, usuario_id: currentModuleUser.id, modulo: 'Habitaciones', accion: accionBitacora, detalles: detallesBitacora });
      resetearFormularioTiempoEstancia(formEl, btnCancelarEl);
      await cargarYRenderizarTiemposEstancia(tbodyEl, feedbackEl);
    } catch (err) {
      console.error('Error guardando tiempo de estancia:', err); 
      showHabitacionesFeedback(feedbackEl, `Error al guardar tiempo: ${err.message}`, 'error', 0);
    } finally {
      setFormLoadingState(formEl, false, btnGuardarEl, originalButtonText);
       if (!nombreValue || !nombreValue.toLowerCase().includes('noche')) { // Re-enable if not "Noche"
            formEl.elements.minutosTiempo.disabled = false;
        }
    }
}

function populateTiemposEstanciaSelect(selectEl, selectedIds = []) {
    if (!selectEl) return;
    const activeTiempos = todosLosTiemposEstanciaCache.filter(t => t.activo);
    selectEl.innerHTML = activeTiempos.length > 0
        ? activeTiempos.map(t => {
            const durationString = formatMinutesToHoursMinutes(t.minutos);
            return `<option value="${t.id}" ${selectedIds.includes(t.id.toString()) ? 'selected' : ''}>${t.nombre} (${durationString} - ${formatCurrency(t.precio)})</option>`;
          }).join('')
        : `<option value="" disabled>No hay tiempos activos. Defínalos primero.</option>`;
}

// --- Lógica para Habitaciones ---
async function renderHabitaciones(habitacionesContainer, feedbackEl) {
  if (!habitacionesContainer) {
    if (feedbackEl) showHabitacionesFeedback(feedbackEl, "Error interno: Contenedor de habitaciones no disponible.", "error");
    return;
  }
  if (!currentHotelId) {
    habitacionesContainer.innerHTML = `<div class="col-span-full text-red-600 text-center p-4">Error: Hotel no identificado.</div>`;
    if (feedbackEl) showHabitacionesFeedback(feedbackEl, "Error: Hotel no identificado.", "error");
    return;
  }
  habitacionesContainer.innerHTML = `<div class="col-span-full text-center p-4 text-gray-500">Cargando habitaciones...</div>`;
  if (feedbackEl) clearHabitacionesFeedbackLocal(feedbackEl);

  try {
    const { data: habitaciones, error } = await currentSupabaseInstance
      .from('habitaciones')
      .select(`
        id, nombre, tipo, precio, estado, activo, amenidades, piso,
        capacidad_base, capacidad_maxima, precio_huesped_adicional,
        habitacion_tiempos_permitidos (
          tiempo_estancia_id,
          tiempos_estancia (id, nombre, minutos, precio)
        )
      `)
      .eq('hotel_id', currentHotelId)
      .order('nombre', { ascending: true });

    if (error) throw error;
    habitacionesContainer.innerHTML = '';

    habitaciones.sort((a, b) => {
      const getNumber = nombre => {
        const match = String(nombre || '').match(/\d+/);
        return match ? parseInt(match[0], 10) : Infinity;
      };
      return getNumber(a.nombre) - getNumber(b.nombre);
    });

    if (!habitaciones || habitaciones.length === 0) {
      habitacionesContainer.innerHTML = `<div class="col-span-full text-center p-4 text-gray-500">No hay habitaciones registradas.</div>`;
      return;
    }

    habitaciones.forEach(h => {
      const card = document.createElement('div');
      card.className = `habitacion-card card p-4 rounded-lg shadow-md bg-white border-l-4 estado-border-${h.estado || 'desconocido'} ${h.activo ? 'opacity-100' : 'opacity-60'}`;
      card.dataset.habitacionId = h.id;

      const estadoDisplay = h.estado ? h.estado.charAt(0).toUpperCase() + h.estado.slice(1) : 'Desconocido';
      const nombresTiemposEstancia = h.habitacion_tiempos_permitidos && h.habitacion_tiempos_permitidos.length > 0
        ? h.habitacion_tiempos_permitidos.map(htp => htp.tiempos_estancia?.nombre || 'Tiempo desc.').join(', ')
        : 'No asignados';

      card.innerHTML = `
        <div class="card-body">
          <div class="flex justify-between items-start mb-2">
            <h4 class="text-md font-semibold text-gray-800 habitacion-nombre">${h.nombre} <span class="text-sm text-gray-500">(${h.tipo || 'N/A'})</span></h4>
            <span class="badge estado-badge-${h.estado || 'desconocido'} text-xs px-2.5 py-0.5 rounded-full font-medium">${estadoDisplay}${h.activo ? '' : ' (Inactiva)'}</span>
          </div>
          <p class="text-sm text-gray-600"><strong>Precio Base (Noche):</strong> ${h.precio ? formatCurrency(h.precio) : 'N/D'}</p>
          <p class="text-xs text-gray-500"><strong>Piso:</strong> ${h.piso || 'N/A'}</p>
          <p class="text-xs text-gray-500"><strong>Capacidad:</strong> ${h.capacidad_base || 1}-${h.capacidad_maxima || h.capacidad_base || 1} pers.</p>
          <p class="text-xs text-gray-500"><strong>Precio Adic./Huésped:</strong> ${formatCurrency(h.precio_huesped_adicional)}</p>
          <p class="text-xs text-gray-500"><strong>Amenidades:</strong> ${h.amenidades && h.amenidades.length > 0 ? h.amenidades.join(', ') : 'Ninguna'}</p>
          <p class="text-xs text-gray-500 mt-1"><strong>Tiempos Permitidos:</strong> ${nombresTiemposEstancia}</p>
          <div class="habitacion-acciones mt-3 flex gap-2 flex-wrap">
            <button data-accion="editar-habitacion" data-id="${h.id}" class="button button-outline button-small text-xs">Editar</button>
            <button data-accion="eliminar-habitacion" data-id="${h.id}" class="button button-danger button-small text-xs">Eliminar</button>
          </div>
        </div>
      `;
      habitacionesContainer.appendChild(card);
    });
  } catch (err) {
    console.error('Error loading rooms:', err);
    habitacionesContainer.innerHTML = `<div class="col-span-full text-red-600 text-center p-4">Error al cargar habitaciones: ${err.message}</div>`;
    if (feedbackEl) showHabitacionesFeedback(feedbackEl, `Error al cargar habitaciones: ${err.message}`, 'error');
  }
}

function populateFormHabitacion(formEl, selectTiemposEl, habitacionData, btnCancelarEl, btnGuardarEl, formTitleEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.habitacionIdEdit.value = habitacionData.id;
  if(formTitleEl) formTitleEl.textContent = `Editando Habitación: ${habitacionData.nombre}`;
  
  formEl.elements.nombre.value = habitacionData.nombre || '';
  formEl.elements.tipo.value = habitacionData.tipo || '';
  formEl.elements.precio.value = habitacionData.precio || '';
  formEl.elements.piso.value = habitacionData.piso || '';
  formEl.elements.capacidad_base.value = habitacionData.capacidad_base || 1;
  formEl.elements.capacidad_maxima.value = habitacionData.capacidad_maxima || habitacionData.capacidad_base || 1;
  formEl.elements.precio_huesped_adicional.value = habitacionData.precio_huesped_adicional || 0;
  // Ya no tenemos estos campos en el formulario:
  // formEl.elements.permite_reservas_por_horas.checked = habitacionData.permite_reservas_por_horas || false;
  // formEl.elements.precio_base_hora.value = habitacionData.precio_base_hora || 0;
  formEl.elements.estado.value = habitacionData.estado || 'libre';
  formEl.elements.amenidades.value = habitacionData.amenidades?.join(', ') || '';
  formEl.elements.activo.checked = habitacionData.activo === undefined ? true : habitacionData.activo;

  const selectedTiempoIds = habitacionData.habitacion_tiempos_permitidos?.map(htp => htp.tiempo_estancia_id.toString()) || [];
  populateTiemposEstanciaSelect(selectTiemposEl, selectedTiempoIds);

  if (btnCancelarEl) btnCancelarEl.style.display = 'inline-block';
  if (btnGuardarEl) btnGuardarEl.textContent = 'Actualizar Habitación';
  formEl.elements.nombre.focus();
}

function resetFormHabitacion(formEl, selectTiemposEl, btnCancelarEl, btnGuardarEl, formTitleEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.habitacionIdEdit.value = '';
  if(formTitleEl) formTitleEl.textContent = 'Crear Nueva Habitación';
  formEl.elements.activo.checked = true;
  // formEl.elements.permite_reservas_por_horas.checked = false; 
  populateTiemposEstanciaSelect(selectTiemposEl);
  if (btnCancelarEl) btnCancelarEl.style.display = 'none';
  if (btnGuardarEl) btnGuardarEl.textContent = '＋ Crear Habitación';
  formEl.elements.nombre.focus();
}

// js/modules/habitaciones/habitaciones.js

// ... (otras funciones) ...

async function handleHabitacionSubmit(event, formEl, selectTiemposEl, listaContainerEl, feedbackEl, btnGuardarEl, btnCancelarEl, formTitleEl) {
    event.preventDefault();
    if (feedbackEl) clearHabitacionesFeedbackLocal(feedbackEl);
    
    const formData = new FormData(formEl);
    const editId = formData.get('habitacionIdEdit'); // Para saber si es creación o edición

    // --- INICIO DE VALIDACIÓN DE LÍMITE DE HABITACIONES (SOLO AL CREAR) ---
    if (!editId) { // Solo aplicar el chequeo de límite si estamos creando una nueva habitación
        if (!activePlanDetails || !activePlanDetails.funcionalidades) {
            console.error("handleHabitacionSubmit: No se pueden verificar los límites del plan: activePlanDetails no está cargado o no tiene 'funcionalidades'.");
            showHabitacionesFeedback(feedbackEl, "Error: No se pudo verificar la información de tu plan para el límite de habitaciones. Intenta recargar.", "error", 0);
            return; // Detener si no tenemos info del plan
        }

        const limiteHabitacionesDelPlan = activePlanDetails.funcionalidades.limite_habitaciones;
        const nombreDelPlanActual = activePlanDetails.nombre;

        // Solo validar si limiteHabitacionesDelPlan es un número (y no null/undefined para ilimitado)
        if (typeof limiteHabitacionesDelPlan === 'number') {
            try {
                setFormLoadingState(formEl, true, btnGuardarEl, btnGuardarEl.textContent, 'Verificando plan...');
                const { count: numeroActualHabitaciones, error: countError } = await currentSupabaseInstance
                    .from('habitaciones')
                    .select('*', { count: 'exact', head: true })
                    .eq('hotel_id', currentHotelId);
                    // .eq('activo', true); // Opcional: considerar solo activas

                setFormLoadingState(formEl, false, btnGuardarEl, btnGuardarEl.textContent); // Restaurar estado del botón

                if (countError) {
                    throw countError;
                }

                if (numeroActualHabitaciones >= limiteHabitacionesDelPlan) {
                    console.warn(`Intento de exceder límite de habitaciones. Plan: ${nombreDelPlanActual}, Límite: ${limiteHabitacionesDelPlan}, Actuales: ${numeroActualHabitaciones}`);
                    showHabitacionesFeedback(
                        feedbackEl,
                        `Has alcanzado el límite de ${limiteHabitacionesDelPlan} habitaciones para tu plan '${nombreDelPlanActual}'. Para agregar más, por favor considera mejorar tu plan desde "Mi Cuenta".`,
                        'error',
                        0 // No auto-ocultar
                    );
                    // También podrías usar Swal.fire aquí si prefieres un modal más grande
                    return; // Detener el proceso de guardado
                }
            } catch (error) {
                console.error("Error verificando el límite de habitaciones:", error);
                showHabitacionesFeedback(feedbackEl, "Error al verificar el límite de habitaciones. Por favor, intenta de nuevo.", 'error', 0);
                setFormLoadingState(formEl, false, btnGuardarEl, btnGuardarEl.textContent); // Asegurarse de restaurar en caso de error
                return; // Detener por precaución
            }
        }
    }
    // --- FIN DE VALIDACIÓN DE LÍMITE DE HABITACIONES ---

    // El resto de tu lógica para obtener datos del formulario, construir payload, etc.
    // ... (como la tenías antes) ...
    const nombreHabitacion = formData.get('nombre')?.trim();
    if (!nombreHabitacion) {
        if (feedbackEl) showHabitacionesFeedback(feedbackEl, 'El nombre de la habitación es obligatorio.', 'error');
        formEl.elements.nombre.focus();
        return;
    }
    
    const precioInput = formData.get('precio');
    const precioHabitacion = precioInput !== '' && !isNaN(parseFloat(precioInput)) ? parseFloat(precioInput) : null;
    if (precioHabitacion === null || precioHabitacion < 0) {
        if (feedbackEl) showHabitacionesFeedback(feedbackEl, 'El precio base debe ser un número válido y no negativo.', 'error');
        formEl.elements.precio.focus();
        return;
    }

    const habitacionPayload = {
      nombre: nombreHabitacion,
      tipo: formData.get('tipo')?.trim() || null,
      precio: precioHabitacion,
      piso: parseInt(formData.get('piso')) || null,
      capacidad_base: parseInt(formData.get('capacidad_base')) || 1,
      capacidad_maxima: parseInt(formData.get('capacidad_maxima')) || parseInt(formData.get('capacidad_base')) || 1,
      precio_huesped_adicional: parseFloat(formData.get('precio_huesped_adicional')) || 0,
      estado: formData.get('estado'),
      amenidades: formData.get('amenidades')?.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) || null,
      hotel_id: currentHotelId,
      activo: formEl.elements.activo.checked
    };

    const selectedTiempoIds = Array.from(selectTiemposEl.selectedOptions).map(o => o.value);
    const originalButtonText = btnGuardarEl.textContent; // Ya se obtiene arriba para la validación, podemos reusar
    setFormLoadingState(formEl, true, btnGuardarEl, originalButtonText, 'Guardando...');
    
    try {
      let savedRoomId = editId; // Si editId existe, es una actualización
      let accionBitacora = '';
      let detallesBitacora = {};

      if (editId) { // Actualizar habitación
        const { data, error } = await currentSupabaseInstance.from('habitaciones')
          .update(habitacionPayload).eq('id', editId).eq('hotel_id', currentHotelId)
          .select('id').single();
        if (error) throw error;
        savedRoomId = data.id;
        if (feedbackEl) showHabitacionesFeedback(feedbackEl, 'Habitación actualizada.', 'success');
        accionBitacora = 'ACTUALIZAR_HABITACION';
        detallesBitacora = { habitacion_id: savedRoomId, nombre: nombreHabitacion };
      } else { // Crear nueva habitación (ya pasó la validación de límite)
        const { data, error } = await currentSupabaseInstance.from('habitaciones')
          .insert(habitacionPayload).select('id').single();
        if (error) throw error;
        savedRoomId = data.id;
        if (feedbackEl) showHabitacionesFeedback(feedbackEl, 'Habitación creada.', 'success');
        accionBitacora = 'CREAR_HABITACION';
        detallesBitacora = { habitacion_id: savedRoomId, nombre: nombreHabitacion };
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
      await registrarEnBitacora({ supabase: currentSupabaseInstance, hotel_id: currentHotelId, usuario_id: currentModuleUser.id, modulo: 'Habitaciones', accion: accionBitacora, detalles: detallesBitacora });
      resetFormHabitacion(formEl, selectTiemposEl, btnCancelarEl, btnGuardarEl, formTitleEl);
      await renderHabitaciones(listaContainerEl, feedbackEl);
    } catch (err) {
      console.error('Error saving room:', err);
      if (feedbackEl) showHabitacionesFeedback(feedbackEl, `Error al guardar habitación: ${err.message}`, 'error', 0);
    } finally {
      setFormLoadingState(formEl, false, btnGuardarEl, originalButtonText);
    }
}
// --- Main Module Mount Function ---
export async function mount(container, supabaseInst, user, hotelId, planDetails) { // <--- AÑADIDO planDetails
  console.log("[Habitaciones/mount] Iniciando montaje...");
  unmount(); 

  currentContainerEl = container;
  currentSupabaseInstance = supabaseInst;
  currentModuleUser = user;
  currentHotelId = hotelId; // hotelId ya se recibe de main.js
  activePlanDetails = planDetails; // <--- GUARDA LOS DETALLES DEL PLAN 

  let tempHotelId = user?.user_metadata?.hotel_id || user?.app_metadata?.hotel_id;
  if (!tempHotelId && user?.id) {
    try {
      const { data: perfil, error: perfilError } = await currentSupabaseInstance
        .from('usuarios').select('hotel_id').eq('id', user.id).single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError;
      tempHotelId = perfil?.hotel_id;
    } catch (err) {
      console.error("[Habitaciones] Error obteniendo hotel_id del perfil:", err);
    }
  }
  currentHotelId = tempHotelId;

  // Cargar configuración de horarios del hotel desde configuracion_hotel
  if (currentHotelId) {
    try {
        const { data: configHotel, error: configError } = await currentSupabaseInstance
            .from('configuracion_hotel')
            .select('checkin_hora_config, checkout_hora_config') // Usar los nuevos nombres de columna
            .eq('hotel_id', currentHotelId)
            .single(); // Usar single si esperas una sola fila o ninguna
        
        if (configError && configError.code !== 'PGRST116') { // PGRST116: No rows found, es aceptable
            throw configError;
        }
        if (configHotel) {
            hotelCheckinTimeConfig = configHotel.checkin_hora_config || "15:00";
            hotelCheckoutTimeConfig = configHotel.checkout_hora_config || "12:00";
            console.log(`[Habitaciones] Horarios cargados desde config: Check-in ${hotelCheckinTimeConfig}, Check-out ${hotelCheckoutTimeConfig}`);
        } else {
            console.warn(`[Habitaciones] No se encontró config de horarios para hotel ${currentHotelId}. Usando predeterminados.`);
            // Se mantienen los valores por defecto hotelCheckinTimeConfig y hotelCheckoutTimeConfig
        }
    } catch (err) {
        console.error("[Habitaciones] Error cargando configuración de horarios del hotel:", err.message);
        // Se usarán los predeterminados
    }
  } else {
      console.warn("[Habitaciones] No se pudo determinar el Hotel ID. Usando horarios predeterminados para cálculo de noche.");
  }

  // ... (resto del innerHTML y la lógica de `mount` como en la versión anterior,
  //      asegurándote de que los IDs de los elementos coincidan con los que se buscan en el JS)
  //      He omitido el HTML largo por brevedad, pero debe ser el mismo que te envié
  //      en la respuesta anterior (ID: habitacionesProfesionalV2),
  //      con la sección de horarios eliminada del formulario de habitaciones.
  //      La sección de horarios ahora solo sería informativa si decides mostrarla,
  //      pero la configuración real viene de configuracion_hotel.

  // El HTML del módulo de habitaciones.js (la sección de "Administrar Tiempos de Estancia"
  // y "Administrar Habitaciones") se mantiene igual que en la versión anterior.
  // Lo importante es que la lógica de cálculo de 'Noche' ahora usa hotelCheckinTimeConfig y hotelCheckoutTimeConfig.
  
  // --- Pegar aquí el innerHTML completo de la versión anterior ---
  // (Desde <div class="card habitaciones-module...")
  // ... hasta el final del </style>
  // (Asegúrate de que el HTML no intente crear inputs para checkin_hora y checkout_hora
  //  dentro del formulario de habitaciones, ya que ahora se leen de la configuración)

  // --- HTML del módulo (Abreviado para no repetir todo, usar el de la versión anterior) ---
  container.innerHTML = `
    <div class="card habitaciones-module shadow-lg rounded-2xl overflow-hidden">
      <div class="card-header bg-gradient-to-tr from-blue-600 to-indigo-700 p-5 border-b border-indigo-800">
        <h2 class="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
          Gestión de Hotel: Habitaciones y Tiempos
        </h2>
      </div>
      <div class="card-body p-6 md:p-8 space-y-10 bg-gray-50">
        <div id="habitaciones-global-feedback" role="status" aria-live="polite" class="feedback-message mb-3" style="min-height: 24px; display:none;"></div>
        
        <p class="text-sm text-gray-600 bg-blue-50 p-3 rounded-md border border-blue-200">
          Horarios de referencia para "Noche": Check-in <strong>${hotelCheckinTimeConfig}</strong>, Check-out <strong>${hotelCheckoutTimeConfig}</strong>. 
          Estos se configuran en "Configuración General del Hotel".
        </p>

        <section id="section-tiempos-estancia" class="p-6 border border-indigo-200 rounded-xl bg-white shadow-md">
          <h3 class="text-xl font-semibold text-indigo-700 mb-4 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Administrar Tiempos de Estancia
          </h3>
          <form id="form-tiempo-estancia" class="form space-y-4 mb-6 bg-indigo-50/50 rounded-lg p-5" novalidate>
            <input type="hidden" id="tiempoEstanciaIdEdit" name="tiempoEstanciaIdEdit" />
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 items-end">
              <div>
                <label for="nombreTiempo" class="form-label text-indigo-800">Nombre del Tiempo *</label>
                <input type="text" id="nombreTiempo" name="nombreTiempo" class="form-control" required maxlength="100" placeholder="Ej: 6 Horas, Noche Completa"/>
                <small class="text-xs text-indigo-600">Si incluye "Noche", la duración se calcula automáticamente.</small>
              </div>
              <div>
                <label for="minutosTiempo" class="form-label text-indigo-800">Duración (Minutos) *</label>
                <input type="number" id="minutosTiempo" name="minutosTiempo" class="form-control" required min="1" placeholder="Ej: 360"/>
              </div>
              <div>
                <label for="precioTiempo" class="form-label text-indigo-800">Precio del Tiempo *</label>
                <input type="number" id="precioTiempo" name="precioTiempo" class="form-control" required min="0" step="any" placeholder="0.00"/>
              </div>
              <div class="flex items-center pt-5">
                <input type="checkbox" id="activoTiempo" name="activoTiempo" class="form-check-input h-5 w-5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 mr-2" checked />
                <label for="activoTiempo" class="form-label text-indigo-800 mb-0">Activo</label>
              </div>
              <div class="form-actions flex items-center gap-3 pt-5">
                <button type="submit" id="btn-guardar-tiempo-estancia" class="button button-primary py-2 px-4 text-sm">＋ Crear Tiempo</button>
                <button type="button" id="btn-cancelar-edicion-tiempo" class="button button-outline py-2 px-4 text-sm" style="display:none;">Cancelar</button>
              </div>
            </div>
          </form>
          <h4 class="text-md font-semibold text-indigo-700 mb-2 mt-6">Tiempos Existentes</h4>
          <div class="table-container overflow-x-auto rounded-lg border border-indigo-100 shadow-sm">
            <table class="tabla-estilizada w-full min-w-full divide-y divide-indigo-100">
              <thead class="bg-indigo-50"><tr class="text-indigo-800"><th>Nombre</th><th>Duración</th><th>Precio</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody id="tabla-tiempos-estancia-body" class="bg-white divide-y divide-gray-200"></tbody>
            </table>
          </div>
        </section>

        <hr class="my-10 border-t-2 border-indigo-100"/>

        <section id="section-habitaciones" class="p-6 border border-indigo-200 rounded-xl bg-white shadow-md">
          <h3 id="form-habitacion-titulo" class="text-xl font-semibold text-indigo-700 mb-4 flex items-center gap-2">
             <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.653-.084-1.298-.25-1.921M12 12A3 3 0 1012 6a3 3 0 000 6zM6 20h2v-2a3 3 0 015.356-1.857M6 20H4v-2a3 3 0 015.356-1.857m0 0A3.002 3.002 0 0112 15c1.228 0 2.313.612 3 1.502M12 9.5A2.5 2.5 0 0114.5 12H9.5A2.5 2.5 0 0112 9.5z" /></svg>
            Crear Nueva Habitación
          </h3>
          <form id="form-crear-habitacion" class="form mb-8 bg-indigo-50/50 rounded-lg p-5 space-y-5" novalidate>
            <input type="hidden" name="habitacionIdEdit" />
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              <div><label for="hab-nombre" class="form-label text-indigo-800">Nombre/Número Habitación *</label><input type="text" name="nombre" id="hab-nombre" class="form-control" required /></div>
              <div><label for="hab-tipo" class="form-label text-indigo-800">Tipo</label><input type="text" name="tipo" id="hab-tipo" class="form-control" placeholder="Ej: Sencilla, Doble, Suite"/></div>
              <div><label for="hab-precio" class="form-label text-indigo-800">Precio Base (Noche) *</label><input type="number" name="precio" id="hab-precio" class="form-control" min="0" step="any" required placeholder="0.00"/></div>
              <div><label for="hab-piso" class="form-label text-indigo-800">Piso</label><input type="number" name="piso" id="hab-piso" class="form-control" min="0" /></div>
              <div><label for="hab-capacidad-base" class="form-label text-indigo-800">Capacidad Base (pers.)</label><input type="number" name="capacidad_base" id="hab-capacidad-base" class="form-control" min="1" value="1"/></div>
              <div><label for="hab-capacidad-maxima" class="form-label text-indigo-800">Capacidad Máxima (pers.)</label><input type="number" name="capacidad_maxima" id="hab-capacidad-maxima" class="form-control" min="1"/></div>
              <div class="md:col-span-1"><label for="hab-precio-huesped-adicional" class="form-label text-indigo-800">Precio Huésped Adicional</label><input type="number" name="precio_huesped_adicional" id="hab-precio-huesped-adicional" class="form-control" min="0" step="any" value="0"/></div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label for="hab-estado" class="form-label text-indigo-800">Estado Inicial *</label>
                <select name="estado" id="hab-estado" class="form-control" required><option value="libre">Libre</option><option value="limpieza">En Limpieza</option><option value="mantenimiento">En Mantenimiento</option><option value="bloqueada">Bloqueada</option></select>
              </div>
              <div><label for="hab-amenidades" class="form-label text-indigo-800">Amenidades (separadas por coma)</label><input type="text" name="amenidades" id="hab-amenidades" class="form-control" placeholder="Ej: Wifi, TV, AC" /></div>
            </div>
            <div>
              <label for="habitacion-tiempos-estancia" class="form-label text-indigo-800">Tiempos de Estancia Permitidos para esta Habitación</label>
              <select multiple name="tiempos_estancia_ids_select" id="habitacion-tiempos-estancia" class="form-control" size="5"></select>
              <small class="text-xs text-indigo-700">Mantén Ctrl (o Cmd en Mac) para seleccionar múltiples.</small>
            </div>
            <div class="flex items-center mb-3 space-x-2">
              <input type="checkbox" id="hab-activo" name="activo" class="form-check-input h-5 w-5 text-indigo-600" checked />
              <label for="hab-activo" class="form-label text-indigo-800 mb-0">Activa</label>
            </div>
            <div class="flex items-center gap-4 mt-6">
              <button type="submit" id="btn-guardar-habitacion" class="button button-primary py-2 px-4 text-sm">＋ Crear Habitación</button>
              <button type="button" id="btn-cancelar-edicion-habitacion" class="button button-outline py-2 px-4 text-sm" style="display:none;">Cancelar Edición</button>
            </div>
          </form>
          <h4 class="text-md font-semibold text-indigo-700 mb-3 mt-8">Listado de Habitaciones</h4>
          <div id="habitaciones-lista-container" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            </div>
        </section>
      </div>
    </div>
  `;


  // --- Obtención de elementos del DOM y asignación de listeners ---
  // (Similar a la versión anterior, pero asegurándose de que todos los IDs coincidan)
  const feedbackGlobalEl = container.querySelector('#habitaciones-global-feedback');
  const formTiempoEstanciaEl = container.querySelector('#form-tiempo-estancia');
  const tablaTiemposEstanciaBodyEl = container.querySelector('#tabla-tiempos-estancia-body');
  const btnGuardarTiempoEstanciaEl = container.querySelector('#btn-guardar-tiempo-estancia');
  const btnCancelarEdicionTiempoEl = container.querySelector('#btn-cancelar-edicion-tiempo');
  
  const formHabitacionEl = container.querySelector('#form-crear-habitacion');
  const formHabitacionTitleEl = container.querySelector('#form-habitacion-titulo');
  const selectHabitacionTiemposEl = container.querySelector('#habitacion-tiempos-estancia');
  const listaHabitacionesContainerEl = container.querySelector('#habitaciones-lista-container');
  const btnGuardarHabitacionEl = container.querySelector('#btn-guardar-habitacion');
  const btnCancelarEdicionHabitacionEl = container.querySelector('#btn-cancelar-edicion-habitacion');

  if (!currentHotelId) {
    if (feedbackGlobalEl) showHabitacionesFeedback(feedbackGlobalEl, 'Error crítico: Hotel no identificado. Módulo deshabilitado.', 'error', 0);
    if(formTiempoEstanciaEl) Array.from(formTiempoEstanciaEl.elements).forEach(el => el.disabled = true);
    if(formHabitacionEl) Array.from(formHabitacionEl.elements).forEach(el => el.disabled = true);
    return;
  }

  // --- Lógica y Listeners para Tiempos de Estancia ---
  const tiempoEstanciaSubmitHandler = (e) => handleTiempoEstanciaSubmit(e, formTiempoEstanciaEl, tablaTiemposEstanciaBodyEl, feedbackGlobalEl, btnGuardarTiempoEstanciaEl, btnCancelarEdicionTiempoEl);
  formTiempoEstanciaEl.addEventListener('submit', tiempoEstanciaSubmitHandler);
  moduleListeners.push({ element: formTiempoEstanciaEl, type: 'submit', handler: tiempoEstanciaSubmitHandler });

  const cancelTiempoHandler = () => {
    resetearFormularioTiempoEstancia(formTiempoEstanciaEl, btnCancelarEdicionTiempoEl);
    if(feedbackGlobalEl) clearHabitacionesFeedbackLocal(feedbackGlobalEl);
    formTiempoEstanciaEl.elements.minutosTiempo.disabled = false;
  };
  btnCancelarEdicionTiempoEl.addEventListener('click', cancelTiempoHandler);
  moduleListeners.push({ element: btnCancelarEdicionTiempoEl, type: 'click', handler: cancelTiempoHandler });

  const nombreTiempoInput = formTiempoEstanciaEl.elements.nombreTiempo;
  const minutosTiempoInput = formTiempoEstanciaEl.elements.minutosTiempo;
  const nombreTiempoChangeHandler = () => {
    if (nombreTiempoInput.value.toLowerCase().includes('noche')) {
        minutosTiempoInput.value = calcularMinutosNocheDesdeConfig();
        minutosTiempoInput.disabled = true;
    } else {
        minutosTiempoInput.disabled = false;
    }
  };
  nombreTiempoInput.addEventListener('input', nombreTiempoChangeHandler);
  moduleListeners.push({ element: nombreTiempoInput, type: 'input', handler: nombreTiempoChangeHandler });

  const tablaTiemposClickHandler = async (e) => {
    const button = e.target.closest('button[data-accion]');
    if (!button) return;
    const tiempoId = button.dataset.id;
    const accion = button.dataset.accion;
    if (feedbackGlobalEl) clearHabitacionesFeedbackLocal(feedbackGlobalEl);

    const originalButtonText = button.textContent;
    button.disabled = true; button.textContent = '...';

    try {
        if (accion === 'editar-tiempo') {
          const tiempoToEdit = todosLosTiemposEstanciaCache.find(t => t.id.toString() === tiempoId);
          if (tiempoToEdit) {
            populateFormularioTiempoEstancia(formTiempoEstanciaEl, tiempoToEdit, btnCancelarEdicionTiempoEl);
            window.scrollTo({ top: formTiempoEstanciaEl.offsetTop - 20, behavior: 'smooth' });
          } else { showHabitacionesFeedback(feedbackGlobalEl, 'Tiempo de estancia no encontrado.', 'error'); }
        } else if (accion === 'toggle-activo-tiempo') {
          const estadoActual = button.dataset.estadoActual === 'true';
          const { error } = await currentSupabaseInstance.from('tiempos_estancia').update({ activo: !estadoActual }).eq('id', tiempoId).eq('hotel_id', currentHotelId);
          if (error) throw error;
          showHabitacionesFeedback(feedbackGlobalEl, `Tiempo de estancia ${!estadoActual ? 'activado' : 'desactivado'}.`, 'success');
          await registrarEnBitacora({ supabase: currentSupabaseInstance, hotel_id: currentHotelId, usuario_id: currentModuleUser.id, modulo: 'Habitaciones', accion: 'TOGGLE_TIEMPO_ESTANCIA', detalles: { tiempo_id: tiempoId, activo: !estadoActual } });
          await cargarYRenderizarTiemposEstancia(tablaTiemposEstanciaBodyEl, feedbackGlobalEl);
        }
    } catch (err) { showHabitacionesFeedback(feedbackGlobalEl, `Error en acción '${accion}': ${err.message}`, 'error', 0);
    } finally { button.disabled = false; button.textContent = originalButtonText; }
  };
  tablaTiemposEstanciaBodyEl.addEventListener('click', tablaTiemposClickHandler);
  moduleListeners.push({ element: tablaTiemposEstanciaBodyEl, type: 'click', handler: tablaTiemposClickHandler });

  // --- Lógica y Listeners para Habitaciones ---
  const habitacionSubmitHandler = (e) => handleHabitacionSubmit(e, formHabitacionEl, selectHabitacionTiemposEl, listaHabitacionesContainerEl, feedbackGlobalEl, btnGuardarHabitacionEl, btnCancelarEdicionHabitacionEl, formHabitacionTitleEl);
  formHabitacionEl.addEventListener('submit', habitacionSubmitHandler);
  moduleListeners.push({ element: formHabitacionEl, type: 'submit', handler: habitacionSubmitHandler });

  const cancelHabitacionHandler = () => {
    resetFormHabitacion(formHabitacionEl, selectHabitacionTiemposEl, btnCancelarEdicionHabitacionEl, btnGuardarHabitacionEl, formHabitacionTitleEl);
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
    button.disabled = true; button.textContent = '...';

    try {
        if (accion === 'editar-habitacion') {
          showLoading(feedbackGlobalEl, 'Cargando datos de la habitación...');
          const { data: habitacionData, error } = await currentSupabaseInstance
            .from('habitaciones')
            .select('*, habitacion_tiempos_permitidos(tiempo_estancia_id)')
            .eq('id', habitacionId).eq('hotel_id', currentHotelId).single();
          clearFeedback(feedbackGlobalEl);
          if (error) throw error;
          if (habitacionData) {
            populateFormHabitacion(formHabitacionEl, selectHabitacionTiemposEl, habitacionData, btnCancelarEdicionHabitacionEl, btnGuardarHabitacionEl, formHabitacionTitleEl);
            window.scrollTo({ top: formHabitacionEl.offsetTop - 20, behavior: 'smooth' });
          } else { showHabitacionesFeedback(feedbackGlobalEl, 'Habitación no encontrada.', 'error'); }
        } else if (accion === 'eliminar-habitacion') {
          const habitacionCard = button.closest('.habitacion-card');
          const nombreHabitacion = habitacionCard?.querySelector('.habitacion-nombre')?.textContent || habitacionId;
          if (confirm(`¿Está seguro de que desea eliminar la habitación "${nombreHabitacion}"? Esta acción no se puede deshacer.`)) {
            showLoading(feedbackGlobalEl, 'Eliminando habitación...');
            await currentSupabaseInstance.from('habitacion_tiempos_permitidos').delete().eq('habitacion_id', habitacionId).eq('hotel_id', currentHotelId);
            const { error } = await currentSupabaseInstance.from('habitaciones').delete().eq('id', habitacionId).eq('hotel_id', currentHotelId);
            clearFeedback(feedbackGlobalEl);
            if (error) throw error;
            showHabitacionesFeedback(feedbackGlobalEl, 'Habitación eliminada exitosamente.', 'success');
            await registrarEnBitacora({ supabase: currentSupabaseInstance, hotel_id: currentHotelId, usuario_id: currentModuleUser.id, modulo: 'Habitaciones', accion: 'ELIMINAR_HABITACION', detalles: { habitacion_id: habitacionId, nombre: nombreHabitacion } });
            await renderHabitaciones(listaHabitacionesContainerEl, feedbackGlobalEl);
            if (formHabitacionEl.elements.habitacionIdEdit.value === habitacionId) {
              resetFormHabitacion(formHabitacionEl, selectHabitacionTiemposEl, btnCancelarEdicionHabitacionEl, btnGuardarHabitacionEl, formHabitacionTitleEl);
            }
          }
        }
    } catch (err) {
        console.error(`Error en acción '${accion}' de habitación:`, err);
        showHabitacionesFeedback(feedbackGlobalEl, `Error al procesar acción: ${err.message}`, 'error', 0);
    } finally { button.disabled = false; button.textContent = originalButtonText; }
  };
  listaHabitacionesContainerEl.addEventListener('click', listaHabitacionesClickHandler);
  moduleListeners.push({ element: listaHabitacionesContainerEl, type: 'click', handler: listaHabitacionesClickHandler });

  // Carga inicial de datos
  setFormLoadingState(formTiempoEstanciaEl, true, btnGuardarTiempoEstanciaEl, '＋ Crear Tiempo', 'Cargando...');
  setFormLoadingState(formHabitacionEl, true, btnGuardarHabitacionEl, '＋ Crear Habitación', 'Cargando...');
  
  await cargarYRenderizarTiemposEstancia(tablaTiemposEstanciaBodyEl, feedbackGlobalEl);
  await renderHabitaciones(listaHabitacionesContainerEl, feedbackGlobalEl);
  
  setFormLoadingState(formTiempoEstanciaEl, false, btnGuardarTiempoEstanciaEl, '＋ Crear Tiempo');
  setFormLoadingState(formHabitacionEl, false, btnGuardarHabitacionEl, '＋ Crear Habitación');

  resetearFormularioTiempoEstancia(formTiempoEstanciaEl, btnCancelarEdicionTiempoEl);
  resetFormHabitacion(formHabitacionEl, selectHabitacionTiemposEl, btnCancelarEdicionHabitacionEl, btnGuardarHabitacionEl, formHabitacionTitleEl);

  if(formTiempoEstanciaEl && formTiempoEstanciaEl.elements.nombreTiempo) formTiempoEstanciaEl.elements.nombreTiempo.focus();
  console.log("[Habitaciones/mount] Montaje completado.");
  console.log("[Habitaciones/mount] Detalles del plan recibidos:", activePlanDetails);
}

export function unmount() {
  console.log("[Habitaciones.unmount] Limpiando listeners y estado...");
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
  hotelCheckinTimeConfig = "15:00"; // Reset a predeterminados
  hotelCheckoutTimeConfig = "12:00";
  console.log('[Habitaciones] Módulo desmontado.');
}

