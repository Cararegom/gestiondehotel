import {
  showError,
  showSuccess,
  showLoading,
  clearFeedback,
  setFormLoadingState,
  formatCurrency,
  formatDateTime
} from '../../uiUtils.js';




// --- MÓDULO DE ESTADO GLOBAL ---
// Centraliza los datos y clientes que el módulo necesita para operar.
const state = {
  isEditMode: false,
  editingReservaId: null,
  tiemposEstanciaDisponibles: [],
  currentUser: null,
  hotelId: null,
  supabase: null,
};

// --- MÓDULO DE UI (VISTA) ---
// Centraliza toda la manipulación del DOM para separar la lógica de la presentación.
const ui = {
  container: null,
  form: null,
  feedbackDiv: null,
  formTitle: null,
  submitButton: null,
  cancelEditButton: null,
  reservasListEl: null,
  fechaEntradaInput: null,
  tipoCalculoDuracionEl: null,
  nochesManualContainer: null,
  cantidadNochesInput: null,
  tiempoPredefinidoContainer: null,
  tiempoEstanciaIdSelect: null,
  habitacionIdSelect: null,

  /**
   * Inicializa las referencias a los elementos del DOM una sola vez.
   * @param {HTMLElement} containerEl - El elemento contenedor principal del módulo.
   */
  init(containerEl) {
    this.container = containerEl;
    this.form = containerEl.querySelector('#reserva-form');
    this.feedbackDiv = containerEl.querySelector('#reserva-feedback');
    this.formTitle = containerEl.querySelector('#form-title');
    this.submitButton = containerEl.querySelector('#submit-button');
    this.cancelEditButton = containerEl.querySelector('#cancel-edit-button');
    this.reservasListEl = containerEl.querySelector('#reservas-list');
    this.fechaEntradaInput = containerEl.querySelector('#fecha_entrada');
    this.tipoCalculoDuracionEl = containerEl.querySelector('#tipo_calculo_duracion');
    this.nochesManualContainer = containerEl.querySelector('#noches-manual-container');
    this.cantidadNochesInput = containerEl.querySelector('#cantidad_noches');
    this.tiempoPredefinidoContainer = containerEl.querySelector('#tiempo-predefinido-container');
    this.tiempoEstanciaIdSelect = containerEl.querySelector('#tiempo_estancia_id');
    this.habitacionIdSelect = containerEl.querySelector('#habitacion_id');
  },

  /**
   * Muestra un modal de confirmación. Reemplaza el `confirm()` nativo.
   */
  async showConfirmationModal(message) {
    // Para una mejor UX, reemplaza esto con tu propia librería de modales (ej. SweetAlert2).
    return window.confirm(message);
  },

  /**
   * Muestra un modal de información. Reemplaza el `alert()` nativo.
   */
  showInfoModal(message) {
    // Para una mejor UX, reemplaza esto con tu propia librería de modales.
    alert(message);
  },
};

// --- LÓGICA PRINCIPAL Y MANEJADORES DE EVENTOS ---

/**
 * Orquesta el envío del formulario, dividiendo la lógica en pasos.
 * @param {Event} event
 */
// REEMPLAZA ESTA FUNCIÓN COMPLETA
async function handleFormSubmit(event) {
  event.preventDefault();
  clearFeedback(ui.feedbackDiv);
  const actionText = state.isEditMode ? "Actualizando..." : "Registrando...";
  setFormLoadingState(ui.form, true, ui.submitButton, actionText);

  try {
    const formData = gatherFormData();
    validateInitialInputs(formData);
    
    // Aquí se valida el cruce y se lanza el error si es necesario
    const bookingPayload = await validateAndCalculateBooking(formData);

    if (state.isEditMode) {
      await updateBooking(bookingPayload);
    } else {
      await createBooking(bookingPayload);
    }
   
    // Lógica de éxito: Solo se ejecuta si todo salió bien
    const successMsg = `¡Reserva ${state.isEditMode ? 'actualizada' : 'creada'} con éxito!`;
    showSuccess(ui.feedbackDiv, successMsg);
    await renderReservas();
    document.dispatchEvent(new CustomEvent('datosActualizados'));
    resetFormToCreateMode();

  } catch (error) {
    // Manejo de errores: Solo se ejecuta si algo falló
    showError(ui.feedbackDiv, error.message);

  } finally {
    // Lógica final: Siempre se ejecuta para reactivar el formulario
    const buttonText = state.isEditMode ? "Actualizar Reserva" : "Registrar Reserva";
    setFormLoadingState(ui.form, false, ui.submitButton, buttonText);
  }
  // LAS LÍNEAS PROBLEMÁTICAS HAN SIDO ELIMINADAS DE AQUÍ
}
/**
 * Maneja los clics en los botones de acción de la lista de reservas.
 * @param {Event} event
 */
async function handleListActions(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const reservaId = button.dataset.id;
  const action = button.dataset.action;
  const habitacionIdReserva = button.dataset.habitacionId;

  try {
  switch (action) {
   case 'abonar':
  // Buscar la reserva por id antes de llamar el modal
  const { data: reservaActual, error: errorReserva } = await state.supabase
    .from('reservas')
    .select('*')
    .eq('id', reservaId)
    .single();
  if (errorReserva || !reservaActual) {
    Swal.fire('Error', 'No se encontró la reserva para abonar.', 'error');
    break;
  }
  await mostrarModalAbonoReserva(reservaActual);
  break;

    case 'editar':
      await prepareEditReserva(reservaId);
      break;
    case 'eliminar':
      await handleDeleteReserva(reservaId);
      break;
    case 'confirmar':
      await handleUpdateEstadoReserva(reservaId, 'confirmada', 'confirmada', habitacionIdReserva);
      break;
    case 'checkin':
      if (await puedeHacerCheckIn(reservaId)) {
        await handleUpdateEstadoReserva(reservaId, 'activa', 'ocupada', habitacionIdReserva);
      }
      break;
    case 'checkout':
      ui.showInfoModal("Para realizar esta acción, dirígete al Mapa de Habitaciones y haz clic en la habitación correspondiente.");
      break;
    case 'cancelar':
      console.log("[CANCELAR] Reserva ID:", reservaId, "Habitacion ID:", habitacionIdReserva);
      await handleUpdateEstadoReserva(reservaId, 'cancelada', null, habitacionIdReserva, true);
      break;
    default:
      console.warn("Acción desconocida:", action);
  }
} catch (error) {
  showError(ui.feedbackDiv, `Error en la acción '${action}': ${error.message}`);
  await renderReservas();
}
}

// --- OPERACIONES CON LA BASE DE DATOS (CRUD) ---

/**
 * Crea una nueva reserva y sus registros asociados (pago, actualización de habitación).
 * @param {object} payload - Contiene `datosReserva` y `datosPago`.
 */
