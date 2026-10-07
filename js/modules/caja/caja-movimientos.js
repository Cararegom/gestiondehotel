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
import { reportHandledError } from '../../services/handledErrorReporter.js';
import { readQueryWithNetworkRetry } from '../../services/readQueryService.js';
import {
  getRuntimeHotelTimeZone,
  parseDateTimeInTimeZone,
  toDateTimeLocalValueInTimeZone
} from '../../services/hotelTimeZoneService.js';

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

export function getMovementOriginKey(movement = {}) {
  const movementType = String(movement?.tipo || '').toLowerCase();
  const source = String(movement?.source || '').toLowerCase();

  if (movementType === 'apertura') return 'apertura';
  if (movementType === 'egreso') return 'egreso';
  if (movementType !== 'ingreso') return 'general';

  if (source === 'terrace_tip' || source === 'terrace_tip_mixed') return 'propinas';
  if (movement?.venta_tienda_id || source === 'store_atomic' || source === 'store_web_order') return 'tienda';
  if (movement?.venta_restaurante_id || source === 'restaurant_atomic') return 'cocina';
  if (movement?.venta_terraza_id || source === 'terrace_sale' || source === 'terrace_sale_mixed') return 'terraza';
  if (movement?.pago_reserva_id || movement?.reserva_id || source === 'reservation_payment') return 'habitaciones';

  return 'otros';
}

