import { createHash, createHmac, randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import type { Redis } from '@upstash/redis';
import {
  illustrationRequestSchema,
  type IllustrationResponse,
  type TutorResultV1,
} from '@easy-to-learn/domain';

import type { AiStateStore } from './ai-state.js';
import { ApiFault } from './fault.js';
import {
  ProviderTimeoutError,
  ProviderUnavailableError,
  type BoardAuthorizer,
  type TutorActor,
} from './tutor-service.js';

const IMAGE_TTL_SECONDS = 24 * 60 * 60;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ENCODED_IMAGE_LENGTH = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4;
const MAX_IMAGE_PROVIDER_ATTEMPTS = 3;
const IMAGE_RETRY_DELAYS_MS = [300, 900] as const;

export interface SenseNovaImageConfig {
  baseUrl: string;
  model: 'sensenova-u1.5-lite' | 'sensenova-u1.5-fast';
  apiKey: string;
  timeoutMs?: number;
}

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

export interface ImageGenerator {
  generate(prompt: string): Promise<GeneratedImage>;
}

class NonRetryableImageProviderError extends ProviderUnavailableError {}

const providerFailureDetails = (error: unknown): Record<string, string | number> => {
  const details: Record<string, string | number> = {};
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current instanceof Error; depth += 1) {
    details[`cause${depth}Name`] = current.name.slice(0, 80);
    const code = (current as Error & { code?: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') {
      details[`cause${depth}Code`] = String(code).slice(0, 80);
    }
    current = current.cause;
  }
  return details;
};

interface StoredIllustration {
  fileId: string;
  objectPath: string;
  mimeType: 'image/jpeg';
  byteSize: number;
  width: number;
  height: number;
}

type GeneratedIllustrationData = Omit<
  Extract<IllustrationResponse['data'], { status: 'generated' }>,
  'quota' | 'placement'
>;

export interface IllustrationArtifactRepository {
  read(actor: TutorActor, requestId: string): Promise<GeneratedIllustrationData | null>;
  write(
    actor: TutorActor,
    requestId: string,
    image: GeneratedImage,
  ): Promise<GeneratedIllustrationData>;
}

const readJpegSize = (bytes: Buffer): { width: number; height: number } | null => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (marker && marker >= 0xc0 && marker <= 0xc3) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
};

export class SenseNovaImageGenerator implements ImageGenerator {
  constructor(
    private readonly config: SenseNovaImageConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generate(prompt: string): Promise<GeneratedImage> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 45_000);
    try {
      let lastError: unknown;
      for (let attempt = 0; attempt < MAX_IMAGE_PROVIDER_ATTEMPTS; attempt += 1) {
        try {
          return await this.generateOnce(prompt, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) {
            throw new ProviderTimeoutError('sensenova image timeout');
          }
          if (error instanceof NonRetryableImageProviderError) throw error;
          lastError = error;
          const retryDelay = IMAGE_RETRY_DELAYS_MS[attempt];
          if (retryDelay !== undefined) {
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
          }
        }
      }
      if (lastError instanceof ProviderUnavailableError) throw lastError;
      throw new ProviderUnavailableError('sensenova image request failed', { cause: lastError });
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw error;
      if (error instanceof ProviderTimeoutError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderTimeoutError('sensenova image timeout');
      }
      throw new ProviderUnavailableError('sensenova image request failed', { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async generateOnce(prompt: string, signal: AbortSignal): Promise<GeneratedImage> {
    const response = await this.fetchImpl(
      `${this.config.baseUrl.replace(/\/$/, '')}/images/generations`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          prompt,
          n: 1,
          size: '1024x1024',
          output_format: 'jpeg',
          response_format: 'b64_json',
          // 教学插画必须忠实于已验证的目标步骤，关闭自动扩写，避免模型自行拼贴整份答案。
          prompt_extend: false,
          watermark: true,
        }),
        signal,
      },
    );
    if (!response.ok) {
      const message = `sensenova image request failed with status ${response.status}`;
      if (response.status !== 429 && response.status < 500) {
        throw new NonRetryableImageProviderError(message);
      }
      throw new ProviderUnavailableError(message);
    }
    const body = (await response.json()) as { data?: Array<{ b64_json?: unknown }> };
    const encoded = body.data?.[0]?.b64_json;
    if (
      typeof encoded !== 'string' ||
      encoded.length === 0 ||
      encoded.length > MAX_ENCODED_IMAGE_LENGTH ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
    ) {
      throw new ProviderUnavailableError('sensenova image response is invalid');
    }
    const bytes = Buffer.from(encoded, 'base64');
    const dimensions = readJpegSize(bytes);
    if (!dimensions || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      throw new ProviderUnavailableError('sensenova image payload is invalid');
    }
    return { bytes, mimeType: 'image/jpeg', ...dimensions };
  }
}

