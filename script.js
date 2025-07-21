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



document.addEventListener('DOMContentLoaded', async () => {
    // --- INICIO: CÓDIGO DE REDIRECCIÓN INTELIGENTE ---
    try {
        const { data: { session } } = await supabase.auth.getSession();

        // Si hay una sesión activa, el usuario ya está logueado.
        if (session) {
            console.log('Sesión activa encontrada, redirigiendo al dashboard...');
            // Redirigir al panel principal de la aplicación.
            window.location.href = '/app/index.html#/dashboard';
            return; // Detiene la ejecución del resto del script para evitar cargar cosas innecesarias.
        }
        // Si no hay sesión, no hace nada y deja que se muestre la landing page.
        console.log('No hay sesión activa, mostrando landing page.');

    } catch (error) {
        console.error('Error al verificar la sesión:', error);
        // En caso de error, simplemente muestra la landing page.
    }
    
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

    // --- LÓGICA DE REGISTRO DE CUENTA NUEVA (CORREGIDA) ---
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
                // 1. Registro en Supabase Auth. Esta es la conversión principal.
                const { data: authData, error: authError } = await supabase.auth.signUp({
                    email: email,
                    password: password,
                    options: { data: { full_name: adminName } }
                });
                if (authError) throw authError;

                // 2. Se activa la etiqueta INMEDIATAMENTE después del éxito del signUp.
                window.dataLayer = window.dataLayer || [];
                window.dataLayer.push({ 'event': 'crear_cuenta' });
                console.log("Evento 'crear_cuenta' enviado a dataLayer.");

                // 3. El resto de las operaciones de base de datos continúan.
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
                
                registrationWasSuccessful = true;
                registroModalInstance.hide();    

            } catch (error) {
                showAlert(document.getElementById('registroFormAlert'), `Error: ${error.message}`, 'danger');
            }
        });
    }

    // Listener para el botón "Entendido" del modal de éxito (CORREGIDO)
    const okButton = document.getElementById('btn-ok-registro-exitoso');
    if (okButton) {
        okButton.addEventListener('click', () => {
            // La etiqueta ya se envió. Simplemente redirigimos al usuario.
            window.location.href = '/login.html';
        });
    }
});