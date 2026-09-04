const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const pilotMigration = fs.readFileSync('supabase/migrations/20260824120000_energy_control_pilot.sql', 'utf8');
const hardening = fs.readFileSync('supabase/migrations/20260901213000_energy_control_hardening.sql', 'utf8');
const overdueTypeFix = fs.readFileSync('supabase/migrations/20260901214500_energy_control_overdue_email_type_fix.sql', 'utf8');
const qrHotelIndex = fs.readFileSync('supabase/migrations/20260901215000_energy_qr_hotel_index.sql', 'utf8');
const moduleSource = fs.readFileSync('js/modules/control-energia/control-energia.js', 'utf8');
const main = fs.readFileSync('js/main.js', 'utf8');
const alertFn = fs.readFileSync('supabase/functions/process-energy-alerts/index.ts', 'utf8');
const pkg = fs.readFileSync('package.json', 'utf8');

test('energy remains tenant-configured and disabled by default', () => {
  assert.match(pilotMigration, /energy_control_enabled boolean NOT NULL DEFAULT false/);
  assert.match(main, /currentEnergyControlEnabled/);
  assert.match(hardening, /hotel dora smith de prueba/);
  assert.doesNotMatch(hardening, /set energy_control_enabled = true[\s\S]*hotel marena san isidro/i);
});

test('modern assigned roles and legacy operational roles are accepted server-side', () => {
  assert.match(hardening, /public\.usuarios_roles/);
  assert.match(hardening, /public\.roles/);
  for (const role of ['administrador', 'recepcionista', 'camarera', 'mantenimiento']) {
    assert.match(hardening, new RegExp(role));
  }
  assert.match(hardening, /energy_capabilities/);
  assert.match(moduleSource, /db\.rpc\('energy_capabilities'\)/);
  assert.doesNotMatch(moduleSource, /actor\?\.role/);
});

test('QR secrets are removed from the exposed habitaciones table', () => {
  assert.match(hardening, /private\.room_energy_qr_secrets/);
  assert.match(hardening, /set energy_qr_token = null/);
  assert.match(hardening, /habitaciones_energy_qr_token_deprecated_check/);
  assert.match(hardening, /energy_list_qr_tokens/);
  assert.doesNotMatch(moduleSource, /from\('habitaciones'\)[\s\S]{0,200}energy_qr_token/);
  assert.match(moduleSource, /db\.rpc\('energy_list_qr_tokens'\)/);
});

test('private QR secrets have a covering hotel index', () => {
  assert.match(qrHotelIndex, /room_energy_qr_secrets_hotel_id_idx/);
  assert.match(qrHotelIndex, /private\.room_energy_qr_secrets\(hotel_id\)/);
});

test('cleaning creates a check only for prepared rooms and blocks release while open', () => {
  assert.match(hardening, /v_has_qr/);
  assert.match(hardening, /new\.estado = 'limpieza'/i);
  assert.match(hardening, /v_enabled\s+and\s+v_has_qr/i);
  assert.match(hardening, /CONTROL_ENERGIA_PENDIENTE/);
  assert.match(pilotMigration, /room_energy_checks_one_open_per_room/);
});

test('scan and confirmation are tenant-bound and race safe', () => {
  assert.match(hardening, /s\.token = p_token/);
  assert.match(hardening, /h\.hotel_id = v_user\.hotel_id/);
  assert.match(hardening, /for update/i);
  assert.match(hardening, /status = 'completed'/);
  assert.match(hardening, /energy_notify_recipients/);
});

test('native-camera hash deep links are consumed instead of opening a second scanner', () => {
  assert.match(moduleSource, /tokenFromCurrentHash/);
  assert.match(moduleSource, /hash\.indexOf\('\?'\)/);
  assert.match(moduleSource, /processToken\(deepLinkToken\)/);
  assert.match(moduleSource, /history\.replaceState/);
  assert.match(moduleSource, /new URLSearchParams\(hash\.slice\(queryIndex \+ 1\)\)/);
});

