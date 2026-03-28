import { turnoService } from '../../services/turnoService.js';
import { showError } from '../../uiUtils.js';
import { clearPOSDraft, loadPOSDraft, savePOSDraft } from '../../services/posDraftService.js';
import { imprimirTicketOperacion } from '../../services/thermalPrintService.js';
import { tiendaState } from './state.js';
import { formatCurrency, getTabContentEl } from './helpers.js';

let descuentoAplicado = null;
let posProductos = [];
let posMetodosPago = [];
let posHabitacionesOcupadas = [];
let posCarrito = [];
let posFiltro = '';
let ventaPOSenCurso = false;
let posDraftRestored = false;

function getPOSDraftContext() {
  return {
    hotelId: tiendaState.currentHotelId,
    userId: tiendaState.currentUser?.id
  };
}

function savePOSDraftState() {
  const { hotelId, userId } = getPOSDraftContext();
  if (!hotelId || !userId) return;

  savePOSDraft('tienda', hotelId, userId, {
    carrito: posCarrito,
    filtro: posFiltro,
    discountCode: document.getElementById('codigoDescuentoInput')?.value || '',
    mode: document.getElementById('modoPOS')?.value || 'inmediato',
    metodoPagoId: document.getElementById('metodoPOS')?.value || '',
    habitacionId: document.getElementById('habitacionPOS')?.value || '',
    clienteTemporal: document.getElementById('clientePOS')?.value || ''
  });
}

function setPOSDraftStatus(message = '', tone = 'info') {
  const statusEl = document.getElementById('posDraftStatus');
  if (!statusEl) return;
  if (!message) {
    statusEl.style.display = 'none';
    statusEl.innerHTML = '';
    return;
  }

  const palette = tone === 'success'
    ? 'background:#ecfdf5;border:1px solid #a7f3d0;color:#047857;'
    : tone === 'warning'
      ? 'background:#fff7ed;border:1px solid #fdba74;color:#c2410c;'
      : 'background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;';

  statusEl.style.display = 'block';
  statusEl.style.cssText = `display:block;margin:0 0 16px;padding:10px 12px;border-radius:12px;font-size:0.9rem;font-weight:600;${palette}`;
  statusEl.innerHTML = message;
}

function restorePOSDraftState() {
  const { hotelId, userId } = getPOSDraftContext();
  const draft = loadPOSDraft('tienda', hotelId, userId);
  if (!draft?.payload) {
    posDraftRestored = false;
    setPOSDraftStatus('');
    return;
  }

  const availableProducts = new Map(posProductos.map((product) => [product.id, product]));
  posCarrito = (draft.payload.carrito || [])
    .map((item) => {
      const currentProduct = availableProducts.get(item.id);
      if (!currentProduct) return null;
      return {
        ...currentProduct,
        cantidad: Math.max(1, Math.min(Number(item.cantidad) || 1, currentProduct.stock_actual || 1))
      };
    })
    .filter(Boolean);
  posFiltro = draft.payload.filtro || '';
  posDraftRestored = posCarrito.length > 0;

  const buscadorEl = document.getElementById('buscadorPOS');
  if (buscadorEl) buscadorEl.value = posFiltro;
  const modeEl = document.getElementById('modoPOS');
  if (modeEl && draft.payload.mode) modeEl.value = draft.payload.mode;
  const metodoEl = document.getElementById('metodoPOS');
  if (metodoEl && draft.payload.metodoPagoId) metodoEl.value = draft.payload.metodoPagoId;
  const habitacionEl = document.getElementById('habitacionPOS');
  if (habitacionEl && draft.payload.habitacionId) habitacionEl.value = draft.payload.habitacionId;
  const clienteEl = document.getElementById('clientePOS');
  if (clienteEl) clienteEl.value = draft.payload.clienteTemporal || '';
  const codigoEl = document.getElementById('codigoDescuentoInput');
  if (codigoEl) codigoEl.value = draft.payload.discountCode || '';

  setPOSDraftStatus(
    posDraftRestored
      ? `Se recuperó un borrador guardado del carrito. Última actualización: ${new Date(draft.updatedAt || Date.now()).toLocaleString('es-CO')}.`
      : '',
    'info'
  );
}

export async function cargarDatosPOS() {
  const { data: productos } = await tiendaState.currentSupabase
    .from('productos_tienda')
    .select('id, nombre, precio_venta, imagen_url, stock_actual, categoria_id, codigo_barras')
    .eq('hotel_id', tiendaState.currentHotelId)
    .eq('activo', true)
    .gt('stock_actual', 0);

  const { data: categorias } = await tiendaState.currentSupabase
    .from('categorias_producto')
    .select('id, nombre');

  const catMap = Object.fromEntries((categorias || []).map((cat) => [cat.id, cat.nombre]));
  posProductos = (productos || []).map((producto) => ({
    ...producto,
    categoria_nombre: catMap[producto.categoria_id] || 'Sin Cat.',
  }));

  const { data: metodos } = await tiendaState.currentSupabase
    .from('metodos_pago')
    .select('id, nombre')
    .eq('hotel_id', tiendaState.currentHotelId)
    .eq('activo', true);

  posMetodosPago = [
    { id: 'mixto', nombre: 'Pago Mixto (varios metodos)' },
    ...(metodos || []),
  ];

  const { data: habitaciones } = await tiendaState.currentSupabase
    .from('habitaciones')
    .select('id, nombre')
    .eq('hotel_id', tiendaState.currentHotelId)
    .eq('estado', 'ocupada');

  posHabitacionesOcupadas = habitaciones || [];
}

