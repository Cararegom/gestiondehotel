import { formatCOP, waitForButtonAndBind, cerrarModalContainer, formatHorasMin, formatDateTime, mostrarInfoModalGlobal } from './helpers.js';
import { showGlobalLoading, hideGlobalLoading, showError, formatCurrency, registrarUsoDescuento } from '../../uiUtils.js';
import { turnoService } from '../../services/turnoService.js';
import { showClienteSelectorModal } from '../clientes/clientes.js';
import { calcularSaldoReserva, getHorariosHotel, puedeHacerCheckIn, getTiemposEstancia, getMetodosPago } from './datos.js';
import { updateClienteFields } from './room-card.js';
import { buscarDescuentoParaAlquiler } from './descuentos-helper.js';

async function mostrarConfirmacionAlquilerExitosa() {
    const mensaje = 'La habitaci\u00f3n fue alquilada correctamente.';
    if (typeof Swal !== 'undefined') {
        await Swal.fire('\u00c9xito', mensaje, 'success');
        return;
    }
    mostrarInfoModalGlobal(mensaje, 'Alquiler Registrado');
}

// ================== OPCIONES DE ESTANCIA Y PRECIOS ==================

export function crearOpcionesNochesConPersonalizada(horarios, maxNoches = 5, fechaBase = null) {
    const opciones = [];
    const baseParaCalculo = fechaBase ? new Date(fechaBase) : new Date();

    for (let i = 1; i <= maxNoches; i++) {
        const fechaFinCalculada = new Date(baseParaCalculo);
        const [checkoutH, checkoutM] = (horarios.checkout || '12:00').split(':').map(Number);
        fechaFinCalculada.setHours(checkoutH, checkoutM, 0, 0);

        if (baseParaCalculo >= fechaFinCalculada) {
            fechaFinCalculada.setDate(fechaFinCalculada.getDate() + 1);
        }

        fechaFinCalculada.setDate(fechaFinCalculada.getDate() + (i - 1));
        opciones.push({
            noches: i,
            label: `${i} noche${i > 1 ? 's' : ''} (hasta ${formatDateTime(fechaFinCalculada, undefined, { dateStyle: 'short' })} ${horarios.checkout})`,
            fechaFin: fechaFinCalculada
        });
    }

    return opciones;

}

function getExtensionReferenceDate(fechaFinActual) {
    const fechaFin = fechaFinActual ? new Date(fechaFinActual) : null;
    if (fechaFin && !Number.isNaN(fechaFin.getTime())) {
        return fechaFin;
    }

    return new Date();
}

function calcularNuevaFechaFinExtension({ fechaFinActual, noches = 0, minutos = 0, checkoutStr = '12:00' }) {
    const referencia = getExtensionReferenceDate(fechaFinActual);

    if (Number(noches) > 0) {
        const fechaSalida = new Date(referencia);
        const [h, m] = (checkoutStr || '12:00').split(':').map(Number);
        fechaSalida.setHours(h || 0, m || 0, 0, 0);

        if (referencia.getTime() >= fechaSalida.getTime()) {
            fechaSalida.setDate(fechaSalida.getDate() + 1);
        }

        const nochesExtra = Math.max(0, (Number(noches) || 1) - 1);
        if (nochesExtra > 0) {
            fechaSalida.setDate(fechaSalida.getDate() + nochesExtra);
        }

        return fechaSalida;
    }

    if (Number(minutos) > 0) {
        return new Date(referencia.getTime() + Number(minutos) * 60 * 1000);
    }

    return new Date(fechaFinActual || referencia);
}

function calcularPrecioExtensionNoches(room, cantidadHuespedes, noches) {
    const nochesCantidad = Math.max(1, Number(noches) || 1);
    const huespedes = Math.max(1, Number(cantidadHuespedes) || 1);
    const precioRespaldo = Number(room?.precio) || 0;
    const precioPorNocheBase = huespedes === 1
        ? (Number(room?.precio_1_persona) || precioRespaldo || Number(room?.precio_2_personas) || 0)
        : (Number(room?.precio_2_personas) || precioRespaldo);
    const adicionalPorPersona = Number(room?.precio_huesped_adicional) || 0;

    let total = precioPorNocheBase * nochesCantidad;
    if (huespedes > 2) {
        total += ((huespedes - 2) * adicionalPorPersona) * nochesCantidad;
    }

    return total;
}

export function crearOpcionesHoras(tiempos) {
    if (!Array.isArray(tiempos) || tiempos.length === 0) {
        return '<option value="">-- Sin tarifas disponibles --</option>';
    }

    const opciones = tiempos
        .filter((tiempo) => tiempo.tipo_unidad !== 'noche' && Number(tiempo.minutos) > 0)
        .map((tiempo) => `<option value="${tiempo.id}" data-precio="${tiempo.precio}">${tiempo.nombre} - ${formatCurrency(tiempo.precio)}</option>`);

    if (opciones.length === 0) {
        return '<option value="">-- No aplica --</option>';
    }

    return ['<option value="">-- Selecciona duraci\u00f3n --</option>', ...opciones].join('');
}

// ================== MOTOR DE CÁLCULO DE DETALLES ==================

export async function calcularDetallesEstancia(dataForm, room, tiempos, horarios, descuentoAplicado) {
    let inicioAt = new Date();
    let finAt;

    let montoEstanciaBaseBruto = 0;
    let montoDescuento = 0;
    let descripcionEstancia = 'Seleccione duraci\u00f3n';
    let tipoCalculo = null;
    let cantidadCalculo = 0;
    let precioFinalAntesDeImpuestos = 0;

    const nochesSeleccionadas = dataForm.noches ? parseInt(dataForm.noches, 10) : 0;
    const horasValor = (dataForm.horas ?? '').toString().trim();

    let minutosSeleccionados = 0;
    let tiempoSeleccionado = null;

    if (horasValor) {
        if (/^-?\d+$/.test(horasValor)) {
            minutosSeleccionados = parseInt(horasValor, 10);
            if (minutosSeleccionados > 0) {
                tiempoSeleccionado = tiempos.find((tiempo) => Number(tiempo.minutos) === minutosSeleccionados) || null;
            }
        } else {
            tiempoSeleccionado = tiempos.find((tiempo) => tiempo.id == horasValor) || null;
            minutosSeleccionados = Number(tiempoSeleccionado?.minutos) || 0;
        }
    }

    const tiempoEstanciaId = tiempoSeleccionado?.id || null;
    const cantidadHuespedes = Math.max(1, parseInt(dataForm.cantidad_huespedes, 10) || 1);
    const precioAdicionalPorPersona = Number(room.precio_huesped_adicional) || 0;

    const precioLibreActivado = dataForm.precio_libre_toggle === 'on';
    const precioLibreValor = parseFloat(dataForm.precio_libre_valor) || 0;

    const calcularFinPorNoches = (inicio, noches, checkoutStr) => {
        const fechaSalida = new Date(inicio);
        const [h, m] = (checkoutStr || '12:00').split(':').map(Number);
        fechaSalida.setHours(h || 0, m || 0, 0, 0);

        if (inicio.getTime() >= fechaSalida.getTime()) {
            fechaSalida.setDate(fechaSalida.getDate() + 1);
        }

        const nochesExtra = Math.max(0, (Number(noches) || 1) - 1);
        if (nochesExtra > 0) {
            fechaSalida.setDate(fechaSalida.getDate() + nochesExtra);
        }

        return fechaSalida;
    };

    if (precioLibreActivado) {
        montoEstanciaBaseBruto = precioLibreValor;
        precioFinalAntesDeImpuestos = precioLibreValor;
        descripcionEstancia = `Estancia (Precio Manual: ${formatCurrency(precioLibreValor)})`;
        tipoCalculo = 'manual';
        cantidadCalculo = precioLibreValor;

        if (nochesSeleccionadas > 0) {
            finAt = calcularFinPorNoches(inicioAt, nochesSeleccionadas, horarios.checkout);
        } else if (minutosSeleccionados > 0) {
            finAt = new Date(inicioAt.getTime() + minutosSeleccionados * 60 * 1000);
        } else if (minutosSeleccionados === -1) {
            finAt = new Date(inicioAt.getTime() + 100 * 365 * 24 * 60 * 60 * 1000);
        } else {
            finAt = new Date(inicioAt);
        }
    } else {
        if (nochesSeleccionadas > 0) {
            tipoCalculo = 'noches';
            cantidadCalculo = nochesSeleccionadas;
            finAt = calcularFinPorNoches(inicioAt, nochesSeleccionadas, horarios.checkout);
            descripcionEstancia = `${nochesSeleccionadas} Noche(s)`;

            const precioNocheRespaldo = Number(room.precio) || 0;
            let precioNocheBase = Number(room.precio_2_personas) || precioNocheRespaldo;
            if (cantidadHuespedes === 1) {
                precioNocheBase = Number(room.precio_1_persona) || precioNocheRespaldo || precioNocheBase;
            }

            let totalNoche = precioNocheBase * nochesSeleccionadas;
            if (cantidadHuespedes > 2) {
                totalNoche += ((cantidadHuespedes - 2) * precioAdicionalPorPersona) * nochesSeleccionadas;
            }
            montoEstanciaBaseBruto = totalNoche;
        } else if (minutosSeleccionados > 0) {
            tipoCalculo = 'horas';
            cantidadCalculo = minutosSeleccionados;
            finAt = new Date(inicioAt.getTime() + minutosSeleccionados * 60 * 1000);
            descripcionEstancia = tiempoSeleccionado?.nombre || formatHorasMin(minutosSeleccionados);

            let precioTiempo = Number(tiempoSeleccionado?.precio) || 0;
            if (!precioTiempo) {
                const baseHora = Number(room.precio_base_hora) || 0;
                if (baseHora > 0) {
                    precioTiempo = (minutosSeleccionados / 60) * baseHora;
                }
            }

            if (cantidadHuespedes > 2) {
                precioTiempo += (cantidadHuespedes - 2) * precioAdicionalPorPersona;
            }

            montoEstanciaBaseBruto = precioTiempo;
        } else if (minutosSeleccionados === -1) {
            tipoCalculo = 'abierta';
            cantidadCalculo = 0;
            finAt = new Date(inicioAt.getTime() + 100 * 365 * 24 * 60 * 60 * 1000);
            descripcionEstancia = 'Duraci\u00f3n Abierta';
            montoEstanciaBaseBruto = 0;
        } else {
            finAt = new Date(inicioAt);
        }

        const totalAntesDeDescuento = montoEstanciaBaseBruto;

        if (descuentoAplicado && totalAntesDeDescuento > 0) {
            const valorDescuento = Number(descuentoAplicado.valor) || 0;
            const tipoDescuento = descuentoAplicado.tipo || descuentoAplicado.tipo_descuento;
            if (tipoDescuento === 'porcentaje') {
                montoDescuento = (totalAntesDeDescuento * valorDescuento) / 100;
            } else {
                montoDescuento = valorDescuento;
            }
            montoDescuento = Math.min(montoDescuento, totalAntesDeDescuento);
        }

        precioFinalAntesDeImpuestos = totalAntesDeDescuento - montoDescuento;
    }

    const hotelConfigGlobal = window.hotelConfigGlobal || {};
    const porcentajeImpuesto = Number(hotelConfigGlobal.porcentaje_impuesto_principal) || 0;
    const impuestosIncluidos = hotelConfigGlobal.impuestos_incluidos_en_precios === true;

    let montoImpuesto = 0;
    let baseSinImpuesto = precioFinalAntesDeImpuestos;

    if (porcentajeImpuesto > 0 && precioFinalAntesDeImpuestos > 0 && tipoCalculo !== 'abierta') {
        const tasa = porcentajeImpuesto / 100;
        if (impuestosIncluidos) {
            baseSinImpuesto = precioFinalAntesDeImpuestos / (1 + tasa);
            montoImpuesto = precioFinalAntesDeImpuestos - baseSinImpuesto;
        } else {
            montoImpuesto = precioFinalAntesDeImpuestos * tasa;
            baseSinImpuesto = precioFinalAntesDeImpuestos;
        }
    }

    const precioFinalConImpuestos = impuestosIncluidos
        ? precioFinalAntesDeImpuestos
        : (precioFinalAntesDeImpuestos + montoImpuesto);

    const totalRedondeado = tipoCalculo === 'abierta'
        ? 0
        : (precioLibreActivado ? precioLibreValor : Math.round(precioFinalConImpuestos));

    return {
        inicioAt,
        finAt,
        precioBase: Math.round(montoEstanciaBaseBruto),
        montoDescontado: Math.round(montoDescuento),
        descuentoAplicado,
        montoImpuesto: Math.round(montoImpuesto),
        porcentajeImpuestos: porcentajeImpuesto,
        nombreImpuesto: hotelConfigGlobal.nombre_impuesto_principal || 'IVA',
        montoBaseSinImpuestos: Math.round(baseSinImpuesto),
        precioTotal: totalRedondeado,
        descripcionEstancia,
        tipoCalculo,
        cantidadCalculo,
        tiempoEstanciaId,
        minutosSeleccionados
    };
}

