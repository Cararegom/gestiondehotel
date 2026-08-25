const FLAG_NAMES = Object.freeze([
  'fase1PagosAtomicos',
  'fase1TiendaAtomica',
  'fase1RestauranteAtomico',
  'fase1ReversionCaja',
  'fase1ArqueoDetallado'
]);

function runtimeConfig() {
  const configured = globalThis.__HOTEL_APP_CONFIG__?.featureFlags;
  return configured && typeof configured === 'object' ? configured : {};
}

export function isFase1LegacyRevoked() {
  return globalThis.__HOTEL_APP_CONFIG__?.fase1LegacyRevoked === true;
}

export function isFase1Enabled(name) {
  if (!FLAG_NAMES.includes(name)) throw new Error(`Feature flag Fase 1 desconocido: ${name}`);
  if (isFase1LegacyRevoked()) return true;
  return runtimeConfig()[name] === true;
}

export function requireSafeFase1Path(name) {
  const enabled = isFase1Enabled(name);
  if (!enabled && isFase1LegacyRevoked()) {
    throw new Error(`El camino legacy de ${name} fue revocado y no puede reactivarse.`);
  }
  return enabled;
}

export { FLAG_NAMES as FASE1_FEATURE_FLAGS };
