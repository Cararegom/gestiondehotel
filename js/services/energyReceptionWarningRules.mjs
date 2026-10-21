// Reglas puras: se usan también en las pruebas de regresión.
export function selectEnergyReceptionWarnings(checks, minutes, now = Date.now()) {
  const delay = Number(minutes);
  if (!Number.isInteger(delay) || delay < 1 || delay > 1440) return [];
  return (Array.isArray(checks) ? checks : [])
    .filter((check) => {
      if (!check || !['pending', 'overdue'].includes(check.status)) return false;
      const createdAt = Date.parse(check.created_at);
      return Number.isFinite(createdAt) &&
        createdAt <= now &&
        (now - createdAt) >= delay * 60000;
    })
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}
