import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 62;

type Config = {
  hotel_id: string;
  tipo_operacion: number;
  descanso_minimo_horas: number;
  dias_descanso_semana: number;
  max_noches_consecutivas: number;
  balancear_noches: boolean;
  balancear_fines_semana: boolean;
  permitir_relevo_extendido: boolean;
};

type Shift = {
  codigo: string;
  nombre: string;
  hora_inicio: string;
  hora_fin: string;
  es_nocturno: boolean;
  es_extendido: boolean;
  modo_cobertura: "normal" | "relevo";
  orden: number;
  activo: boolean;
};

type Worker = {
  id: string;
  nombre: string;
  evita_turno_noche?: boolean;
  prefiere_turno_dia?: boolean;
};

type RequestRow = {
  id?: string;
  usuario_id: string;
  fecha: string;
  tipo: string;
  turno_codigo?: string | null;
  obligatoria: boolean;
  nota?: string | null;
};

type Assignment = {
  fecha: string;
  usuario_id: string;
  tipo_asignacion: "turno" | "descanso";
  turno_codigo: string | null;
  bloqueado: boolean;
  origen: "auto" | "manual" | "bloqueado";
  motivo: Record<string, unknown>;
};

type DayMode = { fecha: string; modo_cobertura: "normal" | "relevo" };

type Validation = {
  criticos: Array<Record<string, unknown>>;
  advertencias: Array<Record<string, unknown>>;
  metricas: Record<string, unknown>;
};

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function roleNames(profile: any) {
  return (profile?.usuarios_roles ?? [])
    .map((item: any) => item?.roles?.nombre)
    .filter(Boolean)
    .map(normalize);
}

function isAdmin(profile: any) {
  const direct = normalize(profile?.rol);
  const assigned = roleNames(profile);
  return profile?.activo === true && (
    ["admin", "administrador", "superadmin"].includes(direct) ||
    assigned.some((role: string) => ["admin", "administrador", "superadmin"].includes(role))
  );
}

function isSuperadmin(profile: any) {
  return normalize(profile?.rol) === "superadmin" || roleNames(profile).includes("superadmin");
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) throw new Error("Fecha inválida.");
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function addDays(value: string, amount: number) {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return isoDate(date);
}

function dateRange(start: string, end: string) {
  const from = parseDate(start);
  const to = parseDate(end);
  const count = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
  if (count < 1 || count > MAX_RANGE_DAYS) throw new Error(`El rango debe tener entre 1 y ${MAX_RANGE_DAYS} días.`);
  return Array.from({ length: count }, (_, index) => isoDate(new Date(from.getTime() + index * DAY_MS)));
}

function mondayKey(value: string) {
  const date = parseDate(value);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return isoDate(date);
}

function isWeekend(value: string) {
  const day = parseDate(value).getUTCDay();
  return day === 0 || day === 6;
}

function timeMinutes(value: string) {
  const [hours, minutes] = String(value).slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

function shiftInterval(date: string, shift: Shift) {
  const base = parseDate(date).getTime();
  const startMinutes = timeMinutes(shift.hora_inicio);
  const endMinutes = timeMinutes(shift.hora_fin);
  const start = base + startMinutes * 60_000;
  let end = base + endMinutes * 60_000;
  if (end <= start) end += DAY_MS;
  return { start, end, minutes: Math.round((end - start) / 60_000) };
}

function defaultTemplates(operation: number): Shift[] {
  if (operation === 12) {
    return [
      { codigo: "dia", nombre: "Día", hora_inicio: "07:00", hora_fin: "19:00", es_nocturno: false, es_extendido: true, modo_cobertura: "normal", orden: 1, activo: true },
      { codigo: "noche", nombre: "Noche", hora_inicio: "19:00", hora_fin: "07:00", es_nocturno: true, es_extendido: true, modo_cobertura: "normal", orden: 2, activo: true },
    ];
  }
  return [
    { codigo: "manana", nombre: "Mañana", hora_inicio: "07:00", hora_fin: "14:00", es_nocturno: false, es_extendido: false, modo_cobertura: "normal", orden: 1, activo: true },
    { codigo: "tarde", nombre: "Tarde", hora_inicio: "14:00", hora_fin: "22:00", es_nocturno: false, es_extendido: false, modo_cobertura: "normal", orden: 2, activo: true },
    { codigo: "noche", nombre: "Noche", hora_inicio: "22:00", hora_fin: "07:00", es_nocturno: true, es_extendido: false, modo_cobertura: "normal", orden: 3, activo: true },
    { codigo: "dia_extendido", nombre: "Día 12h", hora_inicio: "07:00", hora_fin: "19:00", es_nocturno: false, es_extendido: true, modo_cobertura: "relevo", orden: 1, activo: true },
    { codigo: "noche_extendida", nombre: "Noche 12h", hora_inicio: "19:00", hora_fin: "07:00", es_nocturno: true, es_extendido: true, modo_cobertura: "relevo", orden: 2, activo: true },
  ];
}

async function authenticate(req: Request, admin: any) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { actor: null, profile: null };
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return { actor: null, profile: null };

  const { data: profile, error: profileError } = await admin
    .from("usuarios")
    .select("id,hotel_id,activo,rol,usuarios_roles(roles(nombre))")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  return { actor: userData.user, profile };
}

async function resolveHotel(body: any, profile: any) {
  const requested = String(body?.hotel_id || "").trim();
  if (isSuperadmin(profile)) {
    if (!requested) throw new Error("Selecciona un hotel.");
    return requested;
  }
  if (!profile?.hotel_id) throw new Error("El usuario no tiene hotel asignado.");
  if (requested && requested !== profile.hotel_id) throw new Error("No puedes gestionar horarios de otro hotel.");
  return profile.hotel_id;
}

