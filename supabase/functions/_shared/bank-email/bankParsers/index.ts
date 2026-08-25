import type {
  BankEmailConfig,
  BankParseResult,
  BankParser,
  BankParserRule,
  NormalizedEmail,
} from "../types.ts";
import { bancolombiaParser } from "./bancolombia.ts";
import { genericBankParser, normalizeForMatching } from "./generic.ts";

export interface BankParserRegistry {
  readonly parsers: readonly BankParser[];
  readonly rules: readonly BankParserRule[];
  parse(email: NormalizedEmail, config: BankEmailConfig): BankParseResult;
}

function ruleForParser(parser: BankParser, rules: readonly BankParserRule[]): BankParserRule | undefined {
  return rules.find((rule) =>
    normalizeForMatching(rule.id) === parser.id ||
    normalizeForMatching(rule.bankName).includes(parser.id)
  );
}

export function createBankParserRegistry(
  rules: readonly BankParserRule[] = [],
  parsers: readonly BankParser[] = [bancolombiaParser, genericBankParser],
): BankParserRegistry {
  const ordered = [...parsers].sort((left, right) => right.priority - left.priority);
  if (!ordered.some((parser) => parser.id === "generic")) ordered.push(genericBankParser);

  return {
    parsers: ordered,
    rules: [...rules],
    parse(email: NormalizedEmail, config: BankEmailConfig): BankParseResult {
      for (const parser of ordered) {
        const rule = ruleForParser(parser, rules) ?? (
          parser.id === "generic" ? rules.find((candidate) => candidate.id === "generic") : undefined
        );
        const context = { config, rule };
        if (parser.canParse(email, context)) return parser.parse(email, context);
      }
      return genericBankParser.parse(email, { config });
    },
  };
}

export function parseBankEmail(
  email: NormalizedEmail,
  config: BankEmailConfig,
  rules: readonly BankParserRule[] = [],
): BankParseResult {
  return createBankParserRegistry(rules).parse(email, config);
}

export { bancolombiaParser } from "./bancolombia.ts";
export {
  classifyTransactionLanguage,
  extractTransactionOccurredAt,
  genericBankParser,
  normalizeForMatching,
} from "./generic.ts";
