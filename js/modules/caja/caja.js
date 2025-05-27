// js/modules/caja/caja.js
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

const EMAIL_REPORT_ENDPOINT = "https://hook.us2.make.com/ta2p8lu2ybrevyujf755nmb44ip8u876";

function generarHTMLReporteCierre(movimientos, totalIngresos, totalEgresos, balance, usuarioNombre, fechaCierre) {
  return `
    <h2 style="color:#2061a9; font-family: Arial, sans-serif;">Cierre de Caja - ${fechaCierre}</h2>
    <p style="font-family: Arial, sans-serif;"><b>Realizado por:</b> ${usuarioNombre}</p>
    <table border="1" cellpadding="7" cellspacing="0" style="border-collapse:collapse; width:100%; margin-bottom:20px; font-family: Arial, sans-serif; font-size: 10pt;">
      <thead style="background:#f0f0f0;">
        <tr>
          <th style="text-align:left; padding: 7px;">Fecha</th>
          <th style="text-align:left; padding: 7px;">Tipo</th>
          <th style="text-align:right; padding: 7px;">Monto</th>
          <th style="text-align:left; padding: 7px;">Concepto</th>
          <th style="text-align:left; padding: 7px;">Usuario</th>
          <th style="text-align:left; padding: 7px;">Método Pago</th>
        </tr>
      </thead>
      <tbody>
        ${movimientos.map(mv => `
          <tr>
            <td style="padding: 7px;">${formatDateTime(mv.creado_en)}</td>
            <td style="padding: 7px;">${mv.tipo.charAt(0).toUpperCase() + mv.tipo.slice(1)}</td>
            <td style="text-align:right; padding: 7px; color: ${mv.tipo === 'ingreso' ? 'green' : 'red'};">${formatCurrency(mv.monto)}</td>
            <td style="padding: 7px;">${mv.concepto || ''}</td>
            <td style="padding: 7px;">${mv.usuarios?.nombre || 'Sistema'}</td>
            <td style="padding: 7px;">${mv.metodos_pago?.nombre || 'N/A'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <p style="font-family: Arial, sans-serif;">
      <b>Ingresos totales:</b> ${formatCurrency(totalIngresos)}<br>
      <b>Egresos totales:</b> ${formatCurrency(totalEgresos)}<br>
      <b style="font-size: 1.1em;">Balance: ${formatCurrency(balance)}</b>
    </p>
  `;
}

async function enviarReporteCierreCaja({ correos, asunto, htmlReporte, feedbackEl }) {
  const btnCierreCaja = currentContainerEl.querySelector('#btn-cierre-caja');
  if (btnCierreCaja) btnCierreCaja.disabled = true;
  try {
    const response = await fetch(EMAIL_REPORT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: correos,
        subject: asunto,
        html: htmlReporte
      })
    });
    if (response.ok) {
      showSuccess(feedbackEl, '¡Reporte de cierre de caja enviado exitosamente!', "success-indicator");
    } else {
      const errorData = await response.text();
      showError(feedbackEl, `No se pudo enviar el reporte por email (Error ${response.status}): ${errorData}. Revise la consola.`);
    }
  } catch (error) {
    showError(feedbackEl, 'Error de red al enviar el reporte: ' + error.message);
  } finally {
    if (btnCierreCaja) btnCierreCaja.disabled = false;
  }
}

async function cancelarMovimientoCaja(
  movimientoId, feedbackEl, tBodyEl, supabaseInst, hotelId, feedbackGlobalEl,
  startInputEl, endInputEl, tipoSelectEl, spanIngresosEl, spanEgresosEl, spanBalanceEl
) {
  showGlobalLoading('Cancelando movimiento...');
  try {
    const { error } = await supabaseInst
      .from('caja')
      .delete()
      .eq('id', movimientoId)
      .eq('hotel_id', hotelId);
    if (error) throw error;
    showSuccess(feedbackEl, '¡Movimiento cancelado exitosamente!');
    await loadAndRenderMovements(
      tBodyEl, supabaseInst, hotelId, feedbackGlobalEl,
      startInputEl, endInputEl, tipoSelectEl, spanIngresosEl, spanEgresosEl, spanBalanceEl
    );
  } catch (err) {
    showError(feedbackEl, 'Error al cancelar el movimiento: ' + (err.message || err));
  } finally {
    hideGlobalLoading();
  }
}

async function loadAndRenderMovements(
  tBodyEl, supabaseInst, hotelId, feedbackGlobalEl,
  startInputEl, endInputEl, tipoSelectEl,
  spanIngresosEl, spanEgresosEl, spanBalanceEl
) {
  if (!tBodyEl || !supabaseInst || !hotelId || !feedbackGlobalEl || !startInputEl || !endInputEl || !tipoSelectEl || !spanIngresosEl || !spanEgresosEl || !spanBalanceEl) {
    if (feedbackGlobalEl) showError(feedbackGlobalEl, "Error interno: No se pueden cargar movimientos (elementos faltantes).");
    return;
  }
  tBodyEl.innerHTML = `<tr><td colspan="7" class="text-center p-1">Cargando movimientos...</td></tr>`;
  clearFeedback(feedbackGlobalEl);
  try {
    let query = supabaseInst
      .from('caja')
      .select('id,tipo,monto,concepto,creado_en,usuario_id,usuarios (nombre),metodo_pago_id,metodos_pago (nombre)')
      .eq('hotel_id', hotelId)
      .order('creado_en', { ascending: false });

    if (startInputEl.value) {
      query = query.gte('creado_en', `${startInputEl.value}T00:00:00.000Z`);
    }
    if (endInputEl.value) {
      query = query.lte('creado_en', `${endInputEl.value}T23:59:59.999Z`);
    }
    if (tipoSelectEl.value) {
      query = query.eq('tipo', tipoSelectEl.value);
    }

    const { data: movements, error } = await query;
    if (error) throw error;

    let ingresos = 0, egresos = 0;
    tBodyEl.innerHTML = '';
    if (!movements || movements.length === 0) {
      tBodyEl.innerHTML = `<tr><td colspan="7" class="text-center p-1">No hay movimientos registrados para los filtros seleccionados.</td></tr>`;
    } else {
      // ---- AQUI DETERMINA SI ES ADMIN ----
      const esAdmin = ['admin', 'superadmin'].includes(
        currentModuleUser?.rol || ''
      );
      movements.forEach(mv => {
        if (mv.tipo === 'ingreso') ingresos += Number(mv.monto);
        else if (mv.tipo === 'egreso') egresos += Number(mv.monto);
        const userName = mv.usuarios?.nombre || (mv.usuario_id ? `ID: ${mv.usuario_id.slice(0, 8)}...` : 'Sistema');
        const metodoPagoNombre = mv.metodos_pago?.nombre || 'N/A';
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-50";
        tr.innerHTML = `
          <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${formatDateTime(mv.creado_en)}</td>
          <td class="px-4 py-2 whitespace-nowrap text-sm">
            <span class="badge px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${mv.tipo === 'ingreso' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
              ${mv.tipo.charAt(0).toUpperCase() + mv.tipo.slice(1)}
            </span>
          </td>
          <td class="px-4 py-2 whitespace-nowrap text-sm font-medium ${mv.tipo === 'ingreso' ? 'text-green-600' : 'text-red-600'}">${formatCurrency(mv.monto)}</td>
          <td class="px-4 py-2 whitespace-normal text-sm text-gray-700">${mv.concepto || 'N/A'}</td>
          <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${userName}</td>
          <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${metodoPagoNombre}</td>
          <td class="px-4 py-2 whitespace-nowrap text-sm">
            ${esAdmin && (mv.tipo === 'ingreso' || mv.tipo === 'egreso')
              ? `<button class="btn-cancelar-movimiento px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-700" data-id="${mv.id}">Cancelar</button>`
              : ''
            }
          </td>
        `;
        if (esAdmin && (mv.tipo === 'ingreso' || mv.tipo === 'egreso')) {
          tr.querySelector('.btn-cancelar-movimiento').onclick = async () => {
            if (confirm('¿Seguro que quieres cancelar este movimiento? Esta acción no se puede deshacer.')) {
              await cancelarMovimientoCaja(
                mv.id,
                feedbackGlobalEl,
                tBodyEl,
                supabaseInst,
                hotelId,
                feedbackGlobalEl,
                startInputEl,
                endInputEl,
                tipoSelectEl,
                spanIngresosEl,
                spanEgresosEl,
                spanBalanceEl
              );
            }
          };
        }
        tBodyEl.appendChild(tr);
      });
    }
    spanIngresosEl.textContent = formatCurrency(ingresos);
    spanEgresosEl.textContent = formatCurrency(egresos);
    const balance = ingresos - egresos;
    spanBalanceEl.textContent = formatCurrency(balance);
    spanBalanceEl.className = `text-2xl font-bold ${balance < 0 ? 'text-red-600' : 'text-green-600'}`;
  } catch (err) {
    tBodyEl.innerHTML = `<tr><td colspan="7" class="text-red-600 text-center p-1">Error al cargar movimientos: ${err.message}</td></tr>`;
    showError(feedbackGlobalEl, `Error al cargar datos de caja: ${err.message}`);
  }
}

async function popularMetodosPagoSelect(selectEl, supabaseInst, feedbackGlobalEl) {
  if (!selectEl || !supabaseInst) return;
  selectEl.innerHTML = '<option value="">Cargando métodos...</option>';
  try {
    const { data: metodos, error } = await supabaseInst
      .from('metodos_pago')
      .select('id, nombre')
      .eq('hotel_id', currentHotelId)
      .eq('activo', true)
      .order('nombre');
    if (error) throw error;
    if (metodos && metodos.length > 0) {
      selectEl.innerHTML = `<option value="">-- Seleccione un método --</option>` +
        metodos.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('');
    } else {
      selectEl.innerHTML = `<option value="" disabled>No hay métodos de pago activos.</option>`;
    }
  } catch (err) {
    selectEl.innerHTML = `<option value="" disabled>Error al cargar métodos</option>`;
    showError(feedbackGlobalEl, `No se pudieron cargar los métodos de pago: ${err.message}`);
  }
}

export async function mount(container, supabaseInst, user) {
  unmount();

  currentContainerEl = container;
  currentSupabaseInstance = supabaseInst;
  currentModuleUser = user;

  // --- CONSULTA el rol y hotel_id desde la tabla usuarios ---
  try {
    const { data: usuarioDB, error } = await currentSupabaseInstance
      .from('usuarios')
      .select('rol, hotel_id')
      .eq('correo', currentModuleUser.email)
      .maybeSingle();
    if (!error && usuarioDB) {
      currentModuleUser.rol = usuarioDB.rol;
      currentModuleUser.hotel_id = usuarioDB.hotel_id;
      currentHotelId = usuarioDB.hotel_id;
      console.log("Rol traído de la BD:", currentModuleUser.rol);
      console.log("Hotel_id traído de la BD:", currentModuleUser.hotel_id);
    } else {
      console.warn("No se pudo traer el rol/hotel_id de la BD, usando 'usuario' y hotel_id null por defecto.");
      currentModuleUser.rol = "usuario";
      currentModuleUser.hotel_id = null;
      currentHotelId = null;
    }
  } catch (err) {
    console.warn("Error al consultar el rol/hotel_id de la BD, usando 'usuario' y hotel_id null por defecto.");
    currentModuleUser.rol = "usuario";
    currentModuleUser.hotel_id = null;
    currentHotelId = null;
  }

  // Si sigue vacío, intenta leer de los metadatos
  if (!currentHotelId) {
    currentHotelId = currentModuleUser?.user_metadata?.hotel_id || null;
  }

  // Debug
  console.log("currentModuleUser:", currentModuleUser);
  console.log("currentModuleUser.rol:", currentModuleUser.rol);
  console.log("currentModuleUser.hotel_id:", currentModuleUser.hotel_id);
  console.log("currentHotelId:", currentHotelId);

  // Resto del código igual:
  container.innerHTML = `
    <div class="card caja-module shadow-lg rounded-lg">
      <div class="card-header bg-gray-100 p-4 border-b flex justify-between items-center">
        <h2 class="text-xl font-semibold text-gray-800">Gestión de Caja</h2>
        <button id="btn-cierre-caja" class="button bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-md shadow-sm">Realizar Cierre de Caja</button>
      </div>
      <div class="card-body p-4 md:p-6">
        <div id="caja-global-feedback" role="status" aria-live="polite" class="feedback-message mb-4" style="min-height: 24px;"></div>
        <form id="caja-filtros-form" class="mb-6 p-4 border rounded-md bg-gray-50 shadow-sm">
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-end">
            <div><label for="caja-filter-start" class="block text-sm font-medium text-gray-700">Desde:</label><input type="date" id="caja-filter-start" class="form-control mt-1 text-sm" /></div>
            <div><label for="caja-filter-end" class="block text-sm font-medium text-gray-700">Hasta:</label><input type="date" id="caja-filter-end" class="form-control mt-1 text-sm" /></div>
            <div><label for="caja-filter-tipo" class="block text-sm font-medium text-gray-700">Tipo:</label><select id="caja-filter-tipo" class="form-control mt-1 text-sm"><option value="">Todos</option><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select></div>
            <button type="submit" class="button button-primary py-2 px-4 rounded-md text-sm">Filtrar</button>
          </div>
        </form>
        <div class="caja-resumen grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 text-center">
          <div class="p-3 bg-green-50 rounded-md shadow"><span class="block text-sm text-gray-500">Ingresos Totales</span><span id="caja-total-ingresos" class="text-2xl font-bold text-green-600">$0.00</span></div>
          <div class="p-3 bg-red-50 rounded-md shadow"><span class="block text-sm text-gray-500">Egresos Totales</span><span id="caja-total-egresos" class="text-2xl font-bold text-red-600">$0.00</span></div>
          <div class="p-3 bg-blue-50 rounded-md shadow"><span class="block text-sm text-gray-500">Balance Actual</span><span id="caja-balance" class="text-2xl font-bold text-blue-600">$0.00</span></div>
        </div>
        <div class="table-container overflow-x-auto mb-6">
          <table class="tabla-estilizada w-full min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tipo</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Monto</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Concepto</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Usuario</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Método Pago</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody id="caja-movements-body" class="bg-white divide-y divide-gray-200"></tbody>
          </table>
        </div>
        <hr class="my-6" />
        <h3 class="text-lg font-semibold text-gray-700 mb-3">Agregar Nuevo Movimiento</h3>
        <form id="caja-add-form" class="form p-4 border rounded-md bg-gray-50 shadow-sm" novalidate>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
            <div><label for="caja-add-tipo" class="block text-sm font-medium text-gray-700">Tipo *</label><select id="caja-add-tipo" name="tipo" class="form-control mt-1 text-sm" required><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select></div>
            <div><label for="caja-add-monto" class="block text-sm font-medium text-gray-700">Monto *</label><input type="number" id="caja-add-monto" name="monto" class="form-control mt-1 text-sm" step="0.01" min="0.01" required /></div>
            <div><label for="caja-add-metodo-pago" class="block text-sm font-medium text-gray-700">Método de Pago *</label><select id="caja-add-metodo-pago" name="metodoPagoId" class="form-control mt-1 text-sm" required><option value="">Cargando...</option></select></div>
          </div>
          <div class="form-group mb-4"><label for="caja-add-concepto" class="block text-sm font-medium text-gray-700">Concepto/Descripción * (mín. 3 caracteres)</label><input type="text" id="caja-add-concepto" name="concepto" class="form-control mt-1 text-sm" required minlength="3" /></div>
          <button type="submit" id="caja-btn-add" class="button button-accent py-2 px-4 rounded-md text-sm">＋ Agregar Movimiento</button>
          <div id="caja-add-feedback" role="alert" class="feedback-message mt-3" style="min-height:24px;"></div>
        </form>
      </div>
    </div>
  `;

  const tBodyEl = container.querySelector('#caja-movements-body');
  const spanIngresosEl = container.querySelector('#caja-total-ingresos');
  const spanEgresosEl = container.querySelector('#caja-total-egresos');
  const spanBalanceEl = container.querySelector('#caja-balance');
  const formFiltrosEl = container.querySelector('#caja-filtros-form');
  const startInputEl = container.querySelector('#caja-filter-start');
  const endInputEl = container.querySelector('#caja-filter-end');
  const tipoSelectEl = container.querySelector('#caja-filter-tipo');
  const addFormEl = container.querySelector('#caja-add-form');
  const addMetodoEl = container.querySelector('#caja-add-metodo-pago');
  const btnAddEl = container.querySelector('#caja-btn-add');
  const feedbackAddEl = container.querySelector('#caja-add-feedback');
  const feedbackGlobalEl = container.querySelector('#caja-global-feedback');
  const btnCierreCaja = container.querySelector('#btn-cierre-caja');

  if (!currentHotelId) {
    if (feedbackGlobalEl) showError(feedbackGlobalEl, 'Error: Hotel no identificado. No se pueden cargar los datos de caja.');
    if(formFiltrosEl) formFiltrosEl.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
    if(addFormEl) addFormEl.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
    if(btnCierreCaja) btnCierreCaja.style.display = 'none';
    return;
  }
  if (!tBodyEl || !formFiltrosEl || !addFormEl || !feedbackGlobalEl || !spanIngresosEl || !spanEgresosEl || !spanBalanceEl || !startInputEl || !endInputEl || !tipoSelectEl || !addMetodoEl || !btnAddEl || !feedbackAddEl || !btnCierreCaja) {
    showError(feedbackGlobalEl || container, "Error interno: No se pudo inicializar el módulo de caja (elementos DOM no encontrados).");
    return;
  }

  const addMovementFormSubmitHandler = async (event) => {
    event.preventDefault();
    clearFeedback(feedbackAddEl);
    const originalButtonText = btnAddEl.textContent;
    setFormLoadingState(addFormEl, true, btnAddEl, originalButtonText, 'Agregando...');
    const montoValue = parseFloat(addFormEl.elements.monto.value);
    const conceptoValue = addFormEl.elements.concepto.value.trim();
    const metodoPagoValue = addFormEl.elements.metodoPagoId.value;
    const tipoValue = addFormEl.elements.tipo.value;

    if (isNaN(montoValue) || montoValue <= 0) {
      showError(feedbackAddEl, 'El monto debe ser un número positivo.');
      setFormLoadingState(addFormEl, false, btnAddEl, originalButtonText);
      addFormEl.elements.monto.focus(); return;
    }
    if (!conceptoValue || conceptoValue.length < 3) {
      showError(feedbackAddEl, 'El concepto es obligatorio (mín. 3 caracteres).');
      setFormLoadingState(addFormEl, false, btnAddEl, originalButtonText);
      addFormEl.elements.concepto.focus(); return;
    }
    if (!metodoPagoValue) {
      showError(feedbackAddEl, 'Debe seleccionar un método de pago.');
      setFormLoadingState(addFormEl, false, btnAddEl, originalButtonText);
      addFormEl.elements.metodoPagoId.focus(); return;
    }
    try {
      const newMovement = {
        tipo: tipoValue,
        monto: montoValue,
        concepto: conceptoValue,
        fecha_movimiento: new Date().toISOString(),
        usuario_id: currentModuleUser.id,
        hotel_id: currentHotelId,
        metodo_pago_id: metodoPagoValue
      };
      const { error } = await currentSupabaseInstance.from('caja').insert([newMovement]);
      if (error) throw error;
      showSuccess(feedbackAddEl, 'Movimiento agregado exitosamente.', 'success-indicator');
      setTimeout(() => clearFeedback(feedbackAddEl), 3000);
      addFormEl.reset();
      await loadAndRenderMovements(tBodyEl, currentSupabaseInstance, currentHotelId, feedbackGlobalEl, startInputEl, endInputEl, tipoSelectEl, spanIngresosEl, spanEgresosEl, spanBalanceEl);
    } catch (err) {
      showError(feedbackAddEl, `Error al agregar movimiento: ${err.message}`);
    } finally {
      setFormLoadingState(addFormEl, false, btnAddEl, originalButtonText);
    }
  };
  addFormEl.addEventListener('submit', addMovementFormSubmitHandler);
  moduleListeners.push({ element: addFormEl, type: 'submit', handler: addMovementFormSubmitHandler });

  const filterFormSubmitHandler = (event) => {
    event.preventDefault();
    loadAndRenderMovements(tBodyEl, currentSupabaseInstance, currentHotelId, feedbackGlobalEl, startInputEl, endInputEl, tipoSelectEl, spanIngresosEl, spanEgresosEl, spanBalanceEl);
  };
  formFiltrosEl.addEventListener('submit', filterFormSubmitHandler);
  moduleListeners.push({ element: formFiltrosEl, type: 'submit', handler: filterFormSubmitHandler });

  // --- CIERRE DE CAJA ---
  const cierreCajaHandler = async () => {
    clearFeedback(feedbackGlobalEl);
    feedbackGlobalEl.innerHTML = `
      <div class="p-4 my-3 rounded-md border border-blue-300 bg-blue-50 text-blue-800 font-semibold shadow-sm flex flex-col items-center">
        <span>¿Está seguro de que desea realizar el cierre de caja?<br>
        Esta acción enviará el reporte y reseteará la vista de filtros.</span>
        <div class="flex gap-4 mt-4">
          <button id="btnConfirmCierreCaja" class="px-4 py-2 bg-green-600 text-white rounded">Sí, Cerrar Caja</button>
          <button id="btnCancelarCierreCaja" class="px-4 py-2 bg-gray-300 rounded">Cancelar</button>
        </div>
      </div>
    `;
    feedbackGlobalEl.style.display = "block";
    document.getElementById('btnConfirmCierreCaja').onclick = async () => {
      showGlobalLoading("Realizando cierre de caja...");
      btnCierreCaja.disabled = true;
      try {
        if (!currentHotelId) {
          showError(feedbackGlobalEl, "No se ha definido el Hotel. Por favor, recarga la página o vuelve a iniciar sesión.");
          btnCierreCaja.disabled = false;
          hideGlobalLoading();
          return;
        }
        const { data: configHotel } = await currentSupabaseInstance
          .from('configuracion_hotel')
          .select('correo_remitente')
          .eq('hotel_id', currentHotelId)
          .maybeSingle();
        const correoAdminPrincipal = currentModuleUser?.email;
        let correosDestino = correoAdminPrincipal;
        if (!correosDestino) {
          const { data: admins, error: adminsError } = await currentSupabaseInstance
            .from('usuarios')
            .select('correo')
            .eq('hotel_id', currentHotelId)
            .in('rol', ['admin', 'superadmin']);
          if (adminsError) throw adminsError;
          if (admins && admins.length > 0) {
            correosDestino = admins[0].correo;
          } else {
            showError(feedbackGlobalEl, 'No hay correos de administradores configurados para enviar el reporte.');
            hideGlobalLoading();
            btnCierreCaja.disabled = false;
            return;
          }
        }
        const hoyInicio = new Date();
        hoyInicio.setHours(0, 0, 0, 0);
        const hoyFin = new Date();
        hoyFin.setHours(23, 59, 59, 999);
        const { data: movimientos, error: errMov } = await currentSupabaseInstance
          .from('caja')
          .select('*, usuarios(nombre), metodos_pago(nombre)')
          .eq('hotel_id', currentHotelId)
          .gte('creado_en', hoyInicio.toISOString())
          .lte('creado_en', hoyFin.toISOString())
          .order('creado_en', { ascending: true });
        if (errMov) throw errMov;
        if (!movimientos || movimientos.length === 0) {
          showError(feedbackGlobalEl, 'No hay movimientos para incluir en el cierre de caja.');
          hideGlobalLoading();
          btnCierreCaja.disabled = false;
          return;
        }
        const totalIngresos = movimientos.filter(m => m.tipo === 'ingreso').reduce((acc, m) => acc + Number(m.monto), 0);
        const totalEgresos = movimientos.filter(m => m.tipo === 'egreso').reduce((acc, m) => acc + Number(m.monto), 0);
        const balance = totalIngresos - totalEgresos;
        const fechaHoy = new Date().toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'short' });
        const usuarioNombre = currentModuleUser?.user_metadata?.nombre_completo || currentModuleUser?.email || 'Usuario del Sistema';
        const htmlReporte = generarHTMLReporteCierre(movimientos, totalIngresos, totalEgresos, balance, usuarioNombre, fechaHoy);
        await enviarReporteCierreCaja({
          correos: correosDestino,
          asunto: `Reporte de Cierre de Caja - Hotel [Tu Nombre de Hotel] - ${fechaHoy}`,
          htmlReporte,
          feedbackEl: feedbackGlobalEl
        });
        // Reset vista movimientos del día
        const hoy = new Date().toISOString().split('T')[0];
        startInputEl.value = hoy;
        endInputEl.value = hoy;
        tipoSelectEl.value = '';
        await loadAndRenderMovements(
          tBodyEl, currentSupabaseInstance, currentHotelId, feedbackGlobalEl,
          startInputEl, endInputEl, tipoSelectEl,
          spanIngresosEl, spanEgresosEl, spanBalanceEl
        );
        showSuccess(feedbackGlobalEl, "¡Cierre de caja realizado y enviado correctamente!", "success-indicator");
      } catch (err) {
        showError(feedbackGlobalEl, 'Error en cierre de caja: ' + (err.message || err));
      } finally {
        hideGlobalLoading();
        btnCierreCaja.disabled = false;
      }
    };
    document.getElementById('btnCancelarCierreCaja').onclick = () => {
      clearFeedback(feedbackGlobalEl);
    };
  };
  btnCierreCaja.addEventListener('click', cierreCajaHandler);
  moduleListeners.push({ element: btnCierreCaja, type: 'click', handler: cierreCajaHandler });
  await popularMetodosPagoSelect(addMetodoEl, currentSupabaseInstance, feedbackGlobalEl);
  // Carga inicial para el día actual
  const hoy = new Date().toISOString().split('T')[0];
  startInputEl.value = hoy;
  endInputEl.value = hoy;
  await loadAndRenderMovements(
    tBodyEl, currentSupabaseInstance, currentHotelId, feedbackGlobalEl,
    startInputEl, endInputEl, tipoSelectEl,
    spanIngresosEl, spanEgresosEl, spanBalanceEl
  );
}

export function unmount() {
  moduleListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = [];
  currentSupabaseInstance = null;
  currentHotelId = null;
  currentModuleUser = null;
  currentContainerEl = null;
}
