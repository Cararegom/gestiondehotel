import { turnoService } from '../../services/turnoService.js';
import { renderCategorias, showModalCategoria, toggleEstadoCategoria } from './categorias.js';
import { renderModuloCompras, eliminarItemCompra, agregarProductoCompra, verDetallesCompra, resetComprasModuleState } from './compras.js';
import { renderComprasPendientes, recibirPedido, showModalEditarCompra, guardarCambiosCompra, cancelarCompra, resetComprasPendientesState } from './compras-pendientes.js';
import { closeModal, getTiendaTabsForCurrentUser, injectTiendaStyles, renderTiendaTabsShell } from './helpers.js';
import { renderInventario, confirmarEliminarProducto, reactivarProducto, showModalProducto, showModalHistorial, showModalMovimiento, resetInventarioState } from './inventario.js';
import { renderListaCompras } from './lista-compras.js';
import { renderPedidosWeb, resetPedidosWebState } from './pedidos-web.js';
import { renderPOS, updateQtyPOS, removeCartPOS, resetPOSState } from './pos.js';
import { renderProveedores, showModalProveedor, toggleEstadoProveedor } from './proveedores.js';
import { resetTiendaState, setTiendaContext, tiendaState } from './state.js';

const globalHandlers = {
  onTabTiendaClick: (tab) => renderTiendaTabs(tab),
  closeModal,
  updateQtyPOS,
  removeCartPOS,
  confirmarEliminarProducto,
  reactivarProducto,
  showModalProducto,
  showModalHistorial,
  showModalMovimiento,
  showModalCategoria,
  toggleEstadoCategoria,
  showModalProveedor,
  toggleEstadoProveedor,
  eliminarItemCompra,
  agregarProductoCompra,
  verDetallesCompra,
  recibirPedido,
  showModalEditarCompra,
  guardarCambiosCompra,
  cancelarCompra,
};

function registerGlobalHandlers() {
  Object.entries(globalHandlers).forEach(([name, handler]) => {
    window[name] = handler;
  });
}

function unregisterGlobalHandlers() {
  Object.keys(globalHandlers).forEach((name) => {
    delete window[name];
  });
}

async function renderTiendaTabs(tab) {
  const tabs = getTiendaTabsForCurrentUser();
  const activeTab = tabs.includes(tab) ? tab : tabs[0];
  renderTiendaTabsShell(activeTab);

  if (activeTab === 'POS') {
    await renderPOS();
    return;
  }
  if (activeTab === 'Inventario') {
    await renderInventario();
    return;
  }
  if (activeTab === 'Categor\u00edas') {
    await renderCategorias();
    return;
  }
  if (activeTab === 'Proveedores') {
    await renderProveedores();
    return;
  }
  if (activeTab === 'Lista de Compras') {
    await renderListaCompras();
    return;
  }
  if (activeTab === 'Compras') {
    await renderModuloCompras();
    return;
  }
  if (activeTab === 'Compras Pendientes') {
    await renderComprasPendientes();
    return;
  }
  if (activeTab === 'Pedidos web') {
    await renderPedidosWeb();
  }
}

export async function mount(container, supabase, user, hotelId) {
  injectTiendaStyles();
  setTiendaContext({ containerEl: container, supabase, user, hotelId });

  if (tiendaState.currentUser?.id && tiendaState.currentHotelId) {
    await turnoService.getTurnoAbierto(
      tiendaState.currentSupabase,
      tiendaState.currentUser.id,
      tiendaState.currentHotelId
    );
  }

  registerGlobalHandlers();
  await renderTiendaTabs(getTiendaTabsForCurrentUser()[0] || 'POS');
}

export function unmount() {
  unregisterGlobalHandlers();
  resetPOSState();
  resetInventarioState();
  resetComprasModuleState();
  resetComprasPendientesState();
  resetPedidosWebState();
  resetTiendaState();
}
