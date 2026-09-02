import { describe, expect, it } from 'vitest';
import type { EnlaceCollection } from '../types.js';
import { ENLACE_COLLECTION_FORMAT, ENLACE_COLLECTION_VERSION } from '../types.js';
import {
  DecryptionError,
  ENCRYPTED_COLLECTION_FORMAT,
  ENCRYPTED_COLLECTION_VERSION,
  EncryptionUnavailableError,
  decryptCollection,
  encryptCollection,
  isEncryptedCollection,
  isEncryptionSupported,
} from './collectionCrypto.js';

/** Shadows the inherited `crypto.subtle` accessor with an own `undefined`
 * for the duration of `fn`, then restores it — see the test that explains
 * why plain `delete crypto.subtle` doesn't work. */
function withoutCryptoSubtle(fn: () => void): void {
  const original = Object.getOwnPropertyDescriptor(crypto, 'subtle');
  Object.defineProperty(crypto, 'subtle', { value: undefined, configurable: true });
  try {
    fn();
  } finally {
    if (original) Object.defineProperty(crypto, 'subtle', original);
    else delete (crypto as { subtle?: unknown }).subtle;
  }
}

async function withoutCryptoSubtleAsync(fn: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(crypto, 'subtle');
  Object.defineProperty(crypto, 'subtle', { value: undefined, configurable: true });
  try {
    await fn();
  } finally {
    if (original) Object.defineProperty(crypto, 'subtle', original);
    else delete (crypto as { subtle?: unknown }).subtle;
  }
}

const collection: EnlaceCollection = {
  format: ENLACE_COLLECTION_FORMAT,
  version: ENLACE_COLLECTION_VERSION,
  name: 'Private backup',
  exportedAt: '2026-08-28T00:00:00.000Z',
  secrets: 'included',
  credentials: [{ id: 'c1', name: 'staging', type: 'bearer', token: 'super-secret-token' }],
  workflows: [
    {
      id: 'workflow-1',
      name: 'Private backup',
      specHint: { operationIds: [] },
      nodes: [],
      connections: [],
      nodePositions: {},
      groups: [],
    },
  ],
};

describe('isEncryptionSupported', () => {
  it('is true under jsdom, which exposes crypto.subtle', () => {
    expect(isEncryptionSupported()).toBe(true);
  });

  it('is false when crypto.subtle is unavailable (e.g. a non-secure-context deployment)', () => {
    // `subtle` is an inherited accessor (Crypto.prototype), not an own
    // property, so `delete crypto.subtle` is a silent no-op — shadow it
    // with an own `undefined` instead to actually simulate its absence.
    withoutCryptoSubtle(() => {
      expect(isEncryptionSupported()).toBe(false);
    });
  });
});

describe('encryptCollection / decryptCollection', () => {
  it('round-trips: decrypting with the right password reproduces the exact plaintext JSON', async () => {
    const envelope = await encryptCollection(collection, 'correct horse battery staple');
    expect(envelope.format).toBe(ENCRYPTED_COLLECTION_FORMAT);
    expect(envelope.version).toBe(ENCRYPTED_COLLECTION_VERSION);

    const plaintext = await decryptCollection(envelope, 'correct horse battery staple');
    expect(JSON.parse(plaintext)).toEqual(collection);
  });

  it('rejects the wrong password', async () => {
    const envelope = await encryptCollection(collection, 'correct horse battery staple');
    await expect(decryptCollection(envelope, 'wrong password')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('detects a bit-flip in the ciphertext instead of returning corrupted plaintext', async () => {
    const envelope = await encryptCollection(collection, 'correct horse battery staple');
    const bytes = Uint8Array.from(atob(envelope.ciphertext), (c) => c.charCodeAt(0));
    bytes[0] ^= 0xff;
    let flipped = '';
    for (const byte of bytes) flipped += String.fromCharCode(byte);
    const tampered = { ...envelope, ciphertext: btoa(flipped) };

    await expect(decryptCollection(tampered, 'correct horse battery staple')).rejects.toBeInstanceOf(
      DecryptionError
    );
  });

  it('wraps malformed base64 (not just a valid-but-wrong ciphertext) as a DecryptionError too', async () => {
    // A hand-edited or truncated file can leave `ciphertext`/`salt`/`iv` not
    // even valid base64 — atob() throws a raw DOMException for that, which
    // must still surface as DecryptionError, not leak past decryptCollection.
    const envelope = await encryptCollection(collection, 'correct horse battery staple');
    const notBase64 = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -1) + '!!!' };

    await expect(decryptCollection(notBase64, 'correct horse battery staple')).rejects.toBeInstanceOf(
      DecryptionError
    );
  });

  it('uses a fresh salt and IV on every call, even for the same collection and password', async () => {
    const first = await encryptCollection(collection, 'same password');
    const second = await encryptCollection(collection, 'same password');
    expect(first.kdf.salt).not.toBe(second.kdf.salt);
    expect(first.cipher.iv).not.toBe(second.cipher.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('throws EncryptionUnavailableError instead of a raw TypeError when crypto.subtle is missing', async () => {
    const envelope = await encryptCollection(collection, 'pw');
    await withoutCryptoSubtleAsync(async () => {
      await expect(encryptCollection(collection, 'pw')).rejects.toBeInstanceOf(EncryptionUnavailableError);
      await expect(decryptCollection(envelope, 'pw')).rejects.toBeInstanceOf(EncryptionUnavailableError);
    });
  });
});

describe('isEncryptedCollection', () => {
  it('recognizes a real envelope', async () => {
    const envelope = await encryptCollection(collection, 'pw');
    expect(isEncryptedCollection(envelope)).toBe(true);
  });

  it('rejects a plaintext EnlaceCollection', () => {
    expect(isEncryptedCollection(collection)).toBe(false);
  });

  it('rejects non-objects, nulls, and near-miss shapes', () => {
    expect(isEncryptedCollection(null)).toBe(false);
    expect(isEncryptedCollection(undefined)).toBe(false);
    expect(isEncryptedCollection('not an object')).toBe(false);
    expect(isEncryptedCollection([])).toBe(false);
    expect(isEncryptedCollection({ format: ENCRYPTED_COLLECTION_FORMAT })).toBe(false);
    expect(
      isEncryptedCollection({
        format: ENCRYPTED_COLLECTION_FORMAT,
        version: ENCRYPTED_COLLECTION_VERSION,
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt: 'abc' },
        cipher: { name: 'AES-GCM' /* missing iv */ },
        ciphertext: 'xyz',
      })
    ).toBe(false);
  });
});
