// modules/micuenta/micuenta.js

const WOMPI_PUBLIC_KEY = 'pub_prod_7qQum1STAjqRoaupXWNwcSvwSFZ9ANq0'; // ← Clave pública de producción de Wompi

let snackbarTimeout = null;

// Muestra una notificación temporal (snackbar) en la esquina de la pantalla.
function showSnackbar(container, message, type = 'success') {
  let snackbar = container.querySelector('#micuenta-snackbar');
  if (!snackbar) {
    snackbar = document.createElement('div');
    snackbar.id = 'micuenta-snackbar';
    snackbar.className = 'fixed bottom-6 right-6 z-50 bg-white shadow-xl rounded px-4 py-2 text-sm font-medium border transition-all';
    container.appendChild(snackbar);
  }
  snackbar.textContent = message;
  snackbar.classList.remove('bg-green-100', 'bg-red-100', 'border-green-500', 'border-red-500', 'text-green-700', 'text-red-700', 'opacity-0');
  if (type === 'error') {
    snackbar.classList.add('bg-red-100', 'border-red-500', 'text-red-700');
  } else {
    snackbar.classList.add('bg-green-100', 'border-green-500', 'text-green-700');
  }
  snackbar.style.opacity = '1';
  clearTimeout(snackbarTimeout);
  snackbarTimeout = setTimeout(() => { snackbar.style.opacity = '0'; }, 3300);
}

// Genera el HTML para las alertas de vencimiento de la suscripción.
function alertaVencimientoHTML(diasRestantes, estado, enGracia) {
  if (estado === 'vencido') {
    return `<div class="bg-red-100 border-l-4 border-red-500 text-red-700 p-3 mb-6 rounded">
      <b>¡Tu suscripción está vencida!</b> Tienes <b>${diasRestantes}</b> días de gracia para renovar antes del bloqueo total.
    </div>`;
  }
  if (enGracia) {
    return `<div class="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-3 mb-6 rounded">
      <b>¡Atención!</b> Tu periodo de gracia termina en <b>${diasRestantes}</b> días. Renueva tu plan para evitar bloqueo.
    </div>`;
  }
  if (diasRestantes <= 3 && estado !== 'trial') {
    return `<div class="bg-yellow-50 border-l-4 border-yellow-400 text-yellow-900 p-3 mb-6 rounded">
      <b>¡Tu suscripción vence pronto!</b> Quedan <b>${diasRestantes}</b> días para renovar o cambiar de plan.
    </div>`;
  }
  return '';
}

// ---- PRECIOS EN USD ----
const USD_PRICES = {
  Lite: 30,
  Pro: 45,
  Max: 60
};

