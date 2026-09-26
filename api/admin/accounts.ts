import { AdminService, requireAdmin } from '../_shared/admin.js';
import { ApiFault } from '../_shared/fault.js';
import {
  header,
  requireAllowedOrigin,
  sendError,
  type HttpRequest,
  type HttpResponse,
} from '../_shared/http.js';

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  try {
    if (request.method !== 'PATCH') throw new ApiFault('INVALID_INPUT', '仅支持 PATCH 请求');
    requireAllowedOrigin(request);
    if (!header(request, 'content-type')?.toLowerCase().startsWith('application/json')) {
      throw new ApiFault('UNSUPPORTED_MEDIA_TYPE', 'Content-Type 必须是 application/json');
    }
    const adminUserId = await requireAdmin(request);
    const account = await new AdminService().updateAccount(adminUserId, request.body);
    response.status(200).json({ data: { account } });
  } catch (error) {
    sendError(response, error);
  }
}
