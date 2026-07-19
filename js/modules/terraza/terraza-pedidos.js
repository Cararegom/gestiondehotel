async function ensurePedidoAbierto(deps) {
  const {
    state,
    getMesaById,
    getNextReservaForLocation,
    getPedidoSeleccionado,
    isLooseChairGroup
  } = deps;

  if (!state.selectedMesaId) {
    throw new Error('Selecciona una mesa o silla antes de agregar productos.');
  }

  const selectedMesa = getMesaById(state.selectedMesaId);
  if (isLooseChairGroup(selectedMesa) && !state.selectedSillaNumero) {
    throw new Error('Selecciona una silla suelta antes de agregar productos.');
  }

  const existing = getPedidoSeleccionado();
  if (existing) return existing;

  const reserva = getNextReservaForLocation(state.selectedMesaId, state.selectedSillaNumero);
  const payload = {
    hotel_id: state.hotelId,
    mesa_id: state.selectedMesaId,
    silla_numero: state.selectedSillaNumero,
    usuario_id: state.user.id,
    estado: 'abierto',
    reserva_terraza_id: reserva?.estado === 'reservada' ? reserva.id : null
  };

  const { data, error } = await state.supabase
    .from('terraza_pedidos')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    let fallbackQuery = state.supabase
      .from('terraza_pedidos')
      .select('*')
      .eq('hotel_id', state.hotelId)
      .eq('mesa_id', state.selectedMesaId)
      .eq('estado', 'abierto');

    fallbackQuery = state.selectedSillaNumero
      ? fallbackQuery.eq('silla_numero', state.selectedSillaNumero)
      : fallbackQuery.is('silla_numero', null);

    const { data: fallback, error: fallbackError } = await fallbackQuery.maybeSingle();

    if (fallbackError || !fallback) throw error;
    return fallback;
  }

  if (reserva?.estado === 'reservada') {
    const { error: reservaError } = await state.supabase
      .from('terraza_reservas')
      .update({
        estado: 'en_curso',
        pedido_id: data.id,
        saldo_consumido: 0
      })
      .eq('id', reserva.id);
    if (reservaError) throw reservaError;
  }

  return data;
}

export async function addProductToSelectedOrder(productId, deps, options = {}) {
  const {
    state,
    getAvailableStock,
    getItemDisplayName,
    getMicheladaPrice,
    getPedidoItems,
    getSelectedLocationLabel,
    isBeerProduct,
    isMicheladaItem,
    refreshAndRender,
    showFeedback
  } = deps;

  const product = state.productos.find((item) => item.id === productId);
  if (!product) throw new Error('Producto no encontrado.');
  if (product.activo === false) {
    throw new Error('Este producto esta inactivo para ventas.');
  }
  if (Number(product.precio || 0) <= 0) {
    throw new Error('Configura el precio de esta bebida antes de venderla.');
  }
  if (getAvailableStock(product) <= 0) {
    throw new Error(`No hay stock disponible de ${product.nombre}. Revisa inventario o transfiere unidades desde Tienda.`);
  }

  const esMichelada = Boolean(options.esMichelada);
  if (esMichelada && !isBeerProduct(product)) {
    throw new Error('Solo los productos de categoria Cerveza pueden venderse como michelada.');
  }
  if (esMichelada && getMicheladaPrice() <= 0) {
    throw new Error('Configura el precio adicional de la michelada antes de venderla.');
  }

  const precioBase = Number(product.precio || 0);
  const precioMichelada = esMichelada ? getMicheladaPrice() : 0;
  const precioUnitario = precioBase + precioMichelada;
  const pedido = await ensurePedidoAbierto(deps);
  const pedidoCompleto = state.pedidosAbiertos.find((item) => item.id === pedido.id) || pedido;
  const existingItem = getPedidoItems(pedidoCompleto).find((item) => (
    item.producto_id === product.id && isMicheladaItem(item) === esMichelada
  ));

  if (existingItem) {
    const nuevaCantidad = Number(existingItem.cantidad || 0) + 1;
    const { error } = await state.supabase
      .from('terraza_pedido_items')
      .update({
        cantidad: nuevaCantidad,
        subtotal: nuevaCantidad * Number(existingItem.precio_unitario || precioUnitario)
      })
      .eq('id', existingItem.id);
    if (error) throw error;
  } else {
    const { error } = await state.supabase.from('terraza_pedido_items').insert({
      pedido_id: pedido.id,
      hotel_id: state.hotelId,
      producto_id: product.id,
      producto_nombre: product.nombre,
      cantidad: 1,
      precio_base: precioBase,
      precio_michelada: precioMichelada,
      es_michelada: esMichelada,
      precio_unitario: precioUnitario,
      subtotal: precioUnitario
    });
    if (error) throw error;
  }

  await refreshAndRender();
  showFeedback(`${getItemDisplayName({ producto_nombre: product.nombre, es_michelada: esMichelada })} agregado a ${getSelectedLocationLabel()}.`, 'success');
}