// REEMPLAZA ESTA FUNCIÓN COMPLETA
async function createBooking(payload) {
  const { datosReserva, datosPago } = payload;

  // --- HEMOS ELIMINADO COMPLETAMENTE EL BLOQUE DE VALIDACIÓN DE CRUCE DE AQUÍ ---
  // La validación ya ocurrió en 'validateAndCalculateBooking'.

  // --- GUARDAR RESERVA ---
  const { data: reservaInsertada, error: errInsert } = await state.supabase
    .from('reservas').insert([datosReserva]).select().single();

  if (errInsert) throw new Error(`Error al guardar la reserva: ${errInsert.message}`);

  const nuevaReservaId = reservaInsertada.id;

  // --- Registrar en caja y pagos ---
  const tipoPago = datosPago?.tipo_pago || 'parcial';
  const montoPago = tipoPago === "completo"
    ? window.__totalReservaCalculado
    : parseInt(datosPago?.monto_abono) || 0;

  if (montoPago > 0) {
    const movimientoCaja = {
      hotel_id: datosReserva.hotel_id,
      tipo: 'ingreso',
      monto: montoPago,
      concepto: tipoPago === "completo" ? 'Pago completo de reserva' : 'Abono de reserva',
      referencia: nuevaReservaId,
      metodo_pago_id: datosPago.metodo_pago_id || null,
      creado_en: new Date().toISOString(),
      usuario_id: datosReserva.usuario_id
    };
    const { error: cajaError } = await state.supabase.from('caja').insert([movimientoCaja]);
    if (cajaError) {
      console.error("[RESERVA] Error al registrar movimiento en caja:", cajaError.message);
    }
  }

  const promises = [];
  if (datosPago.monto_abono > 0 && datosPago.metodo_pago_id) {
    promises.push(
      state.supabase.from('pagos_reserva').insert([{
        reserva_id: nuevaReservaId,
        monto: datosPago.monto_abono,
        metodo_pago_id: datosPago.metodo_pago_id,
        fecha_pago: new Date().toISOString(),
        hotel_id: state.hotelId,
        usuario_id: state.currentUser.id
      }])
    );
  }
  if (tipoPago === "completo") {
    promises.push(
      state.supabase.from('pagos_reserva').insert([{
        reserva_id: nuevaReservaId,
        monto: window.__totalReservaCalculado,
        metodo_pago_id: datosPago.metodo_pago_id || null,
        fecha_pago: new Date().toISOString(),
        hotel_id: state.hotelId,
        usuario_id: state.currentUser.id
      }])
    );
  }

  promises.push(
    state.supabase.from('habitaciones')
      .update({ estado: "reservada" })
      .eq('id', datosReserva.habitacion_id)
      .eq('estado', 'libre')
  );

  await Promise.all(promises);
  await renderReservas();

}




/**
 * Actualiza una reserva existente.
 * @param {object} payload - Contiene `datosReserva`.
 */
async function updateBooking(payload) {
  const {
    datosReserva
  } = payload;
  delete datosReserva.hotel_id; // No se debe cambiar en edición
  delete datosReserva.estado; // El estado se maneja con acciones separadas (confirmar, cancelar, etc.)

  const {
    error
  } = await state.supabase
    .from('reservas')
    .update(datosReserva)
    .eq('id', state.editingReservaId);

  if (error) throw new Error(`Error actualizando reserva: ${error.message}`);
}

/**
 * Prepara el formulario para editar una reserva.
 * @param {string} reservaId - El ID de la reserva a editar.
 */
async function prepareEditReserva(reservaId) {
  clearFeedback(ui.feedbackDiv);
  showLoading(ui.feedbackDiv, "Cargando datos para editar...");

  const {
    data: reserva,
    error
  } = await state.supabase
    .from('reservas').select('*').eq('id', reservaId).single();

  clearFeedback(ui.feedbackDiv);
  if (error || !reserva) throw new Error("Error al cargar la reserva para editar.");

  // Llenar el formulario con los datos de la reserva
  ui.form.elements.cliente_nombre.value = reserva.cliente_nombre || '';
  ui.form.elements.telefono.value = reserva.telefono || '';
  ui.form.elements.cantidad_huespedes.value = reserva.cantidad_huespedes || 1;
  ui.form.elements.habitacion_id.value = reserva.habitacion_id;

  if (reserva.fecha_inicio) {
    const fechaEntradaCorregida = new Date(new Date(reserva.fecha_inicio).getTime() - (new Date().getTimezoneOffset() * 60000));
    ui.form.elements.fecha_entrada.value = fechaEntradaCorregida.toISOString().slice(0, 16);
  } else {
    ui.form.elements.fecha_entrada.value = '';
  }

  if (reserva.tiempo_estancia_id && reserva.tipo_duracion === 'tiempo_estancia') {
    ui.tipoCalculoDuracionEl.value = 'tiempo_predefinido';
    ui.form.elements.tiempo_estancia_id.value = reserva.tiempo_estancia_id;
  } else {
    ui.tipoCalculoDuracionEl.value = 'noches_manual';
    ui.form.elements.cantidad_noches.value = reserva.cantidad_duracion || 1;
  }
  ui.tipoCalculoDuracionEl.dispatchEvent(new Event('change'));

  // El método de pago y el abono no se editan aquí, se manejan en la sección de pagos de la reserva.
  ui.form.elements.metodo_pago_id.value = '';
  ui.form.elements.monto_abono.value = '';
  ui.form.elements.notas.value = reserva.notas || '';

  // Cambiar estado de la UI a modo edición
  ui.formTitle.textContent = `Editar Reserva (ID: ${reservaId.substring(0, 8)})`;
  ui.submitButton.textContent = "Actualizar Reserva";
  ui.cancelEditButton.style.display = 'inline-flex';
  ui.form.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });

  state.isEditMode = true;
  state.editingReservaId = reservaId;
}

/**
 * Elimina una reserva de forma permanente.
 * @param {string} reservaId
 */
async function handleDeleteReserva(reservaId) {
  const confirmed = await ui.showConfirmationModal("¿Seguro de ELIMINAR PERMANENTEMENTE este registro de reserva? Esta acción no se puede deshacer.");
  if (!confirmed) return;

  showLoading(ui.feedbackDiv, "Eliminando...");
  const {
    error
  } = await state.supabase.from('reservas').delete().eq('id', reservaId);
  clearFeedback(ui.feedbackDiv);

  if (error) throw new Error(`Error al eliminar: ${error.message}`);

  showSuccess(ui.feedbackDiv, "Reserva eliminada.");
  await renderReservas();
}

/**
 * Actualiza el estado de una reserva y, opcionalmente, de la habitación.
 * @param {string} reservaId
 * @param {string} nuevoEstadoReserva
 * @param {string|null} nuevoEstadoHabitacion
 * @param {string} habitacionIdReserva
 * @param {boolean} forzarDisponibleHabitacion
 */
import * as mapaHabitaciones from '../mapa-habitaciones/mapa-habitaciones.js'; // ajusta el path según tu estructura


