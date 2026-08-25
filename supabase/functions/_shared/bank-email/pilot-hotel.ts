import type { PilotHotel } from "./types.ts";

interface HotelQueryResult {
  data: unknown;
  error?: { message?: string } | null;
}

interface HotelQueryBuilder extends PromiseLike<HotelQueryResult> {
  ilike(column: string, pattern: string): HotelQueryBuilder;
}

export interface PilotHotelSupabaseClient {
  from(table: "hoteles"): {
    select(columns: "id,nombre"): HotelQueryBuilder;
  };
}

export class PilotHotelResolutionError extends Error {
  readonly code: "PILOT_HOTEL_NOT_FOUND" | "PILOT_HOTEL_AMBIGUOUS" | "PILOT_HOTEL_QUERY_FAILED";
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

export async function getPilotHotel(
  supabase: PilotHotelSupabaseClient,
  configuredName: string,
): Promise<PilotHotel> {
  const requestedName = configuredName.trim();
  const normalizedRequestedName = normalizeHotelName(requestedName);
  if (!normalizedRequestedName) {
    throw new PilotHotelResolutionError(
      "PILOT_HOTEL_NOT_FOUND",
      "The pilot hotel name is not configured.",
    );
  }

  // The surrounding wildcards tolerate legacy leading/trailing spaces. The exact,
  // normalized comparison below remains authoritative and detects ambiguity.
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
