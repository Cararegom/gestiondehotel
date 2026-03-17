import { turnoService } from '../../services/turnoService.js';
import { renderCategorias, showModalCategoria, toggleEstadoCategoria } from './categorias.js';
import { renderModuloCompras, eliminarItemCompra, agregarProductoCompra, verDetallesCompra, resetComprasModuleState } from './compras.js';
import { renderComprasPendientes, recibirPedido, showModalEditarCompra, guardarCambiosCompra, cancelarCompra, resetComprasPendientesState } from './compras-pendientes.js';
import { closeModal, injectTiendaStyles, renderTiendaTabsShell } from './helpers.js';
import { renderInventario, confirmarEliminarProducto, reactivarProducto, showModalProducto, showModalHistorial, showModalMovimiento, resetInventarioState } from './inventario.js';
import { renderListaCompras } from './lista-compras.js';
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
  renderTiendaTabsShell(tab);

  if (tab === 'POS') {
    await renderPOS();
    return;
  }
  if (tab === 'Inventario') {
    await renderInventario();
    return;
  }
  if (tab === 'Categor\u00edas') {
    await renderCategorias();
    return;
  }
  if (tab === 'Proveedores') {
    await renderProveedores();
    return;
  }
  if (tab === 'Lista de Compras') {
    await renderListaCompras();
    return;
  }
  if (tab === 'Compras') {
    await renderModuloCompras();
    return;
  }
  if (tab === 'Compras Pendientes') {
    await renderComprasPendientes();
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
  await renderTiendaTabs('POS');
}

export function unmount() {
  unregisterGlobalHandlers();
  resetPOSState();
  resetInventarioState();
  resetComprasModuleState();
  resetComprasPendientesState();
  resetTiendaState();
}
