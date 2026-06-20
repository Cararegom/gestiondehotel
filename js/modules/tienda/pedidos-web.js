import { escapeHtml } from '../../security.js';
import { formatCurrency, getTabContentEl } from './helpers.js';
import { tiendaState } from './state.js';

function formatDate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

function getItems(pedido) {
  return pedido?.items || pedido?.tienda_pedido_web_items || [];
}

function buildWhatsappUrl(pedido) {
  if (!pedido?.whatsapp_numero || !pedido?.whatsapp_mensaje) return '';
  return `https://wa.me/${encodeURIComponent(pedido.whatsapp_numero)}?text=${encodeURIComponent(pedido.whatsapp_mensaje)}`;
}

function getEstadoMeta(estado = 'pendiente') {
  const map = {
    pendiente: { label: 'Pendiente', style: 'background:#fef3c7;color:#92400e;border-color:#fde68a;' },
    aceptado: { label: 'Aceptado', style: 'background:#dbeafe;color:#1d4ed8;border-color:#bfdbfe;' },
    preparando: { label: 'Preparando', style: 'background:#ede9fe;color:#6d28d9;border-color:#ddd6fe;' },
    entregado: { label: 'Entregado', style: 'background:#dcfce7;color:#166534;border-color:#bbf7d0;' },
    rechazado: { label: 'Rechazado', style: 'background:#fee2e2;color:#991b1b;border-color:#fecaca;' },
    cancelado: { label: 'Cancelado', style: 'background:#f1f5f9;color:#475569;border-color:#e2e8f0;' },
  };
  return map[estado] || map.pendiente;
}

function showFeedback(message, type = 'info') {
  const el = document.getElementById('pedidos-web-feedback');
  if (!el) return;
  const palette = {
    info: 'background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;',
    success: 'background:#ecfdf5;color:#047857;border-color:#a7f3d0;',
    error: 'background:#fef2f2;color:#b91c1c;border-color:#fecaca;'
  };
  el.style = `display:block;border:1px solid;border-radius:10px;padding:10px 12px;margin-bottom:12px;${palette[type] || palette.info}`;
  el.textContent = message;
}

async function confirmAction(title, text, confirmButtonText = 'Confirmar') {
  if (typeof Swal !== 'undefined') {
    const result = await Swal.fire({
      icon: 'question',
      title,
      text,
      showCancelButton: true,
      confirmButtonText,
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#2563eb'
    });
    return result.isConfirmed;
  }
  return window.confirm(`${title}\n\n${text}`);
}

async function askNotes(title, placeholder = 'Motivo u observacion') {
  if (typeof Swal !== 'undefined') {
    const result = await Swal.fire({
      title,
      input: 'textarea',
      inputPlaceholder: placeholder,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#2563eb'
    });
    return result.isConfirmed ? String(result.value || '').trim() : null;
  }
  return window.prompt(title) || null;
}

async function cargarPedidosWeb() {
  const { data, error } = await tiendaState.currentSupabase
    .from('tienda_pedidos_web')
    .select('*, items:tienda_pedido_web_items(*)')
    .eq('hotel_id', tiendaState.currentHotelId)
    .order('creado_en', { ascending: false })
    .limit(100);

  if (error) throw error;
  tiendaState.pedidosWeb.lista = data || [];
}

function renderLinkPanel() {
  const publicUrl = `${window.location.origin}/tienda-web.html?hotel=${encodeURIComponent(tiendaState.currentHotelId)}&habitacion=101`;
  return `
    <section style="border:1px solid #bfdbfe;background:#eff6ff;border-radius:14px;padding:14px;margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
        <div>
          <h3 style="margin:0;color:#1d4ed8;font-weight:800;">Enlace para QR de habitaciones</h3>
          <p style="margin:5px 0 0;color:#475569;font-size:0.9rem;">Cambia el numero de habitacion al generar cada QR.</p>
        </div>
        <button id="btnCopiarLinkTiendaWeb" style="background:#1d4ed8;color:#fff;border:none;border-radius:9px;padding:9px 13px;font-weight:800;">Copiar enlace</button>
      </div>
      <input id="linkTiendaWeb" value="${escapeHtml(publicUrl)}" readonly style="margin-top:12px;width:100%;border:1px solid #bfdbfe;border-radius:9px;padding:10px;background:white;color:#1e3a8a;">
    </section>
  `;
}

