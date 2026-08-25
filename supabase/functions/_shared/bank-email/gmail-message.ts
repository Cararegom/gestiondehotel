import type {
  AuthenticationVerdict,
  BankSenderRule,
  EmailAuthentication,
  GmailMessageHeader,
  GmailMessagePart,
  GmailMessageResource,
  NormalizedEmail,
  SenderValidationResult,
} from "./types.ts";

type HeaderRecord = Record<string, string[]>;

function decodeBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function decodeBase64UrlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function decodeBase64UrlText(value: string): string {
  return decodeBytes(decodeBase64UrlBytes(value));
}

function decodeEncodedWord(match: string, _charset: string, encoding: string, encoded: string): string {
  try {
    if (encoding.toLowerCase() === "b") {
      const normalized = encoded.replace(/\s/g, "");
      const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
      return decodeBytes(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
    }

    const quoted = encoded.replace(/_/g, " ");
    const bytes: number[] = [];
    for (let index = 0; index < quoted.length; index += 1) {
      if (quoted[index] === "=" && /^[0-9a-f]{2}$/i.test(quoted.slice(index + 1, index + 3))) {
        bytes.push(Number.parseInt(quoted.slice(index + 1, index + 3), 16));
        index += 2;
      } else {
        bytes.push(quoted.charCodeAt(index));
      }
    }
    return decodeBytes(Uint8Array.from(bytes));
  } catch {
    return match;
  }
}

export function decodeMimeHeader(value: string): string {
  return value
    .replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, decodeEncodedWord)
    .replace(/\?=\s+=\?/g, "?==?")
    .trim();
}

export function normalizeHeaders(headers: GmailMessageHeader[] | null | undefined): HeaderRecord {
  const normalized: HeaderRecord = {};
  for (const header of headers ?? []) {
    const name = header.name?.trim().toLowerCase();
    if (!name) continue;
    const value = decodeMimeHeader(header.value ?? "");
    (normalized[name] ??= []).push(value);
  }
  return normalized;
}

export function getHeader(
  headers: Readonly<Record<string, readonly string[]>>,
  name: string,
): string | null {
  return headers[name.trim().toLowerCase()]?.[0] ?? null;
}

export function getAllHeaders(
  headers: Readonly<Record<string, readonly string[]>>,
  name: string,
): string[] {
  return [...(headers[name.trim().toLowerCase()] ?? [])];
}

export function extractMailboxAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const bracketed = value.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/);
  const bare = value.match(/(?:^|[\s,(])([^\s,<>"()]+@[^\s,<>"()]+)(?:$|[\s,)])/);
  const candidate = (bracketed?.[1] ?? bare?.[1] ?? "").replace(/^mailto:/i, "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function normalizeDomain(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/^@/, "").replace(/[>;),]+$/, "") ?? "";
  return normalized && /^[a-z0-9.-]+$/.test(normalized) ? normalized : null;
}

function domainOf(address: string | null): string | null {
  return address ? normalizeDomain(address.slice(address.lastIndexOf("@") + 1)) : null;
}

