import { supabase } from './supabaseClient.js';

let currentUser = null;
let authStateChangeListeners = [];
const AUTH_STORAGE_KEY = 'gestionhotel.auth';
let initialSessionResolved = false;
let latestAuthSnapshot = null;

let resolveInitialSession;
const initialSessionPromise = new Promise((resolve) => {
  resolveInitialSession = resolve;
});

export function getUserSession() {
  return initialSessionPromise;
}

function publishAuthSnapshot(event, session) {
  currentUser = session?.user || null;
  latestAuthSnapshot = Object.freeze({ event, session, user: currentUser });
  if (!initialSessionResolved) {
    initialSessionResolved = true;
    resolveInitialSession({ user: currentUser, session });
  }
  authStateChangeListeners.forEach((listener) => listener(latestAuthSnapshot));
}

// Unico listener de Supabase. El contrato publico siempre es { event, session, user }.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'INITIAL_SESSION' && initialSessionResolved) return;
  publishAuthSnapshot(event, session);
});

function removeAuthStorageEntries(storage) {
  if (!storage) return;
  const keysToRemove = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key === AUTH_STORAGE_KEY || (key?.startsWith('sb-') && key.includes('auth-token'))) keysToRemove.push(key);
  }
  keysToRemove.forEach((key) => storage.removeItem(key));
}

function notifySignedOut() {
  if (latestAuthSnapshot?.event === 'SIGNED_OUT' && !currentUser) return;
  publishAuthSnapshot('SIGNED_OUT', null);
}

async function clearLocalAuthState() {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    console.warn('Auth Service: no se pudo cerrar la sesion local; se limpiara el almacenamiento local.');
  }
  try {
    removeAuthStorageEntries(window.localStorage);
    removeAuthStorageEntries(window.sessionStorage);
  } catch {
    console.warn('Auth Service: no se pudo limpiar el almacenamiento de autenticacion.');
  }
  notifySignedOut();
}

export function getCurrentUser() {
  return currentUser;
}

export async function requireAuth() {
  const { user } = await getUserSession();
  if (!user) {
    if (!window.location.pathname.endsWith('/login.html')) window.location.href = '/login.html';
    return false;
  }
  return true;
}

export async function handleLogout({ redirectToLogin = false } = {}) {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) await clearLocalAuthState();
  } catch {
    await clearLocalAuthState();
  } finally {
    if (redirectToLogin && !window.location.pathname.endsWith('/login.html')) window.location.href = '/login.html';
  }
}

export function onAuthStateChange(callback) {
  authStateChangeListeners.push(callback);
  if (latestAuthSnapshot) queueMicrotask(() => callback(latestAuthSnapshot));
  return {
    unsubscribe: () => {
      authStateChangeListeners = authStateChangeListeners.filter((listener) => listener !== callback);
    }
  };
}

// Respaldo determinista; INITIAL_SESSION emitido por Supabase se deduplica arriba.
(async () => {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!initialSessionResolved) publishAuthSnapshot('INITIAL_SESSION', session);
  } catch {
    console.error('Auth Service: no fue posible recuperar la sesion inicial.');
    if (!initialSessionResolved) publishAuthSnapshot('INITIAL_SESSION', null);
  }
})();
