import type {
  ModelReasoningEffort,
  OpenAiResponseFormat,
  OpenAiWireApi,
} from './openai-compatible-model.js';

type Environment = Record<string, string | undefined>;

export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
export const MAX_AI_PROVIDERS = 3;
export const MAX_PROVIDER_CHAIN_TIMEOUT_MS = 50_000;

interface CommonProviderConfig {
  id: string;
  model: string;
  timeoutMs: number;
}

export interface GeminiProviderConfig extends CommonProviderConfig {
  type: 'gemini';
  apiKey: string;
}

export interface OpenAiCompatibleProviderConfig extends CommonProviderConfig {
  type: 'openai-compatible';
  baseUrl: string;
  apiKey?: string;
  responseFormat: OpenAiResponseFormat;
  wireApi: OpenAiWireApi;
  reasoningEffort?: ModelReasoningEffort;
}

export type AiProviderConfig = GeminiProviderConfig | OpenAiCompatibleProviderConfig;

export class AiProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiProviderConfigurationError';
  }
}

const requiredValue = (environment: Environment, name: string): string => {
  const value = environment[name]?.trim();
  if (!value) throw new AiProviderConfigurationError(`${name} 未配置`);
  return value;
};

const timeoutValue = (environment: Environment, name: string, fallback: number): number => {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1_000 || value > MAX_PROVIDER_CHAIN_TIMEOUT_MS) {
    throw new AiProviderConfigurationError(
      `${name} 必须是 1000 到 ${MAX_PROVIDER_CHAIN_TIMEOUT_MS} 的整数`,
    );
  }
  return value;
};

const providerPrefix = (id: string): string => `AI_PROVIDER_${id.toUpperCase()}`;

const parseProvider = (
  id: string,
  environment: Environment,
  defaultTimeoutMs: number,
): AiProviderConfig => {
  if (!/^[a-z][a-z0-9_]*$/i.test(id)) {
    throw new AiProviderConfigurationError(`AI Provider 标识 ${id} 格式错误`);
  }
  const prefix = providerPrefix(id);
  const type = requiredValue(environment, `${prefix}_TYPE`).toLowerCase();
  const model = requiredValue(environment, `${prefix}_MODEL`);
  const timeoutMs = timeoutValue(environment, `${prefix}_TIMEOUT_MS`, defaultTimeoutMs);

  if (type === 'gemini') {
    return {
      id,
      type,
      model,
      timeoutMs,
      apiKey: requiredValue(environment, `${prefix}_API_KEY`),
    };
  }
  if (type === 'openai-compatible') {
    const baseUrl = requiredValue(environment, `${prefix}_BASE_URL`).replace(/\/$/, '');
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(baseUrl);
    } catch {
      throw new AiProviderConfigurationError(`${prefix}_BASE_URL 不是有效 URL`);
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new AiProviderConfigurationError(`${prefix}_BASE_URL 只允许 http 或 https`);
    }
    const responseFormat = (environment[`${prefix}_RESPONSE_FORMAT`]?.trim() ??
      'json_schema') as OpenAiResponseFormat;
    if (!['json_schema', 'json_object', 'prompt'].includes(responseFormat)) {
      throw new AiProviderConfigurationError(
        `${prefix}_RESPONSE_FORMAT 必须是 json_schema、json_object 或 prompt`,
      );
    }
    const wireApi = (environment[`${prefix}_WIRE_API`]?.trim() ??
      'chat_completions') as OpenAiWireApi;
    if (!['chat_completions', 'responses'].includes(wireApi)) {
      throw new AiProviderConfigurationError(
        `${prefix}_WIRE_API 必须是 chat_completions 或 responses`,
      );
    }
    const reasoningEffort = environment[`${prefix}_REASONING_EFFORT`]?.trim() as
      ModelReasoningEffort | undefined;
    if (reasoningEffort && !['none', 'low', 'high', 'max'].includes(reasoningEffort)) {
      throw new AiProviderConfigurationError(
        `${prefix}_REASONING_EFFORT 必须是 none、low、high 或 max`,
      );
    }
    const apiKey = environment[`${prefix}_API_KEY`]?.trim();
    return {
      id,
      type,
      model,
      timeoutMs,
      baseUrl,
      responseFormat,
      wireApi,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(apiKey ? { apiKey } : {}),
    };
  }
  throw new AiProviderConfigurationError(`${prefix}_TYPE 不支持：${type}`);
};

export const loadAiProviderConfigs = (environment: Environment): AiProviderConfig[] => {
  const configuredProviders = environment.AI_PROVIDERS?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  // 兼容旧部署：未声明 Provider 链时继续读取原 Gemini 变量。
  if (!configuredProviders?.length) {
    const apiKey = environment.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw new AiProviderConfigurationError('AI_PROVIDERS 未配置，且没有可兼容的 GEMINI_API_KEY');
    }
    return [
      {
        id: 'gemini',
        type: 'gemini',
        apiKey,
        model: environment.AI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
        timeoutMs: timeoutValue(environment, 'AI_TIMEOUT_MS', MAX_PROVIDER_CHAIN_TIMEOUT_MS),
      },
    ];
  }

  if (configuredProviders.length > MAX_AI_PROVIDERS) {
    throw new AiProviderConfigurationError(`AI_PROVIDERS 最多允许 ${MAX_AI_PROVIDERS} 个 Provider`);
  }
  if (
    new Set(configuredProviders.map((id) => id.toLowerCase())).size !== configuredProviders.length
  ) {
    throw new AiProviderConfigurationError('AI_PROVIDERS 中存在重复标识');
  }
  const defaultTimeoutMs = Math.floor(MAX_PROVIDER_CHAIN_TIMEOUT_MS / configuredProviders.length);
  const configs = configuredProviders.map((id) => parseProvider(id, environment, defaultTimeoutMs));
  const timeoutBudget = configs.reduce((total, config) => total + config.timeoutMs, 0);
  if (timeoutBudget > MAX_PROVIDER_CHAIN_TIMEOUT_MS) {
    throw new AiProviderConfigurationError(
      `AI Provider 链累计超时不能超过 ${MAX_PROVIDER_CHAIN_TIMEOUT_MS} 毫秒`,
    );
  }
  return configs;
};

export const isAiProviderEnvironmentConfigured = (environment: Environment): boolean => {
  try {
    return loadAiProviderConfigs(environment).length > 0;
  } catch {
    return false;
  }
};
