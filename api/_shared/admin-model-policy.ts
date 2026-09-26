import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import type { Redis } from '@upstash/redis';

import { MAX_PROVIDER_CHAIN_TIMEOUT_MS, type AiProviderConfig } from './ai-provider-config.js';
import type {
  ModelReasoningEffort,
  OpenAiResponseFormat,
  OpenAiWireApi,
} from './openai-compatible-model.js';
import { ApiFault } from './fault.js';

export const ADMIN_MODEL_POLICY_KEY = 'ai:admin:provider-config:v2';
export const MAX_ADMIN_PROVIDERS = 5;

interface StoredProviderBase {
  id: string;
  label: string;
  enabled: boolean;
  model: string;
  timeoutMs: number;
  apiKey?: string;
}
interface StoredGeminiProvider extends StoredProviderBase {
  type: 'gemini';
}
interface StoredOpenAiProvider extends StoredProviderBase {
  type: 'openai-compatible';
  baseUrl: string;
  responseFormat: OpenAiResponseFormat;
  wireApi: OpenAiWireApi;
  reasoningEffort?: ModelReasoningEffort;
  imageModel?: SenseNovaImageModel;
}
export type SenseNovaImageModel = 'sensenova-u1.5-lite' | 'sensenova-u1.5-fast';
export type StoredAdminProvider = StoredGeminiProvider | StoredOpenAiProvider;

export interface AdminProviderView {
  id: string;
  label: string;
  type: 'gemini' | 'openai-compatible';
  enabled: boolean;
  model: string;
  timeoutMs: number;
  hasApiKey: boolean;
  baseUrl?: string;
  responseFormat?: OpenAiResponseFormat;
  wireApi?: OpenAiWireApi;
  reasoningEffort?: ModelReasoningEffort;
  imageModel?: SenseNovaImageModel;
}
export interface AdminModelPolicy {
  providers: StoredAdminProvider[];
  updatedAt: string | null;
  updatedBy: string | null;
}
export interface AdminModelPolicyView {
  providers: AdminProviderView[];
  updatedAt: string | null;
  updatedBy: string | null;
}

const deriveKey = (encodedKey: string): Buffer => {
  const source = Buffer.from(encodedKey, 'base64');
  if (source.length !== 32) throw new Error('AI_CACHE_ENCRYPTION_KEY 必须是 32 字节 Base64');
  return createHmac('sha256', source).update('admin-provider-config:v2').digest();
};
const encrypt = (value: AdminModelPolicy, encodedKey: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(encodedKey), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
};
const decrypt = (value: string, encodedKey: string): unknown => {
  const payload = Buffer.from(value, 'base64url');
  if (payload.length < 29) throw new Error('管理员模型配置密文无效');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(encodedKey), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8'),
  );
};

const displayName = ({ id }: AiProviderConfig): string =>
  id === 'sensenova'
    ? 'SenseNova'
    : id === 'deepseek'
      ? 'DeepSeek'
      : id === 'gemini'
        ? 'Gemini'
        : id;

export const defaultAdminModelPolicy = (
  configs: readonly AiProviderConfig[],
): AdminModelPolicy => ({
  providers: configs.map((config) => ({ ...config, label: displayName(config), enabled: true })),
  updatedAt: null,
  updatedBy: null,
});

