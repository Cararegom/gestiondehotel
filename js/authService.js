// js/authService.js
import { supabase } from './supabaseClient.js';

let currentUser = null;
let authStateChangeListeners = [];

supabase.auth.onAuthStateChange((event, session) => {
  const previousUser = currentUser;
  currentUser = session?.user || null;
  console.log('Auth state changed:', event, currentUser);
  if (previousUser?.id !== currentUser?.id || (event === 'TOKEN_REFRESHED' && session) || event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && session)) {
    authStateChangeListeners.forEach(listener => listener(currentUser, session));
  }
});

export function getCurrentUser() {
  return currentUser;
}

export async function requireAuth() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
      console.error("Error en requireAuth al obtener sesión:", error);
      // Redirigir a la PÁGINA login.html, no a un hash
      if (!window.location.pathname.endsWith('/login.html')) {
        window.location.href = '/login.html';
      }
      return false;
  }

  if (!session?.user) {
    console.log('Usuario no autenticado en requireAuth, redirigiendo a login.html...');
    // Redirigir a la PÁGINA login.html, no a un hash
    if (!window.location.pathname.endsWith('/login.html')) {
        window.location.href = '/login.html';
    }
    return false; 
  }
  if (!currentUser || currentUser.id !== session.user.id) {
      currentUser = session.user;
  }
  return true; 
}

export async function handleLogout(supabaseInstance) {
  try {
    const { error } = await supabaseInstance.auth.signOut();
    if (error) {
      console.error('Error al cerrar sesión:', error);
    } else {
      console.log('Sesión cerrada exitosamente vía handleLogout.');
      // onAuthStateChange en main.js se encargará de la redirección a login.html
    }
  } catch (e) {
    console.error('Excepción al cerrar sesión:', e);
  }
}

export function onAuthStateChange(callback) {
  authStateChangeListeners.push(callback);
  (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      callback(currentUser, session); // Llama con el estado actual al suscribirse
  })();

  return {
    unsubscribe: () => {
      authStateChangeListeners = authStateChangeListeners.filter(listener => listener !== callback);
    }
  };
}

(async () => {
  console.log("authService.js: Intentando obtener sesión inicial...");
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
      console.error("authService.js: Error al obtener sesión inicial:", error);
      currentUser = null;
  } else {
      currentUser = session?.user || null;
  }
  
  if (currentUser) {
    console.log('authService.js: Sesión inicial recuperada para:', currentUser.email);
  } else {
    console.log('authService.js: No hay sesión inicial activa.');
  }
  // Notificar a los listeners después de determinar el estado inicial
  authStateChangeListeners.forEach(listener => listener(currentUser, session));
})();