export async function renderPOS() {
  const cont = getTabContentEl();
  if (!cont) return;

  cont.innerHTML = '<div>Cargando...</div>';
  await cargarDatosPOS();

  cont.innerHTML = `
    <div style="display:flex; flex-wrap:wrap; gap:32px; align-items:flex-start; justify-content:center; background:#f3f6fa; border-radius:16px; padding:32px 18px 26px 18px; box-shadow:0 6px 32px #23408c12; margin-top:20px;">
      <div style="flex:1 1 340px; background:#fff; border-radius:16px; box-shadow:0 2px 18px #b6d0f912; padding:28px 22px; min-width:320px; margin-bottom:12px;">
        <h2 style="font-size:1.4rem; color:#2563eb; font-weight:bold; margin-bottom:22px; letter-spacing:1px;">Productos disponibles</h2>
        <input id="buscadorPOS" placeholder="Buscar producto, categoria o codigo..." style="width:100%;margin-bottom:16px;padding:11px 15px;font-size:16px;border-radius:9px;border:1.5px solid #cbd5e1; background:#f9fafb; outline:none;">
        <div id="productosPOS" style="display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:18px; margin-bottom:8px;"></div>
      </div>
      <div style="min-width:360px; max-width:460px; flex:1 1 360px; background:#fff; border-radius:20px; box-shadow:0 18px 40px rgba(15,23,42,0.08); position:sticky; top:20px; align-self:flex-start; z-index:10; overflow:hidden; border:1px solid #dbeafe;">
        <div style="padding:22px 24px 18px; background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 56%,#22c55e 100%); color:#fff;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
            <div>
              <div style="font-size:0.84rem;letter-spacing:0.18em;text-transform:uppercase;opacity:0.8;margin-bottom:6px;">Punto de venta</div>
              <h2 style="font-size:1.45rem;font-weight:800;margin:0 0 6px;">Carrito de venta</h2>
              <p style="margin:0;font-size:0.96rem;opacity:0.9;">Controla artículos, descuentos y forma de pago en un solo bloque.</p>
            </div>
            <div style="padding:10px 12px;border-radius:16px;background:rgba(255,255,255,0.14);min-width:88px;text-align:center;border:1px solid rgba(255,255,255,0.16);">
              <div style="font-size:0.73rem;text-transform:uppercase;letter-spacing:0.12em;opacity:0.8;">Items</div>
              <div id="cartItemsCountPOS" style="font-size:1.4rem;font-weight:800;line-height:1.1;">0</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:16px;">
            <div style="padding:11px 12px;border-radius:14px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.12);">
              <div style="font-size:0.74rem;text-transform:uppercase;letter-spacing:0.12em;opacity:0.75;">Unidades</div>
              <div id="cartUnitsCountPOS" style="font-size:1.2rem;font-weight:800;margin-top:4px;">0</div>
            </div>
            <div style="padding:11px 12px;border-radius:14px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.12);">
              <div style="font-size:0.74rem;text-transform:uppercase;letter-spacing:0.12em;opacity:0.75;">Estado</div>
              <div style="font-size:1rem;font-weight:700;margin-top:4px;">Listo para cobrar</div>
            </div>
          </div>
        </div>

        <div style="padding:20px 22px 22px;">
          <div id="posDraftStatus" style="display:none;"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div style="font-weight:700;color:#0f172a;font-size:1rem;">Detalle del carrito</div>
            <button id="btnVaciarCarritoPOS" type="button" style="background:#fff1f2;color:#e11d48;border:1px solid #fecdd3;border-radius:999px;padding:8px 12px;font-weight:700;cursor:pointer;font-size:0.88rem;">Vaciar</button>
          </div>

          <div id="carritoPOS" style="display:flex;flex-direction:column;gap:10px;max-height:310px;overflow:auto;padding-right:2px;margin-bottom:16px;"></div>

          <div id="resumen-pago-pos" style="background:linear-gradient(180deg,#f8fafc 0%,#f1f5f9 100%);border:1px solid #e2e8f0;border-radius:18px;padding:16px 16px 14px;margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:0.98rem;color:#334155;">
              <span>Subtotal</span>
              <strong id="subtotalPOS" style="font-size:1.02rem;color:#0f172a;">$0</strong>
            </div>
            <div id="lineaDescuentoPOS" style="display:none;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:0.96rem;color:#16a34a;font-weight:700;">
              <span>Descuento (<span id="nombreDescuentoPOS"></span>)</span>
              <span>-<span id="montoDescuentoPOS">$0</span></span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding-top:10px;border-top:1px solid #cbd5e1;">
              <span style="font-size:0.84rem;text-transform:uppercase;letter-spacing:0.12em;color:#64748b;">Total a cobrar</span>
              <strong id="totalPOS" style="font-size:1.55rem;color:#1d4ed8;line-height:1;">$0</strong>
            </div>
          </div>

          <div id="aplicar-descuento-cont" style="display:flex; gap:8px; margin-bottom:14px;">
            <input id="codigoDescuentoInput" placeholder="Codigo de descuento" style="flex-grow:1; padding:10px 12px; border-radius:10px; border:1.5px solid #dbe4f0; background:#fff;">
            <button id="btnAplicarDescuento" style="background:#4f46e5; color:white; border:none; padding:0 18px; border-radius:10px; font-weight:700; cursor:pointer;">Aplicar</button>
            <button id="btnRemoverDescuento" style="background:#ef4444; color:white; border:none; padding:0 15px; border-radius:10px; font-weight:700; cursor:pointer; display:none;">Quitar</button>
          </div>

          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:14px 14px 12px;margin-bottom:14px;">
            <div style="font-size:0.82rem;text-transform:uppercase;letter-spacing:0.12em;color:#64748b;font-weight:700;margin-bottom:10px;">Forma de venta</div>
            <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
              <select id="modoPOS" style="flex:1 1 160px;padding:10px 12px;border-radius:10px;border:1.5px solid #cbd5e1;background:#fff;">
                <option value="inmediato">Pago Inmediato</option>
                <option value="habitacion">Cargar a Habitacion</option>
              </select>
              <select id="metodoPOS" style="flex:1 1 160px;padding:10px 12px;border-radius:10px;border:1.5px solid #cbd5e1;background:#fff;"></select>
              <select id="habitacionPOS" style="flex:1 1 160px;display:none;padding:10px 12px;border-radius:10px;border:1.5px solid #cbd5e1;background:#fff;"></select>
            </div>
            <input id="clientePOS" placeholder="Cliente (opcional)" style="width:100%;padding:10px 12px;font-size:1rem;border-radius:10px;border:1.5px solid #dbe4f0;background:#fff;">
          </div>

          <button id="btnVentaPOS" style="width:100%; background:linear-gradient(90deg,#16a34a 0%,#22c55e 44%,#38bdf8 100%); color:#fff;font-size:1.08rem;font-weight:800; border:none;padding:14px 0;border-radius:14px;box-shadow:0 12px 24px rgba(34,197,94,0.18); margin-bottom:6px;letter-spacing:0.02em;cursor:pointer;">Registrar Venta</button>
          <div id="msgPOS" style="margin-top:10px;font-weight:700;min-height:24px;color:#e11d48;"></div>
        </div>
      </div>
    </div>
  `;

  const buscadorPOSEl = document.getElementById('buscadorPOS');
  buscadorPOSEl.oninput = (event) => {
    posFiltro = event.target.value.toLowerCase();
    renderProductosPOS();
    savePOSDraftState();
  };

  const modoPOSEl = document.getElementById('modoPOS');
  modoPOSEl.onchange = (event) => {
    const modo = event.target.value;
    document.getElementById('metodoPOS').style.display = modo === 'inmediato' ? 'block' : 'none';
    document.getElementById('clientePOS').style.display = modo === 'inmediato' ? 'block' : 'none';
    document.getElementById('habitacionPOS').style.display = modo === 'habitacion' ? 'block' : 'none';
    savePOSDraftState();
  };

  renderMetodosPagoPOS();
  renderHabitacionesPOS();
  restorePOSDraftState();
  modoPOSEl.dispatchEvent(new Event('change'));
  renderProductosPOS();
  renderCarritoPOS();

  document.getElementById('btnVentaPOS').onclick = registrarVentaPOS;
  document.getElementById('btnAplicarDescuento').onclick = aplicarDescuentoPOS;
  document.getElementById('btnRemoverDescuento').onclick = removerDescuentoPOS;
  document.getElementById('metodoPOS').onchange = savePOSDraftState;
  document.getElementById('habitacionPOS').onchange = savePOSDraftState;
  document.getElementById('clientePOS').oninput = savePOSDraftState;
  document.getElementById('codigoDescuentoInput').oninput = savePOSDraftState;
  document.getElementById('btnVaciarCarritoPOS').onclick = () => {
    posCarrito = [];
    descuentoAplicado = null;
    const codigoInputEl = document.getElementById('codigoDescuentoInput');
    if (codigoInputEl) codigoInputEl.value = '';
    renderCarritoPOS();
  };

  if (document.getElementById('codigoDescuentoInput')?.value) {
    await aplicarDescuentoPOS();
  }
}

