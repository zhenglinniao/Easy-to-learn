import type { PersistedTutorBoardV2 } from '@easy-to-learn/domain';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TutorBoard } from './TutorBoard';
import { TutorBlocks } from './TutorBlocks';

const board: PersistedTutorBoardV2 = {
  id: 'tutor-1',
  title: '一次方程',
  stepIndex: 0,
  sceneAnchor: { sceneX: 40, sceneY: 60 },
  anchorMode: 'follow-source',
  source: {
    elementIds: ['e1'],
    bounds: { x: 0, y: 0, width: 100, height: 30 },
    contentHash: 'hash',
    status: 'active',
  },
  result: {
    schemaVersion: 1,
    mode: 'solve',
    title: '一次方程',
    steps: [
      {
        id: 's1',
        title: '移项',
        blocks: [
          { type: 'paragraph', text: '把常数移到右边。' },
          { type: 'math', latex: '2x=8', display: true },
        ],
      },
      {
        id: 's2',
        title: '求解',
        blocks: [{ type: 'callout', tone: 'success', text: '两边同时除以 2。' }],
      },
    ],
    metadata: { model: 'test', promptVersion: 'v1', generatedAt: '2026-09-22T00:00:00.000Z' },
  },
  createdAt: '2026-09-22T00:00:00.000Z',
  updatedAt: '2026-09-22T00:00:00.000Z',
};

describe('TutorBoard', () => {
  it('切换步骤、请求解释并关闭', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClose = vi.fn();
    const onExplainStep = vi.fn();
    render(
      <TutorBoard
        board={board}
        onChange={onChange}
        onClose={onClose}
        onExplainStep={onExplainStep}
      />,
    );
    expect(screen.getByText('把常数移到右边。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ stepIndex: 1 }));
    await user.click(screen.getByRole('button', { name: '解释这一步' }));
    expect(onExplainStep).toHaveBeenCalledWith('tutor-1', 's1');
    await user.click(screen.getByRole('button', { name: '关闭辅导板' }));
    expect(onClose).toHaveBeenCalledWith('tutor-1');
  });

  it('拖动时捕获指针并在结束时提交新位置', () => {
    const onChange = vi.fn();
    render(<TutorBoard board={board} onChange={onChange} onClose={vi.fn()} />);
    const handle = screen.getByText('一次方程', { selector: 'h2' }).closest('header');
    if (!handle) throw new Error('未找到拖动柄');
    handle.setPointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 130, clientY: 125 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 130, clientY: 125 });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sceneAnchor: { sceneX: 70, sceneY: 85 } }),
    );
  });

  it('把模型内容当作数据渲染，不执行 HTML 或可信链接', () => {
    const unsafe = {
      ...board,
      result: {
        ...board.result,
        steps: [
          {
            id: 'safe',
            title: '安全内容',
            blocks: [
              { type: 'paragraph' as const, text: '<img src=x onerror=alert(1)>' },
              { type: 'math' as const, latex: '\\href{javascript:alert(1)}{点击}', display: false },
            ],
          },
        ],
      },
    };
    const { container } = render(
      <TutorBoard board={unsafe} onChange={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('提交正向反馈或带分类的负向反馈', async () => {
    const user = userEvent.setup();
    const onFeedback = vi.fn();
    const { rerender } = render(
      <TutorBoard board={board} onChange={vi.fn()} onClose={vi.fn()} onFeedback={onFeedback} />,
    );

    await user.click(screen.getByRole('button', { name: '有帮助' }));
    expect(onFeedback).toHaveBeenCalledWith(1);
    await user.click(screen.getByRole('button', { name: '有问题' }));
    await user.click(screen.getByRole('button', { name: '答案错误' }));
    expect(onFeedback).toHaveBeenCalledWith(-1, 'incorrect_answer');

    rerender(
      <TutorBoard
        board={board}
        onChange={vi.fn()}
        onClose={vi.fn()}
        feedbackState="sent"
        onFeedback={onFeedback}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('已收到反馈，谢谢你。');
  });

  it('展示模型识别出的内容类型与学习目标', () => {
    render(
      <TutorBoard
        board={{
          ...board,
          result: {
            ...board.result,
            contentProfile: {
              contentKind: 'produce',
              learningGoal: 'nutrition',
              goalSource: 'inferred',
              confidence: 'high',
            },
            metadata: { ...board.result.metadata, promptVersion: 'v3' },
          },
        }}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('识别为：蔬果 · 营养拆解 · 自动选择')).toBeInTheDocument();
  });

  it('忠实渲染几何标签、角的两条射线、坐标网格和流程边', () => {
    const { container } = render(
      <TutorBlocks
        blocks={[
          {
            type: 'diagram',
            diagram: {
              type: 'geometry',
              viewport: { xMin: -2, xMax: 4, yMin: -2, yMax: 4 },
              primitives: [
                { kind: 'point', id: 'A', at: [0, 0], label: 'A', color: 'blue' },
                {
                  kind: 'angle',
                  vertex: [0, 0],
                  from: [2, 0],
                  to: [0, 2],
                  label: '90°',
                  color: 'amber',
                },
              ],
            },
          },
          {
            type: 'diagram',
            diagram: {
              type: 'coordinate-plane',
              xRange: [-2, 2],
              yRange: [-2, 2],
              showGrid: true,
              showAxes: true,
              points: [],
              segments: [{ from: [-1, -1], to: [1, 1], label: 'y=x', color: 'green' }],
            },
          },
          {
            type: 'diagram',
            diagram: {
              type: 'flow',
              direction: 'LR',
              nodes: [
                { id: 'start', label: '观察', shape: 'rounded', color: 'blue' },
                { id: 'end', label: '结论', shape: 'diamond', color: 'green' },
              ],
              edges: [
                {
                  id: 'edge',
                  from: 'start',
                  to: 'end',
                  label: '因此',
                  style: 'dashed',
                },
              ],
            },
          },
        ]}
      />,
    );
    expect(screen.getByText('90°')).toBeInTheDocument();
    expect(screen.getByText('y=x')).toBeInTheDocument();
    expect(screen.getByText('因此')).toBeInTheDocument();
    expect(container.querySelectorAll('g[aria-hidden="true"] line').length).toBeGreaterThan(0);
    expect(container.querySelector('path[d*=" L "]')).not.toBeNull();
  });
});
