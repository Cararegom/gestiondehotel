const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20260803120000_bank_email_payments_pilot.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase', 'functions', 'bank-email-api', 'index.ts'), 'utf8');

test('invalid_grant se convierte en una reconexion controlada y no en error 500', () => {
  assert.match(api, /code === 'google_invalid_grant'/);
  assert.match(api, /new HttpError\(\s*409,[\s\S]*Pulsa Conectar Gmail/);
  assert.match(api, /gmail_connection_test_failed/);
});
const webhook = fs.readFileSync(path.join(root, 'supabase', 'functions', 'gmail-webhook', 'index.ts'), 'utf8');
const queue = fs.readFileSync(path.join(root, 'supabase', 'functions', '_shared', 'bank-email', 'queue.ts'), 'utf8');
const oidc = fs.readFileSync(path.join(root, 'supabase', 'functions', '_shared', 'bank-email', 'pubsub-oidc.ts'), 'utf8');
const oauth = fs.readFileSync(path.join(root, 'supabase', 'functions', '_shared', 'bank-email', 'google-oauth.ts'), 'utf8');
const tokenCrypto = fs.readFileSync(path.join(root, 'supabase', 'functions', '_shared', 'bank-email', 'token-crypto.ts'), 'utf8');
const gmailApi = fs.readFileSync(path.join(root, 'supabase', 'functions', '_shared', 'bank-email', 'gmail-api.ts'), 'utf8');
const integrationService = fs.readFileSync(path.join(root, 'supabase', 'functions', '_shared', 'bank-email', 'integration-service.ts'), 'utf8');

function sqlFunction(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `No se encontro la funcion SQL ${name}`);
  const bodyStart = migration.indexOf('AS $function$', start);
  const end = migration.indexOf('$function$;', bodyStart + 'AS $function$'.length);
  assert.notEqual(bodyStart, -1, `No se encontro el cuerpo SQL ${name}`);
  assert.notEqual(end, -1, `No se encontro el final SQL ${name}`);
  return migration.slice(start, end + '$function$;'.length);
}

const createExpectedSql = sqlFunction('create_expected_bank_payment');
const matchPaymentSql = sqlFunction('match_bank_payment_event');
const reviewPaymentSql = sqlFunction('review_bank_payment_event');
const reservationLifecycleSql = sqlFunction('bank_email_handle_reservation_update');
const relationDeleteSql = sqlFunction('bank_email_mark_deleted_relation');

function productionBankEmailFiles() {
  const roots = [
    path.join(root, 'supabase', 'functions', '_shared', 'bank-email'),
    path.join(root, 'supabase', 'functions', 'bank-email-api'),
    path.join(root, 'supabase', 'functions', 'gmail-oauth-callback'),
    path.join(root, 'supabase', 'functions', 'gmail-webhook'),
    path.join(root, 'supabase', 'functions', 'gmail-watch-renew'),
    path.join(root, 'js', 'services', 'bankPaymentService.js'),
    path.join(root, 'js', 'modules', 'pagos-bancarios'),
    migrationPath
  ];
  const files = [];
  const visit = (target) => {
    const stats = fs.statSync(target);
    if (stats.isFile()) {
      files.push(target);
      return;
    }
    for (const entry of fs.readdirSync(target)) visit(path.join(target, entry));
  };
  roots.forEach(visit);
  return files;
}

