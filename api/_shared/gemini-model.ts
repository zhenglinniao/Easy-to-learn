import { GoogleGenAI } from '@google/genai';
import { domainJsonSchemas, type TutorRequest } from '@easy-to-learn/domain';

import { DEFAULT_GEMINI_MODEL } from './ai-provider-config.js';
import {
  attachTrustedMetadata,
  buildTutorPrompt,
  DEFAULT_TUTOR_PROMPT_VERSION,
  getTutorSystemInstruction,
  parseModelJson,
  type TutorImageResolver,
} from './model-prompt.js';
import {
  ProviderTimeoutError,
  ProviderUnavailableError,
  type TutorModel,
} from './tutor-service.js';

export class GeminiTutorModel implements TutorModel {
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly timeoutMs = 30_000,
    private readonly model = DEFAULT_GEMINI_MODEL,
    private readonly resolveImage?: TutorImageResolver,
    private readonly promptVersion = DEFAULT_TUTOR_PROMPT_VERSION,
    private readonly providerId = 'gemini',
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generate(request: TutorRequest, correction?: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const parts: Array<
        { text: string } | { inlineData: { mimeType: 'image/png' | 'image/jpeg'; data: string } }
      > = [{ text: buildTutorPrompt(request, correction, this.promptVersion) }];
      if (request.image?.base64) {
        parts.push({
          inlineData: { mimeType: request.image.mimeType, data: request.image.base64 },
        });
      } else if (request.image?.uploadPath) {
        if (!this.resolveImage) throw new ProviderUnavailableError('图片上传服务未配置');
        parts.push({
          inlineData: {
            mimeType: request.image.mimeType,
            data: await this.resolveImage(
              request.requestId,
              request.image.uploadPath,
              request.image.mimeType,
            ),
          },
        });
      }
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts }],
        config: {
          abortSignal: controller.signal,
          // 首次生成保留少量表达空间；格式纠错必须稳定服从结构约束。
          temperature: correction ? 0 : 0.4,
          responseMimeType: 'application/json',
          responseJsonSchema: domainJsonSchemas.tutorResultV1,
          systemInstruction: getTutorSystemInstruction(this.promptVersion),
        },
      });
      return attachTrustedMetadata(
        parseModelJson(response.text),
        `${this.providerId}/${this.model}`,
        this.promptVersion,
      );
    } catch (error) {
      if (controller.signal.aborted) throw new ProviderTimeoutError('Gemini timeout');
      if (error instanceof ProviderUnavailableError) throw error;
      throw new ProviderUnavailableError('Gemini request failed', { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
}
