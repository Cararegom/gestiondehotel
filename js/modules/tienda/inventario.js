import { showError } from '../../uiUtils.js';
import { crearNotificacion } from '../../services/NotificationService.js';
import { tiendaState } from './state.js';
import { closeModal, formatCurrency, getModalContainerEl, getTabContentEl } from './helpers.js';

let inventarioProductos = [];
let categoriasCache = [];
let proveedoresCache = [];

export async function renderInventario() {
  const cont = getTabContentEl();
  if (!cont) return;

  cont.innerHTML = `
    <div id="inventario-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
      <h2 style="font-size:1.35rem;font-weight:700;color:#1d4ed8;">Inventario de Productos</h2>
      <div class="inventario-actions" style="display:flex; gap:10px;">
        <button id="btnHojaConteo" style="background:#fff;color:#4b5563;border:1.5px solid #d1d5db;padding:9px 22px;border-radius:6px;font-size:1em;font-weight:600;">Hoja de Conteo</button>
        <button id="btnDescargarInventario" style="background:#fff;color:#1d4ed8;border:1.5px solid #1d4ed8;padding:9px 22px;border-radius:6px;font-size:1em;font-weight:600;">Descargar</button>
        <button id="btnVerMovimientos" style="background:linear-gradient(90deg,#60a5fa,#3b82f6);color:#fff;padding:9px 22px;border:none;border-radius:6px;font-size:1em;font-weight:600;">Historial</button>
        <button id="btnNuevoProducto" style="background:linear-gradient(90deg,#22c55e,#16a34a);color:#fff;padding:9px 22px;border:none;border-radius:6px;font-size:1em;font-weight:600;">+ Agregar Producto</button>
      </div>
    </div>
    <div id="inventario-filters" style="margin-bottom:12px;display:flex;align-items:center;gap:10px;">
      <input id="buscarInventario" placeholder="Buscar por nombre, codigo o categoria..." style="flex:1;max-width:320px;padding:9px 15px;border:1.5px solid #cbd5e1;border-radius:7px;font-size:1em;"/>
      <select id="filtroCategoriaInv" style="padding:8px 13px;border-radius:7px;border:1.5px solid #cbd5e1;font-size:1em;"><option value="">Todas las categorias</option></select>
    </div>
    <div style="overflow-x:auto;background:#fff;border-radius:10px;box-shadow:0 2px 8px #0001;">
      <table style="width:100%;font-size:14px;border-collapse:collapse;">
        <thead><tr style="background:#f3f4f6;"><th style="padding:12px;">Nombre</th><th style="padding:12px;">Codigo</th><th style="padding:12px;">Categoria</th><th style="padding:12px;">Stock</th><th style="padding:12px;">Precio Venta</th><th style="padding:12px;">Estado</th><th style="padding:12px 18px;text-align:center;">Acciones</th></tr></thead>
        <tbody id="invProductos"></tbody>
      </table>
    </div>
  `;

  document.getElementById('btnHojaConteo').onclick = mostrarOpcionesHojaConteo;
  document.getElementById('btnDescargarInventario').onclick = mostrarOpcionesDescarga;
  document.getElementById('btnNuevoProducto').onclick = () => showModalProducto();
  document.getElementById('btnVerMovimientos').onclick = () => showModalHistorial();
  document.getElementById('buscarInventario').oninput = (e) => renderTablaInventario(e.target.value);
  document.getElementById('filtroCategoriaInv').onchange = () => renderTablaInventario(document.getElementById('buscarInventario').value);

  await Promise.all([cargarCategoriasYProveedores(), cargarProductosInventario()]);
  document.getElementById('filtroCategoriaInv').innerHTML = `<option value="">Todas las categorias</option>${categoriasCache.map((cat) => `<option value="${cat.id}">${cat.nombre}</option>`).join('')}`;
  renderTablaInventario('');
}

async function cargarCategoriasYProveedores() {
  const [{ data: cat }, { data: prov }] = await Promise.all([
    tiendaState.currentSupabase.from('categorias_producto').select('id, nombre').eq('hotel_id', tiendaState.currentHotelId).eq('activa', true),
    tiendaState.currentSupabase.from('proveedores').select('id, nombre').eq('hotel_id', tiendaState.currentHotelId).eq('activo', true),
  ]);
  categoriasCache = cat || [];
  proveedoresCache = prov || [];
}

