import { resolveAdminAccess } from '../_shared/admin.js';
import { ApiFault } from '../_shared/fault.js';
import {
  requireAllowedOrigin,
  sendError,
  type HttpRequest,
  type HttpResponse,
} from '../_shared/http.js';

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  try {
    if (request.method !== 'GET') throw new ApiFault('INVALID_INPUT', '仅支持 GET 请求');
    requireAllowedOrigin(request);
    const { isAdmin } = await resolveAdminAccess(request);
    response.status(200).json({ data: { isAdmin } });
  } catch (error) {
    sendError(response, error);
  }
}
