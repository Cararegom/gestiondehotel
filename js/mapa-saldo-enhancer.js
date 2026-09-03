import { calcularResumenSaldoCheckout } from './modules/mapa-habitaciones/datos.js';
import { formatCurrency } from './uiUtils.js';
import './mapa-consumos-pagos-enhancer.js';

const ACTIVE_RESERVATION_STATES = ['activa', 'ocupada', 'tiempo agotado'];
const BALANCE_TOLERANCE = 50;
const BALANCE_REFRESH_DELAY_MS = 140;

let refreshTimer = null;
let requestGeneration = 0;
let appObserver = null;

function groupByReserva(items = []) {
  return (Array.isArray(items) ? items : []).reduce((acc, item) => {
    const reservaId = item?.reserva_id;
    if (!reservaId) return acc;
    if (!acc[reservaId]) acc[reservaId] = [];
    acc[reservaId].push(item);
    return acc;
  }, {});
}

function sumPayments(items = []) {
  return (Array.isArray(items) ? items : []).reduce(
    (total, item) => total + Number(item?.monto || 0),
    0
  );
}

function buildCajaByReserva({ ventas = [], movimientos = [], ventaIdKey }) {
  const reservaByVentaId = new Map();
  ventas.forEach((venta) => {
    if (venta?.id && venta?.reserva_id) {
      reservaByVentaId.set(venta.id, venta.reserva_id);
    }
  });

  return (Array.isArray(movimientos) ? movimientos : []).reduce((acc, movimiento) => {
    const ventaId = movimiento?.[ventaIdKey];
    const reservaId = ventaId ? reservaByVentaId.get(ventaId) : null;
    if (!reservaId) return acc;
    if (!acc[reservaId]) acc[reservaId] = [];
    acc[reservaId].push(movimiento);
    return acc;
  }, {});
}

export function construirSaldosMapaDesdeColecciones({
  reservas = [],
  servicios = [],
  ventasTienda = [],
  ventasRestaurante = [],
  pagos = [],
  cajaTienda = [],
  cajaRestaurante = []
} = {}) {
  const serviciosByReserva = groupByReserva(servicios);
  const tiendaByReserva = groupByReserva(ventasTienda);
  const restauranteByReserva = groupByReserva(ventasRestaurante);
  const pagosByReserva = groupByReserva(pagos);
  const cajaTiendaByReserva = buildCajaByReserva({
    ventas: ventasTienda,
    movimientos: cajaTienda,
    ventaIdKey: 'venta_tienda_id'
  });
  const cajaRestauranteByReserva = buildCajaByReserva({
    ventas: ventasRestaurante,
    movimientos: cajaRestaurante,
    ventaIdKey: 'venta_restaurante_id'
  });

  const saldoByHabitacion = new Map();

  [...(Array.isArray(reservas) ? reservas : [])]
    .sort((a, b) => new Date(b?.fecha_inicio || 0) - new Date(a?.fecha_inicio || 0))
    .forEach((reserva) => {
      if (!reserva?.id || !reserva?.habitacion_id || saldoByHabitacion.has(reserva.habitacion_id)) return;

      const pagosRegistrados = sumPayments(pagosByReserva[reserva.id] || []);
      const totalPagado = Math.max(pagosRegistrados, Number(reserva?.monto_pagado || 0));
      const resumen = calcularResumenSaldoCheckout({
        totalEstancia: Number(reserva?.monto_total || 0),
        servicios: serviciosByReserva[reserva.id] || [],
        ventasTienda: tiendaByReserva[reserva.id] || [],
        ventasRestaurante: restauranteByReserva[reserva.id] || [],
        movimientosCajaTienda: cajaTiendaByReserva[reserva.id] || [],
        movimientosCajaRestaurante: cajaRestauranteByReserva[reserva.id] || [],
        totalPagado
      });

      saldoByHabitacion.set(reserva.habitacion_id, {
        reservaId: reserva.id,
        habitacionId: reserva.habitacion_id,
        ...resumen
      });
    });

  return saldoByHabitacion;
}

