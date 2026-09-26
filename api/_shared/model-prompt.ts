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

export const SENSENOVA_COMPACT_TUTOR_CONTRACT = [
  'SenseNova 紧凑输出契约（服务器会再次严格校验）：',
  '只返回一个 JSON 对象，不要 Markdown、解释前言、尾注或 metadata（metadata 由服务器写入）。总 JSON 控制在 16KB 内。',
  '顶层字段：schemaVersion=1；mode=solve|hint|explain_step；title；contentProfile={contentKind,learningGoal,goalSource,confidence}；steps；仅在求解型 solve 输出 answerPresentation={problemType,conclusionPosition}；hint 还要输出 hintLevel=3。不得增加其他字段。',
  'solve/explain_step 使用 1-5 步；hint 恰好 3 步且各 step.hintLevel 依次为 1、2、3。每步仅含 id、title、blocks（及 hintLevel），不要 explanation。',
  '每步 blocks 恰好 2 个：一个 diagram，加一个 paragraph|math|code|list|callout。文字简洁：title<=40 字，paragraph/callout<=180 字，list<=5 项，code<=40 行。数学内容至少有一幅 comic-strip。',
  '颜色只用 neutral|blue|green|amber|red|purple；所有 id 只用字母、数字、下划线或连字符且唯一。',
  '图解 block 必须写成 {type:"diagram",diagram:<下列图解对象>}，不可把 flow、comic-strip 等直接作为 block.type。diagram 只使用以下精确结构之一：',
  'flow={type:"flow",direction:"TB"|"LR",nodes:[{id,label,shape:"rectangle"|"rounded"|"diamond",color}],edges:[{id,from,to,label?,style:"solid"|"dashed"}]}，nodes<=8，edges<=10；',
  'comic-strip={type:"comic-strip",layout:"single"|"sequence",panels:[{id,motif:"idea"|"balance"|"magnifier"|"puzzle"|"numbers"|"shapes"|"book"|"sprout"|"food"|"gear"|"chart",pose:"point"|"think"|"cheer"|"observe",label,caption,color}]}，panels<=3；',
  'part-map={type:"part-map",layout:"exploded"|"layers"|"callout",subject:{label,motif:"object"|"food"|"plant"|"body"|"device"|"concept",color},parts:[{id,label,detail,role:"shell"|"core"|"layer"|"component"|"ingredient"|"material"|"input"|"output",color}],takeaway}，parts=2-6；',
  'coordinate-plane={type:"coordinate-plane",xRange:[min,max],yRange:[min,max],showGrid,showAxes,points:[{id,x,y,label?,color}],segments:[{from:[x,y],to:[x,y],label?,color}]}，points/segments各<=8；',
  'geometry={type:"geometry",viewport:{xMin,xMax,yMin,yMax},primitives:[point|segment|polygon|circle|angle]}，primitives<=12；primitive 必须按类型使用 kind 及对应坐标字段，并包含 color。',
  '非图解块精确结构：paragraph={type:"paragraph",text}；math={type:"math",latex,display}；code={type:"code",language:"text"|"javascript"|"typescript"|"java"|"python"|"sql"|"c"|"cpp",code}；list={type:"list",style:"ordered"|"unordered",items}；callout={type:"callout",tone:"info"|"warning"|"success",text}。',
  '优先完整闭合 JSON；达到长度预算时减少步骤、节点和措辞，不得截断。',
].join('\n');

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
  const parseCandidate = (candidate: string): unknown => {
    const parsed: unknown = JSON.parse(candidate);
    // 部分 OpenAI-compatible Responses 实现会把结构化 JSON 再编码为字符串。
    // 只额外解码一层，既兼容该差异，也避免无限递归或接受任意多层包装。
    if (typeof parsed === 'string') {
      const nested = parsed.trim();
      if (nested.startsWith('{') && nested.endsWith('}')) return JSON.parse(nested);
    }
    return parsed;
  };
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return parseCandidate(cleaned);
  } catch {
    // 仅支持提示词约束的模型可能在 JSON 前后加上说明。
    // 提取后仍必须通过严格 Tutor DSL 校验，不放宽安全边界。
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
    if (fenced) {
      try {
        return parseCandidate(fenced.trim());
      } catch {
        // 继续尝试从普通文本中提取对象。
      }
    }

    const start = text.indexOf('{');
    if (start >= 0) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = start; index < text.length; index += 1) {
        const character = text[index]!;
        if (inString) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') inString = true;
        else if (character === '{') depth += 1;
        else if (character === '}') {
          depth -= 1;
          if (depth === 0) {
            try {
              return parseCandidate(text.slice(start, index + 1));
            } catch {
              break;
            }
          }
        }
      }
    }
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
