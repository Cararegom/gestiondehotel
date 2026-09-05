import {
  canManageMaintenancePlans,
  createMaintenancePlan,
  deleteMaintenancePlan,
  listMaintenancePlans,
  loadMaintenanceReferenceData,
  updateMaintenancePlan
} from './mantenimiento-repository.js';
import {
  MAINTENANCE_PLAN_CLASSES,
  RECURRENCE_PRESETS,
  addDaysIso,
  compareIsoDates,
  expandMaintenancePlanOccurrences,
  getDefaultReminderDays,
  getPlanClassLabel,
  getPlanRecurrenceLabel,
  getRecurrencePreset,
  normalizeReminderDays,
  recurrenceFromPreset
} from './mantenimiento-calendario-domain.js';
import { QUICK_MAINTENANCE_CATEGORIES } from './mantenimiento-quick-report.js';

let activeContainer = null;
let activeSupabase = null;
let activeUser = null;
let activeHotelId = null;
let plans = [];
let referenceData = { habitaciones: [], usuarios: [] };
let canManage = false;
let monthCursor = null;
let refreshInFlight = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseIsoDate(value) {
  const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function toIsoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function hotelTodayIso() {
  const timeZone = window.hotelConfigGlobal?.zona_horaria || 'America/Bogota';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function firstOfMonth(value) {
  const parsed = parseIsoDate(value) || parseIsoDate(hotelTodayIso());
  return toIsoDate(parsed.year, parsed.month, 1);
}

function shiftMonth(value, amount) {
  const parsed = parseIsoDate(value) || parseIsoDate(hotelTodayIso());
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1 + amount, 1));
  return toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function getMonthBounds(value) {
  const parsed = parseIsoDate(value) || parseIsoDate(hotelTodayIso());
  const first = toIsoDate(parsed.year, parsed.month, 1);
  const lastDay = new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate();
  const last = toIsoDate(parsed.year, parsed.month, lastDay);
  const firstWeekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const lastWeekday = new Date(`${last}T00:00:00Z`).getUTCDay();
  return {
    first,
    last,
    gridStart: addDaysIso(first, -firstWeekday),
    gridEnd: addDaysIso(last, 6 - lastWeekday)
  };
}

function formatMonthTitle(value) {
  const parsed = parseIsoDate(value) || parseIsoDate(hotelTodayIso());
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, 1));
  const label = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatShortDate(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) return '-';
  return `${String(parsed.day).padStart(2, '0')}/${String(parsed.month).padStart(2, '0')}/${parsed.year}`;
}

function getUserLabel(user) {
  return user?.nombre || user?.correo || user?.email || 'Usuario';
}

function getClassVisual(clase) {
  if (clase === MAINTENANCE_PLAN_CLASSES.vencimiento) {
    return { icon: '⏰', chip: 'border-red-200 bg-red-50 text-red-800', dot: 'bg-red-500' };
  }
  if (clase === MAINTENANCE_PLAN_CLASSES.preventivo) {
    return { icon: '🔄', chip: 'border-violet-200 bg-violet-50 text-violet-800', dot: 'bg-violet-500' };
  }
  return { icon: '🔧', chip: 'border-blue-200 bg-blue-50 text-blue-800', dot: 'bg-blue-500' };
}

function getPlanById(planId) {
  return plans.find((plan) => String(plan.id) === String(planId)) || null;
}

function getCalendarOccurrences(bounds) {
  return plans
    .filter((plan) => plan.activo !== false)
    .flatMap((plan) => expandMaintenancePlanOccurrences(plan, bounds.gridStart, bounds.gridEnd, 120))
    .sort((a, b) => compareIsoDates(a.date, b.date) || String(a.titulo).localeCompare(String(b.titulo), 'es'));
}

function getUpcomingOccurrences(days = 90) {
  const today = hotelTodayIso();
  const end = addDaysIso(today, days);
  return plans
    .filter((plan) => plan.activo !== false)
    .flatMap((plan) => expandMaintenancePlanOccurrences(plan, today, end, 30))
    .sort((a, b) => compareIsoDates(a.date, b.date) || String(a.titulo).localeCompare(String(b.titulo), 'es'))
    .slice(0, 10);
}

