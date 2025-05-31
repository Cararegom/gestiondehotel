// js/modules/reservas/reservas.js
import {
  showError,
  showSuccess,
  showLoading,
  clearFeedback,
  setFormLoadingState,
  formatCurrency,
  formatDateTime
} from '../../uiUtils.js';
// NUEVO Y CRUCIAL: Importar el turnoService
import { turnoService } from '../../services/turnoService.js';

// --- MÓDULO DE ESTADO GLOBAL ---
const state = {
  isEditMode: false,
  editingReservaId: null,
  tiemposEstanciaDisponibles: [],
  currentUser: null,
  hotelId: null,
  supabase: null,
  // NUEVO: Para almacenar el total calculado de la reserva de forma más segura que en window
  currentBookingTotal: 0,
};

// --- MÓDULO DE UI (VISTA) ---
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

  async showConfirmationModal(message) {
    // Idealmente, reemplazar con SweetAlert2
    return window.confirm(message);
  },

  showInfoModal(message, title = "Información") {
    // Idealmente, reemplazar con SweetAlert2
     // Asegúrate que Swal esté disponible globalmente si lo usas
    if (typeof Swal !== 'undefined') {
        Swal.fire(title, message, 'info');
    } else {
        alert(`${title}\n\n${message}`);
    }
  },
};

// --- LÓGICA PRINCIPAL Y MANEJADORES DE EVENTOS ---

async function handleFormSubmit(event) {
  event.preventDefault();
  if (ui.feedbackDiv) clearFeedback(ui.feedbackDiv);
  const actionText = state.isEditMode ? "Actualizando..." : "Registrando...";
  if (ui.form && ui.submitButton) setFormLoadingState(ui.form, true, ui.submitButton, actionText);

  try {
    const formData = gatherFormData();
    validateInitialInputs(formData);
    
    // Esta validación es CRUCIAL y ahora incluye el cálculo que actualiza state.currentBookingTotal
    const bookingPayload = await validateAndCalculateBooking(formData);

    if (state.isEditMode) {
      await updateBooking(bookingPayload);
    } else {
      await createBooking(bookingPayload);
    }
   
    const successMsg = `¡Reserva ${state.isEditMode ? 'actualizada' : 'creada'} con éxito!`;
    if (ui.feedbackDiv) showSuccess(ui.feedbackDiv, successMsg);
    await renderReservas();
    document.dispatchEvent(new CustomEvent('datosActualizados')); 
    resetFormToCreateMode();

  } catch (error) {
    console.error("Error en handleFormSubmit:", error);
    if (ui.feedbackDiv) showError(ui.feedbackDiv, error.message || "Ocurrió un error desconocido.");
  } finally {
    const buttonText = state.isEditMode ? "Actualizar Reserva" : "Registrar Reserva";
    if (ui.form && ui.submitButton) setFormLoadingState(ui.form, false, ui.submitButton, buttonText);
  }
}

async function handleListActions(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const reservaId = button.dataset.id;
  const action = button.dataset.action;
  const habitacionIdReserva = button.dataset.habitacionId;

  try {
    switch (action) {
      case 'abonar':
        const { data: reservaParaAbono, error: errorReserva } = await state.supabase
          .from('reservas')
          .select('*') 
          .eq('id', reservaId)
          .single();
        if (errorReserva || !reservaParaAbono) {
          Swal.fire('Error', 'No se encontró la reserva para abonar.', 'error');
          break;
        }
        await mostrarModalAbonoReserva(reservaParaAbono); // Pasamos la reserva completa
        break;
      case 'editar':
        await prepareEditReserva(reservaId);
        break;
      case 'eliminar':
        await handleDeleteReserva(reservaId);
        break;
      case 'confirmar':
        await handleUpdateEstadoReserva(reservaId, 'confirmada', 'reservada', habitacionIdReserva);
        break;
      case 'checkin':
        // La función puedeHacerCheckIn ahora solo valida
        const puedeCheckin = await puedeHacerCheckIn(reservaId);
        if (puedeCheckin) {
          await handleUpdateEstadoReserva(reservaId, 'activa', 'ocupada', habitacionIdReserva);
        }
        break;
      case 'checkout':
        ui.showInfoModal("Para realizar el Checkout, dirígete al Mapa de Habitaciones y haz clic en la habitación correspondiente para ver las opciones de entrega y facturación.");
        break;
      case 'cancelar':
        await handleUpdateEstadoReserva(reservaId, 'cancelada', 'libre', habitacionIdReserva, true);
        break;
      default:
        console.warn("Acción desconocida en reserva:", action);
    }
  } catch (error) {
    console.error(`Error en la acción '${action}' de reserva:`, error);
    if (ui.feedbackDiv) showError(ui.feedbackDiv, `Error en la acción '${action}': ${error.message}`);
    await renderReservas(); 
  }
}

// --- OPERACIONES CON LA BASE DE DATOS (CRUD) ---

