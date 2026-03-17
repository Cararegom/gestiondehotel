export const tiendaState = {
  currentContainerEl: null,
  currentSupabase: null,
  currentUser: null,
  currentHotelId: null,
  descuentoAplicado: null,
  caches: {
    categorias: [],
    proveedores: [],
    productos: [],
  },
  comprasPendientesCache: [],
  pos: {
    productos: [],
    metodosPago: [],
    habitacionesOcupadas: [],
    carrito: [],
    filtro: '',
    ventaEnCurso: false,
  },
  inventario: {
    productos: [],
  },
  categorias: {
    lista: [],
  },
  proveedores: {
    lista: [],
  },
  listaCompras: {
    filtroProveedor: '',
  },
  compras: {
    carritoProveedor: [],
    filtroProveedor: '',
  },
};

export function setTiendaContext({ containerEl, supabase, user, hotelId }) {
  tiendaState.currentContainerEl = containerEl || null;
  tiendaState.currentSupabase = supabase || null;
  tiendaState.currentUser = user || null;
  tiendaState.currentHotelId = hotelId || user?.user_metadata?.hotel_id || null;
}

export function resetTiendaState() {
  tiendaState.currentContainerEl = null;
  tiendaState.currentSupabase = null;
  tiendaState.currentUser = null;
  tiendaState.currentHotelId = null;
  tiendaState.descuentoAplicado = null;
  tiendaState.caches.categorias = [];
  tiendaState.caches.proveedores = [];
  tiendaState.caches.productos = [];
  tiendaState.comprasPendientesCache = [];
  tiendaState.pos.productos = [];
  tiendaState.pos.metodosPago = [];
  tiendaState.pos.habitacionesOcupadas = [];
  tiendaState.pos.carrito = [];
  tiendaState.pos.filtro = '';
  tiendaState.pos.ventaEnCurso = false;
  tiendaState.inventario.productos = [];
  tiendaState.categorias.lista = [];
  tiendaState.proveedores.lista = [];
  tiendaState.listaCompras.filtroProveedor = '';
  tiendaState.compras.carritoProveedor = [];
  tiendaState.compras.filtroProveedor = '';
}