async function handleUpdateEstadoReserva(reservaId, nuevoEstadoReserva, nuevoEstadoHabitacion, habitacionIdReserva, forzarDisponibleHabitacion = false) {
  showLoading(ui.feedbackDiv, `Actualizando a ${nuevoEstadoReserva}...`);
  const {
    data: updatedReserva,
    error: errRes
  } = await state.supabase
    .from('reservas').update({
      estado: nuevoEstadoReserva
    }).eq('id', reservaId).select().single();

  // --- Corrige los nombres y libera la habitación si se cancela ---
  console.log("[CANCELAR PATCH]", {
  id: habitacionIdReserva,
  update: { estado: 'libre' }
});

const { error: updateHabitacionError } = await state.supabase
  .from('habitaciones')
  .update({ estado: 'libre' })
  .eq('id', habitacionIdReserva);

if (updateHabitacionError) {
  console.error("Error actualizando habitación:", updateHabitacionError);
}

  if (errRes) throw new Error(`Error actualizando reserva: ${errRes.message}`);

  let mensajeExito = `¡Reserva actualizada a ${nuevoEstadoReserva.replace(/_/g, ' ')}!`;

  let estadoFinalHabitacion = nuevoEstadoHabitacion;

  if (forzarDisponibleHabitacion) {
    const {
      data: hayCruce
    } = await state.supabase.rpc('validar_cruce_reserva', {
      p_habitacion_id: habitacionIdReserva,
      p_entrada: updatedReserva.fecha_inicio,
      p_salida: updatedReserva.fecha_fin,
      p_reserva_id_excluida: reservaId
    });

    if (hayCruce) {
      estadoFinalHabitacion = null; // No actualizar
      mensajeExito += ` (Habitación no se marcó como disponible por tener otros cruces).`;
    } else {
      estadoFinalHabitacion = 'libre';
    }
  }

 if (estadoFinalHabitacion) {
  console.log("[CANCELAR PATCH]", {
    id: habitacionIdReserva,
    update: { estado: estadoFinalHabitacion }
  });

  const { error: updateHabitacionError } = await state.supabase
    .from('habitaciones')
    .update({
      estado: estadoFinalHabitacion
    })
    .eq('id', habitacionIdReserva);

  if (updateHabitacionError) {
    console.error("Error actualizando habitación:", updateHabitacionError);
  }
}

  showSuccess(ui.feedbackDiv, mensajeExito);
  await renderReservas();

  // --- Refresca el mapa de habitaciones si tienes las variables globales ---
  if (
    typeof containerGlobal !== "undefined" &&
    typeof supabaseGlobal !== "undefined" &&
    typeof currentUserGlobal !== "undefined" &&
    typeof hotelIdGlobal !== "undefined" &&
    mapaHabitaciones.mount
  ) {
    await mapaHabitaciones.mount(
      containerGlobal,
      supabaseGlobal,
      currentUserGlobal,
      hotelIdGlobal
    );
  }
}


// --- LÓGICA DE CÁLCULOS Y VALIDACIONES ---

/**
 * Recolecta los datos del formulario en un objeto.
 * @returns {object}
 */
function gatherFormData() {
  const formElements = ui.form.elements;
  return {
    cliente_nombre: formElements.cliente_nombre.value,
    telefono: formElements.telefono.value,
    fecha_entrada: formElements.fecha_entrada.value,
    tipo_calculo_duracion: formElements.tipo_calculo_duracion.value,
    cantidad_noches: formElements.cantidad_noches.value,
    tiempo_estancia_id: formElements.tiempo_estancia_id.value,
    habitacion_id: formElements.habitacion_id.value,
    cantidad_huespedes: formElements.cantidad_huespedes.value,
    metodo_pago_id: formElements.metodo_pago_id.value,
    monto_abono: formElements.monto_abono.value,
    notas: formElements.notas.value,
    tipo_pago: formElements.tipo_pago.value // <-- AGREGA ESTO
  };
}


/**
 * Realiza validaciones síncronas iniciales sobre los datos del formulario.
 * @param {object} formData
 */
function validateInitialInputs(formData) {
  if (!formData.cliente_nombre.trim()) throw new Error("El nombre del cliente es obligatorio.");
  if (!formData.habitacion_id) throw new Error("Debe seleccionar una habitación.");
  if (!formData.fecha_entrada) throw new Error("La fecha y hora de llegada son obligatorias.");
  
  const fechaEntradaDate = new Date(formData.fecha_entrada);
  if (!state.isEditMode && fechaEntradaDate < new Date(Date.now() - 10 * 60 * 1000)) {
    throw new Error("La fecha de llegada no puede ser en el pasado para nuevas reservas.");
  }

  if (formData.tipo_calculo_duracion === "noches_manual" && (!formData.cantidad_noches || parseInt(formData.cantidad_noches) < 1)) {
    throw new Error("La cantidad de noches debe ser al menos 1.");
  }
  if (formData.tipo_calculo_duracion === "tiempo_predefinido" && !formData.tiempo_estancia_id) {
    throw new Error("Debe seleccionar un tiempo de estancia predefinido.");
  }
  if (!formData.cantidad_huespedes || parseInt(formData.cantidad_huespedes) < 1) {
    throw new Error("La cantidad de huéspedes debe ser al menos 1.");
  }

  // En MODO CREACIÓN, el abono es opcional, pero si se ingresa, el método de pago es obligatorio.
  if (!state.isEditMode && (parseFloat(formData.monto_abono) || 0) > 0 && !formData.metodo_pago_id) {
    throw new Error("Si registra un abono, debe seleccionar un método de pago.");
  }
}

/**
 * Realiza las validaciones y cálculos que requieren llamadas a la base de datos.
 * @param {object} formData
 * @returns {Promise<object>}
 */
