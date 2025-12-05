// js/supabaseClient.js

// CAMBIO IMPORTANTE: Usamos una versión específica (@2.39.7) para evitar el error de 'AuthClient'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.7/+esm';

// TUS CREDENCIALES (Están correctas, las mantengo aquí)
const SUPABASE_URL = 'https://iikpqpdoslyduecibaij.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlpa3BxcGRvc2x5ZHVlY2liYWlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY3MzA2NTIsImV4cCI6MjA2MjMwNjY1Mn0.j9mIsD8-sn_jNsQtguKxsagWzfY_p41KV4TIaur-VBM';

// Validaciones básicas de seguridad
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Error crítico: Faltan las credenciales de Supabase en supabaseClient.js");
}

// Inicializar el cliente
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log("Supabase Client cargado correctamente (v2.39.7)");