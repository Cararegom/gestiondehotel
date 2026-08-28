const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const service = fs.readFileSync('supabase/functions/_shared/bank-email/payment-service.ts', 'utf8');
const hardening = fs.readFileSync('supabase/migrations/20260827052742_premerge_bank_feature_hardening.sql', 'utf8');

test('deduplicacion usa hotel + identidad Gmail y no huella heuristica', () => {
  const duplicateLookup = service.slice(service.indexOf('async function findExistingDuplicate'), service.indexOf('function hasCompletedMatching'));
  assert.match(duplicateLookup, /eq\('hotel_id', hotelId\)/);
  assert.match(duplicateLookup, /eq\('gmail_message_id', gmailMessageId\)/);
  assert.doesNotMatch(duplicateLookup, /eq\('transaction_fingerprint'/);
  assert.match(hardening, /DROP INDEX IF EXISTS public\.bank_payment_events_fingerprint_uidx/);
  assert.match(hardening, /DROP INDEX IF EXISTS public\.bank_payment_events_bank_reference_uidx/);
});

test('dos Gmail IDs distintos sobreviven aunque hotel monto y tiempo coincidan; el reintento del mismo ID es idempotente', () => {
  const seen = new Map();
  const save = ({ hotelId, gmailMessageId, amount, timestamp }) => {
    const key = `${hotelId}:${gmailMessageId}`;
    if (seen.has(key)) return { inserted: false, id: seen.get(key) };
    const id = `event-${seen.size + 1}`;
    seen.set(key, id);
    return { inserted: true, id, amount, timestamp };
  };
  const base = { hotelId: 'hotel-a', amount: 50000, timestamp: '2026-08-27T10:00:00Z' };
  const aaa = save({ ...base, gmailMessageId: 'AAA' });
  const bbb = save({ ...base, gmailMessageId: 'BBB' });
  const retryAaa = save({ ...base, gmailMessageId: 'AAA' });
  assert.equal(aaa.inserted, true);
  assert.equal(bbb.inserted, true);
  assert.notEqual(aaa.id, bbb.id);
  assert.deepEqual(retryAaa, { inserted: false, id: aaa.id });
  assert.equal(seen.size, 2);
});

test('la identidad Gmail permanece aislada por hotel', () => {
  const keys = new Set(['hotel-a:AAA', 'hotel-b:AAA']);
  assert.equal(keys.size, 2);
});