async function ensureConfig(admin: any, hotelId: string): Promise<Config> {
  let { data: config, error } = await admin.from("horario_configuracion_v2").select("*").eq("hotel_id", hotelId).maybeSingle();
  if (error) throw error;
  if (!config) {
    const { data: legacy } = await admin.from("configuracion_hotel").select("tipo_turno_global").eq("hotel_id", hotelId).maybeSingle();
    const operation = Number(legacy?.tipo_turno_global) === 12 ? 12 : 8;
    const result = await admin.from("horario_configuracion_v2").insert({
      hotel_id: hotelId,
      tipo_operacion: operation,
      permitir_relevo_extendido: operation === 8,
    }).select("*").single();
    if (result.error) throw result.error;
    config = result.data;
  }

  const { data: existing, error: shiftError } = await admin.from("horario_turnos_v2").select("codigo").eq("hotel_id", hotelId).limit(1);
  if (shiftError) throw shiftError;
  if (!existing?.length) {
    const result = await admin.from("horario_turnos_v2").insert(defaultTemplates(Number(config.tipo_operacion)).map((item) => ({ ...item, hotel_id: hotelId })));
    if (result.error) throw result.error;
  }
  return config as Config;
}

async function loadTemplates(admin: any, hotelId: string): Promise<Shift[]> {
  const { data, error } = await admin.from("horario_turnos_v2")
    .select("codigo,nombre,hora_inicio,hora_fin,es_nocturno,es_extendido,modo_cobertura,orden,activo")
    .eq("hotel_id", hotelId).eq("activo", true).order("modo_cobertura").order("orden");
  if (error) throw error;
  return (data || []) as Shift[];
}

async function loadReceptionists(admin: any, hotelId: string): Promise<Worker[]> {
  const { data: role, error: roleError } = await admin.from("roles").select("id").ilike("nombre", "Recepcionista").limit(1).maybeSingle();
  if (roleError) throw roleError;
  if (!role) return [];
  const { data: links, error: linksError } = await admin.from("usuarios_roles").select("usuario_id").eq("hotel_id", hotelId).eq("rol_id", role.id);
  if (linksError) throw linksError;
  const ids = [...new Set((links || []).map((row: any) => row.usuario_id).filter(Boolean))];
  if (!ids.length) return [];

  const [{ data: users, error: usersError }, { data: prefs, error: prefsError }] = await Promise.all([
    admin.from("usuarios").select("id,nombre,activo").eq("hotel_id", hotelId).eq("activo", true).in("id", ids).order("nombre"),
    admin.from("configuracion_turnos").select("usuario_id,evita_turno_noche,prefiere_turno_dia").eq("hotel_id", hotelId).eq("activo", true).in("usuario_id", ids),
  ]);
  if (usersError) throw usersError;
  if (prefsError) throw prefsError;
  const prefMap = new Map((prefs || []).map((row: any) => [row.usuario_id, row]));
  return (users || []).map((user: any) => ({
    id: user.id,
    nombre: user.nombre || "Sin nombre",
    evita_turno_noche: prefMap.get(user.id)?.evita_turno_noche === true,
    prefiere_turno_dia: prefMap.get(user.id)?.prefiere_turno_dia === true,
  }));
}

async function loadRequests(admin: any, hotelId: string, start: string, end: string): Promise<RequestRow[]> {
  const { data, error } = await admin.from("horario_solicitudes_v2")
    .select("id,usuario_id,fecha,tipo,turno_codigo,obligatoria,nota")
    .eq("hotel_id", hotelId).eq("activo", true).gte("fecha", start).lte("fecha", end).order("fecha");
  if (error) throw error;
  return (data || []) as RequestRow[];
}

function templatesByMode(templates: Shift[], mode: "normal" | "relevo") {
  return templates.filter((shift) => shift.activo !== false && shift.modo_cobertura === mode).sort((a, b) => a.orden - b.orden);
}

function requestMap(requests: RequestRow[]) {
  const map = new Map<string, RequestRow[]>();
  for (const row of requests) {
    const key = `${row.fecha}|${row.usuario_id}`;
    const current = map.get(key) || [];
    current.push(row);
    map.set(key, current);
  }
  return map;
}

