// ==================== MODULO TIENDA COMPLETO ====================
// Este archivo implementa: POS, Inventario, Categorías, Proveedores, Lista de Compras
// Compatible con tu estructura de base de datos y sin Tailwind

// --- Estado global del módulo
let currentContainerEl = null;
let currentSupabase = null;
let currentUser = null;
let currentHotelId = null;

// --- Memorias auxiliares
let categoriasCache = [];
let proveedoresCache = [];
let productosCache = [];

// ---------  MONTAJE PRINCIPAL Y NAVEGACION DE PESTAÑAS ----------
export async function mount(container, supabase, user, hotelId) {
  currentContainerEl = container;
  currentSupabase = supabase;
  currentUser = user;
  currentHotelId = hotelId || user?.user_metadata?.hotel_id;

  renderTiendaTabs('POS'); // Muestra pestaña inicial POS

  // Evento para navegación de tabs
  window.onTabTiendaClick = (tab) => renderTiendaTabs(tab);
}

// Renderizador principal con pestañas visuales
function renderTiendaTabs(tab) {
  currentContainerEl.innerHTML = `
    <div style="border-bottom:1px solid #ddd;margin-bottom:10px;display:flex;gap:6px;">
      ${['POS','Inventario','Categorías','Proveedores','Lista de Compras'].map(t =>
        `<button onclick="onTabTiendaClick('${t}')" style="
          padding:7px 16px;
          background:${t===tab?'#337ab7':'#f7f7f7'};
          color:${t===tab?'#fff':'#333'};
          border:none;
          border-bottom:${t===tab?'2px solid #337ab7':'none'};
          border-radius:4px 4px 0 0;
          font-weight:${t===tab?'bold':'normal'};
          cursor:pointer;
        ">${t}</button>`
      ).join('')}
    </div>
    <div id="contenidoTiendaTab"></div>
  `;
  if(tab === 'POS') renderPOS();
  if(tab === 'Inventario') renderInventario();
  if(tab === 'Categorías') renderCategorias();
  if(tab === 'Proveedores') renderProveedores();
  if(tab === 'Lista de Compras') renderListaCompras();
}

// ====================  PESTAÑA POS  ====================

let posProductos = [];
let posMetodosPago = [];
let posReservas = [];
let posCarrito = [];

async function renderPOS() {
  const cont = document.getElementById('contenidoTiendaTab');
  cont.innerHTML = `<div>Cargando...</div>`;
  // Carga productos, métodos de pago, reservas
  await cargarDatosPOS();

  // Renderiza la interfaz
  cont.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:18px;">
      <div style="flex:1;min-width:300px;">
        <h4>Productos disponibles</h4>
        <div id="productosPOS" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;"></div>
      </div>
      <div style="min-width:320px;">
        <h4>Carrito de venta</h4>
        <table style="width:100%;font-size:13px;margin-bottom:8px;">
          <thead>
            <tr style="background:#f1f1f1;"><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th><th></th></tr>
          </thead>
          <tbody id="carritoPOS"></tbody>
        </table>
        <div style="text-align:right;font-weight:bold;">Total: <span id="totalPOS">$0</span></div>
        <div style="display:flex;gap:6px;margin:10px 0;">
          <select id="modoPOS" style="flex:1;">
            <option value="inmediato">Pago Inmediato</option>
            <option value="habitacion">Cargar a Habitación</option>
          </select>
          <select id="metodoPOS" style="flex:1;"></select>
          <select id="reservaPOS" style="flex:1;display:none"></select>
          <input id="clientePOS" placeholder="Cliente (opcional)" style="flex:1;" />
          <button id="btnVentaPOS" style="background:#4CAF50;color:#fff;border:none;padding:6px 12px;border-radius:4px;">Vender</button>
        </div>
        <div id="msgPOS" style="color:red;"></div>
      </div>
    </div>
  `;

  renderProductosPOS();
  renderCarritoPOS();
  renderMetodosPagoPOS();
  renderReservasPOS();

  document.getElementById('modoPOS').onchange = (e)=>{
    document.getElementById('metodoPOS').style.display = e.target.value==='inmediato'?'block':'none';
    document.getElementById('clientePOS').style.display = e.target.value==='inmediato'?'block':'none';
    document.getElementById('reservaPOS').style.display = e.target.value==='habitacion'?'block':'none';
  };
  document.getElementById('btnVentaPOS').onclick = registrarVentaPOS;
}

