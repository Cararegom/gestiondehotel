const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { PGlite } = require('@electric-sql/pglite');

const helperPromise = import(pathToFileURL(resolve(
  __dirname, '../supabase/functions/_shared/bank-email/hotel-time-zone.ts'
)).href);
const hotelId = '11111111-1111-4111-8111-111111111111';
const missingHotelId = '22222222-2222-4222-8222-222222222222';

async function productionSchemaFixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create table public.hoteles(id uuid primary key);
    create table public.configuracion_hotel(hotel_id uuid primary key, zona_horaria text);
    insert into public.hoteles values ('${hotelId}');
    insert into public.configuracion_hotel values ('${hotelId}', 'America/Mexico_City');
  `);
  const migration = readFileSync(resolve(
    __dirname, '../supabase/migrations/20260903050000_hotel_timezone_systemwide.sql'
  ), 'utf8');
  const definition = migration.match(/CREATE OR REPLACE FUNCTION public\.hotel_time_zone\(p_hotel_id uuid\)[\s\S]*?\$\$;/i);
  assert.ok(definition, 'El fixture utiliza la función canónica de zona horaria.');
  await db.exec(definition[0]);

  const admin = {
    from(table) {
      return {
        select(columns) {
          return {
            eq(column, value) {
              return {
                async maybeSingle() {
                  try {
                    const result = await db.query(`select ${columns} from ${table} where ${column}=$1`, [value]);
                    return { data: result.rows[0] || null, error: null };
                  } catch (error) {
                    return { data: null, error };
                  }
                }
              };
            }
          };
        }
      };
    },
    async rpc(name, params) {
      assert.equal(name, 'hotel_time_zone');
      try {
        const result = await db.query('select public.hotel_time_zone($1) as zone', [params.p_hotel_id]);
        return { data: result.rows[0].zone, error: null };
      } catch (error) {
        return { data: null, error };
      }
    }
  };
  return { db, admin };
}

test('carga pagos con el esquema real: la zona horaria está en configuración, no en hoteles', async t => {
  const { loadHotelOperationalTimeZone } = await helperPromise;
  const { db, admin } = await productionSchemaFixture(t);
  await assert.rejects(db.query('select zona_horaria from public.hoteles'), error => error.code === '42703');
  assert.equal(await loadHotelOperationalTimeZone(admin, hotelId), 'America/Mexico_City');
});

test('un hotel sin configuración usa Bogotá y los filtros incluyen pagos nocturnos del día local', async t => {
  const { loadHotelOperationalTimeZone } = await helperPromise;
  const { utcRangeForCalendarDates } = await import(pathToFileURL(resolve(
    __dirname, '../supabase/functions/_shared/bank-email/time-zone.ts'
  )).href);
  const { admin } = await productionSchemaFixture(t);
  const zone = await loadHotelOperationalTimeZone(admin, missingHotelId);
  assert.equal(zone, 'America/Bogota');
  const range = utcRangeForCalendarDates('2026-10-12', '2026-10-12', zone);
  const received = '2026-10-13T01:43:51.000Z';
  assert.ok(received >= range.startIso && received < range.endExclusiveIso);
});

test('un error real de base de datos conserva un código seguro en vez de cambiar la zona silenciosamente', async () => {
  const { loadHotelOperationalTimeZone } = await helperPromise;
  const failure = { data: null, error: { code: '08006', message: 'private-database-details' } };
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => failure };
  const admin = { from: () => chain, rpc: async () => failure };
  await assert.rejects(loadHotelOperationalTimeZone(admin, hotelId), error =>
    error.code === 'hotel_time_zone_lookup_failed' && !error.message.includes('private-database-details')
  );
});