function chooseDayModes(dates: string[], workers: Worker[], config: Config, templates: Shift[], requests: RequestRow[]) {
  const normalCount = templatesByMode(templates, "normal").length;
  const relayCount = templatesByMode(templates, "relevo").length;
  const reqMap = requestMap(requests);
  const result: DayMode[] = [];
  const criticals: Array<Record<string, unknown>> = [];

  const groups = new Map<string, string[]>();
  dates.forEach((date) => {
    const key = mondayKey(date);
    groups.set(key, [...(groups.get(key) || []), date]);
  });

  for (const weekDates of groups.values()) {
    const workerCount = workers.length;
    const normalRest = Math.max(0, workerCount - normalCount);
    const relayRest = Math.max(0, workerCount - relayCount);
    const requiredRest = workerCount * config.dias_descanso_semana * (weekDates.length / 7);
    const baseRest = normalRest * weekDates.length;
    let relayNeeded = 0;

    if (config.tipo_operacion === 8 && config.permitir_relevo_extendido && relayCount > 0 && relayRest > normalRest) {
      relayNeeded = Math.max(0, Math.ceil((requiredRest - baseRest) / (relayRest - normalRest)));
    }

    if (workerCount < normalCount && !(config.tipo_operacion === 8 && config.permitir_relevo_extendido && workerCount >= relayCount)) {
      criticals.push({ codigo: "PERSONAL_INSUFICIENTE", semana: mondayKey(weekDates[0]), mensaje: `Hay ${workerCount} recepcionistas para ${normalCount} turnos diarios.` });
    }

    const scoredDates = weekDates.map((date, index) => {
      const mandatoryOff = workers.reduce((count, worker) => {
        const rows = reqMap.get(`${date}|${worker.id}`) || [];
        return count + (rows.some((r) => r.obligatoria && ["descanso", "no_disponible"].includes(r.tipo)) ? 1 : 0);
      }, 0);
      const spacingOrder = [1, 3, 5, 0, 2, 4, 6].indexOf(parseDate(date).getUTCDay() === 0 ? 6 : parseDate(date).getUTCDay() - 1);
      return { date, mandatoryOff, spacingOrder: spacingOrder < 0 ? index : spacingOrder };
    }).sort((a, b) => b.mandatoryOff - a.mandatoryOff || a.spacingOrder - b.spacingOrder);

    const relayDates = new Set(scoredDates.slice(0, Math.min(relayNeeded, weekDates.length)).map((x) => x.date));
    // Una ausencia obligatoria que hace imposible el modo normal fuerza relevo cuando está disponible.
    for (const item of scoredDates) {
      if (item.mandatoryOff > normalRest && config.tipo_operacion === 8 && config.permitir_relevo_extendido && relayCount > 0) {
        relayDates.add(item.date);
      }
    }

    for (const date of weekDates) {
      result.push({ fecha: date, modo_cobertura: relayDates.has(date) ? "relevo" : "normal" });
    }
  }
  return { days: result, criticals };
}

function shiftMap(templates: Shift[]) {
  return new Map(templates.map((shift) => [shift.codigo, shift]));
}

function restBetween(prevDate: string, prevShift: Shift, nextDate: string, nextShift: Shift) {
  const prev = shiftInterval(prevDate, prevShift);
  const next = shiftInterval(nextDate, nextShift);
  return (next.start - prev.end) / 3_600_000;
}

function recentNightStreak(assignments: Assignment[], workerId: string, beforeDate: string, shifts: Map<string, Shift>) {
  let streak = 0;
  let date = addDays(beforeDate, -1);
  for (let index = 0; index < 8; index += 1) {
    const row = assignments.find((item) => item.usuario_id === workerId && item.fecha === date);
    if (!row || row.tipo_asignacion !== "turno") break;
    const shift = shifts.get(row.turno_codigo || "");
    if (!shift?.es_nocturno) break;
    streak += 1;
    date = addDays(date, -1);
  }
  return streak;
}

function latestShift(assignments: Assignment[], workerId: string, beforeDate: string) {
  return assignments
    .filter((item) => item.usuario_id === workerId && item.tipo_asignacion === "turno" && item.fecha < beforeDate)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))[0] || null;
}

function candidateScore(worker: Worker, date: string, shift: Shift, assignments: Assignment[], shifts: Map<string, Shift>, requests: RequestRow[], historic: Map<string, { minutes: number; nights: number; weekends: number }>) {
  const rows = assignments.filter((item) => item.usuario_id === worker.id && item.tipo_asignacion === "turno");
  const base = historic.get(worker.id) || { minutes: 0, nights: 0, weekends: 0 };
  let minutes = base.minutes;
  let nights = base.nights;
  let weekends = base.weekends;
  rows.forEach((row) => {
    const itemShift = shifts.get(row.turno_codigo || "");
    if (!itemShift) return;
    minutes += shiftInterval(row.fecha, itemShift).minutes;
    if (itemShift.es_nocturno) nights += 1;
    if (isWeekend(row.fecha)) weekends += 1;
  });

  let score = minutes / 30;
  if (shift.es_nocturno) {
    score += nights * 110;
    if (worker.evita_turno_noche) score += 350;
    if (worker.prefiere_turno_dia) score += 160;
  }
  if (isWeekend(date)) score += weekends * 45;

  const preferences = requests.filter((request) => request.usuario_id === worker.id && request.fecha === date && !request.obligatoria);
  if (preferences.some((r) => r.tipo === "prefiere_turno" && r.turno_codigo === shift.codigo)) score -= 180;
  if (preferences.some((r) => r.tipo === "prefiere_dia" && !shift.es_nocturno)) score -= 80;
  if (preferences.some((r) => r.tipo === "prefiere_noche" && shift.es_nocturno)) score -= 80;

  // desempate determinista sin favorecer siempre el primer usuario.
  const salt = [...`${date}|${shift.codigo}|${worker.id}`].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 17;
  return score + salt;
}

async function historicStats(admin: any, hotelId: string, start: string, workers: Worker[], shifts: Map<string, Shift>) {
  const since = addDays(start, -35);
  const ids = workers.map((worker) => worker.id);
  const map = new Map<string, { minutes: number; nights: number; weekends: number }>();
  ids.forEach((id) => map.set(id, { minutes: 0, nights: 0, weekends: 0 }));
  if (!ids.length) return map;
  const { data, error } = await admin.from("turnos_programados")
    .select("fecha,usuario_id,tipo_turno")
    .eq("hotel_id", hotelId).gte("fecha", since).lt("fecha", start).in("usuario_id", ids);
  if (error) throw error;
  for (const row of data || []) {
    const shift = shifts.get(row.tipo_turno);
    if (!shift) continue;
    const stat = map.get(row.usuario_id)!;
    stat.minutes += shiftInterval(row.fecha, shift).minutes;
    if (shift.es_nocturno) stat.nights += 1;
    if (isWeekend(row.fecha)) stat.weekends += 1;
  }
  return map;
}

