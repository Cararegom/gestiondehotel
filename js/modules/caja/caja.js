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
  showSuccess
} from '../../uiUtils.js';

let moduleListeners = [];
let currentSupabaseInstance = null;
let currentHotelId = null;
let currentModuleUser = null;
let currentContainerEl = null;
let turnoActivo = null; // Guardará el estado del turno actual

const EMAIL_REPORT_ENDPOINT = "https://hook.us2.make.com/ta2p8lu2ybrevyujf755nmb44ip8u876";

// --- LÓGICA DE TURNOS ---

async function verificarTurnoActivo() {
  if (!currentModuleUser?.id || !currentHotelId) return null;
  const { data, error } = await currentSupabaseInstance
    .from('turnos')
    .select('*')
    .eq('usuario_id', currentModuleUser.id)
    .eq('hotel_id', currentHotelId)
    .eq('estado', 'abierto')
    .maybeSingle();
  if (error) {
    console.error("Error verificando turno activo:", error);
    showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No se pudo verificar el estado del turno.');
    return null;
  }
  if (data) {
    turnoService.setActiveTurn(data.id);
  }
  return data;
}

async function abrirTurno() {
  const montoInicialStr = prompt("¿Cuál es el monto inicial de caja?");
  const montoInicial = parseFloat(montoInicialStr);
  if (isNaN(montoInicial) || montoInicial < 0) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), 'Monto inválido. Turno no iniciado.');
    return;
  }
  showGlobalLoading("Abriendo nuevo turno...");
  try {
    const { data: nuevoTurno, error } = await currentSupabaseInstance
      .from('turnos')
      .insert({
        usuario_id: currentModuleUser.id,
        hotel_id: currentHotelId,
        estado: 'abierto'
      })
      .select()
      .single();
    if (error) throw error;
    turnoActivo = nuevoTurno;
    turnoService.setActiveTurn(turnoActivo.id);
    await currentSupabaseInstance.from('caja').insert({
      tipo: 'apertura',
      monto: montoInicial,
      concepto: 'Apertura de caja',
      hotel_id: currentHotelId,
      usuario_id: currentModuleUser.id,
      turno_id: turnoActivo.id,
      fecha_movimiento: new Date().toISOString()
    });
    await renderizarUI();
    showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), '¡Turno iniciado con éxito!');
  } catch (err) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error al abrir turno: ${err.message}`);
    await renderizarUI();
  } finally {
    hideGlobalLoading();
  }
}

// REEMPLAZA TU FUNCIÓN cerrarTurno CON ESTA
// REEMPLAZA TU FUNCIÓN cerrarTurno CON ESTA
// Reemplaza tu función actual con esta
async function cerrarTurno() {
  if (!turnoActivo) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No hay un turno activo para cerrar.');
    return;
  }
  showGlobalLoading("Realizando cierre de turno...");
  try {
    const { data: metodosDePago, error: metodosError } = await currentSupabaseInstance
      .from('metodos_pago').select('id, nombre').eq('hotel_id', currentHotelId).eq('activo', true).order('nombre');
    if (metodosError) throw metodosError;

    const { data: movimientos, error: movError } = await currentSupabaseInstance
      .from('caja').select('*, usuarios(nombre), metodos_pago(nombre)').eq('turno_id', turnoActivo.id);
    if (movError) throw movError;

    // Usamos la nueva función centralizada aquí también
    const reporte = procesarMovimientosParaReporte(movimientos);

    // El resto de la lógica de cálculo para el balance final
    const calcularTotalFila = (fila) => Object.values(fila.pagos).reduce((acc, val) => acc + val, 0);
    const totalIngresos = calcularTotalFila(reporte.habitaciones) + calcularTotalFila(reporte.cocina) + calcularTotalFila(reporte.tienda) + calcularTotalFila(reporte.propinas);
    const totalGastos = calcularTotalFila(reporte.gastos);
    const balanceFinalEnCaja = reporte.apertura + totalIngresos - totalGastos;
    
    const fechaCierre = new Date().toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'short' });
    const usuarioNombre = currentModuleUser?.user_metadata?.nombre_completo || currentModuleUser?.email || 'Sistema';

    // Generar y enviar el reporte
    const htmlReporte = generarHTMLReporteCierre(reporte, metodosDePago, usuarioNombre, fechaCierre);
    await enviarReporteCierreCaja({
      asunto: `Cierre de Caja - ${usuarioNombre} - ${fechaCierre}`,
      htmlReporte: htmlReporte,
      feedbackEl: currentContainerEl.querySelector('#turno-global-feedback')
    });

    // Actualizar el estado del turno en la base de datos
    const { error: updateError } = await currentSupabaseInstance.from('turnos').update({
        estado: 'cerrado',
        fecha_cierre: new Date().toISOString(),
        balance_final: balanceFinalEnCaja
      }).eq('id', turnoActivo.id);
    if (updateError) throw updateError;

    showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), '¡Turno cerrado y reporte enviado!');
    turnoActivo = null;
    turnoService.clearActiveTurn();
    await renderizarUI();
  } catch (err) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error en el cierre de turno: ${err.message}`);
  } finally {
    hideGlobalLoading();
  }
}// --- LÓGICA DE MOVIMIENTOS Y RENDERIZADO ---

