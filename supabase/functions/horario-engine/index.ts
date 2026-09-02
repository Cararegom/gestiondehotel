import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.111.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

type ShiftTemplate = {
  id: string;
  hotel_id: string;
  codigo: string;
  nombre: string;
  hora_inicio: string;
  hora_fin: string;
  duracion_minutos: number;
  es_nocturno: boolean;
  es_extendido: boolean;
  grupo: "normal" | "extendido";
  activo: boolean;
  orden: number;
};

type ScheduleConfig = {
  hotel_id: string;
  modalidad: 8 | 12;
  zona_horaria: string;
  descanso_minimo_horas: number;
  descansos_minimos_semana: number;
  max_turnos_consecutivos: number;
  max_noches_consecutivas: number;
  equilibrar_noches: boolean;
  equilibrar_fines_semana: boolean;
  permitir_turnos_extendidos: boolean;
  publicar_requiere_sin_conflictos: boolean;
};

type Receptionist = {
  id: string;
  nombre: string;
  evitaNoche: boolean;
  prefiereDia: boolean;
};

type ScheduleRequest = {
  id: string;
  usuario_id: string;
  fecha_inicio: string;
  fecha_fin: string;
  tipo: "no_disponible" | "descanso" | "turno_fijo" | "preferir_turno" | "evitar_turno";
  plantilla_turno_id: string | null;
  obligatorio: boolean;
  motivo: string | null;
};

type DraftAssignment = {
  id?: string;
  borrador_id?: string;
  hotel_id: string;
  fecha: string;
  usuario_id: string;
  plantilla_turno_id: string | null;
  tipo_turno: string;
  bloqueado: boolean;
  origen: "auto" | "manual" | "solicitud";
  motivo: Record<string, unknown>;
};

type ValidationIssue = {
  codigo: string;
  mensaje: string;
  fecha?: string;
  usuario_id?: string;
  usuario?: string;
  severidad: "conflicto" | "advertencia";
};

type UserStats = {
  total: number;
  noches: number;
  finesSemana: number;
  consecutivos: number;
  nochesConsecutivas: number;
  ultimoTrabajo: { fecha: string; finAbsoluto: number; nocturno: boolean } | null;
  trabajoSemana: Map<string, number>;
};

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function roleNames(profile: any): string[] {
  return (profile?.usuarios_roles ?? [])
    .map((item: any) => item?.roles?.nombre)
    .filter(Boolean)
    .map(normalize);
}

function isAdmin(profile: any) {
  const direct = normalize(profile?.rol);
  const assigned = roleNames(profile);
  return profile?.activo === true && (
    direct === "admin" || direct === "administrador" || direct === "superadmin" ||
    assigned.includes("admin") || assigned.includes("administrador") || assigned.includes("superadmin")
  );
}

function isSuperadmin(profile: any) {
  return normalize(profile?.rol) === "superadmin" || roleNames(profile).includes("superadmin");
}

function parseDate(value: unknown) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Fecha inválida.");
  return text;
}

function dateToUtc(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

function addDays(date: string, amount: number) {
  const d = dateToUtc(date);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string) {
  return Math.round((dateToUtc(end).getTime() - dateToUtc(start).getTime()) / 86400000);
}

function enumerateDates(start: string, end: string) {
  const length = daysBetween(start, end) + 1;
  if (length < 1 || length > 63) throw new Error("El horario debe cubrir entre 1 y 63 días.");
  return Array.from({ length }, (_, index) => addDays(start, index));
}

function weekKey(date: string) {
  const d = dateToUtc(date);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function weekdayMondayZero(date: string) {
  return (dateToUtc(date).getUTCDay() + 6) % 7;
}

function isWeekend(date: string) {
  const day = dateToUtc(date).getUTCDay();
  return day === 0 || day === 6;
}

function timeMinutes(value: string) {
  const [h, m] = String(value || "00:00").split(":").map(Number);
  return h * 60 + m;
}

function intervalFor(startDate: string, scheduleStart: string, shift: ShiftTemplate) {
  const dayOffset = daysBetween(scheduleStart, startDate);
  const start = dayOffset * 1440 + timeMinutes(shift.hora_inicio);
  return { start, end: start + Number(shift.duracion_minutos || 0) };
}

function dateInRange(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

function requestForDate(requests: ScheduleRequest[], userId: string, date: string) {
  return requests.filter((item) => item.usuario_id === userId && dateInRange(date, item.fecha_inicio, item.fecha_fin));
}

function shiftForAssignment(assignment: DraftAssignment, templateById: Map<string, ShiftTemplate>) {
  return assignment.plantilla_turno_id ? templateById.get(assignment.plantilla_turno_id) ?? null : null;
}

function hasMandatoryOff(requests: ScheduleRequest[]) {
  return requests.some((item) => item.obligatorio && (item.tipo === "descanso" || item.tipo === "no_disponible"));
}

function mandatoryFixed(requests: ScheduleRequest[]) {
  return requests.find((item) => item.obligatorio && item.tipo === "turno_fijo" && item.plantilla_turno_id) ?? null;
}

function templateCodes(items: ShiftTemplate[]) {
  return items.map((item) => item.codigo).sort().join("|");
}

function evenlyDistributedWeekdays(count: number) {
  if (count <= 0) return new Set<number>();
  const result = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    result.add(Math.min(6, Math.floor(((i + 1) * 7) / (count + 1))));
  }
  return result;
}

async function getActor(req: Request, admin: SupabaseClient) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile, error: profileError } = await admin
    .from("usuarios")
    .select("id, hotel_id, activo, rol, usuarios_roles(roles(nombre))")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile || !isAdmin(profile)) return null;
  return { user: data.user, profile };
}