async function validateAndCalculateBooking(formData) {
  // Obtener info de habitación y hotel en paralelo
  const [habitacionResult, hotelResult] = await Promise.all([
    state.supabase.from('habitaciones')
      .select('precio, capacidad_base, capacidad_maxima, precio_huesped_adicional, permite_reservas_por_horas, precio_base_hora')
      .eq('id', formData.habitacion_id).single(),
    state.supabase.from('hoteles').select('checkout_hora').eq('id', state.hotelId).single()
  ]);

  if (habitacionResult.error) throw new Error("Error obteniendo detalles de la habitación.");
  if (hotelResult.error) throw new Error("No se pudo obtener la configuración del hotel.");

  const habitacionInfo = habitacionResult.data;
  const hotelConfig = hotelResult.data;

  // Calcular fechas de estancia
  const { fechaEntrada, fechaSalida, tipoDuracionOriginal, cantidadDuracionOriginal, errorFechas } = calculateFechasEstancia(
    formData.fecha_entrada, formData.tipo_calculo_duracion, formData.cantidad_noches, formData.tiempo_estancia_id, hotelConfig.checkout_hora
  );
  if (errorFechas) throw new Error(errorFechas);
  
  if (tipoDuracionOriginal === "tiempo_predefinido" && !habitacionInfo.permite_reservas_por_horas && !esTiempoEstanciaNoches(formData.tiempo_estancia_id)) {
    throw new Error("La habitación seleccionada no permite reservas por horas.");
  }

  // Validar cruce de fechas
  const { data: hayCruce, error: errCruce } = await state.supabase.rpc('validar_cruce_reserva', {
    p_habitacion_id: formData.habitacion_id,
    p_entrada: fechaEntrada.toISOString(),
    p_salida: fechaSalida.toISOString(),
    p_reserva_id_excluida: state.isEditMode ? state.editingReservaId : null
  });
  if (errCruce) throw new Error(`Error validando disponibilidad: ${errCruce.message}.`);
  if (hayCruce) throw new Error("Conflicto: La habitación no está disponible para el período seleccionado.");

  // Calcular montos
  const { montoEstanciaBase, montoPorHuespedesAdicionales, errorMonto } = calculateMontos(
    habitacionInfo, parseInt(formData.cantidad_huespedes), tipoDuracionOriginal, cantidadDuracionOriginal, formData.tiempo_estancia_id
  );
  if (errorMonto) throw new Error(errorMonto);

  // Ensamblar el payload final
  const datosReserva = {
    cliente_nombre: formData.cliente_nombre.trim(),
    telefono: formData.telefono.trim() || null,
    cantidad_huespedes: parseInt(formData.cantidad_huespedes),
    habitacion_id: formData.habitacion_id,
    fecha_inicio: fechaEntrada.toISOString(),
    fecha_fin: fechaSalida.toISOString(),
    estado: state.isEditMode ? undefined : 'reservada',
    hotel_id: state.hotelId,
    usuario_id: state.currentUser.id,
    tipo_duracion: tipoDuracionOriginal,
    cantidad_duracion: cantidadDuracionOriginal,
    tiempo_estancia_id: tipoDuracionOriginal === 'tiempo_predefinido' ? formData.tiempo_estancia_id : null,
    monto_estancia_base: montoEstanciaBase,
    monto_por_huespedes_adicionales: montoPorHuespedesAdicionales,
    monto_total: montoEstanciaBase + montoPorHuespedesAdicionales,
    notas: formData.notas.trim() || null,
    origen_reserva: 'directa',
  };
  const datosPago = {
  monto_abono: parseFloat(formData.monto_abono) || 0,
  metodo_pago_id: formData.metodo_pago_id || null,
  tipo_pago: formData.tipo_pago // <-- AGREGA ESTO
};
  return { datosReserva, datosPago };
}

// --- FUNCIONES AUXILIARES DE CÁLCULO ---

function calculateFechasEstancia(fechaEntradaStr, tipoCalculo, cantidadNochesStr, tiempoEstanciaId, hotelCheckoutHora = "12:00") {
  const fechaEntrada = new Date(fechaEntradaStr);
  if (isNaN(fechaEntrada.getTime())) return { errorFechas: "La fecha de entrada proporcionada no es válida." };

  let fechaSalida, cantidadDuracionOriginal;
  const tipoDuracionOriginal = tipoCalculo;

  if (tipoCalculo === "noches_manual") {
    cantidadDuracionOriginal = parseInt(cantidadNochesStr) || 1;
    fechaSalida = new Date(fechaEntrada);
    fechaSalida.setDate(fechaSalida.getDate() + cantidadDuracionOriginal);
    const [hh, mm] = hotelCheckoutHora.split(':').map(Number);
    fechaSalida.setHours(hh, mm, 0, 0);
  } else {
    const tiempo = state.tiemposEstanciaDisponibles.find(ts => ts.id === tiempoEstanciaId);
    if (!tiempo || typeof tiempo.minutos !== 'number') return { errorFechas: "Tiempo de estancia predefinido no válido." };
    cantidadDuracionOriginal = tiempo.minutos;
    fechaSalida = new Date(fechaEntrada.getTime() + (tiempo.minutos * 60 * 1000));
  }

  if (fechaSalida <= fechaEntrada) return { errorFechas: "La fecha de salida debe ser posterior a la de llegada." };
  return { fechaEntrada, fechaSalida, tipoDuracionOriginal, cantidadDuracionOriginal, errorFechas: null };
}

function calculateMontos(habitacionInfo, huespedes, tipoDuracion, cantDuracion, tiempoId) {
  let montoEstanciaBase = 0;
  if (tipoDuracion === "noches_manual") {
    montoEstanciaBase = (habitacionInfo.precio || 0) * cantDuracion;
  } else {
    const tiempo = state.tiemposEstanciaDisponibles.find(ts => ts.id === tiempoId);
    if (tiempo && typeof tiempo.precio === 'number' && tiempo.precio >= 0) {
      montoEstanciaBase = tiempo.precio;
    } else if (habitacionInfo.precio_base_hora && habitacionInfo.precio_base_hora > 0 && cantDuracion > 0) {
      montoEstanciaBase = habitacionInfo.precio_base_hora * (cantDuracion / 60);
    } else {
      return { errorMonto: "No se pudo determinar el precio para el tiempo de estancia." };
    }
  }

  let montoPorHuespedesAdicionales = 0;
  if (huespedes > habitacionInfo.capacidad_maxima) {
    return { errorMonto: `Huéspedes (${huespedes}) exceden capacidad máxima (${habitacionInfo.capacidad_maxima}).` };
  }

  if (huespedes > habitacionInfo.capacidad_base) {
    const extra = huespedes - habitacionInfo.capacidad_base;
    let factorMultiplicador = 1;
    if (tipoDuracion === "noches_manual") {
      factorMultiplicador = cantDuracion;
    } else if (tipoDuracion === "tiempo_predefinido" && esTiempoEstanciaNoches(tiempoId)) {
      factorMultiplicador = Math.max(1, Math.round(cantDuracion / (24 * 60)));
    }
    montoPorHuespedesAdicionales = extra * (habitacionInfo.precio_huesped_adicional || 0) * factorMultiplicador;
  }

  return { montoEstanciaBase, montoPorHuespedesAdicionales, errorMonto: null };
}

function esTiempoEstanciaNoches(tiempoEstanciaId) {
  if (!tiempoEstanciaId) return false;
  const tiempo = state.tiemposEstanciaDisponibles.find(ts => ts.id === tiempoEstanciaId);
  return tiempo && tiempo.minutos >= (22 * 60) && tiempo.minutos <= (26 * 60);
}


// --- CARGA DE DATOS Y RENDERIZADO ---

async function loadInitialData() {
  await Promise.all([
    cargarHabitaciones(),
    cargarMetodosPago(),
    cargarTiemposEstancia()
  ]);
  await renderReservas();
}

async function cargarHabitaciones() {
  ui.habitacionIdSelect.innerHTML = `<option value="">Cargando...</option>`;
  ui.habitacionIdSelect.disabled = true;
console.log("Valor actual del select de habitaciones:", ui.habitacionIdSelect.value);
  const { data: rooms, error } = await state.supabase.from('habitaciones')
    .select('id, nombre, tipo, estado, precio, capacidad_base, capacidad_maxima')
    .eq('hotel_id', state.hotelId).eq('activo', true).order('nombre', { ascending: true });

  if (error) {
    ui.habitacionIdSelect.innerHTML = `<option value="">Error</option>`;
  } else if (!rooms || rooms.length === 0) {
    ui.habitacionIdSelect.innerHTML = `<option value="">No hay habitaciones</option>`;
  } else {
    let optionsHtml = `<option value="">Selecciona habitación...</option>`;
    for (const room of rooms) {
      // Aquí agregamos el precio base como data-precio
      optionsHtml += `<option value="${room.id}" 
        data-precio="${room.precio || 0}"
        data-capacidad-base="${room.capacidad_base || 1}"
        data-precio-extra="${room.precio_huesped_adicional || 0}">
        ${room.nombre} (${formatCurrency(room.precio)})
      </option>`;
    }
    ui.habitacionIdSelect.innerHTML = optionsHtml;
  }
  ui.habitacionIdSelect.disabled = false;
}