async function loadAndRenderMovements(tBodyEl, summaryEls) {
  tBodyEl.innerHTML = `<tr><td colspan="6" class="text-center p-4">Cargando movimientos del turno...</td></tr>`;
  try {
    const { data: movements, error } = await currentSupabaseInstance
      .from('caja')
      .select('id,tipo,monto,concepto,creado_en,usuario_id,usuarios(nombre),metodo_pago_id,metodos_pago(nombre)')
      .eq('hotel_id', currentHotelId)
      .eq('turno_id', turnoActivo.id)
      .order('creado_en', { ascending: false });
    console.log('Movimientos recibidos de Supabase:', movements);
    if (error) throw error;
    let ingresos = 0, egresos = 0;
    tBodyEl.innerHTML = '';
    if (!movements || movements.length === 0) {
      tBodyEl.innerHTML = `<tr><td colspan="6" class="text-center p-4">No hay movimientos en este turno.</td></tr>`;
    } else {
      movements.forEach(mv => {
        if (mv.tipo === 'ingreso') ingresos += Number(mv.monto);
        else if (mv.tipo === 'egreso') egresos += Number(mv.monto);
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-50";
        tr.innerHTML = `
          <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${formatDateTime(mv.creado_en)}</td>
          <td class="px-4 py-2 whitespace-nowrap text-sm"><span class="badge ${mv.tipo === 'ingreso' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${mv.tipo}</span></td>
          <td class="px-4 py-2 whitespace-nowrap text-sm font-medium ${mv.tipo === 'ingreso' ? 'text-green-600' : 'text-red-600'}">${formatCurrency(mv.monto)}</td>
          <td class="px-4 py-2 whitespace-normal text-sm text-gray-700">${mv.concepto || 'N/A'}</td>
          <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${mv.usuarios?.nombre || 'Sistema'}</td>
          <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
            ${mv.metodos_pago?.nombre || 'N/A'}
            <button class="ml-2 text-blue-500 hover:underline" data-edit-metodo="${mv.id}">✏️</button>
          </td>
        `;
        tBodyEl.appendChild(tr);
      });

      // --- Agrega el listener para editar método de pago ---
      tBodyEl.querySelectorAll('button[data-edit-metodo]').forEach(btn => {
        btn.onclick = async () => {
          const movimientoId = btn.getAttribute('data-edit-metodo');
          const { data: metodosPago, error: metError } = await currentSupabaseInstance
            .from('metodos_pago')
            .select('id, nombre')
            .eq('hotel_id', currentHotelId)
            .eq('activo', true);

          if (metError || !metodosPago || !metodosPago.length) {
            alert('No hay métodos de pago activos para este hotel.');
            return;
          }

          let selectHtml = '<select id="select-nuevo-metodo-pago" class="input px-2 py-1 rounded-md border border-gray-300">';
          metodosPago.forEach(mp => {
            selectHtml += `<option value="${mp.id}">${mp.nombre}</option>`;
          });
          selectHtml += '</select>';

          const confirmDiv = document.createElement('div');
          confirmDiv.innerHTML = `
            <div class="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-[99999]">
              <div class="bg-white rounded-xl p-6 border-4 border-green-200 shadow-xl w-full max-w-xs text-center">
                <h4 class="text-lg font-bold mb-3">Cambiar método de pago</h4>
                ${selectHtml}
                <div class="mt-4 flex gap-2 justify-center">
                  <button id="btn-confirm-metodo-pago" class="button button-success px-4 py-2 rounded">Guardar</button>
                  <button id="btn-cancel-metodo-pago" class="button button-neutral px-4 py-2 rounded">Cancelar</button>
                </div>
              </div>
            </div>
          `;
          document.body.appendChild(confirmDiv);

          document.getElementById('btn-cancel-metodo-pago').onclick = () => confirmDiv.remove();

          document.getElementById('btn-confirm-metodo-pago').onclick = async () => {
            const nuevoMetodoId = document.getElementById('select-nuevo-metodo-pago').value;
            const { error } = await currentSupabaseInstance
              .from('caja')
              .update({ metodo_pago_id: nuevoMetodoId })
              .eq('id', movimientoId);
            if (error) {
              alert('Error actualizando método de pago: ' + error.message);
            } else {
              confirmDiv.remove();
              await loadAndRenderMovements(tBodyEl, summaryEls);
            }
          };
        };
      });
    }
    const balance = ingresos - egresos;
    summaryEls.ingresos.textContent = formatCurrency(ingresos);
    summaryEls.egresos.textContent = formatCurrency(egresos);
    summaryEls.balance.textContent = formatCurrency(balance);
    summaryEls.balance.className = `text-2xl font-bold ${balance < 0 ? 'text-red-600' : 'text-green-600'}`;
  } catch (err) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error cargando movimientos: ${err.message}`);
  }
}

// --- UI CON CHECKBOX PARA EGRESO FUERA DE TURNO ---

async function renderizarUIAbierta() {
  console.log("renderizarUIAbierta llamado");
  currentContainerEl.innerHTML = `
    <div class="card caja-module shadow-lg rounded-lg">
      <div class="card-header bg-gray-100 p-4 border-b flex justify-between items-center">
        <h2 class="text-xl font-semibold text-gray-800">Turno Activo</h2>
        <button id="btn-cerrar-turno" class="button bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-md shadow-sm">Realizar Corte de Caja</button>
      </div>
      <div class="card-body p-4 md:p-6">
        <div id="turno-global-feedback" role="status" aria-live="polite" class="feedback-message mb-4"></div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 text-center">
          <div class="p-3 bg-green-50 rounded-md shadow">
            <span class="block text-sm text-gray-500">Ingresos del Turno</span>
            <span id="turno-total-ingresos" class="text-2xl font-bold text-green-600">$0.00</span>
          </div>
          <div class="p-3 bg-red-50 rounded-md shadow">
            <span class="block text-sm text-gray-500">Egresos del Turno</span>
            <span id="turno-total-egresos" class="text-2xl font-bold text-red-600">$0.00</span>
          </div>
          <div class="p-3 bg-blue-50 rounded-md shadow">
            <span class="block text-sm text-gray-500">Balance del Turno</span>
            <span id="turno-balance" class="text-2xl font-bold text-blue-600">$0.00</span>
          </div>
        </div>
        <div class="table-container overflow-x-auto mb-6">
          <table class="tabla-estilizada w-full">
            <thead class="bg-gray-50">
              <tr>
                <th>Fecha</th><th>Tipo</th><th>Monto</th><th>Concepto</th><th>Usuario</th><th>Método Pago</th>
              </tr>
            </thead>
            <tbody id="turno-movements-body"></tbody>
          </table>
        </div>
        <hr class="my-6"/>
        <h3 class="text-lg font-semibold text-gray-700 mb-3">Agregar Nuevo Movimiento</h3>
        <form id="turno-add-form" class="form p-4 border rounded-md bg-gray-50 shadow-sm">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
            <div>
              <label>Tipo *</label>
              <select name="tipo" class="form-control" required>
                <option value="">-- Seleccione --</option>
                <option value="ingreso">Ingreso</option>
                <option value="egreso">Egreso</option>
              </select>
            </div>
            <div>
              <label>Monto *</label>
              <input type="number" name="monto" class="form-control" step="0.01" min="0.01" required />
            </div>
            <div>
              <label>Método de Pago *</label>
              <select name="metodoPagoId" class="form-control" required>
                <option value="">Cargando...</option>
              </select>
            </div>
          </div>
          <div class="mb-4">
            <label>Concepto/Descripción *</label>
            <input type="text" name="concepto" class="form-control" required minlength="3" />
          </div>
          <div class="mb-4" style="display:flex;align-items:center;gap:7px;">
            <input type="checkbox" id="egreso-fuera-turno" name="egreso_fuera_turno" style="transform:scale(1.3);">
            <label for="egreso-fuera-turno" style="margin:0;">Registrar egreso fuera del turno/caja</label>
          </div>
          <button type="submit" class="button button-accent">＋ Agregar Movimiento</button>
          <div id="turno-add-feedback" class="feedback-message mt-3"></div>
        </form>
      </div>
    </div>`;

  // --- Limpieza previa de listeners anteriores (si existiera) ---
  moduleListeners.forEach(({ element, type, handler }) => {
    element?.removeEventListener(type, handler);
  });
  moduleListeners = [];

  const tBodyEl = currentContainerEl.querySelector('#turno-movements-body');
  const summaryEls = {
    ingresos: currentContainerEl.querySelector('#turno-total-ingresos'),
    egresos: currentContainerEl.querySelector('#turno-total-egresos'),
    balance: currentContainerEl.querySelector('#turno-balance')
  };
  await loadAndRenderMovements(tBodyEl, summaryEls);

  // POPULAR SELECT MÉTODO DE PAGO
  const addFormEl = currentContainerEl.querySelector('#turno-add-form');
  const metodoPagoSelect = addFormEl.elements.metodoPagoId;
  await popularMetodosPagoSelect(metodoPagoSelect);

  // --- SUBMIT DEL FORMULARIO ---
  const submitHandler = async (e) => {
    e.preventDefault();
    const formData = new FormData(addFormEl);
    const esEgresoFueraTurno = !!formData.get('egreso_fuera_turno');
    let turnoIdToSave = turnoActivo.id;

    // Si tipo es egreso y el checkbox está activo => guardar egreso fuera de turno (turno_id null)
    if (formData.get('tipo') === "egreso" && esEgresoFueraTurno) {
      turnoIdToSave = null;
    }

    const newMovement = {
      tipo: formData.get('tipo'),
      monto: parseFloat(formData.get('monto')),
      concepto: (formData.get('concepto') || '').trim(),
      metodo_pago_id: formData.get('metodoPagoId'),
      usuario_id: currentModuleUser.id,
      hotel_id: currentHotelId,
      turno_id: turnoIdToSave
    };

    setFormLoadingState(addFormEl, true);
    addFormEl.querySelector('button[type="submit"]').disabled = true;

    if (!(newMovement.monto > 0) || !newMovement.concepto || !newMovement.metodo_pago_id || !newMovement.tipo) {
      showError(addFormEl.querySelector('#turno-add-feedback'), 'Todos los campos son obligatorios.');
      setFormLoadingState(addFormEl, false);
      addFormEl.querySelector('button[type="submit"]').disabled = false;
      return;
    }

    const { error } = await currentSupabaseInstance.from('caja').insert(newMovement);
    if (error) {
      showError(addFormEl.querySelector('#turno-add-feedback'), `Error: ${error.message}`);
    } else {
      showSuccess(addFormEl.querySelector('#turno-add-feedback'), 'Movimiento agregado.');
      addFormEl.reset();
      await loadAndRenderMovements(tBodyEl, summaryEls);
    }
    setFormLoadingState(addFormEl, false);
    addFormEl.querySelector('button[type="submit"]').disabled = false;
  };

  addFormEl.addEventListener('submit', submitHandler);
  moduleListeners.push({ element: addFormEl, type: 'submit', handler: submitHandler });

  // --- Botón de cerrar turno (ahora abre el resumen/modal) ---
  const cerrarTurnoBtn = currentContainerEl.querySelector('#btn-cerrar-turno');
  const resumenCorteHandler = () => mostrarResumenCorteDeCaja();
  cerrarTurnoBtn.addEventListener('click', resumenCorteHandler);
  moduleListeners.push({ element: cerrarTurnoBtn, type: 'click', handler: resumenCorteHandler });
}

function renderizarUICerrada() {
  currentContainerEl.innerHTML = `
    <div class="card shadow-lg rounded-lg">
      <div class="card-body p-6 text-center">
        <div id="turno-global-feedback" class="feedback-message mb-4"></div>
        <h2 class="text-2xl font-semibold text-gray-700 mb-4">La caja está cerrada</h2>
        <p class="text-gray-500 mb-6">No hay un turno activo. Para registrar ingresos o egresos, por favor, inicia un nuevo turno.</p>
        <button id="btn-abrir-turno" class="button button-primary button-lg py-3 px-6 text-lg">Abrir Turno</button>
      </div>
    </div>`;
  const abrirTurnoBtn = currentContainerEl.querySelector('#btn-abrir-turno');
  abrirTurnoBtn.addEventListener('click', abrirTurno);
  moduleListeners.push({ element: abrirTurnoBtn, type: 'click', handler: abrirTurnoBtn });
}

async function renderizarUI() {
  console.log("renderizarUI llamado");
  turnoActivo = await verificarTurnoActivo();
  if (turnoActivo) {
    await renderizarUIAbierta();
  } else {
    renderizarUICerrada();
  }
}

// --- MODAL DE RESUMEN DE CAJA ANTES DE CORTE (CON IMPRESIÓN ADAPTABLE) ---

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
    
    // --- INICIO DE LA LÓGICA CORREGIDA ---
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
    // --- FIN DE LA LÓGICA CORREGIDA ---

    if (categoria) {
      categoria.pagos[nombreMetodo] = (categoria.pagos[nombreMetodo] || 0) + monto;
    }
  });

  return reporte;
}
// Reemplaza tu función actual con esta
// En caja.js, reemplaza tu función mostrarResumenCorteDeCaja con esta versión completa:

async function mostrarResumenCorteDeCaja() {
  showGlobalLoading('Cargando resumen del turno...');
  try {
    // 1. OBTENCIÓN DE DATOS (Esta parte es correcta)
    const { data: metodosDePago, error: metodosError } = await currentSupabaseInstance.from('metodos_pago').select('id, nombre').eq('hotel_id', currentHotelId).eq('activo', true).order('nombre', { ascending: true });
    if (metodosError) throw new Error("No se encontraron métodos de pago activos.");

    const { data: configHotel } = await currentSupabaseInstance.from('configuracion_hotel').select('logo_url, nombre_hotel, direccion_fiscal, nit_rut, razon_social, tipo_impresora, tamano_papel, encabezado_ticket, pie_ticket, mostrar_logo').eq('hotel_id', currentHotelId).maybeSingle();
    
    const { data: movimientos, error: movError } = await currentSupabaseInstance.from('caja').select('*, usuarios(nombre), metodos_pago(nombre)').eq('turno_id', turnoActivo.id).order('creado_en', { ascending: true });
    if (movError) throw movError;
    if (!movimientos || movimientos.length === 0) {
      showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No hay movimientos para generar un resumen.');
      hideGlobalLoading();
      return;
    }

    // 2. PROCESAMIENTO DE DATOS (Esta parte también es correcta)
    const reporte = procesarMovimientosParaReporte(movimientos);

    const calcularTotalFila = (fila) => Object.values(fila.pagos).reduce((acc, val) => acc + val, 0);
    const totalesPorMetodo = {};
    metodosDePago.forEach(metodo => {
      const nombreMetodo = metodo.nombre;
      const totalIngreso = (reporte.habitaciones.pagos[nombreMetodo] || 0) + (reporte.cocina.pagos[nombreMetodo] || 0) + (reporte.tienda.pagos[nombreMetodo] || 0) + (reporte.propinas.pagos[nombreMetodo] || 0);
      const totalGasto = reporte.gastos.pagos[nombreMetodo] || 0;
      totalesPorMetodo[nombreMetodo] = { ingreso: totalIngreso, gasto: totalGasto, balance: totalIngreso - totalGasto };
    });
    const totalIngresos = calcularTotalFila(reporte.habitaciones) + calcularTotalFila(reporte.cocina) + calcularTotalFila(reporte.tienda) + calcularTotalFila(reporte.propinas);
    const totalGastos = calcularTotalFila(reporte.gastos);
    const balanceFinal = totalIngresos - totalGastos;
    
    // Preparación de celdas para la tabla HTML
    const thMetodos = metodosDePago.map(m => `<th class="px-3 py-2 text-right">${m.nombre}</th>`).join('');
    const generarCeldasFila = (fila) => metodosDePago.map(m => `<td class="px-3 py-2 text-right">${formatCurrency(fila.pagos[m.nombre] || 0)}</td>`).join('');
    const tdTotalesIngresos = metodosDePago.map(m => `<td class="px-3 py-2 text-right">${formatCurrency(totalesPorMetodo[m.nombre].ingreso)}</td>`).join('');
    const tdTotalesGastos = metodosDePago.map(m => `<td class="px-3 py-2 text-right text-red-700">(${formatCurrency(totalesPorMetodo[m.nombre].gasto)})</td>`).join('');
    const tdTotalesBalance = metodosDePago.map(m => `<td class="px-3 py-2 text-right text-blue-800">${formatCurrency(totalesPorMetodo[m.nombre].balance)}</td>`).join('');
    
    // 3. GENERACIÓN DEL HTML DEL MODAL (Esta era la parte que faltaba)
    const modalHtml = `
      <div class="bg-white p-0 rounded-2xl shadow-2xl w-full max-w-fit mx-auto border border-slate-200 relative animate-fade-in-down">
        <div class="py-5 px-8 border-b rounded-t-2xl bg-gradient-to-r from-blue-100 to-green-100 flex items-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M15 21v-1.5a.5.5 0 00-.5-.5H9.5a.5.5 0 00-.5.5V21M6 10.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm9 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" /></svg>
          <h2 class="text-2xl font-bold text-slate-800 ml-2">Resumen de Corte de Caja</h2>
        </div>
        <div class="p-4 md:p-6 space-y-3">
          <div id="print-corte-caja" class="overflow-x-auto">
            <table class="tabla-estilizada w-full text-sm">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-3 py-2 text-left">Concepto</th>
                  <th class="px-3 py-2 text-center">N° Transac.</th>
                  ${thMetodos}
                  <th class="px-3 py-2 text-right">Totales</th>
                </tr>
              </thead>
              <tbody>
                <tr><td class="px-3 py-2 font-medium">HABITACIONES:</td><td class="px-3 py-2 text-center">${reporte.habitaciones.transacciones}</td>${generarCeldasFila(reporte.habitaciones)}<td class="px-3 py-2 text-right font-bold bg-gray-50">${formatCurrency(calcularTotalFila(reporte.habitaciones))}</td></tr>
                <tr><td class="px-3 py-2 font-medium">COCINA:</td><td class="px-3 py-2 text-center">${reporte.cocina.transacciones}</td>${generarCeldasFila(reporte.cocina)}<td class="px-3 py-2 text-right font-bold bg-gray-50">${formatCurrency(calcularTotalFila(reporte.cocina))}</td></tr>
                <tr><td class="px-3 py-2 font-medium">TIENDA:</td><td class="px-3 py-2 text-center">${reporte.tienda.transacciones}</td>${generarCeldasFila(reporte.tienda)}<td class="px-3 py-2 text-right font-bold bg-gray-50">${formatCurrency(calcularTotalFila(reporte.tienda))}</td></tr>
                <tr class="bg-gray-100 font-bold"><td class="px-3 py-2">Ingresos Totales:</td><td class="px-3 py-2 text-center">${reporte.habitaciones.transacciones + reporte.cocina.transacciones + reporte.tienda.transacciones}</td>${tdTotalesIngresos}<td class="px-3 py-2 text-right">${formatCurrency(totalIngresos)}</td></tr>
                <tr class="bg-red-50 font-bold"><td class="px-3 py-2 text-red-700">Gastos Totales:</td><td class="px-3 py-2 text-center text-red-700">${reporte.gastos.transacciones}</td>${tdTotalesGastos}<td class="px-3 py-2 text-right text-red-700">(${formatCurrency(totalGastos)})</td></tr>
                <tr class="bg-blue-100 font-extrabold text-base"><td class="px-3 py-2 text-blue-800">Balance Final:</td><td class="px-3 py-2 text-center">${reporte.habitaciones.transacciones + reporte.cocina.transacciones + reporte.tienda.transacciones + reporte.gastos.transacciones}</td>${tdTotalesBalance}<td class="px-3 py-2 text-right text-blue-800">${formatCurrency(balanceFinal)}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="flex flex-col md:flex-row justify-end gap-3 mt-6">
            <button id="btn-imprimir-corte-caja" class="px-4 py-2 rounded-lg bg-slate-100 hover:bg-blue-100 text-blue-800 font-semibold transition order-2 md:order-1">🖨️ Imprimir</button>
            <button id="btn-cancelar-corte-caja" class="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold transition order-1 md:order-2">Cancelar</button>
            <button id="btn-confirmar-corte-caja" class="px-4 py-2 rounded-lg bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-700 text-white font-bold shadow transition order-3">Confirmar Corte y Enviar</button>
          </div>
        </div>
      </div>
    `;

    // 4. RENDERIZADO DEL MODAL Y EVENTOS
    const modal = document.createElement('div');
    modal.id = "modal-corte-caja";
    modal.className = "fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-50 p-4";
    modal.innerHTML = modalHtml;
    document.body.appendChild(modal);

    hideGlobalLoading(); // Se oculta el loader porque el modal ya se mostró

    modal.querySelector('#btn-cancelar-corte-caja').onclick = () => modal.remove();
    
    modal.querySelector('#btn-confirmar-corte-caja').onclick = async () => {
      modal.remove();
      await cerrarTurno(); // Llama a la función de cierre que ya tiene la lógica correcta
    };

    modal.querySelector('#btn-imprimir-corte-caja').onclick = () => {
        const ingresosPorMetodo = {};
        metodosDePago.forEach(m => { ingresosPorMetodo[m.nombre] = totalesPorMetodo[m.nombre]?.ingreso || 0 });
        const egresosPorMetodo = {};
        metodosDePago.forEach(m => { egresosPorMetodo[m.nombre] = totalesPorMetodo[m.nombre]?.gasto || 0 });
      
        imprimirCorteCajaAdaptable(configHotel, movimientos, totalIngresos, totalGastos, balanceFinal, ingresosPorMetodo, egresosPorMetodo);
    };
    
  } catch (e) {
    hideGlobalLoading(); // Importantísimo ocultar el loader si hay un error
    showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error generando el resumen: ${e.message}`);
    console.error('Error en mostrarResumenCorteDeCaja:', e);
  }
}

