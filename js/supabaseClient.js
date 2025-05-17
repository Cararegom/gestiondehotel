// js/supabaseClient.js

// Importar createClient desde el CDN de Supabase (versión ESM para navegadores)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// -----------------------------------------------------------------------------
// ¡¡¡ IMPORTANTE !!!
// REEMPLAZA LAS SIGUIENTES LÍNEAS CON TUS CREDENCIALES REALES DE SUPABASE
// Las encuentras en tu dashboard de Supabase: Project Settings > API
// -----------------------------------------------------------------------------
const SUPABASE_URL = 'https://iikpqpdoslyduecibaij.supabase.co'; // Ejemplo: 'https://abcdefghijklmnop.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlpa3BxcGRvc2x5ZHVlY2liYWlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY3MzA2NTIsImV4cCI6MjA2MjMwNjY1Mn0.j9mIsD8-sn_jNsQtguKxsagWzfY_p41KV4TIaur-VBM'; // Ejemplo: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS...'
// -----------------------------------------------------------------------------
// ¡¡¡ NO OLVIDES REEMPLAZAR LAS LÍNEAS DE ARRIBA !!!
// -----------------------------------------------------------------------------


// Validación para asegurar que las variables fueron reemplazadas
if (SUPABASE_URL === 'TU_SUPABASE_URL' || SUPABASE_URL === '' || SUPABASE_URL === null || SUPABASE_URL === undefined) {
  const errorMsg = "Error: SUPABASE_URL no está configurada correctamente en js/supabaseClient.js. Reemplaza 'TU_SUPABASE_URL' con la URL real de tu proyecto Supabase.";
  console.error(errorMsg);
  // Podrías también mostrar esto en la UI si el error persiste
  // document.body.innerHTML = `<p style="color:red; padding:20px; text-align:center;">${errorMsg}</p>`;
  throw new Error(errorMsg); // Detener la ejecución si no está configurada
}

if (SUPABASE_ANON_KEY === 'TU_SUPABASE_ANON_KEY' || SUPABASE_ANON_KEY === '' || SUPABASE_ANON_KEY === null || SUPABASE_ANON_KEY === undefined) {
  const errorMsg = "Error: SUPABASE_ANON_KEY no está configurada correctamente en js/supabaseClient.js. Reemplaza 'TU_SUPABASE_ANON_KEY' con la Anon Key real de tu proyecto Supabase.";
  console.error(errorMsg);
  // document.body.innerHTML = `<p style="color:red; padding:20px; text-align:center;">${errorMsg}</p>`;
  throw new Error(errorMsg); // Detener la ejecución
}

// Crear y exportar el cliente de Supabase
// Esta es la línea que probablemente causa el error si las URL/Key no son válidas (alrededor de la línea 19 después de los comentarios y validaciones)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Opcional: Verificar si el cliente se creó correctamente
if (!supabase) {
  console.error("Error: No se pudo crear el cliente de Supabase. Verifica las credenciales y la conexión a internet.");
  // Considera mostrar un error más visible al usuario aquí.
} else {
  console.log("Cliente de Supabase inicializado correctamente desde supabaseClient.js.");
}
