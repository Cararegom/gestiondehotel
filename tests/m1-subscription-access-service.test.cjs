const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const servicePath = path.join(root, 'js/services/subscriptionAccessService.js');
const servicePromise = import(`${pathToFileURL(servicePath).href}?m1=${Date.now()}`);

test('resuelve el plan pendiente solo desde su fecha efectiva', async () => {
  const { resolveEffectiveHotelPlan } = await servicePromise;
  const hotel = {
    plan: 'Basico',
    plan_id: 'plan-1',
    plan_pendiente: 'Premium',
    plan_pendiente_id: 'plan-2',
    plan_pendiente_desde: '2026-10-01T00:00:00.000Z'
  };

  assert.equal(resolveEffectiveHotelPlan(hotel, '2026-09-30T23:59:59.000Z'), hotel);
  assert.deepEqual(resolveEffectiveHotelPlan(hotel, '2026-10-01T00:00:00.000Z'), {
    ...hotel,
    plan: 'Premium',
    plan_id: 'plan-2'
  });
  assert.equal(resolveEffectiveHotelPlan({ ...hotel, plan_pendiente_desde: 'fecha-invalida' }).plan, 'Basico');
});

test('distingue suscripcion activa, gracia automatica y vencimiento confirmado', async () => {
  const { calculateSubscriptionStatus } = await servicePromise;
  const active = calculateSubscriptionStatus({
    estado_suscripcion: 'trial',
    trial_fin: '2026-09-22T12:00:00.000Z'
  }, '2026-09-21T12:00:00.000Z');
  const grace = calculateSubscriptionStatus({
    estado_suscripcion: 'vencido',
    suscripcion_fin: '2026-09-20T12:00:00.000Z'
  }, '2026-09-21T12:00:00.000Z');
  const expired = calculateSubscriptionStatus({
    estado_suscripcion: 'vencido',
    suscripcion_fin: '2026-09-20T12:00:00.000Z'
  }, '2026-09-23T12:00:00.000Z');

  assert.equal(active.estadoEfectivo, 'trial');
  assert.equal(active.diasRestantes, 1);
  assert.equal(active.fueraDeGracia, false);
  assert.equal(grace.enGracia, true);
  assert.equal(grace.fueraDeGracia, false);
  assert.equal(expired.enGracia, false);
  assert.equal(expired.fueraDeGracia, true);
});

test('respeta una gracia manual posterior y nunca bloquea cuentas exentas', async () => {
  const { calculateSubscriptionStatus } = await servicePromise;
  const manualGrace = calculateSubscriptionStatus({
    estado_suscripcion: 'vencido',
    suscripcion_fin: '2026-09-01T00:00:00.000Z',
    gracia_hasta: '2026-09-30T00:00:00.000Z'
  }, '2026-09-21T00:00:00.000Z');
  const internal = calculateSubscriptionStatus({
    estado_suscripcion: 'vencido',
    suscripcion_fin: '2020-01-01T00:00:00.000Z',
    suscripcion_exenta: true
  }, '2026-09-21T00:00:00.000Z');

  assert.equal(manualGrace.enGracia, true);
  assert.equal(manualGrace.diasRestantes, 9);
  assert.equal(internal.estadoEfectivo, 'interno');
  assert.equal(internal.fueraDeGracia, false);
  assert.equal(internal.fechaFin, null);
});

test('una fecha ausente o invalida no bloquea globalmente el router', async () => {
  const { calculateSubscriptionStatus } = await servicePromise;

  for (const value of [null, 'fecha-invalida']) {
    const status = calculateSubscriptionStatus({
      estado_suscripcion: 'vencido',
      suscripcion_fin: value
    }, '2026-09-21T00:00:00.000Z');
    assert.equal(status.fueraDeGracia, false);
    assert.equal(status.fechaFin, null);
  }
});

