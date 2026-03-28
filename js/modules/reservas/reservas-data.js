import {
  formatCurrency,
  formatMinutesToHoursMinutes
} from '../../uiUtils.js';

export async function cargarHabitaciones({
  supabase,
  hotelId,
  ui,
  state
}) {
  if (!ui?.habitacionIdSelect) return;

  ui.habitacionIdSelect.innerHTML = '<option value="">Cargando habitaciones...</option>';
  ui.habitacionIdSelect.disabled = true;

  const { data: rooms, error } = await supabase
    .from('habitaciones')
    .select('id, nombre, tipo, estado, precio, capacidad_base, capacidad_maxima, precio_huesped_adicional, precio_1_persona, precio_2_personas, tipo_habitacion_id')
    .eq('hotel_id', hotelId)
    .eq('activo', true)
    .order('nombre', { ascending: true });

  if (error) {
    ui.habitacionIdSelect.innerHTML = '<option value="">Error al cargar</option>';
    ui.habitacionIdSelect.disabled = false;
    return;
  }

  if (!rooms || rooms.length === 0) {
    ui.habitacionIdSelect.innerHTML = '<option value="">No hay habitaciones</option>';
    ui.habitacionIdSelect.disabled = false;
    return;
  }

  let optionsHtml = '<option value="">Selecciona habitacion...</option>';
  rooms.forEach((room) => {
    const isAvailable = room.estado === 'libre';
    const disabledAttribute = !isAvailable ? 'disabled' : '';
    const statusLabel = !isAvailable && room.estado
      ? ` (${room.estado.charAt(0).toUpperCase() + room.estado.slice(1)})`
      : '';
    const capMax = room.capacidad_maxima || 20;

    optionsHtml += `
      <option
        value="${room.id}"
        data-precio="${room.precio || 0}"
        data-precio-1="${room.precio_1_persona || 0}"
        data-precio-2="${room.precio_2_personas || 0}"
        data-capacidad-base="${room.capacidad_base || 2}"
        data-capacidad-maxima="${capMax}"
        data-precio-extra="${room.precio_huesped_adicional || 0}"
        data-tipo-habitacion-id="${room.tipo_habitacion_id || ''}"
        ${disabledAttribute}
      >
        ${room.nombre} (${formatCurrency(room.precio_2_personas || room.precio, state.configHotel?.moneda_local_simbolo || '$')})${statusLabel}
      </option>
    `;
  });

  ui.habitacionIdSelect.innerHTML = optionsHtml;
  ui.habitacionIdSelect.disabled = false;
}

export async function cargarMetodosPago({
  supabase,
  hotelId,
  ui,
  onPaymentVisibilityChange
}) {
  if (!ui?.form || !ui.form.elements.metodo_pago_id) return;

  const select = ui.form.elements.metodo_pago_id;
  select.innerHTML = '<option value="">Cargando metodos...</option>';

  const { data, error } = await supabase
    .from('metodos_pago')
    .select('id, nombre')
    .eq('hotel_id', hotelId)
    .eq('activo', true)
    .order('nombre');

  if (error) {
    select.innerHTML = '<option value="">Error</option>';
    return;
  }

  const metodosDisponibles = data ? [...data] : [];
  metodosDisponibles.unshift({ id: 'mixto', nombre: 'Pago Mixto' });

  let optionsHtml = '<option value="">Selecciona metodo de pago...</option>';
  if (metodosDisponibles.length > 0) {
    metodosDisponibles.forEach((pago) => {
      optionsHtml += `<option value="${pago.id}">${pago.nombre}</option>`;
    });
  } else {
    optionsHtml = '<option value="">No hay metodos de pago</option>';
  }

  select.innerHTML = optionsHtml;
  if (typeof onPaymentVisibilityChange === 'function') {
    onPaymentVisibilityChange();
  }
}

export async function cargarTiemposEstancia({
  supabase,
  hotelId,
  ui,
  state
}) {
  if (!ui?.tiempoEstanciaIdSelect) return;

  const { data, error } = await supabase
    .from('tiempos_estancia')
    .select('id, nombre, minutos, precio')
    .eq('hotel_id', hotelId)
    .eq('activo', true)
    .order('minutos', { ascending: true });

  ui.tiempoEstanciaIdSelect.innerHTML = '';
  if (error || !data || data.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = error ? 'Error cargando tiempos' : 'No hay tiempos predefinidos';
    ui.tiempoEstanciaIdSelect.appendChild(option);
    state.tiemposEstanciaDisponibles = [];
    return;
  }

  state.tiemposEstanciaDisponibles = data;

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Selecciona un tiempo...';
  ui.tiempoEstanciaIdSelect.appendChild(placeholder);

  data.forEach((tiempoEstancia) => {
    const option = document.createElement('option');
    option.value = tiempoEstancia.id;
    const horasAprox = formatMinutesToHoursMinutes(tiempoEstancia.minutos);
    option.textContent = `${tiempoEstancia.nombre} (${formatCurrency(
      tiempoEstancia.precio,
      state.configHotel?.moneda_local_simbolo || '$',
      state.configHotel?.moneda_codigo_iso_info || 'COP',
      parseInt(state.configHotel?.moneda_decimales_info || 0, 10)
    )}) - ${horasAprox}`;
    option.setAttribute('data-precio', tiempoEstancia.precio);
    ui.tiempoEstanciaIdSelect.appendChild(option);
  });
}

