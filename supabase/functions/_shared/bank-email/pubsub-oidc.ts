import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6';
import { HttpError } from './http.ts';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export interface VerifiedPubSubIdentity {
  subject: string;
  email: string;
}

export async function verifyPubSubOidc(req: Request): Promise<VerifiedPubSubIdentity> {
  const audience = Deno.env.get('GOOGLE_PUBSUB_VERIFICATION_AUDIENCE') || '';
  const expectedEmail = (Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL') || '').trim().toLowerCase();
  if (!audience || !expectedEmail) {
    throw Object.assign(new Error('La validacion OIDC de Pub/Sub no esta configurada.'), {
      code: 'pubsub_oidc_not_configured'
    });
  }

  const authorization = req.headers.get('authorization') || '';
  const match = /^Bearer\s+([^\s]+)$/iu.exec(authorization);
  if (!match?.[1]) {
    throw new HttpError(401, 'missing_pubsub_oidc_token', 'Falta el token OIDC de Pub/Sub.');
  }

  try {
    const { payload } = await jwtVerify(match[1], GOOGLE_JWKS, {
      audience,
      issuer: GOOGLE_ISSUERS,
      algorithms: ['RS256']
    });
    const email = String(payload.email || '').trim().toLowerCase();
    if (!email || email !== expectedEmail || payload.email_verified !== true) {
      throw new HttpError(401, 'pubsub_identity_mismatch', 'La identidad de Pub/Sub no esta autorizada.');
    }
    if (!payload.sub) {
      throw new HttpError(401, 'pubsub_subject_missing', 'El token OIDC no tiene sujeto.');
    }
    return { subject: payload.sub, email };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, 'invalid_pubsub_oidc_token', 'El token OIDC de Pub/Sub no es valido.');
  }
}
