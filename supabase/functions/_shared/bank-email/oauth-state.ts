function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function createOAuthState(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashOAuthState(state: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function buildOAuthRedirect(parameters: Record<string, string>): string {
  const configured = Deno.env.get('SITE_URL') || 'https://gestiondehotel.com';
  const base = configured.endsWith('/') ? configured : `${configured}/`;
  const search = new URLSearchParams(parameters);
  return `${base}app/index.html#/integraciones?${search.toString()}`;
}