// ----- Cargar datos POS -----
async function cargarDatosPOS() {
  // Productos disponibles para venta
  let {data: productos} = await currentSupabase
    .from('productos_tienda')
    .select('id, nombre, precio_venta, imagen_url, stock_actual, categoria_id')
    .eq('hotel_id', currentHotelId)
    .eq('activo', true)
    .gt('stock_actual', 0);
  posProductos = productos || [];

  // Métodos de pago
  let {data: metodos} = await currentSupabase
    .from('metodos_pago')
    .select('id, nombre')
    .eq('hotel_id', currentHotelId)
    .eq('activo', true);
  posMetodosPago = metodos || [];

  // Reservas activas para cargar a habitación
  let {data: reservas} = await currentSupabase
    .from('reservas')
    .select('id, cliente_nombre')
    .eq('hotel_id', currentHotelId)
    .eq('estado', 'check_in');
  posReservas = reservas || [];
}

// ----- Renderizar productos POS -----
function renderProductosPOS() {
  const cont = document.getElementById('productosPOS');
  cont.innerHTML = '';
  posProductos.forEach(prod => {
    let card = document.createElement('div');
    card.style = "border:1px solid #e1e1e1;padding:8px;border-radius:7px;background:#fff;min-width:140px;max-width:160px;text-align:center;box-shadow:1px 2px 6px #eee;";
    card.innerHTML = `
      <div style="font-weight:bold;">${prod.nombre}</div>
      <div style="font-size:13px;color:#0a5;">$${prod.precio_venta}</div>
      <div style="font-size:12px;color:#666;">Stock: ${prod.stock_actual}</div>
      <button onclick="window.addToCartPOS('${prod.id}')" style="margin-top:5px;background:#337ab7;color:#fff;border:none;padding:4px 10px;border-radius:3px;cursor:pointer;">Agregar</button>
    `;
    cont.appendChild(card);
  });
}

window.addToCartPOS = (id)=>{
  const prod = posProductos.find(p=>p.id===id);
  if(!prod) return;
  let item = posCarrito.find(i=>i.id===id);
  if(item){
    if(item.cantidad < prod.stock_actual) item.cantidad++;
  }else{
    posCarrito.push({...prod, cantidad:1});
  }
  renderCarritoPOS();
};

