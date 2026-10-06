const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const idempotency = fs.readFileSync('supabase/functions/_shared/bank-email/idempotency.ts', 'utf8');
const service = fs.readFileSync('supabase/functions/_shared/bank-email/payment-service.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260803120000_bank_email_payments_pilot.sql', 'utf8');

test('B11 retira los helpers de deduplicacion en memoria sin consumidores', () => {
  assert.doesNotMatch(idempotency, /gmailMessageDeduplicationKey/);
  assert.doesNotMatch(idempotency, /isDuplicateGmailMessage/);
  assert.doesNotMatch(idempotency, /ReadonlySet/);
});

test('B11 conserva la huella secundaria que si usa el flujo real', () => {
  assert.match(idempotency, /export function transferFingerprint/);
  assert.match(service, /import \{ transferFingerprint \} from '\.\/idempotency\.ts'/);
  assert.match(service, /await transferFingerprint\(/);
});

test('B11 documenta en codigo la idempotencia persistente por hotel y Gmail ID', () => {
  const duplicateLookup = service.slice(
    service.indexOf('async function findExistingDuplicate'),
    service.indexOf('function hasCompletedMatching'),
  );
  assert.match(duplicateLookup, /eq\('hotel_id', hotelId\)/);
  assert.match(duplicateLookup, /eq\('gmail_message_id', gmailMessageId\)/);
  assert.match(migration, /CONSTRAINT bank_payment_events_message_key UNIQUE \(hotel_id, gmail_message_id\)/);
  assert.match(migration, /pubsub_message_id text NOT NULL UNIQUE/);
});
