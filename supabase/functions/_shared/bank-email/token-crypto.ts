const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  if (secret.trim().length < 32) {
    throw Object.assign(new Error('BANK_TOKEN_ENCRYPTION_KEY debe tener al menos 32 caracteres.'), {
      code: 'invalid_encryption_key'
    });
  }

  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptToken(plaintext: string, secret: string): Promise<string> {
  if (!plaintext) {
    throw Object.assign(new Error('No se puede cifrar un token vacio.'), { code: 'empty_token' });
  }

  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode('gestiondehotel:bank-email:v1') },
    key,
    encoder.encode(plaintext)
  );

  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptToken(ciphertext: string, secret: string): Promise<string> {
  const [version, ivValue, encryptedValue, ...extra] = String(ciphertext || '').split('.');
  if (version !== 'v1' || !ivValue || !encryptedValue || extra.length > 0) {
    throw Object.assign(new Error('Formato de token cifrado invalido.'), { code: 'invalid_ciphertext' });
  }

  try {
    const key = await deriveKey(secret);
    const ivBytes = base64UrlToBytes(ivValue);
    const encryptedBytes = base64UrlToBytes(encryptedValue);
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBytes.buffer as ArrayBuffer,
        additionalData: encoder.encode('gestiondehotel:bank-email:v1')
      },
      key,
      encryptedBytes.buffer as ArrayBuffer
    );
    return decoder.decode(decrypted);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error;
    throw Object.assign(new Error('No se pudo descifrar el token.'), { code: 'token_decryption_failed' });
  }
}

export function getTokenEncryptionKey(): string {
  const value = Deno.env.get('BANK_TOKEN_ENCRYPTION_KEY') || '';
  if (!value) {
    throw Object.assign(new Error('BANK_TOKEN_ENCRYPTION_KEY no esta configurada.'), {
      code: 'missing_encryption_key'
    });
  }
  return value;
}
