import { escapeAttribute, escapeHtml } from '../../security.js';
import {
  choosePaymentMethod,
  downloadOrderReceiptPdf,
  paySelectedOrder,
  printOrderReceipt
} from './terraza-cobros.js';
import {
  renderConfiguracionTab,
  saveConfiguracion
} from './terraza-configuracion.js';
import {
  activateReservation,
  cancelReservation,
  deleteReservation,
  renderReservasTab,
  saveReserva
} from './terraza-reservas.js';
import {
  renderInventarioTab,
  saveProduct,
  toggleProductActive,
  transferFromTienda,
  transferToTienda
} from './terraza-inventario.js';
import {
  renderHistorialTab,
  reopenHistoryOrder
} from './terraza-historial.js';
import { renderMapaTab } from './terraza-mapa.js';
import {
  addProductToSelectedOrder,
  cancelSelectedOrder,
  removeItem,
  setItemQuantity,
  updateItemQuantity
} from './terraza-pedidos.js';
import {
  formatDate,
  getItemDisplayName,
  getPedidoItems,
  getSafeFileName,
  isAdminRoleName,
  isBeerProduct,
  isLoungeTable,
  isMicheladaItem,
  money,
  normalizeSilla,
  normalizeTextKey,
  numberOrZero
} from './terraza-utils.js';

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
  isReservasOnly: false,
  pedidosAbiertos: [],
  historial: [],
  reservas: [],
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