async function createBooking(payload) {
  const { datosReserva, datosPago } = payload;

  const { data: reservaInsertada, error: errInsert } = await state.supabase
    .from('reservas')
    .insert(datosReserva)
    .select()
    .single();

  if (errInsert) throw new Error(`Error al guardar la reserva: ${errInsert.message}`);
  const nuevaReservaId = reservaInsertada.id;

  const tipoPago = datosPago?.tipo_pago || 'parcial';
  // Usamos state.currentBookingTotal que se calcula en validateAndCalculateBooking
  const montoPagadoEnFormulario = tipoPago === "completo"
    ? parseFloat(state.currentBookingTotal) || 0
    : parseFloat(datosPago?.monto_abono) || 0;

  console.log("[RESERVA CREATE] Datos para caja:", {
      tipoPago: tipoPago,
      montoAbonoOriginal: datosPago?.monto_abono,
      totalCalculadoGlobalState: state.currentBookingTotal, // Usando state
      montoPagadoEnFormulario: montoPagadoEnFormulario,
      metodoPagoDelForm: datosPago.metodo_pago_id
  });

  if (montoPagadoEnFormulario > 0) {
    const turnoId = turnoService.getActiveTurnId(); // Aquí usamos el servicio importado
    console.log("[RESERVA CREATE] ID de Turno Activo:", turnoId); 
    const feedbackElParaCaja = ui.feedbackDiv;

    if (!turnoId) {
      if (feedbackElParaCaja) showError(feedbackElParaCaja, "ACCIÓN PARCIALMENTE BLOQUEADA: La reserva se creó, pero el pago no se registró en caja porque no hay un turno activo.");
    } else {
      // SÍ HAY TURNO, SE INTENTA REGISTRAR EN CAJA
      const movimientoCaja = {
        hotel_id: datosReserva.hotel_id,
        tipo: 'ingreso',
        monto: montoPagadoEnFormulario,
        // MODIFICADO: Concepto más específico con el nombre del cliente
        concepto: `${tipoPago === "completo" ? 'Pago completo Reserva a nombre de' : 'Abono Reserva a nombre de'} ${datosReserva.cliente_nombre} (ID: #${nuevaReservaId.substring(0,8)})`,
        referencia: nuevaReservaId, 
        metodo_pago_id: datosPago.metodo_pago_id || null,
        usuario_id: datosReserva.usuario_id,
        turno_id: turnoId 
      };
      
      const { error: cajaError } = await state.supabase.from('caja').insert(movimientoCaja);
      if (cajaError) {
        console.error("[RESERVA CREATE] Error al registrar movimiento en caja:", cajaError.message, cajaError.details);
        if (feedbackElParaCaja) showError(feedbackElParaCaja, `Advertencia: Reserva creada. Error al registrar pago en caja: ${cajaError.message}`);
      } else {
        console.log("[RESERVA CREATE] Movimiento en caja registrado con éxito para turno:", turnoId);
      }
    }
  } else {
    console.log("[RESERVA CREATE] Monto de pago es 0 o inválido. No se registra movimiento en caja.");
  }

  const promises = [];
  if (datosPago.metodo_pago_id && montoPagadoEnFormulario > 0) {
      promises.push(
        state.supabase.from('pagos_reserva').insert({
          reserva_id: nuevaReservaId,
          monto: montoPagadoEnFormulario,
          metodo_pago_id: datosPago.metodo_pago_id,
          fecha_pago: new Date().toISOString(),
          hotel_id: state.hotelId,
          usuario_id: state.currentUser.id
        })
      );
  } else if (montoPagadoEnFormulario > 0 && !datosPago.metodo_pago_id) {
      console.warn("[RESERVA CREATE] Se intentó registrar un pago sin método de pago en pagos_reserva. Pago no registrado en esta tabla.");
      if (ui.feedbackDiv) showError(ui.feedbackDiv, "Advertencia: Se indicó un monto de pago pero no un método. El pago no se asoció formalmente en la tabla de pagos de reserva.");
  }

  promises.push(
    state.supabase.from('habitaciones')
      .update({ estado: "reservada" })
      .eq('id', datosReserva.habitacion_id)
      .eq('estado', 'libre')
  );

  const results = await Promise.allSettled(promises);
  results.forEach(result => {
      if (result.status === 'rejected') {
          console.error("[RESERVA CREATE] Error en una de las promesas (pagos_reserva o habitación):", result.reason);
      }
  });

  // No es necesario renderReservas aquí, ya se llama en handleFormSubmit
}


async function updateBooking(payload) {
  const { datosReserva } = payload;
  delete datosReserva.hotel_id; 
  delete datosReserva.estado; 
  delete datosReserva.usuario_id;

  const { error } = await state.supabase
    .from('reservas')
    .update(datosReserva)
    .eq('id', state.editingReservaId);

  if (error) throw new Error(`Error actualizando reserva: ${error.message}`);
}

