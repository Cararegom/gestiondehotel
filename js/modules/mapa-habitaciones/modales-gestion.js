import { imprimirFacturaPosAdaptable } from './modales-alquiler.js';
import {
  formatCOP,
  waitForButtonAndBind,
  formatDateTime,
  getAmenityIcon,
  cerrarModalContainer,
  cerrarModalGlobal,
  mostrarInfoModalGlobal,
  marcarModalMapaHotelAbierto,
  sincronizarEstadoModalMapaHotel
} from './helpers.js';
import { calcularSaldoReserva, obtenerReservaActivaIdDeHabitacion, puedeHacerCheckIn } from './datos.js';
import { showAlquilarModal, showExtenderTiempoModal } from './modales-alquiler.js';
import { buscarDescuentoParaServicios } from './descuentos-helper.js';
import { showModalTarea as importarMantenimientoUI } from '../mantenimiento/mantenimiento.js';
import { showGlobalLoading, hideGlobalLoading, formatCurrency } from '../../uiUtils.js';
import { turnoService } from '../../services/turnoService.js';
import { escapeHtml } from '../../security.js';

function refreshMapaHabitaciones() {
  document.dispatchEvent(new CustomEvent('renderRoomsComplete', { detail: { action: 'refresh' } }));
}

function normalizeLegacyText(value) {
  if (typeof value !== 'string') return value;

  return value
    .replace(/\u00C2\u00A1/g, '')
    .replace(/\u00C2\u00BF/g, '')
    .replace(/\u00C3\u0081/g, 'A')
    .replace(/\u00C3\u0089/g, 'E')
    .replace(/\u00C3\u008D/g, 'I')
    .replace(/\u00C3\u0093/g, 'O')
    .replace(/\u00C3\u009A/g, 'U')
    .replace(/\u00C3\u0091/g, 'N')
    .replace(/\u00C3\u00A1/g, 'a')
    .replace(/\u00C3\u00A9/g, 'e')
    .replace(/\u00C3\u00AD/g, 'i')
    .replace(/\u00C3\u00B3/g, 'o')
    .replace(/\u00C3\u00BA/g, 'u')
    .replace(/\u00C3\u00B1/g, 'n')
    .replace(/\u00E2\u0153\u2026/g, '')
    .replace(/\u00E2\u008F\u00B3/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function applyHabitacionModalLabels(modalContent, reservaFutura) {
  const buttonLabels = {
    'btn-alquilar-directo': 'Alquilar ahora',
    'btn-enviar-limpieza': 'Enviar a limpieza',
    'btn-extender-tiempo': 'Extender tiempo',
    'btn-entregar': 'Liberar habitacion',
    'btn-ver-consumos': 'Ver consumos',
    'btn-cambiar-habitacion': 'Cambiar de habitacion',
    'btn-seguimiento-articulos': 'Gestionar articulos',
    'btn-servicios-adicionales': 'Servicios adicionales',
    'btn-checkin-reserva': 'Check-in',
    'btn-mantenimiento': 'Anotar mantenimiento',
    'btn-info-huesped': 'Ver info huesped',
    'close-modal-acciones': 'Cerrar'
  };

  Object.entries(buttonLabels).forEach(([id, label]) => {
    const button = modalContent.querySelector(`#${id}`);
    if (button) {
      button.textContent = label;
    }
  });

  const reservationInfoCard = modalContent.querySelector('.bg-blue-50.border');
  if (reservationInfoCard && reservaFutura?.fecha_inicio) {
    const fechaInicio = new Date(reservaFutura.fecha_inicio);
    reservationInfoCard.innerHTML = `
      <strong>Cliente:</strong> ${reservaFutura.cliente_nombre || 'N/A'}<br>
      <strong>Huespedes:</strong> ${reservaFutura.cantidad_huespedes || 0}<br>
      <strong>Llegada:</strong> ${fechaInicio.toLocaleString('es-CO', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
    `;
  }
}

function applyServiciosModalLabels(modalContent) {
  const titleLabel = modalContent.querySelector('h3 span');
  if (titleLabel) {
    titleLabel.textContent = 'Servicios adicionales';
  }

  const nextButton = modalContent.querySelector('button[type="submit"]');
  if (nextButton) {
    nextButton.textContent = 'Siguiente';
  }
}

function applyConsumosModalLabels() {
  const btnAbonar = document.getElementById('btn-abonar-saldo-local');
  if (btnAbonar) btnAbonar.textContent = 'Abonar';

  const btnPagar = document.getElementById('btn-pagar-saldo-local');
  if (btnPagar) btnPagar.textContent = 'Pagar todo';
}

async function calculateTimeAndPrice(supabase, reserva, hotelId) {
  if (!reserva?.fecha_inicio) {
    return { precioAlojamientoCalculado: Number(reserva?.monto_total || 0) };
  }

  const inicio = new Date(reserva.fecha_inicio);
  const ahora = new Date();
  const minutosConsumidos = Math.max(0, Math.ceil((ahora.getTime() - inicio.getTime()) / 60000));

  const { data: tiempos } = await supabase
    .from('tiempos_estancia')
    .select('minutos, precio')
    .eq('hotel_id', hotelId)
    .eq('activo', true)
    .order('minutos', { ascending: true });

  const tiemposValidos = (tiempos || []).filter((tiempo) => Number(tiempo.minutos) > 0);
  const tarifa = tiemposValidos.filter((tiempo) => minutosConsumidos >= Number(tiempo.minutos)).slice(-1)[0]
    || tiemposValidos[0]
    || { precio: reserva.monto_total || 0 };

  return {
    precioAlojamientoCalculado: Number(tarifa.precio || reserva.monto_total || 0),
    minutosConsumidos
  };
}

function getReservaActivaLocal(room) {
  return Array.isArray(room?.reservas)
    ? room.reservas.find((reserva) => ['activa', 'ocupada', 'tiempo agotado'].includes(reserva.estado))
    : null;
}

function getLimiteLlegadaReservaLocal(reserva) {
  if (!reserva?.fecha_inicio) return null;

  const fechaInicio = new Date(reserva.fecha_inicio);
  if (Number.isNaN(fechaInicio.getTime())) return null;

  return new Date(
    fechaInicio.getFullYear(),
    fechaInicio.getMonth(),
    fechaInicio.getDate(),
    23,
    59,
    59,
    999
  );
}

function isReservaFuturaLocal(reserva, referenceDate = new Date()) {
  if (!reserva?.fecha_inicio || !['reservada', 'confirmada'].includes(reserva.estado)) {
    return false;
  }

  const fechaInicio = new Date(reserva.fecha_inicio);
  if (Number.isNaN(fechaInicio.getTime())) return false;

  if (fechaInicio.getTime() > referenceDate.getTime()) {
    return true;
  }

  const limiteLlegada = getLimiteLlegadaReservaLocal(reserva);
  return Boolean(limiteLlegada) && referenceDate.getTime() <= limiteLlegada.getTime();
}

function getReservaFuturaLocal(room) {
  if (isReservaFuturaLocal(room?.proximaReservaData)) return room.proximaReservaData;

  return Array.isArray(room?.reservas)
    ? room.reservas
      .filter((reserva) => isReservaFuturaLocal(reserva))
      .sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio))[0] || null
    : null;
}

function getArticulosPendientesCount(reservaActiva) {
  const historial = Array.isArray(reservaActiva?.historial_articulos_prestados)
    ? reservaActiva.historial_articulos_prestados
    : [];
  const saldoPorArticulo = new Map();

  historial.forEach((item) => {
    const nombre = String(item?.articulo_nombre || 'Articulo').trim();
    const cantidad = Number(item?.cantidad || 1) || 1;
    const saldoActual = saldoPorArticulo.get(nombre) || 0;

    if (item?.accion === 'prestado') {
      saldoPorArticulo.set(nombre, saldoActual + cantidad);
    } else if (item?.accion === 'devuelto') {
      saldoPorArticulo.set(nombre, Math.max(0, saldoActual - cantidad));
    }
  });

  return [...saldoPorArticulo.values()].filter((saldo) => saldo > 0).length;
}

const PROGRAMMED_TASK_MARKER = '[PROGRAMADO]';

function normalizeMaintenanceTaskType(task) {
  const markerPresent = String(task?.descripcion || '').includes(PROGRAMMED_TASK_MARKER)
    || String(task?.titulo || '').includes(PROGRAMMED_TASK_MARKER);

  if (markerPresent) {
    return 'programado';
  }

  return task?.tipo === 'programado' ? 'programado' : 'bloqueante';
}

function formatTiempoRestante(fechaFin) {
  if (!fechaFin) return 'Sin hora';

  const diff = new Date(fechaFin).getTime() - Date.now();
  const diffAbs = Math.abs(diff);
  const horas = Math.floor(diffAbs / 3600000);
  const minutos = Math.floor((diffAbs % 3600000) / 60000);
  const label = `${horas}h ${minutos}m`;

  return diff >= 0 ? `Restan ${label}` : `Vencido hace ${label}`;
}

async function getHabitacionResumenOperativo(room, supabase, hotelId) {
  const resumen = {
    reservaActiva: getReservaActivaLocal(room),
    proximaReserva: getReservaFuturaLocal(room),
    articulosPendientesCount: 0,
    saldoPendienteBase: 0,
    reservasRecientes: [],
    tareaMantenimientoActiva: null,
    tareaMantenimientoProgramada: null,
    tareasMantenimientoRecientes: [],
    inspeccionesRecientes: [],
    historialTimeline: []
  };

  resumen.articulosPendientesCount = getArticulosPendientesCount(resumen.reservaActiva);
  resumen.saldoPendienteBase = Math.max(0, Number(resumen.reservaActiva?.monto_total || 0) - Number(resumen.reservaActiva?.monto_pagado || 0));

  const [reservasResult, tareaResult, tareasHistoricasResult, inspeccionesResult] = await Promise.all([
    supabase
      .from('reservas')
      .select('id, estado, fecha_inicio, fecha_fin, cliente_nombre, monto_total, monto_pagado')
      .eq('hotel_id', hotelId)
      .eq('habitacion_id', room.id)
      .order('fecha_inicio', { ascending: false })
      .limit(4),
    supabase
      .from('tareas_mantenimiento')
      .select('id, titulo, descripcion, estado, creado_en, tipo')
      .eq('hotel_id', hotelId)
      .eq('habitacion_id', room.id)
      .in('estado', ['pendiente', 'en_progreso'])
      .order('creado_en', { ascending: false })
      .limit(4),
    supabase
      .from('tareas_mantenimiento')
      .select('id, titulo, descripcion, estado, creado_en, fecha_completada, tipo, frecuencia')
      .eq('hotel_id', hotelId)
      .eq('habitacion_id', room.id)
      .order('creado_en', { ascending: false })
      .limit(6),
    supabase
      .from('inspecciones_limpieza')
      .select('id, puntaje, observaciones, creado_en')
      .eq('hotel_id', hotelId)
      .eq('habitacion_id', room.id)
      .order('creado_en', { ascending: false })
      .limit(4)
  ]);

  if (reservasResult?.error) {
    console.warn('No se pudo cargar el resumen de reservas de la habitacion:', reservasResult.error);
  } else {
    resumen.reservasRecientes = reservasResult?.data || [];
  }

  if (tareaResult?.error) {
    console.warn('No se pudo cargar el estado de mantenimiento de la habitacion:', tareaResult.error);
  } else {
    const tareasAbiertas = tareaResult?.data || [];
    resumen.tareaMantenimientoActiva = tareasAbiertas.find((tarea) => normalizeMaintenanceTaskType(tarea) !== 'programado') || null;
    resumen.tareaMantenimientoProgramada = tareasAbiertas.find((tarea) => normalizeMaintenanceTaskType(tarea) === 'programado') || null;
  }

  if (tareasHistoricasResult?.error) {
    console.warn('No se pudo cargar el historial de mantenimiento de la habitacion:', tareasHistoricasResult.error);
  } else {
    resumen.tareasMantenimientoRecientes = tareasHistoricasResult?.data || [];
  }

  if (inspeccionesResult?.error) {
    console.warn('No se pudo cargar el historial de inspecciones de limpieza:', inspeccionesResult.error);
  } else {
    resumen.inspeccionesRecientes = inspeccionesResult?.data || [];
  }

  const timeline = [];
  (resumen.reservasRecientes || []).forEach((reserva) => {
    timeline.push({
      id: `reserva-${reserva.id}`,
      timestamp: reserva.fecha_inicio,
      badge: 'Reserva',
      title: reserva.cliente_nombre || 'Reserva sin cliente',
      meta: `${reserva.estado || 'N/A'} · ${formatDateTime(reserva.fecha_inicio, 'es-CO', { dateStyle: 'medium', timeStyle: 'short' })}`,
      tone: 'blue'
    });
  });
  (resumen.tareasMantenimientoRecientes || []).forEach((tarea) => {
    timeline.push({
      id: `mant-${tarea.id}`,
      timestamp: tarea.fecha_completada || tarea.creado_en,
      badge: 'Mantenimiento',
      title: tarea.titulo || 'Tarea de mantenimiento',
      meta: `${tarea.estado || 'pendiente'} · ${normalizeMaintenanceTaskType(tarea) === 'programado' ? 'Programado' : 'Bloqueante'}`,
      tone: normalizeMaintenanceTaskType(tarea) === 'programado' ? 'violet' : 'amber'
    });
  });
  (resumen.inspeccionesRecientes || []).forEach((inspeccion) => {
    timeline.push({
      id: `insp-${inspeccion.id}`,
      timestamp: inspeccion.creado_en,
      badge: 'Inspeccion',
      title: `Puntaje ${inspeccion.puntaje || 0}/5`,
      meta: inspeccion.observaciones || 'Sin observaciones registradas.',
      tone: Number(inspeccion.puntaje || 0) >= 4 ? 'emerald' : 'rose'
    });
  });

  resumen.historialTimeline = timeline
    .filter((item) => item.timestamp)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 6);

  return resumen;
}

