// ====================================================================
// ============ SCRIPT.JS - VERSIÓN FINAL CON REGISTRO DE REFERIDOS ====
// ====================================================================

// --- CAPTURA DE REFERIDO (SE EJECUTA AL CARGAR LA PÁGINA) ---
const params = new URLSearchParams(window.location.search);
const refId = params.get('ref');
if (refId) {
  localStorage.setItem('referido_id', refId);
}
// ----------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const sliderWrapper = document.querySelector('.slider-wrapper');
  if (!sliderWrapper) return;

  let slides = sliderWrapper.querySelectorAll('.slide');
  if (slides.length === 0) return;

  let currentSlide = 0;
  let isTransitioning = false;

  // Clonar el primer slide al final
  const firstSlideClone = slides[0].cloneNode(true);
  sliderWrapper.appendChild(firstSlideClone);

  // Recalcular slides luego de clonar
  slides = sliderWrapper.querySelectorAll('.slide');
  const totalSlides = slides.length;

  // Establecer el ancho del wrapper según la cantidad de slides
  sliderWrapper.style.width = `${totalSlides * 100}%`;


  function goToNextSlide() {
    if (isTransitioning) return;
    isTransitioning = true;
    currentSlide++;

    sliderWrapper.style.transition = 'transform 0.8s ease-in-out';
    sliderWrapper.style.transform = `translateX(-${currentSlide * 100 / totalSlides}%)`;

  }

  // Cuando termina la transición
  sliderWrapper.addEventListener('transitionend', () => {
    // Si está en el slide clonado
    if (currentSlide === totalSlides - 1) {
      sliderWrapper.style.transition = 'none';
      currentSlide = 0;
      sliderWrapper.style.transform = `translateX(0vw)`;
    }
    isTransitioning = false;
  });

  // Iniciar carrusel automático
  setInterval(goToNextSlide, 6000); // Más tiempo para que se lea bien el contenido
});

// Importaciones y constantes globales
import { supabase } from '/js/supabaseClient.js'; // Ajusta la ruta si es necesario

// Debes poner aquí el rol_id real de "Administrador" en tu tabla "roles"
const ADMIN_ROL_ID = '76b034c3-e70d-44a1-98ee-9c6eabde6f2b';

// ---- FUNCIONES DE UTILERÍA ----
function showAlert(element, message, type = 'info', duration = 0) {
    if (!element) return;
    element.className = `alert alert-${type} mt-3`;
    element.textContent = message;
    element.classList.remove('d-none');
    if (element.alertTimeout) clearTimeout(element.alertTimeout);
    if (duration > 0) {
        element.alertTimeout = setTimeout(() => {
            element.classList.add('d-none'); element.textContent = '';
        }, duration);
    }
}
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).toLowerCase());
}

