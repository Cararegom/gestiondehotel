const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const helperUrl = pathToFileURL(path.resolve('supabase/functions/_shared/bank-email/candidate-ranking.ts')).href;

test('ordena candidatos por cercania temporal y conserva un limite seguro', async () => {
  const { rankCandidatesByTime } = await import(helperUrl);
  const target = new Date('2026-08-26T20:00:00Z').getTime();
  const candidates = [
    { id: 'older', occurred_at: '2026-08-25T20:00:00Z' },
    { id: 'closest', occurred_at: '2026-08-26T19:55:00Z' },
    { id: 'later', occurred_at: '2026-08-26T22:00:00Z' }
  ];
  const ranked = rankCandidatesByTime(candidates, target, ['occurred_at'], 2);
  assert.deepEqual(ranked.map((item) => item.id), ['closest', 'later']);
  assert.equal(ranked[0].match_distance_minutes, 5);
});

test('resume cantidades y nombres sin mostrar identificadores internos', async () => {
  const { humanItemSummary } = await import(helperUrl);
  assert.equal(humanItemSummary([
    { name: 'Agua', quantity: 3 },
    { name: 'Cerveza', quantity: 2 }
  ], 'Sin detalle'), '3 x Agua + 2 x Cerveza');
  assert.equal(humanItemSummary([], 'Venta sin detalle'), 'Venta sin detalle');
});
