type Candidate = Record<string, unknown>;

function timestampOf(candidate: Candidate, fields: string[]) {
  for (const field of fields) {
    const value = candidate[field];
    if (!value) continue;
    const timestamp = new Date(String(value)).getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return Number.NaN;
}

export function rankCandidatesByTime(
  candidates: Candidate[],
  targetTimestamp: number,
  dateFields: string[],
  limit = 60
) {
  const safeTarget = Number.isFinite(targetTimestamp) ? targetTimestamp : Date.now();
  return candidates
    .map((candidate) => {
      const timestamp = timestampOf(candidate, dateFields);
      const distance = Number.isFinite(timestamp) ? Math.abs(timestamp - safeTarget) : Number.POSITIVE_INFINITY;
      return {
        ...candidate,
        match_distance_minutes: Number.isFinite(distance) ? Math.floor(distance / 60_000) : null,
        _candidate_timestamp: timestamp
      };
    })
    .sort((left, right) => {
      const leftDistance = left.match_distance_minutes ?? Number.POSITIVE_INFINITY;
      const rightDistance = right.match_distance_minutes ?? Number.POSITIVE_INFINITY;
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      return Number(right._candidate_timestamp || 0) - Number(left._candidate_timestamp || 0);
    })
    .slice(0, Math.max(1, limit))
    .map(({ _candidate_timestamp: _ignored, ...candidate }) => candidate);
}

export function humanItemSummary(items: Candidate[], fallback: string) {
  const summary = items
    .filter((item) => Number(item.quantity || 0) > 0)
    .map((item) => `${Number(item.quantity)} x ${String(item.name || 'Producto')}`)
    .join(' + ');
  return summary || fallback;
}
