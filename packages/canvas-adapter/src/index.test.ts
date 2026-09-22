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
}));

import {
  clientPointToScene,
  extractTutorText,
  getTutorSelection,
  hasVisualTutorInput,
  scenePointToClient,
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
});
