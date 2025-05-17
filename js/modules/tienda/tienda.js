// --- ESTADO GLOBAL ---
let currentContainerEl = null;
let currentSupabaseInstance = null;
let currentModuleUser = null;
let currentHotelId = null;

// Estado de cada módulo
let productosDisponibles = [];
let metodosPago = [];
let reservasActivas = [];
let carritoPOS = [];
let totalPOS = 0;
let inventarioProductos = [];
let categoriasCache = [];
let proveedoresCache = [];
let comprasSugeridas = [];
let proveedoresList = [];
let categoriasList = [];

// --- RENDER DE PESTAÑAS PRINCIPALES ---
export async function mount(container, supabase, user, hotelId) {
  currentContainerEl = container;
  currentSupabaseInstance = supabase;
  currentModuleUser = user;
  currentHotelId = hotelId || user?.user_metadata?.hotel_id;

  container.innerHTML = `
    <style>
      .tabbar { display: flex; gap: 8px; margin-bottom: 12px;}
      .tab-btn { padding: 7px 18px; border-radius: 7px 7px 0 0; background: #eee; border: 1px solid #bbb; border-bottom: none; cursor: pointer; font-weight: bold;}
      .tab-btn.active { background: #fff; border-bottom: 1px solid #fff;}
      .tab-content { display:none; padding: 16px; background: #fff; border: 1px solid #bbb; border-radius: 0 0 7px 7px;}
      .tab-content.active { display: block; }
      .btn { padding: 5px 13px; border-radius: 5px; border:none; background:#3182ce; color:#fff; cursor:pointer; font-size: 14px; }
      .btn-danger { background:#e53e3e; }
      .btn-secondary { background:#a0aec0; }
      .modal-bg { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.3); z-index:999; align-items:center; justify-content:center;}
      .modal-bg.active { display:flex;}
      .modal { background:#fff; border-radius:8px; box-shadow:0 4px 32px #0002; max-width:420px; width:90%; padding:26px; }
      .input, select { border:1px solid #cbd5e0; border-radius:4px; padding:5px; margin-bottom:10px; width:100%;}
      .table { border-collapse:collapse; width:100%; margin-top:8px;}
      .table th, .table td { border:1px solid #cbd5e0; padding:6px 10px; font-size:13px;}
      .switch { cursor:pointer; }
      .switch input { display:none; }
      .switch span { display:inline-block; width:30px; height:18px; background:#ccc; border-radius:9px; position:relative; vertical-align:middle;}
      .switch input:checked + span { background:#3182ce;}
      .switch span:before { content:""; display:block; width:14px; height:14px; background:#fff; border-radius:7px; position:absolute; top:2px; left:3px; transition:.15s;}
      .switch input:checked + span:before { left:13px;}
    </style>
    <div>
      <div class="tabbar">
        <button class="tab-btn active" data-tab="tab-pos">POS</button>
        <button class="tab-btn" data-tab="tab-inventario">Inventario</button>
        <button class="tab-btn" data-tab="tab-proveedores">Proveedores</button>
        <button class="tab-btn" data-tab="tab-categorias">Categorías</button>
        <button class="tab-btn" data-tab="tab-lista-compra">Lista de Compra</button>
      </div>
      <div id="tab-pos" class="tab-content active"></div>
      <div id="tab-inventario" class="tab-content"></div>
      <div id="tab-proveedores" class="tab-content"></div>
      <div id="tab-categorias" class="tab-content"></div>
      <div id="tab-lista-compra" class="tab-content"></div>
    </div>
    <div id="modal-bg" class="modal-bg"></div>
  `;

  // Setup tabs
  Array.from(container.querySelectorAll('.tab-btn')).forEach(btn => {
    btn.onclick = () => {
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      container.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      container.querySelector('#' + btn.dataset.tab).classList.add('active');
      // Cargar contenido dinámico si es necesario
      if (btn.dataset.tab === 'tab-pos') cargarPOS();
      if (btn.dataset.tab === 'tab-inventario') cargarInventario();
      if (btn.dataset.tab === 'tab-proveedores') cargarProveedores();
      if (btn.dataset.tab === 'tab-categorias') cargarCategorias();
      if (btn.dataset.tab === 'tab-lista-compra') cargarListaCompra();
    }
  });

  cargarPOS();
}