async function previousPublishedAssignments(admin: any, hotelId: string, start: string, workers: Worker[]) {
  const ids = workers.map((worker) => worker.id);
  if (!ids.length) return [] as Assignment[];
  const from = addDays(start, -3);
  const { data, error } = await admin.from("turnos_programados")
    .select("fecha,usuario_id,tipo_turno")
    .eq("hotel_id", hotelId).gte("fecha", from).lt("fecha", start).in("usuario_id", ids);
  if (error) throw error;
  return (data || []).map((row: any) => ({
    fecha: row.fecha,
    usuario_id: row.usuario_id,
    tipo_asignacion: row.tipo_turno === "descanso" ? "descanso" : "turno",
    turno_codigo: row.tipo_turno === "descanso" ? null : row.tipo_turno,
    bloqueado: true,
    origen: "bloqueado",
    motivo: { fuente: "horario_publicado_anterior" },
  })) as Assignment[];
}

function validateSchedule(config: Config, templates: Shift[], workers: Worker[], days: DayMode[], assignments: Assignment[], requests: RequestRow[], previous: Assignment[] = []): { validation: Validation; quality: number } {
  const shifts = shiftMap(templates);
  const criticals: Array<Record<string, unknown>> = [];
  const warnings: Array<Record<string, unknown>> = [];
  const workerMap = new Map(workers.map((worker) => [worker.id, worker]));
  const allForContinuity = [...previous, ...assignments].sort((a, b) => a.fecha.localeCompare(b.fecha));

  for (const day of days) {
    const required = templatesByMode(templates, day.modo_cobertura);
    const dayAssignments = assignments.filter((item) => item.fecha === day.fecha);
    for (const shift of required) {
      const matches = dayAssignments.filter((item) => item.tipo_asignacion === "turno" && item.turno_codigo === shift.codigo);
      if (matches.length !== 1) criticals.push({ codigo: "COBERTURA", fecha: day.fecha, turno: shift.codigo, mensaje: `${shift.nombre} debe tener exactamente una persona.` });
    }
    for (const worker of workers) {
      const rows = dayAssignments.filter((item) => item.usuario_id === worker.id);
      if (rows.length !== 1) criticals.push({ codigo: "ASIGNACION_DIARIA", fecha: day.fecha, usuario_id: worker.id, mensaje: `${worker.nombre} debe tener un turno o descanso ese día.` });
    }
  }

  for (const request of requests.filter((row) => row.obligatoria && ["descanso", "no_disponible"].includes(row.tipo))) {
    const row = assignments.find((item) => item.fecha === request.fecha && item.usuario_id === request.usuario_id);
    if (row?.tipo_asignacion !== "descanso") {
      criticals.push({ codigo: "SOLICITUD_OBLIGATORIA", fecha: request.fecha, usuario_id: request.usuario_id, mensaje: "No se respetó un descanso/no disponibilidad obligatorio." });
    }
  }

  for (const worker of workers) {
    const workerAssignments = allForContinuity.filter((item) => item.usuario_id === worker.id && item.tipo_asignacion === "turno" && shifts.has(item.turno_codigo || "")).sort((a, b) => a.fecha.localeCompare(b.fecha));
    let nightStreak = 0;
    for (let index = 0; index < workerAssignments.length; index += 1) {
      const current = workerAssignments[index];
      const currentShift = shifts.get(current.turno_codigo || "")!;
      if (currentShift.es_nocturno) nightStreak += 1; else nightStreak = 0;
      if (nightStreak > config.max_noches_consecutivas && assignments.includes(current)) {
        criticals.push({ codigo: "NOCHES_CONSECUTIVAS", fecha: current.fecha, usuario_id: worker.id, mensaje: `${worker.nombre} supera ${config.max_noches_consecutivas} noches consecutivas.` });
      }
      if (index > 0 && assignments.includes(current)) {
        const prev = workerAssignments[index - 1];
        const prevShift = shifts.get(prev.turno_codigo || "")!;
        const rest = restBetween(prev.fecha, prevShift, current.fecha, currentShift);
        if (rest < config.descanso_minimo_horas) {
          criticals.push({ codigo: "DESCANSO_MINIMO", fecha: current.fecha, usuario_id: worker.id, horas: Math.round(rest * 10) / 10, mensaje: `${worker.nombre} solo tendría ${Math.max(0, Math.round(rest * 10) / 10)}h de descanso.` });
        }
      }
    }
  }

  const weeks = new Map<string, string[]>();
  days.forEach((day) => weeks.set(mondayKey(day.fecha), [...(weeks.get(mondayKey(day.fecha)) || []), day.fecha]));
  for (const [week, weekDates] of weeks) {
    const proportionalMin = Math.floor(config.dias_descanso_semana * (weekDates.length / 7));
    if (proportionalMin < 1 && weekDates.length < 7) continue;
    for (const worker of workers) {
      const rests = assignments.filter((item) => item.usuario_id === worker.id && weekDates.includes(item.fecha) && item.tipo_asignacion === "descanso").length;
      if (rests < Math.max(1, proportionalMin)) {
        criticals.push({ codigo: "DESCANSO_SEMANAL", semana: week, usuario_id: worker.id, mensaje: `${worker.nombre} no alcanza el descanso semanal mínimo.` });
      }
    }
  }

  const metrics = workers.map((worker) => {
    const rows = assignments.filter((item) => item.usuario_id === worker.id && item.tipo_asignacion === "turno");
    const minutes = rows.reduce((sum, row) => sum + (shifts.get(row.turno_codigo || "") ? shiftInterval(row.fecha, shifts.get(row.turno_codigo || "")!).minutes : 0), 0);
    const nights = rows.filter((row) => shifts.get(row.turno_codigo || "")?.es_nocturno).length;
    const weekends = rows.filter((row) => isWeekend(row.fecha)).length;
    const rests = assignments.filter((item) => item.usuario_id === worker.id && item.tipo_asignacion === "descanso").length;
    return { usuario_id: worker.id, nombre: worker.nombre, horas: Math.round(minutes / 6) / 10, noches: nights, fines_semana: weekends, descansos: rests };
  });

  if (metrics.length > 1) {
    const hours = metrics.map((row) => row.horas);
    const nights = metrics.map((row) => row.noches);
    const weekends = metrics.map((row) => row.fines_semana);
    const hourGap = Math.max(...hours) - Math.min(...hours);
    const nightGap = Math.max(...nights) - Math.min(...nights);
    const weekendGap = Math.max(...weekends) - Math.min(...weekends);
    if (hourGap > 12) warnings.push({ codigo: "BALANCE_HORAS", diferencia: hourGap, mensaje: `Hay ${hourGap.toFixed(1)}h de diferencia entre cargas.` });
    if (config.balancear_noches && nightGap > 1) warnings.push({ codigo: "BALANCE_NOCHES", diferencia: nightGap, mensaje: "Las noches podrían repartirse de forma más equitativa." });
    if (config.balancear_fines_semana && weekendGap > 1) warnings.push({ codigo: "BALANCE_FIN_SEMANA", diferencia: weekendGap, mensaje: "Los fines de semana podrían repartirse mejor." });
  }

  const uniqueCriticals = [...new Map(criticals.map((item) => [JSON.stringify(item), item])).values()];
  const quality = Math.max(0, Math.min(100, 100 - uniqueCriticals.length * 20 - warnings.length * 4));
  return { validation: { criticos: uniqueCriticals, advertencias: warnings, metricas: { personas: metrics } }, quality };
}

