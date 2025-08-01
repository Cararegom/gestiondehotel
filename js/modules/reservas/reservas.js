// js/modules/reservas/reservas.js
import {
    showError,
    showSuccess,
    showLoading,
    clearFeedback,
    setFormLoadingState,
    formatCurrency,
    formatDateTime,
    formatMinutesToHoursMinutes,
    registrarUsoDescuento 
} from '../../uiUtils.js';
import { turnoService } from '../../services/turnoService.js';
import { registrarEnBitacora } from '../../services/bitacoraservice.js';
import { showClienteSelectorModal, mostrarFormularioCliente } from '../clientes/clientes.js';
// --- MÓDULO DE ESTADO GLOBAL ---
const state = {
    isModuleMounted: false,
    isEditMode: false,
    editingReservaId: null,
    editingOriginalHabitacionId: null,
    descuentoAplicado: null,
    tiemposEstanciaDisponibles: [],
    currentUser: null,
    hotelId: null,
    supabase: null,
    currentBookingTotal: 0,
    configHotel: {
        cobro_al_checkin: true,
        checkin_hora_config: "15:00",
        checkout_hora_config: "12:00",
        impuestos_incluidos_en_precios: false,
        porcentaje_impuesto_principal: 0,
        nombre_impuesto_principal: null,
        moneda_local_simbolo: '$',      // Nuevo, con default
        moneda_codigo_iso_info: 'COP',  // Nuevo, con default
        moneda_decimales_info: '0'      // Nuevo, con default
    }
};

// --- MÓDULO DE UI (VISTA) ---
const ui = {
    container: null, form: null, feedbackDiv: null, formTitle: null,
    submitButton: null, cancelEditButton: null, reservasListEl: null,
    fechaEntradaInput: null, tipoCalculoDuracionEl: null, nochesManualContainer: null,
    cantidadNochesInput: null, tiempoPredefinidoContainer: null, tiempoEstanciaIdSelect: null,
    habitacionIdSelect: null, totalReservaDisplay: null,
    fieldsetPago: null,
    // Aquí declaramos las variables para los nuevos elementos del selector de clientes
    clienteSearchInput: null,
    btnBuscarCliente: null,
    btnCrearCliente: null,
    clienteIdHiddenInput: null,
    clienteNombreDisplay: null, // Este es el div que contiene el span del nombre seleccionado
    
    init(containerEl) {
        // Es crucial que containerEl no sea null y que el HTML ya esté inyectado
        if (!containerEl) {
            console.error("ui.init: El contenedor del módulo es null. No se pueden inicializar los elementos de la UI.");
            return;
        }
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
        this.totalReservaDisplay = containerEl.querySelector('#total-reserva-calculado-display');
        this.fieldsetPago = containerEl.querySelector('#fieldset-pago-adicionales');
        this.cedulaInput = containerEl.querySelector('#cedula');
        this.clienteSearchInput = containerEl.querySelector('#cliente_search_input'); // Nuevo input de búsqueda
        this.btnBuscarCliente = containerEl.querySelector('#btn_buscar_cliente');     // Botón de búsqueda
        this.btnCrearCliente = containerEl.querySelector('#btn_crear_cliente');       // Botón para crear cliente
        this.clienteIdHiddenInput = containerEl.querySelector('#cliente_id_hidden');  // Input oculto para guardar el cliente_id
        this.clienteNombreDisplay = containerEl.querySelector('#cliente_nombre_display'); // Para mostrar el nombre del cliente seleccionado
        if (!this.form) console.error("ui.init: #reserva-form es null.");
        if (!this.clienteNombreDisplay) console.error("ui.init: #cliente_nombre_display es null.");
        if (!this.clienteSearchInput) console.error("ui.init: #cliente_search_input es null.");
   
    },

    async showConfirmationModal(message, title = "Confirmar Acción") {
        if (typeof Swal !== 'undefined') {
            const result = await Swal.fire({
                title: title, text: message, icon: 'warning', showCancelButton: true,
                confirmButtonColor: '#3085d6', cancelButtonColor: '#d33',
                confirmButtonText: 'Sí, continuar', cancelButtonText: 'No, cancelar'
            });
            return result.isConfirmed;
        }
        return window.confirm(message);
    },

    showInfoModal(message, title = "Información") {
        if (typeof Swal !== 'undefined') Swal.fire(title, message, 'info');
        else alert(`${title}\n\n${message}`);
    },

   // REEMPLAZA ESTA FUNCIÓN EN EL OBJETO ui
updateTotalDisplay(montoDescontado = 0) {
    if (!this.totalReservaDisplay) return;

    // Actualiza el total principal
    this.totalReservaDisplay.textContent = formatCurrency(state.currentBookingTotal, state.configHotel?.moneda_local_simbolo || '$', state.configHotel?.moneda_codigo_iso_info || 'COP', parseInt(state.configHotel?.moneda_decimales_info || 0));

    // Muestra u oculta el resumen del descuento
    const descuentoResumenEl = document.getElementById('descuento-resumen-reserva');
    if (descuentoResumenEl) {
        if (state.descuentoAplicado && montoDescontado > 0) {
            descuentoResumenEl.innerHTML = `
                <span class="font-semibold">${state.descuentoAplicado.nombre}:</span>
                <span class="font-bold">-${formatCurrency(montoDescontado, state.configHotel?.moneda_local_simbolo || '$')}</span>
            `;
            descuentoResumenEl.style.display = 'block';
        } else {
            descuentoResumenEl.style.display = 'none';
        }
    }

    // Muestra la información de impuestos
    let impuestoMsg = "";
    if (state.configHotel.porcentaje_impuesto_principal > 0 && state.configHotel.nombre_impuesto_principal) {
        impuestoMsg = state.configHotel.impuestos_incluidos_en_precios
            ? `(Incluye ${state.configHotel.nombre_impuesto_principal})`
            : `(+ ${state.configHotel.porcentaje_impuesto_principal}% ${state.configHotel.nombre_impuesto_principal})`;
    }
    this.totalReservaDisplay.innerHTML += ` <small class="text-gray-500 text-xs ml-1">${impuestoMsg}</small>`;

    // Actualiza el total en el modal de pago
    const valorTotalPagoEl = document.getElementById('valor-total-pago');
    if (valorTotalPagoEl) {
        valorTotalPagoEl.textContent = formatCurrency(state.currentBookingTotal, state.configHotel?.moneda_local_simbolo || '$', state.configHotel?.moneda_codigo_iso_info || 'COP', parseInt(state.configHotel?.moneda_decimales_info || 0));
    }
},

    togglePaymentFieldsVisibility(visible) {
        if (this.fieldsetPago) {
            this.fieldsetPago.style.display = visible ? '' : 'none';
            const paymentMessage = document.getElementById('payment-message-checkout');
            if (!visible && paymentMessage) {
                paymentMessage.style.display = 'block';
            } else if (paymentMessage) {
                paymentMessage.style.display = 'none';
            }
        }
        const tipoPagoEl = this.form.elements.tipo_pago;
        const metodoPagoEl = this.form.elements.metodo_pago_id;
        const montoAbonoEl = this.form.elements.monto_abono;

        if (tipoPagoEl) tipoPagoEl.required = visible;
        if (metodoPagoEl) metodoPagoEl.required = false;
        if (montoAbonoEl) montoAbonoEl.required = false;

        if (!visible) {
            if (tipoPagoEl) tipoPagoEl.value = 'parcial';
            if (metodoPagoEl) metodoPagoEl.value = '';
            if (montoAbonoEl) montoAbonoEl.value = '';
        }
    }
};

// ... (resto de tu código de reservas.js) ...

// js/modules/reservas/reservas.js

// REEMPLAZA esta función en tu archivo reservas.js
function gatherFormData() {
    if (!ui.form) return {};
    const formElements = ui.form.elements;
    
    const clienteIdSeleccionado = ui.clienteIdHiddenInput?.value || null;
    let nombreCliente, cedulaCliente, telefonoCliente;

    if (clienteIdSeleccionado) {
        nombreCliente = ui.clienteNombreDisplay?.querySelector('#selected_client_name')?.textContent || '';
        cedulaCliente = formElements.cedula?.value || '';
        telefonoCliente = formElements.telefono?.value || '';
    } else {
        nombreCliente = formElements.cliente_nombre?.value || '';
        cedulaCliente = formElements.cedula?.value || '';
        telefonoCliente = formElements.telefono?.value || '';
    }

    return {
        cliente_id: clienteIdSeleccionado,
        cliente_nombre: nombreCliente,
        cedula: cedulaCliente,
        telefono: telefonoCliente,
        fecha_entrada: formElements.fecha_entrada?.value || '',
        tipo_calculo_duracion: formElements.tipo_calculo_duracion?.value || 'noches_manual',
        cantidad_noches: formElements.cantidad_noches?.value || '1',
        tiempo_estancia_id: formElements.tiempo_estancia_id?.value || '',
        habitacion_id: formElements.habitacion_id?.value || '',
        cantidad_huespedes: formElements.cantidad_huespedes?.value || '1',
        metodo_pago_id: formElements.metodo_pago_id?.value || '',
        monto_abono: formElements.monto_abono?.value || '0',
        notas: formElements.notas?.value || '',
        tipo_pago: formElements.tipo_pago?.value || 'parcial',
        precio_libre_toggle: formElements.precio_libre_toggle?.checked || false, // <-- AÑADIDO
        precio_libre_valor: formElements.precio_libre_valor?.value || '0'       // <-- AÑADIDO
    };
}