async function cargarSaldosMapaBatch(supabase, hotelId) {
  const { data: reservas, error: reservasError } = await supabase
    .from('reservas')
    .select('id, habitacion_id, estado, fecha_inicio, monto_total, monto_pagado')
    .eq('hotel_id', hotelId)
    .in('estado', ACTIVE_RESERVATION_STATES)
    .order('fecha_inicio', { ascending: false });

  if (reservasError) throw reservasError;

  const reservaIds = (reservas || []).map((reserva) => reserva.id).filter(Boolean);
  if (reservaIds.length === 0) return new Map();

  const [serviciosResult, tiendaResult, restauranteResult, pagosResult] = await Promise.all([
    supabase
      .from('servicios_x_reserva')
      .select('reserva_id, precio_cobrado, estado_pago')
      .eq('hotel_id', hotelId)
      .in('reserva_id', reservaIds),
    supabase
      .from('ventas_tienda')
      .select('id, reserva_id, total_venta, estado_pago')
      .eq('hotel_id', hotelId)
      .in('reserva_id', reservaIds),
    supabase
      .from('ventas_restaurante')
      .select('id, reserva_id, monto_total, total_venta, estado_pago')
      .eq('hotel_id', hotelId)
      .in('reserva_id', reservaIds),
    supabase
      .from('pagos_reserva')
      .select('reserva_id, monto')
      .eq('hotel_id', hotelId)
      .in('reserva_id', reservaIds)
  ]);

  const firstError = [serviciosResult, tiendaResult, restauranteResult, pagosResult]
    .find((result) => result.error)?.error;
  if (firstError) throw firstError;

  const ventasTienda = tiendaResult.data || [];
  const ventasRestaurante = restauranteResult.data || [];
  const tiendaIds = ventasTienda.map((venta) => venta.id).filter(Boolean);
  const restauranteIds = ventasRestaurante.map((venta) => venta.id).filter(Boolean);

  const [cajaTiendaResult, cajaRestauranteResult] = await Promise.all([
    tiendaIds.length
      ? supabase
        .from('caja')
        .select('tipo, monto, venta_tienda_id')
        .eq('hotel_id', hotelId)
        .in('venta_tienda_id', tiendaIds)
      : Promise.resolve({ data: [], error: null }),
    restauranteIds.length
      ? supabase
        .from('caja')
        .select('tipo, monto, venta_restaurante_id')
        .eq('hotel_id', hotelId)
        .in('venta_restaurante_id', restauranteIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (cajaTiendaResult.error) throw cajaTiendaResult.error;
  if (cajaRestauranteResult.error) throw cajaRestauranteResult.error;

  return construirSaldosMapaDesdeColecciones({
    reservas,
    servicios: serviciosResult.data || [],
    ventasTienda,
    ventasRestaurante,
    pagos: pagosResult.data || [],
    cajaTienda: cajaTiendaResult.data || [],
    cajaRestaurante: cajaRestauranteResult.data || []
  });
}

function getRoomIdFromCard(card) {
  const cronometro = card?.querySelector('[id^="cronometro-"]');
  return cronometro?.id?.replace(/^cronometro-/, '') || null;
}

function getBalanceContainer(card) {
  return card?.querySelector('.p-3.flex-grow.flex.flex-col') || null;
}

function removePaymentPendingChips(card) {
  card.querySelectorAll('span').forEach((span) => {
    if (span.textContent.trim().toLowerCase() === 'pago pendiente') {
      span.remove();
    }
  });
}

function getOrCreateAlertContainer(card, contentContainer) {
  const existing = Array.from(contentContainer.children).find((element) => (
    element.classList?.contains('flex')
    && element.classList?.contains('flex-wrap')
    && element.classList?.contains('gap-1.5')
  ));

  if (existing) return existing;

  const alertContainer = document.createElement('div');
  alertContainer.className = 'mt-2 flex flex-wrap gap-1.5';
  alertContainer.dataset.realBalanceAlertContainer = 'true';

  const firstSection = contentContainer.firstElementChild;
  if (firstSection) firstSection.after(alertContainer);
  else contentContainer.prepend(alertContainer);

  return alertContainer;
}

function renderBalanceOnCard(card, summary, currencySymbol) {
  const previous = card.querySelector('[data-room-balance]');
  if (previous) previous.remove();
  removePaymentPendingChips(card);

  if (!summary) {
    card.removeAttribute('data-balance-due');
    return;
  }

  const contentContainer = getBalanceContainer(card);
  if (!contentContainer) return;

  const due = Number(summary.saldoPendiente || 0) > BALANCE_TOLERANCE;
  card.dataset.balanceDue = due ? 'true' : 'false';

  const balanceBox = document.createElement('div');
  balanceBox.dataset.roomBalance = 'true';
  balanceBox.className = due
    ? 'mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700'
    : 'mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700';
  balanceBox.textContent = due
    ? `Debe ${formatCurrency(Number(summary.saldoPendiente || 0), currencySymbol)}`
    : 'Al día';

  const footerAnchor = Array.from(contentContainer.children).find((element) => element.classList?.contains('mt-auto'));
  if (footerAnchor) contentContainer.insertBefore(balanceBox, footerAnchor);
  else contentContainer.appendChild(balanceBox);

  if (due) {
    const alertContainer = getOrCreateAlertContainer(card, contentContainer);
    const chip = document.createElement('span');
    chip.dataset.realBalanceAlert = 'true';
    chip.className = 'inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700';
    chip.textContent = 'Pago pendiente';
    alertContainer.appendChild(chip);
  }
}

function renderUnavailableOnOccupiedCards(cards) {
  cards.forEach((card) => {
    const stateText = Array.from(card.querySelectorAll('.badge'))
      .map((badge) => badge.textContent.trim().toLowerCase())
      .find((state) => ACTIVE_RESERVATION_STATES.includes(state));
    if (!stateText) return;

    const previous = card.querySelector('[data-room-balance]');
    if (previous) previous.remove();
    removePaymentPendingChips(card);

    const contentContainer = getBalanceContainer(card);
    if (!contentContainer) return;

    const balanceBox = document.createElement('div');
    balanceBox.dataset.roomBalance = 'true';
    balanceBox.className = 'mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-500';
    balanceBox.textContent = 'Saldo no disponible';

    const footerAnchor = Array.from(contentContainer.children).find((element) => element.classList?.contains('mt-auto'));
    if (footerAnchor) contentContainer.insertBefore(balanceBox, footerAnchor);
    else contentContainer.appendChild(balanceBox);
  });
}

export async function refrescarSaldosVisiblesMapa() {
  const grid = document.getElementById('room-map-list');
  const supabase = window.supabase;
  const hotelId = window.hotelIdGlobal;

  if (!grid || !supabase || !hotelId) return;

  const cards = Array.from(grid.querySelectorAll('.room-card'));
  if (cards.length === 0) return;

  const generation = ++requestGeneration;

  try {
    const saldosByHabitacion = await cargarSaldosMapaBatch(supabase, hotelId);
    if (generation !== requestGeneration || !document.body.contains(grid)) return;

    const currencySymbol = window.hotelConfigGlobal?.moneda_local_simbolo
      || window.hotelConfigGlobal?.moneda_local
      || '$';

    cards.forEach((card) => {
      const roomId = getRoomIdFromCard(card);
      renderBalanceOnCard(card, roomId ? saldosByHabitacion.get(roomId) : null, currencySymbol);
    });
  } catch (error) {
    if (generation !== requestGeneration) return;
    console.error('[MapaSaldo] No se pudo calcular el saldo visible de las habitaciones:', error);
    renderUnavailableOnOccupiedCards(cards);
  }
}

function scheduleRefresh(delay = BALANCE_REFRESH_DELAY_MS) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refrescarSaldosVisiblesMapa();
  }, delay);
}

function mutationTouchesRoomMap(mutation) {
  const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return nodes.some((node) => {
    if (!(node instanceof Element)) return false;
    return node.matches?.('#room-map-list, .room-card')
      || Boolean(node.querySelector?.('#room-map-list, .room-card'));
  });
}

export function initMapaSaldoEnhancer() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__MAPA_SALDO_ENHANCER_READY__) return;
  window.__MAPA_SALDO_ENHANCER_READY__ = true;

  const appContainer = document.getElementById('app-container');
  if (appContainer && typeof MutationObserver !== 'undefined') {
    appObserver = new MutationObserver((mutations) => {
      if (mutations.some(mutationTouchesRoomMap)) scheduleRefresh();
    });
    appObserver.observe(appContainer, { childList: true, subtree: true });
  }

  window.addEventListener('hashchange', () => scheduleRefresh(220));
  document.addEventListener('renderRoomsComplete', () => scheduleRefresh(320));
  scheduleRefresh(300);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  initMapaSaldoEnhancer();
}