async function ensureSetup(admin: SupabaseClient, hotelId: string) {
  let { data: config, error: configError } = await admin
    .from("horario_configuracion")
    .select("*")
    .eq("hotel_id", hotelId)
    .maybeSingle();
  if (configError) throw configError;

  if (!config) {
    const { data: legacy } = await admin
      .from("configuracion_hotel")
      .select("tipo_turno_global")
      .eq("hotel_id", hotelId)
      .maybeSingle();
    const modalidad = Number(legacy?.tipo_turno_global) === 8 ? 8 : 12;
    const inserted = await admin
      .from("horario_configuracion")
      .insert({ hotel_id: hotelId, modalidad })
      .select("*")
      .single();
    if (inserted.error) throw inserted.error;
    config = inserted.data;
  }

  const typedConfig = { ...config, modalidad: Number(config.modalidad) as 8 | 12 } as ScheduleConfig;
  const { data: existing, error: templateError } = await admin
    .from("horario_plantillas_turno")
    .select("*")
    .eq("hotel_id", hotelId)
    .eq("activo", true)
    .order("orden");
  if (templateError) throw templateError;

  let templates = (existing || []) as ShiftTemplate[];
  const normalCount = templates.filter((item) => item.grupo === "normal").length;
  if (normalCount === 0) {
    const defaults = typedConfig.modalidad === 8
      ? [
          { codigo: "manana", nombre: "Mañana", hora_inicio: "07:00", hora_fin: "15:00", duracion_minutos: 480, es_nocturno: false, es_extendido: false, grupo: "normal", orden: 10 },
          { codigo: "tarde", nombre: "Tarde", hora_inicio: "15:00", hora_fin: "23:00", duracion_minutos: 480, es_nocturno: false, es_extendido: false, grupo: "normal", orden: 20 },
          { codigo: "noche", nombre: "Noche", hora_inicio: "23:00", hora_fin: "07:00", duracion_minutos: 480, es_nocturno: true, es_extendido: false, grupo: "normal", orden: 30 },
          { codigo: "dia_ext", nombre: "Día 12h", hora_inicio: "07:00", hora_fin: "19:00", duracion_minutos: 720, es_nocturno: false, es_extendido: true, grupo: "extendido", orden: 110 },
          { codigo: "noche_ext", nombre: "Noche 12h", hora_inicio: "19:00", hora_fin: "07:00", duracion_minutos: 720, es_nocturno: true, es_extendido: true, grupo: "extendido", orden: 120 },
        ]
      : [
          { codigo: "dia", nombre: "Día", hora_inicio: "07:00", hora_fin: "19:00", duracion_minutos: 720, es_nocturno: false, es_extendido: false, grupo: "normal", orden: 10 },
          { codigo: "noche", nombre: "Noche", hora_inicio: "19:00", hora_fin: "07:00", duracion_minutos: 720, es_nocturno: true, es_extendido: false, grupo: "normal", orden: 20 },
        ];
    const { data: created, error } = await admin
      .from("horario_plantillas_turno")
      .insert(defaults.map((item) => ({ ...item, hotel_id: hotelId })))
      .select("*");
    if (error) throw error;
    templates = created as ShiftTemplate[];
  }

  return { config: typedConfig, templates };
}

async function loadReceptionists(admin: SupabaseClient, hotelId: string, selectedIds?: string[]) {
  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .ilike("nombre", "Recepcionista")
    .limit(1)
    .maybeSingle();
  if (roleError) throw roleError;
  if (!role) throw new Error("No existe el rol Recepcionista.");

  const { data: links, error: linksError } = await admin
    .from("usuarios_roles")
    .select("usuario_id")
    .eq("hotel_id", hotelId)
    .eq("rol_id", role.id);
  if (linksError) throw linksError;
  let ids = [...new Set((links || []).map((item: any) => item.usuario_id).filter(Boolean))];
  if (selectedIds?.length) {
    const allowed = new Set(ids);
    const invalid = selectedIds.filter((id) => !allowed.has(id));
    if (invalid.length) throw new Error("Hay usuarios seleccionados que no tienen rol Recepcionista.");
    ids = ids.filter((id) => selectedIds.includes(id));
  }
  if (!ids.length) return [];

  const { data: users, error: usersError } = await admin
    .from("usuarios")
    .select("id, nombre, activo")
    .eq("hotel_id", hotelId)
    .eq("activo", true)
    .in("id", ids)
    .order("nombre");
  if (usersError) throw usersError;

  const activeIds = (users || []).map((item: any) => item.id);
  const { data: preferences } = activeIds.length
    ? await admin
        .from("configuracion_turnos")
        .select("usuario_id, evita_turno_noche, prefiere_turno_dia, creado_en")
        .eq("hotel_id", hotelId)
        .eq("activo", true)
        .in("usuario_id", activeIds)
        .order("creado_en", { ascending: false })
    : { data: [] as any[] };

  const preferenceByUser = new Map<string, any>();
  for (const pref of preferences || []) {
    if (!preferenceByUser.has(pref.usuario_id)) preferenceByUser.set(pref.usuario_id, pref);
  }

  return (users || []).map((user: any) => {
    const pref = preferenceByUser.get(user.id);
    return {
      id: user.id,
      nombre: user.nombre || "Sin nombre",
      evitaNoche: pref?.evita_turno_noche === true,
      prefiereDia: pref?.prefiere_turno_dia === true,
    } satisfies Receptionist;
  });
}