test('13. la API deriva el hotel del perfil y filtra cada lectura por el piloto', () => {
  assert.match(api, /const pilotHotel = await getPilotHotel\(admin, config\.pilotHotelName\)/);
  assert.match(api, /assertSamePilotHotel\(context, pilotHotel\.id\)/);
  assert.match(api, /\.eq\('hotel_id', pilotHotelId\)/);
  assert.match(api, /admin\.rpc\('review_bank_payment_event'/);
  assert.match(api, /p_actor_id: context\.user\.id/);
  assert.doesNotMatch(api, /body\.hotelId|body\[['"]hotelId['"]\]/);
  assert.match(api, /pilotHotelName: eligible \? pilotHotel\.nombre : null/);
});

test('14. la migracion aplica aislamiento piloto y RLS de solo lectura', () => {
  for (const table of [
    'bank_payment_events',
    'expected_payments',
    'bank_email_integrations',
    'bank_email_oauth_states',
    'bank_email_pubsub_inbox',
    'bank_payment_audit_log'
  ]) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'i'));
  }
  assert.match(migration, /resolve_bank_email_pilot_hotel[\s\S]*cardinality\(v_ids\), 0\) <> 1/i);
  assert.match(migration, /bank_email_assert_pilot_row_trg[\s\S]*BEFORE INSERT OR UPDATE/i);
  assert.match(migration, /bank_payment_events_select_pilot[\s\S]*bank_email_user_has_pilot_access\(hotel_id\)/i);
  assert.match(migration, /expected_payments_select_pilot[\s\S]*bank_email_user_has_pilot_access\(hotel_id\)/i);
  assert.match(migration, /REVOKE ALL ON TABLE public\.bank_email_integrations FROM anon, authenticated/i);
  assert.match(migration, /REVOKE ALL ON TABLE public\.bank_payment_events FROM anon, authenticated/i);
  assert.match(migration, /REVOKE ALL ON TABLE public\.expected_payments FROM anon, authenticated/i);
  assert.doesNotMatch(migration, /GRANT SELECT ON TABLE public\.bank_payment_events[\s\S]{0,80}TO authenticated/i);
  assert.match(migration, /v_actor_id uuid := p_actor_id/i);
  assert.match(migration, /auth\.role\(\) IS DISTINCT FROM 'service_role'/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.review_bank_payment_event[\s\S]*TO service_role/i);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.review_bank_payment_event[\s\S]*TO authenticated/i);
  assert.doesNotMatch(migration, /ON public\.bank_payment_events[\s\S]{0,120}FOR (?:INSERT|UPDATE|DELETE) TO authenticated/i);
  assert.doesNotMatch(migration, /ON public\.expected_payments[\s\S]{0,120}FOR (?:INSERT|UPDATE|DELETE) TO authenticated/i);
  assert.match(createExpectedSql, /auth\.role\(\) IS DISTINCT FROM 'service_role'/i);
  assert.match(createExpectedSql, /pg_advisory_xact_lock[\s\S]*:expected-matching/i);
  assert.doesNotMatch(createExpectedSql, /FROM public\.reservas[\s\S]*FOR UPDATE/i);
  assert.match(createExpectedSql, /expires_at IS DISTINCT FROM[\s\S]*make_interval/i);
  assert.match(createExpectedSql, /v_direct_committed[\s\S]*matched_expected_payment_id IS NULL/i);
  assert.ok(matchPaymentSql.indexOf(':expected-matching') < matchPaymentSql.indexOf('FOR UPDATE'));
  assert.ok(reviewPaymentSql.indexOf(':expected-matching') < reviewPaymentSql.indexOf('FOR UPDATE'));
  assert.match(reviewPaymentSql, /status = 'pending'/i);
  assert.match(reviewPaymentSql, /expires_at IS NULL OR v_expected\.expires_at >= v_payment_time/i);
  assert.match(reviewPaymentSql, /payment_method\)\) NOT IN \('llave', 'transferencia'\)/i);
  assert.match(reviewPaymentSql, /status = 'cancelled'/i);
  assert.match(reservationLifecycleSql, /:expected-matching/i);
  assert.match(reservationLifecycleSql, /reservation_inactive/i);
  assert.match(reservationLifecycleSql, /reservation_balance_changed/i);
  assert.match(relationDeleteSql, /pg_try_advisory_xact_lock[\s\S]*55P03/i);
  assert.match(migration, /bank_email_cancel_pending_on_reservation_payment_trg[\s\S]*AFTER INSERT OR UPDATE ON public\.pagos_reserva/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_expected_bank_payment[\s\S]*TO service_role/i);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.create_expected_bank_payment[\s\S]*TO authenticated/i);
  assert.match(migration, /bank_payment_notifications_insert_guard[\s\S]*AS RESTRICTIVE FOR INSERT TO authenticated/i);
  assert.match(migration, /bank_payment_notifications_update_guard[\s\S]*AS RESTRICTIVE FOR UPDATE TO authenticated/i);
  assert.match(migration, /bank_payment_notifications_delete_guard[\s\S]*AS RESTRICTIVE FOR DELETE TO authenticated/i);
  assert.match(migration, /bank_email_guard_notification_update[\s\S]*Solo se puede cambiar el estado de lectura/i);
  assert.match(api, /function optionalUuid[\s\S]*throw new HttpError\(400, code/i);
});

