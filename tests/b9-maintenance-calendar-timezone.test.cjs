const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const servicePath = path.join(root, 'js/services/hotelTimeZoneService.js');
const calendarPath = path.join(root, 'js/modules/mantenimiento/mantenimiento-calendario-ui.js');
const calendar = fs.readFileSync(calendarPath, 'utf8');

function supabaseWithTimeZone(timeZone, error = null) {
  return {
    from(table) {
      assert.equal(table, 'configuracion_hotel');
      return {
        select(columns) {
          assert.equal(columns, 'zona_horaria');
          return {
            eq(column, hotelId) {
              assert.equal(column, 'hotel_id');
              assert.equal(hotelId, 'hotel-b9');
              return {
                async maybeSingle() {
                  return { data: timeZone === undefined ? null : { zona_horaria: timeZone }, error };
                }
              };
            }
          };
        }
      };
    }
  };
}

test('B9 exige una zona IANA configurada y no inventa un pais', async () => {
  const service = await import(`${pathToFileURL(servicePath).href}?b9=${Date.now()}`);

  await assert.rejects(
    service.loadRequiredHotelTimeZone(supabaseWithTimeZone(undefined), 'hotel-b9'),
    /Configura una zona horaria válida/,
  );
  await assert.rejects(
    service.loadRequiredHotelTimeZone(supabaseWithTimeZone('zona-invalida'), 'hotel-b9'),
    /Configura una zona horaria válida/,
  );

  assert.equal(
    await service.loadRequiredHotelTimeZone(supabaseWithTimeZone('America/Mexico_City'), 'hotel-b9'),
    'America/Mexico_City',
  );
  assert.equal(service.getRuntimeHotelTimeZone(), 'America/Mexico_City');
});

test('B9 calcula hoy con el servicio central y elimina fallbacks silenciosos', () => {
  assert.match(calendar, /getTodayInTimeZone\(getRuntimeHotelTimeZone\(\)\)/);
  assert.match(calendar, /await loadRequiredHotelTimeZone\(supabase, hotelId\)/);
  assert.doesNotMatch(calendar, /America\/Bogota/);
  assert.doesNotMatch(calendar, /hotelConfigGlobal\?\.zona_horaria/);
  assert.doesNotMatch(calendar, /toISOString\(\)\.slice\(0, 10\)/);
});

test('B9 deja visible el error de configuracion sin bloquear todo Mantenimiento', () => {
  assert.match(calendar, /El calendario necesita la zona horaria del hotel\./);
  assert.match(calendar, /Configura una zona horaria válida e intenta de nuevo\./);
  assert.match(calendar, /catch \(error\)[\s\S]*shell\.innerHTML[\s\S]*return;/);
});
