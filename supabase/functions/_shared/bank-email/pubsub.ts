import { decodeBase64UrlText } from "./gmail-message.ts";
import type { DecodedPubSubNotification, GmailPushPayload, PubSubPushEnvelope } from "./types.ts";

function isGmailPushPayload(value: unknown): value is GmailPushPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.emailAddress === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.emailAddress.trim()) &&
    typeof payload.historyId === "string" &&
    /^\d+$/.test(payload.historyId);
}

export function decodePubSubNotification(envelope: PubSubPushEnvelope): DecodedPubSubNotification {
  const messageId = envelope?.message?.messageId?.trim() ?? "";
  const data = envelope?.message?.data?.trim() ?? "";
  if (!messageId) throw new Error("PUBSUB_MESSAGE_ID_REQUIRED");
  if (!data) throw new Error("PUBSUB_MESSAGE_DATA_REQUIRED");

  let decoded: unknown;
  try {
    decoded = JSON.parse(decodeBase64UrlText(data));
  } catch {
    throw new Error("PUBSUB_MESSAGE_DATA_INVALID");
  }
  if (!isGmailPushPayload(decoded)) throw new Error("PUBSUB_GMAIL_PAYLOAD_INVALID");

  return {
    messageId,
    publishTime: envelope.message?.publishTime?.trim() || null,
    subscription: envelope.subscription?.trim() || null,
    gmail: {
      emailAddress: decoded.emailAddress.trim().toLowerCase(),
      historyId: decoded.historyId,
    },
  };
}

export function shouldClaimPubSubInboxItem(status: string | null | undefined): boolean {
  return status == null || status === "pending" || status === "retry" || status === "failed";
}

export const PUBSUB_MAX_ATTEMPTS = 8;

export function shouldDeadLetterPubSubInboxItem(attempts: number): boolean {
  return Number.isFinite(attempts) && Math.max(0, Math.trunc(attempts)) >= PUBSUB_MAX_ATTEMPTS;
}

export function isTerminalMissingGmailMessage(status: number | null | undefined): boolean {
  return status === 404 || status === 410;
}

export function isPubSubRetry(existingMessageId: string | null | undefined, incomingMessageId: string): boolean {
  return Boolean(existingMessageId) && existingMessageId === incomingMessageId;
}