async function cargarMetodosPago() {
  const select = ui.form.elements.metodo_pago_id;
  select.innerHTML = `<option value="">Cargando...</option>`;
  const { data, error } = await state.supabase.from('metodos_pago').select('id, nombre')
    .eq('hotel_id', state.hotelId).eq('activo', true).order('nombre');
  if (error) {
    select.innerHTML = `<option value="">Error</option>`;
    return;
  }
  let optionsHtml = `<option value="">Selecciona (Opcional)...</option>`;
  data.forEach(pago => optionsHtml += `<option value="${pago.id}">${pago.nombre}</option>`);
  select.innerHTML = optionsHtml;
}

async function cargarTiemposEstancia() {
  const { data, error } = await state.supabase
    .from('tiempos_estancia')
    .select('id, nombre, minutos, precio')
    .eq('hotel_id', state.hotelId)
    .eq('activo', true)
    .order('minutos', { ascending: true });

  ui.tiempoEstanciaIdSelect.innerHTML = ""; // Limpia el select

  if (error || !data || !data.length) {
    const opt = document.createElement('option');
    opt.value = "";
    opt.textContent = error ? "Error cargando tiempos" : "No hay tiempos predefinidos";
    ui.tiempoEstanciaIdSelect.appendChild(opt);
    state.tiemposEstanciaDisponibles = [];
    return;
  }

  state.tiemposEstanciaDisponibles = data;

  // Opción placeholder
  const placeholder = document.createElement('option');
  placeholder.value = "";
  placeholder.textContent = "Selecciona un tiempo...";
  ui.tiempoEstanciaIdSelect.appendChild(placeholder);

  data.forEach(ts => {
    const option = document.createElement('option');
    option.value = ts.id;
    const horasAprox = (ts.minutos / 60).toFixed(1);
    option.textContent = `${ts.nombre} ($${Number(ts.precio).toLocaleString("es-CO")}) - ${horasAprox}h`;
    option.setAttribute('data-precio', ts.precio);
    ui.tiempoEstanciaIdSelect.appendChild(option);
  });


}

