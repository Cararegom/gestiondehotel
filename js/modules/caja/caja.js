// js/modules/caja/caja.js
import { turnoService } from '../../services/turnoService.js';
import {
  showError,
  clearFeedback,
  formatCurrency,
  formatDateTime,
  showGlobalLoading,
  hideGlobalLoading,
  setFormLoadingState,
  showSuccess,
  showConfirmationModal
} from '../../uiUtils.js';
import { escapeAttribute, escapeHtml } from '../../security.js';

let moduleListeners = [];
let currentSupabaseInstance = null;
let currentHotelId = null;
let currentModuleUser = null;
let currentContainerEl = null;
let currentUserRole = null;
let turnoActivo = null; // Guardará el estado del turno actual
let turnoEnSupervision = null;
let turnosAbiertosCache = new Map();
let movementTableState = {
  all: [],
  turnoId: null,
  currentPage: 1,
  pageSize: 15,
  search: '',
  type: 'todos',
  method: 'todos'
};


const ADMIN_ROLES = ['admin', 'administrador'];

function isAdminUser() {
  return !!(currentUserRole && ADMIN_ROLES.includes(String(currentUserRole).toLowerCase()));
}

function getMovementEffectiveDate(movement) {
  return movement?.fecha_movimiento || movement?.creado_en || null;
}

function getTimestampValue(dateInput) {
  const timeValue = dateInput ? new Date(dateInput).getTime() : 0;
  return Number.isFinite(timeValue) ? timeValue : 0;
}

function sortMovementsByDate(movements, ascending = false) {
  return [...(movements || [])].sort((a, b) => {
    const diff = getTimestampValue(getMovementEffectiveDate(a)) - getTimestampValue(getMovementEffectiveDate(b));
    return ascending ? diff : -diff;
  });
}

function formatMovementDateTime(movement) {
  return formatDateTime(getMovementEffectiveDate(movement));
}

function getMovementTimeLabel(movement) {
  const formatted = formatMovementDateTime(movement);
  const parts = formatted.split(',');
  return (parts[1] || parts[0] || '').trim().slice(0, 5) || '--:--';
}

function getTurnElapsedLabel(fechaApertura) {
  if (!fechaApertura) return 'Sin hora de apertura';
  const elapsedMs = Date.now() - new Date(fechaApertura).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 'Sin hora de apertura';

  const totalMinutes = Math.floor(elapsedMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} min abierto`;
  return `${hours}h ${String(minutes).padStart(2, '0')} min abierto`;
}

function getMovementOriginMeta(movement) {
  const concept = String(movement?.concepto || '').toLowerCase();

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

function getMovementTypeBadge(movementType) {
  const safeType = escapeHtml(movementType || 'N/A');
  if (movementType === 'ingreso') {
    return `<span class="badge bg-green-100 text-green-800">${safeType}</span>`;
  }
  if (movementType === 'egreso') {
    return `<span class="badge bg-red-100 text-red-800">${safeType}</span>`;
  }
  return `<span class="badge bg-blue-100 text-blue-800">${safeType}</span>`;
}

function resetMovementTableState() {
  movementTableState = {
    all: [],
    turnoId: null,
    currentPage: 1,
    pageSize: 15,
    search: '',
    type: 'todos',
    method: 'todos'
  };
}

async function solicitarMontoInicialTurno() {
  if (typeof Swal !== 'undefined') {
    const result = await Swal.fire({
      title: 'Abrir turno',
      text: 'Ingresa el monto inicial de caja.',
      input: 'number',
      inputValue: '0',
      inputAttributes: {
        min: '0',
        step: '0.01'
      },
      showCancelButton: true,
      confirmButtonText: 'Abrir turno',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#16a34a',
      inputValidator: (value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return 'Debes ingresar un monto igual o mayor a 0.';
        }
        return null;
      }
    });

    if (!result.isConfirmed) return null;
    return Number(result.value);
  }

  const montoInicialStr = prompt('¿Cuál es el monto inicial de caja?');
  if (montoInicialStr === null) return null;

  const montoInicial = Number(montoInicialStr);
  return Number.isFinite(montoInicial) ? montoInicial : Number.NaN;
}

async function seleccionarMetodoPago(metodos, metodoActualId = '') {
  if (!Array.isArray(metodos) || metodos.length === 0) return null;

  if (typeof Swal !== 'undefined') {
    const inputOptions = Object.fromEntries(
      metodos.map((metodo) => [metodo.id, metodo.nombre || 'Sin nombre'])
    );

    const result = await Swal.fire({
      title: 'Cambiar metodo de pago',
      input: 'select',
      inputOptions,
      inputValue: metodoActualId || metodos[0].id,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#2563eb',
      inputPlaceholder: 'Selecciona un metodo'
    });

    if (!result.isConfirmed) return null;
    return result.value;
  }

  const opciones = metodos.map((metodo, index) => `${index + 1}. ${metodo.nombre}`).join('\n');
  const seleccionado = prompt(`Selecciona el metodo de pago:\n${opciones}`);
  const indice = Number(seleccionado) - 1;
  return metodos[indice]?.id || null;
}

async function confirmAction(options) {
  if (typeof Swal !== 'undefined') {
    return showConfirmationModal(options);
  }

  const plainText = String(options?.text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return window.confirm(plainText || 'Estas seguro de continuar?');
}

// --- LÃ“GICA DE TURNOS ---
// js/modules/caja/caja.js

// ...

// NUEVA FUNCIÃ“N para entrar en modo supervisión
async function iniciarModoSupervision(turno) {
  turnoEnSupervision = turno;
  // Cerramos el modal de la lista de turnos
  document.getElementById('modal-turnos-abiertos')?.remove();
  // Volvemos a renderizar toda la UI, que ahora detectará el modo supervisión
  await renderizarUI();
}

// NUEVA FUNCIÃ“N para salir del modo supervisión
async function salirModoSupervision() {
  turnoEnSupervision = null;
  // Volvemos a renderizar la UI para mostrar la vista normal del admin
  await renderizarUI();
}

// ...

async function verificarTurnoActivo() {
  if (!currentModuleUser?.id || !currentHotelId) return null;

  const { data: turnosAbiertos, error } = await currentSupabaseInstance
    .from('turnos')
    .select('*, usuarios(nombre, email)')
    .eq('usuario_id', currentModuleUser.id)
    .eq('hotel_id', currentHotelId)
    .eq('estado', 'abierto')
    .order('fecha_apertura', { ascending: false });

  if (error) {
    console.error("Error verificando turno activo:", error);
    showError(
      currentContainerEl.querySelector('#turno-global-feedback'),
      'No se pudo verificar el estado del turno.'
    );
    return null;
  }

  if (!turnosAbiertos || turnosAbiertos.length === 0) {
    return null;
  }

  if (turnosAbiertos.length > 1) {
    console.warn(
      `[Caja] Hay ${turnosAbiertos.length} turnos abiertos para este usuario. Tomaré el más reciente. IDs:`,
      turnosAbiertos.map(t => t.id)
    );
  }

  const turnoReciente = turnosAbiertos[0];
  turnoService.setActiveTurn(turnoReciente.id);
  return turnoReciente;
}
async function abrirTurno() {
  const montoInicial = await solicitarMontoInicialTurno();
  if (montoInicial === null) {
    return;
  }

  if (!Number.isFinite(montoInicial) || montoInicial < 0) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), 'Monto invalido. Turno no iniciado.');
    return;
  }

  showGlobalLoading('Abriendo nuevo turno...');
  try {
    const fechaMovimiento = new Date().toISOString();
    const { data: nuevoTurno, error } = await currentSupabaseInstance.rpc('abrir_turno_con_apertura', {
      p_hotel_id: currentHotelId,
      p_usuario_id: currentModuleUser.id,
      p_monto_inicial: montoInicial,
      p_fecha_movimiento: fechaMovimiento
    });
    if (error) throw error;

    const turnoPreparado = {
      ...nuevoTurno,
      usuarios: {
        nombre: currentModuleUser?.nombre || currentModuleUser?.email || 'Usuario',
        email: currentModuleUser?.email || ''
      }
    };

    turnoActivo = turnoPreparado;
    turnoService.setActiveTurn(turnoActivo.id);
    await renderizarUI();
    showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), 'Turno iniciado con exito.');
  } catch (err) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error al abrir turno: ${err.message}`);
    await renderizarUI();
  } finally {
    hideGlobalLoading();
  }
}

// js/modules/caja/caja.js