export async function updateItemQuantity(itemId, delta, deps) {
  const {
    state,
    getAvailableStock,
    getPedidoItems,
    getPedidoSeleccionado,
    getProductoById,
    refreshAndRender
  } = deps;

  const pedido = getPedidoSeleccionado();
  const item = getPedidoItems(pedido).find((currentItem) => currentItem.id === itemId);
  if (!item) return;

  const nuevaCantidad = Number(item.cantidad || 0) + delta;
  if (nuevaCantidad <= 0) {
    await removeItem(itemId, deps);
    return;
  }

  if (delta > 0 && item.producto_id) {
    const product = getProductoById(item.producto_id);
    if (product?.activo === false) {
      throw new Error('Este producto esta inactivo para ventas.');
    }
    if (product && getAvailableStock(product) <= 0) {
      throw new Error(`No hay mas stock disponible de ${product.nombre}.`);
    }
  }

  const { error } = await state.supabase
    .from('terraza_pedido_items')
    .update({
      cantidad: nuevaCantidad,
      subtotal: nuevaCantidad * Number(item.precio_unitario || 0)
    })
    .eq('id', itemId);
  if (error) throw error;
  await refreshAndRender();
}

export async function setItemQuantity(itemId, quantity, deps) {
  const {
    state,
    getAvailableStock,
    getPedidoItems,
    getPedidoSeleccionado,
    getProductoById,
    refreshAndRender
  } = deps;

  const nuevaCantidad = Number(quantity);
  if (!Number.isInteger(nuevaCantidad) || nuevaCantidad <= 0) {
    throw new Error('La cantidad debe ser un numero entero mayor a cero.');
  }

  const pedido = getPedidoSeleccionado();
  const item = getPedidoItems(pedido).find((currentItem) => currentItem.id === itemId);
  if (!item) throw new Error('No se encontro el producto en la cuenta.');

  if (item.producto_id) {
    const product = getProductoById(item.producto_id);
    if (product?.activo === false && nuevaCantidad > Number(item.cantidad || 0)) {
      throw new Error('Este producto esta inactivo para ventas.');
    }
    const maximoDisponible = Number(item.cantidad || 0) + (product ? getAvailableStock(product) : 0);
    if (product && nuevaCantidad > maximoDisponible) {
      throw new Error(`Solo puedes registrar hasta ${maximoDisponible} unidad(es) de ${product.nombre}.`);
    }
  }

  const { error } = await state.supabase
    .from('terraza_pedido_items')
    .update({
      cantidad: nuevaCantidad,
      subtotal: nuevaCantidad * Number(item.precio_unitario || 0)
    })
    .eq('id', itemId);
  if (error) throw error;
  await refreshAndRender();
}

export async function removeItem(itemId, deps) {
  const { state, refreshAndRender } = deps;
  const { error } = await state.supabase
    .from('terraza_pedido_items')
    .delete()
    .eq('id', itemId);
  if (error) throw error;
  await refreshAndRender();
}

export async function cancelSelectedOrder(deps) {
  const {
    state,
    confirmDialog,
    getPedidoSeleccionado,
    refreshAndRender,
    showFeedback
  } = deps;

  const pedido = getPedidoSeleccionado();
  if (!pedido) return;
  const confirmed = await confirmDialog('Cancelar cuenta', 'La cuenta abierta se marcara como cancelada y no afectara caja.', 'Si, cancelar');
  if (!confirmed) return;

  const { error } = await state.supabase
    .from('terraza_pedidos')
    .update({
      estado: 'cancelado',
      fecha_cierre: new Date().toISOString(),
      fecha_cancelacion: new Date().toISOString(),
      cancelado_por_usuario_id: state.user?.id || null,
      motivo_cancelacion: 'Cancelada antes de cobrar'
    })
    .eq('id', pedido.id);
  if (error) throw error;

  if (pedido.reserva_terraza_id) {
    const { error: reservaError } = await state.supabase
      .from('terraza_reservas')
      .update({
        estado: 'reservada',
        pedido_id: null,
        saldo_consumido: 0
      })
      .eq('id', pedido.reserva_terraza_id)
      .eq('estado', 'en_curso');
    if (reservaError) throw reservaError;
  }

  await refreshAndRender();
  showFeedback('Cuenta cancelada.', 'success');
}