function formatMoneda(valor, moneda = 'COP') {
  if (moneda === 'USD') {
    return '$' + valor.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return '$' + valor.toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

// Trae la tasa de USD-COP (con cache de 2 min)
let CURRENCY_RATE_CACHE = { rate: 4000, last: 0 };
async function getUsdToCopRate() {
  const now = Date.now();
  if (CURRENCY_RATE_CACHE.rate && (now - CURRENCY_RATE_CACHE.last) < 120000) {
    return CURRENCY_RATE_CACHE.rate;
  }
  try {
    const resp = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=COP');
    const data = await resp.json();
    if (data && data.rates && data.rates.COP) {
      CURRENCY_RATE_CACHE = { rate: data.rates.COP, last: now };
      return data.rates.COP;
    }
  } catch { }
  return 4000;
}

// Función principal que se ejecuta al cargar el módulo "Mi Cuenta".
export async function mount(container, supabase, user, hotelId) {
  container.innerHTML = `<div class="flex justify-center items-center min-h-[60vh] text-xl text-gray-500 animate-pulse">Cargando tu cuenta...</div>`;

  // 1. Trae datos base
  const { data: userProfile } = await supabase
    .from('usuarios').select('*').eq('id', user.id).single();
  const { data: hotel } = await supabase
    .from('hoteles').select('*').eq('id', hotelId).single();
  const { data: plans } = await supabase
    .from('planes').select('*').order('precio_mensual', { ascending: true });

  // 2. Datos adicionales
  const { data: pagos = [] } = await supabase
    .from('pagos').select('*').eq('hotel_id', hotelId).order('fecha', { ascending: false });
  const { data: cambiosPlan = [] } = await supabase
    .from('cambios_plan').select('*').eq('hotel_id', hotelId).order('fecha', { ascending: false });

  // --- LÓGICA CORREGIDA PARA LEER LOS REFERIDOS ---
  let referidosSafe = [];
  try {
    const { data: referidosRaw, error: errorReferidos } = await supabase
      .from('hoteles')
      .select('nombre, creado_en, estado_suscripcion')
      .eq('referido_por', user.id)
      .order('creado_en', { ascending: false });
    if (errorReferidos) {
      console.error("❌ Error consultando referidos:", errorReferidos.message);
    } else {
      referidosSafe = Array.isArray(referidosRaw) ? referidosRaw : [];
    }
    if (referidosSafe.length === 0) {
      referidosSafe.push({
        nombre: "Hotel de Ejemplo",
        creado_en: new Date(),
        estado_suscripcion: "trial"
      });
    }
  } catch (err) {
    console.error("❌ Excepción al cargar referidos:", err);
  }

  const pagosSafe = Array.isArray(pagos) ? pagos : [];
  const cambiosPlanSafe = Array.isArray(cambiosPlan) ? cambiosPlan : [];

  // --- VERIFICACIÓN DE PERMISOS (solo creador o superadmin puede acceder) ---
  const esSuperAdmin = (
    userProfile.rol === 'admin' || userProfile.rol === 'superadmin' ||
    (hotel.creado_por && userProfile.id === hotel.creado_por)
  );
  if (!esSuperAdmin) {
    container.innerHTML = `
      <div class="flex flex-col justify-center items-center min-h-[60vh]">
        <span class="text-5xl mb-3">🔒</span>
        <div class="text-2xl font-bold mb-2 text-red-600">Acceso restringido</div>
        <div class="text-gray-500 text-lg text-center">
          Esta sección solo está disponible para el creador de la cuenta o superadministrador.<br>
          Si necesitas cambiar tu plan o tus datos de cuenta, contacta al responsable de tu hotel.
        </div>
      </div>
    `;
    return;
  }

  // --- Lógica de suscripción, fechas y alertas ---
  const planActivo = plans?.find(p =>
    p.nombre?.toLowerCase() === hotel.plan?.toLowerCase() || p.id === hotel.plan_id
  );
  const fechaInicio = new Date(hotel.suscripcion_inicio || hotel.trial_inicio);
  const fechaFin = new Date(hotel.suscripcion_fin || hotel.trial_fin);
  const hoy = new Date();
  const diasCiclo = Math.ceil((fechaFin - fechaInicio) / (1000 * 60 * 60 * 24));
  let diasRestantes = Math.ceil((fechaFin - hoy) / (1000 * 60 * 60 * 24));
  const DIAS_GRACIA = 2;
  let enGracia = false;
  const fechaFinMasGracia = new Date(fechaFin);
  fechaFinMasGracia.setDate(fechaFin.getDate() + DIAS_GRACIA);

  if (hotel.estado_suscripcion === 'vencido' && hoy <= fechaFinMasGracia) {
    enGracia = true;
    diasRestantes = Math.ceil((fechaFinMasGracia - hoy) / (1000 * 60 * 60 * 24));
  }
  diasRestantes = Math.max(0, diasRestantes);

  // Generar link de referido único
  const refLink = `https://gestiondehotel.com/index.html?ref=${hotel.id}`;

  // --------- SWITCH DE MONEDA Y PERIODO ---------
  let monedaActual = 'COP';
  let periodoActual = 'mensual';

  // =============== HTML UI ===============
  container.innerHTML = `
    <div class="max-w-4xl mx-auto py-8 px-2 relative">
      <div class="flex items-center mb-8 gap-4">
        <div class="flex items-center justify-center w-14 h-14 rounded-full bg-blue-100 text-blue-600 text-3xl shadow-sm"><span>👤</span></div>
        <div>
          <h2 class="text-2xl font-bold mb-0 flex items-center gap-2">Mi cuenta <span class="text-gray-400 text-xl">|</span> <span class="text-base text-gray-500">${userProfile.nombre || user.email}</span></h2>
          <div class="text-sm text-gray-400">Hotel: <span class="font-medium text-blue-600">${hotel.nombre}</span></div>
        </div>
      </div>
      ${alertaVencimientoHTML(diasRestantes, hotel.estado_suscripcion, enGracia)}
      <div class="bg-white shadow rounded-2xl p-6 mb-8">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div class="mb-2 flex items-center gap-3">
              <span class="text-gray-500">Plan actual:</span>
              <span class="inline-flex items-center px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 font-semibold text-sm shadow">${planActivo?.nombre || hotel.plan || 'N/A'}</span>
              <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                  hotel.estado_suscripcion === 'activo' ? 'bg-green-100 text-green-700' :
                  hotel.estado_suscripcion === 'trial' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-red-100 text-red-700'
              }">${hotel.estado_suscripcion}</span>
            </div>
            <div class="text-gray-600 text-sm mb-1"><span class="font-semibold">Vence:</span> ${fechaFin ? fechaFin.toLocaleDateString('es-CO') : 'N/A'}</div>
          </div>
          <div class="flex gap-2 items-center mt-3 md:mt-0">
            <label for="monedaSelector" class="font-semibold text-sm text-gray-600 mr-1">Moneda:</label>
            <select id="monedaSelector" class="form-control w-auto px-2 py-1 text-xs">
              <option value="COP">COP (Colombia)</option>
              <option value="USD">USD (US$)</option>
            </select>
            <label for="tipoPagoSelector" class="font-semibold text-sm text-gray-600 ml-3 mr-1">Pago:</label>
            <select id="tipoPagoSelector" class="form-control w-auto px-2 py-1 text-xs">
              <option value="mensual">Mensual</option>
              <option value="anual">Anual (-2 meses gratis)</option>
            </select>
          </div>
        </div>
        <div class="flex flex-wrap gap-4 mt-6">
          <button class="flex-1 min-w-[180px] group transition bg-gradient-to-br from-blue-600 to-indigo-500 text-white rounded-xl px-5 py-4 shadow-lg hover:shadow-xl hover:scale-[1.04] flex flex-col items-center justify-center font-semibold text-lg" id="btnCambiarCorreo">
            <span class="text-3xl mb-1 transition group-hover:scale-125"><i class="bi bi-envelope-at-fill"></i></span>
            Cambiar correo
          </button>
          <button class="flex-1 min-w-[180px] group transition bg-gradient-to-br from-gray-500 to-gray-700 text-white rounded-xl px-5 py-4 shadow-lg hover:shadow-xl hover:scale-[1.04] flex flex-col items-center justify-center font-semibold text-lg" id="btnCambiarPass">
            <span class="text-3xl mb-1 transition group-hover:scale-125"><i class="bi bi-key-fill"></i></span>
            Cambiar contraseña
          </button>
          <button class="flex-1 min-w-[180px] group transition bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-xl px-5 py-4 shadow-lg hover:shadow-xl hover:scale-[1.04] flex flex-col items-center justify-center font-semibold text-lg" id="btnRenovarPlan">
              <span class="text-3xl mb-1 transition group-hover:scale-125"><i class="bi bi-arrow-repeat"></i></span>
              Renovar / Pagar Plan
          </button>
        </div>
      </div>
      <div class="bg-white shadow rounded-2xl p-6 mb-10">
        <h3 class="text-lg font-semibold mb-4 flex items-center gap-2"><i class="bi bi-patch-check-fill text-blue-600"></i> Cambia o mejora tu plan</h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6" id="planes-list"></div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div class="bg-white shadow rounded-2xl p-6 mb-8">
          <h3 class="text-lg font-semibold mb-4 flex items-center gap-2"><i class="bi bi-clock-history text-blue-500"></i> Historial de Pagos</h3>
          <div class="overflow-auto">
            <table class="w-full text-xs">
              <thead><tr class="text-left text-gray-600 border-b"><th class="py-2">Fecha</th><th>Plan</th><th>Monto</th><th>Método</th></tr></thead>
              <tbody>
                ${pagosSafe.length === 0 ? `<tr><td colspan="4" class="text-gray-400 py-3 text-center">Sin pagos registrados</td></tr>` : pagosSafe.map(p => `<tr><td>${new Date(p.fecha).toLocaleDateString('es-CO')}</td><td>${p.plan}</td><td>$${p.monto.toLocaleString('es-CO')}</td><td>${p.metodo_pago}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="bg-white shadow rounded-2xl p-6 mb-8">
          <h3 class="text-lg font-semibold mb-4 flex items-center gap-2"><i class="bi bi-arrow-repeat text-green-600"></i> Cambios de Plan</h3>
          <div class="overflow-auto">
            <table class="w-full text-xs">
              <thead><tr class="text-left text-gray-600 border-b"><th class="py-2">Fecha</th><th>De</th><th>A</th><th>Usuario</th></tr></thead>
              <tbody>
                ${cambiosPlanSafe.length === 0 ? `<tr><td colspan="4" class="text-gray-400 py-3 text-center">Sin cambios registrados</td></tr>` : cambiosPlanSafe.map(c => `<tr><td>${new Date(c.fecha).toLocaleDateString('es-CO')}</td><td>${c.plan_anterior}</td><td>${c.plan_nuevo}</td><td>${c.usuario_nombre}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="bg-white shadow rounded-2xl p-6 mb-8">
        <h3 class="text-lg font-semibold mb-4 flex items-center gap-2"><i class="bi bi-share-fill text-indigo-600"></i> Programa de Referidos</h3>
        <p class="text-sm text-gray-600 mb-3">Comparte tu enlace y obtén 30 días gratis por cada hotel que pague su primera suscripción.</p>
        <div class="flex items-center gap-3 mb-2">
          <input type="text" class="form-control w-full" value="${refLink}" readonly id="refLinkInput">
          <button class="btn btn-accent" id="btnCopyRefLink">Copiar enlace</button>
        </div>
        <div class="overflow-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="text-left text-gray-600 border-b">
                <th class="py-2">Hotel Referido</th>
                <th>Estado Suscripción</th>
                <th>Fecha Registro</th>
                <th>Recompensa</th>
              </tr>
            </thead>
            <tbody>
              ${referidosSafe.length === 0 ? `
                <tr><td colspan="4" class="text-gray-400 py-3 text-center">Aún no tienes hoteles referidos. ¡Comparte tu enlace!</td></tr>
              ` : referidosSafe.map(r => `
                <tr>
                  <td>${r.nombre || '-'}</td>
                  <td><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                      r.estado_suscripcion === 'activo' ? 'bg-green-100 text-green-700' :
                      r.estado_suscripcion === 'trial' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-700'
                  }">${r.estado_suscripcion || '-'}</span></td>
                  <td>${r.creado_en ? new Date(r.creado_en).toLocaleDateString('es-CO') : '-'}</td>
                  <td>${r.estado_suscripcion === 'activo' ? '✔️ Otorgada' : '⏳ Pendiente de pago'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="flex flex-col items-center justify-center text-xs text-gray-400 pt-8 pb-2">
        Gestión de Hotel es un producto de Grupo Empresarial Areiza Gomez
      </div>
    </div>
    <!-- Modales -->
    <div id="modalUpgrade" class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 hidden">
      <div class="bg-white p-6 rounded-2xl shadow-xl max-w-md w-full relative animate-fade-in">
        <button id="closeUpgradeModal" class="absolute top-2 right-3 text-gray-400 hover:text-red-400 text-2xl">&times;</button>
        <h3 class="font-bold text-lg mb-2 text-blue-700">Confirmar cambio de plan</h3>
        <div class="mb-2"><span id="modalPlanName"></span></div>
        <div class="mb-3 text-sm text-gray-500">Tu ciclo actual vence el <b>${fechaFin ? fechaFin.toLocaleDateString('es-CO') : ''}</b>. Quedan <b>${diasRestantes}</b> días en este ciclo.</div>
        <div id="prorrateoDetalle" class="mb-4 p-3 bg-blue-50/70 rounded-lg text-blue-900"></div>
        
        <button id="confirmUpgrade" class="group w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-lg text-white bg-gradient-to-br from-green-500 to-emerald-600 font-semibold transition-all duration-300 shadow-md hover:shadow-lg hover:scale-[1.03] disabled:opacity-70 disabled:scale-100">
            <span class="btn-text">Pagar y cambiar plan</span>
            <span class="btn-spinner hidden animate-spin">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V4a1 1 0 011-1zm10 10a1 1 0 011 1v2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 111.885-.666A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101z" clip-rule="evenodd" />
                </svg>
            </span>
        </button>
      </div>
    </div>
    <div id="modalCorreo" class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 hidden">
      <div class="bg-white p-6 rounded-2xl shadow-xl max-w-sm w-full relative animate-fade-in">
        <button id="closeCorreoModal" class="absolute top-2 right-3 text-gray-400 hover:text-red-400 text-2xl">&times;</button>
        <h3 class="font-bold text-lg mb-4 text-blue-700">Cambiar correo</h3>
        <form id="formCorreo">
          <label class="block text-sm mb-1">Correo actual</label>
          <input type="email" class="form-control mb-3" value="${user.email}" disabled>
          <label class="block text-sm mb-1">Nuevo correo</label>
          <input type="email" class="form-control mb-3" id="nuevoCorreo" required>
          <button class="btn btn-primary w-full mt-1" type="submit">Actualizar correo</button>
        </form>
      </div>
    </div>
    <div id="modalPass" class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 hidden">
      <div class="bg-white p-6 rounded-2xl shadow-xl max-w-sm w-full relative animate-fade-in">
        <button id="closePassModal" class="absolute top-2 right-3 text-gray-400 hover:text-red-400 text-2xl">&times;</button>
        <h3 class="font-bold text-lg mb-4 text-blue-700">Cambiar contraseña</h3>
        <form id="formPass">
          <label class="block text-sm mb-1">Nueva contraseña</label>
          <input type="password" class="form-control mb-3" id="nuevoPass" required minlength="6">
          <label class="block text-sm mb-1">Confirmar contraseña</label>
          <input type="password" class="form-control mb-3" id="confirmarPass" required minlength="6">
          <button class="btn btn-primary w-full mt-1" type="submit">Actualizar contraseña</button>
        </form>
      </div>
    </div>
  `;

  // ---- SWITHC MONEDA/PERIODO ----
  const monedaSelector = container.querySelector('#monedaSelector');
  const tipoPagoSelector = container.querySelector('#tipoPagoSelector');
  const planesList = container.querySelector('#planes-list');

  monedaSelector.addEventListener('change', (e) => {
    monedaActual = e.target.value;
    renderPlanes();
  });
  tipoPagoSelector.addEventListener('change', (e) => {
    periodoActual = e.target.value;
    renderPlanes();
  });

  // ---- RENDERIZA PLANES SEGÚN MONEDA Y PERIODO ----
const USD_PRICES = {
  "lite": 30,
  "pro": 45,
  "max": 60
};

// EN micuenta.js
async function renderPlanes() {
  let usdCopRate = await getUsdToCopRate();
  planesList.innerHTML = '';
  (plans || []).forEach(plan => {
    // ... (lógica de precios igual a como la tienes)
    let planKey = plan.nombre.trim().toLowerCase();
    let price = 0;
    let label = '';
    if (monedaActual === 'USD') {
      let priceUSD = USD_PRICES[planKey] !== undefined ? USD_PRICES[planKey] : 30;
      price = periodoActual === 'anual' ? priceUSD * 10 : priceUSD;
      label = periodoActual === 'anual' ? 'año' : 'mes';
    } else {
      price = plan.precio_mensual;
      if (periodoActual === 'anual') price = plan.precio_mensual * 10;
      label = periodoActual === 'anual' ? 'año' : 'mes';
    }
    
    const esPlanActual = plan.id === planActivo?.id;
    const esUpgrade = !esPlanActual && plan.precio_mensual > (planActivo?.precio_mensual || 0);
    const esDowngrade = !esPlanActual && plan.precio_mensual < (planActivo?.precio_mensual || 0);
    
    // --- INICIO DE LA MEJORA VISUAL ---
    let botonHTML = '';
    if (esPlanActual) {
        botonHTML = `<button class="w-full mt-2 py-2.5 px-4 rounded-lg text-white bg-gradient-to-br from-blue-500 to-blue-600 font-semibold cursor-not-allowed" disabled>Tu plan actual</button>`;
    } else if (esUpgrade) {
        // Botón de mejora con ícono y mejores efectos
        botonHTML = `<button class="btn-elegir-plan group w-full mt-2 py-2.5 px-4 rounded-lg text-white bg-gradient-to-br from-green-500 to-emerald-600 font-semibold transition-all duration-300 shadow-md hover:shadow-lg hover:scale-[1.03]" data-plan-id="${plan.id}" data-tipo-cambio="upgrade">
            <span class="flex items-center justify-center gap-2">
                Mejorar Plan
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
            </span>
        </button>`;
    } else if (esDowngrade) {
        botonHTML = `<button class="w-full mt-2 py-2.5 px-4 rounded-lg text-gray-500 bg-gray-200 font-semibold cursor-not-allowed" disabled title="El cambio a un plan inferior se aplica al final del ciclo actual.">Bajar de Plan</button>`;
    }
    // --- FIN DE LA MEJORA VISUAL ---

    planesList.innerHTML += `
      <div class="rounded-xl border shadow-sm p-4 flex flex-col justify-between ${esPlanActual ? 'border-blue-500 ring-2 ring-blue-300' : 'border-gray-200'}">
        <div>
          <div class="font-bold text-blue-700 text-lg mb-2 flex items-center gap-1">
            ${plan.nombre.charAt(0).toUpperCase() + plan.nombre.slice(1).toLowerCase()}
            ${esPlanActual ? '<span class="ml-2 px-2 py-0.5 bg-blue-100 text-blue-600 text-xs font-semibold rounded">Actual</span>' : ''}
          </div>
          <div class="text-gray-600 text-sm mb-2">${plan.descripcion || ''}</div>
          <div class="text-xl font-bold text-green-600 mb-2">
            ${formatMoneda(price, monedaActual)} <span class="text-sm text-gray-400 font-normal">/${label}</span>
          </div>
          <ul class="list-disc pl-4 text-gray-500 text-xs mb-3">${(plan.funcionalidades?.descripcion_features || []).map(f => `<li>${f}</li>`).join('')}</ul>
        </div>
        ${botonHTML}
      </div>
    `;
  });

  // Listener para los botones de cambio de plan (sin cambios aquí)
  container.querySelectorAll('.btn-elegir-plan').forEach(btn => {
    btn.addEventListener('click', () => {
      const planId = btn.getAttribute('data-plan-id');
      const tipoCambio = btn.getAttribute('data-tipo-cambio');
      const planSeleccionado = plans.find(p => p.id == planId);
      
      if (planSeleccionado) {
        procesarCambioDePlan(planSeleccionado, tipoCambio);
      }
    });
  });
}  await renderPlanes();

  // Copiar enlace de referido
  container.querySelector('#btnCopyRefLink')?.addEventListener('click', () => {
    const input = container.querySelector('#refLinkInput');
    input.select();
    document.execCommand('copy');
    showSnackbar(container, '¡Enlace copiado!', 'success');
  });

// EN micuenta.js
function procesarCambioDePlan(planSeleccionado, tipo) {
    if (tipo !== 'upgrade') {
        abrirWompi(planSeleccionado, 'renew', planSeleccionado.precio_mensual);
        return;
    }

    const diasCicloSeguro = Math.max(1, diasCiclo);
    const diasRestantesSeguro = Math.max(1, diasRestantes);

    const costoDiarioActual = (planActivo.precio_mensual || 0) / diasCicloSeguro;
    const costoDiarioNuevo = planSeleccionado.precio_mensual / diasCicloSeguro;

    const creditoNoUsado = costoDiarioActual * diasRestantesSeguro;
    const costoNuevoRestante = costoDiarioNuevo * diasRestantesSeguro;
    const montoProrrateado = Math.max(0, costoNuevoRestante - creditoNoUsado);

    const modal = container.querySelector('#modalUpgrade');
    modal.querySelector('#modalPlanName').innerHTML = `De <b>${planActivo.nombre}</b> a <b class="text-green-600">${planSeleccionado.nombre}</b>`;

    // --- INICIO DE LA MEJORA VISUAL DEL DESGLOSE ---
    const detalleHTML = `
        <ul class="text-sm space-y-2">
            <li class="flex justify-between items-center">
                <span>Costo de ${planSeleccionado.nombre} (${diasRestantesSeguro} días)</span>
                <span class="font-semibold">${formatMoneda(costoNuevoRestante)}</span>
            </li>
            <li class="flex justify-between items-center text-green-600">
                <span>(-) Crédito plan ${planActivo.nombre}</span>
                <span class="font-semibold">${formatMoneda(creditoNoUsado)}</span>
            </li>
        </ul>
        <hr class="my-3 border-dashed">
        <div class="text-lg font-bold flex justify-between items-center">
            <span>Total a pagar hoy:</span>
            <span class="text-green-700">${formatMoneda(montoProrrateado)}</span>
        </div>
    `;
    modal.querySelector('#prorrateoDetalle').innerHTML = detalleHTML;
    // --- FIN DE LA MEJORA VISUAL DEL DESGLOSE ---


    const btnConfirmar = modal.querySelector('#confirmUpgrade');
    const newBtn = btnConfirmar.cloneNode(true);
    btnConfirmar.parentNode.replaceChild(newBtn, btnConfirmar);
    
    // --- LÓGICA DE ESTADO DE CARGA ---
    newBtn.addEventListener('click', () => {
        const btnText = newBtn.querySelector('.btn-text');
        const btnSpinner = newBtn.querySelector('.btn-spinner');

        // Activar estado de carga
        newBtn.disabled = true;
        btnText.textContent = 'Procesando...';
        btnSpinner.classList.remove('hidden');

        // Simular un pequeño retraso para que el spinner sea visible y luego redirigir
        setTimeout(() => {
            abrirWompi(planSeleccionado, 'upgrade', montoProrrateado);
            
            // Restaurar botón por si el usuario no completa el pago
            newBtn.disabled = false;
            btnText.textContent = 'Pagar y cambiar plan';
            btnSpinner.classList.add('hidden');
            modal.classList.add('hidden');
        }, 700); // 0.7 segundos de espera
    });

    modal.classList.remove('hidden');
}
// Agrega un listener para cerrar el modal
container.querySelector('#closeUpgradeModal')?.addEventListener('click', () => {
    container.querySelector('#modalUpgrade').classList.add('hidden');
});
  // ========== PAGO EN WOMPI ==========
async function abrirWompi(plan, tipo, montoPagar) {
  const ref = `${tipo}-${hotel.id}-${plan.id}-${Date.now()}`;
  let usdCop = await getUsdToCopRate();
  
  // El monto a pagar ya viene calculado (sea prorrateado o completo)
  // Wompi siempre necesita el valor en centavos de COP
  let amountInCents = Math.round(montoPagar * 100);
  
  // Si la moneda seleccionada es USD, debemos convertir el monto de pago
  if (monedaActual === 'USD') {
      let planKey = plan.nombre.trim().toLowerCase();
      let precioUsd = USD_PRICES[planKey] || 30;
      if (periodoActual === 'anual') precioUsd *= 10;
      
      // Si es upgrade, el monto a pagar se recalcula en USD
      if (tipo === 'upgrade') {
          // Lógica similar de prorrateo pero en USD
          const diasCicloSeguro = Math.max(1, diasCiclo);
          const diasRestantesSeguro = Math.max(1, diasRestantes);
          const costoDiarioActualUSD = (USD_PRICES[planActivo.nombre.toLowerCase()] || 0) / diasCicloSeguro;
          const costoDiarioNuevoUSD = precioUsd / diasCicloSeguro;
          const montoProrrateadoUSD = (costoDiarioNuevoUSD - costoDiarioActualUSD) * diasRestantesSeguro;
          montoPagar = montoProrrateadoUSD;
      } else {
          montoPagar = precioUsd;
      }
      amountInCents = Math.round(montoPagar * usdCop * 100);
  }

  // --- Google Analytics ---
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      'event': tipo === 'upgrade' ? 'cambio_plan' : 'renovacion_plan',
      'currency': monedaActual,
      'value': montoPagar,
      'plan': plan.nombre,
      'hotel_id': hotel.id,
      'periodo': periodoActual
    });
  } catch (e) {}

  // --- Confirma con SweetAlert y redirige a Wompi ---
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      icon: 'info',
      title: 'Serás redirigido a la pasarela de pago',
      html: `<b>El pago será a nombre de<br>Grupo Empresarial Areiza Gomez</b><br>
        <span class="text-gray-500">propietario del sistema hotelero Gestión de Hotel.</span>
        <br><br>
        Monto a pagar: <b>${formatMoneda(montoPagar, monedaActual)} (${formatMoneda(amountInCents/100, 'COP')} COP)</b>
        <br><span class="text-xs">Tasa de cambio: ${formatMoneda(usdCop)}</span><br>
        ¿Deseas continuar?`,
      confirmButtonText: 'Sí, continuar',
      cancelButtonText: 'Cancelar',
      showCancelButton: true,
      confirmButtonColor: '#16a34a',
      cancelButtonColor: '#c026d3'
    }).then((result) => {
      if (result.isConfirmed) {
        window.open(
          `https://checkout.wompi.co/p/?public-key=${WOMPI_PUBLIC_KEY}&currency=COP&amount-in-cents=${amountInCents}&reference=${ref}&customer-email=${user.email}`,
          '_blank'
        );
      }
    });
  } else {
    // Fallback por si SweetAlert no carga
    window.open(`https://checkout.wompi.co/p/?public-key=${WOMPI_PUBLIC_KEY}&currency=COP&amount-in-cents=${amountInCents}&reference=${ref}&customer-email=${user.email}`, '_blank');
  }
}
  // Renovar plan actual
 container.querySelector('#btnRenovarPlan')?.addEventListener('click', () => {
    if (planActivo) {
        // Para renovar, el tipo es 'renew' y se pasa el precio completo del plan
        const precioRenovacion = periodoActual === 'anual'
            ? planActivo.precio_mensual * 10
            : planActivo.precio_mensual;
        
        abrirWompi(planActivo, 'renew', precioRenovacion);
    }
});

  // Modales de cambio de correo y contraseña
  container.querySelector('#btnCambiarCorreo')?.addEventListener('click', () => container.querySelector('#modalCorreo').classList.remove('hidden'));
  container.querySelector('#closeCorreoModal')?.addEventListener('click', () => container.querySelector('#modalCorreo').classList.add('hidden'));
  container.querySelector('#btnCambiarPass')?.addEventListener('click', () => container.querySelector('#modalPass').classList.remove('hidden'));
  container.querySelector('#closePassModal')?.addEventListener('click', () => container.querySelector('#modalPass').classList.add('hidden'));

  // Formulario de cambio de correo
  container.querySelector('#formCorreo')?.addEventListener('submit', async e => {
    e.preventDefault();
    const nuevoCorreo = container.querySelector('#nuevoCorreo').value.trim();
    const { error } = await supabase.auth.updateUser({ email: nuevoCorreo });
    if (error) {
      showSnackbar(container, 'Error: ' + error.message, 'error');
    } else {
      showSnackbar(container, 'Correo actualizado. Revisa tu nuevo correo para confirmar.', 'success');
      container.querySelector('#modalCorreo').classList.add('hidden');
    }
  });

  // Formulario de cambio de contraseña
  container.querySelector('#formPass')?.addEventListener('submit', async e => {
    e.preventDefault();
    const nuevoPass = container.querySelector('#nuevoPass').value.trim();
    const confirmar = container.querySelector('#confirmarPass').value.trim();
    if (nuevoPass.length < 6) {
      showSnackbar(container, 'La contraseña debe tener al menos 6 caracteres', 'error');
      return;
    }
    if (nuevoPass !== confirmar) {
      showSnackbar(container, 'Las contraseñas no coinciden', 'error');
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: nuevoPass });
    if (error) {
      showSnackbar(container, 'Error: ' + error.message, 'error');
    } else {
      showSnackbar(container, 'Contraseña actualizada correctamente', 'success');
      container.querySelector('#modalPass').classList.add('hidden');
    }
  });
}

// Función que se ejecuta al salir del módulo para limpiar el contenido.
export function unmount(container) {
  container.innerHTML = '';
}
