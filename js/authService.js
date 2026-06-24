// js/authService.js
import { supabase } from './supabaseClient.js';

let currentUser = null;
let authStateChangeListeners = [];
const AUTH_STORAGE_KEY = 'gestionhotel.auth';

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

function isMissingRemoteSessionError(error) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || '').toLowerCase();
  return status === 403 && message.includes('session') && message.includes('does not exist');
}

function removeAuthStorageEntries(storage) {
  if (!storage) return;

  const keysToRemove = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key) continue;
    if (key === AUTH_STORAGE_KEY || (key.startsWith('sb-') && key.includes('auth-token'))) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => storage.removeItem(key));
}

function notifySignedOut() {
  currentUser = null;
  authStateChangeListeners.forEach(listener => listener(null, null));
}

async function clearLocalAuthState() {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch (error) {
    console.warn('Auth Service: no se pudo cerrar la sesion local desde Supabase, limpiando storage manualmente.', error);
  }

  try {
    removeAuthStorageEntries(window.localStorage);
    removeAuthStorageEntries(window.sessionStorage);
  } catch (error) {
    console.warn('Auth Service: no se pudo limpiar storage de autenticacion.', error);
  }

  notifySignedOut();
}

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
export async function handleLogout({ redirectToLogin = false } = {}) {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      if (isMissingRemoteSessionError(error)) {
        console.warn('Auth Service: la sesion remota ya no existe. Se limpiara la sesion local.');
      } else {
        console.error('Error al cerrar sesion:', error);
      }
      await clearLocalAuthState();
    }
  } catch (error) {
    console.error('Excepcion al cerrar sesion:', error);
    await clearLocalAuthState();
  } finally {
    if (redirectToLogin && !window.location.pathname.endsWith('/login.html')) {
      window.location.href = '/login.html';
    }
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
