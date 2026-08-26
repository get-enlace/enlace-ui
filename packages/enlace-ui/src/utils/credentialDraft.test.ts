import { describe, it, expect } from 'vitest';
import { CREDENTIAL_TYPE_LABELS, emptyDraft, isDraftComplete, maskTail, maskedPreview, toDraft } from './credentialDraft.js';
import type { Credential } from '../types.js';

describe('emptyDraft', () => {
  it('returns a type-appropriate empty draft for every credential type', () => {
    expect(emptyDraft('bearer', 'x')).toEqual({ name: 'x', type: 'bearer', token: '' });
    expect(emptyDraft('basic', 'x')).toEqual({ name: 'x', type: 'basic', username: '', password: '' });
    expect(emptyDraft('apiKey', 'x')).toEqual({ name: 'x', type: 'apiKey', paramName: '', in: 'header', key: '' });
    expect(emptyDraft('oauth2_clientCredentials', 'x')).toEqual({
      name: 'x',
      type: 'oauth2_clientCredentials',
      tokenUrl: '',
      clientId: '',
      clientSecret: '',
      scope: '',
    });
    expect(emptyDraft('oauth2_password', 'x')).toEqual({
      name: 'x',
      type: 'oauth2_password',
      tokenUrl: '',
      username: '',
      password: '',
      clientId: '',
      clientSecret: '',
      scope: '',
    });
    expect(emptyDraft('popup_login', 'x')).toEqual({ name: 'x', type: 'popup_login', loginUrl: '' });
  });
});

describe('isDraftComplete', () => {
  it('requires a name for every type', () => {
    expect(isDraftComplete({ name: '', type: 'bearer', token: 'x' })).toBe(false);
  });

  it('bearer requires a token', () => {
    expect(isDraftComplete({ name: 'n', type: 'bearer', token: '' })).toBe(false);
    expect(isDraftComplete({ name: 'n', type: 'bearer', token: 'x' })).toBe(true);
  });

  it('basic requires both username and password', () => {
    expect(isDraftComplete({ name: 'n', type: 'basic', username: '', password: 'x' })).toBe(false);
    expect(isDraftComplete({ name: 'n', type: 'basic', username: 'x', password: '' })).toBe(false);
    expect(isDraftComplete({ name: 'n', type: 'basic', username: 'x', password: 'x' })).toBe(true);
  });

  it('apiKey requires paramName and key', () => {
    expect(isDraftComplete({ name: 'n', type: 'apiKey', paramName: '', in: 'header', key: 'x' })).toBe(false);
    expect(isDraftComplete({ name: 'n', type: 'apiKey', paramName: 'x', in: 'header', key: '' })).toBe(false);
    expect(isDraftComplete({ name: 'n', type: 'apiKey', paramName: 'x', in: 'header', key: 'x' })).toBe(true);
  });

  it('oauth2_clientCredentials requires tokenUrl, clientId, and clientSecret', () => {
    expect(
      isDraftComplete({ name: 'n', type: 'oauth2_clientCredentials', tokenUrl: '', clientId: 'x', clientSecret: 'x' })
    ).toBe(false);
    expect(
      isDraftComplete({ name: 'n', type: 'oauth2_clientCredentials', tokenUrl: 'x', clientId: '', clientSecret: 'x' })
    ).toBe(false);
    expect(
      isDraftComplete({ name: 'n', type: 'oauth2_clientCredentials', tokenUrl: 'x', clientId: 'x', clientSecret: '' })
    ).toBe(false);
    expect(
      isDraftComplete({ name: 'n', type: 'oauth2_clientCredentials', tokenUrl: 'x', clientId: 'x', clientSecret: 'x' })
    ).toBe(true);
  });

  it('oauth2_password requires tokenUrl, username, and password, but not clientId/clientSecret', () => {
    expect(isDraftComplete({ name: 'n', type: 'oauth2_password', tokenUrl: '', username: 'x', password: 'x' })).toBe(
      false
    );
    expect(isDraftComplete({ name: 'n', type: 'oauth2_password', tokenUrl: 'x', username: '', password: 'x' })).toBe(
      false
    );
    expect(isDraftComplete({ name: 'n', type: 'oauth2_password', tokenUrl: 'x', username: 'x', password: '' })).toBe(
      false
    );
    expect(isDraftComplete({ name: 'n', type: 'oauth2_password', tokenUrl: 'x', username: 'x', password: 'x' })).toBe(
      true
    );
  });

  it('popup_login requires only loginUrl — no secret at all', () => {
    expect(isDraftComplete({ name: 'n', type: 'popup_login', loginUrl: '' })).toBe(false);
    expect(isDraftComplete({ name: 'n', type: 'popup_login', loginUrl: 'x' })).toBe(true);
  });
});

describe('maskTail', () => {
  it('shows only the last 4 characters, prefixed with dots', () => {
    expect(maskTail('super-secret-token')).toBe('••••oken');
  });

  it('returns an empty string for an empty value', () => {
    expect(maskTail('')).toBe('');
  });
});

describe('maskedPreview', () => {
  it('never includes the raw secret value, for every credential type', () => {
    const credentials: Credential[] = [
      { id: '1', name: 'n', type: 'bearer', token: 'super-secret-token' },
      { id: '2', name: 'n', type: 'basic', username: 'alice', password: 'hunter2-super-secret' },
      { id: '3', name: 'n', type: 'apiKey', paramName: 'X-API-Key', in: 'header', key: 'super-secret-key' },
      { id: '4', name: 'n', type: 'oauth2_clientCredentials', tokenUrl: 'x', clientId: 'id', clientSecret: 'super-secret-cs' },
      { id: '5', name: 'n', type: 'oauth2_password', tokenUrl: 'x', username: 'alice', password: 'super-secret-pw' },
    ];

    for (const credential of credentials) {
      expect(maskedPreview(credential)).not.toContain('super-secret');
    }
  });

  it('popup_login has no secret at all and says so', () => {
    expect(maskedPreview({ id: '1', name: 'n', type: 'popup_login', loginUrl: 'https://x' })).toMatch(
      /no stored secret/
    );
  });
});

describe('toDraft', () => {
  it('strips the id, keeping every other field', () => {
    const credential: Credential = { id: 'c1', name: 'staging', type: 'bearer', token: 'secret' };
    expect(toDraft(credential)).toEqual({ name: 'staging', type: 'bearer', token: 'secret' });
  });
});

describe('CREDENTIAL_TYPE_LABELS', () => {
  it('has a label for every credential type', () => {
    const types: Array<Credential['type']> = [
      'bearer',
      'basic',
      'apiKey',
      'oauth2_clientCredentials',
      'oauth2_password',
      'popup_login',
    ];
    for (const type of types) {
      expect(CREDENTIAL_TYPE_LABELS[type]).toBeTruthy();
    }
  });
});
