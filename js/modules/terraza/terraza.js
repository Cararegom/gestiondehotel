import { registrarEnBitacora } from '../../services/bitacoraservice.js';
import { turnoService } from '../../services/turnoService.js';
import { imprimirTicketOperacion } from '../../services/thermalPrintService.js';
import { formatCurrency } from '../../uiUtils.js';
import { escapeAttribute, escapeHtml } from '../../security.js';

const TERRAZA_HOTEL_ID = '38373fa5-b953-4aa9-b4e9-25b9739be5f2';

let state = {
  container: null,
  supabase: null,
  user: null,
  hotelId: null,
  mesas: [],
  productos: [],
  tiendaProductos: [],
  metodosPago: [],
  pedidosAbiertos: [],
  historial: [],
  selectedMesaId: null,
  selectedSillaNumero: null,
  editingProductId: null,
  activeTab: 'mapa',
  loading: false
};

let moduleListeners = [];

function addListener(element, type, handler) {
  if (!element) return;
  element.addEventListener(type, handler);
  moduleListeners.push({ element, type, handler });
}

function money(value) {
  return formatCurrency(Number(value || 0));
}

function formatDate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

function showFeedback(message, type = 'info', duration = 4500) {
  const feedbackEl = state.container?.querySelector('#terraza-feedback');
  if (!feedbackEl) return;
  const palette = {
    success: 'bg-green-100 border-green-300 text-green-800',
    error: 'bg-red-100 border-red-300 text-red-800',
    warning: 'bg-yellow-100 border-yellow-300 text-yellow-800',
    info: 'bg-blue-100 border-blue-300 text-blue-800'
  };
  feedbackEl.textContent = message;
  feedbackEl.className = `feedback-message rounded-lg border p-3 text-sm ${palette[type] || palette.info}`;
  feedbackEl.style.display = 'block';
  if (duration > 0) {
    window.setTimeout(() => {
      if (feedbackEl.textContent === message) {
        feedbackEl.style.display = 'none';
        feedbackEl.textContent = '';
      }
    }, duration);
  }
}

function setLoading(isLoading, message = 'Cargando terraza...') {
  state.loading = isLoading;
  const loadingEl = state.container?.querySelector('#terraza-loading');
  if (!loadingEl) return;
  loadingEl.textContent = message;
  loadingEl.style.display = isLoading ? 'block' : 'none';
}

