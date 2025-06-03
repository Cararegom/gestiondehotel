import { supabase } from '/js/supabaseClient.js'; // Ajusta la ruta si es necesario
import * as Chart from 'chart.js';

const WOMPI_PUBLIC_KEY = 'pub_prod_7qQum1STAjqRoaupXWNwcSvwSFZ9ANq0';
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

// ---- REGISTRO DE USUARIO ----
document.addEventListener('DOMContentLoaded', () => {
    let registroModalInstance;
    const registroModalElement = document.getElementById('registroModal');
    if (registroModalElement) {
        registroModalInstance = new bootstrap.Modal(registroModalElement);
    }

    // Selección de plan (si quisieras permitirla desde la UI, si no siempre será "max")
    const planButtons = document.querySelectorAll('#pricing .plan-button[data-plan-id]');
    planButtons.forEach(button => {
        button.addEventListener('click', () => {
            const planId = button.getAttribute('data-plan-id');
            localStorage.setItem('selectedPlanGlobal', planId);
            if (registroModalInstance) registroModalInstance.show();
        });
    });

    // Registro de usuario
    const registroForm = document.getElementById('registroForm');
    if (registroForm) {
        registroForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const hotelName = document.getElementById('hotelName').value.trim();
            const adminName = document.getElementById('adminName').value.trim();
            const email = document.getElementById('registroEmail').value.trim();
            const password = document.getElementById('registroPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            // Opcional: Si tienes un campo ciudad/país
            const countryCityInput = document.getElementById('countryCity');
            const countryCity = countryCityInput ? countryCityInput.value.trim() : null;
            // Siempre usar plan max, o desde el botón si lo dejas
            const selectedPlan = localStorage.getItem('selectedPlanGlobal') || 'max';

            if (!hotelName || !adminName || !email || !password || !confirmPassword) {
                showAlert(document.getElementById('registroFormAlert'), 'Completa todos los campos obligatorios.', 'danger');
                return;
            }
            if (!isValidEmail(email)) {
                showAlert(document.getElementById('registroFormAlert'), 'Email no válido.', 'danger');
                return;
            }
            if (password.length < 6) {
                showAlert(document.getElementById('registroFormAlert'), 'Contraseña mínimo 6 caracteres.', 'danger');
                return;
            }
            if (password !== confirmPassword) {
                showAlert(document.getElementById('registroFormAlert'), 'Las contraseñas no coinciden.', 'danger');
                return;
            }

            try {
                // 1. Registro en Supabase Auth
                const { data: authData, error: authError } = await supabase.auth.signUp({
                    email: email,
                    password: password,
                    options: { data: { full_name: adminName } }
                });
                if (authError) throw authError;

                // 1.1 Recuperar el ID del usuario creado en Auth
                const supabaseUserId = authData.user?.id;
                if (!supabaseUserId) {
                    showAlert(document.getElementById('registroFormAlert'), 'No se pudo obtener el ID de usuario de Supabase Auth.', 'danger');
                    return;
                }

                // 2. Registro en tabla hoteles
                const now = new Date();
                const trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 días trial

                const { data: hotelData, error: hotelError } = await supabase
                    .from('hoteles')
                    .insert({
                        nombre: hotelName,
                        correo: email,
                        ciudad: countryCity,
                        plan: selectedPlan,
                        estado_suscripcion: 'trial',
                        creado_en: now,
                        actualizado_en: now,
                        trial_inicio: now,
                        trial_fin: trialEnd.toISOString(),
                        suscripcion_fin: null
                    })
                    .select('id, trial_fin, suscripcion_fin')
                    .single();

                // ----------- MANEJO DE CORREO DUPLICADO --------------
                if (hotelError) {
                    if (
                        hotelError.code === '23505' || // Supabase/PG duplicate key
                        hotelError.status === 409 ||   // HTTP 409 Conflict
                        (hotelError.message && hotelError.message.toLowerCase().includes('duplicate key'))
                    ) {
                        showAlert(document.getElementById('registroFormAlert'), 'Este correo ya está registrado como hotel. Inicia sesión o usa otro correo.', 'danger');
                    } else {
                        showAlert(document.getElementById('registroFormAlert'), hotelError.message, 'danger');
                    }
                    return;
                }
                // ------------------------------------------------------

                // 3. Registro en tabla usuarios (usa el id de Auth, NO generes uno nuevo)
                const { data: usuarioInsert, error: usuarioError } = await supabase
                    .from('usuarios')
                    .insert({
                        id: supabaseUserId, // <--- Usar el id del usuario de Auth
                        nombre: adminName,
                        hotel_id: hotelData.id,
                        correo: email,
                        activo: true,
                        suscripcion_hasta: hotelData.trial_fin, // Campo en usuarios para saber hasta cuándo tiene trial
                        creado_en: now,
                        actualizado_en: now,
                        rol: 'admin'
                    })
                    .select('id')
                    .single();
                if (usuarioError) throw usuarioError;

                // 4. Insertar en usuarios_roles (como Administrador)
                await supabase.from('usuarios_roles').insert({
                    usuario_id: usuarioInsert.id,
                    rol_id: ADMIN_ROL_ID,
                    hotel_id: hotelData.id,
                    creado_en: now.toISOString()
                });

                // Guarda el hotel_id y trial_fin en localStorage
                localStorage.setItem('hotel_id', hotelData.id);
                localStorage.setItem('trial_fin', hotelData.trial_fin);
                localStorage.setItem('userEmail', email);

                showAlert(document.getElementById('registroFormAlert'), '¡Cuenta creada! Revisa tu email para confirmar.', 'success');
                registroForm.reset();
                setTimeout(() => window.location.href = 'login.html', 3000);

            } catch (error) {
                showAlert(document.getElementById('registroFormAlert'), error.message, 'danger');
            }
        });
    }

    // ---- BLOQUEO AUTOMÁTICO POR TRIAL O SUSCRIPCIÓN ----
    async function checkSubscriptionStatus() {
        // Obtén el usuario logueado de Supabase
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return; // No logueado

        const userEmail = session.user.email;
        // Busca el hotel del usuario (ajusta según lógica real)
        const { data: hotelData, error } = await supabase
            .from('hoteles')
            .select('trial_fin, suscripcion_fin, plan, estado_suscripcion')
            .eq('correo', userEmail)
            .single();
        if (error) return;

        const trialFin = hotelData.trial_fin ? new Date(hotelData.trial_fin) : null;
        const suscripcionFin = hotelData.suscripcion_fin ? new Date(hotelData.suscripcion_fin) : null;
        const hoy = new Date();

        // Bloquea si terminó trial y no tiene suscripción activa
        if ((trialFin && hoy > trialFin) && (!suscripcionFin || hoy > suscripcionFin)) {
            // BLOQUEAR ACCESO, mostrar modal de pago
            const modal = new bootstrap.Modal(document.getElementById('modalBloqueoSuscripcion'));
            modal.show();
            document.body.classList.add('bloqueado-por-suscripcion');
        }
    }

    // Llama a la función al cargar
    checkSubscriptionStatus();

    // ---- PAGO DE SUSCRIPCIÓN (WOMPI) ----
    function handlePago(planOverride) {
        const hotel_id = localStorage.getItem('hotel_id');
        const selectedPlan = planOverride || localStorage.getItem('selectedPlanGlobal') || 'max';
        // Monto por plan
        let monto = 99000; // COP por defecto
        if (selectedPlan === 'pro') monto = 149000;
        if (selectedPlan === 'max') monto = 199000;
        // reference para Wompi
        const reference = `hotel_${hotel_id}-${selectedPlan}`;
        const userEmail = localStorage.getItem('userEmail');

        const checkoutData = {
            currency: "COP",
            amount_in_cents: monto * 100,
            reference: reference,
            customer_email: userEmail || "cliente@correo.com",
        };

        if (window.WompiCheckout) {
            window.WompiCheckout.open(checkoutData);
        } else {
            window.location.href = `https://checkout.wompi.co/p/?public-key=${WOMPI_PUBLIC_KEY}&currency=${checkoutData.currency}&amount-in-cents=${checkoutData.amount_in_cents}&reference=${checkoutData.reference}&customer-email=${checkoutData.customer_email}`;
        }
    }

    // Botón principal
    const btnPagar = document.getElementById('btnPagar');
    if (btnPagar) {
        btnPagar.addEventListener('click', () => handlePago());
    }

    // Botón del modal de bloqueo
    const btnPagarModal = document.getElementById('btnPagarModal');
    if (btnPagarModal) {
        btnPagarModal.addEventListener('click', () => handlePago());
    }
});
