import { type TutorRequest } from '@easy-to-learn/domain';

import tutorPromptRegistry from '../../skills/canvas-tutor-planner/references/prompt-registry.json' with { type: 'json' };

import { ProviderUnavailableError } from './tutor-service.js';

type TutorPromptDefinition =
  (typeof tutorPromptRegistry.versions)[keyof typeof tutorPromptRegistry.versions];

export class TutorPromptConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TutorPromptConfigurationError';
  }
}

export const DEFAULT_TUTOR_PROMPT_VERSION = tutorPromptRegistry.defaultVersion;

const getPromptDefinition = (version: string): TutorPromptDefinition => {
  const definition = (tutorPromptRegistry.versions as Record<string, TutorPromptDefinition>)[
    version
  ];
  if (!definition) throw new TutorPromptConfigurationError(`未知 Tutor Prompt 版本：${version}`);
  return definition;
};

export const resolveTutorPromptVersion = (configured?: string): string => {
  const version = configured?.trim() || DEFAULT_TUTOR_PROMPT_VERSION;
  getPromptDefinition(version);
  return version;
};

export const isTutorPromptVersionConfigured = (configured?: string): boolean => {
  try {
    resolveTutorPromptVersion(configured);
    return true;
  } catch {
    return false;
  }
};

export type TutorImageResolver = (
  requestId: string,
  uploadPath: string,
  mimeType: 'image/png' | 'image/jpeg',
) => Promise<string>;

export const getTutorSystemInstruction = (promptVersion = DEFAULT_TUTOR_PROMPT_VERSION): string =>
  getPromptDefinition(promptVersion).systemInstruction;

export const TUTOR_SYSTEM_INSTRUCTION = getTutorSystemInstruction();

export const buildTutorPrompt = (
  request: TutorRequest,
  correction?: string,
  promptVersion = DEFAULT_TUTOR_PROMPT_VERSION,
): string => {
  const modeInstruction: Record<TutorRequest['mode'], string> =
    getPromptDefinition(promptVersion).modeInstructions;
  return [
    modeInstruction[request.mode],
    '输出契约：只返回一个 JSON 对象；顶层必须包含 schemaVersion、mode、title、steps；不得输出 rawHtml、boardHtml、finalAnswer 或未定义字段。每个 step 必须包含 id、title、blocks，blocks 只能使用 Tutor DSL 已支持的类型。',
    request.text ? `题目文字：${request.text}` : '',
    request.parentTutorBoardId ? `父辅导板：${request.parentTutorBoardId}` : '',
    request.targetStepId ? `目标步骤：${request.targetStepId}` : '',
    request.parentContext ? `父辅导板标题：${request.parentContext.title}` : '',
    request.parentContext
      ? `目标步骤已验证内容：${JSON.stringify(request.parentContext.step)}`
      : '',
    correction ?? '',
  ]
    .filter(Boolean)
    .join('\n');
};

export const parseModelJson = (text: string | undefined): unknown => {
  if (!text) throw new ProviderUnavailableError('模型没有返回文本');
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    return text;
  }
};

export const attachTrustedMetadata = (
  candidate: unknown,
  model: string,
  promptVersion: string,
): unknown => {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return candidate;
  }
  return {
    ...candidate,
    metadata: {
      model,
      promptVersion,
      generatedAt: new Date().toISOString(),
    },
  };
};
