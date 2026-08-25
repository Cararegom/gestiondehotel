export interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

interface OAuthConfiguration {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function getOAuthConfiguration(): OAuthConfiguration {
  // Prefer Gmail-only credentials so configuring bank email does not rotate
  // the OAuth client (and refresh tokens) used by Google Calendar.
  const clientId = Deno.env.get('GMAIL_OAUTH_CLIENT_ID') || Deno.env.get('GOOGLE_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('GMAIL_OAUTH_CLIENT_SECRET') || Deno.env.get('GOOGLE_CLIENT_SECRET') || '';
  const redirectUri = Deno.env.get('GMAIL_OAUTH_REDIRECT_URI') || Deno.env.get('GOOGLE_REDIRECT_URI') || '';
  if (!clientId || !clientSecret || !redirectUri) {
    throw Object.assign(new Error('La configuracion OAuth de Google esta incompleta.'), {
      code: 'google_oauth_not_configured'
    });
  }
  return { clientId, clientSecret, redirectUri };
}

async function requestToken(params: URLSearchParams): Promise<GoogleTokenResponse> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof data.access_token !== 'string') {
    throw Object.assign(new Error('Google rechazo la solicitud de token.'), {
      code: typeof data.error === 'string' ? `google_${data.error}` : 'google_token_exchange_failed'
    });
  }
  return data as unknown as GoogleTokenResponse;
}

export function buildGoogleAuthorizationUrl(state: string): string {
  const { clientId, redirectUri } = getOAuthConfiguration();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function exchangeGoogleAuthorizationCode(code: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, redirectUri } = getOAuthConfiguration();
  return requestToken(new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
    grant_type: 'authorization_code'
  }));
}

export function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = getOAuthConfiguration();
  return requestToken(new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  }));
}

export async function revokeGoogleToken(token: string): Promise<void> {
  if (!token) return;
  const response = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  if (!response.ok && response.status !== 400) {
    throw Object.assign(new Error('Google no pudo revocar el token.'), { code: 'google_token_revoke_failed' });
  }
}
