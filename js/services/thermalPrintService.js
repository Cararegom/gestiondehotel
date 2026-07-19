import { escapeHtml } from '../security.js';

function formatCurrency(value) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatDateTime(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-CO');
}

function buildPrintStyle(config) {
  const paper = String(config?.tamano_papel || '').toLowerCase();
  if (paper === '58mm') {
    return {
      width: '54mm',
      printPage: '@page{margin:0;}',
      css: `
        body{font-family:monospace;font-size:10.5px;width:54mm;max-width:54mm;margin:0;padding:0;background:#fff;color:#111;}
        .ticket{width:54mm;max-width:54mm;margin:0;padding:2mm 1.5mm;box-sizing:border-box;}
        table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10.5px;}
        th,td{padding:2px 1px;vertical-align:top;}
      `
    };
  }
  if (paper === '80mm') {
    return {
      width: '74mm',
      printPage: '@page{margin:0;}',
      css: `
        body{font-family:monospace;font-size:11px;width:74mm;max-width:74mm;margin:0;padding:0;background:#fff;color:#111;}
        .ticket{width:74mm;max-width:74mm;margin:0;padding:3mm 2mm;box-sizing:border-box;}
        table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px;}
        th,td{padding:2px 1px;vertical-align:top;}
      `
    };
  }
  return {
    width: '820px',
    printPage: '@page{margin:3mm;}',
    css: `
      body{font-family:'Segoe UI',Arial,sans-serif;font-size:14px;max-width:820px;margin:0 auto;background:#fff;color:#111;}
      .ticket{max-width:820px;margin:auto;padding:18px;}
      table{width:100%;border-collapse:collapse;font-size:14px;}
      th,td{padding:6px 4px;vertical-align:top;}
    `
  };
}

function renderHeader(config = {}, documentLabel) {
  const lines = [config.encabezado_ticket_l1, config.encabezado_ticket_l2, config.encabezado_ticket_l3].filter(Boolean);
  const headerText = lines.length ? lines.join('<br>') : (config.encabezado_ticket || '');
  return `
    ${config.mostrar_logo !== false && config.logo_url ? `<div style="text-align:center;margin-bottom:6px;"><img src="${config.logo_url}" style="max-width:42mm;max-height:40px;object-fit:contain;"></div>` : ''}
    <div style="text-align:center;font-weight:800;font-size:1.2em;">${config.nombre_hotel || ''}</div>
    <div style="text-align:center;font-size:0.9em;line-height:1.35;">
      ${config.razon_social || ''}
      ${config.nit_rut ? `<br>NIT/RUT: ${config.nit_rut}` : ''}
      ${config.direccion_fiscal ? `<br>${config.direccion_fiscal}` : ''}
    </div>
    ${headerText ? `<div style="text-align:center;margin:6px 0;font-size:0.88em;">${headerText}</div>` : ''}
    <div style="border-bottom:1px dashed #333;margin:6px 0;"></div>
    <div style="text-align:center;font-weight:800;font-size:1.05em;">${documentLabel}</div>
    <div style="border-bottom:1px dashed #333;margin:6px 0;"></div>
  `;
}

function renderMeta(meta = []) {
  const cleanMeta = meta.filter((item) => (
    item
    && item.value !== undefined
    && item.value !== null
    && String(item.value).trim() !== ''
  ));
  if (!cleanMeta.length) return '';
  return cleanMeta.map((item) => `
    <div class="meta-row">
      <span class="meta-label"><b>${item.label}:</b></span>
      <span class="meta-value">${item.value}</span>
    </div>
  `).join('');
}

