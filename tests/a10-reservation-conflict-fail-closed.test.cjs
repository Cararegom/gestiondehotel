const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const projectRoot = resolve(__dirname, '..');

async function loadReservasCalculos() {
  const modulePath = resolve(projectRoot, 'js/modules/reservas/reservas-calculos.js');
  return import(`${pathToFileURL(modulePath).href}?a10=${Date.now()}-${Math.random()}`);
}

async function loadReservasFormulario() {
  const modulePath = resolve(projectRoot, 'js/modules/reservas/reservas-formulario.js');
  return import(`${pathToFileURL(modulePath).href}?a10=${Date.now()}-${Math.random()}`);
}

const availabilityInput = {
  habitacionId: 'habitacion-a',
  fechaEntrada: '2026-09-13T20:00:00.000Z',
  fechaSalida: '2026-09-14T17:00:00.000Z',
  reservaIdExcluida: 'reserva-editada'
};

test('A10 permite continuar solo cuando el RPC confirma que no existe cruce', async () => {
  const { assertBookingAvailability } = await loadReservasCalculos();
  let rpcCall;
  const supabase = {
    rpc: async (name, params) => {
      rpcCall = { name, params };
      return { data: false, error: null };
    }
  };

  await assert.doesNotReject(() => assertBookingAvailability({ supabase, ...availabilityInput }));
  assert.deepEqual(rpcCall, {
    name: 'validar_cruce_reserva',
    params: {
      p_habitacion_id: 'habitacion-a',
      p_entrada: '2026-09-13T20:00:00.000Z',
      p_salida: '2026-09-14T17:00:00.000Z',
      p_reserva_id_excluida: 'reserva-editada'
    }
  });
});

test('A10 conserva el conflicto real y no lo transforma en un fallo tecnico', async () => {
  const { assertBookingAvailability, BOOKING_CONFLICT_ERROR } = await loadReservasCalculos();
  const supabase = { rpc: async () => ({ data: true, error: null }) };

  await assert.rejects(
    () => assertBookingAvailability({ supabase, ...availabilityInput }),
    (error) => error.message === BOOKING_CONFLICT_ERROR
  );
});

test('A10 bloquea y reporta una respuesta de error del RPC sin filtrar detalles', async () => {
  const { assertBookingAvailability, BOOKING_AVAILABILITY_CHECK_ERROR } = await loadReservasCalculos();
  const previousMonitoring = globalThis.HotelMonitoring;
  const captured = [];
  globalThis.HotelMonitoring = {
    captureException: (error, context) => captured.push({ error, context })
  };

  try {
    const supabase = {
      rpc: async () => ({
        data: null,
        error: new Error('timeout reserva Ana Perez cedula 123456789')
      })
    };

    await assert.rejects(
      () => assertBookingAvailability({ supabase, ...availabilityInput }),
      (error) => error.message === BOOKING_AVAILABILITY_CHECK_ERROR
    );

    assert.equal(captured.length, 1);
    assert.equal(captured[0].error.message, 'reservas.booking_conflict_validation_failed');
    assert.deepEqual(captured[0].context, {
      source: 'reservas',
      eventType: 'booking_conflict_validation_failed'
    });
    assert.equal(JSON.stringify(captured).includes('Ana Perez'), false);
    assert.equal(JSON.stringify(captured).includes('123456789'), false);
  } finally {
    if (previousMonitoring === undefined) delete globalThis.HotelMonitoring;
    else globalThis.HotelMonitoring = previousMonitoring;
  }
});

test('A10 bloquea tanto una excepcion de red como una respuesta no booleana', async () => {
  const { assertBookingAvailability, BOOKING_AVAILABILITY_CHECK_ERROR } = await loadReservasCalculos();
  const rejectedRpc = { rpc: async () => { throw new Error('network down'); } };
  const invalidRpc = { rpc: async () => ({ data: null, error: null }) };

  for (const supabase of [rejectedRpc, invalidRpc]) {
    await assert.rejects(
      () => assertBookingAvailability({ supabase, ...availabilityInput }),
      (error) => error.message === BOOKING_AVAILABILITY_CHECK_ERROR
    );
  }
});

test('A10 impide createBooking y muestra el error cuando falla la validacion', async () => {
  const { submitReservaForm } = await loadReservasFormulario();
  const expectedMessage = 'No se pudo verificar la disponibilidad de la habitacion. Intente nuevamente.';
  let createCalls = 0;
  let updateCalls = 0;
  const shownErrors = [];
  const loadingStates = [];
  const form = { elements: { metodo_pago_id: { value: '' } } };

  await submitReservaForm({
    event: { preventDefault() {} },
    ui: { form, feedbackDiv: {}, submitButton: { textContent: 'Registrar' } },
    state: { isEditMode: false, configHotel: { cobro_al_checkin: false } },
    turnoService: { getActiveTurnId: () => null },
    setFormLoadingState: (_form, loading) => loadingStates.push(loading),
    clearFeedback() {},
    showError: (_target, message) => shownErrors.push(message),
    showSuccess() {},
    validateAndCalculateBooking: async () => { throw new Error(expectedMessage); },
    createBooking: async () => { createCalls += 1; },
    updateBooking: async () => { updateCalls += 1; },
    showPagoMixtoModal() {},
    showReservaSuccessModal() {},
    renderReservas() {},
    resetFormToCreateMode() {},
    gatherFormData: () => ({ metodo_pago_id: '', tipo_pago: 'parcial', monto_abono: '0' }),
    validateInitialInputs() {}
  });

  assert.equal(createCalls, 0);
  assert.equal(updateCalls, 0);
  assert.deepEqual(shownErrors, [expectedMessage]);
  assert.deepEqual(loadingStates, [true, false]);
});

test('A10 conecta las rutas activa y legada con la misma validacion fail-closed', () => {
  const calculos = readFileSync(resolve(projectRoot, 'js/modules/reservas/reservas-calculos.js'), 'utf8');
  const reservas = readFileSync(resolve(projectRoot, 'js/modules/reservas/reservas.js'), 'utf8');

  assert.match(calculos, /rpcResult\?\.error/);
  assert.match(calculos, /typeof rpcResult\?\.data !== 'boolean'/);
  assert.match(calculos, /await assertBookingAvailability\s*\(/);
  assert.doesNotMatch(calculos, /const \{ data: hayCruce \} = await state\.supabase\.rpc/);

  assert.match(reservas, /assertBookingAvailability as assertBookingAvailabilityModule/);
  assert.match(reservas, /await assertBookingAvailabilityModule\s*\(/);
  assert.doesNotMatch(reservas, /Ignoramos errores de RPC faltante/);
});