async function confirmDialog(title, text, confirmButtonText = 'Confirmar') {
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

function getPedidoItems(pedido) {
  return pedido?.items || pedido?.terraza_pedido_items || [];
}

function getMesaById(mesaId) {
  return state.mesas.find((mesa) => mesa.id === mesaId) || null;
}

function normalizeTextKey(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isLooseChairGroup(mesa) {
  if (!mesa) return false;
  const tipoKey = normalizeTextKey(mesa.tipo);
  const nombreKey = normalizeTextKey(mesa.nombre);
  return tipoKey === 'sillassueltas' || nombreKey.includes('sillassueltas');
}

function getMesasNormales() {
  return state.mesas.filter((mesa) => !isLooseChairGroup(mesa));
}

function getSillasSueltasGroup() {
  return state.mesas.find(isLooseChairGroup) || null;
}

function normalizeSilla(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isSameLocation(pedido, mesaId, sillaNumero) {
  return pedido?.mesa_id === mesaId && normalizeSilla(pedido?.silla_numero) === normalizeSilla(sillaNumero);
}

function getPedidoSeleccionado() {
  return state.pedidosAbiertos.find((pedido) => isSameLocation(pedido, state.selectedMesaId, state.selectedSillaNumero)) || null;
}

function getSelectedLocationLabel() {
  const mesa = getMesaById(state.selectedMesaId);
  if (!mesa) return 'Selecciona una mesa';
  if (isLooseChairGroup(mesa)) {
    return state.selectedSillaNumero ? `Silla suelta ${state.selectedSillaNumero}` : 'Selecciona una silla suelta';
  }
  if (state.selectedSillaNumero) return `${mesa.nombre} - Silla ${state.selectedSillaNumero}`;
  return `${mesa.nombre} - Cuenta de mesa`;
}

function getPedidoLocationLabel(pedido) {
  const mesa = pedido?.mesa || getMesaById(pedido?.mesa_id);
  if (!mesa) return 'Ubicacion no disponible';
  if (isLooseChairGroup(mesa)) {
    return pedido?.silla_numero ? `Silla suelta ${pedido.silla_numero}` : 'Silla suelta';
  }
  return `${mesa.nombre || 'Mesa'}${pedido?.silla_numero ? ` - Silla ${pedido.silla_numero}` : ''}`;
}

function countItems(pedido) {
  return getPedidoItems(pedido).reduce((acc, item) => acc + Number(item.cantidad || 0), 0);
}

function totalPedido(pedido) {
  return Number(pedido?.total || 0);
}

function pedidosPorMesa(mesaId) {
  return state.pedidosAbiertos.filter((pedido) => pedido.mesa_id === mesaId);
}

function getPedidoMesaCompleta(mesaId) {
  return state.pedidosAbiertos.find((pedido) => pedido.mesa_id === mesaId && !pedido.silla_numero) || null;
}

function getPedidoSilla(mesaId, sillaNumero) {
  return state.pedidosAbiertos.find((pedido) => pedido.mesa_id === mesaId && Number(pedido.silla_numero) === Number(sillaNumero)) || null;
}

function getProductosActivos() {
  return state.productos.filter((producto) => producto.activo !== false);
}

function getReservedQuantity(productId) {
  if (!productId) return 0;
  return state.pedidosAbiertos.reduce((acc, pedido) => {
    const cantidadPedido = getPedidoItems(pedido)
      .filter((item) => item.producto_id === productId)
      .reduce((sum, item) => sum + Number(item.cantidad || 0), 0);
    return acc + cantidadPedido;
  }, 0);
}

function getAvailableStock(producto) {
  if (!producto) return 0;
  return Math.max(0, Number(producto.stock_actual || 0) - getReservedQuantity(producto.id));
}

function getStockBadge(producto) {
  if (producto?.activo === false) {
    return {
      label: 'Inactivo',
      className: 'border-slate-200 bg-slate-100 text-slate-500'
    };
  }

  const stock = Number(producto?.stock_actual || 0);
  const disponible = getAvailableStock(producto);
  const minimo = Number(producto?.stock_minimo || 0);

  if (stock <= 0 || disponible <= 0) {
    return {
      label: 'Sin stock',
      className: 'border-red-200 bg-red-50 text-red-700'
    };
  }

  if (stock <= minimo) {
    return {
      label: `Bajo: ${disponible}`,
      className: 'border-amber-200 bg-amber-50 text-amber-800'
    };
  }

  return {
    label: `Disp. ${disponible}`,
    className: 'border-green-200 bg-green-50 text-green-700'
  };
}

function getProductoById(productId) {
  return state.productos.find((producto) => producto.id === productId) || null;
}

function getTiendaProductoNombre(producto) {
  if (!producto?.tienda_producto_id) return 'Sin enlace';
  return state.tiendaProductos.find((item) => item.id === producto.tienda_producto_id)?.nombre || 'Producto enlazado';
}

async function cargarDatos() {
  const [mesasResult, productosResult, tiendaProductosResult, metodosResult, pedidosResult, historialResult] = await Promise.all([
    state.supabase
      .from('terraza_mesas')
      .select('*')
      .eq('hotel_id', state.hotelId)
      .eq('activo', true)
      .order('numero', { ascending: true }),
    state.supabase
      .from('terraza_productos')
      .select('*')
      .eq('hotel_id', state.hotelId)
      .order('categoria', { ascending: true })
      .order('nombre', { ascending: true }),
    state.supabase
      .from('productos_tienda')
      .select('id, nombre, descripcion, codigo_barras, precio, precio_venta, stock_actual, stock_minimo, imagen_url, activo')
      .eq('hotel_id', state.hotelId)
      .eq('activo', true)
      .order('nombre', { ascending: true }),
    state.supabase
      .from('metodos_pago')
      .select('id, nombre')
      .eq('hotel_id', state.hotelId)
      .eq('activo', true)
      .order('nombre', { ascending: true }),
    state.supabase
      .from('terraza_pedidos')
      .select('*, mesa:terraza_mesas(id, numero, nombre, sillas, tipo), items:terraza_pedido_items(*)')
      .eq('hotel_id', state.hotelId)
      .eq('estado', 'abierto')
      .order('creado_en', { ascending: true }),
    state.supabase
      .from('terraza_pedidos')
      .select('*, mesa:terraza_mesas(id, numero, nombre, tipo), metodo:metodos_pago(nombre), items:terraza_pedido_items(*)')
      .eq('hotel_id', state.hotelId)
      .eq('estado', 'pagado')
      .order('fecha_cierre', { ascending: false })
      .limit(12)
  ]);

  const errors = [mesasResult.error, productosResult.error, tiendaProductosResult.error, metodosResult.error, pedidosResult.error, historialResult.error].filter(Boolean);
  if (errors.length) {
    throw errors[0];
  }

  state.mesas = mesasResult.data || [];
  state.productos = productosResult.data || [];
  state.tiendaProductos = tiendaProductosResult.data || [];
  state.metodosPago = metodosResult.data || [];
  state.pedidosAbiertos = pedidosResult.data || [];
  state.historial = historialResult.data || [];

  const selectedExists = state.selectedMesaId && state.mesas.some((mesa) => mesa.id === state.selectedMesaId);
  if (!selectedExists && state.mesas.length) {
    state.selectedMesaId = (getMesasNormales()[0] || state.mesas[0]).id;
    state.selectedSillaNumero = null;
  }
}

async function refreshAndRender() {
  setLoading(true);
  try {
    await cargarDatos();
    render();
  } catch (error) {
    console.error('[Terraza] Error cargando datos:', error);
    renderError(`No se pudo cargar Terraza. Verifica que la migracion 20260619120000_terraza_module.sql este aplicada. Detalle: ${error.message}`);
  } finally {
    setLoading(false);
  }
}

function renderError(message) {
  if (!state.container) return;
  state.container.innerHTML = `
    <div class="p-6">
      <div class="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">
        <h2 class="mb-2 text-xl font-bold">Terraza no disponible</h2>
        <p class="text-sm">${escapeHtml(message)}</p>
      </div>
    </div>
  `;
}

function renderMesas() {
  const mesasNormales = getMesasNormales();

  if (!mesasNormales.length) {
    return '<div class="rounded-xl border border-slate-200 bg-white p-5 text-center text-slate-500">No hay mesas configuradas.</div>';
  }

  return mesasNormales.map((mesa) => {
    const pedidos = pedidosPorMesa(mesa.id);
    const total = pedidos.reduce((acc, pedido) => acc + totalPedido(pedido), 0);
    const mesaCompleta = getPedidoMesaCompleta(mesa.id);
    const isMesaSelected = state.selectedMesaId === mesa.id && !state.selectedSillaNumero;
    const seats = Array.from({ length: Number(mesa.sillas || 2) }, (_, index) => index + 1);
    const estadoLabel = pedidos.length ? 'Con consumo' : 'Libre';
    const estadoClass = pedidos.length ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-green-100 text-green-700 border-green-200';
    const mesaClass = isMesaSelected
      ? 'border-blue-600 bg-blue-600 text-white shadow-lg'
      : mesaCompleta
        ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
        : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50';

    const renderSilla = (seat) => {
      const pedidoSilla = getPedidoSilla(mesa.id, seat);
      const isSelected = state.selectedMesaId === mesa.id && Number(state.selectedSillaNumero) === seat;
      const hasOrder = Boolean(pedidoSilla);
      const sillaClass = isSelected
        ? 'border-blue-600 bg-blue-600 text-white shadow-md'
        : hasOrder
          ? 'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200'
          : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50';

      return `
        <button
          class="flex h-10 items-center justify-center rounded-lg border text-xs font-extrabold transition ${sillaClass}"
          data-action="select-location"
          data-mesa-id="${escapeAttribute(mesa.id)}"
          data-silla="${seat}"
          title="Silla ${seat}${hasOrder ? ` - ${money(totalPedido(pedidoSilla))}` : ''}"
        >
          ${seat}
        </button>
      `;
    };

    return `
      <article class="rounded-xl border ${state.selectedMesaId === mesa.id ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'} p-4 shadow-sm transition hover:shadow-md">
        <div class="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 class="text-base font-bold text-slate-800">${escapeHtml(mesa.nombre)}</h3>
            <p class="text-xs text-slate-500">2 sillas | ${pedidos.length} cuenta(s) abiertas</p>
          </div>
          <span class="rounded-full border px-2.5 py-1 text-xs font-bold ${estadoClass}">${estadoLabel}</span>
        </div>

        <div class="grid grid-cols-[64px_1fr_64px] items-center gap-3">
          <div>${seats[0] ? renderSilla(seats[0]) : ''}</div>
          <button
            class="min-h-[128px] rounded-2xl border-2 p-4 text-center transition ${mesaClass}"
            data-action="select-location"
            data-mesa-id="${escapeAttribute(mesa.id)}"
          >
            <span class="block text-xs font-bold uppercase tracking-wide opacity-75">Mesa completa</span>
            <span class="mt-1 block text-2xl font-black">${escapeHtml(String(mesa.numero || ''))}</span>
            <span class="mt-2 block text-sm font-bold">${mesaCompleta ? money(totalPedido(mesaCompleta)) : 'Sin cuenta general'}</span>
          </button>
          <div>${seats[1] ? renderSilla(seats[1]) : ''}</div>
        </div>

        <div class="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
          <span class="text-xs font-semibold text-slate-500">Total pendiente</span>
          <span class="text-base font-extrabold text-blue-700">${money(total)}</span>
        </div>
      </article>
    `;
  }).join('');
}

function renderSillasSueltas() {
  const grupo = getSillasSueltasGroup();
  if (!grupo) return '';

  const pedidos = pedidosPorMesa(grupo.id);
  const total = pedidos.reduce((acc, pedido) => acc + totalPedido(pedido), 0);
  const seats = Array.from({ length: Number(grupo.sillas || 12) }, (_, index) => index + 1);

  return `
    <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div class="mb-3 flex flex-col justify-between gap-2 md:flex-row md:items-start">
        <div>
          <h3 class="text-base font-bold text-slate-800">Sillas sueltas</h3>
          <p class="text-xs text-slate-500">12 sillas independientes, sin mesa asignada.</p>
        </div>
        <div class="text-left md:text-right">
          <div class="text-xs font-semibold text-slate-500">Total sillas sueltas</div>
          <div class="font-extrabold text-blue-700">${money(total)}</div>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        ${seats.map((seat) => {
          const pedidoSilla = getPedidoSilla(grupo.id, seat);
          const isSelected = state.selectedMesaId === grupo.id && Number(state.selectedSillaNumero) === seat;
          const hasOrder = Boolean(pedidoSilla);
          const sillaClass = isSelected
            ? 'border-blue-600 bg-blue-600 text-white shadow-md'
            : hasOrder
              ? 'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200'
              : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50';

          return `
            <button
              class="min-h-[58px] rounded-lg border px-2 py-2 text-xs font-extrabold transition ${sillaClass}"
              data-action="select-location"
              data-mesa-id="${escapeAttribute(grupo.id)}"
              data-silla="${seat}"
              title="Silla suelta ${seat}${hasOrder ? ` - ${money(totalPedido(pedidoSilla))}` : ''}"
            >
              <span class="block text-[10px] font-semibold uppercase opacity-70">Silla</span>
              ${seat}
            </button>
          `;
        }).join('')}
      </div>
    </article>
  `;
}

function renderProductos() {
  const productosActivos = getProductosActivos();

  if (!productosActivos.length) {
    return '<div class="rounded-xl border border-slate-200 bg-white p-5 text-center text-slate-500">No hay bebidas activas para vender.</div>';
  }

  const categorias = [...new Set(productosActivos.map((producto) => producto.categoria || 'Bebidas'))];

  return categorias.map((categoria) => {
    const productos = productosActivos.filter((producto) => (producto.categoria || 'Bebidas') === categoria);
    return `
      <section class="mb-5">
        <h3 class="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">${escapeHtml(categoria)}</h3>
        <div class="grid grid-cols-1 gap-3">
          ${productos.map((producto) => {
            const disponible = getAvailableStock(producto);
            const disabled = disponible <= 0 || Number(producto.precio || 0) <= 0;
            const stockBadge = getStockBadge(producto);
            return `
            <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div class="flex min-h-[72px] flex-col justify-between">
                <div>
                  <div class="flex items-start justify-between gap-3">
                    <h4 class="font-bold text-slate-800">${escapeHtml(producto.nombre)}</h4>
                    <span class="rounded-full border px-2 py-0.5 text-[11px] font-bold ${stockBadge.className}">${escapeHtml(stockBadge.label)}</span>
                  </div>
                  <p class="mt-1 text-xs text-slate-500">${escapeHtml(producto.descripcion || '')}</p>
                </div>
                <div class="mt-3 flex items-center justify-between gap-3">
                  <span class="text-lg font-extrabold text-blue-700">${money(producto.precio)}</span>
                  <div class="flex gap-2">
                    <button class="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50" data-action="edit-product" data-product-id="${escapeAttribute(producto.id)}">Editar</button>
                    <button class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300" data-action="add-product" data-product-id="${escapeAttribute(producto.id)}" ${disabled ? 'disabled' : ''}>Agregar</button>
                  </div>
                </div>
              </div>
            </article>
          `;
          }).join('')}
        </div>
      </section>
    `;
  }).join('');
}

function renderPedido() {
  const pedido = getPedidoSeleccionado();
  const items = getPedidoItems(pedido);
  const selectedMesa = getMesaById(state.selectedMesaId);
  const isSillaSuelta = isLooseChairGroup(selectedMesa);
  const disabled = !pedido || !items.length;

  return `
    <aside class="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="border-b border-slate-200 p-4">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Cuenta seleccionada</p>
        <h3 class="mt-1 text-xl font-extrabold text-slate-800">${escapeHtml(getSelectedLocationLabel())}</h3>
        ${selectedMesa ? `<p class="mt-1 text-xs text-slate-500">${isSillaSuelta ? 'Cuenta independiente para una silla suelta.' : 'Puedes cobrar mesa completa o una silla individual.'}</p>` : ''}
      </div>
      <div class="max-h-[45vh] overflow-y-auto p-4">
        ${items.length ? `
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs uppercase text-slate-500">
                <th class="pb-2">Producto</th>
                <th class="pb-2 text-center">Cant.</th>
                <th class="pb-2 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${items.map((item) => `
                <tr>
                  <td class="py-3">
                    <div class="font-semibold text-slate-800">${escapeHtml(item.producto_nombre)}</div>
                    <div class="text-xs text-slate-500">${money(item.precio_unitario)}</div>
                  </td>
                  <td class="py-3 text-center">
                    <div class="inline-flex items-center rounded-lg border border-slate-200">
                      <button class="px-2 py-1 text-slate-500 hover:bg-slate-50" data-action="decrease-item" data-item-id="${escapeAttribute(item.id)}">-</button>
                      <span class="min-w-[28px] px-2 font-bold">${escapeHtml(item.cantidad)}</span>
                      <button class="px-2 py-1 text-slate-500 hover:bg-slate-50" data-action="increase-item" data-item-id="${escapeAttribute(item.id)}">+</button>
                    </div>
                    <button class="mt-1 block w-full text-xs font-semibold text-red-600 hover:underline" data-action="remove-item" data-item-id="${escapeAttribute(item.id)}">Quitar</button>
                  </td>
                  <td class="py-3 text-right font-bold text-slate-800">${money(item.subtotal)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<div class="rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">Agrega bebidas a esta ubicacion.</div>'}
      </div>
      <div class="border-t border-slate-200 p-4">
        <div class="mb-4 flex items-center justify-between">
          <span class="text-sm font-semibold text-slate-600">Total</span>
          <span class="text-3xl font-extrabold text-blue-700">${money(totalPedido(pedido))}</span>
        </div>
        <label class="mb-1 block text-xs font-semibold uppercase text-slate-500" for="terraza-metodo-pago">Metodo de pago</label>
        <select id="terraza-metodo-pago" class="form-control mb-3 w-full" ${disabled ? 'disabled' : ''}>
          <option value="">Selecciona metodo</option>
          ${state.metodosPago.map((metodo) => `<option value="${escapeAttribute(metodo.id)}">${escapeHtml(metodo.nombre)}</option>`).join('')}
        </select>
        <div class="grid grid-cols-2 gap-2">
          <button class="button button-danger w-full" data-action="cancel-order" ${disabled ? 'disabled' : ''}>Cancelar</button>
          <button class="button button-success w-full" data-action="pay-order" ${disabled ? 'disabled' : ''}>Cobrar</button>
        </div>
      </div>
    </aside>
  `;
}

function renderCatalogForm() {
  const product = state.editingProductId
    ? state.productos.find((item) => item.id === state.editingProductId)
    : null;

  return `
    <form id="terraza-product-form" class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 class="text-base font-bold text-slate-800">${product ? 'Editar producto de terraza' : 'Nuevo producto de terraza'}</h3>
          <p class="text-xs text-slate-500">Define precio, stock y estado para vender en el mapa.</p>
        </div>
        ${product ? '<button type="button" class="text-sm font-semibold text-slate-500 hover:text-slate-800" data-action="cancel-product-edit">Cancelar</button>' : ''}
      </div>
      <input type="hidden" name="productId" value="${escapeAttribute(product?.id || '')}">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label class="form-label text-xs">Nombre</label>
          <input name="nombre" class="form-control" required value="${escapeAttribute(product?.nombre || '')}" placeholder="Ej: Michelada">
        </div>
        <div>
          <label class="form-label text-xs">Categoria</label>
          <input name="categoria" class="form-control" required value="${escapeAttribute(product?.categoria || 'Bebidas')}" placeholder="Cervezas">
        </div>
        <div>
          <label class="form-label text-xs">Precio</label>
          <input name="precio" type="number" min="0" step="100" class="form-control" required value="${escapeAttribute(product?.precio ?? '')}" placeholder="0">
        </div>
      </div>

      <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div>
          <label class="form-label text-xs">Stock actual</label>
          <input name="stock_actual" type="number" min="0" step="1" class="form-control" required value="${escapeAttribute(product?.stock_actual ?? 0)}">
        </div>
        <div>
          <label class="form-label text-xs">Stock minimo</label>
          <input name="stock_minimo" type="number" min="0" step="1" class="form-control" value="${escapeAttribute(product?.stock_minimo ?? 0)}">
        </div>
        <div>
          <label class="form-label text-xs">Codigo de barras</label>
          <input name="codigo_barras" class="form-control" value="${escapeAttribute(product?.codigo_barras || '')}" placeholder="Opcional">
        </div>
        <label class="flex items-end gap-2 pb-2 text-sm font-semibold text-slate-700">
          <input name="activo" type="checkbox" class="h-4 w-4" ${product?.activo === false ? '' : 'checked'}>
          Activo para ventas
        </label>
      </div>

      <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div class="md:col-span-3">
          <label class="form-label text-xs">Descripcion opcional</label>
          <input name="descripcion" class="form-control" value="${escapeAttribute(product?.descripcion || '')}" placeholder="Detalle para el equipo">
        </div>
        <div class="flex items-end">
          <button class="button button-primary w-full" type="submit">${product ? 'Guardar' : 'Crear'}</button>
        </div>
      </div>
    </form>
  `;
}

function renderTransferForms() {
  const tiendaConStock = state.tiendaProductos.filter((producto) => Number(producto.stock_actual || 0) > 0);
  const terrazaConStock = state.productos.filter((producto) => getAvailableStock(producto) > 0);

  return `
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <form id="terraza-transfer-tienda-form" class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="mb-3">
          <h3 class="font-bold text-slate-800">Pasar de Tienda a Terraza</h3>
          <p class="text-xs text-slate-500">Descuenta stock de Tienda y lo suma al inventario de Terraza.</p>
        </div>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px_auto]">
          <div>
            <label class="form-label text-xs">Producto de Tienda</label>
            <select name="producto_tienda_id" class="form-control" required ${tiendaConStock.length ? '' : 'disabled'}>
              <option value="">Selecciona producto</option>
              ${tiendaConStock.map((producto) => `
                <option value="${escapeAttribute(producto.id)}">
                  ${escapeHtml(producto.nombre)} - stock ${escapeHtml(String(producto.stock_actual || 0))}
                </option>
              `).join('')}
            </select>
          </div>
          <div>
            <label class="form-label text-xs">Cantidad</label>
            <input name="cantidad" type="number" min="1" step="1" class="form-control" required value="1" ${tiendaConStock.length ? '' : 'disabled'}>
          </div>
          <div class="flex items-end">
            <button class="button button-primary w-full" type="submit" ${tiendaConStock.length ? '' : 'disabled'}>Transferir</button>
          </div>
        </div>
      </form>

      <form id="terraza-transfer-terraza-form" class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="mb-3">
          <h3 class="font-bold text-slate-800">Devolver de Terraza a Tienda</h3>
          <p class="text-xs text-slate-500">Mueve unidades disponibles de Terraza hacia Tienda.</p>
        </div>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px_auto]">
          <div>
            <label class="form-label text-xs">Producto de Terraza</label>
            <select name="producto_terraza_id" class="form-control" required ${terrazaConStock.length ? '' : 'disabled'}>
              <option value="">Selecciona producto</option>
              ${terrazaConStock.map((producto) => `
                <option value="${escapeAttribute(producto.id)}">
                  ${escapeHtml(producto.nombre)} - disponible ${escapeHtml(String(getAvailableStock(producto)))}
                </option>
              `).join('')}
            </select>
          </div>
          <div>
            <label class="form-label text-xs">Cantidad</label>
            <input name="cantidad" type="number" min="1" step="1" class="form-control" required value="1" ${terrazaConStock.length ? '' : 'disabled'}>
          </div>
          <div class="flex items-end">
            <button class="button button-outline w-full" type="submit" ${terrazaConStock.length ? '' : 'disabled'}>Enviar</button>
          </div>
        </div>
      </form>
    </div>
  `;
}

function renderInventarioTable() {
  if (!state.productos.length) {
    return '<div class="rounded-xl border border-slate-200 bg-white p-5 text-center text-slate-500">Aun no hay inventario de Terraza.</div>';
  }

  return `
    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="border-b border-slate-200 p-4">
        <h3 class="font-bold text-slate-800">Inventario de Terraza</h3>
        <p class="text-xs text-slate-500">El stock disponible descuenta las unidades en cuentas abiertas.</p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[900px] text-sm">
          <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th class="px-4 py-3">Producto</th>
              <th class="px-4 py-3">Categoria</th>
              <th class="px-4 py-3 text-right">Precio</th>
              <th class="px-4 py-3 text-center">Stock</th>
              <th class="px-4 py-3 text-center">Reservado</th>
              <th class="px-4 py-3 text-center">Disponible</th>
              <th class="px-4 py-3">Tienda</th>
              <th class="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${state.productos.map((producto) => {
              const reservado = getReservedQuantity(producto.id);
              const disponible = getAvailableStock(producto);
              const bajo = Number(producto.stock_actual || 0) <= Number(producto.stock_minimo || 0);
              return `
                <tr class="${producto.activo === false ? 'bg-slate-50 text-slate-500' : 'bg-white'}">
                  <td class="px-4 py-3">
                    <div class="font-bold text-slate-800">${escapeHtml(producto.nombre)}</div>
                    <div class="text-xs text-slate-500">${escapeHtml(producto.codigo_barras || 'Sin codigo')}</div>
                  </td>
                  <td class="px-4 py-3">${escapeHtml(producto.categoria || 'Bebidas')}</td>
                  <td class="px-4 py-3 text-right font-semibold">${money(producto.precio)}</td>
                  <td class="px-4 py-3 text-center font-bold ${bajo ? 'text-amber-700' : 'text-slate-800'}">${escapeHtml(String(producto.stock_actual || 0))}</td>
                  <td class="px-4 py-3 text-center">${escapeHtml(String(reservado))}</td>
                  <td class="px-4 py-3 text-center font-bold ${disponible <= 0 ? 'text-red-600' : 'text-green-700'}">${escapeHtml(String(disponible))}</td>
                  <td class="px-4 py-3 text-xs text-slate-500">${escapeHtml(getTiendaProductoNombre(producto))}</td>
                  <td class="px-4 py-3 text-right">
                    <div class="inline-flex gap-2">
                      <button class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50" data-action="edit-product" data-product-id="${escapeAttribute(producto.id)}">Editar</button>
                      <button class="rounded-lg border px-3 py-1.5 text-xs font-semibold ${producto.activo === false ? 'border-green-200 text-green-700 hover:bg-green-50' : 'border-red-200 text-red-700 hover:bg-red-50'}" data-action="toggle-product-active" data-product-id="${escapeAttribute(producto.id)}" data-active="${producto.activo === false ? 'true' : 'false'}">
                        ${producto.activo === false ? 'Activar' : 'Pausar'}
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderHistorial() {
  if (!state.historial.length) {
    return '<div class="rounded-xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500">Aun no hay cuentas cobradas.</div>';
  }

  return `
    <div class="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="border-b border-slate-200 p-4">
        <h3 class="font-bold text-slate-800">Ultimas cuentas cobradas</h3>
      </div>
      <div class="divide-y divide-slate-100">
        ${state.historial.map((pedido) => `
          <div class="flex items-center justify-between gap-3 p-4 text-sm">
            <div>
              <div class="font-semibold text-slate-800">
                ${escapeHtml(getPedidoLocationLabel(pedido))}
              </div>
              <div class="text-xs text-slate-500">${formatDate(pedido.fecha_cierre)} - ${escapeHtml(pedido.metodo?.nombre || 'Metodo')}</div>
            </div>
            <div class="text-right">
              <div class="font-bold text-blue-700">${money(pedido.total)}</div>
              <div class="text-xs text-slate-500">${countItems(pedido)} item(s)</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderStats() {
  const cuentas = state.pedidosAbiertos.length;
  const totalAbierto = state.pedidosAbiertos.reduce((acc, pedido) => acc + totalPedido(pedido), 0);
  const puestosOcupados = state.pedidosAbiertos.filter((pedido) => pedido.silla_numero).length;
  const productosBajos = state.productos.filter((producto) => producto.activo !== false && Number(producto.stock_actual || 0) <= Number(producto.stock_minimo || 0)).length;

  return `
    <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="text-xs font-semibold uppercase text-slate-500">Cuentas abiertas</div>
        <div class="mt-1 text-2xl font-extrabold text-slate-900">${cuentas}</div>
      </div>
      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="text-xs font-semibold uppercase text-slate-500">Total pendiente</div>
        <div class="mt-1 text-2xl font-extrabold text-blue-700">${money(totalAbierto)}</div>
      </div>
      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="text-xs font-semibold uppercase text-slate-500">Puestos con consumo</div>
        <div class="mt-1 text-2xl font-extrabold text-slate-900">${puestosOcupados}</div>
      </div>
      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="text-xs font-semibold uppercase text-slate-500">Stock bajo</div>
        <div class="mt-1 text-2xl font-extrabold ${productosBajos ? 'text-amber-700' : 'text-slate-900'}">${productosBajos}</div>
      </div>
    </div>
  `;
}

function renderTabNav() {
  const tabs = [
    { id: 'mapa', label: 'Mapa' },
    { id: 'inventario', label: 'Inventario' },
    { id: 'historial', label: 'Historial' }
  ];

  return `
    <div class="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      ${tabs.map((tab) => `
        <button
          class="rounded-lg px-4 py-2 text-sm font-bold transition ${state.activeTab === tab.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}"
          data-action="switch-tab"
          data-tab="${escapeAttribute(tab.id)}"
        >
          ${escapeHtml(tab.label)}
        </button>
      `).join('')}
    </div>
  `;
}

function renderMapaTab() {
  const mesasNormales = getMesasNormales();

  return `
    ${renderStats()}
    <div class="grid grid-cols-1 gap-5 xl:grid-cols-12">
      <div class="space-y-4 xl:col-span-8">
        <div class="flex flex-col justify-between gap-2 md:flex-row md:items-center">
          <div>
            <h2 class="text-lg font-bold text-slate-800">Mapa de mesas y sillas</h2>
            <p class="text-sm text-slate-500">5 mesas de 2 sillas y 12 sillas sueltas independientes.</p>
          </div>
          <span class="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700">${mesasNormales.length} mesas | 12 sillas sueltas</span>
        </div>
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">${renderMesas()}</div>
        ${renderSillasSueltas()}
      </div>

      <div class="space-y-4 xl:col-span-4">
        ${renderPedido()}
        <section class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 class="text-lg font-bold text-slate-800">Bebidas y tragos</h2>
              <p class="text-xs text-slate-500">${getProductosActivos().length} activos para venta</p>
            </div>
            <button class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50" data-action="switch-tab" data-tab="inventario">Inventario</button>
          </div>
          <div class="max-h-[58vh] overflow-y-auto pr-1">${renderProductos()}</div>
        </section>
      </div>
    </div>
  `;
}

function renderInventarioTab() {
  return `
    <div class="space-y-4">
      ${renderStats()}
      ${renderTransferForms()}
      ${renderCatalogForm()}
      ${renderInventarioTable()}
    </div>
  `;
}

function renderHistorialTab() {
  return `
    <div class="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div class="xl:col-span-2">${renderHistorial()}</div>
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

function renderActiveTab() {
  if (state.activeTab === 'inventario') return renderInventarioTab();
  if (state.activeTab === 'historial') return renderHistorialTab();
  return renderMapaTab();
}

function render() {
  if (!state.container) return;

  state.container.innerHTML = `
    <section class="terraza-module min-h-screen bg-slate-100 p-4 lg:p-6">
      <div class="mx-auto max-w-[1600px] space-y-5">
        <header class="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center">
          <div>
            <p class="text-xs font-bold uppercase tracking-wide text-blue-600">Modulo exclusivo</p>
            <h1 class="text-2xl font-extrabold text-slate-900">Terraza</h1>
            <p class="mt-1 text-sm text-slate-500">Controla consumos por mesa, por silla de mesa o por silla suelta.</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            ${renderTabNav()}
            <button class="button button-outline" data-action="refresh">Actualizar</button>
          </div>
        </header>

        <div id="terraza-feedback" style="display:none;"></div>
        <div id="terraza-loading" class="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-800" style="display:none;">Cargando terraza...</div>

        ${renderActiveTab()}
      </div>
    </section>
  `;
}

async function ensurePedidoAbierto() {
  if (!state.selectedMesaId) {
    throw new Error('Selecciona una mesa o silla antes de agregar productos.');
  }

  const selectedMesa = getMesaById(state.selectedMesaId);
  if (isLooseChairGroup(selectedMesa) && !state.selectedSillaNumero) {
    throw new Error('Selecciona una silla suelta antes de agregar productos.');
  }

  const existing = getPedidoSeleccionado();
  if (existing) return existing;

  const payload = {
    hotel_id: state.hotelId,
    mesa_id: state.selectedMesaId,
    silla_numero: state.selectedSillaNumero,
    usuario_id: state.user.id,
    estado: 'abierto'
  };

  const { data, error } = await state.supabase
    .from('terraza_pedidos')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    let fallbackQuery = state.supabase
      .from('terraza_pedidos')
      .select('*')
      .eq('hotel_id', state.hotelId)
      .eq('mesa_id', state.selectedMesaId)
      .eq('estado', 'abierto');

    fallbackQuery = state.selectedSillaNumero
      ? fallbackQuery.eq('silla_numero', state.selectedSillaNumero)
      : fallbackQuery.is('silla_numero', null);

    const { data: fallback, error: fallbackError } = await fallbackQuery.maybeSingle();

    if (fallbackError || !fallback) throw error;
    return fallback;
  }

  return data;
}

async function addProductToSelectedOrder(productId) {
  const product = state.productos.find((item) => item.id === productId);
  if (!product) throw new Error('Producto no encontrado.');
  if (product.activo === false) {
    throw new Error('Este producto esta inactivo para ventas.');
  }
  if (Number(product.precio || 0) <= 0) {
    throw new Error('Configura el precio de esta bebida antes de venderla.');
  }
  if (getAvailableStock(product) <= 0) {
    throw new Error(`No hay stock disponible de ${product.nombre}. Revisa inventario o transfiere unidades desde Tienda.`);
  }

  const pedido = await ensurePedidoAbierto();
  const pedidoCompleto = state.pedidosAbiertos.find((item) => item.id === pedido.id) || pedido;
  const existingItem = getPedidoItems(pedidoCompleto).find((item) => item.producto_id === product.id);

  if (existingItem) {
    const nuevaCantidad = Number(existingItem.cantidad || 0) + 1;
    const { error } = await state.supabase
      .from('terraza_pedido_items')
      .update({
        cantidad: nuevaCantidad,
        precio_unitario: Number(product.precio || 0),
        subtotal: nuevaCantidad * Number(product.precio || 0)
      })
      .eq('id', existingItem.id);
    if (error) throw error;
  } else {
    const { error } = await state.supabase.from('terraza_pedido_items').insert({
      pedido_id: pedido.id,
      hotel_id: state.hotelId,
      producto_id: product.id,
      producto_nombre: product.nombre,
      cantidad: 1,
      precio_unitario: Number(product.precio || 0),
      subtotal: Number(product.precio || 0)
    });
    if (error) throw error;
  }

  await refreshAndRender();
  showFeedback(`${product.nombre} agregado a ${getSelectedLocationLabel()}.`, 'success');
}

async function updateItemQuantity(itemId, delta) {
  const pedido = getPedidoSeleccionado();
  const item = getPedidoItems(pedido).find((currentItem) => currentItem.id === itemId);
  if (!item) return;

  const nuevaCantidad = Number(item.cantidad || 0) + delta;
  if (nuevaCantidad <= 0) {
    await removeItem(itemId);
    return;
  }

  if (delta > 0 && item.producto_id) {
    const product = getProductoById(item.producto_id);
    if (product && getAvailableStock(product) <= 0) {
      throw new Error(`No hay mas stock disponible de ${product.nombre}.`);
    }
  }

  const { error } = await state.supabase
    .from('terraza_pedido_items')
    .update({
      cantidad: nuevaCantidad,
      subtotal: nuevaCantidad * Number(item.precio_unitario || 0)
    })
    .eq('id', itemId);
  if (error) throw error;
  await refreshAndRender();
}

async function removeItem(itemId) {
  const { error } = await state.supabase
    .from('terraza_pedido_items')
    .delete()
    .eq('id', itemId);
  if (error) throw error;
  await refreshAndRender();
}

async function cancelSelectedOrder() {
  const pedido = getPedidoSeleccionado();
  if (!pedido) return;
  const confirmed = await confirmDialog('Cancelar cuenta', 'La cuenta abierta se marcara como cancelada y no afectara caja.', 'Si, cancelar');
  if (!confirmed) return;

  const { error } = await state.supabase
    .from('terraza_pedidos')
    .update({ estado: 'cancelado', fecha_cierre: new Date().toISOString() })
    .eq('id', pedido.id);
  if (error) throw error;
  await refreshAndRender();
  showFeedback('Cuenta cancelada.', 'success');
}

async function paySelectedOrder() {
  const pedido = getPedidoSeleccionado();
  if (!pedido || !getPedidoItems(pedido).length) {
    throw new Error('No hay consumos para cobrar.');
  }

  const metodoPagoId = state.container.querySelector('#terraza-metodo-pago')?.value;
  if (!metodoPagoId) {
    throw new Error('Selecciona un metodo de pago.');
  }

  const turno = await turnoService.getTurnoAbierto(state.supabase, state.user.id, state.hotelId);
  if (!turno) {
    throw new Error('No hay un turno de caja abierto. Abre turno en Caja antes de cobrar.');
  }

  const itemsImpresion = getPedidoItems(pedido).map((item) => ({
    nombre: item.producto_nombre,
    cantidad: item.cantidad,
    precio: item.precio_unitario,
    total: item.subtotal
  }));
  const metodo = state.metodosPago.find((item) => item.id === metodoPagoId);
  const total = totalPedido(pedido);
  const label = getSelectedLocationLabel();

  const { data, error } = await state.supabase.rpc('cerrar_pedido_terraza', {
    p_pedido_id: pedido.id,
    p_metodo_pago_id: metodoPagoId,
    p_usuario_id: state.user.id,
    p_turno_id: turno.id
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.message || 'No se pudo cobrar la cuenta.');

  await registrarEnBitacora({
    supabase: state.supabase,
    hotel_id: state.hotelId,
    usuario_id: state.user.id,
    modulo: 'Terraza',
    accion: 'Cobro de cuenta',
    detalles: {
      pedido_id: pedido.id,
      total,
      ubicacion: label
    }
  });

  try {
    await imprimirTicketOperacion({
      supabase: state.supabase,
      hotelId: state.hotelId,
      documentLabel: 'Ticket Terraza',
      reference: pedido.id,
      meta: [{ label: 'Ubicacion', value: label }],
      items: itemsImpresion,
      subtotal: total,
      total,
      payments: [{ label: metodo?.nombre || 'Metodo', amount: total }]
    });
  } catch (printError) {
    console.warn('[Terraza] No se pudo imprimir el ticket:', printError);
  }

  await refreshAndRender();
  showFeedback(`Cuenta cobrada: ${money(total)}.`, 'success');
}

async function saveProduct(form) {
  const formData = new FormData(form);
  const productId = formData.get('productId');
  const nombre = String(formData.get('nombre') || '').trim();
  const categoria = String(formData.get('categoria') || 'Bebidas').trim();
  const descripcion = String(formData.get('descripcion') || '').trim();
  const precio = Number(formData.get('precio') || 0);
  const stockActual = Number(formData.get('stock_actual') || 0);
  const stockMinimo = Number(formData.get('stock_minimo') || 0);
  const codigoBarras = String(formData.get('codigo_barras') || '').trim();
  const activo = formData.get('activo') === 'on';

  if (!nombre) throw new Error('El nombre es obligatorio.');
  if (!categoria) throw new Error('La categoria es obligatoria.');
  if (!Number.isFinite(precio) || precio < 0) throw new Error('El precio no es valido.');
  if (!Number.isInteger(stockActual) || stockActual < 0) throw new Error('El stock actual no es valido.');
  if (!Number.isInteger(stockMinimo) || stockMinimo < 0) throw new Error('El stock minimo no es valido.');

  const payload = {
    hotel_id: state.hotelId,
    nombre,
    categoria,
    descripcion,
    precio,
    stock_actual: stockActual,
    stock_minimo: stockMinimo,
    codigo_barras: codigoBarras || null,
    activo
  };

  if (productId) {
    const { error } = await state.supabase
      .from('terraza_productos')
      .update(payload)
      .eq('id', productId);
    if (error) throw error;
  } else {
    const { error } = await state.supabase
      .from('terraza_productos')
      .insert(payload);
    if (error) throw error;
  }

  state.editingProductId = null;
  await refreshAndRender();
  showFeedback(productId ? 'Bebida actualizada.' : 'Bebida creada.', 'success');
}

async function transferFromTienda(form) {
  const formData = new FormData(form);
  const productoTiendaId = String(formData.get('producto_tienda_id') || '').trim();
  const cantidad = Number(formData.get('cantidad') || 0);

  if (!productoTiendaId) throw new Error('Selecciona un producto de Tienda.');
  if (!Number.isInteger(cantidad) || cantidad <= 0) throw new Error('La cantidad debe ser mayor a cero.');

  const { data, error } = await state.supabase.rpc('transferir_tienda_a_terraza', {
    p_producto_tienda_id: productoTiendaId,
    p_cantidad: cantidad,
    p_usuario_id: state.user.id
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.message || 'No se pudo transferir desde Tienda.');

  state.activeTab = 'inventario';
  await refreshAndRender();
  showFeedback('Inventario transferido desde Tienda a Terraza.', 'success');
}

async function transferToTienda(form) {
  const formData = new FormData(form);
  const productoTerrazaId = String(formData.get('producto_terraza_id') || '').trim();
  const cantidad = Number(formData.get('cantidad') || 0);

  if (!productoTerrazaId) throw new Error('Selecciona un producto de Terraza.');
  if (!Number.isInteger(cantidad) || cantidad <= 0) throw new Error('La cantidad debe ser mayor a cero.');

  const producto = getProductoById(productoTerrazaId);
  if (producto && getAvailableStock(producto) < cantidad) {
    throw new Error(`Solo hay ${getAvailableStock(producto)} unidad(es) disponibles para devolver. Hay unidades reservadas en cuentas abiertas.`);
  }

  const { data, error } = await state.supabase.rpc('transferir_terraza_a_tienda', {
    p_producto_terraza_id: productoTerrazaId,
    p_cantidad: cantidad,
    p_usuario_id: state.user.id
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.message || 'No se pudo transferir hacia Tienda.');

  state.activeTab = 'inventario';
  await refreshAndRender();
  showFeedback('Inventario devuelto desde Terraza a Tienda.', 'success');
}

async function toggleProductActive(productId, active) {
  const { error } = await state.supabase
    .from('terraza_productos')
    .update({ activo: active })
    .eq('id', productId);
  if (error) throw error;

  await refreshAndRender();
  showFeedback(active ? 'Producto activado para ventas.' : 'Producto pausado para ventas.', 'success');
}

async function handleClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;

  const action = button.dataset.action;

  try {
    if (action === 'refresh') {
      await refreshAndRender();
    } else if (action === 'switch-tab') {
      state.activeTab = button.dataset.tab || 'mapa';
      render();
    } else if (action === 'select-location') {
      state.selectedMesaId = button.dataset.mesaId;
      state.selectedSillaNumero = normalizeSilla(button.dataset.silla);
      render();
    } else if (action === 'add-product') {
      await addProductToSelectedOrder(button.dataset.productId);
    } else if (action === 'increase-item') {
      await updateItemQuantity(button.dataset.itemId, 1);
    } else if (action === 'decrease-item') {
      await updateItemQuantity(button.dataset.itemId, -1);
    } else if (action === 'remove-item') {
      await removeItem(button.dataset.itemId);
    } else if (action === 'cancel-order') {
      await cancelSelectedOrder();
    } else if (action === 'pay-order') {
      await paySelectedOrder();
    } else if (action === 'edit-product') {
      state.editingProductId = button.dataset.productId;
      state.activeTab = 'inventario';
      render();
    } else if (action === 'cancel-product-edit') {
      state.editingProductId = null;
      render();
    } else if (action === 'toggle-product-active') {
      await toggleProductActive(button.dataset.productId, button.dataset.active === 'true');
    }
  } catch (error) {
    console.error('[Terraza] Accion fallida:', error);
    showFeedback(error.message || 'No se pudo completar la accion.', 'error', 0);
  }
}

async function handleSubmit(event) {
  const form = event.target.closest('form');
  if (!form) return;

  if (form.id === 'terraza-product-form') {
    event.preventDefault();
    try {
      await saveProduct(form);
    } catch (error) {
      console.error('[Terraza] Error guardando producto:', error);
      showFeedback(error.message || 'No se pudo guardar la bebida.', 'error', 0);
    }
  } else if (form.id === 'terraza-transfer-tienda-form') {
    event.preventDefault();
    try {
      await transferFromTienda(form);
    } catch (error) {
      console.error('[Terraza] Error transfiriendo desde Tienda:', error);
      showFeedback(error.message || 'No se pudo transferir desde Tienda.', 'error', 0);
    }
  } else if (form.id === 'terraza-transfer-terraza-form') {
    event.preventDefault();
    try {
      await transferToTienda(form);
    } catch (error) {
      console.error('[Terraza] Error transfiriendo hacia Tienda:', error);
      showFeedback(error.message || 'No se pudo transferir hacia Tienda.', 'error', 0);
    }
  }
}

export async function mount(container, sbInstance, user, hotelId) {
  unmount(container);

  state = {
    container,
    supabase: sbInstance,
    user,
    hotelId: hotelId || user?.user_metadata?.hotel_id || user?.app_metadata?.hotel_id || null,
    mesas: [],
    productos: [],
    tiendaProductos: [],
    metodosPago: [],
    pedidosAbiertos: [],
    historial: [],
    selectedMesaId: null,
    selectedSillaNumero: null,
    editingProductId: null,
    activeTab: 'mapa',
    loading: false
  };

  if (state.hotelId !== TERRAZA_HOTEL_ID) {
    renderError('Este modulo solo esta habilitado para el hotel autorizado.');
    return;
  }

  container.innerHTML = '<div class="p-8 text-center text-slate-500">Cargando terraza...</div>';
  addListener(container, 'click', handleClick);
  addListener(container, 'submit', handleSubmit);
  await refreshAndRender();
}

export function unmount(container) {
  moduleListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = [];

  if (container) {
    container.innerHTML = '';
  } else if (state.container) {
    state.container.innerHTML = '';
  }

  state = {
    container: null,
    supabase: null,
    user: null,
    hotelId: null,
    mesas: [],
    productos: [],
    tiendaProductos: [],
    metodosPago: [],
    pedidosAbiertos: [],
    historial: [],
    selectedMesaId: null,
    selectedSillaNumero: null,
    editingProductId: null,
    activeTab: 'mapa',
    loading: false
  };
}
