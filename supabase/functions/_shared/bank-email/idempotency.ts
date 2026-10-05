import { sha256Hex } from "./security.ts";
import { calendarBucketInTimeZone, DEFAULT_BANK_TIME_ZONE } from "./time-zone.ts";

export function transferFingerprint(input: {
  hotelId: string;
  bankName?: string | null;
  transactionReference?: string | null;
  amountCop: number;
  receivedAt: string;
  transactionTimeZone?: string;
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
  const dateBucket = calendarBucketInTimeZone(
    timestamp.toISOString(),
    input.transactionTimeZone || DEFAULT_BANK_TIME_ZONE,
    !normalizedReference,
  );
  const canonical = [
    input.hotelId.trim(),
    input.bankName?.trim().toLowerCase() ?? "",
    normalizedReference,
    String(input.amountCop),
    dateBucket,
  ].join("|");
  return sha256Hex(canonical);
}