function ensureShell() {
  if (!activeContainer) return null;
  let shell = activeContainer.querySelector('#mant-calendar-shell');
  if (shell) return shell;

  shell = document.createElement('section');
  shell.id = 'mant-calendar-shell';
  shell.className = 'mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm';
  shell.innerHTML = '<p class="text-sm font-semibold text-slate-500">Cargando calendario de mantenimiento...</p>';

  const summary = activeContainer.querySelector('#mant-resumen');
  if (summary?.parentElement) summary.insertAdjacentElement('afterend', shell);
  else activeContainer.prepend(shell);
  return shell;
}

function renderCalendar() {
  const shell = ensureShell();
  if (!shell) return;
  if (!monthCursor) monthCursor = firstOfMonth(hotelTodayIso());

  const bounds = getMonthBounds(monthCursor);
  const occurrences = getCalendarOccurrences(bounds);
  const byDate = new Map();
  occurrences.forEach((item) => {
    const items = byDate.get(item.date) || [];
    items.push(item);
    byDate.set(item.date, items);
  });

  const days = [];
  let cursor = bounds.gridStart;
  let guard = 0;
  while (cursor && compareIsoDates(cursor, bounds.gridEnd) <= 0 && guard < 50) {
    days.push(cursor);
    cursor = addDaysIso(cursor, 1);
    guard += 1;
  }

  const upcoming = getUpcomingOccurrences(120);
  const activePlans = plans.filter((plan) => plan.activo !== false);
  const expirationCount = activePlans.filter((plan) => plan.clase === MAINTENANCE_PLAN_CLASSES.vencimiento).length;
  const preventiveCount = activePlans.filter((plan) => plan.clase === MAINTENANCE_PLAN_CLASSES.preventivo).length;
  const today = hotelTodayIso();

  shell.innerHTML = `
    <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="text-lg font-black text-slate-900">Calendario de mantenimiento</h3>
          <span class="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">Preventivos y vencimientos</span>
        </div>
        <p class="mt-1 text-xs text-slate-500">Programa una vez y el sistema conserva la fecha, la recurrencia y los avisos.</p>
      </div>
      ${canManage ? '<button type="button" id="mant-calendar-new" class="min-h-[44px] rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white">+ Programar tarea</button>' : ''}
    </div>

    <div class="mt-4 grid grid-cols-3 gap-2">
      <div class="rounded-xl border border-violet-200 bg-violet-50 p-3"><p class="text-[10px] font-bold uppercase text-violet-600">Preventivos</p><p class="mt-1 text-xl font-black text-violet-900">${preventiveCount}</p></div>
      <div class="rounded-xl border border-red-200 bg-red-50 p-3"><p class="text-[10px] font-bold uppercase text-red-600">Vencimientos</p><p class="mt-1 text-xl font-black text-red-900">${expirationCount}</p></div>
      <div class="rounded-xl border border-blue-200 bg-blue-50 p-3"><p class="text-[10px] font-bold uppercase text-blue-600">Activos</p><p class="mt-1 text-xl font-black text-blue-900">${activePlans.length}</p></div>
    </div>

    <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-1">
        <button type="button" id="mant-calendar-prev" class="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 bg-white text-lg font-black text-slate-700" aria-label="Mes anterior">‹</button>
        <button type="button" id="mant-calendar-today" class="min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700">Hoy</button>
        <button type="button" id="mant-calendar-next" class="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 bg-white text-lg font-black text-slate-700" aria-label="Mes siguiente">›</button>
      </div>
      <h4 class="text-base font-black text-slate-900">${escapeHtml(formatMonthTitle(monthCursor))}</h4>
    </div>

    <div class="mt-3 overflow-x-auto rounded-2xl border border-slate-200">
      <div class="min-w-[700px] bg-white">
        <div class="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-[11px] font-black uppercase tracking-wide text-slate-500">
          ${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((day) => `<div class="px-2 py-2">${day}</div>`).join('')}
        </div>
        <div class="grid grid-cols-7">
          ${days.map((date) => {
            const parsed = parseIsoDate(date);
            const inMonth = date.slice(0, 7) === monthCursor.slice(0, 7);
            const events = byDate.get(date) || [];
            const isToday = date === today;
            return `<button type="button" data-calendar-date="${date}" class="min-h-[108px] border-b border-r border-slate-100 p-2 text-left align-top ${inMonth ? 'bg-white' : 'bg-slate-50/70'} ${canManage ? 'hover:bg-blue-50/40' : ''}">
              <span class="inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-xs font-black ${isToday ? 'bg-slate-900 text-white' : (inMonth ? 'text-slate-700' : 'text-slate-400')}">${parsed?.day || ''}</span>
              <span class="mt-1 block space-y-1">
                ${events.slice(0, 3).map((event) => {
                  const visual = getClassVisual(event.clase);
                  return `<span role="button" tabindex="0" data-plan-id="${escapeHtml(event.planId || '')}" class="block truncate rounded-lg border px-1.5 py-1 text-[10px] font-bold ${visual.chip}" title="${escapeHtml(event.titulo)}">${visual.icon} ${escapeHtml(event.titulo)}</span>`;
                }).join('')}
                ${events.length > 3 ? `<span class="block px-1 text-[10px] font-bold text-slate-400">+${events.length - 3} más</span>` : ''}
              </span>
            </button>`;
          }).join('')}
        </div>
      </div>
    </div>

    <div class="mt-4 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
      <div class="rounded-2xl border border-slate-200 p-3">
        <div class="flex items-center justify-between gap-2"><div><h4 class="text-sm font-black text-slate-900">Próximos trabajos</h4><p class="text-xs text-slate-500">Siguientes 120 días.</p></div></div>
        <div class="mt-3 space-y-2">
          ${upcoming.length ? upcoming.map((item) => {
            const visual = getClassVisual(item.clase);
            const plan = getPlanById(item.planId);
            const responsible = referenceData.usuarios.find((user) => String(user.id) === String(plan?.asignada_a || ''));
            return `<button type="button" data-plan-id="${escapeHtml(item.planId || '')}" class="flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-left hover:border-slate-200">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${visual.chip}">${visual.icon}</span>
              <span class="min-w-0 flex-1"><span class="block truncate text-sm font-black text-slate-800">${escapeHtml(item.titulo)}</span><span class="mt-0.5 block truncate text-xs text-slate-500">${escapeHtml(item.ubicacion || 'Área general')}${responsible ? ` · ${escapeHtml(getUserLabel(responsible))}` : ''}</span></span>
              <span class="shrink-0 text-xs font-black text-slate-600">${escapeHtml(formatShortDate(item.date))}</span>
            </button>`;
          }).join('') : '<p class="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No hay trabajos programados en los próximos 120 días.</p>'}
        </div>
      </div>

      <div class="rounded-2xl border border-slate-200 p-3">
        <h4 class="text-sm font-black text-slate-900">Cómo se interpreta</h4>
        <div class="mt-3 space-y-2 text-xs text-slate-600">
          <p class="rounded-xl bg-blue-50 p-3"><strong class="text-blue-800">🔧 Tarea:</strong> una actividad para una fecha concreta.</p>
          <p class="rounded-xl bg-violet-50 p-3"><strong class="text-violet-800">🔄 Preventivo:</strong> se repite según la regla que definas.</p>
          <p class="rounded-xl bg-red-50 p-3"><strong class="text-red-800">⏰ Vencimiento:</strong> avisa antes de una fecha crítica.</p>
        </div>
        ${!canManage ? '<p class="mt-3 rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-500">Solo administración puede crear, modificar o pausar programaciones.</p>' : ''}
      </div>
    </div>`;

  bindCalendarEvents(shell);
}

