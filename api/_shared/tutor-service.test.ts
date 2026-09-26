import type { TutorRequest, TutorResultV1 } from '@easy-to-learn/domain';
import { describe, expect, it, vi } from 'vitest';

import { MemoryAiStateStore } from './ai-state.js';
import { ApiFault } from './fault.js';
import { issueAnonymousSession, verifyAnonymousSession } from './session.js';
import {
  ProviderTimeoutError,
  TutorService,
  type BoardAuthorizer,
  type TutorModel,
} from './tutor-service.js';

const request: TutorRequest = {
  requestId: 'request-1',
  schemaVersion: 1,
  boardId: 'local_board-1',
  mode: 'solve',
  text: '2x + 3 = 11',
  locale: 'zh-CN',
  source: {
    elementIds: ['element-1'],
    selectionBounds: { x: 0, y: 0, width: 100, height: 40 },
    contentHash: 'content-hash',
  },
};

const result: TutorResultV1 = {
  schemaVersion: 1,
  mode: 'solve',
  title: '一元一次方程',
  steps: [
    {
      id: 'step-1',
      title: '移项',
      blocks: [{ type: 'paragraph', text: '先把常数项移到右边。' }],
    },
  ],
  metadata: {
    model: 'gemini-3.6-flash',
    promptVersion: 'v1',
    generatedAt: '2026-09-22T00:00:00.000Z',
  },
};

const boards: BoardAuthorizer = { canAccess: vi.fn().mockResolvedValue(true) };
const actor = { kind: 'anonymous' as const, id: 'anon-1' };

describe('anonymous session', () => {
  it('签发 30 天会话并拒绝篡改或过期 cookie', () => {
    const key = { version: 'v1', secret: 'test-secret-at-least-32-characters' };
    const now = new Date('2026-09-22T00:00:00.000Z');
    const issued = issueAnonymousSession(key, now);

    expect(verifyAnonymousSession(issued.cookieValue, [key], now)).toEqual(issued.session);
    expect(() => verifyAnonymousSession(`${issued.cookieValue}x`, [key], now)).toThrow(ApiFault);
    expect(() =>
      verifyAnonymousSession(issued.cookieValue, [key], new Date('2026-10-23T00:00:00.000Z')),
    ).toThrow(ApiFault);
  });
});