function buildHabitacionSummaryHtml(room, resumen) {
  if (!resumen) return '';

  const estadoActual = room?.estado || 'N/A';
  const reservaActiva = resumen.reservaActiva;
  const proximaReserva = resumen.proximaReserva;
  const tareaMantenimiento = resumen.tareaMantenimientoActiva;
  const tareaProgramada = resumen.tareaMantenimientoProgramada;
  const actividadReciente = (resumen.reservasRecientes || []).slice(0, 3);
  const saldoBaseLabel = resumen.saldoPendienteBase > 0 ? `$ ${formatCOP(resumen.saldoPendienteBase)}` : 'Al dia';
  const articulosLabel = resumen.articulosPendientesCount > 0
    ? `${resumen.articulosPendientesCount} pendiente${resumen.articulosPendientesCount > 1 ? 's' : ''}`
    : 'Sin pendientes';
  const mantenimientoLabel = tareaMantenimiento
    ? `${tareaMantenimiento.titulo || 'Tarea abierta'}`
    : (tareaProgramada
      ? 'Sin bloqueo activo'
      : (estadoActual === 'mantenimiento' ? 'Habitacion en mantenimiento' : 'Sin tareas abiertas'));
  const mantenimientoSecundario = tareaProgramada
    ? `Pendiente: ${tareaProgramada.titulo || 'Trabajo programado'}`
    : 'Sin pendientes programados';
  const ultimaInspeccion = (resumen.inspeccionesRecientes || [])[0] || null;
  const ultimaInspeccionLabel = ultimaInspeccion
    ? `${ultimaInspeccion.puntaje || 0}/5`
    : 'Sin inspeccion reciente';
  const ultimaInspeccionMeta = ultimaInspeccion?.creado_en
    ? formatDateTime(ultimaInspeccion.creado_en, 'es-CO', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Aun no hay cierre con checklist.';

  const actividadHtml = (resumen.historialTimeline || []).length > 0
    ? resumen.historialTimeline.map((item) => {
        const toneMap = {
          blue: 'border-blue-100 bg-blue-50 text-blue-700',
          amber: 'border-amber-100 bg-amber-50 text-amber-700',
          violet: 'border-violet-100 bg-violet-50 text-violet-700',
          emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
          rose: 'border-rose-100 bg-rose-50 text-rose-700'
        };
        const badgeClass = toneMap[item.tone] || 'border-slate-100 bg-slate-100 text-slate-700';

        return `
          <div class="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${badgeClass}">${escapeHtml(item.badge)}</span>
                <p class="text-sm font-semibold text-slate-800">${escapeHtml(item.title)}</p>
              </div>
              <p class="mt-1 text-xs text-slate-500">${escapeHtml(item.meta)}</p>
            </div>
            <span class="text-[11px] font-semibold text-slate-400">${formatDateTime(item.timestamp, 'es-CO', { dateStyle: 'short', timeStyle: 'short' })}</span>
          </div>
        `;
      }).join('')
    : '<p class="text-sm text-slate-500">Sin actividad reciente registrada para esta habitacion.</p>';

  return `
    <div class="mb-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div class="rounded-xl border border-slate-200 bg-white p-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Estado actual</p>
          <p class="mt-2 text-lg font-bold text-slate-800">${estadoActual}</p>
          <p class="mt-1 text-xs text-slate-500">${reservaActiva ? formatTiempoRestante(reservaActiva.fecha_fin) : 'Sin estancia activa'}</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Saldo base</p>
          <p class="mt-2 text-lg font-bold text-slate-800">${saldoBaseLabel}</p>
          <p class="mt-1 text-xs text-slate-500">Articulos: ${articulosLabel}</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Proxima reserva</p>
          <p class="mt-2 text-sm font-bold text-slate-800">${proximaReserva?.cliente_nombre || 'Sin reserva proxima'}</p>
          <p class="mt-1 text-xs text-slate-500">${proximaReserva?.fecha_inicio ? formatDateTime(proximaReserva.fecha_inicio, 'es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : 'No hay llegada programada'}</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Mantenimiento</p>
          <p class="mt-2 text-sm font-bold text-slate-800">${mantenimientoLabel}</p>
          <p class="mt-1 text-xs text-slate-500">${tareaMantenimiento?.creado_en ? `Abierta desde ${formatDateTime(tareaMantenimiento.creado_en, 'es-CO', { dateStyle: 'medium', timeStyle: 'short' })}` : mantenimientoSecundario}</p>
          ${tareaProgramada ? `<p class="mt-1 text-[11px] font-semibold text-violet-600">${mantenimientoSecundario}</p>` : ''}
        </div>
        <div class="rounded-xl border border-slate-200 bg-white p-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Ultima inspeccion</p>
          <p class="mt-2 text-sm font-bold text-slate-800">${ultimaInspeccionLabel}</p>
          <p class="mt-1 text-xs text-slate-500">${ultimaInspeccionMeta}</p>
          ${ultimaInspeccion?.observaciones ? `<p class="mt-1 text-[11px] text-slate-500">${escapeHtml(ultimaInspeccion.observaciones)}</p>` : ''}
        </div>
      </div>
      <div class="mt-3 rounded-xl border border-slate-200 bg-slate-100/70 p-3">
        <div class="mb-2 flex items-center justify-between gap-2">
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Historial operativo</p>
          <span class="text-xs font-semibold text-slate-400">${(resumen.historialTimeline || []).length} evento${(resumen.historialTimeline || []).length === 1 ? '' : 's'}</span>
        </div>
        <div class="space-y-2">
          ${actividadHtml}
        </div>
      </div>
    </div>
  `;
}

export async function showMantenimientoModal(room, supabase, currentUser, hotelId, mainAppContainer, options = {}) {
  const modalContainer = document.getElementById('modal-container');
  if (!modalContainer) return;
  marcarModalMapaHotelAbierto();
  const rawMode = options?.mode;
  const mode = rawMode === 'programado' || rawMode === 'bloqueante' ? rawMode : 'selector';

  if (typeof window.showModalTarea === 'function' || typeof importarMantenimientoUI === 'function') {
    if (mode === 'bloqueante') {
      const confirmacion = await new Promise((resolve) => {
        mostrarInfoModalGlobal(
          `Desea crear una tarea de mantenimiento para la habitacion <strong>${room.nombre}</strong>?<br><br><small>La habitacion se marcara como "mantenimiento" solo si guardas la tarea.</small>`,
          'Confirmar envio a mantenimiento',
          [
            { texto: 'Si, crear tarea', clase: 'button-danger', accion: () => resolve(true) },
            { texto: 'Cancelar', clase: 'button-neutral', accion: () => resolve(false) }
          ],
          modalContainer
        );
      });

      if (!confirmacion) {
        return;
      }
    }

    const fn = window.showModalTarea || importarMantenimientoUI;
    const modalTareaContainer = document.createElement('div');
    modalTareaContainer.id = 'mant-modal-temp-container';
    modalTareaContainer.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4';
    document.body.appendChild(modalTareaContainer);

    const cleanupModalTarea = () => {
      if (document.body.contains(modalTareaContainer)) {
        document.body.removeChild(modalTareaContainer);
      }
    };

    const observer = new MutationObserver((_, obs) => {
      if (modalTareaContainer.children.length === 0) {
        obs.disconnect();
        cleanupModalTarea();
        refreshMapaHabitaciones();
      }
    });

    observer.observe(modalTareaContainer, { childList: true });

    try {
      await fn(
        modalTareaContainer,
        supabase,
        hotelId,
        currentUser,
        {
          habitacion_id: room.id,
          estado: 'pendiente',
          tipo: mode === 'bloqueante' ? 'bloqueante' : 'programado',
          titulo: `Mantenimiento Hab. ${room.nombre}`,
          origen_selector: mode === 'selector'
        }
      );
    } catch (e) {
      observer.disconnect();
      cleanupModalTarea();
      console.error('Error modal de mantenimiento delegado:', e);
    }

    return;
  }

  // Fallback UI si el script local no esta importado o falla
  const modalHTML = `
        <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6 relative flex flex-col animate-fade-in-up">
            <button id="close-mantenimiento-btn" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
                <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <h3 class="text-xl font-bold text-gray-800 mb-4">Reportar Mantenimiento / Limpieza</h3>
            <p class="text-sm text-gray-600 mb-4">Modulo de mantenimiento nativo no disponible. Por favor, cambia el estado manualmente.</p>
            
            <div class="flex gap-2 justify-end">
                <button id="btn-estado-limpieza" class="button button-accent flex-1 bg-cyan-600 hover:bg-cyan-700">Pasar a Limpieza</button>
                <button id="btn-estado-mante" class="button button-danger flex-1 bg-red-600 hover:bg-red-700">Pasar a Mantenimiento</button>
            </div>
        </div>
    `;

  modalContainer.innerHTML = modalHTML;
  modalContainer.style.display = 'flex';

  waitForButtonAndBind('close-mantenimiento-btn', [cerrarModalContainer], 2000, modalContainer);

  waitForButtonAndBind('btn-estado-limpieza', [async () => {
    const btn = modalContainer.querySelector('#btn-estado-limpieza');
    btn.disabled = true; btn.textContent = 'Actualizando...';
    await supabase.from('habitaciones').update({ estado: 'limpieza' }).eq('id', room.id);
    cerrarModalContainer();
    const event = new CustomEvent('renderRoomsComplete', { detail: { action: 'refresh' } });
    document.dispatchEvent(event);
  }], 2000, modalContainer);

  waitForButtonAndBind('btn-estado-mante', [async () => {
    const btn = modalContainer.querySelector('#btn-estado-mante');
    btn.disabled = true; btn.textContent = 'Actualizando...';
    await supabase.from('habitaciones').update({ estado: 'mantenimiento' }).eq('id', room.id);
    cerrarModalContainer();
    const event = new CustomEvent('renderRoomsComplete', { detail: { action: 'refresh' } });
    document.dispatchEvent(event);
  }], 2000, modalContainer);
}

// Opciones base de cada tarjeta


export async function showHabitacionOpcionesModal(room, supabase, currentUser, hotelId, mainAppContainer) {
  const modalContainer = document.getElementById('modal-container');
  modalContainer.style.display = "flex";
  modalContainer.innerHTML = "";
  marcarModalMapaHotelAbierto();
  const roomSummary = await getHabitacionResumenOperativo(room, supabase, hotelId);
  const closeRoomOptionsModal = () => cerrarModalGlobal(modalContainer);

  // 1. Declarar variables iniciales
  let reservaFutura = null;
  let botonesHtml = '';

  // Estilos de botones (Tailwind)
  const btnPrincipal = "w-full mb-2 py-2.5 rounded-lg text-white font-semibold bg-blue-600 hover:bg-blue-700 shadow-sm hover:shadow transition flex items-center justify-center gap-2";
  const btnSecundario = "w-full mb-2 py-2.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium border border-blue-200 shadow-sm hover:shadow flex items-center justify-center gap-2";
  const btnVerde = "w-full mb-2 py-2.5 rounded-lg bg-green-100 hover:bg-green-200 text-green-800 font-medium border border-green-300 shadow-sm hover:shadow flex items-center justify-center gap-2";
  const btnNaranja = "w-full mb-2 py-2.5 rounded-lg bg-orange-100 hover:bg-orange-200 text-orange-800 font-medium border border-orange-300 shadow-sm hover:shadow flex items-center justify-center gap-2";
  const btnRojo = "w-full mt-4 py-2.5 rounded-lg text-white font-semibold bg-red-600 hover:bg-red-700 shadow-sm hover:shadow transition flex items-center justify-center gap-2";

  // ---------------------------------------------------------------
  // 2. GENERAR HTML SEGÚN EL ESTADO DE LA HABITACIÓN
  // ---------------------------------------------------------------

  // --- CASO A: HABITACIÓN LIBRE ---
  if (["libre", "disponible"].includes(room.estado)) {
    botonesHtml += `<button id="btn-alquilar-directo" class="${btnPrincipal}"><span style="font-size:1.2em">🛏️</span> Alquilar Ahora</button>`;
    botonesHtml += `<button id="btn-enviar-limpieza" class="${btnSecundario}"><span style="font-size:1.2em">🧹</span> Enviar a Limpieza</button>`;
  }

  // --- CASO B: OCUPADA / ACTIVA / TIEMPO AGOTADO ---
  else if (["ocupada", "tiempo agotado", "activa"].includes(room.estado)) {
    botonesHtml += `<button id="btn-extender-tiempo" class="${btnPrincipal}"><span style="font-size:1.2em">⏱️</span> Extender Tiempo</button>`;
    botonesHtml += `<button id="btn-entregar" class="${btnSecundario}"><span style="font-size:1.2em">🔓</span> Liberar Habitación</button>`;
    botonesHtml += `<button id="btn-ver-consumos" class="${btnSecundario}"><span style="font-size:1.2em">🍽️</span> Ver Consumos</button>`;
    botonesHtml += `<button id="btn-cambiar-habitacion" class="${btnSecundario}"><span style="font-size:1.2em">🔁</span> Cambiar de Habitación</button>`;
    botonesHtml += `<button id="btn-seguimiento-articulos" class="${btnSecundario}"><span style="font-size:1.2em">📦</span> Gestionar Artículos</button>`;
    // Servicios adicionales
    botonesHtml += `<button id="btn-servicios-adicionales" class="${btnVerde}"><span style="font-size:1.2em">🛎️</span> Servicios adicionales</button>`;
  }

  // --- CASO C: RESERVADA (Check-in pendiente) ---
  else if (room.estado === "reservada") {
    // Consultar datos de la reserva futura
    const { data, error } = await supabase
      .from('reservas')
      .select('id, cliente_nombre, telefono, cantidad_huespedes, fecha_inicio, fecha_fin')
      .eq('habitacion_id', room.id)
      .eq('estado', 'reservada')
      .gte('fecha_fin', new Date().toISOString())
      .order('fecha_inicio', { ascending: true }) // La más próxima
      .limit(1)
      .maybeSingle();

    if (data) {
      reservaFutura = data;
      const fechaInicio = new Date(reservaFutura.fecha_inicio);
      const ahora = new Date();
      const diferenciaMin = (fechaInicio - ahora) / 60000;

      // Info visual
      botonesHtml += `<div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 text-sm text-blue-900 shadow-sm">
                <strong>Cliente:</strong> ${reservaFutura.cliente_nombre}<br>
                <strong>Huéspedes:</strong> ${reservaFutura.cantidad_huespedes}<br>
                <strong>Llegada:</strong> ${fechaInicio.toLocaleString('es-CO', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
            </div>`;

      // Botón Check-in (habilitado 2 horas antes o si ya pasó la hora)
      if (diferenciaMin <= 120) {
        botonesHtml += `<button id="btn-checkin-reserva" class="${btnVerde}"><span style="font-size:1.2em">✅</span> Check-in (Entrada)</button>`;
      } else {
        botonesHtml += `<div class="text-center text-xs text-orange-600 font-bold mb-2 bg-orange-50 p-2 rounded border border-orange-200">
                    ⏳ Check-in habilitado desde las ${new Date(fechaInicio.getTime() - 120 * 60000).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                </div>`;
      }
    } else {
      botonesHtml += `<div class="text-xs text-red-500 mb-2 p-2 bg-red-50 rounded">No se encontró la reserva activa para check-in.</div>`;
    }

    // Cambio de habitación permitido en reserva
    botonesHtml += `<button id="btn-cambiar-habitacion" class="${btnSecundario}"><span style="font-size:1.2em">🔁</span> Cambiar de Habitación</button>`;
  }

  // --- OPCIONES COMUNES ---

  // Mantenimiento (si no está ya en mantenimiento)
  if (room.estado !== "mantenimiento") {
    botonesHtml += `<button id="btn-mantenimiento" class="${btnNaranja}"><span style="font-size:1.2em">🛠️</span> Anotar mantenimiento</button>`;
  }

  // Info Huésped (si hay alguien asociado a la habitación)
  if (["ocupada", "tiempo agotado", "reservada", "activa"].includes(room.estado)) {
    botonesHtml += `<button id="btn-info-huesped" class="${btnSecundario}"><span style="font-size:1.2em">👤</span> Ver Info Huésped</button>`;
  }

  // Cerrar Modal
  botonesHtml += `<button id="close-modal-acciones" class="${btnRojo}"><span style="font-size:1.2em">❌</span> Cerrar</button>`;

  // 3. RENDERIZAR EL MODAL EN EL DOM
  const modalContent = document.createElement('div');
  modalContent.className = "bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 m-auto relative animate-fade-in-up";
  modalContent.innerHTML = `
        <button id="close-modal-quick" class="absolute right-4 top-4 rounded-full border border-slate-200 bg-white px-3 py-1 text-lg font-bold text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700" aria-label="Cerrar">
            ×
        </button>
        <h3 class="text-xl font-bold mb-5 text-blue-700 text-center">${room.nombre} (${room.estado ? room.estado.toUpperCase() : 'N/A'})</h3>
        ${buildHabitacionSummaryHtml(room, roomSummary)}
        <div class="flex flex-col gap-2.5">
            ${botonesHtml}
        </div>
    `;
  modalContent.innerHTML = normalizeLegacyText(modalContent.innerHTML);
  modalContainer.appendChild(modalContent);
  applyHabitacionModalLabels(modalContent, reservaFutura);

  // Cierre al hacer click fuera del modal
  modalContainer.onclick = (e) => {
    if (e.target === modalContainer) {
      closeRoomOptionsModal();
    }
  };

  // Helper para asignar eventos de forma segura
  const setupButtonListener = (id, handler) => {
    const btn = modalContent.querySelector(`#${id}`);
    if (btn) {
      // Removemos listeners previos clonando el nodo (opcional, pero limpio)
      // En este caso, como creamos el modal de cero cada vez, no es estrictamente necesario clonar.
      btn.onclick = (e) => handler(btn, room);
    }
  };

  // =================================================================
  // 4. ASIGNACIÓN DE EVENTOS (AQUÍ ESTÁ LA CLAVE PARA QUE FUNCIONEN)
  // =================================================================

  // --- ACCIÓN: CERRAR ---
  setupButtonListener('close-modal-acciones', () => {
    closeRoomOptionsModal();
  });
  setupButtonListener('close-modal-quick', () => {
    closeRoomOptionsModal();
  });

  // --- ACCIÓN: ALQUILAR ---
  setupButtonListener('btn-alquilar-directo', async () => {
    const ahora = new Date();
    // Validar si hay una reserva próxima que bloquee el alquiler
    const { data: reservasFuturas } = await supabase
      .from('reservas')
      .select('fecha_inicio')
      .eq('habitacion_id', room.id)
      .in('estado', ['reservada', 'activa'])
      .gte('fecha_fin', ahora.toISOString())
      .order('fecha_inicio', { ascending: true })
      .limit(1);

    if (reservasFuturas && reservasFuturas.length > 0) {
      const inicioBloqueo = new Date(new Date(reservasFuturas[0].fecha_inicio).getTime() - 2 * 60 * 60 * 1000); // 2 horas antes
      if (ahora >= inicioBloqueo) {
        mostrarInfoModalGlobal("No puedes alquilar: habitación bloqueada por reserva próxima.", "Bloqueado");
        return;
      }
    }
    showAlquilarModal(room, supabase, currentUser, hotelId, mainAppContainer);
  });

  // --- ACCIÓN: EXTENDER TIEMPO ---
  setupButtonListener('btn-extender-tiempo', () => showExtenderTiempoModal(room, supabase, currentUser, hotelId, mainAppContainer));

  // --- ACCIÓN: MANTENIMIENTO ---
  setupButtonListener('btn-mantenimiento', () => {
    modalContainer.style.display = 'none';
    modalContainer.innerHTML = '';
    sincronizarEstadoModalMapaHotel();
    showMantenimientoModal(room, supabase, currentUser, hotelId, mainAppContainer);
  });

  // --- ACCIÓN: LIMPIEZA ---
  setupButtonListener('btn-enviar-limpieza', async (btn) => {
    btn.disabled = true; btn.textContent = "Enviando...";
    await supabase.from('habitaciones').update({ estado: 'limpieza' }).eq('id', room.id);
    closeRoomOptionsModal();
    document.dispatchEvent(new CustomEvent('renderRoomsComplete', { detail: { action: 'refresh' } }));
  });

  // --- ACCIÓN: GESTIONAR ARTÍCULOS ---
  setupButtonListener('btn-seguimiento-articulos', () => showSeguimientoArticulosModal(room, supabase, currentUser, hotelId));

  // --- ACCIÓN: VER INFO HUÉSPED ---
  setupButtonListener('btn-info-huesped', async () => {
    const { data: reserva } = await supabase.from('reservas')
      .select('*')
      .eq('habitacion_id', room.id)
      .in('estado', ['activa', 'ocupada', 'tiempo agotado', 'reservada'])
      .order('fecha_inicio', { ascending: false })
      .limit(1)
      .single();

    if (reserva) {
      mostrarInfoModalGlobal(`
                <b>Nombre:</b> ${reserva.cliente_nombre}<br>
                <b>Tel:</b> ${reserva.telefono || 'N/A'}<br>
                <b>Entrada:</b> ${formatDateTime(reserva.fecha_inicio)}<br>
                <b>Salida:</b> ${formatDateTime(reserva.fecha_fin)}<br>
                ${reserva.notas ? `<b>Notas:</b> ${reserva.notas}` : ''}
            `, "Info Huésped");
    } else {
      mostrarInfoModalGlobal("No se encontró información.", "Info");
    }
  });

  // --- ACCIÓN: CHECK-IN RESERVA ---
  if (reservaFutura) {
    setupButtonListener('btn-checkin-reserva', async () => {
      // Validar si requiere pago
      const ok = await puedeHacerCheckIn(reservaFutura.id, hotelId, window.hotelConfigGlobal, supabase, mostrarInfoModalGlobal);
      if (!ok) return;

      // Calcular nueva fecha fin basada en la duración original
      const duracionMs = new Date(reservaFutura.fecha_fin) - new Date(reservaFutura.fecha_inicio);
      const nuevoInicio = new Date();
      const nuevoFin = new Date(nuevoInicio.getTime() + duracionMs);

      // Actualizar Reserva
      await supabase.from('reservas').update({
        estado: 'activa',
        fecha_inicio: nuevoInicio.toISOString(),
        fecha_fin: nuevoFin.toISOString()
      }).eq('id', reservaFutura.id);

      // Actualizar Habitación
      await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', room.id);

      // Crear Cronómetro
      await supabase.from('cronometros').insert([{
        hotel_id: hotelId,
        reserva_id: reservaFutura.id,
        habitacion_id: room.id,
        fecha_inicio: nuevoInicio.toISOString(),
        fecha_fin: nuevoFin.toISOString(),
        activo: true
      }]);

      closeRoomOptionsModal();
      document.dispatchEvent(new CustomEvent('renderRoomsComplete', { detail: { action: 'refresh' } }));
      mostrarInfoModalGlobal("Check-in realizado con éxito.", "Bienvenido");
    });
  }

  // --- ACCIÓN: CAMBIAR HABITACIÓN ---
  setupButtonListener('btn-cambiar-habitacion', async (btn) => {
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Cargando...';

    try {
      const { data: habsLibres, error: errHabs } = await supabase.from('habitaciones')
        .select('id, nombre')
        .eq('hotel_id', hotelId)
        .eq('estado', 'libre')
        .neq('id', room.id);

      if (errHabs) {
        console.error('Error obteniendo habitaciones libres:', errHabs);
        mostrarInfoModalGlobal("No se pudieron obtener las habitaciones libres.", "Error");
        return;
      }

      if (!habsLibres || habsLibres.length === 0) {
        mostrarInfoModalGlobal("No hay habitaciones libres disponibles.", "Error");
        return;
      }

      const options = habsLibres
        .map(h => `<option value="${h.id}">${h.nombre}</option>`)
        .join('');

      const { value: formValues } = await Swal.fire({
        title: 'Cambiar Habitación',
        html: `
                <label class="block text-left mb-1 text-sm">Destino:</label>
                <select id="swal-cambio-hab" class="swal2-input mb-3">${options}</select>
                <label class="block text-left mb-1 text-sm">Motivo:</label>
                <input id="swal-cambio-motivo" class="swal2-input" placeholder="Ej: Aire acondicionado fallando">
            `,
        showCancelButton: true,
        focusConfirm: false,
        preConfirm: () => {
          const id = document.getElementById('swal-cambio-hab').value;
          const motivo = document.getElementById('swal-cambio-motivo').value.trim();
          if (!id) Swal.showValidationMessage('Debes escoger una habitación destino.');
          if (!motivo) Swal.showValidationMessage('Debes escribir un motivo.');
          return { id, motivo };
        }
      });

      if (!formValues || !formValues.id || !formValues.motivo) return;

      const { data: resActiva, error: errResActiva } = await supabase.from('reservas')
        .select('id, estado')
        .eq('habitacion_id', room.id)
        .in('estado', ['activa', 'ocupada', 'tiempo agotado', 'reservada'])
        .order('fecha_inicio', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (errResActiva) {
        console.error('Error obteniendo reserva activa para cambio:', errResActiva);
        mostrarInfoModalGlobal("No se pudo obtener la reserva actual de la habitación.", "Error");
        return;
      }

      if (!resActiva) {
        mostrarInfoModalGlobal("No se encontró una reserva activa asociada a esta habitación.", "Sin Reserva");
        return;
      }

      const { error: errRpc } = await supabase.rpc('cambiar_habitacion_transaccion', {
        p_reserva_id: resActiva.id,
        p_habitacion_origen_id: room.id,
        p_habitacion_destino_id: formValues.id,
        p_motivo_cambio: formValues.motivo,
        p_usuario_id: currentUser.id,
        p_hotel_id: hotelId,
        p_estado_destino: room.estado === 'reservada' ? 'reservada' : 'ocupada'
      });

      if (errRpc) {
        console.error('Error en cambiar_habitacion_transaccion:', errRpc);
        mostrarInfoModalGlobal("No se pudo cambiar la habitación: " + (errRpc.message || "Error en la transacción."), "Error");
        return;
      }

      closeRoomOptionsModal();

      document.dispatchEvent(new CustomEvent('renderRoomsComplete', { detail: { action: 'refresh' } }));
      mostrarInfoModalGlobal("Habitación cambiada correctamente.", "Éxito");
    } catch (err) {
      console.error('Error general al cambiar habitación:', err);
      mostrarInfoModalGlobal("Ocurrió un error al cambiar la habitación: " + (err.message || "Error desconocido"), "Error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });


  // --- ACCIÓN: SERVICIOS ADICIONALES ---
  setupButtonListener('btn-servicios-adicionales', async () => {
    const { data: reserva } = await supabase.from('reservas')
      .select('id, cliente_nombre, estado, monto_pagado')
      .eq('habitacion_id', room.id)
      .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
      .limit(1)
      .maybeSingle();

    if (!reserva) {
      mostrarInfoModalGlobal("No hay reserva activa.", "Error");
      return;
    }

    const { data: servicios } = await supabase.from('servicios_adicionales')
      .select('*')
      .eq('hotel_id', hotelId)
      .eq('activo', true);

    if (servicios && servicios.length > 0) {
      // Nota: Aquí llamamos a tu función externa, asegurate de que exista en el scope o importada
      showEnhancedServiciosModal(room, servicios, reserva, supabase, currentUser, hotelId);
    } else {
      mostrarInfoModalGlobal("No hay servicios configurados en el sistema.", "Info");
    }
  });

  // ===================================================================
  // Ver consumos (MODIFICADO: Usa modal local para evitar facturación electrónica)
  // ===================================================================
  setupButtonListener('btn-ver-consumos', async (btn) => {
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Cargando...';
    btn.disabled = true;

    try {
      // 1. Buscar reserva activa
      const { data: r, error: errReserva } = await supabase
        .from('reservas')
        .select('*') // Traemos todo para tener datos del cliente
        .eq('habitacion_id', room.id)
        .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
        .limit(1)
        .maybeSingle();

      if (errReserva) console.error(errReserva);

      if (!r) {
        mostrarInfoModalGlobal("No hay reserva activa para ver consumos.", "Sin Reserva");
        return;
      }

      // 2. Si es duración abierta, actualizar precio (lógica original)
      if (r.tipo_duracion === 'abierta') {
        try {
          const calculo = await calculateTimeAndPrice(supabase, r, hotelId, window.hotelConfigGlobal);
          if (calculo && calculo.precioAlojamientoCalculado !== Number(r.monto_total)) {
            const { error: upErr } = await supabase
              .from('reservas')
              .update({ monto_total: calculo.precioAlojamientoCalculado })
              .eq('id', r.id);
            if (!upErr) r.monto_total = calculo.precioAlojamientoCalculado;
          }
        } catch (e) { console.error(e); }
      }

      // 3. LLAMAR A NUESTRA NUEVA VENTANA MODAL LOCAL
      await mostrarModalConsumosLocal(room, r, supabase, currentUser, hotelId);

    } catch (err) {
      console.error(err);
      mostrarInfoModalGlobal("Error al cargar consumos.", "Error");
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  });


  // ===================================================================
  // ENTREGAR / LIBERAR HABITACIÓN (CON CORRECCIÓN DE ERROR DE DATOS)
  // ===================================================================
  setupButtonListener('btn-entregar', async (btn) => {
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Procesando...';
    btn.disabled = true;

    try {
      // 1. Buscar reserva activa asociada a la habitación
      const { data: reservaActiva, error: errReserva } = await supabase
        .from('reservas')
        .select('id, estado')
        .eq('habitacion_id', room.id)
        .eq('hotel_id', hotelId)
        .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
        .limit(1)
        .maybeSingle();

      if (errReserva) {
        console.error('Error buscando reserva activa al liberar:', errReserva);
      }

      // ========================================================================
      // CORRECCIÓN: MANEJO DE "ERROR DE DATOS" (Habitación ocupada sin reserva)
      // ========================================================================
      if (!reservaActiva) {
        // En lugar de bloquear, preguntamos si quieren forzar la limpieza
        const { isConfirmed } = await Swal.fire({
          icon: 'error',
          title: '⚠ Inconsistencia de Datos',
          html: `
          Esta habitación figura como ocupada, pero <b>no se encontró ninguna reserva activa</b> asociada.<br><br>
          ¿Deseas <b>forzar</b> el cambio de estado a <b>LIMPIEZA</b> para desbloquearla?
        `,
          showCancelButton: true,
          confirmButtonText: 'Sí, Forzar a Limpieza',
          confirmButtonColor: '#d33',
          cancelButtonText: 'Cancelar'
        });

        if (isConfirmed) {
          // 1. Forzar estado a limpieza
          await supabase.from('habitaciones')
            .update({ estado: 'limpieza' })
            .eq('id', room.id);

          // 2. Matar cualquier cronómetro huérfano (si lo hubiera)
          await supabase.from('cronometros')
            .update({ activo: false, fecha_fin: new Date().toISOString() })
            .eq('habitacion_id', room.id);

          // 3. Cerrar modal y refrescar
          modalContainer.style.display = 'none';
          modalContainer.innerHTML = '';
          const event = new CustomEvent('renderRoomsComplete', { detail: { action: 'refresh' } });
          document.dispatchEvent(event);

          await Swal.fire('Corregido', 'La habitación ha sido enviada a limpieza forzosamente.', 'success');
        }

        // Restaurar botón y salir
        btn.innerHTML = originalText;
        btn.disabled = false;
        return;
      }
      // ================= FIN DE LA CORRECCIÓN =================

      // SI SÍ HAY RESERVA, EL CÓDIGO SIGUE NORMALMENTE DESDE AQUÍ:

      // 2. Verificar artículos prestados sin devolver
      const { data: historialArticulos, error: errHist } = await supabase
        .from('historial_articulos_prestados')
        .select('articulo_nombre, cantidad, accion')
        .eq('hotel_id', hotelId)
        .eq('habitacion_id', room.id)
        .eq('reserva_id', reservaActiva.id);

      if (errHist) {
        console.error('Error consultando historial de artículos prestados:', errHist);
        // Continuamos aunque haya error de consulta, por seguridad
      }

      // Calculamos saldo por artículo
      const saldoPorArticulo = {};
      (historialArticulos || []).forEach((h) => {
        const nombre = h.articulo_nombre || 'Artículo';
        const cant = Number(h.cantidad || 0);
        if (!saldoPorArticulo[nombre]) saldoPorArticulo[nombre] = 0;

        if (h.accion === 'prestado') {
          saldoPorArticulo[nombre] += cant;
        } else if (h.accion === 'devuelto') {
          saldoPorArticulo[nombre] -= cant;
        }
      });

      const articulosPendientes = Object.entries(saldoPorArticulo)
        .filter(([_, saldo]) => saldo > 0);

      if (articulosPendientes.length > 0) {
        const listaHTML = articulosPendientes
          .map(([nombre, saldo]) => `• ${nombre} x${saldo}`)
          .join('<br>');

        await Swal.fire({
          icon: 'warning',
          title: 'Artículos prestados pendientes',
          html: `
          Esta habitación tiene artículos prestados que aún no se han devuelto:<br><br>
          ${listaHTML}<br><br>
          Registra la devolución antes de liberar la habitación.
        `
        });
        btn.innerHTML = originalText;
        btn.disabled = false;
        return; // 🔒 NO se libera
      }

      // 3. Calcular saldo REAL
      const { totalDeTodosLosCargos, saldoPendiente } =
        await calcularSaldoReserva(supabase, reservaActiva.id, hotelId);

      const margen = 50; // margen en pesos para redondeos

      if (totalDeTodosLosCargos > 0 && saldoPendiente > margen) {
        // 🔒 NO PERMITIR LIBERAR CON SALDO
        await Swal.fire({
          icon: 'warning',
          title: 'Saldo pendiente',
          html: `
          La habitación tiene un saldo pendiente de
          <b>$ ${formatCOP(saldoPendiente)}</b>.<br><br>
          Por favor cobra el saldo desde "Ver consumos" antes de liberar la habitación.
        `
        });
        btn.innerHTML = originalText;
        btn.disabled = false;
        return;
      }

      // 4. Confirmar liberación (saldo = 0 y sin artículos pendientes)
      const { isConfirmed } = await Swal.fire({
        icon: 'question',
        title: 'Liberar habitación',
        text: 'El saldo está en $0 y no hay artículos prestados pendientes. ¿Deseas liberar la habitación ahora?',
        showCancelButton: true,
        confirmButtonText: 'Sí, liberar',
        cancelButtonText: 'Cancelar'
      });

      if (!isConfirmed) {
        btn.innerHTML = originalText;
        btn.disabled = false;
        return;
      }

      const ahoraISO = new Date().toISOString();

      // 5. Cerrar reserva: estado finalizada
      await supabase.from('reservas')
        .update({
          estado: 'finalizada',
          fecha_fin: ahoraISO,
          monto_pagado: totalDeTodosLosCargos,
          actualizado_en: ahoraISO
        })
        .eq('id', reservaActiva.id);

      // 6. Detener cronómetro
      await supabase.from('cronometros')
        .update({ activo: false, fecha_fin: ahoraISO })
        .eq('habitacion_id', room.id)
        .eq('reserva_id', reservaActiva.id);

      // 7. Pasar habitación a estado "limpieza"
      await supabase.from('habitaciones')
        .update({ estado: 'limpieza', actualizado_en: ahoraISO })
        .eq('id', room.id);

      // 8. Registrar en bitácora (opcional)
      // ... tu lógica de bitácora ...

      // 9. Cerrar modal y recargar
      modalContainer.style.display = 'none';
      modalContainer.innerHTML = '';
      document.dispatchEvent(new CustomEvent('renderRoomsComplete', { detail: { action: 'refresh' } }));

      await Swal.fire({
        icon: 'success',
        title: 'Habitación liberada',
        text: 'La habitación se ha pasado a estado Limpieza.',
        timer: 1500,
        showConfirmButton: false
      });

    } catch (e) {
      console.error('Error general al liberar la habitación:', e);
      await Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Ocurrió un error al liberar la habitación.'
      });
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  });



}

// --- FUNCIONES RECUPERADAS ---
export function showEnhancedServiciosModal(roomDisplayInfo, availableServices, activeReservation, supabase, currentUser, hotelId) {
  const modalContainer = document.getElementById('modal-container');
  modalContainer.innerHTML = "";
  modalContainer.style.display = "flex";
  const userId = currentUser?.id || null;

  const modalContent = document.createElement('div');
  modalContent.className = "bg-white rounded-3xl shadow-2xl w-full max-w-xl p-6 sm:p-8 m-auto border-2 border-green-100 relative flex flex-col max-h-[90vh] animate-fade-in-up";

  modalContent.innerHTML = `
        <h3 class="text-2xl font-black mb-6 text-green-700 text-center flex items-center justify-center gap-2">
            <span>✨ Servicios Adicionales</span>
            <span class="text-xl text-green-500 font-medium">(${roomDisplayInfo.nombre})</span>
        </h3>
        
        <form id="form-servicios-adicionales" class="space-y-4 overflow-y-auto flex-grow pr-2">
            <label class="block text-lg font-semibold text-gray-700">Seleccione los servicios:</label>
            <div class="space-y-3">
                ${availableServices.map(s => `
                    <div class="service-item group flex items-center gap-3 rounded-xl bg-green-50 border border-green-200 p-3 hover:border-green-400 transition-all">
                        <input type="checkbox" id="servicio_${s.id}" name="servicio_ids" value="${s.id}" data-precio="${s.precio || 0}" class="form-checkbox h-5 w-5 text-green-600 rounded focus:ring-green-500 cursor-pointer">
                        
                        <label for="servicio_${s.id}" class="flex-1 flex justify-between items-center cursor-pointer select-none">
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-green-900">${s.nombre}</span>
                            </div>
                            <span class="text-green-700 font-semibold">${s.precio ? formatCurrency(s.precio) : 'Gratis'}</span>
                        </label>
                        
                        <input type="number" min="1" value="1" name="cantidad_${s.id}" 
                            class="quantity-input border-2 border-green-200 rounded-lg w-16 px-1 py-1 text-center font-bold text-gray-700 focus:ring-2 focus:ring-green-500 opacity-50 disabled:opacity-30 transition-opacity" 
                            disabled placeholder="Cant.">
                    </div>
                `).join('')}
            </div>

            <div class="pt-2">
                <label class="block mb-2 font-semibold text-gray-700">Nota (Opcional):</label>
                <textarea name="nota_servicio" class="w-full border-2 border-gray-200 rounded-xl p-3 focus:ring-2 focus:ring-green-500" rows="2" placeholder="Ej: Toallas extra, Sin hielo..."></textarea>
            </div>
        </form>

        <div class="mt-6 pt-4 border-t border-gray-100">
            <div class="flex justify-between items-center mb-4 text-xl font-bold text-gray-800">
                <span>Total Estimado:</span>
                <span id="preview-total-servicios" class="text-green-600">$0</span>
            </div>
            
            <div class="flex gap-3">
                <button type="submit" form="form-servicios-adicionales" class="flex-1 button button-success py-3 text-lg font-bold shadow-md">
                    Siguiente ➡
                </button>
                <button type="button" id="btn-cancelar-servicios" class="flex-1 button button-neutral py-3 text-lg font-bold shadow-md">
                    Cancelar
                </button>
            </div>
        </div>
    `;

  modalContent.innerHTML = normalizeLegacyText(modalContent.innerHTML);
  modalContainer.appendChild(modalContent);
  applyServiciosModalLabels(modalContent);

  // --- LÓGICA DEL FORMULARIO ---
  const form = modalContent.querySelector('#form-servicios-adicionales');
  const previewTotalElement = modalContent.querySelector('#preview-total-servicios');
  const serviceItems = form.querySelectorAll('.service-item');

  // Actualizar total y habilitar inputs de cantidad
  const updateState = () => {
    let total = 0;
    serviceItems.forEach(item => {
      const checkbox = item.querySelector('input[type="checkbox"]');
      const qtyInput = item.querySelector('.quantity-input');
      const precio = Number(checkbox.dataset.precio) || 0;

      if (checkbox.checked) {
        qtyInput.disabled = false;
        qtyInput.classList.remove('opacity-50');
        total += precio * (parseInt(qtyInput.value) || 1);
      } else {
        qtyInput.disabled = true;
        qtyInput.classList.add('opacity-50');
      }
    });
    previewTotalElement.textContent = formatCurrency(total);
  };

  form.addEventListener('input', updateState);

  // Cerrar modal
  modalContent.querySelector('#btn-cancelar-servicios').onclick = () => {
    modalContainer.style.display = "none";
    modalContainer.innerHTML = '';
  };

  // --- SUBMIT DEL FORMULARIO (SELECCIÓN DE MÉTODO DE PAGO) ---
  form.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const nota = formData.get('nota_servicio');

    // Recopilar items seleccionados
    const itemsSeleccionados = [];
    serviceItems.forEach(item => {
      const checkbox = item.querySelector('input[type="checkbox"]');
      if (checkbox.checked) {
        const qty = parseInt(item.querySelector('.quantity-input').value) || 1;
        const precio = Number(checkbox.dataset.precio) || 0;
        itemsSeleccionados.push({
          servicio_id: checkbox.value,
          cantidad: qty,
          precio_unitario: precio,
          subtotal: qty * precio,
          nombre: availableServices.find(s => s.id == checkbox.value)?.nombre
        });
      }
    });

    if (itemsSeleccionados.length === 0) {
      alert("Seleccione al menos un servicio.");
      return;
    }

    const totalPagar = itemsSeleccionados.reduce((sum, i) => sum + i.subtotal, 0);

    // PREGUNTAR: ¿Cobrar ahora o al final?
    const result = await Swal.fire({
      title: 'Confirmar Servicios',
      html: `
                <p class="mb-2">Total a cargar: <strong>${formatCurrency(totalPagar)}</strong></p>
                <div class="text-left text-sm bg-gray-50 p-3 rounded mb-4">
                    <ul class="list-disc ml-4">
                        ${itemsSeleccionados.map(i => `<li>${i.cantidad}x ${i.nombre}</li>`).join('')}
                    </ul>
                </div>
                <p class="text-sm text-gray-600">¿Desea cobrar esto ahora mismo o cargarlo a la cuenta?</p>
            `,
      icon: 'question',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Cobrar AHORA (Caja)',
      denyButtonText: 'Cargar a la Cuenta',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#10b981', // Verde
      denyButtonColor: '#3b82f6'     // Azul
    });

    if (result.isDismissed) return;

    try {
      showGlobalLoading("Procesando servicios...");

      if (result.isConfirmed) {
        // === COBRAR AHORA (Requiere Turno) ===
        const turnoId = turnoService.getActiveTurnId();
        if (!turnoId) throw new Error("No hay turno activo para cobrar en caja.");

        // 1. Obtener métodos de pago
        const { data: metodos } = await supabase.from('metodos_pago').select('id, nombre').eq('hotel_id', hotelId).eq('activo', true);
        if (!metodos.length) throw new Error("No hay métodos de pago configurados.");

        // Mapear para Swal
        const opciones = metodos.reduce((acc, curr) => ({ ...acc, [curr.id]: curr.nombre }), {});

        hideGlobalLoading(); // Ocultar spinner anterior para mostrar input

        // Seleccionar método de pago
        const { value: metodoPagoId } = await Swal.fire({
          title: 'Seleccione Método de Pago',
          input: 'select',
          inputOptions: opciones,
          inputPlaceholder: 'Seleccione...',
          showCancelButton: true
        });

        if (!metodoPagoId) return; // Cancelado
        showGlobalLoading("Registrando pago...");

        // 2. Registrar Pago en `pagos_reserva`
        const clienteNombreServicio = activeReservation?.cliente_nombre || 'Cliente General';
        const concepto = `Servicios Adicionales (${itemsSeleccionados.map(i => i.nombre).join(', ')}) - Cliente: ${clienteNombreServicio}`;
        const { data: pagoData, error: errPago } = await supabase.from('pagos_reserva').insert({
          hotel_id: hotelId,
          reserva_id: activeReservation.id,
          monto: totalPagar,
          metodo_pago_id: metodoPagoId,
          usuario_id: userId,
          concepto: concepto
        }).select().single();
        if (errPago) throw errPago;

        // 3. Registrar en Caja
        await supabase.from('caja').insert({
          hotel_id: hotelId,
          tipo: 'ingreso',
          monto: totalPagar,
          concepto: `Pago Servicios Hab. ${roomDisplayInfo.nombre} - Cliente: ${clienteNombreServicio}`,
          metodo_pago_id: metodoPagoId,
          usuario_id: userId,
          reserva_id: activeReservation.id,
          pago_reserva_id: pagoData.id,
          turno_id: turnoId
        });

        // 4. Registrar los servicios como PAGADOS
        const serviciosInsert = itemsSeleccionados.map(item => ({
          hotel_id: hotelId,
          reserva_id: activeReservation.id,
          servicio_id: item.servicio_id,
          cantidad: item.cantidad,
          precio_cobrado: item.subtotal,
          nota: nota,
          estado_pago: 'pagado',
          pago_reserva_id: pagoData.id
        }));
        const { error: errServ } = await supabase.from('servicios_x_reserva').insert(serviciosInsert);
        if (errServ) throw errServ;

        // 5. Actualizar monto pagado reserva
        const nuevoPagado = (activeReservation.monto_pagado || 0) + totalPagar;
        await supabase.from('reservas').update({ monto_pagado: nuevoPagado }).eq('id', activeReservation.id);

        Swal.fire('¡Éxito!', 'Servicios cobrados y registrados.', 'success');

      } else if (result.isDenied) {
        // === CARGAR A LA CUENTA (Pendiente) ===
        const serviciosInsert = itemsSeleccionados.map(item => ({
          hotel_id: hotelId,
          reserva_id: activeReservation.id,
          servicio_id: item.servicio_id,
          cantidad: item.cantidad,
          precio_cobrado: item.subtotal,
          nota: nota,
          estado_pago: 'pendiente' // Se paga al checkout
        }));

        const { error: errServ } = await supabase.from('servicios_x_reserva').insert(serviciosInsert);
        if (errServ) throw errServ;

        Swal.fire('Registrado', 'Los servicios se han cargado a la cuenta de la habitación.', 'success');
      }

      // Cerrar modal y limpiar
      modalContainer.style.display = "none";
      modalContainer.innerHTML = '';
      refreshMapaHabitaciones();

    } catch (error) {
      console.error(error);
      hideGlobalLoading();
      Swal.fire('Error', error.message, 'error');
    } finally {
      hideGlobalLoading();
    }
  };
}

export async function showReservaFuturaModal(room, supabase, currentUser, hotelId, mainAppContainer) {
  const modalContainer = document.getElementById('modal-container');
  modalContainer.style.display = "flex";
  modalContainer.innerHTML = "";

  const modalContent = document.createElement('div');
  modalContent.className = "bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 m-auto";
  modalContent.innerHTML = `
        <h3 class="text-xl font-bold mb-5 text-blue-700 text-center">Reservar para otra fecha: ${room.nombre}</h3>
        <form id="form-reserva-futura" class="space-y-3">
            <input required name="cliente_nombre" class="form-control" placeholder="Nombre huésped">
            <input required name="cedula" class="form-control" placeholder="Cédula">
            <input required name="telefono" class="form-control" placeholder="Teléfono">
            <label class="block text-sm mb-1 mt-2">Fecha entrada:</label>
            <input required type="date" name="fecha_inicio" class="form-control">
            <label class="block text-sm mb-1 mt-2">Fecha salida:</label>
            <input required type="date" name="fecha_fin" class="form-control">
            <input required type="number" min="1" max="10" name="cantidad_huespedes" class="form-control mt-2" value="1" placeholder="Cantidad huéspedes">
            <button type="submit" class="button button-success w-full mt-2">Guardar reserva futura</button>
            <button type="button" id="cerrar-modal-futura" class="button w-full mt-2" style="background:#ef4444;color:white;">Cancelar</button>
        </form>
    `;
  modalContent.innerHTML = normalizeLegacyText(modalContent.innerHTML);
  modalContainer.appendChild(modalContent);

  modalContent.querySelector('#cerrar-modal-futura').onclick = () => {
    modalContainer.style.display = "none";
    modalContainer.innerHTML = '';
  };

  modalContent.querySelector('#form-reserva-futura').onsubmit = async (e) => {
    e.preventDefault();
    const formData = Object.fromEntries(new FormData(e.target));
    // Validación básica de fechas
    if (formData.fecha_inicio > formData.fecha_fin) {
      mostrarInfoModalGlobal("La fecha de salida debe ser posterior a la de entrada.", "Error fechas");
      return;
    }
    // Crear la reserva futura
    await supabase.from('reservas').insert([{
      cliente_nombre: formData.cliente_nombre,
      cedula: formData.cedula,
      telefono: formData.telefono,
      habitacion_id: room.id,
      hotel_id: hotelId,
      fecha_inicio: formData.fecha_inicio,
      fecha_fin: formData.fecha_fin,
      estado: "reservada",
      cantidad_huespedes: Number(formData.cantidad_huespedes),
    }]);
    mostrarInfoModalGlobal("Reserva futura guardada correctamente.", "Reserva creada");
    modalContainer.style.display = "none";
    modalContainer.innerHTML = '';
    refreshMapaHabitaciones();
  }
}

export async function showSeguimientoArticulosModal(room, supabase, currentUser, hotelId) {
  const modalContainer = document.getElementById('modal-container');
  showGlobalLoading("Cargando inventario...", modalContainer);

  try {
    // 1. Encontrar la reserva activa
    const { data: reservaActiva, error: errRes } = await supabase
      .from('reservas')
      .select('id')
      .eq('habitacion_id', room.id)
      .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
      .order('fecha_inicio', { ascending: false })
      .limit(1)
      .single();

    if (errRes || !reservaActiva) {
      throw new Error("No se encontró una reserva activa para esta habitación.");
    }

    // 2. Cargar datos en paralelo
    const [prestadosRes, disponiblesRes] = await Promise.all([
      // Artículos YA prestados a esta reserva
      supabase.from('historial_articulos_prestados')
        .select('id, articulo_nombre, item_prestable_id')
        .eq('reserva_id', reservaActiva.id)
        .eq('accion', 'prestado'),
      // Artículos DISPONIBLES en el inventario
      supabase.from('inventario_prestables')
        .select('id, nombre_item, stock_disponible')
        .eq('hotel_id', hotelId)
        .gt('stock_disponible', 0) // ¡Solo los que tienen stock!
    ]);

    if (prestadosRes.error) throw new Error(`Error cargando prestados: ${prestadosRes.error.message}`);
    if (disponiblesRes.error) throw new Error(`Error cargando disponibles: ${disponiblesRes.error.message}`);

    const itemsYaPrestados = prestadosRes.data || [];
    const itemsDisponibles = disponiblesRes.data || [];

    hideGlobalLoading();
    modalContainer.innerHTML = ""; // Limpiar el "cargando"
    const modalContent = document.createElement('div');
    modalContent.className = "bg-white rounded-xl shadow-2xl w-full max-w-md p-6 m-auto relative animate-fade-in-up";

    // 3. Crear el HTML del modal
    const opcionesSelect = itemsDisponibles.length > 0
      ? itemsDisponibles.map(item => `<option value="${item.id}" data-nombre="${item.nombre_item}">${item.nombre_item} (Stock: ${item.stock_disponible})</option>`).join('')
      : '<option value="" disabled>No hay artículos disponibles</option>';

    modalContent.innerHTML = `
            <h3 class="text-xl font-bold mb-4 text-blue-700">Gestionar Artículos (Hab. ${room.nombre})</h3>
            <div class="mb-4">
                <label class="form-label" for="select-articulo-prestable">Añadir artículo:</label>
                <div class="flex gap-2">
                    <select id="select-articulo-prestable" class="form-control flex-grow">
                        <option value="">-- Seleccione un artículo --</option>
                        ${opcionesSelect}
                    </select>
                    <button id="btn-add-articulo" class="button button-info">Prestar</button>
                </div>
            </div>
            <div class="mb-4">
                <p class="font-semibold text-gray-700">Artículos prestados actualmente:</p>
                <div id="lista-articulos-seguimiento" class="mt-2 space-y-2 max-h-40 overflow-y-auto p-2 bg-gray-50 rounded">
                    </div>
            </div>
            <div class="flex gap-3 mt-6">
                <button id="btn-cerrar-seguimiento" class="button button-neutral flex-1">Cerrar</button>
            </div>
        `;
    modalContainer.appendChild(modalContent);

    const listaEl = modalContent.querySelector('#lista-articulos-seguimiento');
    const selectEl = modalContent.querySelector('#select-articulo-prestable');

    // 4. Función para renderizar la lista de artículos prestados
    // 4. Función para renderizar la lista de artículos prestados
    function renderListaPrestados(items) {
      if (items.length === 0) {
        listaEl.innerHTML = `<p class="text-gray-500 italic text-sm text-center">No hay artículos prestados.</p>`;
        return;
      }
      listaEl.innerHTML = items.map(item => `
                <div class="flex justify-between items-center bg-white p-2 rounded shadow-sm">
                    <span class="text-gray-800">${item.articulo_nombre}</span>
                    
                    <button data-historial-id="${item.id}" data-item-id="${item.item_prestable_id}" 
                            class="btn-devolver-articulo button button-danger button-small text-xs py-1 px-2" 
                            title="Marcar como Devuelto">
                        Devolver
                    </button>
                    </div>
            `).join('');
    }
    renderListaPrestados(itemsYaPrestados); // Renderizado inicial

    // 5. Listeners del modal
    modalContent.querySelector('#btn-cerrar-seguimiento').onclick = () => {
      modalContainer.style.display = "none";
      modalContainer.innerHTML = '';
      // Refrescar el mapa para que la tarjeta muestre el cambio
      refreshMapaHabitaciones();
    };

    // PRESTAR artículo
    modalContent.querySelector('#btn-add-articulo').onclick = async () => {
      const selectedOption = selectEl.options[selectEl.selectedIndex];
      const itemId = selectedOption.value;
      const itemNombre = selectedOption.dataset.nombre;

      if (!itemId) {
        alert("Por favor, seleccione un artículo para prestar.");
        return;
      }

      const btn = modalContent.querySelector('#btn-add-articulo');
      btn.disabled = true;
      btn.textContent = "Prestando...";

      try {
        // 1. Llamar a la RPC para descontar stock
        const { error: rpcError } = await supabase.rpc('prestar_articulo', { p_item_id: itemId });
        if (rpcError) throw rpcError;

        // 2. Insertar en el historial
        const { data: nuevoHistorial, error: insertError } = await supabase.from('historial_articulos_prestados').insert({
          hotel_id: hotelId,
          reserva_id: reservaActiva.id,
          habitacion_id: room.id,
          usuario_id: currentUser.id,
          articulo_nombre: itemNombre,
          item_prestable_id: itemId,
          accion: 'prestado',
          cantidad: 1
        }).select('id, articulo_nombre, item_prestable_id').single();
        if (insertError) throw insertError;

        // 3. Recargar el modal
        await showSeguimientoArticulosModal(room, supabase, currentUser, hotelId);

      } catch (err) {
        alert(`Error al prestar artículo: ${err.message}`);
        btn.disabled = false;
        btn.textContent = "Prestar";
      }
    };

    // DEVOLVER artículo (antes del check-out)
    listaEl.onclick = async (e) => {
      if (e.target.classList.contains('btn-devolver-articulo')) {
        const btn = e.target;
        const historialId = btn.dataset.historialId;
        const itemId = btn.dataset.itemId;

        // --- INICIO DE LA MODIFICACIÓN ---
        const result = await Swal.fire({
          title: 'Confirmar Devolución',
          text: '¿Está seguro de que desea marcar este artículo como devuelto?',
          icon: 'question',
          showCancelButton: true,
          confirmButtonColor: '#1d4ed8', // El azul de tu app
          cancelButtonColor: '#d33',
          confirmButtonText: 'Sí, devolver',
          cancelButtonText: 'Cancelar'
        });

        if (!result.isConfirmed) {
          return; // Si el usuario cancela, no hacemos nada
        }
        // --- FIN DE LA MODIFICACIÓN ---

        btn.disabled = true;

        try {
          // 1. Llamar a la RPC para devolver al stock
          const { error: rpcError } = await supabase.rpc('recibir_articulo_devuelto', { p_item_id: itemId });
          if (rpcError) throw rpcError;

          // 2. Actualizar el historial
          const { error: updateError } = await supabase.from('historial_articulos_prestados')
            .update({ accion: 'devuelto' })
            .eq('id', historialId);
          if (updateError) throw updateError;

          // 3. Recargar el modal
          await showSeguimientoArticulosModal(room, supabase, currentUser, hotelId);

        } catch (err) {
          alert(`Error al devolver artículo: ${err.message}`);
          btn.disabled = false;
        }
      }
    };

  } catch (err) {
    hideGlobalLoading();
    mostrarInfoModalGlobal(err.message, "Error", [], modalContainer);
  }
}

export async function mostrarModalConsumosLocal(room, reserva, supabase, user, hotelId) {
  const modalContainer = document.getElementById('modal-container');
  modalContainer.style.display = 'flex';
  modalContainer.innerHTML = '<div class="text-white font-bold">Cargando consumos...</div>';

  const asNum = (v) => Number(v ?? 0);
  const asInt = (v) => Math.round(asNum(v));
  const money = (n) => (typeof formatCurrency === 'function'
    ? formatCurrency(asInt(n))
    : `$${asInt(n).toLocaleString('es-CO')}`);

  const hasSwal = typeof Swal !== 'undefined';
  const safeShowLoading = (msg) => (typeof showGlobalLoading === 'function' ? showGlobalLoading(msg) : null);
  const safeHideLoading = () => (typeof hideGlobalLoading === 'function' ? hideGlobalLoading() : null);

  const cerrarModal = () => {
    modalContainer.style.display = 'none';
    modalContainer.innerHTML = '';
  };

  // ✅ Parse robusto de dinero: acepta "10000", "10.000", "10,000", "$ 10.000"
  const parseMoneyInput = (val) => {
    if (val === null || val === undefined) return 0;
    const s = String(val).trim();
    const digits = s.replace(/[^\d]/g, ''); // deja solo números
    return asInt(digits || 0);
  };

  async function obtenerTurnoActivoId() {
    if (typeof turnoService !== 'undefined' && typeof turnoService.getActiveTurnId === 'function') {
      const tid = turnoService.getActiveTurnId();
      if (tid) return tid;
    }
    const { data, error } = await supabase
      .from('turnos')
      .select('id')
      .eq('hotel_id', hotelId)
      .eq('usuario_id', user.id)
      .eq('estado', 'abierto')
      .order('fecha_apertura', { ascending: false })
      .limit(1);

    if (error) throw error;
    return data?.[0]?.id || null;
  }

  async function getTotalPagadoDb() {
    const { data, error } = await supabase
      .from('pagos_reserva')
      .select('monto')
      .eq('reserva_id', reserva.id);

    if (error) throw error;
    return asInt((data || []).reduce((s, p) => s + asInt(p.monto), 0));
  }

  async function elegirMetodoPagoId() {
    const { data: metodos, error } = await supabase
      .from('metodos_pago')
      .select('id, nombre')
      .eq('hotel_id', hotelId)
      .eq('activo', true);

    if (error) throw error;
    if (!metodos || metodos.length === 0) throw new Error('No hay métodos de pago configurados.');

    if (!hasSwal) return metodos[0].id;

    const opciones = metodos.reduce((acc, curr) => ({ ...acc, [curr.id]: curr.nombre }), {});
    const { value } = await Swal.fire({
      title: 'Método de pago',
      input: 'select',
      inputOptions: opciones,
      inputPlaceholder: 'Seleccione...',
      showCancelButton: true
    });

    return value || null;
  }

  async function registrarPagoEnBD(monto, { liquidarTodo = false, deudaTotalActual = 0 } = {}) {
    const montoInt = asInt(monto);
    if (!montoInt || montoInt <= 0) throw new Error('Monto inválido.');

    const turnoId = await obtenerTurnoActivoId();
    if (!turnoId) throw new Error('No hay turno activo para registrar el pago en caja.');

    const metodoPagoId = await elegirMetodoPagoId();
    if (!metodoPagoId) return { cancelled: true };

    const clienteNombreSaldo = reserva?.cliente_nombre || 'Cliente General';
    const concepto = liquidarTodo
      ? `Pago total saldo Hab. ${room.nombre} - Cliente: ${clienteNombreSaldo}`
      : `Abono saldo Hab. ${room.nombre} - Cliente: ${clienteNombreSaldo}`;

    safeShowLoading('Registrando pago...');

    const { data: pagoData, error: errPago } = await supabase
      .from('pagos_reserva')
      .insert({
        hotel_id: hotelId,
        reserva_id: reserva.id,
        monto: montoInt,
        metodo_pago_id: metodoPagoId,
        usuario_id: user.id,
        concepto
      })
      .select()
      .single();

    if (errPago) {
      safeHideLoading();
      throw errPago;
    }

    const { error: errCaja } = await supabase.from('caja').insert({
      hotel_id: hotelId,
      tipo: 'ingreso',
      monto: montoInt,
      concepto,
      metodo_pago_id: metodoPagoId,
      usuario_id: user.id,
      reserva_id: reserva.id,
      pago_reserva_id: pagoData.id,
      turno_id: turnoId
    });

    if (errCaja) {
      safeHideLoading();
      throw errCaja;
    }

    const totalPagadoDb = await getTotalPagadoDb();
    const nuevoMontoPagado = Math.min(asInt(deudaTotalActual), totalPagadoDb);

    const { error: errUpd } = await supabase
      .from('reservas')
      .update({ monto_pagado: nuevoMontoPagado })
      .eq('id', reserva.id);

    if (errUpd) {
      safeHideLoading();
      throw errUpd;
    }

    safeHideLoading();
    return { cancelled: false, pagoReservaId: pagoData.id };
  }

  async function marcarPendientesComoPagados(pagoReservaId) {
    await supabase
      .from('servicios_x_reserva')
      .update({ estado_pago: 'pagado', pago_reserva_id: pagoReservaId })
      .eq('hotel_id', hotelId)
      .eq('reserva_id', reserva.id)
      .neq('estado_pago', 'pagado');

    await supabase
      .from('ventas_tienda')
      .update({ estado_pago: 'pagado' })
      .eq('hotel_id', hotelId)
      .eq('reserva_id', reserva.id)
      .neq('estado_pago', 'pagado');

    await supabase
      .from('ventas_restaurante')
      .update({ estado_pago: 'pagado' })
      .eq('hotel_id', hotelId)
      .eq('reserva_id', reserva.id)
      .neq('estado_pago', 'pagado');
  }

  async function cargarCuentaDetallada() {
    const serviciosRes = await supabase
      .from('servicios_x_reserva')
      .select('id, cantidad, precio_cobrado, estado_pago, descripcion_manual, servicio:servicios_adicionales(nombre)')
      .eq('reserva_id', reserva.id);

    if (serviciosRes.error) throw serviciosRes.error;
    const servicios = serviciosRes.data || [];

    const ventasTiendaRes = await supabase
      .from('ventas_tienda')
      .select('id, total_venta, estado_pago')
      .eq('hotel_id', hotelId)
      .eq('reserva_id', reserva.id);

    if (ventasTiendaRes.error) throw ventasTiendaRes.error;
    const ventasTienda = ventasTiendaRes.data || [];
    const ventaTiendaIds = ventasTienda.map(v => v.id);

    let detallesTienda = [];
    if (ventaTiendaIds.length > 0) {
      const detTiendaRes = await supabase
        .from('detalle_ventas_tienda')
        .select('venta_id, cantidad, subtotal, producto:productos_tienda!detalle_ventas_tienda_producto_id_fkey(nombre)')
        .in('venta_id', ventaTiendaIds);

      if (detTiendaRes.error) throw detTiendaRes.error;
      detallesTienda = detTiendaRes.data || [];
    }

    const ventasRestRes = await supabase
      .from('ventas_restaurante')
      .select('id, monto_total, total_venta, estado_pago')
      .eq('hotel_id', hotelId)
      .eq('reserva_id', reserva.id);

    if (ventasRestRes.error) throw ventasRestRes.error;
    const ventasRest = ventasRestRes.data || [];
    const ventaRestIds = ventasRest.map(v => v.id);

    let itemsRest = [];
    if (ventaRestIds.length > 0) {
      const itemsRestRes = await supabase
        .from('ventas_restaurante_items')
        .select('venta_id, cantidad, subtotal, plato:platos!ventas_restaurante_items_plato_id_fkey(nombre)')
        .in('venta_id', ventaRestIds);

      if (itemsRestRes.error) throw itemsRestRes.error;
      itemsRest = itemsRestRes.data || [];
    }

    const pagosRes = await supabase
      .from('pagos_reserva')
      .select('id, monto, fecha_pago')
      .eq('reserva_id', reserva.id);

    if (pagosRes.error) throw pagosRes.error;
    const pagos = pagosRes.data || [];

    const totalEstancia = asInt(reserva.monto_total);
    const totalServicios = asInt(servicios.reduce((s, x) => s + asInt(x.precio_cobrado), 0));
    const totalTienda = asInt(ventasTienda.reduce((s, v) => s + asInt(v.total_venta), 0));
    const totalRest = asInt(ventasRest.reduce((s, v) => s + asInt(v.monto_total ?? v.total_venta), 0));
    const totalExtrasPagados = asInt([
      ...servicios.filter((x) => (x.estado_pago || 'pendiente') === 'pagado').map((x) => asInt(x.precio_cobrado)),
      ...ventasTienda.filter((v) => (v.estado_pago || 'pendiente') === 'pagado').map((v) => asInt(v.total_venta)),
      ...ventasRest.filter((v) => (v.estado_pago || 'pendiente') === 'pagado').map((v) => asInt(v.monto_total ?? v.total_venta)),
    ].reduce((s, monto) => s + monto, 0));

    const deudaTotal = asInt(totalEstancia + totalServicios + totalTienda + totalRest);
    const totalPagado = asInt(pagos.reduce((s, p) => s + asInt(p.monto), 0));
    const saldo = Math.max(0, asInt(deudaTotal - totalPagado));
    const pagoAplicadoAHospedaje = Math.max(0, asInt(totalPagado - totalExtrasPagados));
    const saldoHospedaje = Math.max(0, asInt(totalEstancia - pagoAplicadoAHospedaje));

    const mapTiendaEstado = Object.fromEntries(ventasTienda.map(v => [v.id, (v.estado_pago || 'pendiente')]));
    const mapRestEstado = Object.fromEntries(ventasRest.map(v => [v.id, (v.estado_pago || 'pendiente')]));

    return {
      servicios,
      ventasTienda,
      detallesTienda,
      mapTiendaEstado,
      ventasRest,
      itemsRest,
      mapRestEstado,
      pagos,
      totalEstancia,
      deudaTotal,
      totalPagado,
      saldo,
      pagoAplicadoAHospedaje,
      saldoHospedaje
    };
  }

  try {
    const cuenta = await cargarCuentaDetallada();

    const listaItems = [];

    const estadoHospedaje = cuenta.saldoHospedaje <= 0
      ? 'PAGADO'
      : cuenta.pagoAplicadoAHospedaje > 0
        ? 'ABONADO'
        : 'PENDIENTE';

    listaItems.push({
      tipo: 'Hospedaje',
      detalle: `Estancia Hab. ${room.nombre}`,
      cant: 1,
      subtotal: cuenta.totalEstancia,
      estado: estadoHospedaje
    });

    (cuenta.servicios || []).forEach(s => {
      const nombre = s?.servicio?.nombre || s.descripcion_manual || 'Servicio';
      const pagado = (s.estado_pago || 'pendiente') === 'pagado';
      listaItems.push({
        tipo: 'Servicio',
        detalle: nombre,
        cant: asInt(s.cantidad) || 1,
        subtotal: asInt(s.precio_cobrado),
        estado: pagado ? 'PAGADO' : 'PENDIENTE'
      });
    });

    (cuenta.detallesTienda || []).forEach(d => {
      const estadoVenta = (cuenta.mapTiendaEstado?.[d.venta_id] || 'pendiente');
      const pagado = estadoVenta === 'pagado';
      listaItems.push({
        tipo: 'Tienda',
        detalle: d?.producto?.nombre || 'Producto Tienda',
        cant: asInt(d.cantidad) || 1,
        subtotal: asInt(d.subtotal),
        estado: pagado ? 'PAGADO' : 'PENDIENTE'
      });
    });

    (cuenta.itemsRest || []).forEach(it => {
      const estadoVenta = (cuenta.mapRestEstado?.[it.venta_id] || 'pendiente');
      const pagado = estadoVenta === 'pagado';
      listaItems.push({
        tipo: 'Restaurante',
        detalle: it?.plato?.nombre || 'Plato',
        cant: asInt(it.cantidad) || 1,
        subtotal: asInt(it.subtotal),
        estado: pagado ? 'PAGADO' : 'PENDIENTE'
      });
    });

    const rowsHtml = listaItems.map(item => {
      const badge = item.estado === 'PAGADO'
        ? `<span class="text-xs px-2 py-1 rounded bg-green-100 text-green-700 font-bold">PAGADO</span>`
        : item.estado === 'ABONADO'
          ? `<span class="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 font-bold">ABONADO</span>`
          : `<span class="text-xs px-2 py-1 rounded bg-red-100 text-red-700 font-bold">PENDIENTE</span>`;
      return `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
          <td class="p-2 text-xs text-gray-500 uppercase tracking-wide">${item.tipo}</td>
          <td class="p-2 text-sm font-semibold text-gray-800 flex items-center justify-between gap-2">
            <span>${item.detalle}</span>
            ${badge}
          </td>
          <td class="p-2 text-sm text-center text-gray-600">${item.cant}</td>
          <td class="p-2 text-sm text-right font-bold text-gray-700">${money(item.subtotal)}</td>
        </tr>
      `;
    }).join('');

    const tieneSaldo = cuenta.saldo > 0;

    modalContainer.innerHTML = `
      <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl overflow-hidden animate-fade-in-up flex flex-col max-h-[85vh]">
        <div class="bg-gray-50 px-6 py-4 border-b flex justify-between items-center flex-shrink-0">
          <div>
            <h3 class="text-lg font-bold text-gray-800">Detalle de Cuenta: ${room.nombre}</h3>
            <p class="text-sm text-gray-500">Cliente: <strong>${reserva.cliente_nombre || 'N/A'}</strong></p>
          </div>
          <button id="btn-cerrar-local" class="text-gray-400 hover:text-red-500 text-2xl transition">&times;</button>
        </div>

        <div class="p-0 overflow-y-auto flex-grow custom-scrollbar">
          <table class="w-full text-left border-collapse">
            <thead class="bg-blue-50 text-blue-800 uppercase text-xs sticky top-0 shadow-sm">
              <tr>
                <th class="p-3 font-semibold">Origen</th>
                <th class="p-3 font-semibold">Descripción</th>
                <th class="p-3 text-center font-semibold">Cant.</th>
                <th class="p-3 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        <div class="bg-gray-50 px-6 py-4 border-t flex-shrink-0">
          <div class="flex justify-end flex-col items-end space-y-1 mb-4 border-b border-gray-200 pb-2">
            <div class="text-sm text-gray-600">Total de cargos:
              <span class="font-bold text-gray-900">${money(cuenta.deudaTotal)}</span>
            </div>
            <div class="text-sm text-green-600">Pagos aplicados:
              <span class="font-bold">${money(cuenta.totalPagado)}</span>
            </div>
          </div>

          <div class="flex justify-between items-center">
            <div class="text-xl ${cuenta.saldo > 0 ? 'text-red-600' : 'text-blue-600'}">
              Saldo: <span class="font-bold">${money(cuenta.saldo)}</span>
            </div>

            <div class="flex gap-3">
              ${tieneSaldo ? `
                <button id="btn-abonar-saldo-local" class="button button-warning px-5 py-2 shadow-lg flex items-center gap-2 hover:scale-105 transition transform">
                  ➕ Abonar
                </button>
                <button id="btn-pagar-saldo-local" class="button button-info px-5 py-2 shadow-lg flex items-center gap-2 hover:scale-105 transition transform">
                  💳 Pagar todo
                </button>
              ` : ''}

              <button id="btn-imprimir-pos-local" class="button button-success px-5 py-2 shadow-lg flex items-center gap-2 hover:scale-105 transition transform">
                Imprimir Factura
              </button>

              <button id="btn-cerrar-local-2" class="button button-neutral px-4 py-2">Cerrar</button>
            </div>
          </div>
        </div>
      </div>
    `;
    modalContainer.innerHTML = normalizeLegacyText(modalContainer.innerHTML);
    applyConsumosModalLabels();

    document.getElementById('btn-cerrar-local')?.addEventListener('click', cerrarModal);
    document.getElementById('btn-cerrar-local-2')?.addEventListener('click', cerrarModal);

    // ✅ PAGAR TODO
    document.getElementById('btn-pagar-saldo-local')?.addEventListener('click', async () => {
      try {
        const cuentaActual = await cargarCuentaDetallada();
        if (cuentaActual.saldo <= 0) {
          if (hasSwal) await Swal.fire('Info', 'Esta cuenta ya está saldada.', 'info');
          return mostrarModalConsumosLocal(room, reserva, supabase, user, hotelId);
        }

        if (hasSwal) {
          const conf = await Swal.fire({
            title: 'Confirmar pago',
            text: `¿Deseas pagar TODO el saldo (${money(cuentaActual.saldo)})?`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Sí, pagar todo',
            cancelButtonText: 'Cancelar'
          });
          if (!conf.isConfirmed) return;
        }

        const resPago = await registrarPagoEnBD(cuentaActual.saldo, {
          liquidarTodo: true,
          deudaTotalActual: cuentaActual.deudaTotal
        });
        if (resPago?.cancelled) return;

        await marcarPendientesComoPagados(resPago.pagoReservaId);

        if (hasSwal) await Swal.fire('Listo', 'Pago registrado. Saldo en 0.', 'success');
        await mostrarModalConsumosLocal(room, reserva, supabase, user, hotelId);
      } catch (e) {
        console.error(e);
        safeHideLoading();
        if (hasSwal) Swal.fire('Error', e.message || 'No se pudo registrar el pago.', 'error');
      }
    });

    // ✅ ABONAR (ARREGLADO: input TEXT + parse, sin error de step)
    document.getElementById('btn-abonar-saldo-local')?.addEventListener('click', async () => {
      try {
        const cuentaActual = await cargarCuentaDetallada();
        if (cuentaActual.saldo <= 0) {
          if (hasSwal) await Swal.fire('Info', 'Esta cuenta ya está saldada.', 'info');
          return mostrarModalConsumosLocal(room, reserva, supabase, user, hotelId);
        }

        let montoAbono = 0;

        if (hasSwal) {
          const { value } = await Swal.fire({
            title: 'Abonar a la deuda',
            html: `Saldo actual: <b>${money(cuentaActual.saldo)}</b><br>¿Cuánto desea abonar? (Ej: 10000 o 10.000)`,
            input: 'text',
            inputValue: String(Math.min(cuentaActual.saldo, 10000)),
            inputAttributes: {
              inputmode: 'numeric',
              autocapitalize: 'off',
              autocomplete: 'off',
              autocorrect: 'off',
              spellcheck: 'false'
            },
            showCancelButton: true,
            confirmButtonText: 'Registrar abono',
            cancelButtonText: 'Cancelar',
            preConfirm: (val) => {
              const n = parseMoneyInput(val);
              if (!n || n <= 0) return Swal.showValidationMessage('Ingresa un monto válido.');
              if (n > cuentaActual.saldo) return Swal.showValidationMessage('El abono no puede ser mayor al saldo.');
              return n;
            }
          });

          if (!value) return;
          montoAbono = asInt(value);
        } else {
          montoAbono = Math.min(cuentaActual.saldo, 10000);
        }

        const resPago = await registrarPagoEnBD(montoAbono, {
          liquidarTodo: false,
          deudaTotalActual: cuentaActual.deudaTotal
        });
        if (resPago?.cancelled) return;

        if (hasSwal) await Swal.fire('Listo', `Abono registrado: ${money(montoAbono)}`, 'success');
        await mostrarModalConsumosLocal(room, reserva, supabase, user, hotelId);
      } catch (e) {
        console.error(e);
        safeHideLoading();
        if (hasSwal) Swal.fire('Error', e.message || 'No se pudo registrar el abono.', 'error');
      }
    });

    // IMPRIMIR (igual que antes)
    document.getElementById('btn-imprimir-pos-local')?.addEventListener('click', async () => {
      try {
        if (typeof imprimirFacturaPosAdaptable !== 'function') {
          if (hasSwal) return Swal.fire('Error', 'No existe imprimirFacturaPosAdaptable().', 'error');
          return;
        }

        const { data: config, error } = await supabase
          .from('configuracion_hotel')
          .select('*')
          .eq('hotel_id', hotelId)
          .maybeSingle();

        if (error) throw error;

        const datosParaImprimir = {
          cliente: {
            nombre: reserva.cliente_nombre,
            documento: reserva.cedula || reserva.cliente_cedula || ''
          },
          reservaId: reserva.id,
          habitacionNombre: room.nombre,
          items: listaItems.map(i => ({
            nombre: `${i.detalle} (${i.estado})`,
            cantidad: i.cant,
            total: i.subtotal,
            precioUnitario: i.cant > 0 ? asInt(i.subtotal / i.cant) : 0
          })),
          total: cuenta.deudaTotal,
          totalPagado: cuenta.totalPagado,
          impuestos: 0,
          descuento: asInt(reserva.monto_descontado),
          subtotal: cuenta.deudaTotal
        };

        imprimirFacturaPosAdaptable(config || {}, datosParaImprimir);
      } catch (e) {
        console.error(e);
        if (hasSwal) Swal.fire('Error', e.message || 'No se pudo imprimir.', 'error');
      }
    });

  } catch (error) {
    console.error('Error en mostrarModalConsumosLocal:', error);
    modalContainer.innerHTML = `
      <div class="bg-white p-4 rounded text-red-600">
        Error cargando consumos: ${error.message || error}
        <button id="btn-cerrar-error" class="ml-4 underline">Cerrar</button>
      </div>
    `;
    document.getElementById('btn-cerrar-error')?.addEventListener('click', cerrarModal);
  }
}






// ===================================================================
// GENERADOR DE HTML PARA FACTURA POS (ADAPTABLE)
// Poner esto al final de mapa-habitaciones.js
// ===================================================================
