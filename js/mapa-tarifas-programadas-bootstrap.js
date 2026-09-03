import { supabase } from './supabaseClient.js';
import {
  showAlquilarModal,
  showExtenderTiempoModal
} from './modules/mapa-habitaciones/modales-alquiler.js';
import {
  calcularEstanciaNochesProgramada,
  cargarTarifasProgramadas,
  resolverPrecioTiempoEstancia
} from './services/tarifasProgramadasService.js';
import { getRuntimeHotelTimeZone } from './services/hotelTimeZoneService.js';

let handlingPricingAction = false;

function extractRoomNameFromActionModal() {
  const modal = document.getElementById('modal-container');
  if (!modal) return '';
  const heading = [...modal.querySelectorAll('h3')]
    .find((item) => String(item.textContent || '').includes('('));
  const text = String(heading?.textContent || '').trim();
  if (!text) return '';
  return text.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function getPositiveInteger(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function getDirectNightCount() {
  return getPositiveInteger(document.getElementById('select-noches')?.value, 1);
}

function getDirectGuestCount() {
  const form = document.getElementById('alquilar-form-pos');
  return getPositiveInteger(form?.elements?.cantidad_huespedes?.value, 1);
}

function getExtensionNightCount() {
  return getPositiveInteger(document.getElementById('select-noches-ext')?.value, 1);
}

function averageLodgingPerNight(result, nights) {
  return nights > 0 ? (Number(result?.montoHospedaje) || 0) / nights : 0;
}

function averageExtraGuestUnit(result, nights, guests, baseOccupancy, fallback) {
  const extraGuests = Math.max(0, guests - baseOccupancy);
  if (extraGuests <= 0 || nights <= 0) return Number(fallback) || 0;
  return (Number(result?.montoHuespedesAdicionales) || 0) / (extraGuests * nights);
}

function selectedTimeFromContext(context, mode) {
  if (mode === 'extension') {
    const minutes = Number(document.getElementById('select-horas-ext')?.value || 0);
    return minutes > 0 ? context.timesByMinutes.get(minutes) || null : null;
  }

  const id = String(document.getElementById('select-horas')?.value || '');
  return id ? context.timesById.get(id) || null : null;
}

function buildScheduledRoomView(room, tariffs, {
  mode = 'direct',
  extensionStart = null,
  extensionGuests = 1,
  context
} = {}) {
  const originals = {
    precio: Number(room?.precio) || 0,
    precio_1_persona: Number(room?.precio_1_persona) || 0,
    precio_2_personas: Number(room?.precio_2_personas) || 0,
    precio_huesped_adicional: Number(room?.precio_huesped_adicional) || 0
  };
  const baseOccupancy = Math.max(1, Number(room?.capacidad_base) || 2);

  function currentGuests() {
    return mode === 'extension'
      ? getPositiveInteger(extensionGuests, 1)
      : getDirectGuestCount();
  }

  function currentNights() {
    return mode === 'extension' ? getExtensionNightCount() : getDirectNightCount();
  }

  function currentStartDate() {
    return mode === 'extension' && extensionStart ? new Date(extensionStart) : new Date();
  }

  function getScheduledNights(guests) {
    const nights = currentNights();
    return {
      nights,
      result: calcularEstanciaNochesProgramada({
        room: { ...room, ...originals },
        huespedes: guests,
        fechaEntrada: currentStartDate(),
        cantidadNoches: nights,
        tarifas: tariffs,
        timeZone: getRuntimeHotelTimeZone()
      })
    };
  }

  return new Proxy(room, {
    get(target, property, receiver) {
      if (property === '__tarifas_programadas') return tariffs;

      if (property === 'precio_1_persona') {
        const { nights, result } = getScheduledNights(1);
        return averageLodgingPerNight(result, nights) || originals.precio_1_persona || originals.precio;
      }

      if (property === 'precio_2_personas' || property === 'precio') {
        const { nights, result } = getScheduledNights(2);
        const average = averageLodgingPerNight(result, nights);
        if (average > 0) return average;
        return property === 'precio' ? originals.precio : originals.precio_2_personas;
      }

      if (property === 'precio_huesped_adicional') {
        const guests = currentGuests();
        const selectedTime = selectedTimeFromContext(context, mode);
        if (selectedTime && mode === 'direct') {
          const timeResult = resolverPrecioTiempoEstancia({
            room: { ...room, ...originals },
            tiempo: selectedTime,
            huespedes: guests,
            fecha: currentStartDate(),
            tarifas: tariffs,
            timeZone: getRuntimeHotelTimeZone()
          });
          if (timeResult.huespedesAdicionales > 0) return Number(timeResult.precioHuespedAdicional) || 0;
        }

        const { nights, result } = getScheduledNights(guests);
        return averageExtraGuestUnit(
          result,
          nights,
          guests,
          baseOccupancy,
          originals.precio_huesped_adicional
        );
      }

      return Reflect.get(target, property, receiver);
    }
  });
}

function wrapQueryBuilder(builder, transformResult) {
  if (!builder || typeof builder !== 'object') return builder;

  return new Proxy(builder, {
    get(target, property) {
      const value = target[property];
      if (typeof value !== 'function') return value;

      if (property === 'then') {
        return (onFulfilled, onRejected) => value.call(
          target,
          (result) => {
            const transformed = transformResult(result);
            return typeof onFulfilled === 'function' ? onFulfilled(transformed) : transformed;
          },
          onRejected
        );
      }

      if (property === 'catch' || property === 'finally') return value.bind(target);
      return (...args) => wrapQueryBuilder(value.apply(target, args), transformResult);
    }
  });
}

function buildPricingAwareSupabase(baseSupabase, {
  room,
  tariffs,
  mode,
  dateProvider,
  guestProvider,
  context
}) {
  return new Proxy(baseSupabase, {
    get(target, property) {
      const value = target[property];
      if (property !== 'from') return typeof value === 'function' ? value.bind(target) : value;

      return (table) => {
        const builder = target.from(table);
        if (String(table) !== 'tiempos_estancia') return builder;

        return wrapQueryBuilder(builder, (result) => {
          if (!Array.isArray(result?.data)) return result;

          const mapped = result.data.map((tiempo) => {
            context.timesById.set(String(tiempo.id || ''), tiempo);
            context.timesByMinutes.set(Number(tiempo.minutos) || 0, tiempo);

            return new Proxy(tiempo, {
              get(timeTarget, timeProperty, receiver) {
                if (timeProperty !== 'precio') return Reflect.get(timeTarget, timeProperty, receiver);

                const priceResult = resolverPrecioTiempoEstancia({
                  room,
                  tiempo: timeTarget,
                  huespedes: guestProvider(),
                  fecha: dateProvider(),
                  tarifas: tariffs,
                  timeZone: getRuntimeHotelTimeZone()
                });

                // Sin override programado, conservar exactamente el precio que ya traía tiempos_estancia.
                if (!priceResult.tarifaAplicada) return Number(timeTarget.precio) || 0;

                return mode === 'extension'
                  ? Number(priceResult.total) || 0
                  : Number(priceResult.precioHospedaje) || 0;
              }
            });
          });

          return { ...result, data: mapped };
        });
      };
    }
  });
}

async function getContext() {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user?.id) throw userError || new Error('Usuario no identificado.');

  const { data: profile, error: profileError } = await supabase
    .from('usuarios')
    .select('hotel_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError || !profile?.hotel_id) throw profileError || new Error('Hotel no identificado.');

  return { user: userData.user, hotelId: profile.hotel_id };
}

async function loadRoomAndTariffs(hotelId, roomName) {
  const [roomResult, tariffs] = await Promise.all([
    supabase
      .from('habitaciones')
      .select('*')
      .eq('hotel_id', hotelId)
      .eq('nombre', roomName)
      .maybeSingle(),
    cargarTarifasProgramadas(supabase, hotelId)
  ]);

  if (roomResult.error) throw roomResult.error;
  if (!roomResult.data) throw new Error(`No se encontró la habitación ${roomName}.`);
  return { room: roomResult.data, tariffs };
}

async function findActiveReservation(roomId) {
  for (const estado of ['activa', 'ocupada', 'tiempo agotado']) {
    const { data, error } = await supabase
      .from('reservas')
      .select('id, fecha_fin, fecha_inicio, cantidad_huespedes')
      .eq('habitacion_id', roomId)
      .eq('estado', estado)
      .order('fecha_inicio', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    if (data) return data;
  }
  return null;
}

async function openDirectRentWithScheduledTariffs() {
  const roomName = extractRoomNameFromActionModal();
  if (!roomName) throw new Error('No se pudo identificar la habitación.');

  const { user, hotelId } = await getContext();
  const { room, tariffs } = await loadRoomAndTariffs(hotelId, roomName);
  const context = { timesById: new Map(), timesByMinutes: new Map() };
  const scheduledRoom = buildScheduledRoomView(room, tariffs, { mode: 'direct', context });
  const scheduledSupabase = buildPricingAwareSupabase(supabase, {
    room,
    tariffs,
    mode: 'direct',
    dateProvider: () => new Date(),
    guestProvider: () => getDirectGuestCount(),
    context
  });

  await showAlquilarModal(
    scheduledRoom,
    scheduledSupabase,
    user,
    hotelId,
    document.getElementById('app-container')
  );
}

async function openExtensionWithScheduledTariffs() {
  const roomName = extractRoomNameFromActionModal();
  if (!roomName) throw new Error('No se pudo identificar la habitación.');

  const { user, hotelId } = await getContext();
  const { room, tariffs } = await loadRoomAndTariffs(hotelId, roomName);
  const activeReservation = await findActiveReservation(room.id);
  if (!activeReservation) throw new Error('No se encontró una estancia activa para extender.');

  const context = { timesById: new Map(), timesByMinutes: new Map() };
  const extensionStart = new Date(activeReservation.fecha_fin);
  const extensionGuests = getPositiveInteger(activeReservation.cantidad_huespedes, 1);
  const scheduledRoom = buildScheduledRoomView(room, tariffs, {
    mode: 'extension',
    extensionStart,
    extensionGuests,
    context
  });
  const scheduledSupabase = buildPricingAwareSupabase(supabase, {
    room,
    tariffs,
    mode: 'extension',
    dateProvider: () => extensionStart,
    guestProvider: () => extensionGuests,
    context
  });

  await showExtenderTiempoModal(
    scheduledRoom,
    scheduledSupabase,
    user,
    hotelId,
    document.getElementById('app-container')
  );
}

document.addEventListener('click', async (event) => {
  const directButton = event.target.closest?.('#btn-alquilar-directo');
  const extensionButton = event.target.closest?.('#btn-extender-tiempo');
  if ((!directButton && !extensionButton) || handlingPricingAction) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  handlingPricingAction = true;

  try {
    if (extensionButton) {
      await openExtensionWithScheduledTariffs();
    } else {
      await openDirectRentWithScheduledTariffs();
    }
  } catch (error) {
    console.error('[MapaTarifas] No se pudo abrir la operación con tarifa programada:', error);
    if (typeof Swal !== 'undefined') {
      await Swal.fire('No se pudo calcular la tarifa', error.message || 'Error al calcular la tarifa.', 'error');
    } else {
      window.alert(error.message || 'No se pudo calcular la tarifa programada.');
    }
  } finally {
    handlingPricingAction = false;
  }
}, true);
