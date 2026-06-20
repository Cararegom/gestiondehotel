import { supabase } from '../supabaseClient.js';

const PLACEHOLDER_IMAGE = 'https://via.placeholder.com/480x360?text=Tienda';

const state = {
  hotelId: null,
  hotel: null,
  whatsappNumero: null,
  products: [],
  cart: new Map(),
  search: '',
  category: 'Todas',
  submitting: false
};

function money(value) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalize(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function getCartItems() {
  return Array.from(state.cart.values());
}

function getCartTotal() {
  return getCartItems().reduce((acc, item) => acc + item.cantidad * Number(item.precio_venta || 0), 0);
}

function getCartCount() {
  return getCartItems().reduce((acc, item) => acc + item.cantidad, 0);
}

function setStatus(message, type = 'info', extraHtml = '') {
  const box = document.getElementById('status-box');
  if (!box) return;
  box.className = `status-box ${type}`;
  box.innerHTML = `${escapeHtml(message)}${extraHtml}`;
}

function clearStatus() {
  const box = document.getElementById('status-box');
  if (!box) return;
  box.className = 'status-box';
  box.innerHTML = '';
}

function buildWhatsappUrl(numero, mensaje) {
  if (!numero || !mensaje) return '';
  return `https://wa.me/${encodeURIComponent(numero)}?text=${encodeURIComponent(mensaje)}`;
}

function renderHero() {
  const hero = document.getElementById('store-hero');
  if (!hero) return;

  const logo = state.hotel?.logo_url;
  hero.innerHTML = `
    ${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(state.hotel?.nombre || 'Hotel')}">` : ''}
    <div>
      <h1>${escapeHtml(state.hotel?.nombre || 'Tienda del hotel')}</h1>
      <p>Elige tus productos y envia el pedido a recepcion desde tu habitacion.</p>
    </div>
  `;
}

function getCategories() {
  return ['Todas', ...new Set(state.products.map((product) => product.categoria || 'Tienda'))];
}

function renderCategories() {
  const container = document.getElementById('category-tabs');
  if (!container) return;
  const categories = getCategories();
  container.innerHTML = categories.map((category) => `
    <button class="chip ${category === state.category ? 'active' : ''}" data-category="${escapeHtml(category)}">
      ${escapeHtml(category)}
    </button>
  `).join('');
}

function getFilteredProducts() {
  const search = normalize(state.search);
  return state.products.filter((product) => {
    const matchesCategory = state.category === 'Todas' || product.categoria === state.category;
    const matchesSearch = !search || normalize(`${product.nombre} ${product.descripcion || ''} ${product.categoria || ''}`).includes(search);
    return matchesCategory && matchesSearch;
  });
}

function renderProducts() {
  const grid = document.getElementById('product-grid');
  if (!grid) return;

  const products = getFilteredProducts();
  if (!products.length) {
    grid.innerHTML = '<div class="cart-empty">No hay productos disponibles con ese filtro.</div>';
    return;
  }

  grid.innerHTML = products.map((product) => {
    const inCart = state.cart.get(product.id)?.cantidad || 0;
    const stock = Number(product.stock_actual || 0);
    return `
      <article class="product-card">
        <img src="${escapeHtml(product.imagen_url || PLACEHOLDER_IMAGE)}" alt="${escapeHtml(product.nombre)}" loading="lazy">
        <div class="product-body">
          <h2 class="product-title">${escapeHtml(product.nombre)}</h2>
          <p class="product-description">${escapeHtml(product.descripcion || product.categoria || '')}</p>
          <div class="product-meta">
            <span class="price">${money(product.precio_venta)}</span>
            <span class="stock">Stock ${stock}</span>
          </div>
          <button class="add-btn" data-add-product="${escapeHtml(product.id)}" ${inCart >= stock ? 'disabled' : ''}>
            ${inCart ? `Agregar otro (${inCart})` : 'Agregar'}
          </button>
        </div>
      </article>
    `;
  }).join('');
}

function renderCart() {
  const container = document.getElementById('cart-items');
  const totalEl = document.getElementById('cart-total');
  const mobileButton = document.getElementById('mobile-cart-button');
  if (!container || !totalEl || !mobileButton) return;

  const items = getCartItems();
  if (!items.length) {
    container.innerHTML = '<div class="cart-empty">Tu carrito esta vacio. Agrega productos para enviar el pedido.</div>';
  } else {
    container.innerHTML = items.map((item) => `
      <div class="cart-item">
        <div>
          <div class="cart-name">${escapeHtml(item.nombre)}</div>
          <div class="cart-sub">${money(item.precio_venta)} x ${item.cantidad} = ${money(item.precio_venta * item.cantidad)}</div>
        </div>
        <div class="qty-controls">
          <button type="button" data-decrease="${escapeHtml(item.id)}">-</button>
          <strong>${item.cantidad}</strong>
          <button type="button" data-increase="${escapeHtml(item.id)}" ${item.cantidad >= Number(item.stock_actual || 0) ? 'disabled' : ''}>+</button>
        </div>
      </div>
    `).join('');
  }

  const total = getCartTotal();
  const count = getCartCount();
  totalEl.textContent = money(total);
  mobileButton.textContent = count ? `Ver pedido (${count}) - ${money(total)}` : 'Ver pedido - $0';
}

function renderAll() {
  renderHero();
  renderCategories();
  renderProducts();
  renderCart();
}

function addProduct(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;

  const current = state.cart.get(productId);
  const currentQty = current?.cantidad || 0;
  const stock = Number(product.stock_actual || 0);
  if (currentQty >= stock) return;

  state.cart.set(productId, {
    ...product,
    cantidad: currentQty + 1
  });
  renderProducts();
  renderCart();
  clearStatus();
}

function changeQuantity(productId, delta) {
  const item = state.cart.get(productId);
  if (!item) return;

  const nextQty = item.cantidad + delta;
  if (nextQty <= 0) {
    state.cart.delete(productId);
  } else {
    item.cantidad = Math.min(nextQty, Number(item.stock_actual || 0));
    state.cart.set(productId, item);
  }
  renderProducts();
  renderCart();
}

function buildPayload() {
  const room = document.getElementById('room-input')?.value.trim();
  const name = document.getElementById('name-input')?.value.trim();
  const phone = document.getElementById('phone-input')?.value.trim();
  const notes = document.getElementById('notes-input')?.value.trim();
  const items = getCartItems().map((item) => ({
    producto_id: item.id,
    cantidad: item.cantidad
  }));

  return { room, name, phone, notes, items };
}

async function submitOrder(event) {
  event.preventDefault();
  if (state.submitting) return;

  const payload = buildPayload();
  if (!payload.items.length) {
    setStatus('Agrega al menos un producto al pedido.', 'error');
    return;
  }
  if (!payload.room) {
    setStatus('Escribe el numero o nombre de la habitacion.', 'error');
    return;
  }

  state.submitting = true;
  document.getElementById('submit-order').disabled = true;
  setStatus('Enviando pedido...', 'info');

  try {
    const { data, error } = await supabase.rpc('crear_pedido_web_tienda', {
      p_hotel_id: state.hotelId,
      p_habitacion_nombre: payload.room,
      p_cliente_nombre: payload.name || null,
      p_telefono_cliente: payload.phone || null,
      p_observaciones: payload.notes || null,
      p_items: payload.items
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.message || 'No se pudo crear el pedido.');

    state.cart.clear();
    renderProducts();
    renderCart();

    const whatsappUrl = buildWhatsappUrl(data.whatsapp_numero, data.whatsapp_mensaje);
    const whatsappHtml = whatsappUrl
      ? `<a class="whatsapp-btn" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener">Enviar tambien por WhatsApp</a>`
      : '<p style="margin:10px 0 0;">El hotel aun no tiene WhatsApp configurado. El pedido quedo guardado en recepcion.</p>';

    setStatus(`Pedido #${data.codigo || ''} recibido por ${money(data.total)}.`, 'success', whatsappHtml);
  } catch (error) {
    console.error('[Tienda Web] Error enviando pedido:', error);
    setStatus(error.message || 'No se pudo enviar el pedido.', 'error');
  } finally {
    state.submitting = false;
    document.getElementById('submit-order').disabled = false;
  }
}

