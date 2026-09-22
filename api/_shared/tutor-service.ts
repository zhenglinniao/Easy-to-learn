import {
  tutorRequestSchema,
  tutorResultSchema,
  type TutorRequest,
  type TutorResponse,
} from '@easy-to-learn/domain';

import type { AiStateStore } from './ai-state';
import { ApiFault } from './fault';

export interface TutorActor {
  kind: 'anonymous' | 'user';
  id: string;
}

export interface TutorModel {
  generate(request: TutorRequest, correction?: string): Promise<unknown>;
}

export interface BoardAuthorizer {
  canAccess(actor: TutorActor, boardId: string): Promise<boolean>;
}

export class ProviderTimeoutError extends Error {}
export class ProviderUnavailableError extends Error {}

export class TutorService {
  constructor(
    private readonly state: AiStateStore,
    private readonly model: TutorModel,
    private readonly boards: BoardAuthorizer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(actor: TutorActor, input: unknown): Promise<TutorResponse> {
    const parsed = tutorRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new ApiFault('INVALID_INPUT', 'AI 请求格式不正确');
    }
    const request = parsed.data;
    if (actor.kind === 'anonymous' && !request.boardId.startsWith('local_')) {
      throw new ApiFault('FORBIDDEN', '游客只能访问本地临时画板');
    }
    if (actor.kind === 'user' && !(await this.boards.canAccess(actor, request.boardId))) {
      throw new ApiFault('BOARD_NOT_FOUND', '画板不存在或无权访问');
    }

    const actorKey = `${actor.kind}:${actor.id}`;
    const cached = await this.state.getCached(actorKey, request.requestId);
    if (cached) return { data: cached };

    const quota = await this.state.reserve(actorKey, request.requestId, this.now());
    if (quota.duplicateInFlight) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const completed = await this.state.getCached(actorKey, request.requestId);
        if (completed) return { data: completed };
      }
      throw new ApiFault('RATE_LIMITED', '相同请求正在处理中，请稍后重试', {
        retryAfterSeconds: 1,
      });
    }
    try {
      let candidate = await this.model.generate(request);
      let validated = tutorResultSchema.safeParse(candidate);
      if (!validated.success) {
        candidate = await this.model.generate(
          request,
          '上一次输出未通过 Tutor DSL，请只返回符合 JSON Schema 的 JSON。',
        );
        validated = tutorResultSchema.safeParse(candidate);
      }
      if (!validated.success) {
        throw new ApiFault('INVALID_MODEL_OUTPUT', 'AI 返回内容无法安全展示');
      }
      const data: TutorResponse['data'] = {
        requestId: request.requestId,
        result: validated.data,
        quota: { dailyLimit: 3, remaining: quota.remaining, nextAllowedAt: quota.nextAllowedAt },
      };
      await this.state.cache(actorKey, request.requestId, data, this.now());
      return { data };
    } catch (error) {
      if (error instanceof ApiFault) {
        if (error.code !== 'INVALID_MODEL_OUTPUT') {
          await this.state.refund(actorKey, request.requestId, this.now());
        }
        throw error;
      }
      await this.state.refund(actorKey, request.requestId, this.now());
      if (error instanceof ProviderTimeoutError) {
        throw new ApiFault('AI_TIMEOUT', 'AI 请求超时，请稍后重试');
      }
      if (error instanceof ProviderUnavailableError) {
        throw new ApiFault('AI_PROVIDER_ERROR', 'AI 服务暂时不可用，请稍后重试');
      }
      throw new ApiFault('AI_PROVIDER_ERROR', 'AI 服务暂时不可用，请稍后重试');
    }
  }
}
