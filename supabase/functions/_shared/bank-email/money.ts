import type { CopAmountCandidate } from "./types.ts";

const GROUPED_OR_INTEGER = String.raw`(?:\d{1,3}(?:[.,]\d{3})+|\d{4,12})`;
const COP_AMOUNT = String.raw`${GROUPED_OR_INTEGER}(?:[.,]00)?`;
const CURRENCY_PREFIX = new RegExp(String.raw`(?:\bCOP\b|\$)\s*(${COP_AMOUNT})(?!\d|[.,]\d)`, "giu");
const CURRENCY_SUFFIX = new RegExp(String.raw`\b(${COP_AMOUNT})\s*COP\b`, "giu");
const AMOUNT_CONTEXT = new RegExp(
  String.raw`\b(?:monto|valor|recibiste|recibido|abonado|acreditado)\b[^\d$]{0,30}(?:\$\s*)?(${COP_AMOUNT})(?!\d|[.,]\d)`,
  "giu",
);

export function parseCopInteger(rawValue: string): number | null {
  const compact = rawValue.replace(/[\s\u00a0]/g, "");
  if (!/^\d[\d.,]*$/.test(compact)) return null;

  let integerText = compact;
  const decimalMatch = integerText.match(/^(.+)([.,])(\d{2})$/);
  if (decimalMatch) {
    const [, wholePart, decimalSeparator, cents] = decimalMatch;
    if (cents !== "00" || wholePart.includes(decimalSeparator)) return null;
    integerText = wholePart;
  }

  const separators = integerText.match(/[.,]/g) ?? [];
  if (separators.length > 0) {
    const groups = integerText.split(/[.,]/);
    if (groups.some((group) => !/^\d+$/.test(group))) return null;
    const groupedThousands = groups.length > 1 && groups.slice(1).every((group) => group.length === 3);
    if (!groupedThousands) return null;
    integerText = groups.join("");
  }

  const parsed = Number(integerText);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function collectMatches(
  text: string,
  expression: RegExp,
  source: CopAmountCandidate["source"],
): CopAmountCandidate[] {
  expression.lastIndex = 0;
  const candidates: CopAmountCandidate[] = [];
  for (const match of text.matchAll(expression)) {
    const amountCop = parseCopInteger(match[1]);
    if (amountCop !== null) {
      candidates.push({ amountCop, raw: match[0], index: match.index ?? 0, source });
    }
  }
  return candidates;
}

export function extractCopAmounts(
  text: string,
  limits: { minAmountCop?: number; maxAmountCop?: number } = {},
): CopAmountCandidate[] {
  const min = limits.minAmountCop ?? 1;
  const max = limits.maxAmountCop ?? Number.MAX_SAFE_INTEGER;
  const candidates = [
    ...collectMatches(text, CURRENCY_PREFIX, "currency_prefix"),
    ...collectMatches(text, CURRENCY_SUFFIX, "currency_suffix"),
    ...collectMatches(text, AMOUNT_CONTEXT, "amount_context"),
  ].filter((candidate) => candidate.amountCop >= min && candidate.amountCop <= max);

  const priority = { currency_prefix: 0, currency_suffix: 1, amount_context: 2 } as const;
  candidates.sort((left, right) => priority[left.source] - priority[right.source] || left.index - right.index);

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.index}:${candidate.amountCop}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractSingleCopAmount(
  text: string,
  limits: { minAmountCop?: number; maxAmountCop?: number } = {},
): { amountCop: number | null; ambiguous: boolean; candidates: CopAmountCandidate[] } {
  const candidates = extractCopAmounts(text, limits);
  const distinctAmounts = [...new Set(candidates.map((candidate) => candidate.amountCop))];
  return {
    amountCop: distinctAmounts.length === 1 ? distinctAmounts[0] : null,
    ambiguous: distinctAmounts.length > 1,
    candidates,
  };
}