async function generateDraft(admin: any, hotelId: string, actorId: string, input: any, preserveLocked: boolean) {
  const config = await ensureConfig(admin, hotelId);
  const templates = await loadTemplates(admin, hotelId);
  const allWorkers = await loadReceptionists(admin, hotelId);
  const start = String(input?.fecha_inicio || "");
  const end = String(input?.fecha_fin || "");
  const dates = dateRange(start, end);
  const selectedIds = Array.isArray(input?.usuarios) ? input.usuarios.map(String) : [];
  const workers = allWorkers.filter((worker) => !selectedIds.length || selectedIds.includes(worker.id));
  if (!workers.length) throw new Error("Selecciona al menos una recepcionista activa.");

  const requests = await loadRequests(admin, hotelId, start, end);
  const shifts = shiftMap(templates);
  const historic = await historicStats(admin, hotelId, start, workers, shifts);
  const previous = await previousPublishedAssignments(admin, hotelId, start, workers);

  let schedule: any = null;
  let locked: Assignment[] = [];
  if (input?.horario_id) {
    const result = await admin.from("horarios_v2").select("*").eq("id", input.horario_id).eq("hotel_id", hotelId).single();
    if (result.error) throw result.error;
    schedule = result.data;
    if (schedule.estado !== "borrador") throw new Error("Solo se puede reorganizar un borrador.");
    if (preserveLocked) {
      const lockResult = await admin.from("horario_asignaciones_v2").select("fecha,usuario_id,tipo_asignacion,turno_codigo,bloqueado,origen,motivo").eq("horario_id", schedule.id).eq("bloqueado", true);
      if (lockResult.error) throw lockResult.error;
      locked = (lockResult.data || []) as Assignment[];
    }
  } else {
    const result = await admin.from("horarios_v2").insert({
      hotel_id: hotelId,
      fecha_inicio: start,
      fecha_fin: end,
      periodo: input?.periodo === "mes" ? "mes" : input?.periodo === "personalizado" ? "personalizado" : "semana",
      estado: "borrador",
      creado_por: actorId,
    }).select("*").single();
    if (result.error) throw result.error;
    schedule = result.data;
  }

  const modePlan = chooseDayModes(dates, workers, config, templates, requests);
  const assignments: Assignment[] = [];
  const reqMap = requestMap(requests);
  const lockedMap = new Map(locked.map((row) => [`${row.fecha}|${row.usuario_id}`, row]));

  for (const date of dates) {
    const day = modePlan.days.find((item) => item.fecha === date)!;
    const requiredShifts = templatesByMode(templates, day.modo_cobertura).sort((a, b) => Number(b.es_nocturno) - Number(a.es_nocturno) || a.orden - b.orden);
    const dayRows: Assignment[] = [];
    const occupiedShiftCodes = new Set<string>();
    const assignedUsers = new Set<string>();

    // Los bloqueos manuales son la primera restricción del reorganizador.
    for (const worker of workers) {
      const lockedRow = lockedMap.get(`${date}|${worker.id}`);
      if (!lockedRow) continue;
      const copy = { ...lockedRow, bloqueado: true, origen: "bloqueado" as const };
      dayRows.push(copy);
      assignedUsers.add(worker.id);
      if (copy.tipo_asignacion === "turno" && copy.turno_codigo) occupiedShiftCodes.add(copy.turno_codigo);
    }

    const mandatoryOff = new Set(workers.filter((worker) => (reqMap.get(`${date}|${worker.id}`) || []).some((r) => r.obligatoria && ["descanso", "no_disponible"].includes(r.tipo))).map((worker) => worker.id));
    for (const workerId of mandatoryOff) {
      if (assignedUsers.has(workerId)) continue;
      dayRows.push({ fecha: date, usuario_id: workerId, tipo_asignacion: "descanso", turno_codigo: null, bloqueado: false, origen: "auto", motivo: { regla: "solicitud_obligatoria" } });
      assignedUsers.add(workerId);
    }

    for (const shift of requiredShifts) {
      if (occupiedShiftCodes.has(shift.codigo)) continue;
      const candidates = workers.filter((worker) => {
        if (assignedUsers.has(worker.id) || mandatoryOff.has(worker.id)) return false;
        const prev = latestShift([...previous, ...assignments, ...dayRows], worker.id, date);
        if (prev) {
          const prevShift = shifts.get(prev.turno_codigo || "");
          if (prevShift && restBetween(prev.fecha, prevShift, date, shift) < config.descanso_minimo_horas) return false;
        }
        if (shift.es_nocturno && recentNightStreak([...previous, ...assignments, ...dayRows], worker.id, date, shifts) >= config.max_noches_consecutivas) return false;

        // No generar un turno que haga imposible un turno manual bloqueado del día siguiente.
        const nextLocked = lockedMap.get(`${addDays(date, 1)}|${worker.id}`);
        if (nextLocked?.tipo_asignacion === "turno") {
          const nextShift = shifts.get(nextLocked.turno_codigo || "");
          if (nextShift && restBetween(date, shift, nextLocked.fecha, nextShift) < config.descanso_minimo_horas) return false;
        }
        return true;
      }).sort((a, b) => candidateScore(a, date, shift, [...assignments, ...dayRows], shifts, requests, historic) - candidateScore(b, date, shift, [...assignments, ...dayRows], shifts, requests, historic));

      const selected = candidates[0];
      if (!selected) continue;
      dayRows.push({
        fecha: date,
        usuario_id: selected.id,
        tipo_asignacion: "turno",
        turno_codigo: shift.codigo,
        bloqueado: false,
        origen: "auto",
        motivo: { regla: "balance_y_descanso", turno: shift.codigo },
      });
      assignedUsers.add(selected.id);
      occupiedShiftCodes.add(shift.codigo);
    }

    for (const worker of workers) {
      if (!assignedUsers.has(worker.id)) {
        dayRows.push({ fecha: date, usuario_id: worker.id, tipo_asignacion: "descanso", turno_codigo: null, bloqueado: false, origen: "auto", motivo: { regla: "balance_descanso" } });
      }
    }
    assignments.push(...dayRows);
  }

  const checked = validateSchedule(config, templates, workers, modePlan.days, assignments, requests, previous);
  checked.validation.criticos.unshift(...modePlan.criticals);
  const quality = Math.max(0, checked.quality - modePlan.criticals.length * 20);
  const snapshot = {
    tipo_operacion: config.tipo_operacion,
    descanso_minimo_horas: config.descanso_minimo_horas,
    dias_descanso_semana: config.dias_descanso_semana,
    max_noches_consecutivas: config.max_noches_consecutivas,
    permitir_relevo_extendido: config.permitir_relevo_extendido,
    plantillas: templates,
  };

  const save = await admin.rpc("horario_guardar_borrador_v2", {
    p_horario_id: schedule.id,
    p_participantes: workers.map((worker) => worker.id),
    p_dias: modePlan.days,
    p_asignaciones: assignments,
    p_validacion: checked.validation,
    p_calidad: quality,
    p_reglas_snapshot: snapshot,
  });
  if (save.error) throw save.error;

  return { horario: save.data, dias: modePlan.days, asignaciones: assignments, validacion: checked.validation, calidad: quality, trabajadores: workers, turnos: templates };
}