export async function loadInitialData({
  supabase,
  hotelId,
  state,
  ui,
  showError,
  renderReservas,
  onPaymentVisibilityChange
}) {
  if (!ui?.habitacionIdSelect || !ui?.form?.elements.metodo_pago_id || !ui?.tiempoEstanciaIdSelect) {
    console.error('[Reservas] Elementos de UI para carga inicial no encontrados.');
    return;
  }

  try {
    const { data: config, error: configError } = await supabase
      .from('configuracion_hotel')
      .select(`
        cobro_al_checkin,
        checkin_hora_config,
        checkout_hora_config,
        tipo_turno_global,
        impuestos_incluidos_en_precios,
        porcentaje_impuesto_principal,
        nombre_impuesto_principal,
        moneda_local_simbolo,
        moneda_codigo_iso_info,
        moneda_decimales_info,
        minutos_tolerancia_llegada,
        minutos_alerta_reserva,
        minutos_alerta_checkout
      `)
      .eq('hotel_id', hotelId)
      .single();

    if (configError && configError.code !== 'PGRST116') {
      throw configError;
    }

    if (config) {
      state.configHotel.cobro_al_checkin = config.cobro_al_checkin === true;
      state.configHotel.checkin_hora_config = config.checkin_hora_config || '15:00';
      state.configHotel.checkout_hora_config = config.checkout_hora_config || '12:00';
      state.configHotel.tipo_turno_global = parseInt(config.tipo_turno_global || 12, 10);
      state.configHotel.impuestos_incluidos_en_precios = config.impuestos_incluidos_en_precios === true;
      state.configHotel.porcentaje_impuesto_principal = parseFloat(config.porcentaje_impuesto_principal) || 0;
      state.configHotel.nombre_impuesto_principal = config.nombre_impuesto_principal || null;
      state.configHotel.moneda_local_simbolo = config.moneda_local_simbolo || '$';
      state.configHotel.moneda_codigo_iso_info = config.moneda_codigo_iso_info || 'COP';
      state.configHotel.moneda_decimales_info = config.moneda_decimales_info !== null
        ? String(config.moneda_decimales_info)
        : '0';
      state.configHotel.minutos_tolerancia_llegada = Number(config.minutos_tolerancia_llegada) || 60;
      state.configHotel.minutos_alerta_reserva = Number(config.minutos_alerta_reserva) || 120;
      state.configHotel.minutos_alerta_checkout = Number(config.minutos_alerta_checkout) || 30;
    } else {
      console.warn(`[Reservas] No se encontro configuracion para el hotel ${hotelId}. Usando valores predeterminados.`);
    }

    ui.togglePaymentFieldsVisibility(state.configHotel.cobro_al_checkin);
  } catch (error) {
    console.error('[Reservas] Error cargando configuracion del hotel:', error);
    if (ui.feedbackDiv) {
      showError(ui.feedbackDiv, 'Error critico: No se pudo cargar la configuracion del hotel.');
    }
    ui.togglePaymentFieldsVisibility(state.configHotel.cobro_al_checkin);
  }

  try {
    const { data: pricingRules, error: pricingRulesError } = await supabase
      .from('reglas_tarifas')
      .select('*')
      .eq('hotel_id', hotelId)
      .eq('activo', true)
      .order('prioridad', { ascending: false });

    if (pricingRulesError) {
      console.warn('[Reservas] No se pudieron cargar las reglas de tarifa dinamica:', pricingRulesError.message);
      state.pricingRules = [];
      state.pricingRulesAvailable = false;
    } else {
      state.pricingRules = pricingRules || [];
      state.pricingRulesAvailable = true;
    }
  } catch (error) {
    console.warn('[Reservas] Carga de reglas dinamicas omitida:', error.message);
    state.pricingRules = [];
    state.pricingRulesAvailable = false;
  }

  await Promise.all([
    cargarHabitaciones({ supabase, hotelId, ui, state }),
    cargarMetodosPago({ supabase, hotelId, ui, onPaymentVisibilityChange }),
    cargarTiemposEstancia({ supabase, hotelId, ui, state })
  ]);

  await renderReservas();
}