function domainMatches(domain: string | null, allowedDomains: readonly string[]): boolean {
  if (!domain) return false;
  return allowedDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

function collectVerdicts(raw: string, mechanism: "spf" | "dkim" | "dmarc"): AuthenticationVerdict[] {
  const expression = new RegExp(String.raw`(?:^|[\s;])${mechanism}=([a-z]+)`, "giu");
  return [...raw.matchAll(expression)].map((match) => {
    const value = match[1].toLowerCase();
    return ["pass", "fail", "softfail", "neutral", "none", "temperror", "permerror"].includes(value)
      ? value as AuthenticationVerdict
      : "unknown";
  });
}

function resolveVerdict(values: AuthenticationVerdict[]): AuthenticationVerdict {
  if (values.includes("fail")) return "fail";
  if (values.includes("permerror")) return "permerror";
  if (values.includes("temperror")) return "temperror";
  if (values.includes("softfail")) return "softfail";
  if (values.includes("pass")) return "pass";
  return values[0] ?? "unknown";
}

function extractAuthDomain(raw: string, expression: RegExp): string | null {
  const match = raw.match(expression);
  return normalizeDomain(match?.[1]);
}

export function parseAuthenticationResults(
  headers: Readonly<Record<string, readonly string[]>>,
): EmailAuthentication {
  // Only Gmail's own authentication boundary is authoritative. A sender can
  // inject Authentication-Results/Received-SPF headers before delivery, so
  // untrusted authserv-id values must never contribute a "pass" verdict.
  const [topmostAuthenticationResults] = getAllHeaders(headers, "authentication-results");
  const authenticationResults = topmostAuthenticationResults &&
      /^\s*mx\.google\.com\s*;/iu.test(topmostAuthenticationResults)
    ? [topmostAuthenticationResults]
    : [];
  const raw = [...authenticationResults];
  const combined = authenticationResults.join("; ");
  const spfValues = collectVerdicts(combined, "spf");

  return {
    spf: resolveVerdict(spfValues),
    dkim: resolveVerdict(collectVerdicts(combined, "dkim")),
    dmarc: resolveVerdict(collectVerdicts(combined, "dmarc")),
    spfDomain: extractAuthDomain(combined, /smtp\.mailfrom=([^\s;]+)/i),
    dkimDomain: extractAuthDomain(combined, /header\.d=([^\s;]+)/i),
    dmarcDomain: extractAuthDomain(combined, /header\.from=([^\s;]+)/i),
    raw,
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function collectBodies(part: GmailMessagePart | null | undefined): { plain: string[]; html: string[] } {
  const result = { plain: [] as string[], html: [] as string[] };
  if (!part) return result;

  const visit = (current: GmailMessagePart): void => {
    const filename = current.filename?.trim() ?? "";
    const mimeType = current.mimeType?.split(";", 1)[0].trim().toLowerCase() ?? "";
    if (!filename && current.body?.data && (mimeType === "text/plain" || mimeType === "text/html")) {
      try {
        const decoded = decodeBase64UrlText(current.body.data).trim();
        if (decoded) (mimeType === "text/html" ? result.html : result.plain).push(decoded);
      } catch {
        // A malformed part is ignored; callers can route an empty result to manual review.
      }
    }
    for (const child of current.parts ?? []) visit(child);
  };

  visit(part);
  return result;
}

function parseReceivedAt(internalDate: string | null | undefined, dateHeader: string | null): string | null {
  const milliseconds = internalDate && /^\d+$/.test(internalDate) ? Number(internalDate) : Number.NaN;
  const parsed = Number.isFinite(milliseconds) ? new Date(milliseconds) : new Date(dateHeader ?? "");
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function parseGmailMessage(message: GmailMessageResource): NormalizedEmail {
  const gmailMessageId = message.id?.trim() ?? "";
  if (!gmailMessageId) throw new Error("GMAIL_MESSAGE_ID_REQUIRED");

  const headers = normalizeHeaders(message.payload?.headers);
  const bodies = collectBodies(message.payload);
  const htmlBody = bodies.html.length > 0 ? bodies.html.join("\n") : null;
  const textBody = bodies.plain.length > 0 ? bodies.plain.join("\n") : htmlToText(htmlBody ?? "");
  const from = getHeader(headers, "from") ?? "";
  const returnPath = getHeader(headers, "return-path");

  return {
    gmailMessageId,
    gmailThreadId: message.threadId?.trim() || null,
    historyId: message.historyId?.trim() || null,
    labelIds: [...new Set((message.labelIds ?? []).filter((label): label is string => typeof label === "string"))],
    subject: getHeader(headers, "subject") ?? "",
    from,
    fromAddress: extractMailboxAddress(from),
    returnPath,
    returnPathAddress: extractMailboxAddress(returnPath),
    receivedAt: parseReceivedAt(message.internalDate, getHeader(headers, "date")),
    textBody,
    htmlBody,
    headers,
    authentication: parseAuthenticationResults(headers),
  };
}

function normalizedSet(values: readonly string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function addressAllowed(address: string | null, addresses: Set<string>, domains: Set<string>): boolean {
  return Boolean(address && (addresses.has(address) || domainMatches(domainOf(address), [...domains])));
}

function isExplicitAuthenticationFailure(verdict: AuthenticationVerdict): boolean {
  return ["fail", "softfail", "permerror"].includes(verdict);
}

export function validateBankSender(email: NormalizedEmail, rule: BankSenderRule): SenderValidationResult {
  const reasons: string[] = [];
  const fromAddresses = normalizedSet(rule.allowedFromAddresses);
  const fromDomains = normalizedSet(rule.allowedFromDomains);
  const returnAddresses = normalizedSet(rule.allowedReturnPathAddresses);
  const returnDomains = normalizedSet(rule.allowedReturnPathDomains);
  const authDomains = normalizedSet(rule.allowedAuthenticationDomains);
  const hasFromAllowlist = fromAddresses.size > 0 || fromDomains.size > 0;

  if (!hasFromAllowlist) reasons.push("sender_allowlist_not_configured");
  else if (!addressAllowed(email.fromAddress, fromAddresses, fromDomains)) reasons.push("from_not_authorized");

  if (email.returnPathAddress) {
    const effectiveReturnAddresses = returnAddresses.size > 0 || returnDomains.size > 0
      ? returnAddresses
      : fromAddresses;
    const effectiveReturnDomains = returnAddresses.size > 0 || returnDomains.size > 0
      ? returnDomains
      : fromDomains;
    if (!addressAllowed(email.returnPathAddress, effectiveReturnAddresses, effectiveReturnDomains)) {
      reasons.push("return_path_not_authorized");
    }
  }

  let authenticationIdentityMissing = false;
  for (const mechanism of ["spf", "dkim", "dmarc"] as const) {
    const verdict = email.authentication[mechanism];
    if (isExplicitAuthenticationFailure(verdict)) reasons.push(`${mechanism}_failed`);
    const required = {
      spf: rule.requireSpf,
      dkim: rule.requireDkim,
      dmarc: rule.requireDmarc,
    }[mechanism] !== false;
    if (required && verdict !== "pass" && !isExplicitAuthenticationFailure(verdict)) {
      reasons.push(`${mechanism}_missing_or_unverified`);
    }
    const authenticatedDomain = {
      spf: email.authentication.spfDomain,
      dkim: email.authentication.dkimDomain,
      dmarc: email.authentication.dmarcDomain,
    }[mechanism];
    if (required && verdict === "pass" && !authenticatedDomain) authenticationIdentityMissing = true;
  }
  if (authenticationIdentityMissing) reasons.push("authentication_domain_missing_or_unverified");

  if (authDomains.size > 0) {
    const observed = [
      email.authentication.spfDomain,
      email.authentication.dkimDomain,
      email.authentication.dmarcDomain,
    ].filter((domain): domain is string => Boolean(domain));
    if (observed.length === 0) {
      reasons.push("authentication_domain_missing_or_unverified");
    } else if (observed.some((domain) => !domainMatches(domain, [...authDomains]))) {
      reasons.push("authentication_domain_not_authorized");
    }
  }

  const rejected = reasons.some((reason) =>
    reason === "from_not_authorized" ||
    reason === "return_path_not_authorized" ||
    reason.endsWith("_failed") ||
    reason === "authentication_domain_not_authorized"
  );
  const decision = rejected ? "rejected" : reasons.length > 0 ? "manual_review" : "trusted";
  return {
    decision,
    reasons,
    fromAddress: email.fromAddress,
    returnPathAddress: email.returnPathAddress,
    authentication: email.authentication,
  };
}
