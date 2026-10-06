const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.join(__dirname, '..');
const migrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20260919120000_a17_mantenimiento_recurrencia_unificada.sql',
);
const metricsMigrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20260919121500_a17_mantenimiento_metricas_planes.sql',
);

const ids = {
  hotelA: '10000000-0000-4000-8000-000000000001',
  hotelB: '10000000-0000-4000-8000-000000000002',
  roomA: '20000000-0000-4000-8000-000000000001',
  userA: '30000000-0000-4000-8000-000000000001',
  monthlyA: '40000000-0000-4000-8000-000000000001',
  monthlyDuplicate: '40000000-0000-4000-8000-000000000002',
  historical: '40000000-0000-4000-8000-000000000003',
};

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;

    create type public.frecuencia_tarea_enum as enum
      ('diaria', 'mensual', 'personalizada', 'semanal', 'unica');
    create type public.estado_tarea_enum as enum
      ('pendiente', 'en_revision', 'asignado', 'en_proceso', 'resuelto', 'cerrado', 'cancelado');
    create type public.tipo_tarea_enum as enum ('bloqueante', 'programado');

    create table public.hoteles(id uuid primary key);
    create table public.habitaciones(id uuid primary key, hotel_id uuid not null, nombre text);
    create table public.usuarios(
      id uuid primary key,
      hotel_id uuid not null,
      nombre text,
      correo text,
      email text
    );

    create table public.mantenimiento_planes (
      id uuid primary key default gen_random_uuid(),
      hotel_id uuid not null,
      clase text not null default 'preventivo',
      titulo text not null,
      descripcion text,
      ubicacion text,
      categoria_mantenimiento text not null default 'general',
      prioridad integer not null default 1,
      alcance text not null default 'general',
      habitacion_id uuid,
      asignada_a uuid,
      creada_por uuid,
      activo boolean not null default true,
      fecha_inicio date not null,
      hora_programada time,
      recurrencia_unidad text not null default 'ninguna',
      recurrencia_intervalo integer not null default 1,
      fecha_fin date,
      anticipaciones_dias integer[] not null default array[1, 0],
      requiere_evidencia boolean not null default false,
      checklist jsonb not null default '[]'::jsonb,
      proxima_fecha date,
      creado_en timestamptz not null default now(),
      actualizado_en timestamptz not null default now()
    );

    create table public.tareas_mantenimiento (
      id uuid primary key default gen_random_uuid(),
      hotel_id uuid not null,
      titulo text not null,
      descripcion text,
      estado public.estado_tarea_enum not null default 'pendiente',
      tipo public.tipo_tarea_enum not null default 'programado',
      fecha_programada date,
      fecha_completada timestamptz,
      cerrada_en timestamptz,
      vencimiento_at timestamptz,
      frecuencia public.frecuencia_tarea_enum default 'unica',
      ultima_realizacion timestamptz,
      creada_por uuid,
      asignada_a uuid,
      realizada_por uuid,
      creado_en timestamptz not null default now(),
      actualizado_en timestamptz not null default now(),
      habitacion_id uuid,
      prioridad integer,
      categoria_mantenimiento text,
      plan_id uuid,
      ubicacion_mantenimiento text
    );
    create unique index ux_tareas_mantenimiento_plan_fecha
      on public.tareas_mantenimiento(plan_id, fecha_programada)
      where plan_id is not null and fecha_programada is not null;

    create or replace function public.hotel_business_date(
      p_hotel_id uuid,
      p_instant timestamptz default now()
    ) returns date language sql stable as $$
      select date '2026-09-19'
    $$;

    create or replace function public.get_current_user_hotel_id()
    returns uuid language sql stable as $$
      select '${ids.hotelA}'::uuid
    $$;

    create or replace function public.mantenimiento_estado_es_abierto(p_estado text)
    returns boolean language sql immutable as $$
      select p_estado in ('pendiente', 'en_revision', 'asignado', 'en_proceso', 'resuelto')
    $$;

    create or replace function public.mantenimiento_estado_canonico(p_estado text)
    returns text language sql immutable as $$
      select case p_estado
        when 'en_progreso' then 'en_proceso'
        when 'completada' then 'cerrado'
        when 'cancelada' then 'cancelado'
        else p_estado
      end
    $$;

    create or replace function public.mantenimiento_plan_siguiente_fecha(
      p_fecha_actual date,
      p_fecha_ancla date,
      p_unidad text,
      p_intervalo integer
    ) returns date language plpgsql immutable as $$
    declare
      v_intervalo integer := greatest(coalesce(p_intervalo, 1), 1);
      v_month_start date;
      v_last_day date;
      v_anchor_day integer;
      v_anchor_month integer;
      v_target_year integer;
    begin
      case coalesce(p_unidad, 'ninguna')
        when 'ninguna' then return null;
        when 'dia' then return p_fecha_actual + v_intervalo;
        when 'semana' then return p_fecha_actual + (v_intervalo * 7);
        when 'mes' then
          v_anchor_day := extract(day from p_fecha_ancla)::integer;
          v_month_start := (date_trunc('month', p_fecha_actual::timestamp)
            + make_interval(months => v_intervalo))::date;
          v_last_day := (date_trunc('month', v_month_start::timestamp)
            + interval '1 month - 1 day')::date;
          return v_month_start + (least(v_anchor_day, extract(day from v_last_day)::integer) - 1);
        when 'anio' then
          v_anchor_day := extract(day from p_fecha_ancla)::integer;
          v_anchor_month := extract(month from p_fecha_ancla)::integer;
          v_target_year := extract(year from p_fecha_actual)::integer + v_intervalo;
          v_month_start := make_date(v_target_year, v_anchor_month, 1);
          v_last_day := (date_trunc('month', v_month_start::timestamp)
            + interval '1 month - 1 day')::date;
          return v_month_start + (least(v_anchor_day, extract(day from v_last_day)::integer) - 1);
        else raise exception 'Unidad invalida';
      end case;
    end
    $$;

    insert into public.hoteles(id) values
      ('${ids.hotelA}'), ('${ids.hotelB}');
    insert into public.habitaciones(id, hotel_id, nombre) values
      ('${ids.roomA}', '${ids.hotelA}', '101');
    insert into public.usuarios(id, hotel_id, nombre, correo, email) values
      ('${ids.userA}', '${ids.hotelA}', 'Tecnico', 'tecnico@example.test', 'tecnico@example.test');

    insert into public.tareas_mantenimiento(
      id, hotel_id, titulo, descripcion, estado, tipo, fecha_programada,
      frecuencia, creada_por, asignada_a, habitacion_id, prioridad,
      categoria_mantenimiento
    ) values
      (
        '${ids.monthlyA}', '${ids.hotelA}', 'Revisar aire', 'Rutina mensual',
        'pendiente', 'programado', '2026-01-31', 'mensual', '${ids.userA}',
        '${ids.userA}', '${ids.roomA}', 2, 'climatizacion'
      ),
      (
        '${ids.monthlyDuplicate}', '${ids.hotelA}', 'Revisar aire', 'Rutina mensual',
        'pendiente', 'programado', '2026-01-31', 'mensual', '${ids.userA}',
        '${ids.userA}', '${ids.roomA}', 2, 'climatizacion'
      ),
      (
        '${ids.historical}', '${ids.hotelA}', 'Historial cerrado', null,
        'cerrado', 'programado', '2026-01-01', 'semanal', '${ids.userA}',
        '${ids.userA}', null, 1, 'general'
      );
  `);

  await db.exec(fs.readFileSync(migrationPath, 'utf8'));
  await db.exec(fs.readFileSync(metricsMigrationPath, 'utf8'));
  return db;
}

test('A17 retira el motor legacy de todas las rutas JavaScript', () => {
  const activeUi = fs.readFileSync(path.join(root, 'js/modules/mantenimiento/mantenimiento-mobile-ui.js'), 'utf8');
  const workflowUi = fs.readFileSync(path.join(root, 'js/modules/mantenimiento/mantenimiento-workflow-ui.js'), 'utf8');
  const repository = fs.readFileSync(path.join(root, 'js/modules/mantenimiento/mantenimiento-repository.js'), 'utf8');
  const domain = fs.readFileSync(path.join(root, 'js/modules/mantenimiento/mantenimiento-domain.js'), 'utf8');
  const calendar = fs.readFileSync(path.join(root, 'js/modules/mantenimiento/mantenimiento-calendario-ui.js'), 'utf8');

  for (const source of [activeUi, workflowUi, repository, domain]) {
    assert.doesNotMatch(
      source,
      /ensureNextPreventive|createNextPreventiveTask|findOpenPreventiveTask|calculateNextScheduledDate|mantenimiento-preventivo/,
    );
  }
  assert.doesNotMatch(activeUi, /name="frecuencia"/);
  assert.match(activeUi, /normalized\?\.plan_id \? 'personalizada' : 'unica'/);
  assert.match(calendar, /name="recurrence_preset"/);
  assert.match(calendar, /\+ Programar tarea/);
  assert.equal(fs.existsSync(path.join(root, 'js/modules/mantenimiento/mantenimiento-preventivo.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'js/modules/mantenimiento/mantenimiento-ui.js')), false);
});

test('A17 convierte recurrencias abiertas y conserva el historial cerrado', async () => {
  const db = await createDatabase();
  try {
    const converted = await db.query(`
      select id, plan_id, frecuencia::text
      from public.tareas_mantenimiento
      where id in ('${ids.monthlyA}', '${ids.monthlyDuplicate}')
      order by id
    `);
    assert.equal(converted.rows.filter((row) => row.plan_id !== null).length, 1);
    assert.deepEqual(
      converted.rows.map((row) => row.frecuencia).sort(),
      ['personalizada', 'unica'],
    );

    const plan = await db.query(`
      select fecha_inicio::text, proxima_fecha::text, recurrencia_unidad,
             recurrencia_intervalo, alcance
      from public.mantenimiento_planes
    `);
    assert.deepEqual(plan.rows, [{
      fecha_inicio: '2026-01-31',
      proxima_fecha: '2026-09-30',
      recurrencia_unidad: 'mes',
      recurrencia_intervalo: 1,
      alcance: 'habitacion',
    }]);

    const historical = await db.query(`
      select plan_id, frecuencia::text
      from public.tareas_mantenimiento
      where id = '${ids.historical}'
    `);
    assert.deepEqual(historical.rows[0], { plan_id: null, frecuencia: 'semanal' });

    const dates = await db.query(`
      select
        public.mantenimiento_plan_primera_fecha_desde(
          '2024-01-31', '2024-02-01', 'mes', 1
        )::text as february,
        public.mantenimiento_plan_primera_fecha_desde(
          '2024-01-31', '2024-03-01', 'mes', 1
        )::text as march
    `);
    assert.deepEqual(dates.rows[0], { february: '2024-02-29', march: '2024-03-31' });

    const activePlanId = converted.rows.find((row) => row.plan_id !== null).plan_id;
    await db.query(`
      insert into public.tareas_mantenimiento(
        hotel_id, titulo, estado, tipo, fecha_programada, frecuencia, plan_id
      ) values (
        '${ids.hotelA}', 'Preventivo proximo', 'pendiente', 'programado',
        '2026-09-20', 'personalizada', '${activePlanId}'
      )
    `);
    const metrics = await db.query('select public.mantenimiento_metricas(30) as value');
    assert.equal(Number(metrics.rows[0].value.resumen.preventivos_7d), 1);
    assert.equal(metrics.rows[0].value.preventivos.length, 1);
    assert.equal(metrics.rows[0].value.preventivos[0].titulo, 'Preventivo proximo');
  } finally {
    await db.close();
  }
});

test('A17 impide que vuelva a aparecer un segundo motor de recurrencia', async () => {
  const db = await createDatabase();
  try {
    await assert.rejects(
      db.query(`
        insert into public.tareas_mantenimiento(hotel_id, titulo, frecuencia)
        values ('${ids.hotelA}', 'Legacy nueva', 'diaria')
      `),
      /A17_RECURRENCIA_REQUIERE_PLAN/i,
    );

    await db.query(`
      insert into public.tareas_mantenimiento(hotel_id, titulo, frecuencia)
      values ('${ids.hotelA}', 'Tarea unica', 'unica')
    `);

    const plan = await db.query('select id from public.mantenimiento_planes limit 1');
    const planId = plan.rows[0].id;
    await db.query(`
      insert into public.tareas_mantenimiento(hotel_id, titulo, frecuencia, plan_id)
      values ('${ids.hotelA}', 'Ejecucion valida', 'personalizada', '${planId}')
    `);

    await assert.rejects(
      db.query(`
        insert into public.tareas_mantenimiento(hotel_id, titulo, frecuencia, plan_id)
        values ('${ids.hotelB}', 'Plan cruzado', 'personalizada', '${planId}')
      `),
      /A17_PLAN_HOTEL_INVALIDO/i,
    );
  } finally {
    await db.close();
  }
});

test('A17 declara la conversion y el guardado en SQL', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const metricsSql = fs.readFileSync(metricsMigrationPath, 'utf8');
  assert.match(sql, /CREATE TEMP TABLE a17_mantenimiento_grupos_legacy/i);
  assert.match(sql, /public\.mantenimiento_estado_es_abierto/i);
  assert.match(sql, /'personalizada'::public\.frecuencia_tarea_enum/i);
  assert.match(sql, /CREATE TRIGGER trg_validar_mantenimiento_recurrencia_unificada/i);
  assert.match(sql, /A17_RECURRENCIA_REQUIERE_PLAN/i);
  assert.match(sql, /A17_PLAN_HOTEL_INVALIDO/i);
  assert.match(metricsSql, /JOIN public\.mantenimiento_planes mp/i);
  assert.match(metricsSql, /mp\.clase = 'preventivo'/i);
  assert.match(metricsSql, /hotel_business_date\(v_hotel, now\(\)\)/i);
  assert.doesNotMatch(metricsSql, /frecuencia::text IN/i);
  assert.doesNotMatch(metricsSql, /America\/Bogota/i);
});
