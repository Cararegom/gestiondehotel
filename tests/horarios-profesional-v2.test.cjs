const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260902072000_horarios_profesional_v2.sql', 'utf8');
const engine = fs.readFileSync('supabase/functions/schedule-generator-v2/index.ts', 'utf8');
const ui = fs.readFileSync('js/modules/usuarios/horarios-profesional.js', 'utf8');
const facade = fs.readFileSync('js/modules/usuarios/usuarios.js', 'utf8');
const legacy = fs.readFileSync('js/modules/usuarios/usuarios-legacy.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

test('el creador ya no depende de n8n ni de una VM externa', () => {
  assert.match(engine, /schedule-generator-v2/);
  assert.doesNotMatch(engine, /n8n|webhook.*google|compute engine/i);
  assert.doesNotMatch(ui, /n8n|webhook.*google|compute engine/i);
});

test('soporta operación de 8 y 12 horas con plantillas reales', () => {
  assert.match(migration, /tipo_operacion integer[\s\S]*check \(tipo_operacion in \(8,12\)\)/i);
  assert.match(engine, /codigo: "manana"[\s\S]*"07:00"[\s\S]*"14:00"/);
  assert.match(engine, /codigo: "tarde"[\s\S]*"14:00"[\s\S]*"22:00"/);
  assert.match(engine, /codigo: "noche"[\s\S]*"22:00"[\s\S]*"07:00"/);
  assert.match(engine, /codigo: "dia"[\s\S]*"07:00"[\s\S]*"19:00"/);
  assert.match(engine, /codigo: "noche"[\s\S]*"19:00"[\s\S]*"07:00"/);
});

test('la regla Noche -> Día se resuelve por descanso real entre timestamps', () => {
  assert.match(engine, /function restBetween/);
  assert.match(engine, /restBetween\(prev\.fecha, prevShift, date, shift\) < config\.descanso_minimo_horas/);
  assert.match(engine, /DESCANSO_MINIMO/);
  assert.match(engine, /descanso_minimo_horas/);
});

test('el hotel de 8h puede usar relevo extendido para producir descansos', () => {
  assert.match(migration, /permitir_relevo_extendido boolean/);
  assert.match(engine, /dia_extendido/);
  assert.match(engine, /noche_extendida/);
  assert.match(engine, /relayNeeded/);
  assert.match(engine, /requiredRest/);
  assert.match(engine, /modo_cobertura: relayDates\.has\(date\) \? "relevo" : "normal"/);
});

test('solo participan recepcionistas activas del hotel', () => {
  assert.match(engine, /from\("roles"\)[\s\S]*ilike\("nombre", "Recepcionista"\)/);
  assert.match(engine, /from\("usuarios_roles"\)/);
  assert.match(engine, /from\("usuarios"\)[\s\S]*eq\("activo", true\)/);
});

test('solicitudes obligatorias de descanso y no disponibilidad son reglas duras', () => {
  assert.match(migration, /horario_solicitudes_v2/);
  assert.match(engine, /\["descanso", "no_disponible"\]/);
  assert.match(engine, /SOLICITUD_OBLIGATORIA/);
  assert.match(engine, /solicitud_obligatoria/);
});

test('reorganizar conserva asignaciones bloqueadas', () => {
  assert.match(engine, /preserveLocked/);
  assert.match(engine, /eq\("bloqueado", true\)/);
  assert.match(engine, /lockedMap/);
  assert.match(ui, /🔒/);
  assert.match(ui, /Reorganizar/);
  assert.match(ui, /Los turnos con 🔒 se conservaron/);
});

test('valida cobertura, descanso semanal, noches consecutivas y equidad', () => {
  assert.match(engine, /codigo: "COBERTURA"/);
  assert.match(engine, /codigo: "DESCANSO_SEMANAL"/);
  assert.match(engine, /codigo: "NOCHES_CONSECUTIVAS"/);
  assert.match(engine, /BALANCE_HORAS/);
  assert.match(engine, /BALANCE_NOCHES/);
  assert.match(engine, /BALANCE_FIN_SEMANA/);
  assert.match(engine, /quality/);
});

test('un horario con conflictos críticos no se publica', () => {
  assert.match(migration, /HORARIO_CON_CONFLICTOS_CRITICOS/);
  assert.match(engine, /SCHEDULE_HAS_CONFLICTS/);
  assert.match(engine, /checked\.validation\.criticos\.length/);
});

test('guardar borrador y publicar son operaciones atómicas en PostgreSQL', () => {
  assert.match(migration, /horario_guardar_borrador_v2/);
  assert.match(migration, /delete from public\.horario_asignaciones_v2/);
  assert.match(migration, /jsonb_to_recordset/);
  assert.match(migration, /horario_publicar_v2/);
  assert.match(migration, /delete from public\.turnos_programados[\s\S]*tp\.hotel_id=v_horario\.hotel_id[\s\S]*tp\.fecha between/);
  assert.match(migration, /insert into public\.turnos_programados/);
  assert.match(migration, /generado_auto/);
});

test('las funciones internas no son ejecutables por authenticated', () => {
  assert.match(migration, /revoke all on function public\.horario_guardar_borrador_v2[\s\S]*authenticated/);
  assert.match(migration, /grant execute on function public\.horario_guardar_borrador_v2[\s\S]*service_role/);
  assert.match(migration, /revoke all on function public\.horario_publicar_v2[\s\S]*authenticated/);
  assert.match(migration, /grant execute on function public\.horario_publicar_v2[\s\S]*service_role/);
});

test('las tablas nuevas son RLS y el navegador queda de solo lectura', () => {
  for (const table of ['horario_configuracion_v2','horario_turnos_v2','horarios_v2','horario_participantes_v2','horario_dias_v2','horario_asignaciones_v2','horario_solicitudes_v2']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(migration, /revoke all on public\.horario_configuracion_v2[\s\S]*from anon, authenticated/);
  assert.match(migration, /grant select on public\.horario_configuracion_v2[\s\S]*to authenticated/);
});

test('la Edge Function exige administrador activo y controla hotel', () => {
  assert.match(engine, /Solo un administrador activo puede gestionar horarios/);
  assert.match(engine, /auth\.getUser\(token\)/);
  assert.match(engine, /No puedes gestionar horarios de otro hotel/);
  assert.match(engine, /profile\?\.activo === true/);
});

test('la UI permite semana, mes, generar, validar, reorganizar, publicar e imprimir', () => {
  assert.match(ui, /data-period="semana"/);
  assert.match(ui, /data-period="mes"/);
  assert.match(ui, /✨ Generar borrador/);
  assert.match(ui, /🔄 Reorganizar/);
  assert.match(ui, /✓ Validar/);
  assert.match(ui, /Publicar horario/);
  assert.match(ui, /🖨️ Imprimir/);
  assert.match(ui, /Calidad/);
});

test('la gestión estable de Usuarios permanece detrás de una fachada', () => {
  assert.match(facade, /usuarios-legacy\.js/);
  assert.match(facade, /horarios-profesional\.js/);
  assert.match(facade, /await legacy\.mount/);
  assert.match(facade, /mountHorarioProfesional/);
  assert.match(legacy, /Gestión de Usuarios del Hotel/);
  assert.match(legacy, /usuarios-archivo-enhancer|Gestión de Usuarios|turnos_programados/);
});

test('el CI hace typecheck y lint del nuevo motor', () => {
  assert.match(pkg.scripts.typecheck, /schedule-generator-v2\/index\.ts/);
  assert.match(pkg.scripts.lint, /schedule-generator-v2/);
});