function getDiscountableBase(discount, cart) {
  const aplicabilidad = discount.aplicabilidad;
  const itemsAplicables = discount.habitaciones_aplicables || [];

  if (aplicabilidad === 'reserva_total') {
    return cart.reduce((acc, item) => acc + (item.cantidad * item.precio_venta), 0);
  }
  if (aplicabilidad === 'productos_tienda') {
    if (!itemsAplicables.length) return 0;
    return cart
      .filter((item) => itemsAplicables.includes(item.id))
      .reduce((acc, item) => acc + (item.cantidad * item.precio_venta), 0);
  }
  if (aplicabilidad === 'categorias_restaurante') {
    if (!itemsAplicables.length) return 0;
    return cart
      .filter((item) => itemsAplicables.includes(item.categoria_id))
      .reduce((acc, item) => acc + (item.cantidad * item.precio_venta), 0);
  }
  return 0;
}

export async function aplicarDescuentoPOS() {
  const codigoInput = document.getElementById('codigoDescuentoInput');
  const codigo = codigoInput.value.trim().toUpperCase();
  const msgEl = document.getElementById('msgPOS');

  if (!codigo) {
    msgEl.textContent = 'Por favor, ingresa un codigo.';
    return;
  }

  msgEl.textContent = 'Buscando descuento...';

  const { data: discount, error } = await tiendaState.currentSupabase
    .from('descuentos')
    .select('*')
    .eq('hotel_id', tiendaState.currentHotelId)
    .eq('codigo', codigo)
    .single();

  if (error || !discount) {
    msgEl.textContent = 'Codigo de descuento no valido o no encontrado.';
    descuentoAplicado = null;
    renderCarritoPOS();
    return;
  }

  if (!discount.activo) {
    msgEl.textContent = 'Este codigo de descuento ya no esta activo.';
    return;
  }
  if (discount.usos_maximos > 0 && (discount.usos_actuales || 0) >= discount.usos_maximos) {
    msgEl.textContent = 'Este codigo alcanzo su limite de usos.';
    return;
  }

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  if (discount.fecha_inicio && new Date(discount.fecha_inicio) > hoy) {
    msgEl.textContent = 'Este descuento aun no es valido.';
    return;
  }
  if (discount.fecha_fin && new Date(discount.fecha_fin) < hoy) {
    msgEl.textContent = 'Este descuento ha expirado.';
    return;
  }

  const baseDescuento = getDiscountableBase(discount, posCarrito);
  if (baseDescuento <= 0) {
    msgEl.textContent = 'El codigo no aplica a los productos en tu carrito.';
    return;
  }

  descuentoAplicado = discount;
  msgEl.textContent = `Descuento "${discount.nombre}" aplicado.`;
  renderCarritoPOS();
}

