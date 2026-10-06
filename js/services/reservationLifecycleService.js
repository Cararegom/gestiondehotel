import {
  buildOperationScope,
  completeStableOperation,
  getStableOperationId
} from './fase1OperationService.js';

const ERROR_MESSAGES = [
  [/A13_HABITACION_(NO_DISPONIBLE|CON_ESTANCIA_ACTIVA|CAMBIO_DURANTE_CREACION)/i, 'La habitacion ya no esta libre. Actualiza el mapa y vuelve a intentarlo.'],
  [/A13_CLIENTE_NO_AUTORIZADO/i, 'El cliente seleccionado no pertenece a este hotel o ya no esta activo.'],
  [/A13_TIEMPO_ESTANCIA_NO_AUTORIZADO/i, 'La tarifa seleccionada ya no esta disponible para este hotel.'],
  [/A13_METODO_PAGO_NO_AUTORIZADO|Metodo de pago invalido/i, 'El metodo de pago seleccionado ya no esta disponible.'],
  [/A13_DESCUENTO_NO_DISPONIBLE/i, 'El descuento seleccionado vencio, se agoto o ya no esta activo.'],
  [/A13_TURNO_REQUERIDO_PARA_PAGOS|Turno activo propio del hotel requerido/i, 'Debes tener un turno de caja abierto para registrar el cobro.'],
  [/A14_HABITACION_(NO_DISPONIBLE_PARA_CHECKIN|CON_ESTANCIA_ACTIVA)/i, 'La habitacion ya no esta disponible para realizar el check-in.'],
  [/A14_RESERVA_NO_DISPONIBLE_PARA_CHECKIN/i, 'La reserva ya no esta en un estado valido para realizar el check-in.'],
  [/A14_RESERVA_NO_DISPONIBLE_PARA_CHECKOUT/i, 'La reserva ya no esta activa para realizar el check-out.'],
  [/A14_HABITACION_NO_DISPONIBLE_PARA_CHECKOUT/i, 'La habitacion no esta en un estado valido para realizar el check-out.'],
  [/A14_LIMPIEZA_FORZADA_RESERVA_ACTIVA/i, 'No se puede forzar la limpieza porque la habitacion aun tiene una reserva activa.'],
  [/A14_LIMPIEZA_FORZADA_ESTADO_INVALIDO/i, 'La habitacion ya no necesita una limpieza forzada.'],
  [/A13_HOTEL_NO_AUTORIZADO|A14_(RESERVA|HABITACION)_NO_AUTORIZADA/i, 'No tienes acceso a esta operacion del hotel.'],
  [/A13_AUTENTICACION_REQUERIDA|A14_AUTENTICACION_REQUERIDA/i, 'Tu sesion ya no es valida. Inicia sesion nuevamente.']
];

export function getReservationLifecycleErrorMessage(error, fallback = 'No se pudo completar la operacion de la estancia.') {
  const rawMessage = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ');
  const match = ERROR_MESSAGES.find(([pattern]) => pattern.test(rawMessage));
  return match?.[1] || rawMessage || fallback;
}

function throwLifecycleError(error, fallback) {
  const wrapped = new Error(getReservationLifecycleErrorMessage(error, fallback));
  wrapped.cause = error;
  throw wrapped;
}

function requireResult(data, key, fallback) {
  if (!data || (key && !data[key])) throw new Error(fallback);
  return data;
}

export async function crearEstanciaAtomica(supabase, {
  reserva,
  pagos = [],
  turnoId = null,
  conceptoPago = 'Pago de reserva',
  occurredAt = new Date().toISOString()
}) {
  const scope = buildOperationScope('estancia-crear', {
    hotelId: reserva?.hotel_id,
    habitacionId: reserva?.habitacion_id,
    clienteId: reserva?.cliente_id || null,
    clienteNombre: reserva?.cliente_nombre,
    fechaInicio: reserva?.fecha_inicio,
    fechaFin: reserva?.fecha_fin
  });
  const paymentScopes = pagos.map((pago, index) => buildOperationScope('estancia-pago', {
    parent: scope,
    index,
    metodoPagoId: pago.metodo_pago_id,
    monto: pago.monto
  }));
  const pagosConOperacion = pagos.map((pago, index) => ({
    metodo_pago_id: pago.metodo_pago_id,
    monto: pago.monto,
    client_operation_id: getStableOperationId(paymentScopes[index])
  }));

  const { data, error } = await supabase.rpc('crear_estancia_atomica', {
    p_reserva: reserva,
    p_client_operation_id: getStableOperationId(scope),
    p_pagos: pagosConOperacion,
    p_turno_id: turnoId,
    p_concepto_pago: conceptoPago,
    p_occurred_at: occurredAt
  });
  if (error) throwLifecycleError(error, 'No se pudo registrar la estancia.');
  requireResult(data, 'reserva', 'La operacion no devolvio la reserva creada.');
  completeStableOperation(scope);
  paymentScopes.forEach(completeStableOperation);
  return data.reserva;
}

export async function realizarCheckinReservaAtomico(supabase, reservaId, startedAt = new Date().toISOString()) {
  const scope = buildOperationScope('reserva-checkin', { reservaId });
  const { data, error } = await supabase.rpc('realizar_checkin_reserva_atomico', {
    p_reserva_id: reservaId,
    p_client_operation_id: getStableOperationId(scope),
    p_started_at: startedAt
  });
  if (error) throwLifecycleError(error, 'No se pudo realizar el check-in.');
  requireResult(data, 'reserva', 'El check-in no devolvio la reserva actualizada.');
  completeStableOperation(scope);
  return data;
}

export async function finalizarEstanciaReservaAtomica(supabase, {
  reservaId,
  finishedAt = new Date().toISOString(),
  montoPagadoFinal = null,
  estadoFinal = 'completada'
}) {
  const scope = buildOperationScope('reserva-checkout', { reservaId, estadoFinal });
  const { data, error } = await supabase.rpc('finalizar_estancia_reserva_atomica', {
    p_reserva_id: reservaId,
    p_client_operation_id: getStableOperationId(scope),
    p_finished_at: finishedAt,
    p_monto_pagado_final: montoPagadoFinal,
    p_estado_final: estadoFinal
  });
  if (error) throwLifecycleError(error, 'No se pudo realizar el check-out.');
  requireResult(data, 'reserva', 'El check-out no devolvio la reserva actualizada.');
  completeStableOperation(scope);
  return data;
}

export async function forzarLimpiezaHabitacionAtomica(supabase, habitacionId, finishedAt = new Date().toISOString()) {
  const scope = buildOperationScope('habitacion-limpieza-forzada', { habitacionId });
  const { data, error } = await supabase.rpc('forzar_limpieza_habitacion_atomica', {
    p_habitacion_id: habitacionId,
    p_client_operation_id: getStableOperationId(scope),
    p_finished_at: finishedAt
  });
  if (error) throwLifecycleError(error, 'No se pudo enviar la habitacion a limpieza.');
  requireResult(data, 'habitacion', 'La operacion no devolvio la habitacion actualizada.');
  completeStableOperation(scope);
  return data;
}
