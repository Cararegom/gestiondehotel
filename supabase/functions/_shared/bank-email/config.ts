import type { BankEmailConfig, BankEmailRuntimeConfig } from "./types.ts";

export type EnvironmentSource =
  | Readonly<Record<string, string | undefined>>
  | { get(name: string): string | undefined };

const DEFAULT_MIN_AMOUNT_COP = 1;
const DEFAULT_MAX_AMOUNT_COP = 100_000_000;
const DEFAULT_MATCH_WINDOW_MINUTES = 30;
const HARD_MAX_AMOUNT_COP = 100_000_000;
const HARD_MAX_MATCH_WINDOW_MINUTES = 1_440;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function runtimeEnvironment(): EnvironmentSource {
  const runtime = globalThis as typeof globalThis & {
    Deno?: { env?: { get(name: string): string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };

  const denoEnvironment = runtime.Deno?.env;
  if (denoEnvironment) return denoEnvironment;
  return runtime.process?.env ?? {};
}

export function readEnvironmentValue(source: EnvironmentSource, name: string): string | undefined {
  if ("get" in source && typeof source.get === "function") return source.get(name);
  return (source as Readonly<Record<string, string | undefined>>)[name];
}

export function parseStrictBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  if (!/^\d+$/.test(value.trim())) return fallback;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function readBankEmailConfig(source: EnvironmentSource = runtimeEnvironment()): BankEmailRuntimeConfig {
  // Gmail can use a dedicated OAuth client without replacing the shared
  // GOOGLE_* credentials used by the existing Calendar integration. Keep the
  // shared names as a backwards-compatible fallback for current deployments.
  const gmailClientId = readEnvironmentValue(source, "GMAIL_OAUTH_CLIENT_ID")
    ?? readEnvironmentValue(source, "GOOGLE_CLIENT_ID");
  const gmailClientSecret = readEnvironmentValue(source, "GMAIL_OAUTH_CLIENT_SECRET")
    ?? readEnvironmentValue(source, "GOOGLE_CLIENT_SECRET");
  const gmailRedirectUri = readEnvironmentValue(source, "GMAIL_OAUTH_REDIRECT_URI")
    ?? readEnvironmentValue(source, "GOOGLE_REDIRECT_URI");
  const minAmountCop = Math.min(parsePositiveInteger(
    readEnvironmentValue(source, "BANK_EMAIL_MIN_AMOUNT_COP"),
    DEFAULT_MIN_AMOUNT_COP,
  ), HARD_MAX_AMOUNT_COP);
  const configuredMax = parsePositiveInteger(
    readEnvironmentValue(source, "BANK_EMAIL_MAX_AMOUNT_COP"),
    DEFAULT_MAX_AMOUNT_COP,
  );

  return {
    enabled: parseStrictBoolean(readEnvironmentValue(source, "BANK_EMAIL_INTEGRATION_ENABLED")),
    pilotHotelId: (readEnvironmentValue(source, "BANK_EMAIL_PILOT_HOTEL_ID") ?? "").trim().toLowerCase(),
    pilotHotelName: (readEnvironmentValue(source, "BANK_EMAIL_PILOT_HOTEL_NAME") ?? "").trim(),
    gmailPaymentLabel: (readEnvironmentValue(source, "GMAIL_PAYMENT_LABEL") ?? "PAGOS HOTEL MARENA").trim(),
    minAmountCop,
    maxAmountCop: Math.min(Math.max(configuredMax, minAmountCop), HARD_MAX_AMOUNT_COP),
    matchWindowMinutes: Math.min(parsePositiveInteger(
      readEnvironmentValue(source, "BANK_EMAIL_MATCH_WINDOW_MINUTES"),
      DEFAULT_MATCH_WINDOW_MINUTES,
    ), HARD_MAX_MATCH_WINDOW_MINUTES),
    googleClientId: (gmailClientId ?? "").trim(),
    googleClientSecret: (gmailClientSecret ?? "").trim(),
    googleRedirectUri: (gmailRedirectUri ?? "").trim(),
    googlePubSubTopic: (readEnvironmentValue(source, "GOOGLE_PUBSUB_TOPIC") ?? "").trim(),
    googlePubSubVerificationAudience: (
      readEnvironmentValue(source, "GOOGLE_PUBSUB_VERIFICATION_AUDIENCE") ?? ""
    ).trim(),
    googleServiceAccountEmail: (readEnvironmentValue(source, "GOOGLE_SERVICE_ACCOUNT_EMAIL") ?? "")
      .trim()
      .toLowerCase(),
    bankTokenEncryptionKey: (readEnvironmentValue(source, "BANK_TOKEN_ENCRYPTION_KEY") ?? "").trim(),
    cronSecret: (readEnvironmentValue(source, "CRON_SECRET") ?? "").trim(),
  };
}

export function assertBankEmailConfig(config: BankEmailConfig): void {
  if (!UUID_PATTERN.test(config.pilotHotelId || "")) {
    throw new Error("BANK_EMAIL_PILOT_HOTEL_ID must be a valid UUID.");
  }
  if (!config.pilotHotelName) {
    throw new Error("BANK_EMAIL_PILOT_HOTEL_NAME is required as a descriptive cross-check.");
  }
  if (!config.gmailPaymentLabel) {
    throw new Error("GMAIL_PAYMENT_LABEL is required.");
  }
  if (!Number.isSafeInteger(config.minAmountCop) || config.minAmountCop <= 0) {
    throw new Error("BANK_EMAIL_MIN_AMOUNT_COP must be a positive integer.");
  }
  if (!Number.isSafeInteger(config.maxAmountCop) || config.maxAmountCop < config.minAmountCop) {
    throw new Error("BANK_EMAIL_MAX_AMOUNT_COP must be an integer greater than or equal to the minimum.");
  }
}

export function isBankEmailProcessingEnabled(config: BankEmailConfig): boolean {
  return config.enabled && UUID_PATTERN.test(config.pilotHotelId || "") && Boolean(config.pilotHotelName);
}

function assertPresent(value: string, environmentName: string): void {
  if (!value) throw new Error(`${environmentName} is required.`);
}

export function assertGoogleOAuthConfig(config: BankEmailRuntimeConfig): void {
  assertPresent(config.googleClientId, "GMAIL_OAUTH_CLIENT_ID (or GOOGLE_CLIENT_ID)");
  assertPresent(config.googleClientSecret, "GMAIL_OAUTH_CLIENT_SECRET (or GOOGLE_CLIENT_SECRET)");
  assertPresent(config.googleRedirectUri, "GMAIL_OAUTH_REDIRECT_URI (or GOOGLE_REDIRECT_URI)");
  assertPresent(config.bankTokenEncryptionKey, "BANK_TOKEN_ENCRYPTION_KEY");
}

export function assertGooglePubSubConfig(config: BankEmailRuntimeConfig): void {
  assertPresent(config.googlePubSubTopic, "GOOGLE_PUBSUB_TOPIC");
  assertPresent(config.googlePubSubVerificationAudience, "GOOGLE_PUBSUB_VERIFICATION_AUDIENCE");
  assertPresent(config.googleServiceAccountEmail, "GOOGLE_SERVICE_ACCOUNT_EMAIL");
}

export function assertCronConfig(config: BankEmailRuntimeConfig): void {
  assertPresent(config.cronSecret, "CRON_SECRET");
}
