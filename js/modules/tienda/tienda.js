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

import { turnoService } from '../../services/turnoService.js';
import { showError, showSuccess } from '../../uiUtils.js';
import { fetchTurnoActivo } from '../../services/turnoService.js';

async function checkTurnoActivo(supabase, hotelId, usuarioId) {
  const turno = await fetchTurnoActivo(supabase, hotelId, usuarioId);
  if (!turno) {
    // Bloquea acciones aquí y muestra mensaje:
    mostrarInfoModalGlobal(
      "Acción bloqueada: No hay un turno de caja abierto. Ábrelo desde el módulo de Caja.",
      "Turno Requerido"
    );
    // O muestra un botón para abrir el turno directamente (solo si es seguro).
    return false;
  }
  // Si hay turno, sigue con el flujo normal
  return true;
}


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
// ==== FUNCIONES UTILITARIAS PARA TIENDA.JS ====

// Formatea un número a moneda local (COP)
function formatCurrency(num) {
  return '$' + Number(num || 0).toLocaleString('es-CO', { minimumFractionDigits: 0 });
}

// Muestra un loader global (puedes personalizar esto)
function showGlobalLoading(msg="Cargando...") {
  if (document.getElementById('globalLoadingModal')) return;
  const div = document.createElement('div');
  div.id = 'globalLoadingModal';
  div.style = `
    position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:999999;
    background:rgba(51,65,85,0.13);display:flex;align-items:center;justify-content:center;`;
  div.innerHTML = `<div style="background:#fff;padding:36px 36px 22px 36px;border-radius:16px;box-shadow:0 8px 60px #2563eb40;text-align:center;">
    <div style="font-size:2em;color:#1d4ed8;margin-bottom:14px;">⏳</div>
    <div style="font-size:1.13em;font-weight:600;">${msg}</div>
  </div>`;
  document.body.appendChild(div);
}

// Oculta el loader global
function hideGlobalLoading() {
  let modal = document.getElementById('globalLoadingModal');
  if (modal) modal.remove();
}

// ====================  BLOQUE POS COMPLETO CON "PAGO MIXTO" POR DEFECTO ====================

let posProductos = [];
let posMetodosPago = [];
let posHabitacionesOcupadas = [];
let posCarrito = [];
let posFiltro = '';

async function cargarDatosPOS() {
  let { data: productos } = await currentSupabase
    .from('productos_tienda')
    .select('id, nombre, precio_venta, imagen_url, stock_actual, categoria_id, codigo_barras')
    .eq('hotel_id', currentHotelId)
    .eq('activo', true)
    .gt('stock_actual', 0);

  let { data: categorias } = await currentSupabase
    .from('categorias_producto')
    .select('id, nombre');

  const catMap = Object.fromEntries((categorias || []).map(cat => [cat.id, cat.nombre]));
  posProductos = (productos || []).map(p => ({
    ...p,
    categoria_nombre: catMap[p.categoria_id] || 'Sin Cat.'
  }));

  let { data: metodos } = await currentSupabase
    .from('metodos_pago')
    .select('id, nombre')
    .eq('hotel_id', currentHotelId)
    .eq('activo', true);

  // "Pago Mixto" siempre primero y seleccionado por defecto
  posMetodosPago = [
    { id: "mixto", nombre: "Pago Mixto (varios métodos)" },
    ...(metodos || [])
  ];

  let { data: habitaciones } = await currentSupabase
    .from('habitaciones')
    .select('id, nombre')
    .eq('hotel_id', currentHotelId)
    .eq('estado', 'ocupada');
  posHabitacionesOcupadas = habitaciones || [];
}

async function renderPOS() {
  const cont = document.getElementById('contenidoTiendaTab');
  cont.innerHTML = `<div>Cargando...</div>`;
  await cargarDatosPOS();

  cont.innerHTML = `
    <div style="display: flex; flex-wrap: wrap; gap: 32px; align-items: flex-start; justify-content: center; background: #f3f6fa; border-radius: 16px; padding: 32px 18px 26px 18px; box-shadow: 0 6px 32px #23408c12; margin-top:20px;">
      <div style="flex: 1 1 340px; background: #fff; border-radius: 16px; box-shadow: 0 2px 18px #b6d0f912; padding: 28px 22px 28px 22px; min-width: 320px; margin-bottom: 12px;">
        <h2 style="font-size: 1.4rem; color: #2563eb; font-weight: bold; margin-bottom: 22px; letter-spacing: 1px;">
          <span style="font-size:1.1em;">🛒</span> Productos disponibles
        </h2>
        <input id="buscadorPOS" placeholder="🔍 Buscar producto, categoría o código..." style="width:100%;margin-bottom:16px;padding:11px 15px;font-size:16px;border-radius:9px;border:1.5px solid #cbd5e1; background:#f9fafb; outline:none; box-shadow:0 1px 6px #2563eb11; transition: border .2s;"
        onfocus="this.style.borderColor='#2563eb'"
        onblur="this.style.borderColor='#cbd5e1'">
        <div id="productosPOS" style="display: grid; grid-template-columns: repeat(auto-fill,minmax(180px,1fr)); gap:18px; margin-bottom:8px;"></div>
      </div>
      <div style="min-width:340px; max-width: 410px; flex: 1 1 340px; background: #fff; border-radius: 16px; box-shadow: 0 2px 14px #b6d0f922; padding: 28px 24px; position: sticky; top: 20px; align-self: flex-start; z-index: 10;">
        <h2 style="font-size: 1.4rem; color: #22c55e; font-weight: bold; margin-bottom: 16px; letter-spacing: 1px;">
          <span style="font-size:1.1em;">🛍️</span> Carrito de venta
        </h2>
        <table style="width:100%;font-size:15px;margin-bottom:14px;border-radius:10px;overflow:hidden;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th>Producto</th>
              <th>Cant.</th>
              <th>Precio</th>
              <th>Subtotal</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="carritoPOS"></tbody>
        </table>
        <div style="text-align:right;font-size:1.15rem;font-weight:700;margin-bottom:14px;">
          Total: <span id="totalPOS" style="color:#1d4ed8">$0</span>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <select id="modoPOS" style="flex:1;max-width:160px;padding:8px 10px;border-radius:7px;border:1.5px solid #cbd5e1;">
            <option value="inmediato">Pago Inmediato</option>
            <option value="habitacion">Cargar a Habitación</option>
          </select>
          <select id="metodoPOS" style="flex:1;max-width:160px;padding:8px 10px;border-radius:7px;border:1.5px solid #cbd5e1;"></select>
          <select id="habitacionPOS" style="flex:1;display:none;max-width:160px;padding:8px 10px;border-radius:7px;border:1.5px solid #cbd5e1;"></select>
        </div>
        <input id="clientePOS" placeholder="Cliente (opcional)" style="width:100%;margin-bottom:12px;padding:8px 12px;font-size:1rem;border-radius:7px;border:1.5px solid #e5e7eb;">
        <button id="btnVentaPOS" style="width:100%; background:linear-gradient(90deg,#22c55e,#38bdf8 92%); color:#fff;font-size:1.13rem;font-weight:700; border:none;padding:13px 0;border-radius:9px;box-shadow:0 2px 6px #22c55e33; margin-bottom:4px;letter-spacing:0.8px;cursor:pointer; transition: background .18s;"
        onmouseover="this.style.background='linear-gradient(90deg,#38bdf8,#22c55e 92%)'"
        onmouseout="this.style.background='linear-gradient(90deg,#22c55e,#38bdf8 92%)'">Registrar Venta</button>
        <div id="msgPOS" style="color:#e11d48;margin-top:10px;font-weight:bold;min-height:28px;"></div>
      </div>
    </div>`;

  const buscadorPOSEl = document.getElementById('buscadorPOS');
  if (buscadorPOSEl) {
    buscadorPOSEl.oninput = (e) => {
      posFiltro = e.target.value.toLowerCase();
      renderProductosPOS();
    };
  }

  const modoPOSEl = document.getElementById('modoPOS');
  if (modoPOSEl) {
    modoPOSEl.onchange = (e) => {
      const modo = e.target.value;
      document.getElementById('metodoPOS').style.display = modo === 'inmediato' ? 'block' : 'none';
      document.getElementById('clientePOS').style.display = modo === 'inmediato' ? 'block' : 'none';
      document.getElementById('habitacionPOS').style.display = modo === 'habitacion' ? 'block' : 'none';
    };
    modoPOSEl.dispatchEvent(new Event('change'));
  }

  renderProductosPOS();
  renderCarritoPOS();
  renderMetodosPagoPOS();
  renderHabitacionesPOS();

  document.getElementById('btnVentaPOS').onclick = registrarVentaPOS;
}

function renderMetodosPagoPOS() {
  const sel = document.getElementById('metodoPOS');
  if (!sel) return;
  sel.innerHTML = '';
  posMetodosPago.forEach((m, idx) => {
    sel.innerHTML += `<option value="${m.id}" ${idx === 0 ? 'selected' : ''}>${m.nombre}</option>`;
  });
}

