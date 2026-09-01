const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const legacyBackfill = fs.readFileSync('supabase/migrations/20260901185128_bank_payment_allocation_caja_legacy_backfill.sql', 'utf8');
const relationApi = fs.readFileSync('supabase/functions/bank-payment-relation-api/index.ts', 'utf8');

test('el backfill historico solo asigna relaciones uno-a-uno y deja las ambiguas fuera', () => {
  assert.match(legacyBackfill, /one_candidate_per_allocation/);
  assert.match(legacyBackfill, /having count\(\*\) = 1/);
  assert.match(legacyBackfill, /one_allocation_per_candidate/);
  assert.match(legacyBackfill, /count\(\*\) over \(partition by caja_id\)/);
  assert.match(legacyBackfill, /where allocation_count = 1/);
  assert.match(legacyBackfill, /set caja_id = safe\.caja_id/);
});

test('la API protege relaciones historicas ambiguas sin inventar un caja_id', () => {
  assert.match(relationApi, /LEGACY_LINKED_STATUSES/);
  assert.match(relationApi, /legacyAllocationMatchesMovement/);
  assert.match(relationApi, /\.is\('caja_id', null\)/);
  assert.match(relationApi, /legacy: true/);
  assert.match(relationApi, /ambiguous: matches\.length > 1/);
});
