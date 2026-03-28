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
      width: '55mm',
      css: `
        body{font-family:monospace;font-size:11px;max-width:55mm;margin:0;padding:0;background:#fff;color:#111;}
        .ticket{max-width:55mm;margin:auto;padding:4px 3px;}
        table{width:100%;border-collapse:collapse;font-size:11px;}
        th,td{padding:2px 1px;vertical-align:top;}
      `
    };
  }
  if (paper === '80mm') {
    return {
      width: '78mm',
      css: `
        body{font-family:monospace;font-size:13px;max-width:78mm;margin:0;padding:0;background:#fff;color:#111;}
        .ticket{max-width:78mm;margin:auto;padding:5px 4px;}
        table{width:100%;border-collapse:collapse;font-size:13px;}
        th,td{padding:3px 2px;vertical-align:top;}
      `
    };
  }
  return {
    width: '820px',
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
  if (!meta.length) return '';
  return meta.map((item) => `
    <div style="display:flex;justify-content:space-between;gap:10px;font-size:0.92em;margin-bottom:2px;">
      <span><b>${item.label}:</b></span>
      <span style="text-align:right;">${item.value || ''}</span>
    </div>
  `).join('');
}

function renderItems(items = []) {
  if (!items.length) return '';
  return `
    <table>
      <thead>
        <tr>
          <th style="text-align:left;">Detalle</th>
          <th style="text-align:center;width:44px;">Cant.</th>
          <th style="text-align:right;width:68px;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item) => `
          <tr>
            <td>${item.nombre || ''}${item.precio ? `<div style="font-size:0.85em;color:#444;">${formatCurrency(item.precio)}</div>` : ''}</td>
            <td style="text-align:center;">${item.cantidad || ''}</td>
            <td style="text-align:right;">${formatCurrency(item.total || 0)}</td>
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
      <div style="display:flex;justify-content:space-between;gap:10px;font-size:0.92em;margin-bottom:2px;">
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
  total = 0,
  payments = [],
  notes = ''
}) {
  const { data: config } = await supabase
    .from('configuracion_hotel')
    .select('logo_url, nombre_hotel, direccion_fiscal, nit_rut, razon_social, tipo_impresora, tamano_papel, encabezado_ticket, encabezado_ticket_l1, encabezado_ticket_l2, encabezado_ticket_l3, pie_ticket, mostrar_logo')
    .eq('hotel_id', hotelId)
    .maybeSingle();

  const { width, css } = buildPrintStyle(config);
  const finalMeta = [
    { label: 'Referencia', value: reference || '-' },
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
          .ticket{max-width:${width};}
          .total-row{display:flex;justify-content:space-between;gap:10px;font-size:0.95em;margin:3px 0;}
          .total-row strong{font-weight:800;}
          .grand-total{font-size:1.18em;font-weight:900;}
          @media print { .no-print{display:none!important;} @page{margin:3mm;} }
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
          <div class="total-row grand-total"><strong>Total</strong><strong>${formatCurrency(total)}</strong></div>
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
