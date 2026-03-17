import { tiendaState } from './state.js';
import { closeModal, formatCurrency, getTabContentEl, showGlobalLoading, hideGlobalLoading } from './helpers.js';

let productosCache = [];
let proveedoresCache = [];
let compraProveedorCarrito = [];

export async function renderHistorialCompras() {
  const container = document.getElementById('historial-compras-container');
  if (!container) return;

  container.innerHTML = '<p class="text-sm text-gray-500">Cargando historial de compras...</p>';

  try {
    const { data, error } = await tiendaState.currentSupabase
      .from('compras_tienda')
      .select(`
        *,
        proveedor:proveedores(nombre),
        creador:usuarios!compras_tienda_usuario_id_fkey(nombre)
      `)
      .eq('hotel_id', tiendaState.currentHotelId)
      .order('fecha', { ascending: false })
      .limit(50);

    if (error) throw error;
    if (!data?.length) {
      container.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">No hay historial de compras para mostrar.</p>';
      return;
    }

    container.innerHTML = `
      <div class="table-responsive-sm mt-4 border rounded-lg shadow-sm" style="overflow-x:auto;">
        <table class="table table-sm table-hover" style="min-width:600px;">
          <thead class="bg-gray-100">
            <tr>
              <th>Fecha Creacion</th>
              <th>Proveedor</th>
              <th>Total Est.</th>
              <th>Estado</th>
              <th>Creado por</th>
              <th style="text-align:center;">Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${data.map((compra) => `
              <tr>
                <td>${new Date(compra.fecha).toLocaleDateString()}</td>
                <td>${compra.proveedor?.nombre || 'N/A'}</td>
                <td>${formatCurrency(compra.total_compra)}</td>
                <td><span class="badge bg-secondary text-white">${compra.estado}</span></td>
                <td>${compra.creador?.nombre || 'N/A'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                  <button onclick="window.verDetallesCompra('${compra.id}')" class="bg-blue-100 text-blue-700 hover:bg-blue-200 px-4 py-1 rounded-full font-semibold transition-colors duration-200">
                    Ver Detalles
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p class="text-red-500">Error al cargar el historial: ${err.message}</p>`;
  }
}

export async function verDetallesCompra(compraId) {
  showGlobalLoading('Cargando detalles...');

  try {
    const { data: detalles, error } = await tiendaState.currentSupabase
      .from('detalle_compras_tienda')
      .select('*, producto:productos_tienda(nombre)')
      .eq('compra_id', compraId);

    if (error) throw error;
    if (!detalles?.length) throw new Error('No se encontraron detalles para esta compra.');

    const totalCompra = detalles.reduce((sum, item) => sum + item.subtotal, 0);
    const modal = document.createElement('div');
    modal.id = 'modal-detalles-compra';
    modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-[1001]';
    modal.innerHTML = `
      <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col overflow-hidden animate-fade-in-up">
        <div class="flex justify-between items-center p-5 border-b border-gray-200 bg-gray-50">
          <h3 class="text-xl font-semibold text-blue-700">Detalles de la Compra</h3>
          <button onclick="document.getElementById('modal-detalles-compra').remove()" class="text-gray-500 hover:text-gray-800 text-2xl leading-none focus:outline-none">&times;</button>
        </div>
        <div class="p-4 sm:p-6 overflow-y-auto max-h-[65vh]">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-100">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Producto</th>
                <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Cant.</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Precio Unit.</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Subtotal</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              ${detalles.map((item) => `
                <tr>
                  <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-800">${item.producto?.nombre || 'N/A'}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600 text-center">${item.cantidad}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600 text-right">${formatCurrency(item.precio_unitario)}</td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-700 text-right">${formatCurrency(item.subtotal)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="flex justify-end p-5 bg-gray-100 border-t border-gray-200">
          <div class="text-right">
            <span class="text-md font-medium text-gray-700">Total Compra:</span>
            <span class="text-2xl font-bold text-green-800 ml-3">${formatCurrency(totalCompra)}</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  } catch (err) {
    alert(`Error al cargar los detalles: ${err.message}`);
  } finally {
    hideGlobalLoading();
  }
}

export function renderCarritoCompra() {
  const tbody = document.getElementById('carritoCompra');
  if (!tbody) return;

  tbody.innerHTML = '';
  let totalSinRedondear = 0;

  compraProveedorCarrito.forEach((item) => {
    const subtotal = item.cantidad * item.precio;
    totalSinRedondear += subtotal;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding:12px 10px;font-weight:500;color:#1e293b;">${item.nombre}</td>
      <td style="padding:12px 10px;text-align:center;color:#0ea5e9;">${item.cantidad}</td>
      <td style="padding:12px 10px;text-align:right;color:#22c55e;">${formatCurrency(item.precio)}</td>
      <td style="padding:12px 10px;text-align:right;font-weight:600;">${formatCurrency(subtotal)}</td>
      <td style="padding:10px 0;text-align:center;">
        <button onclick="window.eliminarItemCompra('${item.id}')" style="background:#fee2e2; color:#b91c1c; border:none; border-radius:6px; padding:7px 14px; font-weight:bold; font-size:1.03em; cursor:pointer;" title="Eliminar">
          X
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  const totalRedondeado = Math.round(totalSinRedondear / 50) * 50;
  const totalEl = document.getElementById('totalCompra');
  if (totalEl) totalEl.textContent = formatCurrency(totalRedondeado);
}

export function eliminarItemCompra(id) {
  compraProveedorCarrito = compraProveedorCarrito.filter((item) => item.id !== id);
  renderCarritoCompra();
}

export function renderProductosCompra(filtro = '') {
  const productosListEl = document.getElementById('productosCompraList');
  if (!productosListEl) return;

  const proveedorSel = document.getElementById('selectProveedorCompraForm')?.value;
  const filtroLower = filtro.trim().toLowerCase();

  if (!proveedorSel) {
    productosListEl.innerHTML = '<div style="color:#999; padding:12px;">Selecciona un proveedor para ver sus productos.</div>';
    return;
  }

  let listaFiltrada = productosCache.filter((producto) => producto.proveedor_id === proveedorSel && producto.activo === true);
  if (filtroLower) {
    listaFiltrada = listaFiltrada.filter((producto) =>
      (producto.nombre || '').toLowerCase().includes(filtroLower) ||
      (producto.categoria_nombre || '').toLowerCase().includes(filtroLower) ||
      (producto.codigo_barras || '').toLowerCase().includes(filtroLower)
    );
  }

  if (!listaFiltrada.length) {
    productosListEl.innerHTML = `<div style="color:#999; padding:12px;">No hay productos activos para este proveedor ${filtro ? 'o filtro' : ''}.</div>`;
    return;
  }

  productosListEl.innerHTML = listaFiltrada.map((producto) => `
    <div style="display:flex; align-items:center; gap:8px; padding:10px 0 12px 0; border-bottom:1px solid #f1f5f9; font-size:0.97em;">
      <span style="flex:2 1 auto; font-weight:600; color:#1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${producto.nombre}
        <span style="font-size:0.8em; color:#64748b; font-weight:400; margin-left:5px;">${producto.categoria_nombre || ''}</span>
      </span>
      <input type="number" id="cantidad_${producto.id}" min="1" class="input" placeholder="Cant." style="width:80px; text-align:center; padding:5px 7px; border-radius:4px; border:1px solid #cbd5e1; font-size:0.9em;">
      <input type="number" id="precio_${producto.id}" min="0" step="0.01" class="input" placeholder="Precio" style="width:100px; text-align:center; padding:5px 7px; border-radius:4px; border:1px solid #cbd5e1; font-size:0.9em;">
      <button onclick="window.agregarProductoCompra('${producto.id}')" style="background:linear-gradient(90deg,#1d4ed8,#22c55e); color:#fff; border:none; border-radius:4px; padding:5px 12px; font-size:0.9em; font-weight:600; cursor:pointer;">+</button>
    </div>
  `).join('');
}

export function agregarProductoCompra(id) {
  const cantidad = Number(document.getElementById(`cantidad_${id}`)?.value);
  const precio = Number(document.getElementById(`precio_${id}`)?.value);
  const producto = productosCache.find((item) => item.id === id);
  if (!producto || !cantidad || !precio) return;

  const existente = compraProveedorCarrito.find((item) => item.id === id);
  if (existente) {
    existente.cantidad += cantidad;
    existente.precio = precio;
  } else {
    compraProveedorCarrito.push({ ...producto, cantidad, precio });
  }
  renderCarritoCompra();
}

export async function registrarCompraProveedor() {
  const msgEl = document.getElementById('msgCompra');
  const btnEl = document.getElementById('btnRegistrarCompra');
  const originalBtnText = btnEl?.textContent || 'Registrar Compra';

  if (msgEl) msgEl.textContent = '';
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = 'Procesando...';
  }

  try {
    if (!compraProveedorCarrito.length) throw new Error('El carrito de compra esta vacio.');

    const proveedorId = document.getElementById('selectProveedorCompraForm')?.value;
    if (!proveedorId) throw new Error('Debes seleccionar un proveedor.');

    const fechaLlegada = document.getElementById('fechaLlegadaCompra')?.value;
    if (!fechaLlegada) throw new Error('Debes seleccionar una fecha de llegada estimada.');

    const totalSinRedondear = compraProveedorCarrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
    const total = Math.round(totalSinRedondear / 50) * 50;

    const { data: compraData, error: compraError } = await tiendaState.currentSupabase
      .from('compras_tienda')
      .insert({
        hotel_id: tiendaState.currentHotelId,
        usuario_id: tiendaState.currentUser.id,
        proveedor_id: proveedorId,
        total_compra: total,
        fecha: new Date().toISOString(),
        fecha_llegada_estimada: fechaLlegada,
        estado: 'pendiente',
      })
      .select()
      .single();

    if (compraError) throw new Error(`Error al guardar la orden de compra: ${compraError.message}`);

    const detalleItems = compraProveedorCarrito.map((item) => ({
      compra_id: compraData.id,
      producto_id: item.id,
      cantidad: item.cantidad,
      precio_unitario: item.precio,
      subtotal: item.cantidad * item.precio,
      hotel_id: tiendaState.currentHotelId,
    }));

    const { error: detalleError } = await tiendaState.currentSupabase
      .from('detalle_compras_tienda')
      .insert(detalleItems);

    if (detalleError) {
      await tiendaState.currentSupabase.from('compras_tienda').delete().eq('id', compraData.id);
      throw new Error(`Error al guardar los detalles de la compra: ${detalleError.message}`);
    }

    for (const item of compraProveedorCarrito) {
      await tiendaState.currentSupabase
        .from('productos_tienda')
        .update({ precio: item.precio })
        .eq('id', item.id);
    }

    await Swal.fire({
      icon: 'success',
      title: 'Compra Registrada',
      text: 'La orden se creo exitosamente y ahora esta en la pestana "Compras Pendientes".',
      confirmButtonColor: '#16a34a',
      timer: 3000,
      timerProgressBar: true,
    });

    compraProveedorCarrito = [];
    renderCarritoCompra();
    document.getElementById('buscarProductoCompra').value = '';
    renderProductosCompra();
    await renderHistorialCompras();
  } catch (err) {
    console.error('Error en registrarCompraProveedor:', err);
    if (msgEl) msgEl.textContent = err.message;
    else alert(err.message);
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = originalBtnText;
    }
  }
}

export async function renderModuloCompras() {
  const cont = getTabContentEl();
  if (!cont) return;

  const { data: productos } = await tiendaState.currentSupabase
    .from('productos_tienda')
    .select('*')
    .eq('hotel_id', tiendaState.currentHotelId);
  productosCache = productos || [];

  const { data: proveedores } = await tiendaState.currentSupabase
    .from('proveedores')
    .select('*')
    .eq('hotel_id', tiendaState.currentHotelId);
  proveedoresCache = proveedores || [];

  if (!productosCache.length) {
    cont.innerHTML = '<div style="background:#fee2e2; color:#b91c1c; font-weight:600; padding:18px 26px; text-align:center;">No hay productos cargados.</div>';
    return;
  }
  if (!proveedoresCache.length) {
    cont.innerHTML = '<div style="background:#fef9c3; color:#a16207; font-weight:600; padding:18px 26px; text-align:center;">No hay proveedores cargados.</div>';
    return;
  }

  cont.innerHTML = `
    <div style="background:#fff; border-radius:14px; box-shadow:0 3px 16px #0002; padding:30px 24px; max-width:520px; margin:auto;">
      <h3 style="font-size:1.24em;color:#1d4ed8;font-weight:700;margin-bottom:18px;">Registrar Compra a Proveedor</h3>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom:15px;">
        <div style="grid-column: 1 / -1;">
          <label style="font-weight:600; color:#334155; display:block;">Proveedor:</label>
          <select id="selectProveedorCompraForm" style="margin-top:6px; width:100%; padding:9px 13px; border-radius:7px; border:1.5px solid #cbd5e1;">
            <option value="">Selecciona proveedor</option>
            ${proveedoresCache.map((pr) => `<option value="${pr.id}">${pr.nombre}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-weight:600; color:#334155; display:block;">Fecha de Llegada:</label>
          <input type="date" id="fechaLlegadaCompra" style="margin-top:6px; width:100%; padding:8px 13px; border-radius:7px; border:1.5px solid #cbd5e1; font-family: inherit; font-size: inherit; color:#334155;">
        </div>
      </div>
      <input id="buscarProductoCompra" placeholder="Buscar producto..." style="width:100%; padding:9px 13px; margin-bottom:13px; border-radius:6px; border:1.5px solid #d1d5db;"/>
      <div id="productosCompraList" style="margin-bottom:20px;"></div>
      <h5 style="margin:18px 0 10px 0; font-size:1.09em; color:#0f766e; font-weight:600;">Carrito de compra:</h5>
      <div style="overflow-x:auto;background:#f9fafb;border-radius:9px;">
        <table style="width:100%;font-size:0.97em;border-collapse:collapse;">
          <thead><tr style="background:#e0f2fe;color:#0e7490;"><th style="padding:8px 4px;">Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th><th></th></tr></thead>
          <tbody id="carritoCompra"></tbody>
        </table>
      </div>
      <div style="text-align:right;font-size:1.08em;margin-top:10px;font-weight:600;">Total: <span id="totalCompra" style="color:#16a34a;">$0</span></div>
      <button id="btnRegistrarCompra" style="background:linear-gradient(90deg,#16a34a,#22c55e); color:#fff; font-size:1.07em; padding:11px 36px; border:none; border-radius:7px; margin-top:24px; font-weight:700;">Registrar Compra</button>
      <div id="msgCompra" style="color:#e11d48;margin-top:18px;font-weight:bold;font-size:1em;"></div>
    </div>
    <hr style="margin: 2rem 0;">
    <h5 style="font-weight:bold; font-size:1.2em; color:#1e293b; margin-bottom:1rem;">Historial General de Compras</h5>
    <div id="historial-compras-container" class="mt-3"></div>
  `;

  const buscarInput = document.getElementById('buscarProductoCompra');
  const proveedorSelect = document.getElementById('selectProveedorCompraForm');
  const fechaInput = document.getElementById('fechaLlegadaCompra');

  if (fechaInput) {
    const today = new Date();
    const offset = today.getTimezoneOffset();
    const todayLocal = new Date(today.getTime() - (offset * 60 * 1000));
    fechaInput.value = todayLocal.toISOString().split('T')[0];
  }

  buscarInput.oninput = () => renderProductosCompra(buscarInput.value);
  proveedorSelect.onchange = () => renderProductosCompra(buscarInput.value);
  document.getElementById('btnRegistrarCompra').onclick = registrarCompraProveedor;

  compraProveedorCarrito = [];
  renderProductosCompra();
  renderCarritoCompra();
  await renderHistorialCompras();
}

export function showModalPagoCompra(totalAPagar, metodosPagoDisponibles, onConfirm) {
  const modalContainer = document.createElement('div');
  modalContainer.id = 'modal-pago-compra';
  modalContainer.style = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:1002;';

  const opcionesMetodosHTML = metodosPagoDisponibles
    .map((metodo) => `<option value="${metodo.id}">${metodo.nombre}</option>`)
    .join('');

  modalContainer.innerHTML = `
    <div style="background:white; border-radius:12px; padding:24px; width:95%; max-width:500px; max-height:90vh; display:flex; flex-direction:column;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="margin:0; font-size:1.2em; color:#1e3a8a;">Registrar Pago de Compra (Mixto)</h3>
        <button class="btn-cerrar" style="background:none; border:none; font-size:1.5em; cursor:pointer;">&times;</button>
      </div>
      <p style="text-align:center; font-size:1.1em; margin-bottom:15px;">Total a Pagar: <strong style="color:#c2410c; font-size:1.2em;">${formatCurrency(totalAPagar)}</strong></p>
      <form id="form-pago-compra" style="overflow-y:auto; flex-grow:1; padding-right:10px;">
        <div id="lista-pagos-compra" class="space-y-3"></div>
        <button type="button" id="btn-agregar-pago-compra" style="font-size:0.9em; color:#1d4ed8; background:none; border:none; cursor:pointer; margin-top:10px;">+ Agregar otro metodo</button>
      </form>
      <div style="margin-top:15px; padding-top:15px; border-top:1px solid #eee; font-weight:600;">
        <div style="display:flex; justify-content:space-between;"><span>Total ingresado:</span> <span id="total-ingresado-compra">$0</span></div>
        <div style="display:flex; justify-content:space-between; color:#ef4444;" id="linea-restante"><span>Restante:</span> <span id="restante-compra">${formatCurrency(totalAPagar)}</span></div>
      </div>
      <div style="display:flex; gap:10px; margin-top:20px;">
        <button type="submit" form="form-pago-compra" id="btn-confirmar-pago-compra" style="flex:1; background:#16a34a; color:white; border:none; padding:10px; border-radius:6px; font-weight:600; cursor:pointer;" disabled>Confirmar Pago</button>
        <button type="button" class="btn-cerrar" style="flex:1; background:#6b7280; color:white; border:none; padding:10px; border-radius:6px; font-weight:600; cursor:pointer;">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalContainer);

  const form = modalContainer.querySelector('#form-pago-compra');
  const listaPagosDiv = modalContainer.querySelector('#lista-pagos-compra');
  const btnConfirmar = modalContainer.querySelector('#btn-confirmar-pago-compra');

  const closeAction = () => modalContainer.remove();
  modalContainer.querySelectorAll('.btn-cerrar').forEach((btn) => {
    btn.onclick = closeAction;
  });

  const actualizarTotales = () => {
    let totalIngresado = 0;
    listaPagosDiv.querySelectorAll('.pago-compra-row').forEach((row) => {
      totalIngresado += Number(row.querySelector('.monto-pago-compra').value) || 0;
    });
    const restante = totalAPagar - totalIngresado;
    modalContainer.querySelector('#total-ingresado-compra').textContent = formatCurrency(totalIngresado);
    modalContainer.querySelector('#restante-compra').textContent = formatCurrency(restante);
    const lineaRestante = modalContainer.querySelector('#linea-restante');

    if (Math.abs(restante) < 0.01) {
      btnConfirmar.disabled = false;
      lineaRestante.style.color = '#16a34a';
    } else {
      btnConfirmar.disabled = true;
      lineaRestante.style.color = '#ef4444';
    }
  };

  const agregarFila = () => {
    const newRow = document.createElement('div');
    newRow.className = 'pago-compra-row';
    newRow.style = 'display:flex; gap:8px; align-items:center;';
    newRow.innerHTML = `
      <select class="metodo-pago-compra" style="flex:2; padding:8px; border:1px solid #ccc; border-radius:4px;" required>${opcionesMetodosHTML}</select>
      <input type="number" class="monto-pago-compra" placeholder="Monto" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:4px;" required min="0">
      <button type="button" class="btn-remover-fila" style="background:#fee2e2; color:#dc2626; border:none; padding:5px 8px; border-radius:4px; cursor:pointer;">X</button>
    `;
    listaPagosDiv.appendChild(newRow);
    newRow.querySelector('.btn-remover-fila').onclick = () => {
      newRow.remove();
      actualizarTotales();
    };
  };

  modalContainer.querySelector('#btn-agregar-pago-compra').onclick = agregarFila;
  listaPagosDiv.addEventListener('input', actualizarTotales);
  agregarFila();
  const primerInput = listaPagosDiv.querySelector('.monto-pago-compra');
  if (primerInput) primerInput.value = totalAPagar;
  actualizarTotales();

  form.onsubmit = (event) => {
    event.preventDefault();
    const pagosConfirmados = [];
    listaPagosDiv.querySelectorAll('.pago-compra-row').forEach((row) => {
      const metodoId = row.querySelector('.metodo-pago-compra').value;
      const monto = Number(row.querySelector('.monto-pago-compra').value);
      if (metodoId && monto > 0) {
        pagosConfirmados.push({ metodo_pago_id: metodoId, monto });
      }
    });
    if (pagosConfirmados.length > 0) {
      onConfirm(pagosConfirmados);
      closeAction();
    }
  };
}

export function resetComprasModuleState() {
  productosCache = [];
  proveedoresCache = [];
  compraProveedorCarrito = [];
}
