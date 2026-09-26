import { AdminService, requireAdmin, resolveAdminAccess } from '../_shared/admin.js';
import { ApiFault } from '../_shared/fault.js';
import {
  header,
  requireAllowedOrigin,
  sendError,
  type HttpRequest,
  type HttpResponse,
} from '../_shared/http.js';

const actionFrom = (request: HttpRequest): string => {
  const pathname = new URL(request.url ?? '/api/admin/unknown', 'http://local').pathname;
  return pathname.split('/').filter(Boolean).at(-1) ?? '';
};

const requireJson = (request: HttpRequest): void => {
  if (!header(request, 'content-type')?.toLowerCase().startsWith('application/json')) {
    throw new ApiFault('UNSUPPORTED_MEDIA_TYPE', 'Content-Type 必须是 application/json');
  }
};

export default async function handler(request: HttpRequest, response: HttpResponse): Promise<void> {
  try {
    requireAllowedOrigin(request);
    const action = actionFrom(request);

    if (action === 'access') {
      if (request.method !== 'GET') throw new ApiFault('INVALID_INPUT', '仅支持 GET 请求');
      const { isAdmin } = await resolveAdminAccess(request);
      response.status(200).json({ data: { isAdmin } });
      return;
    }

    if (action === 'overview') {
      if (request.method !== 'GET') throw new ApiFault('INVALID_INPUT', '仅支持 GET 请求');
      await requireAdmin(request);
      const url = new URL(request.url ?? '/api/admin/overview', 'http://local');
      const requestedPage = Number(url.searchParams.get('page') ?? 1);
      const page = Number.isInteger(requestedPage)
        ? Math.min(10_000, Math.max(1, requestedPage))
        : 1;
      const search = (url.searchParams.get('search') ?? '').slice(0, 120);
      response.status(200).json({ data: await new AdminService().overview(page, search) });
      return;
    }

    if (action === 'models') {
      if (request.method !== 'PATCH') throw new ApiFault('INVALID_INPUT', '仅支持 PATCH 请求');
      requireJson(request);
      const adminUserId = await requireAdmin(request);
      const policy = await new AdminService().updateModels(adminUserId, request.body);
      response.status(200).json({ data: { policy } });
      return;
    }

    if (action === 'accounts') {
      if (request.method !== 'PATCH') throw new ApiFault('INVALID_INPUT', '仅支持 PATCH 请求');
      requireJson(request);
      const adminUserId = await requireAdmin(request);
      const account = await new AdminService().updateAccount(adminUserId, request.body);
      response.status(200).json({ data: { account } });
      return;
    }

    throw new ApiFault('INVALID_INPUT', '管理员接口不存在');
  } catch (error) {
    sendError(response, error);
  }
}
