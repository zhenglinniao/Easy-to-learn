import { ApiFault } from '../_shared/fault.js';
import {
  cookieValue,
  requireAllowedOrigin,
  sendError,
  type HttpRequest,
  type HttpResponse,
} from '../_shared/http.js';
import { createAiStateStore, sessionKeysFromEnvironment } from '../_shared/runtime.js';
import {
  issueAnonymousSession,
  serializeAnonymousCookie,
  verifyAnonymousSession,
} from '../_shared/session.js';

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  try {
    if (request.method !== 'POST') throw new ApiFault('INVALID_INPUT', '仅支持 POST 请求');
    requireAllowedOrigin(request);
    const keys = sessionKeysFromEnvironment();
    const existing = cookieValue(request, 'etl_anon');
    let session;
    if (existing) {
      try {
        session = verifyAnonymousSession(existing, keys);
      } catch {
        session = undefined;
      }
    }
    if (!session) {
      const issued = issueAnonymousSession(keys[0]!);
      session = issued.session;
      response.setHeader('Set-Cookie', serializeAnonymousCookie(issued.cookieValue));
    }
    const quota = await createAiStateStore().status(`anonymous:${session.id}`, new Date());
    response.setHeader('X-Request-Id', randomUUID());
    response.status(200).json({ data: { expiresAt: session.expiresAt, quota } });
  } catch (error) {
    sendError(response, error);
  }
}
import { randomUUID } from 'node:crypto';
