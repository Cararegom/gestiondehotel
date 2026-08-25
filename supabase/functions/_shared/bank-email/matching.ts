import type {
  ExpectedPaymentCandidate,
  ExpectedPaymentMatchDecision,
  IncomingBankPayment,
} from "./types.ts";

function normalizePaymentMethod(value: string): string {
  return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function validDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function decideExpectedPaymentMatch(
  payment: IncomingBankPayment,
  candidates: readonly ExpectedPaymentCandidate[],
  options: { windowMinutes?: number; pendingStatuses?: readonly string[] } = {},
): ExpectedPaymentMatchDecision {
  if (!payment.hotelId || !Number.isSafeInteger(payment.amountCop) || payment.amountCop <= 0) {
    throw new Error("INVALID_INCOMING_BANK_PAYMENT");
  }
  const receivedAt = validDate(payment.receivedAt);
  if (!receivedAt) throw new Error("INVALID_INCOMING_PAYMENT_DATE");

  const windowMinutes = options.windowMinutes ?? 30;
  const windowMilliseconds = Math.max(1, windowMinutes) * 60_000;
  const pendingStatuses = new Set((options.pendingStatuses ?? ["pending", "pendiente"]).map((status) => status.toLowerCase()));
  const acceptedMethods = new Set(["llave", "transferencia"]);

  const matches = candidates.filter((candidate) => {
    if (candidate.hotelId !== payment.hotelId) return false;
    if (!Number.isSafeInteger(candidate.expectedAmountCop) || candidate.expectedAmountCop !== payment.amountCop) return false;
    if (!pendingStatuses.has(candidate.status.trim().toLowerCase())) return false;
    if (!acceptedMethods.has(normalizePaymentMethod(candidate.paymentMethod))) return false;

    const createdAt = validDate(candidate.createdAt);
    if (!createdAt || Math.abs(receivedAt.getTime() - createdAt.getTime()) > windowMilliseconds) return false;
    const expiresAt = candidate.expiresAt ? validDate(candidate.expiresAt) : null;
    if (candidate.expiresAt && !expiresAt) return false;
    if (expiresAt && expiresAt < receivedAt) return false;
    return true;
  });

  if (matches.length === 1) {
    return {
      status: "matched",
      matchedExpectedPaymentId: matches[0].id,
      candidateIds: [matches[0].id],
      reason: "single_exact_pending_payment_match",
    };
  }
  if (matches.length > 1) {
    return {
      status: "manual_review",
      matchedExpectedPaymentId: null,
      candidateIds: matches.map((candidate) => candidate.id),
      reason: "multiple_exact_pending_payment_matches",
    };
  }
  return {
    status: "detected",
    matchedExpectedPaymentId: null,
    candidateIds: [],
    reason: "no_exact_pending_payment_match",
  };
}
