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
      ${['POS','Inventario','Categorías','Proveedores','Lista de Compras','Compras', 'Compras Pendientes'].map(t =>
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
  if(tab === 'Compras') renderModuloCompras();
  if(tab === 'Compras Pendientes') renderComprasPendientes();

}

// ====================  BLOQUE POS COMPLETO Y CORREGIDO ====================

let posProductos = [];
let posMetodosPago = [];
let posHabitacionesOcupadas = [];
let posCarrito = [];
let posFiltro = '';

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

  // Habitaciones ocupadas desde el mapa de habitaciones (estado: 'ocupada')
  let {data: habitaciones} = await currentSupabase
    .from('habitaciones')
    .select('id, nombre')
    .eq('hotel_id', currentHotelId)
    .eq('estado', 'ocupada');
  posHabitacionesOcupadas = habitaciones || [];
}

// Dentro de tu tienda.js

async function renderPOS() {
  const cont = document.getElementById('contenidoTiendaTab');
  cont.innerHTML = `<div>Cargando...</div>`;
  await cargarDatosPOS(); // Esta función ya la tienes

  // HTML del POS
  cont.innerHTML = `
  <div>
  <input type="text" id="buscadorPOS" placeholder="Buscar producto o categoría..." />
  <div id="productosPOS"></div>
</div>
    <div style="display:flex;flex-wrap:wrap;gap:18px;">
      <div style="flex:1;min-width:340px;max-width:480px;">
        <h4>Productos disponibles</h4>
        <input id="buscadorPOS" placeholder="Buscar producto..." style="width:100%;margin-bottom:8px;padding:6px 12px;font-size:15px;border-radius:4px;border:1px solid #ccc;">
        <div id="productosPOS" style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:10px;"></div>
      </div>
      <div style="min-width:340px;">
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
          <select id="habitacionPOS" style="flex:1;display:none"></select>
          <input id="clientePOS" placeholder="Cliente (opcional)" style="flex:1;" />
          <button id="btnVentaPOS" style="background:#4CAF50;color:#fff;border:none;padding:6px 12px;border-radius:4px;">Vender</button>
        </div>
        <div id="msgPOS" style="color:red;"></div>
      </div>
    </div>
  `;

  // --- MUEVE LA ASIGNACIÓN DE EVENTOS AQUÍ, DESPUÉS DE ESTABLECER innerHTML ---
  const buscadorPOSEl = document.getElementById('buscadorPOS');
  if (buscadorPOSEl) {
    buscadorPOSEl.oninput = (e) => {
      posFiltro = e.target.value.toLowerCase();
      renderProductosPOS();
    };
  } else {
    console.error("Elemento #buscadorPOS no encontrado después de renderizar POS.");
  }

  const modoPOSEl = document.getElementById('modoPOS');
  if (modoPOSEl) {
    modoPOSEl.onchange = (e)=>{
      const modo = e.target.value;
      const metodoPOSEl = document.getElementById('metodoPOS');
      const clientePOSEl = document.getElementById('clientePOS');
      const habitacionPOSEl = document.getElementById('habitacionPOS');

      if (metodoPOSEl) metodoPOSEl.style.display = modo==='inmediato'?'block':'none';
      if (clientePOSEl) clientePOSEl.style.display = modo==='inmediato'?'block':'none';
      if (habitacionPOSEl) habitacionPOSEl.style.display = modo==='habitacion'?'block':'none';
    };
    modoPOSEl.dispatchEvent(new Event('change')); // Para el estado inicial
  } else {
    console.error("Elemento #modoPOS no encontrado.");
  }

  const btnVentaPOSEl = document.getElementById('btnVentaPOS');
  if (btnVentaPOSEl) {
    btnVentaPOSEl.onclick = registrarVentaPOS;
  } else {
    console.error("Elemento #btnVentaPOS no encontrado.");
  }
  // --- FIN DE MOVIMIENTO DE EVENTOS ---


  renderProductosPOS();
  renderCarritoPOS();
  renderMetodosPagoPOS();
  renderHabitacionesPOS();


  document.getElementById('modoPOS').onchange = (e)=>{
    const modo = e.target.value;
    document.getElementById('metodoPOS').style.display = modo==='inmediato'?'block':'none';
    document.getElementById('clientePOS').style.display = modo==='inmediato'?'block':'none';
    document.getElementById('habitacionPOS').style.display = modo==='habitacion'?'block':'none';
  };
  document.getElementById('btnVentaPOS').onclick = registrarVentaPOS;
}

