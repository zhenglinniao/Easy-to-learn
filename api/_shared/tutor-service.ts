import {
  tutorRequestSchema,
  tutorResultSchema,
  type TutorRequest,
  type TutorResponse,
} from '@easy-to-learn/domain';

import type { AiStateStore } from './ai-state.js';
import { ApiFault } from './fault.js';

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

const correctionFromIssues = (issues: Array<{ path: PropertyKey[]; message: string }>): string => {
  const details = issues
    .slice(0, 8)
    .map(({ path, message }) => `${path.length ? path.join('.') : '<root>'}: ${message}`)
    .join('；');
  return [
    '上一次输出未通过 Tutor DSL。只返回符合 JSON Schema 的 JSON，不要添加未定义字段。',
    `需要修正：${details}`,
  ].join('\n');
};

const safeIssueSummary = (issues: Array<{ path: PropertyKey[]; message: string }>) =>
  issues.slice(0, 8).map(({ path, message }) => ({
    path: path.map(String).join('.'),
    message,
  }));

const normalizeKnownModelDrift = (candidate: unknown): unknown => {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return candidate;
  }

  const rawResult = candidate as Record<string, unknown>;
  const result = Object.fromEntries(
    Object.entries(rawResult).filter(
      ([key]) => key !== '$schema' && !(key === 'hintLevel' && rawResult.mode !== 'hint'),
    ),
  );
  if (!Array.isArray(result.steps)) return result;

  return {
    ...result,
    steps: result.steps.map((step) => {
      if (step === null || typeof step !== 'object' || Array.isArray(step)) return step;
      const stepRecord = step as Record<string, unknown>;
      if (!Array.isArray(stepRecord.blocks)) return step;
      return {
        ...stepRecord,
        blocks: stepRecord.blocks.map((block) => {
          if (block === null || typeof block !== 'object' || Array.isArray(block)) return block;
          const blockRecord = block as Record<string, unknown>;
          const diagram = blockRecord.diagram;
          if (
            blockRecord.type !== 'diagram' ||
            typeof blockRecord.takeaway !== 'string' ||
            diagram === null ||
            typeof diagram !== 'object' ||
            Array.isArray(diagram) ||
            (diagram as Record<string, unknown>).type !== 'part-map' ||
            typeof (diagram as Record<string, unknown>).takeaway === 'string'
          ) {
            return block;
          }
          const { takeaway, ...safeBlock } = blockRecord;
          return {
            ...safeBlock,
            diagram: { ...(diagram as Record<string, unknown>), takeaway },
          };
        }),
      };
    }),
  };
};

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
      let validated = tutorResultSchema.safeParse(normalizeKnownModelDrift(candidate));
      const initialIssues = validated.success ? [] : safeIssueSummary(validated.error.issues);
      if (!validated.success) {
        candidate = await this.model.generate(
          request,
          correctionFromIssues(validated.error.issues),
        );
        validated = tutorResultSchema.safeParse(normalizeKnownModelDrift(candidate));
      }
      if (!validated.success) {
        // 只记录契约字段路径和规则，不记录题目、图片或模型原文。
        console.warn(
          JSON.stringify({
            timestamp: this.now().toISOString(),
            level: 'warning',
            event: 'ai_model_output_invalid',
            requestId: request.requestId,
            initialIssues,
            correctionIssues: safeIssueSummary(validated.error.issues),
          }),
        );
        throw new ApiFault('INVALID_MODEL_OUTPUT', 'AI 返回内容无法安全展示');
      }
      const data: TutorResponse['data'] = {
        requestId: request.requestId,
        result: validated.data,
        quota: quota.quota,
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