async function loadFullSchedule(admin: any, hotelId: string, scheduleId: string) {
  const scheduleResult = await admin.from("horarios_v2").select("*").eq("id", scheduleId).eq("hotel_id", hotelId).single();
  if (scheduleResult.error) throw scheduleResult.error;
  const schedule = scheduleResult.data;
  const [assignmentsResult, daysResult, participantsResult, templatesResult, configResult] = await Promise.all([
    admin.from("horario_asignaciones_v2").select("fecha,usuario_id,tipo_asignacion,turno_codigo,bloqueado,origen,motivo").eq("horario_id", scheduleId).order("fecha"),
    admin.from("horario_dias_v2").select("fecha,modo_cobertura").eq("horario_id", scheduleId).order("fecha"),
    admin.from("horario_participantes_v2").select("usuario_id").eq("horario_id", scheduleId),
    loadTemplates(admin, hotelId),
    ensureConfig(admin, hotelId),
  ]);
  if (assignmentsResult.error) throw assignmentsResult.error;
  if (daysResult.error) throw daysResult.error;
  if (participantsResult.error) throw participantsResult.error;
  const ids = (participantsResult.data || []).map((row: any) => row.usuario_id);
  const workers = (await loadReceptionists(admin, hotelId)).filter((worker) => ids.includes(worker.id));
  const requests = await loadRequests(admin, hotelId, schedule.fecha_inicio, schedule.fecha_fin);
  const previous = await previousPublishedAssignments(admin, hotelId, schedule.fecha_inicio, workers);
  return { schedule, assignments: assignmentsResult.data as Assignment[], days: daysResult.data as DayMode[], workers, templates: templatesResult as Shift[], config: configResult as Config, requests, previous };
}

