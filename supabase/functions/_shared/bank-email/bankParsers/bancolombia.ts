import { validateBankSender } from "../gmail-message.ts";
import type { BankParseResult, BankParser, BankParserContext, NormalizedEmail } from "../types.ts";
import {
  classifyTransactionLanguage,
  extractParserAmount,
  extractPayerName,
  extractTransactionOccurredAt,
  extractTransactionReference,
  hasExpectedTerms,
  hasSuccessSignal,
  normalizeForMatching,
} from "./generic.ts";

function emailHintsAtBancolombia(email: NormalizedEmail): boolean {
  const haystack = normalizeForMatching(`${email.from}\n${email.subject}\n${email.textBody.slice(0, 1_000)}`);
  return haystack.includes("bancolombia");
}

export const bancolombiaParser: BankParser = {
  id: "bancolombia",
  priority: 100,

  canParse(email: NormalizedEmail, context: BankParserContext): boolean {
    const configuredBank = normalizeForMatching(context.rule?.bankName ?? "");
    return configuredBank.includes("bancolombia") || emailHintsAtBancolombia(email);
  },

  parse(email: NormalizedEmail, context: BankParserContext): BankParseResult {
    const rule = context.rule;
    const text = `${email.subject}\n${email.textBody}`;
    const classification = classifyTransactionLanguage(email.subject, email.textBody);
    const amount = extractParserAmount(email, context);
    const reasons: string[] = [];

    if (!rule) reasons.push("bank_rule_not_configured");
    const senderValidation = rule ? validateBankSender(email, rule) : null;
    if (senderValidation) reasons.push(...senderValidation.reasons);

    if (classification === "sent") reasons.push("outgoing_transfer_detected");
    if (classification === "reversed") reasons.push("reversed_transfer_detected");
    if (classification === "failed") reasons.push("failed_transfer_detected");
    if (!hasSuccessSignal(email, rule)) reasons.push("success_signal_missing");
    if (rule && !hasExpectedTerms(email.subject, rule.expectedSubjectTerms)) {
      reasons.push("expected_subject_terms_missing");
    }
    if (rule && !hasExpectedTerms(email.textBody, rule.expectedBodyTerms)) {
      reasons.push("expected_body_terms_missing");
    }
    if (amount.ambiguous) reasons.push("multiple_amounts_detected");
    if (amount.amountCop === null && !amount.ambiguous) reasons.push("amount_not_found_or_out_of_range");

    const rejectedReasons = new Set([
      "outgoing_transfer_detected",
      "reversed_transfer_detected",
      "failed_transfer_detected",
      "success_signal_missing",
      "expected_subject_terms_missing",
      "expected_body_terms_missing",
    ]);
    const rejected = senderValidation?.decision === "rejected" || reasons.some((reason) => rejectedReasons.has(reason));
    const manualReview = !rejected && (
      !rule ||
      senderValidation?.decision !== "trusted" ||
      amount.amountCop === null
    );
    const disposition = rejected ? "rejected" : manualReview ? "manual_review" : "detected";

    return {
      parserId: "bancolombia",
      parserVersion: rule?.parserVersion ?? "1.0.0",
      bankName: rule?.bankName ?? "Bancolombia",
      disposition,
      amountCop: amount.amountCop,
      transactionOccurredAt: extractTransactionOccurredAt(text, email.receivedAt),
      transactionReference: extractTransactionReference(text, rule),
      senderName: extractPayerName(text, rule),
      reviewReason: disposition === "detected" ? null : reasons[0] ?? "manual_review_required",
      reasons: [...new Set(reasons)],
      senderValidation,
      metadata: {
        classification,
        amountCandidateCount: amount.candidateCount,
        senderAuthenticated: senderValidation?.decision === "trusted",
      },
    };
  },
};
