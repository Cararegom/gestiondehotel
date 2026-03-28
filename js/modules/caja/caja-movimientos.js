import {
  formatCurrency,
  formatDateTime,
  hideGlobalLoading,
  showError,
  showGlobalLoading,
  showSuccess
} from '../../uiUtils.js';
import { escapeAttribute, escapeHtml, normalizeLegacyText } from '../../security.js';
import { confirmAction, seleccionarMetodoPago } from './caja-turnos.js';

export function createInitialMovementTableState() {
  return {
    all: [],
    turnoId: null,
    currentPage: 1,
    pageSize: 15,
    search: '',
    type: 'todos',
    method: 'todos'
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

  if (concept.includes('tienda') || concept.includes('producto')) {
    return { label: 'Tienda', className: 'bg-cyan-100 text-cyan-700' };
  }
  if (concept.includes('restaurante') || concept.includes('cocina')) {
    return { label: 'Restaurante', className: 'bg-orange-100 text-orange-700' };
  }
  if (concept.includes('propina')) {
    return { label: 'Propina', className: 'bg-amber-100 text-amber-700' };
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
  const apertura = Number(allMovements.find((movement) => movement.tipo === 'apertura')?.monto || 0);

  allMovements.forEach((movement) => {
    if (movement.tipo === 'ingreso') ingresos += Number(movement.monto || 0);
    if (movement.tipo === 'egreso') egresos += Number(movement.monto || 0);
  });

  const balanceOperativo = ingresos - egresos;
  const balance = apertura + balanceOperativo;
  if (summaryEls.apertura) summaryEls.apertura.textContent = formatCurrency(apertura);
  if (summaryEls.ingresos) summaryEls.ingresos.textContent = formatCurrency(ingresos);
  if (summaryEls.egresos) summaryEls.egresos.textContent = formatCurrency(egresos);
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
    tBodyEl.innerHTML = '<tr><td colspan="6" class="text-center p-6 text-sm text-gray-500">No hay movimientos que coincidan con los filtros actuales.</td></tr>';
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
                ${isAdminUser ? `<button class="text-red-500 hover:text-red-700 font-medium" title="Eliminar movimiento" data-delete-movimiento="${movementIdAttr}" data-concepto="${conceptAttr}" data-monto="${amountAttr}" data-tipo="${typeAttr}">Eliminar</button>` : ''}
              </div>
            </div>
          </td>
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
      .select('id, nombre')
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

    const { error: updateError } = await supabase
      .from('caja')
      .update({ metodo_pago_id: nuevoMetodoId })
      .eq('id', movimientoId);

    if (updateError) {
      showError(currentContainerEl.querySelector('#turno-global-feedback'), `No se pudo actualizar el metodo de pago: ${updateError.message}`);
      return;
    }

    showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), 'Metodo de pago actualizado.');
    await loadAndRenderMovements({
      tBodyEl,
      summaryEls,
      turnoId,
      movementRefs,
      movementTableState,
      supabase,
      hotelId,
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
    const { error: rpcError } = await supabase.rpc('registrar_y_eliminar_mov_caja', {
      movimiento_id_param: movimientoId,
      eliminado_por_usuario_id_param: currentModuleUser.id
    });
    hideGlobalLoading();

    if (rpcError) {
      showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error al eliminar el movimiento: ${rpcError.message}`);
      return;
    }

    showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), 'Movimiento eliminado y registrado.');
    await loadAndRenderMovements({
      tBodyEl,
      summaryEls,
      turnoId,
      movementRefs,
      movementTableState,
      supabase,
      hotelId,
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
      .select('id,tipo,monto,concepto,creado_en,fecha_movimiento,turno_id,usuario_id,usuarios(nombre),metodo_pago_id,metodos_pago(nombre),reservas(cliente_nombre)')
      .eq('hotel_id', hotelId)
      .eq('turno_id', turnoId);

    if (error) throw error;

    movementTableState.all = sortMovementsByDate(movements || []);
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
