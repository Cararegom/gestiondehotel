import { escapeHtml } from '../../security.js';
import {
  addCalendarDays,
  formatInTimeZone,
  getRuntimeHotelTimeZone,
  getTodayInTimeZone,
  getUtcRangeForHotelDates,
} from '../../services/hotelTimeZoneService.js';
import { closeModal, getModalContainerEl } from './helpers.js';
import { tiendaState } from './state.js';

const PAGE_SIZE = 1000;
const DEFAULT_PERIOD = 'month';

function firstDayOfMonth(dateKey) {
  return `${String(dateKey).slice(0, 7)}-01`;
}

function shiftMonth(dateKey, offset) {
  const [year, month] = String(dateKey).slice(0, 7).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function resolvePeriod(period, customStart = '', customEnd = '') {
  const timeZone = getRuntimeHotelTimeZone();
  const today = getTodayInTimeZone(timeZone);
  let startDate;
  let endDate;
  let label;

  switch (period) {
    case 'today':
      startDate = today;
      endDate = today;
      label = 'Hoy';
      break;
    case '7days':
      startDate = addCalendarDays(today, -6);
      endDate = today;
      label = 'Últimos 7 días';
      break;
    case 'previousMonth': {
      startDate = shiftMonth(today, -1);
      endDate = addCalendarDays(firstDayOfMonth(today), -1);
      label = 'Mes anterior';
      break;
    }
    case '3months':
      startDate = addCalendarDays(today, -89);
      endDate = today;
      label = 'Últimos 3 meses';
      break;
    case 'custom':
      if (!customStart || !customEnd) throw new Error('Selecciona la fecha inicial y la fecha final.');
      if (customStart > customEnd) throw new Error('La fecha inicial no puede ser posterior a la fecha final.');
      startDate = customStart;
      endDate = customEnd;
      label = `${customStart} a ${customEnd}`;
      break;
    case 'month':
    default:
      startDate = firstDayOfMonth(today);
      endDate = today;
      label = 'Este mes';
      break;
  }

  return {
    ...getUtcRangeForHotelDates(startDate, endDate, timeZone),
    startDate,
    endDate,
    label,
  };
}

async function fetchMovements(productoId, range) {
  const all = [];
  let from = 0;

  while (true) {
    let query = tiendaState.currentSupabase
      .from('movimientos_inventario')
      .select('*, producto:productos_tienda(nombre)')
      .eq('hotel_id', tiendaState.currentHotelId)
      .gte('creado_en', range.startIso)
      .lt('creado_en', range.endExclusiveIso)
      .order('creado_en', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (productoId) query = query.eq('producto_id', productoId);

    const { data, error } = await query;
    if (error) throw error;

    const page = data || [];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
}

function renderRows(movimientos, productoId) {
  const timeZone = getRuntimeHotelTimeZone();
  if (!movimientos.length) {
    return `<tr><td colspan="${productoId ? 6 : 7}" style="padding:28px;text-align:center;color:#64748b;">No hay movimientos registrados en este período.</td></tr>`;
  }

  return movimientos.map((mov) => {
    const tipo = String(mov.tipo_movimiento || 'N/A');
    const tipoColor = tipo === 'INGRESO' ? '#16a34a' : '#ef4444';
    return `
      <tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:8px 10px;white-space:nowrap;">${escapeHtml(formatInTimeZone(mov.creado_en, timeZone, 'es-CO', { dateStyle: 'short', timeStyle: 'short' }))}</td>
        ${!productoId ? `<td style="padding:8px 10px;">${escapeHtml(mov.producto?.nombre || 'N/A')}</td>` : ''}
        <td style="padding:8px 10px;"><span style="font-weight:bold;color:${tipoColor};">${escapeHtml(tipo)}</span></td>
        <td style="padding:8px 10px;font-weight:600;">${escapeHtml(String(mov.cantidad ?? ''))}</td>
        <td style="padding:8px 10px;font-weight:500;">${escapeHtml(mov.usuario_responsable || 'N/A')}</td>
        <td style="padding:8px 10px;">${escapeHtml(mov.razon || '')}</td>
        <td style="padding:8px 10px;text-align:center;white-space:nowrap;">${escapeHtml(String(mov.stock_anterior ?? ''))} → ${escapeHtml(String(mov.stock_nuevo ?? ''))}</td>
      </tr>`;
  }).join('');
}

function renderShell(modalContainer, productoId) {
  const today = getTodayInTimeZone(getRuntimeHotelTimeZone());
  modalContainer.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:1000px;width:96vw;max-height:92vh;overflow-y:auto;margin:auto;padding:24px;position:relative;">
      <button id="btnCerrarHistorialTienda" style="position:absolute;right:14px;top:10px;background:none;border:none;font-size:25px;color:#64748b;cursor:pointer;line-height:1;" title="Cerrar">&times;</button>
      <div style="padding-right:36px;">
        <h2 style="margin:0;color:#1e293b;">Historial de Movimientos</h2>
        <p style="margin:5px 0 18px;color:#64748b;font-size:0.9rem;">Consulta movimientos por período sin limitarte a los últimos 100 registros.</p>
      </div>

      <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:14px;">
        <label style="display:flex;flex-direction:column;gap:5px;font-size:0.82rem;font-weight:700;color:#475569;min-width:180px;">
          Período
          <select id="historialPeriodoTienda" style="padding:9px 11px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;font-size:0.95rem;">
            <option value="today">Hoy</option>
            <option value="7days">Últimos 7 días</option>
            <option value="month" selected>Este mes</option>
            <option value="previousMonth">Mes anterior</option>
            <option value="3months">Últimos 3 meses</option>
            <option value="custom">Rango personalizado</option>
          </select>
        </label>

        <div id="historialRangoPersonalizadoTienda" style="display:none;gap:10px;align-items:end;flex-wrap:wrap;">
          <label style="display:flex;flex-direction:column;gap:5px;font-size:0.82rem;font-weight:700;color:#475569;">
            Desde
            <input id="historialFechaDesdeTienda" type="date" max="${today}" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:7px;">
          </label>
          <label style="display:flex;flex-direction:column;gap:5px;font-size:0.82rem;font-weight:700;color:#475569;">
            Hasta
            <input id="historialFechaHastaTienda" type="date" max="${today}" value="${today}" style="padding:8px 10px;border:1px solid #cbd5e1;border-radius:7px;">
          </label>
          <button id="btnAplicarRangoHistorialTienda" type="button" style="background:#2563eb;color:#fff;border:none;border-radius:7px;padding:9px 15px;font-weight:700;cursor:pointer;">Aplicar</button>
        </div>

        <div id="historialResumenTienda" style="margin-left:auto;color:#475569;font-size:0.86rem;font-weight:700;"></div>
      </div>

      <div id="historialEstadoTienda" style="padding:24px;text-align:center;color:#64748b;">Cargando movimientos...</div>
      <div id="historialTablaWrapTienda" style="display:none;overflow-x:auto;">
        <table style="width:100%;font-size:13px;border-collapse:collapse;min-width:820px;">
          <thead>
            <tr style="background:#f1f5f9;text-align:left;">
              <th style="padding:10px;">Fecha</th>
              ${!productoId ? '<th style="padding:10px;">Producto</th>' : ''}
              <th style="padding:10px;">Tipo</th>
              <th style="padding:10px;">Cantidad</th>
              <th style="padding:10px;">Responsable</th>
              <th style="padding:10px;">Razón</th>
              <th style="padding:10px;text-align:center;">Stock Ant/Nuevo</th>
            </tr>
          </thead>
          <tbody id="historialMovimientosTiendaBody"></tbody>
        </table>
      </div>
    </div>`;
}

export async function showModalHistorial(productoId = null) {
  const modalContainer = getModalContainerEl();
  if (!modalContainer) return;

  modalContainer.style.display = 'flex';
  renderShell(modalContainer, productoId);

  const periodoEl = document.getElementById('historialPeriodoTienda');
  const customWrap = document.getElementById('historialRangoPersonalizadoTienda');
  const desdeEl = document.getElementById('historialFechaDesdeTienda');
  const hastaEl = document.getElementById('historialFechaHastaTienda');
  const estadoEl = document.getElementById('historialEstadoTienda');
  const tablaWrap = document.getElementById('historialTablaWrapTienda');
  const tbody = document.getElementById('historialMovimientosTiendaBody');
  const resumenEl = document.getElementById('historialResumenTienda');

  document.getElementById('btnCerrarHistorialTienda').onclick = () => closeModal();

  const load = async () => {
    try {
      const period = periodoEl.value || DEFAULT_PERIOD;
      const range = resolvePeriod(period, desdeEl.value, hastaEl.value);
      estadoEl.style.display = 'block';
      estadoEl.style.color = '#64748b';
      estadoEl.textContent = 'Cargando movimientos...';
      tablaWrap.style.display = 'none';
      resumenEl.textContent = '';

      const movimientos = await fetchMovements(productoId, range);
      tbody.innerHTML = renderRows(movimientos, productoId);
      resumenEl.textContent = `${movimientos.length.toLocaleString('es-CO')} movimiento${movimientos.length === 1 ? '' : 's'} · ${range.label}`;
      estadoEl.style.display = 'none';
      tablaWrap.style.display = 'block';
    } catch (error) {
      console.error('[Tienda] Error cargando historial de movimientos:', error);
      estadoEl.style.display = 'block';
      estadoEl.style.color = '#dc2626';
      estadoEl.textContent = error?.message || 'No se pudo cargar el historial.';
      tablaWrap.style.display = 'none';
    }
  };

  periodoEl.onchange = async () => {
    const custom = periodoEl.value === 'custom';
    customWrap.style.display = custom ? 'flex' : 'none';
    if (!custom) await load();
  };

  document.getElementById('btnAplicarRangoHistorialTienda').onclick = load;
  await load();
}
