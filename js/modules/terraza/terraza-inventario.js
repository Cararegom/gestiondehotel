import { escapeAttribute, escapeHtml } from '../../security.js';
import { imprimirInventarioTerraza80mm } from '../../services/thermalPrintService.js';

const PRODUCTO_TERRAZA_PLACEHOLDER_IMG = 'https://via.placeholder.com/320x220?text=Terraza';

function sanitizeProductImageName(fileName = 'producto') {
  return fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function uploadProductImage(file, existingUrl, deps) {
  const { state } = deps;
  if (!file) return existingUrl || null;

  const filePath = `public/${state.hotelId}/terraza_${Date.now()}_${sanitizeProductImageName(file.name)}`;
  const { error: uploadError } = await state.supabase.storage.from('productos').upload(filePath, file);
  if (uploadError) throw uploadError;

  const { data: urlData } = state.supabase.storage.from('productos').getPublicUrl(filePath);
  return urlData?.publicUrl || existingUrl || null;
}

function renderCatalogForm(deps) {
  const { state, isBeerProduct } = deps;
  const product = state.editingProductId
    ? state.productos.find((item) => item.id === state.editingProductId)
    : null;

  return `
    <form id="terraza-product-form" class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 class="text-base font-bold text-slate-800">${product ? 'Editar producto de terraza' : 'Nuevo producto de terraza'}</h3>
          <p class="text-xs text-slate-500">Define precio, stock y estado para vender en el mapa.</p>
        </div>
        ${product ? '<button type="button" class="text-sm font-semibold text-slate-500 hover:text-slate-800" data-action="cancel-product-edit">Cancelar</button>' : ''}
      </div>
      <input type="hidden" name="productId" value="${escapeAttribute(product?.id || '')}">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label class="form-label text-xs">Nombre</label>
          <input name="nombre" class="form-control" required value="${escapeAttribute(product?.nombre || '')}" placeholder="Ej: Michelada">
        </div>
        <div>
          <label class="form-label text-xs">Categoria</label>
          <input name="categoria" class="form-control" required value="${escapeAttribute(product?.categoria || 'Bebidas')}" placeholder="Cervezas">
        </div>
        <div>
          <label class="form-label text-xs">Precio</label>
          <input name="precio" type="number" min="0" step="100" class="form-control" required value="${escapeAttribute(product?.precio ?? '')}" placeholder="0">
        </div>
      </div>

      <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div>
          <label class="form-label text-xs">Stock actual</label>
          <input name="stock_actual" type="number" min="0" step="1" class="form-control" required value="${escapeAttribute(product?.stock_actual ?? 0)}">
        </div>
        <div>
          <label class="form-label text-xs">Stock minimo</label>
          <input name="stock_minimo" type="number" min="0" step="1" class="form-control" value="${escapeAttribute(product?.stock_minimo ?? 0)}">
        </div>
        <div>
          <label class="form-label text-xs">Codigo de barras</label>
          <input name="codigo_barras" class="form-control" value="${escapeAttribute(product?.codigo_barras || '')}" placeholder="Opcional">
        </div>
        <label class="flex items-end gap-2 pb-2 text-sm font-semibold text-slate-700">
          <input name="activo" type="checkbox" class="h-4 w-4" ${product?.activo === false ? '' : 'checked'}>
          Activo para ventas
        </label>
      </div>

      <label class="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
        <input name="permite_michelada" type="checkbox" class="mt-1 h-4 w-4" ${product?.permite_michelada || isBeerProduct(product) ? 'checked' : ''}>
        <span>
          Permite vender como michelada
          <span class="block text-xs font-normal text-amber-800">Usalo para cervezas como Corona, Club Colombia, Aguila, Poker, etc.</span>
        </span>
      </label>

      <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div class="md:col-span-3">
          <label class="form-label text-xs">Descripcion opcional</label>
          <input name="descripcion" class="form-control" value="${escapeAttribute(product?.descripcion || '')}" placeholder="Detalle para el equipo">
        </div>
        <div class="flex items-end">
          <button class="button button-primary w-full" type="submit">${product ? 'Guardar' : 'Crear'}</button>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[150px_minmax(0,1fr)]">
        <img
          id="terraza-product-image-preview"
          src="${escapeAttribute(product?.imagen_url || PRODUCTO_TERRAZA_PLACEHOLDER_IMG)}"
          alt="Vista previa del producto"
          class="h-32 w-full rounded-xl border border-slate-200 bg-white object-cover md:h-32"
        >
        <div>
          <label class="form-label text-xs">Imagen para menu publico</label>
          <input name="imagen" type="file" accept="image/png,image/jpeg,image/webp" class="form-control">
          <p class="mt-2 text-xs text-slate-500">Se muestra en el menu publico de Terraza. Si no subes una nueva imagen, se conserva la actual.</p>
        </div>
      </div>
    </form>
  `;
}

function renderInventarioTable(deps) {
  const {
    state,
    getAvailableStock,
    getReservedQuantity,
    getTiendaProductoNombre,
    isBeerProduct,
    money
  } = deps;

  if (!state.productos.length) {
    return '<div class="rounded-xl border border-slate-200 bg-white p-5 text-center text-slate-500">Aun no hay inventario de Terraza.</div>';
  }

  return `
    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="border-b border-slate-200 p-4">
        <h3 class="font-bold text-slate-800">Inventario de Terraza</h3>
        <p class="text-xs text-slate-500">El stock disponible descuenta las unidades en cuentas abiertas.</p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[900px] text-sm">
          <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th class="px-4 py-3">Producto</th>
              <th class="px-4 py-3">Categoria</th>
              <th class="px-4 py-3 text-center">Michelada</th>
              <th class="px-4 py-3 text-right">Precio</th>
              <th class="px-4 py-3 text-center">Stock</th>
              <th class="px-4 py-3 text-center">Reservado</th>
              <th class="px-4 py-3 text-center">Disponible</th>
              <th class="px-4 py-3">Tienda</th>
              <th class="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${state.productos.map((producto) => {
              const reservado = getReservedQuantity(producto.id);
              const disponible = getAvailableStock(producto);
              const bajo = Number(producto.stock_actual || 0) <= Number(producto.stock_minimo || 0);
              return `
                <tr class="${producto.activo === false ? 'bg-slate-50 text-slate-500' : 'bg-white'}">
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-3">
                      <img src="${escapeAttribute(producto.imagen_url || PRODUCTO_TERRAZA_PLACEHOLDER_IMG)}" alt="${escapeAttribute(producto.nombre)}" class="h-12 w-12 rounded-lg border border-slate-200 bg-slate-50 object-cover">
                      <div>
                        <div class="font-bold text-slate-800">${escapeHtml(producto.nombre)}</div>
                        <div class="text-xs text-slate-500">${escapeHtml(producto.codigo_barras || 'Sin codigo')}</div>
                      </div>
                    </div>
                  </td>
                  <td class="px-4 py-3">${escapeHtml(producto.categoria || 'Bebidas')}</td>
                  <td class="px-4 py-3 text-center">
                    ${isBeerProduct(producto)
                      ? '<span class="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">Si</span>'
                      : '<span class="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">No</span>'}
                  </td>
                  <td class="px-4 py-3 text-right font-semibold">${money(producto.precio)}</td>
                  <td class="px-4 py-3 text-center font-bold ${bajo ? 'text-amber-700' : 'text-slate-800'}">${escapeHtml(String(producto.stock_actual || 0))}</td>
                  <td class="px-4 py-3 text-center">${escapeHtml(String(reservado))}</td>
                  <td class="px-4 py-3 text-center font-bold ${disponible <= 0 ? 'text-red-600' : 'text-green-700'}">${escapeHtml(String(disponible))}</td>
                  <td class="px-4 py-3 text-xs text-slate-500">${escapeHtml(getTiendaProductoNombre(producto))}</td>
                  <td class="px-4 py-3 text-right">
                    <div class="inline-flex gap-2">
                      <button class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50" data-action="edit-product" data-product-id="${escapeAttribute(producto.id)}">Editar</button>
                      <button class="rounded-lg border px-3 py-1.5 text-xs font-semibold ${producto.activo === false ? 'border-green-200 text-green-700 hover:bg-green-50' : 'border-red-200 text-red-700 hover:bg-red-50'}" data-action="toggle-product-active" data-product-id="${escapeAttribute(producto.id)}" data-active="${producto.activo === false ? 'true' : 'false'}">
                        ${producto.activo === false ? 'Activar' : 'Pausar'}
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderTransferInfoPanel() {
  return `
    <section class="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 shadow-sm">
      <h3 class="font-bold">Transferencias de inventario</h3>
      <p class="mt-1">El inventario de Tienda hacia Terraza lo envia recepcion desde <strong>Tienda &gt; Inventario</strong>, cuando el mesero lo solicite.</p>
      <p class="mt-1">La devolucion de Terraza hacia Tienda tambien se gestiona desde <strong>Tienda &gt; Inventario</strong>, quedando registrada con el usuario y turno correspondiente.</p>
    </section>
  `;
}

function renderInventoryPrintPanel(deps) {
  const activeProducts = deps.state.productos.filter((producto) => producto.activo !== false).length;

  return `
    <section class="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 class="text-base font-bold text-slate-800">Inventario de Terraza</h3>
        <p class="text-xs text-slate-500">${activeProducts} producto(s) activo(s) para impresion.</p>
      </div>
      <button type="button" class="button button-primary w-full sm:w-auto" data-action="print-inventory" ${activeProducts ? '' : 'disabled'}>
        Imprimir inventario
      </button>
    </section>
  `;
}

export function renderInventarioTab(deps) {
  return `
    <div class="space-y-4">
      ${renderInventoryPrintPanel(deps)}
      ${deps.renderStats()}
      ${renderTransferInfoPanel()}
      ${renderCatalogForm(deps)}
      ${renderInventarioTable(deps)}
    </div>
  `;
}

export async function saveProduct(form, deps) {
  const { state, isBeerProduct, refreshAndRender, showFeedback } = deps;
  const formData = new FormData(form);
  const productId = formData.get('productId');
  const currentProduct = productId ? state.productos.find((item) => item.id === productId) : null;
  const imageEntry = formData.get('imagen');
  const imageFile = imageEntry && typeof imageEntry === 'object' && Number(imageEntry.size || 0) > 0
    ? imageEntry
    : null;
  const nombre = String(formData.get('nombre') || '').trim();
  const categoria = String(formData.get('categoria') || 'Bebidas').trim();
  const descripcion = String(formData.get('descripcion') || '').trim();
  const precio = Number(formData.get('precio') || 0);
  const stockActual = Number(formData.get('stock_actual') || 0);
  const stockMinimo = Number(formData.get('stock_minimo') || 0);
  const codigoBarras = String(formData.get('codigo_barras') || '').trim();
  const activo = formData.get('activo') === 'on';
  const permiteMichelada = formData.get('permite_michelada') === 'on' || isBeerProduct({ nombre, categoria });

  if (!nombre) throw new Error('El nombre es obligatorio.');
  if (!categoria) throw new Error('La categoria es obligatoria.');
  if (!Number.isFinite(precio) || precio < 0) throw new Error('El precio no es valido.');
  if (!Number.isInteger(stockActual) || stockActual < 0) throw new Error('El stock actual no es valido.');
  if (!Number.isInteger(stockMinimo) || stockMinimo < 0) throw new Error('El stock minimo no es valido.');

  const payload = {
    hotel_id: state.hotelId,
    nombre,
    categoria,
    descripcion,
    precio,
    stock_actual: stockActual,
    stock_minimo: stockMinimo,
    codigo_barras: codigoBarras || null,
    imagen_url: await uploadProductImage(imageFile, currentProduct?.imagen_url || null, deps),
    permite_michelada: permiteMichelada,
    activo
  };

  if (productId) {
    const { error } = await state.supabase
      .from('terraza_productos')
      .update(payload)
      .eq('id', productId);
    if (error) throw error;
  } else {
    const { error } = await state.supabase
      .from('terraza_productos')
      .insert(payload);
    if (error) throw error;
  }

  state.editingProductId = null;
  await refreshAndRender();
  showFeedback(productId ? 'Bebida actualizada.' : 'Bebida creada.', 'success');
}

export async function printInventory(deps) {
  const {
    state,
    getAvailableStock,
    getReservedQuantity,
    getTiendaProductoNombre,
    showFeedback
  } = deps;

  const productosActivos = state.productos.filter((producto) => producto.activo !== false);
  if (!productosActivos.length) {
    throw new Error('No hay productos activos de Terraza para imprimir.');
  }

  const productos = productosActivos.map((producto) => ({
    nombre: producto.nombre,
    categoria: producto.categoria,
    codigoBarras: producto.codigo_barras,
    stockActual: Number(producto.stock_actual || 0),
    stockMinimo: Number(producto.stock_minimo || 0),
    reservado: getReservedQuantity(producto.id),
    disponible: getAvailableStock(producto),
    activo: producto.activo,
    tiendaProducto: getTiendaProductoNombre(producto)
  }));

  const userName = state.user?.user_metadata?.full_name
    || state.user?.user_metadata?.nombre
    || state.user?.app_metadata?.nombre
    || state.user?.email
    || 'Usuario';

  await imprimirInventarioTerraza80mm({
    supabase: state.supabase,
    hotelId: state.hotelId,
    productos,
    userName
  });

  showFeedback('Inventario enviado a impresion.', 'success');
}

export async function transferFromTienda() {
  throw new Error('Recepcion debe enviar el inventario desde Tienda > Inventario. El mesero no puede tomar stock de Tienda desde Terraza.');
}

export async function transferToTienda(form, deps) {
  const { state, getAvailableStock, getProductoById, refreshAndRender, showFeedback } = deps;
  const formData = new FormData(form);
  const productoTerrazaId = String(formData.get('producto_terraza_id') || '').trim();
  const cantidad = Number(formData.get('cantidad') || 0);

  if (!productoTerrazaId) throw new Error('Selecciona un producto de Terraza.');
  if (!Number.isInteger(cantidad) || cantidad <= 0) throw new Error('La cantidad debe ser mayor a cero.');

  const producto = getProductoById(productoTerrazaId);
  if (producto && getAvailableStock(producto) < cantidad) {
    throw new Error(`Solo hay ${getAvailableStock(producto)} unidad(es) disponibles para devolver. Hay unidades reservadas en cuentas abiertas.`);
  }

  const { data, error } = await state.supabase.rpc('transferir_terraza_a_tienda', {
    p_producto_terraza_id: productoTerrazaId,
    p_cantidad: cantidad,
    p_usuario_id: state.user.id
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.message || 'No se pudo transferir hacia Tienda.');

  state.activeTab = 'inventario';
  await refreshAndRender();
  showFeedback('Inventario devuelto desde Terraza a Tienda.', 'success');
}

export async function toggleProductActive(productId, active, deps) {
  const { state, refreshAndRender, showFeedback } = deps;
  const { error } = await state.supabase
    .from('terraza_productos')
    .update({ activo: active })
    .eq('id', productId);
  if (error) throw error;

  await refreshAndRender();
  showFeedback(active ? 'Producto activado para ventas.' : 'Producto pausado para ventas.', 'success');
}
