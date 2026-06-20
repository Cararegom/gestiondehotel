import { registrarEnBitacora } from '../../services/bitacoraservice.js';
import { turnoService } from '../../services/turnoService.js';
import { imprimirTicketOperacion } from '../../services/thermalPrintService.js';
import { formatCurrency } from '../../uiUtils.js';
import { escapeAttribute, escapeHtml } from '../../security.js';

const TERRAZA_HOTEL_ID = '38373fa5-b953-4aa9-b4e9-25b9739be5f2';
const DEFAULT_TERRAZA_CONFIG = Object.freeze({
  precio_michelada: 0,
  propina_sugerida_porcentaje: 10,
  permitir_descarga_pdf: true
});

let state = {
  container: null,
  supabase: null,
  user: null,
  hotelId: null,
  mesas: [],
  productos: [],
  tiendaProductos: [],
  metodosPago: [],
  configuracion: { ...DEFAULT_TERRAZA_CONFIG },
  isAdmin: false,
  pedidosAbiertos: [],
  historial: [],
  selectedMesaId: null,
  selectedSillaNumero: null,
  selectedMetodoPagoId: null,
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

function numberOrZero(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
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

function getTerrazaConfig() {
  return { ...DEFAULT_TERRAZA_CONFIG, ...(state.configuracion || {}) };
}

function getMicheladaPrice() {
  return numberOrZero(getTerrazaConfig().precio_michelada);
}

function getTipPercent() {
  return Math.max(0, numberOrZero(getTerrazaConfig().propina_sugerida_porcentaje));
}

function canDownloadPdf() {
  return getTerrazaConfig().permitir_descarga_pdf !== false;
}

function getSuggestedTip(total) {
  const percent = getTipPercent();
  return Math.round(numberOrZero(total) * (percent / 100));
}

function getPedidoTipAmount(pedido) {
  return Math.max(0, numberOrZero(pedido?.propina_monto));
}

function getPedidoSuggestedTipAmount(pedido) {
  return Math.max(0, numberOrZero(pedido?.propina_sugerida_monto || getSuggestedTip(totalPedido(pedido))));
}

function getTotalConPropina(subtotal, propina) {
  return numberOrZero(subtotal) + Math.max(0, numberOrZero(propina));
}

function getTipInputAmount(fallbackAmount = 0) {
  const input = state.container?.querySelector('#terraza-propina-monto');
  if (!input) return Math.max(0, numberOrZero(fallbackAmount));
  return Math.max(0, numberOrZero(input.value));
}

function isBeerProduct(producto) {
  return producto?.permite_michelada === true || normalizeTextKey(producto?.categoria).includes('cerveza');
}

function isAdminRoleName(value = '') {
  const roleKey = normalizeTextKey(value);
  return roleKey === 'admin' || roleKey === 'administrador' || roleKey === 'superadmin';
}

function isMicheladaItem(item) {
  return item?.es_michelada === true || item?.es_michelada === 'true';
}

function getItemDisplayName(item) {
  const baseName = item?.producto_nombre || 'Producto';
  return isMicheladaItem(item) ? `${baseName} Michelada` : baseName;
}

function getItemPriceDetail(item) {
  if (!isMicheladaItem(item)) return money(item?.precio_unitario);
  const basePrice = numberOrZero(item?.precio_base || item?.precio_unitario);
  const micheladaPrice = numberOrZero(item?.precio_michelada);
  return `${money(item?.precio_unitario)} (${money(basePrice)} + ${money(micheladaPrice)})`;
}

function buildReceiptItems(pedido) {
  return getPedidoItems(pedido).map((item) => ({
    nombre: getItemDisplayName(item),
    cantidad: item.cantidad,
    precio: item.precio_unitario,
    total: item.subtotal
  }));
}

function getPedidoById(pedidoId) {
  return [...state.pedidosAbiertos, ...state.historial].find((pedido) => pedido.id === pedidoId) || null;
}

function getSafeFileName(value) {
  return String(value || 'terraza')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'terraza';
}

async function resolveTerrazaAdminAccess() {
  if (isAdminRoleName(state.user?.role || state.user?.app_metadata?.rol || state.user?.user_metadata?.rol)) {
    return true;
  }

  if (!state.supabase || !state.user?.id) return false;

  const { data, error } = await state.supabase
    .from('usuarios')
    .select('rol, usuarios_roles(roles(nombre))')
    .eq('id', state.user.id)
    .maybeSingle();

  if (error) {
    console.warn('[Terraza] No se pudo resolver rol administrativo:', error.message);
    return false;
  }

  const roleNames = [
    data?.rol,
    ...((data?.usuarios_roles || []).map((item) => item?.roles?.nombre))
  ].filter(Boolean);

  return roleNames.some(isAdminRoleName);
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

function getPedidoEstadoMeta(pedido) {
  if (pedido?.estado === 'pagado') {
    return {
      label: 'Pagada',
      className: 'bg-green-100 text-green-800 border-green-200',
      documentLabel: 'Ticket Terraza',
      receiptStatus: 'Pagado'
    };
  }

  if (pedido?.estado === 'cancelado' && pedido?.reabierto_en_pedido_id) {
    return {
      label: 'Cancelada por reapertura',
      className: 'bg-amber-100 text-amber-800 border-amber-200',
      documentLabel: 'Ticket Terraza Cancelado',
      receiptStatus: 'Cancelado por reapertura'
    };
  }

  if (pedido?.estado === 'cancelado') {
    return {
      label: 'Cancelada',
      className: 'bg-red-100 text-red-800 border-red-200',
      documentLabel: 'Cuenta Terraza Cancelada',
      receiptStatus: 'Cancelado'
    };
  }

  return {
    label: 'Abierta',
    className: 'bg-blue-100 text-blue-800 border-blue-200',
    documentLabel: 'Recibo Terraza',
    receiptStatus: 'Pendiente'
  };
}

function canReopenPedido(pedido) {
  return pedido?.estado === 'pagado' && !pedido?.reabierto_en_pedido_id;
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

function getMetodosPagoActivos() {
  return state.metodosPago.filter((metodo) => metodo.activo !== false);
}

function getSelectedMetodoPago() {
  return state.metodosPago.find((metodo) => metodo.id === state.selectedMetodoPagoId) || null;
}

function getTiendaProductoNombre(producto) {
  if (!producto?.tienda_producto_id) return 'Sin enlace';
  return state.tiendaProductos.find((item) => item.id === producto.tienda_producto_id)?.nombre || 'Producto enlazado';
}

async function cargarDatos() {
  const [mesasResult, productosResult, tiendaProductosResult, metodosResult, configResult, pedidosResult, historialResult] = await Promise.all([
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
      .select('*')
      .eq('hotel_id', state.hotelId)
      .order('nombre', { ascending: true }),
    state.supabase
      .from('terraza_configuracion')
      .select('*')
      .eq('hotel_id', state.hotelId)
      .maybeSingle(),
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
      .in('estado', ['pagado', 'cancelado'])
      .order('actualizado_en', { ascending: false })
  ]);

  const errors = [mesasResult.error, productosResult.error, tiendaProductosResult.error, metodosResult.error, configResult.error, pedidosResult.error, historialResult.error].filter(Boolean);
  if (errors.length) {
    throw errors[0];
  }

  state.mesas = mesasResult.data || [];
  state.productos = productosResult.data || [];
  state.tiendaProductos = tiendaProductosResult.data || [];
  state.metodosPago = metodosResult.data || [];
  if (state.selectedMetodoPagoId && !getMetodosPagoActivos().some((metodo) => metodo.id === state.selectedMetodoPagoId)) {
    state.selectedMetodoPagoId = null;
  }
  state.configuracion = { ...DEFAULT_TERRAZA_CONFIG, ...(configResult.data || {}) };
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
            const beerProduct = isBeerProduct(producto);
            const micheladaPrice = getMicheladaPrice();
            return `
            <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-product-card="${escapeAttribute(producto.id)}">
              <div class="flex min-h-[72px] flex-col justify-between">
                <div>
                  <div class="flex items-start justify-between gap-3">
                    <h4 class="font-bold text-slate-800">${escapeHtml(producto.nombre)}</h4>
                    <span class="rounded-full border px-2 py-0.5 text-[11px] font-bold ${stockBadge.className}">${escapeHtml(stockBadge.label)}</span>
                  </div>
                  <p class="mt-1 text-xs text-slate-500">${escapeHtml(producto.descripcion || '')}</p>
                  ${beerProduct ? `
                    <label class="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                      <input type="checkbox" class="h-4 w-4" data-michelada-option>
                      <span>Vender como michelada</span>
                      <span class="ml-auto text-amber-700">+ ${money(micheladaPrice)}</span>
                    </label>
                  ` : ''}
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
  const total = totalPedido(pedido);
  const suggestedTip = getSuggestedTip(total);
  const defaultTipAmount = getPedidoTipAmount(pedido) || suggestedTip;
  const totalConPropina = getTotalConPropina(total, defaultTipAmount);
  const allowPdf = canDownloadPdf();
  const selectedMetodo = getSelectedMetodoPago();
  const metodosActivos = getMetodosPagoActivos();

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
                    <div class="font-semibold text-slate-800">
                      ${escapeHtml(getItemDisplayName(item))}
                      ${isMicheladaItem(item) ? '<span class="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">Michelada</span>' : ''}
                    </div>
                    <div class="text-xs text-slate-500">${escapeHtml(getItemPriceDetail(item))}</div>
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
          <span class="text-sm font-semibold text-slate-600">Subtotal consumo</span>
          <span class="text-3xl font-extrabold text-blue-700">${money(total)}</span>
        </div>
        <div class="mb-4 rounded-lg bg-emerald-50 p-3 text-sm">
          <div class="mb-2 flex items-center justify-between text-emerald-800">
            <span class="font-semibold">Propina sugerida</span>
            <span class="font-bold">${money(suggestedTip)}</span>
          </div>
          <label class="mb-1 block text-xs font-semibold uppercase text-emerald-700" for="terraza-propina-monto">Propina que dio el cliente</label>
          <input
            id="terraza-propina-monto"
            type="number"
            min="0"
            step="100"
            class="form-control w-full border-emerald-200 bg-white"
            value="${escapeAttribute(String(defaultTipAmount))}"
            ${disabled ? 'disabled' : ''}
          >
          <p class="mt-1 text-xs text-emerald-700">El mesero puede cambiar este valor por el monto real recibido.</p>
          <div class="mt-3 flex items-center justify-between text-emerald-900">
            <span class="font-bold">Total con propina</span>
            <span id="terraza-total-con-propina" class="font-extrabold">${money(totalConPropina)}</span>
          </div>
        </div>
        <div class="mb-3 grid ${allowPdf ? 'grid-cols-2' : 'grid-cols-1'} gap-2">
          <button class="button button-outline w-full" data-action="print-order-receipt" ${disabled ? 'disabled' : ''}>Imprimir recibo</button>
          ${allowPdf ? `<button class="button button-neutral w-full" data-action="download-order-pdf" ${disabled ? 'disabled' : ''}>Descargar PDF</button>` : ''}
        </div>
        <div class="mb-3">
          <label class="mb-1 block text-xs font-semibold uppercase text-slate-500">Metodo de pago</label>
          <button
            type="button"
            class="w-full rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${selectedMetodo ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}"
            data-action="choose-payment-method"
            ${disabled || !metodosActivos.length ? 'disabled' : ''}
          >
            ${selectedMetodo ? escapeHtml(selectedMetodo.nombre) : (metodosActivos.length ? 'Seleccionar metodo de pago' : 'No hay metodos activos')}
          </button>
          ${!metodosActivos.length ? '<p class="mt-1 text-xs text-red-600">Activa o crea metodos de pago en Configuracion.</p>' : ''}
        </div>
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

      <label class="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
        <input name="permite_michelada" type="checkbox" class="mt-1 h-4 w-4" ${product?.permite_michelada || isBeerProduct(product) ? 'checked' : ''}>
        <span>
          Permite vender como michelada
          <span class="block text-xs font-normal text-amber-800">Usalo para cervezas como Corona, Club Colombia, Aguila, Poker, etc.</span>
        </span>
      </label>

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
              <th class="px-4 py-3 text-center">Michelada</th>
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
                  <td class="px-4 py-3 text-center">
                    ${isBeerProduct(producto)
                      ? '<span class="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">Si</span>'
                      : '<span class="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">No</span>'}
                  </td>
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
          return `
            <div class="flex flex-col justify-between gap-3 p-4 text-sm md:flex-row md:items-start">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold text-slate-800">${escapeHtml(getPedidoLocationLabel(pedido))}</span>
                  <span class="rounded-full border px-2 py-0.5 text-[11px] font-bold ${estadoMeta.className}">${estadoMeta.label}</span>
                </div>
                <div class="mt-1 text-xs text-slate-500">
                  ${formatDate(fechaMovimiento)} - ${escapeHtml(pedido.metodo?.nombre || 'Sin metodo')}
                </div>
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

function renderStats() {
  const cuentas = state.pedidosAbiertos.length;
  const totalAbierto = state.pedidosAbiertos.reduce((acc, pedido) => acc + totalPedido(pedido), 0);
  const puestosOcupados = state.pedidosAbiertos.filter((pedido) => pedido.silla_numero).length;
  const productosBajos = state.productos.filter((producto) => producto.activo !== false && Number(producto.stock_actual || 0) <= Number(producto.stock_minimo || 0)).length;
  const propinasCobradas = state.historial
    .filter((pedido) => pedido.estado === 'pagado')
    .reduce((acc, pedido) => acc + getPedidoTipAmount(pedido), 0);

  return `
    <div class="grid grid-cols-1 gap-3 md:grid-cols-5">
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
      <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
        <div class="text-xs font-semibold uppercase text-emerald-700">Propinas cobradas</div>
        <div class="mt-1 text-2xl font-extrabold text-emerald-900">${money(propinasCobradas)}</div>
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

  if (state.isAdmin) {
    tabs.push({ id: 'configuracion', label: 'Configuracion' });
  }

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

function renderConfiguracionTab() {
  const config = getTerrazaConfig();

  return `
    <div class="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <form id="terraza-config-form" class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
        <div class="mb-4">
          <h2 class="text-lg font-bold text-slate-800">Configuracion de Terraza</h2>
          <p class="mt-1 text-sm text-slate-500">Define recargos y opciones que usan los meseros al vender y entregar recibos.</p>
        </div>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label class="form-label text-xs">Precio adicional de michelada</label>
            <input name="precio_michelada" type="number" min="0" step="100" class="form-control" value="${escapeAttribute(config.precio_michelada ?? 0)}" required>
            <p class="mt-1 text-xs text-slate-500">Se suma al precio de la cerveza cuando el mesero marca "Vender como michelada".</p>
          </div>
          <div>
            <label class="form-label text-xs">Propina sugerida (%)</label>
            <input name="propina_sugerida_porcentaje" type="number" min="0" max="100" step="0.01" class="form-control" value="${escapeAttribute(config.propina_sugerida_porcentaje ?? 10)}" required>
            <p class="mt-1 text-xs text-slate-500">Sirve solo para calcular el monto sugerido; el mesero registra la propina real en pesos al cobrar.</p>
          </div>
          <label class="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700 md:col-span-2">
            <input name="permitir_descarga_pdf" type="checkbox" class="mt-1 h-4 w-4" ${config.permitir_descarga_pdf !== false ? 'checked' : ''}>
            <span>
              Permitir descargar factura o ticket en PDF
              <span class="mt-1 block text-xs font-normal text-slate-500">Si lo desactivas, los meseros solo veran la opcion de imprimir recibo.</span>
            </span>
          </label>
        </div>

        <div class="mt-5 flex justify-end">
          <button class="button button-primary" type="submit">Guardar configuracion</button>
        </div>
      </form>

      <aside class="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <h3 class="font-bold">Como se aplica</h3>
        <p class="mt-2">Los productos cuya categoria sea Cerveza o Cervezas muestran el check de michelada en el mapa.</p>
        <p class="mt-2">Ejemplo: cerveza ${money(7000)} + michelada ${money(config.precio_michelada)} = ${money(7000 + numberOrZero(config.precio_michelada))}.</p>
      </aside>
    </div>
  `;
}

function renderActiveTab() {
  if (state.activeTab === 'inventario') return renderInventarioTab();
  if (state.activeTab === 'historial') return renderHistorialTab();
  if (state.activeTab === 'configuracion' && state.isAdmin) return renderConfiguracionTab();
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

async function addProductToSelectedOrder(productId, options = {}) {
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

  const esMichelada = Boolean(options.esMichelada);
  if (esMichelada && !isBeerProduct(product)) {
    throw new Error('Solo los productos de categoria Cerveza pueden venderse como michelada.');
  }
  if (esMichelada && getMicheladaPrice() <= 0) {
    throw new Error('Configura el precio adicional de la michelada antes de venderla.');
  }

  const precioBase = Number(product.precio || 0);
  const precioMichelada = esMichelada ? getMicheladaPrice() : 0;
  const precioUnitario = precioBase + precioMichelada;
  const pedido = await ensurePedidoAbierto();
  const pedidoCompleto = state.pedidosAbiertos.find((item) => item.id === pedido.id) || pedido;
  const existingItem = getPedidoItems(pedidoCompleto).find((item) => (
    item.producto_id === product.id && isMicheladaItem(item) === esMichelada
  ));

  if (existingItem) {
    const nuevaCantidad = Number(existingItem.cantidad || 0) + 1;
    const { error } = await state.supabase
      .from('terraza_pedido_items')
      .update({
        cantidad: nuevaCantidad,
        subtotal: nuevaCantidad * Number(existingItem.precio_unitario || precioUnitario)
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
      precio_base: precioBase,
      precio_michelada: precioMichelada,
      es_michelada: esMichelada,
      precio_unitario: precioUnitario,
      subtotal: precioUnitario
    });
    if (error) throw error;
  }

  await refreshAndRender();
  showFeedback(`${product.nombre}${esMichelada ? ' Michelada' : ''} agregado a ${getSelectedLocationLabel()}.`, 'success');
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
    .update({
      estado: 'cancelado',
      fecha_cierre: new Date().toISOString(),
      fecha_cancelacion: new Date().toISOString(),
      cancelado_por_usuario_id: state.user?.id || null,
      motivo_cancelacion: 'Cancelada antes de cobrar'
    })
    .eq('id', pedido.id);
  if (error) throw error;
  await refreshAndRender();
  showFeedback('Cuenta cancelada.', 'success');
}

async function askReopenReason(pedido) {
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

async function reopenHistoryOrder(pedidoId) {
  const pedido = getPedidoById(pedidoId);
  if (!pedido) {
    throw new Error('No se encontro la cuenta en el historial.');
  }
  if (!canReopenPedido(pedido)) {
    throw new Error('Esta cuenta no se puede reabrir.');
  }

  const motivo = await askReopenReason(pedido);
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

async function printOrderReceipt(pedido, options = {}) {
  if (!pedido || !getPedidoItems(pedido).length) {
    throw new Error('No hay consumos para imprimir.');
  }

  const subtotal = totalPedido(pedido);
  const estadoMeta = getPedidoEstadoMeta(pedido);
  const paid = options.paid ?? pedido.estado === 'pagado';
  const metodoNombre = options.metodoNombre || pedido.metodo?.nombre || 'Metodo';
  const suggestedTip = getPedidoSuggestedTipAmount(pedido);
  const storedTip = getPedidoTipAmount(pedido);
  const defaultTip = pedido.estado === 'abierto'
    ? getTipInputAmount(storedTip || suggestedTip)
    : storedTip;
  const propina = Math.max(0, numberOrZero(options.propinaMonto ?? defaultTip));
  const total = getTotalConPropina(subtotal, propina);
  const statusNote = pedido.estado === 'cancelado'
    ? 'Cuenta cancelada. No debe cobrarse nuevamente sin reapertura.'
    : (paid ? 'Cuenta pagada.' : 'Recibo previo al cobro.');

  await imprimirTicketOperacion({
    supabase: state.supabase,
    hotelId: state.hotelId,
    documentLabel: paid ? 'Ticket Terraza' : estadoMeta.documentLabel,
    reference: pedido.id,
    clientName: pedido.cliente_nombre || null,
    meta: [
      { label: 'Ubicacion', value: getPedidoLocationLabel(pedido) },
      { label: 'Estado', value: paid ? 'Pagado' : estadoMeta.receiptStatus }
    ],
    items: buildReceiptItems(pedido),
    subtotal,
    tip: propina,
    tipLabel: 'Propina sugerida',
    total,
    payments: paid ? [{ label: metodoNombre, amount: total }] : [],
    notes: statusNote
  });
}

function downloadOrderReceiptPdf(pedido) {
  if (!pedido || !getPedidoItems(pedido).length) {
    throw new Error('No hay consumos para descargar.');
  }
  if (!canDownloadPdf()) {
    throw new Error('La descarga en PDF esta desactivada en Configuracion de Terraza.');
  }
  if (typeof window.jspdf === 'undefined') {
    throw new Error('La libreria jsPDF no esta cargada. No se puede generar el PDF.');
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const subtotal = totalPedido(pedido);
  const estadoMeta = getPedidoEstadoMeta(pedido);
  const suggestedTip = getPedidoSuggestedTipAmount(pedido);
  const storedTip = getPedidoTipAmount(pedido);
  const propina = pedido.estado === 'abierto' ? getTipInputAmount(storedTip || suggestedTip) : storedTip;
  const total = getTotalConPropina(subtotal, propina);
  const locationLabel = getPedidoLocationLabel(pedido);
  const items = getPedidoItems(pedido).map((item) => [
    getItemDisplayName(item),
    String(item.cantidad || 0),
    money(item.precio_unitario),
    money(item.subtotal)
  ]);

  doc.setFontSize(18);
  doc.text(pedido.estado === 'pagado' ? 'Ticket Terraza' : estadoMeta.documentLabel, 40, 44);
  doc.setFontSize(10);
  doc.text(`Ubicacion: ${locationLabel}`, 40, 64);
  doc.text(`Estado: ${estadoMeta.receiptStatus}`, 40, 80);
  doc.text(`Fecha: ${new Date().toLocaleString('es-CO')}`, 40, 96);
  doc.text(`Referencia: ${pedido.id}`, 40, 112);

  if (typeof doc.autoTable === 'function') {
    doc.autoTable({
      startY: 132,
      head: [['Producto', 'Cant.', 'Precio', 'Subtotal']],
      body: items,
      theme: 'grid',
      styles: { fontSize: 9 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 }
    });
  } else {
    doc.setFontSize(10);
    let y = 122;
    items.forEach((row) => {
      doc.text(`${row[1]} x ${row[0]} - ${row[3]}`, 40, y);
      y += 16;
    });
  }

  const finalY = (doc.lastAutoTable?.finalY || 140) + 24;
  doc.setFontSize(11);
  doc.text(`Subtotal: ${money(subtotal)}`, 380, finalY, { align: 'left' });
  if (propina > 0) {
    doc.text(`Propina sugerida: ${money(propina)}`, 380, finalY + 18, { align: 'left' });
    doc.setFontSize(13);
    doc.text(`Total: ${money(total)}`, 380, finalY + 40, { align: 'left' });
  } else {
    doc.setFontSize(13);
    doc.text(`Total: ${money(total)}`, 380, finalY + 18, { align: 'left' });
  }

  const suffix = new Date().toISOString().slice(0, 10);
  doc.save(`recibo-terraza-${getSafeFileName(locationLabel)}-${suffix}.pdf`);
}

async function choosePaymentMethod() {
  const metodos = getMetodosPagoActivos();
  if (!metodos.length) {
    throw new Error('No hay metodos de pago activos. Activalos o crealos en Configuracion.');
  }

  if (typeof Swal !== 'undefined') {
    const inputOptions = Object.fromEntries(metodos.map((metodo) => [metodo.id, metodo.nombre || 'Sin nombre']));
    const result = await Swal.fire({
      title: 'Metodo de pago',
      input: 'radio',
      inputOptions,
      inputValue: state.selectedMetodoPagoId || metodos[0].id,
      showCancelButton: true,
      confirmButtonText: 'Seleccionar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#2563eb',
      inputValidator: (value) => (!value ? 'Selecciona un metodo de pago.' : undefined)
    });

    if (result.isConfirmed && result.value) {
      state.selectedMetodoPagoId = result.value;
      render();
    }
    return;
  }

  const opciones = metodos.map((metodo, index) => `${index + 1}. ${metodo.nombre}`).join('\n');
  const seleccionado = window.prompt(`Selecciona el metodo de pago:\n${opciones}`);
  const indice = Number(seleccionado) - 1;
  if (metodos[indice]) {
    state.selectedMetodoPagoId = metodos[indice].id;
    render();
  }
}

async function paySelectedOrder() {
  const pedido = getPedidoSeleccionado();
  if (!pedido || !getPedidoItems(pedido).length) {
    throw new Error('No hay consumos para cobrar.');
  }

  const metodoPagoId = state.selectedMetodoPagoId;
  if (!metodoPagoId) {
    throw new Error('Selecciona un metodo de pago.');
  }

  const turno = await turnoService.getTurnoAbierto(state.supabase, state.user.id, state.hotelId);
  if (!turno) {
    throw new Error('No hay un turno de caja abierto. Abre turno en Caja antes de cobrar.');
  }

  const metodo = state.metodosPago.find((item) => item.id === metodoPagoId);
  const total = totalPedido(pedido);
  const propinaSugerida = getSuggestedTip(total);
  const propinaMonto = getTipInputAmount(propinaSugerida);
  const totalCobrado = getTotalConPropina(total, propinaMonto);
  const label = getSelectedLocationLabel();

  const { data, error } = await state.supabase.rpc('cerrar_pedido_terraza', {
    p_pedido_id: pedido.id,
    p_metodo_pago_id: metodoPagoId,
    p_usuario_id: state.user.id,
    p_turno_id: turno.id,
    p_propina_monto: propinaMonto,
    p_propina_sugerida_monto: propinaSugerida
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
      propina_monto: propinaMonto,
      total_cobrado: totalCobrado,
      ubicacion: label
    }
  });

  try {
    await printOrderReceipt(
      { ...pedido, estado: 'pagado', metodo, propina_monto: propinaMonto, propina_sugerida_monto: propinaSugerida },
      { paid: true, metodoNombre: metodo?.nombre || 'Metodo', propinaMonto }
    );
  } catch (printError) {
    console.warn('[Terraza] No se pudo imprimir el ticket:', printError);
  }

  await refreshAndRender();
  showFeedback(`Cuenta cobrada: ${money(totalCobrado)}. Propina: ${money(propinaMonto)}.`, 'success');
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
  const permiteMichelada = formData.get('permite_michelada') === 'on';

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
    permite_michelada: permiteMichelada,
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

async function saveConfiguracion(form) {
  if (!state.isAdmin) {
    throw new Error('Solo un administrador puede cambiar la configuracion de Terraza.');
  }

  const formData = new FormData(form);
  const precioMichelada = Number(formData.get('precio_michelada') || 0);
  const propinaPorcentaje = Number(formData.get('propina_sugerida_porcentaje') || 0);
  const permitirPdf = formData.get('permitir_descarga_pdf') === 'on';

  if (!Number.isFinite(precioMichelada) || precioMichelada < 0) {
    throw new Error('El precio de la michelada no es valido.');
  }
  if (!Number.isFinite(propinaPorcentaje) || propinaPorcentaje < 0 || propinaPorcentaje > 100) {
    throw new Error('La propina sugerida debe estar entre 0 y 100%.');
  }

  const payload = {
    hotel_id: state.hotelId,
    precio_michelada: precioMichelada,
    propina_sugerida_porcentaje: propinaPorcentaje,
    permitir_descarga_pdf: permitirPdf
  };

  const { error } = await state.supabase
    .from('terraza_configuracion')
    .upsert(payload, { onConflict: 'hotel_id' });

  if (error) throw error;

  state.configuracion = { ...DEFAULT_TERRAZA_CONFIG, ...payload };
  state.activeTab = 'configuracion';
  await refreshAndRender();
  showFeedback('Configuracion de Terraza guardada.', 'success');
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
      if (button.dataset.tab === 'configuracion' && !state.isAdmin) {
        throw new Error('Solo un administrador puede abrir la configuracion de Terraza.');
      }
      state.activeTab = button.dataset.tab || 'mapa';
      render();
    } else if (action === 'select-location') {
      state.selectedMesaId = button.dataset.mesaId;
      state.selectedSillaNumero = normalizeSilla(button.dataset.silla);
      render();
    } else if (action === 'add-product') {
      const card = button.closest('[data-product-card]');
      const esMichelada = Boolean(card?.querySelector('[data-michelada-option]')?.checked);
      await addProductToSelectedOrder(button.dataset.productId, { esMichelada });
    } else if (action === 'increase-item') {
      await updateItemQuantity(button.dataset.itemId, 1);
    } else if (action === 'decrease-item') {
      await updateItemQuantity(button.dataset.itemId, -1);
    } else if (action === 'remove-item') {
      await removeItem(button.dataset.itemId);
    } else if (action === 'cancel-order') {
      await cancelSelectedOrder();
    } else if (action === 'choose-payment-method') {
      await choosePaymentMethod();
    } else if (action === 'print-order-receipt') {
      await printOrderReceipt(getPedidoSeleccionado());
    } else if (action === 'download-order-pdf') {
      downloadOrderReceiptPdf(getPedidoSeleccionado());
    } else if (action === 'print-history-receipt') {
      await printOrderReceipt(getPedidoById(button.dataset.pedidoId));
    } else if (action === 'download-history-pdf') {
      downloadOrderReceiptPdf(getPedidoById(button.dataset.pedidoId));
    } else if (action === 'reopen-history-order') {
      await reopenHistoryOrder(button.dataset.pedidoId);
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
  } else if (form.id === 'terraza-config-form') {
    event.preventDefault();
    try {
      await saveConfiguracion(form);
    } catch (error) {
      console.error('[Terraza] Error guardando configuracion:', error);
      showFeedback(error.message || 'No se pudo guardar la configuracion.', 'error', 0);
    }
  }
}

function handleInput(event) {
  if (event.target?.id !== 'terraza-propina-monto') return;

  const pedido = getPedidoSeleccionado();
  const totalEl = state.container?.querySelector('#terraza-total-con-propina');
  if (!pedido || !totalEl) return;

  const subtotal = totalPedido(pedido);
  const propina = getTipInputAmount(getSuggestedTip(subtotal));
  totalEl.textContent = money(getTotalConPropina(subtotal, propina));
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
    configuracion: { ...DEFAULT_TERRAZA_CONFIG },
    isAdmin: false,
    pedidosAbiertos: [],
    historial: [],
    selectedMesaId: null,
    selectedSillaNumero: null,
    selectedMetodoPagoId: null,
    editingProductId: null,
    activeTab: 'mapa',
    loading: false
  };

  if (state.hotelId !== TERRAZA_HOTEL_ID) {
    renderError('Este modulo solo esta habilitado para el hotel autorizado.');
    return;
  }

  container.innerHTML = '<div class="p-8 text-center text-slate-500">Cargando terraza...</div>';
  state.isAdmin = await resolveTerrazaAdminAccess();
  addListener(container, 'click', handleClick);
  addListener(container, 'submit', handleSubmit);
  addListener(container, 'input', handleInput);
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
    configuracion: { ...DEFAULT_TERRAZA_CONFIG },
    isAdmin: false,
    pedidosAbiertos: [],
    historial: [],
    selectedMesaId: null,
    selectedSillaNumero: null,
    selectedMetodoPagoId: null,
    editingProductId: null,
    activeTab: 'mapa',
    loading: false
  };
}
