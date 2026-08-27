import {
  formatCurrency,
  formatDateTime,
  hideGlobalLoading,
  showError,
  showGlobalLoading,
  showSuccess
} from '../../uiUtils.js';
import { escapeAttribute, escapeHtml, normalizeLegacyText } from '../../security.js';
import { confirmAction, seleccionarMetodoPago, solicitarMotivoCambioMetodo } from './caja-turnos.js';
import { buildOperationScope, completeStableOperation, getStableOperationId } from '../../services/fase1OperationService.js';
import { getBankPaymentCashStatuses, getBankPaymentPilotStatus } from '../../services/bankPaymentService.js';

export function createInitialMovementTableState() {
  return {
    all: [],
    turnoId: null,
    currentPage: 1,
    pageSize: 15,
    search: '',
    type: 'todos',
    method: 'todos',
    showBankStatus: false,
    bankFeatureEnabled: false
  };
}

export function resetMovementTableState(movementTableState) {
  Object.assign(movementTableState, createInitialMovementTableState());
}

export function getMovementEffectiveDate(movement) {
  return movement?.fecha_movimiento || movement?.creado_en || null;
}

export function getTimestampValue(dateInput) {
  const timeValue = dateInput ? new Date(dateInput).getTime() : 0;
  return Number.isFinite(timeValue) ? timeValue : 0;
}

export function sortMovementsByDate(movements, ascending = false) {
  return [...(movements || [])].sort((a, b) => {
    const diff = getTimestampValue(getMovementEffectiveDate(a)) - getTimestampValue(getMovementEffectiveDate(b));
    return ascending ? diff : -diff;
  });
}

export function formatMovementDateTime(movement) {
  return formatDateTime(getMovementEffectiveDate(movement));
}

export function getMovementTimeLabel(movement) {
  const formatted = formatMovementDateTime(movement);
  const parts = formatted.split(',');
  return (parts[1] || parts[0] || '').trim().slice(0, 5) || '--:--';
}

export function formatSaleItems(items, relationName) {
  return (items || [])
    .map((item) => {
      const name = item?.[relationName]?.nombre;
      const quantity = Number(item?.cantidad || 0);
      return name && quantity > 0 ? `${quantity} x ${name}` : '';
    })
    .filter(Boolean)
    .join(', ');
}

export function getReadableSaleConcept(movement, storeDetailsBySale, restaurantDetailsBySale) {
  let area = '';
  let detail = '';

  if (movement?.venta_tienda_id) {
    area = 'Tienda';
    detail = storeDetailsBySale.get(movement.venta_tienda_id) || '';
  } else if (movement?.venta_restaurante_id) {
    area = 'Restaurante';
    detail = restaurantDetailsBySale.get(movement.venta_restaurante_id) || '';
  }

  if (!detail) return movement?.concepto || 'Sin concepto';
  const isReversal = movement?.source === 'caja_reversal' || Boolean(movement?.original_movement_id);
  return `${isReversal ? 'Reversión · ' : ''}${area}: ${detail}`;
}

