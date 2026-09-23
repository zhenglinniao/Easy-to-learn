import type { TutorRequest } from '@easy-to-learn/domain';

import { AiProviderConfigurationError, loadAiProviderConfigs } from './ai-provider-config';
import { GeminiTutorModel } from './gemini-model';
import { resolveTutorPromptVersion, type TutorImageResolver } from './model-prompt';
import { OpenAiCompatibleTutorModel } from './openai-compatible-model';
import { ProviderTimeoutError, ProviderUnavailableError, type TutorModel } from './tutor-service';

type Environment = Record<string, string | undefined>;

export class FallbackTutorModel implements TutorModel {
  constructor(private readonly providers: readonly TutorModel[]) {
    if (providers.length === 0) throw new AiProviderConfigurationError('至少需要一个 AI Provider');
  }

  async generate(request: TutorRequest, correction?: string): Promise<unknown> {
    let lastError: ProviderTimeoutError | ProviderUnavailableError | undefined;
    for (const provider of this.providers) {
      try {
        return await provider.generate(request, correction);
      } catch (error) {
        if (
          !(error instanceof ProviderTimeoutError) &&
          !(error instanceof ProviderUnavailableError)
        ) {
          throw error;
        }
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    throw new ProviderUnavailableError('没有可用的 AI Provider');
  }
}

export const createTutorModelFromEnvironment = (
  resolveImage: TutorImageResolver,
  environment: Environment = process.env,
  fetchImpl: typeof fetch = fetch,
): TutorModel => {
  const promptVersion = resolveTutorPromptVersion(environment.AI_PROMPT_VERSION);
  const models = loadAiProviderConfigs(environment).map((config): TutorModel => {
    if (config.type === 'gemini') {
      return new GeminiTutorModel(
        config.apiKey,
        config.timeoutMs,
        config.model,
        resolveImage,
        promptVersion,
        config.id,
      );
    }
    return new OpenAiCompatibleTutorModel(
      config.id,
      config.baseUrl,
      config.model,
      config.apiKey,
      config.timeoutMs,
      config.responseFormat,
      config.wireApi,
      config.reasoningEffort,
      resolveImage,
      promptVersion,
      fetchImpl,
    );
  });
  return models.length === 1 ? models[0]! : new FallbackTutorModel(models);
};
