import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { ApiFault } from './fault.js';

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface AnonymousSession {
  id: string;
  expiresAt: string;
  keyVersion: string;
}

export interface SessionKey {
  version: string;
  secret: string;
}

const encode = (value: string): string => Buffer.from(value).toString('base64url');
const sign = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');

export const issueAnonymousSession = (
  key: SessionKey,
  now = new Date(),
): { session: AnonymousSession; cookieValue: string } => {
  const session: AnonymousSession = {
    id: randomBytes(24).toString('base64url'),
    expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1_000).toISOString(),
    keyVersion: key.version,
  };
  const payload = encode(JSON.stringify(session));
  return { session, cookieValue: `${payload}.${sign(payload, key.secret)}` };
};

export const verifyAnonymousSession = (
  cookieValue: string,
  keys: readonly SessionKey[],
  now = new Date(),
): AnonymousSession => {
  const [payload, signature, extra] = cookieValue.split('.');
  if (!payload || !signature || extra) {
    throw new ApiFault('INVALID_ANON_SESSION', '游客会话无效，请重新建立会话');
  }
  let session: AnonymousSession;
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AnonymousSession;
  } catch {
    throw new ApiFault('INVALID_ANON_SESSION', '游客会话无效，请重新建立会话');
  }
  const key = keys.find(({ version }) => version === session.keyVersion);
  const expected = key ? sign(payload, key.secret) : '';
  const validSignature =
    expected.length === signature.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  if (
    !key ||
    !validSignature ||
    !session.id ||
    !Number.isFinite(Date.parse(session.expiresAt)) ||
    Date.parse(session.expiresAt) <= now.getTime()
  ) {
    throw new ApiFault('INVALID_ANON_SESSION', '游客会话无效，请重新建立会话');
  }
  return session;
};

export const serializeAnonymousCookie = (value: string): string =>
  `etl_anon=${value}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`;
