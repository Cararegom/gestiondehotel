import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.111.0";

// deno-lint-ignore-file no-explicit-any

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
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

type Assignment = {
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

type UserStats = {
  total: number;
  noches: number;
  finesSemana: number;
  consecutivos: number;
  nochesConsecutivas: number;
  ultimoTrabajo: { fecha: string; fin: number; nocturno: boolean } | null;
  trabajoSemana: Map<string, number>;
};

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseDate(value: unknown) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Fecha inválida.");
  return text;
}

function utcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(date: string, amount: number) {
  const d = utcDate(date);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string) {
  return Math.round((utcDate(b).getTime() - utcDate(a).getTime()) / 86400000);
}

function enumerateDates(start: string, end: string) {
  const total = daysBetween(start, end) + 1;
  if (total < 1 || total > 63) throw new Error("El horario debe cubrir entre 1 y 63 días.");
  return Array.from({ length: total }, (_, index) => addDays(start, index));
}

function weekKey(date: string) {
  const d = utcDate(date);
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return d.toISOString().slice(0, 10);
}

function weekdayMondayZero(date: string) {
  return (utcDate(date).getUTCDay() + 6) % 7;
}

function isWeekend(date: string) {
  const day = utcDate(date).getUTCDay();
  return day === 0 || day === 6;
}

function timeMinutes(value: string) {
  const [h, m] = String(value || "00:00").slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function durationMinutes(start: string, end: string) {
  const diff = (timeMinutes(end) - timeMinutes(start) + 1440) % 1440;
  return diff || 1440;
}

function intervalFor(date: string, scheduleStart: string, shift: ShiftTemplate) {
  const start = daysBetween(scheduleStart, date) * 1440 + timeMinutes(shift.hora_inicio);
  return { start, end: start + Number(shift.duracion_minutos || durationMinutes(shift.hora_inicio, shift.hora_fin)) };
}

function requestForDate(requests: ScheduleRequest[], userId: string, date: string) {
  return requests.filter(
    (item) => item.usuario_id === userId && date >= item.fecha_inicio && date <= item.fecha_fin,
  );
}

function roleNames(profile: any) {
  return (profile?.usuarios_roles ?? [])
    .map((item: any) => item?.roles?.nombre)
    .filter(Boolean)
    .map(normalize);
}

function isAdmin(profile: any) {
  const direct = normalize(profile?.rol);
  const roles = roleNames(profile);
  return profile?.activo === true && (
    ["admin", "administrador", "superadmin"].includes(direct) ||
    roles.some((role: string) => ["admin", "administrador", "superadmin"].includes(role))
  );
}

function isSuperadmin(profile: any) {
  return normalize(profile?.rol) === "superadmin" || roleNames(profile).includes("superadmin");
}

function defaultTemplates(modalidad: 8 | 12) {
  if (modalidad === 8) {
    return [
      { codigo: "manana", nombre: "Mañana", hora_inicio: "07:00", hora_fin: "15:00", duracion_minutos: 480, es_nocturno: false, es_extendido: false, grupo: "normal", orden: 10 },
      { codigo: "tarde", nombre: "Tarde", hora_inicio: "15:00", hora_fin: "23:00", duracion_minutos: 480, es_nocturno: false, es_extendido: false, grupo: "normal", orden: 20 },
      { codigo: "noche", nombre: "Noche", hora_inicio: "23:00", hora_fin: "07:00", duracion_minutos: 480, es_nocturno: true, es_extendido: false, grupo: "normal", orden: 30 },
      { codigo: "dia_ext", nombre: "Día 12h", hora_inicio: "07:00", hora_fin: "19:00", duracion_minutos: 720, es_nocturno: false, es_extendido: true, grupo: "extendido", orden: 110 },
      { codigo: "noche_ext", nombre: "Noche 12h", hora_inicio: "19:00", hora_fin: "07:00", duracion_minutos: 720, es_nocturno: true, es_extendido: true, grupo: "extendido", orden: 120 },
    ];
  }
  return [
    { codigo: "dia", nombre: "Día", hora_inicio: "07:00", hora_fin: "19:00", duracion_minutos: 720, es_nocturno: false, es_extendido: false, grupo: "normal", orden: 10 },
    { codigo: "noche", nombre: "Noche", hora_inicio: "19:00", hora_fin: "07:00", duracion_minutos: 720, es_nocturno: true, es_extendido: false, grupo: "normal", orden: 20 },
  ];
}

async function getActor(req: Request, admin: SupabaseClient) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
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
  let { data: config, error } = await admin
    .from("horario_configuracion")
    .select("*")
    .eq("hotel_id", hotelId)
    .maybeSingle();
  if (error) throw error;

  if (!config) {
    const { data: legacy } = await admin
      .from("configuracion_hotel")
      .select("tipo_turno_global")
      .eq("hotel_id", hotelId)
      .maybeSingle();
    const modalidad = Number(legacy?.tipo_turno_global) === 8 ? 8 : 12;
    const created = await admin
      .from("horario_configuracion")
      .insert({ hotel_id: hotelId, modalidad })
      .select("*")
      .single();
    if (created.error) throw created.error;
    config = created.data;
  }

  const typedConfig = {
    ...config,
    modalidad: Number(config.modalidad) === 8 ? 8 : 12,
  } as ScheduleConfig;

  let { data: templates, error: templatesError } = await admin
    .from("horario_plantillas_turno")
    .select("*")
    .eq("hotel_id", hotelId)
    .eq("activo", true)
    .order("orden");
  if (templatesError) throw templatesError;

  const active = (templates || []) as ShiftTemplate[];
  const compatibleNormal = active.filter((item) => item.grupo === "normal");
  if (!compatibleNormal.length) {
    const inserted = await admin
      .from("horario_plantillas_turno")
      .insert(defaultTemplates(typedConfig.modalidad).map((item) => ({ ...item, hotel_id: hotelId })))
      .select("*");
    if (inserted.error) throw inserted.error;
    templates = inserted.data;
  }

  return { config: typedConfig, templates: (templates || []) as ShiftTemplate[] };
}

