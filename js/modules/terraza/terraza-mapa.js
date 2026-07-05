function renderMesas(deps) {
  const {
    state,
    escapeAttribute,
    escapeHtml,
    formatDate,
    getMesasNormales,
    getNextReservaForLocation,
    getPedidoMesaCompleta,
    getPedidoSilla,
    getReservaAnticipo,
    isLoungeTable,
    money,
    pedidosPorMesa,
    totalPedido
  } = deps;
  const mesasNormales = getMesasNormales();

  if (!mesasNormales.length) {
    return '<div class="rounded-xl border border-slate-200 bg-white p-5 text-center text-slate-500">No hay mesas configuradas.</div>';
  }

  return mesasNormales.map((mesa) => {
    const pedidos = pedidosPorMesa(mesa.id);
    const total = pedidos.reduce((acc, pedido) => acc + totalPedido(pedido), 0);
    const mesaCompleta = getPedidoMesaCompleta(mesa.id);
    const reservaMesa = getNextReservaForLocation(mesa.id, null);
    const isMesaSelected = state.selectedMesaId === mesa.id && !state.selectedSillaNumero;
    const seats = Array.from({ length: Number(mesa.sillas || 2) }, (_, index) => index + 1);
    const asientoNombre = isLoungeTable(mesa) ? 'sillon' : 'silla';
    const asientoNombrePlural = isLoungeTable(mesa) ? 'sillones' : 'sillas';
    const estadoLabel = pedidos.length ? 'Con consumo' : (reservaMesa ? 'Reservada' : 'Libre');
    const estadoClass = pedidos.length
      ? 'bg-amber-100 text-amber-800 border-amber-200'
      : (reservaMesa ? 'bg-purple-100 text-purple-800 border-purple-200' : 'bg-green-100 text-green-700 border-green-200');
    const mesaClass = isMesaSelected
      ? 'border-blue-600 bg-blue-600 text-white shadow-lg'
      : mesaCompleta
        ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
        : reservaMesa
          ? 'border-purple-300 bg-purple-50 text-purple-900 hover:bg-purple-100'
          : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50';

    const renderSilla = (seat) => {
      const pedidoSilla = getPedidoSilla(mesa.id, seat);
      const reservaSilla = getNextReservaForLocation(mesa.id, seat);
      const isSelected = state.selectedMesaId === mesa.id && Number(state.selectedSillaNumero) === seat;
      const hasOrder = Boolean(pedidoSilla);
      const sillaClass = isSelected
        ? 'border-blue-600 bg-blue-600 text-white shadow-md'
        : hasOrder
          ? 'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200'
          : reservaSilla
            ? 'border-purple-300 bg-purple-100 text-purple-900 hover:bg-purple-200'
            : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50';

      return `
        <button
          class="flex h-10 items-center justify-center rounded-lg border text-xs font-extrabold transition ${sillaClass}"
          data-action="select-location"
          data-mesa-id="${escapeAttribute(mesa.id)}"
          data-silla="${seat}"
          title="${asientoNombre === 'sillon' ? 'Sillon' : 'Silla'} ${seat}${hasOrder ? ` - ${money(totalPedido(pedidoSilla))}` : ''}${reservaSilla ? ` - Reservada ${formatDate(reservaSilla.fecha_reserva)}` : ''}"
        >
          ${seat}
        </button>
      `;
    };

    return `
      <article class="rounded-xl border ${state.selectedMesaId === mesa.id ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'} p-4 shadow-sm transition hover:shadow-md">
        <div class="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 class="text-base font-bold text-slate-800">${escapeHtml(mesa.nombre)}</h3>
            <p class="text-xs text-slate-500">${escapeHtml(String(seats.length))} ${asientoNombrePlural} | ${pedidos.length} cuenta(s) abiertas</p>
          </div>
          <span class="rounded-full border px-2.5 py-1 text-xs font-bold ${estadoClass}">${estadoLabel}</span>
        </div>

        <div class="grid grid-cols-[64px_1fr_64px] items-center gap-3">
          <div>${seats[0] ? renderSilla(seats[0]) : ''}</div>
          <button
            class="min-h-[128px] rounded-2xl border-2 p-4 text-center transition ${mesaClass}"
            data-action="select-location"
            data-mesa-id="${escapeAttribute(mesa.id)}"
          >
            <span class="block text-xs font-bold uppercase tracking-wide opacity-75">Mesa completa</span>
            <span class="mt-1 block text-2xl font-black">${escapeHtml(String(mesa.numero || ''))}</span>
            <span class="mt-2 block text-sm font-bold">${mesaCompleta ? money(totalPedido(mesaCompleta)) : (reservaMesa ? `Reserva ${money(getReservaAnticipo(reservaMesa))}` : 'Sin cuenta general')}</span>
          </button>
          <div>${seats[1] ? renderSilla(seats[1]) : ''}</div>
        </div>

        <div class="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
          <span class="text-xs font-semibold text-slate-500">Total pendiente</span>
          <span class="text-base font-extrabold text-blue-700">${money(total)}</span>
        </div>
        ${reservaMesa ? `
          <div class="mt-3 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-900">
            <strong>${escapeHtml(reservaMesa.cliente_nombre || 'Reserva')}</strong> - ${formatDate(reservaMesa.fecha_reserva)} - anticipo ${money(getReservaAnticipo(reservaMesa))}
          </div>
        ` : ''}
      </article>
    `;
  }).join('');
}

