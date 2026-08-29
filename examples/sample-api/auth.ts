// Local dev harness only — demo auth middleware for examples/sample-api.
// Each function here backs one of the credential types Enlace's
// Credentials drawer supports, deliberately spread one-per-operation (see
// customers.ts/products.ts/orders.ts and openapi.json's per-operation
// `security`) so trying each from the UI is a real, enforced round-trip —
// see README's "Try the credentials demo". requireCookie is the odd one
// out: unlike every other middleware here, its credential isn't a value
// sent on the request at all — see its own comment below.
import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { MOCK_OAUTH2_ISSUER_URL } from './mockOAuth2.js';

function unauthorized(res: Response, message: string) {
  res.status(401).json({ error: message });
}

// Set via the `dev:no-auth`/`start:no-auth` npm scripts to bypass every
// credential check below — handy for exercising the UI without wiring up
// any of the demo auth flows first.
const NO_AUTH = process.env.ENLACE_EXAMPLE_NO_AUTH === '1';

/** bearerAuth: a static shared token, no issuer behind it to verify against — presence-checked only, matching openapi.json's "any bearer token is accepted" description. */
export function requireBearer(req: Request, res: Response, next: NextFunction) {
  if (NO_AUTH) return next();
  if (!req.header('authorization')?.startsWith('Bearer ')) {
    unauthorized(res, 'Missing Authorization: Bearer <token>');
    return;
  }
  next();
}

/** basicAuth: same story as bearer — well-formedness only, not checked against a real user store. */
export function requireBasic(req: Request, res: Response, next: NextFunction) {
  if (NO_AUTH) return next();
  if (!req.header('authorization')?.startsWith('Basic ')) {
    unauthorized(res, 'Missing Authorization: Basic <base64>');
    return;
  }
  next();
}

/** apiKeyAuth: any non-empty X-API-Key value accepted — same static-secret story as bearer/basic. */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  if (NO_AUTH) return next();
  if (!req.header('x-api-key')) {
    unauthorized(res, 'Missing X-API-Key header');
    return;
  }
  next();
}

// Backs cookieAuth in openapi.json — the one credential type that isn't a
// header/query value at all. GET /auth/demo-login below sets this cookie
// directly (no redirect, no real login page needed) so the whole round
// trip is demoable against a bare API, unlike a real cookie-session login
// which typically needs a real frontend to redirect into.
export const DEMO_SESSION_COOKIE_NAME = 'enlace_demo_session';

/** cookieAuth: presence-checked only (same "demo-only" story as bearer/basic/apiKey) — proves the session cookie set by GET /auth/demo-login actually rides along on a later request. */
export function requireCookie(req: Request, res: Response, next: NextFunction) {
  if (NO_AUTH) return next();
  const cookieHeader = req.header('cookie') ?? '';
  const hasSessionCookie = cookieHeader.split(';').some((c) => c.trim().startsWith(`${DEMO_SESSION_COOKIE_NAME}=`));
  if (!hasSessionCookie) {
    unauthorized(res, `Missing ${DEMO_SESSION_COOKIE_NAME} cookie — visit GET /auth/demo-login first`);
    return;
  }
  next();
}

/**
 * Sets the demo session cookie directly and returns a small static
 * confirmation page — no redirect, no real UI. This is the whole "login"
 * a Cookie credential's optional Login page URL points at: Enlace never
 * drives this, the user just opens it in a new tab (or visits it
 * directly), and the cookie is set as a side effect, exactly like a real
 * login would set one — just without the real login in between.
 */
export function handleDemoLogin(_req: Request, res: Response) {
  res.cookie(DEMO_SESSION_COOKIE_NAME, 'demo', { httpOnly: true, sameSite: 'lax' });
  res.type('html').send(
    '<!doctype html><html><body style="font-family: sans-serif; padding: 2rem;"><h3>Logged in</h3><p>You can close this tab and return to Enlace.</p></body></html>'
  );
}

// Lazy + shared across every route using it — createRemoteJWKSet doesn't
// eagerly fetch, it fetches (and caches) on first jwtVerify() call, so
// this is safe to construct even before mockOAuth2.ts's server has
// actually started listening.
const oauth2Jwks = createRemoteJWKSet(new URL(`${MOCK_OAUTH2_ISSUER_URL}/jwks`));

/**
 * Backs both oauth2ClientCreds and oauth2Password in openapi.json — unlike
 * bearer/basic/apiKey above, this one is for real: the token must be a JWT
 * actually signed by mockOAuth2.ts's issuer, verified against its live
 * JWKS. Deliberately grant-type-agnostic (any valid token from our issuer
 * passes, regardless of which grant produced it) — a resource server
 * checks the token it was handed, not how the caller obtained it, same as
 * a real one would.
 */
export async function requireOAuth2Token(req: Request, res: Response, next: NextFunction) {
  if (NO_AUTH) return next();
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    unauthorized(res, 'Missing Authorization: Bearer <token>');
    return;
  }
  try {
    await jwtVerify(header.slice('Bearer '.length), oauth2Jwks);
    next();
  } catch {
    unauthorized(res, 'Invalid or expired token');
  }
}
