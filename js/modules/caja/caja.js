// js/modules/caja/caja.js
import {
  showError,
  clearFeedback,
  formatCurrency,
  formatDateTime,
  showGlobalLoading,
  hideGlobalLoading,
  setFormLoadingState 
} from '../../uiUtils.js';
import { registrarEnBitacora } from '../../services/bitacoraservice.js';

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
  console.log("Enviando reporte a Make.com. Payload:", { to: correos, subject: asunto, html: htmlReporte ? 'HTML Presente' : 'HTML Ausente' });
  const btnCierreCaja = currentContainerEl.querySelector('#btn-cierre-caja'); // Obtener referencia al botón
  if (btnCierreCaja) btnCierreCaja.disabled = true; // Deshabilitar botón

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
      const responseText = await response.text(); 
      console.log("Respuesta de Make.com (OK):", responseText);
      showError(feedbackEl, '¡Reporte de cierre de caja enviado exitosamente!', 'success-indicator'); 
    } else {
      const errorData = await response.text();
      console.error('Error de Make.com:', response.status, errorData);
      showError(feedbackEl, `No se pudo enviar el reporte por email (Error ${response.status}): ${errorData}. Revise la consola.`);
    }
  } catch (error) {
    console.error('Error al enviar el reporte a Make.com:', error);
    showError(feedbackEl, 'Error de red al enviar el reporte: ' + error.message);
  } finally {
    if (btnCierreCaja) btnCierreCaja.disabled = false; // Reactivar el botón
  }
}