async function loadRequests(admin: SupabaseClient, hotelId: string, userIds: string[], start: string, end: string) {
  if (!userIds.length) return [];
  const { data, error } = await admin
    .from("horario_solicitudes")
    .select("id, usuario_id, fecha_inicio, fecha_fin, tipo, plantilla_turno_id, obligatorio, motivo")
    .eq("hotel_id", hotelId)
    .eq("activo", true)
    .in("usuario_id", userIds)
    .lte("fecha_inicio", end)
    .gte("fecha_fin", start);
  if (error) throw error;
  return (data || []) as ScheduleRequest[];
}

async function loadPreviousPublished(admin: SupabaseClient, hotelId: string, userIds: string[], start: string) {
  if (!userIds.length) return [];
  const { data, error } = await admin
    .from("turnos_programados")
    .select("fecha, usuario_id, tipo_turno, plantilla_turno_id")
    .eq("hotel_id", hotelId)
    .in("usuario_id", userIds)
    .gte("fecha", addDays(start, -7))
    .lt("fecha", start)
    .order("fecha");
  if (error) throw error;
  return data || [];
}

function initialStats(users: Receptionist[]) {
  const map = new Map<string, UserStats>();
  for (const user of users) {
    map.set(user.id, {
      total: 0,
      noches: 0,
      finesSemana: 0,
      consecutivos: 0,
      nochesConsecutivas: 0,
      ultimoTrabajo: null,
      trabajoSemana: new Map(),
    });
  }
  return map;
}

function applyHistoryToStats(
  stats: Map<string, UserStats>,
  previous: any[],
  templateById: Map<string, ShiftTemplate>,
  templateByCode: Map<string, ShiftTemplate>,
  scheduleStart: string,
) {
  for (const row of previous) {
    const stat = stats.get(row.usuario_id);
    if (!stat) continue;
    if (row.tipo_turno === "descanso") {
      stat.consecutivos = 0;
      stat.nochesConsecutivas = 0;
      continue;
    }
    const shift = (row.plantilla_turno_id && templateById.get(row.plantilla_turno_id)) || templateByCode.get(row.tipo_turno);
    if (!shift) continue;
    const interval = intervalFor(row.fecha, scheduleStart, shift);
    stat.ultimoTrabajo = { fecha: row.fecha, finAbsoluto: interval.end, nocturno: shift.es_nocturno };
    stat.consecutivos += 1;
    stat.nochesConsecutivas = shift.es_nocturno ? stat.nochesConsecutivas + 1 : 0;
  }
}

function hardEligible(
  user: Receptionist,
  shift: ShiftTemplate,
  date: string,
  scheduleStart: string,
  requests: ScheduleRequest[],
  stat: UserStats,
  config: ScheduleConfig,
) {
  const userRequests = requestForDate(requests, user.id, date);
  if (hasMandatoryOff(userRequests)) return false;
  const fixed = mandatoryFixed(userRequests);
  if (fixed && fixed.plantilla_turno_id !== shift.id) return false;
  if (userRequests.some((item) => item.obligatorio && item.tipo === "evitar_turno" && item.plantilla_turno_id === shift.id)) return false;

  const interval = intervalFor(date, scheduleStart, shift);
  if (stat.ultimoTrabajo) {
    const restMinutes = interval.start - stat.ultimoTrabajo.finAbsoluto;
    if (restMinutes < Number(config.descanso_minimo_horas) * 60) return false;
    if (stat.ultimoTrabajo.nocturno && daysBetween(stat.ultimoTrabajo.fecha, date) === 1 && !shift.es_nocturno) return false;
  }
  if (stat.consecutivos >= Number(config.max_turnos_consecutivos)) return false;
  if (shift.es_nocturno && stat.nochesConsecutivas >= Number(config.max_noches_consecutivas)) return false;
  return true;
}