async function loadReceptionists(
  admin: SupabaseClient,
  hotelId: string,
  selectedIds?: string[],
) {
  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .ilike("nombre", "Recepcionista")
    .limit(1)
    .maybeSingle();
  if (roleError) throw roleError;
  if (!role) throw new Error('No existe el rol "Recepcionista".');

  const { data: links, error: linksError } = await admin
    .from("usuarios_roles")
    .select("usuario_id")
    .eq("hotel_id", hotelId)
    .eq("rol_id", role.id);
  if (linksError) throw linksError;

  let ids = [...new Set((links || []).map((item: any) => String(item.usuario_id)).filter(Boolean))];
  if (selectedIds?.length) {
    const allowed = new Set(ids);
    const invalid = selectedIds.filter((id) => !allowed.has(id));
    if (invalid.length) throw new Error("Hay usuarios seleccionados que no tienen rol Recepcionista.");
    ids = ids.filter((id) => selectedIds.includes(id));
  }
  if (!ids.length) return [];

  const { data: users, error: userError } = await admin
    .from("usuarios")
    .select("id, nombre, activo")
    .eq("hotel_id", hotelId)
    .eq("activo", true)
    .in("id", ids)
    .order("nombre");
  if (userError) throw userError;

  const activeIds = (users || []).map((item: any) => item.id);
  const { data: preferences, error: preferenceError } = activeIds.length
    ? await admin
      .from("configuracion_turnos")
      .select("usuario_id, evita_turno_noche, prefiere_turno_dia, creado_en")
      .eq("hotel_id", hotelId)
      .eq("activo", true)
      .in("usuario_id", activeIds)
      .order("creado_en", { ascending: false })
    : { data: [], error: null };
  if (preferenceError) throw preferenceError;

  const byUser = new Map<string, any>();
  for (const pref of preferences || []) {
    if (!byUser.has(pref.usuario_id)) byUser.set(pref.usuario_id, pref);
  }

  return (users || []).map((user: any) => {
    const pref = byUser.get(user.id);
    return {
      id: user.id,
      nombre: user.nombre || "Sin nombre",
      evitaNoche: pref?.evita_turno_noche === true,
      prefiereDia: pref?.prefiere_turno_dia === true,
    } satisfies Receptionist;
  });
}