function renderPedidoCard(pedido) {
  const estado = getEstadoMeta(pedido.estado);
  const items = getItems(pedido);
  const whatsappUrl = buildWhatsappUrl(pedido);
  const puedeGestionar = !['entregado', 'rechazado', 'cancelado'].includes(pedido.estado);

  return `
    <article style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:15px;box-shadow:0 4px 14px rgba(15,23,42,0.06);">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
        <div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <h3 style="margin:0;color:#0f172a;font-size:1.05rem;font-weight:900;">Habitacion ${escapeHtml(pedido.habitacion_nombre)}</h3>
            <span style="border:1px solid;border-radius:999px;padding:4px 9px;font-size:0.78rem;font-weight:800;${estado.style}">${estado.label}</span>
          </div>
          <p style="margin:5px 0 0;color:#64748b;font-size:0.86rem;">Pedido #${escapeHtml(String(pedido.id).slice(0, 8).toUpperCase())} - ${formatDate(pedido.creado_en)}</p>
          ${pedido.cliente_nombre ? `<p style="margin:6px 0 0;color:#334155;font-size:0.9rem;"><strong>Cliente:</strong> ${escapeHtml(pedido.cliente_nombre)}</p>` : ''}
          ${pedido.telefono_cliente ? `<p style="margin:4px 0 0;color:#334155;font-size:0.9rem;"><strong>Telefono:</strong> ${escapeHtml(pedido.telefono_cliente)}</p>` : ''}
        </div>
        <div style="text-align:right;">
          <div style="color:#16a34a;font-size:1.25rem;font-weight:900;">${formatCurrency(pedido.total)}</div>
          <div style="color:#64748b;font-size:0.8rem;">${items.reduce((acc, item) => acc + Number(item.cantidad || 0), 0)} producto(s)</div>
        </div>
      </div>

      <div style="margin-top:12px;border-top:1px solid #f1f5f9;padding-top:10px;">
        ${items.map((item) => `
          <div style="display:flex;justify-content:space-between;gap:12px;margin:5px 0;color:#334155;font-size:0.92rem;">
            <span>${escapeHtml(item.cantidad)} x ${escapeHtml(item.producto_nombre)}</span>
            <strong>${formatCurrency(item.subtotal)}</strong>
          </div>
        `).join('')}
      </div>

      ${pedido.observaciones ? `<div style="margin-top:10px;background:#f8fafc;border-radius:10px;padding:10px;color:#475569;font-size:0.9rem;"><strong>Observaciones:</strong> ${escapeHtml(pedido.observaciones)}</div>` : ''}
      ${pedido.notas_internas ? `<div style="margin-top:10px;background:#fff7ed;border-radius:10px;padding:10px;color:#9a3412;font-size:0.9rem;"><strong>Nota interna:</strong> ${escapeHtml(pedido.notas_internas)}</div>` : ''}

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:13px;">
        ${whatsappUrl ? `<a href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener" style="background:#128c7e;color:#fff;text-decoration:none;border-radius:9px;padding:8px 12px;font-weight:800;">WhatsApp</a>` : ''}
        ${puedeGestionar && pedido.estado === 'pendiente' ? `<button data-action="pedido-estado" data-id="${escapeHtml(pedido.id)}" data-estado="aceptado" style="background:#1d4ed8;color:#fff;border:none;border-radius:9px;padding:8px 12px;font-weight:800;">Aceptar</button>` : ''}
        ${puedeGestionar && ['pendiente', 'aceptado'].includes(pedido.estado) ? `<button data-action="pedido-estado" data-id="${escapeHtml(pedido.id)}" data-estado="preparando" style="background:#7c3aed;color:#fff;border:none;border-radius:9px;padding:8px 12px;font-weight:800;">Preparando</button>` : ''}
        ${puedeGestionar ? `<button data-action="pedido-estado" data-id="${escapeHtml(pedido.id)}" data-estado="entregado" style="background:#16a34a;color:#fff;border:none;border-radius:9px;padding:8px 12px;font-weight:800;">Entregar y descontar stock</button>` : ''}
        ${puedeGestionar ? `<button data-action="pedido-rechazar" data-id="${escapeHtml(pedido.id)}" style="background:#fee2e2;color:#991b1b;border:none;border-radius:9px;padding:8px 12px;font-weight:800;">Rechazar</button>` : ''}
      </div>
    </article>
  `;
}

function renderPedidosList() {
  const pedidos = tiendaState.pedidosWeb.lista;
  if (!pedidos.length) {
    return '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px;text-align:center;color:#64748b;">Aun no hay pedidos web de tienda.</div>';
  }

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px;">
      ${pedidos.map(renderPedidoCard).join('')}
    </div>
  `;
}