async function loadAndRenderMovements(
  tBodyEl, supabaseInst, hotelId, feedbackGlobalEl,
  startInputEl, endInputEl, tipoSelectEl,
  spanIngresosEl, spanEgresosEl, spanBalanceEl
) {
  if (!tBodyEl || !supabaseInst || !hotelId || !feedbackGlobalEl || !startInputEl || !endInputEl || !tipoSelectEl || !spanIngresosEl || !spanEgresosEl || !spanBalanceEl) {
      console.error("loadAndRenderMovements: Faltan uno o más elementos DOM o parámetros.");
      if (feedbackGlobalEl) showError(feedbackGlobalEl, "Error interno: No se pueden cargar movimientos (elementos faltantes).");
      return;
  }

  tBodyEl.innerHTML = `<tr><td colspan="6" class="text-center p-1">Cargando movimientos...</td></tr>`;
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
      tBodyEl.innerHTML = `<tr><td colspan="6" class="text-center p-1">No hay movimientos registrados para los filtros seleccionados.</td></tr>`;
    } else {
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
        `;
        tBodyEl.appendChild(tr);
      });
    }

    spanIngresosEl.textContent = formatCurrency(ingresos);
    spanEgresosEl.textContent = formatCurrency(egresos);
    const balance = ingresos - egresos;
    spanBalanceEl.textContent = formatCurrency(balance);
    spanBalanceEl.className = `text-2xl font-bold ${balance < 0 ? 'text-red-600' : 'text-green-600'}`;
  } catch (err) {
    console.error("Error en loadAndRenderMovements:", err);
    tBodyEl.innerHTML = `<tr><td colspan="6" class="text-red-600 text-center p-1">Error al cargar movimientos: ${err.message}</td></tr>`;
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
  console.log("[Caja/mount] Iniciando montaje...");
  unmount(); 

  currentContainerEl = container;
  currentSupabaseInstance = supabaseInst;
  currentModuleUser = user;
  currentHotelId = currentModuleUser?.user_metadata?.hotel_id;

  if (!currentHotelId && currentModuleUser?.id) {
    try {
      const { data: perfil, error: perfilError } = await currentSupabaseInstance
        .from('usuarios').select('hotel_id').eq('id', currentModuleUser.id).single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError;
      currentHotelId = perfil?.hotel_id;
    } catch (err) {
      console.error("Caja Module: Error fetching hotel_id from profile:", err);
    }
  }
  console.log("[Caja/mount] Hotel ID:", currentHotelId);

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

  console.log("[Caja/mount] Botón Cierre Caja encontrado:", btnCierreCaja); 

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
        fecha_movimiento: new Date().toISOString(), // Usar fecha_movimiento
        usuario_id: currentModuleUser.id,
        hotel_id: currentHotelId,
        metodo_pago_id: metodoPagoValue
      };
      const { error } = await currentSupabaseInstance.from('caja').insert([newMovement]);
      if (error) throw error;
      showError(feedbackAddEl, 'Movimiento agregado exitosamente.', 'success-indicator');
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

  const cierreCajaHandler = async () => {
    if (!confirm("¿Está seguro de que desea realizar el cierre de caja? Esta acción enviará el reporte y reseteará la vista de filtros.")) {
        return;
    }
    showGlobalLoading("Realizando cierre de caja...");
    btnCierreCaja.disabled = true;
    
    try {
      const { data: configHotel, error: errConfig } = await currentSupabaseInstance
        .from('configuracion_hotel')
        .select('correo_remitente') 
        .eq('hotel_id', currentHotelId)
        .maybeSingle(); // Usar maybeSingle para que no falle si no hay registro
      
      const correoAdminPrincipal = currentModuleUser?.email; 
      let correosDestino = configHotel?.correo_remitente || correoAdminPrincipal;

      if (!correosDestino) {
          const { data: admins, error: adminsError } = await currentSupabaseInstance
            .from('usuarios')
            .select('correo')
            .eq('hotel_id', currentHotelId)
            .in('rol', ['admin', 'superadmin']); 
          if (adminsError) throw adminsError;
          if (admins && admins.length > 0) {
            correosDestino = admins.map(u => u.correo).join(',');
          } else {
            showError(feedbackGlobalEl, 'No hay correos de administradores configurados para enviar el reporte.');
            hideGlobalLoading();
            btnCierreCaja.disabled = false;
            return;
          }
      }
      
      const { data: movimientos, error: errMov } = await currentSupabaseInstance
        .from('caja')
        .select('*, usuarios(nombre), metodos_pago(nombre)')
        .eq('hotel_id', currentHotelId)
        // Para el reporte, podrías querer los movimientos del día o desde el último cierre.
        // Por ahora, si los filtros de fecha están vacíos, toma todos.
        // Si quieres solo los del día actual para el reporte (independiente de filtros):
        // .gte('creado_en', new Date(new Date().setHours(0,0,0,0)).toISOString())
        // .lt('creado_en', new Date(new Date().setHours(23,59,59,999)).toISOString())
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

      // Resetear la vista a los movimientos del día actual
      const hoy = new Date().toISOString().split('T')[0];
      startInputEl.value = hoy;
      endInputEl.value = hoy;
      tipoSelectEl.value = ''; // Limpiar filtro de tipo
      await loadAndRenderMovements(
        tBodyEl, currentSupabaseInstance, currentHotelId, feedbackGlobalEl,
        startInputEl, endInputEl, tipoSelectEl,
        spanIngresosEl, spanEgresosEl, spanBalanceEl
      );
      showError(feedbackGlobalEl, 'Cierre de caja procesado. La vista muestra los movimientos de hoy.', 'success-indicator');

    } catch (err) {
      console.error('Error en cierre de caja:', err);
      showError(feedbackGlobalEl, 'Error en cierre de caja: ' + err.message);
    } finally {
        hideGlobalLoading();
        btnCierreCaja.disabled = false;
    }
  };
  btnCierreCaja.addEventListener('click', cierreCajaHandler);
  moduleListeners.push({ element: btnCierreCaja, type: 'click', handler: cierreCajaHandler });

  await popularMetodosPagoSelect(addMetodoEl, currentSupabaseInstance, feedbackGlobalEl);
  
  // Carga inicial con filtros de fecha para el día actual
  const hoy = new Date().toISOString().split('T')[0];
  startInputEl.value = hoy;
  endInputEl.value = hoy;
  await loadAndRenderMovements(
    tBodyEl, currentSupabaseInstance, currentHotelId, feedbackGlobalEl,
    startInputEl, endInputEl, tipoSelectEl,
    spanIngresosEl, spanEgresosEl, spanBalanceEl
  );
  console.log("[Caja/mount] Montaje completado.");
}

export function unmount() {
  console.log("[Caja/unmount] Desmontando módulo Caja...");
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
  console.log('Caja module unmounted and listeners cleaned up.');
}
