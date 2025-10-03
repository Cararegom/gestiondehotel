// js/authService.js
import { supabase } from './supabaseClient.js';

let currentUser = null;
let authStateChangeListeners = [];

// --- Promise para resolver la sesión inicial de forma segura ---
let resolveInitialSession;
const initialSessionPromise = new Promise(resolve => {
    resolveInitialSession = resolve;
});

/**
 * Devuelve una promesa que se resuelve con la sesión inicial del usuario.
 * Esta es la forma segura de obtener al usuario al iniciar la aplicación.
 * @returns {Promise<{user: object | null, session: object | null}>}
 */
export function getUserSession() {
    return initialSessionPromise;
}

// Listener principal para cambios de estado (login, logout, etc.)
supabase.auth.onAuthStateChange((event, session) => {
  const previousUser = currentUser;
  currentUser = session?.user || null;
  
  if (previousUser?.id !== currentUser?.id || ['TOKEN_REFRESHED', 'SIGNED_IN', 'SIGNED_OUT'].includes(event)) {
    console.log('Auth Service: Notificando cambio de estado -', event);
    authStateChangeListeners.forEach(listener => listener(currentUser, session));
  }
});

/**
 * Devuelve el usuario actual de forma síncrona.
 * ADVERTENCIA: Puede ser `null` durante el arranque de la app.
 * Prefiere usar getUserSession() o onAuthStateChange() para la lógica de inicialización.
 */
export function getCurrentUser() {
  return currentUser;
}

/**
 * Se asegura de que haya una sesión activa, si no, redirige a login.
 */
export async function requireAuth() {
  const { user, session } = await getUserSession(); // Usa la función segura
  if (!user) {
    console.log('requireAuth: No hay usuario, redirigiendo a login.html...');
    if (!window.location.pathname.endsWith('/login.html')) {
        window.location.href = '/login.html';
    }
    return false;
  }
  return true; 
}

/**
 * Cierra la sesión del usuario.
 */
export async function handleLogout() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('Error al cerrar sesión:', error);
  } catch (e) {
    console.error('Excepción al cerrar sesión:', e);
  }
}

/**
 * Permite a otros módulos suscribirse a los cambios de estado de autenticación.
 */
export function onAuthStateChange(callback) {
  authStateChangeListeners.push(callback);
  // Llama inmediatamente con el estado actual al suscribirse
  getUserSession().then(({ user, session }) => {
    callback(user, session);
  });

  return {
    unsubscribe: () => {
      authStateChangeListeners = authStateChangeListeners.filter(l => l !== callback);
    }
  };
}

// --- Bloque de inicialización del servicio ---
// Obtiene la sesión una sola vez al cargar el script y resuelve la promesa.
(async () => {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    
    currentUser = session?.user || null;
    if (currentUser) {
      console.log('Auth Service: Sesión inicial recuperada para:', currentUser.email);
    } else {
      console.log('Auth Service: No hay sesión inicial activa.');
    }
    // Resuelve la promesa para que cualquier módulo en espera pueda continuar
    resolveInitialSession({ user: currentUser, session });
  } catch (error) {
    console.error("Auth Service: Error crítico al obtener sesión inicial:", error);
    currentUser = null;
    resolveInitialSession({ user: null, session: null }); // Resuelve incluso si hay error
  }
})();