async function renderReservas() {
  ui.reservasListEl.innerHTML = `<div class="text-center p-4">Cargando...</div>`;
  // Traer reservas principales
  const { data: reservas, error } = await state.supabase.from('reservas')
    .select(`*, habitaciones(nombre, tipo), metodos_pago(nombre)`)
    .eq('hotel_id', state.hotelId)
    .in('estado', ['reservada', 'confirmada', 'activa', 'check_in'])
    .order('fecha_inicio', { ascending: true }).limit(100);

  if (error) {
    ui.reservasListEl.innerHTML = `<div class="error-box">Error: ${error.message}</div>`;
    return;
  }
  if (!reservas || reservas.length === 0) {
    ui.reservasListEl.innerHTML = `<div class="info-box">No hay reservas activas.</div>`;
    return;
  }

  // Traer TODOS los pagos de esas reservas de una sola vez
  const ids = reservas.map(r => r.id);
  const { data: pagosAll } = await state.supabase.from('pagos_reserva')
    .select('reserva_id, monto')
    .in('reserva_id', ids);

  // Crear un mapa de abonos por reserva_id para hacerlo rápido
  const mapaPagos = {};
  if (pagosAll) {
    for (const p of pagosAll) {
      if (!mapaPagos[p.reserva_id]) mapaPagos[p.reserva_id] = 0;
      mapaPagos[p.reserva_id] += Number(p.monto) || 0;
    }
  }

  // Añadir los campos 'abonado' y 'pendiente' a cada reserva
  reservas.forEach(r => {
    const abonado = mapaPagos[r.id] || 0;
    r.abonado = abonado;
    r.pendiente = Math.max((r.monto_total || 0) - abonado, 0);
  });

  // Agrupar por estado
  const grouped = reservas.reduce((acc, r) => {
    (acc[r.estado] = acc[r.estado] || []).push(r);
    return acc;
  }, {});

  let html = '';
  ['reservada', 'confirmada', 'activa', 'check_in'].forEach(key => {
    if (grouped[key]) {
      html += renderReservasGrupo(key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '), grouped[key]);
    }
  });
  ui.reservasListEl.innerHTML = html || `<div class="info-box">No hay reservas.</div>`;
}

// MODIFICA ESTA FUNCIÓN para mostrar los valores de abono y pendiente en la tarjeta:
function renderReservasGrupo(titulo, grupo) {
  let html = `<h3 class="text-xl font-bold mt-6 mb-3 text-blue-700 border-b pb-2">${titulo} (${grupo.length})</h3>`;
  html += `<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">`;
  grupo.forEach(r => {
    const estadoActual = (r.estado || 'N/A').toUpperCase().replace(/_/g, ' ');
    html += `
      <div class="p-4 bg-white rounded-lg shadow-md border-l-4 ${getBorderColorForEstado(r.estado)}">
        <div class="flex justify-between items-start mb-2">
          <h4 class="font-semibold text-lg text-gray-800">${r.cliente_nombre}</h4>
          <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full ${getBgColorForEstado(r.estado)} ${getTextColorForEstado(r.estado)}">${estadoActual}</span>
        </div>
        <div class="text-sm space-y-1 text-gray-600">
          <p><strong>Habitación:</strong> ${r.habitaciones?.nombre || 'N/A'}</p>
          <p><strong>Huéspedes:</strong> ${r.cantidad_huespedes}</p>
          <p><strong>Llegada:</strong> ${formatDateTime(r.fecha_inicio)}</p>
          <p><strong>Salida:</strong> ${formatDateTime(r.fecha_fin)}</p>
          <p><strong>Monto Total:</strong> ${formatCurrency(r.monto_total)}</p>
          ${r.abonado > 0 ? `<p style="color:#059669"><strong>Abonado:</strong> ${formatCurrency(r.abonado)}</p>` : ""}
          ${r.pendiente > 0 ? `<p style="color:#ca6510"><strong>Pendiente:</strong> ${formatCurrency(r.pendiente)}</p>` : ""}
          ${r.notas ? `<p class="mt-1"><strong>Notas:</strong> <span class="italic">${r.notas}</span></p>` : ''}
        </div>
        <div class="mt-4 pt-3 border-t flex flex-wrap gap-2">
          ${getAccionesReservaHTML(r)}
        </div>
      </div>`;
  });
  html += `</div>`;
  return html;
}

// MODAL PARA ABONAR O COMPLETAR PAGO
// MODAL PARA ABONAR O COMPLETAR PAGO
async function mostrarModalAbonoReserva(reservaActual) {
  // 1. Carga los métodos de pago desde la base de datos
  const { data: metodosPago, error: errorMetodosPago } = await state.supabase
    .from('metodos_pago')
    .select('id, nombre')
    .eq('hotel_id', state.hotelId)
    .eq('activo', true)
    .order('nombre', { ascending: true });

  if (errorMetodosPago || !metodosPago || metodosPago.length === 0) {
    Swal.fire('Error', 'No se pudieron cargar los métodos de pago.', 'error');
    return;
  }

  const selectOptions = metodosPago
    .map(mp => `<option value="${mp.id}">${mp.nombre}</option>`)
    .join('');

  // 2. Mostrar modal para capturar abono y método de pago
  const { value: formValues } = await Swal.fire({
    title: 'Registrar Abono',
    html:
      `<input id="swal-abono-monto" class="swal2-input" type="number" min="1" placeholder="Valor a abonar">` +
      `<select id="swal-metodo-pago" class="swal2-input">
         <option value="">Selecciona método de pago</option>
         ${selectOptions}
       </select>`,
    focusConfirm: false,
    preConfirm: () => {
      const monto = parseFloat(document.getElementById('swal-abono-monto').value) || 0;
      const metodo = document.getElementById('swal-metodo-pago').value;
      if (monto <= 0 || !metodo) {
        Swal.showValidationMessage('Debes ingresar un monto y seleccionar el método de pago');
        return false;
      }
      return { monto, metodo };
    },
    confirmButtonText: 'Registrar Abono',
    showCancelButton: true,
    cancelButtonText: 'Cancelar'
  });

  if (!formValues) return; // Cancelado

  // 3. Insertar abono en pagos_reserva
  const { error: abonoError } = await state.supabase.from('pagos_reserva').insert([{
    reserva_id: reservaActual.id,
    monto: formValues.monto,
    metodo_pago_id: formValues.metodo,
    fecha_pago: new Date().toISOString(),
    hotel_id: state.hotelId,
    usuario_id: state.currentUser.id
  }]);

  if (abonoError) {
    console.error("[ABONO] Error detalle:", abonoError);
    Swal.fire('Error', 'No se pudo registrar el abono.', 'error');
    return;
  }

  // 4. Registrar movimiento en caja
  const movimientoCaja = {
    hotel_id: state.hotelId,
    tipo: 'ingreso',
    monto: formValues.monto,
    concepto: 'Abono de reserva',
    referencia: reservaActual.id,
    metodo_pago_id: formValues.metodo,
    creado_en: new Date().toISOString(),
    usuario_id: state.currentUser.id
  };

  const { error: cajaError } = await state.supabase.from('caja').insert([movimientoCaja]);
  if (cajaError) {
    console.error("[ABONO] Error al registrar movimiento en caja:", cajaError.message, cajaError);
    Swal.fire('Advertencia', 'El abono fue registrado, pero NO se pudo registrar en caja.', 'warning');
  } else {
    Swal.fire('¡Éxito!', 'Abono registrado correctamente.', 'success');
  }

  await renderReservas(); // Refresca la lista de reservas
}


// Puedes crear esta función para seleccionar el método de pago (sencilla para pruebas)
async function seleccionarMetodoPago() {
  // Aquí puedes poner una lista de métodos de pago disponibles o solo retornar uno por defecto
  return state.formaDePagoDefault || null;
}


function getAccionesReservaHTML(reserva) {
  let actions = '';
  const baseClass = "button text-xs px-2.5 py-1";
  const estado = reserva.estado;

  // --- Botón para abonar si hay saldo pendiente ---
  if (['reservada', 'confirmada'].includes(estado) && reserva.pendiente > 0) {
    actions += `<button class="${baseClass} button-success" data-action="abonar" data-id="${reserva.id}">Abonar / Completar Pago</button>`;
  }

  // --- Botón Editar ---
  if (['reservada', 'confirmada'].includes(estado)) {
    actions += `<button class="${baseClass} button-warning" data-action="editar" data-id="${reserva.id}">Editar</button>`;
    actions += `<button class="${baseClass} button-danger-outline" data-action="cancelar" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">Cancelar</button>`;

  }

  // --- Puedes agregar más botones según estado aquí si lo deseas ---

  return actions;
}

function getBorderColorForEstado(e) { const c={'reservada':'border-yellow-400','confirmada':'border-green-500','activa':'border-blue-500','check_in':'border-blue-500','cancelada':'border-red-500','no_show':'border-purple-500'}; return c[e]||'border-gray-300'; }
function getBgColorForEstado(e) { const c={'reservada':'bg-yellow-100','confirmada':'bg-green-100','activa':'bg-blue-100','check_in':'bg-blue-100','cancelada':'bg-red-100','no_show':'bg-purple-100'}; return c[e]||'bg-gray-200'; }
function getTextColorForEstado(e) { const c={'reservada':'text-yellow-800','confirmada':'text-green-800','activa':'text-blue-800','check_in':'text-blue-800','cancelada':'text-red-800','no_show':'text-purple-800'}; return c[e]||'text-gray-700'; }

// --- FUNCIONES AUXILIARES DE LA UI ---

/**
 * Establece la fecha mínima de entrada para que no se puedan crear reservas en el pasado.
 * @param {HTMLInputElement} fechaEntradaInput
 */
function configureFechaEntrada(fechaEntradaInput) {
  const now = new Date();
  const localNow = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
  fechaEntradaInput.min = localNow.toISOString().slice(0, 16);
}

/**
 * Resetea el formulario y el estado de la UI al modo de creación.
 */
function resetFormToCreateMode() {
  ui.form.reset();
  ui.tipoCalculoDuracionEl.value = 'noches_manual';
  ui.tipoCalculoDuracionEl.dispatchEvent(new Event('change'));
  configureFechaEntrada(ui.fechaEntradaInput);
  ui.formTitle.textContent = "Registrar Nueva Reserva";
  ui.submitButton.textContent = "Registrar Reserva";
  ui.cancelEditButton.style.display = 'none';
  state.isEditMode = false;
  state.editingReservaId = null;
}

// --- PUNTO DE ENTRADA DEL MÓDULO ---

/**
 * Monta e inicializa todo el módulo de reservas.
 * @param {HTMLElement} container - El elemento del DOM donde se montará el módulo.
 * @param {object} supabaseClient - El cliente de Supabase.
 * @param {object} user - El objeto del usuario autenticado.
 * @param {string} hotelId - El ID del hotel actual.
 */
export async function mount(container, supabaseClient, user, hotelId) {
  // --- Validaciones Iniciales ---
  if (!user || !user.id) {
    container.innerHTML = `<p class="error-box">Error: Usuario no autenticado.</p>`;
    return;
  }
  if (!hotelId) {
    container.innerHTML = `<p class="error-box">Error: ID del hotel no disponible.</p>`;
    return;
  }

  // --- Asignación de Estado ---
  state.supabase = supabaseClient;
  state.currentUser = user;
  state.hotelId = hotelId;

  // --- Renderizado de Plantilla HTML ---
  container.innerHTML = `
  <div class="max-w-4xl mx-auto mt-7 px-4">
    <h2 id="form-title" class="text-2xl md:text-3xl font-bold mb-6 text-blue-800">Registrar Nueva Reserva</h2>
    <form id="reserva-form" class="space-y-5 bg-blue-50 rounded-xl p-6 border border-blue-200 mb-8 shadow-md">
      <fieldset class="border border-blue-200 p-4 rounded-md">
        <legend class="text-lg font-semibold text-blue-700 px-2">Datos del Cliente</legend>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
          <div>
            <label for="cliente_nombre" class="font-semibold text-sm text-gray-700">Nombre completo</label>
            <input name="cliente_nombre" id="cliente_nombre" class="form-control" required maxlength="120" />
          </div>
          <div>
            <label for="telefono" class="font-semibold text-sm text-gray-700">Teléfono</label>
            <input name="telefono" id="telefono" type="tel" class="form-control" maxlength="30" />
          </div>
        </div>
      </fieldset>
      <fieldset class="border border-blue-200 p-4 rounded-md">
        <legend class="text-lg font-semibold text-blue-700 px-2">Detalles de la Reserva</legend>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-5 mt-2">
          <div>
            <label for="fecha_entrada" class="font-semibold text-sm text-gray-700">Fecha y hora de llegada</label>
            <input type="datetime-local" name="fecha_entrada" id="fecha_entrada" class="form-control" required />
          </div>
          <div>
            <label for="tipo_calculo_duracion" class="font-semibold text-sm text-gray-700">Calcular duración por</label>
            <select name="tipo_calculo_duracion" id="tipo_calculo_duracion" class="form-control" required>
              <option value="noches_manual">Noches (manual)</option>
              <option value="tiempo_predefinido">Tiempo predefinido</option>
            </select>
          </div>
          <div id="noches-manual-container">
            <label for="cantidad_noches" class="font-semibold text-sm text-gray-700">Cantidad de noches</label>
            <input name="cantidad_noches" id="cantidad_noches" type="number" min="1" max="90" value="1" class="form-control" />
          </div>
          <div id="tiempo-predefinido-container" style="display:none;">
            <label for="tiempo_estancia_id" class="font-semibold text-sm text-gray-700">Selecciona tiempo de estancia</label>
            <select name="tiempo_estancia_id" id="tiempo_estancia_id" class="form-control"></select>
          </div>
          <div>
            <label for="habitacion_id" class="font-semibold text-sm text-gray-700">Habitación</label>
            <select name="habitacion_id" id="habitacion_id" class="form-control" required></select>
          </div>
          <div>
            <label for="cantidad_huespedes" class="font-semibold text-sm text-gray-700">Cantidad de huéspedes</label>
            <input name="cantidad_huespedes" id="cantidad_huespedes" type="number" min="1" max="20" value="1" class="form-control" required />
          </div>
        </div>
      </fieldset>
      <fieldset class="border border-blue-200 p-4 rounded-md">
        <legend class="text-lg font-semibold text-blue-700 px-2">Pago y Adicionales</legend>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-5 mt-2">
          <div>
            <label for="tipo_pago" class="font-semibold text-sm text-gray-700">Tipo de Pago</label>
            <select id="tipo_pago" name="tipo_pago" class="form-control" required>
              <option value="parcial">Pago parcial (abono)</option>
              <option value="completo">Pago completo</option>
            </select>
          </div>
          <div>
            <label for="metodo_pago_id" class="font-semibold text-sm text-gray-700">Método de Pago</label>
            <select name="metodo_pago_id" id="metodo_pago_id" class="form-control"></select>
          </div>
          <!-- Solo sale si escoge pago parcial -->
          <div id="abono-container" class="md:col-span-2">
            <label for="monto_abono" class="font-semibold text-sm text-gray-700">Valor a abonar</label>
            <input name="monto_abono" id="monto_abono" type="number" min="0" step="1000" class="form-control" placeholder="Valor a abonar" />
          </div>
          <!-- Solo sale si escoge pago completo -->
          <div id="total-pago-completo" class="md:col-span-2" style="display:none;">
            <div class="text-center py-4">
              <span class="text-2xl font-bold text-green-600">
                Total a pagar: <span id="valor-total-pago"></span>
              </span>
            </div>
          </div>
          <div class="md:col-span-2">
            <label for="notas" class="font-semibold text-sm text-gray-700">Notas Adicionales</label>
            <textarea name="notas" id="notas" class="form-control" maxlength="500" rows="2" placeholder="Ej: Llegada tardía, solicitud especial..."></textarea>
          </div>
        </div>
      </fieldset>
      <div class="flex flex-col sm:flex-row gap-3 pt-2">
        <button type="submit" id="submit-button" class="button button-primary w-full sm:w-auto flex-grow">Registrar Reserva</button>
        <button type="button" id="cancel-edit-button" class="button button-secondary w-full sm:w-auto" style="display:none;">Cancelar Edición</button>
      </div>
    </form>
    <div id="reserva-feedback" class="mb-6"></div>
    <div id="reservas-list" class="mt-8"></div>
  </div>
`;

// ------ JS QUE VA JUSTO DESPUÉS DEL innerHTML ------

// Elementos principales del pago
// Elementos principales del formulario
const tipoPagoSelect = document.getElementById('tipo_pago');
const abonoContainer = document.getElementById('abono-container');
const totalPagoCompleto = document.getElementById('total-pago-completo');
const valorTotalPago = document.getElementById('valor-total-pago');
const habitacionSelect = document.getElementById('habitacion_id');
const cantidadNochesInput = document.getElementById('cantidad_noches');
const tipoCalculoDuracionEl = document.getElementById('tipo_calculo_duracion');
const tiempoEstanciaIdSelect = document.getElementById('tiempo_estancia_id');
const cantidadHuespedesInput = document.getElementById('cantidad_huespedes');

// ------- CÁLCULO SEGURO DEL TOTAL ------- //
function calcularTotalReserva() {
  let total = 0;

  // Asegura que los selects están cargados
  if (!habitacionSelect || habitacionSelect.selectedIndex === -1) return 0;
  const habitacionOption = habitacionSelect.options[habitacionSelect.selectedIndex];
  let precioHabitacion = habitacionOption ? (parseInt(habitacionOption.getAttribute('data-precio')) || 0) : 0;

  const tipoCalculo = tipoCalculoDuracionEl?.value || 'noches_manual';
  if (tipoCalculo === 'noches_manual') {
    const cantidadNoches = parseInt(cantidadNochesInput?.value) || 1;
    total = precioHabitacion * cantidadNoches;
  } else if (tiempoEstanciaIdSelect && tiempoEstanciaIdSelect.selectedIndex !== -1) {
    const tiempoOption = tiempoEstanciaIdSelect.options[tiempoEstanciaIdSelect.selectedIndex];
    total = tiempoOption ? (parseInt(tiempoOption.getAttribute('data-precio')) || 0) : 0;
  }

  // Lógica de huéspedes extra (si aplica)
  const capacidadBase = habitacionOption ? (parseInt(habitacionOption.getAttribute('data-capacidad-base')) || 1) : 1;
  const precioExtra   = habitacionOption ? (parseInt(habitacionOption.getAttribute('data-precio-extra')) || 0) : 0;
  const cantidadHuespedes = parseInt(cantidadHuespedesInput?.value) || 1;
  if (cantidadHuespedes > capacidadBase) {
    const extra = cantidadHuespedes - capacidadBase;
    if (tipoCalculo === 'noches_manual') {
      const cantidadNoches = parseInt(cantidadNochesInput?.value) || 1;
      total += extra * precioExtra * cantidadNoches;
    } else {
      total += extra * precioExtra;
    }
  }

  window.__totalReservaCalculado = total;
  return total;
}

function actualizarTotalReserva() {
  let total = calcularTotalReserva();
  if (typeof total !== "number" || isNaN(total)) total = 0;
  valorTotalPago.textContent = "$" + total.toLocaleString("es-CO");
}

// Evento al cambiar el tipo de pago
tipoPagoSelect.addEventListener('change', function () {
  if (this.value === 'completo') {
    abonoContainer.style.display = 'none';
    totalPagoCompleto.style.display = 'block';
    actualizarTotalReserva();
  } else {
    abonoContainer.style.display = 'block';
    totalPagoCompleto.style.display = 'none';
  }
});

// Eventos para recalcular el total automáticamente
habitacionSelect?.addEventListener('change', actualizarTotalReserva);
cantidadNochesInput?.addEventListener('input', actualizarTotalReserva);
tipoCalculoDuracionEl?.addEventListener('change', actualizarTotalReserva);
tiempoEstanciaIdSelect?.addEventListener('change', actualizarTotalReserva);
cantidadHuespedesInput?.addEventListener('input', actualizarTotalReserva);
tipoPagoSelect?.addEventListener('change', actualizarTotalReserva);

// Mostrar correcto al cargar
tipoPagoSelect.dispatchEvent(new Event('change'));
actualizarTotalReserva();

// --- Inicialización de la UI y Eventos ---
ui.init(container);

ui.form.onsubmit = handleFormSubmit;
ui.cancelEditButton.onclick = () => resetFormToCreateMode();
ui.reservasListEl.addEventListener('click', handleListActions);

ui.tipoCalculoDuracionEl.onchange = () => {
  const esNochesManual = ui.tipoCalculoDuracionEl.value === 'noches_manual';
  ui.nochesManualContainer.style.display = esNochesManual ? '' : 'none';
  ui.cantidadNochesInput.required = esNochesManual;
  ui.tiempoPredefinidoContainer.style.display = esNochesManual ? 'none' : '';
  ui.tiempoEstanciaIdSelect.required = !esNochesManual;
};
ui.tipoCalculoDuracionEl.dispatchEvent(new Event('change'));

// --- Carga de Datos Inicial ---
configureFechaEntrada(ui.fechaEntradaInput);
await loadInitialData();
}
// --- Modal de Abono o Completar Pago ---
async function puedeHacerCheckIn(reservaId, supabase) {
  // Usa el parámetro supabase
  const { data: reserva, error } = await supabase
    .from('reservas')
    .select('id, monto_total')
    .eq('id', reservaId)
    .single();
  if (error || !reserva) return alert('No se pudo cargar la reserva.');

  const { data: pagos, error: errPagos } = await state.supabase
    .from('pagos_reserva')
    .select('monto')
    .eq('reserva_id', reservaId);
  const pagado = pagos ? pagos.reduce((sum, p) => sum + Number(p.monto), 0) : 0;
  const pendiente = Math.max(reserva.monto_total - pagado, 0);

  // Crea el modal simple (puedes personalizar el diseño)
  const modal = document.createElement('div');
  modal.innerHTML = `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
      <div class="bg-white rounded-lg shadow-lg p-6 max-w-sm w-full">
        <h3 class="text-lg font-bold mb-3">Abonar / Completar Pago</h3>
        <p>Cliente: <b>${reserva.cliente_nombre}</b></p>
        <p>Monto total: <b>$${reserva.monto_total.toLocaleString('es-CO')}</b></p>
        <p>Pagado: <b class="text-green-600">$${pagado.toLocaleString('es-CO')}</b></p>
        <p>Pendiente: <b class="text-red-600">$${pendiente.toLocaleString('es-CO')}</b></p>
        <form id="form-abono-reserva" class="mt-3 space-y-2">
          <input type="number" min="1" max="${pendiente}" class="form-control" name="monto_abono" required placeholder="Valor a abonar (máx. $${pendiente})" />
          <select name="metodo_pago_id" class="form-control" required>
            <option value="">Método de pago...</option>
            ${(await cargarOpcionesMetodoPago()).map(m => `<option value="${m.id}">${m.nombre}</option>`).join('')}
          </select>
          <div class="flex gap-2 pt-2">
            <button type="submit" class="button button-primary flex-1">Registrar Abono</button>
            <button type="button" id="btn-cerrar-modal-abono" class="button button-secondary">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Cerrar modal
  modal.querySelector('#btn-cerrar-modal-abono').onclick = () => document.body.removeChild(modal);

  // Registrar el abono
  modal.querySelector('#form-abono-reserva').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const monto = parseInt(form.monto_abono.value) || 0;
    const metodo = form.metodo_pago_id.value;
    if (!metodo) return alert('Selecciona el método de pago');
    if (monto < 1 || monto > pendiente) return alert('El valor a abonar no es válido.');

    // 1. Guarda el abono
    const { error: errorAbono } = await state.supabase.from('pagos_reserva').insert([{
      reserva_id: reservaId,
      monto,
      metodo_pago_id: metodo,
      fecha_pago: new Date().toISOString(),
      hotel_id: state.hotelId,
      usuario_id: state.currentUser.id
    }]);
    if (errorAbono) return alert('Error registrando abono: ' + errorAbono.message);

    // 2. Guarda movimiento en caja
    const movimientoCaja = {
  hotel_id: state.hotelId,
  tipo: 'ingreso',
  monto: montoAbono, // El monto que acaba de abonar el usuario
  concepto: 'Abono de reserva',
  referencia: reservaActual.id, // El id de la reserva como referencia
  metodo_pago_id: metodoPagoSeleccionado, // el id del método de pago elegido
  creado_en: new Date().toISOString(),
  usuario_id: state.currentUser.id
};
const { error: cajaError } = await state.supabase.from('caja').insert([movimientoCaja]);
if (cajaError) {
  console.error("[ABONO] Error al registrar movimiento en caja:", cajaError.message, cajaError);
  // Puedes mostrar un warning pero no interrumpir el flujo del abono
}

    document.body.removeChild(modal);
    alert('¡Abono registrado con éxito!');
    await renderReservas(); // Refresca la lista
  };
}

// --- Función para traer métodos de pago (útil para el modal) ---
async function cargarOpcionesMetodoPago() {
  const { data, error } = await state.supabase
    .from('metodos_pago')
    .select('id, nombre')
    .eq('hotel_id', state.hotelId)
    .eq('activo', true);
  return error ? [] : data;
}
// Función auxiliar para obtener el total abonado de una reserva
async function getPagosDeReserva(reservaId) {
  const { data: pagos, error } = await state.supabase
    .from('pagos_reserva')
    .select('monto')
    .eq('reserva_id', reservaId);
  if (error) return 0;
  return pagos ? pagos.reduce((sum, p) => sum + Number(p.monto), 0) : 0;
}