export function removerDescuentoPOS() {
  descuentoAplicado = null;
  document.getElementById('codigoDescuentoInput').value = '';
  document.getElementById('msgPOS').textContent = 'Descuento removido.';
  renderCarritoPOS();
}

function renderMetodosPagoPOS() {
  const sel = document.getElementById('metodoPOS');
  if (!sel) return;
  sel.innerHTML = posMetodosPago.map((metodo, index) => `
    <option value="${metodo.id}" ${index === 0 ? 'selected' : ''}>${metodo.nombre}</option>
  `).join('');
}

function renderHabitacionesPOS() {
  const sel = document.getElementById('habitacionPOS');
  if (!sel) return;
  sel.innerHTML = '<option value="">Selecciona habitacion...</option>' + posHabitacionesOcupadas.map((hab) => `
    <option value="${hab.id}">${hab.nombre}</option>
  `).join('');
}

function renderProductosPOS() {
  const cont = document.getElementById('productosPOS');
  if (!cont) return;

  let productosFiltrados = posProductos;
  if (posFiltro?.trim()) {
    const filtro = posFiltro.trim().toLowerCase();
    productosFiltrados = productosFiltrados.filter((producto) =>
      (producto.nombre || '').toLowerCase().includes(filtro) ||
      (producto.categoria_nombre || '').toLowerCase().includes(filtro) ||
      (producto.codigo_barras || '').toLowerCase().includes(filtro)
    );
  }

  if (!productosFiltrados.length) {
    cont.innerHTML = '<div style="color:#888;">No hay productos encontrados</div>';
    return;
  }

  cont.innerHTML = '';
  productosFiltrados.forEach((prod) => {
    const card = document.createElement('div');
    card.style = `
      border:1px solid #e5e7eb;
      padding:14px 12px 16px 12px;
      border-radius:14px;
      background:#fff;
      width:100%;
      max-width:220px;
      text-align:center;
      box-shadow:0 2px 12px #8bb5e628;
      display:flex;
      flex-direction:column;
      align-items:center;
      gap:8px;
      margin-bottom:12px;
      transition:box-shadow 0.23s, transform 0.18s;
      font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    `;
    card.onmouseover = () => {
      card.style.boxShadow = '0 8px 20px #2dd4b680';
      card.style.transform = 'translateY(-5px) scale(1.025)';
    };
    card.onmouseout = () => {
      card.style.boxShadow = '0 2px 12px #8bb5e628';
      card.style.transform = 'none';
    };
    card.innerHTML = `
      <img src="${prod.imagen_url || 'https://via.placeholder.com/180x180?text=Sin+Imagen'}" style="width:170px;height:140px;object-fit:contain;border-radius:8px;background:#f7fafc;margin-bottom:5px;">
      <div style="font-weight:600;color:#1e293b;word-break:break-all;margin-bottom:2px;">${prod.nombre}</div>
      <div style="font-size:13px;color:#64748b;word-break:break-all;margin-bottom:2px;"><span style="font-weight:500;">Categoria:</span> ${prod.categoria_nombre || 'Sin Cat.'}</div>
      <div style="font-size:13px;color:#334155;word-break:break-all;margin-bottom:2px;"><span style="font-weight:500;">Codigo:</span> ${prod.codigo_barras || '-'}</div>
      <div style="font-size:1.05em;color:#22c55e;font-weight:bold;">${formatCurrency(prod.precio_venta)}</div>
      <div style="font-size:13px;color:#666;">Stock: ${prod.stock_actual}</div>
      <button class="agregar-btn-pos" style="margin-top:7px;background:linear-gradient(90deg,#2563eb,#22d3ee);color:#fff;border:none;padding:7px 15px;border-radius:6px;cursor:pointer;font-weight:600;">Agregar</button>
    `;
    card.querySelector('.agregar-btn-pos').onclick = () => addToCartPOS(prod.id);
    cont.appendChild(card);
  });
}