describe('TutorService', () => {
  it('相同 requestId 返回同一结果且不重复调用模型或扣配额', async () => {
    const model: TutorModel = { generate: vi.fn().mockResolvedValue(result) };
    const now = new Date('2026-09-22T00:00:00.000Z');
    const service = new TutorService(
      new MemoryAiStateStore(() => now.getTime()),
      model,
      boards,
      () => now,
    );

    const first = await service.execute(actor, request);
    const second = await service.execute(actor, request);

    expect(second).toEqual(first);
    expect(model.generate).toHaveBeenCalledOnce();
    expect(first.data.quota).toMatchObject({ dailyLimit: 3, remaining: 2 });
  });

  it('执行一次同模型纠错，并拒绝第二次非法输出', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ html: '<script />' })
      .mockResolvedValue(result);
    const service = new TutorService(
      new MemoryAiStateStore(),
      { generate },
      boards,
      () => new Date('2026-09-22T00:00:00.000Z'),
    );

    await expect(service.execute(actor, request)).resolves.toMatchObject({
      data: { result: { schemaVersion: 1 } },
    });
    expect(generate).toHaveBeenNthCalledWith(2, request, expect.stringContaining('Tutor DSL'));
    expect(generate).toHaveBeenNthCalledWith(2, request, expect.stringContaining('schemaVersion'));

    const invalid = new TutorService(
      new MemoryAiStateStore(),
      { generate: vi.fn().mockResolvedValue({ rawHtml: '<b>unsafe</b>' }) },
      boards,
      () => new Date('2026-09-22T00:00:00.000Z'),
    );
    await expect(invalid.execute(actor, request)).rejects.toMatchObject({
      code: 'INVALID_MODEL_OUTPUT',
      retryable: true,
    });
  });

  it('主模型两次内容校验失败后使用下一顺位模型', async () => {
    const primary: TutorModel = {
      generate: vi.fn().mockResolvedValue({ title: '缺少 Tutor DSL 字段' }),
    };
    const backup: TutorModel = { generate: vi.fn().mockResolvedValue(result) };
    const model: TutorModel = {
      generate: vi.fn(),
      fallbackCandidates: () => [primary, backup],
    };
    const service = new TutorService(
      new MemoryAiStateStore(),
      model,
      boards,
      () => new Date('2026-09-22T00:00:00.000Z'),
    );

    await expect(service.execute(actor, request)).resolves.toMatchObject({
      data: { result: { title: '一元一次方程' } },
    });
    expect(primary.generate).toHaveBeenCalledTimes(2);
    expect(backup.generate).toHaveBeenCalledOnce();
  });

  it('修复 part-map takeaway 被模型放到图块外层的已知结构漂移', async () => {
    const model = {
      generate: vi.fn().mockResolvedValue({
        ...result,
        $schema: 'https://example.invalid/tutor.schema.json',
        hintLevel: 1,
        title: '香水瓶拆解',
        steps: [
          {
            id: 'step-1',
            title: '看清结构',
            blocks: [
              { type: 'paragraph', text: '先从外到内观察。' },
              {
                type: 'diagram',
                diagram: {
                  type: 'part-map',
                  layout: 'exploded',
                  subject: { label: '香水瓶', motif: 'device', color: 'amber' },
                  parts: [
                    { id: 'cap', label: '瓶盖', detail: '保护喷头', role: 'shell', color: 'blue' },
                    { id: 'body', label: '瓶身', detail: '容纳香水', role: 'core', color: 'amber' },
                  ],
                },
                takeaway: '每个部件各司其职。',
              },
            ],
          },
        ],
      }),
    };
    const service = new TutorService(
      new MemoryAiStateStore(),
      model,
      boards,
      () => new Date('2026-09-22T00:00:00.000Z'),
    );

    const response = await service.execute(actor, request);

    const diagramBlock = response.data.result.steps[0]?.blocks[1];
    expect(diagramBlock).toMatchObject({
      type: 'diagram',
      diagram: { type: 'part-map', takeaway: '每个部件各司其职。' },
    });
    expect(response.data.result).not.toHaveProperty('$schema');
    expect(response.data.result).not.toHaveProperty('hintLevel');
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it('将直接放进 blocks 的已知图解对象包进 diagram block', async () => {
    const model = {
      generate: vi.fn().mockResolvedValue({
        ...result,
        steps: [
          {
            id: 'step-1',
            title: '按顺序观察',
            blocks: [
              {
                type: 'flow',
                direction: 'LR',
                nodes: [
                  { id: 'a', label: '起点', shape: 'rounded', color: 'green' },
                  { id: 'b', label: '终点', shape: 'rounded', color: 'blue' },
                ],
                edges: [{ id: 'e1', from: 'a', to: 'b', style: 'solid' }],
              },
              { type: 'paragraph', text: '沿箭头前进。' },
            ],
          },
        ],
      }),
    };
    const service = new TutorService(
      new MemoryAiStateStore(),
      model,
      boards,
      () => new Date('2026-09-22T00:00:00.000Z'),
    );

    const response = await service.execute(actor, request);

    expect(response.data.result.steps[0]?.blocks[0]).toMatchObject({
      type: 'diagram',
      diagram: { type: 'flow', direction: 'LR' },
    });
  });

  it('执行五分钟间隔与上海自然日三次配额', async () => {
    const state = new MemoryAiStateStore();
    const model: TutorModel = { generate: vi.fn().mockResolvedValue(result) };
    let now = new Date('2026-09-22T00:00:00.000Z');
    const service = new TutorService(state, model, boards, () => now);

    await service.execute(actor, request);
    await expect(
      service.execute(actor, { ...request, requestId: 'request-2' }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    now = new Date(now.getTime() + 5 * 60 * 1_000);
    await service.execute(actor, { ...request, requestId: 'request-2' });
    now = new Date(now.getTime() + 5 * 60 * 1_000);
    await service.execute(actor, { ...request, requestId: 'request-3' });
    now = new Date(now.getTime() + 5 * 60 * 1_000);
    await expect(
      service.execute(actor, { ...request, requestId: 'request-4' }),
    ).rejects.toMatchObject({ code: 'DAILY_QUOTA_EXHAUSTED' });
  });

  it('模型超时不扣配额，输入失败和游客越权不会调用模型', async () => {
    const state = new MemoryAiStateStore();
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new ProviderTimeoutError())
      .mockResolvedValue(result);
    const service = new TutorService(
      state,
      { generate },
      boards,
      () => new Date('2026-09-22T00:00:00.000Z'),
    );

    await expect(service.execute(actor, request)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    await expect(service.execute(actor, request)).resolves.toMatchObject({
      data: { quota: { remaining: 2 } },
    });
    await expect(service.execute(actor, {})).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      service.execute(actor, { ...request, requestId: 'other', boardId: 'cloud-board' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('在 Asia/Shanghai 自然日零点重置日配额', async () => {
    const model: TutorModel = { generate: vi.fn().mockResolvedValue(result) };
    let now = new Date('2026-09-22T15:40:00.000Z');
    const service = new TutorService(new MemoryAiStateStore(), model, boards, () => now);
    for (let index = 1; index <= 3; index += 1) {
      await service.execute(actor, { ...request, requestId: `day-one-${index}` });
      now = new Date(now.getTime() + 5 * 60 * 1_000);
    }
    await expect(
      service.execute(actor, { ...request, requestId: 'day-one-4' }),
    ).rejects.toMatchObject({ code: 'DAILY_QUOTA_EXHAUSTED' });

    now = new Date('2026-09-22T16:00:00.000Z');
    await expect(
      service.execute(actor, { ...request, requestId: 'day-two-1' }),
    ).resolves.toMatchObject({ data: { quota: { remaining: 2 } } });
  });
});
