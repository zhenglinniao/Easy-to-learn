import type { Redis } from '@upstash/redis';

import { MAX_PROVIDER_CHAIN_TIMEOUT_MS, type AiProviderConfig } from './ai-provider-config.js';
import { ApiFault } from './fault.js';

export const ADMIN_MODEL_POLICY_KEY = 'ai:admin:provider-policy:v1';

export interface AdminProviderSetting {
  id: string;
  enabled: boolean;
  model: string;
  timeoutMs: number;
}

export interface AdminModelPolicy {
  providers: AdminProviderSetting[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export const defaultAdminModelPolicy = (
  configs: readonly AiProviderConfig[],
): AdminModelPolicy => ({
  providers: configs.map(({ id, model, timeoutMs }) => ({ id, enabled: true, model, timeoutMs })),
  updatedAt: null,
  updatedBy: null,
});

export const validateAdminModelPolicy = (
  value: unknown,
  configs: readonly AiProviderConfig[],
): AdminModelPolicy => {
  if (!value || typeof value !== 'object' || !('providers' in value)) {
    throw new ApiFault('INVALID_INPUT', '模型策略格式不正确');
  }
  const raw = value as { providers?: unknown; updatedAt?: unknown; updatedBy?: unknown };
  if (!Array.isArray(raw.providers) || raw.providers.length !== configs.length) {
    throw new ApiFault('INVALID_INPUT', '模型策略必须包含全部已配置 Provider');
  }
  const configuredIds = new Set(configs.map(({ id }) => id));
  const seen = new Set<string>();
  const providers = raw.providers.map((item): AdminProviderSetting => {
    if (!item || typeof item !== 'object') {
      throw new ApiFault('INVALID_INPUT', '模型策略项目格式不正确');
    }
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? candidate.id : '';
    const model = typeof candidate.model === 'string' ? candidate.model.trim() : '';
    const timeoutMs = Number(candidate.timeoutMs);
    if (!configuredIds.has(id) || seen.has(id)) {
      throw new ApiFault('INVALID_INPUT', '模型策略包含未知或重复 Provider');
    }
    if (!model || model.length > 160 || /[\r\n]/.test(model)) {
      throw new ApiFault('INVALID_INPUT', '模型名称格式不正确');
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 25_000) {
      throw new ApiFault('INVALID_INPUT', '单个 Provider 超时必须为 1000 到 25000 毫秒');
    }
    if (typeof candidate.enabled !== 'boolean') {
      throw new ApiFault('INVALID_INPUT', 'Provider 启用状态格式不正确');
    }
    seen.add(id);
    return { id, enabled: candidate.enabled, model, timeoutMs };
  });
  const enabled = providers.filter(({ enabled }) => enabled);
  if (enabled.length === 0) throw new ApiFault('INVALID_INPUT', '至少需要启用一个 AI Provider');
  if (enabled.reduce((sum, item) => sum + item.timeoutMs, 0) > MAX_PROVIDER_CHAIN_TIMEOUT_MS) {
    throw new ApiFault('INVALID_INPUT', '启用模型的累计超时不能超过 25000 毫秒');
  }
  return {
    providers,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null,
  };
};

export const applyAdminModelPolicy = (
  configs: readonly AiProviderConfig[],
  policy: AdminModelPolicy,
): AiProviderConfig[] => {
  const byId = new Map(configs.map((config) => [config.id, config]));
  return policy.providers
    .filter(({ enabled }) => enabled)
    .map(({ id, model, timeoutMs }) => ({ ...byId.get(id)!, model, timeoutMs }));
};

export class AdminModelPolicyStore {
  constructor(private readonly redis: Redis) {}

  async read(configs: readonly AiProviderConfig[]): Promise<AdminModelPolicy> {
    try {
      const raw = await this.redis.get<unknown>(ADMIN_MODEL_POLICY_KEY);
      return raw ? validateAdminModelPolicy(raw, configs) : defaultAdminModelPolicy(configs);
    } catch {
      return defaultAdminModelPolicy(configs);
    }
  }

  async write(
    configs: readonly AiProviderConfig[],
    value: unknown,
    adminUserId: string,
  ): Promise<AdminModelPolicy> {
    const validated = validateAdminModelPolicy(value, configs);
    const policy = {
      ...validated,
      updatedAt: new Date().toISOString(),
      updatedBy: adminUserId,
    };
    await this.redis.set(ADMIN_MODEL_POLICY_KEY, policy);
    return policy;
  }
}
