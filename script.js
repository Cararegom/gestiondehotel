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
                window.location.href = '/index.html#/registro-exitoso';


            } catch (error) {
                showAlert(document.getElementById('registroFormAlert'), `Error: ${error.message}`, 'danger');
            }
        });
    }
});
