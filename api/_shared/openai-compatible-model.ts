import { domainJsonSchemas, type TutorRequest } from '@easy-to-learn/domain';

import {
  attachTrustedMetadata,
  buildTutorPrompt,
  DEFAULT_TUTOR_PROMPT_VERSION,
  getTutorSystemInstruction,
  parseModelJson,
  type TutorImageResolver,
} from './model-prompt';
import { ProviderTimeoutError, ProviderUnavailableError, type TutorModel } from './tutor-service';

export type OpenAiResponseFormat = 'json_schema' | 'json_object' | 'prompt';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
}

type FetchLike = typeof fetch;

const responseText = (payload: ChatCompletionResponse): string | undefined => {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
  }
  return undefined;
};

export class OpenAiCompatibleTutorModel implements TutorModel {
  constructor(
    private readonly providerId: string,
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string,
    private readonly timeoutMs = 30_000,
    private readonly responseFormat: OpenAiResponseFormat = 'json_schema',
    private readonly resolveImage?: TutorImageResolver,
    private readonly promptVersion = DEFAULT_TUTOR_PROMPT_VERSION,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async generate(request: TutorRequest, correction?: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const content: Array<
        { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
      > = [
        {
          type: 'text',
          text: buildTutorPrompt(request, correction, this.promptVersion),
        },
      ];
      if (request.image) {
        let data = request.image.base64;
        if (!data && request.image.uploadPath) {
          if (!this.resolveImage) throw new ProviderUnavailableError('图片上传服务未配置');
          data = await this.resolveImage(
            request.requestId,
            request.image.uploadPath,
            request.image.mimeType,
          );
        }
        if (data) {
          content.push({
            type: 'image_url',
            image_url: { url: `data:${request.image.mimeType};base64,${data}` },
          });
        }
      }

      const responseFormat =
        this.responseFormat === 'json_schema'
          ? {
              type: 'json_schema',
              json_schema: {
                name: 'tutor_result_v1',
                strict: true,
                schema: domainJsonSchemas.tutorResultV1,
              },
            }
          : this.responseFormat === 'json_object'
            ? { type: 'json_object' }
            : undefined;
      const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.6,
          messages: [
            { role: 'system', content: getTutorSystemInstruction(this.promptVersion) },
            { role: 'user', content },
          ],
          ...(responseFormat ? { response_format: responseFormat } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ProviderUnavailableError(
          `${this.providerId} request failed with status ${response.status}`,
        );
      }
      const payload = (await response.json()) as ChatCompletionResponse;
      return attachTrustedMetadata(
        parseModelJson(responseText(payload)),
        `${this.providerId}/${this.model}`,
        this.promptVersion,
      );
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ProviderTimeoutError(`${this.providerId} timeout`);
      }
      if (error instanceof ProviderUnavailableError) throw error;
      throw new ProviderUnavailableError(`${this.providerId} request failed`, { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
}