function candidateScore(
  user: Receptionist,
  shift: ShiftTemplate,
  date: string,
  requests: ScheduleRequest[],
  stat: UserStats,
  config: ScheduleConfig,
) {
  let score = stat.total * 4 + (stat.trabajoSemana.get(weekKey(date)) || 0) * 6;
  if (shift.es_nocturno && config.equilibrar_noches) score += stat.noches * 7;
  if (isWeekend(date) && config.equilibrar_fines_semana) score += stat.finesSemana * 4;
  if (shift.es_nocturno && user.evitaNoche) score += 35;
  if (shift.es_nocturno && user.prefiereDia) score += 15;

  for (const request of requestForDate(requests, user.id, date)) {
    if (request.tipo === "preferir_turno" && request.plantilla_turno_id === shift.id) score -= request.obligatorio ? 100 : 30;
    if (request.tipo === "evitar_turno" && request.plantilla_turno_id === shift.id) score += request.obligatorio ? 1000 : 45;
    if (!request.obligatorio && (request.tipo === "descanso" || request.tipo === "no_disponible")) score += 50;
  }
  return score + user.id.charCodeAt(0) / 10000;
}

function updateStatsForDay(
  stats: Map<string, UserStats>,
  users: Receptionist[],
  assignments: DraftAssignment[],
  date: string,
  scheduleStart: string,
  templateById: Map<string, ShiftTemplate>,
) {
  const byUser = new Map(assignments.filter((item) => item.fecha === date).map((item) => [item.usuario_id, item]));
  for (const user of users) {
    const stat = stats.get(user.id)!;
    const assignment = byUser.get(user.id);
    if (!assignment || assignment.tipo_turno === "descanso") {
      stat.consecutivos = 0;
      stat.nochesConsecutivas = 0;
      continue;
    }
    const shift = shiftForAssignment(assignment, templateById);
    if (!shift) continue;
    const interval = intervalFor(date, scheduleStart, shift);
    stat.total += 1;
    stat.noches += shift.es_nocturno ? 1 : 0;
    stat.finesSemana += isWeekend(date) ? 1 : 0;
    stat.consecutivos += 1;
    stat.nochesConsecutivas = shift.es_nocturno ? stat.nochesConsecutivas + 1 : 0;
    stat.ultimoTrabajo = { fecha: date, finAbsoluto: interval.end, nocturno: shift.es_nocturno };
    const wk = weekKey(date);
    stat.trabajoSemana.set(wk, (stat.trabajoSemana.get(wk) || 0) + 1);
  }
}

function chooseGroup(
  date: string,
  users: Receptionist[],
  normal: ShiftTemplate[],
  extended: ShiftTemplate[],
  config: ScheduleConfig,
  requests: ScheduleRequest[],
  lockedForDate: DraftAssignment[],
  templateById: Map<string, ShiftTemplate>,
) {
  const forcedGroups = new Set<string>();
  for (const assignment of lockedForDate) {
    const shift = shiftForAssignment(assignment, templateById);
    if (shift) forcedGroups.add(shift.grupo);
  }
  for (const user of users) {
    const fixed = mandatoryFixed(requestForDate(requests, user.id, date));
    const shift = fixed?.plantilla_turno_id ? templateById.get(fixed.plantilla_turno_id) : null;
    if (shift) forcedGroups.add(shift.grupo);
  }
  if (forcedGroups.size === 1) return [...forcedGroups][0] as "normal" | "extendido";
  if (forcedGroups.size > 1) return "normal";

  const unavailable = users.filter((user) => {
    const locked = lockedForDate.find((item) => item.usuario_id === user.id);
    return locked?.tipo_turno === "descanso" || hasMandatoryOff(requestForDate(requests, user.id, date));
  }).length;
  const available = users.length - unavailable;
  if (config.permitir_turnos_extendidos && extended.length && available < normal.length && available >= extended.length) {
    return "extendido";
  }

  if (config.permitir_turnos_extendidos && extended.length < normal.length) {
    const maxWorkDays = 7 - Number(config.descansos_minimos_semana);
    const deficit = Math.max(0, normal.length * 7 - users.length * maxWorkDays);
    const savings = normal.length - extended.length;
    const requiredExtendedDays = savings > 0 ? Math.ceil(deficit / savings) : 0;
    if (evenlyDistributedWeekdays(requiredExtendedDays).has(weekdayMondayZero(date))) return "extendido";
  }
  return "normal";
}