async function cargarProductosInventario() {
  const { data } = await tiendaState.currentSupabase
    .from('productos_tienda')
    .select('*, categoria_id, proveedor_id')
    .eq('hotel_id', tiendaState.currentHotelId)
    .order('nombre', { ascending: true });
  inventarioProductos = data || [];
}

function renderTablaInventario(filtro = '') {
  const tbody = document.getElementById('invProductos');
  if (!tbody) return;

  const categoriaId = document.getElementById('filtroCategoriaInv')?.value;
  let lista = inventarioProductos;
  if (filtro?.trim()) {
    const fil = filtro.toLowerCase();
    lista = lista.filter((p) => (p.nombre || '').toLowerCase().includes(fil) || (p.codigo_barras || '').toLowerCase().includes(fil));
  }
  if (categoriaId) lista = lista.filter((p) => p.categoria_id === categoriaId);

  tbody.innerHTML = lista.map((p) => {
    const categoriaNombre = categoriasCache.find((c) => c.id === p.categoria_id)?.nombre || '-';
    return `
      <tr style="opacity:${p.activo ? '1' : '0.6'};">
        <td style="padding:10px 8px;font-weight:600;">${p.nombre}</td>
        <td style="padding:10px 8px;text-align:center;">${p.codigo_barras || '-'}</td>
        <td style="padding:10px 8px;text-align:center;">${categoriaNombre}</td>
        <td style="padding:10px 8px;text-align:center;font-weight:700;font-size:1.1em;color:${p.stock_actual < (p.stock_minimo || 0) ? '#f43f5e' : '#166534'};">${p.stock_actual || 0}</td>
        <td style="padding:10px 8px;text-align:right;">${formatCurrency(p.precio_venta)}</td>
        <td style="padding:10px 8px;text-align:center;"><span style="font-weight:bold;color:${p.activo ? '#22c55e' : '#f43f5e'};">${p.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td style="padding:10px 8px;text-align:center;display:flex;gap:4px;justify-content:center;align-items:center;">
          <button onclick="window.showModalMovimiento('${p.id}', 'INGRESO')" style="background:#dcfce7;color:#16a34a;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;">+</button>
          <button onclick="window.showModalMovimiento('${p.id}', 'SALIDA')" style="background:#fee2e2;color:#ef4444;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;">-</button>
          <button onclick="window.showModalProducto('${p.id}')" style="background:#e0e7ff;color:#4338ca;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;">Editar</button>
          ${p.activo
            ? `<button onclick="window.confirmarEliminarProducto('${p.id}', '${(p.nombre || '').replace(/'/g, "\\'")}')" style="background:#fecaca;color:#dc2626;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;">Inactivar</button>`
            : `<button onclick="window.reactivarProducto('${p.id}')" style="background:#dcfce7;color:#16a34a;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;">Activar</button>`}
        </td>
      </tr>
    `;
  }).join('');
}

export function confirmarEliminarProducto(productoId, nombreProducto) {
  if (confirm(`Estas seguro de que quieres inactivar el producto "${nombreProducto}"?`)) {
    actualizarEstadoProducto(productoId, false);
  }
}

export function reactivarProducto(productoId) {
  actualizarEstadoProducto(productoId, true);
}

async function actualizarEstadoProducto(id, activo) {
  try {
    const { error } = await tiendaState.currentSupabase.from('productos_tienda').update({ activo, actualizado_en: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    await cargarProductosInventario();
    renderTablaInventario(document.getElementById('buscarInventario')?.value || '');
  } catch (error) {
    alert(`Error al actualizar el producto: ${error.message}`);
  }
}

export async function showModalProducto(productoId = null) {
  const modalContainer = getModalContainerEl();
  if (!modalContainer) return;

  const prod = productoId ? inventarioProductos.find((p) => p.id === productoId) : null;
  const esEdicion = Boolean(productoId);

  modalContainer.style.display = 'flex';
  modalContainer.innerHTML = `
    <div style="background:#fff;border-radius:18px;box-shadow:0 8px 40px #1d4ed828;max-width:430px;width:95vw;margin:auto;padding:34px 26px 22px 26px;position:relative;max-height:90vh;overflow-y:auto;">
      <button onclick="window.closeModal()" style="position:absolute;right:14px;top:10px;background:none;border:none;font-size:25px;color:#64748b;cursor:pointer;" title="Cerrar">&times;</button>
      <h2 style="margin-bottom:19px;text-align:center;font-size:1.22rem;font-weight:700;color:#1d4ed8;">${esEdicion ? 'Editar' : 'Nuevo'} Producto</h2>
      <form id="formProductoInv" autocomplete="off">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:13px 16px;">
          <div style="grid-column:1/3;"><label>Nombre</label><input id="prodNombre" required value="${prod?.nombre || ''}" style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;"></div>
          <div style="grid-column:1/3;"><label>Codigo de Barras</label><input id="prodCodigoBarras" value="${prod?.codigo_barras || ''}" style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;"></div>
          <div><label>Categoria</label><select id="prodCategoria" required style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;"><option value="">Selecciona...</option>${categoriasCache.map((cat) => `<option value="${cat.id}" ${prod?.categoria_id === cat.id ? 'selected' : ''}>${cat.nombre}</option>`).join('')}</select></div>
          <div><label>Proveedor</label><select id="prodProveedor" style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;"><option value="">(Opcional)</option>${proveedoresCache.map((pr) => `<option value="${pr.id}" ${prod?.proveedor_id === pr.id ? 'selected' : ''}>${pr.nombre}</option>`).join('')}</select></div>
          <div><label>${esEdicion ? 'Stock actual' : 'Stock inicial'}</label><input id="prodStock" type="number" min="0" value="${prod?.stock_actual || '0'}" ${esEdicion ? 'readonly' : ''} style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;"></div>
          <div><label>Precio compra</label><input id="prodPrecio" type="number" min="0" step="any" value="${prod?.precio || ''}" style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;"></div>
          <div><label>Precio venta</label><input id="prodPrecioVenta" type="number" min="0" step="any" value="${prod?.precio_venta || ''}" style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;"></div>
          <div><label>Stock minimo</label><input id="prodStockMin" type="number" min="0" value="${prod?.stock_minimo || ''}" style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;"></div>
          <div><label>Stock maximo</label><input id="prodStockMax" type="number" min="0" value="${prod?.stock_maximo || ''}" style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;"></div>
        </div>
        <div style="margin-top:23px;display:flex;gap:14px;justify-content:center;">
          <button type="submit" style="background:linear-gradient(90deg,#22c55e,#16a3a4);color:#fff;font-weight:700;border:none;border-radius:7px;padding:11px 28px;font-size:1.08em;cursor:pointer;">${esEdicion ? 'Actualizar' : 'Crear'}</button>
          <button type="button" onclick="window.closeModal()" style="background:#e0e7ef;color:#334155;font-weight:600;border:none;border-radius:7px;padding:11px 28px;font-size:1.08em;cursor:pointer;">Cancelar</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById('formProductoInv').onsubmit = async (e) => {
    e.preventDefault();
    await saveProductoInv(productoId);
  };
}