async function revalidate(admin: any, hotelId: string, scheduleId: string) {
  const full = await loadFullSchedule(admin, hotelId, scheduleId);
  const checked = validateSchedule(full.config, full.templates, full.workers, full.days, full.assignments, full.requests, full.previous);
  const { error } = await admin.from("horarios_v2").update({ validacion: checked.validation, calidad: checked.quality, actualizado_en: new Date().toISOString() }).eq("id", scheduleId).eq("hotel_id", hotelId).eq("estado", "borrador");
  if (error) throw error;
  return { ...full, validacion: checked.validation, calidad: checked.quality };
}

async function configure(admin: any, hotelId: string, body: any) {
  const current = await ensureConfig(admin, hotelId);
  const requestedOperation = Number(body?.config?.tipo_operacion ?? current.tipo_operacion);
  if (![8, 12].includes(requestedOperation)) throw new Error("Tipo de operación inválido.");
  const next = {
    tipo_operacion: requestedOperation,
    descanso_minimo_horas: Number(body?.config?.descanso_minimo_horas ?? current.descanso_minimo_horas),
    dias_descanso_semana: Number(body?.config?.dias_descanso_semana ?? current.dias_descanso_semana),
    max_noches_consecutivas: Number(body?.config?.max_noches_consecutivas ?? current.max_noches_consecutivas),
    balancear_noches: body?.config?.balancear_noches !== false,
    balancear_fines_semana: body?.config?.balancear_fines_semana !== false,
    permitir_relevo_extendido: requestedOperation === 8 && body?.config?.permitir_relevo_extendido !== false,
    actualizado_en: new Date().toISOString(),
  };
  const configResult = await admin.from("horario_configuracion_v2").update(next).eq("hotel_id", hotelId).select("*").single();
  if (configResult.error) throw configResult.error;

  const operationChanged = Number(current.tipo_operacion) !== requestedOperation;
  const suppliedTemplates = Array.isArray(body?.turnos) ? body.turnos : null;
  if (operationChanged || suppliedTemplates) {
    const templates = suppliedTemplates || defaultTemplates(requestedOperation);
    if (!templates.length) throw new Error("Debe existir al menos una plantilla de turno.");
    const deleteResult = await admin.from("horario_turnos_v2").delete().eq("hotel_id", hotelId);
    if (deleteResult.error) throw deleteResult.error;
    const clean = templates.map((item: any, index: number) => ({
      hotel_id: hotelId,
      codigo: String(item.codigo || "").trim(),
      nombre: String(item.nombre || "").trim(),
      hora_inicio: String(item.hora_inicio || "").slice(0, 5),
      hora_fin: String(item.hora_fin || "").slice(0, 5),
      es_nocturno: item.es_nocturno === true,
      es_extendido: item.es_extendido === true,
      modo_cobertura: item.modo_cobertura === "relevo" ? "relevo" : "normal",
      orden: Number(item.orden ?? index + 1),
      activo: item.activo !== false,
    }));
    if (clean.some((item: any) => !item.codigo || !item.nombre || !/^\d{2}:\d{2}$/.test(item.hora_inicio) || !/^\d{2}:\d{2}$/.test(item.hora_fin))) {
      throw new Error("Hay una plantilla de turno incompleta.");
    }
    const insertResult = await admin.from("horario_turnos_v2").insert(clean);
    if (insertResult.error) throw insertResult.error;
  }
  return { config: configResult.data, turnos: await loadTemplates(admin, hotelId) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceKey) return json({ error: "Configuración del servidor incompleta." }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const { actor, profile } = await authenticate(req, admin);
    if (!actor) return json({ error: "Sesión inválida." }, 401);
    if (!profile || !isAdmin(profile)) return json({ error: "Solo un administrador activo puede gestionar horarios." }, 403);
    const body = await req.json().catch(() => ({}));
    const action = normalize(body?.action);
    const hotelId = await resolveHotel(body, profile);

    if (action === "bootstrap") {
      const config = await ensureConfig(admin, hotelId);
      const workers = await loadReceptionists(admin, hotelId);
      const templates = await loadTemplates(admin, hotelId);
      const start = String(body?.fecha_inicio || isoDate(new Date()));
      const end = String(body?.fecha_fin || addDays(start, 31));
      const requests = await loadRequests(admin, hotelId, start, end);
      const { data: drafts, error } = await admin.from("horarios_v2").select("id,fecha_inicio,fecha_fin,periodo,estado,calidad,validacion,actualizado_en").eq("hotel_id", hotelId).order("actualizado_en", { ascending: false }).limit(12);
      if (error) throw error;
      return json({ ok: true, config, trabajadores: workers, turnos: templates, solicitudes: requests, horarios: drafts || [] });
    }

    if (action === "configure") return json({ ok: true, ...(await configure(admin, hotelId, body)) });

    if (action === "generate") {
      const result = await generateDraft(admin, hotelId, actor.id, body, false);
      return json({ ok: true, ...result });
    }

    if (action === "reorganize") {
      if (!body?.horario_id) return json({ error: "Falta horario_id." }, 400);
      const full = await loadFullSchedule(admin, hotelId, String(body.horario_id));
      const result = await generateDraft(admin, hotelId, actor.id, {
        ...body,
        horario_id: body.horario_id,
        fecha_inicio: full.schedule.fecha_inicio,
        fecha_fin: full.schedule.fecha_fin,
        periodo: full.schedule.periodo,
        usuarios: full.workers.map((worker) => worker.id),
      }, true);
      return json({ ok: true, ...result });
    }

    if (action === "get") {
      if (!body?.horario_id) return json({ error: "Falta horario_id." }, 400);
      const full = await loadFullSchedule(admin, hotelId, String(body.horario_id));
      return json({ ok: true, horario: full.schedule, asignaciones: full.assignments, dias: full.days, trabajadores: full.workers, turnos: full.templates, solicitudes: full.requests });
    }

    if (action === "validate") {
      if (!body?.horario_id) return json({ error: "Falta horario_id." }, 400);
      const checked = await revalidate(admin, hotelId, String(body.horario_id));
      return json({ ok: true, horario: checked.schedule, validacion: checked.validacion, calidad: checked.calidad, asignaciones: checked.assignments, dias: checked.days, trabajadores: checked.workers, turnos: checked.templates });
    }

    if (action === "set_assignment") {
      const scheduleId = String(body?.horario_id || "");
      const userId = String(body?.usuario_id || "");
      const date = String(body?.fecha || "");
      const value = String(body?.turno_codigo || "descanso");
      if (!scheduleId || !userId || !date) return json({ error: "Asignación incompleta." }, 400);
      const full = await loadFullSchedule(admin, hotelId, scheduleId);
      if (full.schedule.estado !== "borrador") return json({ error: "El horario ya no es borrador." }, 409);
      if (!full.workers.some((worker) => worker.id === userId)) return json({ error: "La persona no participa en este horario." }, 409);
      if (!full.days.some((day) => day.fecha === date)) return json({ error: "La fecha no pertenece al horario." }, 409);
      if (value !== "descanso") {
        const day = full.days.find((item) => item.fecha === date)!;
        const allowed = templatesByMode(full.templates, day.modo_cobertura).some((shift) => shift.codigo === value);
        if (!allowed) return json({ error: "Ese turno no corresponde al modo de cobertura del día." }, 409);
        const occupied = full.assignments.find((item) => item.fecha === date && item.tipo_asignacion === "turno" && item.turno_codigo === value && item.usuario_id !== userId);
        if (occupied) return json({ error: "Ese turno ya está asignado. Cambia primero a la persona que lo ocupa." }, 409);
      }
      const update = await admin.from("horario_asignaciones_v2").update({
        tipo_asignacion: value === "descanso" ? "descanso" : "turno",
        turno_codigo: value === "descanso" ? null : value,
        origen: "manual",
        motivo: { regla: "edicion_manual", actor: actor.id },
        actualizado_en: new Date().toISOString(),
      }).eq("horario_id", scheduleId).eq("hotel_id", hotelId).eq("fecha", date).eq("usuario_id", userId);
      if (update.error) throw update.error;
      const checked = await revalidate(admin, hotelId, scheduleId);
      return json({ ok: true, validacion: checked.validacion, calidad: checked.calidad, asignaciones: checked.assignments });
    }

    if (action === "toggle_lock") {
      const scheduleId = String(body?.horario_id || "");
      const userId = String(body?.usuario_id || "");
      const date = String(body?.fecha || "");
      const locked = body?.bloqueado === true;
      const full = await loadFullSchedule(admin, hotelId, scheduleId);
      if (full.schedule.estado !== "borrador") return json({ error: "El horario ya no es borrador." }, 409);
      const update = await admin.from("horario_asignaciones_v2").update({ bloqueado: locked, origen: locked ? "bloqueado" : "manual", actualizado_en: new Date().toISOString() }).eq("horario_id", scheduleId).eq("hotel_id", hotelId).eq("fecha", date).eq("usuario_id", userId);
      if (update.error) throw update.error;
      return json({ ok: true, bloqueado: locked });
    }

    if (action === "save_request") {
      const userId = String(body?.usuario_id || "");
      const date = String(body?.fecha || "");
      const type = String(body?.tipo || "");
      if (!userId || !date || !["descanso", "no_disponible", "prefiere_dia", "prefiere_noche", "prefiere_turno"].includes(type)) return json({ error: "Solicitud inválida." }, 400);
      const activeWorkers = await loadReceptionists(admin, hotelId);
      if (!activeWorkers.some((worker) => worker.id === userId)) return json({ error: "La persona no es una recepcionista activa." }, 409);
      const insert = await admin.from("horario_solicitudes_v2").insert({
        hotel_id: hotelId,
        usuario_id: userId,
        fecha: date,
        tipo: type,
        turno_codigo: type === "prefiere_turno" ? String(body?.turno_codigo || "") : null,
        obligatoria: body?.obligatoria === true,
        nota: String(body?.nota || "").trim() || null,
        creado_por: actor.id,
      }).select("*").single();
      if (insert.error) throw insert.error;
      return json({ ok: true, solicitud: insert.data });
    }

    if (action === "delete_request") {
      const id = String(body?.solicitud_id || "");
      const result = await admin.from("horario_solicitudes_v2").update({ activo: false, actualizado_en: new Date().toISOString() }).eq("id", id).eq("hotel_id", hotelId);
      if (result.error) throw result.error;
      return json({ ok: true });
    }

    if (action === "publish") {
      const scheduleId = String(body?.horario_id || "");
      if (!scheduleId) return json({ error: "Falta horario_id." }, 400);
      const checked = await revalidate(admin, hotelId, scheduleId);
      if (checked.validation.criticos.length) return json({ error: "El horario tiene conflictos críticos y no puede publicarse.", code: "SCHEDULE_HAS_CONFLICTS", validacion: checked.validation }, 409);
      const publish = await admin.rpc("horario_publicar_v2", { p_horario_id: scheduleId, p_actor_id: actor.id });
      if (publish.error) throw publish.error;
      return json({ ok: true, horario: publish.data, validacion: checked.validation, calidad: checked.calidad });
    }

    return json({ error: "Acción no reconocida." }, 400);
  } catch (error) {
    console.error("[schedule-generator-v2]", error);
    return json({ error: error instanceof Error ? error.message : "Error interno del creador de horarios." }, 500);
  }
});