function bindCalendarEvents(shell) {
  shell.querySelector('#mant-calendar-prev')?.addEventListener('click', () => {
    monthCursor = shiftMonth(monthCursor, -1);
    renderCalendar();
  });
  shell.querySelector('#mant-calendar-next')?.addEventListener('click', () => {
    monthCursor = shiftMonth(monthCursor, 1);
    renderCalendar();
  });
  shell.querySelector('#mant-calendar-today')?.addEventListener('click', () => {
    monthCursor = firstOfMonth(hotelTodayIso());
    renderCalendar();
  });
  shell.querySelector('#mant-calendar-new')?.addEventListener('click', () => showPlanModal(null, hotelTodayIso()));

  shell.querySelectorAll('[data-calendar-date]').forEach((dayButton) => {
    dayButton.addEventListener('click', (event) => {
      const planTarget = event.target.closest?.('[data-plan-id]');
      if (planTarget?.dataset.planId) {
        event.preventDefault();
        event.stopPropagation();
        showPlanModal(getPlanById(planTarget.dataset.planId), null);
        return;
      }
      if (canManage) showPlanModal(null, dayButton.dataset.calendarDate);
    });
  });

  shell.querySelectorAll('[data-plan-id]').forEach((button) => {
    if (button.closest('[data-calendar-date]')) return;
    button.addEventListener('click', () => {
      const plan = getPlanById(button.dataset.planId);
      if (plan) showPlanModal(plan, null);
    });
  });
}

