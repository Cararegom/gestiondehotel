import {
  showError,
  clearFeedback,
  formatCurrency,
  formatDateTime
} from '../../uiUtils.js';

let moduleListeners = [];
let currentSupabaseInstance = null;
let currentHotelId = null;
let currentModuleUser = null;

// URL del Webhook de Make para enviar el correo de cierre
const EMAIL_REPORT_ENDPOINT = "https://hook.us2.make.com/ta2p8lu2ybrevyujf755nmb44ip8u876";

// ---------- Helpers para el reporte ----------
function generarHTMLReporteCierre(movimientos, totalIngresos, totalEgresos, balance, usuario, fechaCierre) {
  return `
    <h2 style="color:#2061a9;">Cierre de caja - ${fechaCierre}</h2>
    <p><b>Realizado por:</b> ${usuario}</p>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%; margin-bottom:20px;">
      <thead style="background:#f3f6fa;">
        <tr>
          <th>Fecha</th>
          <th>Tipo</th>
          <th>Monto</th>
          <th>Concepto</th>
        </tr>
      </thead>
      <tbody>
        ${movimientos.map(mv => `
          <tr>
            <td>${formatDateTime(mv.creado_en)}</td>
            <td>${mv.tipo.charAt(0).toUpperCase() + mv.tipo.slice(1)}</td>
            <td>${formatCurrency(mv.monto)}</td>
            <td>${mv.concepto || ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <b>Ingresos totales:</b> ${formatCurrency(totalIngresos)}<br>
    <b>Egresos totales:</b> ${formatCurrency(totalEgresos)}<br>
    <b>Balance:</b> ${formatCurrency(balance)}<br>
  `;
}

// ---------- Enviar email usando el webhook ----------
async function enviarReporteCierreCaja({ correos, asunto, htmlReporte }) {
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
      alert('¡Reporte de cierre de caja enviado exitosamente!');
    } else {
      alert('No se pudo enviar el reporte por email.');
    }
  } catch (error) {
    alert('Error al enviar el reporte: ' + error.message);
  }
}

// ---------- Render y lógica principal ----------

async function loadAndRenderMovements(
  tBodyEl, supabaseInst, hotelId, feedbackGlobalEl,
  startInputEl, endInputEl, tipoSelectEl,
  spanIngresosEl, spanEgresosEl, spanBalanceEl
) {
  if (!tBodyEl || !supabaseInst || !hotelId) return;

  tBodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-1">Cargando movimientos...</td></tr>`;
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
      tBodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-1">No hay movimientos registrados para los filtros seleccionados.</td></tr>`;
    } else {
      movements.forEach(mv => {
        if (mv.tipo === 'ingreso') ingresos += Number(mv.monto);
        else if (mv.tipo === 'egreso') egresos += Number(mv.monto);

        const userName = mv.usuarios?.nombre || (mv.usuario_id ? `ID: ${mv.usuario_id.slice(0, 8)}...` : 'Desconocido');
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
        `;
        tBodyEl.appendChild(tr);
      });
    }

    spanIngresosEl.textContent = formatCurrency(ingresos);
    spanEgresosEl.textContent = formatCurrency(egresos);
    const balance = ingresos - egresos;
    spanBalanceEl.textContent = formatCurrency(balance);
    spanBalanceEl.className = `font-bold ${balance < 0 ? 'text-red-600' : 'text-green-600'}`;
  } catch (err) {
    tBodyEl.innerHTML = `<tr><td colspan="5" class="text-danger text-center p-1">Error al cargar movimientos: ${err.message}</td></tr>`;
    showError(feedbackGlobalEl, `Error al cargar datos de caja: ${err.message}`);
  }
}

// --- Métodos de pago ---
async function popularMetodosPagoSelect(selectEl, supabaseInst, feedbackGlobalEl) {
  if (!selectEl || !supabaseInst) return;
  selectEl.innerHTML = '<option value="">Cargando métodos...</option>';
  try {
    const { data: metodos, error } = await supabaseInst
      .from('metodos_pago')
      .select('id, nombre')
      .eq('activo', true)
      .order('nombre');

    if (error) throw error;

    if (metodos && metodos.length > 0) {
      selectEl.innerHTML = `<option value="">-- Seleccione un método --</option>` +
        metodos.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('');
    } else {
      selectEl.innerHTML = `<option value="" disabled>No hay métodos de pago configurados</option>`;
    }
  } catch (err) {
    selectEl.innerHTML = `<option value="" disabled>Error al cargar métodos</option>`;
    showError(feedbackGlobalEl, `No se pudieron cargar los métodos de pago: ${err.message}`);
  }
}

// --------- MOUNT PRINCIPAL ---------
export async function mount(container, supabaseInst, user) {
  unmount();

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

  container.innerHTML = `
    <div class="card caja-module shadow-lg rounded-lg">
      <div class="card-header bg-gray-100 p-4 border-b flex justify-between items-center">
        <h2 class="text-xl font-semibold text-gray-800">Gestión de Caja</h2>
        <button id="btn-cierre-caja" class="button button-success px-4 py-2 rounded-md text-white font-bold">Cierre de Caja</button>
      </div>
      <div class="card-body p-4 md:p-6">
        <div id="caja-global-feedback" role="status" aria-live="polite" class="feedback-message mb-4" style="min-height: 24px;"></div>
        
        <form id="caja-filtros-form" class="mb-6 p-4 border rounded-md bg-gray-50 shadow-sm">
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-end">
            <div class="form-group">
              <label for="caja-filter-start" class="block text-sm font-medium text-gray-700">Desde:</label>
              <input type="date" id="caja-filter-start" class="form-control mt-1 text-sm" />
            </div>
            <div class="form-group">
              <label for="caja-filter-end" class="block text-sm font-medium text-gray-700">Hasta:</label>
              <input type="date" id="caja-filter-end" class="form-control mt-1 text-sm" />
            </div>
            <div class="form-group">
              <label for="caja-filter-tipo" class="block text-sm font-medium text-gray-700">Tipo:</label>
              <select id="caja-filter-tipo" class="form-control mt-1 text-sm">
                <option value="">Todos</option>
                <option value="ingreso">Ingreso</option>
                <option value="egreso">Egreso</option>
              </select>
            </div>
            <button type="submit" class="button button-primary py-2 px-4 rounded-md text-sm">Filtrar</button>
          </div>
        </form>

        <div class="caja-resumen grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 text-center">
          <div class="p-3 bg-green-50 rounded-md shadow">
            <span class="block text-sm text-gray-500">Ingresos Totales</span>
            <span id="caja-total-ingresos" class="text-2xl font-bold text-green-600">$0.00</span>
          </div>
          <div class="p-3 bg-red-50 rounded-md shadow">
            <span class="block text-sm text-gray-500">Egresos Totales</span>
            <span id="caja-total-egresos" class="text-2xl font-bold text-red-600">$0.00</span>
          </div>
          <div class="p-3 bg-blue-50 rounded-md shadow">
            <span class="block text-sm text-gray-500">Balance Actual</span>
            <span id="caja-balance" class="text-2xl font-bold text-blue-600">$0.00</span>
          </div>
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
              </tr>
            </thead>
            <tbody id="caja-movements-body" class="bg-white divide-y divide-gray-200"></tbody>
          </table>
        </div>

        <hr class="my-6" />
        <h3 class="text-lg font-semibold text-gray-700 mb-3">Agregar Nuevo Movimiento</h3>
        <form id="caja-add-form" class="form p-4 border rounded-md bg-gray-50 shadow-sm" novalidate>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
            <div class="form-group">
              <label for="caja-add-tipo" class="block text-sm font-medium text-gray-700">Tipo *</label>
              <select id="caja-add-tipo" name="tipo" class="form-control mt-1 text-sm" required>
                <option value="ingreso">Ingreso</option>
                <option value="egreso">Egreso</option>
              </select>
            </div>
            <div class="form-group">
              <label for="caja-add-monto" class="block text-sm font-medium text-gray-700">Monto *</label>
              <input type="number" id="caja-add-monto" name="monto" class="form-control mt-1 text-sm" step="0.01" min="0.01" required />
            </div>
            <div class="form-group">
              <label for="caja-add-metodo-pago" class="block text-sm font-medium text-gray-700">Método de Pago *</label>
              <select id="caja-add-metodo-pago" name="metodoPagoId" class="form-control mt-1 text-sm" required>
                <option value="">Cargando...</option>
              </select>
            </div>
          </div>
          <div class="form-group mb-4">
            <label for="caja-add-concepto" class="block text-sm font-medium text-gray-700">Concepto/Descripción * (mín. 3 caracteres)</label>
            <input type="text" id="caja-add-concepto" name="concepto" class="form-control mt-1 text-sm" required minlength="3" />
          </div>
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
  const addTipoEl = container.querySelector('#caja-add-tipo');
  const addMontoEl = container.querySelector('#caja-add-monto');
  const addConceptoEl = container.querySelector('#caja-add-concepto');
  const addMetodoEl = container.querySelector('#caja-add-metodo-pago');
  const btnAddEl = container.querySelector('#caja-btn-add');
  const feedbackAddEl = container.querySelector('#caja-add-feedback');
  const feedbackGlobalEl = container.querySelector('#caja-global-feedback');
  const btnCierreCaja = container.querySelector('#btn-cierre-caja');

  if (!currentHotelId) {
    if (feedbackGlobalEl) showError(feedbackGlobalEl, 'Error: Hotel no identificado para el usuario. No se pueden cargar los datos de caja.');
    if(formFiltrosEl) formFiltrosEl.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
    if(addFormEl) addFormEl.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
    return;
  }
  if (!tBodyEl || !formFiltrosEl || !addFormEl || !feedbackGlobalEl || !spanIngresosEl || !spanEgresosEl || !spanBalanceEl || !startInputEl || !endInputEl || !tipoSelectEl || !addMetodoEl || !btnAddEl || !feedbackAddEl) {
    showError(feedbackGlobalEl || container, "Error interno: No se pudo inicializar el módulo de caja (elementos no encontrados).");
    return;
  }

  // Manejar agregar nuevo movimiento
  const addMovementFormSubmitHandler = async (event) => {
    event.preventDefault();
    clearFeedback(feedbackAddEl);

    const montoValue = parseFloat(addMontoEl.value);
    const conceptoValue = addConceptoEl.value.trim();
    const metodoPagoValue = addMetodoEl.value;

    if (isNaN(montoValue) || montoValue <= 0) {
      showError(feedbackAddEl, 'El monto debe ser un número positivo.');
      addMontoEl.focus();
      return;
    }
    if (!conceptoValue || conceptoValue.length < 3) {
      showError(feedbackAddEl, 'El concepto es obligatorio y debe tener al menos 3 caracteres.');
      addConceptoEl.focus();
      return;
    }
    if (!metodoPagoValue) {
      showError(feedbackAddEl, 'Debe seleccionar un método de pago.');
      addMetodoEl.focus();
      return;
    }

    btnAddEl.disabled = true;
    btnAddEl.textContent = 'Agregando...';

    try {
      const newMovement = {
        tipo: addTipoEl.value,
        monto: montoValue,
        concepto: conceptoValue,
        creado_en: new Date().toISOString(),
        usuario_id: currentModuleUser.id,
        hotel_id: currentHotelId,
        metodo_pago_id: metodoPagoValue
      };

      const { error } = await currentSupabaseInstance.from('caja').insert([newMovement]);
      if (error) throw error;

      showError(feedbackAddEl, 'Movimiento agregado exitosamente.', 'success-indicator');
      setTimeout(() => clearFeedback(feedbackAddEl), 3000);
      
      addFormEl.reset();
      await loadAndRenderMovements(
        tBodyEl, currentSupabaseInstance, currentHotelId, feedbackGlobalEl,
        startInputEl, endInputEl, tipoSelectEl,
        spanIngresosEl, spanEgresosEl, spanBalanceEl
      );
    } catch (err) {
      showError(feedbackAddEl, `Error al agregar movimiento: ${err.message}`);
    } finally {
      btnAddEl.disabled = false;
      btnAddEl.textContent = '＋ Agregar Movimiento';
    }
  };
  addFormEl.addEventListener('submit', addMovementFormSubmitHandler);
  moduleListeners.push({ element: addFormEl, type: 'submit', handler: addMovementFormSubmitHandler });

  // Filtrar movimientos
  const filterFormSubmitHandler = (event) => {
    event.preventDefault();
    loadAndRenderMovements(
      tBodyEl, currentSupabaseInstance, currentHotelId, feedbackGlobalEl,
      startInputEl, endInputEl, tipoSelectEl,
      spanIngresosEl, spanEgresosEl, spanBalanceEl
    );
  };
  formFiltrosEl.addEventListener('submit', filterFormSubmitHandler);
  moduleListeners.push({ element: formFiltrosEl, type: 'submit', handler: filterFormSubmitHandler });

  // Cierre de caja (nuevo)
  const cierreCajaHandler = async () => {
    try {
      // Obtener todos los movimientos de la caja desde el último cierre (o todos)
      const { data: movimientos, error } = await currentSupabaseInstance
        .from('caja')
        .select('*')
        .eq('hotel_id', currentHotelId)
        .order('creado_en', { ascending: true });

      if (error) throw error;
      if (!movimientos || movimientos.length === 0) {
        alert('No hay movimientos para el cierre.');
        return;
      }

      // --- Obtener los admin del hotel
      const { data: admins, error: adminsError } = await currentSupabaseInstance
        .from('usuarios')
        .select('correo')
        .eq('hotel_id', currentHotelId)
        .eq('rol', 'admin');

      if (adminsError) throw adminsError;
      if (!admins || admins.length === 0) {
        alert('No hay administradores registrados.');
        return;
      }

      const correos = admins.map(u => u.correo).join(',');
      // Puedes agregar también el correo institucional del hotel si lo deseas

      // --- Calcular totales
      const totalIngresos = movimientos.filter(m => m.tipo === 'ingreso').reduce((acc, m) => acc + Number(m.monto), 0);
      const totalEgresos = movimientos.filter(m => m.tipo === 'egreso').reduce((acc, m) => acc + Number(m.monto), 0);
      const balance = totalIngresos - totalEgresos;

      // --- Generar HTML bonito del reporte
      const fechaHoy = new Date().toLocaleString('es-CO');
      const usuarioNombre = currentModuleUser?.user_metadata?.nombre || 'Usuario';
      const htmlReporte = generarHTMLReporteCierre(movimientos, totalIngresos, totalEgresos, balance, usuarioNombre, fechaHoy);

      // --- Enviar email
      await enviarReporteCierreCaja({
        correos,
        asunto: "Cierre de caja - " + fechaHoy,
        htmlReporte
      });

      alert('Cierre de caja realizado y reporte enviado.');
      // Aquí podrías limpiar movimientos (reset), registrar un movimiento "cierre" o guardar historico según tu lógica.
    } catch (err) {
      alert('Error en cierre de caja: ' + err.message);
    }
  };
  btnCierreCaja.addEventListener('click', cierreCajaHandler);
  moduleListeners.push({ element: btnCierreCaja, type: 'click', handler: cierreCajaHandler });

  // Inicialización
  await popularMetodosPagoSelect(addMetodoEl, currentSupabaseInstance, feedbackGlobalEl);
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
  console.log('Caja module unmounted and listeners cleaned up.');
}