export class IllustrationArtifactStore implements IllustrationArtifactRepository {
  constructor(
    private readonly redis: Redis,
    private readonly actorHashSecret: string,
    private readonly supabaseUrl: string,
    private readonly serviceRoleKey: string,
  ) {}

  async read(actor: TutorActor, requestId: string): Promise<GeneratedIllustrationData | null> {
    const stored = await this.redis.get<StoredIllustration>(this.cacheKey(actor, requestId));
    if (!stored) return null;
    return this.response(stored);
  }

  async write(
    actor: TutorActor,
    requestId: string,
    image: GeneratedImage,
  ): Promise<GeneratedIllustrationData> {
    const actorHash = this.actorHash(actor);
    const contentHash = createHash('sha256').update(image.bytes).digest('hex');
    const stored: StoredIllustration = {
      fileId: randomUUID(),
      objectPath: `${actorHash}/${requestId}/${contentHash}.jpg`,
      mimeType: image.mimeType,
      byteSize: image.bytes.length,
      width: image.width,
      height: image.height,
    };
    const client = this.supabase();
    const { error: uploadError } = await client.storage
      .from('ai-temp')
      .upload(stored.objectPath, image.bytes, {
        contentType: image.mimeType,
        upsert: true,
      });
    if (uploadError) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '生成图片暂时无法保存');
    const cleanupAt = new Date(Date.now() + IMAGE_TTL_SECONDS * 1_000).toISOString();
    const { error: cleanupError } = await client.from('asset_cleanup_jobs').upsert(
      {
        object_path: stored.objectPath,
        reason: 'temp_expired',
        not_before: cleanupAt,
        status: 'pending',
        attempts: 0,
      },
      { onConflict: 'object_path' },
    );
    if (cleanupError) {
      await client.storage.from('ai-temp').remove([stored.objectPath]);
      throw new ApiFault('DEPENDENCY_UNAVAILABLE', '生成图片暂时无法保存');
    }
    await this.redis.set(this.cacheKey(actor, requestId), stored, { ex: IMAGE_TTL_SECONDS });
    return this.response(stored);
  }

  private async response(stored: StoredIllustration): Promise<GeneratedIllustrationData> {
    const { data, error } = await this.supabase()
      .storage.from('ai-temp')
      .createSignedUrl(stored.objectPath, IMAGE_TTL_SECONDS);
    if (error || !data) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '生成图片暂时无法读取');
    return {
      status: 'generated',
      asset: {
        fileId: stored.fileId,
        downloadUrl: data.signedUrl,
        mimeType: stored.mimeType,
        byteSize: stored.byteSize,
        width: stored.width,
        height: stored.height,
      },
    };
  }

  private actorHash(actor: TutorActor): string {
    return createHmac('sha256', this.actorHashSecret)
      .update(`${actor.kind}:${actor.id}`)
      .digest('hex');
  }

  private cacheKey(actor: TutorActor, requestId: string): string {
    return `ai:illustration:${this.actorHash(actor)}:${requestId}`;
  }

  private supabase() {
    return createClient(this.supabaseUrl, this.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
}

const VISUAL_CONTENT_KINDS = new Set([
  'exercise',
  'question',
  'food_dish',
  'produce',
  'object',
  'process',
  'diagram',
  'mixed',
]);
const VISUAL_GOALS = new Set([
  'explain',
  'recipe',
  'nutrition',
  'production',
  'growth',
  'mechanism',
  'compare',
  'explore',
]);
const ILLUSTRATABLE_DIAGRAM_TYPES = new Set(['flow', 'comic-strip', 'part-map']);

type IllustrationPlacement = Extract<
  IllustrationResponse['data'],
  { status: 'generated' }
>['placement'];

interface IllustrationTarget {
  step: TutorResultV1['steps'][number];
  stepIndex: number;
  placement: IllustrationPlacement;
}

const explanatoryText = (step: TutorResultV1['steps'][number]): string => {
  const summary = step.blocks
    .filter((block) => block.type !== 'diagram')
    .map((block) => {
      if (block.type === 'paragraph' || block.type === 'callout') return block.text;
      if (block.type === 'math') return `公式：${block.latex}`;
      if (block.type === 'code') return `代码展示 ${block.language} 中的数据或执行关系`;
      return block.items.join('；');
    })
    .join(' ')
    .trim();
  return summary.slice(0, 360);
};

const resolveIllustrationTarget = (result: TutorResultV1): IllustrationTarget | null => {
  if (result.steps.length === 0) return null;
  const preferredIndex = result.steps.findIndex((step) =>
    step.blocks.some(
      (block) => block.type === 'diagram' && ILLUSTRATABLE_DIAGRAM_TYPES.has(block.diagram.type),
    ),
  );
  const stepIndex = preferredIndex >= 0 ? preferredIndex : 0;
  const step = result.steps[stepIndex]!;
  const explanation = explanatoryText(step);
  return {
    step,
    stepIndex,
    placement: {
      stepId: step.id,
      stepTitle: step.title,
      altText: `“${result.title}”第 ${stepIndex + 1} 步“${step.title}”的教学插画`.slice(0, 240),
      caption: (explanation
        ? `这张图只对应“${step.title}”：${explanation}`
        : `这张图只对应“${step.title}”，请按本步骤中的关系和箭头阅读。`
      ).slice(0, 500),
    },
  };
};

const hasIllustratableDiagram = (result: TutorResultV1): boolean =>
  result.steps.some((step) =>
    step.blocks.some(
      (block) => block.type === 'diagram' && ILLUSTRATABLE_DIAGRAM_TYPES.has(block.diagram.type),
    ),
  );

export const shouldGenerateIllustration = (result: TutorResultV1): boolean =>
  result.mode === 'solve' &&
  Boolean(
    result.contentProfile &&
    VISUAL_CONTENT_KINDS.has(result.contentProfile.contentKind) &&
    (VISUAL_GOALS.has(result.contentProfile.learningGoal) ||
      (result.contentProfile.learningGoal === 'solve' && hasIllustratableDiagram(result))),
  );

export const buildIllustrationPrompt = (result: TutorResultV1): string => {
  const target = resolveIllustrationTarget(result);
  if (!target) throw new ProviderUnavailableError('illustration target step is missing');
  const diagramPlan = target.step.blocks
    .filter((block) => block.type === 'diagram')
    .map((block) => block.diagram);
  const explanation = explanatoryText(target.step);
  return [
    '创作一张嵌入单个讲解步骤的中文教学插画，不是整份答案的总览海报。',
    `课程主题：${result.title}。`,
    `唯一目标步骤：第 ${target.stepIndex + 1} 步“${target.step.title}”。`,
    explanation ? `这一步的讲解要点：${explanation}` : '',
    diagramPlan.length > 0
      ? `必须忠实表现的已验证关系（字段标签只用于理解，不要抄写到画面）：${JSON.stringify(diagramPlan)}`
      : '',
    '画面必须只解释这一步：主体、动作、箭头方向、前后状态和数量关系必须与上述步骤一致；不得拼贴其他步骤、最终总结或无关知识。',
    '采用温暖纸张背景、清晰主体、手绘线稿与柔和配色；先突出当前动作，再用箭头呈现输入到阶段结果的阅读顺序。',
    '只使用图形、部件、状态、动作和箭头表达；不要生成文字、数字、公式、代码、品牌标志或额外水印，准确文字由步骤卡片和图注负责。',
    '构图简洁、单一焦点、留白充足，缩放到步骤卡片宽度后仍能看懂。',
  ].join('\n');
};

export class IllustrationService {
  constructor(
    private readonly state: AiStateStore,
    private readonly boards: BoardAuthorizer,
    private readonly artifacts: IllustrationArtifactRepository,
    private readonly generator: ImageGenerator | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(actor: TutorActor, input: unknown): Promise<IllustrationResponse> {
    const parsed = illustrationRequestSchema.safeParse(input);
    if (!parsed.success) throw new ApiFault('INVALID_INPUT', '生图请求格式不正确');
    const { requestId, boardId } = parsed.data;
    if (actor.kind === 'anonymous' && !boardId.startsWith('local_')) {
      throw new ApiFault('FORBIDDEN', '游客只能访问本地临时画板');
    }
    if (actor.kind === 'user' && !(await this.boards.canAccess(actor, boardId))) {
      throw new ApiFault('BOARD_NOT_FOUND', '画板不存在或无权访问');
    }
    const actorKey = `${actor.kind}:${actor.id}`;
    const completed = await this.state.getCached(actorKey, requestId);
    if (!completed) throw new ApiFault('INVALID_INPUT', '对应的教学结果不存在或已过期');
    const quota = await this.state.status(actorKey, this.now());
    if (!shouldGenerateIllustration(completed.result)) {
      return { data: { status: 'not_applicable', quota } };
    }
    const target = resolveIllustrationTarget(completed.result);
    if (!target) return { data: { status: 'not_applicable', quota } };
    if (!this.generator) return { data: { status: 'unavailable', quota } };

    const cached = await this.artifacts.read(actor, requestId);
    if (cached) return { data: { ...cached, placement: target.placement, quota } };
    const reservation = await this.state.reserveImages(actorKey, requestId, 1, this.now());
    if (!reservation.granted) {
      return { data: { status: 'quota_exhausted', quota: reservation.quota } };
    }
    if (reservation.duplicate) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const existing = await this.artifacts.read(actor, requestId);
        if (existing) {
          return {
            data: {
              ...existing,
              placement: target.placement,
              quota: await this.state.status(actorKey, this.now()),
            },
          };
        }
      }
      throw new ApiFault('RATE_LIMITED', '这张插画正在生成，请稍后重试', {
        retryAfterSeconds: 1,
      });
    }
    try {
      const image = await this.generator.generate(buildIllustrationPrompt(completed.result));
      const asset = await this.artifacts.write(actor, requestId, image);
      return {
        data: {
          ...asset,
          placement: target.placement,
          quota: await this.state.status(actorKey, this.now()),
        },
      };
    } catch (error) {
      await this.state.refundImages(actorKey, requestId, this.now());
      if (error instanceof ApiFault) throw error;
      if (error instanceof ProviderTimeoutError) {
        console.warn(
          JSON.stringify({
            timestamp: this.now().toISOString(),
            level: 'warning',
            event: 'image_provider_timeout',
            requestId,
            detail: error.message.slice(0, 160),
          }),
        );
        throw new ApiFault('AI_TIMEOUT', '图片生成超时，文字与矢量图解已保留');
      }
      if (error instanceof ProviderUnavailableError) {
        console.error(
          JSON.stringify({
            timestamp: this.now().toISOString(),
            level: 'error',
            event: 'image_provider_unavailable',
            requestId,
            detail: error.message.slice(0, 160),
            ...providerFailureDetails(error),
          }),
        );
      }
      throw new ApiFault('AI_PROVIDER_ERROR', '图片生成暂时不可用，文字与矢量图解已保留');
    }
  }
}