async function prepareEditReserva(reservaId) {
  if (ui.feedbackDiv) clearFeedback(ui.feedbackDiv);
  if (ui.feedbackDiv) showLoading(ui.feedbackDiv, "Cargando datos para editar...");

  const { data: reserva, error } = await state.supabase
    .from('reservas').select('*').eq('id', reservaId).single();

  if (ui.feedbackDiv) clearFeedback(ui.feedbackDiv);
  if (error || !reserva) {
      console.error("Error al cargar reserva para editar:", error);
      throw new Error("No se pudo cargar la reserva para editar.");
  }

  ui.form.elements.cliente_nombre.value = reserva.cliente_nombre || '';
  ui.form.elements.telefono.value = reserva.telefono || '';
  ui.form.elements.cantidad_huespedes.value = reserva.cantidad_huespedes || 1;
  ui.form.elements.habitacion_id.value = reserva.habitacion_id;

  if (reserva.fecha_inicio) {
    const fechaEntradaLocal = new Date(reserva.fecha_inicio);
    const offset = fechaEntradaLocal.getTimezoneOffset() * 60000;
    const localDate = new Date(fechaEntradaLocal.getTime() - offset);
    ui.form.elements.fecha_entrada.value = localDate.toISOString().slice(0, 16);
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
  if (ui.tipoCalculoDuracionEl) ui.tipoCalculoDuracionEl.dispatchEvent(new Event('change'));

  ui.form.elements.tipo_pago.value = 'parcial'; 
  ui.form.elements.tipo_pago.disabled = true;
  ui.form.elements.metodo_pago_id.value = '';
  ui.form.elements.metodo_pago_id.disabled = true;
  const abonoContainerEl = document.getElementById('abono-container');
  const totalPagoCompletoEl = document.getElementById('total-pago-completo');
  if(abonoContainerEl) abonoContainerEl.style.display = 'none';
  if(totalPagoCompletoEl) totalPagoCompletoEl.style.display = 'none';
  
  ui.form.elements.notas.value = reserva.notas || '';

  ui.formTitle.textContent = `Editar Reserva (ID: ${reservaId.substring(0, 8)})`;
  ui.submitButton.textContent = "Actualizar Reserva";
  if (ui.cancelEditButton) ui.cancelEditButton.style.display = 'inline-flex';
  if (ui.form) ui.form.scrollIntoView({ behavior: 'smooth', block: 'start' });

  state.isEditMode = true;
  state.editingReservaId = reservaId;
}

async function handleDeleteReserva(reservaId) {
  const confirmed = await ui.showConfirmationModal("¿Seguro de ELIMINAR PERMANENTEMENTE este registro de reserva y sus pagos asociados? Esta acción no se puede deshacer.");
  if (!confirmed) return;

  if (ui.feedbackDiv) showLoading(ui.feedbackDiv, "Eliminando...");
  
  const { error: errPagos } = await state.supabase.from('pagos_reserva').delete().eq('reserva_id', reservaId);
  if (errPagos) {
      console.warn("Advertencia al eliminar pagos de reserva:", errPagos.message);
  }

  const { error } = await state.supabase.from('reservas').delete().eq('id', reservaId);
  if (ui.feedbackDiv) clearFeedback(ui.feedbackDiv);

  if (error) throw new Error(`Error al eliminar reserva: ${error.message}`);

  if (ui.feedbackDiv) showSuccess(ui.feedbackDiv, "Reserva eliminada permanentemente.");
  await renderReservas();
}

async function handleUpdateEstadoReserva(reservaId, nuevoEstadoReserva, nuevoEstadoHabitacion, habitacionIdReserva, forzarDisponibleHabitacion = false) {
  if (!ui.feedbackDiv) {
      console.error("feedbackDiv no está inicializado en handleUpdateEstadoReserva");
      return;
  }
  showLoading(ui.feedbackDiv, `Actualizando a ${nuevoEstadoReserva.replace(/_/g, ' ')}...`);
  
  const updatesReserva = { estado: nuevoEstadoReserva };
  if (nuevoEstadoReserva === 'activa' && !forzarDisponibleHabitacion) {
      updatesReserva.fecha_inicio = new Date().toISOString(); 
  }

  const { data: updatedReserva, error: errRes } = await state.supabase
    .from('reservas').update(updatesReserva).eq('id', reservaId).select().single();

  if (errRes) {
      console.error("Error actualizando estado de reserva:", errRes);
      throw new Error(`Error actualizando reserva: ${errRes.message}`);
  }

  let mensajeExito = `¡Reserva actualizada a ${nuevoEstadoReserva.replace(/_/g, ' ')}!`;
  let habitacionActualizadaConExito = false; // Para saber si refrescar el mapa

  if (habitacionIdReserva && nuevoEstadoHabitacion) {
    let estadoHabitacionFinalDeseado = nuevoEstadoHabitacion;
    if ( (nuevoEstadoHabitacion === 'libre' || forzarDisponibleHabitacion) && nuevoEstadoReserva === 'cancelada' ) {
        // Solo validar cruce si se intenta poner 'libre' por cancelación
        const { data: hayCruce } = await state.supabase.rpc('validar_cruce_reserva', {
          p_habitacion_id: habitacionIdReserva,
          // Usar fechas de la reserva que se está manipulando, no la actual (que ya cambió)
          p_entrada: updatedReserva.fecha_inicio, 
          p_salida: updatedReserva.fecha_fin,
          p_reserva_id_excluida: reservaId 
        });
        if (hayCruce === true) { // rpc devuelve true si hay cruce
          console.warn(`Habitación ${habitacionIdReserva} no se marcó como libre por cruce con otra reserva activa.`);
          mensajeExito += ` (Habitación no se liberó por tener otras reservas).`;
          estadoHabitacionFinalDeseado = null; // No cambiar estado de habitación
        }
    }
    
    if (estadoHabitacionFinalDeseado) {
      const { error: errHab } = await state.supabase
        .from('habitaciones').update({ estado: estadoHabitacionFinalDeseado }).eq('id', habitacionIdReserva);
      if (errHab) {
        console.error("Error actualizando estado de habitación:", errHab);
        mensajeExito += ` (Error al actualizar habitación: ${errHab.message})`;
      } else {
        habitacionActualizadaConExito = true;
      }
    }
  }

  showSuccess(ui.feedbackDiv, mensajeExito);
  await renderReservas();

  if (habitacionActualizadaConExito && typeof mapaHabitaciones !== "undefined" && mapaHabitaciones.mount) {
    console.log("Intentando refrescar mapa de habitaciones...");
    const mapaContainer = document.getElementById('mapa-habitaciones-container'); // ID del contenedor del mapa
    if (mapaContainer && state.supabase && state.currentUser && state.hotelId) {
        try {
            await mapaHabitaciones.mount(mapaContainer, state.supabase, state.currentUser, state.hotelId);
            console.log("Mapa de habitaciones refrescado.");
        } catch (mapError) {
            console.error("Error al refrescar el mapa de habitaciones:", mapError);
        }
    } else {
        console.warn("No se pudo refrescar el mapa: faltan dependencias o contenedor del mapa.");
    }
  }
}


// --- LÓGICA DE CÁLCULOS Y VALIDACIONES ---
function gatherFormData() {
  if (!ui.form) {
      console.error("Formulario de reserva no inicializado en ui.form");
      return {}; // Devuelve objeto vacío para evitar más errores, pero esto es un problema.
  }
  const formElements = ui.form.elements;
  return {
    cliente_nombre: formElements.cliente_nombre?.value || '',
    telefono: formElements.telefono?.value || '',
    fecha_entrada: formElements.fecha_entrada?.value || '',
    tipo_calculo_duracion: formElements.tipo_calculo_duracion?.value || 'noches_manual',
    cantidad_noches: formElements.cantidad_noches?.value || '1',
    tiempo_estancia_id: formElements.tiempo_estancia_id?.value || '',
    habitacion_id: formElements.habitacion_id?.value || '',
    cantidad_huespedes: formElements.cantidad_huespedes?.value || '1',
    metodo_pago_id: formElements.metodo_pago_id?.value || '',
    monto_abono: formElements.monto_abono?.value || '0',
    notas: formElements.notas?.value || '',
    tipo_pago: formElements.tipo_pago?.value || 'parcial'
  };
}

function validateInitialInputs(formData) {
  if (!formData.cliente_nombre.trim()) throw new Error("El nombre del cliente es obligatorio.");
  if (!formData.habitacion_id) throw new Error("Debe seleccionar una habitación.");
  if (!formData.fecha_entrada) throw new Error("La fecha y hora de llegada son obligatorias.");
  
  const fechaEntradaDate = new Date(formData.fecha_entrada);
  if (isNaN(fechaEntradaDate.getTime())) throw new Error("La fecha de llegada no es válida.");
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

  if (!state.isEditMode) { // Solo para nuevas reservas
    const montoAbonoNum = parseFloat(formData.monto_abono) || 0;
    if (formData.tipo_pago === 'completo' && !formData.metodo_pago_id) {
        throw new Error("Si selecciona 'Pago completo', debe elegir un método de pago.");
    }
    if (formData.tipo_pago === 'parcial' && montoAbonoNum > 0 && !formData.metodo_pago_id) {
        throw new Error("Si registra un abono mayor a cero, debe seleccionar un método de pago.");
    }
     if (formData.tipo_pago === 'parcial' && montoAbonoNum === 0 && formData.metodo_pago_id) {
        // Permitir método de pago si el abono es 0, pero no hacerlo requerido
    }
  }
}

async function validateAndCalculateBooking(formData) {
  const [habitacionResult, hotelResult] = await Promise.all([
    state.supabase.from('habitaciones')
      .select('precio, capacidad_base, capacidad_maxima, precio_huesped_adicional, permite_reservas_por_horas, precio_base_hora')
      .eq('id', formData.habitacion_id).single(),
    state.supabase.from('hoteles').select('checkout_hora').eq('id', state.hotelId).single()
  ]);

  if (habitacionResult.error) throw new Error(`Error obteniendo detalles de la habitación: ${habitacionResult.error.message}`);
  if (hotelResult.error) throw new Error(`No se pudo obtener la configuración del hotel: ${hotelResult.error.message}`);

  const habitacionInfo = habitacionResult.data;
  const hotelConfig = hotelResult.data;
  if (!habitacionInfo) throw new Error("No se encontró la habitación seleccionada.");
  if (!hotelConfig) throw new Error("No se encontró la configuración del hotel.");

  const { fechaEntrada, fechaSalida, tipoDuracionOriginal, cantidadDuracionOriginal, errorFechas } = calculateFechasEstancia(
    formData.fecha_entrada, formData.tipo_calculo_duracion, formData.cantidad_noches, formData.tiempo_estancia_id, hotelConfig.checkout_hora
  );
  if (errorFechas) throw new Error(errorFechas);
  
  if (tipoDuracionOriginal === "tiempo_predefinido" && !habitacionInfo.permite_reservas_por_horas && !esTiempoEstanciaNoches(formData.tiempo_estancia_id)) {
    throw new Error("La habitación seleccionada no permite reservas por horas para el tiempo elegido.");
  }

  const { data: hayCruce, error: errCruce } = await state.supabase.rpc('validar_cruce_reserva', {
    p_habitacion_id: formData.habitacion_id,
    p_entrada: fechaEntrada.toISOString(),
    p_salida: fechaSalida.toISOString(),
    p_reserva_id_excluida: state.isEditMode ? state.editingReservaId : null
  });

  if (errCruce) throw new Error(`Error validando disponibilidad: ${errCruce.message}.`);
  if (hayCruce === true) throw new Error("Conflicto: La habitación no está disponible para el período seleccionado debido a otra reserva.");

  const { montoEstanciaBase, montoPorHuespedesAdicionales, errorMonto } = calculateMontos(
    habitacionInfo, parseInt(formData.cantidad_huespedes), tipoDuracionOriginal, cantidadDuracionOriginal, formData.tiempo_estancia_id
  );
  if (errorMonto) throw new Error(errorMonto);
  
  state.currentBookingTotal = montoEstanciaBase + montoPorHuespedesAdicionales; // Actualizar el total en state

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
    monto_total: state.currentBookingTotal,
    notas: formData.notas.trim() || null,
    origen_reserva: 'directa',
  };
  const datosPago = {
    monto_abono: parseFloat(formData.monto_abono) || 0,
    metodo_pago_id: formData.metodo_pago_id || null,
    tipo_pago: formData.tipo_pago 
  };
  return { datosReserva, datosPago };
}