function generateAssignments(params: {
  hotelId: string;
  draftId: string;
  start: string;
  end: string;
  users: Receptionist[];
  templates: ShiftTemplate[];
  requests: ScheduleRequest[];
  config: ScheduleConfig;
  previous: any[];
  locked?: DraftAssignment[];
}) {
  const { hotelId, draftId, start, end, users, templates, requests, config, previous } = params;
  const locked = params.locked || [];
  const dates = enumerateDates(start, end);
  const templateById = new Map(templates.map((item) => [item.id, item]));
  const templateByCode = new Map(templates.map((item) => [item.codigo, item]));
  const normal = templates.filter((item) => item.activo && item.grupo === "normal").sort((a, b) => a.orden - b.orden);
  const extended = templates.filter((item) => item.activo && item.grupo === "extendido").sort((a, b) => a.orden - b.orden);
  if (!normal.length) throw new Error("El hotel no tiene plantillas de turnos normales configuradas.");

  const stats = initialStats(users);
  applyHistoryToStats(stats, previous, templateById, templateByCode, start);
  const generated: DraftAssignment[] = [];

  for (const date of dates) {
    const lockedForDate = locked.filter((item) => item.fecha === date);
    const group = chooseGroup(date, users, normal, extended, config, requests, lockedForDate, templateById);
    const shifts = group === "extendido" ? extended : normal;
    const usedUsers = new Set<string>();
    const usedTemplates = new Set<string>();

    for (const item of lockedForDate) {
      generated.push({ ...item, borrador_id: draftId, hotel_id: hotelId });
      usedUsers.add(item.usuario_id);
      if (item.plantilla_turno_id) usedTemplates.add(item.plantilla_turno_id);
    }

    for (const user of users) {
      if (usedUsers.has(user.id)) continue;
      const fixed = mandatoryFixed(requestForDate(requests, user.id, date));
      if (!fixed?.plantilla_turno_id) continue;
      const shift = templateById.get(fixed.plantilla_turno_id);
      if (!shift || shift.grupo !== group || usedTemplates.has(shift.id)) continue;
      generated.push({
        borrador_id: draftId,
        hotel_id: hotelId,
        fecha: date,
        usuario_id: user.id,
        plantilla_turno_id: shift.id,
        tipo_turno: shift.codigo,
        bloqueado: false,
        origen: "solicitud",
        motivo: { regla: "turno_fijo", solicitud_id: fixed.id },
      });
      usedUsers.add(user.id);
      usedTemplates.add(shift.id);
    }

    for (const shift of shifts) {
      if (usedTemplates.has(shift.id)) continue;
      const candidates = users
        .filter((user) => !usedUsers.has(user.id))
        .filter((user) => hardEligible(user, shift, date, start, requests, stats.get(user.id)!, config))
        .map((user) => ({ user, score: candidateScore(user, shift, date, requests, stats.get(user.id)!, config) }))
        .sort((a, b) => a.score - b.score || a.user.nombre.localeCompare(b.user.nombre, "es"));
      const selected = candidates[0]?.user;
      if (!selected) continue;
      generated.push({
        borrador_id: draftId,
        hotel_id: hotelId,
        fecha: date,
        usuario_id: selected.id,
        plantilla_turno_id: shift.id,
        tipo_turno: shift.codigo,
        bloqueado: false,
        origen: "auto",
        motivo: { regla: "equilibrio", grupo },
      });
      usedUsers.add(selected.id);
      usedTemplates.add(shift.id);
    }

    for (const user of users) {
      if (usedUsers.has(user.id)) continue;
      const userRequests = requestForDate(requests, user.id, date);
      const offRequest = userRequests.find((item) => item.tipo === "descanso" || item.tipo === "no_disponible");
      generated.push({
        borrador_id: draftId,
        hotel_id: hotelId,
        fecha: date,
        usuario_id: user.id,
        plantilla_turno_id: null,
        tipo_turno: "descanso",
        bloqueado: false,
        origen: offRequest ? "solicitud" : "auto",
        motivo: offRequest ? { regla: offRequest.tipo, solicitud_id: offRequest.id } : { regla: "descanso_rotativo" },
      });
    }
    updateStatsForDay(stats, users, generated, date, start, templateById);
  }
  return generated;
}