function renderSillasSueltas(deps) {
  const {
    state,
    escapeAttribute,
    formatDate,
    getNextReservaForLocation,
    getPedidoSilla,
    getSillasSueltasGroup,
    money,
    pedidosPorMesa,
    totalPedido
  } = deps;
  const grupo = getSillasSueltasGroup();
  if (!grupo) return '';

  const pedidos = pedidosPorMesa(grupo.id);
  const total = pedidos.reduce((acc, pedido) => acc + totalPedido(pedido), 0);
  const seats = Array.from({ length: Number(grupo.sillas || 12) }, (_, index) => index + 1);

  return `
    <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div class="mb-3 flex flex-col justify-between gap-2 md:flex-row md:items-start">
        <div>
          <h3 class="text-base font-bold text-slate-800">Sillas sueltas</h3>
          <p class="text-xs text-slate-500">12 sillas independientes, sin mesa asignada.</p>
        </div>
        <div class="text-left md:text-right">
          <div class="text-xs font-semibold text-slate-500">Total sillas sueltas</div>
          <div class="font-extrabold text-blue-700">${money(total)}</div>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        ${seats.map((seat) => {
          const pedidoSilla = getPedidoSilla(grupo.id, seat);
          const reservaSilla = getNextReservaForLocation(grupo.id, seat);
          const isSelected = state.selectedMesaId === grupo.id && Number(state.selectedSillaNumero) === seat;
          const hasOrder = Boolean(pedidoSilla);
          const sillaClass = isSelected
            ? 'border-blue-600 bg-blue-600 text-white shadow-md'
            : hasOrder
              ? 'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200'
              : reservaSilla
                ? 'border-purple-300 bg-purple-100 text-purple-900 hover:bg-purple-200'
                : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50';

          return `
            <button
              class="min-h-[58px] rounded-lg border px-2 py-2 text-xs font-extrabold transition ${sillaClass}"
              data-action="select-location"
              data-mesa-id="${escapeAttribute(grupo.id)}"
              data-silla="${seat}"
              title="Silla suelta ${seat}${hasOrder ? ` - ${money(totalPedido(pedidoSilla))}` : ''}${reservaSilla ? ` - Reservada ${formatDate(reservaSilla.fecha_reserva)}` : ''}"
            >
              <span class="block text-[10px] font-semibold uppercase opacity-70">Silla</span>
              ${seat}
            </button>
          `;
        }).join('')}
      </div>
    </article>
  `;
}

