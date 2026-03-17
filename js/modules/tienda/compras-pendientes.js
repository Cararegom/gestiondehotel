import { turnoService } from '../../services/turnoService.js';
import { tiendaState } from './state.js';
import { formatCurrency, getTabContentEl, hideGlobalLoading, showGlobalLoading } from './helpers.js';
import { showModalPagoCompra } from './compras.js';

let comprasPendientesCache = [];

export async function renderComprasPendientes() {
  const cont = getTabContentEl();
  if (!cont) return;

  cont.innerHTML = `
    <h4 style="font-weight:bold; font-size:1.3em; color:#1e293b; margin-bottom:1rem;">Compras Pendientes de Recibir</h4>
    <div id="comprasPendientesList">Cargando...</div>
    <hr style="margin: 2rem 0; border-top: 1px solid #e5e7eb;">
    <h5 style="font-weight:bold; font-size:1.2em; color:#1e293b; margin-bottom:1rem;">Historial de Compras Ya Recibidas</h5>
    <div id="historial-recibidos-container"></div>
  `;

  const listEl = document.getElementById('comprasPendientesList');
  try {
    const { data: compras, error } = await tiendaState.currentSupabase
      .from('compras_tienda')
      .select('*, proveedor:proveedores(nombre)')
      .eq('hotel_id', tiendaState.currentHotelId)
      .eq('estado', 'pendiente')
      .order('fecha', { ascending: false });

    if (error) throw error;

    await cargarDetallesCompras(compras || []);
    comprasPendientesCache = (compras || []).filter((compra) => compra.detalles?.length > 0);
    redibujarListaPendientes();
  } catch (err) {
    if (listEl) {
      listEl.innerHTML = `<div style="color:red;">Error cargando compras pendientes: ${err.message}</div>`;
    }
  }

  await renderHistorialRecibidos();
}

function redibujarListaPendientes() {
  const listEl = document.getElementById('comprasPendientesList');
  if (!listEl) return;

  if (!comprasPendientesCache.length) {
    listEl.innerHTML = '<p style="text-align:center;padding:1rem;color:#888;">No hay compras pendientes.</p>';
    return;
  }

  listEl.innerHTML = comprasPendientesCache.map((compra) => renderTarjetaCompraPendiente(compra)).join('');
}

async function cargarDetallesCompras(compras) {
  for (const compra of compras) {
    if (!compra.id) continue;
    const { data: detalles, error } = await tiendaState.currentSupabase
      .from('detalle_compras_tienda')
      .select('*, producto:productos_tienda!inner(id, nombre)')
      .eq('compra_id', compra.id);

    if (error) {
      console.error(`Error cargando detalles para compra ${compra.id}:`, error);
      compra.detalles = [];
    } else {
      compra.detalles = detalles || [];
    }
  }
}