function calculateFechasEstancia(fechaEntradaStr, tipoCalculo, cantidadNochesStr, tiempoEstanciaId, hotelCheckoutHora = "12:00") {
  const fechaEntrada = new Date(fechaEntradaStr);
  if (isNaN(fechaEntrada.getTime())) return { errorFechas: "La fecha de entrada no es válida." };

  let fechaSalida, cantidadDuracionOriginal;
  const tipoDuracionOriginal = tipoCalculo;

  if (tipoCalculo === "noches_manual") {
    cantidadDuracionOriginal = parseInt(cantidadNochesStr) || 1;
    if (cantidadDuracionOriginal < 1) return { errorFechas: "Cantidad de noches debe ser al menos 1."};
    fechaSalida = new Date(fechaEntrada);
    fechaSalida.setDate(fechaSalida.getDate() + cantidadDuracionOriginal);
    const [hh, mm] = (hotelCheckoutHora || "12:00").split(':').map(Number);
    fechaSalida.setHours(hh, mm, 0, 0);
  } else { 
    if (!tiempoEstanciaId) return { errorFechas: "No se seleccionó un tiempo de estancia."};
    const tiempo = state.tiemposEstanciaDisponibles.find(ts => ts.id === tiempoEstanciaId);
    if (!tiempo || typeof tiempo.minutos !== 'number' || tiempo.minutos <=0) return { errorFechas: "Tiempo de estancia predefinido inválido o no encontrado." };
    cantidadDuracionOriginal = tiempo.minutos;
    fechaSalida = new Date(fechaEntrada.getTime() + (tiempo.minutos * 60 * 1000));
  }

  if (fechaSalida <= fechaEntrada) return { errorFechas: "La fecha de salida debe ser posterior a la de llegada." };
  return { fechaEntrada, fechaSalida, tipoDuracionOriginal, cantidadDuracionOriginal, errorFechas: null };
}

function calculateMontos(habitacionInfo, huespedes, tipoDuracion, cantDuracion, tiempoId) {
  let montoEstanciaBase = 0;
  if (!habitacionInfo) return { errorMonto: "Información de habitación no disponible."};

  if (tipoDuracion === "noches_manual") {
    montoEstanciaBase = (habitacionInfo.precio || 0) * cantDuracion;
  } else { 
    const tiempo = state.tiemposEstanciaDisponibles.find(ts => ts.id === tiempoId);
    if (tiempo && typeof tiempo.precio === 'number' && tiempo.precio >= 0) {
      montoEstanciaBase = tiempo.precio;
    } else if (habitacionInfo.precio_base_hora && habitacionInfo.precio_base_hora > 0 && cantDuracion > 0) {
      montoEstanciaBase = habitacionInfo.precio_base_hora * (cantDuracion / 60); 
    } else {
      return { errorMonto: "No se pudo determinar el precio base para el tiempo de estancia seleccionado." };
    }
  }

  let montoPorHuespedesAdicionales = 0;
  const capacidadMaxima = habitacionInfo.capacidad_maxima || huespedes; // Si no hay capacidad maxima, no limita
  if (huespedes > capacidadMaxima) {
    return { errorMonto: `Cantidad de huéspedes (${huespedes}) excede la capacidad máxima (${capacidadMaxima}) de la habitación.` };
  }

  const capacidadBase = habitacionInfo.capacidad_base || 1; // Default a 1 si no está definido
  if (huespedes > capacidadBase) {
    const extraHuespedes = huespedes - capacidadBase;
    let factorNoches = 1; 
    if (tipoDuracion === "noches_manual") {
      factorNoches = cantDuracion;
    } else if (tipoDuracion === "tiempo_predefinido" && esTiempoEstanciaNoches(tiempoId)) {
        factorNoches = Math.max(1, Math.round(cantDuracion / (24 * 60)));
    }
    montoPorHuespedesAdicionales = extraHuespedes * (habitacionInfo.precio_huesped_adicional || 0) * factorNoches;
  }
  return { montoEstanciaBase: Math.round(montoEstanciaBase), montoPorHuespedesAdicionales: Math.round(montoPorHuespedesAdicionales), errorMonto: null };
}

