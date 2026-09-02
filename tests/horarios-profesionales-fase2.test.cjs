const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('js/modules/usuarios/horarios-profesionales.js', 'utf8');
const hook = fs.readFileSync('js/services/permissionTemplateService.js', 'utf8');

test('la interfaz profesional base permanece disponible y el punto activo pertenece a horarios profesionales', () => {
  assert.match(hook, /import '\.\.\/modules\/usuarios\/horarios-profesionales(?:-fase\d+)?\.js';/);
  assert.match(ui, /horarios-profesionales-root/);
  assert.match(ui, /MutationObserver/);
});

test('la Fase 2 oculta la edición directa del horario legado', () => {
  assert.match(ui, /configuracion-global-turnos-container/);
  assert.match(ui, /horario-turnos-semanal/);
  assert.match(ui, /legacyConfig\.style\.display = 'none'/);
  assert.match(ui, /legacySchedule\.style\.display = 'none'/);
});

test('la nueva UI trabaja con horario-engine y nunca escribe turnos_programados directamente', () => {
  assert.match(ui, /supabase\.functions\.invoke\('horario-engine'/);
  assert.match(ui, /invokeEngine\('setup'/);
  assert.match(ui, /invokeEngine\('save_config'/);
  assert.match(ui, /invokeEngine\('save_templates'/);
  assert.match(ui, /invokeEngine\('generate'/);
  assert.match(ui, /invokeEngine\('get_draft'/);
  assert.doesNotMatch(ui, /from\(['"]turnos_programados['"]\)/);
});

test('permite configurar modalidad 8 y 12 horas y las horas reales de cada turno', () => {
  assert.match(ui, /<option value="12"/);
  assert.match(ui, /<option value="8"/);
  assert.match(ui, /data-template-start/);
  assert.match(ui, /data-template-end/);
  assert.match(ui, /Guardar horas/);
});

test('permite generar semana, mes o un rango personalizado de hasta 63 días', () => {
  assert.match(ui, /Esta semana/);
  assert.match(ui, /Este mes/);
  assert.match(ui, /data-period-start/);
  assert.match(ui, /data-period-end/);
  assert.match(ui, /63 días/);
});

test('solo genera con el equipo seleccionado y exige mínimo dos recepcionistas', () => {
  assert.match(ui, /data-user-checkbox/);
  assert.match(ui, /state\.selectedUsers\.size < 2/);
  assert.match(ui, /Selecciona al menos 2 recepcionistas/);
  assert.match(ui, /usuario_ids: \[\.\.\.state\.selectedUsers\]/);
});

test('el calendario de Fase 2 es de revisión y el archivo base no publica directamente', () => {
  assert.match(ui, /Borrador de horario/);
  assert.match(ui, /no está publicado/);
  assert.match(ui, /La edición, bloqueo y botón Reorganizar se habilitan en la siguiente fase/);
  assert.doesNotMatch(ui, /data-action="publish"/);
  assert.doesNotMatch(ui, /data-action="reorganize"/);
  assert.doesNotMatch(ui, /data-action="update-assignment"/);
});

test('muestra calidad, conflictos y advertencias del motor', () => {
  assert.match(ui, /Validación del borrador/);
  assert.match(ui, /validation\.conflictos/);
  assert.match(ui, /validation\.advertencias/);
  assert.match(ui, /Calidad/);
});

test('la cuadrícula mensual mantiene compatibilidad móvil mediante scroll horizontal', () => {
  assert.match(ui, /overflow-x-auto/);
  assert.match(ui, /min-w-max/);
  assert.match(ui, /sticky left-0/);
});