function validateAssignments(params: {
  start: string;
  end: string;
  users: Receptionist[];
  templates: ShiftTemplate[];
  requests: ScheduleRequest[];
  config: ScheduleConfig;
  assignments: DraftAssignment[];
}) {
  const { start, end, users, templates, requests, config, assignments } = params;
  const conflicts: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const templateById = new Map(templates.map((item) => [item.id, item]));
  const userById = new Map(users.map((item) => [item.id, item]));
  const normal = templates.filter((item) => item.activo && item.grupo === "normal");
  const extended = templates.filter((item) => item.activo && item.grupo === "extendido");

  for (const date of enumerateDates(start, end)) {
    const daily = assignments.filter((item) => item.fecha === date);
    const work = daily.filter((item) => item.tipo_turno !== "descanso");
    const workTemplates = work.map((item) => shiftForAssignment(item, templateById)).filter(Boolean) as ShiftTemplate[];
    const groups = new Set(workTemplates.map((item) => item.grupo));
    const duplicateIds = workTemplates.map((item) => item.id).filter((id, index, all) => all.indexOf(id) !== index);
    if (duplicateIds.length) {
      conflicts.push({ codigo: "TURNO_DUPLICADO", mensaje: "Hay un turno cubierto por más de una persona.", fecha: date, severidad: "conflicto" });
    }
    const actualCodes = templateCodes(workTemplates);
    const validNormal = actualCodes === templateCodes(normal);
    const validExtended = config.permitir_turnos_extendidos && extended.length > 0 && actualCodes === templateCodes(extended);
    if (groups.size > 1 || (!validNormal && !validExtended)) {
      conflicts.push({ codigo: "COBERTURA_INCOMPLETA", mensaje: "La cobertura del día no completa todos los turnos requeridos.", fecha: date, severidad: "conflicto" });
    }
  }

  for (const user of users) {
    const rows = assignments.filter((item) => item.usuario_id === user.id).sort((a, b) => a.fecha.localeCompare(b.fecha));
    let previousWork: { row: DraftAssignment; shift: ShiftTemplate; end: number } | null = null;
    let consecutive = 0;
    let consecutiveNights = 0;
    for (const row of rows) {
      if (row.tipo_turno === "descanso") {
        consecutive = 0;
        consecutiveNights = 0;
        continue;
      }
      const shift = shiftForAssignment(row, templateById);
      if (!shift) {
        conflicts.push({ codigo: "PLANTILLA_INVALIDA", mensaje: "La asignación usa un turno inexistente.", fecha: row.fecha, usuario_id: user.id, usuario: user.nombre, severidad: "conflicto" });
        continue;
      }
      const interval = intervalFor(row.fecha, start, shift);
      if (previousWork) {
        const rest = interval.start - previousWork.end;
        if (rest < Number(config.descanso_minimo_horas) * 60) {
          conflicts.push({ codigo: "DESCANSO_INSUFICIENTE", mensaje: `${user.nombre} no cumple el descanso mínimo entre turnos.`, fecha: row.fecha, usuario_id: user.id, usuario: user.nombre, severidad: "conflicto" });
        }
        if (previousWork.shift.es_nocturno && daysBetween(previousWork.row.fecha, row.fecha) === 1 && !shift.es_nocturno) {
          conflicts.push({ codigo: "NOCHE_A_DIA", mensaje: `${user.nombre} trabajó de noche y no puede pasar a turno de día al día siguiente.`, fecha: row.fecha, usuario_id: user.id, usuario: user.nombre, severidad: "conflicto" });
        }
      }
      consecutive += 1;
      consecutiveNights = shift.es_nocturno ? consecutiveNights + 1 : 0;
      if (consecutive > Number(config.max_turnos_consecutivos)) {
        conflicts.push({ codigo: "MAX_CONSECUTIVOS", mensaje: `${user.nombre} supera el máximo de turnos consecutivos.`, fecha: row.fecha, usuario_id: user.id, usuario: user.nombre, severidad: "conflicto" });
      }
      if (consecutiveNights > Number(config.max_noches_consecutivas)) {
        conflicts.push({ codigo: "MAX_NOCHES", mensaje: `${user.nombre} supera el máximo de noches consecutivas.`, fecha: row.fecha, usuario_id: user.id, usuario: user.nombre, severidad: "conflicto" });
      }
      previousWork = { row, shift, end: interval.end };
    }
  }

  const dates = enumerateDates(start, end);
  const weeks = new Map<string, string[]>();
  for (const date of dates) {
    const key = weekKey(date);
    weeks.set(key, [...(weeks.get(key) || []), date]);
  }
  for (const [key, weekDates] of weeks) {
    for (const user of users) {
      const restCount = assignments.filter((item) => item.usuario_id === user.id && weekDates.includes(item.fecha) && item.tipo_turno === "descanso").length;
      if (weekDates.length === 7 && restCount < Number(config.descansos_minimos_semana)) {
        conflicts.push({ codigo: "DESCANSO_SEMANAL", mensaje: `${user.nombre} no tiene el descanso semanal mínimo en la semana ${key}.`, usuario_id: user.id, usuario: user.nombre, severidad: "conflicto" });
      } else if (weekDates.length < 7 && restCount === 0) {
        warnings.push({ codigo: "SEMANA_PARCIAL", mensaje: `${user.nombre} no tiene descanso dentro del tramo parcial de la semana ${key}.`, usuario_id: user.id, usuario: user.nombre, severidad: "advertencia" });
      }
    }
  }

  const assignmentByUserDate = new Map(assignments.map((item) => [`${item.usuario_id}|${item.fecha}`, item]));
  for (const request of requests.filter((item) => item.obligatorio)) {
    for (const date of dates.filter((item) => dateInRange(item, request.fecha_inicio, request.fecha_fin))) {
      const row = assignmentByUserDate.get(`${request.usuario_id}|${date}`);
      const user = userById.get(request.usuario_id);
      let valid = true;
      if (request.tipo === "descanso" || request.tipo === "no_disponible") valid = row?.tipo_turno === "descanso";
      if (request.tipo === "turno_fijo") valid = row?.plantilla_turno_id === request.plantilla_turno_id;
      if (request.tipo === "preferir_turno") valid = row?.plantilla_turno_id === request.plantilla_turno_id;
      if (request.tipo === "evitar_turno") valid = row?.plantilla_turno_id !== request.plantilla_turno_id;
      if (!valid) {
        conflicts.push({ codigo: "SOLICITUD_OBLIGATORIA", mensaje: `${user?.nombre || "Recepcionista"}: no se cumplió una solicitud obligatoria.`, fecha: date, usuario_id: request.usuario_id, usuario: user?.nombre, severidad: "conflicto" });
      }
    }
  }

  const quality = Math.max(0, Math.min(100, 100 - conflicts.length * 18 - warnings.length * 3));
  return { conflictos: conflicts, advertencias: warnings, calidad: quality };
}

