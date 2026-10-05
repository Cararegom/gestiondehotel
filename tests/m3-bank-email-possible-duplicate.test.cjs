const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(
  root,
  'supabase',
  'migrations',
  '20260921120000_m3_bank_email_possible_duplicate_review.sql',
), 'utf8');
const service = fs.readFileSync(path.join(
  root,
  'supabase',
  'functions',
  '_shared',
  'bank-email',
  'payment-service.ts',
), 'utf8');
const ui = fs.readFileSync(path.join(
  root,
  'js',
  'modules',
  'pagos-bancarios',
  'pagos-bancarios.js',
), 'utf8');

const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const hotels = { a: id(1), b: id(2) };

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema app_private;

    create table public.bank_payment_events (
      id uuid primary key default gen_random_uuid(),
      hotel_id uuid not null,
      provider text not null default 'gmail',
      bank_name text,
      gmail_message_id text not null,
      transaction_reference text,
      transaction_occurred_at timestamptz,
      email_received_at timestamptz,
      sender_name text,
      amount_cop bigint not null,
      status text not null default 'detected',
      raw_content_hash text,
      review_reason text,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default statement_timestamp(),
      unique (hotel_id, gmail_message_id)
    );
  `);
  await db.exec(migration);
  return db;
}

async function insertEvent(db, values) {
  const event = {
    hotelId: hotels.a,
    provider: 'gmail',
    bankName: 'Bancolombia',
    messageId: `message-${crypto.randomUUID()}`,
    transactionReference: null,
    occurredAt: '2026-09-21T15:00:00Z',
    senderName: 'Maria Gomez',
    amountCop: 100000,
    status: 'detected',
    rawContentHash: 'hash-default',
    metadata: {},
    ...values,
  };
  const result = await db.query(`
    insert into public.bank_payment_events (
      hotel_id, provider, bank_name, gmail_message_id, transaction_reference,
      transaction_occurred_at, email_received_at, sender_name, amount_cop,
      status, raw_content_hash, metadata
    ) values ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11::jsonb)
    returning *
  `, [
    event.hotelId,
    event.provider,
    event.bankName,
    event.messageId,
    event.transactionReference,
    event.occurredAt,
    event.senderName,
    event.amountCop,
    event.status,
    event.rawContentHash,
    JSON.stringify(event.metadata),
  ]);
  return result.rows[0];
}

test('M3 usa una senal conservadora y serializada sin descartar pagos', () => {
  assert.match(migration, /pg_advisory_xact_lock\s*\(\s*hashtextextended/i);
  assert.match(migration, /interval '120 seconds'/i);
  assert.match(migration, /event\.raw_content_hash = new\.raw_content_hash/i);
  assert.match(migration, /translate\(lower\(btrim\(coalesce\(event\.sender_name/i);
  assert.match(migration, /new\.status := 'manual_review'/i);
  assert.match(migration, /new\.review_reason := 'possible_duplicate_transfer'/i);
  assert.doesNotMatch(migration, /new\.status\s*:=\s*'duplicated'/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.bank_payment_events/i);
});

test('M3 ejecuta la deteccion real sobre PostgreSQL', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  await t.test('el primer mensaje queda detectado y el segundo compatible pide revision', async () => {
    const first = await insertEvent(db, {
      messageId: 'pair-a-1',
      amountCop: 101000,
      senderName: 'María Gómez',
      rawContentHash: 'hash-pair-a-1',
    });
    const second = await insertEvent(db, {
      messageId: 'pair-a-2',
      amountCop: 101000,
      occurredAt: '2026-09-21T15:01:30Z',
      senderName: 'MARIA-GOMEZ',
      rawContentHash: 'hash-pair-a-2',
    });

    assert.equal(first.status, 'detected');
    assert.equal(second.status, 'manual_review');
    assert.equal(second.review_reason, 'possible_duplicate_transfer');
    assert.equal(second.metadata.possible_duplicate, true);
    assert.equal(second.metadata.possible_duplicate_candidate_count, 1);
    assert.deepEqual(second.metadata.possible_duplicate_candidate_ids, [first.id]);
    assert.equal(second.metadata.possible_duplicate_same_sender, true);
    assert.equal(second.metadata.possible_duplicate_same_content, false);
  });

  await t.test('el mismo contenido detecta el caso aunque falte el remitente', async () => {
    await insertEvent(db, {
      messageId: 'pair-hash-1',
      amountCop: 202000,
      senderName: null,
      rawContentHash: 'same-content-hash',
    });
    const second = await insertEvent(db, {
      messageId: 'pair-hash-2',
      amountCop: 202000,
      occurredAt: '2026-09-21T15:00:45Z',
      senderName: null,
      rawContentHash: 'same-content-hash',
    });

    assert.equal(second.status, 'manual_review');
    assert.equal(second.metadata.possible_duplicate_same_content, true);
  });

  await t.test('monto y hora solos no producen un falso positivo', async () => {
    await insertEvent(db, {
      messageId: 'different-sender-1',
      amountCop: 303000,
      senderName: 'Persona Uno',
      rawContentHash: 'different-hash-1',
    });
    const second = await insertEvent(db, {
      messageId: 'different-sender-2',
      amountCop: 303000,
      occurredAt: '2026-09-21T15:00:30Z',
      senderName: 'Persona Dos',
      rawContentHash: 'different-hash-2',
    });
    assert.equal(second.status, 'detected');
    assert.equal(second.review_reason, null);
  });

  await t.test('respeta la ventana, el hotel, pruebas y referencias reales', async () => {
    await insertEvent(db, { messageId: 'scope-1', amountCop: 404000 });

    const outsideWindow = await insertEvent(db, {
      messageId: 'scope-window',
      amountCop: 404000,
      occurredAt: '2026-09-21T15:02:01Z',
    });
    const otherHotel = await insertEvent(db, {
      hotelId: hotels.b,
      messageId: 'scope-hotel',
      amountCop: 404000,
    });
    const testEvent = await insertEvent(db, {
      messageId: 'scope-test',
      amountCop: 404000,
      metadata: { is_test: true },
    });
    const referenced = await insertEvent(db, {
      messageId: 'scope-reference',
      amountCop: 404000,
      transactionReference: 'TRX-404',
    });

    assert.equal(outsideWindow.status, 'detected');
    assert.equal(otherHotel.status, 'detected');
    assert.equal(testEvent.status, 'detected');
    assert.equal(referenced.status, 'detected');
  });

  await t.test('no toma eventos rechazados o ya marcados duplicados como evidencia', async () => {
    await insertEvent(db, {
      messageId: 'ignored-rejected',
      amountCop: 505000,
      status: 'rejected',
    });
    await insertEvent(db, {
      messageId: 'ignored-duplicated',
      amountCop: 606000,
      status: 'duplicated',
    });
    const afterRejected = await insertEvent(db, {
      messageId: 'after-rejected',
      amountCop: 505000,
    });
    const afterDuplicated = await insertEvent(db, {
      messageId: 'after-duplicated',
      amountCop: 606000,
    });
    assert.equal(afterRejected.status, 'detected');
    assert.equal(afterDuplicated.status, 'detected');
  });

  await t.test('la identidad Gmail original sigue siendo una restriccion unica', async () => {
    await insertEvent(db, { messageId: 'same-gmail-id', amountCop: 707000 });
    await assert.rejects(
      insertEvent(db, { messageId: 'same-gmail-id', amountCop: 707000 }),
      /unique|duplicate/i,
    );
  });
});

test('M3 impide el auto-match y muestra la advertencia al operador', () => {
  const postInsert = service.slice(service.indexOf('let event = inserted'));
  assert.match(postInsert, /inserted\.status === 'detected'/);
  assert.doesNotMatch(postInsert, /parsed\.disposition === 'detected'[\s\S]*matchStoredPaymentEvent/);
  assert.match(postInsert, /inserted\.review_reason === 'possible_duplicate_transfer'/);
  assert.match(postInsert, /'duplicate_detected'/);

  assert.match(ui, /POSSIBLE_DUPLICATE_REASON = 'possible_duplicate_transfer'/);
  assert.match(ui, /Verifica una posible notificación duplicada/);
  assert.match(ui, /Ningún pago fue descartado automáticamente/);
  assert.match(ui, /renderPossibleDuplicateWarning\(event\)/);
});
