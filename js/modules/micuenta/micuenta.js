// modules/micuenta/micuenta.js

// --- IMPORTACIONES ---
import { abrirMercadoPagoCheckout } from './mercadoPagoService.js';

// --- CONSTANTES Y VARIABLES GLOBALES ---
const WOMPI_PUBLIC_KEY = 'pub_prod_7qQum1STAjqRoaupXWNwcSvwSFZ9ANq0';
let snackbarTimeout = null;
const USD_PRICES = {
  lite: 30,
  pro: 45,
  max: 60
};
let CURRENCY_RATE_CACHE = { rate: 4000, last: 0 };

// =======================================================================
// ========================== FUNCIONES DE UTILIDAD ========================
// =======================================================================

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

function formatMoneda(valor, moneda = 'COP') {
  if (moneda === 'USD') {
    return '$' + valor.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return '$' + valor.toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

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
  } catch (e) {
    console.error("Error fetching currency rate:", e);
  }
  return 4000;
}

// =======================================================================
// ========================== FUNCIÓN PRINCIPAL (MOUNT) ====================
// =======================================================================

export async function mount(container, supabase, user, hotelId) {
  container.innerHTML = `<div class="flex justify-center items-center min-h-[60vh] text-xl text-gray-500 animate-pulse">Cargando tu cuenta...</div>`;

  const { data: userProfile } = await supabase.from('usuarios').select('*').eq('id', user.id).single();
  const { data: hotel } = await supabase.from('hoteles').select('*').eq('id', hotelId).single();
  const { data: plans } = await supabase.from('planes').select('*').order('precio_mensual', { ascending: true });
  const { data: pagos = [] } = await supabase.from('pagos').select('*').eq('hotel_id', hotelId).order('fecha', { ascending: false });
  const pagosSafe = Array.isArray(pagos) ? pagos : [];
  const { data: cambiosPlan = [] } = await supabase.from('cambios_plan').select('*').eq('hotel_id', hotelId).order('fecha', { ascending: false });
  const cambiosPlanSafe = Array.isArray(cambiosPlan) ? cambiosPlan : [];


  let referidosSafe = [];

// ✅ Mostramos qué hotelId se está usando
console.log("📦 hotelId recibido en Mi Cuenta:", hotelId);

try {
  // ✅ Ejecutamos la consulta corregida
  const { data: referidosRaw, error: errorReferidos } = await supabase
    .from('referidos')
    .select('nombre_hotel_referido, fecha_registro, estado, recompensa_otorgada') // Campo corregido
    .eq('referidor_id', hotelId)
    .order('fecha_registro', { ascending: false }); // Campo corregido

  // ✅ Mostramos lo que devuelve la base de datos
  console.log("🔍 Resultado referidosRaw:", referidosRaw);

  // ✅ Validamos si hubo error o si vino vacío
  if (errorReferidos) {
    console.error("❌ Error al consultar referidos:", errorReferidos.message);
  } else if (!referidosRaw || referidosRaw.length === 0) {
    console.warn("⚠️ Consulta ejecutada correctamente pero no devolvió ningún referido.");
  }

  // ✅ Guardamos los datos si vinieron bien
  referidosSafe = Array.isArray(referidosRaw) ? referidosRaw : [];

} catch (err) {
  console.error("❌ Excepción al cargar referidos:", err);
}


  const { count: conteoHabitaciones, error: errHabitaciones } = await supabase
      .from('habitaciones')
      .select('id', { count: 'exact', head: true })
      .eq('hotel_id', hotelId);

  const { count: conteoUsuarios, error: errUsuarios } = await supabase
      .from('usuarios')
      .select('id', { count: 'exact', head: true })
      .eq('hotel_id', hotelId);
  
  if (errHabitaciones || errUsuarios) {
      console.error("Error obteniendo conteo de recursos:", errHabitaciones, errUsuarios);
      showSnackbar(container, 'Error al verificar uso actual del hotel.', 'error');
  }

  const esSuperAdmin = (userProfile.rol === 'admin' || userProfile.rol === 'superadmin' || (hotel.creado_por && userProfile.id === hotel.creado_por));
  if (!esSuperAdmin) {
    container.innerHTML = `<div class="flex flex-col justify-center items-center min-h-[60vh]"><span class="text-5xl mb-3">🔒</span><div class="text-2xl font-bold mb-2 text-red-600">Acceso restringido</div><div class="text-gray-500 text-lg text-center">Esta sección solo está disponible para el creador de la cuenta o superadministrador.<br>Si necesitas cambiar tu plan o tus datos de cuenta, contacta al responsable de tu hotel.</div></div>`;
    return;
  }
  
  const planActivo = plans?.find(p => p.nombre?.toLowerCase() === hotel.plan?.toLowerCase() || p.id === hotel.plan_id);
  const fechaFin = new Date(hotel.suscripcion_fin || hotel.trial_fin);
  const hoy = new Date();
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

  const refLink = `https://gestiondehotel.com/index.html?ref=${hotel.id}`;
  let monedaActual = 'COP';
  let periodoActual = 'mensual';

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
          <div class="flex flex-wrap gap-x-4 gap-y-2 items-center mt-3 md:mt-0">
            <div class="flex items-center gap-2">
              <label for="monedaSelector" class="font-semibold text-sm text-gray-600">Moneda:</label>
              <select id="monedaSelector" class="form-control w-auto px-2 py-1 text-xs">
                <option value="COP">COP (Colombia)</option>
                <option value="USD">USD (US$)</option>
              </select>
            </div>
            <div class="flex items-center gap-2">
              <label for="tipoPagoSelector" class="font-semibold text-sm text-gray-600">Pago:</label>
              <select id="tipoPagoSelector" class="form-control w-auto px-2 py-1 text-xs">
                <option value="mensual">Mensual</option>
                <option value="anual">Anual (-2 meses gratis)</option>
              </select>
            </div>
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
                ${pagosSafe.length === 0 ? `<tr><td colspan="4" class="text-gray-400 py-3 text-center">Sin pagos registrados</td></tr>` : pagosSafe.map(p => `<tr><td>${new Date(p.fecha).toLocaleDateString('es-CO')}</td><td>${p.plan}</td><td>${formatMoneda(p.monto, p.moneda)}</td><td>${p.metodo_pago}</td></tr>`).join('')}
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
            console.log("🧾 Renderizando referidos en tabla:", referidosSafe);
            <tbody>
              ${referidosSafe.length === 0 ? `
                <tr><td colspan="4" class="text-gray-400 py-3 text-center">Aún no tienes hoteles referidos. ¡Comparte tu enlace!</td></tr>
              ` : referidosSafe.map(r => `
                <tr>
                  <td>${r.nombre_hotel_referido || '-'}</td>
                  <td><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                      r.estado === 'activo' ? 'bg-green-100 text-green-700' :
                      r.estado === 'trial' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-700'
                  }">${r.estado || '-'}</span></td>
<td>${r.fecha_registro ? new Date(r.fecha_registro).toLocaleDateString('es-CO') : '-'}</td>
                  <td>${r.recompensa_otorgada ? '✔️ Otorgada' : '⏳ Pendiente de pago'}</td>
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
    <div id="modalUpgrade" class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 hidden">
      <div class="bg-white p-6 rounded-2xl shadow-xl max-w-md w-full relative animate-fade-in">
        <button id="closeUpgradeModal" class="absolute top-2 right-3 text-gray-400 hover:text-red-400 text-2xl">&times;</button>
        <h3 class="font-bold text-lg mb-2 text-blue-700">Confirmar cambio de plan</h3>
        <div class="mb-2"><span id="modalPlanName"></span></div>
        <div class="mb-3 text-sm text-gray-500">Tu ciclo actual vence el <b>${fechaFin ? fechaFin.toLocaleDateString('es-CO') : ''}</b>. Quedan <b>${diasRestantes}</b> días en este ciclo.</div>
        <div id="prorrateoDetalle" class="mb-4 p-3 bg-blue-50/70 rounded-lg text-blue-900"></div>
        <button id="confirmUpgrade" class="group w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-lg text-white bg-gradient-to-br from-green-500 to-emerald-600 font-semibold transition-all duration-300 shadow-md hover:shadow-lg hover:scale-[1.03] disabled:opacity-70 disabled:scale-100">
            <span class="btn-text">Pagar y cambiar plan</span>
            <span class="btn-spinner hidden animate-spin"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V4a1 1 0 011-1zm10 10a1 1 0 011 1v2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 111.885-.666A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101z" clip-rule="evenodd" /></svg></span>
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

  const monedaSelector = container.querySelector('#monedaSelector');
  const tipoPagoSelector = container.querySelector('#tipoPagoSelector');
  const planesList = container.querySelector('#planes-list');

  async function iniciarProcesoDePago(plan, tipo, montoPagarCOP, montoPagarUSD) {
    if (monedaActual === 'USD') {
      await abrirMercadoPagoCheckout(plan, tipo, montoPagarUSD, hotel.id, user.email);
    } else {
      await abrirWompi(plan, tipo, montoPagarCOP);
    }
  }

  async function abrirWompi(plan, tipo, montoPagar) {
    const ref = `${tipo}-${hotel.id}-${plan.id}-${Date.now()}`;
    const amountInCents = Math.round(montoPagar * 100);

    try {
      window.dataLayer.push({
  'event': 'Pago_de_suscripcion',
  'currency': 'COP',
  'value': montoPagar,
  'plan': plan.nombre,
  'hotel_id': hotel.id,
  'periodo': periodoActual
});

    } catch (e) { console.error("GA Error:", e); }

    if (typeof Swal !== 'undefined') {
      const usdCop = await getUsdToCopRate();
      Swal.fire({
        icon: 'info',
        title: 'Serás redirigido a la pasarela de pago',
        html: `<b>El pago será a nombre de<br>Grupo Empresarial Areiza Gomez</b><br>
          <span class="text-gray-500">propietario del sistema hotelero Gestión de Hotel.</span>
          <br><br>
          Monto a pagar: <b>${formatMoneda(montoPagar, 'COP')}</b>
          <br><span class="text-xs">Tasa de cambio (ref): ${formatMoneda(usdCop, 'COP')}</span><br>
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
      window.open(`https://checkout.wompi.co/p/?public-key=${WOMPI_PUBLIC_KEY}&currency=COP&amount-in-cents=${amountInCents}&reference=${ref}&customer-email=${user.email}`, '_blank');
    }
  }

  function procesarCambioDePlan(planSeleccionado, tipo) {
    const modal = container.querySelector('#modalUpgrade');
    
    if (tipo === 'upgrade') {
        const fechaInicioCiclo = new Date(hotel.suscripcion_inicio || hotel.trial_inicio);
        const diasCicloTotal = Math.ceil((new Date(hotel.suscripcion_fin || hotel.trial_fin) - fechaInicioCiclo) / (1000 * 60 * 60 * 24));
        const diasCicloSeguro = Math.max(1, diasCicloTotal);
        const diasRestantesSeguro = Math.max(0, diasRestantes);

        const costoDiarioActualCOP = (planActivo.precio_mensual || 0) / diasCicloSeguro;
        const costoDiarioNuevoCOP = planSeleccionado.precio_mensual / diasCicloSeguro;
        const creditoNoUsadoCOP = costoDiarioActualCOP * diasRestantesSeguro;
        const costoNuevoRestanteCOP = costoDiarioNuevoCOP * diasRestantesSeguro;
        const montoProrrateadoCOP = Math.max(0, costoNuevoRestanteCOP - creditoNoUsadoCOP);

        const precioActualUSD = USD_PRICES[planActivo.nombre.toLowerCase()] || 0;
        const precioNuevoUSD = USD_PRICES[planSeleccionado.nombre.toLowerCase()] || 0;
        const costoDiarioActualUSD = precioActualUSD / diasCicloSeguro;
        const costoDiarioNuevoUSD = precioNuevoUSD / diasCicloSeguro;
        const creditoNoUsadoUSD = costoDiarioActualUSD * diasRestantesSeguro;
        const costoNuevoRestanteUSD = costoDiarioNuevoUSD * diasRestantesSeguro;
        const montoProrrateadoUSD = Math.max(0, costoNuevoRestanteUSD - creditoNoUsadoUSD);
        
        modal.querySelector('#modalPlanName').innerHTML = `De <b>${planActivo.nombre}</b> a <b class="text-green-600">${planSeleccionado.nombre}</b>`;
        modal.querySelector('.text-blue-700').textContent = 'Confirmar mejora de plan';

        const montoMostar = monedaActual === 'USD' ? montoProrrateadoUSD : montoProrrateadoCOP;
        const creditoMostrar = monedaActual === 'USD' ? creditoNoUsadoUSD : creditoNoUsadoCOP;
        const costoRestanteMostrar = monedaActual === 'USD' ? costoNuevoRestanteUSD : costoNuevoRestanteCOP;

        const detalleHTML = `
            <ul class="text-sm space-y-2"><li class="flex justify-between items-center"><span>Costo de ${planSeleccionado.nombre} (${diasRestantesSeguro} días)</span><span class="font-semibold">${formatMoneda(costoRestanteMostrar, monedaActual)}</span></li><li class="flex justify-between items-center text-green-600"><span>(-) Crédito plan ${planActivo.nombre}</span><span class="font-semibold">${formatMoneda(creditoMostrar, monedaActual)}</span></li></ul>
            <hr class="my-3 border-dashed">
            <div class="text-lg font-bold flex justify-between items-center"><span>Total a pagar hoy:</span><span class="text-green-700">${formatMoneda(montoMostar, monedaActual)}</span></div>
        `;
        modal.querySelector('#prorrateoDetalle').innerHTML = detalleHTML;
        
        const btnConfirmar = modal.querySelector('#confirmUpgrade');
        const newBtn = btnConfirmar.cloneNode(true);
        newBtn.querySelector('.btn-text').textContent = 'Pagar y cambiar plan';
        newBtn.classList.remove('from-orange-500', 'to-red-500');
        newBtn.classList.add('from-green-500', 'to-emerald-600');
        btnConfirmar.parentNode.replaceChild(newBtn, btnConfirmar);
        
        newBtn.addEventListener('click', () => {
            iniciarProcesoDePago(planSeleccionado, 'upgrade', montoProrrateadoCOP, montoProrrateadoUSD);
            modal.classList.add('hidden');
        });
    } else if (tipo === 'downgrade') {
        let planKey = planSeleccionado.nombre.trim().toLowerCase();
        let precioRenovacionCOP = periodoActual === 'anual' ? planSeleccionado.precio_mensual * 10 : planSeleccionado.precio_mensual;
        let precioRenovacionUSD = USD_PRICES[planKey] || 0;
        if (periodoActual === 'anual') {
            precioRenovacionUSD *= 10;
        }
        
        const montoAPagar = monedaActual === 'USD' ? precioRenovacionUSD : precioRenovacionCOP;

        modal.querySelector('#modalPlanName').innerHTML = `De <b>${planActivo.nombre}</b> a <b class="text-orange-600">${planSeleccionado.nombre}</b>`;
        modal.querySelector('.text-blue-700').textContent = 'Confirmar pago para próximo ciclo';

        const detalleHTML = `
          <div class="text-sm text-gray-700 space-y-3">
            <p>Vas a pagar hoy por tu próximo ciclo para asegurar un precio más bajo.</p>
            <div class="text-lg font-bold flex justify-between items-center">
              <span>Total a pagar ahora:</span>
              <span class="text-green-700">${formatMoneda(montoAPagar, monedaActual)}</span>
            </div>
            <div class="p-3 bg-blue-50 border-l-4 border-blue-500 text-blue-800 rounded">
              <p>Tu plan actual <b class="font-semibold">${planActivo.nombre}</b> seguirá activo hasta el <b class="font-semibold">${fechaFin ? fechaFin.toLocaleDateString('es-CO') : ''}</b>.</p>
              <p class="mt-1">El nuevo plan <b class="font-semibold">${planSeleccionado.nombre}</b> se activará automáticamente después de esa fecha.</p>
            </div>
          </div>
        `;
        modal.querySelector('#prorrateoDetalle').innerHTML = detalleHTML;

        const btnConfirmar = modal.querySelector('#confirmUpgrade');
        const newBtn = btnConfirmar.cloneNode(true);
        newBtn.querySelector('.btn-text').textContent = 'Pagar próximo ciclo ahora';
        newBtn.classList.remove('from-green-500', 'to-emerald-600');
        newBtn.classList.add('from-orange-500', 'to-red-500');
        btnConfirmar.parentNode.replaceChild(newBtn, btnConfirmar);

        newBtn.addEventListener('click', () => {
            iniciarProcesoDePago(planSeleccionado, 'renew-downgrade', precioRenovacionCOP, precioRenovacionUSD);
            modal.classList.add('hidden');
        });
    }

    modal.classList.remove('hidden');
  }
  
  async function renderPlanes(conteoHabitacionesActual, conteoUsuariosActual) {
    planesList.innerHTML = '';
    
    (plans || []).forEach(plan => {
        let planKey = plan.nombre.trim().toLowerCase();
        let price = 0;
        let label = '';

        if (monedaActual === 'USD') {
            let priceUSD = USD_PRICES[planKey] || 30;
            price = periodoActual === 'anual' ? priceUSD * 10 : priceUSD;
            label = periodoActual === 'anual' ? 'año' : 'mes';
        } else {
            price = plan.precio_mensual;
            if (periodoActual === 'anual') price *= 10;
            label = periodoActual === 'anual' ? 'año' : 'mes';
        }

        const esPlanActual = plan.id === planActivo?.id;
        
        const limiteHabitaciones = plan.funcionalidades.limite_habitaciones;
        const limiteUsuarios = plan.funcionalidades.limite_usuarios;
        let motivoDeshabilitado = '';

        if (typeof limiteHabitaciones === 'number' && conteoHabitacionesActual > limiteHabitaciones) {
            motivoDeshabilitado = `Excedes el límite de ${limiteHabitaciones} habitaciones.`;
        }
        else if (typeof limiteUsuarios === 'number' && conteoUsuariosActual > limiteUsuarios) {
            motivoDeshabilitado = `Excedes el límite de ${limiteUsuarios} usuarios.`;
        }
        
        const puedeElegirPlan = !motivoDeshabilitado;

        let botonHTML = '';
        if (esPlanActual) {
            botonHTML = `<button class="w-full mt-4 py-2.5 px-4 rounded-lg text-white bg-gradient-to-br from-blue-500 to-blue-600 font-semibold cursor-not-allowed" disabled>Tu plan actual</button>`;
        } else if (puedeElegirPlan) {
            const tipoCambio = !esPlanActual && plan.precio_mensual < (planActivo?.precio_mensual || 0) ? 'downgrade' : 'upgrade';
            botonHTML = `<button class="btn-elegir-plan group w-full mt-4 py-2.5 px-4 rounded-lg text-white bg-gradient-to-br from-green-500 to-emerald-600 font-semibold transition-all duration-300 shadow-md hover:shadow-lg hover:scale-[1.03]" data-plan-id="${plan.id}" data-tipo-cambio="${tipoCambio}">
                <span class="flex items-center justify-center gap-2">Elegir este Plan <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg></span>
            </button>`;
        } else {
            botonHTML = `<div class="mt-4">
                <button class="w-full py-2.5 px-4 rounded-lg text-white bg-gray-400 font-semibold cursor-not-allowed" disabled>No elegible</button>
                <p class="text-xs text-center text-red-600 mt-2 font-medium">${motivoDeshabilitado}</p>
            </div>`;
        }

        planesList.innerHTML += `
            <div class="rounded-xl border shadow-sm p-4 flex flex-col justify-between ${esPlanActual ? 'border-blue-500 ring-2 ring-blue-300' : 'border-gray-200'} ${!puedeElegirPlan && !esPlanActual ? 'bg-gray-50 opacity-70' : ''}">
                <div>
                    <div class="font-bold text-blue-700 text-lg mb-2 flex items-center gap-1">${plan.nombre.charAt(0).toUpperCase() + plan.nombre.slice(1).toLowerCase()} ${esPlanActual ? '<span class="ml-2 px-2 py-0.5 bg-blue-100 text-blue-600 text-xs font-semibold rounded">Actual</span>' : ''}</div>
                    <div class="text-gray-600 text-sm mb-2">${plan.descripcion || ''}</div>
                    <div class="text-xl font-bold text-green-600 mb-2">${formatMoneda(price, monedaActual)} <span class="text-sm text-gray-400 font-normal">/${label}</span></div>
                    <ul class="list-disc pl-4 text-gray-500 text-xs mb-3 space-y-1">${(plan.funcionalidades?.descripcion_features || []).map(f => `<li>${f}</li>`).join('')}</ul>
                </div>
                ${botonHTML}
            </div>
        `;
    });

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
  }

  monedaSelector.addEventListener('change', (e) => {
    monedaActual = e.target.value;
    renderPlanes(conteoHabitaciones || 0, conteoUsuarios || 0);
  });
  tipoPagoSelector.addEventListener('change', (e) => {
    periodoActual = e.target.value;
    renderPlanes(conteoHabitaciones || 0, conteoUsuarios || 0);
  });

  await renderPlanes(conteoHabitaciones || 0, conteoUsuarios || 0);

  container.querySelector('#btnCopyRefLink')?.addEventListener('click', () => {
    const input = container.querySelector('#refLinkInput');
    input.select();
    document.execCommand('copy');
    showSnackbar(container, '¡Enlace copiado!', 'success');
  });

  container.querySelector('#btnRenovarPlan')?.addEventListener('click', () => {
      if (planActivo) {
          const planKey = planActivo.nombre.toLowerCase();
          const precioRenovacionCOP = periodoActual === 'anual' ? planActivo.precio_mensual * 10 : planActivo.precio_mensual;
          let precioRenovacionUSD = USD_PRICES[planKey] || 0;
          if (periodoActual === 'anual') {
              precioRenovacionUSD *= 10;
          }
          iniciarProcesoDePago(planActivo, 'renew', precioRenovacionCOP, precioRenovacionUSD);
      }
  });

  container.querySelector('#closeUpgradeModal')?.addEventListener('click', () => container.querySelector('#modalUpgrade').classList.add('hidden'));
  container.querySelector('#btnCambiarCorreo')?.addEventListener('click', () => container.querySelector('#modalCorreo').classList.remove('hidden'));
  container.querySelector('#closeCorreoModal')?.addEventListener('click', () => container.querySelector('#modalCorreo').classList.add('hidden'));
  container.querySelector('#btnCambiarPass')?.addEventListener('click', () => container.querySelector('#modalPass').classList.remove('hidden'));
  container.querySelector('#closePassModal')?.addEventListener('click', () => container.querySelector('#modalPass').classList.add('hidden'));

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

  container.querySelector('#formPass')?.addEventListener('submit', async e => {
    e.preventDefault();
    const nuevoPass = container.querySelector('#nuevoPass').value.trim();
    const confirmar = container.querySelector('#confirmarPass').value.trim();
    if (nuevoPass.length < 6) {
      showSnackbar(container, 'La contraseña debe tener al menos 6 caracteres', 'error'); return;
    }
    if (nuevoPass !== confirmar) {
      showSnackbar(container, 'Las contraseñas no coinciden', 'error'); return;
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

// =======================================================================
// ========================== FUNCIÓN DE DESMONTAJE ======================
// =======================================================================

export function unmount(container) {
  container.innerHTML = '';
}