function parseHoraAms(horaStr) {
    if (!horaStr) return 0;
    const parts = horaStr.split(':');
    return (parseInt(parts[0], 10) * 3600000) + (parseInt(parts[1], 10) * 60000);
}
function extractHoraString(horaCompleta) {
    if (!horaCompleta) return '12:00';
    return horaCompleta.split(':').slice(0, 2).join(':');
}


// ================== REGISTRAR RESERVA ==================

export async function registrarReservaYMovimientosCaja({
    formData,
    detallesEstancia,
    pagos,
    room,
    supabase,
    currentUser,
    hotelId,
    mainAppContainer
}) {
    const clienteNombre = (formData?.cliente_nombre ?? '').toString().trim();
    if (!clienteNombre) throw new Error('Falta el nombre del cliente.');
    if (!detallesEstancia?.inicioAt || !detallesEstancia?.finAt) {
        throw new Error('No se pudo calcular la fecha de inicio/fin de la estancia.');
    }

    const cantidadHuespedes = Math.max(1, parseInt(formData?.cantidad_huespedes, 10) || 1);
    const pagosLimpios = Array.isArray(pagos)
        ? pagos.map((pago) => ({
            monto: Number(pago.monto) || 0,
            metodo_pago_id: pago.metodo_pago_id || null
        })).filter((pago) => pago.monto > 0 && pago.metodo_pago_id)
        : [];

    const totalPagado = pagosLimpios.reduce((sum, pago) => sum + pago.monto, 0);
    const metodoPagoReserva = pagosLimpios.length === 1 ? pagosLimpios[0].metodo_pago_id : null;

    let clienteIdFinal = formData?.cliente_id || null;
    const cedula = (formData?.cedula ?? '').toString().trim() || null;
    const telefono = (formData?.telefono ?? '').toString().trim() || null;

    if (!clienteIdFinal) {
        const { data: nuevoCliente, error: errCliente } = await supabase
            .from('clientes')
            .insert({
                hotel_id: hotelId,
                nombre: clienteNombre,
                documento: cedula,
                telefono
            })
            .select('id')
            .single();

        if (errCliente) throw new Error(`Error al crear el nuevo cliente: ${errCliente.message}`);
        clienteIdFinal = nuevoCliente.id;
    }

    let notasFinales = formData?.notas ? formData.notas.toString().trim() : null;
    if (formData?.precio_libre_toggle === 'on') {
        const precioManual = Number(formData?.precio_libre_valor) || 0;
        const precioManualStr = `[PRECIO MANUAL: ${formatCurrency(precioManual)}]`;
        notasFinales = notasFinales ? `${precioManualStr} ${notasFinales}` : precioManualStr;
    }

    const reservaInsert = {
        hotel_id: hotelId,
        habitacion_id: room.id,
        cliente_id: clienteIdFinal,
        cliente_nombre: clienteNombre,
        cedula,
        telefono,
        tiempo_estancia_id: detallesEstancia?.tiempoEstanciaId || null,
        fecha_inicio: detallesEstancia.inicioAt.toISOString(),
        fecha_fin: detallesEstancia.finAt.toISOString(),
        cantidad_huespedes: cantidadHuespedes,
        monto_total: Number(detallesEstancia?.precioTotal) || 0,
        monto_pagado: totalPagado,
        metodo_pago_id: metodoPagoReserva,
        estado: 'ocupada',
        tipo_duracion: detallesEstancia?.tipoCalculo || null,
        cantidad_duracion: Number(detallesEstancia?.cantidadCalculo) || 0,
        monto_estancia_base: Number(detallesEstancia?.precioBase) || 0,
        monto_estancia_base_sin_impuestos: Number(detallesEstancia?.montoBaseSinImpuestos) || Number(detallesEstancia?.precioBase) || 0,
        monto_impuestos_estancia: Number(detallesEstancia?.montoImpuesto) || 0,
        porcentaje_impuestos_aplicado: detallesEstancia?.porcentajeImpuestos ?? null,
        nombre_impuesto_aplicado: detallesEstancia?.nombreImpuesto ?? null,
        descuento_aplicado_id: detallesEstancia?.descuentoAplicado?.id || null,
        monto_descontado: Number(detallesEstancia?.montoDescontado) || 0,
        usuario_id: currentUser.id,
        notas: notasFinales
    };

    const { data: nuevaReserva, error: errReserva } = await supabase
        .from('reservas')
        .insert(reservaInsert)
        .select()
        .single();

    if (errReserva) throw new Error(`Error al crear la reserva: ${errReserva.message}`);

    if (nuevaReserva.descuento_aplicado_id) {
        await registrarUsoDescuento(supabase, nuevaReserva.descuento_aplicado_id);
    }

    const { error: errHab } = await supabase
        .from('habitaciones')
        .update({ estado: 'ocupada' })
        .eq('id', room.id);

    if (errHab) throw new Error(`Reserva creada, pero error al actualizar habitaci\u00f3n: ${errHab.message}`);

    const { error: errCrono } = await supabase
        .from('cronometros')
        .insert({
            hotel_id: hotelId,
            reserva_id: nuevaReserva.id,
            habitacion_id: room.id,
            fecha_inicio: nuevaReserva.fecha_inicio,
            fecha_fin: nuevaReserva.fecha_fin,
            activo: true
        });

    if (errCrono) throw new Error(`Reserva creada, pero error al crear cron\u00f3metro: ${errCrono.message}`);

    const turnoActivoId = turnoService.getActiveTurnId
        ? turnoService.getActiveTurnId()
        : (await turnoService.getTurnoAbierto(supabase, currentUser.id, hotelId))?.id;

    if (turnoActivoId && pagosLimpios.length > 0) {
        const pagosParaInsertar = pagosLimpios.map((pago) => ({
            hotel_id: hotelId,
            reserva_id: nuevaReserva.id,
            monto: pago.monto,
            fecha_pago: new Date().toISOString(),
            metodo_pago_id: pago.metodo_pago_id,
            usuario_id: currentUser.id,
            concepto: `Alquiler Inicial Hab. ${room.nombre} (${detallesEstancia?.descripcionEstancia || ''}) - Cliente: ${clienteNombre}`
        }));

        const { data: pagosData, error: errPagoRes } = await supabase
            .from('pagos_reserva')
            .insert(pagosParaInsertar)
            .select('id');

        if (errPagoRes) throw new Error(`Reserva creada, pero error al guardar pagos_reserva: ${errPagoRes.message}`);

        const movimientosCaja = pagosLimpios.map((pago, index) => ({
            hotel_id: hotelId,
            tipo: 'ingreso',
            monto: pago.monto,
            concepto: `Alquiler Hab. ${room.nombre} (${detallesEstancia?.descripcionEstancia || ''}) - Cliente: ${clienteNombre}`,
            fecha_movimiento: new Date().toISOString(),
            metodo_pago_id: pago.metodo_pago_id,
            usuario_id: currentUser.id,
            reserva_id: nuevaReserva.id,
            turno_id: turnoActivoId,
            pago_reserva_id: pagosData?.[index]?.id || null
        }));

        const { error: errCaja } = await supabase.from('caja').insert(movimientosCaja);
        if (errCaja) throw new Error(`Reserva creada, pero error al registrar movimiento en caja: ${errCaja.message}`);
    }

    const modalContainer = document.getElementById('modal-container');
    if (modalContainer) {
        modalContainer.style.display = 'none';
        modalContainer.innerHTML = '';
    }

    await mostrarConfirmacionAlquilerExitosa();
    document.dispatchEvent(new CustomEvent('renderRoomsComplete', { detail: { action: 'refresh' } }));
    return nuevaReserva;
}

