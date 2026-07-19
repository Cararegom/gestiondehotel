import { escapeHtml } from '../../security.js';

function getListaCompraItems(deps) {
  const {
    state,
    getAvailableStock,
    getReservedQuantity,
    getTiendaProductoNombre
  } = deps;

  return state.productos
    .filter((producto) => producto.activo !== false)
    .map((producto) => {
      const stockActual = Number(producto.stock_actual || 0);
      const stockMinimo = Number(producto.stock_minimo || 0);
      const reservado = getReservedQuantity(producto.id);
      const disponible = getAvailableStock(producto);
      return {
        id: producto.id,
        nombre: producto.nombre || 'Producto',
        categoria: producto.categoria || 'Terraza',
        codigo: producto.codigo_barras || '',
        stockActual,
        stockMinimo,
        reservado,
        disponible,
        sugerido: Math.max(0, stockMinimo - disponible),
        tiendaProducto: getTiendaProductoNombre(producto)
      };
    })
    .filter((item) => item.stockMinimo > 0 && item.disponible < item.stockMinimo)
    .sort((a, b) => {
      if (b.sugerido !== a.sugerido) return b.sugerido - a.sugerido;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
}

function renderEmptyState() {
  return `
    <div class="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h3 class="text-lg font-bold text-slate-800">Lista de compra al dia</h3>
      <p class="mt-1 text-sm text-slate-500">No hay productos activos con disponible por debajo del stock minimo.</p>
    </div>
  `;
}

function renderShoppingCards(items) {
  if (!items.length) return '';

  return `
    <div class="grid gap-3 md:hidden">
      ${items.map((item) => `
        <article class="rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="font-bold text-slate-800">${escapeHtml(item.nombre)}</h3>
              <p class="text-xs text-slate-500">${escapeHtml(item.categoria)}${item.codigo ? ` | ${escapeHtml(item.codigo)}` : ''}</p>
            </div>
            <span class="rounded-full bg-amber-100 px-3 py-1 text-sm font-black text-amber-800">+${escapeHtml(String(item.sugerido))}</span>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div class="rounded-lg bg-slate-50 p-2"><span class="block text-xs font-semibold uppercase text-slate-500">Stock</span><strong>${escapeHtml(String(item.stockActual))}</strong></div>
            <div class="rounded-lg bg-slate-50 p-2"><span class="block text-xs font-semibold uppercase text-slate-500">Minimo</span><strong>${escapeHtml(String(item.stockMinimo))}</strong></div>
            <div class="rounded-lg bg-slate-50 p-2"><span class="block text-xs font-semibold uppercase text-slate-500">Reservado</span><strong>${escapeHtml(String(item.reservado))}</strong></div>
            <div class="rounded-lg bg-slate-50 p-2"><span class="block text-xs font-semibold uppercase text-slate-500">Disponible</span><strong>${escapeHtml(String(item.disponible))}</strong></div>
          </div>
          <p class="mt-3 text-xs font-semibold text-blue-700">${escapeHtml(item.tiendaProducto)}</p>
        </article>
      `).join('')}
    </div>
  `;
}

function renderShoppingTable(items) {
  if (!items.length) return '';

  return `
    <div class="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th class="px-4 py-3">Producto</th>
            <th class="px-4 py-3">Categoria</th>
            <th class="px-4 py-3 text-right">Stock</th>
            <th class="px-4 py-3 text-right">Minimo</th>
            <th class="px-4 py-3 text-right">Reservado</th>
            <th class="px-4 py-3 text-right">Disponible</th>
            <th class="px-4 py-3 text-right">Sugerido comprar</th>
            <th class="px-4 py-3">Tienda</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${items.map((item) => `
            <tr class="bg-white">
              <td class="px-4 py-3">
                <div class="font-bold text-slate-800">${escapeHtml(item.nombre)}</div>
                <div class="text-xs text-slate-500">${item.codigo ? escapeHtml(item.codigo) : 'Sin codigo'}</div>
              </td>
              <td class="px-4 py-3">${escapeHtml(item.categoria)}</td>
              <td class="px-4 py-3 text-right font-semibold">${escapeHtml(String(item.stockActual))}</td>
              <td class="px-4 py-3 text-right">${escapeHtml(String(item.stockMinimo))}</td>
              <td class="px-4 py-3 text-right">${escapeHtml(String(item.reservado))}</td>
              <td class="px-4 py-3 text-right font-semibold ${item.disponible <= 0 ? 'text-red-600' : 'text-slate-700'}">${escapeHtml(String(item.disponible))}</td>
              <td class="px-4 py-3 text-right">
                <span class="inline-flex rounded-full bg-amber-100 px-3 py-1 text-sm font-black text-amber-800">+${escapeHtml(String(item.sugerido))}</span>
              </td>
              <td class="px-4 py-3 text-xs font-semibold text-blue-700">${escapeHtml(item.tiendaProducto)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

export function renderListaCompraTab(deps) {
  const items = getListaCompraItems(deps);
  const totalSugerido = items.reduce((acc, item) => acc + item.sugerido, 0);

  return `
    <div class="space-y-4">
      ${deps.renderStats()}
      <section class="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-lg font-bold text-slate-800">Lista de compra</h2>
          <p class="text-sm text-slate-500">${items.length} producto(s) con disponible bajo minimo | ${totalSugerido} unidad(es) sugeridas.</p>
        </div>
        <button class="button button-success w-full sm:w-auto" data-action="export-shopping-list" ${items.length ? '' : 'disabled'}>Exportar Excel</button>
      </section>
      ${items.length ? `${renderShoppingCards(items)}${renderShoppingTable(items)}` : renderEmptyState()}
    </div>
  `;
}

export function exportListaCompraExcel(deps) {
  const items = getListaCompraItems(deps);
  if (!items.length) {
    throw new Error('No hay productos en la lista de compra para exportar.');
  }
  if (typeof XLSX === 'undefined') {
    throw new Error('La libreria XLSX no esta cargada. No se puede exportar Excel.');
  }

  const rows = items.map((item) => ({
    Producto: item.nombre,
    Categoria: item.categoria,
    Codigo: item.codigo || 'N/A',
    'Stock Actual': item.stockActual,
    'Stock Minimo': item.stockMinimo,
    Reservado: item.reservado,
    Disponible: item.disponible,
    'Sugerido Comprar': item.sugerido,
    Tienda: item.tiendaProducto
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Lista de compra');
  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `Lista_de_Compra_Terraza_${fecha}.xlsx`);
}
