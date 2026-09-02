const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('js/modules/usuarios/horarios-profesionales-fase3.js', 'utf8');
const hook = fs.readFileSync('js/services/permissionTemplateService.js', 'utf8');
const engine = fs.readFileSync('supabase/functions/horario-engine/index.ts', 'utf8');
const publishMigration = fs.readFileSync('supabase/migrations/20260902073000_horarios_publicacion_compat_legacy.sql', 'utf8');

test('Fase 3 es la interfaz activa de horarios', () => {
  assert.match(hook, /import '\.\.\/modules\/usuarios\/horarios-profesionales-fase3\.js';/);
  assert.match(ui, /root\.dataset\.phase = '3'/);
  assert.match(ui, /Edición segura/);
});

test('la cuadrícula permite edición manual y la protege automáticamente', () => {
  assert.match(ui, /data-assignment-shift/);
  assert.match(ui, /invokeEngine\('update_assignment'/);
  assert.match(ui, /bloqueado: locked/);
  assert.match(ui, /updateAssignment\(cell\.dataset\.assignmentId, event\.target\.value \|\| null, true\)/);
  assert.match(ui, /Cambio guardado y protegido para Reorganizar/);
});

test('permite proteger y desbloquear asignaciones de manera explícita', () => {
  assert.match(ui, /data-action="toggle-lock"/);
  assert.match(ui, /Proteger/);
  assert.match(ui, /Desbloquear/);
  assert.match(ui, /toggleLock/);
  assert.match(ui, /!row\.bloqueado/);
});

test('Reorganizar conserva las asignaciones bloqueadas y recalcula solo las libres', () => {
  assert.match(ui, /data-action="reorganize"/);
  assert.match(ui, /invokeEngine\('reorganize'/);
  assert.match(ui, /asignaciones protegida\(s\) se conservarán sin cambios/);
  assert.match(engine, /bundle\.assignments\.filter\(\(item\) => item\.bloqueado === true\)/);
  assert.match(engine, /\.eq\("bloqueado", false\)/);
  assert.match(engine, /locked,/);
});

test('Validar vuelve a consultar el motor y muestra conflictos y advertencias', () => {
  assert.match(ui, /data-action="validate"/);
  assert.match(ui, /invokeEngine\('validate'/);
  assert.match(ui, /Validación del borrador/);
  assert.match(ui, /conflicto\(s\)/);
  assert.match(ui, /advertencia\(s\)/);
});

test('Publicar queda bloqueado visualmente cuando existen conflictos', () => {
  assert.match(ui, /data-action="publish"/);
  assert.match(ui, /conflicts \? 'disabled' : ''/);
  assert.match(ui, /Publicación bloqueada hasta resolver/);
  assert.match(ui, /if \(conflicts\) return showFeedback/);
});

test('Publicar exige confirmación y el backend vuelve a validar antes de escribir', () => {
  assert.match(ui, /title: 'Publicar horario'/);
  assert.match(ui, /invokeEngine\('publish'/);
  assert.match(engine, /checked = await validateDraft\(admin, hotelId, draftId\)/);
  assert.match(engine, /HORARIO_TIENE_CONFLICTOS/);
  assert.match(engine, /admin\.rpc\("horario_publicar_borrador"/);
});

test('la publicación sigue siendo atómica y solo service_role puede invocar el RPC', () => {
  assert.match(publishMigration, /CREATE OR REPLACE FUNCTION public\.horario_publicar_borrador/);
  assert.match(publishMigration, /REVOKE ALL ON FUNCTION public\.horario_publicar_borrador\(uuid, uuid\)[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(publishMigration, /GRANT EXECUTE ON FUNCTION public\.horario_publicar_borrador\(uuid, uuid\)[\s\S]*TO service_role/);
});

test('un horario publicado queda en solo lectura', () => {
  assert.match(ui, /currentDraftStatus\(\) === 'borrador'/);
  assert.match(ui, /Horario publicado abierto en modo de solo lectura/);
  assert.match(ui, /Este horario ya fue publicado y queda bloqueado para edición/);
  assert.match(ui, /\$\{editable \? '' : 'disabled'\}/);
  assert.match(engine, /No puedes editar un horario publicado/);
  assert.match(engine, /Solo se puede reorganizar un borrador/);
});

test('Fase 3 mantiene la barrera: el navegador no escribe turnos_programados', () => {
  assert.match(ui, /supabase\.functions\.invoke\('horario-engine'/);
  assert.doesNotMatch(ui, /from\(['"]turnos_programados['"]\)/);
  assert.doesNotMatch(ui, /rpc\(['"]horario_publicar_borrador['"]/);
});

test('edición y publicación conservan compatibilidad móvil', () => {
  assert.match(ui, /overflow-x-auto/);
  assert.match(ui, /min-w-max/);
  assert.match(ui, /sticky left-0/);
  assert.match(ui, /flex flex-wrap gap-2/);
});
