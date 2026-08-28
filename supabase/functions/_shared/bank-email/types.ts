export type BankPaymentEventStatus =
  | "detected"
  | "matched"
  | "confirmed"
  | "manual_review"
  | "rejected"
  | "duplicated";

export type ParserDisposition = "detected" | "manual_review" | "rejected";

export type AuthenticationVerdict =
  | "pass"
  | "fail"
  | "softfail"
  | "neutral"
  | "none"
  | "temperror"
  | "permerror"
  | "unknown";

export interface BankEmailConfig {
  enabled: boolean;
  pilotHotelId: string;
  pilotHotelName: string;
  gmailPaymentLabel: string;
  minAmountCop: number;
  maxAmountCop: number;
  matchWindowMinutes: number;
}

export interface BankEmailRuntimeConfig extends BankEmailConfig {
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  googlePubSubTopic: string;
  googlePubSubVerificationAudience: string;
  googleServiceAccountEmail: string;
  bankTokenEncryptionKey: string;
  cronSecret: string;
}

export interface PilotHotel {
  id: string;
  nombre: string;
}

export interface GmailMessagePartBody {
  data?: string | null;
  attachmentId?: string | null;
  size?: number | null;
}

export interface GmailMessageHeader {
  name?: string | null;
  value?: string | null;
}

export interface GmailMessagePart {
  mimeType?: string | null;
  filename?: string | null;
  headers?: GmailMessageHeader[] | null;
  body?: GmailMessagePartBody | null;
  parts?: GmailMessagePart[] | null;
}

export interface GmailMessageResource {
  id?: string | null;
  threadId?: string | null;
  historyId?: string | null;
  internalDate?: string | null;
  labelIds?: string[] | null;
  payload?: GmailMessagePart | null;
}

export interface EmailAuthentication {
  spf: AuthenticationVerdict;
  dkim: AuthenticationVerdict;
  dmarc: AuthenticationVerdict;
  spfDomain: string | null;
  dkimDomain: string | null;
  dmarcDomain: string | null;
  raw: string[];
}

export interface NormalizedEmail {
  gmailMessageId: string;
  gmailThreadId: string | null;
  historyId: string | null;
  labelIds: string[];
  subject: string;
  from: string;
  fromAddress: string | null;
  returnPath: string | null;
  returnPathAddress: string | null;
  receivedAt: string | null;
  textBody: string;
  htmlBody: string | null;
  headers: Readonly<Record<string, readonly string[]>>;
  authentication: EmailAuthentication;
}

export interface BankSenderRule {
  allowedFromAddresses?: string[];
  allowedFromDomains?: string[];
  allowedReturnPathAddresses?: string[];
  allowedReturnPathDomains?: string[];
  allowedAuthenticationDomains?: string[];
  requireSpf?: boolean;
  requireDkim?: boolean;
  requireDmarc?: boolean;
}

export interface BankParserRule extends BankSenderRule {
  id: string;
  bankName: string;
  senderName?: string;
  expectedSubjectTerms?: string[];
  expectedBodyTerms?: string[];
  successExpressions?: string[];
  amountExpressions?: string[];
  referenceExpressions?: string[];
  payerNameExpressions?: string[];
  parserVersion?: string;
}

export interface SenderValidationResult {
  decision: "trusted" | "manual_review" | "rejected";
  reasons: string[];
  fromAddress: string | null;
  returnPathAddress: string | null;
  authentication: EmailAuthentication;
}

export interface CopAmountCandidate {
  amountCop: number;
  raw: string;
  index: number;
  source: "currency_prefix" | "currency_suffix" | "amount_context";
}

export interface BankParseResult {
  parserId: string;
  parserVersion: string;
  bankName: string | null;
  disposition: ParserDisposition;
  amountCop: number | null;
  transactionOccurredAt: string | null;
  transactionReference: string | null;
  senderName: string | null;
  reviewReason: string | null;
  reasons: string[];
  senderValidation: SenderValidationResult | null;
  metadata: Record<string, unknown>;
}

export interface BankParserContext {
  config: BankEmailConfig;
  rule?: BankParserRule;
}

export interface BankParser {
  id: string;
  priority: number;
  canParse(email: NormalizedEmail, context: BankParserContext): boolean;
  parse(email: NormalizedEmail, context: BankParserContext): BankParseResult;
}

export interface IncomingBankPayment {
  hotelId: string;
  amountCop: number;
  receivedAt: string;
}

export interface ExpectedPaymentCandidate {
  id: string;
  hotelId: string;
  expectedAmountCop: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
  expiresAt?: string | null;
  reservationId?: string | null;
  roomId?: string | null;
  saleId?: string | null;
}

export interface ExpectedPaymentMatchDecision {
  status: "matched" | "manual_review" | "detected";
  matchedExpectedPaymentId: string | null;
  candidateIds: string[];
  reason: string;
}

export interface GmailPushPayload {
  emailAddress: string;
  historyId: string;
}

export interface PubSubPushEnvelope {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
    attributes?: Record<string, string>;
  };
  subscription?: string;
}

export interface DecodedPubSubNotification {
  messageId: string;
  publishTime: string | null;
  subscription: string | null;
  gmail: GmailPushPayload;
}