// ---- LÓGICA DE LA PÁGINA ----
document.addEventListener('DOMContentLoaded', () => {
    let registroModalInstance;
    const registroModalElement = document.getElementById('registroModal');
    if (registroModalElement) {
        registroModalInstance = new bootstrap.Modal(registroModalElement);
    }

    const planButtons = document.querySelectorAll('#pricing .plan-button-select');
    planButtons.forEach(button => {
        button.addEventListener('click', () => {
            const planId = button.getAttribute('data-plan-id');
            localStorage.setItem('selectedPlanGlobal', planId);
            if (registroModalInstance) registroModalInstance.show();
        });
    });

    // --- LÓGICA DE REGISTRO DE CUENTA NUEVA ---
    const registroForm = document.getElementById('registroForm');
    if (registroForm) {
        registroForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const hotelName = document.getElementById('hotelName').value.trim();
            const adminName = document.getElementById('adminName').value.trim();
            const email = document.getElementById('registroEmail').value.trim();
            const password = document.getElementById('registroPassword').value;
            // ... (resto de tus validaciones)

            showAlert(document.getElementById('registroFormAlert'), 'Procesando registro...', 'info');

            try {
                // 1. Registro en Supabase Auth
                const { data: authData, error: authError } = await supabase.auth.signUp({
                    email: email,
                    password: password,
                    options: { data: { full_name: adminName } }
                });
                if (authError) throw authError;

                const supabaseUserId = authData.user?.id;
                const now = new Date();
                const trialEnd = new Date();
                trialEnd.setDate(now.getDate() + 30);

                const idDeReferido = localStorage.getItem('referido_id');

                // 2. Creación del hotel
                const { data: hotelData, error: hotelError } = await supabase
                    .from('hoteles')
                    .insert({
                        nombre: hotelName,
                        correo: email,
                        plan: 'max', // O el plan que corresponda
                        estado_suscripcion: 'trial',
                        trial_inicio: now.toISOString(),
                        trial_fin: trialEnd.toISOString(),
                        suscripcion_fin: trialEnd.toISOString(),
                        creado_por: supabaseUserId,
                        referido_por: idDeReferido || null,
                    })
                    .select('id')
                    .single();
                
                if (hotelError) throw hotelError;
                
                // --- LÓGICA CORREGIDA PARA REGISTRAR EL REFERIDO ---
                if (idDeReferido) {
                    await supabase
                        .from('referidos')
                        .insert({
                            referidor_id: idDeReferido,
                            nombre_hotel_referido: hotelName,
                            estado: 'trial', // El referido empieza en 'trial'
                            recompensa_otorgada: false
                        });
                }
                // --- FIN DE LA CORRECCIÓN ---

                // 3. Creación del perfil de usuario y rol (sin cambios)
                await supabase.from('usuarios').insert({
                    id: supabaseUserId,
                    nombre: adminName,
                    hotel_id: hotelData.id,
                    correo: email,
                    rol: 'admin'
                });
                await supabase.from('usuarios_roles').insert({
                    usuario_id: supabaseUserId,
                    rol_id: ADMIN_ROL_ID,
                    hotel_id: hotelData.id,
                });

                localStorage.removeItem('referido_id');
                showAlert(document.getElementById('registroFormAlert'), '¡Cuenta creada con éxito!', 'success');
                registroForm.reset();
                // Disparar evento personalizado para Google Tag Manager
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event: 'crear_cuenta'
});
setTimeout(() => {
  window.location.href = '/index.html#/registro-exitoso';
}, 300);
                window.location.href = '/index.html#/registro-exitoso';



            } catch (error) {
                showAlert(document.getElementById('registroFormAlert'), `Error: ${error.message}`, 'danger');
            }
        });
    }
});
// --- PRECIOS FIJOS ---
// Si quieres puedes extraer esto a un archivo config
const PLANES_LANDING = [
    { id: 'lite', nombre: 'Lite', cop: 99000, usd: 30, eur: 30 },
    { id: 'pro',  nombre: 'Pro',  cop: 149000, usd: 45, eur: 45 },
    { id: 'max',  nombre: 'Max',  cop: 199000, usd: 60, eur: 60 }
];

function formatMonedaLanding(valor, moneda) {
    if (moneda === 'USD') {
        return '$' + valor.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }
    if (moneda === 'EUR') {
        return '€' + valor.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }
    // COP
    return '$' + valor.toLocaleString('es-CO', { maximumFractionDigits: 0 });
}

function actualizarPreciosLanding() {
    const moneda = document.getElementById('monedaLandingSelector')?.value || 'COP';
    const periodo = document.getElementById('periodoLandingSelector')?.value || 'mensual';
    PLANES_LANDING.forEach(plan => {
        // Obtiene el precio según la moneda seleccionada
        let precio = plan[moneda.toLowerCase()];
        let labelUnidad = (moneda === 'USD' ? 'USD' : (moneda === 'EUR' ? 'EUR' : 'COP')) + '/' + (periodo === 'anual' ? 'año' : 'mes');
        let precioAnual = plan[moneda.toLowerCase()] * 10;
        let badgeAhorro = `Anual: ${formatMonedaLanding(precioAnual, moneda)} (Ahorra ${formatMonedaLanding(precio*2, moneda)})`;

        // Si es anual, multiplicar precio * 10 (2 meses gratis)
        let mostrarPrecio = periodo === 'anual' ? precio * 10 : precio;
        let unidad = (moneda === 'USD' ? 'USD' : (moneda === 'EUR' ? 'EUR' : 'COP')) + '/' + (periodo === 'anual' ? 'año' : 'mes');
        
        document.getElementById('precio-' + plan.id).textContent = formatMonedaLanding(mostrarPrecio, moneda);
        document.getElementById('unidad-' + plan.id).textContent = unidad;
        document.getElementById('anual-' + plan.id).textContent = badgeAhorro;

        // Opcional: Cambia texto del botón para mostrar precio seleccionado
        const btn = document.getElementById('btn-' + plan.id);
        if(btn) btn.innerHTML = `Suscribirme a ${plan.nombre} <span class="fw-bold">(${formatMonedaLanding(mostrarPrecio, moneda)})</span>`;
    });
}

// Listeners para cambiar moneda y periodo
document.getElementById('monedaLandingSelector')?.addEventListener('change', actualizarPreciosLanding);
document.getElementById('periodoLandingSelector')?.addEventListener('change', actualizarPreciosLanding);

// Al cargar la página
document.addEventListener('DOMContentLoaded', actualizarPreciosLanding);