async function actualizarEstadoPedido(pedidoId, estado, notas = null) {
  const { data, error } = await tiendaState.currentSupabase.rpc('actualizar_estado_pedido_web_tienda', {
    p_pedido_id: pedidoId,
    p_usuario_id: tiendaState.currentUser.id,
    p_estado: estado,
    p_notas_internas: notas
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.message || 'No se pudo actualizar el pedido.');
  return data;
}

async function handleClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) {
    if (event.target.id === 'btnCopiarLinkTiendaWeb') {
      const input = document.getElementById('linkTiendaWeb');
      if (input) {
        await navigator.clipboard?.writeText(input.value);
        showFeedback('Enlace copiado. Cambia habitacion=101 por el numero que corresponda.', 'success');
      }
    }
    return;
  }

  try {
    const pedidoId = button.dataset.id;
    if (button.dataset.action === 'pedido-rechazar') {
      const notas = await askNotes('Motivo para rechazar el pedido', 'Ej: producto agotado, cliente cancelo...');
      if (notas === null) return;
      await actualizarEstadoPedido(pedidoId, 'rechazado', notas);
      showFeedback('Pedido rechazado.', 'success');
    } else if (button.dataset.action === 'pedido-estado') {
      const estado = button.dataset.estado;
      if (estado === 'entregado') {
        const ok = await confirmAction('Entregar pedido', 'Se descontara el inventario y se registrara una venta de tienda pendiente/cargada a la habitacion.', 'Entregar');
        if (!ok) return;
      }
      await actualizarEstadoPedido(pedidoId, estado);
      showFeedback('Pedido actualizado.', 'success');
    }
    await renderPedidosWeb();
  } catch (error) {
    console.error('[Pedidos web tienda] Error:', error);
    showFeedback(error.message || 'No se pudo gestionar el pedido.', 'error');
  }
}

export async function renderPedidosWeb() {
  const cont = getTabContentEl();
  if (!cont) return;

  cont.innerHTML = '<div style="padding:24px;text-align:center;color:#64748b;">Cargando pedidos web...</div>';

  try {
    await cargarPedidosWeb();
    cont.innerHTML = `
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
          <div>
            <h2 style="margin:0;color:#1d4ed8;font-size:1.45rem;font-weight:900;">Pedidos web de Tienda</h2>
            <p style="margin:5px 0 0;color:#64748b;">Pedidos que los clientes envian desde el QR de la habitacion.</p>
          </div>
          <button id="btnRefrescarPedidosWeb" style="background:#fff;color:#1d4ed8;border:1.5px solid #1d4ed8;border-radius:9px;padding:9px 13px;font-weight:800;">Actualizar</button>
        </div>
        <div id="pedidos-web-feedback" style="display:none;"></div>
        ${renderLinkPanel()}
        ${renderPedidosList()}
      </div>
    `;

    cont.onclick = handleClick;
    const refreshButton = document.getElementById('btnRefrescarPedidosWeb');
    if (refreshButton) refreshButton.onclick = renderPedidosWeb;
  } catch (error) {
    console.error('[Pedidos web tienda] Error cargando:', error);
    cont.innerHTML = `<div style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:12px;padding:16px;">Error cargando pedidos web: ${escapeHtml(error.message || 'Error desconocido')}</div>`;
  }
}

export function resetPedidosWebState() {
  tiendaState.pedidosWeb.lista = [];
}
