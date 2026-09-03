import { supabase } from './supabaseClient.js';
import { showAlquilarModal } from './modules/mapa-habitaciones/modales-alquiler.js';
import {
  calcularEstanciaNochesProgramada,
  cargarTarifasProgramadas
} from './services/tarifasProgramadasService.js';
import { getRuntimeHotelTimeZone } from './services/hotelTimeZoneService.js';

let handlingDirectRent = false;

function extractRoomNameFromActionModal() {
  const modal = document.getElementById('modal-container');
  if (!modal) return '';
  const heading = [...modal.querySelectorAll('h3')]
    .find((item) => String(item.textContent || '').includes('('));
  const text = String(heading?.textContent || '').trim();
  if (!text) return '';
  return text.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function currentNightCount() {
  const value = Number(document.getElementById('select-noches')?.value || 0);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 1;
}

function currentGuestCount() {
  const form = document.getElementById('alquilar-form-pos');
  const value = Number(form?.elements?.cantidad_huespedes?.value || 1);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 1;
}

function buildScheduledRoomView(room, tariffs) {
  const originals = {
    precio: Number(room?.precio) || 0,
    precio_1_persona: Number(room?.precio_1_persona) || 0,
    precio_2_personas: Number(room?.precio_2_personas) || 0,
    precio_huesped_adicional: Number(room?.precio_huesped_adicional) || 0
  };

  function getScheduledAverage(guests) {
    const nights = currentNightCount();
    const result = calcularEstanciaNochesProgramada({
      room: { ...room, ...originals },
      huespedes: guests,
      fechaEntrada: new Date(),
      cantidadNoches: nights,
      tarifas: tariffs,
      timeZone: getRuntimeHotelTimeZone()
    });

    return {
      nights,
      total: Number(result.total) || 0,
      hasProgrammedTariff: Array.isArray(result.tarifasAplicadas) && result.tarifasAplicadas.length > 0,
      names: [...new Set((result.tarifasAplicadas || []).map((tariff) => tariff?.nombre).filter(Boolean))]
    };
  }

  return new Proxy(room, {
    get(target, property, receiver) {
      if (property === '__tarifas_programadas') return tariffs;
      if (property === '__tarifa_programada_resumen') {
        return getScheduledAverage(currentGuestCount());
      }

      if (property === 'precio_1_persona') {
        const scheduled = getScheduledAverage(1);
        return scheduled.hasProgrammedTariff ? scheduled.total / scheduled.nights : originals.precio_1_persona;
      }

      if (property === 'precio_2_personas' || property === 'precio') {
        const guests = Math.max(2, currentGuestCount());
        const scheduled = getScheduledAverage(guests);
        if (scheduled.hasProgrammedTariff) return scheduled.total / scheduled.nights;
        return property === 'precio' ? originals.precio : originals.precio_2_personas;
      }

      if (property === 'precio_huesped_adicional') {
        const scheduled = getScheduledAverage(currentGuestCount());
        return scheduled.hasProgrammedTariff ? 0 : originals.precio_huesped_adicional;
      }

      return Reflect.get(target, property, receiver);
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

async function openDirectRentWithScheduledTariffs() {
  const roomName = extractRoomNameFromActionModal();
  if (!roomName) throw new Error('No se pudo identificar la habitación.');

  const { user, hotelId } = await getContext();
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

  const scheduledRoom = buildScheduledRoomView(roomResult.data, tariffs);
  await showAlquilarModal(
    scheduledRoom,
    supabase,
    user,
    hotelId,
    document.getElementById('app-container')
  );
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest?.('#btn-alquilar-directo');
  if (!button || handlingDirectRent) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  handlingDirectRent = true;

  try {
    await openDirectRentWithScheduledTariffs();
  } catch (error) {
    console.error('[MapaTarifas] No se pudo abrir el alquiler con tarifa programada:', error);
    if (typeof Swal !== 'undefined') {
      await Swal.fire('No se pudo abrir el alquiler', error.message || 'Error al calcular la tarifa.', 'error');
    } else {
      window.alert(error.message || 'No se pudo calcular la tarifa programada.');
    }
  } finally {
    handlingDirectRent = false;
  }
}, true);