function renderHabitacionesPOS() {
  const sel = document.getElementById('habitacionPOS');
  if (!sel) return;
  sel.innerHTML = '<option value="">Selecciona habitación...</option>';
  posHabitacionesOcupadas.forEach(hab => {
    sel.innerHTML += `<option value="${hab.id}">${hab.nombre}</option>`;
  });
}

function renderProductosPOS() {
  const cont = document.getElementById('productosPOS');
  if (!cont) return;
  cont.innerHTML = '';
  let productosFiltrados = posProductos;
  if (posFiltro && posFiltro.trim()) {
    const fil = posFiltro.trim().toLowerCase();
    productosFiltrados = productosFiltrados.filter(p =>
      (p.nombre || '').toLowerCase().includes(fil) ||
      (p.categoria_nombre || '').toLowerCase().includes(fil) ||
      (p.codigo_barras || '').toLowerCase().includes(fil)
    );
  }
  if (productosFiltrados.length === 0) {
    cont.innerHTML = `<div style="color:#888;">No hay productos encontrados</div>`;
    return;
  }
  productosFiltrados.forEach(prod => {
    let card = document.createElement('div');
    card.style = `
      border: 1px solid #e5e7eb;
      padding: 14px 12px 16px 12px;
      border-radius: 14px;
      background: #fff;
      width: 100%;
      max-width: 220px;
      text-align: center;
      box-shadow: 0 2px 12px #8bb5e628;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      transition: box-shadow 0.23s, transform 0.18s;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    `;
    card.onmouseover = () => {
      card.style.boxShadow = "0 8px 20px #2dd4b680";
      card.style.transform = "translateY(-5px) scale(1.025)";
    };
    card.onmouseout = () => {
      card.style.boxShadow = "0 2px 12px #8bb5e628";
      card.style.transform = "none";
    };

    card.innerHTML = `
      <img src="${prod.imagen_url || 'https://via.placeholder.com/180x180?text=Sin+Imagen'}"
        style="width:170px;height:140px;object-fit:contain;border-radius:8px;background:#f7fafc;margin-bottom:5px;">
      <div style="font-weight:600;color:#1e293b;word-break:break-all;margin-bottom:2px;">
        ${prod.nombre}
      </div>
      <div style="font-size:13px;color:#64748b;word-break:break-all;margin-bottom:2px;">
        <span style="font-weight:500;">Categoría:</span> ${prod.categoria_nombre || 'Sin Cat.'}
      </div>
      <div style="font-size:13px;color:#334155;word-break:break-all;margin-bottom:2px;">
        <span style="font-weight:500;">Código:</span> ${prod.codigo_barras || '-'}
      </div>
      <div style="font-size:1.05em;color:#22c55e;font-weight:bold;">$${prod.precio_venta}</div>
      <div style="font-size:13px;color:#666;">Stock: ${prod.stock_actual}</div>
      <button class="agregar-btn-pos" style="
        margin-top:7px;background:linear-gradient(90deg,#2563eb,#22d3ee);
        color:#fff;border:none;padding:7px 15px;border-radius:6px;cursor:pointer;
        font-weight:600;box-shadow:0 1px 3px #1d4ed840;transition:background 0.18s;">
        Agregar
      </button>
    `;
    card.querySelector('.agregar-btn-pos').onclick = () => addToCartPOS(prod.id);
    cont.appendChild(card);
  });
}

