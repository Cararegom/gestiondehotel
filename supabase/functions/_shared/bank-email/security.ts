function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const stableBuffer = new Uint8Array(bytes.byteLength);
  stableBuffer.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableBuffer.buffer);
  return bytesToHex(new Uint8Array(digest));
}

export function canonicalizeSensitiveContent(value: string): string {
  return value.normalize("NFKC").replace(/\r\n?/g, "\n").trim();
}

export function hashSensitiveContent(value: string): Promise<string> {
  return sha256Hex(canonicalizeSensitiveContent(value));
}

export function maskReference(value: string | null | undefined, visibleSuffix = 4): string | null {
  const compact = value?.replace(/\s+/g, "").trim() ?? "";
  if (!compact) return null;
  const suffixLength = Math.max(1, Math.min(visibleSuffix, compact.length));
  return `${"\u2022".repeat(Math.max(4, compact.length - suffixLength))}${compact.slice(-suffixLength)}`;
}

export function redactEmailAddress(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return email ? "[redacted]" : null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email-redacted]")
    .replace(/\b(?:\d[ -]?){10,19}\b/g, "[number-redacted]")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[token-redacted]")
    .replace(/((?:access|refresh|id)[_-]?token\s*[:=]\s*)\S+/gi, "$1[token-redacted]");
}