const allowedHosts = (configs: readonly AiProviderConfig[]): Set<string> => {
  const result = new Set(['token.sensenova.cn', 'api.deepseek.com', 'api.openai.com']);
  for (const config of configs) {
    if (config.type === 'openai-compatible') {
      try {
        result.add(new URL(config.baseUrl).hostname.toLowerCase());
      } catch {
        /* 原加载器负责校验 */
      }
    }
  }
  for (const host of process.env.AI_ADMIN_ALLOWED_PROVIDER_HOSTS?.split(',') ?? []) {
    if (host.trim()) result.add(host.trim().toLowerCase());
  }
  return result;
};
const cleanBaseUrl = (value: unknown, hosts: Set<string>): string => {
  if (typeof value !== 'string') throw new ApiFault('INVALID_INPUT', '服务地址格式不正确');
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ApiFault('INVALID_INPUT', '服务地址不是有效 URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new ApiFault('INVALID_INPUT', '服务地址必须是不含凭据、参数和锚点的 HTTPS URL');
  }
  if (!hosts.has(url.hostname.toLowerCase())) {
    throw new ApiFault('INVALID_INPUT', `服务域名 ${url.hostname} 不在管理员允许列表中`);
  }
  return url.toString().replace(/\/$/, '');
};
const cleanApiKey = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ApiFault('INVALID_INPUT', 'API Key 格式不正确');
  const key = value.trim();
  if (!key || key.length > 512 || /[\r\n]/.test(key))
    throw new ApiFault('INVALID_INPUT', 'API Key 格式不正确');
  return key;
};

export const validateAdminModelPolicy = (
  value: unknown,
  environmentConfigs: readonly AiProviderConfig[],
  current?: AdminModelPolicy,
): AdminModelPolicy => {
  if (!value || typeof value !== 'object' || !('providers' in value))
    throw new ApiFault('INVALID_INPUT', '模型配置格式不正确');
  const raw = value as { providers?: unknown; updatedAt?: unknown; updatedBy?: unknown };
  if (
    !Array.isArray(raw.providers) ||
    raw.providers.length === 0 ||
    raw.providers.length > MAX_ADMIN_PROVIDERS
  ) {
    throw new ApiFault('INVALID_INPUT', `必须配置 1 到 ${MAX_ADMIN_PROVIDERS} 个 Provider`);
  }
  const seen = new Set<string>();
  const existing = new Map(current?.providers.map((provider) => [provider.id, provider]));
  const hosts = allowedHosts(environmentConfigs);
  const providers = raw.providers.map((item): StoredAdminProvider => {
    if (!item || typeof item !== 'object')
      throw new ApiFault('INVALID_INPUT', '模型配置项目格式不正确');
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? candidate.id.trim().toLowerCase() : '';
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(id) || seen.has(id))
      throw new ApiFault('INVALID_INPUT', 'Provider 标识格式错误或重复');
    seen.add(id);
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    const model = typeof candidate.model === 'string' ? candidate.model.trim() : '';
    const timeoutMs = Number(candidate.timeoutMs);
    const enabled = candidate.enabled;
    if (!label || label.length > 60 || /[\r\n]/.test(label))
      throw new ApiFault('INVALID_INPUT', 'Provider 显示名称格式不正确');
    if (!model || model.length > 160 || /[\r\n]/.test(model))
      throw new ApiFault('INVALID_INPUT', '模型 ID 格式不正确');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 25_000)
      throw new ApiFault('INVALID_INPUT', '单个 Provider 超时必须为 1000 到 25000 毫秒');
    if (typeof enabled !== 'boolean')
      throw new ApiFault('INVALID_INPUT', 'Provider 启用状态格式不正确');
    const apiKey = cleanApiKey(candidate.apiKey) ?? existing.get(id)?.apiKey;
    const imageModel = candidate.imageModel;
    if (
      imageModel !== undefined &&
      !['sensenova-u1.5-lite', 'sensenova-u1.5-fast'].includes(String(imageModel))
    ) {
      throw new ApiFault('INVALID_INPUT', '生图模型 ID 不受支持');
    }
    if ((enabled || imageModel) && !apiKey)
      throw new ApiFault('INVALID_INPUT', `${label} 启用前必须配置 API Key`);
    if (candidate.type === 'gemini') {
      if (imageModel)
        throw new ApiFault('INVALID_INPUT', 'U1.5 生图模型只能配置在商汤日日新 Provider');
      return {
        id,
        label,
        type: 'gemini',
        enabled,
        model,
        timeoutMs,
        ...(apiKey ? { apiKey } : {}),
      };
    }
    if (candidate.type !== 'openai-compatible')
      throw new ApiFault('INVALID_INPUT', 'Provider 类型不受支持');
    const responseFormat = candidate.responseFormat;
    const wireApi = candidate.wireApi;
    const reasoningEffort = candidate.reasoningEffort;
    if (!['json_schema', 'json_object', 'prompt'].includes(String(responseFormat)))
      throw new ApiFault('INVALID_INPUT', '结构化输出模式不受支持');
    if (!['chat_completions', 'responses'].includes(String(wireApi)))
      throw new ApiFault('INVALID_INPUT', '接口模式不受支持');
    if (
      reasoningEffort !== undefined &&
      !['none', 'low', 'high', 'max'].includes(String(reasoningEffort))
    )
      throw new ApiFault('INVALID_INPUT', '推理强度不受支持');
    const baseUrl = cleanBaseUrl(candidate.baseUrl, hosts);
    if (imageModel && id !== 'sensenova' && !baseUrl.includes('sensenova.cn')) {
      throw new ApiFault('INVALID_INPUT', 'U1.5 生图模型只能配置在商汤日日新 Provider');
    }
    return {
      id,
      label,
      type: 'openai-compatible',
      enabled,
      model,
      timeoutMs,
      baseUrl,
      responseFormat: responseFormat as OpenAiResponseFormat,
      wireApi: wireApi as OpenAiWireApi,
      ...(reasoningEffort ? { reasoningEffort: reasoningEffort as ModelReasoningEffort } : {}),
      ...(imageModel ? { imageModel: imageModel as SenseNovaImageModel } : {}),
      ...(apiKey ? { apiKey } : {}),
    };
  });
  const active = providers.filter((provider) => provider.enabled);
  if (active.length === 0) throw new ApiFault('INVALID_INPUT', '至少需要启用一个 AI Provider');
  if (active.reduce((sum, provider) => sum + provider.timeoutMs, 0) > MAX_PROVIDER_CHAIN_TIMEOUT_MS)
    throw new ApiFault('INVALID_INPUT', '启用模型的累计超时不能超过 25000 毫秒');
  return {
    providers,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null,
  };
};

