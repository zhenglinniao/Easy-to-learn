import type { AdminProviderView } from './client';

export interface AdminModelOption {
  id: string;
  label: string;
  family: string;
  description: string;
}

export const sensenovaTutorModels: readonly AdminModelOption[] = [
  {
    id: 'sensenova-6.8-flash-lite',
    label: 'SenseNova 6.8 Flash Lite',
    family: '日日新原生模型',
    description: '轻量高效的多模态模型，适合画布理解、规划和复杂信息呈现。',
  },
  {
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    family: '商汤平台兼容模型',
    description: '偏速度与成本的通用模型，适合日常问答、代码辅助和规模化调用。',
  },
  {
    id: 'deepseek-flash',
    label: 'DeepSeek V4.1 Flash',
    family: '商汤平台兼容模型',
    description: '强化复杂推理、Agent 与多模态理解，适合较复杂的画布拆解。',
  },
  {
    id: 'glm-5.2',
    label: 'GLM-5.2',
    family: '商汤平台兼容模型',
    description: '面向长程 Coding 与复杂工程任务，适合代码和长上下文内容。',
  },
  {
    id: 'kimi-k3',
    label: 'Kimi K3',
    family: '商汤平台兼容模型',
    description: '原生多模态 Agent 模型，适合长上下文、知识工作与复杂推理。',
  },
] as const;

export const deepseekDirectModels: readonly AdminModelOption[] = [
  {
    id: 'deepseek-flash',
    label: 'DeepSeek Flash',
    family: 'DeepSeek 直连模型',
    description: '低延迟通用模型，适合日常画布理解与结构化教学规划。',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    family: 'DeepSeek 直连模型',
    description: '面向更高质量复杂推理；可用性与计费以当前 DeepSeek 账户为准。',
  },
] as const;

export const sensenovaImageModels: readonly AdminModelOption[] = [
  {
    id: 'sensenova-u1.5-lite',
    label: 'SenseNova U1.5 Lite',
    family: '日日新生图模型',
    description: '生成与编辑一体，支持参考图与灵活修改，适合高质量教学插画。',
  },
  {
    id: 'sensenova-u1.5-fast',
    label: 'SenseNova U1.5 Fast',
    family: '日日新生图模型',
    description: 'U1.5 加速版，适合需要更快返回的手绘步骤插画。',
  },
] as const;

export const modelOptionsFor = (
  provider: AdminProviderView,
): readonly AdminModelOption[] | null => {
  if (provider.type !== 'openai-compatible') return null;
  const baseUrl = provider.baseUrl?.toLowerCase() ?? '';
  if (provider.id === 'sensenova' || baseUrl.includes('sensenova.cn')) {
    return sensenovaTutorModels;
  }
  if (provider.id === 'deepseek' || baseUrl.includes('deepseek.com')) {
    return deepseekDirectModels;
  }
  return null;
};

export const selectedModelDescription = (provider: AdminProviderView): string | null =>
  modelOptionsFor(provider)?.find(({ id }) => id === provider.model)?.description ?? null;

export const modelSelectionPatch = (
  provider: AdminProviderView,
  model: string,
): Pick<AdminProviderView, 'model' | 'label'> => {
  const option = modelOptionsFor(provider)?.find(({ id }) => id === model);
  return { model, label: option?.label ?? provider.label };
};

export const imageModelOptionsFor = (
  provider: AdminProviderView,
): readonly AdminModelOption[] | null => {
  if (provider.type !== 'openai-compatible') return null;
  const baseUrl = provider.baseUrl?.toLowerCase() ?? '';
  return provider.id === 'sensenova' || baseUrl.includes('sensenova.cn')
    ? sensenovaImageModels
    : null;
};