function getModalTarget() {
  return activeContainer?.querySelector('#mant-modal') || activeContainer;
}

function renderReminderOptions(selectedDays) {
  const selected = new Set(normalizeReminderDays(selectedDays));
  const options = [30, 15, 7, 1, 0];
  return options.map((days) => {
    const label = days === 0 ? 'El mismo día' : `${days} día${days === 1 ? '' : 's'} antes`;
    return `<label class="flex min-h-[42px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"><input type="checkbox" name="recordatorio" value="${days}" ${selected.has(days) ? 'checked' : ''}> ${label}</label>`;
  }).join('');
}

function checklistToText(checklist) {
  if (!Array.isArray(checklist)) return '';
  return checklist.map((item) => typeof item === 'string' ? item : item?.texto).filter(Boolean).join('\n');
}

function getDefaultPresetForClass(planClass) {
  if (planClass === MAINTENANCE_PLAN_CLASSES.preventivo) return 'semanal';
  return 'ninguna';
}

function showPlanModal(plan = null, seedDate = null) {
  if (!activeContainer) return;
  if (plan && !canManage) return;
  if (!plan && !canManage) return;

  const target = getModalTarget();
  if (!target) return;
  const isEditing = Boolean(plan?.id);
  const planClass = plan?.clase || MAINTENANCE_PLAN_CLASSES.tarea;
  const date = String(plan?.fecha_inicio || seedDate || hotelTodayIso()).slice(0, 10);
  const preset = plan ? getRecurrencePreset(plan) : getDefaultPresetForClass(planClass);
  const reminderDays = plan?.anticipaciones_dias || getDefaultReminderDays(planClass);
  const activeUsers = referenceData.usuarios.filter((user) => user.activo !== false);

  target.innerHTML = `
    <div class="fixed inset-0 z-[270] overflow-y-auto bg-black/55 p-3 sm:p-5">
      <div class="mx-auto max-w-3xl">
        <div class="relative rounded-3xl bg-white shadow-2xl">
          <button type="button" id="mant-plan-close" class="absolute right-4 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-2xl text-slate-500">&times;</button>
          <form id="mant-plan-form" class="space-y-4 p-5 sm:p-6">
            <div class="pr-12">
              <p class="text-xs font-bold uppercase tracking-[0.16em] text-violet-600">Calendario de mantenimiento</p>
              <h3 class="text-2xl font-black text-slate-900">${isEditing ? 'Editar programación' : 'Programar tarea'}</h3>
              <p class="mt-1 text-sm text-slate-500">La fecha se conserva aunque el trabajo se complete tarde.</p>
            </div>

            <div class="grid gap-3 sm:grid-cols-3">
              <div><label class="mb-1 block text-sm font-bold">Tipo</label><select name="clase" id="mant-plan-class" class="form-control w-full rounded-xl"><option value="tarea" ${planClass === 'tarea' ? 'selected' : ''}>🔧 Tarea puntual</option><option value="preventivo" ${planClass === 'preventivo' ? 'selected' : ''}>🔄 Preventivo</option><option value="vencimiento" ${planClass === 'vencimiento' ? 'selected' : ''}>⏰ Vencimiento</option></select></div>
              <div class="sm:col-span-2"><label class="mb-1 block text-sm font-bold">Título <span class="text-red-500">*</span></label><input name="titulo" required maxlength="180" class="form-control w-full rounded-xl" value="${escapeHtml(plan?.titulo || '')}" placeholder="Ej. Revisar rejillas de los aires"></div>
            </div>

            <div><label class="mb-1 block text-sm font-bold">Descripción</label><textarea name="descripcion" class="form-control min-h-[82px] w-full rounded-xl" placeholder="Qué debe revisar o cambiar el encargado">${escapeHtml(plan?.descripcion || '')}</textarea></div>

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><label class="mb-1 block text-sm font-bold">Ubicación</label><input name="ubicacion" maxlength="160" class="form-control w-full rounded-xl" value="${escapeHtml(plan?.ubicacion || '')}" placeholder="Recepción, terraza, tanque..."></div>
              <div><label class="mb-1 block text-sm font-bold">Habitación</label><select name="habitacion_id" class="form-control w-full rounded-xl"><option value="">Área general</option>${referenceData.habitaciones.map((room) => `<option value="${room.id}" ${String(plan?.habitacion_id || '') === String(room.id) ? 'selected' : ''}>${escapeHtml(room.nombre)}</option>`).join('')}</select></div>
              <div><label class="mb-1 block text-sm font-bold">Responsable</label><select name="asignada_a" class="form-control w-full rounded-xl"><option value="">Sin asignar</option>${activeUsers.map((user) => `<option value="${user.id}" ${String(plan?.asignada_a || '') === String(user.id) ? 'selected' : ''}>${escapeHtml(getUserLabel(user))}${user.rol ? ` · ${escapeHtml(user.rol)}` : ''}</option>`).join('')}</select></div>
              <div><label class="mb-1 block text-sm font-bold">Prioridad</label><select name="prioridad" class="form-control w-full rounded-xl"><option value="0" ${Number(plan?.prioridad) === 0 ? 'selected' : ''}>Baja</option><option value="1" ${Number(plan?.prioridad ?? 1) === 1 ? 'selected' : ''}>Media</option><option value="2" ${Number(plan?.prioridad) === 2 ? 'selected' : ''}>Alta</option><option value="3" ${Number(plan?.prioridad) === 3 ? 'selected' : ''}>Urgente</option></select></div>
            </div>

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><label class="mb-1 block text-sm font-bold">Categoría</label><select name="categoria_mantenimiento" class="form-control w-full rounded-xl">${QUICK_MAINTENANCE_CATEGORIES.map((category) => `<option value="${category.id}" ${String(plan?.categoria_mantenimiento || 'general') === String(category.id) ? 'selected' : ''}>${category.icon} ${escapeHtml(category.label)}</option>`).join('')}</select></div>
              <div><label class="mb-1 block text-sm font-bold">Fecha</label><input name="fecha_inicio" required type="date" class="form-control w-full rounded-xl" value="${escapeHtml(date)}"></div>
              <div><label class="mb-1 block text-sm font-bold">Hora <span class="font-normal text-slate-400">(opcional)</span></label><input name="hora_programada" type="time" class="form-control w-full rounded-xl" value="${escapeHtml(String(plan?.hora_programada || '').slice(0, 5))}"></div>
              <div><label class="mb-1 block text-sm font-bold">Repetición</label><select name="recurrence_preset" id="mant-plan-recurrence" class="form-control w-full rounded-xl">${RECURRENCE_PRESETS.map((item) => `<option value="${item.id}" ${preset === item.id ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></div>
            </div>

            <div id="mant-plan-custom-recurrence" class="grid gap-3 rounded-2xl border border-violet-100 bg-violet-50 p-3 sm:grid-cols-3 ${preset === 'personalizada' ? '' : 'hidden'}">
              <div><label class="mb-1 block text-sm font-bold text-violet-900">Cada</label><input name="custom_interval" type="number" min="1" max="365" class="form-control w-full rounded-xl" value="${Number(plan?.recurrencia_intervalo || 1)}"></div>
              <div><label class="mb-1 block text-sm font-bold text-violet-900">Unidad</label><select name="custom_unit" class="form-control w-full rounded-xl"><option value="dia" ${plan?.recurrencia_unidad === 'dia' ? 'selected' : ''}>Días</option><option value="semana" ${plan?.recurrencia_unidad === 'semana' ? 'selected' : ''}>Semanas</option><option value="mes" ${plan?.recurrencia_unidad === 'mes' ? 'selected' : ''}>Meses</option><option value="anio" ${plan?.recurrencia_unidad === 'anio' ? 'selected' : ''}>Años</option></select></div>
              <div><label class="mb-1 block text-sm font-bold text-violet-900">Termina <span class="font-normal text-violet-500">(opcional)</span></label><input name="fecha_fin_custom" type="date" class="form-control w-full rounded-xl" value="${escapeHtml(String(plan?.fecha_fin || '').slice(0, 10))}"></div>
            </div>

            <div id="mant-plan-repeat-end" class="${preset !== 'ninguna' && preset !== 'personalizada' ? '' : 'hidden'}"><label class="mb-1 block text-sm font-bold">Terminar repetición <span class="font-normal text-slate-400">(opcional)</span></label><input name="fecha_fin" type="date" class="form-control w-full max-w-xs rounded-xl" value="${escapeHtml(String(plan?.fecha_fin || '').slice(0, 10))}"></div>

            <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div class="flex flex-wrap items-center justify-between gap-2"><div><p class="text-sm font-black text-slate-800">Recordatorios</p><p class="text-xs text-slate-500">Administración y mantenimiento recibirán el aviso.</p></div><span id="mant-plan-reminder-hint" class="text-xs font-bold text-slate-500"></span></div>
              <div id="mant-plan-reminders" class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">${renderReminderOptions(reminderDays)}</div>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <label class="flex min-h-[48px] items-center gap-3 rounded-2xl border border-slate-200 p-3"><input type="checkbox" name="requiere_evidencia" ${plan?.requiere_evidencia ? 'checked' : ''}><span><span class="block text-sm font-black text-slate-800">Exigir evidencia</span><span class="block text-xs text-slate-500">Foto o archivo al ejecutar.</span></span></label>
              ${isEditing ? `<label class="flex min-h-[48px] items-center gap-3 rounded-2xl border border-slate-200 p-3"><input type="checkbox" name="activo" ${plan?.activo !== false ? 'checked' : ''}><span><span class="block text-sm font-black text-slate-800">Programación activa</span><span class="block text-xs text-slate-500">Desmárcala para pausarla sin borrar historial.</span></span></label>` : ''}
            </div>

            <div><label class="mb-1 block text-sm font-bold">Checklist <span class="font-normal text-slate-400">(una revisión por línea)</span></label><textarea name="checklist" class="form-control min-h-[100px] w-full rounded-xl" placeholder="Revisar rejilla\nLimpiar filtro\nVerificar que enfríe">${escapeHtml(checklistToText(plan?.checklist))}</textarea></div>

            <div id="mant-plan-error" class="hidden rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700"></div>
            <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <div>${isEditing ? '<button type="button" id="mant-plan-delete" class="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-black text-red-700">Eliminar programación</button>' : ''}</div>
              <div class="flex gap-2"><button type="button" id="mant-plan-cancel" class="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700">Cancelar</button><button type="submit" id="mant-plan-submit" class="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-black text-white">${isEditing ? 'Guardar cambios' : 'Guardar programación'}</button></div>
            </div>
          </form>
        </div>
      </div>
    </div>`;

  const form = target.querySelector('#mant-plan-form');
  const recurrenceSelect = target.querySelector('#mant-plan-recurrence');
  const customBlock = target.querySelector('#mant-plan-custom-recurrence');
  const repeatEnd = target.querySelector('#mant-plan-repeat-end');
  const classSelect = target.querySelector('#mant-plan-class');
  const errorTarget = target.querySelector('#mant-plan-error');

  const close = () => { target.innerHTML = ''; };
  target.querySelector('#mant-plan-close')?.addEventListener('click', close);
  target.querySelector('#mant-plan-cancel')?.addEventListener('click', close);

  const syncRecurrence = () => {
    const value = recurrenceSelect?.value || 'ninguna';
    customBlock?.classList.toggle('hidden', value !== 'personalizada');
    repeatEnd?.classList.toggle('hidden', value === 'ninguna' || value === 'personalizada');
  };
  recurrenceSelect?.addEventListener('change', syncRecurrence);
  syncRecurrence();

  if (!isEditing) {
    classSelect?.addEventListener('change', () => {
      const nextClass = classSelect.value;
      const nextPreset = getDefaultPresetForClass(nextClass);
      if (recurrenceSelect) recurrenceSelect.value = nextPreset;
      const reminders = target.querySelector('#mant-plan-reminders');
      if (reminders) reminders.innerHTML = renderReminderOptions(getDefaultReminderDays(nextClass));
      syncRecurrence();
    });
  }

  target.querySelector('#mant-plan-delete')?.addEventListener('click', async () => {
    if (!plan?.id || !window.confirm(`¿Eliminar la programación “${plan.titulo}”? Las tareas ya ejecutadas conservarán su historial.`)) return;
    const button = target.querySelector('#mant-plan-delete');
    if (button) button.disabled = true;
    try {
      await deleteMaintenancePlan(activeSupabase, activeHotelId, plan.id);
      close();
      await refreshMaintenanceCalendar(true);
      document.dispatchEvent(new CustomEvent('maintenanceChanged', { detail: { source: 'maintenance-calendar-plan-delete', planId: plan.id } }));
    } catch (error) {
      if (errorTarget) { errorTarget.textContent = error?.message || 'No se pudo eliminar la programación.'; errorTarget.classList.remove('hidden'); }
      if (button) button.disabled = false;
    }
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = target.querySelector('#mant-plan-submit');
    if (submit?.disabled) return;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    const title = String(data.titulo || '').trim();
    if (!title) return;

    const recurrence = recurrenceFromPreset(
      data.recurrence_preset,
      data.custom_unit,
      data.custom_interval
    );
    const selectedReminderDays = [...form.querySelectorAll('input[name="recordatorio"]:checked')]
      .map((input) => Number(input.value));
    const checklist = String(data.checklist || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 50)
      .map((texto, index) => ({ id: `item_${index + 1}`, texto, obligatorio: true }));
    const fechaFin = data.recurrence_preset === 'personalizada' ? data.fecha_fin_custom : data.fecha_fin;

    const payload = {
      clase: data.clase || 'tarea',
      titulo: title,
      descripcion: String(data.descripcion || '').trim() || null,
      ubicacion: String(data.ubicacion || '').trim() || null,
      categoria_mantenimiento: data.categoria_mantenimiento || 'general',
      prioridad: Number(data.prioridad || 0),
      habitacion_id: data.habitacion_id || null,
      asignada_a: data.asignada_a || null,
      fecha_inicio: data.fecha_inicio,
      hora_programada: data.hora_programada || null,
      recurrencia_unidad: recurrence.unit,
      recurrencia_intervalo: recurrence.interval,
      fecha_fin: recurrence.unit === 'ninguna' ? null : (fechaFin || null),
      anticipaciones_dias: normalizeReminderDays(selectedReminderDays, getDefaultReminderDays(data.clase)),
      requiere_evidencia: form.elements.requiere_evidencia?.checked === true,
      checklist
    };
    if (isEditing) payload.activo = form.elements.activo?.checked !== false;
    else payload.creada_por = activeUser?.id || null;

    if (submit) { submit.disabled = true; submit.textContent = 'Guardando...'; }
    errorTarget?.classList.add('hidden');
    try {
      const saved = isEditing
        ? await updateMaintenancePlan(activeSupabase, activeHotelId, plan.id, payload)
        : await createMaintenancePlan(activeSupabase, activeHotelId, payload);
      close();
      await refreshMaintenanceCalendar(true);
      document.dispatchEvent(new CustomEvent('maintenanceChanged', { detail: { source: 'maintenance-calendar-plan-save', planId: saved.id } }));
    } catch (error) {
      if (errorTarget) { errorTarget.textContent = error?.message || 'No se pudo guardar la programación.'; errorTarget.classList.remove('hidden'); }
      if (submit) { submit.disabled = false; submit.textContent = isEditing ? 'Guardar cambios' : 'Guardar programación'; }
    }
  });
}

export async function refreshMaintenanceCalendar(force = false) {
  if (!activeContainer || !activeSupabase || !activeHotelId) return;
  if (refreshInFlight && !force) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      plans = await listMaintenancePlans(activeSupabase, activeHotelId);
      renderCalendar();
    } catch (error) {
      console.error('Error cargando calendario de mantenimiento:', error);
      const shell = ensureShell();
      if (shell) shell.innerHTML = `<div class="rounded-xl border border-red-200 bg-red-50 p-3"><p class="text-sm font-black text-red-800">No se pudo cargar el calendario.</p><p class="mt-1 text-xs text-red-700">${escapeHtml(error?.message || 'Error desconocido')}</p></div>`;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function mountMaintenanceCalendar(container, supabase, currentUser, hotelId) {
  activeContainer = container;
  activeSupabase = supabase;
  activeUser = currentUser;
  activeHotelId = hotelId;
  monthCursor = firstOfMonth(hotelTodayIso());

  ensureShell();
  const [refs, permission] = await Promise.all([
    loadMaintenanceReferenceData(supabase, hotelId),
    canManageMaintenancePlans(supabase, hotelId, currentUser)
  ]);
  referenceData = refs;
  canManage = permission;
  await refreshMaintenanceCalendar(true);
}

export function unmountMaintenanceCalendar() {
  activeContainer?.querySelector('#mant-calendar-shell')?.remove();
  activeContainer = null;
  activeSupabase = null;
  activeUser = null;
  activeHotelId = null;
  plans = [];
  referenceData = { habitaciones: [], usuarios: [] };
  canManage = false;
  monthCursor = null;
  refreshInFlight = null;
}
