import { describe, it, expect } from 'vitest';
import { CREDENTIAL_TYPE_LABELS, emptyDraft, isDraftComplete, maskedPreview, toDraft } from './credentialDraft.js';
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
      clientAuthMethod: 'basic',
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
      clientAuthMethod: 'basic',
    });
    expect(emptyDraft('cookie', 'x')).toEqual({ name: 'x', type: 'cookie', loginUrl: '' });
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
      isDraftComplete({
        name: 'n',
        type: 'oauth2_clientCredentials',
        tokenUrl: '',
        clientId: 'x',
        clientSecret: 'x',
        clientAuthMethod: 'basic',
      })
    ).toBe(false);
    expect(
      isDraftComplete({
        name: 'n',
        type: 'oauth2_clientCredentials',
        tokenUrl: 'x',
        clientId: '',
        clientSecret: 'x',
        clientAuthMethod: 'basic',
      })
    ).toBe(false);
    expect(
      isDraftComplete({
        name: 'n',
        type: 'oauth2_clientCredentials',
        tokenUrl: 'x',
        clientId: 'x',
        clientSecret: '',
        clientAuthMethod: 'basic',
      })
    ).toBe(false);
    expect(
      isDraftComplete({
        name: 'n',
        type: 'oauth2_clientCredentials',
        tokenUrl: 'x',
        clientId: 'x',
        clientSecret: 'x',
        clientAuthMethod: 'basic',
      })
    ).toBe(true);
  });

  it('oauth2_password requires tokenUrl, username, and password, but not clientId/clientSecret', () => {
    expect(
      isDraftComplete({
        name: 'n',
        type: 'oauth2_password',
        tokenUrl: '',
        username: 'x',
        password: 'x',
        clientAuthMethod: 'basic',
      })
    ).toBe(false);
    expect(
      isDraftComplete({
        name: 'n',
        type: 'oauth2_password',
        tokenUrl: 'x',
        username: '',
        password: 'x',
        clientAuthMethod: 'basic',
      })
    ).toBe(false);
    expect(
      isDraftComplete({
        name: 'n',
        type: 'oauth2_password',
        tokenUrl: 'x',
        username: 'x',
        password: '',
        clientAuthMethod: 'basic',
      })
    ).toBe(false);
    expect(
      isDraftComplete({
        name: 'n',
        type: 'oauth2_password',
        tokenUrl: 'x',
        username: 'x',
        password: 'x',
        clientAuthMethod: 'basic',
      })
    ).toBe(true);
  });

  it('cookie requires only a name — loginUrl is optional', () => {
    expect(isDraftComplete({ name: '', type: 'cookie', loginUrl: '' })).toBe(false);
    expect(isDraftComplete({ name: 'n', type: 'cookie', loginUrl: '' })).toBe(true);
    expect(isDraftComplete({ name: 'n', type: 'cookie', loginUrl: 'x' })).toBe(true);
  });
});

describe('maskedPreview', () => {
  it('never includes any raw secret value, for every credential type', () => {
    const credentials: Credential[] = [
      { id: '1', name: 'n', type: 'bearer', token: 'super-secret-token' },
      { id: '2', name: 'n', type: 'basic', username: 'alice', password: 'hunter2-super-secret' },
      { id: '3', name: 'n', type: 'apiKey', paramName: 'X-API-Key', in: 'header', key: 'super-secret-key' },
      {
        id: '4',
        name: 'n',
        type: 'oauth2_clientCredentials',
        tokenUrl: 'x',
        clientId: 'id',
        clientSecret: 'super-secret-cs',
        clientAuthMethod: 'basic',
      },
      {
        id: '5',
        name: 'n',
        type: 'oauth2_password',
        tokenUrl: 'x',
        username: 'alice',
        password: 'super-secret-pw',
        clientAuthMethod: 'basic',
      },
    ];

    for (const credential of credentials) {
      expect(maskedPreview(credential)).not.toContain('super-secret');
    }
  });

  it('bearer and oauth2_clientCredentials have no non-secret detail worth showing, so preview is empty', () => {
    expect(maskedPreview({ id: '1', name: 'n', type: 'bearer', token: 'super-secret-token' })).toBe('');
    expect(
      maskedPreview({
        id: '4',
        name: 'n',
        type: 'oauth2_clientCredentials',
        tokenUrl: 'x',
        clientId: 'id',
        clientSecret: 'secret',
        clientAuthMethod: 'basic',
      })
    ).toBe('');
  });

  it("basic shows the username plainly, with the password fully redacted (no characters revealed)", () => {
    const preview = maskedPreview({ id: '2', name: 'n', type: 'basic', username: 'alice', password: 'hunter2' });
    expect(preview).toBe('alice');
    expect(preview).not.toContain('hunter2');
  });

  it('apiKey shows the header/query param name plainly, with the key fully redacted', () => {
    const preview = maskedPreview({
      id: '3',
      name: 'n',
      type: 'apiKey',
      paramName: 'X-API-Key',
      in: 'header',
      key: 'super-secret-key',
    });
    expect(preview).toContain('X-API-Key (header)');
    expect(preview).not.toContain('super-secret-key');
  });

  it("oauth2_password shows the resource owner's username plainly, with the password fully redacted", () => {
    const preview = maskedPreview({
      id: '5',
      name: 'n',
      type: 'oauth2_password',
      tokenUrl: 'x',
      username: 'alice',
      password: 'hunter2',
      clientAuthMethod: 'basic',
    });
    expect(preview).toContain('alice');
    expect(preview).not.toContain('hunter2');
  });

  it('cookie has no secret at all and says so', () => {
    expect(maskedPreview({ id: '1', name: 'n', type: 'cookie', loginUrl: 'https://x' })).toMatch(
      /No stored secret/
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
      'cookie',
    ];
    for (const type of types) {
      expect(CREDENTIAL_TYPE_LABELS[type]).toBeTruthy();
    }
  });
});
