import { supabase } from './supabaseClient.js';

const CHECK_INTERVAL_MS = 30000;
let checking = false;
let redirecting = false;
let intervalId = null;

async function forceArchivedSignOut() {
  if (redirecting) return;
  redirecting = true;
  try {
    await supabase.auth.signOut();
  } catch (error) {
    console.warn('[ActiveUserGuard] No se pudo cerrar la sesión remota:', error?.message || error);
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // La redirección evita que el usuario siga operando incluso si el cierre remoto falla.
    }
  } finally {
    if (!window.location.pathname.endsWith('/login.html')) {
      window.location.replace('/login.html?access=archived');
    }
  }
}

export async function verifyCurrentUserIsActive() {
  if (checking || redirecting) return true;
  checking = true;
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return true;

    const { data: profile, error: profileError } = await supabase
      .from('usuarios')
      .select('activo')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      console.warn('[ActiveUserGuard] No se pudo verificar el estado del usuario:', profileError.message);
      return true;
    }

    if (profile && profile.activo === false) {
      await forceArchivedSignOut();
      return false;
    }
    return true;
  } finally {
    checking = false;
  }
}

function startGuard() {
  if (window.location.pathname.endsWith('/login.html')) return;
  verifyCurrentUserIsActive();
  intervalId = window.setInterval(verifyCurrentUserIsActive, CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') verifyCurrentUserIsActive();
  });
  window.addEventListener('focus', verifyCurrentUserIsActive);
}

startGuard();

export function stopActiveUserGuardForTests() {
  if (intervalId) window.clearInterval(intervalId);
  intervalId = null;
}
