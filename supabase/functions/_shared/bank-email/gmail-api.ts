export interface GmailProfile {
  emailAddress: string;
  historyId: string;
  messagesTotal?: number;
  threadsTotal?: number;
}

export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
}

export interface GmailWatchResult {
  historyId: string;
  expiration: string;
}

export interface GmailMessageReference {
  id: string;
  threadId?: string;
}

export interface GmailHistoryPage {
  history?: Array<{
    id?: string;
    messagesAdded?: Array<{ message?: GmailMessageReference & { labelIds?: string[] } }>;
  }>;
  nextPageToken?: string;
  historyId?: string;
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: Record<string, unknown>;
  sizeEstimate?: number;
}

async function gmailRequest<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const providerCode = typeof (data.error as Record<string, unknown> | undefined)?.status === 'string'
      ? String((data.error as Record<string, unknown>).status).toLowerCase()
      : `http_${response.status}`;
    throw Object.assign(new Error('La API de Gmail rechazo la solicitud.'), {
      code: `gmail_${providerCode}`,
      status: response.status
    });
  }
  return data as unknown as T;
}

export function getGmailProfile(accessToken: string): Promise<GmailProfile> {
  return gmailRequest<GmailProfile>(accessToken, '/profile');
}

export async function listGmailLabels(accessToken: string): Promise<GmailLabel[]> {
  const result = await gmailRequest<{ labels?: GmailLabel[] }>(accessToken, '/labels');
  return Array.isArray(result.labels) ? result.labels : [];
}

export async function findGmailLabel(accessToken: string, labelName: string): Promise<GmailLabel | null> {
  const normalized = labelName.trim().toLocaleLowerCase('es-CO');
  const labels = await listGmailLabels(accessToken);
  const matches = labels.filter((label) => label.name.trim().toLocaleLowerCase('es-CO') === normalized);
  if (matches.length > 1) {
    throw Object.assign(new Error('La etiqueta Gmail configurada es ambigua.'), { code: 'gmail_label_ambiguous' });
  }
  return matches[0] || null;
}

export function registerGmailWatch(
  accessToken: string,
  topicName: string,
  labelId: string
): Promise<GmailWatchResult> {
  return gmailRequest<GmailWatchResult>(accessToken, '/watch', {
    method: 'POST',
    body: JSON.stringify({
      topicName,
      labelIds: [labelId],
      labelFilterBehavior: 'INCLUDE'
    })
  });
}

export async function stopGmailWatch(accessToken: string): Promise<void> {
  await gmailRequest<Record<string, never>>(accessToken, '/stop', {
    method: 'POST',
    body: '{}'
  });
}

export function getGmailMessage(accessToken: string, messageId: string): Promise<GmailMessage> {
  return gmailRequest<GmailMessage>(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}?format=full`
  );
}

export function listGmailHistory(
  accessToken: string,
  startHistoryId: string,
  labelId: string,
  pageToken?: string
): Promise<GmailHistoryPage> {
  const params = new URLSearchParams({
    startHistoryId,
    historyTypes: 'messageAdded',
    labelId,
    maxResults: '100'
  });
  if (pageToken) params.set('pageToken', pageToken);
  return gmailRequest<GmailHistoryPage>(accessToken, `/history?${params.toString()}`);
}

export async function listLabeledMessageIdsForRecovery(
  accessToken: string,
  labelId: string,
  maxMessages = 500
): Promise<GmailMessageReference[]> {
  const safeMaximum = Math.min(Math.max(Math.trunc(maxMessages), 1), 2_000);
  const messages = new Map<string, GmailMessageReference>();
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ labelIds: labelId, maxResults: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const result = await gmailRequest<{
      messages?: GmailMessageReference[];
      nextPageToken?: string;
    }>(accessToken, `/messages?${params.toString()}`);
    for (const message of result.messages || []) {
      if (message.id) messages.set(message.id, message);
    }
    pageToken = result.nextPageToken;
    if (pageToken && messages.size >= safeMaximum) {
      throw Object.assign(new Error('La recuperacion Gmail excede el limite seguro.'), {
        code: 'gmail_recovery_too_large'
      });
    }
  } while (pageToken);
  return [...messages.values()];
}
