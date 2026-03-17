import { tiendaState } from './state.js';
import { getTabContentEl } from './helpers.js';

let filtroProveedorListaCompras = '';
let inventarioProductos = [];
let proveedoresCache = [];

async function cargarDatosListaCompras() {
  const [{ data: productos }, { data: proveedores }] = await Promise.all([
    tiendaState.currentSupabase
      .from('productos_tienda')
      .select('*')
      .eq('hotel_id', tiendaState.currentHotelId),
    tiendaState.currentSupabase
      .from('proveedores')
      .select('id, nombre')
      .eq('hotel_id', tiendaState.currentHotelId),
  ]);

  inventarioProductos = productos || [];
  proveedoresCache = proveedores || [];
}

export async function renderListaCompras() {
  const cont = getTabContentEl();
  if (!cont) return;

  await cargarDatosListaCompras();

  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <h3 style="color:#2563eb;font-size:1.23em;font-weight:700;margin:0;">Lista de Compras Sugerida</h3>
      <button id="btnExportarListaCompra" style="background:linear-gradient(90deg,#22c55e,#1d4ed8);color:#fff;padding:10px 22px;border:none;border-radius:7px;font-size:1em;font-weight:600;box-shadow:0 1px 8px #1d4ed820;cursor:pointer;">Exportar Excel</button>
    </div>

    <div style="margin-bottom:16px;">
      <label style="font-weight:600;color:#334155;margin-right:10px;">Filtrar por proveedor:</label>
      <select id="selectProveedorCompra" style="padding:9px 18px;border-radius:7px;border:1.5px solid #cbd5e1;min-width:200px;font-size:1em;background:#f9fafb;font-weight:500;color:#2563eb;margin-left:0;">
        <option value="">-- Todos los proveedores --</option>
        ${proveedoresCache.map((pr) => `<option value="${pr.id}">${pr.nombre}</option>`).join('')}
      </select>
    </div>

    <div style="overflow-x:auto;background:#fff;border-radius:10px;box-shadow:0 2px 16px #0001;">
      <table style="width:100%;font-size:1em;border-collapse:collapse;overflow:hidden;">
        <thead>
          <tr style="background:#f1f5f9;color:#222;">
            <th style="padding:13px 10px;text-align:left;">Producto</th>
            <th style="padding:13px 10px;text-align:right;">Stock Actual</th>
            <th style="padding:13px 10px;text-align:right;">Stock Min.</th>
            <th style="padding:13px 10px;text-align:right;">Stock Max.</th>
            <th style="padding:13px 10px;text-align:right;">Sugerido Comprar</th>
            <th style="padding:13px 10px;text-align:left;">Proveedor</th>
          </tr>
        </thead>
        <tbody id="bodyListaCompras"></tbody>
      </table>
    </div>
  `;

  document.getElementById('btnExportarListaCompra').onclick = exportarListaCompraExcel;
  document.getElementById('selectProveedorCompra').onchange = (event) => {
    filtroProveedorListaCompras = event.target.value;
    renderTablaListaCompras();
  };

  renderTablaListaCompras();
}

export function renderTablaListaCompras() {
  const tbody = document.getElementById('bodyListaCompras');
  if (!tbody) return;

  let listaSugerida = inventarioProductos
    .filter((producto) => producto.activo)
    .filter((producto) => Number(producto.stock_actual) < Number(producto.stock_minimo));

  if (filtroProveedorListaCompras) {
    listaSugerida = listaSugerida.filter((producto) => producto.proveedor_id === filtroProveedorListaCompras);
  }

  if (!listaSugerida.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:10px;">No hay productos que necesiten reabastecimiento o que coincidan con el filtro.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  listaSugerida.forEach((producto) => {
    const proveedor = proveedoresCache.find((item) => item.id === producto.proveedor_id)?.nombre || 'N/A';
    const cantidadASugerir = Math.max(
      0,
      (Number(producto.stock_maximo) || Number(producto.stock_minimo) || 0) - (Number(producto.stock_actual) || 0)
    );

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding:12px 10px;border-bottom:1px solid #f1f5f9;font-weight:500;color:#334155;">${producto.nombre}</td>
      <td style="padding:12px 10px;text-align:right;border-bottom:1px solid #f1f5f9;">${producto.stock_actual || 0}</td>
      <td style="padding:12px 10px;text-align:right;border-bottom:1px solid #f1f5f9;">${producto.stock_minimo || 0}</td>
      <td style="padding:12px 10px;text-align:right;border-bottom:1px solid #f1f5f9;">${producto.stock_maximo || 0}</td>
      <td style="padding:12px 10px;text-align:right;font-weight:700;border-bottom:1px solid #f1f5f9;${cantidadASugerir > 0 ? 'color:#fff;background:#facc15;border-radius:7px;' : 'color:#64748b;'}">
        ${cantidadASugerir > 0
          ? `<span style="padding:5px 18px;border-radius:14px;background:#facc15;color:#a16207;display:inline-block;">+${cantidadASugerir}</span>`
          : '<span style="color:#aaa;">-</span>'}
      </td>
      <td style="padding:12px 10px;color:#2563eb;border-bottom:1px solid #f1f5f9;">
        ${proveedor ? `<span style="font-weight:600;">${proveedor}</span>` : '<span style="color:#aaa;">Sin proveedor</span>'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

export function exportarListaCompraExcel() {
  let listaSugerida = inventarioProductos.filter((producto) => Number(producto.stock_actual) < Number(producto.stock_minimo));
  if (filtroProveedorListaCompras) {
    listaSugerida = listaSugerida.filter((producto) => producto.proveedor_id === filtroProveedorListaCompras);
  }

  if (!listaSugerida.length) {
    alert('No hay productos en la lista de compras para exportar.');
    return;
  }

  const dataParaExcel = listaSugerida.map((producto) => {
    const proveedorNombre = proveedoresCache.find((item) => item.id === producto.proveedor_id)?.nombre || 'N/A';
    const cantidadASugerir = Math.max(
      0,
      (Number(producto.stock_maximo) || Number(producto.stock_minimo) || 0) - (Number(producto.stock_actual) || 0)
    );

    return {
      Producto: producto.nombre,
      Proveedor: proveedorNombre,
      'Stock Actual': producto.stock_actual,
      'Stock Minimo': producto.stock_minimo,
      'Sugerido Comprar': cantidadASugerir,
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(dataParaExcel);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Lista de Compras');
  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `Lista_de_Compras_${fecha}.xlsx`);
}