export function getTurnElapsedLabel(fechaApertura) {
  if (!fechaApertura) return 'Sin hora de apertura';
  const elapsedMs = Date.now() - new Date(fechaApertura).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 'Sin hora de apertura';

  const totalMinutes = Math.floor(elapsedMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} min abierto`;
  return `${hours}h ${String(minutes).padStart(2, '0')} min abierto`;
}

export function getMovementOriginMeta(movement) {
  const concept = normalizeLegacyText(movement?.concepto || '').toLowerCase();

  if (concept.includes('propina')) {
    return { label: 'Propina', className: 'bg-amber-100 text-amber-700' };
  }
  if (concept.includes('tienda') || concept.includes('producto')) {
    return { label: 'Tienda', className: 'bg-cyan-100 text-cyan-700' };
  }
  if (concept.includes('terraza')) {
    return { label: 'Terraza', className: 'bg-emerald-100 text-emerald-700' };
  }
  if (concept.includes('restaurante') || concept.includes('cocina')) {
    return { label: 'Restaurante', className: 'bg-orange-100 text-orange-700' };
  }
  if (concept.includes('habitaci') || concept.includes('alquiler') || concept.includes('reserva') || concept.includes('extensi')) {
    return { label: 'Habitaciones', className: 'bg-blue-100 text-blue-700' };
  }
  if (movement?.tipo === 'egreso') {
    return { label: 'Egreso', className: 'bg-rose-100 text-rose-700' };
  }
  if (movement?.tipo === 'apertura') {
    return { label: 'Apertura', className: 'bg-violet-100 text-violet-700' };
  }
  return { label: 'General', className: 'bg-slate-100 text-slate-700' };
}

export function getMovementTypeBadge(movementType) {
  const safeType = escapeHtml(movementType || 'N/A');
  if (movementType === 'ingreso') {
    return `<span class="badge bg-green-100 text-green-800">${safeType}</span>`;
  }
  if (movementType === 'egreso') {
    return `<span class="badge bg-red-100 text-red-800">${safeType}</span>`;
  }
  return `<span class="badge bg-blue-100 text-blue-800">${safeType}</span>`;
}

export function getBankStatusBadge(status) {
  const badges = {
    pending: ['Esperando verificacion', 'bg-amber-100 text-amber-800'],
    verified: ['Confirmado por banco', 'bg-emerald-100 text-emerald-800'],
    review: ['Revision administrativa', 'bg-rose-100 text-rose-800'],
    not_applicable: ['No aplica', 'bg-slate-100 text-slate-600']
  };
  const [label, className] = badges[status] || badges.not_applicable;
  return `<span class="inline-flex rounded-full px-2 py-1 text-xs font-semibold ${className}">${label}</span>`;
}

function updateMovementMethodFilter(selectEl, movements, movementTableState) {
  if (!selectEl) return;

  const currentValue = movementTableState.method;
  const methods = [...new Set(
    (movements || [])
      .map((movement) => movement?.metodos_pago?.nombre)
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'es'));

  selectEl.innerHTML = `
    <option value="todos">Todos los metodos</option>
    ${methods.map((methodName) => `<option value="${escapeAttribute(methodName)}">${escapeHtml(methodName)}</option>`).join('')}
  `;

  if (currentValue !== 'todos' && methods.includes(currentValue)) {
    selectEl.value = currentValue;
  } else {
    selectEl.value = 'todos';
    movementTableState.method = 'todos';
  }
}

export function getFilteredMovements(movementTableState) {
  const searchTerm = movementTableState.search.trim().toLowerCase();
  return movementTableState.all.filter((movement) => {
    const concept = normalizeLegacyText(movement?.concepto || '').toLowerCase();
    const clientName = String(movement?.reservas?.cliente_nombre || '').toLowerCase();
    const userName = String(movement?.usuarios?.nombre || '').toLowerCase();
    const methodName = String(movement?.metodos_pago?.nombre || '').toLowerCase();

    const matchesSearch = !searchTerm || [concept, clientName, userName, methodName].some((value) => value.includes(searchTerm));
    const matchesType = movementTableState.type === 'todos' || movement?.tipo === movementTableState.type;
    const matchesMethod = movementTableState.method === 'todos' || movement?.metodos_pago?.nombre === movementTableState.method;

    return matchesSearch && matchesType && matchesMethod;
  });
}

export function renderMovementRows({
  tBodyEl,
  summaryEls,
  movementRefs = {},
  movementTableState,
  isAdminUser
}) {
  const allMovements = movementTableState.all || [];
  const filteredMovements = getFilteredMovements(movementTableState);

  let ingresos = 0;
  let egresos = 0;
  let propinas = 0;
  const apertura = Number(allMovements.find((movement) => movement.tipo === 'apertura')?.monto || 0);

  allMovements.forEach((movement) => {
    if (movement.tipo === 'ingreso') ingresos += Number(movement.monto || 0);
    if (movement.tipo === 'egreso') egresos += Number(movement.monto || 0);
    if (
      movement.tipo === 'ingreso' &&
      normalizeLegacyText(movement.concepto || '').toLowerCase().includes('propina')
    ) {
      propinas += Number(movement.monto || 0);
    }
  });

  const balanceOperativo = ingresos - egresos;
  const balance = apertura + balanceOperativo;
  if (summaryEls.apertura) summaryEls.apertura.textContent = formatCurrency(apertura);
  if (summaryEls.ingresos) summaryEls.ingresos.textContent = formatCurrency(ingresos);
  if (summaryEls.egresos) summaryEls.egresos.textContent = formatCurrency(egresos);
  if (summaryEls.propinas) summaryEls.propinas.textContent = formatCurrency(propinas);
  if (summaryEls.operativo) {
    summaryEls.operativo.textContent = formatCurrency(balanceOperativo);
    summaryEls.operativo.className = `block text-2xl font-bold mt-3 leading-tight ${balanceOperativo < 0 ? 'text-red-600' : 'text-sky-600'}`;
  }
  if (summaryEls.balance) {
    summaryEls.balance.textContent = formatCurrency(balance);
    summaryEls.balance.className = `block text-2xl font-bold mt-3 leading-tight ${balance < 0 ? 'text-red-600' : 'text-emerald-600'}`;
  }

  const totalPages = Math.max(1, Math.ceil(filteredMovements.length / movementTableState.pageSize));
  if (movementTableState.currentPage > totalPages) {
    movementTableState.currentPage = totalPages;
  }

  const startIndex = (movementTableState.currentPage - 1) * movementTableState.pageSize;
  const pageMovements = filteredMovements.slice(startIndex, startIndex + movementTableState.pageSize);

  if (!filteredMovements.length) {
    tBodyEl.innerHTML = `<tr><td colspan="${movementTableState.showBankStatus ? 7 : 6}" class="text-center p-6 text-sm text-gray-500">No hay movimientos que coincidan con los filtros actuales.</td></tr>`;
  } else {
    tBodyEl.innerHTML = pageMovements.map((movement) => {
      const normalizedConcept = normalizeLegacyText(movement.concepto || 'Sin concepto');
      const safeConcept = escapeHtml(normalizedConcept);
      const safeClientName = escapeHtml(movement.reservas?.cliente_nombre || '');
      const safeUserName = escapeHtml(movement.usuarios?.nombre || 'Sistema');
      const safeMethodName = escapeHtml(movement.metodos_pago?.nombre || 'N/A');
      const movementIdAttr = escapeAttribute(movement.id || '');
      const conceptAttr = escapeAttribute(normalizedConcept || 'N/A');
      const amountAttr = escapeAttribute(formatCurrency(movement.monto));
      const typeAttr = escapeAttribute(movement.tipo || '');
      const currentMethodAttr = escapeAttribute(movement.metodo_pago_id || '');
      const originMeta = getMovementOriginMeta(movement);
      const isReversal = movement.source === 'caja_reversal' || Boolean(movement.original_movement_id);
      const isReverted = Boolean(movement.reverted);
      const movementDate = formatMovementDateTime(movement);
      const isIncome = movement.tipo === 'ingreso';
      const amountClass = movement.tipo === 'egreso' ? 'text-red-600' : (isIncome ? 'text-green-600' : 'text-blue-600');

      return `
        <tr class="hover:bg-slate-50 transition-colors">
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
            <div>${movementDate}</div>
            <div class="text-xs text-gray-400">${getMovementTimeLabel(movement)}</div>
          </td>
          <td class="px-4 py-3 whitespace-nowrap text-sm">
            <div>${getMovementTypeBadge(movement.tipo)}</div>
            <div class="mt-1"><span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${originMeta.className}">${escapeHtml(originMeta.label)}</span></div>
          </td>
          <td class="px-4 py-3 whitespace-nowrap text-sm font-semibold ${amountClass}">${formatCurrency(Number(movement.monto || 0))}</td>
          <td class="px-4 py-3 whitespace-normal text-sm text-gray-700">
            <div class="font-medium text-slate-700">${safeConcept}</div>
            ${movement.reservas?.cliente_nombre && !normalizedConcept.includes('Cliente:')
              ? `<div class="text-xs text-gray-500 mt-1">Cliente: ${safeClientName}</div>`
              : ''
            }
          </td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${safeUserName}</td>
          <td class="px-4 py-3 text-sm text-gray-500">
            <div class="flex items-center justify-between gap-3">
              <span class="truncate">${safeMethodName}</span>
              <div class="flex-shrink-0 flex items-center gap-3">
                <button class="text-blue-600 hover:text-blue-800 font-medium" title="Editar metodo de pago" data-edit-metodo="${movementIdAttr}" data-metodo-actual="${currentMethodAttr}">Editar</button>
                ${isReverted ? '<span class="text-xs font-semibold text-amber-700">Revertido</span>' : ''}
                ${isAdminUser && !isReversal && !isReverted ? `<button class="text-red-500 hover:text-red-700 font-medium" title="Revertir movimiento" data-delete-movimiento="${movementIdAttr}" data-concepto="${conceptAttr}" data-monto="${amountAttr}" data-tipo="${typeAttr}">Revertir</button>` : ''}
              </div>
            </div>
          </td>
          ${movementTableState.showBankStatus ? `<td class="px-4 py-3 text-sm">${getBankStatusBadge(movement.bank_status)}</td>` : ''}
        </tr>
      `;
    }).join('');
  }

  if (movementRefs.resultsEl) {
    movementRefs.resultsEl.textContent = `Mostrando ${pageMovements.length} de ${filteredMovements.length} movimientos`;
  }
  if (movementRefs.pageInfoEl) {
    movementRefs.pageInfoEl.textContent = `Pagina ${movementTableState.currentPage} de ${totalPages}`;
  }
  if (movementRefs.prevBtn) {
    movementRefs.prevBtn.disabled = movementTableState.currentPage <= 1;
  }
  if (movementRefs.nextBtn) {
    movementRefs.nextBtn.disabled = movementTableState.currentPage >= totalPages;
  }
  if (movementRefs.countEl) {
    movementRefs.countEl.textContent = String(allMovements.length);
  }
}

export async function handleMovementTableClick({
  event,
  tBodyEl,
  summaryEls,
  turnoId,
  movementRefs = {},
  movementTableState,
  isAdminUser,
  supabase,
  hotelId,
  hotelName = '',
  currentModuleUser,
  currentContainerEl
}) {
  const editButton = event.target.closest('button[data-edit-metodo]');
  if (editButton) {
    const movimientoId = editButton.getAttribute('data-edit-metodo');
    const metodoActualId = editButton.getAttribute('data-metodo-actual') || '';

    showGlobalLoading('Cargando metodos de pago...');
    const { data: metodos, error: errMetodos } = await supabase
      .from('metodos_pago')
      .select('id, nombre, financial_accounts(account_type)')
      .eq('hotel_id', hotelId)
      .eq('activo', true)
      .order('nombre');
    hideGlobalLoading();

    if (errMetodos || !metodos?.length) {
      showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No se pudieron cargar los metodos de pago.');
      return;
    }

    const nuevoMetodoId = await seleccionarMetodoPago(metodos, metodoActualId);
    if (!nuevoMetodoId || nuevoMetodoId === metodoActualId) return;

    const metodoAnterior = metodos.find((metodo) => metodo.id === metodoActualId);
    const metodoNuevo = metodos.find((metodo) => metodo.id === nuevoMetodoId);
    const esEfectivoABanco = movementTableState.bankFeatureEnabled
      && metodoAnterior?.financial_accounts?.account_type === 'cash'
      && metodoNuevo?.financial_accounts?.account_type === 'bank';
    const motivo = esEfectivoABanco ? await solicitarMotivoCambioMetodo() : null;
    if (esEfectivoABanco && !motivo) return;

    const { data: updateResult, error: updateError } = await supabase
      .rpc('actualizar_metodo_pago_caja', {
        p_movimiento_id: movimientoId,
        p_metodo_pago_id: nuevoMetodoId,
        p_motivo: motivo
      });

    if (updateError) {
      showError(currentContainerEl.querySelector('#turno-global-feedback'), `No se pudo actualizar el metodo de pago: ${updateError.message}`);
      return;
    }

    if (updateResult?.ledger_sincronizado !== true) {
      showError(currentContainerEl.querySelector('#turno-global-feedback'), 'El metodo cambio, pero no se pudo verificar la cuenta financiera asociada.');
      return;
    }

    showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), 'Metodo de pago y cuenta financiera actualizados.');
    await loadAndRenderMovements({
      tBodyEl,
      summaryEls,
      turnoId,
      movementRefs,
      movementTableState,
      supabase,
      hotelId,
      hotelName,
      currentContainerEl,
      isAdminUser
    });
    return;
  }

  const deleteButton = event.target.closest('button[data-delete-movimiento]');
  if (deleteButton && isAdminUser) {
    const movimientoId = deleteButton.dataset.deleteMovimiento;
    const concepto = deleteButton.dataset.concepto;
    const monto = deleteButton.dataset.monto;
    const tipo = deleteButton.dataset.tipo;

    let warningMessage = `<p>Realmente deseas eliminar este movimiento de caja?</p><div class="my-3 p-2 bg-gray-100 border border-gray-300 rounded text-left"><strong>Concepto:</strong> ${escapeHtml(concepto || 'N/A')}<br><strong>Monto:</strong> ${escapeHtml(monto || 'N/A')}</div><p class="font-bold text-red-600">Esta accion es irreversible.</p>`;
    if (tipo === 'apertura') {
      warningMessage = `<p class="font-bold text-lg text-red-700">Advertencia maxima</p><p>Estas a punto de eliminar el movimiento de <strong>apertura de turno</strong>.</p><div class="my-3 p-2 bg-red-100 border border-red-400 rounded text-left"><strong>Monto:</strong> ${escapeHtml(monto || 'N/A')}</div><p>Eliminar esto afectara todos los calculos del turno.</p>`;
    }

    const confirmed = await confirmAction({
      title: 'Confirmar eliminacion',
      text: warningMessage,
      confirmButtonText: 'Si, eliminar'
    });

    if (!confirmed) return;

    showGlobalLoading('Eliminando movimiento...');
    const reason = `Reversion administrativa: ${concepto || 'movimiento de caja'}`;
    const operationScope = buildOperationScope('caja-reversion', { movimientoId, reason });
    const { data: reversalResult, error: rpcError } = await supabase.rpc('revertir_movimiento_caja', {
      p_original_movement_id: movimientoId,
      p_reason: reason,
      p_client_operation_id: getStableOperationId(operationScope),
      p_approved_by: currentModuleUser.id
    });
    if (!rpcError) completeStableOperation(operationScope);
    hideGlobalLoading();

    if (rpcError) {
      showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error al eliminar el movimiento: ${rpcError.message}`);
      return;
    }

    showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), reversalResult?.already_reverted
      ? 'El movimiento ya estaba revertido; no se creó otra reversión.'
      : 'Movimiento revertido y registrado.');
    await loadAndRenderMovements({
      tBodyEl,
      summaryEls,
      turnoId,
      movementRefs,
      movementTableState,
      supabase,
      hotelId,
      hotelName,
      currentContainerEl,
      isAdminUser
    });
  }
}

