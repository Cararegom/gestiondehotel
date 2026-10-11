const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const shared = name => import(pathToFileURL(path.join(root, 'supabase/functions/_shared/bank-email', name)).href);
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261011190513_enable_bank_email_all_hotels_outlook.sql'), 'utf8');
const ids = { marena: '11111111-1111-4111-8111-111111111111', corales: '22222222-2222-4222-8222-222222222222',
  dora: '33333333-3333-4333-8333-333333333333', recep: '44444444-4444-4444-8444-444444444444',
  other: '55555555-5555-4555-8555-555555555555', admin: '66666666-6666-4666-8666-666666666666',
  event: '77777777-7777-4777-8777-777777777777', integration: '88888888-8888-4888-8888-888888888888' };

function definition(schema, name) {
  const marker = `create or replace function ${schema}.${name}(`;
  const start = migration.toLowerCase().indexOf(marker);
  assert.notEqual(start, -1, marker);
  const body = migration.indexOf('$function$', start);
  const end = migration.indexOf('$function$;', body + 10);
  return migration.slice(start, end + 11);
}

test('Corales se identifica por la llave completa, aunque cambie la cuenta', async () => {
  const { bankEmailMatchesKey, validateHotelBankSettings } = await shared('hotel-scope.ts');
  const content = account => `Bancolombia: CORALES DEL MAR, recibiste un pago de YUSTIN DANIEL ALFARO PORTO por $1,000.00 en tu cuenta *${account} conectado a la llave 0090237193 el 10/10/2026 a las 23:23.`;
  assert.equal(bankEmailMatchesKey(content('7772'), '0090237193'), true);
  assert.equal(bankEmailMatchesKey(content('9686'), '0090237193'), true);
  assert.equal(bankEmailMatchesKey(content('7772'), '90237193'), false);
  assert.equal(bankEmailMatchesKey(content('7772'), '009023719'), false);
  assert.equal(bankEmailMatchesKey(content('7772'), ''), false);
  assert.equal(bankEmailMatchesKey(content('7772').replace('0090237193', '@hotelok'), '@hotelok'), true);
  assert.throws(() => validateHotelBankSettings({ labelName: 'PAGOS', bankKey: '0090\n237193' }));
});

test('Outlook autentica el aviso y extrae el mismo pago; cabeceras inyectadas no acreditan pagos', async () => {
  const { parseOutlookMessage, validateGraphUrl } = await shared('outlook-service.ts');
  const { parseBankEmail } = await shared('bankParsers/index.ts');
  const { parseConfiguredRules } = await shared('payment-service.ts');
  const message = { id: 'immutable-message', subject: 'Alertas y Notificaciones', receivedDateTime: '2026-10-11T04:23:00Z',
    from: { emailAddress: { address: 'alertasynotificaciones@an.notificacionesbancolombia.com' } },
    body: { contentType: 'text', content: 'Bancolombia: CORALES DEL MAR, recibiste un pago de YUSTIN DANIEL ALFARO PORTO por $1,000.00 en tu cuenta *7772 conectado a la llave 0090237193 el 10/10/2026 a las 23:23.' },
    internetMessageHeaders: [
      { name: 'Received', value: 'from inbound by CO1PR01MB.prod.outlook.com with HTTPS;' },
      { name: 'Return-Path', value: '<alertasynotificaciones@an.notificacionesbancolombia.com>' },
      { name: 'Authentication-Results', value: 'spf=pass smtp.mailfrom=an.notificacionesbancolombia.com; dkim=pass header.d=an.notificacionesbancolombia.com; dmarc=pass header.from=an.notificacionesbancolombia.com; compauth=pass reason=100' }
    ] };
  const normalized = parseOutlookMessage(message);
  assert.equal(normalized.gmailMessageId, 'outlook:immutable-message');
  const parsed = parseBankEmail(normalized, { enabled: true, minAmountCop: 1, maxAmountCop: 100_000_000, matchWindowMinutes: 30 }, parseConfiguredRules());
  assert.equal(parsed.amountCop, 1000);
  assert.equal(parsed.senderName, 'YUSTIN DANIEL ALFARO PORTO');
  assert.equal(parsed.disposition, 'detected');
  const spoofed = structuredClone(message);
  spoofed.internetMessageHeaders[2].value = 'spf=fail smtp.mailfrom=evil.example; dkim=fail header.d=evil.example; dmarc=fail header.from=evil.example; compauth=fail reason=000';
  spoofed.internetMessageHeaders.push(message.internetMessageHeaders[2]);
  assert.equal(parseOutlookMessage(spoofed).authentication.spf, 'fail');
  const outside = structuredClone(message);
  outside.internetMessageHeaders[0].value = 'from inbound by attacker.example;';
  assert.equal(parseOutlookMessage(outside).authentication.spf, 'unknown');
  assert.throws(() => validateGraphUrl('https://graph.microsoft.com.evil.example/v1.0/me/messages'));
  assert.throws(() => validateGraphUrl('https://graph.microsoft.com/v1.0/users/another/messages'));
});