function renderCarritoPOS() {
  const carritoEl = document.getElementById('carritoPOS');
  if (!carritoEl) return;
  carritoEl.innerHTML = '';

  const subtotalEl = document.getElementById('subtotalPOS');
  const totalEl = document.getElementById('totalPOS');
  const lineaDescuentoEl = document.getElementById('lineaDescuentoPOS');
  const nombreDescuentoEl = document.getElementById('nombreDescuentoPOS');
  const montoDescuentoEl = document.getElementById('montoDescuentoPOS');
  const btnAplicar = document.getElementById('btnAplicarDescuento');
  const btnRemover = document.getElementById('btnRemoverDescuento');
  const codigoInput = document.getElementById('codigoDescuentoInput');
  const cartItemsCountEl = document.getElementById('cartItemsCountPOS');
  const cartUnitsCountEl = document.getElementById('cartUnitsCountPOS');

  let subtotal = 0;
  let unidades = 0;
  posCarrito.forEach((item) => {
    const itemSubtotal = item.cantidad * item.precio_venta;
    subtotal += itemSubtotal;
    unidades += item.cantidad;

    const card = document.createElement('div');
    card.style = `
      display:grid;
      grid-template-columns:56px minmax(0,1fr) auto;
      gap:12px;
      align-items:center;
      padding:12px;
      border-radius:16px;
      border:1px solid #e2e8f0;
      background:#fff;
      box-shadow:0 6px 14px rgba(15,23,42,0.04);
    `;
    card.innerHTML = `
      <img src="${item.imagen_url || 'https://via.placeholder.com/96x96?text=Sin+Foto'}" alt="${item.nombre}" style="width:56px;height:56px;border-radius:14px;object-fit:cover;background:#f8fafc;border:1px solid #e2e8f0;">
      <div style="min-width:0;">
        <div style="font-weight:800;color:#0f172a;font-size:0.96rem;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.nombre}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;font-size:0.84rem;color:#64748b;">
          <span>Unitario: <strong style="color:#334155;">${formatCurrency(item.precio_venta)}</strong></span>
          <span>Subtotal: <strong style="color:#16a34a;">${formatCurrency(itemSubtotal)}</strong></span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">
          <span style="font-size:0.8rem;color:#64748b;font-weight:700;">Cantidad</span>
          <input type="number" min="1" max="${item.stock_actual}" value="${item.cantidad}" style="width:68px;padding:7px 8px;border-radius:10px;border:1.5px solid #cbd5e1;font-weight:700;" onchange="updateQtyPOS('${item.id}',this.value)">
        </div>
      </div>
      <button onclick="removeCartPOS('${item.id}')" style="align-self:flex-start;background:#fff1f2;color:#e11d48;border:1px solid #fecdd3;border-radius:999px;padding:8px 10px;cursor:pointer;font-weight:800;">X</button>
    `;
    carritoEl.appendChild(card);
  });

  if (!posCarrito.length) {
    carritoEl.innerHTML = `
      <div style="padding:22px 18px;border:1.5px dashed #cbd5e1;border-radius:18px;background:#f8fafc;text-align:center;color:#64748b;">
        <div style="font-size:2rem;line-height:1;margin-bottom:10px;">🛒</div>
        <div style="font-weight:800;color:#334155;margin-bottom:4px;">Tu carrito esta vacio</div>
        <div style="font-size:0.92rem;">Agrega productos desde la izquierda para comenzar la venta.</div>
      </div>
    `;
  }

  let montoDescuento = 0;
  let totalFinal = subtotal;

  if (descuentoAplicado && subtotal > 0) {
    const baseDescuento = getDiscountableBase(descuentoAplicado, posCarrito);
    if (baseDescuento > 0) {
      montoDescuento = descuentoAplicado.tipo === 'porcentaje'
        ? baseDescuento * (descuentoAplicado.valor / 100)
        : descuentoAplicado.valor;
      montoDescuento = Math.min(montoDescuento, baseDescuento);
      totalFinal = subtotal - montoDescuento;
    } else {
      descuentoAplicado = null;
    }
  }

  subtotalEl.textContent = formatCurrency(subtotal);
  totalEl.textContent = formatCurrency(totalFinal);
  if (cartItemsCountEl) cartItemsCountEl.textContent = String(posCarrito.length);
  if (cartUnitsCountEl) cartUnitsCountEl.textContent = String(unidades);

  if (descuentoAplicado && montoDescuento > 0) {
    lineaDescuentoEl.style.display = 'flex';
    nombreDescuentoEl.textContent = descuentoAplicado.nombre;
    montoDescuentoEl.textContent = formatCurrency(montoDescuento);
    btnAplicar.style.display = 'none';
    btnRemover.style.display = 'block';
    codigoInput.disabled = true;
  } else {
    lineaDescuentoEl.style.display = 'none';
    btnAplicar.style.display = 'block';
    btnRemover.style.display = 'none';
    codigoInput.disabled = false;
  }

  if (!posCarrito.length) {
    setPOSDraftStatus('');
  } else if (posDraftRestored) {
    setPOSDraftStatus('Borrador recuperado y listo para continuar.', 'info');
  }

  savePOSDraftState();
}