// ----- Renderizar carrito POS -----
function renderCarritoPOS() {
  const tbody = document.getElementById('carritoPOS');
  tbody.innerHTML = '';
  let total = 0;
  posCarrito.forEach(item => {
    const subtotal = item.cantidad * item.precio_venta;
    total += subtotal;
    let tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.nombre}</td>
      <td>
        <input type="number" min="1" max="${item.stock_actual}" value="${item.cantidad}" style="width:40px;"
          onchange="window.updateQtyPOS('${item.id}',this.value)">
      </td>
      <td>$${item.precio_venta}</td>
      <td>$${subtotal}</td>
      <td><button onclick="window.removeCartPOS('${item.id}')" style="color:#e11;">X</button></td>
    `;
    tbody.appendChild(tr);
  });
  document.getElementById('totalPOS').textContent = `$${total}`;
}

window.updateQtyPOS = (id, val)=>{
  let item = posCarrito.find(i=>i.id===id);
  if(item){
    let v = parseInt(val);
    if(v>0 && v<=item.stock_actual) item.cantidad=v;
    renderCarritoPOS();
  }
};
window.removeCartPOS = (id)=>{
  posCarrito = posCarrito.filter(i=>i.id!==id);
  renderCarritoPOS();
};

// ----- Render métodos de pago y reservas POS -----
function renderMetodosPagoPOS() {
  let sel = document.getElementById('metodoPOS');
  sel.innerHTML = '';
  posMetodosPago.forEach(m=>{
    let opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.nombre;
    sel.appendChild(opt);
  });
}
function renderReservasPOS() {
  let sel = document.getElementById('reservaPOS');
  sel.innerHTML = '';
  posReservas.forEach(r=>{
    let opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.cliente_nombre;
    sel.appendChild(opt);
  });
}

// ----- Registrar venta -----
async function registrarVentaPOS() {
  try {
    if(posCarrito.length === 0) {
      document.getElementById('msgPOS').textContent = "Carrito vacío";
      return;
    }
    const modo = document.getElementById('modoPOS').value;
    let metodo_pago_id = null, reserva_id = null, cliente_temporal = null;
    if(modo === 'inmediato') {
      metodo_pago_id = document.getElementById('metodoPOS').value;
      cliente_temporal = document.getElementById('clientePOS').value || null;
    } else {
      reserva_id = document.getElementById('reservaPOS').value;
    }
    let total = posCarrito.reduce((a,b)=>a+b.precio_venta*b.cantidad,0);

    // Crear venta_tienda (principal)
    let {data: ventas, error} = await currentSupabase.from('ventas_tienda').insert([{
      hotel_id: currentHotelId,
      usuario_id: currentUser.id,
      reserva_id,
      metodo_pago_id,
      cliente_temporal,
      total_venta: total,
      fecha: new Date().toISOString(),
      creado_en: new Date().toISOString()
    }]).select();
    if(error || !ventas?.[0]) throw new Error("Error guardando venta");
    let ventaId = ventas[0].id;

    // Detalle y stock
    for(let item of posCarrito){
      await currentSupabase.from('detalle_ventas_tienda').insert([{
        venta_id: ventaId,
        producto_id: item.id,
        cantidad: item.cantidad,
        precio_unitario_venta: item.precio_venta,
        subtotal: item.cantidad*item.precio_venta,
        hotel_id: currentHotelId,
        creado_en: new Date().toISOString()
      }]);
      // Descuenta stock_actual
      await currentSupabase.from('productos_tienda').update({
        stock_actual: item.stock_actual-item.cantidad
      }).eq('id',item.id);
    }
    // Caja
    await currentSupabase.from('caja').insert([{
      hotel_id: currentHotelId,
      tipo: 'ingreso',
      monto: total,
      concepto: 'Venta de tienda',
      fecha_movimiento: new Date().toISOString(),
      metodo_pago_id: metodo_pago_id || null,
      usuario_id: currentUser.id,
      venta_tienda_id: ventaId,
      creado_en: new Date().toISOString()
    }]);
    // Limpia
    posCarrito = [];
    renderCarritoPOS();
    await cargarDatosPOS();
    renderProductosPOS();
    document.getElementById('msgPOS').textContent = "¡Venta registrada!";
    setTimeout(()=>{document.getElementById('msgPOS').textContent="";},1700);

  }catch(err){
    document.getElementById('msgPOS').textContent = err.message;
  }
}

// ===================  AQUÍ VA LA SEGUNDA PARTE  ===================
// ====================  PESTAÑA INVENTARIO  ====================
let inventarioProductos = [];

async function renderInventario() {
  const cont = document.getElementById('contenidoTiendaTab');
  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <h4>Inventario de Productos</h4>
      <button id="btnNuevoProducto" style="background:#337ab7;color:#fff;padding:6px 14px;border:none;border-radius:4px;">Agregar Producto</button>
    </div>
    <input id="buscarInventario" placeholder="Buscar producto..." style="width:230px;margin-bottom:10px;"/>
    <div style="overflow-x:auto;">
      <table style="width:100%;font-size:13px;border:1px solid #eee;">
        <thead>
          <tr style="background:#f7f7f7;">
            <th>Nombre</th>
            <th>Código</th>
            <th>Categoría</th>
            <th>Proveedor</th>
            <th>Precio Compra</th>
            <th>Precio Venta</th>
            <th>Stock Actual</th>
            <th>Stock Mín</th>
            <th>Stock Máx</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody id="invProductos"></tbody>
      </table>
    </div>
    <div id="modalProductoInv" style="display:none"></div>
  `;
  document.getElementById('btnNuevoProducto').onclick = ()=>showModalProducto();
  document.getElementById('buscarInventario').oninput = (e)=>renderTablaInventario(e.target.value);

  await cargarProductosInventario();
  await cargarCategoriasYProveedores();
  renderTablaInventario('');
}

async function cargarProductosInventario() {
  let {data} = await currentSupabase
    .from('productos_tienda')
    .select('*, categorias_producto(nombre), proveedores(nombre)')
    .eq('hotel_id', currentHotelId);
  inventarioProductos = data || [];
}

async function cargarCategoriasYProveedores() {
  let {data: cat} = await currentSupabase
    .from('categorias_producto')
    .select('id, nombre')
    .eq('hotel_id', currentHotelId)
    .eq('activa', true);
  categoriasCache = cat || [];
  let {data: prov} = await currentSupabase
    .from('proveedores')
    .select('id, nombre')
    .eq('hotel_id', currentHotelId)
    .eq('activo', true);
  proveedoresCache = prov || [];
}

function renderTablaInventario(filtro = '') {
  let tbody = document.getElementById('invProductos');
  if (!tbody) return;
  let lista = inventarioProductos;
  if(filtro && filtro.trim()) {
    lista = lista.filter(p => (p.nombre||'').toLowerCase().includes(filtro.toLowerCase()));
  }
  tbody.innerHTML = '';
  lista.forEach(p => {
    let categoria = categoriasCache.find(cat=>cat.id===p.categoria_id)?.nombre || '';
    let proveedor = proveedoresCache.find(pr=>pr.id===p.proveedor_id)?.nombre || '';
    let tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.nombre}</td>
      <td>${p.codigo_barras||''}</td>
      <td>${categoria}</td>
      <td>${proveedor}</td>
      <td>$${p.precio||0}</td>
      <td>$${p.precio_venta||0}</td>
      <td>${p.stock_actual||0}</td>
      <td>${p.stock_minimo||0}</td>
      <td>${p.stock_maximo||0}</td>
      <td>${p.activo ? 'Activo' : 'Inactivo'}</td>
      <td>
        <button onclick="window.showModalProducto('${p.id}')">✏️</button>
        <button onclick="window.toggleActivoProducto('${p.id}',${!p.activo})">${p.activo?'❌':'✅'}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.showModalProducto = showModalProducto;
async function showModalProducto(productoId = null) {
  let modal = document.getElementById('modalProductoInv');
  let prod = productoId ? inventarioProductos.find(p=>p.id===productoId) : null;
  modal.style.display = 'block';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:7px;box-shadow:2px 3px 12px #2225;max-width:400px;margin:auto;padding:30px;position:relative;">
      <button onclick="window.closeModalProducto()" style="position:absolute;right:10px;top:6px;background:none;font-size:18px;">&times;</button>
      <h4 style="margin-bottom:18px;">${productoId ? 'Editar' : 'Nuevo'} Producto</h4>
      <input id="prodNombre" placeholder="Nombre" value="${prod?.nombre||''}" style="width:100%;margin-bottom:8px;"/>
      <input id="prodCodigo" placeholder="Código de barras" value="${prod?.codigo_barras||''}" style="width:100%;margin-bottom:8px;"/>
      <select id="prodCategoria" style="width:100%;margin-bottom:8px;">
        <option value="">Categoría</option>
        ${categoriasCache.map(cat=>`<option value="${cat.id}"${prod?.categoria_id===cat.id?' selected':''}>${cat.nombre}</option>`).join('')}
      </select>
      <select id="prodProveedor" style="width:100%;margin-bottom:8px;">
        <option value="">Proveedor</option>
        ${proveedoresCache.map(prov=>`<option value="${prov.id}"${prod?.proveedor_id===prov.id?' selected':''}>${prov.nombre}</option>`).join('')}
      </select>
      <input id="prodPrecio" type="number" placeholder="Precio compra" value="${prod?.precio||''}" style="width:100%;margin-bottom:8px;" />
      <input id="prodPrecioVenta" type="number" placeholder="Precio venta" value="${prod?.precio_venta||''}" style="width:100%;margin-bottom:8px;" />
      <input id="prodStock" type="number" placeholder="Stock actual" value="${prod?.stock_actual||''}" style="width:100%;margin-bottom:8px;" />
      <input id="prodStockMin" type="number" placeholder="Stock mínimo" value="${prod?.stock_minimo||''}" style="width:100%;margin-bottom:8px;" />
      <input id="prodStockMax" type="number" placeholder="Stock máximo" value="${prod?.stock_maximo||''}" style="width:100%;margin-bottom:8px;" />
      <input id="prodImagenUrl" placeholder="URL Imagen (opcional)" value="${prod?.imagen_url||''}" style="width:100%;margin-bottom:8px;" />
      <textarea id="prodDescripcion" placeholder="Descripción" style="width:100%;margin-bottom:8px;">${prod?.descripcion||''}</textarea>
      <div style="margin-top:8px;text-align:right;">
        <button id="btnGuardarProducto" style="background:#4CAF50;color:#fff;padding:7px 15px;border:none;border-radius:4px;">${productoId?'Actualizar':'Crear'}</button>
      </div>
    </div>
  `;
  document.getElementById('btnGuardarProducto').onclick = ()=>saveProductoInv(productoId);
}

window.closeModalProducto = ()=>{document.getElementById('modalProductoInv').style.display='none';};

async function saveProductoInv(productoId) {
  let datos = {
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
    imagen_url: document.getElementById('prodImagenUrl').value,
    descripcion: document.getElementById('prodDescripcion').value,
    activo: true,
    actualizado_en: new Date().toISOString(),
  };
  if(productoId) {
    await currentSupabase.from('productos_tienda').update(datos).eq('id',productoId);
  } else {
    datos.creado_en = new Date().toISOString();
    await currentSupabase.from('productos_tienda').insert([datos]);
  }
  closeModalProducto();
  await cargarProductosInventario();
  renderTablaInventario('');
}

window.toggleActivoProducto = async (id,act)=>{
  await currentSupabase.from('productos_tienda').update({activo:act}).eq('id',id);
  await cargarProductosInventario();
  renderTablaInventario('');
};

// ====================  PESTAÑA CATEGORÍAS  ====================
let categoriasLista = [];
async function renderCategorias() {
  const cont = document.getElementById('contenidoTiendaTab');
  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <h4>Categorías de Productos</h4>
      <button id="btnNuevaCategoria" style="background:#337ab7;color:#fff;padding:6px 14px;border:none;border-radius:4px;">Agregar Categoría</button>
    </div>
    <table style="width:100%;font-size:14px;border:1px solid #eee;">
      <thead>
        <tr style="background:#f7f7f7;">
          <th>Nombre</th>
          <th>Descripción</th>
          <th>Estado</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody id="bodyCategorias"></tbody>
    </table>
    <div id="modalCategoria" style="display:none"></div>
  `;
  document.getElementById('btnNuevaCategoria').onclick = ()=>showModalCategoria();

  await cargarCategorias();
  renderTablaCategorias();
}
async function cargarCategorias() {
  let {data} = await currentSupabase
    .from('categorias_producto')
    .select('*')
    .eq('hotel_id', currentHotelId);
  categoriasLista = data || [];
}
function renderTablaCategorias() {
  let tbody = document.getElementById('bodyCategorias');
  tbody.innerHTML = '';
  categoriasLista.forEach(cat => {
    let tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${cat.nombre}</td>
      <td>${cat.descripcion||''}</td>
      <td>${cat.activa?'Activa':'Inactiva'}</td>
      <td>
        <button onclick="window.showModalCategoria('${cat.id}')">✏️</button>
        <button onclick="window.toggleEstadoCategoria('${cat.id}',${!cat.activa})">${cat.activa?'❌':'✅'}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}
window.showModalCategoria = showModalCategoria;
async function showModalCategoria(categoriaId=null) {
  let modal = document.getElementById('modalCategoria');
  let cat = categoriaId ? categoriasLista.find(c=>c.id===categoriaId) : null;
  modal.style.display = 'block';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:7px;box-shadow:2px 3px 12px #2225;max-width:340px;margin:auto;padding:24px;position:relative;">
      <button onclick="window.closeModalCategoria()" style="position:absolute;right:8px;top:4px;background:none;font-size:18px;">&times;</button>
      <h4>${categoriaId?'Editar':'Nueva'} Categoría</h4>
      <input id="catNombre" placeholder="Nombre" value="${cat?.nombre||''}" style="width:100%;margin-bottom:8px;" />
      <input id="catDescripcion" placeholder="Descripción" value="${cat?.descripcion||''}" style="width:100%;margin-bottom:8px;" />
      <div style="margin-top:8px;text-align:right;">
        <button id="btnGuardarCategoria" style="background:#4CAF50;color:#fff;padding:7px 15px;border:none;border-radius:4px;">${categoriaId?'Actualizar':'Crear'}</button>
      </div>
    </div>
  `;
  document.getElementById('btnGuardarCategoria').onclick = ()=>saveCategoria(categoriaId);
}
window.closeModalCategoria = ()=>{document.getElementById('modalCategoria').style.display='none';};
async function saveCategoria(categoriaId){
  let datos = {
    hotel_id: currentHotelId,
    nombre: document.getElementById('catNombre').value,
    descripcion: document.getElementById('catDescripcion').value,
    activa: true,
    actualizado_en: new Date().toISOString(),
  };
  if(categoriaId){
    await currentSupabase.from('categorias_producto').update(datos).eq('id',categoriaId);
  }else{
    datos.creado_en = new Date().toISOString();
    await currentSupabase.from('categorias_producto').insert([datos]);
  }
  closeModalCategoria();
  await cargarCategorias();
  renderTablaCategorias();
}
window.toggleEstadoCategoria = async (id,act)=>{
  await currentSupabase.from('categorias_producto').update({activa:act}).eq('id',id);
  await cargarCategorias();
  renderTablaCategorias();
};

// ====================  PESTAÑA PROVEEDORES  ====================
let proveedoresLista = [];
async function renderProveedores() {
  const cont = document.getElementById('contenidoTiendaTab');
  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <h4>Proveedores</h4>
      <button id="btnNuevoProveedor" style="background:#337ab7;color:#fff;padding:6px 14px;border:none;border-radius:4px;">Agregar Proveedor</button>
    </div>
    <table style="width:100%;font-size:14px;border:1px solid #eee;">
      <thead>
        <tr style="background:#f7f7f7;">
          <th>Nombre</th>
          <th>Contacto</th>
          <th>Teléfono</th>
          <th>Email</th>
          <th>NIT</th>
          <th>Estado</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody id="bodyProveedores"></tbody>
    </table>
    <div id="modalProveedor" style="display:none"></div>
  `;
  document.getElementById('btnNuevoProveedor').onclick = ()=>showModalProveedor();

  await cargarProveedores();
  renderTablaProveedores();
}
async function cargarProveedores(){
  let {data} = await currentSupabase
    .from('proveedores')
    .select('*')
    .eq('hotel_id', currentHotelId);
  proveedoresLista = data || [];
}
function renderTablaProveedores(){
  let tbody = document.getElementById('bodyProveedores');
  tbody.innerHTML = '';
  proveedoresLista.forEach(pr=>{
    let tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${pr.nombre}</td>
      <td>${pr.contacto_nombre||''}</td>
      <td>${pr.telefono||''}</td>
      <td>${pr.email||''}</td>
      <td>${pr.nit||''}</td>
      <td>${pr.activo?'Activo':'Inactivo'}</td>
      <td>
        <button onclick="window.showModalProveedor('${pr.id}')">✏️</button>
        <button onclick="window.toggleEstadoProveedor('${pr.id}',${!pr.activo})">${pr.activo?'❌':'✅'}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}
window.showModalProveedor = showModalProveedor;
async function showModalProveedor(proveedorId=null){
  let modal = document.getElementById('modalProveedor');
  let pr = proveedorId ? proveedoresLista.find(p=>p.id===proveedorId):null;
  modal.style.display = 'block';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:7px;box-shadow:2px 3px 12px #2225;max-width:370px;margin:auto;padding:24px;position:relative;">
      <button onclick="window.closeModalProveedor()" style="position:absolute;right:8px;top:4px;background:none;font-size:18px;">&times;</button>
      <h4>${proveedorId?'Editar':'Nuevo'} Proveedor</h4>
      <input id="provNombre" placeholder="Nombre" value="${pr?.nombre||''}" style="width:100%;margin-bottom:8px;" />
      <input id="provContacto" placeholder="Nombre contacto" value="${pr?.contacto_nombre||''}" style="width:100%;margin-bottom:8px;" />
      <input id="provTelefono" placeholder="Teléfono" value="${pr?.telefono||''}" style="width:100%;margin-bottom:8px;" />
      <input id="provEmail" placeholder="Email" value="${pr?.email||''}" style="width:100%;margin-bottom:8px;" />
      <input id="provNIT" placeholder="NIT" value="${pr?.nit||''}" style="width:100%;margin-bottom:8px;" />
      <div style="margin-top:8px;text-align:right;">
        <button id="btnGuardarProveedor" style="background:#4CAF50;color:#fff;padding:7px 15px;border:none;border-radius:4px;">${proveedorId?'Actualizar':'Crear'}</button>
      </div>
    </div>
  `;
  document.getElementById('btnGuardarProveedor').onclick = ()=>saveProveedor(proveedorId);
}
window.closeModalProveedor = ()=>{document.getElementById('modalProveedor').style.display='none';};
async function saveProveedor(proveedorId){
  let datos = {
    hotel_id: currentHotelId,
    nombre: document.getElementById('provNombre').value,
    contacto_nombre: document.getElementById('provContacto').value,
    telefono: document.getElementById('provTelefono').value,
    email: document.getElementById('provEmail').value,
    nit: document.getElementById('provNIT').value,
    activo: true,
    actualizado_en: new Date().toISOString(),
  };
  if(proveedorId){
    await currentSupabase.from('proveedores').update(datos).eq('id',proveedorId);
  }else{
    datos.creado_en = new Date().toISOString();
    await currentSupabase.from('proveedores').insert([datos]);
  }
  closeModalProveedor();
  await cargarProveedores();
  renderTablaProveedores();
}
window.toggleEstadoProveedor = async (id,act)=>{
  await currentSupabase.from('proveedores').update({activo:act}).eq('id',id);
  await cargarProveedores();
  renderTablaProveedores();
};

// ====================  PESTAÑA LISTA DE COMPRAS  ====================
async function renderListaCompras() {
  const cont = document.getElementById('contenidoTiendaTab');
  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <h4>Lista de Compras Sugerida</h4>
      <button id="btnExportarListaCompra" style="background:#337ab7;color:#fff;padding:6px 14px;border:none;border-radius:4px;">Exportar Excel</button>
    </div>
    <table style="width:100%;font-size:14px;border:1px solid #eee;">
      <thead>
        <tr style="background:#f7f7f7;">
          <th>Producto</th>
          <th>Stock Actual</th>
          <th>Stock Mín.</th>
          <th>Stock Máx.</th>
          <th>Faltante</th>
          <th>Proveedor</th>
        </tr>
      </thead>
      <tbody id="bodyListaCompras"></tbody>
    </table>
  `;
  document.getElementById('btnExportarListaCompra').onclick = ()=>alert('Función en desarrollo: exportar a Excel');
  await cargarProductosInventario();
  await cargarCategoriasYProveedores();
  renderTablaListaCompras();
}

function renderTablaListaCompras() {
  let tbody = document.getElementById('bodyListaCompras');
  tbody.innerHTML = '';
  inventarioProductos
    .filter(p=>Number(p.stock_actual)<Number(p.stock_maximo))
    .forEach(p=>{
      let proveedor = proveedoresCache.find(pr=>pr.id===p.proveedor_id)?.nombre||'';
      let faltante = Math.max(0,(Number(p.stock_maximo)||0)-(Number(p.stock_actual)||0));
      let tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.nombre}</td>
        <td>${p.stock_actual||0}</td>
        <td>${p.stock_minimo||0}</td>
        <td>${p.stock_maximo||0}</td>
        <td>${faltante}</td>
        <td>${proveedor}</td>
      `;
      tbody.appendChild(tr);
    });
}

// ====================  FIN DEL MODULO TIENDA ====================

