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
  } finally {
    hideGlobalLoading();
  }
}

async function cerrarTurno() {
  if (!turnoActivo) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No hay un turno activo para cerrar.');
    return;
  }
  showGlobalLoading("Realizando cierre de turno...");
  try {
    const { data: movimientos, error: movError } = await currentSupabaseInstance
      .from('caja')
      .select('*, usuarios(nombre), metodos_pago(nombre)')
      .eq('turno_id', turnoActivo.id)
      .order('creado_en', { ascending: true });
    if (movError) throw movError;
    if (movimientos.length === 0) {
      showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No hay movimientos en este turno para generar un reporte.');
      return;
    }
    const totalIngresos = movimientos.filter(m => m.tipo === 'ingreso').reduce((acc, m) => acc + Number(m.monto), 0);
    const totalEgresos = movimientos.filter(m => m.tipo === 'egreso').reduce((acc, m) => acc + Number(m.monto), 0);
    const balance = totalIngresos - totalEgresos;
    const fechaCierre = new Date().toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'short' });
    const usuarioNombre = currentModuleUser?.user_metadata?.nombre_completo || currentModuleUser?.email || 'Usuario del Sistema';
    const htmlReporte = generarHTMLReporteCierre(movimientos, totalIngresos, totalEgresos, balance, usuarioNombre, fechaCierre);
    await enviarReporteCierreCaja({
      asunto: `Cierre de Turno - ${usuarioNombre} - ${fechaCierre}`,
      htmlReporte: htmlReporte,
      feedbackEl: currentContainerEl.querySelector('#turno-global-feedback')
    });
    const { error: updateError } = await currentSupabaseInstance
      .from('turnos')
      .update({
        estado: 'cerrado',
        fecha_cierre: new Date().toISOString(),
        balance_final: balance
      })
      .eq('id', turnoActivo.id);
    if (updateError) throw updateError;
    showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), '¡Turno cerrado y reporte enviado con éxito!');
    turnoActivo = null;
    turnoService.clearActiveTurn();
    await renderizarUI();
  } catch (err) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error en el cierre de turno: ${err.message}`);
  } finally {
    hideGlobalLoading();
  }
}

// --- LÓGICA DE MOVIMIENTOS Y RENDERIZADO ---

async function loadAndRenderMovements(tBodyEl, summaryEls) {
  tBodyEl.innerHTML = `<tr><td colspan="6" class="text-center p-4">Cargando movimientos del turno...</td></tr>`;
  try {
    const { data: movements, error } = await currentSupabaseInstance
      .from('caja')
      .select('id,tipo,monto,concepto,creado_en,usuario_id,usuarios(nombre),metodo_pago_id,metodos_pago(nombre)')
      .eq('hotel_id', currentHotelId)
      .eq('turno_id', turnoActivo.id)
      .order('creado_en', { ascending: false });
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
          const { data: metodosPago } = await currentSupabaseInstance
            .from('metodos_pago')
            .select('id, nombre')
            .eq('hotel_id', currentHotelId)
            .eq('activo', true);

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

  // SUBMIT DEL FORMULARIO
  addFormEl.addEventListener('submit', async (e) => {
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

    if (!(newMovement.monto > 0) || !newMovement.concepto || !newMovement.metodo_pago_id || !newMovement.tipo) {
      showError(addFormEl.querySelector('#turno-add-feedback'), 'Todos los campos son obligatorios.');
      setFormLoadingState(addFormEl, false);
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
  });

  // Botón de cerrar turno
  currentContainerEl.querySelector('#btn-cerrar-turno').addEventListener('click', cerrarTurno);
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
  currentContainerEl.querySelector('#btn-abrir-turno').addEventListener('click', abrirTurno);
}

async function renderizarUI() {
  turnoActivo = await verificarTurnoActivo();
  if (turnoActivo) {
    await renderizarUIAbierta();
  } else {
    renderizarUICerrada();
  }
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

function generarHTMLReporteCierre(movimientos, totalIngresos, totalEgresos, balance, usuarioNombre, fechaCierre) {
  return `
    <h2 style="color:#2061a9; font-family: Arial, sans-serif;">Cierre de Turno - ${fechaCierre}</h2>
    <p style="font-family: Arial, sans-serif;"><b>Realizado por:</b> ${usuarioNombre}</p>
    <table border="1" cellpadding="7" cellspacing="0" style="width:100%;">
      <thead style="background:#f0f0f0;">
        <tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th>Concepto</th><th>Método Pago</th></tr>
      </thead>
      <tbody>
        ${movimientos.map(mv => `
          <tr>
            <td>${formatDateTime(mv.creado_en)}</td>
            <td>${mv.tipo}</td>
            <td style="text-align:right; color: ${mv.tipo === 'ingreso' ? 'green' : 'red'};">${formatCurrency(mv.monto)}</td>
            <td>${mv.concepto || ''}</td>
            <td>${mv.metodos_pago?.nombre || 'N/A'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <p><b>Ingresos totales:</b> ${formatCurrency(totalIngresos)}<br>
       <b>Egresos totales:</b> ${formatCurrency(totalEgresos)}<br>
       <b style="font-size: 1.1em;">Balance del Turno: ${formatCurrency(balance)}</b></p>`;
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