async function loadRequests(
  admin: SupabaseClient,
  hotelId: string,
  userIds: string[],
  start: string,
  end: string,
) {
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

async function loadPreviousPublished(
  admin: SupabaseClient,
  hotelId: string,
  userIds: string[],
  start: string,
) {
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
  return new Map(
    users.map((user) => [
      user.id,
      {
        total: 0,
        noches: 0,
        finesSemana: 0,
        consecutivos: 0,
        nochesConsecutivas: 0,
        ultimoTrabajo: null,
        trabajoSemana: new Map<string, number>(),
      } satisfies UserStats,
    ]),
  );
}

function seedHistory(
  stats: Map<string, UserStats>,
  rows: any[],
  templates: ShiftTemplate[],
  scheduleStart: string,
) {
  const byId = new Map(templates.map((item) => [item.id, item]));
  const byCode = new Map(templates.map((item) => [item.codigo, item]));

  for (const row of rows) {
    const stat = stats.get(row.usuario_id);
    if (!stat) continue;
    if (normalize(row.tipo_turno) === "descanso") {
      stat.consecutivos = 0;
      stat.nochesConsecutivas = 0;
      continue;
    }

    const shift = (row.plantilla_turno_id && byId.get(row.plantilla_turno_id)) ||
      byCode.get(normalize(row.tipo_turno));
    if (!shift) continue;
    const interval = intervalFor(row.fecha, scheduleStart, shift);
    stat.ultimoTrabajo = { fecha: row.fecha, fin: interval.end, nocturno: shift.es_nocturno };
    stat.consecutivos += 1;
    stat.nochesConsecutivas = shift.es_nocturno ? stat.nochesConsecutivas + 1 : 0;
  }
}

function mandatoryOff(requests: ScheduleRequest[]) {
  return requests.some(
    (item) => item.obligatorio && ["descanso", "no_disponible"].includes(item.tipo),
  );
}

function mandatoryFixed(requests: ScheduleRequest[]) {
  return requests.find(
    (item) => item.obligatorio && item.tipo === "turno_fijo" && item.plantilla_turno_id,
  ) || null;
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
  const dayRequests = requestForDate(requests, user.id, date);
  if (mandatoryOff(dayRequests)) return false;
  const fixed = mandatoryFixed(dayRequests);
  if (fixed && fixed.plantilla_turno_id !== shift.id) return false;
  if (dayRequests.some(
    (item) => item.obligatorio && item.tipo === "evitar_turno" &&
      item.plantilla_turno_id === shift.id
  )) return false;

  const current = intervalFor(date, scheduleStart, shift);
  if (stat.ultimoTrabajo) {
    const rest = current.start - stat.ultimoTrabajo.fin;
    if (rest < Number(config.descanso_minimo_horas) * 60) return false;
    if (
      stat.ultimoTrabajo.nocturno &&
      daysBetween(stat.ultimoTrabajo.fecha, date) === 1 &&
      !shift.es_nocturno
    ) return false;
  }

  if (stat.consecutivos >= Number(config.max_turnos_consecutivos)) return false;
  if (shift.es_nocturno && stat.nochesConsecutivas >= Number(config.max_noches_consecutivas)) {
    return false;
  }
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
  if (isWeekend(date) && config.equilibrar_fines_semana) score += stat.finesSemana * 5;
  if (shift.es_nocturno && user.evitaNoche) score += 40;
  if (shift.es_nocturno && user.prefiereDia) score += 20;

  for (const request of requestForDate(requests, user.id, date)) {
    if (request.tipo === "preferir_turno" && request.plantilla_turno_id === shift.id) score -= 30;
    if (request.tipo === "evitar_turno" && request.plantilla_turno_id === shift.id) score += 50;
    if (!request.obligatorio && ["descanso", "no_disponible"].includes(request.tipo)) score += 60;
  }
  return score;
}

function extendedDaysNeeded(
  users: Receptionist[],
  normalCount: number,
  extendedCount: number,
  config: ScheduleConfig,
) {
  if (!config.permitir_turnos_extendidos || extendedCount <= 0 || extendedCount >= normalCount) return 0;
  const maxWorkDays = 7 - Number(config.descansos_minimos_semana);
  const deficit = Math.max(0, normalCount * 7 - users.length * maxWorkDays);
  const savings = normalCount - extendedCount;
  return savings > 0 ? Math.ceil(deficit / savings) : 0;
}

function distributedWeekdays(count: number) {
  const set = new Set<number>();
  if (count <= 0) return set;
  for (let i = 0; i < count; i += 1) {
    set.add(Math.min(6, Math.floor(((i + 1) * 7) / (count + 1))));
  }
  return set;
}

function chooseGroup(
  date: string,
  users: Receptionist[],
  normal: ShiftTemplate[],
  extended: ShiftTemplate[],
  config: ScheduleConfig,
  requests: ScheduleRequest[],
  locked: Assignment[],
  templateById: Map<string, ShiftTemplate>,
) {
  const forcedGroups = new Set<string>();
  for (const item of locked) {
    if (!item.plantilla_turno_id) continue;
    const shift = templateById.get(item.plantilla_turno_id);
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
    const lockedRow = locked.find((item) => item.usuario_id === user.id);
    return lockedRow?.tipo_turno === "descanso" ||
      mandatoryOff(requestForDate(requests, user.id, date));
  }).length;
  const available = users.length - unavailable;

  if (
    config.permitir_turnos_extendidos &&
    extended.length &&
    available < normal.length &&
    available >= extended.length
  ) return "extendido";

  const needed = extendedDaysNeeded(users, normal.length, extended.length, config);
  if (
    config.permitir_turnos_extendidos &&
    extended.length &&
    distributedWeekdays(needed).has(weekdayMondayZero(date))
  ) return "extendido";

  return "normal";
}

