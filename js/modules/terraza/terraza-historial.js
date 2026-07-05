import { registrarEnBitacora } from '../../services/bitacoraservice.js';
import { turnoService } from '../../services/turnoService.js';

export function renderHistorialTab(deps) {
  return `
    <div class="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div class="xl:col-span-2">${renderHistorial(deps)}</div>
      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 class="font-bold text-slate-800">Operacion de Terraza</h3>
        <p class="mt-2 text-sm text-slate-500">Las ventas cobradas aqui entran al cierre de Caja como ingresos de Terraza.</p>
        <div class="mt-4 rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-800">
          En el cierre de un mesero se adjunta el inventario completo de Terraza por correo.
        </div>
      </div>
    </div>
  `;
}

function renderHistorial(deps) {
  const {
    state,
    canDownloadPdf,
    canReopenPedido,
    countItems,
    escapeAttribute,
    escapeHtml,
    formatDate,
    getItemDisplayName,
    getPedidoEstadoMeta,
    getPedidoItems,
    getPedidoLocationLabel,
    getPedidoTipAmount,
    getTotalConPropina,
    money,
    totalPedido
  } = deps;

  if (!state.historial.length) {
    return '<div class="rounded-xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500">Aun no hay movimientos de cuentas en Terraza.</div>';
  }

  return `
    <div class="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="border-b border-slate-200 p-4">
        <h3 class="font-bold text-slate-800">Historial de cuentas y movimientos</h3>
        <p class="mt-1 text-xs text-slate-500">Incluye cuentas cobradas, canceladas y reabiertas.</p>
      </div>
      <div class="divide-y divide-slate-100">
        ${state.historial.map((pedido) => {
          const estadoMeta = getPedidoEstadoMeta(pedido);
          const fechaMovimiento = pedido.fecha_cancelacion || pedido.fecha_cierre || pedido.actualizado_en || pedido.creado_en;
          const items = getPedidoItems(pedido);
          const motivo = pedido.motivo_reapertura || pedido.motivo_cancelacion || '';
          const subtotal = totalPedido(pedido);
          const propina = getPedidoTipAmount(pedido);
          const totalCobrado = getTotalConPropina(subtotal, propina);
          const reserva = pedido.reserva;
          const metodoLabel = Array.isArray(pedido.pagos_mixtos) && pedido.pagos_mixtos.length
            ? 'Pago mixto'
            : (pedido.metodo?.nombre || 'Sin metodo');
          return `
            <div class="flex flex-col justify-between gap-3 p-4 text-sm md:flex-row md:items-start">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold text-slate-800">${escapeHtml(getPedidoLocationLabel(pedido))}</span>
                  <span class="rounded-full border px-2 py-0.5 text-[11px] font-bold ${estadoMeta.className}">${estadoMeta.label}</span>
                </div>
                <div class="mt-1 text-xs text-slate-500">
                  ${formatDate(fechaMovimiento)} - ${escapeHtml(metodoLabel)}
                </div>
                ${reserva ? `
                  <div class="mt-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-900">
                    <strong>Cuenta originada por reserva:</strong> ${escapeHtml(reserva.cliente_nombre || 'Cliente')}
                    <span class="block mt-1">Reservada por: ${escapeHtml(reserva.reservado_por?.nombre || 'Usuario no disponible')}</span>
                  </div>
                ` : ''}
                ${motivo ? `<div class="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"><strong>Motivo:</strong> ${escapeHtml(motivo)}</div>` : ''}
                ${items.length ? `
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    ${items.map((item) => `
                      <span class="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                        ${escapeHtml(String(item.cantidad || 0))}x ${escapeHtml(getItemDisplayName(item))}
                      </span>
                    `).join('')}
                  </div>
                ` : '<div class="mt-2 text-xs text-slate-400">Sin consumos registrados.</div>'}
              </div>
              <div class="flex flex-col items-start gap-2 md:items-end">
                <div class="text-right">
                  <div class="text-xs text-slate-500">Consumo: ${money(subtotal)}</div>
                  <div class="text-xs text-emerald-700">Propina: ${money(propina)}</div>
                  <div class="font-bold ${pedido.estado === 'cancelado' ? 'text-slate-500' : 'text-blue-700'}">${money(totalCobrado)}</div>
                </div>
                <div class="text-xs text-slate-500">${countItems(pedido)} item(s)</div>
                <div class="flex flex-wrap gap-2 md:justify-end">
                  <button class="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" data-action="print-history-receipt" data-pedido-id="${escapeAttribute(pedido.id)}">Imprimir</button>
                  ${canDownloadPdf() ? `<button class="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" data-action="download-history-pdf" data-pedido-id="${escapeAttribute(pedido.id)}">PDF</button>` : ''}
                  ${canReopenPedido(pedido) ? `<button class="rounded-lg border border-amber-200 px-2 py-1 text-xs font-bold text-amber-800 hover:bg-amber-50" data-action="reopen-history-order" data-pedido-id="${escapeAttribute(pedido.id)}">Reabrir</button>` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

async function askReopenReason(pedido, deps) {
  const { escapeHtml, getPedidoLocationLabel } = deps;
  const location = getPedidoLocationLabel(pedido);

  if (typeof Swal !== 'undefined') {
    const result = await Swal.fire({
      icon: 'warning',
      title: 'Reabrir cuenta',
      html: `
        <div class="text-left text-sm">
          <p>Se cancelara el movimiento de caja anterior y se abrira una cuenta nueva para <strong>${escapeHtml(location)}</strong>.</p>
          <p class="mt-2">Escribe el motivo para dejar trazabilidad.</p>
        </div>
      `,
      input: 'textarea',
      inputPlaceholder: 'Ej: Se cerro por error, faltaba agregar una cerveza...',
      showCancelButton: true,
      confirmButtonText: 'Reabrir cuenta',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d97706',
      inputValidator: (value) => (!String(value || '').trim() ? 'El motivo es obligatorio.' : undefined)
    });

    return result.isConfirmed ? String(result.value || '').trim() : null;
  }

  const reason = window.prompt(`Motivo para reabrir la cuenta de ${location}:`);
  return String(reason || '').trim() || null;
}

export async function reopenHistoryOrder(pedidoId, deps) {
  const {
    state,
    canReopenPedido,
    getPedidoById,
    getPedidoLocationLabel,
    normalizeSilla,
    refreshAndRender,
    showFeedback
  } = deps;
  const pedido = getPedidoById(pedidoId);
  if (!pedido) {
    throw new Error('No se encontro la cuenta en el historial.');
  }
  if (!canReopenPedido(pedido)) {
    throw new Error('Esta cuenta no se puede reabrir.');
  }

  const motivo = await askReopenReason(pedido, deps);
  if (!motivo) return;

  const turno = await turnoService.getTurnoAbierto(state.supabase, state.user.id, state.hotelId);
  if (!turno) {
    throw new Error('No hay un turno de caja abierto. Abre turno en Caja antes de reabrir la cuenta.');
  }

  const { data, error } = await state.supabase.rpc('reabrir_pedido_terraza', {
    p_pedido_id: pedido.id,
    p_usuario_id: state.user.id,
    p_turno_id: turno.id,
    p_motivo: motivo
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.message || 'No se pudo reabrir la cuenta.');

  await registrarEnBitacora({
    supabase: state.supabase,
    hotel_id: state.hotelId,
    usuario_id: state.user.id,
    modulo: 'Terraza',
    accion: 'Reapertura de cuenta',
    detalles: {
      pedido_original_id: pedido.id,
      pedido_nuevo_id: data?.nuevo_pedido_id,
      motivo,
      ubicacion: getPedidoLocationLabel(pedido)
    }
  });

  state.activeTab = 'mapa';
  state.selectedMesaId = data?.mesa_id || pedido.mesa_id;
  state.selectedSillaNumero = normalizeSilla(data?.silla_numero ?? pedido.silla_numero);
  await refreshAndRender();
  showFeedback('Cuenta reabierta. Se creo una cuenta nueva para corregirla.', 'success');
}