export const toAdminModelPolicyView = (policy: AdminModelPolicy): AdminModelPolicyView => ({
  providers: policy.providers.map(({ apiKey, ...provider }) => ({
    ...provider,
    hasApiKey: Boolean(apiKey),
  })),
  updatedAt: policy.updatedAt,
  updatedBy: policy.updatedBy,
});
export const applyAdminModelPolicy = (policy: AdminModelPolicy): AiProviderConfig[] =>
  policy.providers
    .filter(({ enabled }) => enabled)
    .map((provider) => {
      const config = { ...provider } as Partial<StoredAdminProvider> & Record<string, unknown>;
      delete config.enabled;
      delete config.label;
      return config as unknown as AiProviderConfig;
    });

export class AdminModelPolicyStore {
  constructor(
    private readonly redis: Redis,
    private readonly encryptionKey: string,
  ) {}
  async read(configs: readonly AiProviderConfig[]): Promise<AdminModelPolicy> {
    try {
      const encrypted = await this.redis.get<string>(ADMIN_MODEL_POLICY_KEY);
      return encrypted
        ? validateAdminModelPolicy(decrypt(encrypted, this.encryptionKey), configs)
        : defaultAdminModelPolicy(configs);
    } catch {
      return defaultAdminModelPolicy(configs);
    }
  }
  async write(
    configs: readonly AiProviderConfig[],
    value: unknown,
    adminUserId: string,
  ): Promise<AdminModelPolicy> {
    const validated = validateAdminModelPolicy(value, configs, await this.read(configs));
    const policy = { ...validated, updatedAt: new Date().toISOString(), updatedBy: adminUserId };
    await this.redis.set(ADMIN_MODEL_POLICY_KEY, encrypt(policy, this.encryptionKey));
    return policy;
  }
}