// --- IMPRESIÓN ADAPTABLE POR TIPO DE IMPRESORA ---
function imprimirCorteCajaAdaptable(config, movimientos, ingresos, egresos, balance, ingresosPorMetodo, egresosPorMetodo) {
  let tamano = (config?.tamano_papel || '').toLowerCase();
  let tipo = (config?.tipo_impresora || '').toLowerCase();
  console.log('Tamaño papel recibido:', tamano);
  let esTermica = tipo === 'termica' || ['58mm', '80mm'].includes(tamano);

  // --- Header personalizable ---
  let encabezado = config?.encabezado_ticket || '';
  let pie = config?.pie_ticket || '';
  let logoUrl = config?.mostrar_logo !== false && config?.logo_url ? config.logo_url : null;
  let hotelNombre = config?.nombre_hotel || '';
  let direccion = config?.direccion_fiscal || '';
  let nit = config?.nit_rut || '';
  let razon = config?.razon_social || '';

  let style = '';
  let html = '';
  let anchoMax = '100%';

  // === NUEVO FORMATO 58mm ===
  if (tamano === '58mm') {
    anchoMax = '55mm';
    style = `
      @page { size: 58mm auto; margin: 0; }
      body{font-family:monospace;font-size:11px;max-width:55mm;margin:0;padding:0;}
      .ticket{max-width:55mm;margin:auto;}
      .hotel-title{text-align:center;font-weight:bold;font-size:13px;}
      .info{text-align:center;font-size:10px;}
      .line{border-bottom:1px dashed #444;margin:3px 0;}
      .totales{margin-bottom:2px;}
      .totales b{float:right;}
      ul.resumido{margin:0;padding-left:0;list-style:none;}
      ul.resumido li{display:flex;justify-content:space-between;}
      .movs-table{width:100%;font-size:10px;border-collapse:collapse;}
      .movs-table th,.movs-table td{padding:1px 2px;}
      .pie{text-align:center;margin-top:4px;font-size:10px;}
    `;
    // Solo 5 últimos movimientos
    let movsCortos = movimientos;
    html = `
      <div class="ticket">
        ${logoUrl ? `<div style="text-align:center;margin-bottom:4px;"><img src="${logoUrl}" style="max-width:45mm;max-height:30px;"></div>` : ''}
        <div class="hotel-title">${hotelNombre}</div>
        <div class="info">${direccion ? direccion + '<br/>' : ''}${nit ? 'NIT: ' + nit : ''}${razon ? '<br/>' + razon : ''}</div>
        <div class="line"></div>
        <div style="text-align:center;font-size:12px;"><b>CIERRE DE CAJA</b></div>
        <div style="text-align:center;font-size:10px;">${formatDateTime(new Date())}</div>
        <div class="line"></div>
        <div class="totales">Apertura:<b>${formatCurrency(movsCortos.find(m => m.tipo === 'apertura')?.monto ?? 0)}</b></div>
        <div class="totales">Ingresos:<b>${formatCurrency(ingresos)}</b></div>
        <div class="totales">Egresos:<b>${formatCurrency(egresos)}</b></div>
        <div class="totales">Balance:<b>${formatCurrency(balance)}</b></div>
        <div class="line"></div>
        <div><b>Ingresos x método:</b></div>
        <ul class="resumido">
          ${Object.entries(ingresosPorMetodo).map(([k, v]) => `<li>${k}<b>${formatCurrency(v)}</b></li>`).join('') || '<li>Sin ingresos</li>'}
        </ul>
        <div><b>Egresos x método:</b></div>
        <ul class="resumido">
          ${Object.entries(egresosPorMetodo).map(([k, v]) => `<li>${k}<b>${formatCurrency(v)}</b></li>`).join('') || '<li>Sin egresos</li>'}
        </ul>
        <div class="line"></div>
        <div><b>Movimientos recientes:</b></div>
        <table class="movs-table">
  <tr><th>Fec</th><th>Tp</th><th>Mon</th><th>Conc</th></tr>
  ${movimientos.map(mv => `
    <tr>
      <td>${new Date(mv.creado_en).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' })}</td>
      <td>${mv.tipo.charAt(0).toUpperCase()}</td>
      <td>${formatCurrency(mv.monto)}</td>
      <td>${(mv.concepto || '').slice(0, 11)}</td>
    </tr>
  `).join('')}
</table>
        <div class="line"></div>
        ${pie ? `<div class="pie">${pie}</div>` : ''}
      </div>
    `;
  }
  // === FORMATO PARA 80mm o Carta ===
  else if (tamano === '80mm') {
    anchoMax = '78mm'; style = `
      body{font-family:monospace;font-size:12px;max-width:78mm;margin:0;padding:0;}
      .ticket{max-width:78mm;margin:auto;}
      table{width:100%;font-size:12px;}
      th,td{padding:3px 2px;}
      .title{font-size:15px;}
      .totales span{font-size:13px;}
      .linea{border-bottom:1px dashed #444;margin:4px 0;}
    `;
    html = `
      <div class="ticket">
        ${logoUrl ? `<div style="text-align:center;margin-bottom:4px;"><img src="${logoUrl}" style="max-width:70mm;max-height:40px;"></div>` : ''}
        <div class="title" style="text-align:center;font-weight:bold;">${hotelNombre}</div>
        <div style="text-align:center;">${direccion}${direccion ? '<br/>' : ''}${nit ? 'NIT: ' + nit : ''}${razon ? '<br/>' + razon : ''}</div>
        ${encabezado ? `<div style="text-align:center;margin:2px 0 5px 0;">${encabezado}</div>` : ''}
        <div class="linea"></div>
        <div style="font-size:13px;"><b>CIERRE DE CAJA</b></div>
        <div class="linea"></div>
        <div class="totales">
          <span>Ingresos: <b>${formatCurrency(ingresos)}</b></span><br>
          <span>Egresos: <b>${formatCurrency(egresos)}</b></span><br>
          <span>Balance: <b>${formatCurrency(balance)}</b></span>
        </div>
        <div class="linea"></div>
        <div><b>Ingresos por método:</b></div>
        <ul style="margin:0;padding-left:14px;">
          ${Object.entries(ingresosPorMetodo).map(([k, v]) => `<li>${k}: <b>${formatCurrency(v)}</b></li>`).join('')}
        </ul>
        <div><b>Egresos por método:</b></div>
        <ul style="margin:0;padding-left:14px;">
          ${Object.entries(egresosPorMetodo).length === 0 ? '<li>Sin egresos</li>' : Object.entries(egresosPorMetodo).map(([k, v]) => `<li>${k}: <b>${formatCurrency(v)}</b></li>`).join('')}
        </ul>
        <div class="linea"></div>
        <table>
          <thead>
            <tr><th>Fec</th><th>Tp</th><th>Monto</th><th>Concepto</th><th>Método</th></tr>
          </thead>
          <tbody>
            ${movimientos.map(mv => `
              <tr>
                <td>${formatDateTime(mv.creado_en).slice(0, 10)}</td>
                <td>${mv.tipo.charAt(0).toUpperCase()}</td>
                <td style="text-align:right;color:${mv.tipo === 'ingreso' ? '#166534' : '#dc2626'};">${formatCurrency(mv.monto)}</td>
                <td>${mv.concepto || ''}</td>
                <td>${mv.metodos_pago?.nombre || 'N/A'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="linea"></div>
        ${pie ? `<div style="text-align:center;margin-top:6px;">${pie}</div>` : ''}
      </div>
    `;
  } else {
    anchoMax = '850px'; style = `
      body{font-family:'Segoe UI',Arial,sans-serif;font-size:15px;max-width:850px;margin:0 auto;}
      .ticket{max-width:850px;margin:auto;}
      table{width:100%;font-size:15px;}
      th,td{padding:6px 5px;}
      .title{font-size:22px;}
      .totales span{font-size:17px;}
      .linea{border-bottom:1px solid #ccc;margin:10px 0;}
    `;
    html = `
      <div class="ticket">
        ${logoUrl ? `<div style="text-align:center;margin-bottom:8px;"><img src="${logoUrl}" style="max-width:120px;max-height:40px;"></div>` : ''}
        <div class="title" style="text-align:center;font-weight:bold;">${hotelNombre}</div>
        <div style="text-align:center;">${direccion}${direccion ? '<br/>' : ''}${nit ? 'NIT: ' + nit : ''}${razon ? '<br/>' + razon : ''}</div>
        ${encabezado ? `<div style="text-align:center;margin:2px 0 8px 0;">${encabezado}</div>` : ''}
        <div class="linea"></div>
        <div style="font-size:16px;"><b>CIERRE DE CAJA</b></div>
        <div class="linea"></div>
        <div class="totales">
          <span>Ingresos: <b>${formatCurrency(ingresos)}</b></span><br>
          <span>Egresos: <b>${formatCurrency(egresos)}</b></span><br>
          <span>Balance: <b>${formatCurrency(balance)}</b></span>
        </div>
        <div class="linea"></div>
        <div><b>Ingresos por método:</b></div>
        <ul style="margin:0;padding-left:14px;">
          ${Object.entries(ingresosPorMetodo).map(([k, v]) => `<li>${k}: <b>${formatCurrency(v)}</b></li>`).join('')}
        </ul>
        <div><b>Egresos por método:</b></div>
        <ul style="margin:0;padding-left:14px;">
          ${Object.entries(egresosPorMetodo).length === 0 ? '<li>Sin egresos</li>' : Object.entries(egresosPorMetodo).map(([k, v]) => `<li>${k}: <b>${formatCurrency(v)}</b></li>`).join('')}
        </ul>
        <div class="linea"></div>
        <table>
          <thead>
            <tr><th>Fec</th><th>Tp</th><th>Monto</th><th>Concepto</th><th>Método</th></tr>
          </thead>
          <tbody>
            ${movimientos.map(mv => `
              <tr>
                <td>${formatDateTime(mv.creado_en).slice(0, 10)}</td>
                <td>${mv.tipo.charAt(0).toUpperCase()}</td>
                <td style="text-align:right;color:${mv.tipo === 'ingreso' ? '#166534' : '#dc2626'};">${formatCurrency(mv.monto)}</td>
                <td>${mv.concepto || ''}</td>
                <td>${mv.metodos_pago?.nombre || 'N/A'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="linea"></div>
        ${pie ? `<div style="text-align:center;margin-top:6px;">${pie}</div>` : ''}
      </div>
    `;
  }

  // --- Ventana de impresión ---
  let w = window.open('', '', `width=400,height=700`);
  w.document.write(`
    <html>
      <head>
        <title>Corte de Caja</title>
        <style>
          ${style}
          @media print { .no-print {display:none;} }
        </style>
      </head>
      <body>
        ${html}
      </body>
    </html>
  `);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 250);
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
    selectEl.innerHTML = '<option value="" disabled>No hay métodos</option>';
  } else {
    selectEl.innerHTML = `<option value="">-- Seleccione --</option>${data.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('')}`;
    if (data.length === 1) selectEl.value = data[0].id;
  }
}

// REEMPLAZA TU FUNCIÓN generarHTMLReporteCierre CON ESTA
// REEMPLAZA TU FUNCIÓN generarHTMLReporteCierre CON ESTA
function generarHTMLReporteCierre(reporte, metodosDePago, usuarioNombre, fechaCierre) {
  // --- LÓGICA DE CÁLCULO Y GENERACIÓN DINÁMICA ---
  const calcularTotalFila = (fila) => Object.values(fila.pagos).reduce((acc, val) => acc + val, 0);

  const totalesPorMetodo = {};
  metodosDePago.forEach(metodo => {
    const nombreMetodo = metodo.nombre;
    const totalIngreso = (reporte.habitaciones.pagos[nombreMetodo] || 0) +
                         (reporte.cocina.pagos[nombreMetodo] || 0) +
                         (reporte.tienda.pagos[nombreMetodo] || 0) +
                         (reporte.propinas.pagos[nombreMetodo] || 0);
    const totalGasto = reporte.gastos.pagos[nombreMetodo] || 0;
    totalesPorMetodo[nombreMetodo] = { ingreso: totalIngreso, gasto: totalGasto, balance: totalIngreso - totalGasto };
  });

  const totalIngresos = Object.values(totalesPorMetodo).reduce((acc, val) => acc + val.ingreso, 0);
  const totalGastos = Object.values(totalesPorMetodo).reduce((acc, val) => acc + val.gasto, 0);
  const balanceFinal = totalIngresos - totalGastos;

  const styles = {
    body: `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; color: #333; background-color: #f8f9fa; margin: 0; padding: 20px;`,
    container: `max-width: fit-content; min-width: 800px; margin: 20px auto; padding: 25px; border: 1px solid #dee2e6; border-radius: 8px; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.05);`,
    header: `color: #212529; font-size: 26px; text-align: center; margin-bottom: 10px; border-bottom: 2px solid #007bff; padding-bottom: 10px;`,
    subHeader: `font-size: 16px; color: #6c757d; text-align: center; margin-bottom: 25px;`,
    table: `width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px;`,
    th: `border: 1px solid #dee2e6; padding: 12px 10px; text-align: left; background-color: #f1f3f5; font-weight: 600;`,
    td: `border: 1px solid #dee2e6; padding: 12px 10px; text-align: right;`,
    tdConcepto: `border: 1px solid #dee2e6; padding: 12px 10px; text-align: left; font-weight: 500;`,
    tdTotal: `border: 1px solid #dee2e6; padding: 12px 10px; text-align: right; font-weight: bold; background-color: #e9ecef;`,
    tdTotalConcepto: `border: 1px solid #dee2e6; padding: 12px 10px; text-align: left; font-weight: bold; background-color: #e9ecef;`,
    footer: `text-align: center; font-size: 12px; color: #adb5bd; margin-top: 30px; padding-top: 15px; border-top: 1px solid #e9ecef;`
  };

  const thMetodos = metodosDePago.map(m => `<th style="${styles.th} text-align:right;">${m.nombre}</th>`).join('');
  const generarCeldasFila = (fila) => metodosDePago.map(m => `<td style="${styles.td}">${formatCurrency(fila.pagos[m.nombre] || 0)}</td>`).join('');
  const tdTotalesIngresos = metodosDePago.map(m => `<td style="${styles.tdTotal}">${formatCurrency(totalesPorMetodo[m.nombre].ingreso)}</td>`).join('');
  const tdTotalesGastos = metodosDePago.map(m => `<td style="${styles.tdTotal} color:red;">(${formatCurrency(totalesPorMetodo[m.nombre].gasto)})</td>`).join('');
  const tdTotalesBalance = metodosDePago.map(m => `<td style="${styles.tdTotal}">${formatCurrency(totalesPorMetodo[m.nombre].balance)}</td>`).join('');
  
  return `
    <body style="${styles.body}">
      <div style="${styles.container}">
        <h1 style="${styles.header}">Reporte de Ingresos y Gastos</h1>
        <p style="${styles.subHeader}">
          <strong>Realizado por:</strong> ${usuarioNombre}<br>
          <strong>Fecha de Cierre:</strong> ${fechaCierre}
        </p>
        
        <table style="${styles.table}">
          <thead>
            <tr>
              <th style="${styles.th}">Concepto</th>
              <th style="${styles.th}">N° Ventas</th>
              <th style="${styles.th}">Transac.</th>
              ${thMetodos}
              <th style="${styles.th} text-align:right;">Totales</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="${styles.tdConcepto}">HABITACIONES:</td>
              <td style="${styles.td} text-align:center;">${reporte.habitaciones.ventas}</td>
              <td style="${styles.td} text-align:center;">${reporte.habitaciones.transacciones}</td>
              ${generarCeldasFila(reporte.habitaciones)}
              <td style="${styles.tdTotal}">${formatCurrency(calcularTotalFila(reporte.habitaciones))}</td>
            </tr>
            <tr>
              <td style="${styles.tdConcepto}">COCINA:</td>
              <td style="${styles.td} text-align:center;">${reporte.cocina.ventas}</td>
              <td style="${styles.td} text-align:center;">${reporte.cocina.transacciones}</td>
              ${generarCeldasFila(reporte.cocina)}
              <td style="${styles.tdTotal}">${formatCurrency(calcularTotalFila(reporte.cocina))}</td>
            </tr>
            <tr>
              <td style="${styles.tdConcepto}">TIENDA:</td>
              <td style="${styles.td} text-align:center;">${reporte.tienda.ventas}</td>
              <td style="${styles.td} text-align:center;">${reporte.tienda.transacciones}</td>
              ${generarCeldasFila(reporte.tienda)}
              <td style="${styles.tdTotal}">${formatCurrency(calcularTotalFila(reporte.tienda))}</td>
            </tr>
            <tr>
              <td style="${styles.tdTotalConcepto}">Ingresos Totales:</td>
              <td style="${styles.tdTotal} text-align:center;">${reporte.habitaciones.ventas + reporte.cocina.ventas + reporte.tienda.ventas}</td>
              <td style="${styles.tdTotal} text-align:center;">${reporte.habitaciones.transacciones + reporte.cocina.transacciones + reporte.tienda.transacciones}</td>
              ${tdTotalesIngresos}
              <td style="${styles.tdTotal}">${formatCurrency(totalIngresos)}</td>
            </tr>
            <tr>
              <td style="${styles.tdTotalConcepto}">Gastos Totales:</td>
              <td style="${styles.tdTotal} text-align:center;">-</td>
              <td style="${styles.tdTotal} text-align:center;">${reporte.gastos.transacciones}</td>
              ${tdTotalesGastos}
              <td style="${styles.tdTotal} color:red;">(${formatCurrency(totalGastos)})</td>
            </tr>
             <tr>
              <td style="${styles.tdTotalConcepto}">Balance Final:</td>
              <td style="${styles.tdTotal} text-align:center;">-</td>
              <td style="${styles.tdTotal} text-align:center;">${reporte.habitaciones.transacciones + reporte.cocina.transacciones + reporte.tienda.transacciones + reporte.gastos.transacciones}</td>
              ${tdTotalesBalance}
              <td style="${styles.tdTotal} background-color:#007bff; color:white;">${formatCurrency(balanceFinal)}</td>
            </tr>
          </tbody>
        </table>
        <div style="${styles.footer}">Este es un reporte automático generado por el sistema.</div>
      </div>
    </body>`;
}
async function enviarReporteCierreCaja({ asunto, htmlReporte, feedbackEl }) {
  const { data: config } = await currentSupabaseInstance
    .from('configuracion_hotel')
    .select('correo_reportes, correo_remitente')
    .eq('hotel_id', currentHotelId)
    .maybeSingle();
  let toCorreos = (config?.correo_reportes || '').trim();
  if (!toCorreos) {
    toCorreos = currentModuleUser.email || "tucorreo@tudominio.com";
  }
  if (!toCorreos || !toCorreos.split(',').some(correo => correo.trim().includes('@'))) {
    showError(feedbackEl, "No hay correo de destino válido para enviar el cierre de caja. Configúralo en Ajustes.");
    return;
  }
  toCorreos = toCorreos.split(',').map(c => c.trim()).filter(c => !!c).join(',');
  const fromCorreo = config?.correo_remitente || "no-reply@gestiondehotel.com";
  const payload = {
    to: toCorreos,
    from: fromCorreo,
    subject: asunto,
    html: htmlReporte
  };
  const response = await fetch(EMAIL_REPORT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    showError(feedbackEl, 'No se pudo enviar el reporte por email.');
  }
}

// --- MOUNT / UNMOUNT ---

export async function mount(container, supabaseInst, user) {
  console.log("MOUNT caja.js llamado");
  unmount();
  currentContainerEl = container;
  currentSupabaseInstance = supabaseInst;
  currentModuleUser = user;
  const { data: perfil } = await supabaseInst.from('usuarios').select('hotel_id').eq('id', user.id).single();
  currentHotelId = perfil?.hotel_id;
  if (!currentHotelId) {
    container.innerHTML = `<div class="p-4 text-red-600">Error: Hotel no identificado.</div>`;
    return;
  }
  container.innerHTML = `<div class="p-8 text-center">Cargando estado de la caja...</div>`;
  await renderizarUI();
}

export function unmount() {
  // Limpia todos los listeners registrados
  moduleListeners.forEach(({ element, type, handler }) => {
    element?.removeEventListener(type, handler);
  });
  moduleListeners = [];
  currentSupabaseInstance = null;
  currentHotelId = null;
  currentModuleUser = null;
  currentContainerEl = null;
  turnoActivo = null;
}