export function updateQtyPOS(id, val) {
  const item = posCarrito.find((entry) => entry.id === id);
  if (!item) return;
  const value = parseInt(val, 10);
  if (value > 0 && value <= item.stock_actual) {
    item.cantidad = value;
  }
  renderCarritoPOS();
}

export function removeCartPOS(id) {
  posCarrito = posCarrito.filter((item) => item.id !== id);
  renderCarritoPOS();
}

function addToCartPOS(id) {
  const prod = posProductos.find((item) => item.id === id);
  if (!prod) return;
  const item = posCarrito.find((entry) => entry.id === id);
  if (item) {
    if (item.cantidad < prod.stock_actual) item.cantidad++;
  } else {
    posCarrito.push({ ...prod, cantidad: 1 });
  }
  renderCarritoPOS();
}

export async function registrarVentaPOS() {
  if (ventaPOSenCurso) return;
  ventaPOSenCurso = true;
  const btnVentaPOSEl = document.getElementById('btnVentaPOS');
  if (btnVentaPOSEl) btnVentaPOSEl.disabled = true;

  try {
    if (!posCarrito.length) {
      document.getElementById('msgPOS').textContent = 'Carrito vacio';
      return;
    }

    const modo = document.getElementById('modoPOS').value;
    let habitacion_id = null;
    let cliente_temporal = null;

    if (modo === 'inmediato') {
      const metodo_pago_id = document.getElementById('metodoPOS').value;
      cliente_temporal = document.getElementById('clientePOS').value || null;
      const total = posCarrito.reduce((a, b) => a + b.precio_venta * b.cantidad, 0);

      if (metodo_pago_id === 'mixto') {
        await mostrarModalPagoMixto(total, async (pagos) => {
          if (!pagos) return;
          await procesarVentaConPagos({ pagos, habitacion_id, cliente_temporal, modo, total });
        });
        return;
      }

      await procesarVentaConPagos({
        pagos: [{ metodo_pago_id, monto: total }],
        habitacion_id,
        cliente_temporal,
        modo,
        total,
      });
      return;
    }

    habitacion_id = document.getElementById('habitacionPOS').value;
    if (!habitacion_id) {
      document.getElementById('msgPOS').textContent = 'Selecciona una habitacion';
      return;
    }
    await procesarVentaConPagos({ pagos: [], habitacion_id, cliente_temporal, modo, total: null });
  } catch (err) {
    document.getElementById('msgPOS').textContent = err.message;
  } finally {
    ventaPOSenCurso = false;
    if (btnVentaPOSEl) btnVentaPOSEl.disabled = false;
  }
}