export async function loadAndRenderMovements({
  tBodyEl,
  summaryEls,
  turnoId,
  movementRefs = {},
  movementTableState,
  supabase,
  hotelId,
  hotelName = '',
  currentContainerEl,
  isAdminUser
}) {
  if (!turnoId) {
    tBodyEl.innerHTML = '<tr><td colspan="6" class="text-center p-4 text-red-500">Error: no se ha especificado un turno para cargar.</td></tr>';
    return;
  }

  if (movementTableState.turnoId !== turnoId) {
    resetMovementTableState(movementTableState);
    movementTableState.turnoId = turnoId;
    if (movementRefs.searchInputEl) movementRefs.searchInputEl.value = '';
    if (movementRefs.typeFilterEl) movementRefs.typeFilterEl.value = 'todos';
    if (movementRefs.methodFilterEl) movementRefs.methodFilterEl.value = 'todos';
  }

  tBodyEl.innerHTML = '<tr><td colspan="6" class="text-center p-4">Cargando movimientos del turno...</td></tr>';
  try {
    const { data: movements, error } = await supabase
      .from('caja')
      .select('id,tipo,monto,concepto,creado_en,fecha_movimiento,turno_id,usuario_id,source,original_movement_id,venta_tienda_id,venta_restaurante_id,usuarios(nombre),metodo_pago_id,metodos_pago(nombre),reservas(cliente_nombre)')
      .eq('hotel_id', hotelId)
      .eq('turno_id', turnoId);

    if (error) throw error;

    const movementIds = (movements || []).map((movement) => movement.id);
    let showBankStatus = false;
    try {
      const pilotStatus = await getBankPaymentPilotStatus(supabase, hotelId);
      showBankStatus = pilotStatus.eligible === true && pilotStatus.canViewOperationalStatus === true;
    } catch (statusError) {
      console.warn('Caja: no se pudo validar la funcion bancaria; se oculta de forma segura.', statusError);
    }
    movementTableState.showBankStatus = showBankStatus;
    movementTableState.bankFeatureEnabled = showBankStatus;
    if (movementRefs.bankStatusHeaderEl) movementRefs.bankStatusHeaderEl.classList.toggle('hidden', !showBankStatus);
    const storeSaleIds = [...new Set((movements || []).map((movement) => movement.venta_tienda_id).filter(Boolean))];
    const restaurantSaleIds = [...new Set((movements || []).map((movement) => movement.venta_restaurante_id).filter(Boolean))];
    const [storeResult, restaurantResult] = await Promise.all([
      storeSaleIds.length
        ? supabase
          .from('detalle_ventas_tienda')
          .select('venta_id,cantidad,producto:productos_tienda!detalle_ventas_tienda_producto_id_fkey(nombre)')
          .in('venta_id', storeSaleIds)
        : Promise.resolve({ data: [], error: null }),
      restaurantSaleIds.length
        ? supabase
          .from('ventas_restaurante_items')
          .select('venta_id,cantidad,plato:platos!ventas_restaurante_items_plato_id_fkey(nombre)')
          .in('venta_id', restaurantSaleIds)
        : Promise.resolve({ data: [], error: null })
    ]);
    if (storeResult.error) throw storeResult.error;
    if (restaurantResult.error) throw restaurantResult.error;

    const storeDetailsBySale = new Map();
    const restaurantDetailsBySale = new Map();
    storeSaleIds.forEach((saleId) => {
      storeDetailsBySale.set(saleId, formatSaleItems(
        (storeResult.data || []).filter((item) => item.venta_id === saleId),
        'producto'
      ));
    });
    restaurantSaleIds.forEach((saleId) => {
      restaurantDetailsBySale.set(saleId, formatSaleItems(
        (restaurantResult.data || []).filter((item) => item.venta_id === saleId),
        'plato'
      ));
    });
    let revertedIds = new Set();
    if (movementIds.length) {
      const { data: reversals, error: reversalsError } = await supabase
        .from('caja_reversiones')
        .select('original_movement_id')
        .in('original_movement_id', movementIds);
      if (reversalsError) throw reversalsError;
      revertedIds = new Set((reversals || []).map((item) => item.original_movement_id));
    }
    const bankStatuses = showBankStatus
      ? await getBankPaymentCashStatuses(supabase, hotelId, movementIds)
      : {};
    movementTableState.all = sortMovementsByDate((movements || []).map((movement) => ({
      ...movement,
      concepto_original: movement.concepto,
      concepto: getReadableSaleConcept(movement, storeDetailsBySale, restaurantDetailsBySale),
      reverted: revertedIds.has(movement.id),
      bank_status: bankStatuses[movement.id] || 'not_applicable'
    })));
    updateMovementMethodFilter(movementRefs.methodFilterEl, movementTableState.all, movementTableState);
    renderMovementRows({
      tBodyEl,
      summaryEls,
      movementRefs,
      movementTableState,
      isAdminUser
    });
  } catch (err) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error cargando movimientos: ${err.message}`);
    console.error('Error en loadAndRenderMovements:', err);
  }
}
