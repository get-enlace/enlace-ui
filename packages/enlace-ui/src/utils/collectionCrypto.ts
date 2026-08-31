import type { EnlaceCollection } from '../types.js';

/**
 * The "Full credentials" export envelope. Wraps today's plaintext
 * `EnlaceCollection` JSON (with `secrets: "included"`) unchanged — nothing
 * about the collection format itself changes, only that its serialized
 * bytes are encrypted before they touch disk.
 *
 * Password only, no generated-key/recovery-code mode: the passphrase is
 * typed at export time and again at import time, held in memory only for
 * the `crypto.subtle` call, and never stored anywhere by Enlace (server or
 * app). Losing the password means losing the file — there is no recovery
 * path, by design.
 */
export interface EncryptedCollectionEnvelope {
  format: typeof ENCRYPTED_COLLECTION_FORMAT;
  version: typeof ENCRYPTED_COLLECTION_VERSION;
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
    /** base64 */
    salt: string;
  };
  cipher: {
    name: 'AES-GCM';
    /** base64 */
    iv: string;
  };
  /** base64 */
  ciphertext: string;
}

export const ENCRYPTED_COLLECTION_FORMAT = 'enlace-collection-encrypted' as const;
export const ENCRYPTED_COLLECTION_VERSION = 1 as const;

/** OWASP's 2023 minimum for PBKDF2-SHA256. Stored per-envelope (not assumed
 * at decrypt time) so a future bump doesn't break decrypting older files. */
export const PBKDF2_ITERATIONS = 600_000;

const SALT_BYTES = 16;
const IV_BYTES = 12; // AES-GCM's recommended nonce size

export class EncryptionUnavailableError extends Error {
  constructor(
    message = 'Encrypted export/import needs the Web Crypto API, which browsers only expose in a secure context (HTTPS or localhost). This page is neither.'
  ) {
    super(message);
    this.name = 'EncryptionUnavailableError';
  }
}

export class DecryptionError extends Error {
  constructor(message = 'Incorrect password, or this file is corrupted.') {
    super(message);
    this.name = 'DecryptionError';
  }
}

/**
 * `crypto.subtle` is only defined by browsers in a secure context (HTTPS or
 * localhost) — the same restriction `utils/randomId.ts` already leans on via
 * `crypto.randomUUID()`. Some of Enlace's real target deployments are plain
 * HTTP pre-prod servers, so check explicitly and fail with a clear message
 * rather than letting `encryptCollection`/`decryptCollection` throw a raw
 * `TypeError` from a missing `crypto.subtle`.
 */
export function isEncryptionSupported(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}

/** Shape check only — doesn't verify the password. Used to route an import
 * to the password-prompt flow before any decryption is attempted. */
export function isEncryptedCollection(raw: unknown): raw is EncryptedCollectionEnvelope {
  return (
    isRecord(raw) &&
    raw.format === ENCRYPTED_COLLECTION_FORMAT &&
    raw.version === ENCRYPTED_COLLECTION_VERSION &&
    isRecord(raw.kdf) &&
    raw.kdf.name === 'PBKDF2' &&
    raw.kdf.hash === 'SHA-256' &&
    typeof raw.kdf.iterations === 'number' &&
    typeof raw.kdf.salt === 'string' &&
    isRecord(raw.cipher) &&
    raw.cipher.name === 'AES-GCM' &&
    typeof raw.cipher.iv === 'string' &&
    typeof raw.ciphertext === 'string'
  );
}

/**
 * Encrypts a full-credential `EnlaceCollection` (already serialized by
 * `serializeCollection({ includeSecrets: true, ... })`) for export. Fresh
 * random salt and IV every call, so encrypting the same collection with the
 * same password twice never produces the same ciphertext.
 */
export async function encryptCollection(
  collection: EnlaceCollection,
  password: string
): Promise<EncryptedCollectionEnvelope> {
  if (!isEncryptionSupported()) throw new EncryptionUnavailableError();

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(collection));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  return {
    format: ENCRYPTED_COLLECTION_FORMAT,
    version: ENCRYPTED_COLLECTION_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * Decrypts an envelope back to the plaintext `EnlaceCollection` JSON string
 * — handed straight to `parseCollection()` by the caller, same as any other
 * imported file, so its validation (including `__proto__`-key rejection)
 * isn't duplicated here.
 *
 * Throws `DecryptionError` for a wrong password OR a corrupted/tampered
 * file. That covers two distinct failure modes the caller can't tell
 * apart anyway: AES-GCM's auth tag failing to verify (right shape, wrong
 * key or flipped ciphertext bits), and `salt`/`iv`/`ciphertext` not even
 * being valid base64 (a hand-edited or truncated file) — the latter would
 * otherwise throw a raw `DOMException` straight out of `atob`, so the
 * whole body below is covered, not just the `crypto.subtle.decrypt` call.
 */
export async function decryptCollection(
  envelope: EncryptedCollectionEnvelope,
  password: string
): Promise<string> {
  if (!isEncryptionSupported()) throw new EncryptionUnavailableError();

  try {
    const salt = fromBase64(envelope.kdf.salt);
    const iv = fromBase64(envelope.cipher.iv);
    const key = await deriveKey(password, salt, envelope.kdf.iterations);
    const ciphertext = fromBase64(envelope.ciphertext);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new DecryptionError();
  }
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function toBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