async function saveProductoInv(productoId) {
  const btnSubmit = document.querySelector('#formProductoInv button[type="submit"]');
  const originalText = btnSubmit.textContent;
  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Guardando...';

  try {
    const datosProducto = {
      hotel_id: tiendaState.currentHotelId,
      nombre: document.getElementById('prodNombre').value.trim(),
      codigo_barras: document.getElementById('prodCodigoBarras').value.trim() || null,
      categoria_id: document.getElementById('prodCategoria').value,
      precio: Number(document.getElementById('prodPrecio').value) || 0,
      precio_venta: Number(document.getElementById('prodPrecioVenta').value) || 0,
      stock_minimo: Number(document.getElementById('prodStockMin').value) || 0,
      stock_maximo: Number(document.getElementById('prodStockMax').value) || 0,
      proveedor_id: document.getElementById('prodProveedor').value || null,
      actualizado_en: new Date().toISOString(),
    };

    if (productoId) {
      const { error } = await tiendaState.currentSupabase.from('productos_tienda').update(datosProducto).eq('id', productoId);
      if (error) throw error;
    } else {
      datosProducto.stock_actual = Number(document.getElementById('prodStock').value) || 0;
      datosProducto.creado_en = new Date().toISOString();
      datosProducto.activo = true;

      const { data: nuevoProducto, error } = await tiendaState.currentSupabase.from('productos_tienda').insert([datosProducto]).select();
      if (error) throw error;

      if (datosProducto.stock_actual > 0 && nuevoProducto?.[0]) {
        const { data: { user } } = await tiendaState.currentSupabase.auth.getUser();
        const nombreResponsable = user.user_metadata?.full_name || user.user_metadata?.nombre || user.email;
        await tiendaState.currentSupabase.from('movimientos_inventario').insert([{
          hotel_id: tiendaState.currentHotelId,
          producto_id: nuevoProducto[0].id,
          tipo_movimiento: 'INGRESO',
          cantidad: datosProducto.stock_actual,
          razon: 'Stock inicial de creacion',
          usuario_responsable: nombreResponsable,
          stock_anterior: 0,
          stock_nuevo: datosProducto.stock_actual,
        }]);
      }
    }

    closeModal();
    await Promise.all([cargarCategoriasYProveedores(), cargarProductosInventario()]);
    renderTablaInventario('');
  } catch (error) {
    let mensajeUsuario = `Error al guardar el producto: ${error.message}`;
    if (error.message.includes('productos_tienda_hotel_id_nombre_key')) mensajeUsuario = 'Error: Ya existe un producto con este nombre.';
    if (error.message.includes('codigo_barras')) mensajeUsuario = 'Error: Ya existe un producto con este codigo de barras.';
    showError(null, mensajeUsuario);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = originalText;
  }
}

