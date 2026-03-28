import { formatCurrency, formatDateTime } from '../../uiUtils.js';
import { applyPricingRule } from './reservas-operacion.js';

export function calculateFechasEstancia(
  fechaEntradaStr,
  tipoCalculo,
  cantidadNochesStr,
  tiempoEstanciaId,
  checkoutHoraConfig,
  tiemposEstanciaDisponibles = []
) {
  const fechaEntrada = new Date(fechaEntradaStr);
  if (Number.isNaN(fechaEntrada.getTime())) {
    return { errorFechas: 'La fecha de entrada no es valida.' };
  }

  let fechaSalida;
  let cantidadDuracionOriginal;
  const tipoDuracionOriginal = tipoCalculo;

  if (tipoCalculo === 'noches_manual') {
    cantidadDuracionOriginal = parseInt(cantidadNochesStr, 10) || 1;
    if (cantidadDuracionOriginal < 1) {
      return { errorFechas: 'La cantidad de noches debe ser al menos 1.' };
    }

    fechaSalida = new Date(fechaEntrada);
    fechaSalida.setDate(fechaSalida.getDate() + cantidadDuracionOriginal);
    const [hh, mm] = (checkoutHoraConfig || '12:00').split(':').map(Number);
    fechaSalida.setHours(hh, mm, 0, 0);
  } else {
    if (!tiempoEstanciaId) {
      return { errorFechas: 'No se selecciono un tiempo de estancia.' };
    }

    const tiempo = tiemposEstanciaDisponibles.find((item) => item.id === tiempoEstanciaId);
    if (!tiempo || typeof tiempo.minutos !== 'number' || tiempo.minutos <= 0) {
      return { errorFechas: 'Tiempo de estancia predefinido invalido.' };
    }

    cantidadDuracionOriginal = tiempo.minutos;
    fechaSalida = new Date(fechaEntrada.getTime() + (tiempo.minutos * 60 * 1000));
  }

  if (fechaSalida <= fechaEntrada) {
    return { errorFechas: 'La fecha de salida debe ser posterior a la de llegada.' };
  }

  return { fechaEntrada, fechaSalida, tipoDuracionOriginal, cantidadDuracionOriginal, errorFechas: null };
}

export function calculateMontos({
  habitacionInfo,
  huespedes,
  tipoDuracion,
  cantDuracion,
  tiempoId,
  precioLibreActivado,
  precioLibreValor,
  tiemposEstanciaDisponibles = [],
  descuentoAplicado = null,
  configHotel = {},
  pricingRules = [],
  origenReserva = 'directa',
  fechaEntrada = null
}) {
  if (!habitacionInfo) {
    return { errorMonto: 'Informacion de habitacion no disponible.' };
  }

  let montoEstanciaBaseBruto = 0;
  let montoPorHuespedesAdicionales = 0;
  let montoDescontado = 0;
  let totalAntesDeImpuestos;
  let appliedPricingRule = null;

  if (precioLibreActivado && typeof precioLibreValor === 'number' && precioLibreValor >= 0) {
    montoEstanciaBaseBruto = precioLibreValor;
    totalAntesDeImpuestos = precioLibreValor;
  } else {
    if (tipoDuracion === 'noches_manual') {
      let precioNocheUnitario = 0;

      if (huespedes === 1 && habitacionInfo.precio_1_persona > 0) {
        precioNocheUnitario = habitacionInfo.precio_1_persona;
      } else if (huespedes >= 2 && habitacionInfo.precio_2_personas > 0) {
        precioNocheUnitario = habitacionInfo.precio_2_personas;
      } else {
        precioNocheUnitario = habitacionInfo.precio_general || 0;
      }

      montoEstanciaBaseBruto = precioNocheUnitario * cantDuracion;
      const baseOcupacion = habitacionInfo.capacidad_base || 2;
      if (huespedes > baseOcupacion) {
        const extraHuespedes = huespedes - baseOcupacion;
        montoPorHuespedesAdicionales = extraHuespedes * (habitacionInfo.precio_huesped_adicional || 0) * cantDuracion;
      }
    } else {
      const tiempo = tiemposEstanciaDisponibles.find((item) => item.id === tiempoId);
      if (tiempo && typeof tiempo.precio === 'number' && tiempo.precio >= 0) {
        montoEstanciaBaseBruto = tiempo.precio;
      } else {
        return { errorMonto: 'Precio no definido para el tiempo seleccionado.' };
      }
    }

    const pricingResult = applyPricingRule(montoEstanciaBaseBruto, pricingRules, {
      fechaEntrada,
      origenReserva,
      tipoDuracion,
      habitacionId: habitacionInfo.id,
      tipoHabitacionId: habitacionInfo.tipo_habitacion_id
    });

    montoEstanciaBaseBruto = pricingResult.adjustedBaseAmount;
    appliedPricingRule = pricingResult.appliedRule;

    const totalAntesDeDescuento = montoEstanciaBaseBruto + montoPorHuespedesAdicionales;
    if (descuentoAplicado) {
      if (descuentoAplicado.tipo === 'fijo') {
        montoDescontado = parseFloat(descuentoAplicado.valor);
      } else if (descuentoAplicado.tipo === 'porcentaje') {
        montoDescontado = totalAntesDeDescuento * (parseFloat(descuentoAplicado.valor) / 100);
      }
    }

    montoDescontado = Math.min(totalAntesDeDescuento, montoDescontado);
    totalAntesDeImpuestos = totalAntesDeDescuento - montoDescontado;
  }

  let montoImpuestoCalculado = 0;
  let baseImponibleFinal = totalAntesDeImpuestos;

  if (configHotel.impuestos_incluidos_en_precios && configHotel.porcentaje_impuesto_principal > 0) {
    baseImponibleFinal = totalAntesDeImpuestos / (1 + (configHotel.porcentaje_impuesto_principal / 100));
    montoImpuestoCalculado = totalAntesDeImpuestos - baseImponibleFinal;
  } else if (configHotel.porcentaje_impuesto_principal > 0) {
    montoImpuestoCalculado = baseImponibleFinal * (configHotel.porcentaje_impuesto_principal / 100);
  }

  return {
    montoEstanciaBase: Math.round(montoEstanciaBaseBruto),
    montoPorHuespedesAdicionales: Math.round(montoPorHuespedesAdicionales),
    montoDescontado: Math.round(montoDescontado),
    montoImpuesto: Math.round(montoImpuestoCalculado),
    baseSinImpuestos: Math.round(baseImponibleFinal),
    appliedPricingRule,
    errorMonto: null
  };
}