function updateStats(
  stats: Map<string, UserStats>,
  users: Receptionist[],
  dayAssignments: Assignment[],
  date: string,
  scheduleStart: string,
  templates: Map<string, ShiftTemplate>,
) {
  const byUser = new Map(dayAssignments.map((item) => [item.usuario_id, item]));
  for (const user of users) {
    const stat = stats.get(user.id)!;
    const row = byUser.get(user.id);
    if (!row || row.tipo_turno === "descanso") {
      stat.consecutivos = 0;
      stat.nochesConsecutivas = 0;
      continue;
    }
    const shift = row.plantilla_turno_id ? templates.get(row.plantilla_turno_id) : null;
    if (!shift) continue;
    const interval = intervalFor(date, scheduleStart, shift);
    stat.total += 1;
    stat.noches += shift.es_nocturno ? 1 : 0;
    stat.finesSemana += isWeekend(date) ? 1 : 0;
    stat.consecutivos += 1;
    stat.nochesConsecutivas = shift.es_nocturno ? stat.nochesConsecutivas + 1 : 0;
    stat.ultimoTrabajo = { fecha: date, fin: interval.end, nocturno: shift.es_nocturno };
    const wk = weekKey(date);
    stat.trabajoSemana.set(wk, (stat.trabajoSemana.get(wk) || 0) + 1);
  }
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
  locked?: Assignment[];
}) {
  const { hotelId, draftId, start, end, users, templates, requests, config, previous } = params;
  const locked = params.locked || [];
  const templateById = new Map(templates.map((item) => [item.id, item]));
  const normal = templates.filter((item) => item.activo && item.grupo === "normal").sort((a, b) => a.orden - b.orden);
  const extended = templates.filter((item) => item.activo && item.grupo === "extendido").sort((a, b) => a.orden - b.orden);
  if (!normal.length) throw new Error("El hotel no tiene turnos normales configurados.");

  const stats = initialStats(users);
  seedHistory(stats, previous, templates, start);
  const result: Assignment[] = [];

  for (const date of enumerateDates(start, end)) {
    const dayLocked = locked.filter((item) => item.fecha === date);
    const group = chooseGroup(date, users, normal, extended, config, requests, dayLocked, templateById);
    const shifts = group === "extendido" ? extended : normal;
    const usedUsers = new Set<string>();
    const usedShifts = new Set<string>();
    const dayRows: Assignment[] = [];

    for (const item of dayLocked) {
      const row = { ...item, borrador_id: draftId, hotel_id: hotelId };
      dayRows.push(row);
      usedUsers.add(item.usuario_id);
      if (item.plantilla_turno_id) usedShifts.add(item.plantilla_turno_id);
    }

    for (const user of users) {
      if (usedUsers.has(user.id)) continue;
      const fixed = mandatoryFixed(requestForDate(requests, user.id, date));
      if (!fixed?.plantilla_turno_id) continue;
      const shift = templateById.get(fixed.plantilla_turno_id);
      if (!shift || shift.grupo !== group || usedShifts.has(shift.id)) continue;
      dayRows.push({
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
      usedShifts.add(shift.id);
    }

    for (const shift of shifts) {
      if (usedShifts.has(shift.id)) continue;
      const candidates = users
        .filter((user) => !usedUsers.has(user.id))
        .filter((user) => hardEligible(
          user,
          shift,
          date,
          start,
          requests,
          stats.get(user.id)!,
          config,
        ))
        .map((user) => ({
          user,
          score: candidateScore(user, shift, date, requests, stats.get(user.id)!, config),
        }))
        .sort((a, b) => a.score - b.score || a.user.nombre.localeCompare(b.user.nombre, "es"));

      const selected = candidates[0]?.user;
      if (!selected) continue;

      dayRows.push({
        borrador_id: draftId,
        hotel_id: hotelId,
        fecha: date,
        usuario_id: selected.id,
        plantilla_turno_id: shift.id,
        tipo_turno: shift.codigo,
        bloqueado: false,
        origen: "auto",
        motivo: { regla: "equilibrio", grupo: group },
      });
      usedUsers.add(selected.id);
      usedShifts.add(shift.id);
    }

    for (const user of users) {
      if (usedUsers.has(user.id)) continue;
      const requestsForUser = requestForDate(requests, user.id, date);
      const off = requestsForUser.find((item) => ["descanso", "no_disponible"].includes(item.tipo));
      dayRows.push({
        borrador_id: draftId,
        hotel_id: hotelId,
        fecha: date,
        usuario_id: user.id,
        plantilla_turno_id: null,
        tipo_turno: "descanso",
        bloqueado: false,
        origen: off ? "solicitud" : "auto",
        motivo: off
          ? { regla: off.tipo, solicitud_id: off.id }
          : { regla: "descanso_rotativo" },
      });
    }

    result.push(...dayRows);
    updateStats(stats, users, dayRows, date, start, templateById);
  }

  return result;
}

function templateCodes(items: ShiftTemplate[]) {
  return items.map((item) => item.codigo).sort().join("|");
}

function validateAssignments(params: {
  start: string;
  end: string;
  users: Receptionist[];
  templates: ShiftTemplate[];
  requests: ScheduleRequest[];
  config: ScheduleConfig;
  assignments: Assignment[];
}) {
  const { start, end, users, templates, requests, config, assignments } = params;
  const conflicts: any[] = [];
  const warnings: any[] = [];
  const templateById = new Map(templates.map((item) => [item.id, item]));
  const userById = new Map(users.map((item) => [item.id, item]));
  const normal = templates.filter((item) => item.activo && item.grupo === "normal");
  const extended = templates.filter((item) => item.activo && item.grupo === "extendido");

  for (const date of enumerateDates(start, end)) {
    const work = assignments.filter((item) => item.fecha === date && item.tipo_turno !== "descanso");
    const shifts = work
      .map((item) => item.plantilla_turno_id ? templateById.get(item.plantilla_turno_id) : null)
      .filter(Boolean) as ShiftTemplate[];
    const groups = new Set(shifts.map((item) => item.grupo));
    const actual = templateCodes(shifts);
    const validNormal = actual === templateCodes(normal);
    const validExtended = config.permitir_turnos_extendidos &&
      extended.length > 0 &&
      actual === templateCodes(extended);

    if (groups.size > 1 || (!validNormal && !validExtended)) {
      conflicts.push({
        codigo: "COBERTURA_INCOMPLETA",
        mensaje: "La cobertura del día no completa todos los turnos requeridos.",
        fecha: date,
      });
    }
  }

  for (const user of users) {
    const rows = assignments
      .filter((item) => item.usuario_id === user.id)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    let previous: { row: Assignment; shift: ShiftTemplate; end: number } | null = null;
    let consecutive = 0;
    let nights = 0;

    for (const row of rows) {
      if (row.tipo_turno === "descanso") {
        consecutive = 0;
        nights = 0;
        continue;
      }
      const shift = row.plantilla_turno_id ? templateById.get(row.plantilla_turno_id) : null;
      if (!shift) {
        conflicts.push({
          codigo: "PLANTILLA_INVALIDA",
          mensaje: `${user.nombre} tiene un turno inexistente.`,
          fecha: row.fecha,
          usuario_id: user.id,
        });
        continue;
      }

      const current = intervalFor(row.fecha, start, shift);
      if (previous) {
        const rest = current.start - previous.end;
        if (rest < Number(config.descanso_minimo_horas) * 60) {
          conflicts.push({
            codigo: "DESCANSO_INSUFICIENTE",
            mensaje: `${user.nombre} no cumple el descanso mínimo entre turnos.`,
            fecha: row.fecha,
            usuario_id: user.id,
          });
        }
        if (
          previous.shift.es_nocturno &&
          daysBetween(previous.row.fecha, row.fecha) === 1 &&
          !shift.es_nocturno
        ) {
          conflicts.push({
            codigo: "NOCHE_A_DIA",
            mensaje: `${user.nombre} no puede pasar de noche a día al día siguiente.`,
            fecha: row.fecha,
            usuario_id: user.id,
          });
        }
      }

      consecutive += 1;
      nights = shift.es_nocturno ? nights + 1 : 0;
      if (consecutive > Number(config.max_turnos_consecutivos)) {
        conflicts.push({
          codigo: "MAX_CONSECUTIVOS",
          mensaje: `${user.nombre} supera el máximo de jornadas consecutivas.`,
          fecha: row.fecha,
          usuario_id: user.id,
        });
      }
      if (nights > Number(config.max_noches_consecutivas)) {
        conflicts.push({
          codigo: "MAX_NOCHES",
          mensaje: `${user.nombre} supera el máximo de noches consecutivas.`,
          fecha: row.fecha,
          usuario_id: user.id,
        });
      }
      previous = { row, shift, end: current.end };
    }
  }

  const weeks = new Map<string, string[]>();
  for (const date of enumerateDates(start, end)) {
    const key = weekKey(date);
    weeks.set(key, [...(weeks.get(key) || []), date]);
  }

  for (const [key, dates] of weeks) {
    for (const user of users) {
      const restCount = assignments.filter(
        (item) => item.usuario_id === user.id &&
          dates.includes(item.fecha) &&
          item.tipo_turno === "descanso",
      ).length;

      if (dates.length === 7 && restCount < Number(config.descansos_minimos_semana)) {
        conflicts.push({
          codigo: "DESCANSO_SEMANAL",
          mensaje: `${user.nombre} no tiene el descanso semanal mínimo en la semana ${key}.`,
          usuario_id: user.id,
        });
      } else if (dates.length < 7 && restCount === 0) {
        warnings.push({
          codigo: "SEMANA_PARCIAL",
          mensaje: `${user.nombre} no tiene descanso dentro del tramo parcial ${key}.`,
          usuario_id: user.id,
        });
      }
    }
  }

  const byUserDate = new Map(
    assignments.map((item) => [`${item.usuario_id}|${item.fecha}`, item]),
  );

  for (const request of requests.filter((item) => item.obligatorio)) {
    for (const date of enumerateDates(start, end).filter(
      (item) => item >= request.fecha_inicio && item <= request.fecha_fin,
    )) {
      const row = byUserDate.get(`${request.usuario_id}|${date}`);
      const name = userById.get(request.usuario_id)?.nombre || "Recepcionista";
      let valid = true;
      if (["descanso", "no_disponible"].includes(request.tipo)) {
        valid = row?.tipo_turno === "descanso";
      } else if (request.tipo === "turno_fijo" || request.tipo === "preferir_turno") {
        valid = row?.plantilla_turno_id === request.plantilla_turno_id;
      } else if (request.tipo === "evitar_turno") {
        valid = row?.plantilla_turno_id !== request.plantilla_turno_id;
      }
      if (!valid) {
        conflicts.push({
          codigo: "SOLICITUD_OBLIGATORIA",
          mensaje: `${name}: no se cumplió una solicitud obligatoria.`,
          fecha: date,
          usuario_id: request.usuario_id,
        });
      }
    }
  }

  const quality = Math.max(0, Math.min(100, 100 - conflicts.length * 18 - warnings.length * 3));
  return { conflictos: conflicts, advertencias: warnings, calidad: quality };
}

async function getDraftBundle(admin: SupabaseClient, draftId: string, hotelId: string) {
  const { data: draft, error } = await admin
    .from("horario_borradores")
    .select("*")
    .eq("id", draftId)
    .eq("hotel_id", hotelId)
    .maybeSingle();
  if (error) throw error;
  if (!draft) throw new Error("Borrador no encontrado.");

  const { data: assignments, error: assignmentError } = await admin
    .from("horario_borrador_asignaciones")
    .select("*")
    .eq("borrador_id", draftId)
    .eq("hotel_id", hotelId)
    .order("fecha");
  if (assignmentError) throw assignmentError;
  return { draft, assignments: (assignments || []) as Assignment[] };
}

async function saveValidation(
  admin: SupabaseClient,
  draftId: string,
  validation: ReturnType<typeof validateAssignments>,
) {
  const { error } = await admin
    .from("horario_borradores")
    .update({
      validacion: {
        conflictos: validation.conflictos,
        advertencias: validation.advertencias,
      },
      calidad: validation.calidad,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", draftId);
  if (error) throw error;
}

async function validateDraft(
  admin: SupabaseClient,
  hotelId: string,
  draftId: string,
) {
  const bundle = await getDraftBundle(admin, draftId, hotelId);
  const { config, templates } = await ensureSetup(admin, hotelId);
  const userIds = [...new Set(bundle.assignments.map((item) => item.usuario_id))];
  const users = await loadReceptionists(admin, hotelId, userIds);
  const requests = await loadRequests(
    admin,
    hotelId,
    userIds,
    bundle.draft.fecha_inicio,
    bundle.draft.fecha_fin,
  );
  const validation = validateAssignments({
    start: bundle.draft.fecha_inicio,
    end: bundle.draft.fecha_fin,
    users,
    templates,
    requests,
    config,
    assignments: bundle.assignments,
  });
  await saveValidation(admin, draftId, validation);
  return { bundle, config, templates, users, validation };
}

async function generateDraft(
  admin: SupabaseClient,
  actorId: string,
  hotelId: string,
  body: any,
  reorganize: boolean,
) {
  let draftId = "";
  let start = "";
  let end = "";
  let locked: Assignment[] = [];
  let selectedIds: string[] | undefined;

  if (reorganize) {
    draftId = String(body?.draft_id || "");
    const bundle = await getDraftBundle(admin, draftId, hotelId);
    if (bundle.draft.estado !== "borrador") throw new Error("Solo se puede reorganizar un borrador.");
    start = bundle.draft.fecha_inicio;
    end = bundle.draft.fecha_fin;
    locked = bundle.assignments.filter((item) => item.bloqueado === true);
    selectedIds = [...new Set(bundle.assignments.map((item) => item.usuario_id))];
  } else {
    start = parseDate(body?.fecha_inicio);
    end = parseDate(body?.fecha_fin);
    enumerateDates(start, end);
    draftId = crypto.randomUUID();
    selectedIds = Array.isArray(body?.usuario_ids)
      ? body.usuario_ids.map((value: unknown) => String(value))
      : undefined;
  }

  const { config, templates } = await ensureSetup(admin, hotelId);
  const users = await loadReceptionists(admin, hotelId, selectedIds);
  if (users.length < 2) throw new Error("Se necesitan al menos 2 recepcionistas activos.");

  const userIds = users.map((item) => item.id);
  const requests = await loadRequests(admin, hotelId, userIds, start, end);
  const previous = await loadPreviousPublished(admin, hotelId, userIds, start);

  if (!reorganize) {
    const { error } = await admin
      .from("horario_borradores")
      .insert({
        id: draftId,
        hotel_id: hotelId,
        fecha_inicio: start,
        fecha_fin: end,
        modalidad: config.modalidad,
        origen: "generado",
        configuracion_snapshot: config,
        generado_por: actorId,
      });
    if (error) throw error;
  } else {
    const { error } = await admin
      .from("horario_borrador_asignaciones")
      .delete()
      .eq("borrador_id", draftId)
      .eq("hotel_id", hotelId)
      .eq("bloqueado", false);
    if (error) throw error;

    const updated = await admin
      .from("horario_borradores")
      .update({
        origen: "reorganizado",
        configuracion_snapshot: config,
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", draftId)
      .eq("hotel_id", hotelId);
    if (updated.error) throw updated.error;
  }

  const generated = generateAssignments({
    hotelId,
    draftId,
    start,
    end,
    users,
    templates,
    requests,
    config,
    previous,
    locked,
  });

  const toInsert = generated.filter((item) => !item.id);
  if (toInsert.length) {
    const inserted = await admin
      .from("horario_borrador_asignaciones")
      .insert(toInsert);
    if (inserted.error) throw inserted.error;
  }

  const bundle = await getDraftBundle(admin, draftId, hotelId);
  const validation = validateAssignments({
    start,
    end,
    users,
    templates,
    requests,
    config,
    assignments: bundle.assignments,
  });
  await saveValidation(admin, draftId, validation);

  return {
    draft_id: draftId,
    fecha_inicio: start,
    fecha_fin: end,
    usuarios: users,
    plantillas: templates,
    asignaciones: bundle.assignments,
    validacion: validation,
  };
}

async function saveConfig(
  admin: SupabaseClient,
  hotelId: string,
  actorId: string,
  body: any,
) {
  const current = await ensureSetup(admin, hotelId);
  const modalidad = Number(body?.modalidad) === 8 ? 8 : 12;
  const patch = {
    modalidad,
    descanso_minimo_horas: Math.min(24, Math.max(6, Number(body?.descanso_minimo_horas ?? current.config.descanso_minimo_horas))),
    descansos_minimos_semana: Math.min(6, Math.max(1, Number(body?.descansos_minimos_semana ?? current.config.descansos_minimos_semana))),
    max_turnos_consecutivos: Math.min(14, Math.max(1, Number(body?.max_turnos_consecutivos ?? current.config.max_turnos_consecutivos))),
    max_noches_consecutivas: Math.min(7, Math.max(1, Number(body?.max_noches_consecutivas ?? current.config.max_noches_consecutivas))),
    equilibrar_noches: body?.equilibrar_noches !== false,
    equilibrar_fines_semana: body?.equilibrar_fines_semana !== false,
    permitir_turnos_extendidos: body?.permitir_turnos_extendidos === true,
    actualizado_en: new Date().toISOString(),
    actualizado_por: actorId,
  };

  const { error } = await admin
    .from("horario_configuracion")
    .update(patch)
    .eq("hotel_id", hotelId);
  if (error) throw error;

  const legacy = await admin
    .from("configuracion_hotel")
    .update({ tipo_turno_global: modalidad })
    .eq("hotel_id", hotelId);
  if (legacy.error) throw legacy.error;

  if (modalidad !== current.config.modalidad || body?.restablecer_plantillas === true) {
    const deactivated = await admin
      .from("horario_plantillas_turno")
      .update({ activo: false, actualizado_en: new Date().toISOString() })
      .eq("hotel_id", hotelId)
      .eq("activo", true);
    if (deactivated.error) throw deactivated.error;

    const defaults = await admin
      .from("horario_plantillas_turno")
      .upsert(
        defaultTemplates(modalidad).map((item) => ({ ...item, hotel_id: hotelId, activo: true })),
        { onConflict: "hotel_id,codigo" },
      );
    if (defaults.error) throw defaults.error;
  }

  return ensureSetup(admin, hotelId);
}

async function saveTemplates(admin: SupabaseClient, hotelId: string, body: any) {
  const items = Array.isArray(body?.plantillas) ? body.plantillas : [];
  if (!items.length) throw new Error("No se recibieron turnos para guardar.");

  const { templates } = await ensureSetup(admin, hotelId);
  const allowed = new Map(templates.map((item) => [item.id, item]));

  for (const item of items) {
    const id = String(item?.id || "");
    if (!allowed.has(id)) throw new Error("Se intentó modificar una plantilla que no pertenece al hotel.");
    const start = String(item?.hora_inicio || "").slice(0, 5);
    const end = String(item?.hora_fin || "").slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
      throw new Error("Las horas de los turnos no son válidas.");
    }

    const { error } = await admin
      .from("horario_plantillas_turno")
      .update({
        hora_inicio: start,
        hora_fin: end,
        duracion_minutos: durationMinutes(start, end),
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("hotel_id", hotelId);
    if (error) throw error;
  }

  return ensureSetup(admin, hotelId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  let secret = "";
  try {
    secret = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || "";
  } catch {
    // fallback below
  }
  secret ||= Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !secret) return json({ error: "Configuración del servidor incompleta." }, 500);

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const actor = await getActor(req, admin);
    if (!actor) return json({ error: "Solo un administrador activo puede gestionar horarios." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = normalize(body?.action || "setup");
    const requestedHotel = body?.hotel_id ? String(body.hotel_id) : null;
    const hotelId = isSuperadmin(actor.profile) && requestedHotel
      ? requestedHotel
      : String(actor.profile.hotel_id || "");

    if (!hotelId) return json({ error: "No se pudo resolver el hotel." }, 400);
    if (!isSuperadmin(actor.profile) && requestedHotel && requestedHotel !== hotelId) {
      return json({ error: "No puedes gestionar horarios de otro hotel." }, 403);
    }

    if (action === "setup") {
      const { config, templates } = await ensureSetup(admin, hotelId);
      const users = await loadReceptionists(admin, hotelId);
      const { data: drafts, error } = await admin
        .from("horario_borradores")
        .select("id, fecha_inicio, fecha_fin, estado, modalidad, origen, calidad, validacion, creado_en, publicado_en")
        .eq("hotel_id", hotelId)
        .order("creado_en", { ascending: false })
        .limit(10);
      if (error) throw error;
      return json({ ok: true, config, templates, usuarios: users, borradores: drafts || [] });
    }

    if (action === "save_config") {
      const saved = await saveConfig(admin, hotelId, actor.user.id, body);
      return json({ ok: true, ...saved });
    }

    if (action === "save_templates") {
      const saved = await saveTemplates(admin, hotelId, body);
      return json({ ok: true, ...saved });
    }

    if (action === "generate") {
      return json({ ok: true, ...(await generateDraft(admin, actor.user.id, hotelId, body, false)) });
    }

    if (action === "reorganize") {
      return json({ ok: true, ...(await generateDraft(admin, actor.user.id, hotelId, body, true)) });
    }

    if (action === "get_draft") {
      const draftId = String(body?.draft_id || "");
      const checked = await validateDraft(admin, hotelId, draftId);
      return json({
        ok: true,
        draft: checked.bundle.draft,
        asignaciones: checked.bundle.assignments,
        plantillas: checked.templates,
        usuarios: checked.users,
        validacion: checked.validation,
      });
    }

    if (action === "validate") {
      const draftId = String(body?.draft_id || "");
      const checked = await validateDraft(admin, hotelId, draftId);
      return json({
        ok: true,
        draft: checked.bundle.draft,
        asignaciones: checked.bundle.assignments,
        plantillas: checked.templates,
        usuarios: checked.users,
        validacion: checked.validation,
      });
    }

    if (action === "update_assignment") {
      const draftId = String(body?.draft_id || "");
      const assignmentId = String(body?.assignment_id || "");
      const bundle = await getDraftBundle(admin, draftId, hotelId);
      if (bundle.draft.estado !== "borrador") {
        return json({ error: "No puedes editar un horario publicado." }, 409);
      }

      const { templates } = await ensureSetup(admin, hotelId);
      const templateId = body?.plantilla_turno_id ? String(body.plantilla_turno_id) : null;
      const shift = templateId ? templates.find((item) => item.id === templateId) : null;
      if (templateId && !shift) return json({ error: "Turno inválido." }, 400);

      const updated = await admin
        .from("horario_borrador_asignaciones")
        .update({
          plantilla_turno_id: shift?.id || null,
          tipo_turno: shift?.codigo || "descanso",
          bloqueado: body?.bloqueado !== false,
          origen: "manual",
          motivo: { regla: "edicion_manual" },
          actualizado_en: new Date().toISOString(),
        })
        .eq("id", assignmentId)
        .eq("borrador_id", draftId)
        .eq("hotel_id", hotelId);
      if (updated.error) throw updated.error;

      const checked = await validateDraft(admin, hotelId, draftId);
      return json({
        ok: true,
        asignaciones: checked.bundle.assignments,
        validacion: checked.validation,
      });
    }

    if (action === "publish") {
      const draftId = String(body?.draft_id || "");
      const checked = await validateDraft(admin, hotelId, draftId);
      if (
        checked.config.publicar_requiere_sin_conflictos &&
        checked.validation.conflictos.length
      ) {
        return json({
          error: "El horario tiene conflictos y no puede publicarse.",
          code: "HORARIO_TIENE_CONFLICTOS",
          validacion: checked.validation,
        }, 409);
      }

      const { data, error } = await admin.rpc("horario_publicar_borrador", {
        p_borrador_id: draftId,
        p_actor_id: actor.user.id,
      });
      if (error) throw error;
      return json({ ok: true, publicacion: data, validacion: checked.validation });
    }

    return json({ error: "Acción no soportada." }, 400);
  } catch (error) {
    console.error("[horario-engine]", error);
    return json({
      error: error instanceof Error ? error.message : "Error interno del generador.",
    }, 500);
  }
});