function esTiempoEstanciaNoches(tiempoEstanciaId) {
  if (!tiempoEstanciaId || !state.tiemposEstanciaDisponibles) return false;
  const tiempo = state.tiemposEstanciaDisponibles.find(ts => ts.id === tiempoEstanciaId);
  return tiempo && tiempo.minutos >= (22 * 60) && tiempo.minutos <= (26 * 60);
}

// --- CARGA DE DATOS Y RENDERIZADO ---
async function loadInitialData() {
  if (!ui.habitacionIdSelect || !ui.form?.elements.metodo_pago_id || !ui.tiempoEstanciaIdSelect) {
      console.error("Elementos de UI para carga inicial no encontrados en loadInitialData. El formulario puede no estar listo.");
      return;
  }
  await Promise.all([
    cargarHabitaciones(),
    cargarMetodosPago(),
    cargarTiemposEstancia()
  ]);
  await renderReservas();
}

async function cargarHabitaciones() {
  if (!ui.habitacionIdSelect) return;
  ui.habitacionIdSelect.innerHTML = `<option value="">Cargando habitaciones...</option>`;
  ui.habitacionIdSelect.disabled = true;

  const { data: rooms, error } = await state.supabase.from('habitaciones')
    .select('id, nombre, tipo, estado, precio, capacidad_base, capacidad_maxima, precio_huesped_adicional')
    .eq('hotel_id', state.hotelId).eq('activo', true).order('nombre', { ascending: true });

  if (error) {
    ui.habitacionIdSelect.innerHTML = `<option value="">Error al cargar</option>`;
  } else if (!rooms || rooms.length === 0) {
    ui.habitacionIdSelect.innerHTML = `<option value="">No hay habitaciones</option>`;
  } else {
    let optionsHtml = `<option value="">Selecciona habitación...</option>`;
    for (const room of rooms) {
      optionsHtml += `<option value="${room.id}" 
        data-precio="${room.precio || 0}"
        data-capacidad-base="${room.capacidad_base || 1}"
        data-capacidad-maxima="${room.capacidad_maxima || room.capacidad_base || 1}"
        data-precio-extra="${room.precio_huesped_adicional || 0}">
        ${room.nombre} (${formatCurrency(room.precio)})
      </option>`;
    }
    ui.habitacionIdSelect.innerHTML = optionsHtml;
  }
  ui.habitacionIdSelect.disabled = false;
}

async function cargarMetodosPago() {
  if (!ui.form || !ui.form.elements.metodo_pago_id) return;
  const select = ui.form.elements.metodo_pago_id;
  select.innerHTML = `<option value="">Cargando métodos...</option>`;
  const { data, error } = await state.supabase.from('metodos_pago').select('id, nombre')
    .eq('hotel_id', state.hotelId).eq('activo', true).order('nombre');
  if (error) {
    select.innerHTML = `<option value="">Error</option>`;
    return;
  }
  let optionsHtml = `<option value="">Selecciona método de pago...</option>`; 
  if (data && data.length > 0) {
      data.forEach(pago => optionsHtml += `<option value="${pago.id}">${pago.nombre}</option>`);
  } else {
      optionsHtml = `<option value="">No hay métodos de pago</option>`;
  }
  select.innerHTML = optionsHtml;
}

async function cargarTiemposEstancia() {
  if (!ui.tiempoEstanciaIdSelect) return;
  const { data, error } = await state.supabase
    .from('tiempos_estancia')
    .select('id, nombre, minutos, precio')
    .eq('hotel_id', state.hotelId)
    .eq('activo', true)
    .order('minutos', { ascending: true });

  ui.tiempoEstanciaIdSelect.innerHTML = ""; 

  if (error || !data || !data.length) {
    const opt = document.createElement('option');
    opt.value = "";
    opt.textContent = error ? "Error cargando tiempos" : "No hay tiempos predefinidos";
    ui.tiempoEstanciaIdSelect.appendChild(opt);
    state.tiemposEstanciaDisponibles = [];
    return;
  }

  state.tiemposEstanciaDisponibles = data;
  const placeholder = document.createElement('option');
  placeholder.value = "";
  placeholder.textContent = "Selecciona un tiempo...";
  ui.tiempoEstanciaIdSelect.appendChild(placeholder);

  data.forEach(ts => {
    const option = document.createElement('option');
    option.value = ts.id;
    const horasAprox = (ts.minutos / 60).toFixed(1);
    option.textContent = `${ts.nombre} (${formatCurrency(ts.precio)}) - ${horasAprox}h`;
    option.setAttribute('data-precio', ts.precio); 
    ui.tiempoEstanciaIdSelect.appendChild(option);
  });
}

