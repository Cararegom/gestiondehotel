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
  element.innerHTML = message; // <-- ESTE ES EL CAMBIO CLAVE
  element.classList.remove('d-none');
  if (element.alertTimeout) clearTimeout(element.alertTimeout);
  if (duration > 0) {
      element.alertTimeout = setTimeout(() => {
          element.classList.add('d-none'); element.innerHTML = ''; // <-- Y aquí también
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

     const togglePassword = document.querySelector('#togglePassword');
    const passwordInput = document.querySelector('#registroPassword');
    const toggleConfirmPassword = document.querySelector('#toggleConfirmPassword');
    const confirmPasswordInput = document.querySelector('#confirmPassword');

    if (togglePassword) {
        togglePassword.addEventListener('click', function () {
            // Cambia el tipo del input
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            // Cambia el ícono
            this.classList.toggle('bi-eye-slash-fill');
            this.classList.toggle('bi-eye-fill');
        });
    }

    if (toggleConfirmPassword) {
        toggleConfirmPassword.addEventListener('click', function () {
            // Cambia el tipo del input
            const type = confirmPasswordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            confirmPasswordInput.setAttribute('type', type);
            // Cambia el ícono
            this.classList.toggle('bi-eye-slash-fill');
            this.classList.toggle('bi-eye-fill');
        });
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
            const alertElement = document.getElementById('registroFormAlert');
            
            // 1. OBTENER Y VALIDAR DATOS DEL FORMULARIO (VALIDACIÓN FRONT-END)
            const hotelName = document.getElementById('hotelName').value.trim();
            const adminName = document.getElementById('adminName').value.trim();
            const email = document.getElementById('registroEmail').value.trim();
            const password = document.getElementById('registroPassword').value;
            const confirmPasswordValue = document.getElementById('confirmPassword').value;

            if (!hotelName || !adminName || !email || !password || !confirmPasswordValue) {
                showAlert(alertElement, 'Todos los campos con * son obligatorios.', 'warning');
                return;
            }
            if (!isValidEmail(email)) {
                showAlert(alertElement, 'Por favor, introduce una dirección de correo válida.', 'warning');
                return;
            }
            if (password.length < 6) {
                showAlert(alertElement, 'La contraseña debe tener al menos 6 caracteres.', 'warning');
                return;
            }
            if (password !== confirmPasswordValue) {
                showAlert(alertElement, 'Las contraseñas no coinciden.', 'warning');
                return;
            }
         

            // Si todas las validaciones pasan, mostramos un mensaje de "procesando"
            showAlert(alertElement, 'Creando tu cuenta, por favor espera...', 'info');
            const submitButton = registroForm.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            submitButton.innerHTML = 'Procesando...';

            try {
                // 2. PROCESO DE REGISTRO CON SUPABASE (LÓGICA BACK-END)
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

                const { data: hotelData, error: hotelError } = await supabase.from('hoteles').insert({ 
                    nombre: hotelName, 
                    correo: email, 
                    plan: 'max', 
                    estado_suscripcion: 'trial', 
                    trial_inicio: now.toISOString(), 
                    trial_fin: trialEnd.toISOString(), 
                    suscripcion_fin: trialEnd.toISOString(), 
                    creado_por: supabaseUserId, 
                    referido_por: idDeReferido || null 
                }).select('id').single();

                if (hotelError) throw hotelError;
                
                if (idDeReferido) { await supabase.from('referidos').insert({ referidor_id: idDeReferido, nombre_hotel_referido: hotelName, estado: 'trial', recompensa_otorgada: false }); }
                await supabase.from('usuarios').insert({ id: supabaseUserId, nombre: adminName, hotel_id: hotelData.id, correo: email, rol: 'admin' });
                await supabase.from('usuarios_roles').insert({ usuario_id: supabaseUserId, rol_id: ADMIN_ROL_ID, hotel_id: hotelData.id });

                // 3. ÉXITO
                localStorage.removeItem('referido_id');
                registroForm.reset();
                alertElement.classList.add('d-none');
                
                window.dataLayer = window.dataLayer || [];
                window.dataLayer.push({ 'event': 'crear_cuenta' });
                console.log("Evento 'crear_cuenta' enviado a dataLayer.");
                
                registrationWasSuccessful = true;
                if (registroModalInstance) registroModalInstance.hide();    

            } catch (error) {
                // Mantenemos nuestro "chivato" para futuras revisiones
                console.log("El error COMPLETO de Supabase es:", error);

                let userMessage = "Ocurrió un error inesperado. Por favor, revisa tus datos o inténtalo de nuevo más tarde.";

                // --- INICIO DE LA LÓGICA CORREGIDA ---

                // 1. Buscamos PRIMERO el error de la base de datos que descubrimos.
                if (error.message && error.message.includes('hoteles_correo_key')) {
                    userMessage = 'Ese correo ya está siendo usado como contacto principal de otro hotel. <a href="/login.html" class="font-bold underline hover:text-blue-700">¿Deseas iniciar sesión?</a>';
                
                // 2. Mantenemos la revisión del error de autenticación por si acaso.
                } else if (error.message && error.message.toLowerCase().includes('user already registered')) {
                    userMessage = 'Este correo ya está registrado en la plataforma. <a href="/login.html" class="font-bold underline hover:text-blue-700">¿Deseas iniciar sesión?</a>';

                // 3. Mantenemos los otros errores que ya manejábamos.
                } else if (error.message.includes('duplicate key value') && error.message.includes('hoteles_nombre_key')) {
                    userMessage = "El nombre de este hotel ya ha sido registrado. Por favor, elige otro.";
                } else if (error.message.includes('Password should be at least 6 characters')) {
                    userMessage = "La contraseña es demasiado corta. Debe tener al menos 6 caracteres.";
                }
                
                // --- FIN DE LA LÓGICA CORREGIDA ---
                
                showAlert(alertElement, userMessage, 'danger');

            } finally {
                // Reactivamos el botón sin importar si hubo éxito o error
                submitButton.disabled = false;
                submitButton.innerHTML = '¡Crear mi Cuenta y Empezar Prueba GRATIS!';
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