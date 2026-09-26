import { domainJsonSchemas, type TutorRequest } from '@easy-to-learn/domain';

import {
  attachTrustedMetadata,
  buildTutorPrompt,
  DEFAULT_TUTOR_PROMPT_VERSION,
  getTutorSystemInstruction,
  parseModelJson,
  SENSENOVA_COMPACT_TUTOR_CONTRACT,
  type TutorImageResolver,
} from './model-prompt.js';
import {
  ProviderTimeoutError,
  ProviderUnavailableError,
  type TutorModel,
} from './tutor-service.js';

export type OpenAiResponseFormat = 'json_schema' | 'json_object' | 'prompt';
export type OpenAiWireApi = 'chat_completions' | 'responses';
export type ModelReasoningEffort = 'none' | 'low' | 'high' | 'max';

const SENSENOVA_MAX_OUTPUT_TOKENS = 2_048;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
}

interface ResponsesApiResponse {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
}

export interface OpenAiFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type OpenAiFetch = (
  input: string | URL,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<OpenAiFetchResponse>;

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

const responsesOutputText = (payload: ResponsesApiResponse): string | undefined => {
  const text = payload.output
    ?.filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
  return text || undefined;
};

export class OpenAiCompatibleTutorModel implements TutorModel {
  constructor(
    private readonly providerId: string,
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string,
    private readonly timeoutMs = 30_000,
    private readonly responseFormat: OpenAiResponseFormat = 'json_schema',
    private readonly wireApi: OpenAiWireApi = 'chat_completions',
    private readonly reasoningEffort?: ModelReasoningEffort,
    private readonly resolveImage?: TutorImageResolver,
    private readonly promptVersion = DEFAULT_TUTOR_PROMPT_VERSION,
    private readonly fetchImpl: OpenAiFetch = fetch as unknown as OpenAiFetch,
  ) {}

  async generate(request: TutorRequest, correction?: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const isSenseNova = this.providerId === 'sensenova' || this.baseUrl.includes('sensenova.cn');
      const chatContent: Array<
        { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
      > = [
        {
          type: 'text',
          text: [
            buildTutorPrompt(request, correction, this.promptVersion),
            ...(this.responseFormat === 'prompt'
              ? [
                  ...(isSenseNova
                    ? [SENSENOVA_COMPACT_TUTOR_CONTRACT]
                    : [
                        '以下 JSON Schema 是唯一允许的输出结构。必须完整遵守 required、enum、oneOf、additionalProperties 等约束；不得输出 Markdown 代码围栏或解释文字：',
                        JSON.stringify(domainJsonSchemas.tutorResultV1),
                      ]),
                ]
              : []),
          ].join('\n'),
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
          chatContent.push({
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
      const baseUrl = this.baseUrl.replace(/\/$/, '');
      const requestBody =
        this.wireApi === 'responses'
          ? {
              model: this.model,
              // 首次生成保留少量表达空间；格式纠错必须稳定服从结构约束。
              temperature: correction ? 0 : 0.4,
              instructions: getTutorSystemInstruction(this.promptVersion),
              input: [
                {
                  role: 'user',
                  content: chatContent.map((part) =>
                    part.type === 'text'
                      ? { type: 'input_text', text: part.text }
                      : {
                          type: 'input_image',
                          image_url: part.image_url.url,
                          detail: 'original',
                        },
                  ),
                },
              ],
              ...(this.responseFormat === 'json_schema'
                ? {
                    text: {
                      format: {
                        type: 'json_schema',
                        name: 'tutor_result_v1',
                        schema: domainJsonSchemas.tutorResultV1,
                      },
                    },
                  }
                : this.responseFormat === 'json_object'
                  ? { text: { format: { type: 'json_object' } } }
                  : {}),
              ...(this.reasoningEffort ? { reasoning: { effort: this.reasoningEffort } } : {}),
            }
          : {
              model: this.model,
              temperature: correction ? 0 : isSenseNova ? 0.2 : 0.4,
              ...(isSenseNova ? { max_tokens: SENSENOVA_MAX_OUTPUT_TOKENS } : {}),
              messages: [
                { role: 'system', content: getTutorSystemInstruction(this.promptVersion) },
                { role: 'user', content: chatContent },
              ],
              ...(responseFormat ? { response_format: responseFormat } : {}),
              ...(isSenseNova
                ? { reasoning_effort: 'none' }
                : this.reasoningEffort
                  ? { reasoning_effort: this.reasoningEffort }
                  : {}),
            };
      const endpoint = this.wireApi === 'responses' ? '/responses' : '/chat/completions';
      const attempts = isSenseNova ? 2 : 1;
      const requestUrl = `${baseUrl}${endpoint}`;
      const requestInit = {
        method: 'POST' as const,
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      };
      let response: OpenAiFetchResponse | undefined;
      let lastTransportError: unknown;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          response = await this.fetchImpl(requestUrl, requestInit);
          const retryableStatus = response.status === 429 || response.status >= 500;
          if (response.ok || !retryableStatus || attempt === attempts - 1) break;
        } catch (error) {
          if (controller.signal.aborted) throw error;
          lastTransportError = error;
          if (attempt === attempts - 1) throw error;
        }
      }
      if (!response) {
        throw new ProviderUnavailableError(`${this.providerId} request failed`, {
          cause: lastTransportError,
        });
      }
      if (!response.ok) {
        throw new ProviderUnavailableError(
          `${this.providerId} request failed with status ${response.status}`,
        );
      }
      let payload = (await response.json()) as ChatCompletionResponse | ResponsesApiResponse;
      let text =
        this.wireApi === 'responses'
          ? responsesOutputText(payload as ResponsesApiResponse)
          : responseText(payload as ChatCompletionResponse);
      // SenseNova 偶尔会以 200 返回空 content；在同一总超时预算内只重试一次。
      if (!text && isSenseNova && !controller.signal.aborted) {
        response = await this.fetchImpl(requestUrl, requestInit);
        if (!response.ok) {
          throw new ProviderUnavailableError(
            `${this.providerId} empty response retry failed with status ${response.status}`,
          );
        }
        payload = (await response.json()) as ChatCompletionResponse | ResponsesApiResponse;
        text = responseText(payload as ChatCompletionResponse);
      }
      return attachTrustedMetadata(
        parseModelJson(text),
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