async function mostrarModalPagoMixto(totalAPagar, callback) {
  const modalContainer = document.createElement('div');
  modalContainer.id = 'modal-pago-mixto-pos';
  modalContainer.style = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:1002;';

  const metodosDisponibles = posMetodosPago.filter((metodo) => metodo.id !== 'mixto');
  const opcionesMetodosHTML = metodosDisponibles
    .map((metodo) => `<option value="${metodo.id}">${metodo.nombre}</option>`)
    .join('');

  modalContainer.innerHTML = `
    <div style="background:white; border-radius:12px; padding:24px; width:95%; max-width:500px; max-height:90vh; display:flex; flex-direction:column;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="margin:0; font-size:1.2em; color:#1e3a8a;">Registrar Pago Mixto (POS)</h3>
        <button class="btn-cerrar" style="background:none; border:none; font-size:1.5em; cursor:pointer;">&times;</button>
      </div>
      <p style="text-align:center; font-size:1.1em; margin-bottom:15px;">Total a Pagar: <strong style="color:#c2410c; font-size:1.2em;">${formatCurrency(totalAPagar)}</strong></p>
      <form id="form-pago-mixto-pos" style="overflow-y:auto; flex-grow:1; padding-right:10px;">
        <div id="lista-pagos-mixtos-pos" class="space-y-3"></div>
        <button type="button" id="btn-agregar-pago-mixto-pos" style="font-size:0.9em; color:#1d4ed8; background:none; border:none; cursor:pointer; margin-top:10px;">+ Agregar otro metodo</button>
      </form>
      <div style="margin-top:15px; padding-top:15px; border-top:1px solid #eee; font-weight:600;">
        <div style="display:flex; justify-content:space-between;"><span>Total ingresado:</span> <span id="total-ingresado-mixto-pos">$0</span></div>
        <div style="display:flex; justify-content:space-between; color:#ef4444;" id="linea-restante-pos"><span>Restante:</span> <span id="restante-mixto-pos">${formatCurrency(totalAPagar)}</span></div>
      </div>
      <div style="display:flex; gap:10px; margin-top:20px;">
        <button type="submit" form="form-pago-mixto-pos" id="btn-confirmar-pago-mixto-pos" style="flex:1; background:#16a34a; color:white; border:none; padding:10px; border-radius:6px; font-weight:600; cursor:pointer;" disabled>Confirmar Pago</button>
        <button type="button" class="btn-cerrar" style="flex:1; background:#6b7280; color:white; border:none; padding:10px; border-radius:6px; font-weight:600; cursor:pointer;">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalContainer);

  const form = modalContainer.querySelector('#form-pago-mixto-pos');
  const listaPagosDiv = modalContainer.querySelector('#lista-pagos-mixtos-pos');
  const btnConfirmar = modalContainer.querySelector('#btn-confirmar-pago-mixto-pos');

  const closeAction = () => {
    modalContainer.remove();
    callback(null);
  };
  modalContainer.querySelectorAll('.btn-cerrar').forEach((btn) => {
    btn.onclick = closeAction;
  });

  const actualizarTotales = () => {
    let totalIngresado = 0;
    listaPagosDiv.querySelectorAll('.pago-mixto-row-pos').forEach((row) => {
      totalIngresado += Number(row.querySelector('.monto-pago-mixto-pos').value) || 0;
    });
    const restante = totalAPagar - totalIngresado;
    modalContainer.querySelector('#total-ingresado-mixto-pos').textContent = formatCurrency(totalIngresado);
    modalContainer.querySelector('#restante-mixto-pos').textContent = formatCurrency(restante);
    const lineaRestante = modalContainer.querySelector('#linea-restante-pos');
    if (Math.abs(restante) < 0.01) {
      btnConfirmar.disabled = false;
      lineaRestante.style.color = '#16a34a';
    } else {
      btnConfirmar.disabled = true;
      lineaRestante.style.color = '#ef4444';
    }
  };

  const agregarFila = () => {
    const newRow = document.createElement('div');
    newRow.className = 'pago-mixto-row-pos';
    newRow.style = 'display:flex; gap:8px; align-items:center;';
    newRow.innerHTML = `
      <select class="metodo-pago-mixto-pos" style="flex:2; padding:8px; border:1px solid #ccc; border-radius:4px;" required>${opcionesMetodosHTML}</select>
      <input type="number" class="monto-pago-mixto-pos" placeholder="Monto" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:4px;" required min="0">
      <button type="button" class="btn-remover-fila-pos" style="background:#fee2e2; color:#dc2626; border:none; padding:5px 8px; border-radius:4px; cursor:pointer;">X</button>
    `;
    listaPagosDiv.appendChild(newRow);
    newRow.querySelector('.btn-remover-fila-pos').onclick = () => {
      newRow.remove();
      actualizarTotales();
    };
  };

  modalContainer.querySelector('#btn-agregar-pago-mixto-pos').onclick = agregarFila;
  listaPagosDiv.addEventListener('input', actualizarTotales);
  agregarFila();
  const primerInput = listaPagosDiv.querySelector('.monto-pago-mixto-pos');
  if (primerInput) primerInput.value = totalAPagar;
  actualizarTotales();

  form.onsubmit = (event) => {
    event.preventDefault();
    const pagosConfirmados = [];
    listaPagosDiv.querySelectorAll('.pago-mixto-row-pos').forEach((row) => {
      const metodoId = row.querySelector('.metodo-pago-mixto-pos').value;
      const monto = Number(row.querySelector('.monto-pago-mixto-pos').value);
      if (metodoId && monto > 0) {
        pagosConfirmados.push({ metodo_pago_id: metodoId, monto });
      }
    });
    if (pagosConfirmados.length > 0) {
      callback(pagosConfirmados);
      modalContainer.remove();
    }
  };
}

async function procesarVentaConPagos({ pagos, habitacion_id, cliente_temporal, modo }) {
  const msgPOSEl = document.getElementById('msgPOS');
  const carritoParaImpresion = posCarrito.map((item) => ({
    nombre: item.nombre,
    cantidad: item.cantidad,
    precio: item.precio_venta,
    total: item.cantidad * item.precio_venta
  }));
  const subtotalVenta = posCarrito.reduce((a, b) => a + b.precio_venta * b.cantidad, 0);
  let montoDescuento = 0;
  let totalVentaFinal = subtotalVenta;

  if (descuentoAplicado) {
    const baseDescuento = getDiscountableBase(descuentoAplicado, posCarrito);
    if (baseDescuento > 0) {
      montoDescuento = descuentoAplicado.tipo === 'porcentaje'
        ? baseDescuento * (descuentoAplicado.valor / 100)
        : descuentoAplicado.valor;
      montoDescuento = Math.min(montoDescuento, baseDescuento);
      totalVentaFinal = subtotalVenta - montoDescuento;
    }
  }

  let reservaId = null;
  if (habitacion_id) {
    const { data: reservasActivas } = await tiendaState.currentSupabase
      .from('reservas')
      .select('id')
      .eq('habitacion_id', habitacion_id)
      .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
      .order('fecha_inicio', { ascending: false })
      .limit(1);
    if (reservasActivas?.length) {
      reservaId = reservasActivas[0].id;
    }
  }

  const ventaPayload = {
    hotel_id: tiendaState.currentHotelId,
    usuario_id: tiendaState.currentUser.id,
    habitacion_id,
    reserva_id: reservaId,
    total_venta: totalVentaFinal,
    fecha: new Date().toISOString(),
    creado_en: new Date().toISOString(),
    cliente_temporal,
    metodo_pago_id: modo === 'inmediato' && pagos.length === 1 ? pagos[0].metodo_pago_id : null,
    descuento_id: descuentoAplicado ? descuentoAplicado.id : null,
    monto_descuento: montoDescuento > 0 ? montoDescuento : null,
  };

  const { data: ventas, error } = await tiendaState.currentSupabase
    .from('ventas_tienda')
    .insert([ventaPayload])
    .select();
  if (error || !ventas?.[0]) throw new Error(`Error guardando venta: ${error?.message}`);

  const ventaId = ventas[0].id;

  if (descuentoAplicado && montoDescuento > 0) {
    const { error: rpcError } = await tiendaState.currentSupabase.rpc('incrementar_uso_descuento', {
      descuento_id_param: descuentoAplicado.id,
    });
    if (rpcError) {
      console.error('Advertencia: No se pudo incrementar el uso del descuento en la tienda.', rpcError);
    }
  }

  for (const item of posCarrito) {
    await tiendaState.currentSupabase.from('detalle_ventas_tienda').insert([{
      venta_id: ventaId,
      producto_id: item.id,
      cantidad: item.cantidad,
      precio_unitario_venta: item.precio_venta,
      subtotal: item.cantidad * item.precio_venta,
      hotel_id: tiendaState.currentHotelId,
      creado_en: new Date().toISOString(),
    }]);

    await tiendaState.currentSupabase.rpc('increment', {
      table_name: 'productos_tienda',
      column_name: 'stock_actual',
      row_id: item.id,
      amount: -item.cantidad,
    });
  }

  const turnoId = turnoService.getActiveTurnId();
  if (modo === 'inmediato') {
    if (!turnoId) {
      showError(msgPOSEl, 'No hay un turno de caja activo.');
      return;
    }

    const nombresProductos = posCarrito.map((item) => `${item.nombre} x${item.cantidad}`).join(', ');
    for (const pago of pagos) {
      await tiendaState.currentSupabase.from('caja').insert({
        hotel_id: tiendaState.currentHotelId,
        tipo: 'ingreso',
        monto: Number(pago.monto),
        concepto: `Venta Tienda: ${nombresProductos}`,
        fecha_movimiento: new Date().toISOString(),
        metodo_pago_id: pago.metodo_pago_id,
        usuario_id: tiendaState.currentUser.id,
        venta_tienda_id: ventaId,
        turno_id: turnoId,
      });
    }
    msgPOSEl.textContent = 'Venta registrada.';
  } else {
    msgPOSEl.textContent = 'Consumo cargado a la cuenta de la habitacion.';
  }

  posCarrito = [];
  descuentoAplicado = null;
  document.getElementById('codigoDescuentoInput').value = '';
  posDraftRestored = false;
  clearPOSDraft('tienda', tiendaState.currentHotelId, tiendaState.currentUser?.id);
  renderCarritoPOS();
  await cargarDatosPOS();
  renderProductosPOS();
  setPOSDraftStatus('Venta registrada. El borrador del carrito se limpió automáticamente.', 'success');

  try {
    const paymentLabels = pagos.map((pago) => ({
      label: posMetodosPago.find((metodo) => metodo.id === pago.metodo_pago_id)?.nombre || 'Metodo',
      amount: pago.monto
    }));
    await imprimirTicketOperacion({
      supabase: tiendaState.currentSupabase,
      hotelId: tiendaState.currentHotelId,
      documentLabel: modo === 'inmediato' ? 'Ticket POS Tienda' : 'Comprobante de consumo cargado',
      reference: ventaId,
      clientName: cliente_temporal || (habitacion_id ? posHabitacionesOcupadas.find((habitacion) => habitacion.id === habitacion_id)?.nombre : null),
      meta: habitacion_id ? [{ label: 'Habitación', value: posHabitacionesOcupadas.find((habitacion) => habitacion.id === habitacion_id)?.nombre || '-' }] : [],
      items: carritoParaImpresion,
      subtotal: subtotalVenta,
      discount: montoDescuento,
      taxes: 0,
      total: totalVentaFinal,
      payments: paymentLabels,
      notes: modo === 'habitacion' ? 'Consumo cargado a la cuenta de la habitación.' : ''
    });
  } catch (printError) {
    console.warn('[POS Tienda] No se pudo imprimir el ticket:', printError);
  }

  setTimeout(() => {
    msgPOSEl.textContent = '';
  }, 2500);
}

export function resetPOSState() {
  descuentoAplicado = null;
  posProductos = [];
  posMetodosPago = [];
  posHabitacionesOcupadas = [];
  posCarrito = [];
  posFiltro = '';
  ventaPOSenCurso = false;
  posDraftRestored = false;
}
