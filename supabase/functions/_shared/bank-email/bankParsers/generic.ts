import { extractSingleCopAmount, parseCopInteger } from "../money.ts";
import { validateBankSender } from "../gmail-message.ts";
import type {
  BankParseResult,
  BankParser,
  BankParserContext,
  BankParserRule,
  NormalizedEmail,
} from "../types.ts";

export type TransactionLanguage = "received" | "sent" | "reversed" | "failed" | "unknown";

export function normalizeForMatching(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const NEGATIVE_LANGUAGE: ReadonlyArray<[TransactionLanguage, RegExp[]]> = [
  ["reversed", [
    /\b(?:reversada|reversado|revertida|revertido|reversion|anulada|anulado|devuelta|devuelto)\b/i,
  ]],
  ["failed", [
    /\b(?:fallida|fallido|rechazada|rechazado|declinada|declinado|cancelada|cancelado)\b/i,
    /\bno\s+(?:fue|ha\s+sido|se\s+pudo)\s+(?:exitosa|exitoso|completar|procesar)\b/i,
  ]],
  ["sent", [
    /\b(?:transferencia|pago|dinero)\s+(?:enviada|enviado)\b/i,
    /\b(?:enviaste|transferiste|pagaste|debitamos|debitado|debito)\b/i,
    /\b(?:salio|retiro)\s+(?:dinero|de\s+tu\s+cuenta)\b/i,
  ]],
];

const RECEIVED_LANGUAGE = [
  /\b(?:transferencia|pago|dinero)\s+(?:recibida|recibido)\b/i,
  /\b(?:recibiste|te\s+transfirieron|te\s+enviaron)\b/i,
  /\b(?:abonada|abonado|acreditada|acreditado)\b/i,
  /\b(?:transaccion|transferencia|pago)\s+(?:exitosa|exitoso|completada|completado)\b/i,
];

export function classifyTransactionLanguage(subject: string, body: string): TransactionLanguage {
  const text = normalizeForMatching(`${subject}\n${body}`);
  for (const [classification, expressions] of NEGATIVE_LANGUAGE) {
    if (expressions.some((expression) => expression.test(text))) return classification;
  }
  return RECEIVED_LANGUAGE.some((expression) => expression.test(text)) ? "received" : "unknown";
}

function safeExpression(source: string): RegExp | null {
  if (!source || source.length > 300) return null;
  try {
    return new RegExp(source, "iu");
  } catch {
    return null;
  }
}

function extractFirstByExpressions(text: string, expressions: readonly string[] | undefined): string | null {
  for (const source of expressions ?? []) {
    const expression = safeExpression(source);
    if (!expression) continue;
    const value = text.match(expression)?.[1]?.trim();
    if (value) return value.slice(0, 160);
  }
  return null;
}

export function extractTransactionReference(text: string, rule?: BankParserRule): string | null {
  const configured = extractFirstByExpressions(text, rule?.referenceExpressions);
  if (configured) {
    return configured.replace(/[^a-z0-9._-]/gi, "").replace(/^[._-]+|[._-]+$/g, "").slice(0, 80) || null;
  }
  const fallback = text.match(/\b(?:referencia|numero\s+de\s+transaccion|comprobante)\s*[:#-]?\s*([a-z0-9][a-z0-9._-]{3,79})\b/i)?.[1];
  return fallback?.trim().replace(/[._-]+$/g, "") ?? null;
}

export function extractPayerName(text: string, rule?: BankParserRule): string | null {
  const configured = extractFirstByExpressions(text, rule?.payerNameExpressions);
  if (configured) return configured.replace(/\s+/g, " ").slice(0, 120);
  const receivedPayment = text.match(
    /\brecibiste\s+un\s+pago\s+de\s+([^\r\n,;]{2,120}?)\s+por\s+(?=(?:(?:COP\b|\$)\s*)?\d)/iu,
  )?.[1];
  if (receivedPayment) return receivedPayment.trim().replace(/\s+/g, " ").slice(0, 120);
  const receivedTransfer = text.match(
    /\brecibiste\s+una\s+transferencia\s+por\s+(?:(?:COP\b|\$)\s*)?\d[\d.,]*\s+de\s+([^\r\n,;]{2,120}?)\s+en\s+tu\s+cuenta\b/iu,
  )?.[1];
  if (receivedTransfer) return receivedTransfer.trim().replace(/\s+/g, " ").slice(0, 120);
  const fallback = text.match(/\b(?:remitente|pagador|enviado\s+por)\s*[:#-]?\s*([^\n,;]{2,120})/i)?.[1];
  return fallback?.trim().replace(/\s+/g, " ") ?? null;
}

const SPANISH_MONTHS = new Map([
  ["enero", 1], ["febrero", 2], ["marzo", 3], ["abril", 4],
  ["mayo", 5], ["junio", 6], ["julio", 7], ["agosto", 8],
  ["septiembre", 9], ["setiembre", 9], ["octubre", 10],
  ["noviembre", 11], ["diciembre", 12],
]);

function bogotaDateTimeToIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  meridiem = "",
): string | null {
  if (year < 2020 || year > 2100 || month < 1 || month > 12 || minute > 59 || second > 59) return null;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDay) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) return null;
  return new Date(Date.UTC(year, month - 1, day, hour + 5, minute, second)).toISOString();
}

function plausibleTransactionTime(candidate: string | null, receivedAt: string | null): string | null {
  if (!candidate) return null;
  const candidateMs = new Date(candidate).getTime();
  const receivedMs = receivedAt ? new Date(receivedAt).getTime() : Number.NaN;
  if (!Number.isFinite(candidateMs)) return null;
  if (Number.isFinite(receivedMs)) {
    const earliest = receivedMs - 14 * 24 * 60 * 60 * 1000;
    const latest = receivedMs + 24 * 60 * 60 * 1000;
    if (candidateMs < earliest || candidateMs > latest) return null;
  }
  return new Date(candidateMs).toISOString();
}

export function extractTransactionOccurredAt(text: string, receivedAt: string | null): string | null {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\ba\.\s*m\./g, "am")
    .replace(/\bp\.\s*m\./g, "pm");

  const iso = normalized.match(
    /\b(20\d{2})-(\d{2})-(\d{2})[ t](\d{1,2}):(\d{2})(?::(\d{2}))?(z|[+-]\d{2}:?\d{2})?\b/,
  );
  if (iso) {
    const suffix = iso[7] || "";
    let candidate: string | null = null;
    if (suffix) {
      const parsed = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}:${iso[6] || "00"}${suffix}`);
      candidate = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    } else {
      candidate = bogotaDateTimeToIso(
        Number(iso[1]), Number(iso[2]), Number(iso[3]), Number(iso[4]), Number(iso[5]), Number(iso[6] || 0)
      );
    }
    return plausibleTransactionTime(candidate, receivedAt);
  }

  const numeric = normalized.match(
    /\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})[,\s]+(?:a\s+las\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\b/,
  );
  if (numeric) {
    return plausibleTransactionTime(bogotaDateTimeToIso(
      Number(numeric[3]), Number(numeric[2]), Number(numeric[1]), Number(numeric[4]),
      Number(numeric[5]), Number(numeric[6] || 0), numeric[7] || ""
    ), receivedAt);
  }

  const words = normalized.match(
    /\b(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(20\d{2})[,\s]+(?:a\s+las\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\b/,
  );
  const month = words ? SPANISH_MONTHS.get(words[2]) : null;
  return words && month
    ? plausibleTransactionTime(bogotaDateTimeToIso(
        Number(words[3]), month, Number(words[1]), Number(words[4]),
        Number(words[5]), Number(words[6] || 0), words[7] || ""
      ), receivedAt)
    : null;
}

function hasConfiguredExpression(text: string, expressions: readonly string[] | undefined): boolean {
  if (!expressions?.length) return false;
  return expressions.some((source) => safeExpression(source)?.test(text) ?? false);
}

export function hasExpectedTerms(text: string, terms: readonly string[] | undefined): boolean {
  if (!terms?.length) return true;
  const normalizedText = normalizeForMatching(text);
  return terms.some((term) => normalizedText.includes(normalizeForMatching(term)));
}

function extractConfiguredAmount(text: string, rule: BankParserRule | undefined): number[] {
  const results: number[] = [];
  for (const source of rule?.amountExpressions ?? []) {
    const expression = safeExpression(source);
    if (!expression) continue;
    const match = text.match(expression);
    const amount = match?.[1] ? parseCopInteger(match[1]) : null;
    if (amount !== null) results.push(amount);
  }
  return results;
}

export function extractParserAmount(email: NormalizedEmail, context: BankParserContext) {
  const text = `${email.subject}\n${email.textBody}`;
  const standard = extractSingleCopAmount(text, {
    minAmountCop: context.config.minAmountCop,
    maxAmountCop: context.config.maxAmountCop,
  });
  const configured = extractConfiguredAmount(text, context.rule)
    .filter((amount) => amount >= context.config.minAmountCop && amount <= context.config.maxAmountCop);
  const distinct = [...new Set([
    ...standard.candidates.map((candidate) => candidate.amountCop),
    ...configured,
  ])];
  return {
    amountCop: distinct.length === 1 ? distinct[0] : null,
    ambiguous: distinct.length > 1,
    candidateCount: standard.candidates.length + configured.length,
  };
}

export function hasSuccessSignal(email: NormalizedEmail, rule?: BankParserRule): boolean {
  const text = `${email.subject}\n${email.textBody}`;
  if (rule?.successExpressions?.length) return hasConfiguredExpression(text, rule.successExpressions);
  return classifyTransactionLanguage(email.subject, email.textBody) === "received";
}

export const genericBankParser: BankParser = {
  id: "generic",
  priority: -1_000,

  canParse(): boolean {
    return true;
  },

  parse(email: NormalizedEmail, context: BankParserContext): BankParseResult {
    const classification = classifyTransactionLanguage(email.subject, email.textBody);
    const amount = extractParserAmount(email, context);
    const text = `${email.subject}\n${email.textBody}`;
    const reasons: string[] = [];

    if (classification === "sent") reasons.push("outgoing_transfer_detected");
    if (classification === "reversed") reasons.push("reversed_transfer_detected");
    if (classification === "failed") reasons.push("failed_transfer_detected");
    if (classification === "unknown" && !hasSuccessSignal(email, context.rule)) reasons.push("success_signal_missing");
    if (amount.ambiguous) reasons.push("multiple_amounts_detected");
    if (amount.amountCop === null && !amount.ambiguous) reasons.push("amount_not_found_or_out_of_range");

    const senderValidation = context.rule ? validateBankSender(email, context.rule) : null;
    if (senderValidation) reasons.push(...senderValidation.reasons);

    const isNegative = ["sent", "reversed", "failed"].includes(classification);
    const rejected = isNegative || senderValidation?.decision === "rejected" || reasons.includes("success_signal_missing");
    const disposition = rejected ? "rejected" : "manual_review";
    if (!rejected) reasons.push("generic_parser_requires_manual_review");

    return {
      parserId: "generic",
      parserVersion: context.rule?.parserVersion ?? "1.0.0",
      bankName: context.rule?.bankName ?? null,
      disposition,
      amountCop: amount.amountCop,
      transactionOccurredAt: extractTransactionOccurredAt(text, email.receivedAt),
      transactionReference: extractTransactionReference(text, context.rule),
      senderName: extractPayerName(text, context.rule),
      reviewReason: reasons[0] ?? "generic_parser_requires_manual_review",
      reasons: [...new Set(reasons)],
      senderValidation,
      metadata: {
        classification,
        amountCandidateCount: amount.candidateCount,
        isGenericParser: true,
      },
    };
  },
};