function renderProductos(deps) {
  const {
    escapeAttribute,
    escapeHtml,
    getAvailableStock,
    getMicheladaPrice,
    getProductosActivos,
    getStockBadge,
    isBeerProduct,
    money
  } = deps;
  const productosActivos = getProductosActivos();

  if (!productosActivos.length) {
    return '<div class="rounded-xl border border-slate-200 bg-white p-5 text-center text-slate-500">No hay bebidas activas para vender.</div>';
  }

  const categorias = [...new Set(productosActivos.map((producto) => producto.categoria || 'Bebidas'))];

  return categorias.map((categoria) => {
    const productos = productosActivos.filter((producto) => (producto.categoria || 'Bebidas') === categoria);
    return `
      <section class="mb-5">
        <h3 class="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">${escapeHtml(categoria)}</h3>
        <div class="grid grid-cols-1 gap-3">
          ${productos.map((producto) => {
            const disponible = getAvailableStock(producto);
            const disabled = disponible <= 0 || Number(producto.precio || 0) <= 0;
            const stockBadge = getStockBadge(producto);
            const beerProduct = isBeerProduct(producto);
            const micheladaPrice = getMicheladaPrice();
            return `
            <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-product-card="${escapeAttribute(producto.id)}">
              <div class="flex min-h-[72px] flex-col justify-between">
                <div>
                  <div class="flex items-start justify-between gap-3">
                    <h4 class="font-bold text-slate-800">${escapeHtml(producto.nombre)}</h4>
                    <span class="rounded-full border px-2 py-0.5 text-[11px] font-bold ${stockBadge.className}">${escapeHtml(stockBadge.label)}</span>
                  </div>
                  <p class="mt-1 text-xs text-slate-500">${escapeHtml(producto.descripcion || '')}</p>
                  ${beerProduct ? `
                    <label class="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                      <input type="checkbox" class="h-4 w-4" data-michelada-option>
                      <span>Vender como michelada</span>
                      <span class="ml-auto text-amber-700">+ ${money(micheladaPrice)}</span>
                    </label>
                  ` : ''}
                </div>
                <div class="mt-3 flex items-center justify-between gap-3">
                  <span class="text-lg font-extrabold text-blue-700">${money(producto.precio)}</span>
                  <div class="flex gap-2">
                    <button class="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50" data-action="edit-product" data-product-id="${escapeAttribute(producto.id)}">Editar</button>
                    <button class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300" data-action="add-product" data-product-id="${escapeAttribute(producto.id)}" ${disabled ? 'disabled' : ''}>Agregar</button>
                  </div>
                </div>
              </div>
            </article>
          `;
          }).join('')}
        </div>
      </section>
    `;
  }).join('');
}