// --- POS ---
async function cargarPOS() {
  const el = currentContainerEl.querySelector('#tab-pos');
  el.innerHTML = `<div>Cargando POS...</div>`;
  // Traer productos, métodos y reservas
  let { data: productos } = await currentSupabaseInstance
    .from('productos_tienda').select('id, nombre, precio_venta, imagen_url, stock_actual, categoria_id').eq('hotel_id', currentHotelId).eq('activo', true).gt('stock_actual', 0);
  productosDisponibles = productos || [];

  let { data: metodos } = await currentSupabaseInstance
    .from('metodos_pago').select('id, nombre').eq('hotel_id', currentHotelId).eq('activo', true);
  metodosPago = metodos || [];

  let { data: reservas } = await currentSupabaseInstance
    .from('reservas').select('id, cliente_nombre').eq('hotel_id', currentHotelId).eq('estado', 'check_in');
  reservasActivas = reservas || [];
  carritoPOS = [];
  totalPOS = 0;

  renderPOS(el);
}
function renderPOS(el) {
  el.innerHTML = `
    <h3>Punto de Venta</h3>
    <div style="display:flex;gap:28px;">
      <div style="width:50%">
        <h4>Productos</h4>
        <div id="productosPOS" style="display:flex;flex-wrap:wrap;gap:9px;"></div>
      </div>
      <div style="width:50%">
        <h4>Carrito</h4>
        <table class="table" id="carritoTable"><thead>
          <tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subt.</th><th></th></tr>
        </thead><tbody id="carritoBody"></tbody></table>
        <div style="text-align:right;margin-top:7px;font-weight:bold;">Total: <span id="totalPOS">$0</span></div>
        <div style="margin:11px 0;">
          <select id="modoCargoPOS" class="input" style="width:130px;display:inline-block;">
            <option value="inmediato">Pago Inmediato</option>
            <option value="habitacion">Cargar a Habitación</option>
          </select>
          <select id="metodoPagoPOS" class="input" style="width:130px;display:inline-block;"></select>
          <select id="reservaPOS" class="input" style="width:170px;display:none"></select>
          <input id="clienteTemporalPOS" type="text" class="input" style="width:150px;display:inline-block;" placeholder="Nombre cliente (opcional)">
          <button id="finalizarVentaPOS" class="btn">Finalizar Venta</button>
        </div>
        <div id="errorPOS" style="color:#e53e3e;margin-top:6px;"></div>
      </div>
    </div>
  `;
  // Productos
  let cont = el.querySelector('#productosPOS');
  cont.innerHTML = '';
  productosDisponibles.forEach(p => {
    let d = document.createElement('div');
    d.style = "border:1px solid #ddd;border-radius:7px;width:130px;padding:6px;text-align:center;cursor:pointer;";
    d.innerHTML = `<div style="font-weight:bold">${p.nombre}</div>
      <div style="font-size:13px;color:#666;">$${p.precio_venta}</div>
      <div style="font-size:12px;">Stock: ${p.stock_actual}</div>
      <button class="btn btn-secondary" data-id="${p.id}" style="margin-top:6px;">Agregar</button>`;
    d.querySelector('button').onclick = () => agregarAlCarritoPOS(p.id);
    cont.appendChild(d);
  });
  // Métodos de pago y reservas
  let metodoSel = el.querySelector('#metodoPagoPOS');
  metodoSel.innerHTML = metodosPago.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('');
  let resSel = el.querySelector('#reservaPOS');
  resSel.innerHTML = reservasActivas.map(r => `<option value="${r.id}">${r.cliente_nombre}</option>`).join('');
  // Eventos
  el.querySelector('#modoCargoPOS').onchange = e => {
    let modo = e.target.value;
    metodoSel.style.display = modo === 'inmediato' ? 'inline-block' : 'none';
    el.querySelector('#clienteTemporalPOS').style.display = modo === 'inmediato' ? 'inline-block' : 'none';
    resSel.style.display = modo === 'habitacion' ? 'inline-block' : 'none';
  };
  el.querySelector('#finalizarVentaPOS').onclick = finalizarVentaPOS;
  renderizarCarritoPOS();
}
function agregarAlCarritoPOS(pid) {
  let prod = productosDisponibles.find(p => p.id === pid);
  if (!prod) return;
  let item = carritoPOS.find(i => i.id === pid);
  if (item) {
    if (item.cantidad < prod.stock_actual) item.cantidad++;
  } else {
    carritoPOS.push({ ...prod, cantidad: 1 });
  }
  renderizarCarritoPOS();
}
function renderizarCarritoPOS() {
  let tbody = currentContainerEl.querySelector('#carritoBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  let total = 0;
  carritoPOS.forEach(item => {
    let subt = item.precio_venta * item.cantidad;
    total += subt;
    let tr = document.createElement('tr');
    tr.innerHTML = `<td>${item.nombre}</td>
      <td><input type="number" min="1" max="${item.stock_actual}" value="${item.cantidad}" style="width:40px;" 
      onchange="this.value<=${item.stock_actual}&&this.value>0?window.cantidadPOS('${item.id}',this.value):this.value=${item.cantidad};"></td>
      <td>$${item.precio_venta}</td>
      <td>$${subt}</td>
      <td><button onclick="window.eliminarPOS('${item.id}')" class="btn btn-danger" style="padding:2px 7px;">✖</button></td>`;
    tbody.appendChild(tr);
  });
  currentContainerEl.querySelector('#totalPOS').textContent = `$${total}`;
  totalPOS = total;
}
window.cantidadPOS = (id, val) => {
  let item = carritoPOS.find(i => i.id === id);
  if (item && val > 0 && val <= item.stock_actual) item.cantidad = Number(val);
  renderizarCarritoPOS();
}
window.eliminarPOS = id => {
  carritoPOS = carritoPOS.filter(i => i.id !== id);
  renderizarCarritoPOS();
};
async function finalizarVentaPOS() {
  let errorEl = currentContainerEl.querySelector('#errorPOS');
  if (carritoPOS.length === 0) {
    errorEl.textContent = "¡El carrito está vacío!";
    return;
  }
  errorEl.textContent = "";
  let modo = currentContainerEl.querySelector('#modoCargoPOS').value;
  let metodo_pago_id = null, reserva_id = null, cliente_temporal = null;
  if (modo === 'inmediato') {
    metodo_pago_id = currentContainerEl.querySelector('#metodoPagoPOS').value;
    cliente_temporal = currentContainerEl.querySelector('#clienteTemporalPOS').value || null;
  } else if (modo === 'habitacion') {
    reserva_id = currentContainerEl.querySelector('#reservaPOS').value;
  }
  // Crear venta
  let { data: venta, error: errorVenta } = await currentSupabaseInstance
    .from('ventas_tienda')
    .insert([{
      hotel_id: currentHotelId,
      usuario_id: currentModuleUser.id,
      reserva_id,
      metodo_pago_id,
      cliente_temporal,
      total_venta: totalPOS,
      fecha: new Date().toISOString(),
      creado_en: new Date().toISOString()
    }])
    .select().single();
  if (errorVenta || !venta) {
    errorEl.textContent = "Error registrando venta";
    return;
  }
  // Detalles venta y stock
  for (let item of carritoPOS) {
    await currentSupabaseInstance.from('detalle_ventas_tienda').insert([{
      venta_id: venta.id,
      producto_id: item.id,
      cantidad: item.cantidad,
      precio_unitario_venta: item.precio_venta,
      subtotal: item.cantidad * item.precio_venta,
      hotel_id: currentHotelId,
      creado_en: new Date().toISOString()
    }]);
    await currentSupabaseInstance
      .from('productos_tienda')
      .update({ stock_actual: item.stock_actual - item.cantidad })
      .eq('id', item.id);
  }
  // Caja
  await currentSupabaseInstance.from('caja').insert([{
    hotel_id: currentHotelId,
    tipo: 'ingreso',
    monto: totalPOS,
    concepto: 'Venta de tienda',
    fecha_movimiento: new Date().toISOString(),
    metodo_pago_id: metodo_pago_id || null,
    usuario_id: currentModuleUser.id,
    venta_tienda_id: venta.id,
    creado_en: new Date().toISOString()
  }]);
  carritoPOS = [];
  renderizarCarritoPOS();
  await cargarPOS();
  errorEl.textContent = "¡Venta registrada con éxito!";
  setTimeout(() => errorEl.textContent = "", 2200);
}

// --- INVENTARIO ---
async function cargarInventario() {
  let el = currentContainerEl.querySelector('#tab-inventario');
  el.innerHTML = `<div>Cargando inventario...</div>`;
  let { data } = await currentSupabaseInstance
    .from('productos_tienda')
    .select('*, categorias_producto(nombre), proveedores(nombre)')
    .eq('hotel_id', currentHotelId);
  inventarioProductos = data || [];
  await cargarAuxiliares();
  renderInventario(el);
}
async function cargarAuxiliares() {
  let { data: cat } = await currentSupabaseInstance
    .from('categorias_producto')
    .select('id, nombre')
    .eq('hotel_id', currentHotelId)
    .eq('activa', true);
  categoriasCache = cat || [];
  let { data: prov } = await currentSupabaseInstance
    .from('proveedores')
    .select('id, nombre')
    .eq('hotel_id', currentHotelId)
    .eq('activo', true);
  proveedoresCache = prov || [];
}
function renderInventario(el) {
  el.innerHTML = `
    <h3>Inventario de Productos</h3>
    <div style="margin-bottom:7px;">
      <button class="btn" id="btnAddProducto">Agregar Producto</button>
      <input id="buscarInventario" class="input" style="width:190px;display:inline-block;margin-left:14px;" placeholder="Buscar...">
    </div>
    <div style="overflow-x:auto;">
      <table class="table">
        <thead><tr>
          <th>Nombre</th><th>Código</th><th>Categoría</th><th>Proveedor</th><th>Precio Compra</th>
          <th>Precio Venta</th><th>Stock</th><th>Stock Mín</th><th>Stock Máx</th><th>Estado</th><th>Acciones</th>
        </tr></thead>
        <tbody id="tbodyInventario"></tbody>
      </table>
    </div>
  `;
  document.getElementById('btnAddProducto').onclick = () => showProductoModal();
  document.getElementById('buscarInventario').oninput = e => renderInventarioTabla(e.target.value);
  renderInventarioTabla();
}
function renderInventarioTabla(filtro = '') {
  let tbody = document.getElementById('tbodyInventario');
  if (!tbody) return;
  let lista = inventarioProductos;
  if (filtro.trim() !== '') lista = lista.filter(p => p.nombre.toLowerCase().includes(filtro.toLowerCase()));
  tbody.innerHTML = '';
  lista.forEach(p => {
    let tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.nombre}</td>
      <td>${p.codigo_barras || ''}</td>
      <td>${p.categorias_producto?.nombre || ''}</td>
      <td>${p.proveedores?.nombre || ''}</td>
      <td class="text-right">$${p.precio || 0}</td>
      <td class="text-right">$${p.precio_venta || 0}</td>
      <td class="text-right">${p.stock_actual || 0}</td>
      <td class="text-right">${p.stock_minimo || 0}</td>
      <td class="text-right">${p.stock_maximo || 0}</td>
      <td>${p.activo ? 'Activo' : 'Inactivo'}</td>
      <td>
        <button onclick="window.showProductoModal('${p.id}')" class="btn btn-secondary" style="padding:2px 7px;">✏️</button>
        <button onclick="window.toggleProductoActivo('${p.id}', ${!p.activo})" class="btn btn-danger" style="padding:2px 7px;">${p.activo ? '❌' : '✅'}</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

// MODAL DE PRODUCTO
window.showProductoModal = function(productoId = null) {
  let prod = productoId ? inventarioProductos.find(p => p.id === productoId) : {};
  let modal = document.getElementById('modal-bg');
  modal.innerHTML = `
    <div class="modal">
      <h4>${productoId ? 'Editar Producto' : 'Nuevo Producto'}</h4>
      <input id="prodNombre" class="input" placeholder="Nombre" value="${prod?.nombre || ''}" />
      <input id="prodCodigo" class="input" placeholder="Código de barras" value="${prod?.codigo_barras || ''}" />
      <select id="prodCategoria" class="input">
        <option value="">Categoría</option>
        ${categoriasCache.map(cat => `<option value="${cat.id}" ${prod?.categoria_id === cat.id ? 'selected' : ''}>${cat.nombre}</option>`).join('')}
      </select>
      <select id="prodProveedor" class="input">
        <option value="">Proveedor</option>
        ${proveedoresCache.map(prov => `<option value="${prov.id}" ${prod?.proveedor_id === prov.id ? 'selected' : ''}>${prov.nombre}</option>`).join('')}
      </select>
      <input id="prodPrecio" type="number" class="input" placeholder="Precio compra" value="${prod?.precio || ''}" />
      <input id="prodPrecioVenta" type="number" class="input" placeholder="Precio venta" value="${prod?.precio_venta || ''}" />
      <input id="prodStock" type="number" class="input" placeholder="Stock inicial" value="${prod?.stock_actual || ''}" />
      <input id="prodStockMin" type="number" class="input" placeholder="Stock mínimo" value="${prod?.stock_minimo || ''}" />
      <input id="prodStockMax" type="number" class="input" placeholder="Stock máximo" value="${prod?.stock_maximo || ''}" />
      <div style="display:flex;gap:10px;">
        <button id="btnSaveProducto" class="btn">${productoId ? 'Actualizar' : 'Crear'}</button>
        <button onclick="window.closeProductoModal()" class="btn btn-secondary">Cancelar</button>
      </div>
    </div>`;
  modal.classList.add('active');
  document.getElementById('btnSaveProducto').onclick = () => saveProducto(productoId);
}
window.closeProductoModal = function() {
  let modal = document.getElementById('modal-bg');
  modal.classList.remove('active');
  modal.innerHTML = '';
}
window.saveProducto = async function(productoId) {
  const datos = {
    hotel_id: currentHotelId,
    nombre: document.getElementById('prodNombre').value,
    codigo_barras: document.getElementById('prodCodigo').value,
    categoria_id: document.getElementById('prodCategoria').value,
    proveedor_id: document.getElementById('prodProveedor').value,
    precio: Number(document.getElementById('prodPrecio').value),
    precio_venta: Number(document.getElementById('prodPrecioVenta').value),
    stock_actual: Number(document.getElementById('prodStock').value),
    stock_minimo: Number(document.getElementById('prodStockMin').value),
    stock_maximo: Number(document.getElementById('prodStockMax').value),
    activo: true,
    actualizado_en: new Date().toISOString(),
  };
  if (productoId) {
    await currentSupabaseInstance.from('productos_tienda').update(datos).eq('id', productoId);
  } else {
    datos.creado_en = new Date().toISOString();
    await currentSupabaseInstance.from('productos_tienda').insert([datos]);
  }
  closeProductoModal();
  await cargarInventario();
}
window.toggleProductoActivo = async function(productoId, activo) {
  await currentSupabaseInstance.from('productos_tienda').update({ activo }).eq('id', productoId);
  await cargarInventario();
};

// --- PROVEEDORES ---
async function cargarProveedores() {
  let el = currentContainerEl.querySelector('#tab-proveedores');
  el.innerHTML = `<div>Cargando proveedores...</div>`;
  let { data } = await currentSupabaseInstance.from('proveedores')
    .select('*')
    .eq('hotel_id', currentHotelId);
  proveedoresList = data || [];
  renderProveedores(el);
}
function renderProveedores(el) {
  el.innerHTML = `
    <h3>Proveedores</h3>
    <div style="margin-bottom:7px;">
      <button class="btn" id="btnAddProveedor">Agregar Proveedor</button>
      <input id="buscarProveedor" class="input" style="width:190px;display:inline-block;margin-left:14px;" placeholder="Buscar...">
    </div>
    <div style="overflow-x:auto;">
      <table class="table">
        <thead><tr>
          <th>Nombre</th><th>Contacto</th><th>Teléfono</th><th>Email</th><th>NIT</th><th>Estado</th><th>Acciones</th>
        </tr></thead>
        <tbody id="tbodyProveedores"></tbody>
      </table>
    </div>
  `;
  document.getElementById('btnAddProveedor').onclick = () => showProveedorModal();
  document.getElementById('buscarProveedor').oninput = e => renderProveedoresTabla(e.target.value);
  renderProveedoresTabla();
}
function renderProveedoresTabla(filtro = '') {
  let tbody = document.getElementById('tbodyProveedores');
  if (!tbody) return;
  let lista = proveedoresList;
  if (filtro.trim() !== '') lista = lista.filter(p => p.nombre.toLowerCase().includes(filtro.toLowerCase()));
  tbody.innerHTML = '';
  lista.forEach(p => {
    let tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.nombre}</td>
      <td>${p.contacto_nombre || ''}</td>
      <td>${p.telefono || ''}</td>
      <td>${p.email || ''}</td>
      <td>${p.nit || ''}</td>
      <td>${p.activo ? 'Activo' : 'Inactivo'}</td>
      <td>
        <button onclick="window.showProveedorModal('${p.id}')" class="btn btn-secondary" style="padding:2px 7px;">✏️</button>
        <button onclick="window.toggleProveedorActivo('${p.id}', ${!p.activo})" class="btn btn-danger" style="padding:2px 7px;">${p.activo ? '❌' : '✅'}</button>
      </td>`;
    tbody.appendChild(tr);
  });
}
window.showProveedorModal = function(proveedorId = null) {
  let prov = proveedorId ? proveedoresList.find(p => p.id === proveedorId) : {};
  let modal = document.getElementById('modal-bg');
  modal.innerHTML = `
    <div class="modal">
      <h4>${proveedorId ? 'Editar Proveedor' : 'Nuevo Proveedor'}</h4>
      <input id="provNombre" class="input" placeholder="Nombre" value="${prov?.nombre || ''}" />
      <input id="provContacto" class="input" placeholder="Nombre de contacto" value="${prov?.contacto_nombre || ''}" />
      <input id="provTelefono" class="input" placeholder="Teléfono" value="${prov?.telefono || ''}" />
      <input id="provEmail" class="input" placeholder="Email" value="${prov?.email || ''}" />
      <input id="provNIT" class="input" placeholder="NIT/RUT" value="${prov?.nit || ''}" />
      <div style="display:flex;gap:10px;">
        <button id="btnSaveProveedor" class="btn">${proveedorId ? 'Actualizar' : 'Crear'}</button>
        <button onclick="window.closeProveedorModal()" class="btn btn-secondary">Cancelar</button>
      </div>
    </div>`;
  modal.classList.add('active');
  document.getElementById('btnSaveProveedor').onclick = () => saveProveedor(proveedorId);
}
window.closeProveedorModal = function() {
  let modal = document.getElementById('modal-bg');
  modal.classList.remove('active');
  modal.innerHTML = '';
}
window.saveProveedor = async function(proveedorId) {
  const datos = {
    hotel_id: currentHotelId,
    nombre: document.getElementById('provNombre').value,
    contacto_nombre: document.getElementById('provContacto').value,
    telefono: document.getElementById('provTelefono').value,
    email: document.getElementById('provEmail').value,
    nit: document.getElementById('provNIT').value,
    activo: true,
    actualizado_en: new Date().toISOString(),
  };
  if (proveedorId) {
    await currentSupabaseInstance.from('proveedores').update(datos).eq('id', proveedorId);
  } else {
    datos.creado_en = new Date().toISOString();
    await currentSupabaseInstance.from('proveedores').insert([datos]);
  }
  closeProveedorModal();
  await cargarProveedores();
}
window.toggleProveedorActivo = async function(proveedorId, activo) {
  await currentSupabaseInstance.from('proveedores').update({ activo }).eq('id', proveedorId);
  await cargarProveedores();
};

// --- CATEGORÍAS ---
async function cargarCategorias() {
  let el = currentContainerEl.querySelector('#tab-categorias');
  el.innerHTML = `<div>Cargando categorías...</div>`;
  let { data } = await currentSupabaseInstance.from('categorias_producto')
    .select('*')
    .eq('hotel_id', currentHotelId);
  categoriasList = data || [];
  renderCategorias(el);
}
function renderCategorias(el) {
  el.innerHTML = `
    <h3>Categorías</h3>
    <div style="margin-bottom:7px;">
      <button class="btn" id="btnAddCategoria">Agregar Categoría</button>
      <input id="buscarCategoria" class="input" style="width:190px;display:inline-block;margin-left:14px;" placeholder="Buscar...">
    </div>
    <div style="overflow-x:auto;">
      <table class="table">
        <thead><tr>
          <th>Nombre</th><th>Descripción</th><th>Estado</th><th>Acciones</th>
        </tr></thead>
        <tbody id="tbodyCategorias"></tbody>
      </table>
    </div>
  `;
  document.getElementById('btnAddCategoria').onclick = () => showCategoriaModal();
  document.getElementById('buscarCategoria').oninput = e => renderCategoriasTabla(e.target.value);
  renderCategoriasTabla();
}
function renderCategoriasTabla(filtro = '') {
  let tbody = document.getElementById('tbodyCategorias');
  if (!tbody) return;
  let lista = categoriasList;
  if (filtro.trim() !== '') lista = lista.filter(c => c.nombre.toLowerCase().includes(filtro.toLowerCase()));
  tbody.innerHTML = '';
  lista.forEach(c => {
    let tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.nombre}</td>
      <td>${c.descripcion || ''}</td>
      <td>${c.activa ? 'Activa' : 'Inactiva'}</td>
      <td>
        <button onclick="window.showCategoriaModal('${c.id}')" class="btn btn-secondary" style="padding:2px 7px;">✏️</button>
        <button onclick="window.toggleCategoriaActiva('${c.id}', ${!c.activa})" class="btn btn-danger" style="padding:2px 7px;">${c.activa ? '❌' : '✅'}</button>
      </td>`;
    tbody.appendChild(tr);
  });
}
window.showCategoriaModal = function(categoriaId = null) {
  let cat = categoriaId ? categoriasList.find(c => c.id === categoriaId) : {};
  let modal = document.getElementById('modal-bg');
  modal.innerHTML = `
    <div class="modal">
      <h4>${categoriaId ? 'Editar Categoría' : 'Nueva Categoría'}</h4>
      <input id="catNombre" class="input" placeholder="Nombre" value="${cat?.nombre || ''}" />
      <input id="catDesc" class="input" placeholder="Descripción" value="${cat?.descripcion || ''}" />
      <div style="display:flex;gap:10px;">
        <button id="btnSaveCategoria" class="btn">${categoriaId ? 'Actualizar' : 'Crear'}</button>
        <button onclick="window.closeCategoriaModal()" class="btn btn-secondary">Cancelar</button>
      </div>
    </div>`;
  modal.classList.add('active');
  document.getElementById('btnSaveCategoria').onclick = () => saveCategoria(categoriaId);
}
window.closeCategoriaModal = function() {
  let modal = document.getElementById('modal-bg');
  modal.classList.remove('active');
  modal.innerHTML = '';
}
window.saveCategoria = async function(categoriaId) {
  const datos = {
    hotel_id: currentHotelId,
    nombre: document.getElementById('catNombre').value,
    descripcion: document.getElementById('catDesc').value,
    activa: true,
    actualizado_en: new Date().toISOString(),
  };
  if (categoriaId) {
    await currentSupabaseInstance.from('categorias_producto').update(datos).eq('id', categoriaId);
  } else {
    datos.creado_en = new Date().toISOString();
    await currentSupabaseInstance.from('categorias_producto').insert([datos]);
  }
  closeCategoriaModal();
  await cargarCategorias();
}
window.toggleCategoriaActiva = async function(categoriaId, activa) {
  await currentSupabaseInstance.from('categorias_producto').update({ activa }).eq('id', categoriaId);
  await cargarCategorias();
};

// --- LISTA DE COMPRA ---
async function cargarListaCompra() {
  let el = currentContainerEl.querySelector('#tab-lista-compra');
  el.innerHTML = `<div>Cargando lista de compra...</div>`;
  let { data } = await currentSupabaseInstance
    .from('productos_tienda')
    .select('*, proveedores(nombre)')
    .eq('hotel_id', currentHotelId)
    .eq('activo', true);
  comprasSugeridas = (data || []).filter(p => p.stock_actual < p.stock_minimo && p.stock_maximo);
  renderListaCompra(el);
}
function renderListaCompra(el) {
  el.innerHTML = `
    <h3>Lista de Compra Sugerida</h3>
    <div style="overflow-x:auto;">
      <table class="table">
        <thead><tr>
          <th>Producto</th><th>Proveedor</th><th>Stock actual</th><th>Stock mín</th><th>Stock máx</th><th>Sugerir comprar</th>
        </tr></thead>
        <tbody>
          ${comprasSugeridas.map(p =>
            `<tr>
              <td>${p.nombre}</td>
              <td>${p.proveedores?.nombre || ''}</td>
              <td>${p.stock_actual || 0}</td>
              <td>${p.stock_minimo || 0}</td>
              <td>${p.stock_maximo || 0}</td>
              <td>${(p.stock_maximo && p.stock_actual < p.stock_maximo) ? (p.stock_maximo - p.stock_actual) : ''}</td>
            </tr>`
          ).join('')}
        </tbody>
      </table>
    </div>
  `;
}

