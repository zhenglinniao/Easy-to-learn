import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';

import { AiProviderConfigurationError, loadAiProviderConfigs } from './ai-provider-config.js';
import { createTutorModelFromConfigs } from './ai-provider.js';
import { AdminModelPolicyStore, applyAdminModelPolicy } from './admin-model-policy.js';
import { isAdminUserId } from './admin-access.js';
import { UnlimitedAiStateStore, type AiStateStore } from './ai-state.js';
import { ApiFault } from './fault.js';
import { cookieValue, header, type HttpRequest } from './http.js';
import { resolveTutorPromptVersion, TutorPromptConfigurationError } from './model-prompt.js';
import { RedisAiStateStore } from './redis-ai-state.js';
import { verifyAnonymousSession, type SessionKey } from './session.js';
import {
  TutorService,
  type BoardAuthorizer,
  type TutorActor,
  type TutorModel,
} from './tutor-service.js';
import { UploadTicketService } from './upload-ticket.js';
import {
  AccountDeletionService,
  SupabaseAccountDeletionStore,
  type AuthenticatedAccount,
} from './account-deletion.js';
import { AiFeedbackService, SupabaseAiFeedbackStore } from './ai-feedback.js';
import {
  IllustrationArtifactStore,
  IllustrationService,
  SenseNovaImageGenerator,
} from './illustration-service.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '服务配置尚未完成');
  return value;
};

export const sessionKeysFromEnvironment = (): SessionKey[] =>
  required('ANON_SESSION_KEYS')
    .split(',')
    .map((item) => {
      const separator = item.indexOf(':');
      if (separator <= 0) throw new Error('ANON_SESSION_KEYS 格式错误');
      const key = { version: item.slice(0, separator), secret: item.slice(separator + 1) };
      if (key.secret.length < 32) throw new Error('匿名会话密钥至少需要 32 个字符');
      return key;
    });

export const createAiStateStore = (actor?: TutorActor): AiStateStore => {
  const store = new RedisAiStateStore(
    Redis.fromEnv(),
    required('ACTOR_HASH_SECRET'),
    required('AI_CACHE_ENCRYPTION_KEY'),
  );
  return actor?.kind === 'user' && isAdminUserId(actor.id)
    ? new UnlimitedAiStateStore(store)
    : store;
};