test('QR scan reaches backend even if camera shutdown stalls and exposes a retry path', () => {
  assert.match(moduleSource, /ENERGY_SCANNER_STOP_TIMEOUT_MS = 1500/);
  assert.match(moduleSource, /ENERGY_SCAN_TIMEOUT_MS = 12000/);
  assert.match(moduleSource, /QR detectado\. Verificando habitación/);
  assert.match(moduleSource, /void stopScanner\(\);[\s\S]{0,500}db\.rpc\('energy_scan'/);
  assert.match(moduleSource, /withTimeout\([\s\S]{0,120}db\.rpc\('energy_scan'/);
  assert.match(moduleSource, /ENERGY_SCAN_TIMEOUT/);
  assert.match(moduleSource, /renderScanRetry/);
  assert.match(moduleSource, /HotelMonitoring\?\.captureException/);
  assert.match(moduleSource, /ENERGY_QR_CAMERA_OPEN_FAILED/);
});

test('admin can prepare QR while feature is disabled and worker cannot list secrets', () => {
  const regenerateBody = hardening.match(
    /create or replace function public\.energy_regenerate_qr\(p_room_id uuid\)[\s\S]*?\$function\$;/i
  )?.[0] || '';
  assert.ok(regenerateBody, 'energy_regenerate_qr definition must exist');
  assert.match(regenerateBody, /energy_actor_allowed\(true\)/);
  assert.match(regenerateBody, /private\.room_energy_qr_secrets/);
  assert.doesNotMatch(regenerateBody, /energy_control_enabled/i);
  assert.match(hardening, /revoke all on function public\.energy_list_qr_tokens\(\) from authenticated/);
  assert.match(hardening, /grant execute on function public\.energy_list_qr_tokens\(\) to authenticated/);
});

test('QR printing supports one, selected or all rooms on compact letter sheets', () => {
  assert.match(moduleSource, /ENERGY_QR_PRINT_SIZE_IN = 1\.5/);
  assert.match(moduleSource, /ENERGY_QR_PRINT_PER_PAGE = 20/);
  assert.match(moduleSource, /@page \{ size: Letter portrait; margin: 0\.25in; \}/);
  assert.match(moduleSource, /grid-template-columns: repeat\(4, 2in\)/);
  assert.match(moduleSource, /grid-template-rows: repeat\(5, 2\.05in\)/);
  assert.match(moduleSource, /data-print="\$\{room\.room_id\}"/);
  assert.match(moduleSource, /energy-print-selected/);
  assert.match(moduleSource, /energy-print-all/);
  assert.match(moduleSource, /energy-select-all/);
  assert.match(moduleSource, /energy-clear-selection/);
  assert.match(moduleSource, /printableRoomLabel/);
  assert.match(moduleSource, /Hab\. \$\{number/);
  assert.match(moduleSource, /Faltan \$\{missingCount\} QR por generar/);
  assert.doesNotMatch(moduleSource, /<h1>CONTROL DE ENERGÍA<\/h1>/);
});

test('printed QR keeps a white safety margin and uses higher resolution source', () => {
  assert.match(moduleSource, /width: 256, height: 256/);
  assert.match(moduleSource, /qr-safe-zone/);
  assert.match(moduleSource, /padding: 0\.06in/);
  assert.match(moduleSource, /image-rendering: pixelated/);
  assert.match(moduleSource, /qrImageSource/);
  assert.match(moduleSource, /toDataURL\('image\/png'\)/);
});

test('disabling energy cancels open checks so stale controls cannot return later', () => {
  assert.match(hardening, /energy_cancel_open_checks_when_disabled/);
  assert.match(hardening, /old\.energy_control_enabled = true and new\.energy_control_enabled = false/);
  assert.match(hardening, /status = 'cancelled'/);
  assert.match(hardening, /Control de Energia desactivado/);
});

test('overdue alerts use atomic claims, recipient idempotency and retries', () => {
  assert.match(hardening, /energy_claim_overdue_alerts/);
  assert.match(hardening, /skip locked/i);
  assert.match(hardening, /admin_alert_attempts < 5/);
  assert.match(hardening, /energy_check_notification_recipient_uidx/);
  assert.match(alertFn, /CRON_SECRET/);
  assert.match(alertFn, /constantTimeEqual/);
  assert.match(alertFn, /energy_claim_overdue_alerts/);
  assert.match(alertFn, /energy_notify_recipients/);
  assert.match(alertFn, /failed_permanent/);
  assert.match(alertFn, /MAKE_CASH_CLOSE_WEBHOOK_URL/);
});

test('overdue queue casts hotel citext email to its declared text contract', () => {
  assert.match(overdueTypeFix, /energy_claim_overdue_alerts/);
  assert.match(overdueTypeFix, /h\.correo::text/);
  assert.match(overdueTypeFix, /hotel_email text/);
});

test('energy alert worker is covered by CI typecheck and lint', () => {
  assert.match(pkg, /supabase\/functions\/process-energy-alerts\/index\.ts/);
  assert.match(pkg, /supabase\/functions\/process-energy-alerts/);
});

test('energy cron is registered only when scheduler extensions and Vault secrets exist', () => {
  assert.match(hardening, /energy-overdue-alerts-every-minute/);
  assert.match(hardening, /pg_cron/);
  assert.match(hardening, /pg_net/);
  assert.match(hardening, /bank_email_project_url/);
  assert.match(hardening, /bank_email_cron_secret/);
  assert.match(hardening, /\/functions\/v1\/process-energy-alerts/);
});