export async function showAlquilarModal(room, supabase, currentUser, hotelId, mainAppContainer) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) { console.error("Contenedor de modal no encontrado."); return; }
    modalContainer.style.display = "flex";
    modalContainer.innerHTML = "";

    let descuentoAplicado = null; 

    // Obtención de datos iniciales
    let horarios, tiempos, metodosPagoDisponibles;
    try {
        [horarios, tiempos, metodosPagoDisponibles] = await Promise.all([
            getHorariosHotel(supabase, hotelId),
            getTiemposEstancia(supabase, hotelId),
            getMetodosPago(supabase, hotelId)
        ]);
    } catch (err) {
        mostrarInfoModalGlobal("No se pudieron cargar los datos necesarios para el alquiler.", "Error de Carga");
        return;
    }
    
    // --- CORRECCIÃ“N 1: Filtramos los tiempos según el tipo de habitación (Aire vs Ventilador) ---
    const tipoHab = (room.tipo || 'aire').toLowerCase();
    const tiemposFiltrados = tiempos.filter(t => {
        // Asumimos que t.tipo_habitacion puede ser 'aire', 'ventilador' o 'ambas'
        const tipoTarifa = (t.tipo_habitacion || 'ambas').toLowerCase();
        return (tipoTarifa === 'ambas' || tipoTarifa === tipoHab) && t.minutos > 0;
    });

    metodosPagoDisponibles.unshift({ id: "mixto", nombre: "Pago Mixto" });
    const opcionesNoches = crearOpcionesNochesConPersonalizada(horarios, 5, null, room);
    
    // No usamos crearOpcionesHoras aquí para tener control total del mapeo con ID en el HTML

    // HTML del Modal
    const modalContent = document.createElement('div');
    modalContent.className = "bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-auto animate-fade-in-up overflow-hidden";
    
    modalContent.innerHTML = `
    <div class="flex flex-col md:flex-row">
        <div class="w-full md:w-3/5 p-6 sm:p-8 space-y-6 bg-slate-50 md:rounded-l-xl max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-center">
                <h3 class="text-2xl md:text-3xl font-bold text-blue-700">Alquilar: ${room.nombre}</h3>
                <button id="close-modal-alquilar" class="text-gray-500 hover:text-red-600 text-3xl leading-none focus:outline-none">&times;</button>
            </div>
            <form id="alquilar-form-pos" class="space-y-5">
                <input type="hidden" name="cliente_id" id="cliente_id_alquiler">
                <div>
                    <label class="form-label">Hu\u00e9sped*</label>
                    <div class="flex items-center gap-2">
                        <input required name="cliente_nombre" id="cliente_nombre" class="form-control flex-grow" placeholder="Nombre completo o busque uno existente">
                        <button type="button" id="btn-buscar-cliente-alquiler" class="button button-info p-2 rounded-full" title="Buscar cliente existente"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" /></svg></button>
                    </div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div><label class="form-label">C\u00e9dula / ID</label><input name="cedula" id="cedula" class="form-control"></div>
                    <div><label class="form-label">Tel\u00e9fono</label><input name="telefono" id="telefono" type="tel" class="form-control"></div>
                </div>
                <div>
                    <label class="form-label">Duraci\u00f3n de Estancia*</label>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                        <select name="noches" id="select-noches" class="form-control"><option value="">-- Noches --</option>${opcionesNoches.map(o => `<option value="${o.noches}">${o.label}</option>`).join('')}</select>
                        
                        <select name="horas" id="select-horas" class="form-control">
                            <option value="">-- Horas --</option>
                            ${tiemposFiltrados.map(t => `<option value="${t.id}">${t.nombre} - ${formatCOP(t.precio)}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="pt-2 mt-2 border-t">
                    <label class="flex items-center gap-2 cursor-pointer mt-2"><input type="checkbox" id="precio_libre_toggle_alquiler" name="precio_libre_toggle" class="form-checkbox h-5 w-5 text-indigo-600"><span class="font-semibold text-sm text-indigo-700">Asignar Precio Manual</span></label>
                    <div id="precio_libre_container_alquiler" class="mt-2" style="display:none;"><label for="precio_libre_valor_alquiler" class="font-semibold text-sm text-gray-700">Valor Total de la Estancia</label><input type="number" id="precio_libre_valor_alquiler" name="precio_libre_valor" class="form-control text-lg font-bold" placeholder="0"></div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                    <div>
                        <label class="form-label">Cant. Hu\u00e9spedes*</label>
                        <input name="cantidad_huespedes" id="cantidad_huespedes" type="number" class="form-control" min="1" value="2" required>
                    </div>
                    <div id="metodo-pago-wrapper">
                        <label class="form-label">M\u00e9todo de Pago*</label><select required name="metodo_pago_id" id="metodo_pago_id" class="form-control">${metodosPagoDisponibles.map(mp => `<option value="${mp.id}">${mp.nombre}</option>`).join('')}</select>
                    </div>
                </div>
                <div id="descuento-wrapper">
                    <label class="form-label">C\u00f3digo de Descuento</label>
                    <div class="flex items-center gap-2"><input type="text" id="codigo-descuento-alquiler" class="form-control flex-grow uppercase" placeholder="C\u00d3DIGO OPCIONAL"><button type="button" id="btn-aplicar-descuento-alquiler" class="button button-info">Aplicar</button></div>
                    <div id="feedback-descuento-alquiler" class="text-xs mt-1 h-4 font-semibold"></div>
                </div>
                <div class="pt-4"><button type="submit" id="btn-alquilar-hab" class="button button-success w-full py-3 text-lg font-bold rounded-lg">Confirmar y Registrar</button></div>
            </form>
        </div>
        <div class="w-full md:w-2/5 bg-slate-800 text-white p-6 sm:p-8 flex flex-col justify-between md:rounded-r-xl">
            <div>
                <h4 class="text-xl sm:text-2xl font-semibold text-center border-b border-slate-600 pb-3 mb-5 text-cyan-400">Resumen del Alquiler</h4>
                <div id="ticket-resumen-container" class="space-y-2 text-sm sm:text-base"></div>
            </div>
            <div class="border-t-2 border-cyan-500 pt-4 mt-6">
                <div class="flex justify-between items-baseline"><span class="text-xl font-semibold text-green-400">TOTAL A PAGAR:</span><span id="ticket-total-price" class="text-3xl font-bold text-green-300">$0</span></div>
            </div>
        </div>
    </div>`;
    modalContainer.appendChild(modalContent);
    
    // Referencias
    const formEl = modalContainer.querySelector('#alquilar-form-pos');
    const togglePrecioLibreEl = modalContainer.querySelector('#precio_libre_toggle_alquiler');
    const containerPrecioLibreEl = modalContainer.querySelector('#precio_libre_container_alquiler');
    const codigoInputEl = modalContainer.querySelector('#codigo-descuento-alquiler');
    const feedbackDescuentoAlquilerEl = modalContainer.querySelector('#feedback-descuento-alquiler');
    const selectNochesEl = modalContainer.querySelector('#select-noches');
    const selectHorasEl = modalContainer.querySelector('#select-horas');
    const metodoPagoWrapper = modalContainer.querySelector('#metodo-pago-wrapper');
    const descuentoWrapper = modalContainer.querySelector('#descuento-wrapper');
    const btnAlquilar = modalContainer.querySelector('#btn-alquilar-hab');
    
    // FUNCIÃ“N DE CÁLCULO
    const recalcularYActualizarTotalAlquiler = async (codigoManual = null) => {
        const formData = Object.fromEntries(new FormData(formEl));
        const clienteId = formData.cliente_id || null;
        const codigo = codigoManual === null ? codigoInputEl.value.trim().toUpperCase() : codigoManual;
        
        // --- CORRECCIÃ“N 3: Lógica para obtener tarifa por ID ---
        const horasIdSeleccionado = formData.horas; // Esto ahora es un ID (string)
        let minutosSeleccionados = 0;
        let tarifaEspecifica = null;

        if (horasIdSeleccionado) {
            // Buscamos la tarifa exacta usando el ID
            tarifaEspecifica = tiempos.find(t => t.id == horasIdSeleccionado);
            if (tarifaEspecifica) {
                minutosSeleccionados = tarifaEspecifica.minutos;
            }
        }

        const nochesSeleccionadas = parseInt(formData.noches) || 0; 
        
        // Si no hay noches y seleccionamos horas, usamos los minutos de la tarifa encontrada
        // Si tarifaEspecifica es null, asumimos 0
        
        const esDuracionAbierta = false; // Ajusta según tu lógica si tienes tarifas "abiertas"
        
        if (esDuracionAbierta) {
            selectNochesEl.value = ''; selectNochesEl.disabled = true;
            togglePrecioLibreEl.checked = false; togglePrecioLibreEl.disabled = true;
            containerPrecioLibreEl.style.display = 'none';
            metodoPagoWrapper.style.display = 'none'; formEl.elements.metodo_pago_id.required = false;
            descuentoWrapper.style.display = 'none'; codigoInputEl.value = '';
            btnAlquilar.textContent = "Registrar Entrada";
            feedbackDescuentoAlquilerEl.textContent = ''; descuentoAplicado = null;
        } else {
            selectNochesEl.disabled = false; togglePrecioLibreEl.disabled = false;
            metodoPagoWrapper.style.display = 'block'; formEl.elements.metodo_pago_id.required = true;
            descuentoWrapper.style.display = 'block'; btnAlquilar.textContent = "Confirmar y Registrar";
            containerPrecioLibreEl.style.display = togglePrecioLibreEl.checked ? 'block' : 'none';

            descuentoAplicado = await buscarDescuentoParaAlquiler(supabase, hotelId, clienteId, room.id, codigo, minutosSeleccionados, nochesSeleccionadas, tiempos);

            if (descuentoAplicado) {
                feedbackDescuentoAlquilerEl.className = 'text-xs mt-1 h-4 font-semibold text-green-600';
                feedbackDescuentoAlquilerEl.textContent = `\u00a1"${descuentoAplicado.nombre}" aplicado!`;
            } else if (codigo) {
                feedbackDescuentoAlquilerEl.className = 'text-xs mt-1 h-4 font-semibold text-red-600';
                feedbackDescuentoAlquilerEl.textContent = 'C\u00f3digo no v\u00e1lido o no aplicable.';
            } else {
                feedbackDescuentoAlquilerEl.textContent = '';
            }
        }
        
        // Pasamos los datos a la función auxiliar
        // NOTA: Como formData.horas ahora tiene un ID, si calcularDetallesEstancia espera minutos, 
        // debemos tener cuidado. Sin embargo, lo más seguro es FORZAR el precio correcto abajo.
        const detalles = await calcularDetallesEstancia(formData, room, tiempos, horarios, descuentoAplicado); 
        
        // --- CORRECCIÃ“N 4: Forzamos el precio correcto si se eligió tarifa por ID ---
        // Esto arregla el problema de que calcularDetallesEstancia se confunda con los nombres
        if (tarifaEspecifica && !nochesSeleccionadas && !togglePrecioLibreEl.checked) {
            detalles.precioBase = tarifaEspecifica.precio;
            // Recalculamos el total basándonos en el precio base correcto
            detalles.precioTotal = detalles.precioBase - (detalles.montoDescontado || 0) + (detalles.montoImpuesto || 0);
            detalles.descripcionEstancia = tarifaEspecifica.nombre; // Aseguramos el nombre correcto
        }

        const ticketResumenEl = modalContainer.querySelector('#ticket-resumen-container');
        const ticketTotalEl = modalContainer.querySelector('#ticket-total-price');

        let resumenHtml = `
            <div class="flex justify-between"><span class="text-slate-300">Estancia:</span><strong>${detalles.descripcionEstancia}</strong></div>
            <div class="flex justify-between"><span class="text-slate-300">Precio Base:</span><strong>${formatCOP(detalles.precioBase)}</strong></div>
            ${detalles.montoDescontado > 0 ? `<div class="flex justify-between text-green-300"><span>Descuento Aplicado:</span><strong>-${formatCOP(detalles.montoDescontado)}</strong></div>` : ''}
            ${detalles.montoImpuesto > 0 ? `<div class="flex justify-between"><span>Impuestos:</span><strong>${formatCOP(detalles.montoImpuesto)}</strong></div>` : ''}
        `;
        ticketResumenEl.innerHTML = resumenHtml;
        ticketTotalEl.textContent = formatCOP(detalles.precioTotal);
    };

    // --- LISTENERS ---
    
    selectNochesEl.addEventListener('change', async () => { if (selectNochesEl.value) { selectHorasEl.value = ''; } await recalcularYActualizarTotalAlquiler(); });
    selectHorasEl.addEventListener('change', async () => { if (selectHorasEl.value) { selectNochesEl.value = ''; } await recalcularYActualizarTotalAlquiler(); });
    
    const cantidadHuespedesEl = modalContainer.querySelector('#cantidad_huespedes');
    if (cantidadHuespedesEl) {
        cantidadHuespedesEl.addEventListener('input', async () => {
            await recalcularYActualizarTotalAlquiler();
        });
    }

    const precioLibreValorEl = modalContainer.querySelector('#precio_libre_valor_alquiler');
    if (precioLibreValorEl) {
        precioLibreValorEl.addEventListener('input', async () => { await recalcularYActualizarTotalAlquiler(); });
    }
    
    togglePrecioLibreEl.addEventListener('change', async () => { await recalcularYActualizarTotalAlquiler(); });
    modalContainer.querySelector('#btn-aplicar-descuento-alquiler').onclick = async () => { await recalcularYActualizarTotalAlquiler(); };
    modalContainer.querySelector('#close-modal-alquilar').onclick = () => { modalContainer.style.display = "none"; modalContainer.innerHTML = ''; };
    modalContainer.querySelector('#btn-buscar-cliente-alquiler').onclick = () => {
        showClienteSelectorModal(supabase, hotelId, {
            onSelect: async (cliente) => {
                formEl.elements.cliente_nombre.value = cliente.nombre;
                formEl.elements.cedula.value = cliente.documento || '';
                formEl.elements.telefono.value = cliente.telefono || '';
                formEl.elements.cliente_id.value = cliente.id;
                await recalcularYActualizarTotalAlquiler();
            }
        });
    };
    
    // Submit
    formEl.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = formEl.querySelector('#btn-alquilar-hab');
        submitBtn.disabled = true;
        submitBtn.textContent = "Procesando...";
        try {
            const formData = Object.fromEntries(new FormData(formEl));
            const detallesFinales = await calcularDetallesEstancia(formData, room, tiempos, horarios, descuentoAplicado);
            
            // --- CORRECCIÃ“N 5: Aplicar la corrección de precio también al enviar ---
            const horasIdSeleccionado = formData.horas;
            if (horasIdSeleccionado && !formData.noches && !formData.precio_libre_toggle) {
                const tarifaEspecifica = tiempos.find(t => t.id == horasIdSeleccionado);
                if (tarifaEspecifica) {
                    detallesFinales.precioBase = tarifaEspecifica.precio;
                    detallesFinales.precioTotal = detallesFinales.precioBase - (detallesFinales.montoDescontado || 0);
                    // Importante: asegurarnos que 'minutos' sean correctos para la fecha de salida
                    detallesFinales.duracionMinutos = tarifaEspecifica.minutos;
                }
            }

            if (!formData.cliente_nombre.trim()) throw new Error("El nombre del hu\u00e9sped es obligatorio.");
            if (detallesFinales.tipoCalculo === null && formData.precio_libre_toggle !== 'on') throw new Error("Debe seleccionar una duraci\u00f3n v\u00e1lida.");
            
            const totalCostoEstancia = detallesFinales.precioTotal;
            const metodoPagoId = formData.metodo_pago_id;
            
            if (detallesFinales.tipoCalculo === 'abierta' || totalCostoEstancia <= 0) {
                 await registrarReservaYMovimientosCaja({ formData, detallesEstancia: detallesFinales, pagos: [], room, supabase, currentUser, hotelId, mainAppContainer });
            } else if (metodoPagoId === "mixto") {
                showPagoMixtoModal(totalCostoEstancia, metodosPagoDisponibles, async (pagosMixtos) => {
                    await registrarReservaYMovimientosCaja({ formData, detallesEstancia: detallesFinales, pagos: pagosMixtos, room, supabase, currentUser, hotelId, mainAppContainer });
                });
            } else {
                await registrarReservaYMovimientosCaja({ formData, detallesEstancia: detallesFinales, pagos: [{ metodo_pago_id: metodoPagoId, monto: totalCostoEstancia }], room, supabase, currentUser, hotelId, mainAppContainer });
            }
        } catch (err) {
            mostrarInfoModalGlobal(err.message, "Error de Registro");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = "Confirmar y Registrar";
        }
    };
    
    await recalcularYActualizarTotalAlquiler();
}

async function showPagoMixtoModal(totalAPagar, metodosPago, onConfirm) {
    const modalContainer = document.getElementById('modal-container-secondary');
    if (!modalContainer) throw new Error('No existe modal-container-secondary para el pago mixto.');

    modalContainer.style.display = 'flex';
    modalContainer.innerHTML = '';

    const metodosDisponibles = metodosPago.filter((metodo) => metodo.id !== 'mixto');
    const opcionesMetodosHTML = metodosDisponibles.map((metodo) => `<option value="${metodo.id}">${metodo.nombre}</option>`).join('');

    const modalContent = document.createElement('div');
    modalContent.className = 'bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 m-auto animate-fade-in-up';
    modalContent.innerHTML = `
        <form id="form-pago-mixto">
            <h3 class="text-xl font-bold mb-2 text-indigo-700">Pago Mixto</h3>
            <p class="mb-4 text-gray-600">Divida el total de <strong class="text-2xl">${formatCurrency(totalAPagar)}</strong>.</p>
            <div id="lista-pagos-mixtos" class="space-y-3 pr-2 max-h-60 overflow-y-auto"></div>
            <button type="button" id="btn-agregar-pago-mixto" class="button button-neutral w-full mt-4 text-sm py-2">Agregar Otro M\u00e9todo</button>
            <hr class="my-4">
            <div class="flex justify-between items-center text-lg font-bold">
                <span class="text-gray-700">Total Cubierto:</span>
                <span id="total-cubierto-mixto">${formatCurrency(0)}</span>
            </div>
            <div class="flex justify-between items-center text-lg font-bold mt-1">
                <span class="text-gray-700">Faltante por Pagar:</span>
                <span id="faltante-pago-mixto" class="text-red-600">${formatCurrency(totalAPagar)}</span>
            </div>
            <div class="flex gap-3 mt-6">
                <button type="submit" id="btn-confirmar-pago-mixto" class="button button-success flex-1 py-2.5" disabled>Confirmar Pago</button>
                <button type="button" id="btn-cancelar-pago-mixto" class="button button-danger flex-1 py-2.5">Cancelar</button>
            </div>
        </form>
    `;
    modalContainer.appendChild(modalContent);

    const formMixto = modalContent.querySelector('#form-pago-mixto');
    const listaPagosDiv = modalContent.querySelector('#lista-pagos-mixtos');
    const btnConfirmar = modalContent.querySelector('#btn-confirmar-pago-mixto');

    const actualizarTotalesMixtos = () => {
        let totalCubierto = 0;
        listaPagosDiv.querySelectorAll('input.monto-pago-mixto').forEach((input) => {
            totalCubierto += Number(input.value) || 0;
        });

        const faltante = totalAPagar - totalCubierto;
        modalContent.querySelector('#total-cubierto-mixto').textContent = formatCurrency(totalCubierto);
        const faltanteEl = modalContent.querySelector('#faltante-pago-mixto');
        faltanteEl.textContent = formatCurrency(faltante);

        if (Math.abs(faltante) < 0.01) {
            btnConfirmar.disabled = false;
            faltanteEl.className = 'text-green-600';
        } else {
            btnConfirmar.disabled = true;
            faltanteEl.className = 'text-red-600';
        }
    };

    const agregarFilaDePago = () => {
        const newRow = document.createElement('div');
        newRow.className = 'pago-mixto-row flex items-center gap-2';
        newRow.innerHTML = `
            <select class="form-control flex-grow">${opcionesMetodosHTML}</select>
            <input type="number" class="form-control w-32 monto-pago-mixto" placeholder="Monto" min="0" step="any">
            <button type="button" class="btn-remover-pago-mixto text-red-500 hover:text-red-700 text-2xl font-bold">&times;</button>
        `;
        listaPagosDiv.appendChild(newRow);
        newRow.querySelector('.btn-remover-pago-mixto').onclick = () => {
            newRow.remove();
            actualizarTotalesMixtos();
        };
    };

    modalContent.querySelector('#btn-agregar-pago-mixto').onclick = agregarFilaDePago;
    listaPagosDiv.addEventListener('input', actualizarTotalesMixtos);
    agregarFilaDePago();
    listaPagosDiv.querySelector('input.monto-pago-mixto').value = totalAPagar;
    actualizarTotalesMixtos();

    modalContent.querySelector('#btn-cancelar-pago-mixto').onclick = () => {
        modalContainer.style.display = 'none';
        modalContainer.innerHTML = '';

        const btnPrincipal = document.querySelector('#btn-alquilar-hab');
        if (btnPrincipal) {
            btnPrincipal.disabled = false;
            btnPrincipal.textContent = 'Confirmar y Registrar';
        }

        const btnExtension = document.querySelector('#extender-form-pos button[type="submit"]');
        if (btnExtension) {
            btnExtension.disabled = false;
            btnExtension.textContent = 'Confirmar Extensi\u00f3n';
        }
    };

    formMixto.onsubmit = async (event) => {
        event.preventDefault();
        btnConfirmar.disabled = true;
        btnConfirmar.textContent = 'Procesando...';

        const pagosFinales = [];
        listaPagosDiv.querySelectorAll('.pago-mixto-row').forEach((row) => {
            const metodoId = row.querySelector('select').value;
            const monto = Number(row.querySelector('input').value);
            if (metodoId && monto > 0) {
                pagosFinales.push({ metodo_pago_id: metodoId, monto });
            }
        });

        if (pagosFinales.length === 0) {
            alert('No se ha definido ning\u00fan pago v\u00e1lido.');
            btnConfirmar.disabled = false;
            btnConfirmar.textContent = 'Confirmar Pago';
            return;
        }

        try {
            await onConfirm(pagosFinales);
            modalContainer.style.display = 'none';
            modalContainer.innerHTML = '';
        } catch (error) {
            console.error('Error procesando pago mixto:', error);
            mostrarInfoModalGlobal(error.message || 'No se pudo registrar el pago mixto.', 'Error de Pago');
            btnConfirmar.disabled = false;
            btnConfirmar.textContent = 'Confirmar Pago';
        }
    };
}

export async function showExtenderTiempoModal(room, supabase, currentUser, hotelId, mainAppContainer) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) {
        console.error("Contenedor de modal 'modal-container' no encontrado.");
        alert("Error cr\u00edtico: No se puede mostrar el modal para extender tiempo.");
        return;
    }
    modalContainer.style.display = "flex";
    modalContainer.innerHTML = "";

    let reservaActiva = null;
    try {
        for (const estado of ['activa', 'ocupada', 'tiempo agotado']) {
            const { data, error } = await supabase
                .from('reservas')
                .select('id, fecha_fin, fecha_inicio, cliente_nombre, monto_total, metodo_pago_id, monto_pagado, cantidad_huespedes')
                .eq('habitacion_id', room.id)
                .eq('estado', estado)
                .order('fecha_inicio', { ascending: false })
                .limit(1)
                .maybeSingle(); 
            if (error && error.code !== 'PGRST116') throw error;
            if (data) {
                reservaActiva = data;
                break;
            }
        }

        if (!reservaActiva) {
            mostrarInfoModalGlobal("No se encontr\u00f3 una reserva activa o con tiempo agotado para extender en esta habitaci\u00f3n.", "Operaci\u00f3n no posible", [], modalContainer);
            return;
        }

        const [horarios, tiempos, metodosPagoExtension] = await Promise.all([
            getHorariosHotel(supabase, hotelId),
            getTiemposEstancia(supabase, hotelId),
            getMetodosPago(supabase, hotelId)
        ]);
        
        metodosPagoExtension.unshift({ id: "mixto", nombre: "Pago Mixto" });
        const tarifaNocheUnicaExt = tiempos.find(t => t.nombre.toLowerCase().includes('noche'));
        const fechaBaseExtension = getExtensionReferenceDate(reservaActiva.fecha_fin);
        const opcionesNochesExt = crearOpcionesNochesConPersonalizada(horarios, 5, fechaBaseExtension, tarifaNocheUnicaExt, room);
        const opcionesHorasExt = Array.isArray(tiempos)
  ? tiempos
      .filter(t => Number(t.minutos) > 0 && String(t.tipo_unidad || '').toLowerCase() !== 'noche')
      .map(t => ({
        minutos: parseInt(t.minutos, 10) || 0,
        nombre: t.nombre || `${(parseInt(t.minutos, 10) || 0) / 60} hora(s)`,
        precio: Number(t.precio) || 0
      }))
      .filter(t => t.minutos > 0)
      .sort((a, b) => a.minutos - b.minutos)
  : [];


        const modalContent = document.createElement('div');
        modalContent.className = "bg-gradient-to-br from-slate-50 to-gray-100 rounded-xl shadow-2xl w-full max-w-3xl p-0 m-auto animate-fade-in-up overflow-hidden";

        const fechaFinActual = new Date(reservaActiva.fecha_fin);
        const ahora = new Date();
        const tiempoRestanteMs = fechaFinActual - ahora;
        let tiempoRestanteStr = tiempoRestanteMs > 0 ? `Tiempo restante: ${formatHorasMin(Math.floor(tiempoRestanteMs / 60000))}` : `Tiempo excedido: ${formatHorasMin(Math.floor(Math.abs(tiempoRestanteMs) / 60000))}`;

        modalContent.innerHTML = `
            <div class="flex flex-col md:flex-row">
                <div class="w-full md:w-3/5 p-6 md:p-8 space-y-5 max-h-[90vh] overflow-y-auto">
                    <div class="flex justify-between items-center">
                        <h3 class="text-2xl font-bold text-purple-700">Extender Estancia: ${room.nombre}</h3>
                        <button id="close-modal-extender" class="text-gray-400 hover:text-red-600 text-3xl leading-none">&times;</button>
                    </div>
                    <div class="text-sm text-gray-600">
                        <p>Hu\u00e9sped: <strong>${reservaActiva.cliente_nombre || 'N/A'}</strong></p>
                        <p>Salida actual: <strong>${formatDateTime(reservaActiva.fecha_fin)}</strong></p>
                        <p class="${tiempoRestanteMs > 0 ? 'text-green-600' : 'text-red-600'}">${tiempoRestanteStr}</p>
                    </div>
                    <form id="extender-form-pos" class="space-y-4">
                        <div>
                            <label class="form-label">Extender Por:</label>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 items-start">
                                <select name="noches_extender" id="select-noches-ext" class="form-control"><option value="">-- Noches --</option>${opcionesNochesExt.map(o => `<option value="${o.noches}">${o.label}</option>`).join('')}</select>
                                <select name="horas_extender" id="select-horas-ext" class="form-control"><option value="">-- Horas --</option>${opcionesHorasExt.map(o => `<option value="${o.minutos}">${o.nombre || o.label || formatHorasMin(o.minutos)}</option>`).join('')}
