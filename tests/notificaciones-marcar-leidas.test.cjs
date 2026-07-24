const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('marcar todas las notificaciones tiene RPC segura y respaldo compatible', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260724150000_fix_marcar_notificaciones_leidas.sql'),
    'utf8'
  );
  const service = fs.readFileSync(
    path.join(root, 'js/services/notificationCenterService.js'),
    'utf8'
  );
  const ui = fs.readFileSync(
    path.join(root, 'js/modules/notificaciones/notificaciones.js'),
    'utf8'
  );

  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /n\.hotel_id = v_actor\.hotel_id/);
  assert.match(migration, /v_actor\.rol::text IN \('admin', 'superadmin'\)/);
  assert.match(service, /usando actualización compatible/);
  assert.match(service, /\.or\(buildNotificationMatchFilter\(context\)\)/);
  assert.match(ui, /markAllNotificationsAsRead\(supabase, context\)/);
  assert.match(ui, /if \(markAllButton\.disabled\) return/);
});
