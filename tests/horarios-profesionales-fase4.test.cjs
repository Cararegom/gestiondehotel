const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('js/modules/usuarios/horarios-profesionales-fase4.js', 'utf8');
const hook = fs.readFileSync('js/services/permissionTemplateService.js', 'utf8');
const operations = fs.readFileSync('supabase/functions/horario-operations/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260902165000_horarios_fase4_operacion.sql', 'utf8');
const pkg = fs.readFileSync('package.json', 'utf8');

test('Fase 4 es la capa activa y conserva Fase 3 como base operativa', () => {
  assert.match(hook, /horarios-profesionales-fase4\.js/);
  assert.match(ui, /import '\.\/horarios-profesionales-fase3\.js'/);
  assert.match(ui, /root\.dataset\.phase = '4'/);
  assert.match(ui, /Horarios · Fase 4/);
  assert.match(ui, /Operación completa/);
});

test('la autopreparación nace desactivada y admite semana o mes', () => {
  assert.match(migration, /autopreparar_activo boolean NOT NULL DEFAULT false/);
  assert.match(migration, /autopreparar_periodo text NOT NULL DEFAULT 'semana'/);
  assert.match(migration, /CHECK \(autopreparar_periodo IN \('semana', 'mes'\)\)/);
  assert.match(migration, /autopreparar_dias_anticipacion BETWEEN 1 AND 14/);
  assert.match(ui, /Preparación automática/);
  assert.match(ui, /Nunca se publica automáticamente/);
});

test('autopreparar solo genera borrador y nunca invoca publicación', () => {
  assert.match(operations, /action: "generate"/);
  assert.match(operations, /fecha_inicio: target\.start/);
  assert.match(operations, /fecha_fin: target\.end/);
  assert.doesNotMatch(operations, /action:\s*["']publish["']/);
  assert.doesNotMatch(operations, /horario_publicar_borrador/);
});

test('autopreparar evita duplicados por hotel y rango exacto', () => {
  assert.match(operations, /\.from\("horario_borradores"\)/);
  assert.match(operations, /\.eq\("fecha_inicio", target\.start\)/);
  assert.match(operations, /\.eq\("fecha_fin", target\.end\)/);
  assert.match(operations, /\.in\("estado", \["borrador", "publicado"\]\)/);
  assert.match(operations, /reason: "already_exists"/);
});

test('la autopreparación usa la misma sesión administrativa para llamar horario-engine', () => {
  assert.match(operations, /req\.headers\.get\("Authorization"\)/);
  assert.match(operations, /\/functions\/v1\/horario-engine/);
  assert.match(operations, /"Authorization": authorization/);
  assert.match(operations, /admin\.auth\.getUser\(token\)/);
});

test('solicitudes solo aceptan recepcionistas activas y tipos conocidos', () => {
  assert.match(operations, /assertReceptionist/);
  assert.match(operations, /no_disponible/);
  assert.match(operations, /descanso/);
  assert.match(operations, /turno_fijo/);
  assert.match(operations, /preferir_turno/);
  assert.match(operations, /evitar_turno/);
  assert.match(operations, /no es una recepcionista activa/);
});

test('las solicitudes con turno verifican que la plantilla pertenezca al hotel', () => {
  assert.match(operations, /needsTemplate/);
  assert.match(operations, /\.from\("horario_plantillas_turno"\)/);
  assert.match(operations, /\.eq\("hotel_id", hotelId\)/);
  assert.match(operations, /El turno seleccionado no pertenece al hotel/);
});

test('retirar una solicitud es soft-delete para conservar trazabilidad', () => {
  assert.match(operations, /action === "cancel_request"/);
  assert.match(operations, /\.update\(\{ activo: false, actualizado_en:/);
  assert.doesNotMatch(operations, /\.from\("horario_solicitudes"\)[\s\S]{0,250}\.delete\(\)/);
});

test('la UI permite reglas obligatorias y preferencias', () => {
  assert.match(ui, /data-f4-request-required/);
  assert.match(ui, /OBLIGATORIA/);
  assert.match(ui, /PREFERENCIA/);
  assert.match(ui, /save_request/);
  assert.match(ui, /cancel_request/);
});

test('la UI final permite imprimir y exportar CSV desde la tabla visible', () => {
  assert.match(ui, /data-f4-action="print"/);
  assert.match(ui, /data-f4-action="csv"/);
  assert.match(ui, /window\.print\(\)/);
  assert.match(ui, /new Blob\(\[csv\]/);
  assert.match(ui, /text\/csv;charset=utf-8/);
});

test('Fase 4 no escribe directamente el horario publicado', () => {
  assert.doesNotMatch(ui, /from\(['"]turnos_programados['"]\)/);
  assert.doesNotMatch(operations, /\.from\("turnos_programados"\)/);
  assert.doesNotMatch(ui, /horario_publicar_borrador/);
});

test('CI incluye las dos Edge Functions del creador', () => {
  assert.match(pkg, /supabase\/functions\/horario-engine\/index\.ts/);
  assert.match(pkg, /supabase\/functions\/horario-operations\/index\.ts/);
  assert.match(pkg, /supabase\/functions\/horario-engine supabase\/functions\/horario-operations/);
});