test('El callback conserva correo, permisos y vencimiento del calendario Google y no revela errores con tokens', async t => {
  const { exchangeCalendarGoogleCode } = await shared('calendar-google-oauth.ts');
  const calls = [];
  let failToken = false;
  let failProfile = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json(failToken ? { error_description: 'sensitive-provider-response' } : {
        access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600,
        scope: 'calendar email'
      }, { status: failToken ? 400 : 200 });
    }
    assert.equal(url, 'https://www.googleapis.com/oauth2/v2/userinfo');
    assert.equal(options.headers.Authorization, 'Bearer test-access');
    return Response.json({ email: 'calendar@example.test' }, { status: failProfile ? 403 : 200 });
  });
  const before = Date.now();
  const result = await exchangeCalendarGoogleCode('test-code', 'test-client', 'test-secret', 'https://example.test/callback');
  assert.equal(result.email, 'calendar@example.test');
  assert.deepEqual(result.scopes, ['calendar','email']);
  assert.equal(result.tokens.refresh_token, 'test-refresh');
  assert.ok(result.tokens.expiry_date >= before + 3600000 && result.tokens.expiry_date <= Date.now() + 3600000);
  assert.equal(calls[0].options.body.get('redirect_uri'), 'https://example.test/callback');
  assert.equal(calls[0].options.body.get('grant_type'), 'authorization_code');
  assert.ok(calls.every(call => call.options.redirect === 'error'));
  failToken = true;
  await assert.rejects(exchangeCalendarGoogleCode('x','client','secret','uri'), error =>
    /No se pudo autorizar/.test(error.message) && !error.message.includes('sensitive-provider-response'));
  failToken = false;
  failProfile = true;
  await assert.rejects(exchangeCalendarGoogleCode('x','client','secret','uri'), /No se pudo identificar/);
});

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema app_private;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('app.role',true),''),'service_role') $$;
    create table hoteles(id uuid primary key,nombre text,creado_por uuid);
    create table hotel_features(id uuid default gen_random_uuid(),hotel_id uuid,feature_key text,enabled boolean,configuration jsonb default '{}',enabled_at timestamptz,updated_at timestamptz,unique(hotel_id,feature_key));
    create table usuarios(id uuid primary key,hotel_id uuid,rol text,activo boolean);
    create table roles(id uuid,nombre text);
    create table usuarios_roles(usuario_id uuid,hotel_id uuid,rol_id uuid);
    create table pagos_reserva(id uuid primary key,hotel_id uuid,reserva_id uuid,monto numeric,usuario_id uuid,nota text);
    create table expected_payments(id uuid default gen_random_uuid(),hotel_id uuid,reservation_id uuid,status text,matched_bank_payment_id uuid,updated_at timestamptz);
    create table bank_payment_audit_log(hotel_id uuid,user_id uuid,action text,payment_event_id uuid,details jsonb);
    create table bank_email_integrations(id uuid primary key,hotel_id uuid,provider text,sync_lock_token uuid,sync_locked_until timestamptz);
    create table bank_email_pubsub_inbox(id uuid primary key default gen_random_uuid(),hotel_id uuid,status text,attempts integer default 0,next_attempt_at timestamptz default now(),created_at timestamptz default now(),updated_at timestamptz default now());
    create table bank_payment_events(id uuid primary key,hotel_id uuid,status text,amount_cop bigint,metadata jsonb default '{}',sender_name text,transaction_occurred_at timestamptz,email_received_at timestamptz,detected_at timestamptz default now(),reviewed_by uuid);
    create type tipo_notificacion_enum as enum('general_info');
    create table notificaciones(id uuid default gen_random_uuid(),hotel_id uuid,usuario_id uuid,user_id uuid,rol_destino text,tipo tipo_notificacion_enum,mensaje text,entidad_tipo text,entidad_id uuid,leida boolean,creado_en timestamptz,actualizado_en timestamptz);
    create unique index on notificaciones(hotel_id,usuario_id,entidad_tipo,entidad_id) where entidad_tipo='bank_payment_event' and usuario_id is not null;
    create function hotel_time_zone(uuid) returns text language sql as $$ select 'America/Bogota' $$;
    insert into hoteles values('${ids.marena}','Hotel Marena San Isidro',null),('${ids.corales}','Hotel Corales del Mar','${ids.admin}'),('${ids.dora}','Hotel Dora Smith',null);
    insert into usuarios values('${ids.recep}','${ids.corales}','recepcionista',true),('${ids.other}','${ids.marena}','recepcionista',true),('${ids.admin}','${ids.corales}','administrador',true);
  `);
  for (const name of ['enable_hotel_bank_reconciliation','bank_email_actor_is_pilot_admin','bank_email_actor_is_pilot_operational','bank_email_user_has_pilot_access']) await db.exec(definition('app_private', name));
  for (const name of ['resolve_bank_email_pilot_hotel','bank_email_assert_pilot_row','bank_email_cancel_pending_on_reservation_payment','bank_email_notification_is_visible','bank_email_notify_payment_event','claim_bank_email_pubsub_inbox_for_hotel','claim_bank_outlook_sync']) await db.exec(definition('public', name));
  await db.exec(migration.slice(migration.indexOf('insert into public.hotel_features'), migration.indexOf('create or replace function app_private.enable_hotel')));
  await db.exec(`
    create trigger bank_rows before insert or update on bank_payment_events for each row execute function bank_email_assert_pilot_row();
    create trigger changed_receipt after insert or update on pagos_reserva for each row execute function bank_email_cancel_pending_on_reservation_payment();
    create trigger new_bank_hotel after insert on hoteles for each row execute function app_private.enable_hotel_bank_reconciliation();
    alter table bank_payment_events enable row level security;
    create policy own_bank_events on bank_payment_events for select to authenticated using(app_private.bank_email_user_has_pilot_access(hotel_id));
    alter table notificaciones enable row level security;
    create policy own_bank_notifications on notificaciones for select to authenticated using(bank_email_notification_is_visible(entidad_tipo,hotel_id,usuario_id,user_id,entidad_id));
    grant usage on schema public,app_private,auth to authenticated;
    grant select on bank_payment_events,notificaciones to authenticated;
    insert into bank_payment_events(id,hotel_id,status,amount_cop,metadata,sender_name,email_received_at) values('${ids.event}','${ids.corales}','detected',1000,'{"bank_key":"0090237193"}','YUSTIN DANIEL ALFARO PORTO','2026-10-11T04:23:00Z');
    insert into bank_email_integrations values('${ids.integration}','${ids.corales}','microsoft',null,null);
  `);
  return db;
}

test('PostgreSQL habilita todos los hoteles y aisla filas, roles, avisos y colas', async t => {
  const db = await database();
  t.after(() => db.close());
  for (const hotel of [ids.marena, ids.corales, ids.dora]) {
    assert.equal((await db.query('select resolve_bank_email_pilot_hotel($1) as hotel',[hotel])).rows[0].hotel,hotel);
  }
  assert.equal((await db.query('select configuration from hotel_features where hotel_id=$1',[ids.corales])).rows[0].configuration.bankKey,'0090237193');
  const future = '99999999-9999-4999-8999-999999999999';
  await db.query('insert into hoteles(id,nombre) values($1,$2)',[future,'Hotel Nuevo']);
  assert.equal((await db.query('select resolve_bank_email_pilot_hotel($1) as hotel',[future])).rows[0].hotel,future);
  assert.equal((await db.query('select app_private.bank_email_actor_is_pilot_operational($1,$2) as allowed',[ids.recep,ids.corales])).rows[0].allowed,true);
  assert.equal((await db.query('select app_private.bank_email_actor_is_pilot_admin($1,$2) as allowed',[ids.recep,ids.corales])).rows[0].allowed,false);
  assert.equal((await db.query('select app_private.bank_email_actor_is_pilot_operational($1,$2) as allowed',[ids.recep,ids.marena])).rows[0].allowed,false);
  await assert.rejects(db.query('update bank_payment_events set hotel_id=$1 where id=$2',[ids.marena,ids.event]),/inmutable/);
  await db.query('select bank_email_notify_payment_event($1)',[ids.event]);
  await db.query('select bank_email_notify_payment_event($1)',[ids.event]);
  assert.equal((await db.query('select count(*)::int as count from notificaciones')).rows[0].count,2);
  await db.exec(`set role authenticated; set app.uid='${ids.recep}';`);
  assert.equal((await db.query('select count(*)::int as count from bank_payment_events')).rows[0].count,1);
  const notifications = (await db.query('select mensaje from notificaciones')).rows;
  assert.equal(notifications.length,1);
  assert.match(notifications[0].mensaje,/llave 0090237193/);
  assert.doesNotMatch(notifications[0].mensaje,/@hotelok/);
  await db.exec(`set app.uid='${ids.other}';`);
  assert.equal((await db.query('select count(*)::int as count from bank_payment_events')).rows[0].count,0);
  assert.equal((await db.query('select count(*)::int as count from notificaciones')).rows[0].count,0);
  await db.exec('reset role;');
  await db.exec(`insert into bank_email_pubsub_inbox(hotel_id,status) values('${ids.marena}','pending'),('${ids.corales}','pending');`);
  const claimed = (await db.query('select claim_bank_email_pubsub_inbox_for_hotel($1,10) as rows',[ids.corales])).rows[0].rows;
  assert.equal(claimed.length,1);
  assert.equal(claimed[0].hotel_id,ids.corales);
  assert.equal((await db.query('select status from bank_email_pubsub_inbox where hotel_id=$1',[ids.marena])).rows[0].status,'pending');
  const lock = (await db.query('select claim_bank_outlook_sync($1,$2) as lock',[ids.corales,ids.integration])).rows[0].lock;
  assert.ok(lock);
  assert.equal((await db.query('select claim_bank_outlook_sync($1,$2) as lock',[ids.corales,ids.integration])).rows[0].lock,null);
  await db.exec(`set app.role='authenticated';`);
  await assert.rejects(db.query('select claim_bank_outlook_sync($1,$2)',[ids.corales,ids.integration]),/Servidor requerido/);
});

test('un recibo cambiado cancela los intentos de ambos hoteles; editar su nota conserva los pendientes', async t => {
  const db = await database();
  t.after(() => db.close());
  await db.exec(`
    insert into pagos_reserva values('${ids.integration}','${ids.corales}','${ids.corales}',1000,'${ids.admin}',null);
    insert into expected_payments(hotel_id,reservation_id,status) values('${ids.corales}','${ids.corales}','pending'),('${ids.marena}','${ids.marena}','pending');
    update pagos_reserva set nota='Solo metadatos' where id='${ids.integration}';
  `);
  assert.equal((await db.query("select count(*)::int as count from expected_payments where status='pending'")).rows[0].count,2);
  await db.exec(`update pagos_reserva set hotel_id='${ids.marena}',reserva_id='${ids.marena}' where id='${ids.integration}';`);
  assert.equal((await db.query("select count(*)::int as count from expected_payments where status='cancelled'")).rows[0].count,2);
  assert.equal((await db.query('select count(distinct hotel_id)::int as count from bank_payment_audit_log')).rows[0].count,2);
});
