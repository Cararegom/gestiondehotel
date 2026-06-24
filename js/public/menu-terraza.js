import { supabase } from '../supabaseClient.js';

const DEFAULT_TERRAZA_HOTEL_ID = '38373fa5-b953-4aa9-b4e9-25b9739be5f2';

const state = {
  hotelId: null,
  hotel: null,
  products: [],
  search: '',
  category: 'Todas',
  micheladaPrice: 0
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

function setStatus(message, type = 'info') {
  const box = document.getElementById('status-box');
  if (!box) return;
  box.className = `status-box show ${type}`;
  box.textContent = message;
}

function clearStatus() {
  const box = document.getElementById('status-box');
  if (!box) return;
  box.className = 'status-box';
  box.textContent = '';
}

function getCategories() {
  return ['Todas', ...new Set(state.products.map((product) => product.categoria || 'Terraza'))];
}

function getFilteredProducts() {
  const search = normalize(state.search);
  return state.products.filter((product) => {
    const matchesCategory = state.category === 'Todas' || product.categoria === state.category;
    const matchesSearch = !search || normalize(`${product.nombre} ${product.descripcion || ''} ${product.categoria || ''}`).includes(search);
    return matchesCategory && matchesSearch;
  });
}

function renderHero() {
  const hotelName = document.getElementById('hotel-name');
  const heroCopy = document.getElementById('hero-copy');
  if (!hotelName || !heroCopy) return;

  hotelName.textContent = state.hotel?.nombre
    ? `${state.hotel.nombre} | Terraza`
    : 'Menu de Terraza';
  heroCopy.textContent = state.hotel?.direccion
    ? `Bebidas, licores y micheladas disponibles en terraza. ${state.hotel.direccion}.`
    : 'Bebidas, licores, micheladas y precios actualizados para disfrutar en la terraza.';
}

function renderCategories() {
  const container = document.getElementById('category-tabs');
  if (!container) return;

  container.innerHTML = getCategories().map((category) => `
    <button class="chip ${category === state.category ? 'active' : ''}" type="button" data-category="${escapeHtml(category)}">
      ${escapeHtml(category)}
    </button>
  `).join('');
}

function renderProducts() {
  const grid = document.getElementById('menu-grid');
  if (!grid) return;

  const products = getFilteredProducts();
  if (!products.length) {
    grid.innerHTML = '<div class="empty">No encontramos productos con ese filtro. Prueba otra busqueda.</div>';
    return;
  }

  grid.innerHTML = products.map((product, index) => {
    const price = Number(product.precio || 0);
    const micheladaTotal = price + state.micheladaPrice;
    const imageLoading = index < 4 ? 'eager' : 'lazy';
    const imageHtml = product.imagen_url
      ? `<img src="${escapeHtml(product.imagen_url)}" alt="${escapeHtml(product.nombre)}" loading="${imageLoading}" decoding="async">`
      : '<div class="beer-media-placeholder" aria-hidden="true"></div>';
    const micheladaHtml = product.permite_michelada && state.micheladaPrice > 0
      ? `<span class="addon">Michelada + ${money(state.micheladaPrice)} (${money(micheladaTotal)})</span>`
      : '';
    const availabilityHtml = product.disponible === false
      ? '<span class="addon soldout">Agotada por ahora</span>'
      : '<span class="addon">Disponible hoy</span>';

    return `
      <article class="beer-card">
        <figure class="beer-media ${product.imagen_url ? 'has-image' : ''}">
          ${imageHtml}
        </figure>
        <div class="beer-body">
          <div class="beer-top">
            <h2 class="beer-title">${escapeHtml(product.nombre)}</h2>
            <div class="price">${money(price)}</div>
          </div>
          <span class="category">${escapeHtml(product.categoria || 'Terraza')}</span>
          <p class="description">${escapeHtml(product.descripcion || 'Producto disponible en terraza.')}</p>
          <div class="addons">
            ${micheladaHtml}
            ${availabilityHtml}
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function renderAll() {
  renderHero();
  renderCategories();
  renderProducts();
}

async function loadMenu() {
  state.hotelId = getParam('hotel') || DEFAULT_TERRAZA_HOTEL_ID;

  try {
    const { data, error } = await supabase.rpc('obtener_menu_terraza_publico', {
      p_hotel_id: state.hotelId
    });

    if (error) throw error;

    state.hotel = data?.hotel || null;
    state.micheladaPrice = Number(data?.precio_michelada || 0);
    state.products = (data?.productos || []).map((product) => ({
      ...product,
      precio: Number(product.precio || 0)
    }));

    clearStatus();
    renderAll();
  } catch (error) {
    console.error('[Menu Terraza] Error cargando menu:', error);
    setStatus(error.message || 'No se pudo cargar el menu de terraza.', 'error');
    document.getElementById('menu-grid').innerHTML = '<div class="empty">No pudimos cargar la carta. Solicita el menu actualizado al equipo de terraza.</div>';
  }
}

function bindEvents() {
  document.getElementById('search-input')?.addEventListener('input', (event) => {
    state.search = event.target.value || '';
    renderProducts();
  });

  document.addEventListener('click', (event) => {
    const categoryButton = event.target.closest('[data-category]');
    if (!categoryButton) return;
    state.category = categoryButton.dataset.category || 'Todas';
    renderCategories();
    renderProducts();
  });
}

bindEvents();
loadMenu();