async function loadCatalog() {
  state.hotelId = getParam('hotel');
  const roomParam = getParam('habitacion') || getParam('room');
  const roomInput = document.getElementById('room-input');
  if (roomInput && roomParam) roomInput.value = roomParam;

  if (!state.hotelId) {
    setStatus('Falta el parametro hotel en la URL.', 'error');
    document.getElementById('product-grid').innerHTML = '<div class="cart-empty">Solicita el enlace correcto en recepcion.</div>';
    return;
  }

  const { data, error } = await supabase.rpc('obtener_catalogo_tienda_web', {
    p_hotel_id: state.hotelId
  });

  if (error) {
    console.error('[Tienda Web] Error cargando catalogo:', error);
    setStatus(error.message || 'No se pudo cargar la tienda.', 'error');
    return;
  }

  if (data?.activo === false) {
    state.hotel = data.hotel || null;
    renderHero();
    document.getElementById('product-grid').innerHTML = '<div class="cart-empty">La tienda web esta desactivada temporalmente.</div>';
    return;
  }

  state.hotel = data.hotel || null;
  state.whatsappNumero = data.whatsapp_numero || null;
  state.products = (data.productos || []).map((product) => ({
    ...product,
    precio_venta: Number(product.precio_venta || 0),
    stock_actual: Number(product.stock_actual || 0)
  }));

  renderAll();
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const addButton = event.target.closest('[data-add-product]');
    const increaseButton = event.target.closest('[data-increase]');
    const decreaseButton = event.target.closest('[data-decrease]');
    const categoryButton = event.target.closest('[data-category]');

    if (addButton) {
      addProduct(addButton.dataset.addProduct);
    } else if (increaseButton) {
      changeQuantity(increaseButton.dataset.increase, 1);
    } else if (decreaseButton) {
      changeQuantity(decreaseButton.dataset.decrease, -1);
    } else if (categoryButton) {
      state.category = categoryButton.dataset.category || 'Todas';
      renderCategories();
      renderProducts();
    }
  });

  document.getElementById('search-input')?.addEventListener('input', (event) => {
    state.search = event.target.value || '';
    renderProducts();
  });

  document.getElementById('order-form')?.addEventListener('submit', submitOrder);

  document.getElementById('mobile-cart-button')?.addEventListener('click', () => {
    document.getElementById('cart-panel')?.classList.add('open');
  });

  document.getElementById('close-cart-button')?.addEventListener('click', () => {
    document.getElementById('cart-panel')?.classList.remove('open');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.getElementById('cart-panel')?.classList.remove('open');
    }
  });
}

bindEvents();
loadCatalog();
