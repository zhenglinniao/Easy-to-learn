import type { TutorResponse } from '@easy-to-learn/domain';
import { describe, expect, it, vi } from 'vitest';

import { AiFeedbackService, type AiFeedbackRecord, type AiFeedbackStore } from './ai-feedback.js';
import { MemoryAiStateStore } from './ai-state.js';

const requestId = '018f47a4-6a1d-7c2e-8f30-123456789abc';
const actor = { kind: 'anonymous' as const, id: 'anon-1' };
const completed: TutorResponse['data'] = {
  requestId,
  result: {
    schemaVersion: 1,
    mode: 'solve',
    title: '一元一次方程',
    steps: [
      {
        id: 'step-1',
        title: '移项',
        blocks: [{ type: 'paragraph', text: '把常数项移到等号右边。' }],
      },
    ],
    metadata: {
      model: 'gemini-test',
      promptVersion: 'prompt-v2',
      generatedAt: '2026-09-23T00:00:00.000Z',
    },
  },
  quota: {
    dailyLimit: 3,
    remaining: 2,
    nextAllowedAt: '2026-09-23T00:05:00.000Z',
  },
};

const setup = async () => {
  const state = new MemoryAiStateStore();
  await state.cache('anonymous:anon-1', requestId, completed, new Date());
  const records = new Map<string, AiFeedbackRecord>();
  const store: AiFeedbackStore = {
    upsert: vi.fn(async (record) => {
      records.set(record.requestId, record);
      return true;
    }),
  };
  return { service: new AiFeedbackService(state, store, 'test-hash-secret'), store, records };
};

describe('AiFeedbackService', () => {
  it('只从服务端缓存读取模型元数据并保存不可逆 actor 摘要', async () => {
    const { service, records } = await setup();

    await service.submit(actor, { requestId, rating: -1, category: 'incorrect_answer' });

    expect(records.get(requestId)).toMatchObject({
      requestId,
      rating: -1,
      category: 'incorrect_answer',
      model: 'gemini-test',
      promptVersion: 'prompt-v2',
      schemaVersion: 1,
    });
    expect(records.get(requestId)?.actorHash).toMatch(/^[a-f0-9]{64}$/);
    expect(records.get(requestId)?.actorHash).not.toContain(actor.id);
  });

  it('重复 requestId 通过 upsert 更新评分，不创建第二个逻辑记录', async () => {
    const { service, store, records } = await setup();

    await service.submit(actor, { requestId, rating: -1, category: 'unclear_explanation' });
    await service.submit(actor, { requestId, rating: 1 });

    expect(store.upsert).toHaveBeenCalledTimes(2);
    expect(records).toHaveLength(1);
    expect(records.get(requestId)).toMatchObject({ rating: 1 });
    expect(records.get(requestId)).not.toHaveProperty('category');
  });

  it('拒绝非法枚举、自由文本和不属于当前身份的请求', async () => {
    const { service } = await setup();

    await expect(
      service.submit(actor, { requestId, rating: -1, category: 'made_up' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      service.submit(actor, { requestId, rating: -1, comment: '原始题目内容' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      service.submit({ kind: 'anonymous', id: 'another-actor' }, { requestId, rating: 1 }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('拒绝数据库检测到的跨身份 requestId 冲突', async () => {
    const { service, store } = await setup();
    vi.mocked(store.upsert).mockResolvedValueOnce(false);

    await expect(service.submit(actor, { requestId, rating: 1 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
});