function validateInitialInputs(formData) {
    // Si hay un `cliente_id` (cliente seleccionado desde el selector), el `cliente_nombre` ya está validado.
    // Si NO hay `cliente_id`, entonces el `cliente_nombre` manual es obligatorio.
    if (!formData.cliente_id && !formData.cliente_nombre.trim()) {
        throw new Error("El nombre del cliente es obligatorio o debe seleccionar un cliente existente.");
    }

    if (!formData.habitacion_id) throw new Error("Debe seleccionar una habitación.");
    if (!formData.fecha_entrada) throw new Error("La fecha y hora de llegada son obligatorias.");
    const fechaEntradaDate = new Date(formData.fecha_entrada);
    if (isNaN(fechaEntradaDate.getTime())) throw new Error("La fecha de llegada no es válida.");

    const unDiaEnMs = 24 * 60 * 60 * 1000;
    // Validar que la fecha de llegada no sea demasiado en el pasado para nuevas reservas
    // o un pasado muy lejano para ediciones.
    if (!state.isEditMode && fechaEntradaDate < new Date(Date.now() - 10 * 60 * 1000)) { // 10 minutos de margen
        throw new Error("La fecha y hora de llegada no pueden ser en el pasado para nuevas reservas.");
    } else if (state.isEditMode && fechaEntradaDate < new Date(Date.now() - 7 * unDiaEnMs)) { // 7 días de margen al editar
        throw new Error("Al editar, la fecha y hora de llegada no pueden ser más de 7 días en el pasado.");
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

    // Validaciones de pago si el hotel cobra al check-in y no estamos editando
    if (state.configHotel.cobro_al_checkin && !state.isEditMode) {
        const montoAbonoNum = parseFloat(formData.monto_abono) || 0;
        if (formData.tipo_pago === 'completo' && state.currentBookingTotal > 0 && !formData.metodo_pago_id) {
            throw new Error("Si selecciona 'Pago completo' y hay un total a pagar, debe elegir un método de pago.");
        }
        if (formData.tipo_pago === 'parcial' && montoAbonoNum > 0 && !formData.metodo_pago_id) {
            throw new Error("Si registra un abono mayor a cero, debe seleccionar un método de pago.");
        }
        if (montoAbonoNum < 0) {
            throw new Error("El monto del abono no puede ser negativo.");
        }
        // Asegurarse de que el abono no exceda el total de la reserva
        if (montoAbonoNum > state.currentBookingTotal && state.currentBookingTotal > 0) {
             throw new Error(`El abono (${formatCurrency(montoAbonoNum, state.configHotel?.moneda_local_simbolo || '$')}) no puede exceder el total de la reserva (${formatCurrency(state.currentBookingTotal, state.configHotel?.moneda_local_simbolo || '$')}).`);
        }
    }
}


//-----------calendario------------//
// Parser para eventos creados desde tu app (si los tuvieras)
// REEMPLAZA ESTAS DOS FUNCIONES EN: js/modules/reservas/reservas.js

// Parser para eventos creados desde tu app (más robusto)
function parseEventoGoogle(evento) {
  if (!evento.summary) return null;
  // Expresión regular mejorada: más flexible con los espacios
  const summaryRegex = /Reserva\s*\|\s*Cliente:\s*([^|]+?)\s*\|\s*Room:\s*([^|]+?)\s*\|\s*Huéspedes:\s*(\d+)/i;
  const match = evento.summary.match(summaryRegex);
  
  // Si el formato del título no coincide, no se puede procesar.
  if (!match) return null;

  const [, cliente_nombre, habitacion_nombre, cantidad_huespedes_str] = match;

  // Validación básica de los datos extraídos
  if (!cliente_nombre.trim() || !habitacion_nombre.trim()) return null;

  let telefono = null, cedula = null;
  if (evento.description) {
    const telMatch = evento.description.match(/Tel[eé]fono:\s*([\d\s\-\+]+)/i);
    if (telMatch) telefono = telMatch[1].trim();
    
    const cedulaMatch = evento.description.match(/C[eé]dula:\s*([A-Za-z0-9\-\.]+)/i);
    if (cedulaMatch) cedula = cedulaMatch[1].trim();
  }

  return {
    cliente_nombre: cliente_nombre.trim(),
    cantidad_huespedes: parseInt(cantidad_huespedes_str, 10) || 1,
    // Importante: Guardamos el NOMBRE de la habitación para buscar su ID después
    habitacion_nombre: habitacion_nombre.trim(), 
    telefono,
    cedula,
    fecha_inicio: evento.start.dateTime || evento.start.date,
    fecha_fin: evento.end.dateTime || evento.end.date,
    google_event_id: evento.id,
    descripcion: evento.description || '', 
    origen_reserva: 'google_calendar'
  };
}

// Parser para eventos de iCal (Booking, Airbnb, etc. - más robusto)
function parseEventoICal(evento, habitaciones) {
    if (!evento.summary && !evento.location) return null;
    
    let habitacionNombreDetectado = null;
    
    // Busca el nombre de la habitación en el título (summary) o en la ubicación (location)
    const roomRegex = /(?:Room|Habitación)\s*:?\s*([^\s(]+)/i;
    const summaryMatch = evento.summary ? evento.summary.match(roomRegex) : null;
    const locationMatch = evento.location ? evento.location.match(roomRegex) : null;

    if (summaryMatch && summaryMatch[1]) {
        habitacionNombreDetectado = summaryMatch[1].trim();
    } else if (locationMatch && locationMatch[1]) {
        habitacionNombreDetectado = locationMatch[1].trim();
    }

    // Si no se encuentra un nombre de habitación, no podemos continuar
    if (!habitacionNombreDetectado) return null;

    // Busca el ID de la habitación haciendo una comparación insensible a mayúsculas/minúsculas
    const habitacionObj = habitaciones.find(h => h.nombre.trim().toLowerCase() === habitacionNombreDetectado.toLowerCase());
    
    // Si no se encuentra una habitación coincidente en la BD, se descarta el evento.
    if (!habitacionObj) {
        console.warn(`[Sync ICal] Evento de ${evento.summary} descartado. No se encontró habitación con el nombre: "${habitacionNombreDetectado}"`);
        return null;
    }

    // El resto del parseo de la descripción se mantiene igual
    let cliente_nombre = evento.summary.replace(roomRegex, "").replace("(Imported)", "").trim() || "Reserva Externa";
    let cantidad_huespedes = 1;

    if (evento.description) {
        const huespedesMatch = evento.description.match(/Huéspedes?:\s*(\d+)/i);
        if (huespedesMatch) cantidad_huespedes = parseInt(huespedesMatch[1], 10);
    }
    
    return {
        cliente_nombre,
        cantidad_huespedes,
        habitacion_id: habitacionObj.id, // Usamos el ID encontrado
        fecha_inicio: evento.start.dateTime || evento.start.date,
        fecha_fin: evento.end.dateTime || evento.end.date,
        google_event_id: evento.id,
        origen_reserva: 'ical_google',
        descripcion: evento.description || ''
    };
}




// Función principal de sincronización
// REEMPLAZA ESTA FUNCIÓN EN: js/modules/reservas/reservas.js

async function syncReservasConGoogleCalendar(state) {
  try {
    if (!state.hotelId) return;

    // 1. Obtener datos locales (reservas existentes y habitaciones con su ID y nombre)
    const [reservasResult, habitacionesResult] = await Promise.all([
        state.supabase.from('reservas').select('google_event_id').eq('hotel_id', state.hotelId).not('google_event_id', 'is', null),
        state.supabase.from('habitaciones').select('id, nombre').eq('hotel_id', state.hotelId)
    ]);

    if (reservasResult.error || habitacionesResult.error) {
        console.error("[Sync] Error obteniendo datos locales:", { reservError: reservasResult.error, habError: habitacionesResult.error });
        return;
    }
    const reservasActuales = reservasResult.data;
    const habitaciones = habitacionesResult.data;

    // 2. Invocar la Edge Function
    const { data: dataEventos, error: errorInvocacion } = await state.supabase.functions.invoke(
      'calendar-sync-events', { body: { hotelId: state.hotelId } }
    );
    if (errorInvocacion) {
      console.error('CRÍTICO: Error al invocar la Edge Function:', errorInvocacion);
      return;
    }
    const eventosGoogle = dataEventos.events;
    if (!Array.isArray(eventosGoogle)) return;
    
    let nuevasReservasInsertadas = 0;
    for (const evento of eventosGoogle) {
      if (evento.status === "cancelled") continue;
      
      const yaExiste = reservasActuales.some(r => r.google_event_id === evento.id);
      if (yaExiste) continue;

      // 3. Parsear el evento
      let reservaParsed = parseEventoGoogle(evento) || parseEventoICal(evento, habitaciones);
      if (!reservaParsed) continue;

      // 4. Asegurar que tenemos un habitacion_id
      if (!reservaParsed.habitacion_id && reservaParsed.habitacion_nombre) {
          const habEncontrada = habitaciones.find(h => h.nombre.trim().toLowerCase() === reservaParsed.habitacion_nombre.toLowerCase());
          if (habEncontrada) {
              reservaParsed.habitacion_id = habEncontrada.id;
          } else {
              console.warn(`[Sync] Evento descartado. No se encontró ID para habitación nombrada: "${reservaParsed.habitacion_nombre}"`);
              continue;
          }
      }
      if (!reservaParsed.habitacion_id) continue;

      // 5. Preparar e insertar
      const reservaParaInsertar = { ...reservaParsed, hotel_id: state.hotelId, estado: 'reservada', monto_total: 0, monto_pagado: 0, usuario_id: state.currentUser.id };
      delete reservaParaInsertar.descripcion;
      delete reservaParaInsertar.habitacion_nombre; // Limpiar campo temporal

      const { data: insertData, error: insertError } = await state.supabase
        .from('reservas').insert(reservaParaInsertar).select().single();
      
      if (insertError) {
        console.error("[Sync] ERROR AL INSERTAR EN SUPABASE:", insertError.message, "--> Objeto:", reservaParaInsertar);
      } else {
        console.log("%c[Sync] ¡ÉXITO! Reserva insertada:", "color: green; font-weight: bold;", insertData);
        nuevasReservasInsertadas++;
        reservasActuales.push({ google_event_id: insertData.google_event_id });
      }
    }

    if (nuevasReservasInsertadas > 0) {
        console.log(`[Sync] ${nuevasReservasInsertadas} nuevas reservas sincronizadas. Refrescando UI.`);
        await renderReservas();
    }
  } catch (e) {
    console.error("Error catastrófico en syncReservasConGoogleCalendar:", e);
  }
}

//------------------fin de reservas google---------------------//
function calculateFechasEstancia(fechaEntradaStr, tipoCalculo, cantidadNochesStr, tiempoEstanciaId, checkoutHoraConfig) {
    const fechaEntrada = new Date(fechaEntradaStr);
    if (isNaN(fechaEntrada.getTime())) return { errorFechas: "La fecha de entrada no es válida." };
    let fechaSalida, cantidadDuracionOriginal;
    const tipoDuracionOriginal = tipoCalculo;

    if (tipoCalculo === "noches_manual") {
        cantidadDuracionOriginal = parseInt(cantidadNochesStr) || 1;
        if (cantidadDuracionOriginal < 1) return { errorFechas: "Cantidad de noches debe ser al menos 1." };
        fechaSalida = new Date(fechaEntrada);
        fechaSalida.setDate(fechaSalida.getDate() + cantidadDuracionOriginal);
        const [hh, mm] = (checkoutHoraConfig || "12:00").split(':').map(Number);
        fechaSalida.setHours(hh, mm, 0, 0);
    } else {
        if (!tiempoEstanciaId) return { errorFechas: "No se seleccionó un tiempo de estancia." };
        const tiempo = state.tiemposEstanciaDisponibles.find(ts => ts.id === tiempoEstanciaId);
        if (!tiempo || typeof tiempo.minutos !== 'number' || tiempo.minutos <= 0) return { errorFechas: "Tiempo de estancia predefinido inválido." };
        cantidadDuracionOriginal = tiempo.minutos;
        fechaSalida = new Date(fechaEntrada.getTime() + (tiempo.minutos * 60 * 1000));
    }
    if (fechaSalida <= fechaEntrada) return { errorFechas: "La fecha de salida debe ser posterior a la de llegada." };
    return { fechaEntrada, fechaSalida, tipoDuracionOriginal, cantidadDuracionOriginal, errorFechas: null };
}



function esTiempoEstanciaNoches(tiempoEstanciaId) {
    if (!tiempoEstanciaId || !state.tiemposEstanciaDisponibles) return false;
    const tiempo = state.tiemposEstanciaDisponibles.find(ts => ts.id === tiempoEstanciaId);
    return tiempo && tiempo.minutos >= (22 * 60) && tiempo.minutos <= (26 * 60);
}

// REEMPLAZA esta función completa en tu archivo reservas.js
function calculateMontos(habitacionInfo, huespedes, tipoDuracion, cantDuracion, tiempoId, precioLibreActivado, precioLibreValor) {
    if (!habitacionInfo) return { errorMonto: "Información de habitación no disponible." };

    let montoEstanciaBaseBruto;
    let montoPorHuespedesAdicionales = 0;
    let montoDescontado = 0;
    let totalAntesDeImpuestos;

    // --- INICIO DE LA LÓGICA CORREGIDA ---
    // Si el precio libre está activado, este se convierte en el precio total antes de impuestos.
    // Se ignoran los cálculos de precio de habitación, huéspedes adicionales y descuentos.
    if (precioLibreActivado && typeof precioLibreValor === 'number' && precioLibreValor >= 0) {
        
        montoEstanciaBaseBruto = precioLibreValor;
        totalAntesDeImpuestos = precioLibreValor;
        // Forzamos a cero los otros conceptos para que no se sumen ni resten.
        montoPorHuespedesAdicionales = 0;
        montoDescontado = 0;

    } else {
        // --- LÓGICA DE CÁLCULO NORMAL (CUANDO EL PRECIO LIBRE NO ESTÁ ACTIVO) ---

        // 1. Calcular precio base de la estancia (por noche o por tiempo)
        if (tipoDuracion === "noches_manual") {
            montoEstanciaBaseBruto = (habitacionInfo.precio || 0) * cantDuracion;
        } else {
            const tiempo = state.tiemposEstanciaDisponibles.find(ts => ts.id === tiempoId);
            if (tiempo && typeof tiempo.precio === 'number' && tiempo.precio >= 0) {
                montoEstanciaBaseBruto = tiempo.precio;
            } else {
                return { errorMonto: "Precio no definido para el tiempo de estancia seleccionado." };
            }
        }

        // 2. Validar capacidad y calcular costo de huéspedes adicionales
        const capacidadMaxima = habitacionInfo.capacidad_maxima || huespedes;
        if (huespedes > capacidadMaxima) {
            return { errorMonto: `Cantidad de huéspedes (${huespedes}) excede la capacidad máxima (${capacidadMaxima}).` };
        }
        const capacidadBase = habitacionInfo.capacidad_base || 1;
        if (huespedes > capacidadBase) {
            const extraHuespedes = huespedes - capacidadBase;
            let factorDuracionParaAdicional = 1;
            if (tipoDuracion === "noches_manual") {
                factorDuracionParaAdicional = cantDuracion;
            } else if (tipoDuracion === "tiempo_predefinido" && esTiempoEstanciaNoches(tiempoId)) {
                factorDuracionParaAdicional = Math.max(1, Math.round(cantDuracion / (24 * 60)));
            }
            montoPorHuespedesAdicionales = extraHuespedes * (habitacionInfo.precio_huesped_adicional || 0) * factorDuracionParaAdicional;
        }

        const totalAntesDeDescuento = montoEstanciaBaseBruto + montoPorHuespedesAdicionales;

        // 3. Calcular descuento si aplica
        if (state.descuentoAplicado) {
            if (state.descuentoAplicado.tipo === 'fijo') {
                montoDescontado = parseFloat(state.descuentoAplicado.valor);
            } else if (state.descuentoAplicado.tipo === 'porcentaje') {
                montoDescontado = totalAntesDeDescuento * (parseFloat(state.descuentoAplicado.valor) / 100);
            }
        }
        montoDescontado = Math.min(totalAntesDeDescuento, montoDescontado);
        
        totalAntesDeImpuestos = totalAntesDeDescuento - montoDescontado;
    }
    // --- FIN DE LA LÓGICA CORREGIDA ---


    // --- CÁLCULO DE IMPUESTOS (COMÚN PARA AMBOS CASOS) ---
    let montoImpuestoCalculado = 0;
    let baseImponibleFinal = totalAntesDeImpuestos;

    if (state.configHotel.impuestos_incluidos_en_precios && state.configHotel.porcentaje_impuesto_principal > 0) {
        baseImponibleFinal = totalAntesDeImpuestos / (1 + (state.configHotel.porcentaje_impuesto_principal / 100));
        montoImpuestoCalculado = totalAntesDeImpuestos - baseImponibleFinal;
    } else if (state.configHotel.porcentaje_impuesto_principal > 0) {
        montoImpuestoCalculado = baseImponibleFinal * (state.configHotel.porcentaje_impuesto_principal / 100);
    }

    return {
        montoEstanciaBase: Math.round(montoEstanciaBaseBruto),
        montoPorHuespedesAdicionales: Math.round(montoPorHuespedesAdicionales),
        montoDescontado: Math.round(montoDescontado),
        montoImpuesto: Math.round(montoImpuestoCalculado),
        baseSinImpuestos: Math.round(baseImponibleFinal),
        errorMonto: null
    };
}


async function validateAndCalculateBooking(formData) {
    const [habitacionResult] = await Promise.all([
        state.supabase.from('habitaciones').select('precio, capacidad_base, capacidad_maxima, precio_huesped_adicional').eq('id', formData.habitacion_id).single(),
    ]);
    if (habitacionResult.error) throw new Error(`Error obteniendo detalles de la habitación: ${habitacionResult.error.message}`);
    const habitacionInfo = habitacionResult.data;
    if (!habitacionInfo) throw new Error("No se encontró la habitación seleccionada.");

    const { fechaEntrada, fechaSalida, tipoDuracionOriginal, cantidadDuracionOriginal, errorFechas } = calculateFechasEstancia(formData.fecha_entrada, formData.tipo_calculo_duracion, formData.cantidad_noches, formData.tiempo_estancia_id, state.configHotel.checkout_hora_config);
    if (errorFechas) throw new Error(errorFechas);

    const { data: hayCruce, error: errCruce } = await state.supabase.rpc('validar_cruce_reserva', {
        p_habitacion_id: formData.habitacion_id, p_entrada: fechaEntrada.toISOString(),
        p_salida: fechaSalida.toISOString(), p_reserva_id_excluida: state.isEditMode ? state.editingReservaId : null
    });
    if (errCruce) throw new Error(`Error validando disponibilidad: ${errCruce.message}.`);
    if (hayCruce === true) throw new Error("Conflicto: La habitación no está disponible para el período seleccionado.");
    
    // ▼▼▼ INICIO DE LA CORRECCIÓN CLAVE ▼▼▼
    // Ahora pasamos correctamente los valores del precio libre a la función de cálculo.
    const { montoEstanciaBase, montoPorHuespedesAdicionales, montoDescontado, montoImpuesto, baseSinImpuestos, errorMonto } = calculateMontos(
        habitacionInfo, parseInt(formData.cantidad_huespedes), tipoDuracionOriginal, cantidadDuracionOriginal, formData.tiempo_estancia_id, 
        formData.precio_libre_toggle, 
        parseFloat(formData.precio_libre_valor)
    );
    // ▲▲▲ FIN DE LA CORRECCIÓN CLAVE ▲▲▲

    if (errorMonto) throw new Error(errorMonto);

    state.currentBookingTotal = baseSinImpuestos + montoImpuesto;
    if (ui && typeof ui.updateTotalDisplay === 'function') { 
        ui.updateTotalDisplay(montoDescontado);
    }
    
    let notasFinales = formData.notas.trim() || null;
    if (formData.precio_libre_toggle) {
        const precioManualStr = `[PRECIO MANUAL: ${formatCurrency(parseFloat(formData.precio_libre_valor))}]`;
        notasFinales = notasFinales ? `${precioManualStr} ${notasFinales}` : precioManualStr;
    }

    const datosReserva = {
        cliente_id: formData.cliente_id,
        cliente_nombre: formData.cliente_nombre.trim(),
        cedula: formData.cedula.trim() || null,
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
        monto_estancia_base_sin_impuestos: baseSinImpuestos,
        monto_impuestos_estancia: montoImpuesto,
        porcentaje_impuestos_aplicado: state.configHotel.porcentaje_impuesto_principal,
        nombre_impuesto_aplicado: state.configHotel.nombre_impuesto_principal,
        monto_total: state.currentBookingTotal,
        descuento_aplicado_id: state.descuentoAplicado?.id || null,
        monto_descontado: montoDescontado,
        notas: notasFinales,
        origen_reserva: 'directa',
        id_temporal_o_final: state.isEditMode ? state.editingReservaId : `TEMP-${Date.now()}`
    };
    
    const datosPago = {
        monto_abono: parseFloat(formData.monto_abono) || 0,
        metodo_pago_id: formData.metodo_pago_id || null,
        tipo_pago: formData.tipo_pago
    };
    
    return { datosReserva, datosPago };
}





// REEMPLAZA ESTA FUNCIÓN COMPLETA
async function recalcularYActualizarTotalUI() {
    try {
        const formData = gatherFormData();

        // --- INICIO DE LA LÓGICA DE DESCUENTO AUTOMÁTICO ---
        // Solo buscamos descuentos automáticos si no hay uno manual ya aplicado
        if (!state.descuentoAplicado || state.descuentoAplicado.tipo_descuento_general !== 'codigo') {
            // Pasamos 'null' para que la función solo busque automáticos
            state.descuentoAplicado = await buscarDescuentoParaReserva(formData, null);
        }
        // --- FIN DE LA LÓGICA DE DESCUENTO AUTOMÁTICO ---

        if (formData.habitacion_id && formData.fecha_entrada &&
            ((formData.tipo_calculo_duracion === 'noches_manual' && formData.cantidad_noches) ||
             (formData.tipo_calculo_duracion === 'tiempo_predefinido' && formData.tiempo_estancia_id)) &&
            formData.cantidad_huespedes
        ) {
            await validateAndCalculateBooking(formData);
        } else {
            state.currentBookingTotal = 0;
            if (ui && typeof ui.updateTotalDisplay === 'function') { 
                ui.updateTotalDisplay(); 
            }
        }
    } catch (calcError) {
        state.currentBookingTotal = 0;
        if (ui && typeof ui.updateTotalDisplay === 'function') { 
            ui.updateTotalDisplay(); 
        }
        console.warn("[Reservas] Advertencia al recalcular total para UI:", calcError.message);
    }
}

// REEMPLAZA ESTA FUNCIÓN EN TU ARCHIVO reservas.js

async function cargarHabitaciones() {
    if (!ui.habitacionIdSelect) return;
    ui.habitacionIdSelect.innerHTML = `<option value="">Cargando habitaciones...</option>`;
    ui.habitacionIdSelect.disabled = true;
    
    const { data: rooms, error } = await state.supabase.from('habitaciones')
        .select('id, nombre, tipo, estado, precio, capacidad_base, capacidad_maxima, precio_huesped_adicional')
        .eq('hotel_id', state.hotelId)
        .eq('activo', true)
        .order('nombre', { ascending: true });

    if (error) {
        ui.habitacionIdSelect.innerHTML = `<option value="">Error al cargar</option>`;
    } else if (!rooms || rooms.length === 0) {
        ui.habitacionIdSelect.innerHTML = `<option value="">No hay habitaciones</option>`;
    } else {
        let optionsHtml = `<option value="">Selecciona habitación...</option>`;
        
        rooms.forEach(room => {
            const isAvailable = room.estado === 'libre';
            const disabledAttribute = !isAvailable ? 'disabled' : '';
            
            // --- INICIO DE LA CORRECCIÓN ---
            // Se añade una comprobación para asegurar que 'room.estado' no es null
            // antes de intentar usar métodos de string como .charAt() o .slice().
            const statusLabel = !isAvailable && room.estado 
                ? ` (${room.estado.charAt(0).toUpperCase() + room.estado.slice(1)})` 
                : '';
            // --- FIN DE LA CORRECCIÓN ---

            optionsHtml += `
                <option 
                    value="${room.id}" 
                    data-precio="${room.precio || 0}" 
                    data-capacidad-base="${room.capacidad_base || 1}" 
                    data-capacidad-maxima="${room.capacidad_maxima || room.capacidad_base || 1}" 
                    data-precio-extra="${room.precio_huesped_adicional || 0}"
                    ${disabledAttribute}
                >
                    ${room.nombre} (${formatCurrency(room.precio, state.configHotel?.moneda_local_simbolo || '$')})${statusLabel}
                </option>
            `;
        });
        
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
    if (error) { select.innerHTML = `<option value="">Error</option>`; return; }
    let optionsHtml = `<option value="">Selecciona método de pago...</option>`;
    if (data && data.length > 0) { data.forEach(pago => optionsHtml += `<option value="${pago.id}">${pago.nombre}</option>`); }
    else { optionsHtml = `<option value="">No hay métodos de pago</option>`; }
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
        const opt = document.createElement('option'); opt.value = "";
        opt.textContent = error ? "Error cargando tiempos" : "No hay tiempos predefinidos";
        ui.tiempoEstanciaIdSelect.appendChild(opt);
        state.tiemposEstanciaDisponibles = []; return;
    }
    state.tiemposEstanciaDisponibles = data;
    const placeholder = document.createElement('option');
    placeholder.value = ""; placeholder.textContent = "Selecciona un tiempo...";
    ui.tiempoEstanciaIdSelect.appendChild(placeholder);
    data.forEach(ts => {
        const option = document.createElement('option'); option.value = ts.id;
        const horasAprox = formatMinutesToHoursMinutes(ts.minutos);
        option.textContent = `${ts.nombre} (${formatCurrency(ts.precio, state.configHotel?.moneda_local_simbolo || '$', state.configHotel?.moneda_codigo_iso_info || 'COP', parseInt(state.configHotel?.moneda_decimales_info || 0))}) - ${horasAprox}`;
        option.setAttribute('data-precio', ts.precio);
        ui.tiempoEstanciaIdSelect.appendChild(option);
    });
}


// PEGA ESTAS DOS NUEVAS FUNCIONES EN reservas.js

/**
 * Busca un descuento aplicable para la reserva actual, por código o automático.
 * @param {object} formData - Los datos actuales del formulario de reserva.
 * @param {string|null} codigoManual - El código introducido por el usuario.
 * @returns {Promise<object|null>} El objeto del descuento si es aplicable, o null.
 */
// PEGA ESTAS DOS NUEVAS FUNCIONES EN reservas.js

/**
 * Busca un descuento aplicable para la reserva actual, por código o automático.
 * @param {object} formData - Los datos actuales del formulario de reserva.
 * @param {string|null} codigoManual - El código introducido por el usuario.
 * @returns {Promise<object|null>} El objeto del descuento si es aplicable, o null.
 */

// PEGA ESTA FUNCIÓN FALTANTE EN TU ARCHIVO reservas.js

/**
 * Busca un descuento aplicable para la reserva actual, por código o automático.
 * @param {object} formData - Los datos actuales del formulario de reserva.
 * @param {string|null} codigoManual - El código introducido por el usuario.
 * @returns {Promise<object|null>} El objeto del descuento si es aplicable, o null.
 */
// En reservas.js, reemplaza esta función completa

// En reservas.js, reemplaza esta función completa

async function buscarDescuentoParaReserva(formData, codigoManual = null) {
    if (!formData.habitacion_id && !codigoManual && !formData.cliente_id) return null;

    const ahora = new Date().toISOString();
    let query = state.supabase.from('descuentos').select('*')
        .eq('hotel_id', state.hotelId)
        .eq('activo', true)
        .or(`fecha_inicio.is.null,fecha_inicio.lte.${ahora}`)
        .or(`fecha_fin.is.null,fecha_fin.gte.${ahora}`);

    const orConditions = ['tipo_descuento_general.eq.automatico'];
    if (codigoManual) { orConditions.push(`codigo.eq.${codigoManual.toUpperCase()}`); }
    if (formData.cliente_id) { orConditions.push(`cliente_id.eq.${formData.cliente_id}`); }
    query = query.or(orConditions.join(','));

    const { data: descuentosPotenciales, error } = await query;
    if (error) { console.error("Error buscando descuentos de reserva:", error); return null; }

    const descuentosValidos = descuentosPotenciales.filter(d => (d.usos_maximos || 0) === 0 || (d.usos_actuales || 0) < d.usos_maximos);

    // Prioridad de búsqueda:
    if (formData.cliente_id) { const d = descuentosValidos.find(d => d.cliente_id === formData.cliente_id); if (d) return d; }
    if (codigoManual) { const d = descuentosValidos.find(d => d.codigo && d.codigo.toUpperCase() === codigoManual.toUpperCase()); if (d) return d; }
    
    for (const descuento of descuentosValidos) {
        const aplicabilidad = descuento.aplicabilidad;
        const itemsAplicables = descuento.habitaciones_aplicables || [];

        if (aplicabilidad === 'tiempos_estancia_especificos') {
             // --- LÓGICA NUEVA Y CORRECTA ---
            if (formData.tipo_calculo_duracion === 'noches_manual' && itemsAplicables.includes('NOCHE_COMPLETA')) {
                return descuento;
            }
            if (formData.tipo_calculo_duracion === 'tiempo_predefinido' && formData.tiempo_estancia_id && itemsAplicables.includes(formData.tiempo_estancia_id)) {
                return descuento;
            }
        }
        else if (aplicabilidad === 'habitaciones_especificas' && formData.habitacion_id && itemsAplicables.includes(formData.habitacion_id)) {
            return descuento;
        }
        else if (aplicabilidad === 'reserva_total') {
            return descuento;
        }
    }
    
    return null;
}


async function handleAplicarDescuentoReserva() {
    const feedbackEl = document.getElementById('feedback-descuento-reserva');
    const codigoInput = document.getElementById('codigo-descuento-reserva');
    const codigo = codigoInput.value.trim();

    clearFeedback(feedbackEl);
    if (!codigo) {
        state.descuentoAplicado = null;
        await recalcularYActualizarTotalUI(); // Recalcula sin descuento
        return;
    }

    feedbackEl.textContent = 'Buscando...';
    try {
        const formData = gatherFormData();
        state.descuentoAplicado = await buscarDescuentoParaReserva(formData, codigo);
        
        if (state.descuentoAplicado) {
            showSuccess(feedbackEl, `¡Descuento "${state.descuentoAplicado.nombre}" aplicado!`);
        } else {
            showError(feedbackEl, 'El código no es válido o no aplica a esta reserva.');
        }
        await recalcularYActualizarTotalUI();

    } catch (err) {
        showError(feedbackEl, `Error: ${err.message}`);
    }
}

async function loadInitialData() {
    if (!ui.habitacionIdSelect || !ui.form?.elements.metodo_pago_id || !ui.tiempoEstanciaIdSelect) {
        console.error("[Reservas] Elementos de UI para carga inicial no encontrados.");
        return;
    }
    try {
        const { data: config, error: configError } = await state.supabase
            .from('configuracion_hotel')
            .select(`
                cobro_al_checkin, 
                checkin_hora_config, 
                checkout_hora_config, 
                impuestos_incluidos_en_precios, 
                porcentaje_impuesto_principal, 
                nombre_impuesto_principal,
                moneda_local_simbolo, 
                moneda_codigo_iso_info, 
                moneda_decimales_info 
            `)
            .eq('hotel_id', state.hotelId)
            .single();

        if (configError && configError.code !== 'PGRST116') throw configError;

        if (config) {
            state.configHotel.cobro_al_checkin = config.cobro_al_checkin === true;
            state.configHotel.checkin_hora_config = config.checkin_hora_config || "15:00";
            state.configHotel.checkout_hora_config = config.checkout_hora_config || "12:00";
            state.configHotel.impuestos_incluidos_en_precios = config.impuestos_incluidos_en_precios === true;
            state.configHotel.porcentaje_impuesto_principal = parseFloat(config.porcentaje_impuesto_principal) || 0;
            state.configHotel.nombre_impuesto_principal = config.nombre_impuesto_principal || null;
            state.configHotel.moneda_local_simbolo = config.moneda_local_simbolo || '$';
            state.configHotel.moneda_codigo_iso_info = config.moneda_codigo_iso_info || 'COP';
            state.configHotel.moneda_decimales_info = config.moneda_decimales_info !== null ? String(config.moneda_decimales_info) : '0';
        } else {
            console.warn(`[Reservas] No se encontró configuración para el hotel ${state.hotelId}. Usando valores predeterminados.`);
        }
        ui.togglePaymentFieldsVisibility(state.configHotel.cobro_al_checkin);

    } catch (err) {
        console.error("[Reservas] Error cargando configuración del hotel:", err);
        if (ui.feedbackDiv) showError(ui.feedbackDiv, "Error crítico: No se pudo cargar la configuración del hotel.");
        ui.togglePaymentFieldsVisibility(state.configHotel.cobro_al_checkin);
    }
    await Promise.all([cargarHabitaciones(), cargarMetodosPago(), cargarTiemposEstancia()]);
    await renderReservas();
}


async function createBooking(payload) {
    const { datosReserva, datosPago } = payload;
    let reservaParaInsertar = { ...datosReserva };
    delete reservaParaInsertar.id_temporal_o_final;
    
    // Lógica para crear un cliente nuevo si no se seleccionó uno existente
    if (!reservaParaInsertar.cliente_id) {
        const { data: nuevoCliente, error: errCliente } = await state.supabase
            .from('clientes')
            .insert({
                hotel_id: state.hotelId,
                nombre: reservaParaInsertar.cliente_nombre,
                documento: reservaParaInsertar.cedula,
                telefono: reservaParaInsertar.telefono
            })
            .select('id')
            .single();

        if (errCliente) throw new Error(`Error al crear el nuevo cliente: ${errCliente.message}`);
        reservaParaInsertar.cliente_id = nuevoCliente.id;
    }

    // Lógica para determinar el monto pagado
    if (!state.configHotel.cobro_al_checkin) {
        reservaParaInsertar.monto_pagado = 0;
    } else {
        const tipoPago = datosPago?.tipo_pago || 'parcial';
        const montoAbono = parseFloat(datosPago?.monto_abono) || 0;
        reservaParaInsertar.monto_pagado = (tipoPago === 'completo') ? state.currentBookingTotal : montoAbono;
    }

    // Insertar la reserva principal
    const { data: reservaInsertada, error: errInsert } = await state.supabase
        .from('reservas').insert(reservaParaInsertar).select().single();

    if (errInsert) throw new Error(`Error al guardar la reserva principal: ${errInsert.message}`);

    // --- INICIO DE LA LÓGICA AÑADIDA ---
    // Si la reserva se creó con un descuento, llamamos a la función de la BD para incrementar su uso.
    if (reservaInsertada.descuento_aplicado_id) {
    const { error: rpcError } = await state.supabase.rpc('incrementar_uso_descuento', {
        descuento_id_param: reservaInsertada.descuento_aplicado_id
    });
    if (rpcError) {
        console.error("Advertencia: No se pudo incrementar el uso del descuento.", rpcError);
    }
}

    // --- FIN DE LA LÓGICA AÑADIDA ---

    const nuevaReservaId = reservaInsertada.id;
    const montoPagadoAhora = reservaInsertada.monto_pagado;

    // Lógica para registrar pagos y movimientos en caja
    if (montoPagadoAhora > 0) {
        if (!datosPago.metodo_pago_id) {
            throw new Error("Se requiere un método de pago para registrar el abono o pago completo.");
        }

        const { data: pagoData, error: errPagosReserva } = await state.supabase
            .from('pagos_reserva')
            .insert({
                reserva_id: nuevaReservaId,
                monto: montoPagadoAhora,
                metodo_pago_id: datosPago.metodo_pago_id,
                fecha_pago: new Date().toISOString(),
                hotel_id: state.hotelId,
                usuario_id: state.currentUser.id,
                concepto: datosPago.tipo_pago === 'completo' ? 'Pago completo de reserva' : 'Abono inicial de reserva'
            })
            .select('id')
            .single();

        if (errPagosReserva) {
            console.error("Error crítico: La reserva se creó pero el pago no pudo ser registrado en 'pagos_reserva'.", errPagosReserva);
            showError(ui.feedbackDiv, "Advertencia: Reserva creada, pero hubo un error registrando el detalle del pago.");
        }
        
        const turnoId = await turnoService.getActiveTurnId(); // Asumiendo que esta función existe
        if (!turnoId) {
            showError(ui.feedbackDiv, "Advertencia: ¡Pago no registrado en caja! No hay un turno activo.");
        } else if (pagoData) {
            const { error: errCaja } = await state.supabase.from('caja').insert({
                hotel_id: state.hotelId,
                tipo: 'ingreso',
                monto: montoPagadoAhora,
                concepto: `Reserva ${reservaInsertada.cliente_nombre} (#${nuevaReservaId.substring(0, 8)})`,
                referencia: nuevaReservaId,
                metodo_pago_id: datosPago.metodo_pago_id,
                usuario_id: state.currentUser.id,
                turno_id: turnoId,
                reserva_id: nuevaReservaId,
                pago_reserva_id: pagoData.id
            });

            if (errCaja) {
                 console.error("Error crítico: El pago se registró en la reserva pero no en la caja.", errCaja);
                 showError(ui.feedbackDiv, "Advertencia: Reserva y pago registrados, pero hubo un error al registrar el ingreso en caja.");
            }
        }
    }
    
    // Lógica para actualizar estado de la habitación
    const ahora = new Date();
    const fechaInicioReserva = new Date(reservaInsertada.fecha_inicio);
    if ((fechaInicioReserva.getTime() - ahora.getTime()) / (1000 * 60) <= 120) {
        await state.supabase.from('habitaciones')
            .update({ estado: "reservada" })
            .eq('id', reservaInsertada.habitacion_id)
            .eq('estado', 'libre');
    }

    return reservaInsertada;
}

// js/modules/reservas/reservas.js

async function updateBooking(payload) {
    const { datosReserva } = payload;
    delete datosReserva.hotel_id;
    delete datosReserva.estado;
    delete datosReserva.usuario_id;
    delete datosReserva.id_temporal_o_final;
    delete datosReserva.monto_pagado;

    const reservaUpd = {
        ...datosReserva,
        monto_total: state.currentBookingTotal,
        actualizado_en: new Date().toISOString()
    };

    const { data: updatedReserva, error } = await state.supabase.from('reservas')
        .update(reservaUpd)
        .eq('id', state.editingReservaId)
        .select()
        .single();

    if (error) throw new Error(`Error actualizando reserva: ${error.message}`);
    
    // --- INICIO DE LA LÓGICA DE CORRECCIÓN ---
    const nuevaHabitacionId = updatedReserva.habitacion_id;
    const originalHabitacionId = state.editingOriginalHabitacionId;

    // Si la habitación original existe y es diferente a la nueva, actualizamos los estados.
    if (originalHabitacionId && nuevaHabitacionId !== originalHabitacionId) {
        console.log(`[Reservas] Se detectó cambio de habitación de ${originalHabitacionId} a ${nuevaHabitacionId}. Actualizando estados.`);

        // Liberar la habitación original
        const { error: errOldHab } = await state.supabase
            .from('habitaciones')
            .update({ estado: 'libre' })
            .eq('id', originalHabitacionId);

        if (errOldHab) console.error("Error al liberar la habitación original:", errOldHab);

        // Ocupar la nueva habitación
        const { error: errNewHab } = await state.supabase
            .from('habitaciones')
            .update({ estado: 'reservada' }) // O el estado que corresponda
            .eq('id', nuevaHabitacionId);

        if (errNewHab) console.error("Error al reservar la nueva habitación:", errNewHab);
    }
    // --- FIN DE LA LÓGICA DE CORRECCIÓN ---

    // Lógica de descuento (ya existente)
    if (updatedReserva.descuento_aplicado_id) {
       const { error: rpcError } = await state.supabase.rpc('incrementar_uso_descuento', {
           descuento_id_param: updatedReserva.descuento_aplicado_id
       });
       if (rpcError) {
           console.error("Advertencia: No se pudo incrementar el uso del descuento al actualizar la reserva.", rpcError);
       }
    }

    return updatedReserva;
}


// js/modules/reservas/reservas.js

async function prepareEditReserva(reservaId) {
    if (ui.feedbackDiv) clearFeedback(ui.feedbackDiv);
    showLoading(ui.feedbackDiv, "Cargando datos para editar...");

    const { data: r, error } = await state.supabase
        .from('reservas')
        .select(`*, habitaciones(nombre)`)
        .eq('id', reservaId)
        .single();

    clearFeedback(ui.feedbackDiv);
    if (error || !r) {
        console.error("Error cargando reserva para editar:", error);
        throw new Error(`No se pudo cargar la reserva (ID: ${reservaId.substring(0,8)}). Puede que ya no exista o haya un error de red.`);
    }

    // <-- LÍNEA AÑADIDA: Guardamos el ID de la habitación original en el estado global del módulo.
    state.editingOriginalHabitacionId = r.habitacion_id;

    ui.form.elements.cliente_nombre.value = r.cliente_nombre || '';
    ui.form.elements.cedula.value = r.cedula || '';
    ui.form.elements.telefono.value = r.telefono || '';
    ui.form.elements.cantidad_huespedes.value = r.cantidad_huespedes || 1;
    ui.form.elements.habitacion_id.value = r.habitacion_id;

    if (r.fecha_inicio) {
        const fEntrada = new Date(r.fecha_inicio);
        ui.form.elements.fecha_entrada.value = new Date(fEntrada.getTime() - (fEntrada.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    } else {
        ui.form.elements.fecha_entrada.value = '';
    }

    if (r.tiempo_estancia_id && r.tipo_duracion === 'tiempo_predefinido') {
        ui.tipoCalculoDuracionEl.value = 'tiempo_predefinido';
        ui.form.elements.tiempo_estancia_id.value = r.tiempo_estancia_id;
    } else {
        ui.tipoCalculoDuracionEl.value = 'noches_manual';
        ui.form.elements.cantidad_noches.value = r.cantidad_duracion || 1;
    }
    if (ui.tipoCalculoDuracionEl) ui.tipoCalculoDuracionEl.dispatchEvent(new Event('change'));

    ui.form.elements.tipo_pago.value = 'parcial';
    ui.form.elements.tipo_pago.disabled = true;
    ui.form.elements.metodo_pago_id.value = '';
    ui.form.elements.metodo_pago_id.disabled = true;
    document.getElementById('abono-container').style.display = 'none';
    document.getElementById('total-pago-completo').style.display = 'none';
    if(ui.form.elements.monto_abono) ui.form.elements.monto_abono.value = '';

    ui.form.elements.notas.value = r.notas || '';
    ui.formTitle.textContent = `Editar Reserva: ${r.cliente_nombre} (Hab: ${r.habitaciones?.nombre || 'N/A'})`;
    ui.submitButton.textContent = "Actualizar Reserva";
    if (ui.cancelEditButton) ui.cancelEditButton.style.display = 'inline-flex';
    if (ui.form) ui.form.scrollIntoView({ behavior: 'smooth', block: 'start' });

    state.isEditMode = true;
    state.editingReservaId = reservaId;
    await recalcularYActualizarTotalUI();
}

async function handleDeleteReserva(reservaId) {
    const { data: r, error: fetchError } = await state.supabase
        .from('reservas')
        .select('cliente_nombre, habitacion_id, estado')
        .eq('id', reservaId)
        .single();

    if (fetchError || !r) {
        throw new Error(`No se encontró la reserva a eliminar (ID: ${reservaId.substring(0,8)}).`);
    }

    const conf = await ui.showConfirmationModal(`¿Está seguro de que desea eliminar permanentemente la reserva de ${r.cliente_nombre || 'cliente desconocido'}? Esta acción no se puede deshacer y también eliminará los pagos asociados.`);
    if (!conf) return;

    showLoading(ui.feedbackDiv, "Eliminando reserva y pagos asociados...");

    const { error: errPagos } = await state.supabase.from('pagos_reserva').delete().eq('reserva_id', reservaId);
    if (errPagos) {
        clearFeedback(ui.feedbackDiv);
        throw new Error(`Error al eliminar pagos de la reserva: ${errPagos.message}. La reserva no fue eliminada.`);
    }

    const { error: deleteError } = await state.supabase.from('reservas').delete().eq('id', reservaId);
    clearFeedback(ui.feedbackDiv);
    if (deleteError) throw new Error(`Error al eliminar la reserva: ${deleteError.message}`);

    if (['activa', 'confirmada', 'reservada'].includes(r.estado) && r.habitacion_id) {
        const { error: errHab } = await state.supabase.from('habitaciones')
            .update({ estado: 'libre' })
            .eq('id', r.habitacion_id);
        if (errHab) console.warn("Advertencia al actualizar estado de habitación tras eliminar reserva:", errHab.message);
    }

    showSuccess(ui.feedbackDiv, "Reserva y sus pagos asociados eliminados exitosamente.");
    await registrarEnBitacora({
        supabase: state.supabase, hotel_id: state.hotelId, usuario_id: state.currentUser.id,
        modulo: 'Reservas', accion: 'ELIMINAR_RESERVA',
        detalles: { reserva_id: reservaId, cliente: r.cliente_nombre, habitacion_id: r.habitacion_id }
    });

    resetFormToCreateMode();
    await renderReservas();
    document.dispatchEvent(new CustomEvent('datosActualizados', { detail: { origen: 'reservas', accion: 'delete' } }));
}

async function handleUpdateEstadoReserva(reservaId, nuevoEstadoReserva, nuevoEstadoHabitacion, habitacionIdReserva, forzarDisponibleHabitacion = false) {
    if (!ui.feedbackDiv) return;
    showLoading(ui.feedbackDiv, `Actualizando estado a ${nuevoEstadoReserva}...`);

    const updatesReserva = { estado: nuevoEstadoReserva, actualizado_en: new Date().toISOString() };

if (nuevoEstadoReserva === 'activa') { // Se aplica siempre que el nuevo estado sea 'activa' (check-in)
    // 1. Obtener la reserva original para calcular su duración programada
    const { data: reservaOriginal, error: errFetchOriginal } = await state.supabase
        .from('reservas')
        .select('fecha_inicio, fecha_fin') // Necesitamos ambas para la duración
        .eq('id', reservaId)
        .single();

    if (errFetchOriginal || !reservaOriginal) {
        clearFeedback(ui.feedbackDiv);
        throw new Error('Error obteniendo datos originales de la reserva para el check-in.');
    }

    // 2. Calcular la duración original en milisegundos
    const fechaInicioOriginal = new Date(reservaOriginal.fecha_inicio);
    const fechaFinOriginal = new Date(reservaOriginal.fecha_fin);
    const duracionOriginalMs = fechaFinOriginal.getTime() - fechaInicioOriginal.getTime();

    if (duracionOriginalMs <= 0) {
        // Esto sería raro, pero por si acaso. Podrías definir una duración mínima.
        console.warn(`[Reservas] La duración original de la reserva ${reservaId} es cero o negativa. El check-out podría ser inmediato.`);
        // Si la duración es 0 o negativa, la nueva fecha_fin será igual a la nueva fecha_inicio, o podrías añadir una duración mínima por defecto.
    }

    // 3. Establecer la nueva fecha de inicio como la actual
    const nuevaFechaInicio = new Date();
    updatesReserva.fecha_inicio = nuevaFechaInicio.toISOString();

    // 4. Calcular la nueva fecha de fin sumando la duración original a la nueva fecha de inicio
    const nuevaFechaFin = new Date(nuevaFechaInicio.getTime() + duracionOriginalMs);
    updatesReserva.fecha_fin = nuevaFechaFin.toISOString();

    console.log(`[Reservas Check-in] Reserva ID: ${reservaId}`);
    console.log(`  Duración Original (ms): ${duracionOriginalMs}`);
    console.log(`  Nueva Fecha Inicio: ${updatesReserva.fecha_inicio}`);
    console.log(`  Nueva Fecha Fin: ${updatesReserva.fecha_fin}`);
}
    if (nuevoEstadoReserva === 'completada') {
        updatesReserva.fecha_fin = new Date().toISOString();
    }

    const { error: errRes } = await state.supabase.from('reservas').update(updatesReserva).eq('id', reservaId);
    clearFeedback(ui.feedbackDiv);
    if (errRes) throw new Error(`Error actualizando estado de la reserva: ${errRes.message}`);

    let msgExito = `Reserva actualizada a ${nuevoEstadoReserva}.`;
    let habActualizada = false;

    if (habitacionIdReserva && nuevoEstadoHabitacion) {
        const { error: errHab } = await state.supabase.from('habitaciones')
            .update({ estado: nuevoEstadoHabitacion })
            .eq('id', habitacionIdReserva);
        if (errHab) {
            msgExito += ` (Pero hubo un error actualizando la habitación: ${errHab.message})`;
        } else {
            habActualizada = true;
            msgExito += ` Estado de habitación actualizado a ${nuevoEstadoHabitacion}.`;
        }
    }

    showSuccess(ui.feedbackDiv, msgExito);
    await registrarEnBitacora({
        supabase: state.supabase, hotel_id: state.hotelId, usuario_id: state.currentUser.id,
        modulo: 'Reservas', accion: `CAMBIO_ESTADO_RESERVA_${nuevoEstadoReserva.toUpperCase()}`,
        detalles: { reserva_id: reservaId, nuevo_estado_reserva: nuevoEstadoReserva, habitacion_id: habitacionIdReserva, nuevo_estado_hab: nuevoEstadoHabitacion }
    });

    resetFormToCreateMode();
    await renderReservas();
    if (habActualizada) {
        document.dispatchEvent(new CustomEvent('datosActualizados', { detail: { origen: 'reservas', accion: 'updateEstado' } }));
    }
}

async function puedeHacerCheckIn(reservaId) {
    if (!state.configHotel.cobro_al_checkin) {
        return true;
    }
    const { data: r, error: errR } = await state.supabase.from('reservas')
        .select('monto_total, id')
        .eq('id', reservaId).single();
    if (errR || !r) {
        console.error("Error obteniendo reserva para verificar check-in:", errR);
        return false;
    }
    const { data: p, error: errP } = await state.supabase.from('pagos_reserva')
        .select('monto').eq('reserva_id', reservaId);
    if (errP) {
        console.error("Error obteniendo pagos para verificar check-in:", errP);
        return false;
    }
    const totalPagado = p ? p.reduce((s, i) => s + Number(i.monto), 0) : 0;
    if (!r.monto_total || r.monto_total <= 0) return true;
    return totalPagado >= r.monto_total;
}

// MODIFICADO: renderReservas para mostrar solo 'reservada', 'confirmada', 'activa'
async function renderReservas() {
     if (!state.isModuleMounted) {
        console.log("[Reservas] renderReservas abortado porque el módulo ya no está montado.");
        return; 
    }
    if (!ui.reservasListEl) {
        console.error("[Reservas] reservasListEl no encontrado en UI para renderizar.");
        return;
    }
    showLoading(ui.reservasListEl, "Cargando reservas...");

    console.log("[Reservas] Render: Hotel ID para la consulta:", state.hotelId);

    const estadosVisibles = ['reservada', 'confirmada', 'activa'];
    console.log("[Reservas] Render: Buscando reservas con estados:", estadosVisibles);

    const { data: rs, error } = await state.supabase.from('reservas')
        .select(`
            *, 
            habitaciones(nombre, tipo), 
            pagos_reserva(monto)
        `)
        .eq('hotel_id', state.hotelId)
        .in('estado', estadosVisibles)
        .order('fecha_inicio', { ascending: true })
        .limit(100);

    console.log("[Reservas] Render: Datos crudos de la consulta:", rs);
    console.log("[Reservas] Render: Error en consulta:", error);

    clearFeedback(ui.reservasListEl); // Limpia el "Cargando..."

    if (error) {
        showError(ui.reservasListEl, `Error cargando reservas: ${error.message}`);
        console.error("[Reservas] Render: Error detallado en la consulta:", error);
        return;
    }

    let htmlGeneral = '';
    if (rs && rs.length > 0) {
        console.log(`[Reservas] Render: Se encontraron ${rs.length} reservas para procesar.`);
        rs.forEach(r => {
            const abonado = r.pagos_reserva ? r.pagos_reserva.reduce((s, p) => s + Number(p.monto), 0) : 0;
            r.abonado = abonado;
            r.pendiente = Math.max((r.monto_total || 0) - abonado, 0);
        });

        const groupedVisibles = rs.reduce((acc, r) => {
            (acc[r.estado] = acc[r.estado] || []).push(r);
            return acc;
        }, {});
        
        console.log("[Reservas] Render: Reservas agrupadas:", groupedVisibles);

        htmlGeneral += `<div class="mb-10"><h2 class="text-2xl font-semibold text-gray-700 mb-4 border-b pb-2">Reservas Actuales y Próximas</h2>`;

        let foundAnyReservasInGroups = false;
        estadosVisibles.forEach(k => {
            console.log(`[Reservas] Render: Verificando grupo para estado '${k}'`);
            if (groupedVisibles[k]?.length) {
                console.log(`[Reservas] Render: Renderizando grupo '${k}' con ${groupedVisibles[k].length} reservas.`);
                htmlGeneral += renderReservasGrupo(k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '), groupedVisibles[k]);
                foundAnyReservasInGroups = true;
            } else {
                console.log(`[Reservas] Render: No hay reservas para el grupo '${k}'.`);
            }
        });
        
        if (!foundAnyReservasInGroups) {
             htmlGeneral += `<div class="info-box p-4 text-center text-gray-500">No hay reservas que coincidan con los estados visibles después de agrupar.</div>`;
             console.log("[Reservas] Render: No se encontraron reservas en los grupos después de procesar.");
        }
        htmlGeneral += `</div>`;

    } else {
        console.log("[Reservas] Render: No se encontraron reservas en la consulta inicial.");
        htmlGeneral += `<div class="mb-10"><h2 class="text-2xl font-semibold text-gray-700 mb-4 border-b pb-2">Reservas Actuales y Próximas</h2><div class="info-box p-4 text-center text-gray-500">No hay reservas activas o próximas para mostrar.</div></div>`;
    }

    console.log("[Reservas] Render: HTML General generado (primeros 500 caracteres):", htmlGeneral.substring(0,500));
    try {
        // Asegurarnos de que ui.reservasListEl sigue siendo válido y visible
        if (!ui.reservasListEl) {
            console.error("[Reservas] Render: ui.reservasListEl se volvió nulo antes de la asignación de innerHTML. Esto no debería pasar.");
            // Intentar re-seleccionarlo como último recurso, aunque esto indicaría un problema más profundo.
            ui.reservasListEl = document.getElementById('reservas-list');
            if (!ui.reservasListEl) {
                 console.error("[Reservas] Render: CRÍTICO - No se pudo re-seleccionar #reservas-list.");
                 return; // No podemos continuar
            }
        }
        
        ui.reservasListEl.style.display = 'block'; // Forzar que sea visible por si CSS lo ocultó
        ui.reservasListEl.innerHTML = htmlGeneral; 
        console.log("[Reservas] Render: HTML insertado en el DOM.");

        // VERIFICACIÓN ADICIONAL:
        if (ui.reservasListEl.childNodes.length > 0) {
            console.log("[Reservas] VERIFICATION SUCCESS: ui.reservasListEl ahora tiene nodos hijos.", ui.reservasListEl.innerHTML.substring(0, 200));
        } else if (htmlGeneral.trim() !== '') {
            console.error("[Reservas] VERIFICATION ERROR: ui.reservasListEl NO tiene nodos hijos, AUNQUE htmlGeneral NO ESTABA VACÍO. Esto es muy extraño. htmlGeneral (start):", htmlGeneral.substring(0,200));
            console.log("[Reservas] VERIFICATION: Contenido actual de ui.reservasListEl.innerHTML:", ui.reservasListEl.innerHTML);
        } else {
            console.log("[Reservas] VERIFICATION: ui.reservasListEl no tiene nodos hijos porque htmlGeneral estaba vacío (o solo espacios).");
        }

    } catch (e) {
        console.error("[Reservas] Render: Error al insertar HTML en el DOM:", e);
        if (ui.reservasListEl) { // Solo intentar si ui.reservasListEl existe
             ui.reservasListEl.innerHTML = "<p class='error-indicator'>Error crítico al mostrar la lista de reservas. Revise la consola.</p>";
        }
    }
}
function renderReservasGrupo(titulo, grupo) {
    console.log(`[ReservasGrupo] Renderizando grupo titulado: "${titulo}" con ${grupo.length} elementos.`);
    let html = `<h3 class="text-xl font-bold mt-6 mb-3 text-blue-700 border-b pb-2">${titulo} (${grupo.length})</h3>`;
    html += `<div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">`;
    grupo.forEach((r, index) => {
        console.log(`[ReservasGrupo] Procesando reserva ${index + 1}/${grupo.length} en grupo "${titulo}": ID ${r.id}`);
        const estadoActual = (r.estado || 'N/A').toUpperCase().replace(/_/g, ' ');
        const monedaSimbolo = state.configHotel?.moneda_local_simbolo || '$';
        const monedaISO = state.configHotel?.moneda_codigo_iso_info || 'COP';
        const monedaDecimales = parseInt(state.configHotel?.moneda_decimales_info || 0);

        let cardHtml = `
        <div class="p-4 bg-white rounded-lg shadow-md border-l-4 ${getBorderColorForEstado(r.estado)}">
            <div class="flex justify-between items-start mb-2">
                <h4 class="font-semibold text-lg text-gray-800">${r.cliente_nombre || 'Cliente Desconocido'}</h4>
                <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full ${getBgColorForEstado(r.estado)} ${getTextColorForEstado(r.estado)}">${estadoActual}</span>
            </div>
            <div class="text-sm space-y-1 text-gray-600">
                <p><strong>Hab:</strong> ${r.habitaciones?.nombre || 'N/A'}</p>
                <p><strong>Huésp:</strong> ${r.cantidad_huespedes || 'N/A'}</p>
                <p><strong>Llega:</strong> ${formatDateTime(r.fecha_inicio)}</p>
                <p><strong>Sale:</strong> ${formatDateTime(r.fecha_fin)}</p>
                <p><strong>Total:</strong> ${formatCurrency(r.monto_total, monedaSimbolo, monedaISO, monedaDecimales)}</p>
                ${r.abonado > 0 ? `<p style="color:#059669"><strong>Abonado:</strong> ${formatCurrency(r.abonado, monedaSimbolo, monedaISO, monedaDecimales)}</p>` : ''}
                ${r.pendiente > 0 ? `<p style="color:#b91c1c"><strong>Pendiente:</strong> ${formatCurrency(r.pendiente, monedaSimbolo, monedaISO, monedaDecimales)}</p>` : ''}
                ${r.notas ? `<p class="mt-1"><strong>Notas:</strong> <span class="italic">${r.notas}</span></p>` : ''}
            </div>
            <div class="mt-4 pt-3 border-t flex flex-wrap gap-2">
                ${getAccionesReservaHTML(r)}
            </div>
        </div>`;
        html += cardHtml;
    });
    html += `</div>`;
    console.log(`[ReservasGrupo] HTML generado para grupo "${titulo}" (primeros 300 chars): ${html.substring(0,300)}`);
    return html;
}

async function mostrarModalAbonoReserva(reservaActual) {
    const { data: mP, error: errMP } = await state.supabase.from('metodos_pago')
        .select('id, nombre').eq('hotel_id', state.hotelId).eq('activo', true).order('nombre');

    if (errMP || !mP?.length) {
        Swal.fire('Error', 'No hay métodos de pago activos configurados en el sistema.', 'error');
        return;
    }
    const selOpts = mP.map(mp => `<option value="${mp.id}">${mp.nombre}</option>`).join('');

    const { data: pExist, error: errPExist } = await state.supabase.from('pagos_reserva')
        .select('monto').eq('reserva_id', reservaActual.id);

    if (errPExist) {
        Swal.fire('Error', 'No se pudieron cargar los pagos existentes para esta reserva.', 'error');
        return;
    }

    const totAbonado = pExist ? pExist.reduce((s, p) => s + Number(p.monto), 0) : 0;
    const mPend = Math.max(0, (reservaActual.monto_total || 0) - totAbonado);

    if (mPend === 0 && reservaActual.monto_total > 0) {
        Swal.fire('Información', 'Esta reserva ya ha sido pagada en su totalidad.', 'info');
        return;
    }

    const { value: fVal, isConfirmed } = await Swal.fire({
        title: `Registrar Abono para ${reservaActual.cliente_nombre}`,
        html: `
            <p class="mb-2 text-sm">Reserva ID: <span class="font-mono">${reservaActual.id.substring(0,8)}</span></p>
            <p class="mb-2 text-sm">Total Reserva: <strong class="text-blue-600">${formatCurrency(reservaActual.monto_total, state.configHotel?.moneda_local_simbolo || '$', state.configHotel?.moneda_codigo_iso_info || 'COP', parseInt(state.configHotel?.moneda_decimales_info || 0))}</strong></p>
            <p class="mb-2 text-sm">Total Abonado: <strong class="text-green-600">${formatCurrency(totAbonado, state.configHotel?.moneda_local_simbolo || '$', state.configHotel?.moneda_codigo_iso_info || 'COP', parseInt(state.configHotel?.moneda_decimales_info || 0))}</strong></p>
            <p class="mb-4 text-lg">Pendiente: <strong class="text-red-600">${formatCurrency(mPend, state.configHotel?.moneda_local_simbolo || '$', state.configHotel?.moneda_codigo_iso_info || 'COP', parseInt(state.configHotel?.moneda_decimales_info || 0))}</strong></p>
            <input id="swal-abono-monto" class="swal2-input" type="number" min="1" ${mPend > 0 ? `max="${mPend}"` : ''} placeholder="Valor a abonar (máx. ${formatCurrency(mPend, state.configHotel?.moneda_local_simbolo || '$', state.configHotel?.moneda_codigo_iso_info || 'COP', parseInt(state.configHotel?.moneda_decimales_info || 0))})" value="${mPend > 0 ? mPend : ''}">
            <select id="swal-metodo-pago" class="swal2-input">
                <option value="">Seleccione método de pago...</option>
                ${selOpts}
            </select>`,
        focusConfirm: false,
        preConfirm: () => {
            const m = parseFloat(document.getElementById('swal-abono-monto').value) || 0;
            const met = document.getElementById('swal-metodo-pago').value;
            if (m <= 0) { Swal.showValidationMessage('El monto del abono debe ser mayor a cero.'); return false; }
            if (mPend > 0 && m > mPend) { Swal.showValidationMessage(`El monto no puede exceder el pendiente de ${formatCurrency(mPend, state.configHotel?.moneda_local_simbolo || '$', state.configHotel?.moneda_codigo_iso_info || 'COP', parseInt(state.configHotel?.moneda_decimales_info || 0))}.`); return false; }
            if (!met) { Swal.showValidationMessage('Debe seleccionar un método de pago.'); return false; }
            return { monto: m, metodo: met };
        },
        confirmButtonText: 'Registrar Abono',
        showCancelButton: true,
        cancelButtonText: 'Cancelar'
    });

    if (!isConfirmed || !fVal) return;

    const { data: nuevoPago, error: errAbono } = await state.supabase.from('pagos_reserva').insert({
        reserva_id: reservaActual.id,
        monto: fVal.monto,
        metodo_pago_id: fVal.metodo,
        fecha_pago: new Date().toISOString(),
        hotel_id: state.hotelId,
        usuario_id: state.currentUser.id
    }).select().single();

    if (errAbono) {
        Swal.fire('Error', `No se pudo registrar el abono en la reserva: ${errAbono.message}`, 'error');
        return;
    }
    
    const nuevoTotalAbonado = totAbonado + fVal.monto;
    const { error: errUpdateReserva } = await state.supabase
        .from('reservas')
        .update({ monto_pagado: nuevoTotalAbonado, actualizado_en: new Date().toISOString() })
        .eq('id', reservaActual.id);

    if (errUpdateReserva) {
        Swal.fire('Advertencia', `Abono registrado, pero hubo un error actualizando el total pagado de la reserva: ${errUpdateReserva.message}`, 'warning');
    }

    const turnoId = turnoService.getActiveTurnId();
    let movCajaOK = false;
    if (!turnoId) {
        Swal.fire('Advertencia', 'Abono registrado en la reserva, pero NO se registró en caja (No hay turno activo). Registre el ingreso manualmente en caja.', 'warning');
    } else {
        const movCaja = {
            hotel_id: state.hotelId, tipo: 'ingreso', monto: fVal.monto,
            concepto: `Abono Reserva ${reservaActual.cliente_nombre} (#${reservaActual.id.substring(0, 8)})`,
            referencia: reservaActual.id,
            metodo_pago_id: fVal.metodo,
            usuario_id: state.currentUser.id,
            turno_id: turnoId,
            reserva_id: reservaActual.id,
            pago_reserva_id: nuevoPago.id
        };
        const { error: errCaja } = await state.supabase.from('caja').insert(movCaja);
        if (errCaja) {
            Swal.fire('Advertencia', `Abono registrado en reserva, pero hubo un error al registrar el movimiento en caja: ${errCaja.message}`, 'warning');
        } else {
            movCajaOK = true;
        }
    }

    if (movCajaOK) {
        Swal.fire('¡Éxito!', 'Abono registrado exitosamente en la reserva y en la caja.', 'success');
    }

    await registrarEnBitacora({
        supabase: state.supabase, hotel_id: state.hotelId, usuario_id: state.currentUser.id,
        modulo: 'Reservas', accion: 'REGISTRAR_ABONO',
        detalles: { reserva_id: reservaActual.id, monto_abonado: fVal.monto, metodo_pago_id: fVal.metodo }
    });

    await renderReservas();
    document.dispatchEvent(new CustomEvent('datosActualizados', { detail: { origen: 'reservas', accion: 'abono' } }));
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

    switch (estado) {
        case 'reservada':
            actions += `<button class="${baseClass} bg-cyan-500 hover:bg-cyan-600 text-white" data-action="confirmar" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">Confirmar</button>`;
            actions += `<button class="${baseClass} bg-red-500 hover:bg-red-600 text-white" data-action="cancelar_reserva" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">Cancelar Reserva</button>`;
            const fInicioRes = new Date(reserva.fecha_inicio);
            const ahoraRes = new Date();
            const inicioVentanaCheckinRes = new Date(fInicioRes.getTime() - 24 * 60 * 60 * 1000); 
            const finVentanaCheckinRes = new Date(fInicioRes.getFullYear(), fInicioRes.getMonth(), fInicioRes.getDate(), 23, 59, 59);
            if (ahoraRes >= inicioVentanaCheckinRes && ahoraRes <= finVentanaCheckinRes) {
                 actions += `<button class="${baseClass} bg-blue-500 hover:bg-blue-600 text-white" data-action="checkin" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">Check-in</button>`;
            }
            break;
        case 'confirmada':
            const fInicioConf = new Date(reserva.fecha_inicio);
            const ahoraConf = new Date();
            const inicioVentanaCheckinConf = new Date(fInicioConf.getTime() - 24 * 60 * 60 * 1000);
            const finVentanaCheckinConf = new Date(fInicioConf.getFullYear(), fInicioConf.getMonth(), fInicioConf.getDate(), 23, 59, 59);
            if (ahoraConf >= inicioVentanaCheckinConf && ahoraConf <= finVentanaCheckinConf) {
                actions += `<button class="${baseClass} bg-blue-500 hover:bg-blue-600 text-white" data-action="checkin" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">Check-in</button>`;
            }
            actions += `<button class="${baseClass} bg-red-500 hover:bg-red-600 text-white" data-action="cancelar_reserva" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">Cancelar Reserva</button>`;
            actions += `<button class="${baseClass} bg-purple-500 hover:bg-purple-600 text-white" data-action="no_show" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">No Show</button>`;
            break;
        case 'activa':
            actions += `<button class="${baseClass} bg-teal-500 hover:bg-teal-600 text-white" data-action="checkout" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">Check-out</button>`;
            break;
    }
     if (['reservada', 'confirmada'].includes(estado)) {
        actions += `<button class="${baseClass} bg-black hover:bg-gray-800 text-white" data-action="eliminar" data-id="${reserva.id}">Eliminar</button>`;
     }
    return actions;
}

function configureFechaEntrada(fechaEntradaInput) {
    if (!fechaEntradaInput) return;
    const now = new Date();
    const minDate = new Date(now.getTime() - 15 * 60 * 1000);
    const year = minDate.getFullYear();
    const month = (minDate.getMonth() + 1).toString().padStart(2, '0');
    const day = minDate.getDate().toString().padStart(2, '0');
    const hours = minDate.getHours().toString().padStart(2, '0');
    const minutes = minDate.getMinutes().toString().padStart(2, '0');
    fechaEntradaInput.min = `${year}-${month}-${day}T${hours}:${minutes}`;
}


function resetFormToCreateMode() {
    if (ui.form) {
        ui.form.reset();
        if (ui.tipoCalculoDuracionEl) {
            ui.tipoCalculoDuracionEl.value = 'noches_manual';
            ui.tipoCalculoDuracionEl.dispatchEvent(new Event('change'));
        }
        if (ui.fechaEntradaInput) configureFechaEntrada(ui.fechaEntradaInput);

        const esCobroAlCheckin = state.configHotel.cobro_al_checkin;
        ui.togglePaymentFieldsVisibility(esCobroAlCheckin);

        if (esCobroAlCheckin) {
            if (ui.form.elements.tipo_pago) {
                ui.form.elements.tipo_pago.disabled = false;
                ui.form.elements.tipo_pago.value = 'parcial';
                ui.form.elements.tipo_pago.dispatchEvent(new Event('change'));
            }
            if (ui.form.elements.metodo_pago_id) ui.form.elements.metodo_pago_id.disabled = false;
            if (ui.form.elements.monto_abono) ui.form.elements.monto_abono.value = '';
        }
    }
    if (ui.formTitle) ui.formTitle.textContent = "Registrar Nueva Reserva";
    if (ui.submitButton) ui.submitButton.textContent = "Registrar Reserva";
    if (ui.cancelEditButton) ui.cancelEditButton.style.display = 'none';

    state.isEditMode = false;
    state.editingReservaId = null;
    state.editingOriginalHabitacionId = null; // <-- LÍNEA AÑADIDA: Limpia el ID de la habitación original.
    state.currentBookingTotal = 0;
    state.descuentoAplicado = null;

    // Limpiar UI de descuento
    const codigoInput = document.getElementById('codigo-descuento-reserva');
    if (codigoInput) codigoInput.value = '';
    const feedbackEl = document.getElementById('feedback-descuento-reserva');
    if (feedbackEl) clearFeedback(feedbackEl);
    const resumenEl = document.getElementById('descuento-resumen-reserva');
    if (resumenEl) resumenEl.style.display = 'none';

    ui.updateTotalDisplay();
    actualizarVisibilidadPago();
}

function getBorderColorForEstado(e) {
    const c = {
        'reservada': 'border-yellow-400', 'confirmada': 'border-green-500',
        'activa': 'border-blue-500', 'cancelada': 'border-red-500',
        'no_show': 'border-purple-500', 'completada': 'border-gray-400',
        'cancelada_mantenimiento': 'border-orange-500', 'finalizada_auto': 'border-slate-400'
    }; return c[e] || 'border-gray-300';
}
function getBgColorForEstado(e) {
    const c = {
        'reservada': 'bg-yellow-100', 'confirmada': 'bg-green-100',
        'activa': 'bg-blue-100', 'cancelada': 'bg-red-100',
        'no_show': 'bg-purple-100', 'completada': 'bg-gray-100',
        'cancelada_mantenimiento': 'bg-orange-100', 'finalizada_auto': 'bg-slate-100'
    }; return c[e] || 'bg-gray-200';
}
function getTextColorForEstado(e) {
    const c = {
        'reservada': 'text-yellow-800', 'confirmada': 'text-green-800',
        'activa': 'text-blue-800', 'cancelada': 'text-red-800',
        'no_show': 'text-purple-800', 'completada': 'text-gray-700',
        'cancelada_mantenimiento': 'text-orange-800', 'finalizada_auto': 'text-slate-700'
    }; return c[e] || 'text-gray-700';
}

async function handleExternalUpdate(event) {
    // Opcional: verificar event.detail.origen si necesitas lógica diferente
    console.log("[Reservas] Evento 'datosActualizados' recibido. Refrescando lista de reservas.", event.detail);
    await renderReservas();
}

// En tu archivo reservas.js, reemplaza esta función completa:

async function handleFormSubmit(event) {
    event.preventDefault();
    if (!ui.form || !ui.feedbackDiv || !ui.submitButton) return;

    const originalButtonText = ui.submitButton.textContent;
    setFormLoadingState(ui.form, true, ui.submitButton, originalButtonText, state.isEditMode ? "Actualizando..." : "Registrando...");
    clearFeedback(ui.feedbackDiv);

    try {
        const formData = gatherFormData();

        // --- INICIO DE LA VALIDACIÓN DE TURNO ACTIVO ---
        // Antes de hacer cualquier otra cosa, verificamos si se requiere un pago
        // y si hay un turno para registrarlo.

        // Determinamos si se está intentando hacer un pago.
        const seIntentaPagar = (formData.tipo_pago === 'completo' && state.currentBookingTotal > 0) ||
                               (formData.tipo_pago === 'parcial' && parseFloat(formData.monto_abono) > 0);

        // Si la política es cobrar al check-in y se está intentando pagar...
        if (state.configHotel.cobro_al_checkin && seIntentaPagar) {
            const turnoId = turnoService.getActiveTurnId();
            if (!turnoId) {
                // Si no hay turno, bloqueamos la acción y mostramos un error claro.
                throw new Error("ACCIÓN BLOQUEADA: No se puede registrar la reserva porque no hay un turno de caja activo para procesar el pago.");
            }
        }
        // --- FIN DE LA VALIDACIÓN DE TURNO ACTIVO ---

        // Si la validación de turno pasó, continuamos con el resto del proceso.
        validateInitialInputs(formData);
        const bookingPayload = await validateAndCalculateBooking(formData);

        if (state.isEditMode) {
            await updateBooking(bookingPayload);
            showSuccess(ui.feedbackDiv, "Reserva actualizada exitosamente.");
            await registrarEnBitacora({ supabase: state.supabase, hotel_id: state.hotelId, usuario_id: state.currentUser.id, modulo: 'Reservas', accion: 'ACTUALIZAR_RESERVA', detalles: { reserva_id: state.editingReservaId, cliente: bookingPayload.datosReserva.cliente_nombre } });
        } else {
            const reservaCreada = await createBooking(bookingPayload);
            showSuccess(ui.feedbackDiv, "Reserva creada exitosamente.");
            await registrarEnBitacora({ supabase: state.supabase, hotel_id: state.hotelId, usuario_id: state.currentUser.id, modulo: 'Reservas', accion: 'CREAR_RESERVA', detalles: { reserva_id: reservaCreada.id, cliente: reservaCreada.cliente_nombre, habitacion_id: reservaCreada.habitacion_id } });
        }

        resetFormToCreateMode();
        await renderReservas();
        document.dispatchEvent(new CustomEvent('datosActualizados', { detail: { origen: 'reservas', accion: state.isEditMode ? 'update' : 'create' } }));

    } catch (err) {
        console.error("Error en submit de reserva:", err);
        showError(ui.feedbackDiv, err.message);
    } finally {
        setFormLoadingState(ui.form, false, ui.submitButton, originalButtonText);
    }
}

async function handleListActions(event) {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;

    const action = btn.getAttribute('data-action');
    const reservaId = btn.getAttribute('data-id');
    const habitacionId = btn.getAttribute('data-habitacion-id') || null;

    btn.disabled = true;
    const originalButtonText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-tiny"></span>`;

    try {
        switch (action) {
            case 'editar':
                await prepareEditReserva(reservaId);
                break;
            case 'cancelar_reserva':
                const confirmCancel = await ui.showConfirmationModal("¿Está seguro de que desea cancelar esta reserva? La habitación asociada se marcará como libre.");
                if (confirmCancel) {
                    await handleUpdateEstadoReserva(reservaId, 'cancelada', 'libre', habitacionId, true);
                }
                break;
            case 'confirmar':
            // CORRECCIÓN: Solo se actualiza el estado de la RESERVA a 'confirmada'.
            // El estado de la HABITACIÓN no se toca (se pasa 'null'),
            // permitiendo que siga 'libre' hasta que sea inminente.
            await handleUpdateEstadoReserva(reservaId, 'confirmada', null, habitacionId);
            break;
            case 'checkin':
                const puedeCheckin = await puedeHacerCheckIn(reservaId);
                if (!puedeCheckin && state.configHotel.cobro_al_checkin) {
                     showError(ui.feedbackDiv, "Debe registrar el pago completo de la reserva para poder hacer Check-in.");
                    Swal.fire({
                        title: 'Pago Pendiente',
                        html: `La política del hotel requiere el pago completo (${formatCurrency(state.currentBookingTotal, state.configHotel?.moneda_local_simbolo || '$')}) antes del Check-in. <br/>Por favor, registre el pago restante utilizando el botón "Abonar".`,
                        icon: 'warning',
                        confirmButtonText: 'Entendido'
                    });
                    return;
                }
                const confirmCheckin = await ui.showConfirmationModal("¿Confirmar Check-in para esta reserva? La habitación se marcará como ocupada.");
                if (confirmCheckin) {
                    await handleUpdateEstadoReserva(reservaId, 'activa', 'ocupada', habitacionId);
                }
                break;
            case 'checkout':
                 const { data: reservaCheckout, error: errCheckout } = await state.supabase
                    .from('reservas')
                    .select('monto_total, monto_pagado')
                    .eq('id', reservaId)
                    .single();
                if (errCheckout || !reservaCheckout) {
                    showError(ui.feedbackDiv, "Error al obtener detalles de la reserva para el checkout.");
                    return;
                }
                const pendienteCheckout = (reservaCheckout.monto_total || 0) - (reservaCheckout.monto_pagado || 0);
                if (pendienteCheckout > 0) {
                     Swal.fire({
                        title: 'Pago Pendiente en Checkout',
                        html: `Esta reserva tiene un saldo pendiente de <strong>${formatCurrency(pendienteCheckout, state.configHotel?.moneda_local_simbolo || '$')}</strong>.<br/>Debe saldar la cuenta antes de completar el Check-out. Use el botón "Abonar".`,
                        icon: 'error',
                        confirmButtonText: 'Entendido'
                    });
                    return;
                }
                const confirmCheckout = await ui.showConfirmationModal("¿Confirmar Check-out para esta reserva? La reserva se marcará como completada y la habitación como 'limpieza'.");
                if (confirmCheckout) {
                    await handleUpdateEstadoReserva(reservaId, 'completada', 'limpieza', habitacionId);
                }
                break;
            case 'abonar':
                const { data: reservaActual, error: errRA } = await state.supabase
                    .from('reservas')
                    .select('*')
                    .eq('id', reservaId)
                    .single();
                if (errRA || !reservaActual) throw new Error("Reserva no encontrada para abonar.");
                await mostrarModalAbonoReserva(reservaActual);
                break;
            case 'no_show':
                 const confirmNoShow = await ui.showConfirmationModal("¿Marcar esta reserva como 'No Show'? La habitación se marcará como libre.");
                if (confirmNoShow) {
                    await handleUpdateEstadoReserva(reservaId, 'no_show', 'libre', habitacionId, true);
                }
                break;
            case 'eliminar':
                await handleDeleteReserva(reservaId);
                break;
            case 'ver_detalles':
                 ui.showInfoModal(`Funcionalidad "Ver Detalles" para reserva ${reservaId.substring(0,8)} aún no implementada.`, "En Desarrollo");
                break;
            default:
                console.warn("Acción no reconocida en lista de reservas:", action);
        }
    } catch (err) {
        console.error(`Error en acción '${action}' para reserva ${reservaId}:`, err);
        if (ui.feedbackDiv) showError(ui.feedbackDiv, err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalButtonText;
    }
}

function actualizarVisibilidadPago() {
    // Referencias a los elementos que vamos a manipular
    const tipoPagoSelect = ui.form.elements.tipo_pago;
    const abonoContainer = ui.container.querySelector('#abono-container');
    const totalPagoCompletoContainer = ui.container.querySelector('#total-pago-completo');
    const metodoPagoSelect = ui.form.elements.metodo_pago_id;
    const montoAbonoInput = ui.form.elements.monto_abono;

    // Salir si algún elemento no se encuentra, para evitar errores
    if (!tipoPagoSelect || !abonoContainer || !totalPagoCompletoContainer || !metodoPagoSelect || !montoAbonoInput) {
        console.error("No se encontraron todos los elementos del formulario de pago.");
        return;
    }

    // Lógica principal
    if (tipoPagoSelect.value === 'completo') {
        // Si es PAGO COMPLETO:
        abonoContainer.style.display = 'none'; // Ocultar campo de abono
        totalPagoCompletoContainer.style.display = 'block'; // Mostrar el total a pagar
        montoAbonoInput.required = false; // El abono ya no es requerido
        montoAbonoInput.value = ''; // Limpiar el valor del abono
        
        // El método de pago es requerido solo si hay un total mayor a cero
        metodoPagoSelect.required = state.currentBookingTotal > 0;

    } else {
        // Si es PAGO PARCIAL:
        abonoContainer.style.display = 'block'; // Mostrar campo de abono
        totalPagoCompletoContainer.style.display = 'none'; // Ocultar el total a pagar
        
        // El método de pago es requerido solo si se ingresa un abono mayor a cero
        const abonoActual = parseFloat(montoAbonoInput.value) || 0;
        metodoPagoSelect.required = abonoActual > 0;
    }
}
// En tu archivo reservas.js, reemplaza tu función mount por esta versión definitiva

// En tu archivo reservas.js, reemplaza TODA la función mount con esta versión:

// En tu archivo reservas.js, REEMPLAZA TODA la función mount con esta versión final:

export async function mount(container, supabaseClient, user, hotelId) {
    // --- 1. CONFIGURACIÓN INICIAL DEL ESTADO ---
    state.isModuleMounted = true;
    state.supabase = supabaseClient;
    state.currentUser = user;
    state.hotelId = hotelId;
    

    if (!user || !user.id) {
        container.innerHTML = `<p class="error-box">Usuario no autenticado. Acceso denegado.</p>`;
        return;
    }
    if (!hotelId) {
        container.innerHTML = `<p class="error-box">ID del hotel no disponible. Módulo de reservas no puede operar.</p>`;
        return;
    }
    await turnoService.getTurnoAbierto(supabaseClient, user.id, hotelId);

    console.log("[Reservas Mount] Iniciando montaje...");

    // --- 2. RENDERIZAR LA ESTRUCTURA HTML PRINCIPAL (CORREGIDA SIN DUPLICADOS) ---
    // REEMPLAZA el contenido de container.innerHTML en tu función mount CON ESTE BLOQUE COMPLETO

container.innerHTML = `
    <div class="max-w-7xl mx-auto mt-10 px-4">
        <h2 id="form-title" class="text-3xl font-extrabold text-blue-800 mb-8 text-center drop-shadow-md">Registrar Nueva Reserva</h2>

        <form id="reserva-form" class="space-y-8 bg-white rounded-2xl p-8 border border-blue-100 shadow-xl">

            <fieldset class="border border-slate-200 p-6 rounded-xl">
                <legend class="text-lg font-bold text-slate-700 px-2">1. Datos del Cliente</legend>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                    <div class="md:col-span-2">
                        <label for="cliente_search_input" class="font-semibold text-sm text-gray-700 block mb-1">Buscar Cliente Existente</label>
                        <div class="flex items-center gap-2">
                            <input name="cliente_search_input" id="cliente_search_input" class="form-control flex-grow" placeholder="Click en 'Buscar' para abrir el selector" readonly/>
                            <button type="button" id="btn_buscar_cliente" class="button button-info">Buscar</button>
                            <button type="button" id="btn_crear_cliente" class="button button-success p-2 rounded-full" title="Crear Nuevo Cliente">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" /></svg>
                            </button>
                        </div>
                        <input type="hidden" name="cliente_id_hidden" id="cliente_id_hidden" />
                        <div id="cliente_nombre_display" class="mt-3 hidden rounded-md bg-blue-50 border border-blue-300 text-blue-800 px-4 py-2 shadow-sm flex justify-between items-center">
                            <div><strong class="mr-2">Cliente:</strong> <span id="selected_client_name"></span></div>
                            <button type="button" id="btn_clear_cliente" class="text-red-500 font-bold text-lg leading-none" title="Deseleccionar cliente">&times;</button>
                        </div>
                    </div>
                    <div id="new-client-fields" class="md:col-span-2">
                        <p class="text-sm text-gray-500 mb-2">O ingrese los datos para un cliente nuevo:</p>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                                <label for="cliente_nombre" class="font-semibold text-sm text-gray-700">Nombre completo*</label>
                                <input name="cliente_nombre" id="cliente_nombre" class="form-control" required maxlength="120" />
                            </div>
                            <div>
                                <label for="cedula" class="font-semibold text-sm text-gray-700">Cédula/ID</label>
                                <input name="cedula" id="cedula" class="form-control" maxlength="30" />
                            </div>
                            <div>
                                <label for="telefono" class="font-semibold text-sm text-gray-700">Teléfono</label>
                                <input name="telefono" id="telefono" type="tel" class="form-control" maxlength="30" />
                            </div>
                        </div>
                    </div>
                </div>
            </fieldset>

           <fieldset class="border border-slate-200 p-6 rounded-xl">
    <legend class="text-lg font-bold text-slate-700 px-2">2. Detalles de la Reserva</legend>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
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

        <div class="lg:col-span-3 md:col-span-2 pt-3 mt-3 border-t border-slate-200">
            <label class="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" id="precio_libre_toggle" name="precio_libre_toggle" class="form-checkbox h-5 w-5 text-indigo-600">
                <span class="font-semibold text-indigo-700">Asignar Precio Manual (Libre)</span>
            </label>
            <div id="precio_libre_container" class="mt-2" style="display:none;">
                <label for="precio_libre_valor" class="font-semibold text-sm text-gray-700">Valor Total de la Estancia (sin impuestos)</label>
                <input type="number" id="precio_libre_valor" name="precio_libre_valor" class="form-control mt-1 text-lg font-bold" placeholder="Ingrese el valor total">
            </div>
        </div>
        </div>
</fieldset>
            
            <fieldset class="border border-slate-200 p-6 rounded-xl">
                <legend class="text-lg font-bold text-slate-700 px-2">Descuento</legend>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 items-center">
                    <div>
                        <label for="codigo-descuento-reserva" class="font-semibold text-sm text-gray-700">Código de Descuento (opcional)</label>
                        <div class="flex items-center gap-2 mt-1">
                            <input type="text" id="codigo-descuento-reserva" class="form-control flex-grow" placeholder="PROMO2025">
                            <button type="button" id="btn-aplicar-descuento-reserva" class="button button-info">Aplicar</button>
                        </div>
                        <div id="feedback-descuento-reserva" class="text-xs mt-1 h-4"></div>
                    </div>
                    <div id="descuento-resumen-reserva" class="text-sm text-green-600 bg-green-50 p-3 rounded-md border border-green-200" style="display: none;">
                        </div>
                </div>
            </fieldset>
            <div class="p-4 bg-blue-50 border border-blue-200 rounded-xl text-center">
                <p class="text-sm text-blue-700">Total Estimado de la Reserva:</p>
                <p id="total-reserva-calculado-display" class="text-3xl font-extrabold text-blue-600">$0</p>
            </div>

            <div id="payment-message-checkout" class="p-3 bg-orange-50 border border-orange-200 rounded-md text-center text-orange-700 text-sm hidden">
                La política del hotel es <strong class="font-semibold">Cobro al Check-out</strong>. Los detalles del pago se gestionarán al finalizar la estancia.
            </div>

            <fieldset id="fieldset-pago-adicionales" class="border border-slate-200 p-6 rounded-xl">
                 <legend class="text-lg font-bold text-slate-700 px-2">3. Pago y Adicionales</legend>
                 <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
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
                     <div id="total-pago-completo" class="md:col-span-2 hidden">
                         <div class="text-center py-4">
                             <span class="text-2xl font-bold text-green-600">Total a pagar: <span id="valor-total-pago">$0</span></span>
                         </div>
                     </div>
                 </div>
            </fieldset>

            <fieldset class="border border-slate-200 p-6 rounded-xl">
                <legend class="text-lg font-bold text-slate-700 px-2">4. Notas</legend>
                <div>
                    <label for="notas" class="font-semibold text-sm text-gray-700">Notas Adicionales (visibles para el staff)</label>
                    <textarea name="notas" id="notas" class="form-control mt-2" maxlength="500" rows="2" placeholder="Ej: Solicitud especial del cliente, llegada tardía..."></textarea>
                </div>
            </fieldset>

            <div class="flex flex-col sm:flex-row gap-4 pt-4 justify-center">
                <button type="submit" id="submit-button" class="button button-success py-3 px-6 rounded-xl text-lg">Registrar Reserva</button>
                <button type="button" id="cancel-edit-button" class="button button-neutral py-3 px-6 rounded-xl hidden">Cancelar Edición</button>
            </div>
        </form>

        <div id="reserva-feedback" class="mt-6"></div>
        <div id="reservas-list" class="mt-10"></div>
    </div>
    
    <div id="modal-container-secondary" class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" style="display:none;"></div>
`;

    // --- 3. INICIALIZAR REFERENCIAS A LA UI ---
    ui.init(container);

    // --- 4. LÓGICA Y LISTENERS DE EVENTOS ---
    
// DENTRO DE LA FUNCIÓN mount, REEMPLAZA la función interna updateClienteFields
// EN: js/modules/reservas/reservas.js

const updateClienteFields = (cliente) => {
    const newClientFieldsContainer = ui.container.querySelector('#new-client-fields');
    if (cliente) {
        // Rellena los campos con el cliente seleccionado
        ui.clienteIdHiddenInput.value = cliente.id;
        ui.clienteNombreDisplay.querySelector('#selected_client_name').textContent = cliente.nombre;
        ui.form.elements.cliente_nombre.value = cliente.nombre; // Llenar también el input manual
        ui.form.elements.cedula.value = cliente.documento || '';
        ui.form.elements.telefono.value = cliente.telefono || '';
        // Muestra el panel del cliente seleccionado y oculta los campos de nuevo cliente
        ui.clienteNombreDisplay.classList.remove('hidden');
        if(newClientFieldsContainer) newClientFieldsContainer.style.display = 'none';
        ui.form.elements.cliente_nombre.required = false; // El nombre ya no es requerido
    } else {
        // Limpia todos los campos si no hay cliente seleccionado
        ui.clienteIdHiddenInput.value = '';
        ['cliente_nombre', 'cedula', 'telefono'].forEach(name => {
            if (ui.form.elements[name]) ui.form.elements[name].value = '';
        });
        // Oculta el panel y vuelve a mostrar los campos para un nuevo cliente
        ui.clienteNombreDisplay.classList.add('hidden');
        if(newClientFieldsContainer) newClientFieldsContainer.style.display = 'block';
        ui.form.elements.cliente_nombre.required = true;
    }
};
    
    if (ui.btnBuscarCliente) {
    ui.btnBuscarCliente.onclick = () => {
        showClienteSelectorModal(state.supabase, state.hotelId, {
            onSelect: async (cliente) => {
                updateClienteFields(cliente);
                clearFeedback(ui.feedbackDiv);
                // 👉 Aquí llamas a recalcular con el nuevo cliente seleccionado
                await recalcularYActualizarTotalUI();
            }
        });
    };
}


    const btnCrearCliente = container.querySelector('#btn_crear_cliente');
    if (btnCrearCliente) {
        btnCrearCliente.onclick = () => {
            mostrarFormularioCliente(null, state.supabase, state.hotelId, { 
                afterSave: (nuevoCliente) => {
                    updateClienteFields(nuevoCliente);
                    showSuccess(ui.feedbackDiv, `Cliente "${nuevoCliente.nombre}" creado y seleccionado.`);
                    setTimeout(() => clearFeedback(ui.feedbackDiv), 2500);
                }
            });
        };
    }
    
    container.querySelector('#btn_clear_cliente')?.addEventListener('click', () => updateClienteFields(null));
    
    // Listeners que afectan el cálculo del total y la UI


const setupEventListeners = () => {
    // Referencias a los elementos de la UI
    const togglePrecioLibre = ui.container.querySelector('#precio_libre_toggle');
    const containerPrecioLibre = ui.container.querySelector('#precio_libre_container');

    // Listener para mostrar/ocultar el campo de precio libre
    if (togglePrecioLibre && containerPrecioLibre) {
        togglePrecioLibre.addEventListener('change', () => {
            containerPrecioLibre.style.display = togglePrecioLibre.checked ? 'block' : 'none';
        });
    }

    // Lista de todos los inputs que deben disparar un recálculo del total
    const inputsToRecalculate = [
        ui.habitacionIdSelect,
        ui.cantidadNochesInput,
        ui.tiempoEstanciaIdSelect,
        ui.form.elements.cantidad_huespedes,
        ui.fechaEntradaInput,
        togglePrecioLibre, // La casilla de precio libre
        ui.container.querySelector('#precio_libre_valor') // El input del valor de precio libre
    ];

    inputsToRecalculate.forEach(el => {
        if (el) {
            const eventType = (el.tagName === 'SELECT' || el.type === 'checkbox') ? 'change' : 'input';
            el.addEventListener(eventType, () => recalcularYActualizarTotalUI());
        }
    });
    
    // Listeners existentes que se mantienen
    const btnAplicarDescuento = ui.container.querySelector('#btn-aplicar-descuento-reserva');
    if (btnAplicarDescuento) {
        btnAplicarDescuento.addEventListener('click', handleAplicarDescuentoReserva);
    }

    if (ui.tipoCalculoDuracionEl) {
        ui.tipoCalculoDuracionEl.addEventListener('change', () => {
            const esNochesManual = ui.tipoCalculoDuracionEl.value === 'noches_manual';
            if(ui.nochesManualContainer) ui.nochesManualContainer.style.display = esNochesManual ? '' : 'none';
            if(ui.cantidadNochesInput) ui.cantidadNochesInput.required = esNochesManual;
            if(ui.tiempoPredefinidoContainer) ui.tiempoPredefinidoContainer.style.display = esNochesManual ? 'none' : '';
            if(ui.tiempoEstanciaIdSelect) ui.tiempoEstanciaIdSelect.required = !esNochesManual;
        });
    }

    if (ui.form.elements.tipo_pago) ui.form.elements.tipo_pago.addEventListener('change', actualizarVisibilidadPago);
    if (ui.form.elements.monto_abono) ui.form.elements.monto_abono.addEventListener('input', actualizarVisibilidadPago);

    if (ui.form) ui.form.addEventListener('submit', handleFormSubmit);
    if (ui.cancelEditButton) ui.cancelEditButton.addEventListener('click', () => resetFormToCreateMode());
    if (ui.reservasListEl) ui.reservasListEl.addEventListener('click', handleListActions);
    
    document.addEventListener('datosActualizados', handleExternalUpdate);
};   


await loadInitialData(); 
    setupEventListeners();   
    
    await syncReservasConGoogleCalendar(state); 
    
    resetFormToCreateMode(); 
    
    console.log("[Reservas Mount] Montaje completado y listeners adjuntados.");
}



export function unmount(container) {
     state.isModuleMounted = false;
    console.log("Modulo Reservas desmontado.");
    console.log("Modulo Reservas desmontado.");
    if (ui.form && typeof handleFormSubmit === 'function') {
        ui.form.removeEventListener('submit', handleFormSubmit);
    }
    if (ui.reservasListEl && typeof handleListActions === 'function') {
        ui.reservasListEl.removeEventListener('click', handleListActions);
    }
    if (ui.cancelEditButton && typeof resetFormToCreateMode === 'function') {
        ui.cancelEditButton.onclick = null;
    }
    if (ui.tipoCalculoDuracionEl) {
         ui.tipoCalculoDuracionEl.onchange = null;
    }
     const tipoPagoSelectEl = document.getElementById('tipo_pago');
     if(tipoPagoSelectEl && ui.togglePaymentFieldsVisibility) { // Asegurar que la función exista
        // No hay una función específica para remover, pero el onchange se pierde con el innerHTML
     }

    document.removeEventListener('datosActualizados', handleExternalUpdate);

    state.isEditMode = false;
    state.editingReservaId = null;
    state.tiemposEstanciaDisponibles = [];
    state.currentBookingTotal = 0;
    state.configHotel = {
        cobro_al_checkin: true,
        checkin_hora_config: "15:00",
        checkout_hora_config: "12:00",
        impuestos_incluidos_en_precios: false,
        porcentaje_impuesto_principal: 0,
        nombre_impuesto_principal: null,
        moneda_local_simbolo: '$',
        moneda_codigo_iso_info: 'COP',
        moneda_decimales_info: '0'
    };
    if (ui.container) {
        ui.container.innerHTML = '';
    }
    ui.container = null; ui.form = null; ui.feedbackDiv = null; ui.formTitle = null;
    ui.submitButton = null; ui.cancelEditButton = null; ui.reservasListEl = null;
    ui.fechaEntradaInput = null; ui.tipoCalculoDuracionEl = null; ui.nochesManualContainer = null;
    ui.cantidadNochesInput = null; ui.tiempoPredefinidoContainer = null; ui.tiempoEstanciaIdSelect = null;
    ui.habitacionIdSelect = null; ui.totalReservaDisplay = null; ui.fieldsetPago = null; ui.cedulaInput = null;
    
    console.log("Reservas module unmounted and listeners removed.");
}