export async function showModalHistorial(productoId = null) {
  const modalContainer = getModalContainerEl();
  if (!modalContainer) return;

  modalContainer.style.display = 'flex';
  modalContainer.innerHTML = '<div style="color:#fff;font-size:1.2em;">Cargando historial...</div>';

  let query = tiendaState.currentSupabase.from('movimientos_inventario').select('*, producto:productos_tienda(nombre)').eq('hotel_id', tiendaState.currentHotelId).order('creado_en', { ascending: false }).limit(100);
  if (productoId) query = query.eq('producto_id', productoId);
  const { data: movimientos, error } = await query;

  if (error) {
    alert(`Error al cargar el historial: ${error.message}`);
    closeModal();
    return;
  }

  modalContainer.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:800px;width:95vw;max-height:90vh;overflow-y:auto;margin:auto;padding:24px; position:relative;">
      <button onclick="window.closeModal()" style="position:absolute;right:14px;top:10px;background:none;border:none;font-size:25px;color:#64748b;cursor:pointer; line-height:1;" title="Cerrar">&times;</button>
      <h2 style="margin-top:0; margin-bottom:20px;color:#1e293b;">Historial de Movimientos</h2>
      <div style="overflow-x:auto;">
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
          <thead><tr style="background:#f1f5f9;text-align:left;"><th style="padding:10px;">Fecha</th>${!productoId ? '<th style="padding:10px;">Producto</th>' : ''}<th style="padding:10px;">Tipo</th><th style="padding:10px;">Cantidad</th><th style="padding:10px;">Responsable</th><th style="padding:10px;">Razon</th><th style="padding:10px;text-align:center;">Stock Ant/Nuevo</th></tr></thead>
          <tbody>
            ${(movimientos || []).map((mov) => `
              <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:8px 10px;">${new Date(mov.creado_en).toLocaleString('es-CO')}</td>
                ${!productoId ? `<td style="padding:8px 10px;">${mov.producto?.nombre || 'N/A'}</td>` : ''}
                <td style="padding:8px 10px;"><span style="font-weight:bold;color:${mov.tipo_movimiento === 'INGRESO' ? '#16a34a' : '#ef4444'};">${mov.tipo_movimiento}</span></td>
                <td style="padding:8px 10px;font-weight:600;">${mov.cantidad}</td>
                <td style="padding:8px 10px;font-weight:500;">${mov.usuario_responsable}</td>
                <td style="padding:8px 10px;">${mov.razon}</td>
                <td style="padding:8px 10px;text-align:center;">${mov.stock_anterior} -> ${mov.stock_nuevo}</td>
              </tr>
            `).join('')}
            ${(movimientos || []).length === 0 ? '<tr><td colspan="7" style="padding:20px;text-align:center;color:#64748b;">No hay movimientos registrados.</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export async function showModalMovimiento(productoId, tipo) {
  const modalContainer = getModalContainerEl();
  if (!modalContainer) return;

  const prod = inventarioProductos.find((p) => p.id === productoId);
  if (!prod) {
    alert('Producto no encontrado.');
    return;
  }

  modalContainer.style.display = 'flex';
  modalContainer.innerHTML = `
    <div style="background:#fff;border-radius:18px;max-width:400px;width:95vw;margin:auto;padding:28px 24px;position:relative;">
      <button onclick="window.closeModal()" style="position:absolute;right:14px;top:10px;background:none;border:none;font-size:25px;color:#64748b;cursor:pointer;" title="Cerrar">&times;</button>
      <h2 style="margin-top:0; margin-bottom:15px;text-align:center;font-size:1.2rem;font-weight:700;color:${tipo === 'INGRESO' ? '#16a34a' : '#ef4444'};">${tipo === 'INGRESO' ? 'Ingreso a Inventario' : 'Salida de Inventario'}</h2>
      <p style="text-align:center;margin-top:-5px;margin-bottom:20px;font-size:1.1rem;font-weight:600;">${prod.nombre}</p>
      <p style="text-align:center;margin-top:-15px;margin-bottom:20px;font-size:0.9rem;">Stock Actual: <strong style="font-size:1.1rem;">${prod.stock_actual}</strong></p>
      <form id="formMovimiento">
        <div style="display:flex;flex-direction:column;gap:15px;">
          <div><label style="font-weight:500;">Cantidad</label><input id="movCantidad" type="number" min="1" required style="width:100%;padding:9px 12px;margin-top:3px;border:1.5px solid #cbd5e1;border-radius:6px;font-size:1.1em;"></div>
          <div><label style="font-weight:500;">Razon o Motivo</label><textarea id="movRazon" required rows="3" style="width:100%;padding:8px 11px;margin-top:3px;border:1.5px solid #cbd5e1;border-radius:6px;"></textarea></div>
        </div>
        <div style="margin-top:25px;text-align:center;"><button type="submit" style="background:linear-gradient(90deg,${tipo === 'INGRESO' ? '#22c55e,#16a34a' : '#f87171,#ef4444'});color:#fff;font-weight:700;border:none;border-radius:7px;padding:11px 35px;font-size:1.08em;cursor:pointer;">Confirmar ${tipo}</button></div>
      </form>
    </div>
  `;

  document.getElementById('formMovimiento').onsubmit = async (e) => {
    e.preventDefault();
    await saveMovimiento(productoId, tipo);
  };
}

async function saveMovimiento(productoId, tipo) {
  const btn = document.querySelector('#formMovimiento button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    const { data: { user } } = await tiendaState.currentSupabase.auth.getUser();
    if (!user) throw new Error('No se pudo identificar al usuario.');

    const cantidad = parseInt(document.getElementById('movCantidad').value, 10);
    const razon = document.getElementById('movRazon').value;
    if (isNaN(cantidad) || cantidad <= 0) throw new Error('La cantidad debe ser positiva.');

    const producto = inventarioProductos.find((p) => p.id === productoId);
    const stockAnterior = producto.stock_actual;
    const stockMinimo = producto.stock_minimo || 0;
    const nuevoStock = tipo === 'INGRESO'
      ? stockAnterior + cantidad
      : stockAnterior - cantidad;

    if (tipo === 'SALIDA' && cantidad > stockAnterior) {
      throw new Error(`No puedes dar salida a ${cantidad} unidades. Solo hay ${stockAnterior} en stock.`);
    }

    const movimientoData = {
      hotel_id: tiendaState.currentHotelId,
      producto_id: productoId,
      tipo_movimiento: tipo,
      cantidad,
      razon,
      usuario_responsable: user.user_metadata?.full_name || user.user_metadata?.nombre || user.email,
      stock_anterior: stockAnterior,
      stock_nuevo: nuevoStock,
    };

    const { error: movError } = await tiendaState.currentSupabase.from('movimientos_inventario').insert([movimientoData]);
    if (movError) throw movError;

    const { error: prodError } = await tiendaState.currentSupabase.from('productos_tienda').update({ stock_actual: nuevoStock, actualizado_en: new Date().toISOString() }).eq('id', productoId);
    if (prodError) throw prodError;

    if (tipo === 'SALIDA' && stockAnterior > stockMinimo && nuevoStock <= stockMinimo && stockMinimo > 0) {
      try {
        await crearNotificacion(tiendaState.currentSupabase, {
          hotelId: tiendaState.currentHotelId,
          rolDestino: 'admin',
          tipo: 'stock_bajo',
          mensaje: `El producto '${producto.nombre}' esta en stock bajo (Actual: ${nuevoStock}, Minimo: ${stockMinimo}).`,
          entidadTipo: 'producto',
          entidadId: producto.id,
          userId: null,
        });
      } catch (notifError) {
        console.error('Error al crear notificacion:', notifError);
      }
    }

    closeModal();
    await cargarProductosInventario();
    renderTablaInventario(document.getElementById('buscarInventario')?.value || '');
  } catch (error) {
    alert(`Error al registrar el movimiento: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = `Confirmar ${tipo}`;
  }
}

function mostrarOpcionesHojaConteo() {
  const modalContainer = getModalContainerEl();
  if (!modalContainer) return;

  modalContainer.style.display = 'flex';
  modalContainer.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:28px 24px;width:95vw;max-width:420px;text-align:center;">
      <h2 style="margin-top:0;margin-bottom:15px;color:#1e293b;">Hoja de Conteo</h2>
      <p style="margin-top:0;margin-bottom:22px;color:#475569;">Elige como deseas generar la hoja de conteo.</p>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <button id="btnImprimirHojaConteo" style="background:#3b82f6;color:white;border:none;padding:12px 18px;border-radius:8px;font-size:1em;font-weight:600;cursor:pointer;">Imprimir</button>
        <button id="btnExcelHojaConteo" style="background:#107c41;color:white;border:none;padding:12px 18px;border-radius:8px;font-size:1em;font-weight:600;cursor:pointer;">Descargar Excel</button>
      </div>
      <button onclick="window.closeModal()" style="margin-top:20px;background:none;border:none;color:#64748b;cursor:pointer;">Cancelar</button>
    </div>
  `;

  document.getElementById('btnImprimirHojaConteo').onclick = () => {
    closeModal();
    imprimirHojaDeConteo();
  };
  document.getElementById('btnExcelHojaConteo').onclick = () => {
    closeModal();
    descargarExcelConteo();
  };
}

function mostrarOpcionesDescarga() {
  const modalContainer = getModalContainerEl();
  if (!modalContainer) return;

  modalContainer.style.display = 'flex';
  modalContainer.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:28px 24px;width:95vw;max-width:420px;text-align:center;">
      <h2 style="margin-top:0;margin-bottom:15px;color:#1e293b;">Descargar Inventario</h2>
      <p style="margin-top:0;margin-bottom:22px;color:#475569;">Elige el formato del reporte.</p>
      <div style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap;">
        <button id="btnDescargarInventarioExcel" style="background:#107c41;color:white;border:none;padding:12px 18px;border-radius:8px;font-size:1em;font-weight:600;cursor:pointer;">Excel</button>
        <button id="btnDescargarInventarioPdf" style="background:#b91c1c;color:white;border:none;padding:12px 18px;border-radius:8px;font-size:1em;font-weight:600;cursor:pointer;">PDF</button>
      </div>
      <button onclick="window.closeModal()" style="margin-top:20px;background:none;border:none;color:#64748b;cursor:pointer;">Cancelar</button>
    </div>
  `;

  document.getElementById('btnDescargarInventarioExcel').onclick = () => {
    closeModal();
    descargarExcel();
  };
  document.getElementById('btnDescargarInventarioPdf').onclick = () => {
    closeModal();
    descargarPdf();
  };
}

function descargarExcelConteo() {
  const productosActivos = inventarioProductos.filter((p) => p.activo);
  const dataParaExcel = productosActivos.map((p) => ({
    Producto: p.nombre,
    Codigo: p.codigo_barras || '',
    Categoria: categoriasCache.find((c) => c.id === p.categoria_id)?.nombre || '',
    'Stock Sistema': p.stock_actual,
    'Conteo Fisico': '',
    Diferencia: '',
    Notas: '',
  }));
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(dataParaExcel);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Hoja de Conteo');
  XLSX.writeFile(workbook, `Hoja_Conteo_Inventario_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function descargarExcel() {
  const productosActivos = inventarioProductos.filter((p) => p.activo);
  const dataParaExcel = productosActivos.map((p) => ({
    Nombre: p.nombre,
    Codigo: p.codigo_barras || 'N/A',
    Categoria: categoriasCache.find((c) => c.id === p.categoria_id)?.nombre || 'N/A',
    'Stock Actual': p.stock_actual,
    'Precio Compra': p.precio,
    'Precio Venta': p.precio_venta,
  }));
  const worksheet = XLSX.utils.json_to_sheet(dataParaExcel);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventario');
  XLSX.writeFile(workbook, `Reporte_Inventario_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function descargarPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const productosActivos = inventarioProductos.filter((p) => p.activo);
  const fecha = new Date().toLocaleString('es-CO');

  doc.setFontSize(18);
  doc.text('Reporte de Inventario Activo', 14, 22);
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Generado el: ${fecha}`, 14, 30);

  const tableRows = productosActivos.map((p) => [
    p.nombre,
    p.codigo_barras || 'N/A',
    categoriasCache.find((c) => c.id === p.categoria_id)?.nombre || 'N/A',
    String(p.stock_actual ?? 0),
    formatCurrency(p.precio_venta),
  ]);

  doc.autoTable({
    head: [['Nombre', 'Codigo', 'Categoria', 'Stock', 'Precio Venta']],
    body: tableRows,
    startY: 35,
    theme: 'grid',
  });

  doc.save(`Reporte_Inventario_${new Date().toISOString().slice(0, 10)}.pdf`);
}

function imprimirHojaDeConteo() {
  const productosActivos = inventarioProductos.filter((p) => p.activo);
  const fechaActual = new Date().toLocaleString('es-CO');
  let contenido = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Hoja de Conteo</title>
        <style>
          body { font-family: Arial, sans-serif; }
          h1 { color: #1d4ed8; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
          th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
          th { background-color: #f3f4f6; }
        </style>
      </head>
      <body>
        <h1>Hoja de Conteo de Inventario</h1>
        <p>Generado el: ${fechaActual}</p>
        <table>
          <thead><tr><th>Producto</th><th>Codigo</th><th>Categoria</th><th>Stock Sistema</th><th>Conteo Fisico</th><th>Diferencia</th><th>Notas</th></tr></thead>
          <tbody>
            ${productosActivos.map((p) => `<tr><td>${p.nombre}</td><td>${p.codigo_barras || ''}</td><td>${categoriasCache.find((c) => c.id === p.categoria_id)?.nombre || ''}</td><td>${p.stock_actual}</td><td></td><td></td><td></td></tr>`).join('')}
          </tbody>
        </table>
      </body>
    </html>
  `;
  const ventanaImpresion = window.open('', '_blank');
  ventanaImpresion.document.write(contenido);
  ventanaImpresion.document.close();
  ventanaImpresion.focus();
  ventanaImpresion.print();
  ventanaImpresion.close();
}

export function resetInventarioState() {
  inventarioProductos = [];
  categoriasCache = [];
  proveedoresCache = [];
}