async function cerrarTurno(turnoExterno = null, usuarioDelTurnoExterno = null, valoresReales = null) {
  const turnoACerrar = turnoExterno || turnoActivo;
  const usuarioDelTurno = usuarioDelTurnoExterno || currentModuleUser;

  if (!turnoACerrar) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No hay un turno activo para cerrar.');
    return;
  }

  const esCierreForzoso = !!turnoExterno;
  const adminNombre = currentModuleUser?.email;
  const tituloLoading = esCierreForzoso
    ? `Forzando cierre del turno de ${usuarioDelTurno.nombre || 'usuario'}...`
    : 'Realizando cierre de turno...';
  
  showGlobalLoading(tituloLoading);

  try {
    const fechaCierreISO = new Date().toISOString();
    const fechaAperturaISO = turnoACerrar.fecha_apertura;
    const usuarioDelTurnoId = usuarioDelTurno.id;

    const { data: metodosDePago, error: metodosError } = await currentSupabaseInstance
      .from('metodos_pago').select('id, nombre').eq('hotel_id', currentHotelId).eq('activo', true).order('nombre');
    if (metodosError) throw metodosError;

    const { data: movimientos, error: movError } = await currentSupabaseInstance
      .from('caja')
      .select('*, usuarios(nombre), metodos_pago(nombre)')
      .eq('turno_id', turnoACerrar.id);
    if (movError) throw movError;

    const [
      { data: logAmenidades, error: logAmenidadesError },
      { data: logLenceria, error: logLenceriaError },
      { data: logPrestamos, error: logPrestamosError },
      { data: stockAmenidades, error: stockAmenidadesError },
      { data: stockLenceria, error: stockLenceriaError }
    ] = await Promise.all([
      currentSupabaseInstance
        .from('log_amenidades_uso')
        .select('*, amenidades_inventario(nombre_item), habitaciones(nombre)')
        .eq('usuario_id', usuarioDelTurnoId)
        .gte('fecha_uso', fechaAperturaISO)
        .lte('fecha_uso', fechaCierreISO),
      currentSupabaseInstance
        .from('log_lenceria_uso')
        .select('*, inventario_lenceria(nombre_item), habitaciones(nombre)')
        .eq('usuario_id', usuarioDelTurnoId)
        .gte('fecha_uso', fechaAperturaISO)
        .lte('fecha_uso', fechaCierreISO),
      currentSupabaseInstance
        .from('historial_articulos_prestados')
        .select('*, habitaciones(nombre)')
        .eq('usuario_id', usuarioDelTurnoId)
        .gte('fecha_accion', fechaAperturaISO)
        .lte('fecha_accion', fechaCierreISO),
      currentSupabaseInstance
        .from('amenidades_inventario')
        .select('nombre_item, stock_actual')
        .eq('hotel_id', currentHotelId),
      currentSupabaseInstance
        .from('inventario_lenceria')
        .select('nombre_item, stock_limpio_almacen, stock_en_lavanderia, stock_total')
        .eq('hotel_id', currentHotelId)
    ]);

    if (logAmenidadesError) throw logAmenidadesError;
    if (logLenceriaError) throw logLenceriaError;
    if (logPrestamosError) throw logPrestamosError;
    if (stockAmenidadesError) throw stockAmenidadesError;
    if (stockLenceriaError) throw stockLenceriaError;

    const movimientosOrdenados = sortMovementsByDate(movimientos, true);
    const reporte = procesarMovimientosParaReporte(movimientos);
    const { balanceFinal: balanceFinalEnCaja } = calcularTotalesSistemaCierre(reporte, metodosDePago);
    
    const fechaCierreLocal = new Date(fechaCierreISO).toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'short' });
    const usuarioNombre = usuarioDelTurno?.nombre || usuarioDelTurno?.email || 'Sistema';
    
    let asuntoEmail = `Cierre de Caja - ${usuarioNombre} - ${fechaCierreLocal}`;
    if (esCierreForzoso) {
      asuntoEmail += ` (Forzado por ${adminNombre})`;
    }

    const htmlReporte = generarHTMLReporteCierre(
        reporte, 
        metodosDePago, 
        usuarioNombre, 
        fechaCierreLocal,
        movimientosOrdenados || [],
        logAmenidades || [],
        logLenceria || [],
        logPrestamos || [],
        stockAmenidades || [],
        stockLenceria || [],
        valoresReales
    );

    const emailResult = await enviarReporteCierreCaja({
      asunto: asuntoEmail,
      htmlReporte: htmlReporte,
      feedbackEl: currentContainerEl.querySelector('#turno-global-feedback')
    });

    const { error: updateError } = await currentSupabaseInstance.rpc('cerrar_turno_con_balance', {
      p_turno_id: turnoACerrar.id,
      p_usuario_id: currentModuleUser?.id || usuarioDelTurnoId,
      p_balance_final: balanceFinalEnCaja,
      p_fecha_cierre: fechaCierreISO
    });

    if (updateError) throw updateError;
    
    const successMessage = emailResult?.sent
      ? 'Turno cerrado y reporte enviado.'
      : 'Turno cerrado. El reporte no se pudo enviar por correo.';

    if (turnoActivo && turnoACerrar.id === turnoActivo.id) {
        showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), successMessage);
        turnoActivo = null;
        turnoEnSupervision = null;
        turnoService.clearActiveTurn();
        await renderizarUI();
    } else if (esCierreForzoso) {
        const supervisionMessage = emailResult?.sent
          ? `Turno de ${usuarioDelTurno.nombre || 'usuario'} cerrado exitosamente.`
          : `Turno de ${usuarioDelTurno.nombre || 'usuario'} cerrado, pero el reporte no se envio por correo.`;
        showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), supervisionMessage);
        turnoEnSupervision = null;
        await renderizarUI();
    }

  } catch (err) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error en el cierre de turno: ${err.message}`);
    if(turnoActivo && turnoACerrar.id === turnoActivo.id) {
       await renderizarUI();
    }
  } finally {
    hideGlobalLoading();
  }
}


function updateMovementMethodFilter(selectEl, movements) {
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

function getFilteredMovements() {
    const searchTerm = movementTableState.search.trim().toLowerCase();
    return movementTableState.all.filter((movement) => {
        const concept = String(movement?.concepto || '').toLowerCase();
        const clientName = String(movement?.reservas?.cliente_nombre || '').toLowerCase();
        const userName = String(movement?.usuarios?.nombre || '').toLowerCase();
        const methodName = String(movement?.metodos_pago?.nombre || '').toLowerCase();

        const matchesSearch = !searchTerm || [concept, clientName, userName, methodName].some((value) => value.includes(searchTerm));
        const matchesType = movementTableState.type === 'todos' || movement?.tipo === movementTableState.type;
        const matchesMethod = movementTableState.method === 'todos' || movement?.metodos_pago?.nombre === movementTableState.method;

        return matchesSearch && matchesType && matchesMethod;
    });
}

function renderMovementRows(tBodyEl, summaryEls, movementRefs = {}) {
    const allMovements = movementTableState.all || [];
    const filteredMovements = getFilteredMovements();

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
        tBodyEl.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-sm text-gray-500">No hay movimientos que coincidan con los filtros actuales.</td></tr>`;
    } else {
        tBodyEl.innerHTML = pageMovements.map((movement) => {
            const safeConcept = escapeHtml(movement.concepto || 'Sin concepto');
            const safeClientName = escapeHtml(movement.reservas?.cliente_nombre || '');
            const safeUserName = escapeHtml(movement.usuarios?.nombre || 'Sistema');
            const safeMethodName = escapeHtml(movement.metodos_pago?.nombre || 'N/A');
            const movementIdAttr = escapeAttribute(movement.id || '');
            const conceptAttr = escapeAttribute(movement.concepto || 'N/A');
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
                        ${movement.reservas?.cliente_nombre && !(movement.concepto || '').includes('Cliente:')
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
                                ${isAdminUser() ? `<button class="text-red-500 hover:text-red-700 font-medium" title="Eliminar movimiento" data-delete-movimiento="${movementIdAttr}" data-concepto="${conceptAttr}" data-monto="${amountAttr}" data-tipo="${typeAttr}">Eliminar</button>` : ''}
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

async function handleMovementTableClick(event, tBodyEl, summaryEls, turnoId, movementRefs = {}) {
    const editButton = event.target.closest('button[data-edit-metodo]');
    if (editButton) {
        const movimientoId = editButton.getAttribute('data-edit-metodo');
        const metodoActualId = editButton.getAttribute('data-metodo-actual') || '';

        showGlobalLoading('Cargando metodos de pago...');
        const { data: metodos, error: errMetodos } = await currentSupabaseInstance
            .from('metodos_pago')
            .select('id, nombre')
            .eq('hotel_id', currentHotelId)
            .eq('activo', true)
            .order('nombre');
        hideGlobalLoading();

        if (errMetodos || !metodos?.length) {
            showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No se pudieron cargar los metodos de pago.');
            return;
        }

        const nuevoMetodoId = await seleccionarMetodoPago(metodos, metodoActualId);
        if (!nuevoMetodoId || nuevoMetodoId === metodoActualId) return;

        const { error: updateError } = await currentSupabaseInstance
            .from('caja')
            .update({ metodo_pago_id: nuevoMetodoId })
            .eq('id', movimientoId);

        if (updateError) {
            showError(currentContainerEl.querySelector('#turno-global-feedback'), `No se pudo actualizar el metodo de pago: ${updateError.message}`);
            return;
        }

        showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), 'Metodo de pago actualizado.');
        await loadAndRenderMovements(tBodyEl, summaryEls, turnoId, movementRefs);
        return;
    }

    const deleteButton = event.target.closest('button[data-delete-movimiento]');
    if (deleteButton && isAdminUser()) {
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
        const { error: rpcError } = await currentSupabaseInstance.rpc('registrar_y_eliminar_mov_caja', {
            movimiento_id_param: movimientoId,
            eliminado_por_usuario_id_param: currentModuleUser.id
        });
        hideGlobalLoading();

        if (rpcError) {
            showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error al eliminar el movimiento: ${rpcError.message}`);
            return;
        }

        showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), 'Movimiento eliminado y registrado.');
        await loadAndRenderMovements(tBodyEl, summaryEls, turnoId, movementRefs);
    }
}

async function loadAndRenderMovements(tBodyEl, summaryEls, turnoId, movementRefs = {}) {
    if (!turnoId) {
        tBodyEl.innerHTML = `<tr><td colspan="6" class="text-center p-4 text-red-500">Error: no se ha especificado un turno para cargar.</td></tr>`;
        return;
    }

    if (movementTableState.turnoId !== turnoId) {
        resetMovementTableState();
        movementTableState.turnoId = turnoId;
        if (movementRefs.searchInputEl) movementRefs.searchInputEl.value = '';
        if (movementRefs.typeFilterEl) movementRefs.typeFilterEl.value = 'todos';
        if (movementRefs.methodFilterEl) movementRefs.methodFilterEl.value = 'todos';
    }

    tBodyEl.innerHTML = `<tr><td colspan="6" class="text-center p-4">Cargando movimientos del turno...</td></tr>`;
    try {
        const { data: movements, error } = await currentSupabaseInstance
            .from('caja')
            .select('id,tipo,monto,concepto,creado_en,fecha_movimiento,turno_id,usuario_id,usuarios(nombre),metodo_pago_id,metodos_pago(nombre),reservas(cliente_nombre)')
            .eq('hotel_id', currentHotelId)
            .eq('turno_id', turnoId);

        if (error) throw error;

        movementTableState.all = sortMovementsByDate(movements || []);
        updateMovementMethodFilter(movementRefs.methodFilterEl, movementTableState.all);
        renderMovementRows(tBodyEl, summaryEls, movementRefs);
    } catch (err) {
        showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error cargando movimientos: ${err.message}`);
        console.error('Error en loadAndRenderMovements:', err);
    }
}





async function renderizarUIAbierta() {
    const esModoSupervision = !!turnoEnSupervision;
    const turnoParaMostrar = turnoEnSupervision || turnoActivo;
    
    if (!turnoParaMostrar) {
        console.error("Se intentó renderizar UI abierta sin un turno válido.");
        renderizarUICerrada();
        return;
    }

    const isAdmin = isAdminUser();
    const usuarioTurnoNombre = escapeHtml(turnoParaMostrar.usuarios?.nombre || currentModuleUser?.nombre || currentModuleUser?.email || 'Usuario');
    const fechaAperturaLabel = formatDateTime(turnoParaMostrar.fecha_apertura);
    const tiempoAbiertoLabel = getTurnElapsedLabel(turnoParaMostrar.fecha_apertura);

    const supervisionBannerHtml = esModoSupervision
        ? `
        <div class="bg-amber-50 border border-amber-200 text-amber-800 p-4 mb-5 rounded-2xl flex flex-col gap-3 md:flex-row md:justify-between md:items-center" role="alert">
            <div>
                <p class="font-bold text-sm uppercase tracking-wide">Modo supervision</p>
                <p>Estas gestionando el turno de: <strong>${usuarioTurnoNombre}</strong> (Inicio: ${fechaAperturaLabel})</p>
            </div>
            <button id="btn-salir-supervision" class="button bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-4 rounded-xl">Salir de supervision</button>
        </div>`
        : '';

    currentContainerEl.innerHTML = `
    <div class="caja-module space-y-5">
      <section class="rounded-3xl overflow-hidden border border-slate-200 shadow-xl bg-white">
        <div class="text-white p-6 md:p-7" style="background: radial-gradient(circle at top left, rgba(59,130,246,0.18), transparent 35%), linear-gradient(135deg, #0f172a, #1e293b 55%, #334155);">
          <div class="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div class="max-w-3xl">
              <p class="text-xs uppercase tracking-widest text-sky-200 mb-3 font-semibold">Caja y turnos</p>
              <div class="flex flex-wrap items-center gap-3">
                <h2 class="text-3xl font-bold tracking-tight">${esModoSupervision ? 'Gestionando turno ajeno' : 'Centro de control del turno'}</h2>
                <span class="inline-flex items-center rounded-full border border-emerald-300/30 bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-100">
                  ${esModoSupervision ? 'Supervision activa' : 'Turno en operacion'}
                </span>
              </div>
              <p class="text-sm md:text-base text-slate-200 mt-3 max-w-2xl">
                Controla ingresos, egresos, arqueo y trazabilidad del turno actual desde una sola vista. La base inicial y el dinero generado quedan separados para evitar confusiones al cerrar.
              </p>

              <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mt-6">
                <div class="rounded-2xl bg-white/10 border border-white/10 px-4 py-4 backdrop-blur-sm">
                  <span class="block text-xs uppercase tracking-widest text-slate-300">Cajero</span>
                  <span class="block text-base font-semibold mt-2 text-white">${usuarioTurnoNombre}</span>
                </div>
                <div class="rounded-2xl bg-white/10 border border-white/10 px-4 py-4 backdrop-blur-sm">
                  <span class="block text-xs uppercase tracking-widest text-slate-300">Inicio</span>
                  <span id="turno-opened-at" class="block text-base font-semibold mt-2 text-white">${fechaAperturaLabel}</span>
                </div>
                <div class="rounded-2xl bg-white/10 border border-white/10 px-4 py-4 backdrop-blur-sm">
                  <span class="block text-xs uppercase tracking-widest text-slate-300">Tiempo abierto</span>
                  <span id="turno-open-duration" class="block text-base font-semibold mt-2 text-white">${tiempoAbiertoLabel}</span>
                </div>
                <div class="rounded-2xl bg-white/10 border border-white/10 px-4 py-4 backdrop-blur-sm">
                  <span class="block text-xs uppercase tracking-widest text-slate-300">Movimientos</span>
                  <span id="turno-movements-count" class="block text-base font-semibold mt-2 text-white">0</span>
                </div>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2 xl:justify-end">
            ${isAdmin ? `
              <button id="btn-ver-turnos-abiertos" class="button button-neutral py-2.5 px-4 rounded-2xl shadow-sm bg-white/10 hover:bg-white/20 text-white border border-white/10">Ver turnos abiertos</button>
              <button id="btn-ver-eliminados" class="button button-neutral py-2.5 px-4 rounded-2xl shadow-sm bg-white/10 hover:bg-white/20 text-white border border-white/10">Ver eliminados</button>
            ` : ''}
              <button id="btn-cerrar-turno" class="button ${esModoSupervision ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'} text-white font-bold py-2.5 px-5 rounded-2xl shadow-lg shadow-black/10">
                ${esModoSupervision ? 'Forzar cierre de este turno' : 'Preparar corte de caja'}
              </button>
            </div>
          </div>
        </div>

        <div class="p-4 md:p-6" style="background: linear-gradient(180deg, rgba(248,250,252,0.96), #ffffff);">
          ${supervisionBannerHtml}
          <div id="turno-global-feedback" role="status" aria-live="polite" class="feedback-message mb-4"></div>

          <div class="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.9fr)]">
            <div class="space-y-5">
              <section class="rounded-3xl bg-white border border-slate-200 shadow-sm overflow-hidden">
                <div class="p-5 border-b border-slate-200 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <p class="text-xs uppercase tracking-widest text-slate-400 mb-2">Resumen financiero</p>
                    <h3 class="text-xl font-semibold text-slate-900">Pulso actual del turno</h3>
                    <p class="text-sm text-slate-500 mt-1">Base inicial, ingresos, egresos y balance consolidados sin mezclar conceptos.</p>
                  </div>
                  <div class="inline-flex items-center rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
                    ${esModoSupervision ? 'Modo supervision' : 'Operacion normal'}
                  </div>
                </div>

                <div class="p-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
                  <div class="rounded-3xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-5 shadow-sm">
                    <span class="block text-xs uppercase tracking-widest text-slate-400">Apertura</span>
                    <span id="turno-total-apertura" class="block text-2xl font-bold mt-3 text-slate-900 leading-tight">$0</span>
                    <span class="block text-xs text-slate-500 mt-2">Base inicial del cajero</span>
                  </div>
                  <div class="rounded-3xl border border-emerald-200 bg-emerald-50/80 p-5 shadow-sm">
                    <span class="block text-xs uppercase tracking-widest text-emerald-700">Ingresos</span>
                    <span id="turno-total-ingresos" class="block text-2xl font-bold mt-3 text-emerald-600 leading-tight">$0</span>
                    <span class="block text-xs text-emerald-700/70 mt-2">Dinero que entro en el turno</span>
                  </div>
                  <div class="rounded-3xl border border-rose-200 bg-rose-50/80 p-5 shadow-sm">
                    <span class="block text-xs uppercase tracking-widest text-rose-700">Egresos</span>
                    <span id="turno-total-egresos" class="block text-2xl font-bold mt-3 text-rose-600 leading-tight">$0</span>
                    <span class="block text-xs text-rose-700/70 mt-2">Salidas registradas en el turno</span>
                  </div>
                  <div class="rounded-3xl border border-sky-200 bg-sky-50/80 p-5 shadow-sm">
                    <span class="block text-xs uppercase tracking-widest text-sky-700">Dinero generado</span>
                    <span id="turno-balance-operativo" class="block text-2xl font-bold mt-3 text-sky-600 leading-tight">$0</span>
                    <span class="block text-xs text-sky-700/70 mt-2">Ingresos menos egresos</span>
                  </div>
                  <div class="rounded-3xl border border-emerald-200 p-5 shadow-sm" style="background: linear-gradient(180deg, #ecfdf5, #d1fae5);">
                    <span class="block text-xs uppercase tracking-widest text-emerald-800">Balance total</span>
                    <span id="turno-balance" class="block text-2xl font-bold mt-3 text-emerald-600 leading-tight">$0</span>
                    <span class="block text-xs text-emerald-800/70 mt-2">Incluye apertura del turno</span>
                  </div>
                </div>

                <div class="mx-5 mb-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  <strong class="text-slate-800">Lectura rapida:</strong> la apertura es la base inicial. El dinero generado muestra solo lo que produjo el turno. El balance total incluye esa base mas el resultado del turno.
                </div>
              </section>

              <section class="rounded-3xl bg-white shadow-sm border border-slate-200 overflow-hidden">
                <div class="p-5 border-b border-slate-200">
                  <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p class="text-xs uppercase tracking-widest text-slate-400 mb-2">Historial del turno</p>
                      <h3 class="text-xl font-semibold text-slate-900">Movimientos registrados</h3>
                      <p id="movements-results" class="text-sm text-slate-500 mt-1">Cargando movimientos...</p>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full lg:w-auto lg:min-w-[560px]">
                      <label class="text-sm text-slate-600">
                        Buscar
                        <input id="movements-search" type="search" class="form-control mt-1" placeholder="Concepto, cliente, usuario o metodo">
                      </label>
                      <label class="text-sm text-slate-600">
                        Tipo
                        <select id="movements-type-filter" class="form-control mt-1">
                          <option value="todos">Todos</option>
                          <option value="ingreso">Ingresos</option>
                          <option value="egreso">Egresos</option>
                          <option value="apertura">Aperturas</option>
                        </select>
                      </label>
                      <label class="text-sm text-slate-600">
                        Metodo
                        <select id="movements-method-filter" class="form-control mt-1">
                          <option value="todos">Todos los metodos</option>
                        </select>
                      </label>
                    </div>
                  </div>
                </div>

                <div class="table-container overflow-x-auto">
                  <table class="tabla-estilizada w-full">
                    <thead class="bg-slate-50 text-slate-600">
                      <tr>
                        <th>Fecha</th>
                        <th>Tipo</th>
                        <th>Monto</th>
                        <th>Concepto</th>
                        <th>Usuario</th>
                        <th>Metodo de pago</th>
                      </tr>
                    </thead>
                    <tbody id="turno-movements-body"></tbody>
                  </table>
                </div>

                <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between p-4 border-t border-slate-200 bg-slate-50">
                  <p class="text-sm text-slate-500">La tabla usa la fecha real del movimiento cuando fue registrada manualmente y te sirve como base para el corte.</p>
                  <div class="flex items-center gap-2">
                    <button id="movements-prev-page" class="button button-neutral px-3 py-2 rounded-xl bg-white border border-slate-200">Anterior</button>
                    <span id="movements-page-info" class="text-sm text-slate-500 min-w-[120px] text-center">Pagina 1 de 1</span>
                    <button id="movements-next-page" class="button button-neutral px-3 py-2 rounded-xl bg-white border border-slate-200">Siguiente</button>
                  </div>
                </div>
              </section>
            </div>

            <aside class="space-y-5">
              <section class="rounded-3xl bg-white shadow-sm border border-slate-200 overflow-hidden">
                <div class="p-5 border-b border-slate-200" style="background: linear-gradient(180deg, #ffffff, #eef6ff);">
                  <p class="text-xs uppercase tracking-widest text-slate-400 mb-2">Operacion</p>
                  <h3 class="text-xl font-semibold text-slate-900">Registrar nuevo movimiento</h3>
                  <p class="text-sm text-slate-500 mt-1">Carga ingresos, egresos o ajustes con mejor trazabilidad para el corte.</p>
                </div>
                <form id="turno-add-form" class="form p-5 bg-white space-y-5">
                  <div class="grid grid-cols-1 gap-4">
                    <div>
                      <label class="block text-sm font-medium text-slate-700 mb-1.5">Tipo *</label>
                      <select name="tipo" class="form-control" required>
                        <option value="">-- Seleccione --</option>
                        <option value="ingreso">Ingreso</option>
                        <option value="egreso">Egreso</option>
                      </select>
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-slate-700 mb-1.5">Monto *</label>
                      <input type="number" name="monto" class="form-control" step="0.01" min="0.01" required />
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-slate-700 mb-1.5">Metodo de pago *</label>
                      <select name="metodoPagoId" class="form-control" required>
                        <option value="">Cargando...</option>
                      </select>
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-slate-700 mb-1.5">Concepto / descripcion *</label>
                      <input type="text" name="concepto" class="form-control" required minlength="3" placeholder="Ej. Compra de insumos, abono, venta adicional">
                    </div>
                  </div>
                  
                  <div class="space-y-3">
                    <label class="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                      <input type="checkbox" id="egreso-fuera-turno" name="egreso_fuera_turno" class="mt-1">
                      <span>
                        <strong class="block text-slate-800">Registrar fuera del turno/caja</strong>
                        <small id="fuera-turno-help" class="block text-slate-500 mt-1">Usa esta opcion solo cuando el movimiento no debe afectar el arqueo actual.</small>
                      </span>
                    </label>
                    <label class="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                      <input type="checkbox" id="fecha-anterior-check" name="fecha_anterior_check" class="mt-1">
                      <span>
                        <strong class="block text-slate-800">Registrar con fecha anterior</strong>
                        <small class="block text-slate-500 mt-1">La fecha ingresada sera la que se vea en caja, reportes e impresion.</small>
                      </span>
                    </label>
                  </div>

                  <div id="fecha-anterior-container" class="hidden rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <label class="block text-sm font-medium text-amber-900 mb-1.5">Fecha y hora del movimiento *</label>
                    <input type="datetime-local" id="fecha-movimiento-custom" name="fecha_movimiento_custom" class="form-control">
                  </div>

                  <button type="submit" class="button button-accent w-full py-3 rounded-2xl text-base font-semibold shadow-sm">+ Guardar movimiento</button>
                  <div id="turno-add-feedback" class="feedback-message mt-1"></div>
                </form>
              </section>

              <section class="rounded-3xl bg-slate-950 text-white shadow-sm overflow-hidden">
                <div class="p-5 border-b border-white/10">
                  <p class="text-xs uppercase tracking-widest text-sky-200 mb-2">Checklist rapido</p>
                  <h3 class="text-xl font-semibold">Buenas practicas del turno</h3>
                </div>
                <div class="p-5 text-sm text-slate-300 space-y-4">
                  <div class="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <strong class="block text-white mb-1">1. Separa bien la base del turno</strong>
                    <p>La apertura no es dinero generado. Sirve para arrancar caja y debe mantenerse clara para el corte.</p>
                  </div>
                  <div class="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <strong class="block text-white mb-1">2. Usa fecha anterior con cuidado</strong>
                    <p>Si corriges una fecha, revisa el corte antes de cerrar para no arrastrar diferencias al reporte.</p>
                  </div>
                  <div class="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <strong class="block text-white mb-1">3. Cierra con datos limpios</strong>
                    <p>Antes del corte revisa metodo de pago, concepto y movimientos fuera del turno para evitar confusiones.</p>
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </section>
    </div>`;

    moduleListeners.forEach(({ element, type, handler }) => element?.removeEventListener(type, handler));
    moduleListeners = [];

    const tBodyEl = currentContainerEl.querySelector('#turno-movements-body');
    const summaryEls = {
        apertura: currentContainerEl.querySelector('#turno-total-apertura'),
        ingresos: currentContainerEl.querySelector('#turno-total-ingresos'),
        egresos: currentContainerEl.querySelector('#turno-total-egresos'),
        operativo: currentContainerEl.querySelector('#turno-balance-operativo'),
        balance: currentContainerEl.querySelector('#turno-balance')
    };
    const movementRefs = {
        searchInputEl: currentContainerEl.querySelector('#movements-search'),
        typeFilterEl: currentContainerEl.querySelector('#movements-type-filter'),
        methodFilterEl: currentContainerEl.querySelector('#movements-method-filter'),
        resultsEl: currentContainerEl.querySelector('#movements-results'),
        pageInfoEl: currentContainerEl.querySelector('#movements-page-info'),
        prevBtn: currentContainerEl.querySelector('#movements-prev-page'),
        nextBtn: currentContainerEl.querySelector('#movements-next-page'),
        countEl: currentContainerEl.querySelector('#turno-movements-count')
    };
    
    await loadAndRenderMovements(tBodyEl, summaryEls, turnoParaMostrar.id, movementRefs);

    if (esModoSupervision) {
        const salirBtn = currentContainerEl.querySelector('#btn-salir-supervision');
        if(salirBtn) {
            const handler = () => salirModoSupervision();
            salirBtn.addEventListener('click', handler);
            moduleListeners.push({ element: salirBtn, type: 'click', handler });
        }
    }

    if (isAdmin) {
        const verTurnosBtn = currentContainerEl.querySelector('#btn-ver-turnos-abiertos');
        if(verTurnosBtn) {
            const handler = (event) => mostrarTurnosAbiertos(event);
            verTurnosBtn.addEventListener('click', handler);
            moduleListeners.push({ element: verTurnosBtn, type: 'click', handler });
        }
        const verEliminadosBtn = currentContainerEl.querySelector('#btn-ver-eliminados');
        if (verEliminadosBtn) {
            const handler = () => mostrarLogEliminados();
            verEliminadosBtn.addEventListener('click', handler);
            moduleListeners.push({ element: verEliminadosBtn, type: 'click', handler: handler });
        }
    }
    
    const cerrarTurnoBtn = currentContainerEl.querySelector('#btn-cerrar-turno');
    const resumenHandler = () => mostrarResumenCorteDeCaja();
    cerrarTurnoBtn.addEventListener('click', resumenHandler);
    moduleListeners.push({ element: cerrarTurnoBtn, type: 'click', handler: resumenHandler });

    const tableClickHandler = (event) => handleMovementTableClick(event, tBodyEl, summaryEls, turnoParaMostrar.id, movementRefs);
    tBodyEl.addEventListener('click', tableClickHandler);
    moduleListeners.push({ element: tBodyEl, type: 'click', handler: tableClickHandler });

    const searchHandler = (event) => {
        movementTableState.search = event.target.value || '';
        movementTableState.currentPage = 1;
        renderMovementRows(tBodyEl, summaryEls, movementRefs);
    };
    movementRefs.searchInputEl.addEventListener('input', searchHandler);
    moduleListeners.push({ element: movementRefs.searchInputEl, type: 'input', handler: searchHandler });

    const typeFilterHandler = (event) => {
        movementTableState.type = event.target.value || 'todos';
        movementTableState.currentPage = 1;
        renderMovementRows(tBodyEl, summaryEls, movementRefs);
    };
    movementRefs.typeFilterEl.addEventListener('change', typeFilterHandler);
    moduleListeners.push({ element: movementRefs.typeFilterEl, type: 'change', handler: typeFilterHandler });

    const methodFilterHandler = (event) => {
        movementTableState.method = event.target.value || 'todos';
        movementTableState.currentPage = 1;
        renderMovementRows(tBodyEl, summaryEls, movementRefs);
    };
    movementRefs.methodFilterEl.addEventListener('change', methodFilterHandler);
    moduleListeners.push({ element: movementRefs.methodFilterEl, type: 'change', handler: methodFilterHandler });

    const prevPageHandler = () => {
        if (movementTableState.currentPage <= 1) return;
        movementTableState.currentPage -= 1;
        renderMovementRows(tBodyEl, summaryEls, movementRefs);
    };
    movementRefs.prevBtn.addEventListener('click', prevPageHandler);
    moduleListeners.push({ element: movementRefs.prevBtn, type: 'click', handler: prevPageHandler });

    const nextPageHandler = () => {
        const totalPages = Math.max(1, Math.ceil(getFilteredMovements().length / movementTableState.pageSize));
        if (movementTableState.currentPage >= totalPages) return;
        movementTableState.currentPage += 1;
        renderMovementRows(tBodyEl, summaryEls, movementRefs);
    };
    movementRefs.nextBtn.addEventListener('click', nextPageHandler);
    moduleListeners.push({ element: movementRefs.nextBtn, type: 'click', handler: nextPageHandler });
    
    const addFormEl = currentContainerEl.querySelector('#turno-add-form');
    const metodoPagoSelect = addFormEl.elements.metodoPagoId;
    await popularMetodosPagoSelect(metodoPagoSelect);

    const fechaAnteriorCheck = addFormEl.querySelector('#fecha-anterior-check');
    const fechaAnteriorContainer = addFormEl.querySelector('#fecha-anterior-container');
    const fechaAnteriorHandler = () => {
        fechaAnteriorContainer.classList.toggle('hidden', !fechaAnteriorCheck.checked);
    };
    fechaAnteriorCheck.addEventListener('change', fechaAnteriorHandler);
    moduleListeners.push({ element: fechaAnteriorCheck, type: 'change', handler: fechaAnteriorHandler });

    const submitHandler = async (e) => {
        e.preventDefault();
        const formData = new FormData(addFormEl);
        const esFueraTurno = !!formData.get('egreso_fuera_turno');
        let turnoIdToSave = turnoParaMostrar.id;
        if (esFueraTurno) {
            turnoIdToSave = null;
        }

        const esFechaAnterior = !!formData.get('fecha_anterior_check');
        const fechaCustom = formData.get('fecha_movimiento_custom');

        const newMovement = {
            tipo: formData.get('tipo'),
            monto: parseFloat(formData.get('monto')),
            concepto: (formData.get('concepto') || '').trim(),
            metodo_pago_id: formData.get('metodoPagoId'),
            usuario_id: currentModuleUser.id,
            hotel_id: currentHotelId,
            turno_id: turnoIdToSave,
            fecha_movimiento: (esFechaAnterior && fechaCustom) ? new Date(fechaCustom).toISOString() : new Date().toISOString()
        };

        const feedbackEl = addFormEl.querySelector('#turno-add-feedback');
        const submitButton = addFormEl.querySelector('button[type="submit"]');
        setFormLoadingState(addFormEl, true, submitButton, '+ Agregar movimiento', 'Guardando...');
        clearFeedback(feedbackEl);

        if (!(newMovement.monto > 0) || !newMovement.concepto || !newMovement.metodo_pago_id || !newMovement.tipo) {
            showError(feedbackEl, 'Todos los campos son obligatorios.');
            setFormLoadingState(addFormEl, false, submitButton, '+ Agregar movimiento');
            return;
        }
        
        if (esFechaAnterior && !fechaCustom) {
            showError(feedbackEl, 'Debes seleccionar una fecha y hora si marcas la opcion de fecha anterior.');
            setFormLoadingState(addFormEl, false, submitButton, '+ Agregar movimiento');
            return;
        }

        const { error } = await currentSupabaseInstance.rpc('registrar_movimiento_caja_atomico', {
            p_hotel_id: newMovement.hotel_id,
            p_usuario_id: newMovement.usuario_id,
            p_turno_id: newMovement.turno_id,
            p_tipo: newMovement.tipo,
            p_monto: newMovement.monto,
            p_concepto: newMovement.concepto,
            p_metodo_pago_id: newMovement.metodo_pago_id,
            p_fecha_movimiento: newMovement.fecha_movimiento
        });
        if (error) {
            showError(feedbackEl, `Error: ${error.message}`);
        } else {
            showSuccess(feedbackEl, esFueraTurno ? 'Movimiento agregado fuera del turno actual.' : 'Movimiento agregado al turno actual.');
            addFormEl.reset();
            fechaAnteriorContainer.classList.add('hidden');
            movementTableState.currentPage = 1;
            await loadAndRenderMovements(tBodyEl, summaryEls, turnoParaMostrar.id, movementRefs);
        }
        setFormLoadingState(addFormEl, false, submitButton, '+ Agregar movimiento');
    };

    addFormEl.addEventListener('submit', submitHandler);
    moduleListeners.push({ element: addFormEl, type: 'submit', handler: submitHandler });
}

// --- COPIA TODA ESTA FUNCIÃ“N ---
async function mostrarLogEliminados() {
    const modalContainer = document.createElement('div');
    modalContainer.id = "modal-log-eliminados";
    modalContainer.className = "fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-70 p-4";
    modalContainer.innerHTML = `<div class="bg-white p-6 rounded-lg shadow-xl w-full max-w-4xl text-center"><p>Cargando historial...</p></div>`;
    document.body.appendChild(modalContainer);

    try {
        const { data: logs, error } = await currentSupabaseInstance
            .from('log_caja_eliminados')
            .select('creado_en, datos_eliminados, eliminado_por_usuario:usuarios(nombre)')
            .order('creado_en', { ascending: false })
            .limit(100); // Limitamos a los 100 más recientes para no sobrecargar

        if (error) throw error;

        let tableRowsHtml = '';
        if (!logs || logs.length === 0) {
            tableRowsHtml = '<tr><td colspan="6" class="text-center p-4">No hay movimientos eliminados.</td></tr>';
        } else {
            tableRowsHtml = logs.map(log => {
                const datos = log.datos_eliminados || {};
                const usuarioElimino = escapeHtml(log.eliminado_por_usuario?.nombre || 'Desconocido');
                const tipoOriginal = escapeHtml(datos.tipo || 'N/A');
                const conceptoOriginal = escapeHtml(datos.concepto || 'N/A');
                return `
                    <tr class="hover:bg-gray-50 border-b">
                        <td class="p-3 text-sm">${formatDateTime(log.creado_en)}</td>
                        <td class="p-3 text-sm text-red-600 font-medium">${usuarioElimino}</td>
                        <td class="p-3 text-sm">${formatDateTime(datos.creado_en)}</td>
                        <td class="p-3 text-sm font-semibold ${datos.tipo === 'ingreso' ? 'text-green-700' : 'text-orange-700'}">${tipoOriginal}</td>
                        <td class="p-3 text-sm font-bold">${formatCurrency(datos.monto || 0)}</td>
                        <td class="p-3 text-sm text-left">${conceptoOriginal}</td>
                    </tr>
                `;
            }).join('');
        }

        const modalContent = `
            <div class="bg-white p-0 rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
                <div class="flex justify-between items-center p-4 border-b bg-gray-50 rounded-t-lg">
                    <h3 class="text-xl font-bold text-gray-700">Historial de Movimientos Eliminados</h3>
                    <button id="btn-cerrar-log-modal" class="text-gray-500 hover:text-red-600 text-3xl">&times;</button>
                </div>
                <div class="overflow-y-auto">
                    <table class="w-full text-left">
                        <thead class="bg-gray-100 sticky top-0">
                            <tr>
                                <th class="p-3 text-sm font-semibold">Fecha eliminacion</th>
                                <th class="p-3 text-sm font-semibold">Eliminado Por</th>
                                <th class="p-3 text-sm font-semibold">Fecha Original</th>
                                <th class="p-3 text-sm font-semibold">Tipo Original</th>
                                <th class="p-3 text-sm font-semibold">Monto Original</th>
                                <th class="p-3 text-sm font-semibold">Concepto Original</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        modalContainer.innerHTML = modalContent;
        modalContainer.querySelector('#btn-cerrar-log-modal').onclick = () => modalContainer.remove();

    } catch (err) {
        modalContainer.innerHTML = `<div class="bg-white p-6 rounded-lg shadow-xl w-full max-w-md text-center">
            <p class="text-red-600">Error al cargar el historial: ${escapeHtml(err.message)}</p>
            <button id="btn-cerrar-log-modal" class="button button-neutral mt-4">Cerrar</button>
        </div>`;
        modalContainer.querySelector('#btn-cerrar-log-modal').onclick = () => modalContainer.remove();
    }
}



// Reemplaza tu función mostrarTurnosAbiertos con esta versión
// REEMPLAZA TU FUNCIÃ“N ACTUAL CON ESTA VERSIÃ“N MEJORADA
async function mostrarTurnosAbiertos(event) {
    if (document.getElementById('modal-turnos-abiertos')) {
        return;
    }

    const boton = event.currentTarget;
    const rect = boton.getBoundingClientRect();
    const top = rect.bottom + window.scrollY + 5;
    const right = window.innerWidth - rect.right;
    const isMobile = window.innerWidth < 640;

    const modalContainer = document.createElement('div');
    modalContainer.id = "modal-turnos-abiertos";
    modalContainer.style.zIndex = '10000';
    modalContainer.className = isMobile
        ? "fixed inset-0 bg-black/50 p-4 flex items-start justify-center overflow-y-auto"
        : "fixed inset-0";

    const modalPanel = document.createElement('div');
    modalPanel.className = "bg-white rounded-2xl shadow-xl border w-full text-center overflow-hidden";
    modalPanel.style.maxWidth = isMobile ? '28rem' : '24rem';
    modalPanel.style.maxHeight = isMobile ? 'calc(100vh - 2rem)' : 'min(75vh, 34rem)';

    if (isMobile) {
        modalPanel.style.marginTop = '1rem';
    } else {
        modalPanel.style.position = 'absolute';
        modalPanel.style.top = `${top}px`;
        modalPanel.style.right = `${right}px`;
    }

    modalPanel.innerHTML = `<div class="p-4"><p>Buscando turnos abiertos...</p></div>`;
    modalContainer.appendChild(modalPanel);
    document.body.appendChild(modalContainer);

    const closeModal = () => {
        modalContainer.remove();
        document.removeEventListener('click', closeOnClickOutside);
        document.removeEventListener('keydown', closeOnEscape);
    };

    const closeOnClickOutside = (e) => {
        if (isMobile) {
            if (e.target === modalContainer) {
                closeModal();
            }
            return;
        }

        if (!modalPanel.contains(e.target) && e.target !== boton) {
            closeModal();
        }
    };

    const closeOnEscape = (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    };

    setTimeout(() => document.addEventListener('click', closeOnClickOutside), 0);
    document.addEventListener('keydown', closeOnEscape);
    
    try {
        const { data: turnos, error } = await currentSupabaseInstance
            .from('turnos')
            .select('*, usuarios(*)')
            .eq('estado', 'abierto')
            .eq('hotel_id', currentHotelId)
            .order('fecha_apertura', { ascending: true });

        if (error) throw error;
        turnosAbiertosCache = new Map((turnos || []).map((turno) => [String(turno.id), turno]));

        let tableRowsHtml = '';
        if (!turnos || turnos.length === 0) {
            tableRowsHtml = '<tr><td class="text-center p-4">Excelente. No hay turnos abiertos.</td></tr>';
        } else {
            tableRowsHtml = turnos.map(turno => {
                const nombreUsuario = turno.usuarios?.nombre || turno.usuarios?.email || 'Usuario Desconocido';
                const esMiTurno = turno.usuario_id === currentModuleUser.id;

                const botonGestion = esMiTurno
                    ? `<span class="text-gray-400 italic">Es tu turno actual</span>`
                    : `<button class="button bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded" data-turno-id="${escapeAttribute(turno.id || '')}">Gestionar turno</button>`;

                return `
                    <tr class="hover:bg-gray-50 border-b">
                        <td class="p-3 text-sm text-left">${escapeHtml(nombreUsuario)}</td>
                        <td class="p-3 text-sm text-left">${formatDateTime(turno.fecha_apertura)}</td>
                        <td class="p-3 text-sm text-center">${botonGestion}</td>
                    </tr>
                `;
            }).join('');
        }

        const modalContent = `
            <div class="flex justify-between items-center p-3 border-b bg-gray-50 rounded-t-lg">
                <h3 class="text-md font-bold text-gray-700">Turnos Abiertos</h3>
                <button id="btn-cerrar-turnos-modal" class="text-gray-500 hover:text-red-600 text-xl">&times;</button>
            </div>
            <div class="overflow-y-auto" style="max-height: ${isMobile ? 'calc(100vh - 8.5rem)' : '22rem'};">
                <table class="w-full text-left">
                    <tbody>
                        ${tableRowsHtml}
                    </tbody>
                </table>
            </div>
        `;
        modalPanel.innerHTML = modalContent;
        
        modalPanel.querySelector('#btn-cerrar-turnos-modal').onclick = closeModal;
        
        modalPanel.querySelectorAll('button[data-turno-id]').forEach(btn => {
            btn.onclick = async (e) => {
                const turnoId = e.currentTarget.dataset.turnoId;
                const turnoData = turnosAbiertosCache.get(String(turnoId));
                closeModal();
                if (!turnoData) {
                    showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No se pudo cargar el turno seleccionado.');
                    return;
                }
                await iniciarModoSupervision(turnoData);
            };
        });

    } catch (err) {
        modalPanel.innerHTML = `<div class="p-4 text-red-600">Error: ${escapeHtml(err.message)}</div>`;
    }
}




function renderizarUICerrada() {
  currentContainerEl.innerHTML = `
    <div class="card shadow-xl rounded-3xl overflow-hidden border border-slate-200">
      <div class="card-body p-8 text-center bg-gradient-to-br from-slate-50 to-white">
        <div id="turno-global-feedback" class="feedback-message mb-4"></div>
        <p class="text-xs uppercase tracking-[0.22em] text-slate-400 mb-2">Caja</p>
        <h2 class="text-3xl font-semibold text-gray-700 mb-4">La caja esta cerrada</h2>
        <p class="text-gray-500 mb-6 max-w-xl mx-auto">No hay un turno activo. Para registrar ingresos o egresos, inicia un nuevo turno y deja la apertura asociada al cajero correcto.</p>
        <button id="btn-abrir-turno" class="button button-primary button-lg py-3 px-8 text-lg rounded-2xl">Abrir turno</button>
      </div>
    </div>`;
  const abrirTurnoBtn = currentContainerEl.querySelector('#btn-abrir-turno');
  const abrirTurnoHandler = () => abrirTurno();
  abrirTurnoBtn.addEventListener('click', abrirTurnoHandler);
  moduleListeners.push({ element: abrirTurnoBtn, type: 'click', handler: abrirTurnoHandler });
}

// Reemplaza tu función renderizarUI con esta
async function renderizarUI() {
    if (turnoEnSupervision) {
        await renderizarUIAbierta();
        return;
    }

    turnoActivo = await verificarTurnoActivo();
    if (turnoActivo) {
        await renderizarUIAbierta();
    } else {
        renderizarUICerrada();
    }
}
// --- MODAL DE RESUMEN DE CAJA ANTES DE CORTE (CON IMPRESIÃ“N ADAPTABLE) ---

// Reemplaza tu función mostrarResumenCorteDeCaja existente con esta versión final.
// Agrega esta nueva función a tu archivo caja.js

/**
 * Procesa una lista de movimientos y devuelve un objeto de reporte estructurado.
 * @param {Array} movimientos - El array de movimientos de caja del turno.
 * @returns {object} El objeto de reporte con los totales calculados.
 */
function procesarMovimientosParaReporte(movimientos) {
  const crearCategoria = () => ({ pagos: {}, ventas: 0, transacciones: 0 });
  const reporte = {
    habitaciones: crearCategoria(),
    cocina:       crearCategoria(),
    tienda:       crearCategoria(),
    propinas:     crearCategoria(),
    gastos:       crearCategoria(),
    apertura: 0,
  };

  if (!movimientos || movimientos.length === 0) {
    return reporte;
  }

  movimientos.forEach(mv => {
    const monto = Number(mv.monto);
    const nombreMetodo = mv.metodos_pago?.nombre || 'Efectivo';
    const concepto = (mv.concepto || '').toLowerCase();
    let categoria = null;

    if (mv.tipo === 'apertura') {
      reporte.apertura += monto;
      return; // Continuar con el siguiente movimiento
    }
    
    // --- INICIO DE LA LÃ“GICA CORREGIDA ---
    if (mv.tipo === 'ingreso') {
        // Se mejora la clasificación para incluir más términos
        if (concepto.includes('restaurante') || concepto.includes('cocina')) {
            categoria = reporte.cocina;
        } else if (concepto.includes('tienda') || concepto.includes('producto')) {
            categoria = reporte.tienda;
        } else if (concepto.includes('propina')) {
            categoria = reporte.propinas;
        } else if (concepto.includes('habitaci') || concepto.includes('alquiler') || concepto.includes('reserva') || concepto.includes('extensi')) {
            // Esta categoría ahora agrupa todo lo relacionado a alojamiento
            categoria = reporte.habitaciones;
        } else {
            // Fallback para cualquier otro ingreso, se va a habitaciones
            console.warn(`Movimiento de ingreso no clasificado, asignado a Habitaciones: "${mv.concepto}"`);
            categoria = reporte.habitaciones;
        }
        
        categoria.ventas += 1; // O puedes ajustar esta lógica si es necesario
        categoria.transacciones += 1;

    } else if (mv.tipo === 'egreso') {
        categoria = reporte.gastos;
        categoria.transacciones += 1;
    }
    // --- FIN DE LA LÃ“GICA CORREGIDA ---

    if (categoria) {
      categoria.pagos[nombreMetodo] = (categoria.pagos[nombreMetodo] || 0) + monto;
    }
  });

  return reporte;
}

function esMetodoEfectivo(nombreMetodo = '') {
  return String(nombreMetodo).toLowerCase().includes('efectivo');
}

function calcularTotalesSistemaCierre(reporte, metodosDePago) {
  const calcularTotalFila = (fila) => Object.values(fila?.pagos || {}).reduce((acc, val) => acc + val, 0);
  const totalIngresos = calcularTotalFila(reporte.habitaciones) + calcularTotalFila(reporte.cocina) + calcularTotalFila(reporte.tienda) + calcularTotalFila(reporte.propinas);
  const totalGastos = calcularTotalFila(reporte.gastos);
  const balanceFinal = (reporte.apertura || 0) + totalIngresos - totalGastos;

  const totalesPorMetodo = {};
  metodosDePago.forEach((metodo) => {
    const nombreMetodo = metodo.nombre;
    const totalIngreso = (reporte.habitaciones.pagos[nombreMetodo] || 0) +
      (reporte.cocina.pagos[nombreMetodo] || 0) +
      (reporte.tienda.pagos[nombreMetodo] || 0) +
      (reporte.propinas.pagos[nombreMetodo] || 0);
    const totalGasto = reporte.gastos.pagos[nombreMetodo] || 0;
    const balanceSinApertura = totalIngreso - totalGasto;

    totalesPorMetodo[nombreMetodo] = {
      ingreso: totalIngreso,
      gasto: totalGasto,
      balance: balanceSinApertura,
      esperadoArqueo: balanceSinApertura + (esMetodoEfectivo(nombreMetodo) ? (reporte.apertura || 0) : 0)
    };
  });

  return {
    totalIngresos,
    totalGastos,
    balanceFinal,
    totalesPorMetodo
  };
}

function renderizarModalArqueo(metodosDePago, onConfirm) {
  const metodoEfectivo = metodosDePago.find(m => esMetodoEfectivo(m.nombre));
  const idEfectivo = metodoEfectivo ? metodoEfectivo.id : null;

  const inputsHtml = metodosDePago.map(metodo => {
    const esEfectivo = metodo.id === idEfectivo;
    
    const botonCalc = esEfectivo 
        ? `<button type="button" id="btn-abrir-calc" class="absolute inset-y-0 right-0 px-3 flex items-center bg-gray-100 hover:bg-gray-200 border-l text-gray-600 rounded-r-md transition" title="Abrir calculadora de billetes">Contar</button>` 
        : '';
    
    return `
    <div class="mb-4">
      <label class="block text-sm font-medium text-gray-700 mb-1">
        ${metodo.nombre} (Dinero fisico / real)
      </label>
      <div class="relative group">
        <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500">$</span>
        <input 
          type="number" 
          id="arqueo-input-${metodo.id}" 
          class="form-control pl-7 ${esEfectivo ? 'pr-20' : ''} w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 transition-colors" 
          placeholder="0" 
          min="0" 
          step="0.01"
        >
        ${botonCalc}
      </div>
    </div>
  `}).join('');

  const calculadoraHtml = `
    <div id="panel-calculadora" class="hidden bg-gray-50 p-4 rounded-md border border-gray-200 mb-4 animate-fadeIn">
        <div class="flex justify-between items-center mb-2">
            <h4 class="text-sm font-bold text-gray-700">Desglose de Efectivo</h4>
            <span class="text-xs text-blue-600 cursor-pointer hover:underline" id="btn-limpiar-calc">Limpiar</span>
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            ${[100000, 50000, 20000, 10000, 5000, 2000, 1000].map(val => `
                <div class="flex items-center justify-between">
                    <label class="text-gray-600">$${val/1000}k</label>
                    <input type="number" class="calc-billete w-20 p-1 border rounded text-right focus:ring-1 focus:ring-blue-500" data-valor="${val}" placeholder="0" min="0">
                </div>
            `).join('')}
            <div class="flex items-center justify-between col-span-2 border-t pt-2 mt-1">
                <label class="text-gray-600">Monedas (Total)</label>
                <input type="number" id="calc-monedas" class="w-24 p-1 border rounded text-right focus:ring-1 focus:ring-blue-500" placeholder="0" min="0">
            </div>
        </div>
        <div class="mt-3 text-right">
            <span class="text-xs text-gray-500 uppercase">Total Calculado:</span>
            <div class="text-lg font-bold text-blue-700" id="calc-total-display">$0</div>
        </div>
    </div>
  `;

  const modalHtml = `
    <div class="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden animate-fade-in-down transform transition-all">
      <div class="bg-gradient-to-r from-blue-600 to-blue-500 p-4 border-b">
        <h3 class="text-lg font-bold text-white flex items-center gap-2">
          Arqueo de caja
        </h3>
        <p class="text-blue-100 text-xs mt-1">
          Cuenta el dinero fisico antes de ver el reporte.
        </p>
      </div>
      <div class="p-6">
        <form id="form-arqueo-ciego">
          ${calculadoraHtml}
          ${inputsHtml}
          <div class="mt-6 flex justify-end gap-3 pt-4 border-t">
            <button type="button" id="btn-cancelar-arqueo" class="button button-neutral px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition">Cancelar</button>
            <button type="submit" class="button button-primary bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-md shadow-md transition transform active:scale-95">
              Confirmar
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  const modalContainer = document.createElement('div');
  modalContainer.id = "modal-arqueo-ciego";
  modalContainer.className = "fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-60 p-4 backdrop-blur-sm";
  modalContainer.innerHTML = modalHtml;
  document.body.appendChild(modalContainer);

  if (idEfectivo) {
    const btnAbrir = modalContainer.querySelector('#btn-abrir-calc');
    const panelCalc = modalContainer.querySelector('#panel-calculadora');
    const inputEfectivo = modalContainer.querySelector(`#arqueo-input-${idEfectivo}`);
    const displayTotal = modalContainer.querySelector('#calc-total-display');
    const inputsBilletes = modalContainer.querySelectorAll('.calc-billete');
    const inputMonedas = modalContainer.querySelector('#calc-monedas');
    const btnLimpiar = modalContainer.querySelector('#btn-limpiar-calc');

    if (btnAbrir) {
        btnAbrir.onclick = () => {
            const isHidden = panelCalc.classList.contains('hidden');
            if (isHidden) {
                panelCalc.classList.remove('hidden');
                inputsBilletes[0].focus();
            } else {
                panelCalc.classList.add('hidden');
            }
        };

        const recalcular = () => {
            let total = 0;
            inputsBilletes.forEach(inp => {
                const val = parseFloat(inp.dataset.valor);
                const count = parseFloat(inp.value) || 0;
                total += (val * count);
            });
            total += (parseFloat(inputMonedas.value) || 0);
            
            displayTotal.textContent = formatCurrency(total);
            inputEfectivo.value = total;
        };

        inputsBilletes.forEach(inp => inp.addEventListener('input', recalcular));
        inputMonedas.addEventListener('input', recalcular);

        btnLimpiar.onclick = () => {
            inputsBilletes.forEach(inp => inp.value = '');
            inputMonedas.value = '';
            recalcular();
        };
    }
  }

  modalContainer.querySelector('#btn-cancelar-arqueo').onclick = () => modalContainer.remove();

  modalContainer.querySelector('#form-arqueo-ciego').onsubmit = (e) => {
    e.preventDefault();
    const valoresReales = {};
    metodosDePago.forEach(m => {
      const input = document.getElementById(`arqueo-input-${m.id}`);
      const valor = parseFloat(input.value) || 0;
      valoresReales[m.nombre] = valor;
    });
    modalContainer.remove();
    onConfirm(valoresReales);
  };
  
  setTimeout(() => {
    const firstInput = modalContainer.querySelector('input');
    if(firstInput) firstInput.focus();
  }, 100);
} 


async function mostrarResumenCorteDeCaja(valoresRealesArqueo = null) {
  const turnoParaResumir = turnoEnSupervision || turnoActivo;
  const esCierreForzoso = !!turnoEnSupervision;

  if (!turnoParaResumir) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No hay ningun turno activo para generar un resumen.');
    return;
  }

  if (!valoresRealesArqueo) showGlobalLoading('Preparando cierre...');

  try {
    const { data: metodosDePago, error: metodosError } = await currentSupabaseInstance.from('metodos_pago').select('id, nombre').eq('hotel_id', currentHotelId).eq('activo', true).order('nombre', { ascending: true });
    if (metodosError) throw new Error('No se encontraron metodos de pago activos.');

    const { data: configHotel } = await currentSupabaseInstance.from('configuracion_hotel').select('*').eq('hotel_id', currentHotelId).maybeSingle();

    const { data: movimientos, error: movError } = await currentSupabaseInstance
      .from('caja')
      .select('*, usuarios(nombre), metodos_pago(nombre)')
      .eq('turno_id', turnoParaResumir.id);
    
    if (!valoresRealesArqueo) hideGlobalLoading();

    if (movError) throw movError;
    if (!movimientos || movimientos.length === 0) {
      showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No hay movimientos para generar un resumen.');
      return;
    }

    const movimientosOrdenados = sortMovementsByDate(movimientos, true);

    if (!valoresRealesArqueo) {
        renderizarModalArqueo(metodosDePago, (valoresCapturados) => {
            mostrarResumenCorteDeCaja(valoresCapturados);
        });
        return;
    }

    const reporte = procesarMovimientosParaReporte(movimientosOrdenados);
    const {
      totalesPorMetodo,
      totalIngresos,
      totalGastos,
      balanceFinal
    } = calcularTotalesSistemaCierre(reporte, metodosDePago);

    const filasComparativas = metodosDePago.map(m => {
        const sistema = totalesPorMetodo[m.nombre].esperadoArqueo;
        const real = valoresRealesArqueo[m.nombre] || 0;
        const diferencia = real - sistema;
        
        let claseDif = "text-gray-500";
        let icono = "Cuadra";
        if (diferencia < 0) { claseDif = "text-red-600 font-bold"; icono = "Falta"; }
        else if (diferencia > 0) { claseDif = "text-blue-600 font-bold"; icono = "Sobra"; }
        
        const difFormat = diferencia === 0 ? '$0' : formatCurrency(diferencia);

        return `
            <tr class="border-b hover:bg-gray-50">
                <td class="px-4 py-3 font-medium">${m.nombre}</td>
                <td class="px-4 py-3 text-right text-gray-600">${formatCurrency(sistema)}</td>
                <td class="px-4 py-3 text-right font-bold text-gray-800 bg-yellow-50">${formatCurrency(real)}</td>
                <td class="px-4 py-3 text-right ${claseDif}">${icono} ${difFormat}</td>
            </tr>
        `;
    }).join('');

    const modalHtml = `
      <div class="bg-white p-0 rounded-2xl shadow-2xl w-full max-w-4xl mx-auto border border-slate-200 relative animate-fade-in-down max-h-[90vh] flex flex-col">
        <div class="py-5 px-8 border-b rounded-t-2xl bg-gradient-to-r from-blue-100 to-green-100 flex items-center justify-between">
          <h2 class="text-2xl font-bold text-slate-800">Resultado del Cierre</h2>
          <div class="text-sm bg-white px-3 py-1 rounded-full shadow-sm">
             Usuario: <b>${turnoParaResumir.usuarios?.nombre || 'Sistema'}</b>
          </div>
        </div>
        
        <div class="p-6 overflow-y-auto custom-scrollbar">
          
          <div class="mb-6 border rounded-lg overflow-hidden shadow-sm">
            <div class="bg-gray-800 text-white px-4 py-2 text-sm font-bold uppercase tracking-wider">Cuadre de Caja</div>
            <table class="w-full text-sm">
                <thead class="bg-gray-100 text-gray-700">
                    <tr>
                        <th class="px-4 py-2 text-left">Metodo</th>
                        <th class="px-4 py-2 text-right">Sistema (Esperado)</th>
                        <th class="px-4 py-2 text-right bg-yellow-100">Declarado (Real)</th>
                        <th class="px-4 py-2 text-right">Diferencia</th>
                    </tr>
                </thead>
                <tbody>
                    ${filasComparativas}
                </tbody>
            </table>
          </div>

          <details class="group mb-4">
            <summary class="flex justify-between items-center font-medium cursor-pointer list-none p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition">
                <span>Ver desglose por conceptos (Habitaciones, Tienda, etc.)</span>
                <span class="transition group-open:rotate-180">v</span>
            </summary>
            <div class="text-xs mt-3 text-gray-500 group-open:animate-fadeIn">
                <div class="overflow-x-auto">
                    <p class="p-2">Apertura: <b>${formatCurrency(reporte.apertura)}</b> | Ingresos operativos: <b>${formatCurrency(totalIngresos)}</b> | Gastos: <b>${formatCurrency(totalGastos)}</b> | Balance esperado: <b>${formatCurrency(balanceFinal)}</b></p>
                </div>
            </div>
          </details>

          <div class="flex flex-col md:flex-row justify-end gap-3 mt-6 pt-4 border-t">
            <button id="btn-imprimir-corte-caja" class="button button-neutral px-4 py-2 rounded-lg bg-slate-100 hover:bg-blue-100 text-blue-800 font-semibold transition order-2 md:order-1">Imprimir reporte</button>
            <button id="btn-cancelar-corte-caja" class="button button-neutral px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold transition order-1 md:order-2">Volver / corregir</button>
            <button id="btn-confirmar-corte-caja" class="button button-primary px-4 py-2 rounded-lg bg-gradient-to-r from-green-600 to-green-500 hover:from-green-700 hover:to-green-600 text-white font-bold shadow transition order-3">Cerrar turno definitivamente</button>
          </div>
        </div>
      </div>
    `;

    const modal = document.createElement('div');
    modal.id = "modal-corte-caja";
    modal.className = "fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-50 p-4";
    modal.innerHTML = modalHtml;
    document.body.appendChild(modal);

    modal.querySelector('#btn-cancelar-corte-caja').onclick = () => modal.remove();
    
    modal.querySelector('#btn-confirmar-corte-caja').onclick = async () => {
      modal.remove();
      if (esCierreForzoso) {
        await cerrarTurno(turnoParaResumir, turnoParaResumir.usuarios, valoresRealesArqueo);
      } else {
        await cerrarTurno(null, null, valoresRealesArqueo);
      }
    };

    modal.querySelector('#btn-imprimir-corte-caja').onclick = () => {
        const ingresosPorMetodo = {};
        const egresosPorMetodo = {};
        const balancesPorMetodo = {};
        
        metodosDePago.forEach(m => { 
            ingresosPorMetodo[m.nombre] = totalesPorMetodo[m.nombre]?.ingreso || 0;
            egresosPorMetodo[m.nombre] = totalesPorMetodo[m.nombre]?.gasto || 0;
            balancesPorMetodo[m.nombre] = totalesPorMetodo[m.nombre]?.esperadoArqueo || 0;
        });
        
        const nombreUsuario = turnoParaResumir.usuarios?.nombre || turnoParaResumir.usuarios?.email || 'Usuario';
        const fechaLocal = new Date().toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'medium' });

        imprimirCorteCajaAdaptable(
            configHotel, 
            movimientosOrdenados, 
            totalIngresos, 
            totalGastos, 
            balanceFinal, 
            ingresosPorMetodo, 
            egresosPorMetodo, 
            balancesPorMetodo,
            nombreUsuario, 
            fechaLocal,
            reporte.apertura,
            valoresRealesArqueo
        );
    };
    
  } catch (e) {
    hideGlobalLoading();
    document.getElementById('modal-corte-caja')?.remove(); 
    showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error generando el resumen: ${e.message}`);
    console.error('Error en mostrarResumenCorteDeCaja:', e);
  }
}





function imprimirCorteCajaAdaptable(config, movimientos, ingresos, egresos, balance, ingresosPorMetodo, egresosPorMetodo, balancesPorMetodo, usuarioNombre, fechaCierre, montoApertura = 0, valoresReales = null) {
  let tamano = (config?.tamano_papel || '').toLowerCase();
  const esTermica = tamano === '58mm' || tamano === '80mm';
  const widthPage = tamano === '58mm' ? '58mm' : (tamano === '80mm' ? '78mm' : '100%');
  const fontSize = tamano === '58mm' ? '10px' : (tamano === '80mm' ? '11px' : '12px');

  let logoUrl = config?.mostrar_logo !== false && config?.logo_url ? config.logo_url : null;
  let hotelNombre = config?.nombre_hotel || 'Hotel';
  let direccion = config?.direccion_fiscal || '';
  let nit = config?.nit_rut || '';
  let pie = config?.pie_ticket || '';

  let alertaHtml = '';
  if (valoresReales) {
      let totalDeclarado = 0;
      Object.values(valoresReales).forEach(val => totalDeclarado += val);
      
      let diferencia = totalDeclarado - balance;
      
      if (Math.abs(diferencia) > 1) {
          const esFaltante = diferencia < 0;
          const tipo = esFaltante ? 'FALTANTE (DEUDA)' : 'SOBRANTE';
          const borde = esFaltante ? '2px dashed black' : '1px solid black';
          
          alertaHtml = `
            <div style="margin: 10px 0; padding: 8px; border: ${borde}; text-align: center;">
                <div style="font-weight: bold; font-size: 1.2em;">DESCUADRE DETECTADO</div>
                <div style="margin-top: 4px;">Sistema espera: ${formatCurrency(balance)}</div>
                <div>Cajero entrega: ${formatCurrency(totalDeclarado)}</div>
                <div style="margin-top: 5px; font-weight: bold; font-size: 1.3em;">
                    ${tipo}: ${formatCurrency(diferencia)}
                </div>
            </div>
          `;
      }
  }

  let style = `
    @page { margin: ${esTermica ? '0' : '15mm'}; size: auto; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: ${fontSize}; margin: 0; padding: ${esTermica ? '5px' : '20px'}; width: ${esTermica ? widthPage : 'auto'}; color: #000; }
    .container { width: 100%; max-width: ${esTermica ? '100%' : '800px'}; margin: 0 auto; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: bold; }
    .mb-2 { margin-bottom: 10px; }
    .mt-2 { margin-top: 10px; }
    .border-bottom { border-bottom: 1px dashed #444; padding-bottom: 5px; margin-bottom: 5px; }
    .border-top { border-top: 1px dashed #444; padding-top: 5px; margin-top: 5px; }
    table { width: 100%; border-collapse: collapse; margin-top: 5px; }
    th { text-align: left; border-bottom: 1px solid #000; padding: 3px 0; font-weight: bold; text-transform: uppercase; font-size: 0.9em; }
    td { padding: 4px 0; vertical-align: top; }
    .col-hora { width: 12%; } .col-tipo { width: 8%; text-align: center; } .col-concepto { width: 45%; } .col-metodo { width: 15%; } .col-monto { width: 20%; text-align: right; }
    .resumen-row { display: flex; justify-content: space-between; margin-bottom: 2px; }
    .balance-box { border: 1px solid #000; padding: 5px; margin: 10px 0; background-color: #f9f9f9; }
    @media print { .no-print { display: none; } body { -webkit-print-color-adjust: exact; } }
  `;

  let headerHtml = `
    <div class="text-center mb-2">
      ${logoUrl ? `<img src="${logoUrl}" style="max-width: 60%; max-height: 60px; object-fit: contain;">` : ''}
      <div class="bold" style="font-size: 1.1em; margin-top:5px;">${hotelNombre}</div>
      <div>${direccion}</div>
      ${nit ? `<div>NIT: ${nit}</div>` : ''}
    </div>
    <div class="border-bottom text-center bold">CIERRE DE CAJA</div>
    <div class="mb-2" style="font-size: 0.9em;">
      <div class="resumen-row"><span>Cajero:</span> <span class="bold">${usuarioNombre}</span></div>
      <div class="resumen-row"><span>Fecha:</span> <span>${fechaCierre}</span></div>
    </div>
  `;

  let totalesHtml = `
    <div class="mb-2">
      <div class="resumen-row"><span>Apertura de caja (base inicial):</span> <span>${formatCurrency(montoApertura)}</span></div>
      <div class="resumen-row"><span>(+) Ingresos del turno:</span> <span>${formatCurrency(ingresos)}</span></div>
      <div class="resumen-row"><span>(-) Egresos del turno:</span> <span>${formatCurrency(egresos)}</span></div>
      <div class="resumen-row"><span>(=) Dinero generado en el turno:</span> <span>${formatCurrency(ingresos - egresos)}</span></div>
      <div class="border-top resumen-row bold" style="font-size: 1.1em;">
        <span>(=) BALANCE TOTAL INCLUYENDO APERTURA:</span> <span>${formatCurrency(balance)}</span>
      </div>
    </div>
  `;

  let listaBalances = Object.entries(balancesPorMetodo).map(([metodo, valor]) => {
     if(valor === 0) return '';
     return `<div class="resumen-row"><span>${metodo}:</span> <span class="bold">${formatCurrency(valor)}</span></div>`;
  }).join('');

  let detalleEntregarHtml = `
    <div class="balance-box">
      <div class="bold text-center border-bottom mb-1">BALANCE TOTAL INCLUYENDO APERTURA</div>
      ${listaBalances || '<div class="text-center italic">Sin movimientos</div>'}
    </div>
  `;

  let filasMovimientos = movimientos.map(mv => {
    let hora = getMovementTimeLabel(mv);
    let tipoSigno = mv.tipo === 'ingreso' ? '+' : (mv.tipo === 'egreso' ? '-' : '*');
    return `<tr><td class="col-hora">${hora}</td><td class="col-tipo">${tipoSigno}</td><td class="col-concepto">${mv.concepto || 'Sin concepto'}</td><td class="col-metodo">${(mv.metodos_pago?.nombre || 'N/A')}</td><td class="col-monto">${formatCurrency(mv.monto)}</td></tr>`;
  }).join('');

  let tablaHtml = `<div class="bold mt-2 border-bottom">MOVIMIENTOS</div><table><thead><tr><th class="col-hora">Hora</th><th class="col-tipo">T</th><th class="col-concepto">Concepto</th><th class="col-metodo">Met</th><th class="col-monto">Monto</th></tr></thead><tbody>${filasMovimientos}</tbody></table>`;

  let firmasHtml = `<div class="mt-2" style="margin-top: 30px; display: flex; justify-content: space-between; gap: 20px;"><div class="text-center" style="flex: 1; border-top: 1px solid #000; padding-top: 5px;">Firma Cajero</div><div class="text-center" style="flex: 1; border-top: 1px solid #000; padding-top: 5px;">Firma Supervisor</div></div>`;

  let fullHtml = `<html><head><title>Corte de Caja</title><style>${style}</style></head><body><div class="container">${headerHtml}${totalesHtml}${detalleEntregarHtml}${alertaHtml}${tablaHtml}${firmasHtml}${pie ? `<div class="text-center mt-2 border-top" style="font-size:0.8em; padding-top:5px;">${pie}</div>` : ''}</div></body></html>`;

  let w = window.open('', '_blank', `width=${esTermica ? '400' : '900'},height=700`);
  w.document.write(fullHtml);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 500);
}

// --- FUNCIONES AUXILIARES (Email, Métodos de Pago, etc.) ---

async function popularMetodosPagoSelect(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">Cargando...</option>';
  const { data, error } = await currentSupabaseInstance
    .from('metodos_pago')
    .select('id, nombre')
    .eq('hotel_id', currentHotelId)
    .eq('activo', true);
  if (error || !data.length) {
    selectEl.innerHTML = '<option value="" disabled>No hay m\u00E9todos</option>';
  } else {
    selectEl.innerHTML = `<option value="">-- Seleccione --</option>${data.map(m => `<option value="${escapeAttribute(m.id || '')}">${escapeHtml(m.nombre || 'Sin nombre')}</option>`).join('')}`;
    if (data.length === 1) selectEl.value = data[0].id;
  }
}

// REEMPLAZA TU FUNCIÃ“N generarHTMLReporteCierre CON ESTA VERSIÃ“N (DETALLADA + ALERTA)
function generarHTMLReporteCierre(
    reporte, 
    metodosDePago, 
    usuarioNombre, 
    fechaCierre,
    movsCaja, 
    movsAmenidades, 
    movsLenceria, 
    movsPrestamos,
    stockAmenidades, 
    stockLenceria,
    valoresReales = null // <--- Parámetro para el arqueo ciego
) {
  
  // --- 1. CÁLCULO DE TOTALES DEL SISTEMA ---
  const {
    totalesPorMetodo,
    totalIngresos,
    totalGastos,
    balanceFinal
  } = calcularTotalesSistemaCierre(reporte, metodosDePago);
  const balanceOperativo = totalIngresos - totalGastos;
  const saldoEsperadoEnCaja = balanceFinal;


  let alertaDescuadreHtml = '';
  if (valoresReales) {
      let totalDeclarado = 0;
      let filasDescuadre = metodosDePago.map(m => {
          const sistema = totalesPorMetodo[m.nombre].esperadoArqueo;

          const real = valoresReales[m.nombre] || 0;
          totalDeclarado += real;
          const dif = real - sistema;
          
          if (Math.abs(dif) < 1) return '';
          
          const color = dif < 0 ? 'red' : 'blue';
          const signo = dif > 0 ? '+' : '';
          return `<tr>
              <td style="padding:5px; border-bottom:1px solid #ddd;">${m.nombre}</td>
              <td style="padding:5px; border-bottom:1px solid #ddd; text-align:right;">${formatCurrency(sistema)}</td>
              <td style="padding:5px; border-bottom:1px solid #ddd; text-align:right;">${formatCurrency(real)}</td>
              <td style="padding:5px; border-bottom:1px solid #ddd; text-align:right; color:${color}; font-weight:bold;">${signo}${formatCurrency(dif)}</td>
          </tr>`;
      }).join('');

      // Diferencia total global
      const diferenciaTotal = totalDeclarado - saldoEsperadoEnCaja;

      if (Math.abs(diferenciaTotal) > 1 || filasDescuadre.trim() !== '') {
            const tituloEstado = diferenciaTotal < 0 ? 'DESCUADRE: FALTANTE DE DINERO' : (diferenciaTotal > 0 ? 'DESCUADRE: SOBRANTE DE DINERO' : 'DETALLE DE DIFERENCIAS');
            const colorFondo = diferenciaTotal < 0 ? '#fee2e2' : '#dbeafe'; 
            const colorTexto = diferenciaTotal < 0 ? '#991b1b' : '#1e40af';

            alertaDescuadreHtml = `
            <div style="background-color: ${colorFondo}; border: 2px dashed ${colorTexto}; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                <h3 style="color: ${colorTexto}; margin-top: 0; text-align: center;">${tituloEstado}</h3>
                <p style="text-align:center; font-size:16px;">
                    El saldo esperado en caja era <b>${formatCurrency(saldoEsperadoEnCaja)}</b>, pero el cajero declaro tener <b>${formatCurrency(totalDeclarado)}</b>.
                </p>
                <div style="text-align:center; font-size:20px; font-weight:bold; color:${colorTexto}; margin-bottom:10px;">
                   Diferencia Total: ${diferenciaTotal > 0 ? '+' : ''}${formatCurrency(diferenciaTotal)}
                </div>
                <table style="width:100%; font-size:13px; background:white; border-collapse:collapse;">
                    <thead>
                        <tr style="background:#f3f4f6; color:#555;">
                            <th style="padding:5px; text-align:left;">Metodo</th>
                            <th style="padding:5px; text-align:right;">Sistema (Esperado)</th>
                            <th style="padding:5px; text-align:right;">Real (Declarado)</th>
                            <th style="padding:5px; text-align:right;">Diferencia</th>
                        </tr>
                    </thead>
                    <tbody>${filasDescuadre}</tbody>
                </table>
            </div>`;
      }
  }

  // --- 3. ESTILOS HTML (Tus estilos originales) ---
  const styles = {
    body: `font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1f2937; background-color: #eef3f8; margin: 0; padding: 24px;`,
    container: `max-width: 1100px; width: 100%; margin: 0 auto; background-color: #ffffff; border: 1px solid #dbe4ee; border-radius: 18px; overflow: hidden; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);`,
    hero: `background-color: #0f172a; padding: 28px 32px 22px; color: #ffffff;`,
    heroEyebrow: `font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; color: #93c5fd; margin-bottom: 10px; font-weight: bold;`,
    heroTitle: `font-size: 30px; line-height: 1.15; margin: 0; font-weight: bold;`,
    heroSubtitle: `font-size: 14px; color: #cbd5e1; margin: 8px 0 0;`,
    metaTable: `width: 100%; margin-top: 18px; border-collapse: separate; border-spacing: 0 10px;`,
    metaLabel: `font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #93c5fd;`,
    metaValue: `font-size: 14px; color: #ffffff; font-weight: bold;`,
    section: `padding: 26px 28px 30px;`,
    headerDetalle: `color: #0f172a; font-size: 18px; text-align: left; margin: 34px 0 14px; padding: 0 0 10px; border-bottom: 2px solid #e5e7eb;`,
    table: `width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px; border: 1px solid #e5e7eb; overflow: hidden;`,
    th: `border: 1px solid #e5e7eb; padding: 12px 10px; text-align: left; background-color: #f8fafc; color: #334155; font-weight: 700;`,
    td: `border: 1px solid #e5e7eb; padding: 11px 10px; text-align: right; background-color: #ffffff;`,
    tdConcepto: `border: 1px solid #e5e7eb; padding: 11px 10px; text-align: left; font-weight: 500; background-color: #ffffff;`,
    tdTotal: `border: 1px solid #dbeafe; padding: 11px 10px; text-align: right; font-weight: bold; background-color: #f8fbff;`,
    tdTotalConcepto: `border: 1px solid #dbeafe; padding: 11px 10px; text-align: left; font-weight: bold; background-color: #f8fbff;`,
    summaryTable: `width: 100%; border-collapse: separate; border-spacing: 10px; margin: 20px 0 0;`,
    summaryCell: `background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px;`,
    summaryLabel: `font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; color: #64748b; margin-bottom: 10px; font-weight: bold;`,
    summaryValue: `font-size: 24px; line-height: 1.1; color: #0f172a; font-weight: bold;`,
    summaryHint: `font-size: 12px; color: #64748b; margin-top: 6px;`,
    infoBox: `background:#f8fafc; border:1px solid #dbeafe; color:#1e3a8a; padding:14px 16px; border-radius:12px; margin:22px 0 6px; font-size:13px; line-height:1.6;`,
    footer: `text-align: center; font-size: 12px; color: #94a3b8; margin-top: 30px; padding: 18px 0 0; border-top: 1px solid #e5e7eb;`
  };

  // --- 4. TABLAS DE RESUMEN (Tus tablas originales) ---
  const thMetodos = metodosDePago.map(m => `<th style="${styles.th} text-align:right;">${m.nombre}</th>`).join('');
  const generarCeldasFila = (fila) => metodosDePago.map(m => `<td style="${styles.td}">${formatCurrency(fila.pagos[m.nombre] || 0)}</td>`).join('');
  const calcularTotalCategoria = (fila) => Object.values(fila?.pagos || {}).reduce((acc, val) => acc + val, 0);
  const tdTotalesIngresos = metodosDePago.map(m => `<td style="${styles.tdTotal}">${formatCurrency(totalesPorMetodo[m.nombre].ingreso)}</td>`).join('');
  const tdTotalesGastos = metodosDePago.map(m => `<td style="${styles.tdTotal} color:red;">(${formatCurrency(totalesPorMetodo[m.nombre].gasto)})</td>`).join('');
  const tdTotalesBalanceOperativo = metodosDePago.map(m => `<td style="${styles.tdTotal}">${formatCurrency(totalesPorMetodo[m.nombre].balance)}</td>`).join('');
  const tdTotalesEsperadoCaja = metodosDePago.map(m => `<td style="${styles.tdTotal}">${formatCurrency(totalesPorMetodo[m.nombre].esperadoArqueo)}</td>`).join('');

  const resumenCardsHtml = `
    <table role="presentation" style="${styles.summaryTable}">
      <tr>
        <td style="${styles.summaryCell}; width: 33.33%;">
          <div style="${styles.summaryLabel}">Apertura</div>
          <div style="${styles.summaryValue}">${formatCurrency(reporte.apertura)}</div>
          <div style="${styles.summaryHint}">Base inicial del turno</div>
        </td>
        <td style="${styles.summaryCell}; width: 33.33%;">
          <div style="${styles.summaryLabel}">Ingresos</div>
          <div style="${styles.summaryValue}; color:#166534;">${formatCurrency(totalIngresos)}</div>
          <div style="${styles.summaryHint}">Total facturado en el turno</div>
        </td>
        <td style="${styles.summaryCell}; width: 33.33%;">
          <div style="${styles.summaryLabel}">Egresos</div>
          <div style="${styles.summaryValue}; color:#b91c1c;">${formatCurrency(totalGastos)}</div>
          <div style="${styles.summaryHint}">Salidas de dinero del turno</div>
        </td>
      </tr>
    </table>
    <table role="presentation" style="${styles.summaryTable}; margin-top: 0;">
      <tr>
        <td style="${styles.summaryCell}; width: 50%;">
          <div style="${styles.summaryLabel}">Dinero generado</div>
          <div style="${styles.summaryValue}; color:#2563eb;">${formatCurrency(balanceOperativo)}</div>
          <div style="${styles.summaryHint}">Ingresos menos egresos</div>
        </td>
        <td style="${styles.summaryCell}; width: 50%;">
          <div style="${styles.summaryLabel}">Total esperado en caja</div>
          <div style="${styles.summaryValue}; color:#0f766e;">${formatCurrency(saldoEsperadoEnCaja)}</div>
          <div style="${styles.summaryHint}">Apertura mas dinero generado</div>
        </td>
      </tr>
    </table>
  `;
  
  const detalleCajaHtml = `
    <h2 style="${styles.headerDetalle}">Detalle de Movimientos de Caja</h2>
    <table style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th}">Fecha</th>
          <th style="${styles.th}">Tipo</th>
          <th style="${styles.th}">Concepto</th>
          <th style="${styles.th}">Metodo</th>
          <th style="${styles.th}">Monto</th>
        </tr>
      </thead>
      <tbody>
        ${(movsCaja && movsCaja.length > 0) ? movsCaja.map(mv => `
          <tr>
            <td style="${styles.td} text-align:left; min-width: 130px;">${formatMovementDateTime(mv)}</td>
            <td style="${styles.tdConcepto}">${mv.tipo}</td>
            <td style="${styles.tdConcepto}">${mv.concepto}</td>
            <td style="${styles.tdConcepto}">${mv.metodos_pago?.nombre || 'N/A'}</td>
            <td style="${styles.td} font-weight:bold; color:${mv.tipo === 'ingreso' ? 'green' : (mv.tipo === 'egreso' ? 'red' : 'inherit')};">
              ${formatCurrency(mv.monto)}
            </td>
          </tr>
        `).join('') : `<tr><td colspan="5" style="${styles.td} text-align:center;">No hay movimientos de caja.</td></tr>`}
      </tbody>
    </table>
  `;

  const amenidadesAgrupadas = {};
  if (movsAmenidades && movsAmenidades.length > 0) {
    movsAmenidades.forEach(mv => {
      const habitacionNombre = mv.habitaciones?.nombre || 'N/A (Registro Manual)';
      const itemNombre = mv.amenidades_inventario?.nombre_item || 'N/A';
      const cantidad = mv.cantidad_usada;
      if (!amenidadesAgrupadas[habitacionNombre]) amenidadesAgrupadas[habitacionNombre] = [];
      amenidadesAgrupadas[habitacionNombre].push(`${itemNombre} (<b>${cantidad}</b>)`);
    });
  }
  const detalleAmenidadesHtml = `
    <h2 style="${styles.headerDetalle}">Registro de Amenidades (Agrupado por Habitacion)</h2>
    <table style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th}">Habitacion</th>
          <th style="${styles.th}">Articulos entregados en el turno</th>
        </tr>
      </thead>
      <tbody>
        ${(Object.keys(amenidadesAgrupadas).length > 0) ? Object.entries(amenidadesAgrupadas).map(([habitacion, items]) => `
          <tr>
            <td style="${styles.tdConcepto}">${habitacion}</td>
            <td style="${styles.tdConcepto}">${items.join('<br>')}</td>
          </tr>
        `).join('') : `<tr><td colspan="2" style="${styles.td} text-align:center;">No hay registros de amenidades.</td></tr>`}
      </tbody>
    </table>
  `;

  const detalleLenceriaHtml = `
    <h2 style="${styles.headerDetalle}">Registro de Lenceria (Ropa de cama)</h2>
    <table style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th}">Fecha</th>
          <th style="${styles.th}">Habitacion</th>
          <th style="${styles.th}">Articulo</th>
          <th style="${styles.th}">Cantidad</th>
        </tr>
      </thead>
      <tbody>
        ${(movsLenceria && movsLenceria.length > 0) ? movsLenceria.map(mv => `
          <tr>
            <td style="${styles.td} text-align:left; min-width: 130px;">${formatDateTime(mv.fecha_uso)}</td>
            <td style="${styles.tdConcepto}">${mv.habitaciones?.nombre || 'N/A'}</td>
            <td style="${styles.tdConcepto}">${mv.inventario_lenceria?.nombre_item || 'N/A'}</td>
            <td style="${styles.td} text-align:center; font-weight:bold;">${mv.cantidad_usada}</td>
          </tr>
        `).join('') : `<tr><td colspan="4" style="${styles.td} text-align:center;">No hay registros de lenceria.</td></tr>`}
      </tbody>
    </table>
  `;

  const detallePrestamosHtml = `
    <h2 style="${styles.headerDetalle}">Registro de Prestamos</h2>
    <table style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th}">Fecha</th>
          <th style="${styles.th}">Habitacion</th>
          <th style="${styles.th}">Articulo</th>
          <th style="${styles.th}">Accion</th>
        </tr>
      </thead>
      <tbody>
        ${(movsPrestamos && movsPrestamos.length > 0) ? movsPrestamos.map(mv => `
          <tr>
            <td style="${styles.td} text-align:left; min-width: 130px;">${formatDateTime(mv.fecha_accion)}</td>
            <td style="${styles.tdConcepto}">${mv.habitaciones?.nombre || 'N/A'}</td>
            <td style="${styles.tdConcepto}">${mv.articulo_nombre}</td>
            <td style="${styles.tdConcepto}">${mv.accion}</td>
          </tr>
        `).join('') : `<tr><td colspan="4" style="${styles.td} text-align:center;">No hay registros de prestamos.</td></tr>`}
      </tbody>
    </table>
  `;
  
  const stockAmenidadesHtml = `
    <h2 style="${styles.headerDetalle}">Stock Actual de Amenidades</h2>
    <table style="${styles.table}">
      <thead><tr><th style="${styles.th}">Articulo</th><th style="${styles.th}">Stock Actual</th></tr></thead>
      <tbody>
        ${(stockAmenidades && stockAmenidades.length > 0) ? stockAmenidades.map(item => `
          <tr>
            <td style="${styles.tdConcepto}">${item.nombre_item}</td>
            <td style="${styles.td} text-align:center; font-weight:bold;">${item.stock_actual}</td>
          </tr>
        `).join('') : `<tr><td colspan="2" style="${styles.td} text-align:center;">No hay datos de stock.</td></tr>`}
      </tbody>
    </table>
  `;

  const stockLenceriaHtml = `
    <h2 style="${styles.headerDetalle}">Stock Actual de Lenceria</h2>
    <table style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th}">Articulo</th>
          <th style="${styles.th}">Limpio (Almacen)</th>
          <th style="${styles.th}">En Lavanderia</th>
          <th style="${styles.th}">Stock Total</th>
        </tr>
      </thead>
      <tbody>
        ${(stockLenceria && stockLenceria.length > 0) ? stockLenceria.map(item => `
          <tr>
            <td style="${styles.tdConcepto}">${item.nombre_item}</td>
            <td style="${styles.td} text-align:center; font-weight:bold; color:green;">${item.stock_limpio_almacen || 0}</td>
            <td style="${styles.td} text-align:center; color:#CA8A04;">${item.stock_en_lavanderia || 0}</td>
            <td style="${styles.td} text-align:center; font-weight:bold;">${item.stock_total || 0}</td>
          </tr>
        `).join('') : `<tr><td colspan="4" style="${styles.td} text-align:center;">No hay datos de stock.</td></tr>`}
      </tbody>
    </table>
  `;


  return `
    <body style="${styles.body}">
      <div style="${styles.container}">
        <div style="${styles.hero}">
          <div style="${styles.heroEyebrow}">Gestion de Hotel</div>
          <h1 style="${styles.heroTitle}">Cierre de Caja</h1>
          <p style="${styles.heroSubtitle}">Resumen financiero, movimientos y control de entregas del turno.</p>
          <table role="presentation" style="${styles.metaTable}">
            <tr>
              <td style="width:50%; vertical-align:top;">
                <div style="${styles.metaLabel}">Realizado por</div>
                <div style="${styles.metaValue}">${usuarioNombre}</div>
              </td>
              <td style="width:50%; vertical-align:top; text-align:right;">
                <div style="${styles.metaLabel}">Fecha de cierre</div>
                <div style="${styles.metaValue}">${fechaCierre}</div>
              </td>
            </tr>
          </table>
        </div>

        <div style="${styles.section}">
        ${resumenCardsHtml}
        <div style="${styles.infoBox}">
          <strong>Como leer este reporte:</strong> la <strong>apertura de caja</strong> es la base inicial del turno. El <strong>dinero generado en el turno</strong> muestra solo ingresos menos egresos. El <strong>balance total incluyendo apertura</strong> incluye la apertura mas el dinero generado en el turno.
        </div>
        
        ${alertaDescuadreHtml}
        <table style="${styles.table}">
          <thead>
            <tr>
              <th style="${styles.th}">Concepto</th>
              <th style="${styles.th}">No. Ventas</th>
              <th style="${styles.th}">Transac.</th>
              ${thMetodos}
              <th style="${styles.th} text-align:right;">Totales</th>
            </tr>
          </thead>
          <tbody>
            <tr>
               <td style="${styles.tdConcepto}">Apertura de caja (base inicial):</td>
               <td style="${styles.td} text-align:center;">-</td>
               <td style="${styles.td} text-align:center;">-</td>
               ${metodosDePago.map(() => `<td style="${styles.td}">-</td>`).join('')}
               <td style="${styles.tdTotal}">${formatCurrency(reporte.apertura)}</td>
            </tr>
            <tr>
              <td style="${styles.tdConcepto}">HABITACIONES:</td>
              <td style="${styles.td} text-align:center;">${reporte.habitaciones.ventas}</td>
              <td style="${styles.td} text-align:center;">${reporte.habitaciones.transacciones}</td>
              ${generarCeldasFila(reporte.habitaciones)}
              <td style="${styles.tdTotal}">${formatCurrency(calcularTotalCategoria(reporte.habitaciones))}</td>
            </tr>
            <tr>
              <td style="${styles.tdConcepto}">COCINA:</td>
              <td style="${styles.td} text-align:center;">${reporte.cocina.ventas}</td>
              <td style="${styles.td} text-align:center;">${reporte.cocina.transacciones}</td>
              ${generarCeldasFila(reporte.cocina)}
              <td style="${styles.tdTotal}">${formatCurrency(calcularTotalCategoria(reporte.cocina))}</td>
            </tr>
            <tr>
              <td style="${styles.tdConcepto}">TIENDA:</td>
              <td style="${styles.td} text-align:center;">${reporte.tienda.ventas}</td>
              <td style="${styles.td} text-align:center;">${reporte.tienda.transacciones}</td>
              ${generarCeldasFila(reporte.tienda)}
              <td style="${styles.tdTotal}">${formatCurrency(calcularTotalCategoria(reporte.tienda))}</td>
            </tr>
            <tr>
              <td style="${styles.tdTotalConcepto}">Ingresos del turno:</td>
              <td style="${styles.tdTotal} text-align:center;">${reporte.habitaciones.ventas + reporte.cocina.ventas + reporte.tienda.ventas}</td>
              <td style="${styles.tdTotal} text-align:center;">${reporte.habitaciones.transacciones + reporte.cocina.transacciones + reporte.tienda.transacciones}</td>
              ${tdTotalesIngresos}
              <td style="${styles.tdTotal}">${formatCurrency(totalIngresos)}</td>
            </tr>
            <tr>
              <td style="${styles.tdTotalConcepto}">Egresos del turno:</td>
              <td style="${styles.tdTotal} text-align:center;">-</td>
              <td style="${styles.tdTotal} text-align:center;">${reporte.gastos.transacciones}</td>
              ${tdTotalesGastos}
              <td style="${styles.tdTotal} color:red;">(${formatCurrency(totalGastos)})</td>
            </tr>
             <tr>
              <td style="${styles.tdTotalConcepto}">Dinero generado en el turno:</td>
              <td style="${styles.tdTotal} text-align:center;">-</td>
              <td style="${styles.tdTotal} text-align:center;">${reporte.habitaciones.transacciones + reporte.cocina.transacciones + reporte.tienda.transacciones + reporte.gastos.transacciones}</td>
              ${tdTotalesBalanceOperativo}
              <td style="${styles.tdTotal} background-color:#007bff; color:white;">${formatCurrency(balanceOperativo)}</td>
            </tr>
             <tr>
              <td style="${styles.tdTotalConcepto}">Balance total incluyendo apertura:</td>
              <td style="${styles.tdTotal} text-align:center;">-</td>
              <td style="${styles.tdTotal} text-align:center;">-</td>
              ${tdTotalesEsperadoCaja}
              <td style="${styles.tdTotal} background-color:#0f766e; color:white;">${formatCurrency(saldoEsperadoEnCaja)}</td>
            </tr>
          </tbody>
        </table>
        
        ${detalleCajaHtml}
        ${detalleAmenidadesHtml} 
        ${detalleLenceriaHtml}
        ${detallePrestamosHtml}
        
        ${stockAmenidadesHtml}
        ${stockLenceriaHtml}

        <div style="${styles.footer}">Este es un reporte automatico generado por Gestion de Hotel.</div>
        </div>
      </div>
    </body>`;
}



async function enviarReporteCierreCaja({ asunto, htmlReporte, feedbackEl }) {
  const { data, error } = await currentSupabaseInstance.functions.invoke('send-cash-close-report', {
    body: {
      hotelId: currentHotelId,
      subject: asunto,
      html: htmlReporte,
      fallbackEmail: currentModuleUser?.email || ''
    }
  });
  if (error || !data?.sent) {
    return {
      sent: false,
      reason: data?.reason || 'request_failed'
    };
  }
  return { sent: true };
}

// --- MOUNT / UNMOUNT ---

// En el archivo caja.js

export async function mount(container, supabaseInst, user) {
  unmount();
  currentContainerEl = container;
  currentSupabaseInstance = supabaseInst;
  currentModuleUser = user;

  const { data: perfil } = await supabaseInst
    .from('usuarios')
    .select('hotel_id, rol, nombre, email')
    .eq('id', user.id)
    .single();
  
  currentHotelId = perfil?.hotel_id;
  currentUserRole = perfil?.rol;
  currentModuleUser = {
    ...user,
    nombre: perfil?.nombre || user?.user_metadata?.nombre || user?.nombre || '',
    email: perfil?.email || user?.email || '',
    rol: perfil?.rol || user?.rol || null
  };

  if (!currentHotelId) {
    container.innerHTML = `<div class="p-4 text-red-600">Error: Hotel no identificado.</div>`;
    return;
  }
  container.innerHTML = `<div class="p-8 text-center">Cargando estado de la caja...</div>`;
  await renderizarUI();
}


export function unmount() {
  moduleListeners.forEach(({ element, type, handler }) => {
    element?.removeEventListener(type, handler);
  });
  moduleListeners = [];
  currentSupabaseInstance = null;
  currentHotelId = null;
  currentModuleUser = null;
  currentContainerEl = null;
  currentUserRole = null;
  turnoActivo = null;
  turnoEnSupervision = null;
  turnosAbiertosCache = new Map();
  resetMovementTableState();
}
