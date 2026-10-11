// Keep the existing Calendar token format without loading the full Google API SDK.
export async function exchangeCalendarGoogleCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
) {
  if (!clientId || !clientSecret) throw new Error('Google no esta configurado.');
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!tokenResponse.ok) throw new Error('No se pudo autorizar el calendario de Google.');
  const tokenData = await tokenResponse.json();
  if (typeof tokenData.access_token !== 'string' || !tokenData.access_token) {
    throw new Error('Google no devolvio un token de acceso.');
  }
  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!profileResponse.ok) throw new Error('No se pudo identificar la cuenta de Google.');
  const profile = await profileResponse.json();
  const expiresIn = Number(tokenData.expires_in);
  return {
    tokens: { ...tokenData, expiry_date: Number.isFinite(expiresIn) && expiresIn > 0
      ? Date.now() + expiresIn * 1000 : null },
    email: typeof profile.email === 'string' ? profile.email : null,
    scopes: typeof tokenData.scope === 'string' ? tokenData.scope.split(/\s+/u).filter(Boolean) : [],
  };
}
