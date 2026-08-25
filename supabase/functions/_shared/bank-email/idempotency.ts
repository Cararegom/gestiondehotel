import { sha256Hex } from "./security.ts";

export function gmailMessageDeduplicationKey(hotelId: string, gmailMessageId: string): string {
  if (!hotelId.trim() || !gmailMessageId.trim()) throw new Error("IDEMPOTENCY_FIELDS_REQUIRED");
  return `${hotelId.trim()}:${gmailMessageId.trim()}`;
}

export function bogotaCalendarBucket(value: string, includeMinute = false): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error("INVALID_BOGOTA_TIMESTAMP");
  const colombiaTime = new Date(timestamp.getTime() - 5 * 60 * 60 * 1000).toISOString();
  return colombiaTime.slice(0, includeMinute ? 16 : 10);
}

export function transferFingerprint(input: {
  hotelId: string;
  bankName?: string | null;
  transactionReference?: string | null;
  amountCop: number;
  receivedAt: string;
}): Promise<string> {
  if (!input.hotelId || !Number.isSafeInteger(input.amountCop) || input.amountCop <= 0) {
    throw new Error("INVALID_TRANSFER_FINGERPRINT_INPUT");
  }
  const timestamp = new Date(input.receivedAt);
  if (Number.isNaN(timestamp.getTime())) throw new Error("INVALID_TRANSFER_RECEIVED_AT");
  const normalizedReference = input.transactionReference?.replace(/\s+/g, "").toLowerCase() ?? "";
  // A banking reference identifies the transfer across delayed/retried emails, so
  // its secondary fingerprint uses the calendar day. Without a reference, keep a
  // narrow minute bucket to avoid collapsing unrelated same-amount payments.
  const dateBucket = bogotaCalendarBucket(timestamp.toISOString(), !normalizedReference);
  const canonical = [
    input.hotelId.trim(),
    input.bankName?.trim().toLowerCase() ?? "",
    normalizedReference,
    String(input.amountCop),
    dateBucket,
  ].join("|");
  return sha256Hex(canonical);
}

export function isDuplicateGmailMessage(
  seenKeys: ReadonlySet<string>,
  hotelId: string,
  gmailMessageId: string,
): boolean {
  return seenKeys.has(gmailMessageDeduplicationKey(hotelId, gmailMessageId));
}