function renderCarritoPOS() {
  const tbody = document.getElementById('carritoPOS');
  if (!tbody) return;
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
          onchange="updateQtyPOS('${item.id}',this.value)">
      </td>
      <td>$${item.precio_venta}</td>
      <td>$${subtotal}</td>
      <td><button onclick="removeCartPOS('${item.id}')" style="color:#e11;">X</button></td>
    `;
    tbody.appendChild(tr);
  });
  document.getElementById('totalPOS').textContent = `$${total}`;
}

window.updateQtyPOS = function (id, val) {
  let item = posCarrito.find(i => i.id === id);
  if (item) {
    let v = parseInt(val);
    if (v > 0 && v <= item.stock_actual) item.cantidad = v;
    renderCarritoPOS();
  }
};
window.removeCartPOS = function (id) {
  posCarrito = posCarrito.filter(i => i.id !== id);
  renderCarritoPOS();
};

function addToCartPOS(id) {
  const prod = posProductos.find(p => p.id === id);
  if (!prod) return;
  let item = posCarrito.find(i => i.id === id);
  if (item) {
    if (item.cantidad < prod.stock_actual) item.cantidad++;
  } else {
    posCarrito.push({ ...prod, cantidad: 1 });
  }
  renderCarritoPOS();
}

let ventaPOSenCurso = false;

async function registrarVentaPOS() {
  if (ventaPOSenCurso) return;
  ventaPOSenCurso = true;
  const btnVentaPOSEl = document.getElementById('btnVentaPOS');
  if (btnVentaPOSEl) btnVentaPOSEl.disabled = true;

  try {
    if (posCarrito.length === 0) {
      document.getElementById('msgPOS').textContent = "Carrito vacío";
      return;
    }
    const modo = document.getElementById('modoPOS').value;
    let habitacion_id = null, cliente_temporal = null;

    if (modo === 'inmediato') {
      const metodo_pago_id = document.getElementById('metodoPOS').value;
      cliente_temporal = document.getElementById('clientePOS').value || null;
      const total = posCarrito.reduce((a, b) => a + b.precio_venta * b.cantidad, 0);

      if (metodo_pago_id === "mixto") {
        // Si selecciona pago mixto, muestra el modal
        await mostrarModalPagoMixto(total, async function (pagos) {
          if (!pagos) return;
          await procesarVentaConPagos({ pagos, habitacion_id, cliente_temporal, modo, total });
        });
        return;
      } else {
        // Un solo método, pago tradicional
        await procesarVentaConPagos({
          pagos: [{ metodo_pago_id, monto: total }],
          habitacion_id,
          cliente_temporal,
          modo,
          total
        });
      }

    } else {
      habitacion_id = document.getElementById('habitacionPOS').value;
      if (habitacion_id === "") habitacion_id = null;
      if (!habitacion_id) {
        document.getElementById('msgPOS').textContent = "Selecciona una habitación";
        return;
      }
      await procesarVentaConPagos({ pagos: [], habitacion_id, cliente_temporal, modo, total: null });
    }
  } catch (err) {
    document.getElementById('msgPOS').textContent = err.message;
  } finally {
    ventaPOSenCurso = false;
    const btnVentaPOSEl = document.getElementById('btnVentaPOS');
    if (btnVentaPOSEl) btnVentaPOSEl.disabled = false;
  }
}

// ================== BLOQUE UTILIDAD MODAL PAGO MIXTO Y PROCESO DE VENTA ==================
async function mostrarModalPagoMixto(total, callback) {
  let pagos = [{ metodo_pago_id: '', monto: '' }];
  const body = document.body;
  const modal = document.createElement('div');
  modal.id = 'modal-pagos-mixtos-pos';
  modal.style = `
    position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;
    background:rgba(30,41,59,0.45);display:flex;align-items:center;justify-content:center;`;
  modal.innerHTML = `
    <div style="background:#fff;max-width:430px;width:95vw;padding:38px 28px 22px 28px;border-radius:20px;box-shadow:0 2px 32px #2563eb44;">
      <h3 style="font-size:1.22rem;font-weight:700;color:#2563eb;margin-bottom:15px;text-align:center;">Métodos de Pago Mixtos</h3>
      <div style="font-size:15px;color:#64748b;margin-bottom:8px;">Total de la venta: <b style="color:#0ea5e9;font-size:18px;">$${total}</b></div>
      <form id="formPagosMixtosPOS">
        <div id="pagosMixtosPOSCampos"></div>
        <div style="margin:13px 0;">
          <button type="button" id="agregarPagoPOS" style="background:#e0e7ff;color:#2563eb;border:none;border-radius:7px;padding:7px 18px;font-weight:600;font-size:1em;cursor:pointer;">+ Agregar Pago</button>
        </div>
        <div style="font-size:15px;margin-bottom:8px;color:#f43f5e;" id="msgPagosMixtosPOS"></div>
        <div style="display:flex;gap:12px;justify-content:center;margin-top:20px;">
          <button type="submit" style="background:linear-gradient(90deg,#22c55e,#2563eb);color:#fff;font-weight:700;border:none;border-radius:7px;padding:11px 28px;font-size:1.08em;box-shadow:0 2px 10px #22c55e22;cursor:pointer;">Registrar Pagos</button>
          <button type="button" id="cancelarPagoPOS" style="background:#e0e7ef;color:#334155;font-weight:600;border:none;border-radius:7px;padding:11px 28px;font-size:1.08em;box-shadow:0 2px 10px #64748b15;cursor:pointer;">Cancelar</button>
        </div>
      </form>
    </div>
  `;
  body.appendChild(modal);

  function renderPagosCampos() {
    const campos = modal.querySelector('#pagosMixtosPOSCampos');
    campos.innerHTML = '';
    pagos.forEach((pago, idx) => {
      campos.innerHTML += `
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:6px;">
          <select required style="padding:7px 12px;border-radius:7px;border:1.5px solid #cbd5e1;flex:2;" data-idx="${idx}">
            <option value="">Método de pago...</option>
            ${posMetodosPago.filter(m => m.id !== "mixto").map(m => `<option value="${m.id}" ${pago.metodo_pago_id === m.id ? 'selected' : ''}>${m.nombre}</option>`).join('')}
          </select>
          <input type="number" required min="1" style="flex:1.5;padding:7px 11px;border-radius:7px;border:1.5px solid #cbd5e1;" placeholder="Monto" value="${pago.monto}" data-idx="${idx}" />
          ${pagos.length > 1 ? `<button type="button" data-remove="${idx}" style="background:#fee2e2;color:#f43f5e;border:none;border-radius:5px;padding:3px 10px;font-size:1em;cursor:pointer;">✖</button>` : ''}
        </div>
      `;
    });
    campos.querySelectorAll('button[data-remove]').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.getAttribute('data-remove'));
        pagos.splice(idx, 1);
        renderPagosCampos();
      };
    });
    campos.querySelectorAll('select[data-idx]').forEach(sel => {
      sel.onchange = (e) => {
        pagos[parseInt(sel.getAttribute('data-idx'))].metodo_pago_id = sel.value;
      };
    });
    campos.querySelectorAll('input[type="number"][data-idx]').forEach(inp => {
      inp.oninput = (e) => {
        pagos[parseInt(inp.getAttribute('data-idx'))].monto = inp.value;
      };
    });
  }
  renderPagosCampos();

  modal.querySelector('#agregarPagoPOS').onclick = () => {
    pagos.push({ metodo_pago_id: '', monto: '' });
    renderPagosCampos();
  };
  modal.querySelector('#cancelarPagoPOS').onclick = () => {
    body.removeChild(modal);
    callback(null);
  };
  modal.querySelector('#formPagosMixtosPOS').onsubmit = (e) => {
    e.preventDefault();
    const suma = pagos.reduce((s, p) => s + Number(p.monto || 0), 0);
    if (suma !== total) {
      modal.querySelector('#msgPagosMixtosPOS').textContent = `La suma de los pagos ($${suma}) debe ser igual al total de la venta ($${total}).`;
      return;
    }
    for (let p of pagos) {
      if (!p.metodo_pago_id) {
        modal.querySelector('#msgPagosMixtosPOS').textContent = `Falta seleccionar método de pago.`;
        return;
      }
    }
    body.removeChild(modal);
    callback(pagos);
  };
}

async function procesarVentaConPagos({ pagos, habitacion_id, cliente_temporal, modo, total }) {
  const msgPOSEl = document.getElementById('msgPOS');
  let totalVenta = total ?? posCarrito.reduce((a, b) => a + b.precio_venta * b.cantidad, 0);
  let reservaId = null;
  if (habitacion_id) {
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
  let ventaPayload = {
    hotel_id: currentHotelId,
    usuario_id: currentUser.id,
    habitacion_id: habitacion_id,
    reserva_id: reservaId,
    total_venta: totalVenta,
    fecha: new Date().toISOString(),
    creado_en: new Date().toISOString(),
    cliente_temporal,
    metodo_pago_id: modo === 'inmediato' && pagos.length === 1 ? pagos[0].metodo_pago_id : null
  };
  let { data: ventas, error } = await currentSupabase.from('ventas_tienda').insert([ventaPayload]).select();
  if (error || !ventas?.[0]) throw new Error("Error guardando venta");
  let ventaId = ventas[0].id;

  for (let item of posCarrito) {
    await currentSupabase.from('detalle_ventas_tienda').insert([{
      venta_id: ventaId,
      producto_id: item.id,
      cantidad: item.cantidad,
      precio_unitario_venta: item.precio_venta,
      subtotal: item.cantidad * item.precio_venta,
      hotel_id: currentHotelId,
      creado_en: new Date().toISOString()
    }]);
    await currentSupabase.from('productos_tienda').update({
      stock_actual: item.stock_actual - item.cantidad
    }).eq('id', item.id);
  }

  const turnoId = turnoService.getActiveTurnId();
  if (modo === 'inmediato') {
    if (!turnoId) {
      if (msgPOSEl) showError(msgPOSEl, "No hay un turno de caja activo.");
      return;
    }
    const nombresProductos = posCarrito.map(i => `${i.nombre} x${i.cantidad}`).join(', ');
    for (let p of pagos) {
      const movimientoCaja = {
        hotel_id: currentHotelId,
        tipo: 'ingreso',
        monto: Number(p.monto),
        concepto: `Venta: ${nombresProductos}`,
        fecha_movimiento: new Date().toISOString(),
        metodo_pago_id: p.metodo_pago_id,
        usuario_id: currentUser.id,
        venta_tienda_id: ventaId,
        turno_id: turnoId
      };
      const { error: errorCaja } = await currentSupabase.from('caja').insert(movimientoCaja);
      if (errorCaja) {
        if (msgPOSEl) showError(msgPOSEl, `Error al registrar pago en caja: ${errorCaja.message}`);
      }
    }
    msgPOSEl.textContent = "¡Venta registrada!";
  } else {
    msgPOSEl.textContent = "Consumo cargado a la cuenta de la habitación.";
  }

  posCarrito = [];
  renderCarritoPOS();
  await cargarDatosPOS();
  renderProductosPOS();
  setTimeout(() => { msgPOSEl.textContent = ""; }, 1700);
}

// ====================  PESTAÑA INVENTARIO  ====================
let inventarioProductos = [];

async function renderInventario() {
  const cont = document.getElementById('contenidoTiendaTab');
  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
  <h2 style="font-size:1.35rem;font-weight:700;color:#1d4ed8;display:flex;align-items:center;gap:9px;">
    <svg width="23" height="23" fill="#1d4ed8"><use href="#icon-box"></use></svg>
    Inventario de Productos
  </h2>
  <button id="btnNuevoProducto" 
    style="background:linear-gradient(90deg,#22c55e,#16a34a);color:#fff;
           padding:9px 22px;border:none;border-radius:6px;font-size:1em;font-weight:600;
           box-shadow:0 1px 4px #22c55e55;transition:background 0.2s;">
    + Agregar Producto
  </button>
</div>

<div style="margin-bottom:12px;display:flex;align-items:center;gap:10px;">
  <input id="buscarInventario" placeholder="Buscar por nombre, código, categoría, proveedor..." 
    style="flex:1;max-width:320px;padding:9px 15px;border:1.5px solid #cbd5e1;border-radius:7px;font-size:1em;"/>
  <select id="filtroCategoriaInv" style="padding:8px 13px;border-radius:7px;border:1.5px solid #cbd5e1;font-size:1em;">
    <option value="">Todas las Categorías</option>
  </select>
</div>

<div style="overflow-x:auto;background:#fff;border-radius:10px;box-shadow:0 2px 8px #0001;">
  <table style="width:100%;font-size:14px;border-collapse:collapse;">
    <thead>
      <tr style="background:#f3f4f6;">
        <th style="padding:12px;">Nombre</th>
        <th style="padding:12px;">Código</th>
        <th style="padding:12px;">Categoría</th>
        <th style="padding:12px;">Proveedor</th>
        <th style="padding:12px;">Precio Compra</th>
        <th style="padding:12px;">Precio Venta</th>
        <th style="padding:12px;">Stock Actual</th>
        <th style="padding:12px;">Stock Mín</th>
        <th style="padding:12px;">Stock Máx</th>
        <th style="padding:12px;">Estado</th>
        <th style="padding:12px;">Acciones</th>
      </tr>
    </thead>
    <tbody id="invProductos"></tbody>
  </table>
</div>
<div id="modalProductoInv" style="display:none"></div>
  `;

  const selectFiltroCat = document.getElementById('filtroCategoriaInv');
  if (selectFiltroCat) {
    selectFiltroCat.innerHTML = `
      <option value="">Todas las categorías</option>
      ${categoriasCache.map(cat => `<option value="${cat.id}">${cat.nombre}</option>`).join('')}
    `;
    selectFiltroCat.onchange = function() {
      filtrarYRenderInventario();
    }
  }

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

function filtrarYRenderInventario() {
  const categoriaSeleccionada = document.getElementById('filtroCategoriaInv').value;
  let productos = inventarioProductos;
  if (categoriaSeleccionada) {
    productos = productos.filter(p => p.categoria_id === categoriaSeleccionada);
  }
  renderTablaInventario(productos);
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
    let categoria = categoriasCache.find(cat => cat.id === p.categoria_id)?.nombre || '—';
    let proveedor = proveedoresCache.find(pr => pr.id === p.proveedor_id)?.nombre || '—';
    let tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding:10px 8px;">${p.nombre}</td>
      <td style="padding:10px 8px;text-align:center;">${p.codigo_barras || '—'}</td>
      <td style="padding:10px 8px;text-align:center;">${categoria}</td>
      <td style="padding:10px 8px;text-align:center;">${proveedor}</td>
      <td style="padding:10px 8px;text-align:right;">$${p.precio ? Number(p.precio).toLocaleString('es-CO') : 0}</td>
      <td style="padding:10px 8px;text-align:right;">$${p.precio_venta ? Number(p.precio_venta).toLocaleString('es-CO') : 0}</td>
      <td style="padding:10px 8px;text-align:center;font-weight:600;color:${p.stock_actual < (p.stock_min || 0) ? '#f43f5e' : '#22c55e'};">
        ${p.stock_actual || 0}
      </td>
      <td style="padding:10px 8px;text-align:center;">${p.stock_min || 0}</td>
      <td style="padding:10px 8px;text-align:center;">${p.stock_max || 0}</td>
      <td style="padding:10px 8px;text-align:center;">
        <span style="font-weight:bold;color:${p.activo ? '#22c55e' : '#f43f5e'};">
          ${p.activo ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td style="padding:10px 8px;text-align:center;">
        <button onclick="window.showModalProducto('${p.id}')" 
          style="background:#e0e7ff;color:#1d4ed8;border:none;border-radius:6px;padding:5px 10px;margin-right:4px;cursor:pointer;" title="Editar">
          <svg width="16" height="16" fill="#1d4ed8" style="vertical-align:middle;"><use href="#icon-edit"></use></svg>
        </button>
        <button onclick="window.toggleActivoProducto('${p.id}',${!p.activo})" 
          style="background:${p.activo ? '#fee2e2' : '#bbf7d0'};color:${p.activo ? '#f43f5e' : '#16a34a'};border:none;border-radius:6px;padding:5px 10px;cursor:pointer;" title="${p.activo ? 'Desactivar' : 'Activar'}">
          <svg width="16" height="16" fill="${p.activo ? '#f43f5e' : '#16a34a'}" style="vertical-align:middle;">
            <use href="#${p.activo ? 'icon-x' : 'icon-check'}"></use>
          </svg>
        </button>
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
  <div style="
    background:#fff;
    border-radius:18px;
    box-shadow:0 8px 40px #1d4ed828;
    max-width:430px;
    width:95vw;
    margin:auto;
    padding:34px 26px 22px 26px;
    position:relative;
    font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;
    ">
    <button onclick="window.closeModalProducto()" 
      style="
        position:absolute;right:14px;top:10px;
        background:none;border:none;font-size:25px;color:#64748b;cursor:pointer;
        transition:color 0.18s;
      "
      onmouseover="this.style.color='#f43f5e'" onmouseout="this.style.color='#64748b'"
      title="Cerrar">&times;</button>

    <h2 style="margin-bottom:19px;text-align:center;font-size:1.22rem;font-weight:700;color:#1d4ed8;">
      ${productoId ? 'Editar' : 'Nuevo'} Producto
    </h2>
    <form id="formProductoInv" autocomplete="off">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:13px 16px;">
        <div style="grid-column:1/3;">
          <label style="font-weight:500;">Nombre</label>
          <input id="prodNombre" required placeholder="Nombre" value="${prod?.nombre||''}"
            style="width:100%;padding:8px 11px;margin-top:2px;margin-bottom:3px;border:1.5px solid #cbd5e1;border-radius:6px;font-size:1em;">
        </div>
        <div>
          <label style="font-weight:500;">Código de barras</label>
          <input id="prodCodigo" placeholder="Código de barras" value="${prod?.codigo_barras||''}" 
            style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;">
        </div>
        <div>
          <label style="font-weight:500;">Categoría</label>
          <select id="prodCategoria" required style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;">
            <option value="">Selecciona...</option>
            ${categoriasCache.map(cat=>`<option value="${cat.id}"${prod?.categoria_id===cat.id?' selected':''}>${cat.nombre}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-weight:500;">Proveedor</label>
          <select id="prodProveedor" style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;">
            <option value="">Selecciona...</option>
            ${proveedoresCache.map(prov=>`<option value="${prov.id}"${prod?.proveedor_id===prov.id?' selected':''}>${prov.nombre}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-weight:500;">Precio compra</label>
          <input id="prodPrecio" type="number" min="0" step="any" placeholder="Precio compra" value="${prod?.precio||''}"
            style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;">
        </div>
        <div>
          <label style="font-weight:500;">Precio venta</label>
          <input id="prodPrecioVenta" type="number" min="0" step="any" placeholder="Precio venta" value="${prod?.precio_venta||''}"
            style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;">
        </div>
        <div>
          <label style="font-weight:500;">Stock actual</label>
          <input id="prodStock" type="number" min="0" placeholder="Stock actual" value="${prod?.stock_actual||''}" 
            style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;">
        </div>
        <div>
          <label style="font-weight:500;">Stock mínimo</label>
          <input id="prodStockMin" type="number" min="0" placeholder="Stock mínimo" value="${prod?.stock_min||''}" 
            style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;">
        </div>
        <div>
          <label style="font-weight:500;">Stock máximo</label>
          <input id="prodStockMax" type="number" min="0" placeholder="Stock máximo" value="${prod?.stock_max||''}" 
            style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;">
        </div>
        <div style="grid-column:1/3;">
          <label style="font-weight:500;">Imagen (URL)</label>
          <input id="prodImagenUrl" type="text" placeholder="https://..." value="${prod?.imagen_url||''}" 
            style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;">
          <div id="previewImagen" style="margin-top:8px;text-align:center;">
            ${prod?.imagen_url ? `<img src="${prod.imagen_url}" alt="Imagen" style="max-width:95px;max-height:80px;border-radius:6px;border:1px solid #eee;background:#f7f7f7;">` : ''}
          </div>
          <label style="font-size:13px;display:block;margin-top:7px;margin-bottom:0;">
            <span style="color:#64748b;">Subir Imagen:</span>
            <input type="file" id="prodImagenArchivo" accept="image/*" style="margin-top:3px;">
          </label>
        </div>
        <div style="grid-column:1/3;">
          <label style="font-weight:500;">Descripción</label>
          <textarea id="prodDescripcion" rows="2" placeholder="Descripción" 
            style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;">${prod?.descripcion||''}</textarea>
        </div>
      </div>
      <div style="margin-top:23px;display:flex;gap:14px;justify-content:center;">
        <button id="btnGuardarProducto" type="submit"
          style="background:linear-gradient(90deg,#22c55e,#16a34a);color:#fff;font-weight:700;border:none;border-radius:7px;padding:11px 28px;font-size:1.08em;box-shadow:0 2px 10px #22c55e22;cursor:pointer;">
          ${productoId ? 'Actualizar' : 'Crear'}
        </button>
        <button type="button" onclick="window.closeModalProducto()"
          style="background:#e0e7ef;color:#334155;font-weight:600;border:none;border-radius:7px;padding:11px 28px;font-size:1.08em;box-shadow:0 2px 10px #64748b15;cursor:pointer;">
          Cancelar
        </button>
      </div>
    </form>
  </div>
`;

  // 👇  CAMBIO CLAVE: usar onsubmit para que no recargue página
  const form = document.getElementById('formProductoInv');
  if (form) {
    form.onsubmit = async function(e) {
      e.preventDefault();
      await saveProductoInv(productoId);
    };
  }
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
      .from('productos')
      .upload(nombreArchivo, archivo, { upsert: true });
    if (errorUp) {
      alert("Error subiendo imagen: " + errorUp.message);
      return;
    }
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
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
  <h3 style="color:#1d4ed8;font-size:1.4em;font-weight:bold;letter-spacing:.5px;margin:0;">📦 Categorías de Productos</h3>
  <button id="btnNuevaCategoria" 
    style="
      background:linear-gradient(90deg,#22c55e,#1d4ed8);
      color:#fff;padding:10px 20px;
      border:none;
      border-radius:7px;
      font-size:1em;
      font-weight:600;
      box-shadow:0 1px 8px #1d4ed820;
      transition:background 0.2s;
      cursor:pointer;
    "
    onmouseover="this.style.background='linear-gradient(90deg,#1d4ed8,#22c55e)'"
    onmouseout="this.style.background='linear-gradient(90deg,#22c55e,#1d4ed8)'"
  >+ Agregar Categoría</button>
</div>

<div style="overflow-x:auto;background:#fff;border-radius:10px;box-shadow:0 2px 16px #0001;">
  <table style="width:100%;font-size:1em;border-collapse:collapse;overflow:hidden;">
    <thead>
      <tr style="background:#f1f5f9;color:#222;">
        <th style="padding:13px 10px;text-align:left;">Nombre</th>
        <th style="padding:13px 10px;text-align:left;">Descripción</th>
        <th style="padding:13px 10px;text-align:center;">Estado</th>
        <th style="padding:13px 10px;text-align:center;">Acciones</th>
      </tr>
    </thead>
    <tbody id="bodyCategorias"></tbody>
  </table>
</div>

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
  <td style="padding:12px 10px;font-weight:500;color:#1e293b;">
    ${cat.nombre}
  </td>
  <td style="padding:12px 10px;color:#475569;">
    ${cat.descripcion || '<span style="color:#aaa;">Sin descripción</span>'}
  </td>
  <td style="padding:12px 0;text-align:center;">
    <span style="
      display:inline-block;
      padding:4px 14px;
      border-radius:16px;
      font-size:0.93em;
      font-weight:600;
      ${cat.activa ? 'background:#dcfce7;color:#15803d;' : 'background:#fee2e2;color:#b91c1c;'}
    ">
      ${cat.activa ? 'Activa' : 'Inactiva'}
    </span>
  </td>
  <td style="padding:12px 0;text-align:center;">
    <button onclick="window.showModalCategoria('${cat.id}')"
      title="Editar"
      style="
        background:#e0e7ff;
        border:none;
        border-radius:5px;
        padding:6px 12px;
        margin-right:5px;
        font-size:1em;
        cursor:pointer;
        transition:background 0.2s;
      "
      onmouseover="this.style.background='#c7d2fe'"
      onmouseout="this.style.background='#e0e7ff'"
    >✏️</button>
    <button onclick="window.toggleEstadoCategoria('${cat.id}',${!cat.activa})"
      title="${cat.activa ? 'Desactivar' : 'Activar'}"
      style="
        background:${cat.activa ? '#fee2e2' : '#dcfce7'};
        border:none;
        border-radius:5px;
        padding:6px 12px;
        font-size:1.15em;
        cursor:pointer;
        transition:background 0.2s;
      "
      onmouseover="this.style.background='${cat.activa ? '#fecaca' : '#bbf7d0'}'"
      onmouseout="this.style.background='${cat.activa ? '#fee2e2' : '#dcfce7'}'"
    >
      ${cat.activa ? '❌' : '✅'}
    </button>
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
  <div style="
    background:#fff;
    border-radius:14px;
    box-shadow:0 4px 24px #0002;
    max-width:370px;
    margin:auto;
    padding:36px 26px 24px 26px;
    position:relative;
    font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;
  ">
    <button onclick="window.closeModalCategoria()"
      style="
        position:absolute;
        right:14px;top:10px;
        background:none;
        font-size:23px;
        border:none;
        color:#64748b;
        cursor:pointer;
        transition:color 0.2s;
      "
      onmouseover="this.style.color='#e11d48'"
      onmouseout="this.style.color='#64748b'"
      title="Cerrar">&times;</button>
    <h3 style="margin-bottom:22px;color:#2563eb;letter-spacing:0.5px;font-weight:700;">
      ${categoriaId ? 'Editar' : 'Nueva'} Categoría
    </h3>
    <label style="font-size:15px;font-weight:600;color:#334155;display:block;margin-bottom:6px;">Nombre</label>
    <input id="catNombre"
      placeholder="Nombre de la categoría"
      value="${cat?.nombre||''}"
      style="width:100%;margin-bottom:18px;padding:10px 13px;border-radius:7px;border:1.5px solid #cbd5e1;font-size:1em;" />
    <label style="font-size:15px;font-weight:600;color:#334155;display:block;margin-bottom:6px;">Descripción</label>
    <input id="catDescripcion"
      placeholder="Descripción (opcional)"
      value="${cat?.descripcion||''}"
      style="width:100%;margin-bottom:24px;padding:10px 13px;border-radius:7px;border:1.5px solid #cbd5e1;font-size:1em;" />
    <div style="margin-top:8px;text-align:right;">
      <button id="btnGuardarCategoria"
        style="
          background:linear-gradient(90deg,#22c55e,#16a34a);
          color:#fff;
          font-size:1em;
          font-weight:600;
          padding:10px 28px;
          border:none;
          border-radius:7px;
          box-shadow:0 1px 4px #22c55e44;
          cursor:pointer;
          transition:background 0.19s;
        "
        onmouseover="this.style.background='linear-gradient(90deg,#2563eb,#38bdf8)'"
        onmouseout="this.style.background='linear-gradient(90deg,#22c55e,#16a34a)'"
      >${categoriaId ? 'Actualizar' : 'Crear'}</button>
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
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
  <h3 style="color:#1d4ed8;font-size:1.3em;font-weight:bold;letter-spacing:.5px;margin:0;">📦 Proveedores</h3>
  <button id="btnNuevoProveedor"
    style="
      background:linear-gradient(90deg,#22c55e,#1d4ed8);
      color:#fff;padding:10px 20px;
      border:none;
      border-radius:7px;
      font-size:1em;
      font-weight:600;
      box-shadow:0 1px 8px #1d4ed820;
      transition:background 0.2s;
      cursor:pointer;
    "
    onmouseover="this.style.background='linear-gradient(90deg,#1d4ed8,#22c55e)'"
    onmouseout="this.style.background='linear-gradient(90deg,#22c55e,#1d4ed8)'"
  >+ Agregar Proveedor</button>
</div>

<div style="overflow-x:auto;background:#fff;border-radius:10px;box-shadow:0 2px 16px #0001;">
  <table style="width:100%;font-size:1em;border-collapse:collapse;overflow:hidden;">
    <thead>
      <tr style="background:#f1f5f9;color:#222;">
        <th style="padding:13px 10px;text-align:left;">Nombre</th>
        <th style="padding:13px 10px;text-align:left;">Contacto</th>
        <th style="padding:13px 10px;text-align:center;">Teléfono</th>
        <th style="padding:13px 10px;text-align:left;">Email</th>
        <th style="padding:13px 10px;text-align:center;">NIT</th>
        <th style="padding:13px 10px;text-align:center;">Estado</th>
        <th style="padding:13px 10px;text-align:center;">Acciones</th>
      </tr>
    </thead>
    <tbody id="bodyProveedores"></tbody>
  </table>
</div>
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
  <td style="padding:12px 10px;font-weight:500;color:#1e293b;">
    ${pr.nombre}
  </td>
  <td style="padding:12px 10px;color:#334155;">
    ${pr.contacto_nombre || '<span style="color:#aaa;">Sin contacto</span>'}
  </td>
  <td style="padding:12px 10px;text-align:center;color:#0ea5e9;">
    ${pr.telefono || '<span style="color:#aaa;">-</span>'}
  </td>
  <td style="padding:12px 10px;color:#64748b;">
    ${pr.email || '<span style="color:#aaa;">-</span>'}
  </td>
  <td style="padding:12px 10px;text-align:center;">
    ${pr.nit || '<span style="color:#aaa;">-</span>'}
  </td>
  <td style="padding:12px 0;text-align:center;">
    <span style="
      display:inline-block;
      padding:4px 14px;
      border-radius:16px;
      font-size:0.93em;
      font-weight:600;
      ${pr.activo ? 'background:#dcfce7;color:#15803d;' : 'background:#fee2e2;color:#b91c1c;'}
    ">
      ${pr.activo ? 'Activo' : 'Inactivo'}
    </span>
  </td>
  <td style="padding:12px 0;text-align:center;">
    <button onclick="window.showModalProveedor('${id}')"
      title="Editar"
      style="
        background:#e0e7ff;
        border:none;
        border-radius:5px;
        padding:6px 12px;
        margin-right:5px;
        font-size:1em;
        cursor:pointer;
        transition:background 0.2s;
      "
      onmouseover="this.style.background='#c7d2fe'"
      onmouseout="this.style.background='#e0e7ff'"
    >✏️</button>
    <button onclick="window.toggleEstadoProveedor('${id}',${!pr.activo})"
      title="${pr.activo ? 'Desactivar' : 'Activar'}"
      style="
        background:${pr.activo ? '#fee2e2' : '#dcfce7'};
        border:none;
        border-radius:5px;
        padding:6px 12px;
        font-size:1.15em;
        cursor:pointer;
        transition:background 0.2s;
      "
      onmouseover="this.style.background='${pr.activo ? '#fecaca' : '#bbf7d0'}'"
      onmouseout="this.style.background='${pr.activo ? '#fee2e2' : '#dcfce7'}'"
    >
      ${pr.activo ? '❌' : '✅'}
    </button>
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
  <div style="
    background:#fff;
    border-radius:14px;
    box-shadow:0 4px 24px #0002;
    max-width:390px;
    margin:auto;
    padding:38px 28px 24px 28px;
    position:relative;
    font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;
  ">
    <button onclick="window.closeModalProveedor()"
      style="
        position:absolute;
        right:14px;top:10px;
        background:none;
        font-size:23px;
        border:none;
        color:#64748b;
        cursor:pointer;
        transition:color 0.2s;
      "
      onmouseover="this.style.color='#e11d48'"
      onmouseout="this.style.color='#64748b'"
      title="Cerrar">&times;</button>
    <h3 style="margin-bottom:22px;color:#2563eb;letter-spacing:0.5px;font-weight:700;">
      ${proveedorId ? 'Editar' : 'Nuevo'} Proveedor
    </h3>
    <label style="font-size:15px;font-weight:600;color:#334155;display:block;margin-bottom:6px;">Nombre</label>
    <input id="provNombre"
      placeholder="Nombre del proveedor"
      value="${pr?.nombre || ''}"
      style="width:100%;margin-bottom:14px;padding:10px 13px;border-radius:7px;border:1.5px solid #cbd5e1;font-size:1em;" />
    <label style="font-size:15px;font-weight:600;color:#334155;display:block;margin-bottom:6px;">Contacto</label>
    <input id="provContacto"
      placeholder="Nombre contacto"
      value="${pr?.contacto_nombre || ''}"
      style="width:100%;margin-bottom:14px;padding:10px 13px;border-radius:7px;border:1.5px solid #cbd5e1;font-size:1em;" />
    <label style="font-size:15px;font-weight:600;color:#334155;display:block;margin-bottom:6px;">Teléfono</label>
    <input id="provTelefono"
      placeholder="Teléfono"
      value="${pr?.telefono || ''}"
      style="width:100%;margin-bottom:14px;padding:10px 13px;border-radius:7px;border:1.5px solid #cbd5e1;font-size:1em;" />
    <label style="font-size:15px;font-weight:600;color:#334155;display:block;margin-bottom:6px;">Email</label>
    <input id="provEmail"
      placeholder="Correo electrónico"
      value="${pr?.email || ''}"
      style="width:100%;margin-bottom:14px;padding:10px 13px;border-radius:7px;border:1.5px solid #cbd5e1;font-size:1em;" />
    <label style="font-size:15px;font-weight:600;color:#334155;display:block;margin-bottom:6px;">NIT</label>
    <input id="provNIT"
      placeholder="NIT"
      value="${pr?.nit || ''}"
      style="width:100%;margin-bottom:20px;padding:10px 13px;border-radius:7px;border:1.5px solid #cbd5e1;font-size:1em;" />
    <div style="margin-top:8px;text-align:right;">
      <button id="btnGuardarProveedor"
        style="
          background:linear-gradient(90deg,#22c55e,#16a34a);
          color:#fff;
          font-size:1em;
          font-weight:600;
          padding:10px 28px;
          border:none;
          border-radius:7px;
          box-shadow:0 1px 4px #22c55e44;
          cursor:pointer;
          transition:background 0.19s;
        "
        onmouseover="this.style.background='linear-gradient(90deg,#2563eb,#38bdf8)'"
        onmouseout="this.style.background='linear-gradient(90deg,#22c55e,#16a34a)'"
      >${proveedorId ? 'Actualizar' : 'Crear'}</button>
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
   <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
  <h3 style="color:#2563eb;font-size:1.23em;font-weight:700;margin:0;">📋 Lista de Compras Sugerida</h3>
  <button id="btnExportarListaCompra"
    style="
      background:linear-gradient(90deg,#22c55e,#1d4ed8);
      color:#fff;
      padding:10px 22px;
      border:none;
      border-radius:7px;
      font-size:1em;
      font-weight:600;
      box-shadow:0 1px 8px #1d4ed820;
      transition:background 0.2s;
      cursor:pointer;
    "
    onmouseover="this.style.background='linear-gradient(90deg,#1d4ed8,#22c55e)'"
    onmouseout="this.style.background='linear-gradient(90deg,#22c55e,#1d4ed8)'"
  >⬇️ Exportar Excel</button>
</div>

<div style="margin-bottom:16px;">
  <label style="font-weight:600;color:#334155;margin-right:10px;">Filtrar por proveedor:</label>
  <select id="selectProveedorCompra"
    style="
      padding:9px 18px;
      border-radius:7px;
      border:1.5px solid #cbd5e1;
      min-width:200px;
      font-size:1em;
      background:#f9fafb;
      font-weight:500;
      color:#2563eb;
      margin-left:0;
    ">
    <option value="">-- Todos los proveedores --</option>
    ${(proveedoresCache || []).map(pr => `
      <option value="${pr.id}">${pr.nombre}</option>
    `).join('')}
  </select>
</div>

<div style="overflow-x:auto;background:#fff;border-radius:10px;box-shadow:0 2px 16px #0001;">
  <table style="width:100%;font-size:1em;border-collapse:collapse;overflow:hidden;">
    <thead>
      <tr style="background:#f1f5f9;color:#222;">
        <th style="padding:13px 10px;text-align:left;">Producto</th>
        <th style="padding:13px 10px;text-align:right;">Stock Actual</th>
        <th style="padding:13px 10px;text-align:right;">Stock Mín.</th>
        <th style="padding:13px 10px;text-align:right;">Stock Máx.</th>
        <th style="padding:13px 10px;text-align:right;">Sugerido Comprar</th>
        <th style="padding:13px 10px;text-align:left;">Proveedor</th>
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
  <td style="padding:12px 10px;border-bottom:1px solid #f1f5f9;font-weight:500;color:#334155;">
    ${p.nombre}
  </td>
  <td style="padding:12px 10px;text-align:right;border-bottom:1px solid #f1f5f9;">
    ${p.stock_actual || 0}
  </td>
  <td style="padding:12px 10px;text-align:right;border-bottom:1px solid #f1f5f9;">
    ${p.stock_minimo || 0}
  </td>
  <td style="padding:12px 10px;text-align:right;border-bottom:1px solid #f1f5f9;">
    ${p.stock_maximo || 0}
  </td>
  <td style="
      padding:12px 10px;text-align:right;font-weight:700;border-bottom:1px solid #f1f5f9;
      ${cantidadASugerir > 0 ? 'color:#fff;background:#facc15;border-radius:7px;' : 'color:#64748b;'}
    ">
    ${cantidadASugerir > 0
      ? `<span style="padding:5px 18px;border-radius:14px;background:#facc15;color:#a16207;display:inline-block;">
          +${cantidadASugerir}
        </span>`
      : '<span style="color:#aaa;">—</span>'}
  </td>
  <td style="padding:12px 10px;color:#2563eb;border-bottom:1px solid #f1f5f9;">
    ${proveedor ? `<span style="font-weight:600;">${proveedor}</span>` : '<span style="color:#aaa;">Sin proveedor</span>'}
  </td>
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
  <td style="padding:12px 10px;font-weight:500;color:#1e293b;">
    ${item.nombre}
  </td>
  <td style="padding:12px 10px;text-align:center;color:#0ea5e9;">
    ${item.cantidad}
  </td>
  <td style="padding:12px 10px;text-align:right;color:#22c55e;">
    $${parseFloat(item.precio).toLocaleString('es-CO', { minimumFractionDigits: 0 })}
  </td>
  <td style="padding:12px 10px;text-align:right;font-weight:600;">
    $${parseFloat(subtotal).toLocaleString('es-CO', { minimumFractionDigits: 0 })}
  </td>
  <td style="padding:10px 0;text-align:center;">
    <button onclick="window.eliminarItemCompra('${item.id}')"
      style="
        background:#fee2e2;
        color:#b91c1c;
        border:none;
        border-radius:6px;
        padding:7px 14px;
        font-weight:bold;
        font-size:1.03em;
        cursor:pointer;
        transition:background 0.19s;
      "
      onmouseover="this.style.background='#fecaca'"
      onmouseout="this.style.background='#fee2e2'"
      title="Eliminar"
    >✖️</button>
  </td>
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
  let filtro = (window.compraProveedorFiltro || '').trim().toLowerCase();
  let list = [];

  // Si NO hay proveedor seleccionado, muestra mensaje y NO muestra productos
  if (!proveedorSel) {
    document.getElementById('productosCompraList').innerHTML = `<div class="text-gray-400">Selecciona un proveedor para ver sus productos disponibles.</div>`;
    return;
  }

  // Si hay proveedor, filtra los productos por proveedor_id
  list = productosCache.filter(p => p.proveedor_id === proveedorSel);

  // Si hay filtro, filtra aún más por nombre, categoría, código de barras
  if (filtro) {
    list = list.filter(p =>
      (p.nombre || '').toLowerCase().includes(filtro) ||
      (p.categoria_nombre || '').toLowerCase().includes(filtro) ||
      (p.codigo_barras || '').toLowerCase().includes(filtro)
    );
  }

  // Render
  if (!list.length) {
  document.getElementById('productosCompraList').innerHTML = `<div style="color:#999; padding:12px;">No hay productos para este proveedor${filtro ? " o filtro" : ""}.</div>`;
  return;
}

let productosHtml = list.map(p => `
  <div style="
      display:flex;
      align-items:center;
      gap:16px;
      padding:10px 0 12px 0;
      border-bottom:1px solid #f1f5f9;
      font-size:1em;
      font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;
    ">
    <span style="flex:1 1 180px; font-weight:600; color:#1e293b;">
      ${p.nombre}
      <span style="font-size:0.87em; color:#64748b; font-weight:400; margin-left:7px;">
        ${p.categoria_nombre || ''}
      </span>
    </span>
    <input type="number"
  id="cantidad_${p.id}"
  min="1"
  class="input"
  placeholder="Cantidad"
  style="
    width:140px;
    min-width:120px;
    padding:7px 9px;
    border-radius:6px;
    border:1.5px solid #cbd5e1;
    background:#f9fafb;
    font-size:1em;
    margin-right:6px;
    text-align:center;
  ">

<input type="number"
  id="precio_${p.id}"
  min="0"
  step="0.01"
  class="input"
  placeholder="Precio compra"
  style="
    width:160px;
    min-width:120px;
    padding:7px 9px;
    border-radius:6px;
    border:1.5px solid #cbd5e1;
    background:#f9fafb;
    font-size:1em;
    margin-right:6px;
    text-align:center;
  ">
    <button onclick="window.agregarProductoCompra('${p.id}')"
      style="
        background:linear-gradient(90deg,#1d4ed8,#22c55e);
        color:#fff;
        border:none;
        border-radius:6px;
        padding:7px 19px;
        font-size:1em;
        font-weight:600;
        box-shadow:0 1px 4px #22c55e22;
        cursor:pointer;
        transition:background 0.16s;
      "
      onmouseover="this.style.background='linear-gradient(90deg,#22c55e,#1d4ed8)'"
      onmouseout="this.style.background='linear-gradient(90deg,#1d4ed8,#22c55e)'"
    >Agregar</button>
  </div>
`).join('');

document.getElementById('productosCompraList').innerHTML = productosHtml;

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
      await currentSupabase
      .from('productos_tienda')
     .update({ precio: item.precio })
      .eq('id', item.id);
    
}


    function mostrarAlertaCompraExitosa(msg) {
  // Si ya existe una alerta, elimínala
  let alertaExistente = document.getElementById('miAlertaCompra');
  if (alertaExistente) alertaExistente.remove();

  const alerta = document.createElement('div');
  alerta.id = 'miAlertaCompra';
  alerta.innerHTML = `
    <div style="
      position: fixed; left: 0; top: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.18); display: flex; align-items: center; justify-content: center; z-index: 1000;">
      <div style="
        background: #fff;
        padding: 34px 32px 22px 32px;
        border-radius: 18px;
        box-shadow: 0 6px 36px #1d4ed860;
        text-align: center;
        max-width: 350px;">
        <div style="font-size: 2.3em; color: #22c55e;">✔️</div>
        <div style="font-size:1.15em; color:#334155; margin:16px 0 10px 0; font-weight:600;">${msg || 'Compra registrada exitosamente'}</div>
        <button onclick="document.getElementById('miAlertaCompra').remove()" style="
          background: linear-gradient(90deg,#16a34a,#22c55e);
          color: #fff;
          font-weight:600;
          border:none;
          border-radius:6px;
          padding:10px 30px;
          margin-top:12px;
          font-size:1.05em;
          cursor:pointer;
          box-shadow:0 2px 8px #22c55e20;
          transition:background 0.18s;
        ">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(alerta);
}

// Usa así:
mostrarAlertaCompraExitosa('¡Compra registrada! Puedes recibir el pedido cuando llegue para actualizar inventario y caja.');


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
  cont.innerHTML = `
    <div style="
      background: #fee2e2;
      color: #b91c1c;
      font-weight: 600;
      border-radius: 10px;
      padding: 18px 26px;
      margin: 40px auto 0 auto;
      max-width: 420px;
      box-shadow: 0 2px 10px #ef444422;
      display: flex;
      align-items: center;
      gap: 13px;
      font-size: 1.07em;
    ">
      <span style="font-size:1.5em;">🚫</span>
      No hay productos cargados.<br>
      <span style="font-weight:400;">Registra productos antes de realizar compras.</span>
    </div>
  `;
  return;
}
if (!proveedoresCache.length) {
  cont.innerHTML = `
    <div style="
      background: #fef9c3;
      color: #a16207;
      font-weight: 600;
      border-radius: 10px;
      padding: 18px 26px;
      margin: 40px auto 0 auto;
      max-width: 420px;
      box-shadow: 0 2px 10px #fde04799;
      display: flex;
      align-items: center;
      gap: 13px;
      font-size: 1.07em;
    ">
      <span style="font-size:1.5em;">⚠️</span>
      No hay proveedores cargados.<br>
      <span style="font-weight:400;">Registra proveedores antes de realizar compras.</span>
    </div>
  `;
  return;
}


  // --- FORMULARIO NORMAL ---
  cont.innerHTML = `
  <div style="background:#fff; border-radius:14px; box-shadow:0 3px 16px #0002; padding:30px 24px; max-width:520px; margin:auto;">
    <h3 style="font-size:1.24em;color:#1d4ed8;font-weight:700;margin-bottom:18px;">
      📝 Registrar Compra a Proveedor
    </h3>
    <div style="margin-bottom:15px;">
      <label style="font-weight:600; color:#334155; margin-bottom:6px; display:block;">
        Proveedor:
        <select id="selectProveedorCompraForm"
          style="
            margin-top:6px;
            width:100%;
            padding:9px 13px;
            border-radius:7px;
            border:1.5px solid #cbd5e1;
            background:#f9fafb;
            font-size:1em;
            font-weight:500;
            color:#2563eb;
          ">
          <option value="">Selecciona proveedor</option>
          ${proveedoresCache.map(pr => `<option value="${pr.id}">${pr.nombre}</option>`).join('')}
        </select>
      </label>
    </div>
    <input id="buscarProductoCompra"
      placeholder="Buscar producto o categoría..."
      style="
        width:100%;
        padding:9px 13px;
        margin-bottom:13px;
        border-radius:6px;
        border:1.5px solid #d1d5db;
        background:#f9fafb;
        font-size:1em;
        box-sizing: border-box;
        transition:border 0.18s;
        outline:none;
      "
      onfocus="this.style.borderColor='#2563eb'"
      onblur="this.style.borderColor='#d1d5db'"
    />
    <div id="productosCompraList" style="margin-bottom:20px;"></div>
    <h5 style="margin:18px 0 10px 0; font-size:1.09em; color:#0f766e; font-weight:600;">
      🛒 Carrito de compra:
    </h5>
    <div style="overflow-x:auto;background:#f9fafb;border-radius:9px;">
      <table style="width:100%;font-size:0.97em;border-collapse:collapse;">
        <thead>
          <tr style="background:#e0f2fe;color:#0e7490;">
            <th style="padding:8px 4px;">Producto</th>
            <th style="padding:8px 4px;">Cantidad</th>
            <th style="padding:8px 4px;">Precio compra</th>
            <th style="padding:8px 4px;">Subtotal</th>
            <th style="padding:8px 4px;"></th>
          </tr>
        </thead>
        <tbody id="carritoCompra"></tbody>
      </table>
    </div>
    <div style="text-align:right;font-size:1.08em;margin-top:10px;font-weight:600;">
      Total: <span id="totalCompra" style="color:#16a34a;">$0</span>
    </div>
    <button id="btnRegistrarCompra"
      style="
        background:linear-gradient(90deg,#16a34a,#22c55e);
        color:#fff;
        font-size:1.07em;
        padding:11px 36px;
        border:none;
        border-radius:7px;
        margin-top:24px;
        margin-bottom:8px;
        font-weight:700;
        cursor:pointer;
        box-shadow:0 2px 8px #22c55e20;
        transition:background 0.18s;
      "
      onmouseover="this.style.background='linear-gradient(90deg,#22c55e,#16a34a)'"
      onmouseout="this.style.background='linear-gradient(90deg,#16a34a,#22c55e)'"
    >Registrar Compra</button>
    <div id="msgCompra" style="color:#e11d48;margin-top:18px;font-weight:bold;font-size:1em;"></div>
  </div>
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
  cont.innerHTML = `
  <div style="
    display:flex;
    align-items:center;
    gap:14px;
    margin-bottom:23px;
    padding:8px 0 6px 0;
  ">
    <span style="
      display:inline-block;
      background:#fef08a;
      color:#b45309;
      font-weight:700;
      font-size:1.2em;
      padding:8px 15px;
      border-radius:10px;
      box-shadow:0 1px 6px #fde04744;
    ">
      <span style="font-size:1.3em;">📦</span>
      Compras pendientes por recibir
    </span>
  </div>
  <div id="comprasPendientesList"></div>
`;

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
      // Se une con productos_tienda para obtener el nombre directamente
      .select('*, producto_id(id, nombre)')
      .eq('compra_id', compra.id);
    compra.detalles = detalles; // Ahora los detalles ya incluyen el objeto producto
  }
}

// 9. Renderiza una tarjeta de compra pendiente con inputs de recepción
function renderTarjetaCompraPendiente(compra) {
    let productosHtml = '';
    if (compra.detalles && compra.detalles.length > 0) {
        productosHtml = `
            <table style="width:100%; border-collapse: collapse; font-size: 0.95em;">
                <thead>
                    <tr style="text-align:left; color:#475569;">
                        <th style="padding:4px; border-bottom:1.5px solid #e2e8f0;">Producto</th>
                        <th style="padding:4px; border-bottom:1.5px solid #e2e8f0; text-align:center;">Pedido</th>
                        <th style="padding:4px; border-bottom:1.5px solid #e2e8f0; text-align:center;">Recibido</th>
                    </tr>
                </thead>
                <tbody>
                    ${compra.detalles.map(det => `
                        <tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:8px 4px; font-weight:600; color:#1e293b;">
                                ${det.producto_id.nombre || 'Producto Desconocido'}
                            </td>
                            <td style="padding:8px 4px; text-align:center;">
                                ${det.cantidad}
                            </td>
                            <td style="padding:8px 4px; text-align:center;">
                                <input 
                                    type="number" 
                                    id="recibido_${compra.id}_${det.producto_id.id}" 
                                    value="${det.cantidad}" 
                                    min="0" 
                                    max="${det.cantidad}"
                                    style="width:70px; padding:5px 7px; border-radius:6px; border:1.3px solid #cbd5e1; background:#f8fafc; text-align:center;">
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    return `
        <div style="border-radius:11px;background:#fef9c3;border:1.7px solid #fde047;box-shadow:0 2px 10px #fde04738;margin-bottom:23px;padding:24px 18px 16px 18px;max-width:520px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                <span style="font-size:1.07em; font-weight:700; color:#b45309;">
                    Proveedor: <span style="color:#2563eb;">${getProveedorNombre(compra.proveedor_id)}</span>
                </span>
                <span style="font-size:0.9em; color:#475569;">${new Date(compra.fecha).toLocaleDateString()}</span>
            </div>
            ${productosHtml}
            <div style="margin:16px 0 13px 0; text-align:right; font-weight:700; font-size:1.1em; color:#166534;">
                Total Compra: ${formatCurrency(compra.total_compra)}
            </div>
            <div style="display:flex;gap:8px;">
                <button onclick="window.recibirPedido('${compra.id}')" style="background:#16a34a;color:#fff;padding:8px 18px;border:none;border-radius:6px;font-weight:600;cursor:pointer;flex-grow:1;">✔️ Recibir Productos</button>
                <button onclick="window.cancelarCompra('${compra.id}')" style="background:#ef4444;color:#fff;padding:8px 18px;border:none;border-radius:6px;font-weight:600;cursor:pointer;">❌ Cancelar Compra</button>
            </div>
            <div id="msgRecibido_${compra.id}" style="margin-top:8px;font-size:0.95em;color:#64748b;text-align:center;"></div>
        </div>`;
}

// La función 'guardarEdicionCompra' no se llama desde la tarjeta de recepción, se mantiene por si se usa en otro lado.
window.guardarEdicionCompra = async function (compraId) {
    // ... tu código original de guardarEdicionCompra ...
};

window.cancelarCompra = async function (compraId) {
    if (!confirm("¿Está seguro que desea cancelar esta compra? Esta acción no se puede deshacer.")) return;
    await currentSupabase.from('compras_tienda')
      .update({ estado: 'cancelada' })
      .eq('id', compraId);

    showSuccess(document.getElementById(`msgRecibido_${compraId}`), 'Compra cancelada.');
    renderComprasPendientes();
};

// 10. Obtiene el nombre del proveedor por id (de tu cache)
function getProveedorNombre(proveedorId) {
  let pr = proveedoresCache.find(p => p.id === proveedorId);
  return pr ? pr.nombre : proveedorId;
}

// 11. Lógica para recibir pedido (total o parcial) - VERSIÓN CORREGIDA
// Reemplaza tu función window.recibirPedido existente con esta versión final

window.recibirPedido = async function(compraId) {
    const feedbackElementForToast = document.getElementById(`msgRecibido_${compraId}`) || document.body;

    try {
        // 1. Carga detalles de productos de la compra
        const { data: detallesCompra, error: errDetalles } = await currentSupabase
            .from('detalle_compras_tienda')
            .select('*, producto_id(id, nombre)')
            .eq('compra_id', compraId);

        if (errDetalles || !detallesCompra || detallesCompra.length === 0) {
            showError(feedbackElementForToast, 'No se encontraron detalles para esta compra.');
            return;
        }

        // 2. Recopilar cantidades recibidas
        let esRecepcionParcial = false;
        let recibidoTotalMonto = 0;
        const itemsRecibidosParaActualizar = [];

        for (let det of detallesCompra) {
            const recibidoInput = document.getElementById(`recibido_${compraId}_${det.producto_id.id}`);
            const cantidadRecibida = recibidoInput ? Number(recibidoInput.value) : 0;
            
            if (isNaN(cantidadRecibida) || cantidadRecibida < 0) {
                showError(feedbackElementForToast, `Cantidad inválida para ${det.producto_id.nombre}.`);
                return;
            }
            if (cantidadRecibida > det.cantidad) {
                showError(feedbackElementForToast, `No puedes recibir más de lo pedido (${det.cantidad}) para ${det.producto_id.nombre}.`);
                return;
            }

            if (cantidadRecibida < det.cantidad) {
                esRecepcionParcial = true;
            }

            if (cantidadRecibida > 0) {
                itemsRecibidosParaActualizar.push({
                    producto_id: det.producto_id.id,
                    cantidadRecibida: cantidadRecibida,
                    precio_compra: det.precio_unitario
                });
                recibidoTotalMonto += cantidadRecibida * det.precio_unitario;
            }
        }

        if (itemsRecibidosParaActualizar.length === 0) {
            showError(feedbackElementForToast, "No se indicó ninguna cantidad recibida.");
            return;
        }

        // 3. Confirmación con el usuario (método de pago)
        const turnoId = turnoService.getActiveTurnId();
        if (!turnoId) {
            showError(feedbackElementForToast, "ACCIÓN BLOQUEADA: No hay un turno de caja activo.");
            return;
        }
        const { data: metodosPago, error: errMetodos } = await currentSupabase.from('metodos_pago').select('id, nombre').eq('hotel_id', currentHotelId).eq('activo', true).order('nombre');
        if (errMetodos || !metodosPago || metodosPago.length === 0) {
            showError(feedbackElementForToast, "No hay métodos de pago activos configurados.");
            return;
        }
        const inputOptions = new Map(metodosPago.map(mp => [mp.id, mp.nombre]));
        const { value: metodoPagoId, isDismissed } = await Swal.fire({
            title: 'Confirmar Recepción y Pago',
            html: `Se registrará un egreso de <b>${formatCurrency(recibidoTotalMonto)}</b>.<br>Por favor, selecciona el método de pago:`,
            input: 'select',
            inputOptions,
            inputPlaceholder: '-- Selecciona un método --',
            confirmButtonText: 'Confirmar y Registrar',
            showCancelButton: true,
            cancelButtonText: 'Cancelar',
            inputValidator: (value) => !value && '¡Debes seleccionar un método de pago!'
        });
        if (isDismissed || !metodoPagoId) {
            showError(feedbackElementForToast, "Recepción cancelada.");
            return;
        }

        showGlobalLoading("Procesando recepción...");

        // 4. Actualizar stock y precio de compra en la base de datos
        for (const item of itemsRecibidosParaActualizar) {
            const { data: productoActual, error: errProd } = await currentSupabase
                .from('productos_tienda')
                .select('stock_actual')
                .eq('id', item.producto_id)
                .single();

            if (errProd || !productoActual) {
                throw new Error(`No se pudo encontrar el producto con ID ${item.producto_id} para actualizar stock.`);
            }

            const nuevoStock = (productoActual.stock_actual || 0) + item.cantidadRecibida;
            
            // --- CORRECCIÓN FINAL ---
            // Cambiamos 'precio_compra' por 'precio', asumiendo que ese es el nombre correcto de tu columna.
            const { error: updateError } = await currentSupabase
                .from('productos_tienda')
                .update({
                    stock_actual: nuevoStock,
                    precio: item.precio_compra 
                })
                .eq('id', item.producto_id);

            if (updateError) {
                // Si este error persiste, verifica el nombre exacto de la columna de precio en tu tabla 'productos_tienda'.
                throw new Error(`Error actualizando el stock para el producto ID ${item.producto_id}: ${updateError.message}`);
            }
        }

        // 5. Actualizar estado de la compra y registrar egreso en caja
        const nuevoEstadoCompra = esRecepcionParcial ? 'parcial' : 'recibida';
        await currentSupabase.from('compras_tienda').update({
            estado: nuevoEstadoCompra
        }).eq('id', compraId);
        
        const { data: compraData } = await currentSupabase.from('compras_tienda').select('proveedor_id').eq('id', compraId).single();
        const proveedorNombre = getProveedorNombre(compraData.proveedor_id);
        const concepto = `Compra a ${proveedorNombre} (${nuevoEstadoCompra})`;

        const { error: errorCaja } = await currentSupabase.from('caja').insert({
            hotel_id: currentHotelId,
            tipo: 'egreso',
            monto: recibidoTotalMonto,
            concepto: concepto,
            usuario_id: currentUser.id,
            compra_tienda_id: compraId,
            turno_id: turnoId, 
            metodo_pago_id: metodoPagoId
        });

        if (errorCaja) {
            throw new Error(`Inventario actualizado, pero falló el registro en caja: ${errorCaja.message}. REVISAR MANUALMENTE.`);
        }
        
        showSuccess(feedbackElementForToast, '¡Éxito! Inventario y caja actualizados.');

    } catch (err) {
        console.error("Error en recibirPedido:", err);
        showError(feedbackElementForToast, 'Error al procesar: ' + err.message);
    } finally {
        hideGlobalLoading();
        if (typeof window.recargarProductosYProveedores === "function") {
            await window.recargarProductosYProveedores();
        }
        if (typeof renderComprasPendientes === "function") {
            await renderComprasPendientes();
        }
    }
};