import type { PilotHotel } from "./types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface HotelQueryResult {
  data: unknown;
  error?: { message?: string } | null;
}

interface HotelQueryBuilder extends PromiseLike<HotelQueryResult> {
  ilike(column: string, pattern: string): HotelQueryBuilder;
  eq(column: string, value: string): HotelQueryBuilder;
}

export interface PilotHotelSupabaseClient {
  from(table: "hoteles"): {
    select(columns: "id,nombre"): HotelQueryBuilder;
  };
}

export class PilotHotelResolutionError extends Error {
  readonly code:
    | "PILOT_HOTEL_NOT_FOUND"
    | "PILOT_HOTEL_AMBIGUOUS"
    | "PILOT_HOTEL_QUERY_FAILED"
    | "PILOT_HOTEL_ID_REQUIRED"
    | "PILOT_HOTEL_ID_INVALID"
    | "PILOT_HOTEL_ID_NAME_MISMATCH";
  readonly matchCount: number;

  constructor(
    code: PilotHotelResolutionError["code"],
    message: string,
    matchCount = 0,
  ) {
    super(message);
    this.name = "PilotHotelResolutionError";
    this.code = code;
    this.matchCount = matchCount;
  }
}

export function normalizeHotelName(value: unknown): string {
  return typeof value === "string"
    ? value.trim().normalize("NFKC").toLocaleLowerCase("es-CO")
    : "";
}

function isPilotHotelRow(value: unknown): value is PilotHotel {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && row.id.length > 0 && typeof row.nombre === "string";
}

function edgeRuntimePilotHotelId(): { strict: boolean; value: string } {
  const runtime = globalThis as typeof globalThis & {
    Deno?: { env?: { get(name: string): string | undefined } };
  };
  const environment = runtime.Deno?.env;
  if (!environment || typeof environment.get !== "function") {
    return { strict: false, value: "" };
  }
  return {
    strict: true,
    value: (environment.get("BANK_EMAIL_PILOT_HOTEL_ID") ?? "").trim(),
  };
}

async function resolvePilotById(
  supabase: PilotHotelSupabaseClient,
  configuredName: string,
  configuredId: string,
): Promise<PilotHotel> {
  if (!configuredId) {
    throw new PilotHotelResolutionError(
      "PILOT_HOTEL_ID_REQUIRED",
      "BANK_EMAIL_PILOT_HOTEL_ID is required in the Edge Function runtime.",
    );
  }
  if (!UUID_PATTERN.test(configuredId)) {
    throw new PilotHotelResolutionError(
      "PILOT_HOTEL_ID_INVALID",
      "BANK_EMAIL_PILOT_HOTEL_ID must be a valid UUID.",
    );
  }

  const { data, error } = await supabase
    .from("hoteles")
    .select("id,nombre")
    .eq("id", configuredId);

  if (error) {
    throw new PilotHotelResolutionError(
      "PILOT_HOTEL_QUERY_FAILED",
      `Could not resolve the pilot hotel by UUID: ${error.message ?? "unknown query error"}`,
    );
  }

  const rows = Array.isArray(data) ? data.filter(isPilotHotelRow) : [];
  const matches = rows.filter((row) => row.id === configuredId);
  if (matches.length === 0) {
    throw new PilotHotelResolutionError(
      "PILOT_HOTEL_NOT_FOUND",
      "No hotel matches BANK_EMAIL_PILOT_HOTEL_ID.",
    );
  }
  if (matches.length !== 1) {
    throw new PilotHotelResolutionError(
      "PILOT_HOTEL_AMBIGUOUS",
      `BANK_EMAIL_PILOT_HOTEL_ID matched ${matches.length} hotels.`,
      matches.length,
    );
  }

  const requestedName = normalizeHotelName(configuredName);
  if (requestedName && normalizeHotelName(matches[0].nombre) !== requestedName) {
    throw new PilotHotelResolutionError(
      "PILOT_HOTEL_ID_NAME_MISMATCH",
      "BANK_EMAIL_PILOT_HOTEL_ID does not match BANK_EMAIL_PILOT_HOTEL_NAME.",
    );
  }

  return { id: matches[0].id, nombre: matches[0].nombre.trim() };
}

export async function getPilotHotel(
  supabase: PilotHotelSupabaseClient,
  configuredName: string,
  configuredId?: string,
): Promise<PilotHotel> {
  const runtimeGate = edgeRuntimePilotHotelId();
  if (configuredId !== undefined || runtimeGate.strict) {
    return resolvePilotById(
      supabase,
      configuredName,
      (configuredId ?? runtimeGate.value).trim(),
    );
  }

  // Legacy resolver retained only for non-Edge tooling/tests. Supabase Edge Functions
  // always enter the strict UUID branch above and therefore fail closed without ID.
  const requestedName = configuredName.trim();
  const normalizedRequestedName = normalizeHotelName(requestedName);
  if (!normalizedRequestedName) {
    throw new PilotHotelResolutionError(
      "PILOT_HOTEL_NOT_FOUND",
      "The pilot hotel name is not configured.",
    );
  }

  const { data, error } = await supabase
    .from("hoteles")
    .select("id,nombre")
    .ilike("nombre", `%${requestedName}%`);

  if (error) {
    throw new PilotHotelResolutionError(
      "PILOT_HOTEL_QUERY_FAILED",
      `Could not resolve the pilot hotel: ${error.message ?? "unknown query error"}`,
    );
  }

  const rows = Array.isArray(data) ? data.filter(isPilotHotelRow) : [];
  const matches = rows.filter((row) => normalizeHotelName(row.nombre) === normalizedRequestedName);

  if (matches.length === 0) {
    throw new PilotHotelResolutionError(
      "PILOT_HOTEL_NOT_FOUND",
      `No hotel matches the normalized pilot name "${requestedName}".`,
    );
  }
  if (matches.length !== 1) {
    throw new PilotHotelResolutionError(
      "PILOT_HOTEL_AMBIGUOUS",
      `The normalized pilot name "${requestedName}" matched ${matches.length} hotels.`,
      matches.length,
    );
  }

  return { id: matches[0].id, nombre: matches[0].nombre.trim() };
}

export function assertPilotHotelScope(hotelId: string, pilotHotel: PilotHotel): void {
  if (!hotelId || hotelId !== pilotHotel.id) {
    throw new Error("BANK_EMAIL_OUTSIDE_PILOT_HOTEL");
  }
}

export function isPilotHotelScope(hotelId: string | null | undefined, pilotHotel: PilotHotel): boolean {
  return Boolean(hotelId) && hotelId === pilotHotel.id;
}