async function saveValidation(admin: SupabaseClient, draftId: string, validation: ReturnType<typeof validateAssignments>) {
  const { error } = await admin
    .from("horario_borradores")
    .update({
      validacion: { conflictos: validation.conflictos, advertencias: validation.advertencias },
      calidad: validation.calidad,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", draftId);
  if (error) throw error;
}

async function getDraftBundle(admin: SupabaseClient, draftId: string, hotelId: string) {
  const { data: draft, error: draftError } = await admin
    .from("horario_borradores")
    .select("*")
    .eq("id", draftId)
    .eq("hotel_id", hotelId)
    .maybeSingle();
  if (draftError) throw draftError;
  if (!draft) throw new Error("Borrador no encontrado.");
  const { data: assignments, error: assignmentError } = await admin
    .from("horario_borrador_asignaciones")
    .select("*")
    .eq("borrador_id", draftId)
    .eq("hotel_id", hotelId)
    .order("fecha");
  if (assignmentError) throw assignmentError;
  return { draft, assignments: (assignments || []) as DraftAssignment[] };
}

async function generateDraft(admin: SupabaseClient, actorId: string, hotelId: string, body: any, reorganize = false) {
  let start: string;
  let end: string;
  let draftId: string;
  let locked: DraftAssignment[] = [];

  if (reorganize) {
    draftId = String(body?.draft_id || "");
    const bundle = await getDraftBundle(admin, draftId, hotelId);
    if (bundle.draft.estado !== "borrador") throw new Error("Solo se puede reorganizar un borrador.");
    start = bundle.draft.fecha_inicio;
    end = bundle.draft.fecha_fin;
    locked = bundle.assignments.filter((item) => item.bloqueado === true);
  } else {
    start = parseDate(body?.fecha_inicio);
    end = parseDate(body?.fecha_fin);
    enumerateDates(start, end);
    draftId = crypto.randomUUID();
  }

  const { config, templates } = await ensureSetup(admin, hotelId);
  const selectedIds = Array.isArray(body?.usuario_ids) ? body.usuario_ids.map(String) : undefined;
  const users = await loadReceptionists(admin, hotelId, selectedIds);
  if (users.length < 2) throw new Error("Se necesitan al menos 2 recepcionistas activos para generar el horario.");
  const requests = await loadRequests(admin, hotelId, users.map((item) => item.id), start, end);
  const previous = await loadPreviousPublished(admin, hotelId, users.map((item) => item.id), start);

  if (!reorganize) {
    const { error: draftError } = await admin.from("horario_borradores").insert({
      id: draftId,
      hotel_id: hotelId,
      fecha_inicio: start,
      fecha_fin: end,
      modalidad: config.modalidad,
      origen: "generado",
      configuracion_snapshot: config,
      generado_por: actorId,
    });
    if (draftError) throw draftError;
  } else {
    const { error: deleteError } = await admin
      .from("horario_borrador_asignaciones")
      .delete()
      .eq("borrador_id", draftId)
      .eq("hotel_id", hotelId)
      .eq("bloqueado", false);
    if (deleteError) throw deleteError;
    const { error: updateError } = await admin
      .from("horario_borradores")
      .update({ origen: "reorganizado", configuracion_snapshot: config, actualizado_en: new Date().toISOString() })
      .eq("id", draftId)
      .eq("hotel_id", hotelId);
    if (updateError) throw updateError;
  }

  const assignments = generateAssignments({ hotelId, draftId, start, end, users, templates, requests, config, previous, locked });
  const unlockedGenerated = assignments.filter((item) => !item.id);
  if (unlockedGenerated.length) {
    const { error } = await admin.from("horario_borrador_asignaciones").insert(unlockedGenerated);
    if (error) throw error;
  }
  const persisted = await getDraftBundle(admin, draftId, hotelId);
  const validation = validateAssignments({ start, end, users, templates, requests, config, assignments: persisted.assignments });
  await saveValidation(admin, draftId, validation);
  return { draft_id: draftId, fecha_inicio: start, fecha_fin: end, usuarios: users, plantillas: templates, asignaciones: persisted.assignments, validacion: validation };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  let secret = "";
  try {
    secret = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || "";
  } catch { /* fallback below */ }
  secret ||= Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !secret) return json({ error: "Configuración del servidor incompleta." }, 500);

  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const actor = await getActor(req, admin);
    if (!actor) return json({ error: "Solo un administrador activo puede gestionar horarios." }, 403);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "setup").toLowerCase();
    const requestedHotel = body?.hotel_id ? String(body.hotel_id) : null;
    const hotelId = isSuperadmin(actor.profile) && requestedHotel ? requestedHotel : String(actor.profile.hotel_id || "");
    if (!hotelId) return json({ error: "No se pudo resolver el hotel." }, 400);
    if (!isSuperadmin(actor.profile) && requestedHotel && requestedHotel !== hotelId) return json({ error: "No puedes gestionar horarios de otro hotel." }, 403);

    if (action === "setup") {
      const { config, templates } = await ensureSetup(admin, hotelId);
      const users = await loadReceptionists(admin, hotelId);
      const { data: drafts } = await admin
        .from("horario_borradores")
        .select("id, fecha_inicio, fecha_fin, estado, modalidad, origen, calidad, validacion, creado_en, publicado_en")
        .eq("hotel_id", hotelId)
        .order("creado_en", { ascending: false })
        .limit(10);
      return json({ ok: true, config, templates, usuarios: users, borradores: drafts || [] });
    }

    if (action === "generate") {
      return json({ ok: true, ...(await generateDraft(admin, actor.user.id, hotelId, body, false)) });
    }

    if (action === "reorganize") {
      return json({ ok: true, ...(await generateDraft(admin, actor.user.id, hotelId, body, true)) });
    }

    if (action === "validate") {
      const draftId = String(body?.draft_id || "");
      const bundle = await getDraftBundle(admin, draftId, hotelId);
      const { config, templates } = await ensureSetup(admin, hotelId);
      const userIds = [...new Set(bundle.assignments.map((item) => item.usuario_id))];
      const users = await loadReceptionists(admin, hotelId, userIds);
      const requests = await loadRequests(admin, hotelId, userIds, bundle.draft.fecha_inicio, bundle.draft.fecha_fin);
      const validation = validateAssignments({ start: bundle.draft.fecha_inicio, end: bundle.draft.fecha_fin, users, templates, requests, config, assignments: bundle.assignments });
      await saveValidation(admin, draftId, validation);
      return json({ ok: true, draft: bundle.draft, asignaciones: bundle.assignments, plantillas: templates, usuarios: users, validacion: validation });
    }

    if (action === "update_assignment") {
      const assignmentId = String(body?.assignment_id || "");
      const draftId = String(body?.draft_id || "");
      const bundle = await getDraftBundle(admin, draftId, hotelId);
      if (bundle.draft.estado !== "borrador") return json({ error: "No puedes editar un horario publicado." }, 409);
      const { templates } = await ensureSetup(admin, hotelId);
      const templateId = body?.plantilla_turno_id ? String(body.plantilla_turno_id) : null;
      const shift = templateId ? templates.find((item) => item.id === templateId) : null;
      if (templateId && !shift) return json({ error: "Turno inválido." }, 400);
      const patch = {
        plantilla_turno_id: shift?.id || null,
        tipo_turno: shift?.codigo || "descanso",
        bloqueado: body?.bloqueado !== false,
        origen: "manual",
        motivo: { regla: "edicion_manual" },
        actualizado_en: new Date().toISOString(),
      };
      const { error } = await admin
        .from("horario_borrador_asignaciones")
        .update(patch)
        .eq("id", assignmentId)
        .eq("borrador_id", draftId)
        .eq("hotel_id", hotelId);
      if (error) throw error;
      const refresh = await getDraftBundle(admin, draftId, hotelId);
      const users = await loadReceptionists(admin, hotelId, [...new Set(refresh.assignments.map((item) => item.usuario_id))]);
      const requests = await loadRequests(admin, hotelId, users.map((item) => item.id), refresh.draft.fecha_inicio, refresh.draft.fecha_fin);
      const { config } = await ensureSetup(admin, hotelId);
      const validation = validateAssignments({ start: refresh.draft.fecha_inicio, end: refresh.draft.fecha_fin, users, templates, requests, config, assignments: refresh.assignments });
      await saveValidation(admin, draftId, validation);
      return json({ ok: true, asignaciones: refresh.assignments, validacion: validation });
    }

    if (action === "publish") {
      const draftId = String(body?.draft_id || "");
      const bundle = await getDraftBundle(admin, draftId, hotelId);
      const { config, templates } = await ensureSetup(admin, hotelId);
      const userIds = [...new Set(bundle.assignments.map((item) => item.usuario_id))];
      const users = await loadReceptionists(admin, hotelId, userIds);
      const requests = await loadRequests(admin, hotelId, userIds, bundle.draft.fecha_inicio, bundle.draft.fecha_fin);
      const validation = validateAssignments({ start: bundle.draft.fecha_inicio, end: bundle.draft.fecha_fin, users, templates, requests, config, assignments: bundle.assignments });
      await saveValidation(admin, draftId, validation);
      if (config.publicar_requiere_sin_conflictos && validation.conflictos.length) {
        return json({ error: "El horario tiene conflictos y no puede publicarse.", code: "HORARIO_TIENE_CONFLICTOS", validacion: validation }, 409);
      }
      const { data, error } = await admin.rpc("horario_publicar_borrador", { p_borrador_id: draftId, p_actor_id: actor.user.id });
      if (error) throw error;
      return json({ ok: true, publicacion: data, validacion: validation });
    }

    return json({ error: "Acción no soportada." }, 400);
  } catch (error) {
    console.error("[horario-engine]", error);
    return json({ error: error instanceof Error ? error.message : "Error interno del generador." }, 500);
  }
});