export async function validateAndCalculateBooking({
  formData,
  state,
  updateTotalDisplay
}) {
  const habitacionInfo = formData.habitacion_info_dom;
  if (!habitacionInfo) {
    throw new Error('Seleccione una habitacion valida para calcular.');
  }

  const {
    fechaEntrada,
    fechaSalida,
    tipoDuracionOriginal,
    cantidadDuracionOriginal,
    errorFechas
  } = calculateFechasEstancia(
    formData.fecha_entrada,
    formData.tipo_calculo_duracion,
    formData.cantidad_noches,
    formData.tiempo_estancia_id,
    state.configHotel.checkout_hora_config,
    state.tiemposEstanciaDisponibles
  );
  if (errorFechas) throw new Error(errorFechas);

  const {
    montoDescontado,
    montoImpuesto,
    baseSinImpuestos,
    appliedPricingRule,
    errorMonto
  } = calculateMontos({
    habitacionInfo,
    huespedes: parseInt(formData.cantidad_huespedes, 10),
    tipoDuracion: tipoDuracionOriginal,
    cantDuracion: cantidadDuracionOriginal,
    tiempoId: formData.tiempo_estancia_id,
    precioLibreActivado: formData.precio_libre_toggle,
    precioLibreValor: parseFloat(formData.precio_libre_valor),
    tiemposEstanciaDisponibles: state.tiemposEstanciaDisponibles,
    descuentoAplicado: state.descuentoAplicado,
    configHotel: state.configHotel,
    pricingRules: state.pricingRules || [],
    origenReserva: formData.origen_reserva || 'directa',
    fechaEntrada
  });

  if (errorMonto) throw new Error(errorMonto);

  state.currentBookingTotal = baseSinImpuestos + montoImpuesto;
  state.currentPricingRule = appliedPricingRule || null;
  if (typeof updateTotalDisplay === 'function') {
    updateTotalDisplay(montoDescontado);
  }

  const HORAS_BLOQUEO_PREVIO = 3;
  let queryProxima = state.supabase
    .from('reservas')
    .select('id, fecha_inicio')
    .eq('habitacion_id', formData.habitacion_id)
    .in('estado', ['reservada', 'confirmada', 'activa'])
    .gte('fecha_inicio', fechaEntrada.toISOString());

  if (state.isEditMode && state.editingReservaId) {
    queryProxima = queryProxima.neq('id', state.editingReservaId);
  }

  const { data: proximaReserva } = await queryProxima
    .order('fecha_inicio', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (proximaReserva) {
    const inicioProximaReserva = new Date(proximaReserva.fecha_inicio);
    const inicioBloqueo = new Date(inicioProximaReserva.getTime() - HORAS_BLOQUEO_PREVIO * 60 * 60 * 1000);
    if (fechaSalida > inicioBloqueo) {
      throw new Error(`Conflicto: Se cruza con una reserva futura (Inicia: ${formatDateTime(inicioProximaReserva)}).`);
    }
  }

  try {
    const { data: hayCruce } = await state.supabase.rpc('validar_cruce_reserva', {
      p_habitacion_id: formData.habitacion_id,
      p_entrada: fechaEntrada.toISOString(),
      p_salida: fechaSalida.toISOString(),
      p_reserva_id_excluida: state.isEditMode ? state.editingReservaId : null
    });

    if (hayCruce === true) {
      throw new Error('Conflicto: La habitacion NO esta disponible para estas fechas.');
    }
  } catch (error) {
    console.warn('Validacion de cruce RPC omitida o fallida:', error.message);
  }

  let notasFinales = formData.notas.trim() || null;
  if (formData.precio_libre_toggle) {
    const precioManualStr = `[PRECIO MANUAL: ${formatCurrency(parseFloat(formData.precio_libre_valor), state.configHotel?.moneda_local_simbolo)}]`;
    notasFinales = notasFinales ? `${precioManualStr} ${notasFinales}` : precioManualStr;
  }
  if (appliedPricingRule?.label) {
    const pricingStr = `[TARIFA DINAMICA: ${appliedPricingRule.label}]`;
    notasFinales = notasFinales ? `${pricingStr} ${notasFinales}` : pricingStr;
  }

  const datosReserva = {
    cliente_id: formData.cliente_id,
    cliente_nombre: formData.cliente_nombre.trim(),
    cedula: formData.cedula.trim() || null,
    telefono: formData.telefono.trim() || null,
    cantidad_huespedes: parseInt(formData.cantidad_huespedes, 10),
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
    origen_reserva: formData.origen_reserva || 'directa',
    id_temporal_o_final: state.isEditMode ? state.editingReservaId : `TEMP-${Date.now()}`
  };

  const datosPago = {
    monto_abono: parseFloat(formData.monto_abono) || 0,
    metodo_pago_id: formData.metodo_pago_id || null,
    tipo_pago: formData.tipo_pago
  };

  return { datosReserva, datosPago, appliedPricingRule };
}