function getMesaById(mesaId) {
  return state.mesas.find((mesa) => mesa.id === mesaId) || null;
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







function getItemPriceDetail(item) {
  if (!isMicheladaItem(item)) return money(item?.precio_unitario);
  const basePrice = numberOrZero(item?.precio_base || item?.precio_unitario);
  const micheladaPrice = numberOrZero(item?.precio_michelada);
  return `${money(item?.precio_unitario)} (${money(basePrice)} + ${money(micheladaPrice)})`;
}

function getPedidoById(pedidoId) {
  return [...state.pedidosAbiertos, ...state.historial].find((pedido) => pedido.id === pedidoId) || null;
}

function getReservaById(reservaId) {
  return state.reservas.find((reserva) => reserva.id === reservaId) || null;
}

function getReservaForPedido(pedido) {
  return pedido?.reserva || getReservaById(pedido?.reserva_terraza_id) || null;
}

function getReservasActivas() {
  return state.reservas.filter((reserva) => ['reservada', 'en_curso'].includes(reserva.estado));
}

function getReservasByLocation(mesaId, sillaNumero = null) {
  return getReservasActivas()
    .filter((reserva) => isSameLocation(reserva, mesaId, sillaNumero))
    .sort((a, b) => new Date(a.fecha_reserva || 0) - new Date(b.fecha_reserva || 0));
}

function getNextReservaForLocation(mesaId, sillaNumero = null) {
  return getReservasByLocation(mesaId, sillaNumero)[0] || null;
}

function getReservaAnticipo(reserva) {
  return Math.max(0, numberOrZero(reserva?.anticipo_consumible));
}

function getReservaConsumido(reserva) {
  return Math.max(0, numberOrZero(reserva?.saldo_consumido));
}

function getReservaSaldoDisponible(reserva) {
  return Math.max(0, getReservaAnticipo(reserva) - getReservaConsumido(reserva));
}

function getPedidoReservaSaldo(pedido) {
  return getReservaSaldoDisponible(getReservaForPedido(pedido));
}

function getPedidoSaldoAPagar(pedido, propina = 0) {
  const subtotal = totalPedido(pedido);
  const saldoReserva = Math.min(subtotal, getPedidoReservaSaldo(pedido));
  return Math.max(0, subtotal - saldoReserva) + Math.max(0, numberOrZero(propina));
}

function isRecepcionistaRoleName(value = '') {
  return normalizeTextKey(value) === 'recepcionista';
}

function isReservasOnlyRole() {
  return isRecepcionistaRoleName(state.user?.role || state.user?.app_metadata?.rol || state.user?.user_metadata?.rol);
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
  if (state.selectedSillaNumero) {
    const asientoLabel = isLoungeTable(mesa) ? 'Sillon' : 'Silla';
    return `${mesa.nombre} - ${asientoLabel} ${state.selectedSillaNumero}`;
  }
  return `${mesa.nombre} - Cuenta de mesa`;
}

function getPedidoLocationLabel(pedido) {
  const mesa = pedido?.mesa || getMesaById(pedido?.mesa_id);
  if (!mesa) return 'Ubicacion no disponible';
  if (isLooseChairGroup(mesa)) {
    return pedido?.silla_numero ? `Silla suelta ${pedido.silla_numero}` : 'Silla suelta';
  }
  const asientoLabel = isLoungeTable(mesa) ? 'Sillon' : 'Silla';
  return `${mesa.nombre || 'Mesa'}${pedido?.silla_numero ? ` - ${asientoLabel} ${pedido.silla_numero}` : ''}`;
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
  if (state.selectedMetodoPagoId === 'mixto') {
    return { id: 'mixto', nombre: 'Pago mixto' };
  }
  return state.metodosPago.find((metodo) => metodo.id === state.selectedMetodoPagoId) || null;
}

function getTiendaProductoNombre(producto) {
  if (!producto?.tienda_producto_id) return 'Sin enlace';
  return state.tiendaProductos.find((item) => item.id === producto.tienda_producto_id)?.nombre || 'Producto enlazado';
}

async function cargarDatos() {
  const [mesasResult, productosResult, tiendaProductosResult, metodosResult, configResult, pedidosResult, historialResult, reservasResult] = await Promise.all([
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
      .select('*, mesa:terraza_mesas(id, numero, nombre, sillas, tipo), reserva:terraza_reservas!terraza_pedidos_reserva_terraza_id_fkey(*, reservado_por:usuarios!terraza_reservas_usuario_id_fkey(nombre)), items:terraza_pedido_items(*)')
      .eq('hotel_id', state.hotelId)
      .eq('estado', 'abierto')
      .order('creado_en', { ascending: true }),
    state.supabase
      .from('terraza_pedidos')
      .select('*, mesa:terraza_mesas(id, numero, nombre, tipo), metodo:metodos_pago(nombre), reserva:terraza_reservas!terraza_pedidos_reserva_terraza_id_fkey(*, reservado_por:usuarios!terraza_reservas_usuario_id_fkey(nombre)), items:terraza_pedido_items(*)')
      .eq('hotel_id', state.hotelId)
      .in('estado', ['pagado', 'cancelado'])
      .order('actualizado_en', { ascending: false }),
    state.supabase
      .from('terraza_reservas')
      .select('*, mesa:terraza_mesas(id, numero, nombre, sillas, tipo), metodo:metodos_pago(nombre), reservado_por:usuarios!terraza_reservas_usuario_id_fkey(nombre), pedido:terraza_pedidos!terraza_reservas_pedido_id_fkey(id, estado, total)')
      .eq('hotel_id', state.hotelId)
      .in('estado', ['reservada', 'en_curso', 'completada', 'cancelada'])
      .order('fecha_reserva', { ascending: true })
  ]);

  const errors = [mesasResult.error, productosResult.error, tiendaProductosResult.error, metodosResult.error, configResult.error, pedidosResult.error, historialResult.error, reservasResult.error].filter(Boolean);
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
  state.reservas = reservasResult.data || [];

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

function renderStats() {
  const cuentas = state.pedidosAbiertos.length;
  const totalAbierto = state.pedidosAbiertos.reduce((acc, pedido) => acc + totalPedido(pedido), 0);
  const puestosOcupados = state.pedidosAbiertos.filter((pedido) => pedido.silla_numero).length;
  const productosBajos = state.productos.filter((producto) => producto.activo !== false && Number(producto.stock_actual || 0) <= Number(producto.stock_minimo || 0)).length;
  const reservasActivas = getReservasActivas().filter((reserva) => reserva.estado === 'reservada').length;
  const propinasCobradas = state.historial
    .filter((pedido) => pedido.estado === 'pagado')
    .reduce((acc, pedido) => acc + getPedidoTipAmount(pedido), 0);

  return `
    <div class="grid grid-cols-1 gap-3 md:grid-cols-6">
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
      <div class="rounded-xl border border-purple-200 bg-purple-50 p-4 shadow-sm">
        <div class="text-xs font-semibold uppercase text-purple-700">Reservas</div>
        <div class="mt-1 text-2xl font-extrabold text-purple-900">${reservasActivas}</div>
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
    ...(state.isReservasOnly ? [] : [{ id: 'mapa', label: 'Mapa' }]),
    { id: 'reservas', label: 'Reservas' },
    ...(state.isReservasOnly ? [] : [
      { id: 'inventario', label: 'Inventario' },
      { id: 'historial', label: 'Historial' }
    ])
  ];

  if (state.isAdmin && !state.isReservasOnly) {
    tabs.push({ id: 'configuracion', label: 'Configuracion' });
  }

  return `
    <div class="grid w-full grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:grid-cols-3 lg:inline-flex lg:w-auto">
      ${tabs.map((tab) => `
        <button
          class="rounded-lg px-3 py-2 text-center text-sm font-bold transition sm:px-4 ${state.activeTab === tab.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}"
          data-action="switch-tab"
          data-tab="${escapeAttribute(tab.id)}"
        >
          ${escapeHtml(tab.label)}
        </button>
      `).join('')}
    </div>
  `;
}

function getReservaModuleDeps() {
  return {
    state,
    confirmDialog,
    formatDate,
    getMesaById,
    getMetodosPagoActivos,
    getPedidoLocationLabel,
    getPedidoSeleccionado,
    getReservaAnticipo,
    getReservaById,
    getReservaSaldoDisponible,
    money,
    normalizeSilla,
    refreshAndRender,
    renderStats,
    showFeedback
  };
}

function getInventarioModuleDeps() {
  return {
    state,
    getAvailableStock,
    getProductoById,
    getReservedQuantity,
    getTiendaProductoNombre,
    isBeerProduct,
    money,
    refreshAndRender,
    renderStats,
    showFeedback
  };
}

function getCobrosModuleDeps() {
  return {
    state,
    canDownloadPdf,
    getItemDisplayName,
    getMetodosPagoActivos,
    getPedidoById,
    getPedidoEstadoMeta,
    getPedidoItems,
    getPedidoLocationLabel,
    getPedidoReservaSaldo,
    getPedidoSeleccionado,
    getPedidoSuggestedTipAmount,
    getPedidoTipAmount,
    getReservaAnticipo,
    getReservaForPedido,
    getSafeFileName,
    getSelectedLocationLabel,
    getSuggestedTip,
    getTipInputAmount,
    money,
    numberOrZero,
    refreshAndRender,
    render,
    showFeedback,
    totalPedido
  };
}

function getConfiguracionModuleDeps() {
  return {
    state,
    defaultTerrazaConfig: DEFAULT_TERRAZA_CONFIG,
    escapeAttribute,
    getTerrazaConfig,
    money,
    numberOrZero,
    refreshAndRender,
    showFeedback
  };
}

function getPedidosModuleDeps() {
  return {
    state,
    confirmDialog,
    getAvailableStock,
    getItemDisplayName,
    getMesaById,
    getMicheladaPrice,
    getNextReservaForLocation,
    getPedidoItems,
    getPedidoSeleccionado,
    getProductoById,
    getSelectedLocationLabel,
    isBeerProduct,
    isLooseChairGroup,
    isMicheladaItem,
    refreshAndRender,
    showFeedback
  };
}

function getMapaModuleDeps() {
  return {
    state,
    canDownloadPdf,
    escapeAttribute,
    escapeHtml,
    formatDate,
    getAvailableStock,
    getItemDisplayName,
    getItemPriceDetail,
    getMesasNormales,
    getMetodosPagoActivos,
    getMesaById,
    getMicheladaPrice,
    getNextReservaForLocation,
    getPedidoItems,
    getPedidoMesaCompleta,
    getPedidoReservaSaldo,
    getPedidoSaldoAPagar,
    getPedidoSeleccionado,
    getPedidoSilla,
    getPedidoTipAmount,
    getProductosActivos,
    getReservaAnticipo,
    getReservaForPedido,
    getReservaSaldoDisponible,
    getSelectedLocationLabel,
    getSelectedMetodoPago,
    getSillasSueltasGroup,
    getStockBadge,
    getSuggestedTip,
    getTotalConPropina,
    isBeerProduct,
    isLooseChairGroup,
    isLoungeTable,
    isMicheladaItem,
    money,
    pedidosPorMesa,
    renderStats,
    totalPedido
  };
}

function getHistorialModuleDeps() {
  return {
    state,
    canDownloadPdf,
    canReopenPedido,
    countItems,
    escapeAttribute,
    escapeHtml,
    formatDate,
    getItemDisplayName,
    getPedidoById,
    getPedidoEstadoMeta,
    getPedidoItems,
    getPedidoLocationLabel,
    getPedidoTipAmount,
    getTotalConPropina,
    money,
    normalizeSilla,
    refreshAndRender,
    showFeedback,
    totalPedido
  };
}

function renderActiveTab() {
  if (state.isReservasOnly && state.activeTab !== 'reservas') {
    state.activeTab = 'reservas';
  }
  if (state.activeTab === 'reservas') return renderReservasTab(getReservaModuleDeps());
  if (state.activeTab === 'inventario') return renderInventarioTab(getInventarioModuleDeps());
  if (state.activeTab === 'historial') return renderHistorialTab(getHistorialModuleDeps());
  if (state.activeTab === 'configuracion' && state.isAdmin) return renderConfiguracionTab(getConfiguracionModuleDeps());
  return renderMapaTab(getMapaModuleDeps());
}

function render() {
  if (!state.container) return;

  state.container.innerHTML = `
    <section class="terraza-module min-h-screen bg-slate-100 p-4 lg:p-6">
      <div class="mx-auto max-w-[1600px] space-y-5">
        <header class="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center">
          <div class="min-w-0">
            <p class="text-xs font-bold uppercase tracking-wide text-blue-600">Modulo exclusivo</p>
            <h1 class="text-2xl font-extrabold text-slate-900">Terraza</h1>
            <p class="mt-1 text-sm text-slate-500">Controla consumos por mesa, por silla de mesa o por silla suelta.</p>
          </div>
          <div class="flex w-full flex-col gap-2 md:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end">
            ${renderTabNav()}
            <button class="button button-outline w-full lg:w-auto" data-action="refresh">Actualizar</button>
          </div>
        </header>

        <div id="terraza-feedback" style="display:none;"></div>
        <div id="terraza-loading" class="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-800" style="display:none;">Cargando terraza...</div>

        ${renderActiveTab()}
      </div>
    </section>
  `;
}

async function handleClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;

  const action = button.dataset.action;

  try {
    if (action === 'refresh') {
      await refreshAndRender();
    } else if (action === 'switch-tab') {
      if (state.isReservasOnly && button.dataset.tab !== 'reservas') {
        throw new Error('Recepcion solo puede gestionar reservas de Terraza.');
      }
      if (button.dataset.tab === 'configuracion' && !state.isAdmin) {
        throw new Error('Solo un administrador puede abrir la configuracion de Terraza.');
      }
      state.activeTab = button.dataset.tab || 'mapa';
      render();
    } else if (action === 'select-location') {
      if (state.isReservasOnly) throw new Error('Recepcion solo puede gestionar reservas de Terraza.');
      state.selectedMesaId = button.dataset.mesaId;
      state.selectedSillaNumero = normalizeSilla(button.dataset.silla);
      render();
    } else if (action === 'add-product') {
      if (state.isReservasOnly) throw new Error('Recepcion no puede registrar consumos de Terraza.');
      const card = button.closest('[data-product-card]');
      const esMichelada = Boolean(card?.querySelector('[data-michelada-option]')?.checked);
      await addProductToSelectedOrder(button.dataset.productId, getPedidosModuleDeps(), { esMichelada });
    } else if (action === 'increase-item') {
      if (state.isReservasOnly) throw new Error('Recepcion no puede modificar consumos de Terraza.');
      await updateItemQuantity(button.dataset.itemId, 1, getPedidosModuleDeps());
    } else if (action === 'decrease-item') {
      if (state.isReservasOnly) throw new Error('Recepcion no puede modificar consumos de Terraza.');
      await updateItemQuantity(button.dataset.itemId, -1, getPedidosModuleDeps());
    } else if (action === 'remove-item') {
      if (state.isReservasOnly) throw new Error('Recepcion no puede modificar consumos de Terraza.');
      await removeItem(button.dataset.itemId, getPedidosModuleDeps());
    } else if (action === 'cancel-order') {
      if (state.isReservasOnly) throw new Error('Recepcion no puede cancelar cuentas de Terraza.');
      await cancelSelectedOrder(getPedidosModuleDeps());
    } else if (action === 'choose-payment-method') {
      if (state.isReservasOnly) throw new Error('Recepcion no puede cobrar cuentas de Terraza.');
      await choosePaymentMethod(getCobrosModuleDeps());
    } else if (action === 'print-order-receipt') {
      if (state.isReservasOnly) throw new Error('Recepcion no puede imprimir cuentas de Terraza.');
      await printOrderReceipt(getPedidoSeleccionado(), getCobrosModuleDeps());
    } else if (action === 'download-order-pdf') {
      if (state.isReservasOnly) throw new Error('Recepcion no puede descargar cuentas de Terraza.');
      downloadOrderReceiptPdf(getPedidoSeleccionado(), getCobrosModuleDeps());
    } else if (action === 'print-history-receipt') {
      if (state.isReservasOnly) throw new Error('Recepcion no puede imprimir historial de Terraza.');
      await printOrderReceipt(getPedidoById(button.dataset.pedidoId), getCobrosModuleDeps());
    } else if (action === 'download-history-pdf') {
      if (state.isReservasOnly) throw new Error('Recepcion no puede descargar historial de Terraza.');
      downloadOrderReceiptPdf(getPedidoById(button.dataset.pedidoId), getCobrosModuleDeps());
    } else if (action === 'reopen-history-order') {
      if (state.isReservasOnly) throw new Error('Recepcion no puede reabrir cuentas de Terraza.');
      await reopenHistoryOrder(button.dataset.pedidoId, getHistorialModuleDeps());
    } else if (action === 'pay-order') {
      if (state.isReservasOnly) throw new Error('Recepcion no puede cobrar cuentas de Terraza.');
      await paySelectedOrder(getCobrosModuleDeps());
    } else if (action === 'activate-reservation') {
      if (state.isReservasOnly) throw new Error('Recepcion solo puede crear reservas; la activacion la hace mesero o admin.');
      await activateReservation(button.dataset.reservaId, getReservaModuleDeps());
    } else if (action === 'cancel-reservation') {
      if (state.isReservasOnly) throw new Error('Recepcion no puede cancelar reservas de Terraza.');
      await cancelReservation(button.dataset.reservaId, getReservaModuleDeps());
    } else if (action === 'delete-reservation') {
      await deleteReservation(button.dataset.reservaId, getReservaModuleDeps());
    } else if (action === 'edit-product') {
      if (state.isReservasOnly) throw new Error('Recepcion no puede editar inventario de Terraza.');
      state.editingProductId = button.dataset.productId;
      state.activeTab = 'inventario';
      render();
    } else if (action === 'cancel-product-edit') {
      if (state.isReservasOnly) throw new Error('Recepcion no puede editar inventario de Terraza.');
      state.editingProductId = null;
      render();
    } else if (action === 'toggle-product-active') {
      if (state.isReservasOnly) throw new Error('Recepcion no puede editar inventario de Terraza.');
      await toggleProductActive(button.dataset.productId, button.dataset.active === 'true', getInventarioModuleDeps());
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
    if (state.isReservasOnly) {
      showFeedback('Recepcion no puede guardar productos de Terraza.', 'error', 0);
      return;
    }
    try {
      await saveProduct(form, getInventarioModuleDeps());
    } catch (error) {
      console.error('[Terraza] Error guardando producto:', error);
      showFeedback(error.message || 'No se pudo guardar la bebida.', 'error', 0);
    }
  } else if (form.id === 'terraza-reserva-form') {
    event.preventDefault();
    try {
      await saveReserva(form, getReservaModuleDeps());
    } catch (error) {
      console.error('[Terraza] Error guardando reserva:', error);
      showFeedback(error.message || 'No se pudo guardar la reserva.', 'error', 0);
    }
  } else if (form.id === 'terraza-transfer-tienda-form') {
    event.preventDefault();
    if (state.isReservasOnly) {
      showFeedback('Recepcion no puede mover inventario de Terraza.', 'error', 0);
      return;
    }
    try {
      await transferFromTienda(form, getInventarioModuleDeps());
    } catch (error) {
      console.error('[Terraza] Error transfiriendo desde Tienda:', error);
      showFeedback(error.message || 'No se pudo transferir desde Tienda.', 'error', 0);
    }
  } else if (form.id === 'terraza-transfer-terraza-form') {
    event.preventDefault();
    if (state.isReservasOnly) {
      showFeedback('Recepcion no puede mover inventario de Terraza.', 'error', 0);
      return;
    }
    try {
      await transferToTienda(form, getInventarioModuleDeps());
    } catch (error) {
      console.error('[Terraza] Error transfiriendo hacia Tienda:', error);
      showFeedback(error.message || 'No se pudo transferir hacia Tienda.', 'error', 0);
    }
  } else if (form.id === 'terraza-config-form') {
    event.preventDefault();
    if (state.isReservasOnly) {
      showFeedback('Recepcion no puede cambiar la configuracion de Terraza.', 'error', 0);
      return;
    }
    try {
      await saveConfiguracion(form, getConfiguracionModuleDeps());
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
  const saldoEl = state.container?.querySelector('#terraza-saldo-a-cobrar');
  if (!pedido || !totalEl) return;

  const subtotal = totalPedido(pedido);
  const propina = getTipInputAmount(getSuggestedTip(subtotal));
  totalEl.textContent = money(getTotalConPropina(subtotal, propina));
  if (saldoEl) {
    saldoEl.textContent = money(getPedidoSaldoAPagar(pedido, propina));
  }
}

function handleChange(event) {
  const quantityInput = event.target?.closest?.('[data-item-quantity]');
  if (quantityInput) {
    if (state.isReservasOnly) {
      showFeedback('Recepcion no puede modificar consumos de Terraza.', 'error', 0);
      return;
    }
    setItemQuantity(quantityInput.dataset.itemId, quantityInput.value, getPedidosModuleDeps())
      .catch((error) => {
        console.error('[Terraza] Error actualizando cantidad:', error);
        showFeedback(error.message || 'No se pudo actualizar la cantidad.', 'error', 0);
        refreshAndRender();
      });
    return;
  }

  if (event.target?.name !== 'imagen') return;

  const preview = state.container?.querySelector('#terraza-product-image-preview');
  const file = event.target.files?.[0];
  if (preview && file) {
    preview.src = URL.createObjectURL(file);
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
    configuracion: { ...DEFAULT_TERRAZA_CONFIG },
    isAdmin: false,
    isReservasOnly: false,
    pedidosAbiertos: [],
    historial: [],
    reservas: [],
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
  state.isReservasOnly = !state.isAdmin && isReservasOnlyRole();
  if (state.isReservasOnly) {
    state.activeTab = 'reservas';
  }
  addListener(container, 'click', handleClick);
  addListener(container, 'submit', handleSubmit);
  addListener(container, 'input', handleInput);
  addListener(container, 'change', handleChange);
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
    isReservasOnly: false,
    pedidosAbiertos: [],
    historial: [],
    reservas: [],
    selectedMesaId: null,
    selectedSillaNumero: null,
    selectedMetodoPagoId: null,
    editingProductId: null,
    activeTab: 'mapa',
    loading: false
  };
}
