// js/supabaseClient.js
import './safeLogger.js';

// CAMBIO IMPORTANTE: Usamos una versión específica (@2.39.7) para evitar el error de 'AuthClient'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.7/+esm';

// TUS CREDENCIALES (Están correctas, las mantengo aquí)
const PRODUCTION_SUPABASE_URL = 'https://iikpqpdoslyduecibaij.supabase.co';
const PRODUCTION_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlpa3BxcGRvc2x5ZHVlY2liYWlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY3MzA2NTIsImV4cCI6MjA2MjMwNjY1Mn0.j9mIsD8-sn_jNsQtguKxsagWzfY_p41KV4TIaur-VBM';
const STAGING_SUPABASE_URL = 'https://vyzscuzgjdhrhzctmsuv.supabase.co';
const STAGING_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5enNjdXpnamRocmh6Y3Rtc3V2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2MjUxMjQsImV4cCI6MjEwMzIwMTEyNH0.iqH71aQ5lj8T4j-gmmFSyLWq_gCj3UaHYvHH8IebJCM';

const requestedBackend = new URLSearchParams(globalThis.location?.search || '').get('backend');
if (requestedBackend === 'staging' || requestedBackend === 'production') {
  globalThis.localStorage?.setItem('gestionhotel.backend', requestedBackend);
}
export const activeBackend = globalThis.localStorage?.getItem('gestionhotel.backend') === 'staging'
  ? 'staging'
  : 'production';
const SUPABASE_URL = activeBackend === 'staging' ? STAGING_SUPABASE_URL : PRODUCTION_SUPABASE_URL;
const SUPABASE_ANON_KEY = activeBackend === 'staging' ? STAGING_SUPABASE_ANON_KEY : PRODUCTION_SUPABASE_ANON_KEY;

if (activeBackend === 'staging' && globalThis.document) {
  globalThis.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('staging-environment-badge')) return;
    const badge = document.createElement('div');
    badge.id = 'staging-environment-badge';
    badge.textContent = 'ENTORNO DE PRUEBAS · STAGING';
    badge.setAttribute('role', 'status');
    badge.style.cssText = 'position:fixed;left:50%;top:0;transform:translateX(-50%);z-index:99999;background:#b91c1c;color:white;padding:6px 16px;border-radius:0 0 10px 10px;font:700 12px system-ui;letter-spacing:.08em;box-shadow:0 2px 8px #0004';
    document.body.appendChild(badge);
  }, { once: true });
}

// Validaciones básicas de seguridad
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Error crítico: Faltan las credenciales de Supabase en supabaseClient.js");
}

// Inicializar el cliente con opciones explÃ­citas de sesiÃ³n para evitar
// comportamientos ambiguos entre pÃ¡ginas pÃºblicas, login y recuperaciÃ³n.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: `gestionhotel.auth.${activeBackend}`
  },
  global: {
    headers: {
      'X-Client-Info': 'gestiondehotel-web'
    }
  }
});

console.log(`Supabase Client cargado correctamente (v2.39.7, ${activeBackend})`);
