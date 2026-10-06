const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const corePromise = import(pathToFileURL(resolve(
  __dirname,
  '../supabase/functions/_shared/bank-email/index.ts'
)).href);

test('M15 genera buckets con la zona IANA declarada por el banco', async () => {
  const core = await corePromise;
  const instant = '2026-08-04T05:30:00.000Z';

  assert.equal(core.calendarBucketInTimeZone(instant, 'America/Bogota'), '2026-08-04');
  assert.equal(core.calendarBucketInTimeZone(instant, 'America/Mexico_City'), '2026-08-03');
  assert.equal(
    core.calendarBucketInTimeZone(instant, 'America/Mexico_City', true),
    '2026-08-03T23:30'
  );
});

test('M15 convierte la hora escrita por cada banco sin asumir un offset fijo', async () => {
  const core = await corePromise;
  const text = 'Fecha: 03/08/2026 19:18';

  assert.equal(
    core.extractTransactionOccurredAt(text, '2026-08-04T00:20:00.000Z', 'America/Bogota'),
    '2026-08-04T00:18:00.000Z'
  );
  assert.equal(
    core.extractTransactionOccurredAt(text, '2026-08-04T01:20:00.000Z', 'America/Mexico_City'),
    '2026-08-04T01:18:00.000Z'
  );
});

test('M15 convierte filtros de calendario a rangos UTC que respetan DST', async () => {
  const core = await corePromise;

  assert.deepEqual(
    core.utcRangeForCalendarDates('2026-03-08', '2026-03-08', 'America/New_York'),
    {
      startIso: '2026-03-08T05:00:00.000Z',
      endExclusiveIso: '2026-03-09T04:00:00.000Z'
    }
  );
});

test('M15 separa la zona fuente del banco de la zona operativa del hotel', () => {
  const api = readFileSync(resolve(__dirname, '../supabase/functions/bank-email-api/index.ts'), 'utf8');
  const paymentService = readFileSync(resolve(
    __dirname,
    '../supabase/functions/_shared/bank-email/payment-service.ts'
  ), 'utf8');
  const genericParser = readFileSync(resolve(
    __dirname,
    '../supabase/functions/_shared/bank-email/bankParsers/generic.ts'
  ), 'utf8');

  assert.match(api, /select\('zona_horaria'\)/);
  assert.match(api, /utcRangeForCalendarDates\(rangeStart, rangeEnd, hotelTimeZone\)/);
  assert.doesNotMatch(api, /T00:00:00-05:00/);
  assert.match(paymentService, /transactionTimeZone:\s*DEFAULT_BANK_TIME_ZONE/);
  assert.match(paymentService, /bank's source zone/);
  assert.doesNotMatch(genericParser, /hour\s*\+\s*5/);
});
