import { AdminService, requireAdmin } from '../_shared/admin.js';
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
    await requireAdmin(request);
    const url = new URL(request.url ?? '/api/admin/overview', 'http://local');
    const requestedPage = Number(url.searchParams.get('page') ?? 1);
    const page = Number.isInteger(requestedPage)
      ? Math.min(10_000, Math.max(1, requestedPage))
      : 1;
    const search = (url.searchParams.get('search') ?? '').slice(0, 120);
    response.status(200).json({ data: await new AdminService().overview(page, search) });
  } catch (error) {
    sendError(response, error);
  }
}