function renderPedido(deps) {
  const {
    state,
    canDownloadPdf,
    escapeAttribute,
    escapeHtml,
    formatDate,
    getItemDisplayName,
    getItemPriceDetail,
    getMetodosPagoActivos,
    getMesaById,
    getPedidoItems,
    getPedidoReservaSaldo,
    getPedidoSaldoAPagar,
    getPedidoSeleccionado,
    getPedidoTipAmount,
    getReservaAnticipo,
    getReservaForPedido,
    getReservaSaldoDisponible,
    getSelectedLocationLabel,
    getSelectedMetodoPago,
    getSuggestedTip,
    getTotalConPropina,
    isLooseChairGroup,
    isMicheladaItem,
    money,
    totalPedido
  } = deps;
  const pedido = getPedidoSeleccionado();
  const items = getPedidoItems(pedido);
  const selectedMesa = getMesaById(state.selectedMesaId);
  const isSillaSuelta = isLooseChairGroup(selectedMesa);
  const disabled = !pedido || !items.length;
  const total = totalPedido(pedido);
  const suggestedTip = getSuggestedTip(total);
  const defaultTipAmount = getPedidoTipAmount(pedido) || suggestedTip;
  const totalConPropina = getTotalConPropina(total, defaultTipAmount);
  const reserva = getReservaForPedido(pedido) || deps.getNextReservaForLocation(state.selectedMesaId, state.selectedSillaNumero);
  const reservaAsociada = pedido && reserva?.pedido_id === pedido.id;
  const saldoReserva = pedido ? Math.min(total, getPedidoReservaSaldo(pedido)) : getReservaSaldoDisponible(reserva);
  const saldoAPagar = pedido ? getPedidoSaldoAPagar(pedido, defaultTipAmount) : 0;
  const allowPdf = canDownloadPdf();
  const selectedMetodo = getSelectedMetodoPago();
  const metodosActivos = getMetodosPagoActivos();

  return `
    <aside class="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="border-b border-slate-200 p-4">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Cuenta seleccionada</p>
        <h3 class="mt-1 text-xl font-extrabold text-slate-800">${escapeHtml(getSelectedLocationLabel())}</h3>
        ${selectedMesa ? `<p class="mt-1 text-xs text-slate-500">${isSillaSuelta ? 'Cuenta independiente para una silla suelta.' : 'Puedes cobrar mesa completa o una silla individual.'}</p>` : ''}
        ${reserva ? `
          <div class="mt-3 rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="font-bold">${escapeHtml(reserva.cliente_nombre || 'Reserva de terraza')}</p>
                <p class="text-xs">${formatDate(reserva.fecha_reserva)}${reserva.cantidad_personas ? ` - ${escapeHtml(String(reserva.cantidad_personas))} persona(s)` : ''}</p>
              </div>
              <span class="rounded-full border border-purple-200 bg-white px-2 py-0.5 text-xs font-bold">${money(getReservaSaldoDisponible(reserva))}</span>
            </div>
            <p class="mt-2 text-xs">Anticipo consumible: ${money(getReservaAnticipo(reserva))}${reservaAsociada ? ' aplicado a esta cuenta.' : '.'}</p>
            ${!reservaAsociada && reserva.estado === 'reservada' ? `<button type="button" class="mt-3 w-full rounded-lg bg-purple-600 px-3 py-2 text-xs font-bold text-white hover:bg-purple-700" data-action="activate-reservation" data-reserva-id="${escapeAttribute(reserva.id)}">Usar reserva en esta cuenta</button>` : ''}
          </div>
        ` : ''}
      </div>
      <div class="max-h-[45vh] overflow-y-auto p-4">
        ${items.length ? `
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs uppercase text-slate-500">
                <th class="pb-2">Producto</th>
                <th class="pb-2 text-center">Cant.</th>
                <th class="pb-2 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${items.map((item) => `
                <tr>
                  <td class="py-3">
                    <div class="font-semibold text-slate-800">
                      ${escapeHtml(getItemDisplayName(item))}
                      ${isMicheladaItem(item) ? '<span class="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">Michelada</span>' : ''}
                    </div>
                    <div class="text-xs text-slate-500">${escapeHtml(getItemPriceDetail(item))}</div>
                  </td>
                  <td class="py-3 text-center">
                    <div class="inline-flex items-center rounded-lg border border-slate-200">
                      <button class="px-2 py-1 text-slate-500 hover:bg-slate-50" data-action="decrease-item" data-item-id="${escapeAttribute(item.id)}">-</button>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value="${escapeAttribute(String(item.cantidad || 1))}"
                        class="w-14 border-x border-slate-200 px-1 py-1 text-center font-bold outline-none focus:bg-blue-50"
                        data-item-quantity
                        data-item-id="${escapeAttribute(item.id)}"
                        aria-label="Cantidad de ${escapeAttribute(getItemDisplayName(item))}"
                      >
                      <button class="px-2 py-1 text-slate-500 hover:bg-slate-50" data-action="increase-item" data-item-id="${escapeAttribute(item.id)}">+</button>
                    </div>
                    <button class="mt-1 block w-full text-xs font-semibold text-red-600 hover:underline" data-action="remove-item" data-item-id="${escapeAttribute(item.id)}">Quitar</button>
                  </td>
                  <td class="py-3 text-right font-bold text-slate-800">${money(item.subtotal)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<div class="rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">Agrega bebidas a esta ubicacion.</div>'}
      </div>
      <div class="border-t border-slate-200 p-4">
        <div class="mb-4 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
          <span class="text-xs font-semibold uppercase tracking-wide text-slate-500">Consumo sin propina</span>
          <span class="text-lg font-bold text-slate-600">${money(total)}</span>
        </div>
        ${pedido && reservaAsociada ? `
          <div class="mb-4 rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900">
            <div class="flex items-center justify-between">
              <span class="font-semibold">Anticipo aplicado</span>
              <span class="font-bold">-${money(saldoReserva)}</span>
            </div>
            <div class="mt-1 flex items-center justify-between text-xs">
              <span>Saldo consumible disponible</span>
              <span>${money(getReservaSaldoDisponible(reserva))}</span>
            </div>
          </div>
        ` : ''}
        ${pedido && reserva && !reservaAsociada ? `
          <div class="mb-4 rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900">
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">Anticipo disponible por aplicar</span>
              <span class="font-bold">${money(getReservaSaldoDisponible(reserva))}</span>
            </div>
            <p class="mt-1 text-xs">Usa el boton de la reserva para descontarlo de esta cuenta.</p>
          </div>
        ` : ''}
        <div class="mb-4 rounded-xl border-2 border-emerald-400 bg-emerald-50 p-4 text-sm shadow-sm">
          <div class="mb-2 flex items-center justify-between text-emerald-800">
            <span class="font-semibold">Propina sugerida</span>
            <span class="font-bold">${money(suggestedTip)}</span>
          </div>
          <label class="mb-1 block text-xs font-semibold uppercase text-emerald-700" for="terraza-propina-monto">Propina que dio el cliente</label>
          <input
            id="terraza-propina-monto"
            type="number"
            min="0"
            step="100"
            class="form-control w-full border-emerald-200 bg-white"
            value="${escapeAttribute(String(defaultTipAmount))}"
            ${disabled ? 'disabled' : ''}
          >
          <p class="mt-1 text-xs text-emerald-700">El mesero puede cambiar este valor por el monto real recibido.</p>
          <div class="mt-3 flex items-center justify-between text-emerald-800">
            <span class="text-xs font-semibold uppercase tracking-wide">Consumo + propina</span>
            <span id="terraza-total-con-propina" class="text-base font-bold">${money(totalConPropina)}</span>
          </div>
          <div class="mt-3 rounded-xl bg-emerald-700 px-4 py-4 text-white shadow-md">
            <span class="block text-xs font-black uppercase tracking-widest text-emerald-100">Total a cobrar con propina</span>
            <span id="terraza-saldo-a-cobrar" class="mt-1 block text-right text-4xl font-black leading-none">${money(saldoAPagar)}</span>
            <span class="mt-2 block text-right text-xs font-semibold text-emerald-100">Este es el valor que debe cobrar el mesero</span>
          </div>
        </div>
        <div class="mb-3 grid ${allowPdf ? 'grid-cols-2' : 'grid-cols-1'} gap-2">
          <button class="button button-outline w-full" data-action="print-order-receipt" ${disabled ? 'disabled' : ''}>Imprimir recibo</button>
          ${allowPdf ? `<button class="button button-neutral w-full" data-action="download-order-pdf" ${disabled ? 'disabled' : ''}>Descargar PDF</button>` : ''}
        </div>
        <div class="mb-3">
          <label class="mb-1 block text-xs font-semibold uppercase text-slate-500">Metodo de pago</label>
          <button
            type="button"
            class="w-full rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${selectedMetodo ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}"
            data-action="choose-payment-method"
            ${disabled || !metodosActivos.length ? 'disabled' : ''}
          >
            ${selectedMetodo ? escapeHtml(selectedMetodo.nombre) : (metodosActivos.length ? 'Seleccionar metodo de pago' : 'No hay metodos activos')}
          </button>
          ${!metodosActivos.length ? '<p class="mt-1 text-xs text-red-600">Activa o crea metodos de pago en Configuracion.</p>' : ''}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button class="button button-danger w-full" data-action="cancel-order" ${disabled ? 'disabled' : ''}>Cancelar</button>
          <button class="button button-success w-full" data-action="pay-order" ${disabled ? 'disabled' : ''}>Cobrar</button>
        </div>
      </div>
    </aside>
  `;
}

export function renderMapaTab(deps) {
  const {
    getMesasNormales,
    getProductosActivos,
    isLoungeTable,
    renderStats
  } = deps;
  const mesasNormales = getMesasNormales();
  const mesasConSillones = mesasNormales.filter(isLoungeTable).length;

  return `
    ${renderStats()}
    <div class="grid grid-cols-1 gap-5 xl:grid-cols-12">
      <div class="space-y-4 xl:col-span-8">
        <div class="flex flex-col justify-between gap-2 md:flex-row md:items-center">
          <div>
            <h2 class="text-lg font-bold text-slate-800">Mapa de mesas y sillas</h2>
            <p class="text-sm text-slate-500">${mesasNormales.length} mesas: ${mesasNormales.length - mesasConSillones} con sillas, ${mesasConSillones} con sillones y 12 sillas sueltas independientes.</p>
          </div>
          <span class="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700">${mesasNormales.length} mesas | 12 sillas sueltas</span>
        </div>
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">${renderMesas(deps)}</div>
        ${renderSillasSueltas(deps)}
      </div>

      <div class="space-y-4 xl:col-span-4">
        ${renderPedido(deps)}
        <section class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 class="text-lg font-bold text-slate-800">Bebidas y tragos</h2>
              <p class="text-xs text-slate-500">${getProductosActivos().length} activos para venta</p>
            </div>
            <button class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50" data-action="switch-tab" data-tab="inventario">Inventario</button>
          </div>
          <div class="max-h-[58vh] overflow-y-auto pr-1">${renderProductos(deps)}</div>
        </section>
      </div>
    </div>
  `;
}
