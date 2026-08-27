const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const notifications = fs.readFileSync('js/modules/notificaciones/notificaciones.js', 'utf8');
const service = fs.readFileSync('js/services/notificationCenterService.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260825214500_notificacion_instantanea_pago_llave.sql', 'utf8');
const recipientFix = fs.readFileSync('supabase/migrations/20260825220000_corregir_destinatarios_alertas_bancarias.sql', 'utf8');
const receptionistFix = fs.readFileSync('supabase/migrations/20260827033138_alertas_transferencias_recepcionistas.sql', 'utf8');

test('muestra un globo global cuando llega una transferencia bancaria', () => {
  assert.match(notifications, /showInstantBankPaymentToast/);
  assert.match(notifications, /Nueva transferencia bancaria/);
  assert.match(notifications, /data-open-bank-payment/);
  assert.match(notifications, /canOpenBankPaymentDetails/);
  assert.match(notifications, /z-\[10000\]/);
  assert.doesNotMatch(notifications, /setTimeout\(removeToast/);
  assert.doesNotMatch(notifications, />Entendido</);
  assert.match(notifications, /showUnreadBankAlerts: true/);
  assert.match(notifications, /markNotificationAsRead\(supabase, notification\.id/);
  assert.match(notifications, /bellPollTimer = window\.setInterval/);
});

test('recepcionistas ven la alerta sin acceso a la conciliacion administrativa', () => {
  assert.match(service, /usuarios_roles\(roles\(nombre\)\)/);
  assert.match(service, /\['superadmin', 'admin', 'recepcionista'\]/);
  assert.match(notifications, /paymentEventId && canOpenBankPaymentDetails\(\)/);
  assert.match(receptionistFix, /JOIN public\.roles r ON r\.id = ur\.rol_id/);
  assert.match(receptionistFix, /'admin', 'administrador', 'superadmin', 'recepcionista', 'recepcion'/);
  assert.doesNotMatch(receptionistFix, /'usuario', 'recepcionista'/);
});

test('evita avisos ajenos o repetidos para el usuario conectado', () => {
  assert.match(notifications, /displayedInstantNotificationIds\.has/);
  assert.match(service, /notification\.usuario_id !== context\.userId/);
  assert.match(service, /onChange\?\.\(notification\)/);
});

test('la notificacion incluye llave, remitente, fecha y hora y llega solo a operacion', () => {
  assert.match(migration, /llave @hotelok/);
  assert.match(migration, /Remitente:/);
  assert.match(migration, /Fecha:/);
  assert.match(migration, /Hora:/);
  assert.match(migration, /'usuario', 'recepcionista', 'recepcion', 'admin', 'administrador'/);
  assert.match(recipientFix, /'usuario', 'recepcionista', 'recepcion', 'admin', 'administrador'/);
  assert.match(migration, /ON CONFLICT \(hotel_id, usuario_id, entidad_tipo, entidad_id\)/);
});
