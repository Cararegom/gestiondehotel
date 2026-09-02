const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const schema = fs.readFileSync('supabase/migrations/20260902072000_horarios_profesionales_fase1.sql', 'utf8');
const publish = fs.readFileSync('supabase/migrations/20260902073000_horarios_publicacion_compat_legacy.sql', 'utf8');
const engine = fs.readFileSync('supabase/functions/horario-engine/index.ts', 'utf8');

test('el creador soporta hoteles de 8 y 12 horas sin mezclar modalidades', () => {
  assert.match(schema, /modalidad smallint NOT NULL DEFAULT 12 CHECK \(modalidad IN \(8, 12\)\)/);
  assert.match(engine, /typedConfig\.modalidad === 8/);
  assert.match(engine, /codigo: "manana"/);
  assert.match(engine, /codigo: "tarde"/);
  assert.match(engine, /codigo: "noche"/);
  assert.match(engine, /codigo: "dia"/);
});

test('las horas reales viven en plantillas configurables y no en nombres de turno', () => {
  assert.match(schema, /hora_inicio time NOT NULL/);
  assert.match(schema, /hora_fin time NOT NULL/);
  assert.match(schema, /duracion_minutos integer NOT NULL/);
  assert.match(engine, /timeMinutes\(shift\.hora_inicio\)/);
  assert.match(engine, /shift\.duracion_minutos/);
});

test('Noche a Día al día siguiente es un conflicto duro', () => {
  assert.match(engine, /stat\.ultimoTrabajo\.nocturno/);
  assert.match(engine, /daysBetween\(stat\.ultimoTrabajo\.fecha, date\) === 1 && !shift\.es_nocturno/);
  assert.match(engine, /codigo: "NOCHE_A_DIA"/);
  assert.match(engine, /no puede pasar a turno de día al día siguiente/);
});

test('el motor exige descanso mínimo y limita secuencias de trabajo y noches', () => {
  assert.match(schema, /descanso_minimo_horas numeric\(4,1\) NOT NULL DEFAULT 11/);
  assert.match(schema, /max_turnos_consecutivos smallint NOT NULL DEFAULT 6/);
  assert.match(schema, /max_noches_consecutivas smallint NOT NULL DEFAULT 3/);
  assert.match(engine, /restMinutes < Number\(config\.descanso_minimo_horas\) \* 60/);
  assert.match(engine, /MAX_CONSECUTIVOS/);
  assert.match(engine, /MAX_NOCHES/);
});

test('generar y reorganizar trabajan sobre borradores, nunca directamente sobre el horario publicado', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.horario_borradores/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.horario_borrador_asignaciones/);
  assert.match(engine, /action === "generate"/);
  assert.match(engine, /action === "reorganize"/);
  assert.doesNotMatch(engine, /\.from\("turnos_programados"\)\.insert/);
  assert.doesNotMatch(engine, /\.from\("turnos_programados"\)\.delete/);
});

test('reorganizar conserva las asignaciones bloqueadas y reemplaza solo las libres', () => {
  assert.match(engine, /locked = bundle\.assignments\.filter\(\(item\) => item\.bloqueado === true\)/);
  assert.match(engine, /\.eq\("bloqueado", false\)/);
  assert.match(engine, /const unlockedGenerated = assignments\.filter\(\(item\) => !item\.id\)/);
});

test('la edición manual bloquea por defecto la asignación para protegerla de Reorganizar', () => {
  assert.match(engine, /action === "update_assignment"/);
  assert.match(engine, /bloqueado: body\?\.bloqueado !== false/);
  assert.match(engine, /origen: "manual"/);
});

test('las solicitudes soportan descansos, indisponibilidad y preferencias obligatorias', () => {
  assert.match(schema, /'no_disponible','descanso','turno_fijo','preferir_turno','evitar_turno'/);
  assert.match(schema, /obligatorio boolean NOT NULL DEFAULT true/);
  assert.match(engine, /SOLICITUD_OBLIGATORIA/);
});

test('el motor solo usa usuarios activos con rol Recepcionista', () => {
  assert.match(engine, /\.ilike\("nombre", "Recepcionista"\)/);
  assert.match(engine, /\.eq\("activo", true\)/);
  assert.match(engine, /usuarios_roles/);
});

test('la cobertura diaria debe usar el grupo normal completo o un grupo extendido completo', () => {
  assert.match(engine, /validNormal/);
  assert.match(engine, /validExtended/);
  assert.match(engine, /COBERTURA_INCOMPLETA/);
  assert.match(schema, /permitir_turnos_extendidos boolean NOT NULL DEFAULT false/);
});

test('publicar es una operación atómica de base de datos y bloquea conflictos', () => {
  assert.match(publish, /FOR UPDATE/);
  assert.match(publish, /HORARIO_TIENE_CONFLICTOS/);
  assert.match(publish, /DELETE FROM public\.turnos_programados/);
  assert.match(publish, /INSERT INTO public\.turnos_programados/);
  assert.match(publish, /SET estado = 'publicado'/);
  assert.match(publish, /REVOKE ALL ON FUNCTION public\.horario_publicar_borrador/);
  assert.match(publish, /GRANT EXECUTE ON FUNCTION public\.horario_publicar_borrador[\s\S]*TO service_role/);
});

test('la publicación conserva compatibilidad con el campo legado dia NOT NULL', () => {
  assert.match(publish, /fecha,\s*dia,\s*usuario_id/);
  assert.match(publish, /WHEN 1 THEN 'lunes'/);
  assert.match(publish, /WHEN 7 THEN 'domingo'/);
});

test('el motor valida antes de publicar y usa el RPC atómico', () => {
  assert.match(engine, /action === "publish"/);
  assert.match(engine, /validateAssignments/);
  assert.match(engine, /HORARIO_TIENE_CONFLICTOS/);
  assert.match(engine, /rpc\("horario_publicar_borrador"/);
});

test('tablas expuestas de horario tienen RLS y aislamiento hotelero', () => {
  for (const table of ['horario_configuracion', 'horario_plantillas_turno', 'horario_solicitudes', 'horario_borradores', 'horario_borrador_asignaciones']) {
    assert.match(schema, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(schema, /usuario_actual_es_admin_hotel\(hotel_id\)/);
  assert.match(schema, /fase1_actor_es_miembro_activo\(hotel_id\)/);
  assert.match(schema, /REVOKE ALL ON public\.horario_configuracion[\s\S]*FROM anon/);
});