function renderItems(items = []) {
  if (!items.length) return '';
  return `
    <table>
      <thead>
        <tr>
          <th class="item-name">Detalle</th>
          <th class="item-qty">Cant.</th>
          <th class="item-total">Total</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item) => `
          <tr>
            <td class="item-name">${item.nombre || ''}${item.precio ? `<div class="item-price">${formatCurrency(item.precio)}</div>` : ''}</td>
            <td class="item-qty">${item.cantidad || ''}</td>
            <td class="item-total">${formatCurrency(item.total || 0)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderPayments(payments = []) {
  if (!payments.length) return '';
  return `
    <div style="border-top:1px dashed #333;margin:8px 0 6px;"></div>
    <div style="font-weight:700;margin-bottom:4px;">Pagos</div>
    ${payments.map((payment) => `
      <div class="payment-row">
        <span>${payment.label || 'Método'}</span>
        <span>${formatCurrency(payment.amount || 0)}</span>
      </div>
    `).join('')}
  `;
}

export async function imprimirTicketOperacion({
  supabase,
  hotelId,
  documentLabel = 'Ticket',
  reference,
  clientName,
  meta = [],
  items = [],
  subtotal = 0,
  discount = 0,
  taxes = 0,
  tip = 0,
  tipLabel = 'Propina sugerida',
  total = 0,
  totalLabel = 'Total',
  payments = [],
  notes = ''
}) {
  const { data: config } = await supabase
    .from('configuracion_hotel')
    .select('logo_url, nombre_hotel, direccion_fiscal, nit_rut, razon_social, tipo_impresora, tamano_papel, encabezado_ticket, encabezado_ticket_l1, encabezado_ticket_l2, encabezado_ticket_l3, pie_ticket, mostrar_logo')
    .eq('hotel_id', hotelId)
    .maybeSingle();

  const { width, css, printPage } = buildPrintStyle(config);
  const shouldShowReference = Boolean(reference) && !String(documentLabel || '').toLowerCase().includes('terraza');
  const finalMeta = [
    ...(shouldShowReference ? [{ label: 'Referencia', value: reference }] : []),
    { label: 'Fecha', value: formatDateTime(new Date()) },
    ...(clientName ? [{ label: 'Cliente', value: clientName }] : []),
    ...meta
  ];

  const html = `
    <html>
      <head>
        <title>${documentLabel}</title>
        <style>
          ${css}
          *{box-sizing:border-box;}
          .ticket{width:${width};max-width:${width};overflow:hidden;}
          .meta-row,.payment-row,.total-row{display:flex;justify-content:space-between;gap:6px;font-size:0.92em;margin-bottom:2px;max-width:100%;min-width:0;}
          .meta-label,.meta-value,.payment-row span,.total-row span,.total-row strong{min-width:0;overflow-wrap:anywhere;word-break:break-word;}
          .meta-value,.payment-row span:last-child,.total-row span:last-child,.total-row strong:last-child{text-align:right;}
          .item-name{width:54%;text-align:left;overflow-wrap:anywhere;word-break:break-word;}
          .item-qty{width:14%;text-align:center;white-space:nowrap;}
          .item-total{width:32%;text-align:right;white-space:nowrap;}
          .item-price{font-size:0.85em;color:#444;overflow-wrap:anywhere;word-break:break-word;}
          .total-row{font-size:0.95em;margin:3px 0;}
          .total-row strong{font-weight:800;}
          .grand-total{display:block;text-align:center;font-size:1.15em;font-weight:900;border-top:2px solid #111;border-bottom:2px solid #111;padding:7px 0;margin:7px 0;}
          .grand-total strong{display:block;width:100%;text-align:center!important;white-space:nowrap;overflow-wrap:normal;word-break:normal;}
          .grand-total strong:last-child{margin-top:3px;font-size:1.45em;line-height:1.1;}
          @media print { .no-print{display:none!important;} ${printPage} body{margin:0;} }
        </style>
      </head>
      <body>
        <div class="ticket">
          ${renderHeader(config || {}, documentLabel)}
          ${renderMeta(finalMeta)}
          ${items.length ? `<div style="border-top:1px dashed #333;margin:8px 0 6px;"></div>${renderItems(items)}` : ''}
          <div style="border-top:1px dashed #333;margin:8px 0 6px;"></div>
          <div class="total-row"><span>Subtotal</span><span>${formatCurrency(subtotal)}</span></div>
          ${discount > 0 ? `<div class="total-row"><span>Descuento</span><span>-${formatCurrency(discount)}</span></div>` : ''}
          ${taxes > 0 ? `<div class="total-row"><span>Impuestos</span><span>${formatCurrency(taxes)}</span></div>` : ''}
          ${tip > 0 ? `<div class="total-row"><span>${tipLabel}</span><span>${formatCurrency(tip)}</span></div>` : ''}
          <div class="total-row grand-total"><strong>${totalLabel}</strong><strong>${formatCurrency(total)}</strong></div>
          ${renderPayments(payments)}
          ${notes ? `<div style="border-top:1px dashed #333;margin:8px 0 6px;"></div><div style="font-size:0.88em;">${notes}</div>` : ''}
          ${config?.pie_ticket ? `<div style="border-top:1px dashed #333;margin:8px 0 6px;"></div><div style="text-align:center;font-size:0.86em;">${config.pie_ticket}</div>` : ''}
        </div>
        <script>window.onload = function(){ window.focus(); window.print(); };</script>
      </body>
    </html>
  `;

  const printWindow = window.open('', '', 'width=420,height=760');
  if (!printWindow) {
    throw new Error('No se pudo abrir la ventana de impresion. Revisa el bloqueo de ventanas emergentes.');
  }
  printWindow.document.write(html);
  printWindow.document.close();
}

export async function imprimirInventarioTerraza80mm({
  supabase,
  hotelId,
  productos = [],
  userName = ''
}) {
  if (!Array.isArray(productos) || !productos.length) {
    throw new Error('No hay productos de Terraza para imprimir.');
  }

  const { data: config } = await supabase
    .from('configuracion_hotel')
    .select('logo_url, nombre_hotel, direccion_fiscal, nit_rut, razon_social, tipo_impresora, tamano_papel, encabezado_ticket, encabezado_ticket_l1, encabezado_ticket_l2, encabezado_ticket_l3, pie_ticket, mostrar_logo')
    .eq('hotel_id', hotelId)
    .maybeSingle();

  const printConfig = {
    ...(config || {}),
    tipo_impresora: 'termica',
    tamano_papel: '80mm'
  };
  const { width, css, printPage } = buildPrintStyle(printConfig);
  const fecha = formatDateTime(new Date());
  const resumen = productos.reduce((acc, producto) => {
    const stock = Number(producto.stockActual || 0);
    const reservado = Number(producto.reservado || 0);
    const disponible = Number(producto.disponible || 0);
    const stockMinimo = Number(producto.stockMinimo || 0);
    acc.stock += stock;
    acc.reservado += reservado;
    acc.disponible += disponible;
    if (producto.activo !== false && stock <= stockMinimo) acc.bajos += 1;
    if (producto.activo === false) acc.inactivos += 1;
    return acc;
  }, { stock: 0, reservado: 0, disponible: 0, bajos: 0, inactivos: 0 });

  const rowsHtml = productos.map((producto) => {
    const stock = Number(producto.stockActual || 0);
    const reservado = Number(producto.reservado || 0);
    const disponible = Number(producto.disponible || 0);
    const stockMinimo = Number(producto.stockMinimo || 0);
    const bajo = producto.activo !== false && stock <= stockMinimo;
    const estado = producto.activo === false ? 'Inactivo' : (bajo ? 'Stock bajo' : 'Activo');
    const detalle = [
      producto.categoria || 'Sin categoria',
      producto.codigoBarras ? `Cod: ${producto.codigoBarras}` : 'Sin codigo',
      producto.tiendaProducto ? `Tienda: ${producto.tiendaProducto}` : ''
    ].filter(Boolean).join(' | ');

    return `
      <div class="inventory-row ${bajo ? 'is-low' : ''} ${producto.activo === false ? 'is-inactive' : ''}">
        <div class="inventory-name">
          <strong>${escapeHtml(producto.nombre || 'Producto')}</strong>
          <span>${escapeHtml(detalle)}</span>
          <span>Min: ${escapeHtml(String(stockMinimo))} | ${escapeHtml(estado)}</span>
        </div>
        <div class="inventory-num">${escapeHtml(String(stock))}</div>
        <div class="inventory-num">${escapeHtml(String(reservado))}</div>
        <div class="inventory-num inventory-available">${escapeHtml(String(disponible))}</div>
      </div>
    `;
  }).join('');

  const html = `
    <html>
      <head>
        <title>Inventario Terraza</title>
        <style>
          ${css}
          *{box-sizing:border-box;}
          .ticket{width:${width};max-width:${width};overflow:hidden;}
          .meta-row{display:flex;justify-content:space-between;gap:6px;font-size:0.92em;margin-bottom:2px;max-width:100%;min-width:0;}
          .meta-label,.meta-value{min-width:0;overflow-wrap:anywhere;word-break:break-word;}
          .meta-value{text-align:right;}
          .summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px;margin:7px 0;}
          .summary-box{border:1px solid #111;padding:4px 2px;text-align:center;}
          .summary-box span{display:block;font-size:0.78em;text-transform:uppercase;}
          .summary-box strong{display:block;font-size:1.15em;}
          .inventory-head,.inventory-row{display:grid;grid-template-columns:minmax(0,1fr) 10mm 10mm 12mm;gap:2mm;align-items:start;}
          .inventory-head{border-top:1px dashed #333;border-bottom:1px dashed #333;font-weight:800;padding:4px 0;margin-top:6px;}
          .inventory-row{border-bottom:1px dashed #bbb;padding:5px 0;}
          .inventory-name{min-width:0;overflow-wrap:anywhere;word-break:break-word;line-height:1.22;}
          .inventory-name strong{display:block;font-size:1em;}
          .inventory-name span{display:block;font-size:0.82em;color:#333;}
          .inventory-num{text-align:right;font-weight:800;white-space:nowrap;}
          .inventory-available{font-size:1.05em;}
          .is-low .inventory-available{border-bottom:2px solid #111;}
          .is-inactive{color:#555;}
          @media print { .no-print{display:none!important;} ${printPage} body{margin:0;} }
        </style>
      </head>
      <body>
        <div class="ticket">
          ${renderHeader(printConfig, 'Inventario Terraza')}
          ${renderMeta([
            { label: 'Fecha', value: escapeHtml(fecha) },
            { label: 'Usuario', value: escapeHtml(userName || 'Usuario') },
            { label: 'Formato', value: 'Termica 80mm' }
          ])}
          <div class="summary">
            <div class="summary-box"><span>Productos</span><strong>${escapeHtml(String(productos.length))}</strong></div>
            <div class="summary-box"><span>Stock</span><strong>${escapeHtml(String(resumen.stock))}</strong></div>
            <div class="summary-box"><span>Reservado</span><strong>${escapeHtml(String(resumen.reservado))}</strong></div>
            <div class="summary-box"><span>Disponible</span><strong>${escapeHtml(String(resumen.disponible))}</strong></div>
          </div>
          <div class="meta-row"><span><b>Bajo minimo:</b></span><span>${escapeHtml(String(resumen.bajos))}</span></div>
          ${resumen.inactivos ? `<div class="meta-row"><span><b>Inactivos:</b></span><span>${escapeHtml(String(resumen.inactivos))}</span></div>` : ''}
          <div class="inventory-head">
            <div>Producto</div>
            <div class="inventory-num">Sis</div>
            <div class="inventory-num">Res</div>
            <div class="inventory-num">Disp</div>
          </div>
          ${rowsHtml}
          <div style="margin-top:8px;text-align:center;font-size:0.82em;">Sis: stock sistema | Res: reservado | Disp: disponible</div>
          ${printConfig?.pie_ticket ? `<div style="border-top:1px dashed #333;margin:8px 0 6px;"></div><div style="text-align:center;font-size:0.86em;">${printConfig.pie_ticket}</div>` : ''}
        </div>
        <script>window.onload = function(){ window.focus(); window.print(); };</script>
      </body>
    </html>
  `;

  const printWindow = window.open('', '', 'width=420,height=760');
  if (!printWindow) {
    throw new Error('No se pudo abrir la ventana de impresion. Revisa el bloqueo de ventanas emergentes.');
  }
  printWindow.document.write(html);
  printWindow.document.close();
}