</select>
                            </div>
                        </div>
                        
                        <div class="pt-2 mt-2 border-t">
                            <label class="flex items-center gap-2 cursor-pointer mt-2">
                                <input type="checkbox" id="precio_libre_toggle_ext" name="precio_libre_toggle" class="form-checkbox h-5 w-5 text-indigo-600">
                                <span class="font-semibold text-sm text-indigo-700">Asignar Precio Manual a la Extensi\u00f3n</span>
                            </label>
                            <div id="precio_libre_container_ext" class="mt-2" style="display:none;">
                                <label for="precio_libre_valor_ext" class="font-semibold text-sm text-gray-700">Valor Total de la Extensi\u00f3n</label>
                                <input type="number" id="precio_libre_valor_ext" name="precio_libre_valor" class="form-control text-lg font-bold" placeholder="0">
                            </div>
                        </div>
                        <div>
                            <label for="metodo_pago_ext_id" class="form-label">M\u00e9todo de Pago (Extensi\u00f3n)</label>
                            <select required name="metodo_pago_ext_id" id="metodo_pago_ext_id" class="form-control">
                                <option value="">-- Seleccionar --</option>
                                ${metodosPagoExtension.map(mp => `<option value="${mp.id}" ${reservaActiva.metodo_pago_id === mp.id ? 'selected' : ''}>${mp.nombre}</option>`).join('')}
                            </select>
                        </div>
                        <div class="pt-3">
                            <button type="submit" class="button button-custom-purple w-full py-3 text-lg font-semibold">Confirmar Extensi\u00f3n</button>
                        </div>
                    </form>
                </div>
                <div class="w-full md:w-2/5 bg-slate-800 text-white p-6 md:p-8 flex flex-col justify-between">
                    <div>
                        <h4 class="text-2xl font-semibold text-center border-b border-slate-600 pb-3 mb-4 text-purple-400">Costo de Extensi\u00f3n</h4>
                        <div class="space-y-3 text-sm">
                            <div class="flex justify-between"><span>Extensi\u00f3n:</span> <strong id="ticket-ext-description" class="text-right">Seleccione duraci\u00f3n</strong></div>
                            <div class="flex justify-between"><span>Costo Extensi\u00f3n:</span> <strong id="ticket-ext-price" class="text-right">${formatCOP(0)}</strong></div>
                        </div>
                    </div>
                    <div class="border-t-2 border-purple-500 pt-4 mt-6">
                        <div class="flex justify-between items-center font-bold text-3xl text-green-400"><span>A PAGAR:</span><span id="ticket-ext-total-price">${formatCOP(0)}</span></div>
                        <p class="text-xs text-slate-400 mt-2">Nueva salida estimada: <strong id="nueva-salida-estimada">${formatDateTime(reservaActiva.fecha_fin)}</strong></p>
                    </div>
                </div>
            </div>
        `;
        modalContainer.appendChild(modalContent);

        const formExtEl = modalContent.querySelector('#extender-form-pos');
        const selectNochesExtEl = modalContent.querySelector('#select-noches-ext');
        const selectHorasExtEl = modalContent.querySelector('#select-horas-ext');
        const ticketExtDescEl = modalContent.querySelector('#ticket-ext-description');
        const ticketExtPriceEl = modalContent.querySelector('#ticket-ext-price');
        const ticketExtTotalEl = modalContent.querySelector('#ticket-ext-total-price');
        const nuevaSalidaEstimadaEl = modalContent.querySelector('#nueva-salida-estimada');
        
        // â–¼â–¼â–¼ BLOQUE AÃ‘ADIDO: Listeners para precio manual â–¼â–¼â–¼
        const togglePrecioLibreExtEl = modalContent.querySelector('#precio_libre_toggle_ext');
        const containerPrecioLibreExtEl = modalContent.querySelector('#precio_libre_container_ext');
        const valorPrecioLibreExtEl = modalContent.querySelector('#precio_libre_valor_ext');
        
        togglePrecioLibreExtEl.addEventListener('change', () => {
            containerPrecioLibreExtEl.style.display = togglePrecioLibreExtEl.checked ? 'block' : 'none';
            actualizarResumenTicketExtension();
        });
        valorPrecioLibreExtEl.addEventListener('input', actualizarResumenTicketExtension);
        // â–²â–²â–² FIN DEL BLOQUE AÃ‘ADIDO â–²â–²â–²

        function actualizarResumenTicketExtension() {
            const formDataExt = Object.fromEntries(new FormData(formExtEl));
            let precioExtra = 0; let descExtra = "Seleccione duraci\u00f3n"; let nuevaFechaFinExt = new Date(reservaActiva.fecha_fin);
            const nochesSelExt = parseInt(formDataExt.noches_extender) || 0;
            const minutosSelExt = parseInt(formDataExt.horas_extender) || 0;
            
            // â–¼â–¼â–¼ LÃ“GICA MODIFICADA: Ahora considera el precio manual â–¼â–¼â–¼
            const esPrecioLibre = togglePrecioLibreExtEl.checked;
            const valorPrecioLibre = parseFloat(valorPrecioLibreExtEl.value) || 0;

            if (nochesSelExt > 0) {
                nuevaFechaFinExt = calcularNuevaFechaFinExtension({
                    fechaFinActual: reservaActiva.fecha_fin,
                    noches: nochesSelExt,
                    checkoutStr: horarios.checkout
                });
                descExtra = `${nochesSelExt} noche${nochesSelExt > 1 ? 's' : ''}`;

                if (esPrecioLibre) {
                    precioExtra = valorPrecioLibre;
                    descExtra += " (Precio Manual)";
                } else {
                    precioExtra = calcularPrecioExtensionNoches(room, reservaActiva.cantidad_huespedes, nochesSelExt);
                }

            } else if (minutosSelExt > 0) {
                nuevaFechaFinExt = calcularNuevaFechaFinExtension({
                    fechaFinActual: reservaActiva.fecha_fin,
                    minutos: minutosSelExt
                });
                const tiempoSelExt = tiempos.find(t => Number(t.minutos) === minutosSelExt);
                descExtra = tiempoSelExt?.nombre || formatHorasMin(minutosSelExt);
                
                if (esPrecioLibre) {
                    precioExtra = valorPrecioLibre;
                    descExtra += " (Precio Manual)";
                } else {
                    precioExtra = tiempoSelExt?.precio || 0;
                }
            }
            
            ticketExtDescEl.textContent = descExtra;
            ticketExtPriceEl.textContent = formatCOP(precioExtra);
            ticketExtTotalEl.textContent = formatCOP(precioExtra); 
            nuevaSalidaEstimadaEl.textContent = formatDateTime(nuevaFechaFinExt);
        }

        selectNochesExtEl.onchange = () => { if (selectNochesExtEl.value) selectHorasExtEl.value = ""; actualizarResumenTicketExtension(); };
        selectHorasExtEl.onchange = () => { if (selectHorasExtEl.value) selectNochesExtEl.value = ""; actualizarResumenTicketExtension(); };
        actualizarResumenTicketExtension();

        modalContent.querySelector('#close-modal-extender').onclick = () => { modalContainer.style.display = "none"; modalContainer.innerHTML = ''; };

        formExtEl.onsubmit = async (ev) => {
            ev.preventDefault();
            const submitButton = formExtEl.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            submitButton.textContent = "Procesando...";
            try {
                const formDataExt = Object.fromEntries(new FormData(formExtEl));
                let precioExtraSubmit = 0;
                let nuevaFechaFinSubmit;
                let descExtraSubmit = "";
                let notasAdicionales = "";

            const nochesExtSubmit = parseInt(formDataExt.noches_extender) || 0;
            const minutosExtSubmit = parseInt(formDataExt.horas_extender) || 0;

            // â–¼â–¼â–¼ LÃ“GICA MODIFICADA: El submit también considera el precio manual â–¼â–¼â–¼
            const esPrecioLibreSubmit = formDataExt.precio_libre_toggle === 'on';
            const valorPrecioLibreSubmit = parseFloat(formDataExt.precio_libre_valor) || 0;

            if (nochesExtSubmit > 0) {
                nuevaFechaFinSubmit = calcularNuevaFechaFinExtension({
                    fechaFinActual: reservaActiva.fecha_fin,
                    noches: nochesExtSubmit,
                    checkoutStr: horarios.checkout
                });
                descExtraSubmit = `${nochesExtSubmit} noche(s) adicional(es)`;
                
                if (esPrecioLibreSubmit) {
                    precioExtraSubmit = valorPrecioLibreSubmit;
                    notasAdicionales = `[EXTENSI\u00d3N MANUAL: ${formatCOP(precioExtraSubmit)}]`;
                } else {
                    precioExtraSubmit = calcularPrecioExtensionNoches(room, reservaActiva.cantidad_huespedes, nochesExtSubmit);
                }

            } else if (minutosExtSubmit > 0) {
                nuevaFechaFinSubmit = calcularNuevaFechaFinExtension({
                    fechaFinActual: reservaActiva.fecha_fin,
                    minutos: minutosExtSubmit
                });
                const tiempoSelExt = tiempos.find(t => Number(t.minutos) === minutosExtSubmit);
                descExtraSubmit = tiempoSelExt?.nombre || formatHorasMin(minutosExtSubmit);

                if (esPrecioLibreSubmit) {
                    precioExtraSubmit = valorPrecioLibreSubmit;
                    notasAdicionales = `[EXTENSI\u00d3N MANUAL: ${formatCOP(precioExtraSubmit)}]`;
                } else {
                    precioExtraSubmit = tiempoSelExt?.precio || 0;
                }
            } else { 
                alert('Debe seleccionar noches o horas para extender.'); 
                submitButton.disabled = false; submitButton.textContent = "Confirmar Extensi\u00f3n";
                return; 
            }
            
            // Lógica de pago y actualización (el resto de la función no necesita cambios significativos)...
            const turnoId = turnoService.getActiveTurnId();
            if (precioExtraSubmit > 0 && !turnoId) {
                mostrarInfoModalGlobal("ACCI\u00d3N BLOQUEADA: No se puede registrar el pago de la extensi\u00f3n porque no hay un turno activo.", "Turno Requerido", [], modalContainer);
                submitButton.disabled = false; submitButton.textContent = "Confirmar Extensi\u00f3n";
                return; 
            }
            
            const handlePaymentAndDBUpdate = async (pagos) => {
                const totalPagadoExt = pagos.reduce((sum, p) => sum + p.monto, 0);
                
                const pagosParaInsertar = pagos.map(p => ({
                    hotel_id: hotelId, reserva_id: reservaActiva.id, monto: p.monto,
                    fecha_pago: new Date().toISOString(), metodo_pago_id: p.metodo_pago_id,
                    usuario_id: currentUser?.id, concepto: `Pago por extensi\u00f3n: ${descExtraSubmit} - Cliente: ${reservaActiva.cliente_nombre || 'Cliente General'}`
                }));
                const { data: pagosData, error: errPagoReserva } = await supabase.from('pagos_reserva').insert(pagosParaInsertar).select('id');
                if (errPagoReserva) throw new Error('Error registrando el pago de la extensi\u00f3n: ' + errPagoReserva.message);

                await supabase.from('servicios_x_reserva').insert({
                    hotel_id: hotelId, reserva_id: reservaActiva.id,
                    descripcion_manual: `Extensi\u00f3n: ${descExtraSubmit}`, cantidad: 1,
                    precio_cobrado: Math.round(precioExtraSubmit), estado_pago: 'pagado',
                    pago_reserva_id: pagosData[0].id, fecha_servicio: new Date().toISOString()
                });

                const nuevoMontoPagadoReserva = (reservaActiva.monto_pagado || 0) + totalPagadoExt;
                await supabase.from('reservas').update({
                    fecha_fin: nuevaFechaFinSubmit.toISOString(),
                    monto_pagado: nuevoMontoPagadoReserva,
                    estado: 'activa',
                    notas: reservaActiva.notas ? `${reservaActiva.notas}\n${notasAdicionales}` : notasAdicionales
                }).eq('id', reservaActiva.id);

                const movimientosCaja = pagos.map(p => ({
                    hotel_id: hotelId, tipo: 'ingreso', monto: p.monto,
                    concepto: `Extensi\u00f3n Hab. ${room.nombre} (${descExtraSubmit}) - Cliente: ${reservaActiva.cliente_nombre || 'Cliente General'}`,
                    fecha_movimiento: new Date().toISOString(), usuario_id: currentUser?.id,
                    reserva_id: reservaActiva.id, metodo_pago_id: p.metodo_pago_id,
                    turno_id: turnoId, pago_reserva_id: pagosData[pagos.indexOf(p)].id
                }));
                await supabase.from('caja').insert(movimientosCaja);
            };

            const finalizarExtension = async () => {
                const { data: cronoAct } = await supabase
                    .from('cronometros')
                    .select('id')
                    .eq('reserva_id', reservaActiva.id)
                    .eq('habitacion_id', room.id)
                    .eq('activo', true)
                    .order('id', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (cronoAct?.id) {
                    await supabase
                        .from('cronometros')
                        .update({ fecha_fin: nuevaFechaFinSubmit.toISOString(), activo: true })
                        .eq('id', cronoAct.id);
                } else {
                    await supabase.from('cronometros').insert({
                        hotel_id: hotelId,
                        reserva_id: reservaActiva.id,
                        habitacion_id: room.id,
                        fecha_inicio: reservaActiva.fecha_inicio || new Date().toISOString(),
                        fecha_fin: nuevaFechaFinSubmit.toISOString(),
                        activo: true
                    });
                }

                await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', room.id);
                modalContainer.style.display = "none";
                modalContainer.innerHTML = '';
                document.dispatchEvent(new CustomEvent('renderRoomsComplete', { detail: { action: 'refresh' } }));
            };

            if (precioExtraSubmit > 0) {
                 const metodoPagoSeleccionado = formDataExt.metodo_pago_ext_id;
                 if(metodoPagoSeleccionado === 'mixto'){
                    showPagoMixtoModal(precioExtraSubmit, metodosPagoExtension, async (pagosMixtos) => {
                        await handlePaymentAndDBUpdate(pagosMixtos);
                        await finalizarExtension();
                    });
                    return;
                 } else {
                    await handlePaymentAndDBUpdate([{ metodo_pago_id: metodoPagoSeleccionado, monto: precioExtraSubmit }]);
                 }
            } else {
                 await supabase.from('reservas').update({
                    fecha_fin: nuevaFechaFinSubmit.toISOString(), estado: 'activa'
                }).eq('id', reservaActiva.id);
            }

                await finalizarExtension();
            } catch (error) {
                console.error("Error procesando la extensi\u00f3n:", error);
                mostrarInfoModalGlobal(error.message || "No se pudo registrar la extensi\u00f3n.", "Error de Extensi\u00f3n", [], modalContainer);
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = "Confirmar Extensi\u00f3n";
            }
};
    } catch (err) {
        console.error("Error preparando modal de extensi\u00f3n:", err);
        mostrarInfoModalGlobal("Error al preparar el modal de extensi\u00f3n: " + (err.message || "Error desconocido"), "Error Cr\u00edtico", [], modalContainer);
    }
}

export async function facturarElectronicaYMostrarResultado(payloadOrReservaId, montoTotal, hotelId, supabase) {
    const payload = (payloadOrReservaId && typeof payloadOrReservaId === 'object' && !Array.isArray(payloadOrReservaId))
        ? payloadOrReservaId
        : {
            reserva: { id: payloadOrReservaId, monto_total: montoTotal },
            hotelId,
            supabase
        };

    const {
        supabase: supabaseClient,
        hotelId: hotelIdFinal,
        reserva,
        consumosTienda = [],
        consumosRest = [],
        consumosServicios = []
    } = payload;

    if (!supabaseClient || !hotelIdFinal || !reserva) {
        throw new Error('Faltan datos para generar la factura o el ticket.');
    }

    try {
        const { data: config } = await supabaseClient
            .from('configuracion_hotel')
            .select('*')
            .eq('hotel_id', hotelIdFinal)
            .maybeSingle();

        const itemsParaTicket = [];

        if (Number(reserva.monto_total) > 0) {
            itemsParaTicket.push({
                nombre: `Alojamiento: ${reserva.habitacion_nombre || 'Habitaci\u00f3n'}`,
                cantidad: 1,
                precioUnitario: Number(reserva.monto_total),
                total: Number(reserva.monto_total)
            });
        }

        [...consumosTienda, ...consumosRest, ...consumosServicios].forEach((item) => {
            const cantidad = Number(item.cantidad) || 1;
            const total = Number(item.subtotal ?? item.total ?? item.precio_cobrado ?? 0);
            if (cantidad <= 0 || total <= 0) return;

            itemsParaTicket.push({
                nombre: item.nombre || item.descripcion_manual || 'Consumo',
                cantidad,
                precioUnitario: total / cantidad,
                total
            });
        });

        const totalFactura = itemsParaTicket.reduce((sum, item) => sum + Number(item.total || 0), 0);
        const datosTicket = {
            cliente: {
                nombre: reserva.cliente_nombre || 'Cliente General',
                documento: reserva.cedula || ''
            },
            reservaId: reserva.id,
            habitacionNombre: reserva.habitacion_nombre || '',
            items: itemsParaTicket,
            total: totalFactura,
            totalPagado: Number(reserva.monto_pagado || 0),
            impuestos: 0,
            descuento: Number(reserva.monto_descontado || 0),
            subtotal: totalFactura
        };

        imprimirFacturaPosAdaptable(config || {}, datosTicket);
        return { success: true, mensaje: 'Ticket generado correctamente' };
    } catch (err) {
        console.error('Error generando ticket POS:', err);
        return { success: false, error: err.message };
    }
    // Para simplificar la refactorización, si existe DIAN
}

// --- FUNCIONES RECUPERADAS ---
export async function imprimirConsumosHabitacion(supabase, hotelId, datosTicket) {
  try {
    // 1. Cargamos la configuración del hotel para saber el tamaño de papel y datos fiscales
    const { data: config, error } = await supabase
      .from('configuracion_hotel')
      .select('*')
      .eq('hotel_id', hotelId)
      .maybeSingle();

    if (error) {
      console.error("Error cargando configuraci\u00f3n para imprimir:", error);
      alert("Error cargando configuraci\u00f3n de impresi\u00f3n.");
      return;
    }

    // 2. Llamamos a la función de construcción de HTML adaptable (estilo POS)
    imprimirFacturaPosAdaptable(config, datosTicket);

  } catch (err) {
    console.error("Error en imprimirConsumosHabitacion:", err);
    alert("Ocurri\u00f3 un error al intentar generar la factura.");
  }
}

export function imprimirFacturaPosAdaptable(config, datos) {
  // 1. Detectar configuración de papel
  let tamano = (config?.tamano_papel || '80mm').toLowerCase();
  const esTermica = tamano === '58mm' || tamano === '80mm';
  
  // Ajustes de ancho y fuente
  const widthPage = tamano === '58mm' ? '58mm' : (tamano === '80mm' ? '74mm' : '100%');
  const fontSize = tamano === '58mm' ? '10px' : (tamano === '80mm' ? '11px' : '12px');
  // En impresoras térmicas, el width 100% a veces falla, mejor fixed mm. En carta usamos 800px max.
  const containerMaxWidth = esTermica ? '100%' : '800px'; 

  // 2. Datos del Encabezado
  let logoUrl = config?.mostrar_logo !== false && config?.logo_url ? config.logo_url : null;
  let hotelNombre = config?.nombre_hotel || 'Hotel';
  let direccion = config?.direccion_fiscal || '';
  let nit = config?.nit_rut || '';
  let telefono = config?.telefono_fiscal || '';
  let pie = config?.pie_ticket || 'Gracias por su visita.';
  let resolucion = config?.encabezado_ticket_l1 || ''; 

  // 3. Datos del Cliente y Reserva
  const clienteNombre = datos.cliente?.nombre || 'Consumidor Final';
  const clienteDoc = datos.cliente?.documento || '';
  const fechaEmision = new Date().toLocaleString('es-CO');
  const reservaId = datos.reservaId ? datos.reservaId.split('-')[0].toUpperCase() : '---';
  const habitacion = datos.habitacionNombre || 'General';

  // 4. CSS
  let style = `
    @page { margin: ${esTermica ? '0' : '15mm'}; size: auto; }
    body { 
        font-family: 'Courier New', Courier, monospace; 
        font-size: ${fontSize}; 
        margin: 0; 
        padding: ${esTermica ? '2px' : '20px'}; 
        width: ${esTermica ? widthPage : 'auto'}; 
        color: #000;
        background: #fff;
    }
    .container { width: 100%; max-width: ${containerMaxWidth}; margin: 0 auto; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: bold; }
    .mb-1 { margin-bottom: 5px; }
    .border-bottom { border-bottom: 1px dashed #000; padding-bottom: 5px; margin-bottom: 5px; }
    .border-top { border-top: 1px dashed #000; padding-top: 5px; margin-top: 5px; }
    
    table { width: 100%; border-collapse: collapse; margin-top: 5px; }
    th { border-bottom: 1px solid #000; padding: 2px 0; font-size: 0.9em; text-align: left; }
    td { padding: 2px 0; vertical-align: top; }
    
    .col-cant { width: 15%; text-align: center; }
    .col-desc { width: 55%; text-align: left; }
    .col-total { width: 30%; text-align: right; }
    
    @media print { .no-print { display: none; } }
  `;

  // 5. HTML Contenido
  let headerHtml = `
    <div class="text-center mb-1">
      ${logoUrl ? `<img src="${logoUrl}" style="max-width: 50%; max-height: 60px; filter: grayscale(100%); margin-bottom:2px;">` : ''}
      <div class="bold" style="font-size: 1.1em;">${hotelNombre}</div>
      <div>NIT: ${nit}</div>
      <div>${direccion}</div>
      ${telefono ? `<div>Tel: ${telefono}</div>` : ''}
      ${resolucion ? `<div style="font-size:0.8em; margin-top:2px;">${resolucion}</div>` : ''}
    </div>
    
    <div class="border-bottom mb-1">
        <div class="bold text-center">FACTURA POS / CUENTA</div>
        <div style="display:flex; justify-content:space-between;"><span>F: ${fechaEmision}</span></div>
        <div style="display:flex; justify-content:space-between;"><span>Reserva: #${reservaId}</span></div>
        <div style="display:flex; justify-content:space-between;"><span>Hab: <b>${habitacion}</b></span></div>
    </div>

    <div class="border-bottom mb-1">
        <div><b>Cliente:</b> ${clienteNombre}</div>
        ${clienteDoc ? `<div><b>ID:</b> ${clienteDoc}</div>` : ''}
    </div>
  `;

  // Items
  let itemsHtml = '';
  if (datos.items && datos.items.length > 0) {
      const filas = datos.items.map(item => `
        <tr>
            <td class="col-cant">${item.cantidad}</td>
            <td class="col-desc">${item.nombre}</td>
            <td class="col-total">${formatCOP(item.total)}</td>
        </tr>
      `).join('');
      itemsHtml = `<table><thead><tr><th class="col-cant">Cant</th><th class="col-desc">Desc</th><th class="col-total">Total</th></tr></thead><tbody>${filas}</tbody></table>`;
  } else {
      itemsHtml = '<div class="text-center">Sin \u00edtems.</div>';
  }

  // Totales
  const total = datos.total || 0;
  const pagado = datos.totalPagado || 0;
  const saldo = total - pagado;

  let footerHtml = `
    <div class="border-top mt-2">
        <div style="display:flex; justify-content:space-between; font-size:1.1em;" class="bold">
            <span>TOTAL:</span><span>${formatCOP(total)}</span>
        </div>
        ${pagado > 0 ? `<div style="display:flex; justify-content:space-between;"><span>Pagado:</span><span>${formatCOP(pagado)}</span></div>` : ''}
        ${saldo > 0 ? `<div style="display:flex; justify-content:space-between; color:red;" class="bold"><span>PENDIENTE:</span><span>${formatCOP(saldo)}</span></div>` : ''}
        ${saldo <= 0 ? `<div class="text-center bold" style="margin-top:5px;">\u00a1GRACIAS POR SU PAGO!</div>` : ''}
    </div>
    <div class="text-center mt-2" style="font-size:0.85em;">${pie}</div>
  `;

  let fullHtml = `<html><head><title>Imprimir</title><style>${style}</style></head><body><div class="container">${headerHtml}${itemsHtml}${footerHtml}</div><script>window.onload=function(){window.print();window.focus();}</script></body></html>`;

  let w = window.open('', '_blank', `width=${esTermica?400:800},height=600`);
  w.document.write(fullHtml);
  w.document.close();
}