test('15. Pub/Sub autentica, persiste, deduplica y recupera reintentos', () => {
  assert.match(webhook, /if \(!isBankEmailProcessingEnabled\(config\)\) return emptyResponse\(204\)/);
  assert.match(webhook, /await verifyPubSubOidc\(req\)/);
  assert.match(webhook, /onConflict: 'pubsub_message_id'/);
  assert.match(webhook, /processPendingPubSubInbox/);
  assert.match(oidc, /jwtVerify[\s\S]*audience[\s\S]*issuer[\s\S]*algorithms: \['RS256'\]/);
  assert.match(oidc, /payload\.email_verified !== true/);
  assert.match(migration, /pubsub_message_id text NOT NULL UNIQUE/i);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/i);
  assert.match(migration, /status IN \('pending', 'retry', 'failed'\)/i);
  assert.match(migration, /status = 'processing'[\s\S]*interval '10 minutes'/i);
  assert.match(queue, /status: 'processed' \| 'failed' \| 'ignored'/);
  assert.match(queue, /next_attempt_at:[\s\S]*retryDelayMinutes/);
  assert.match(queue, /isTerminalMissingGmailMessage\(status\)[\s\S]*gmail_message_unavailable/);
  assert.match(queue, /shouldDeadLetterPubSubInboxItem\(attempts\)/);
  assert.match(queue, /alertQueueDeadLetter[\s\S]*bank_email_integration/);
  assert.match(queue, /listLabeledMessageIdsForRecovery\(accessToken, labelId, 500\)/);
  assert.match(queue, /const GMAIL_WATCH_LABEL_ID = 'INBOX'/);
  assert.match(queue, /isConfiguredBankSender\(normalized\)/);
  assert.match(integrationService, /registerGmailWatch\(accessToken, topicName, 'INBOX'\)/);
  assert.doesNotMatch(gmailApi, /newer_than:/);
  assert.match(gmailApi, /gmail_recovery_too_large/);
});

test('OAuth y secretos quedan limitados y cifrados en servidor', () => {
  assert.match(oauth, /scope: 'https:\/\/www\.googleapis\.com\/auth\/gmail\.readonly'/);
  assert.match(oauth, /access_type: 'offline'/);
  assert.match(tokenCrypto, /name: 'AES-GCM'/);
  assert.match(tokenCrypto, /crypto\.getRandomValues\(new Uint8Array\(12\)\)/);
  assert.match(migration, /access_token_encrypted text/);
  assert.match(migration, /refresh_token_encrypted text/);
  assert.doesNotMatch(api, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('la integracion de pagos no contiene un UUID de hotel fijo', () => {
  const uuidLiteral = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
  for (const file of productionBankEmailFiles()) {
    assert.doesNotMatch(
      fs.readFileSync(file, 'utf8'),
      uuidLiteral,
      `UUID fijo encontrado en ${path.relative(root, file)}`
    );
  }
});

test('los contratos de estados y deduplicacion coinciden con las Edge Functions', () => {
  assert.match(migration, /watch_status IN \([\s\S]*'pending'[\s\S]*'label_missing'[\s\S]*'renewal_pending'/i);
  assert.match(migration, /status IN \('pending', 'processing', 'retry', 'failed', 'processed', 'ignored', 'dead_letter'\)/i);
  assert.match(migration, /UNIQUE \(hotel_id, gmail_message_id\)/i);
  assert.match(migration, /user_id uuid NOT NULL REFERENCES public\.usuarios\(id\)/i);
  assert.match(migration, /expected_payments_match_state_check[\s\S]*matched_bank_payment_id IS NOT NULL/i);
  assert.match(migration, /bank_payment_events_confirmation_state_check[\s\S]*confirmed_at IS NOT NULL/i);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER bank_email_event_match_reciprocity_trg[\s\S]*DEFERRABLE INITIALLY DEFERRED/i);
});

test('la API no devuelve identificadores Gmail, asunto ni referencia bancaria completa', () => {
  assert.match(api, /transaction_reference_masked/);
  assert.match(api, /delete safe\[field\]/);
  for (const field of ['gmail_message_id', 'email_subject', 'raw_content_hash', 'transaction_fingerprint']) {
    assert.match(api, new RegExp(`'${field}'`));
  }
  assert.match(api, /CLIENT_EVENT_COLUMNS/);
  assert.doesNotMatch(api, /\.from\('bank_payment_events'\)[\s\S]{0,100}\.select\('\*'\)/);
  assert.doesNotMatch(migration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.bank_payment_events/i);
  assert.match(migration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.notificaciones/i);
});

test('la API pagina transferencias sin imponer un corte silencioso de 200 eventos', () => {
  assert.match(api, /const EVENT_PAGE_SIZE = 100/);
  assert.match(api, /const EVENT_PAGE_SIZE_MAX = 200/);
  assert.match(api, /query = query\.range\(offset, offset \+ limit\)/);
  assert.match(api, /pagination: \{ hasMore: page\.hasMore, nextOffset: page\.nextOffset, limit: page\.limit \}/);
});