test('centraliza modulos del plan, exenciones y accesos especiales', async () => {
  const {
    PLAN_EXEMPT_MODULES,
    isModuleAccessibleForPlan
  } = await servicePromise;

  assert.equal(isModuleAccessibleForPlan('reservas', ['reservas']), true);
  assert.equal(isModuleAccessibleForPlan('reservas', []), false);
  assert.equal(isModuleAccessibleForPlan('micuenta', []), true);
  assert.equal(PLAN_EXEMPT_MODULES.filter((module) => module === 'micuenta').length, 1);
  assert.equal(isModuleAccessibleForPlan('terraza', ['terraza'], { canAccessTerraza: false }), false);
  assert.equal(isModuleAccessibleForPlan('terraza', [], { canAccessTerraza: true }), true);
  assert.equal(isModuleAccessibleForPlan('pagos-bancarios', [], { canAccessBankPayments: true }), true);
});

test('define una sola decision de ruta para suscripciones vencidas', async () => {
  const { getExpiredSubscriptionRouteDecision } = await servicePromise;

  assert.equal(getExpiredSubscriptionRouteDecision({ fueraDeGracia: false, esAdmin: false, baseRoute: '/caja' }), 'allow');
  assert.equal(getExpiredSubscriptionRouteDecision({ fueraDeGracia: true, esAdmin: true, baseRoute: '/micuenta' }), 'allow');
  assert.equal(getExpiredSubscriptionRouteDecision({ fueraDeGracia: true, esAdmin: true, baseRoute: '/dashboard' }), 'redirect-micuenta');
  assert.equal(getExpiredSubscriptionRouteDecision({ fueraDeGracia: true, esAdmin: false, baseRoute: '/dashboard' }), 'block-staff');
});

test('carga el contexto del hotel incluyendo la exencion y el plan efectivo', async () => {
  const { loadHotelSubscriptionContext } = await servicePromise;
  const selections = [];
  const hotel = {
    id: 'hotel-1',
    plan: 'Premium',
    estado_suscripcion: 'vencido',
    suscripcion_fin: '2020-01-01T00:00:00.000Z',
    suscripcion_exenta: true
  };
  const supabase = {
    from(table) {
      const query = {
        select(columns) {
          selections.push({ table, columns });
          return query;
        },
        eq() { return query; },
        async single() {
          if (table === 'hoteles') return { data: hotel, error: null };
          if (table === 'planes') {
            return {
              data: { nombre: 'Premium', funcionalidades: { modulos_permitidos: ['reservas'] } },
              error: null
            };
          }
          throw new Error(`Tabla inesperada: ${table}`);
        }
      };
      return query;
    }
  };

  const context = await loadHotelSubscriptionContext(supabase, 'hotel-1', {
    now: '2026-09-21T00:00:00.000Z'
  });

  assert.equal(context.hotel.id, 'hotel-1');
  assert.equal(context.planDetails.nombre, 'Premium');
  assert.equal(context.subscriptionStatus.estadoEfectivo, 'interno');
  assert.equal(context.subscriptionStatus.fueraDeGracia, false);
  assert.match(selections.find((entry) => entry.table === 'hoteles').columns, /suscripcion_exenta/);
});

test('main y Mi Cuenta consumen el servicio compartido sin duplicar reglas', () => {
  const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
  const account = fs.readFileSync(path.join(root, 'js/modules/micuenta/accountDataService.js'), 'utf8');

  assert.match(main, /from '\.\/services\/subscriptionAccessService\.js'/);
  assert.match(main, /loadHotelSubscriptionContext\(supabaseInstance, hotelId\)/);
  assert.doesNotMatch(main, /function calculateSubscriptionExpiredStatus/);
  assert.doesNotMatch(main, /const modulosExentos =/);
  assert.match(account, /calculateSubscriptionStatus/);
  assert.match(account, /resolveEffectiveHotelPlan/);
  assert.doesNotMatch(account, /function calcularEstadoDeVencimiento/);
});