export const createAiFeedbackService = (): AiFeedbackService =>
  new AiFeedbackService(
    createAiStateStore(),
    new SupabaseAiFeedbackStore(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY')),
    required('ACTOR_HASH_SECRET'),
  );

export const createUploadTicketService = (): UploadTicketService =>
  new UploadTicketService(
    Redis.fromEnv(),
    required('ACTOR_HASH_SECRET'),
    required('SUPABASE_URL'),
    required('SUPABASE_SERVICE_ROLE_KEY'),
  );

export const resolveActor = async (
  request: HttpRequest,
): Promise<{ actor: TutorActor; accessToken?: string }> => {
  const authorization = header(request, 'authorization');
  if (authorization) {
    if (!authorization.startsWith('Bearer ')) {
      throw new ApiFault('AUTH_REQUIRED', '登录凭据无效');
    }
    const accessToken = authorization.slice(7);
    const supabase = createClient(required('SUPABASE_URL'), required('SUPABASE_ANON_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user) throw new ApiFault('AUTH_REQUIRED', '登录已失效，请重新登录');
    return { actor: { kind: 'user', id: data.user.id }, accessToken };
  }
  const anonymousCookie = cookieValue(request, 'etl_anon');
  if (!anonymousCookie) {
    throw new ApiFault('INVALID_ANON_SESSION', '请先建立游客会话');
  }
  const session = verifyAnonymousSession(anonymousCookie, sessionKeysFromEnvironment());
  return { actor: { kind: 'anonymous', id: session.id } };
};

class SupabaseBoardAuthorizer implements BoardAuthorizer {
  constructor(private readonly accessToken?: string) {}

  async canAccess(actor: TutorActor, boardId: string): Promise<boolean> {
    if (actor.kind === 'anonymous') return boardId.startsWith('local_');
    if (!this.accessToken) return false;
    const supabase = createClient(required('SUPABASE_URL'), required('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: `Bearer ${this.accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase
      .from('boards')
      .select('id')
      .eq('id', boardId)
      .maybeSingle();
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', '画板权限服务暂时不可用');
    return data !== null;
  }
}

export const createTutorService = async (
  actor: TutorActor,
  accessToken?: string,
): Promise<TutorService> => {
  let model: TutorModel;
  try {
    // 文字题和小型内嵌图片不依赖对象存储。仅在模型实际需要读取上传图片时，
    // 再创建需要 Supabase service role 的票据服务，避免无关配置阻断匿名文字辅导。
    const configs = loadAiProviderConfigs(process.env);
    const policy = await new AdminModelPolicyStore(
      Redis.fromEnv(),
      required('AI_CACHE_ENCRYPTION_KEY'),
    ).read(configs);
    model = createTutorModelFromConfigs(
      applyAdminModelPolicy(policy),
      (...args) => createUploadTicketService().resolve(actor, ...args),
      resolveTutorPromptVersion(process.env.AI_PROMPT_VERSION),
    );
  } catch (error) {
    if (
      error instanceof AiProviderConfigurationError ||
      error instanceof TutorPromptConfigurationError
    ) {
      throw new ApiFault('DEPENDENCY_UNAVAILABLE', 'AI 服务配置尚未完成');
    }
    throw error;
  }
  return new TutorService(
    createAiStateStore(actor),
    model,
    new SupabaseBoardAuthorizer(accessToken),
  );
};

export const createIllustrationService = async (
  actor: TutorActor,
  accessToken?: string,
): Promise<IllustrationService> => {
  const configs = loadAiProviderConfigs(process.env);
  const policy = await new AdminModelPolicyStore(
    Redis.fromEnv(),
    required('AI_CACHE_ENCRYPTION_KEY'),
  ).read(configs);
  const provider = policy.providers.find(
    (item) => item.type === 'openai-compatible' && item.imageModel && item.apiKey,
  );
  const generator =
    provider?.type === 'openai-compatible' && provider.imageModel && provider.apiKey
      ? new SenseNovaImageGenerator({
          baseUrl: provider.baseUrl,
          model: provider.imageModel,
          apiKey: provider.apiKey,
          timeoutMs: 90_000,
        })
      : null;
  return new IllustrationService(
    createAiStateStore(actor),
    new SupabaseBoardAuthorizer(accessToken),
    new IllustrationArtifactStore(
      Redis.fromEnv(),
      required('ACTOR_HASH_SECRET'),
      required('SUPABASE_URL'),
      required('SUPABASE_SERVICE_ROLE_KEY'),
    ),
    generator,
  );
};

export const resolveAuthenticatedAccount = async (
  request: HttpRequest,
): Promise<AuthenticatedAccount> => {
  const authorization = header(request, 'authorization');
  if (!authorization?.startsWith('Bearer ')) throw new ApiFault('AUTH_REQUIRED', '请先登录');
  const accessToken = authorization.slice(7);
  const supabase = createClient(required('SUPABASE_URL'), required('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new ApiFault('AUTH_REQUIRED', '登录已失效，请重新登录');
  const payload = JSON.parse(
    Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as { auth_time?: number; iat?: number };
  const authenticatedAt = new Date((payload.auth_time ?? payload.iat ?? 0) * 1_000);
  return { userId: data.user.id, authenticatedAt };
};

export const createAccountDeletionService = (): AccountDeletionService =>
  new AccountDeletionService(
    new SupabaseAccountDeletionStore(
      required('SUPABASE_URL'),
      required('SUPABASE_SERVICE_ROLE_KEY'),
      required('ACTOR_HASH_SECRET'),
    ),
  );
