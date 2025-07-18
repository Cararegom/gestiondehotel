// ====================================================================
// ============ SCRIPT.JS - VERSIÓN FINAL Y FUNCIONAL =================
// ====================================================================

// --- CAPTURA DE REFERIDO (SE EJECUTA AL CARGAR LA PÁGINA) ---
const params = new URLSearchParams(window.location.search);
const refId = params.get('ref');
if (refId) {
  localStorage.setItem('referido_id', refId);
}
// ----------------------------------------------------------------

// Importaciones y constantes globales
import { supabase } from '/js/supabaseClient.js';

// Debes poner aquí el rol_id real de "Administrador" en tu tabla "roles"
const ADMIN_ROL_ID = '76b034c3-e70d-44a1-98ee-9c6eabde6f2b';

// ===================================================================
// ========= INICIO: FUNCIONES DE UTILIDAD (NECESARIAS) =========
// ===================================================================
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
// ===================================================================
// ========= FIN: FUNCIONES DE UTILIDAD (NECESARIAS) ==========
// ===================================================================



document.addEventListener('DOMContentLoaded', () => {
    
    // --- MANEJO DE MODALES Y REGISTRO ---
    const registroModalElement = document.getElementById('registroModal');
    const registroExitosoModalElement = document.getElementById('registroExitosoModal');
    let registroModalInstance;
    let registroExitosoModalInstance;
    let registrationWasSuccessful = false; 

    if (registroModalElement) {
        registroModalInstance = new bootstrap.Modal(registroModalElement);

        registroModalElement.addEventListener('hidden.bs.modal', () => {
            if (registrationWasSuccessful) {
                if (registroExitosoModalInstance) {
                    registroExitosoModalInstance.show(); 
                }
                registrationWasSuccessful = false; 
            }
        });
    }

    if (registroExitosoModalElement) {
        registroExitosoModalInstance = new bootstrap.Modal(registroExitosoModalElement);
    }
    
    const urlParamsForModal = new URLSearchParams(window.location.search);
    if (urlParamsForModal.get('modal') === 'registro') {
        if (registroModalInstance) {
            registroModalInstance.show();
        }
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

            showAlert(document.getElementById('registroFormAlert'), 'Procesando registro...', 'info');

            try {
                // 1. Registro en Supabase Auth
                const { data: authData, error: authError } = await supabase.auth.signUp({
                    email: email,
                    password: password,
                    options: { data: { full_name: adminName } }
                });
                if (authError) throw authError;

                // Lógica de creación de hotel, usuario, etc... (sin cambios)
                const supabaseUserId = authData.user?.id;
                const now = new Date();
                const trialEnd = new Date();
                trialEnd.setDate(now.getDate() + 30);
                const idDeReferido = localStorage.getItem('referido_id');
                const { data: hotelData, error: hotelError } = await supabase.from('hoteles').insert({ nombre: hotelName, correo: email, plan: 'max', estado_suscripcion: 'trial', trial_inicio: now.toISOString(), trial_fin: trialEnd.toISOString(), suscripcion_fin: trialEnd.toISOString(), creado_por: supabaseUserId, referido_por: idDeReferido || null }).select('id').single();
                if (hotelError) throw hotelError;
                if (idDeReferido) { await supabase.from('referidos').insert({ referidor_id: idDeReferido, nombre_hotel_referido: hotelName, estado: 'trial', recompensa_otorgada: false }); }
                await supabase.from('usuarios').insert({ id: supabaseUserId, nombre: adminName, hotel_id: hotelData.id, correo: email, rol: 'admin' });
                await supabase.from('usuarios_roles').insert({ usuario_id: supabaseUserId, rol_id: ADMIN_ROL_ID, hotel_id: hotelData.id });
                localStorage.removeItem('referido_id');
                registroForm.reset();
                document.getElementById('registroFormAlert').classList.add('d-none');

                // --- INICIO DE LA CORRECCIÓN ---
                // Se envía el evento con un 'callback' que se ejecutará DESPUÉS de que las etiquetas se disparen.
                window.dataLayer = window.dataLayer || [];
                window.dataLayer.push({ 
                    'event': 'crear_cuenta',
                    'eventCallback': function() {
                        console.log("GTM Callback ejecutado: Redirigiendo a login.html");
                        window.location.href = '/login.html';
                    },
                    'eventTimeout': 2000 // Máximo 2 segundos de espera como seguridad
                });
                // --- FIN DE LA CORRECCIÓN ---

                registrationWasSuccessful = true;
                registroModalInstance.hide();    

            } catch (error) {
                showAlert(document.getElementById('registroFormAlert'), `Error: ${error.message}`, 'danger');
            }
        });
    }

    // Listener para el botón "Entendido" del modal de éxito
    const okButton = document.getElementById('btn-ok-registro-exitoso');
    if (okButton) {
        okButton.addEventListener('click', () => {
            // --- CAMBIO AQUÍ ---
            // El botón ya no redirige directamente. Solo cierra el modal.
            // La redirección ahora es manejada por el eventCallback de GTM.
            // Si el callback falla por alguna razón (ej. GTM bloqueado), el usuario
            // puede hacer clic de nuevo o la página quedará ahí, pero la etiqueta ya se habrá enviado.
            if (registroExitosoModalInstance) {
                registroExitosoModalInstance.hide();
            }
             // Como fallback, si después de 2 segundos el callback no ha redirigido, 
             // forzamos la redirección para no dejar al usuario esperando.
            setTimeout(() => {
                if (window.location.pathname.includes('index.html')) { // Solo si seguimos en la misma página
                   window.location.href = '/login.html';
                }
            }, 2100);
        });
    }
});