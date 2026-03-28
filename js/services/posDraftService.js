const PREFIX = 'gestiondehotel-pos-draft-v1';

function buildKey(scope, hotelId, userId) {
  return `${PREFIX}:${scope}:${hotelId || 'hotel'}:${userId || 'user'}`;
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

export function loadPOSDraft(scope, hotelId, userId) {
  if (typeof localStorage === 'undefined') return null;
  return safeParse(localStorage.getItem(buildKey(scope, hotelId, userId)));
}

export function savePOSDraft(scope, hotelId, userId, payload) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(buildKey(scope, hotelId, userId), JSON.stringify({
    updatedAt: new Date().toISOString(),
    payload
  }));
}

export function clearPOSDraft(scope, hotelId, userId) {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(buildKey(scope, hotelId, userId));
}