function renderTarjetaCompraPendiente(compra) {
  if (!compra.detalles?.length) return '';

  const productosHtml = `
    <table style="width:100%; border-collapse: collapse; font-size: 0.95em;">
      <thead>
        <tr style="text-align:left; color:#475569;">
          <th style="padding:4px; border-bottom:1.5px solid #e2e8f0;">Producto</th>
          <th style="padding:4px; border-bottom:1.5px solid #e2e8f0; text-align:center;">Pedido</th>
          <th style="padding:4px; border-bottom:1.5px solid #e2e8f0; text-align:right;">Precio Unit.</th>
          <th style="padding:4px; border-bottom:1.5px solid #e2e8f0; text-align:right;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${compra.detalles.map((det) => `
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:8px 4px; font-weight:600; color:#1e293b;">${det.producto?.nombre || 'N/A'}</td>
            <td style="padding:8px 4px; text-align:center; font-weight:bold;">${det.cantidad}</td>
            <td style="padding:8px 4px; text-align:right;">${formatCurrency(det.precio_unitario)}</td>
            <td style="padding:8px 4px; text-align:right; font-weight:600;">${formatCurrency(det.subtotal)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  const fechaLlegadaEstimada = compra.fecha_llegada_estimada
    ? new Date(`${compra.fecha_llegada_estimada}T00:00:00`)
    : null;
  const fechaLlegadaHtml = fechaLlegadaEstimada
    ? `<div style="font-size:0.95em; color:#475569; margin-bottom:12px; font-weight:600; background:#f0fdf4; padding:6px 12px; border-radius:6px; border:1px solid #bbf7d0; text-align:center;">
         Llegada estimada: <span style="color:#15803d;">${fechaLlegadaEstimada.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
       </div>`
    : '';

  return `
    <div style="border-radius:11px;background:#fff;border:1.7px solid #e2e8f0;box-shadow:0 2px 10px #94a3b81a;margin-bottom:23px;padding:24px 18px 16px 18px;max-width:520px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <span style="font-size:1.07em; font-weight:700; color:#4f46e5;">Proveedor: <span style="color:#1e293b;">${compra.proveedor?.nombre || 'N/A'}</span></span>
        <span style="font-size:0.9em; color:#475569;">Creada: ${new Date(compra.fecha).toLocaleDateString()}</span>
      </div>
      ${fechaLlegadaHtml}
      ${productosHtml}
      <div style="margin:16px 0 13px 0; text-align:right; font-weight:700; font-size:1.1em; color:#166534;">Total Compra: ${formatCurrency(compra.total_compra)}</div>
      <div style="display:flex;gap:8px;">
        <button onclick="window.recibirPedido('${compra.id}')" style="background:#16a34a;color:#fff;padding:8px 18px;border:none;border-radius:6px;font-weight:600;cursor:pointer;flex-grow:1;">Recibir Productos</button>
        <button onclick="window.showModalEditarCompra('${compra.id}')" style="background:#4f46e5;color:#fff;padding:8px 18px;border:none;border-radius:6px;font-weight:600;cursor:pointer;">Editar</button>
        <button onclick="window.cancelarCompra('${compra.id}')" style="background:#ef4444;color:#fff;padding:8px 18px;border:none;border-radius:6px;font-weight:600;cursor:pointer;">Cancelar</button>
      </div>
    </div>
  `;
}

export async function recibirPedido(compraId) {
  showGlobalLoading('Cargando orden...');
  try {
    const { data: compra, error: errCompra } = await tiendaState.currentSupabase
      .from('compras_tienda')
      .select('*')
      .eq('id', compraId)
      .single();
    if (errCompra || !compra) throw new Error('No se encontro la compra para recibir.');

    const recibidoTotalMonto = compra.total_compra;
    const { data: metodosPagoDB } = await tiendaState.currentSupabase
      .from('metodos_pago')
      .select('id, nombre')
      .eq('hotel_id', tiendaState.currentHotelId)
      .eq('activo', true);

    const metodosPagoConMixto = [
      { id: 'mixto', nombre: 'Pago Mixto (varios metodos)' },
      ...(metodosPagoDB || []),
    ];
    const inputOptions = new Map(metodosPagoConMixto.map((metodo) => [metodo.id, metodo.nombre]));

    hideGlobalLoading();

    const procesarRecepcionYActualizarUI = async (pagos) => {
      showGlobalLoading('Procesando recepcion...');
      try {
        const esEgresoFueraTurnoCheck = document.getElementById('registrar-pago-fuera-turno')?.checked || false;
        let turnoIdParaGuardar = null;

        if (!esEgresoFueraTurnoCheck) {
          const turnoActivoId = turnoService.getActiveTurnId();
          if (!turnoActivoId) {
            throw new Error('Accion bloqueada: para registrar el pago en el turno debe haber un turno de caja activo.');
          }
          turnoIdParaGuardar = turnoActivoId;
        }

        const { data: detallesCompra } = await tiendaState.currentSupabase
          .from('detalle_compras_tienda')
          .select('*, producto:productos_tienda!inner(id, nombre)')
          .eq('compra_id', compraId);

        for (const det of detallesCompra || []) {
          await tiendaState.currentSupabase.rpc('ajustar_stock_producto', {
            p_producto_id: det.producto.id,
            p_cantidad_ajuste: det.cantidad,
            p_tipo_movimiento: 'ingreso_compra',
            p_usuario_id: tiendaState.currentUser.id,
            p_notas: `Recepcion de OC #${compraId.substring(0, 8)}`,
          });
        }

        await tiendaState.currentSupabase
          .from('compras_tienda')
          .update({
            estado: 'recibido',
            recibido_por_usuario_id: tiendaState.currentUser.id,
            fecha_recepcion: new Date().toISOString(),
          })
          .eq('id', compraId);

        const { data: compraData } = await tiendaState.currentSupabase
          .from('compras_tienda')
          .select('proveedor:proveedores(nombre)')
          .eq('id', compraId)
          .single();

        const conceptoBase = `Pago Compra a ${compraData?.proveedor?.nombre || 'N/A'}`;

        for (const pago of pagos) {
          await tiendaState.currentSupabase.from('caja').insert({
            hotel_id: tiendaState.currentHotelId,
            tipo: 'egreso',
            monto: pago.monto,
            concepto: conceptoBase,
            usuario_id: tiendaState.currentUser.id,
            compra_tienda_id: compraId,
            turno_id: turnoIdParaGuardar,
            metodo_pago_id: pago.metodo_pago_id,
          });
        }

        hideGlobalLoading();
        await Swal.fire('Exito', 'La recepcion y el pago han sido procesados correctamente.', 'success');
      } catch (err) {
        hideGlobalLoading();
        console.error('Error procesando pago y recepcion:', err);
        await Swal.fire('Error', `No se pudo procesar la recepcion y pago: ${err.message}`, 'error');
      } finally {
        await renderComprasPendientes();
      }
    };

    const { value: metodoPagoId, isConfirmed } = await Swal.fire({
      title: 'Confirmar Recepcion y Pago',
      html: `
        <p>Se dara ingreso al inventario y se registrara un egreso de <strong>${formatCurrency(recibidoTotalMonto)}</strong>.</p>
        <p>Selecciona el metodo de pago:</p>
        <div style="margin-top:20px; text-align:left; font-size:0.95em; padding:10px; border:1px solid #eee; border-radius:8px;">
          <input type="checkbox" id="registrar-pago-fuera-turno" style="margin-right:8px; vertical-align:middle;">
          <label for="registrar-pago-fuera-turno" style="vertical-align:middle;">Registrar pago por fuera del turno de caja</label>
        </div>
      `,
      input: 'select',
      inputOptions,
      inputPlaceholder: '-- Selecciona metodo --',
      confirmButtonText: 'Siguiente',
      showCancelButton: true,
      cancelButtonText: 'Cancelar',
      inputValidator: (value) => (!value ? 'Debes seleccionar un metodo de pago' : null),
    });

    if (!isConfirmed || !metodoPagoId) return;

    if (metodoPagoId === 'mixto') {
      showModalPagoCompra(recibidoTotalMonto, metodosPagoDB || [], procesarRecepcionYActualizarUI);
    } else {
      await procesarRecepcionYActualizarUI([{ metodo_pago_id: metodoPagoId, monto: recibidoTotalMonto }]);
    }
  } catch (err) {
    hideGlobalLoading();
    console.error('Error en recibirPedido:', err);
    await Swal.fire('Error', `No se pudo procesar la recepcion: ${err.message}`, 'error');
  }
}

export async function showModalEditarCompra(compraId) {
  showGlobalLoading('Cargando detalles de la compra...');
  try {
    const { data: detalles, error } = await tiendaState.currentSupabase
      .from('detalle_compras_tienda')
      .select('*, producto:productos_tienda(nombre)')
      .eq('compra_id', compraId);
    if (error) throw error;
    hideGlobalLoading();

    const modalHtml = `
      <div id="modal-editar-compra" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1001;">
        <div style="background:white;width:95%;max-width:600px;border-radius:12px;padding:24px;max-height:90vh;display:flex;flex-direction:column;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 style="margin:0;font-size:1.2em;color:#4f46e5;">Editar Orden de Compra</h3>
            <button onclick="document.getElementById('modal-editar-compra').remove()" style="background:none;border:none;font-size:1.5em;cursor:pointer;">&times;</button>
          </div>
          <div id="edit-details-list" style="overflow-y:auto;flex-grow:1;padding-right:10px;">
            ${(detalles || []).map((det) => `
              <div class="edit-detail-row" data-detail-id="${det.id}" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #eee;">
                <span style="flex:1;font-weight:600;">${det.producto.nombre}</span>
                <label>Cant: <input type="number" value="${det.cantidad}" min="1" class="edit-cantidad" style="width:70px;padding:4px;border-radius:4px;border:1px solid #ccc;"></label>
                <label>Precio: <input type="number" value="${det.precio_unitario}" min="0" step="any" class="edit-precio" style="width:90px;padding:4px;border-radius:4px;border:1px solid #ccc;"></label>
                <button class="delete-detail-btn" style="background:#fee2e2;color:#dc2626;border:none;padding:5px 8px;border-radius:4px;cursor:pointer;" title="Eliminar producto">X</button>
              </div>
            `).join('')}
          </div>
          <div style="margin-top:20px;text-align:right;">
            <button onclick="window.guardarCambiosCompra('${compraId}')" style="background:#16a34a;color:white;border:none;padding:10px 20px;border-radius:6px;font-weight:600;cursor:pointer;">Guardar Cambios</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.querySelectorAll('.delete-detail-btn').forEach((btn) => {
      btn.onclick = (event) => {
        const row = event.target.closest('.edit-detail-row');
        row.dataset.deleted = '1';
        row.style.display = 'none';
      };
    });
  } catch (err) {
    hideGlobalLoading();
    alert(`Error al cargar detalles para editar: ${err.message}`);
  }
}

export async function guardarCambiosCompra(compraId) {
  const modal = document.getElementById('modal-editar-compra');
  if (!modal) return;

  try {
    showGlobalLoading('Guardando cambios...');
    const rows = modal.querySelectorAll('.edit-detail-row');
    const detalles_a_actualizar = [];
    const ids_a_eliminar = [];

    for (const row of rows) {
      const detailId = row.getAttribute('data-detail-id');
      if (row.dataset.deleted === '1' || row.style.display === 'none') {
        ids_a_eliminar.push(detailId);
      } else {
        const cantidad = parseInt(row.querySelector('.edit-cantidad').value, 10);
        const precio_unitario = parseFloat(row.querySelector('.edit-precio').value);
        if (isNaN(cantidad) || cantidad <= 0) {
          throw new Error(`La cantidad para '${row.querySelector('span').textContent}' debe ser positiva.`);
        }
        if (isNaN(precio_unitario) || precio_unitario < 0) {
          throw new Error(`El precio para '${row.querySelector('span').textContent}' debe ser valido.`);
        }
        detalles_a_actualizar.push({ id: detailId, cantidad, precio_unitario });
      }
    }

    const { error: rpcError } = await tiendaState.currentSupabase.rpc('actualizar_compra_y_detalles', {
      p_compra_id: compraId,
      detalles_a_actualizar,
      ids_a_eliminar,
    });
    if (rpcError) throw rpcError;

    hideGlobalLoading();
    modal.remove();
    await Swal.fire('Exito', 'La orden de compra ha sido actualizada correctamente en la base de datos.', 'success');
    await renderComprasPendientes();
  } catch (err) {
    hideGlobalLoading();
    console.error('Error al guardar cambios:', err);
    await Swal.fire('Error', `No se pudo guardar: ${err.message}`, 'error');
  }
}

export async function cancelarCompra(compraId) {
  const result = await Swal.fire({
    title: 'Estas seguro?',
    text: 'Esta accion cancelara la orden de compra y no se puede deshacer.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    cancelButtonColor: '#6b7280',
    confirmButtonText: 'Si, cancelar',
    cancelButtonText: 'No',
  });

  if (!result.isConfirmed) return;

  try {
    await tiendaState.currentSupabase
      .from('compras_tienda')
      .update({ estado: 'cancelada' })
      .eq('id', compraId);

    comprasPendientesCache = comprasPendientesCache.filter((compra) => compra.id !== compraId);
    redibujarListaPendientes();
    await Swal.fire('Cancelada', 'La orden ha sido cancelada.', 'success');
  } catch (error) {
    await Swal.fire('Error', `No se pudo cancelar la compra: ${error.message}`, 'error');
  }
}

async function renderHistorialRecibidos() {
  const container = document.getElementById('historial-recibidos-container');
  if (!container) return;

  container.innerHTML = '<p class="text-sm text-gray-500">Cargando historial...</p>';
  try {
    const { data, error } = await tiendaState.currentSupabase
      .from('compras_tienda')
      .select(`
        *,
        proveedor:proveedor_id(nombre),
        creador:usuario_id(nombre),
        receptor:recibido_por_usuario_id(nombre)
      `)
      .eq('hotel_id', tiendaState.currentHotelId)
      .in('estado', ['recibido', 'recibido_parcial'])
      .order('fecha_recepcion', { ascending: false })
      .limit(50);

    if (error) throw error;
    if (!data?.length) {
      container.innerHTML = '<p class="text-center py-4 text-gray-500">No hay compras recibidas para mostrar.</p>';
      return;
    }

    container.innerHTML = `
      <div class="align-middle inline-block min-w-full">
        <div class="shadow overflow-hidden border-b border-gray-200 sm:rounded-lg">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha Recepcion</th>
                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Proveedor</th>
                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Recibido por</th>
                <th scope="col" class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              ${data.map((compra) => {
                const esParcial = compra.estado === 'recibido_parcial';
                const estadoClasses = esParcial ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800';
                const estadoTexto = esParcial ? 'Recibido Parcial' : 'Recibido';

                return `
                  <tr>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${new Date(compra.fecha_recepcion).toLocaleString('es-CO')}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${compra.proveedor?.nombre || 'N/A'}</td>
                    <td class="px-6 py-4 whitespace-nowrap">
                      <span class="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${estadoClasses}">${estadoTexto}</span>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${compra.receptor?.nombre || 'N/A'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                      <button onclick="window.verDetallesCompra('${compra.id}')" class="bg-blue-100 text-blue-700 hover:bg-blue-200 px-4 py-1 rounded-full font-semibold transition-colors duration-200">Ver Detalles</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p class="text-red-500">Error al cargar el historial: ${err.message}</p>`;
  }
}

export function resetComprasPendientesState() {
  comprasPendientesCache = [];
}