async function renderReservas() {
  if (!ui.reservasListEl) return;
  ui.reservasListEl.innerHTML = `<div class="text-center p-4">Cargando reservas...</div>`;
  const { data: reservas, error } = await state.supabase.from('reservas')
    .select(`*, habitaciones(nombre, tipo), pagos_reserva(monto)`)
    .eq('hotel_id', state.hotelId)
    .in('estado', ['reservada', 'confirmada', 'activa']) // Quitado 'check_in' si es redundante con 'activa'
    .order('fecha_inicio', { ascending: true }).limit(100);

  if (error) {
    ui.reservasListEl.innerHTML = `<div class="error-box">Error cargando reservas: ${error.message}</div>`;
    return;
  }
  if (!reservas || reservas.length === 0) {
    ui.reservasListEl.innerHTML = `<div class="info-box">No hay reservas activas o próximas.</div>`;
    return;
  }

  reservas.forEach(r => {
    const abonado = r.pagos_reserva ? r.pagos_reserva.reduce((sum, p) => sum + Number(p.monto), 0) : 0;
    r.abonado = abonado;
    r.pendiente = Math.max((r.monto_total || 0) - abonado, 0);
  });

  const grouped = reservas.reduce((acc, r) => {
    (acc[r.estado] = acc[r.estado] || []).push(r);
    return acc;
  }, {});

  let html = '';
  ['reservada', 'confirmada', 'activa'].forEach(key => { 
    if (grouped[key] && grouped[key].length > 0) {
      html += renderReservasGrupo(key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '), grouped[key]);
    }
  });
  ui.reservasListEl.innerHTML = html || `<div class="info-box">No hay reservas para mostrar.</div>`;
}

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
          ${r.pendiente > 0 ? `<p style="color:#b91c1c"><strong>Pendiente:</strong> ${formatCurrency(r.pendiente)}</p>` : ""}
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

async function mostrarModalAbonoReserva(reservaActual) {
  const { data: metodosPago, error: errorMetodosPago } = await state.supabase
    .from('metodos_pago')
    .select('id, nombre')
    .eq('hotel_id', state.hotelId)
    .eq('activo', true)
    .order('nombre', { ascending: true });

  if (errorMetodosPago || !metodosPago || metodosPago.length === 0) {
    Swal.fire('Error', 'No se pudieron cargar los métodos de pago activos.', 'error');
    return;
  }

  const selectOptions = metodosPago
    .map(mp => `<option value="${mp.id}">${mp.nombre}</option>`)
    .join('');

  const { data: pagosExistentes } = await state.supabase.from('pagos_reserva').select('monto').eq('reserva_id', reservaActual.id);
  const totalAbonadoActual = pagosExistentes ? pagosExistentes.reduce((sum, p) => sum + Number(p.monto), 0) : 0;
  const montoPendienteActual = Math.max(0, (reservaActual.monto_total || 0) - totalAbonadoActual);

  if (montoPendienteActual === 0 && reservaActual.monto_total > 0) { // Solo si ya estaba pagada y tenía monto > 0
    Swal.fire('Información', 'Esta reserva ya ha sido pagada en su totalidad.', 'info');
    return;
  }

  const { value: formValues, isConfirmed } = await Swal.fire({
    title: `Registrar Abono para ${reservaActual.cliente_nombre}`,
    html:
      `<p class="mb-2 text-sm">Pendiente: <strong class="text-red-600">${formatCurrency(montoPendienteActual)}</strong></p>`+
      `<input id="swal-abono-monto" class="swal2-input" type="number" min="1" max="${montoPendienteActual > 0 ? montoPendienteActual : ''}" placeholder="Valor a abonar (máx. ${formatCurrency(montoPendienteActual)})" value="${montoPendienteActual > 0 ? montoPendienteActual : ''}">` + // Poner el pendiente por defecto
      `<select id="swal-metodo-pago" class="swal2-input">
         <option value="">Selecciona método de pago...</option>
         ${selectOptions}
       </select>`,
    focusConfirm: false,
    preConfirm: () => {
      const monto = parseFloat(document.getElementById('swal-abono-monto').value) || 0;
      const metodo = document.getElementById('swal-metodo-pago').value;
      if (monto <= 0) {
        Swal.showValidationMessage('El monto a abonar debe ser mayor a cero.');
        return false;
      }
      if (monto > montoPendienteActual && montoPendienteActual > 0) { // Solo validar si había pendiente
        Swal.showValidationMessage(`El monto no puede exceder el pendiente de ${formatCurrency(montoPendienteActual)}.`);
        return false;
      }
      if (!metodo) {
        Swal.showValidationMessage('Debes seleccionar un método de pago.');
        return false;
      }
      return { monto, metodo };
    },
    confirmButtonText: 'Registrar Abono',
    showCancelButton: true,
    cancelButtonText: 'Cancelar'
  });

  if (!isConfirmed || !formValues) return; 

  const { error: abonoError } = await state.supabase.from('pagos_reserva').insert({
    reserva_id: reservaActual.id,
    monto: formValues.monto,
    metodo_pago_id: formValues.metodo,
    fecha_pago: new Date().toISOString(),
    hotel_id: state.hotelId,
    usuario_id: state.currentUser.id
  });

  if (abonoError) {
    console.error("[ABONO MODAL] Error al guardar en pagos_reserva:", abonoError);
    Swal.fire('Error', `No se pudo registrar el abono en la reserva: ${abonoError.message}`, 'error');
    return;
  }

  const turnoId = turnoService.getActiveTurnId(); // Usar el servicio importado
  let movimientoRegistradoEnCaja = false;

  if (!turnoId) {
    Swal.fire(
        'Acción Parcialmente Bloqueada',
        'El abono fue registrado en la reserva, pero NO se pudo registrar en caja porque no hay un turno activo.',
        'warning'
    );
  } else {
    const movimientoCaja = {
        hotel_id: state.hotelId,
        tipo: 'ingreso',
        monto: formValues.monto,
        concepto: `Abono reserva #${reservaActual.id.substring(0,8)} (${reservaActual.cliente_nombre})`,
        referencia: reservaActual.id,
        metodo_pago_id: formValues.metodo,
        usuario_id: state.currentUser.id,
        turno_id: turnoId 
    };
    const { error: cajaError } = await state.supabase.from('caja').insert(movimientoCaja);
    if (cajaError) {
        console.error("[ABONO MODAL] Error al registrar movimiento en caja:", cajaError.message);
        Swal.fire('Advertencia', `Abono registrado en reserva, pero error al registrar en caja: ${cajaError.message}`, 'warning');
    } else {
        console.log("[ABONO MODAL] Movimiento en caja registrado con éxito para turno:", turnoId);
        movimientoRegistradoEnCaja = true;
    }
  }
  
  if (movimientoRegistradoEnCaja) {
    Swal.fire('¡Éxito!', 'Abono registrado correctamente en reserva y caja.', 'success');
  }
  await renderReservas();
}

function getAccionesReservaHTML(reserva) {
  let actions = '';
  const baseClass = "button text-xs px-2.5 py-1 rounded-md shadow-sm disabled:opacity-50";
  const estado = reserva.estado;

  if (['reservada', 'confirmada', 'activa'].includes(estado) && reserva.pendiente > 0) {
    actions += `<button class="${baseClass} bg-green-500 hover:bg-green-600 text-white" data-action="abonar" data-id="${reserva.id}">Abonar</button>`;
  }

  if (['reservada', 'confirmada'].includes(estado)) {
    actions += `<button class="${baseClass} bg-yellow-400 hover:bg-yellow-500 text-black" data-action="editar" data-id="${reserva.id}">Editar</button>`;
  }
  
  if (['reservada', 'confirmada', 'activa'].includes(estado)) { 
      actions += `<button class="${baseClass} bg-red-500 hover:bg-red-600 text-white" data-action="cancelar" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">Cancelar</button>`;
  }
  
  if (estado === 'confirmada') {
      const fechaInicio = new Date(reserva.fecha_inicio);
      const ahora = new Date();
      // Permitir check-in desde 24 horas antes hasta el final del día de inicio
      const inicioVentanaCheckin = new Date(fechaInicio.getTime() - 24 * 60 * 60 * 1000); 
      const finDiaCheckin = new Date(fechaInicio.getFullYear(), fechaInicio.getMonth(), fechaInicio.getDate(), 23, 59, 59);

      if (ahora >= inicioVentanaCheckin && ahora <= finDiaCheckin) { 
          actions += `<button class="${baseClass} bg-blue-500 hover:bg-blue-600 text-white" data-action="checkin" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">Check-in</button>`;
      }
  }
  
  if (estado === 'activa') {
    actions += `<button class="${baseClass} bg-teal-500 hover:bg-teal-600 text-white" data-action="checkout" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">Check-out</button>`;
  }

  return actions;
}

// Colores
function getBorderColorForEstado(e) { const c={'reservada':'border-yellow-400','confirmada':'border-green-500','activa':'border-blue-500','cancelada':'border-red-500','no_show':'border-purple-500','completada':'border-gray-400'}; return c[e]||'border-gray-300'; }
function getBgColorForEstado(e) { const c={'reservada':'bg-yellow-100','confirmada':'bg-green-100','activa':'bg-blue-100','cancelada':'bg-red-100','no_show':'bg-purple-100','completada':'bg-gray-100'}; return c[e]||'bg-gray-200'; }
function getTextColorForEstado(e) { const c={'reservada':'text-yellow-800','confirmada':'text-green-800','activa':'text-blue-800','cancelada':'text-red-800','no_show':'text-purple-800','completada':'text-gray-700'}; return c[e]||'text-gray-700'; }

// --- FUNCIONES AUXILIARES DE LA UI ---
function configureFechaEntrada(fechaEntradaInput) {
  if(!fechaEntradaInput) return;
  const now = new Date();
  const todayForMin = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  fechaEntradaInput.min = todayForMin.toISOString().slice(0, 16);
}

function resetFormToCreateMode() {
  if (ui.form) {
    ui.form.reset();
    if (ui.tipoCalculoDuracionEl) {
        ui.tipoCalculoDuracionEl.value = 'noches_manual';
        ui.tipoCalculoDuracionEl.dispatchEvent(new Event('change'));
    }
    if (ui.fechaEntradaInput) configureFechaEntrada(ui.fechaEntradaInput); 
    if (ui.form.elements.tipo_pago) {
        ui.form.elements.tipo_pago.disabled = false;
        ui.form.elements.tipo_pago.value = 'parcial'; 
        ui.form.elements.tipo_pago.dispatchEvent(new Event('change'));
    }
    if (ui.form.elements.metodo_pago_id) ui.form.elements.metodo_pago_id.disabled = false;
    if (ui.form.elements.monto_abono) ui.form.elements.monto_abono.value = '';


  }
  if (ui.formTitle) ui.formTitle.textContent = "Registrar Nueva Reserva";
  if (ui.submitButton) ui.submitButton.textContent = "Registrar Reserva";
  if (ui.cancelEditButton) ui.cancelEditButton.style.display = 'none';
  state.isEditMode = false;
  state.editingReservaId = null;
}

// --- PUNTO DE ENTRADA DEL MÓDULO ---
export async function mount(container, supabaseClient, user, hotelId) {
  if (!user || !user.id) {
    container.innerHTML = `<p class="error-box">Error: Usuario no autenticado.</p>`;
    return;
  }
  if (!hotelId) {
    container.innerHTML = `<p class="error-box">Error: ID del hotel no disponible.</p>`;
    return;
  }

  state.supabase = supabaseClient;
  state.currentUser = user;
  state.hotelId = hotelId;

  container.innerHTML = `
    <div class="max-w-4xl mx-auto mt-7 px-4">
      <h2 id="form-title" class="text-2xl md:text-3xl font-bold mb-6 text-blue-800">Registrar Nueva Reserva</h2>
      <form id="reserva-form" class="space-y-5 bg-slate-50 rounded-xl p-6 border border-slate-200 mb-8 shadow-md">
        <fieldset class="border border-slate-300 p-4 rounded-md">
          <legend class="text-lg font-semibold text-slate-700 px-2">Datos del Cliente</legend>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
            <div>
              <label for="cliente_nombre" class="font-semibold text-sm text-gray-700">Nombre completo*</label>
              <input name="cliente_nombre" id="cliente_nombre" class="form-control" required maxlength="120" />
            </div>
            <div>
              <label for="telefono" class="font-semibold text-sm text-gray-700">Teléfono</label>
              <input name="telefono" id="telefono" type="tel" class="form-control" maxlength="30" />
            </div>
          </div>
        </fieldset>
        <fieldset class="border border-slate-300 p-4 rounded-md">
          <legend class="text-lg font-semibold text-slate-700 px-2">Detalles de la Reserva</legend>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-5 mt-2">
            <div>
              <label for="fecha_entrada" class="font-semibold text-sm text-gray-700">Fecha y hora de llegada*</label>
              <input type="datetime-local" name="fecha_entrada" id="fecha_entrada" class="form-control" required />
            </div>
            <div>
              <label for="tipo_calculo_duracion" class="font-semibold text-sm text-gray-700">Calcular duración por*</label>
              <select name="tipo_calculo_duracion" id="tipo_calculo_duracion" class="form-control" required>
                <option value="noches_manual">Noches (manual)</option>
                <option value="tiempo_predefinido">Tiempo predefinido</option>
              </select>
            </div>
            <div id="noches-manual-container">
              <label for="cantidad_noches" class="font-semibold text-sm text-gray-700">Cantidad de noches*</label>
              <input name="cantidad_noches" id="cantidad_noches" type="number" min="1" max="90" value="1" class="form-control" />
            </div>
            <div id="tiempo-predefinido-container" style="display:none;">
              <label for="tiempo_estancia_id" class="font-semibold text-sm text-gray-700">Selecciona tiempo de estancia*</label>
              <select name="tiempo_estancia_id" id="tiempo_estancia_id" class="form-control"></select>
            </div>
            <div>
              <label for="habitacion_id" class="font-semibold text-sm text-gray-700">Habitación*</label>
              <select name="habitacion_id" id="habitacion_id" class="form-control" required></select>
            </div>
            <div>
              <label for="cantidad_huespedes" class="font-semibold text-sm text-gray-700">Cantidad de huéspedes*</label>
              <input name="cantidad_huespedes" id="cantidad_huespedes" type="number" min="1" max="20" value="2" class="form-control" required />
            </div>
          </div>
        </fieldset>
        <fieldset class="border border-slate-300 p-4 rounded-md">
          <legend class="text-lg font-semibold text-slate-700 px-2">Pago y Adicionales</legend>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-5 mt-2">
            <div>
              <label for="tipo_pago" class="font-semibold text-sm text-gray-700">Tipo de Pago*</label>
              <select id="tipo_pago" name="tipo_pago" class="form-control" required>
                <option value="parcial">Pago parcial (abono)</option>
                <option value="completo">Pago completo</option>
              </select>
            </div>
            <div>
              <label for="metodo_pago_id" class="font-semibold text-sm text-gray-700">Método de Pago*</label>
              <select name="metodo_pago_id" id="metodo_pago_id" class="form-control"></select> 
            </div>
            <div id="abono-container" class="md:col-span-2">
              <label for="monto_abono" class="font-semibold text-sm text-gray-700">Valor a abonar</label>
              <input name="monto_abono" id="monto_abono" type="number" min="0" step="1000" class="form-control" placeholder="0" />
            </div>
            <div id="total-pago-completo" class="md:col-span-2" style="display:none;">
              <div class="text-center py-4">
                <span class="text-2xl font-bold text-green-600">
                  Total a pagar: <span id="valor-total-pago">$0</span>
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
      <div id="reserva-feedback" class="mb-6 min-h-[24px]"></div>
      <div id="reservas-list" class="mt-8"></div>
    </div>
  `;

  ui.init(container); 
  
  const tipoPagoSelectEl = document.getElementById('tipo_pago');
  const abonoContainerEl = document.getElementById('abono-container');
  const montoAbonoInputEl = document.getElementById('monto_abono');
  const totalPagoCompletoEl = document.getElementById('total-pago-completo');
  const valorTotalPagoEl = document.getElementById('valor-total-pago');
  const metodoPagoSelectEl = document.getElementById('metodo_pago_id');

  function actualizarVisibilidadPago() {
    const totalReserva = state.currentBookingTotal; // Usar el total del state
    if (tipoPagoSelectEl.value === 'completo') {
      if (abonoContainerEl) abonoContainerEl.style.display = 'none';
      if (montoAbonoInputEl) {
          montoAbonoInputEl.value = ''; 
          montoAbonoInputEl.required = false; // No requerido si es pago completo
      }
      if (totalPagoCompletoEl) totalPagoCompletoEl.style.display = 'block';
      if (valorTotalPagoEl) valorTotalPagoEl.textContent = formatCurrency(totalReserva);
      if (metodoPagoSelectEl) metodoPagoSelectEl.required = true;
    } else { // parcial
      if (abonoContainerEl) abonoContainerEl.style.display = 'block';
      if (montoAbonoInputEl) montoAbonoInputEl.required = true; // Requerido si es pago parcial y el monto es > 0
      if (totalPagoCompletoEl) totalPagoCompletoEl.style.display = 'none';
      if (metodoPagoSelectEl) metodoPagoSelectEl.required = (parseFloat(montoAbonoInputEl?.value) || 0) > 0;
    }
  }
  
  if (tipoPagoSelectEl) tipoPagoSelectEl.addEventListener('change', actualizarVisibilidadPago);
  if (montoAbonoInputEl) {
      montoAbonoInputEl.addEventListener('input', () => {
          if (tipoPagoSelectEl.value === 'parcial' && metodoPagoSelectEl) {
              metodoPagoSelectEl.required = (parseFloat(montoAbonoInputEl.value) || 0) > 0;
          }
      });
  }
  
  [ui.habitacionIdSelect, ui.cantidadNochesInput, ui.tipoCalculoDuracionEl, ui.tiempoEstanciaIdSelect, ui.cantidadHuespedesInput].forEach(el => {
      if (el) el.addEventListener('change', async () => { // Hacerlo async para esperar validateAndCalculateBooking
          try {
              // Recalcular el total llamando a la función que actualiza state.currentBookingTotal
              const formData = gatherFormData();
              // Solo recalcular si hay suficiente info para no lanzar errores prematuros
              if (formData.habitacion_id && formData.fecha_entrada && 
                  ((formData.tipo_calculo_duracion === 'noches_manual' && formData.cantidad_noches) || 
                   (formData.tipo_calculo_duracion === 'tiempo_predefinido' && formData.tiempo_estancia_id))
              ) {
                  await validateAndCalculateBooking(formData); // Esto actualiza state.currentBookingTotal
              }
          } catch (calcError) {
              // No mostrar error aquí, validateAndCalculateBooking lo hará si es un error real de validación.
              // Esto es solo para actualizar el display del total.
              state.currentBookingTotal = 0; // Resetear si hay error de cálculo
          }
          actualizarVisibilidadPago(); // Actualizar UI del pago
      });
  });

  ui.form.onsubmit = handleFormSubmit;
  if(ui.cancelEditButton) ui.cancelEditButton.onclick = () => resetFormToCreateMode();
  if(ui.reservasListEl) ui.reservasListEl.addEventListener('click', handleListActions);

  if(ui.tipoCalculoDuracionEl) {
    ui.tipoCalculoDuracionEl.onchange = () => {
        const esNochesManual = ui.tipoCalculoDuracionEl.value === 'noches_manual';
        if(ui.nochesManualContainer) ui.nochesManualContainer.style.display = esNochesManual ? '' : 'none';
        if(ui.cantidadNochesInput) ui.cantidadNochesInput.required = esNochesManual;
        if(ui.tiempoPredefinidoContainer) ui.tiempoPredefinidoContainer.style.display = esNochesManual ? 'none' : '';
        if(ui.tiempoEstanciaIdSelect) ui.tiempoEstanciaIdSelect.required = !esNochesManual;
        
        // Recalcular y actualizar visibilidad de pago cuando cambia la duración
        const formData = gatherFormData();
        if (formData.habitacion_id && formData.fecha_entrada) { // Solo si hay datos base
            validateAndCalculateBooking(formData).then(() => {
                actualizarVisibilidadPago();
            }).catch(err => { 
                state.currentBookingTotal = 0; // Reset en caso de error
                actualizarVisibilidadPago();
                console.warn("Error recalculando total por cambio de duración:", err.message);
            });
        } else {
             state.currentBookingTotal = 0;
             actualizarVisibilidadPago();
        }
    };
    ui.tipoCalculoDuracionEl.dispatchEvent(new Event('change'));
  }
  
  if (ui.fechaEntradaInput) configureFechaEntrada(ui.fechaEntradaInput);
  await loadInitialData();
  actualizarVisibilidadPago(); 
}