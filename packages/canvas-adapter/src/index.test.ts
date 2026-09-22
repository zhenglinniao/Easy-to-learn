import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState } from '@excalidraw/excalidraw/types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@excalidraw/excalidraw', () => ({
  exportToBlob: vi.fn(),
  viewportCoordsToSceneCoords: (
    { clientX, clientY }: { clientX: number; clientY: number },
    transform: {
      zoom: { value: number };
      offsetLeft: number;
      offsetTop: number;
      scrollX: number;
      scrollY: number;
    },
  ) => ({
    x: (clientX - transform.offsetLeft) / transform.zoom.value - transform.scrollX,
    y: (clientY - transform.offsetTop) / transform.zoom.value - transform.scrollY,
  }),
  sceneCoordsToViewportCoords: (
    { sceneX, sceneY }: { sceneX: number; sceneY: number },
    transform: {
      zoom: { value: number };
      offsetLeft: number;
      offsetTop: number;
      scrollX: number;
      scrollY: number;
    },
  ) => ({
    x: (sceneX + transform.scrollX) * transform.zoom.value + transform.offsetLeft,
    y: (sceneY + transform.scrollY) * transform.zoom.value + transform.offsetTop,
  }),
  getCommonBounds: (items: Array<{ x: number; y: number; width: number; height: number }>) => [
    Math.min(...items.map(({ x }) => x)),
    Math.min(...items.map(({ y }) => y)),
    Math.max(...items.map(({ x, width }) => x + width)),
    Math.max(...items.map(({ y, height }) => y + height)),
  ],
}));

import {
  clientPointToScene,
  extractTutorText,
  getTutorSelection,
  hasVisualTutorInput,
  prepareTutorSelection,
  scenePointToClient,
  shouldOpenTutorMenu,
} from './index';

const elements = [
  { id: 'question', type: 'text', text: '2x + 3 = 11', isDeleted: false },
  { id: 'shape', type: 'rectangle', isDeleted: false },
  { id: 'ignored', type: 'frame', isDeleted: false },
] as unknown as readonly ExcalidrawElement[];

describe('canvas adapter', () => {
  it('只保留 AI 支持的已选元素，并提取文字', () => {
    const selectedElementIds = {
      question: true,
      shape: true,
      ignored: true,
    } as AppState['selectedElementIds'];

    const selection = getTutorSelection(elements, selectedElementIds);

    expect(selection.map((element) => element.id)).toEqual(['question', 'shape']);
    expect(extractTutorText(selection)).toBe('2x + 3 = 11');
    expect(hasVisualTutorInput(selection)).toBe(true);
  });

  it('scene/client 坐标可以稳定往返', () => {
    const transform = {
      zoom: { value: 2 as AppState['zoom']['value'] },
      offsetLeft: 40,
      offsetTop: 20,
      scrollX: -100,
      scrollY: 50,
    };

    const scene = clientPointToScene({ clientX: 340, clientY: 260 }, transform);
    const client = scenePointToClient({ sceneX: scene.x, sceneY: scene.y }, transform);

    expect(client.x).toBeCloseTo(340);
    expect(client.y).toBeCloseTo(260);
  });

  it('只在鼠标 selection 点击或框选完成后打开 AI 菜单', () => {
    const selection = getTutorSelection(elements, {
      question: true,
    } as AppState['selectedElementIds']);
    const validInteraction = {
      activeToolType: 'selection',
      pointerType: 'mouse',
      dragOccurred: false,
      boxSelectionOccurred: false,
      hitSelection: true,
    };

    expect(shouldOpenTutorMenu(selection, validInteraction)).toBe(true);
    expect(shouldOpenTutorMenu(selection, { ...validInteraction, pointerType: 'touch' })).toBe(
      false,
    );
    expect(shouldOpenTutorMenu(selection, { ...validInteraction, pointerType: 'pen' })).toBe(false);
    expect(
      shouldOpenTutorMenu(selection, { ...validInteraction, activeToolType: 'rectangle' }),
    ).toBe(false);
    expect(shouldOpenTutorMenu(selection, { ...validInteraction, dragOccurred: true })).toBe(false);
    expect(
      shouldOpenTutorMenu(selection, {
        ...validInteraction,
        dragOccurred: true,
        boxSelectionOccurred: true,
        hitSelection: false,
      }),
    ).toBe(true);
  });

  it('不为只有不支持元素的选区打开菜单', () => {
    const unsupported = getTutorSelection(elements, {
      ignored: true,
    } as AppState['selectedElementIds']);

    expect(
      shouldOpenTutorMenu(unsupported, {
        activeToolType: 'selection',
        pointerType: 'mouse',
        dragOccurred: false,
        boxSelectionOccurred: false,
        hitSelection: true,
      }),
    ).toBe(false);
  });

  it('准备文字输入时移动位置不改变内容摘要，但更新选区 bounds', async () => {
    const text = {
      id: 'question',
      type: 'text',
      text: '2x + 3 = 11',
      isDeleted: false,
      x: 10,
      y: 20,
      width: 120,
      height: 40,
    } as unknown as ExcalidrawElement;
    const moved = { ...text, x: 110, y: 220 } as ExcalidrawElement;

    const first = await prepareTutorSelection([text] as never, {});
    const second = await prepareTutorSelection([moved] as never, {});

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.selectionBounds).toEqual({ x: 10, y: 20, width: 120, height: 40 });
    expect(second.selectionBounds).toEqual({ x: 110, y: 220, width: 120, height: 40 });
    expect(first).toMatchObject({ elementIds: ['question'], text: '2x + 3 = 11' });
  });
});
