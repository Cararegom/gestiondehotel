// js/modules/caja/caja.js
import {
  showError,
  clearFeedback,
  formatCurrency,
  formatDateTime,
  setFormLoadingState,
  showSuccess
} from '../../uiUtils.js';
import { escapeHtml } from '../../security.js';
import {
  createInitialMovementTableState,
  getFilteredMovements as getFilteredMovementsData,
  getTurnElapsedLabel,
  handleMovementTableClick as handleMovementTableClickFlow,
  loadAndRenderMovements as loadAndRenderMovementsFlow,
  renderMovementRows as renderMovementRowsFlow,
  sortMovementsByDate
} from './caja-movimientos.js';
import {
  abrirTurnoFlow,
  cerrarTurnoFlow,
  iniciarModoSupervision as iniciarModoSupervisionFlow,
  salirModoSupervision as salirModoSupervisionFlow,
  verificarTurnoActivo as verificarTurnoActivoFlow
} from './caja-turnos.js';
import {
  calcularTotalesSistemaCierre,
  construirResumenOperativoCierre,
  enviarReporteCierreCaja,
  generarHTMLReporteCierre,
  mostrarResumenCorteDeCaja as mostrarResumenCorteDeCajaFlow,
  popularMetodosPagoSelect as popularMetodosPagoSelectFlow,
  procesarMovimientosParaReporte
} from './caja-cierre.js';
import {
  mostrarLogEliminados as mostrarLogEliminadosPanel,
  mostrarTurnosAbiertos as mostrarTurnosAbiertosPanel
} from './caja-paneles.js';

let moduleListeners = [];
let currentSupabaseInstance = null;
let currentHotelId = null;
let currentModuleUser = null;
let currentContainerEl = null;
let currentUserRole = null;
let turnoActivo = null;
let turnoEnSupervision = null;
let turnosAbiertosCache = new Map();
let movementTableState = createInitialMovementTableState();

const ADMIN_ROLES = ['admin', 'administrador'];

function isAdminUser() {
  return !!(currentUserRole && ADMIN_ROLES.includes(String(currentUserRole).toLowerCase()));
}

function setTurnoActivo(nuevoTurno) {
  turnoActivo = nuevoTurno;
}

function setTurnoEnSupervision(nuevoTurno) {
  turnoEnSupervision = nuevoTurno;
}

function resetMovementTableState() {
  movementTableState = createInitialMovementTableState();
}

function getFilteredMovements() {
  return getFilteredMovementsData(movementTableState);
}

async function iniciarModoSupervision(turno) {
  return iniciarModoSupervisionFlow({
    turno,
    setTurnoEnSupervision,
    renderizarUI
  });
}

async function salirModoSupervision() {
  return salirModoSupervisionFlow({
    setTurnoEnSupervision,
    renderizarUI
  });
}

async function verificarTurnoActivo() {
  return verificarTurnoActivoFlow({
    supabase: currentSupabaseInstance,
    currentModuleUser,
    currentHotelId,
    currentContainerEl
  });
}

async function abrirTurno() {
  return abrirTurnoFlow({
    supabase: currentSupabaseInstance,
    currentHotelId,
    currentModuleUser,
    currentContainerEl,
    renderizarUI,
    setTurnoActivo
  });
}

async function cerrarTurno(turnoExterno = null, usuarioDelTurnoExterno = null, valoresReales = null) {
  return cerrarTurnoFlow({
    turnoExterno,
    usuarioDelTurnoExterno,
    valoresReales,
    turnoActivo,
    currentModuleUser,
    currentHotelId,
    currentContainerEl,
    supabase: currentSupabaseInstance,
    renderizarUI,
    setTurnoActivo,
    setTurnoEnSupervision,
    procesarMovimientosParaReporte,
    calcularTotalesSistemaCierre,
    construirResumenOperativoCierre,
    generarHTMLReporteCierre,
    enviarReporteCierreCaja: ({ asunto, htmlReporte }) => enviarReporteCierreCaja({
      asunto,
      htmlReporte,
      supabase: currentSupabaseInstance,
      hotelId: currentHotelId,
      fallbackEmail: currentModuleUser?.email || ''
    }),
    sortMovementsByDate
  });
}

function renderMovementRows(tBodyEl, summaryEls, movementRefs = {}) {
  return renderMovementRowsFlow({
    tBodyEl,
    summaryEls,
    movementRefs,
    movementTableState,
    isAdminUser: isAdminUser()
  });
}

async function handleMovementTableClick(event, tBodyEl, summaryEls, turnoId, movementRefs = {}) {
  return handleMovementTableClickFlow({
    event,
    tBodyEl,
    summaryEls,
    turnoId,
    movementRefs,
    movementTableState,
    isAdminUser: isAdminUser(),
    supabase: currentSupabaseInstance,
    hotelId: currentHotelId,
    currentModuleUser,
    currentContainerEl
  });
}

async function loadAndRenderMovements(tBodyEl, summaryEls, turnoId, movementRefs = {}) {
  return loadAndRenderMovementsFlow({
    tBodyEl,
    summaryEls,
    turnoId,
    movementRefs,
    movementTableState,
    supabase: currentSupabaseInstance,
    hotelId: currentHotelId,
    currentContainerEl,
    isAdminUser: isAdminUser()
  });
}

async function mostrarLogEliminados() {
  return mostrarLogEliminadosPanel({
    supabase: currentSupabaseInstance
  });
}

async function mostrarTurnosAbiertos(event) {
  return mostrarTurnosAbiertosPanel({
    event,
    supabase: currentSupabaseInstance,
    hotelId: currentHotelId,
    currentModuleUser,
    currentContainerEl,
    turnosAbiertosCache,
    iniciarModoSupervision
  });
}

async function mostrarResumenCorteDeCaja(valoresRealesArqueo = null) {
  return mostrarResumenCorteDeCajaFlow({
    valoresRealesArqueo,
    turnoEnSupervision,
    turnoActivo,
    supabase: currentSupabaseInstance,
    hotelId: currentHotelId,
    currentModuleUser,
    currentContainerEl,
    handleCerrarTurno: cerrarTurno
  });
}

async function popularMetodosPagoSelect(selectEl) {
  return popularMetodosPagoSelectFlow({
    selectEl,
    supabase: currentSupabaseInstance,
    hotelId: currentHotelId
  });
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
