const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('el calendario mensual usa una capa responsive estilo Google Calendar', () => {
  const ui = fs.readFileSync('js/modules/mantenimiento/mantenimiento-calendario-google-ui.js', 'utf8');
  const analytics = fs.readFileSync('js/modules/mantenimiento/mantenimiento-analytics-ui.js', 'utf8');

  assert.match(ui, /grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(ui, /data-google-calendar-event/);
  assert.match(ui, /@media \(max-width: 767px\)/);
  assert.match(ui, /overflow-x:\s*hidden\s*!important/);
  assert.match(analytics, /mountMaintenanceCalendarGoogleStyle/);
  assert.match(analytics, /unmountMaintenanceCalendarGoogleStyle/);
});