function renderProductosPOS() {
  const cont = document.getElementById('productosPOS');
  if (!cont) {
    console.error('No se encontró el contenedor #productosPOS');
    return;
  }
  cont.innerHTML = '';
  let productosFiltrados = posProductos;
  if (posFiltro && posFiltro.trim()) {
    productosFiltrados = productosFiltrados.filter(p => (p.nombre||'').toLowerCase().includes(posFiltro));
  }
  if(productosFiltrados.length === 0) {
    cont.innerHTML = `<div style="color:#888;">No hay productos encontrados</div>`;
    return;
  }
  productosFiltrados.forEach(prod => {
    let card = document.createElement('div');
    card.style = `
      border:1px solid #e1e1e1;
      padding:8px;
      border-radius:7px;
      background:#fff;
      min-width:160px;
      max-width:210px;
      text-align:center;
      box-shadow:1px 2px 6px #eee;
      display:flex;
      flex-direction:column;
      align-items:center;
      gap:8px;
    `;
    card.innerHTML = `
      <img src="${prod.imagen_url || 'https://via.placeholder.com/200x200?text=Sin+Imagen'}" style="width:200px;height:200px;object-fit:contain;border-radius:6px;border:1px solid #eee;background:#f9f9f9;">
      <div style="font-weight:bold;word-break:break-all;">${prod.nombre}</div>
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

function renderCarritoPOS() {
  const tbody = document.getElementById('carritoPOS');
  if (!tbody) {
    console.error('No se encontró el tbody #carritoPOS');
    return;
  }
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
  const totalEl = document.getElementById('totalPOS');
  if (totalEl) totalEl.textContent = `$${total}`;
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

function renderMetodosPagoPOS() {
  let sel = document.getElementById('metodoPOS');
  if (!sel) {
    console.error('No se encontró el select #metodoPOS');
    return;
  }
  sel.innerHTML = '';
  posMetodosPago.forEach(m=>{
    let opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.nombre;
    sel.appendChild(opt);
  });
}

function renderHabitacionesPOS() {
  let sel = document.getElementById('habitacionPOS');
  if (!sel) {
    console.error('No se encontró el select #habitacionPOS');
    return;
  }
  sel.innerHTML = '';
  posHabitacionesOcupadas.forEach(h=>{
    let opt = document.createElement('option');
    opt.value = h.id;
    opt.textContent = h.nombre;
    sel.appendChild(opt);
  });
}

// ----- Registrar venta -----
async function registrarVentaPOS() {
  try {
    if(posCarrito.length === 0) {
      const msg = document.getElementById('msgPOS');
      if (msg) msg.textContent = "Carrito vacío";
      return;
    }
    const modoEl = document.getElementById('modoPOS');
    const metodoPagoEl = document.getElementById('metodoPOS');
    const habitacionEl = document.getElementById('habitacionPOS');
    const clienteEl = document.getElementById('clientePOS');
    const msgEl = document.getElementById('msgPOS');

    const modo = modoEl ? modoEl.value : null;
    let metodo_pago_id = null, habitacion_id = null, cliente_temporal = null;
    if(modo === 'inmediato') {
      metodo_pago_id = metodoPagoEl ? metodoPagoEl.value : null;
      if (metodo_pago_id === "") metodo_pago_id = null;
      cliente_temporal = clienteEl ? clienteEl.value : null;
    } else {
      habitacion_id = habitacionEl ? habitacionEl.value : null;
      if (habitacion_id === "") habitacion_id = null;
      if(!habitacion_id) {
        if (msgEl) msgEl.textContent = "Selecciona una habitación";
        return;
      }
    }
    let total = posCarrito.reduce((a,b)=>a+b.precio_venta*b.cantidad,0);
    let reservaId = null;
    if (habitacion_id) {
      // Buscar reserva activa en esa habitación
      const { data: reservasActivas } = await currentSupabase
        .from('reservas')
        .select('id')
        .eq('habitacion_id', habitacion_id)
        .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
        .order('fecha_inicio', { ascending: false })
        .limit(1);

      if (reservasActivas && reservasActivas.length > 0) {
        reservaId = reservasActivas[0].id;
      }
    }
    // Crear venta_tienda (principal)
    let ventaPayload = {
      hotel_id: currentHotelId,
      usuario_id: currentUser.id,
      habitacion_id: habitacion_id,
      reserva_id: reservaId, // 👈 ESTA LÍNEA ASOCIA LA VENTA A LA RESERVA ACTIVA
      metodo_pago_id: metodo_pago_id,
      cliente_temporal,
      total_venta: total,
      fecha: new Date().toISOString(),
      creado_en: new Date().toISOString()
    };
    console.log('Debug venta POS:', ventaPayload);
    let {data: ventas, error} = await currentSupabase.from('ventas_tienda').insert([ventaPayload]).select();
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
    // Caja (validar recibidoTotal y compraId según tu lógica, aquí puedes poner chequeo)
    /*
    await currentSupabase.from('caja').insert([{
      hotel_id: currentHotelId,
      tipo: 'egreso',
      monto: recibidoTotal,
      concepto: parcial ? 'Compra a proveedor (recepción parcial)' : 'Compra a proveedor (total)',
      fecha_movimiento: new Date().toISOString(),
      usuario_id: currentUser.id,
      compra_tienda_id: compraId || null,
      creado_en: new Date().toISOString()
    }]);
    */

    // Limpia
    posCarrito = [];
    renderCarritoPOS();
    await cargarDatosPOS();
    renderProductosPOS();
    if (msgEl) {
      msgEl.textContent = "¡Venta registrada!";
      setTimeout(()=>{msgEl.textContent="";},1700);
    }

  }catch(err){
    const msg = document.getElementById('msgPOS');
    if (msg) msg.textContent = err.message;
  }
}

// =============== FIN BLOQUE POS ===============


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
    .select('*, categoria_id, proveedor_id')
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
      <label style="font-size:13px;">Subir Imagen:
        <input type="file" id="prodImagenArchivo" accept="image/*" style="width:100%;margin-bottom:8px;" />
      </label>
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
  let imagenUrl = document.getElementById('prodImagenUrl').value;
  const archivoInput = document.getElementById('prodImagenArchivo');
  let archivo = archivoInput && archivoInput.files[0];

  if (archivo) {
    // Sube la imagen al bucket 'productos'
    const nombreArchivo = `producto_${Date.now()}_${archivo.name}`;
    let { error: errorUp } = await currentSupabase
      .storage
      .from('productos') // El bucket debe existir en Supabase Storage
      .upload(nombreArchivo, archivo, { upsert: true });
    if (errorUp) {
      alert("Error subiendo imagen: " + errorUp.message);
      return;
    }
    // Obtén la URL pública
    let { data: publicUrlData } = currentSupabase
      .storage
      .from('productos')
      .getPublicUrl(nombreArchivo);
    imagenUrl = publicUrlData.publicUrl;
  }

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
    imagen_url: imagenUrl,
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
  // Log para verificar el hotelId que se está usando
  console.log('[Proveedores] Cargando proveedores para hotelId:', currentHotelId); 
  
  if (!currentHotelId) {
    console.error('[Proveedores] currentHotelId es nulo o indefinido. No se pueden cargar proveedores.');
    proveedoresLista = []; // Asegura que la lista esté vacía si no hay hotelId
    return;
  }

  let {data, error} = await currentSupabase
    .from('proveedores')
    .select('*')
    .eq('hotel_id', currentHotelId);

  // Logs para ver el resultado de la consulta
  console.log('[Proveedores] Datos recibidos de Supabase:', data);
  console.log('[Proveedores] Error (si existe) de Supabase:', error);

  proveedoresLista = data || [];
}
// ... (resto de tu tienda.js, incluyendo cargarProveedores) ...

function renderTablaProveedores(){
  let tbody = document.getElementById('bodyProveedores');

  // Log para verificar el tbody
  console.log('[Proveedores] Entrando a renderTablaProveedores. tbody encontrado:', tbody !== null);

  if (!tbody) {
    console.error('[Proveedores] CRÍTICO: El elemento tbody con ID "bodyProveedores" no fue encontrado en el DOM. No se puede renderizar la tabla.');
    // Podrías mostrar un error en la UI aquí si tienes un div de feedback general para la pestaña.
    // Por ejemplo: document.getElementById('feedbackProveedoresTab').textContent = 'Error al cargar la tabla de proveedores.';
    return;
  }
  
  // Log para ver el contenido de proveedoresLista ANTES de intentar iterar
  console.log('[Proveedores] Contenido de proveedoresLista justo antes de renderizar:', JSON.stringify(proveedoresLista, null, 2));

  tbody.innerHTML = ''; // Limpiar la tabla antes de dibujar
  
  if (!proveedoresLista || proveedoresLista.length === 0) {
    console.log('[Proveedores] proveedoresLista está vacía o no definida. Mostrando mensaje de "No hay proveedores".');
    // Mostrar un mensaje dentro de la tabla si no hay proveedores
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:10px;">No hay proveedores para mostrar o no se cargaron correctamente.</td></tr>';
    return;
  }

  proveedoresLista.forEach(pr => {
    // Log para cada proveedor que se va a renderizar
    console.log('[Proveedores] Renderizando proveedor:', pr); 
    
    let tr = document.createElement('tr');
    // Validaciones para cada propiedad antes de accederla, por si acaso alguna es null/undefined
    const nombre = pr.nombre || 'N/A';
    const contacto = pr.contacto_nombre || '';
    const telefono = pr.telefono || '';
    const email = pr.email || '';
    const nit = pr.nit || '';
    const estado = pr.activo ? 'Activo' : 'Inactivo';
    const id = pr.id; // Asumimos que el id siempre existirá si el objeto 'pr' existe

    tr.innerHTML = `
      <td>${pr.nombre}</td>
      <td>${pr.contacto_nombre || ''}</td>
      <td>${pr.telefono || ''}</td>
      <td>${pr.email || ''}</td>
      <td>${pr.nit || ''}</td>
      <td>${pr.activo ? 'Activo' : 'Inactivo'}</td>
      <td>
        <button onclick="window.showModalProveedor('${id}')" style="margin-right:5px;border:none;background:transparent;cursor:pointer;" title="Editar">✏️</button>
        <button onclick="window.toggleEstadoProveedor('${id}',${!pr.activo})" style="border:none;background:transparent;cursor:pointer;" title="${pr.activo ? 'Desactivar' : 'Activar'}">${pr.activo?'❌':'✅'}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  console.log(`[Proveedores] Tabla renderizada con ${proveedoresLista.length} proveedores.`);
}

window.showModalProveedor = showModalProveedor; // Asegúrate que esta función exista globalmente o ajústala
async function showModalProveedor(proveedorId = null) {
  // Verificar que proveedoresCache (o proveedoresLista si es la que usas para el modal) esté cargada
  if (!proveedoresCache && !proveedoresLista) { // OJO: Si usas proveedoresCache aquí, asegúrate que esté poblada
      console.error("[Proveedores] Cache de proveedores no cargada para el modal.");
      // Podrías intentar cargarla aquí o mostrar un error
      // await cargarCategoriasYProveedores(); // Si es necesario
  }

  let modal = document.getElementById('modalProveedor');
  // Usa proveedoresLista si es la fuente de datos principal para la tabla.
  // Si tienes un proveedoresCache separado para los modales, asegúrate que esté sincronizado.
  let pr = proveedorId ? (proveedoresLista.find(p => p.id === proveedorId) || null) : null; 

  if (proveedorId && !pr) {
      console.error(`[Proveedores] No se encontró el proveedor con ID ${proveedorId} en proveedoresLista para editar.`);
      // Mostrar un mensaje al usuario
      return;
  }

  modal.style.display = 'block';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:7px;box-shadow:2px 3px 12px #2225;max-width:370px;margin:auto;padding:24px;position:relative;">
      <button onclick="window.closeModalProveedor()" style="position:absolute;right:8px;top:4px;background:none;border:none;font-size:18px;cursor:pointer;">&times;</button>
      <h4 style="margin-top:0;margin-bottom:18px;font-size:1.2em;">${proveedorId ? 'Editar' : 'Nuevo'} Proveedor</h4>
      <input id="provNombre" placeholder="Nombre" value="${pr?.nombre || ''}" style="width:100%;margin-bottom:8px;padding:6px;border:1px solid #ccc;border-radius:3px;" />
      <input id="provContacto" placeholder="Nombre contacto" value="${pr?.contacto_nombre || ''}" style="width:100%;margin-bottom:8px;padding:6px;border:1px solid #ccc;border-radius:3px;" />
      <input id="provTelefono" placeholder="Teléfono" value="${pr?.telefono || ''}" style="width:100%;margin-bottom:8px;padding:6px;border:1px solid #ccc;border-radius:3px;" />
      <input id="provEmail" placeholder="Email" value="${pr?.email || ''}" style="width:100%;margin-bottom:8px;padding:6px;border:1px solid #ccc;border-radius:3px;" />
      <input id="provNIT" placeholder="NIT" value="${pr?.nit || ''}" style="width:100%;margin-bottom:8px;padding:6px;border:1px solid #ccc;border-radius:3px;" />
      <div style="margin-top:15px;text-align:right;">
        <button id="btnGuardarProveedor" style="background:#4CAF50;color:#fff;padding:8px 15px;border:none;border-radius:4px;cursor:pointer;">${proveedorId ? 'Actualizar' : 'Crear'}</button>
      </div>
    </div>
  `;
  document.getElementById('btnGuardarProveedor').onclick = () => saveProveedor(proveedorId);
}

window.closeModalProveedor = () => {
    const modal = document.getElementById('modalProveedor');
    if (modal) modal.style.display = 'none';
};

async function saveProveedor(proveedorId) {
  let datos = {
    hotel_id: currentHotelId,
    nombre: document.getElementById('provNombre').value,
    contacto_nombre: document.getElementById('provContacto').value,
    telefono: document.getElementById('provTelefono').value,
    email: document.getElementById('provEmail').value,
    nit: document.getElementById('provNIT').value,
    activo: true, // Por defecto activo al crear/actualizar desde este modal
    actualizado_en: new Date().toISOString(),
  };

  if (!datos.nombre) {
      alert("El nombre del proveedor es obligatorio.");
      return;
  }

  try {
    if (proveedorId) {
      const { error } = await currentSupabase.from('proveedores').update(datos).eq('id', proveedorId);
      if (error) throw error;
      console.log('[Proveedores] Proveedor actualizado:', proveedorId);
    } else {
      datos.creado_en = new Date().toISOString();
      const { error } = await currentSupabase.from('proveedores').insert([datos]);
      if (error) throw error;
      console.log('[Proveedores] Proveedor creado.');
    }
    closeModalProveedor();
    await cargarProveedores(); // Recarga la lista de proveedores
    renderTablaProveedores();  // Vuelve a dibujar la tabla
  } catch (error) {
      console.error('[Proveedores] Error guardando proveedor:', error);
      alert(`Error al guardar el proveedor: ${error.message}`);
  }
}

window.toggleEstadoProveedor = async (id, act) => {
  try {
    const { error } = await currentSupabase.from('proveedores').update({ activo: act, actualizado_en: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    console.log(`[Proveedores] Estado del proveedor ${id} cambiado a: ${act}`);
    await cargarProveedores();
    renderTablaProveedores();
  } catch (error) {
    console.error('[Proveedores] Error cambiando estado del proveedor:', error);
    alert(`Error al cambiar el estado del proveedor: ${error.message}`);
  }
};

// ASEGÚRATE DE QUE ESTAS FUNCIONES ESTÉN PRESENTES EN TU tienda.js

// ====================  PESTAÑA LISTA DE COMPRAS  ====================
let filtroProveedorListaCompras = ''; // Variable global para el filtro de esta pestaña

async function renderListaCompras() {
  const cont = document.getElementById('contenidoTiendaTab');
  if (!cont) {
      console.error("Error: #contenidoTiendaTab no encontrado para Lista de Compras.");
      return;
  }

  // Asegurarse que los caches necesarios estén poblados
  // Si proveedoresCache no se llena en otro lado antes de esto, hay que cargarlo.
  if (!proveedoresCache || proveedoresCache.length === 0) {
      await cargarCategoriasYProveedores(); // Esta función llena proveedoresCache
  }
  if (!inventarioProductos || inventarioProductos.length === 0) {
      await cargarProductosInventario(); // Esta función llena inventarioProductos
  }


  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <h4>Lista de Compras Sugerida</h4>
      <button id="btnExportarListaCompra" style="background:#337ab7;color:#fff;padding:6px 14px;border:none;border-radius:4px;cursor:pointer;">Exportar Excel</button>
    </div>
    <div style="margin-bottom:10px;">
      <label style="font-weight:500;">Filtrar por proveedor:</label>
      <select id="selectProveedorCompra" style="margin-left:10px;padding:6px 14px;border-radius:4px;border:1px solid #ccc;min-width:180px;">
        <option value="">-- Todos los proveedores --</option>
        ${(proveedoresCache || []).map(pr => `
          <option value="${pr.id}">${pr.nombre}</option>
        `).join('')}
      </select>
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%;font-size:14px;border:1px solid #eee;border-collapse:collapse;">
        <thead>
          <tr style="background:#f7f7f7;">
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Producto</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Stock Actual</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Stock Mín.</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Stock Máx.</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Sugerido Comprar</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Proveedor</th>
          </tr>
        </thead>
        <tbody id="bodyListaCompras"></tbody>
      </table>
    </div>
  `;

  const btnExportar = document.getElementById('btnExportarListaCompra');
  if (btnExportar) {
      btnExportar.onclick = () => alert('Función en desarrollo: exportar a Excel');
  }

  const selectProveedor = document.getElementById('selectProveedorCompra');
  if (selectProveedor) {
      selectProveedor.onchange = (e) => {
          filtroProveedorListaCompras = e.target.value;
          renderTablaListaCompras();
      };
  }
  renderTablaListaCompras(); // Renderizar la tabla inicialmente
}

function renderTablaListaCompras() {
  const tbody = document.getElementById('bodyListaCompras');
  if (!tbody) {
      console.error("Error: #bodyListaCompras no encontrado para la tabla de Lista de Compras.");
      return;
  }
  tbody.innerHTML = '';

  let listaSugerida = (inventarioProductos || [])
    .filter(p => Number(p.stock_actual) < Number(p.stock_minimo)); // O podrías usar stock_maximo para rellenar hasta el máximo

  if (filtroProveedorListaCompras) {
    listaSugerida = listaSugerida.filter(p => p.proveedor_id === filtroProveedorListaCompras);
  }

  if (listaSugerida.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:10px;">No hay productos que necesiten reabastecimiento o que coincidan con el filtro.</td></tr>';
      return;
  }

  listaSugerida.forEach(p => {
    let proveedor = (proveedoresCache || []).find(pr => pr.id === p.proveedor_id)?.nombre || 'N/A';
    // Sugerir comprar la diferencia para alcanzar el stock máximo, o al menos el mínimo.
    // Aquí usamos stock_maximo. Si prefieres solo hasta el mínimo, cambia p.stock_maximo por p.stock_minimo
    let cantidadASugerir = Math.max(0, (Number(p.stock_maximo) || Number(p.stock_minimo) || 0) - (Number(p.stock_actual) || 0));
    
    if (cantidadASugerir <= 0 && Number(p.stock_actual) >= Number(p.stock_minimo) ) { // Si ya tiene suficiente para el mínimo, no lo mostramos si no necesita para el máximo
        // Opcional: si quieres mostrar solo los que están POR DEBAJO del mínimo estricto, descomenta la siguiente línea y comenta la lógica de stock_maximo
        // if (Number(p.stock_actual) >= Number(p.stock_minimo)) return;
        // cantidadASugerir = Math.max(0, (Number(p.stock_minimo) || 0) - (Number(p.stock_actual) || 0));
        // if (cantidadASugerir <= 0) return;
    }


    let tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding:8px;border:1px solid #ddd;">${p.nombre}</td>
      <td style="padding:8px;border:1px solid #ddd;">${p.stock_actual || 0}</td>
      <td style="padding:8px;border:1px solid #ddd;">${p.stock_minimo || 0}</td>
      <td style="padding:8px;border:1px solid #ddd;">${p.stock_maximo || 0}</td>
      <td style="padding:8px;border:1px solid #ddd;font-weight:bold;">${cantidadASugerir > 0 ? cantidadASugerir : '-'}</td>
      <td style="padding:8px;border:1px solid #ddd;">${proveedor}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Fin de la sección Lista de Compras
// Asegúrate de que esta sea la última parte de tu archivo, o que esté antes del cierre del módulo si usas IIFE.




// ... (asegúrate que el resto de tu tienda.js, como `renderProveedores`, `cargarProveedores`, etc., estén definidos correctamente y que `proveedoresLista` sea la variable global que se llena en `cargarProveedores`).
// Recuerda que `cargarCategoriasYProveedores()` llena `proveedoresCache`, si usas esa variable en el modal, asegúrate que se llame.
// Si el modal de proveedor solo depende de `proveedoresLista`, entonces `cargarProveedores()` es suficiente.
// ====================  PESTAÑA DE COMPRAS Y PENDIENTES  ====================

// --- VARIABLES GLOBALES ---
let compraProveedorCarrito = [];
let compraProveedorFiltro = '';

// ==================== FUNCIONES DE REGISTRO DE COMPRA ====================

// 1. Renderiza el carrito de compras del proveedor
function renderCarritoCompra() {
  let tbody = document.getElementById('carritoCompra');
  if (!tbody) return;
  tbody.innerHTML = '';
  let total = 0;
  compraProveedorCarrito.forEach(item => {
    let subtotal = item.cantidad * item.precio;
    total += subtotal;
    let tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.nombre}</td>
      <td>${item.cantidad}</td>
      <td>$${item.precio}</td>
      <td>$${subtotal}</td>
      <td><button onclick="window.eliminarItemCompra('${item.id}')">X</button></td>
    `;
    tbody.appendChild(tr);
  });
  let totalEl = document.getElementById('totalCompra');
  if (totalEl) totalEl.textContent = `$${total}`;
}

// 2. Elimina un producto del carrito de compra
window.eliminarItemCompra = (id)=>{
  compraProveedorCarrito = compraProveedorCarrito.filter(i=>i.id!==id);
  renderCarritoCompra();
};

// 3. Renderiza los productos disponibles para compras (por proveedor/categoría/nombre)
function renderProductosCompra() {
  let proveedorSel = document.getElementById('selectProveedorCompraForm')?.value;
  let list = [];

  // Si NO hay proveedor seleccionado, muestra mensaje y NO muestra productos
  if (!proveedorSel) {
    document.getElementById('productosCompraList').innerHTML = `<div class="text-gray-400">Selecciona un proveedor para ver sus productos disponibles.</div>`;
    return;
  }

  // Si hay proveedor, filtra los productos por proveedor_id
  list = productosCache.filter(p => p.proveedor_id === proveedorSel);

  let html = list.map(p => `
    <div class="my-1 flex gap-2 items-center">
      <span class="w-36 inline-block">${p.nombre} <span class="text-xs text-gray-500">${p.categoria_nombre || ''}</span></span>
      <input type="number" id="cantidad_${p.id}" class="input" placeholder="Cantidad" style="width:70px;">
      <input type="number" id="precio_${p.id}" class="input" placeholder="Precio compra" style="width:90px;">
      <button onclick="window.agregarProductoCompra('${p.id}')" class="bg-gray-200 px-2 rounded">Agregar</button>
      <div id="msgCompra" class="text-green-600 mt-3"></div>
    </div>
  `).join('');
  document.getElementById('productosCompraList').innerHTML = html;
}


// 4. Agrega productos al carrito de compra
window.agregarProductoCompra = (id)=>{
  let cantidad = Number(document.getElementById('cantidad_'+id).value);
  let precio = Number(document.getElementById('precio_'+id).value);
  let prod = productosCache.find(p=>p.id===id);
  if(!prod || !cantidad || !precio) return;
  let item = compraProveedorCarrito.find(i=>i.id===id);
  if(item){
    item.cantidad += cantidad;
    item.precio = precio;
  }else{
    compraProveedorCarrito.push({...prod, cantidad, precio});
  }
  renderCarritoCompra();
};

// 5. Registra la compra (en estado pendiente)
async function registrarCompraProveedor() {
  try {
    if (compraProveedorCarrito.length === 0) {
      document.getElementById('msgCompra').textContent = "Carrito vacío";
      return;
    }
    let proveedorId = document.getElementById('selectProveedorCompraForm').value;
    if (!proveedorId) {
      document.getElementById('msgCompra').textContent = "Selecciona un proveedor";
      return;
    }
    let total = compraProveedorCarrito.reduce((a, b) => a + b.precio * b.cantidad, 0);

    // 1. Registra compra principal en estado pendiente
    let { data: compras, error } = await currentSupabase.from('compras_tienda').insert([{
      hotel_id: currentHotelId,
      usuario_id: currentUser.id,
      proveedor_id: proveedorId,
      total_compra: total,
      fecha: new Date().toISOString(),
      estado: "pendiente",
      creado_en: new Date().toISOString()
    }]).select();
    if (error || !compras?.[0]) throw new Error("Error guardando compra");
    let compraId = compras[0].id;

    // 2. Detalle de compra
    for (let item of compraProveedorCarrito) {
      await currentSupabase.from('detalle_compras_tienda').insert([{
        compra_id: compraId,
        producto_id: item.id,
        cantidad: item.cantidad,
        precio_unitario: item.precio,
        subtotal: item.cantidad * item.precio,
        hotel_id: currentHotelId
      }]);
    }

    alert('Compra registrada. Puedes recibir el pedido cuando llegue para actualizar inventario y caja.');

    compraProveedorCarrito = [];
    renderCarritoCompra();
    // Aquí puedes llamar a una función para refrescar la lista de compras pendientes:
    // await renderComprasPendientes();
  } catch (err) {
    document.getElementById('msgCompra').textContent = err.message;
  }
}

// 6. Renderiza el formulario de compras, carrito y proveedores
async function renderModuloCompras() {
  const cont = document.getElementById('contenidoTiendaTab');

  // --- RECARGA productos y proveedores desde Supabase antes de mostrar el formulario ---
  const { data: productos } = await currentSupabase
    .from('productos_tienda')
    .select('*')
    .eq('hotel_id', currentHotelId);
  productosCache = productos || [];

  const { data: proveedores } = await currentSupabase
    .from('proveedores')
    .select('*')
    .eq('hotel_id', currentHotelId);
  proveedoresCache = proveedores || [];

  // --- ALERTAS: Si no hay productos o proveedores cargados ---
  if (!productosCache.length) {
    cont.innerHTML = '<div class="text-red-500 font-bold">No hay productos cargados. Registra productos antes de realizar compras.</div>';
    return;
  }
  if (!proveedoresCache.length) {
    cont.innerHTML = '<div class="text-red-500 font-bold">No hay proveedores cargados. Registra proveedores antes de realizar compras.</div>';
    return;
  }

  // --- FORMULARIO NORMAL ---
  cont.innerHTML = `
    <h4 class="mb-2 font-bold text-lg">Registrar Compra a Proveedor</h4>
    <div class="mb-2">
      <label>Proveedor:
        <select id="selectProveedorCompraForm">
          <option value="">Selecciona proveedor</option>
          ${proveedoresCache.map(pr => `<option value="${pr.id}">${pr.nombre}</option>`).join('')}
        </select>
      </label>
    </div>
    <input id="buscarProductoCompra" class="input mb-2" placeholder="Buscar producto o categoría..."/>
    <div id="productosCompraList"></div>
    <h5 class="mt-4 font-semibold">Carrito de compra:</h5>
    <table class="w-full border mb-2 text-xs">
      <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio compra</th><th>Subtotal</th><th></th></tr></thead>
      <tbody id="carritoCompra"></tbody>
    </table>
    <div class="text-right mb-2">Total: <span id="totalCompra">$0</span></div>
    <button id="btnRegistrarCompra" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded">Registrar Compra</button>
    <div id="msgCompra" class="text-red-500 mt-2"></div>
  `;

  document.getElementById('buscarProductoCompra').oninput = (e) => {
    compraProveedorFiltro = e.target.value.toLowerCase();
    renderProductosCompra();
  };
  document.getElementById('selectProveedorCompraForm').onchange = renderProductosCompra;
  document.getElementById('btnRegistrarCompra').onclick = registrarCompraProveedor;

  compraProveedorCarrito = [];
  renderProductosCompra();
  renderCarritoCompra();
}


// ==================== FUNCIONES DE COMPRAS PENDIENTES Y RECEPCIÓN ====================

// 7. Renderiza la lista de compras pendientes
async function renderComprasPendientes() {
  const cont = document.getElementById('contenidoTiendaTab');
  cont.innerHTML = `<h4 class="mb-4 font-bold text-lg">Compras pendientes por recibir</h4><div id="comprasPendientesList"></div>`;

  // Cargar compras pendientes/parciales
  const { data: compras, error } = await currentSupabase
    .from('compras_tienda')
    .select('*')
    .eq('hotel_id', currentHotelId)
    .in('estado', ['pendiente', 'parcial'])
    .order('fecha', { ascending: false });

  if (error) {
    cont.innerHTML += `<div class="text-red-600">Error cargando compras: ${error.message}</div>`;
    return;
  }
  if (!compras || compras.length === 0) {
    cont.innerHTML += `<div class="text-gray-500 mt-5">No hay compras pendientes o parciales.</div>`;
    return;
  }
  await cargarDetallesCompras(compras);
  let html = compras.map(compra => renderTarjetaCompraPendiente(compra)).join('');
  document.getElementById('comprasPendientesList').innerHTML = html;
}

// 8. Carga detalles de productos de una compra
async function cargarDetallesCompras(compras) {
  for (let compra of compras) {
    const { data: detalles } = await currentSupabase
      .from('detalle_compras_tienda')
      .select('producto_id, cantidad, precio_unitario')
      .eq('compra_id', compra.id);
    compra.detalles = detalles.map(det => ({
      ...det,
      nombre: (productosCache.find(p => p.id === det.producto_id)?.nombre) || "Producto"
    }));
  }
}

// 9. Renderiza una tarjeta de compra pendiente con inputs de recepción
function renderTarjetaCompraPendiente(compra) {
  let productosHtml = '';
  if (compra.detalles) {
    productosHtml = compra.detalles.map(det => `
      <li>
        ${det.nombre}: <b>${det.cantidad}</b> x $${det.precio_unitario}
        <br>
        <label>Recibido:
          <input type="number" id="recibido_${compra.id}_${det.producto_id}" value="${det.cantidad}" max="${det.cantidad}" min="0" style="width:60px;">
        </label>
      </li>
    `).join('');
  }
  return `
    <div class="border rounded-lg p-3 mb-5 bg-yellow-50 card-compra-pendiente" data-id="${compra.id}">
      <div class="mb-2 font-semibold">Proveedor: ${getProveedorNombre(compra.proveedor_id)}</div>
      <ul class="mb-2">${productosHtml}</ul>
      <div class="mb-2 font-bold">Total: $${compra.total_compra}</div>
      <button onclick="window.recibirPedido('${compra.id}')" class="bg-green-600 text-white px-3 py-1 rounded">Recibir pedido</button>
      <span id="msgRecibido_${compra.id}" class="ml-3 text-xs text-gray-500"></span>
    </div>
  `;
}

// 10. Obtiene el nombre del proveedor por id (de tu cache)
function getProveedorNombre(proveedorId) {
  let pr = proveedoresCache.find(p => p.id === proveedorId);
  return pr ? pr.nombre : proveedorId;
}

// 11. Lógica para recibir pedido (total o parcial)
window.recibirPedido = async function(compraId) {
  alert('Entrando a recibirPedido para: ' + compraId);
  try {
    // 1. Carga detalles de productos de la compra
    const { data: detalles, error: errorDetalles } = await currentSupabase
      .from('detalle_compras_tienda')
      .select('*')
      .eq('compra_id', compraId);

    if (errorDetalles) {
      alert('Error obteniendo detalles de compra: ' + errorDetalles.message);
      return;
    }

    if (!detalles || detalles.length === 0) {
      alert('No hay detalles de la compra para este pedido.');
      return;
    }

    let parcial = false;
    let recibidoTotal = 0;

    // 2. Actualiza inventario y calcula total recibido
    for (let det of detalles) {
      let recibidoInput = document.getElementById(`recibido_${compraId}_${det.producto_id}`);
      let cantidadRecibida = Number(recibidoInput?.value || det.cantidad);
      if (cantidadRecibida < det.cantidad) parcial = true;
      recibidoTotal += cantidadRecibida * det.precio_unitario;

      // Actualiza stock solo lo recibido
      let prod = productosCache.find(p => p.id === det.producto_id);
      if (prod) {
        await currentSupabase.from('productos_tienda').update({
          stock_actual: (prod.stock_actual || 0) + cantidadRecibida,
          // (Opcional) actualiza el precio de compra si varió
          precio: det.precio_unitario
        }).eq('id', det.producto_id);
        prod.stock_actual = (prod.stock_actual || 0) + cantidadRecibida;
        prod.precio = det.precio_unitario;
      }
    }

    // 3. Actualiza estado de compra
    await currentSupabase.from('compras_tienda').update({
      estado: parcial ? 'parcial' : 'recibida'
    }).eq('id', compraId);

    // 4. Nombre del proveedor para la caja
    let compra = (await currentSupabase.from('compras_tienda').select('proveedor_id').eq('id', compraId).single()).data;
    let proveedor = proveedoresCache.find(p => p.id === compra.proveedor_id);
    let nombreProveedor = proveedor ? proveedor.nombre : 'Proveedor';

    // 5. Registra egreso en caja solo por lo recibido
    const { error: errorCaja } = await currentSupabase.from('caja').insert([{
      hotel_id: currentHotelId,
      tipo: 'egreso',
      monto: recibidoTotal,
      concepto: (parcial ? 'Compra parcial a proveedor: ' : 'Compra total a proveedor: ') + nombreProveedor,
      fecha_movimiento: new Date().toISOString(),
      usuario_id: currentUser.id,
      creado_en: new Date().toISOString()
    }]);

    if (errorCaja) {
      alert('Error insertando en caja: ' + errorCaja.message);
      return;
    }

    const msg = document.getElementById(`msgRecibido_${compraId}`);
msg.textContent = '✅ Compra registrada y egreso generado en caja. ¡Listo!';
msg.className = 'ml-3 text-sm font-bold text-green-700 bg-green-100 px-3 py-2 rounded shadow-sm border border-green-300';
setTimeout(() => {
  msg.textContent = '';
  msg.className = '';
}, 3000); // El mensaje desaparece después de 3 segundos
  } catch (err) {
    alert('Error general en recibirPedido: ' + err.message);
    console.error('Error detalle:', err);
  }
}




// ========== BLOQUE PDF, BITÁCORA Y ALERTAS VISUALES ==========

// ------ 2. BOTÓN PDF EN LA TARJETA DE COMPRA PENDIENTE ------


// ------ 3. FUNCIÓN GLOBAL PARA PDF ------
window.descargarCompraPDF = function(compraId) {
  let card = document.querySelector(`.card-compra-pendiente[data-id="${compraId}"]`);
  if (!card) return alert('No encontrado');
  html2pdf().from(card).save(`compra_${compraId}.pdf`);
};
// Incluye html2pdf.js en tu HTML:
// <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>

// ============= FUNCIONES CRUD DE PROVEEDORES =============

window.nuevoProveedor = async function() {
  let nombre = prompt("Nombre del proveedor:");
  if (!nombre) return;
  const { error } = await currentSupabase.from('proveedores').insert([{ nombre, hotel_id: currentHotelId }]);
  if (!error) alert("Proveedor agregado");
  await recargarProveedores();
  renderProveedores();
};

window.editarProveedor = async function(id) {
  let actual = proveedoresCache.find(p=>p.id===id);
  let nombre = prompt("Nuevo nombre para el proveedor:", actual?.nombre);
  if (!nombre) return;
  await currentSupabase.from('proveedores').update({ nombre }).eq('id', id);
  await recargarProveedores();
  renderProveedores();
};

window.eliminarProveedor = async function(id) {
  if (!confirm("¿Eliminar este proveedor?")) return;
  await currentSupabase.from('proveedores').delete().eq('id', id);
  await recargarProveedores();
  renderProveedores();
};

async function recargarProveedores() {
  const { data } = await currentSupabase.from('proveedores').select('*').eq('hotel_id', currentHotelId);
  proveedoresCache = data || [];
}

// UI Proveedores

// ============= LISTA DE COMPRAS (HISTORIAL, FILTRO, PDF) =============




function renderTablaCompras(compras) {
  let tabla = `
    <table class="w-full border text-xs mt-4">
      <thead><tr>
        <th>Fecha</th><th>Proveedor</th><th>Total</th><th>Estado</th><th>Recibo</th>
      </tr></thead>
      <tbody>
        ${compras.map(c=>`
          <tr>
            <td>${(c.fecha||'').slice(0,10)}</td>
            <td>${getProveedorNombre(c.proveedor_id)}</td>
            <td>$${c.total_compra}</td>
            <td>${c.estado}</td>
            <td>
              <button onclick="window.descargarReciboCompra('${c.id}')" class="bg-gray-300 px-2 rounded">PDF</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  document.getElementById('tablaCompras').innerHTML = tabla;
}

// ============= DESCARGA PDF DE RECIBO DE COMPRA =============
window.descargarReciboCompra = async function(compraId) {
  const { data: compra } = await currentSupabase.from('compras_tienda').select('*').eq('id', compraId).single();
  const { data: detalles } = await currentSupabase.from('detalle_compras_tienda').select('*').eq('compra_id', compraId);
  let proveedor = getProveedorNombre(compra.proveedor_id);
  let html = `
    <h3>Recibo de compra #${compraId}</h3>
    <b>Fecha:</b> ${compra.fecha} <br>
    <b>Proveedor:</b> ${proveedor} <br>
    <b>Total:</b> $${compra.total_compra} <br><br>
    <table border="1" cellspacing="0" cellpadding="3">
      <tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr>
      ${detalles.map(d=>`
        <tr>
          <td>${productosCache.find(p=>p.id===d.producto_id)?.nombre || "Producto"}</td>
          <td>${d.cantidad}</td>
          <td>$${d.precio_unitario}</td>
          <td>$${d.cantidad * d.precio_unitario}</td>
        </tr>
      `).join('')}
    </table>
  `;
  // html2pdf debe estar cargado en tu index.html
  html2pdf().from(html).save(`recibo_compra_${compraId}.pdf`);
};

// ============= BITÁCORA DE COMPRAS Y RECEPCIÓN =============
// Solo llama tu servicio si ya tienes implementado el registrarEnBitacora

async function registrarBitacoraCompra(tipo, compraId, datos) {
  if (typeof registrarEnBitacora !== "function") return;
  await registrarEnBitacora({
    supabase: currentSupabase,
    hotel_id: currentHotelId,
    usuario_id: currentUser.id,
    modulo: 'Tienda',
    accion: tipo,
    detalles: { compraId, ...datos }
  });
}

// Llama así después de registrar compra o recibir pedido:
// await registrarBitacoraCompra("Registrar compra", compraId, { carrito: compraProveedorCarrito });
// await registrarBitacoraCompra("Recibir pedido", compraId, { /* detalles de recepción */ });

// ============= RECARGA GLOBAL =============

window.recargarProductosYProveedores = async function() {
  // Recarga ambas caches globales
  await cargarProductosTienda(); // debe actualizar productosCache
  await recargarProveedores();
};

// ============= INTEGRACIÓN CON TABS EXISTENTES =============
// Asegúrate de tener en tu renderTiendaTabs:
  // if(tab === 'Proveedores') renderProveedores();
  // if(tab === 'Lista de Compras') renderListaCompras();

// Y de tener cargadas las caches al iniciar cada módulo, ejemplo:
  // await recargarProductosYProveedores();
  // o al menos recargarProveedores() y cargarProductosTienda()

// ============= FIN DEL BLOQUE =============