export function getMovementOriginMeta(movement) {
  const origins = {
    propinas: { label: 'Propina', className: 'bg-amber-100 text-amber-700' },
    tienda: { label: 'Tienda', className: 'bg-cyan-100 text-cyan-700' },
    terraza: { label: 'Terraza', className: 'bg-emerald-100 text-emerald-700' },
    cocina: { label: 'Restaurante', className: 'bg-orange-100 text-orange-700' },
    habitaciones: { label: 'Habitaciones', className: 'bg-blue-100 text-blue-700' },
    egreso: { label: 'Egreso', className: 'bg-rose-100 text-rose-700' },
    apertura: { label: 'Apertura', className: 'bg-violet-100 text-violet-700' },
    otros: { label: 'Otros ingresos', className: 'bg-slate-100 text-slate-700' },
    general: { label: 'General', className: 'bg-slate-100 text-slate-700' }
  };

  return origins[getMovementOriginKey(movement)] || origins.general;
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

const LINKED_MOVEMENT_FIELDS = [
  'reserva_id',
  'pago_reserva_id',
  'venta_tienda_id',
  'venta_restaurante_id',
  'venta_terraza_id',
  'reserva_terraza_id',
  'compra_tienda_id'
];

// El backend tambien bloquea anticipos, gastos y conciliaciones bancarias.
export function isMovementLinkedToOtherModule(movement = {}) {
  return LINKED_MOVEMENT_FIELDS.some((field) => Boolean(movement?.[field]));
}

export function canAdminEditMovement(movement = {}, isAdminUser = false) {
  const isReversal = movement?.source === 'caja_reversal' || Boolean(movement?.original_movement_id);
  return Boolean(isAdminUser)
    && !isReversal
    && !movement?.reverted
    && ['ingreso', 'egreso', 'apertura'].includes(movement?.tipo);
}

export async function solicitarEdicionMovimientoAdmin({ movement, metodos, timeZone = getRuntimeHotelTimeZone() }) {
  if (typeof Swal === 'undefined') {
    throw new Error('El editor de movimientos no esta disponible en este navegador.');
  }

  const isApertura = movement.tipo === 'apertura';
  const linked = isMovementLinkedToOtherModule(movement);
  const fechaLocal = toDateTimeLocalValueInTimeZone(getMovementEffectiveDate(movement) || new Date(), timeZone);
  const metodoOptions = (metodos || []).map((metodo) => `
    <option value="${escapeAttribute(metodo.id)}" ${metodo.id === movement.metodo_pago_id ? 'selected' : ''}>
      ${escapeHtml(metodo.nombre || 'Sin nombre')}${metodo.activo === false ? ' (inactivo)' : ''}
    </option>`).join('');
  const tipoField = isApertura
    ? '<input id="edit-mov-tipo" type="hidden" value="apertura"><p class="text-sm text-slate-600">Tipo: <strong>Apertura</strong></p>'
    : `<select id="edit-mov-tipo" class="swal2-select" style="width:100%;margin:0" ${linked ? 'disabled' : ''}>
        <option value="ingreso" ${movement.tipo === 'ingreso' ? 'selected' : ''}>Ingreso</option>
        <option value="egreso" ${movement.tipo === 'egreso' ? 'selected' : ''}>Egreso</option>
      </select>`;

  const result = await Swal.fire({
    title: 'Editar movimiento',
    width: 560,
    html: `
      <div style="display:grid;gap:12px;text-align:left">
        ${linked ? '<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-sm p-2">Este movimiento esta ligado a una reserva o venta: el monto y el tipo se corrigen desde ese modulo.</p>' : ''}
        <label class="text-sm font-semibold">Tipo ${tipoField}</label>
        <label class="text-sm font-semibold">Monto
          <input id="edit-mov-monto" type="number" min="1" step="any" class="swal2-input" style="width:100%;margin:0" value="${escapeAttribute(String(Number(movement.monto) || ''))}" ${linked ? 'disabled' : ''}>
        </label>
        <label class="text-sm font-semibold">Concepto
          <textarea id="edit-mov-concepto" maxlength="500" class="swal2-textarea" style="width:100%;margin:0">${escapeHtml(movement.concepto_original ?? movement.concepto ?? '')}</textarea>
        </label>
        <label class="text-sm font-semibold">Metodo de pago
          <select id="edit-mov-metodo" class="swal2-select" style="width:100%;margin:0">${metodoOptions}</select>
        </label>
        <label class="text-sm font-semibold">Fecha y hora
          <input id="edit-mov-fecha" type="datetime-local" class="swal2-input" style="width:100%;margin:0" value="${escapeAttribute(fechaLocal)}">
        </label>
        <label class="text-sm font-semibold">Motivo de la correccion
          <textarea id="edit-mov-motivo" maxlength="500" class="swal2-textarea" style="width:100%;margin:0" placeholder="Obligatorio. Queda en la auditoria."></textarea>
        </label>
      </div>`,
    showCancelButton: true,
    confirmButtonText: 'Guardar cambios',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#2563eb',
    focusConfirm: false,
    preConfirm: () => {
      const popup = Swal.getPopup();
      const value = (selector) => popup.querySelector(selector)?.value ?? '';
      const monto = Number(value('#edit-mov-monto'));
      const concepto = String(value('#edit-mov-concepto')).trim();
      const motivo = String(value('#edit-mov-motivo')).trim();
      const metodoPagoId = value('#edit-mov-metodo');
      if (!Number.isFinite(monto) || monto <= 0) return Swal.showValidationMessage('El monto debe ser mayor que cero.');
      if (!concepto) return Swal.showValidationMessage('El concepto es obligatorio.');
      if (!metodoPagoId) return Swal.showValidationMessage('Selecciona un metodo de pago.');
      if (!motivo) return Swal.showValidationMessage('El motivo de la correccion es obligatorio.');
      const fechaInput = value('#edit-mov-fecha');
      let fechaMovimiento = getMovementEffectiveDate(movement);
      // datetime-local recorta segundos: si no se toco, se conserva la fecha exacta.
      if (fechaInput !== fechaLocal || !fechaMovimiento) {
        try {
          fechaMovimiento = parseDateTimeInTimeZone(fechaInput, timeZone).toISOString();
        } catch (error) {
          return Swal.showValidationMessage(error.message || 'Fecha y hora invalidas.');
        }
      }
      return {
        tipo: value('#edit-mov-tipo') || movement.tipo,
        monto,
        concepto,
        metodoPagoId,
        fechaMovimiento,
        motivo
      };
    }
  });

  return result.isConfirmed ? result.value : null;
}

export function getBankStatusBadge(status) {
  const badges = {
    pending: ['Esperando verificacion', 'bg-amber-100 text-amber-800'],
    verified: ['Confirmado por banco', 'bg-emerald-100 text-emerald-800'],
    review: ['Revision administrativa', 'bg-rose-100 text-rose-800'],
    not_applicable: ['No aplica', 'bg-slate-100 text-slate-600'],
    unavailable: ['Verificación no disponible', 'bg-slate-100 text-slate-600']
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
    if (getMovementOriginKey(movement) === 'propinas') {
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
      const editButton = canAdminEditMovement(movement, isAdminUser)
        ? `<button class="text-blue-600 hover:text-blue-800 font-medium" title="Editar movimiento" data-edit-movimiento-admin="${movementIdAttr}" data-edit-metodo="${movementIdAttr}" data-metodo-actual="${currentMethodAttr}">Editar</button>`
        : `<button class="text-blue-600 hover:text-blue-800 font-medium" title="Editar metodo de pago" data-edit-metodo="${movementIdAttr}" data-metodo-actual="${currentMethodAttr}">Editar</button>`;

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
              <div class="shrink-0 flex items-center gap-3">
                ${editButton}
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
  const adminEditButton = event.target.closest('button[data-edit-movimiento-admin]');
  if (adminEditButton && isAdminUser) {
    const movimientoId = adminEditButton.getAttribute('data-edit-movimiento-admin');
    const movement = movementTableState.all.find((item) => item.id === movimientoId);
    const feedbackEl = currentContainerEl.querySelector('#turno-global-feedback');
    if (!movement) {
      showError(feedbackEl, 'No se encontro el movimiento. Recarga la vista e intenta de nuevo.');
      return;
    }

    showGlobalLoading('Cargando metodos de pago...');
    const { data: metodos, error: errMetodos } = await supabase
      .from('metodos_pago')
      .select('id, nombre, activo')
      .eq('hotel_id', hotelId)
      .order('nombre');
    hideGlobalLoading();
    if (errMetodos) {
      showError(feedbackEl, 'No se pudieron cargar los metodos de pago.');
      return;
    }
    const metodosEditables = (metodos || []).filter((metodo) => metodo.activo !== false || metodo.id === movement.metodo_pago_id);

    let cambios;
    try {
      cambios = await solicitarEdicionMovimientoAdmin({ movement, metodos: metodosEditables });
    } catch (modalError) {
      showError(feedbackEl, modalError.message);
      return;
    }
    if (!cambios) return;

    showGlobalLoading('Guardando movimiento...');
    const { data: editResult, error: editError } = await supabase.rpc('editar_movimiento_caja_admin', {
      p_movimiento_id: movimientoId,
      p_tipo: cambios.tipo,
      p_monto: cambios.monto,
      p_concepto: cambios.concepto,
      p_metodo_pago_id: cambios.metodoPagoId,
      p_fecha_movimiento: cambios.fechaMovimiento,
      p_motivo: cambios.motivo
    });
    hideGlobalLoading();

    if (editError) {
      showError(feedbackEl, `No se pudo editar el movimiento: ${editError.message}`);
      return;
    }
    if (editResult?.ledger_sincronizado !== true) {
      showError(feedbackEl, 'El movimiento cambio, pero no se pudo verificar la cuenta financiera asociada.');
      return;
    }

    showSuccess(feedbackEl, editResult?.sin_cambios ? 'No habia cambios para guardar.' : 'Movimiento actualizado y auditado.');
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

    let warningMessage = `<p>Realmente deseas eliminar este movimiento de caja?</p><div class="my-3 p-2 bg-gray-100 border border-gray-300 rounded-sm text-left"><strong>Concepto:</strong> ${escapeHtml(concepto || 'N/A')}<br><strong>Monto:</strong> ${escapeHtml(monto || 'N/A')}</div><p class="font-bold text-red-600">Esta accion es irreversible.</p>`;
    if (tipo === 'apertura') {
      warningMessage = `<p class="font-bold text-lg text-red-700">Advertencia maxima</p><p>Estas a punto de eliminar el movimiento de <strong>apertura de turno</strong>.</p><div class="my-3 p-2 bg-red-100 border border-red-400 rounded-sm text-left"><strong>Monto:</strong> ${escapeHtml(monto || 'N/A')}</div><p>Eliminar esto afectara todos los calculos del turno.</p>`;
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
    const { data: movements, error } = await readQueryWithNetworkRetry(() => supabase
      .from('caja')
      .select('id,tipo,monto,concepto,creado_en,fecha_movimiento,turno_id,usuario_id,source,original_movement_id,reserva_id,pago_reserva_id,venta_tienda_id,venta_restaurante_id,venta_terraza_id,reserva_terraza_id,compra_tienda_id,usuarios(nombre),metodo_pago_id,metodos_pago(nombre),reservas(cliente_nombre)')
      .eq('hotel_id', hotelId)
      .eq('turno_id', turnoId));

    if (error) throw error;

    const movementIds = (movements || []).map((movement) => movement.id);
    let showBankStatus = false;
    try {
      const pilotStatus = await getBankPaymentPilotStatus(supabase, hotelId);
      showBankStatus = pilotStatus.eligible === true && pilotStatus.canViewOperationalStatus === true;
    } catch (statusError) {
      reportHandledError('caja', 'bank_feature_status_failed', statusError);
    }
    movementTableState.showBankStatus = showBankStatus;
    movementTableState.bankFeatureEnabled = showBankStatus;
    if (movementRefs.bankStatusHeaderEl) movementRefs.bankStatusHeaderEl.classList.toggle('hidden', !showBankStatus);
    const storeSaleIds = [...new Set((movements || []).map((movement) => movement.venta_tienda_id).filter(Boolean))];
    const restaurantSaleIds = [...new Set((movements || []).map((movement) => movement.venta_restaurante_id).filter(Boolean))];
    const [storeResult, restaurantResult] = await Promise.all([
      storeSaleIds.length
        ? readQueryWithNetworkRetry(() => supabase
          .from('detalle_ventas_tienda')
          .select('venta_id,cantidad,producto:productos_tienda!detalle_ventas_tienda_producto_id_fkey(nombre)')
          .in('venta_id', storeSaleIds))
        : Promise.resolve({ data: [], error: null }),
      restaurantSaleIds.length
        ? readQueryWithNetworkRetry(() => supabase
          .from('ventas_restaurante_items')
          .select('venta_id,cantidad,plato:platos!ventas_restaurante_items_plato_id_fkey(nombre)')
          .in('venta_id', restaurantSaleIds))
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
      const { data: reversals, error: reversalsError } = await readQueryWithNetworkRetry(() => supabase
        .from('caja_reversiones')
        .select('original_movement_id')
        .in('original_movement_id', movementIds));
      if (reversalsError) throw reversalsError;
      revertedIds = new Set((reversals || []).map((item) => item.original_movement_id));
    }
    let bankStatuses = {};
    if (showBankStatus) {
      try {
        bankStatuses = await getBankPaymentCashStatuses(supabase, hotelId, movementIds);
      } catch (statusError) {
        reportHandledError('caja', 'bank_cash_statuses_load_failed', statusError);
        bankStatuses = Object.fromEntries(movementIds.map((id) => [id, 'unavailable']));
      }
    }
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
    reportHandledError('caja', 'movements_load_failed', err);
  }
}
