import { convertToExcalidrawElements, FONT_FAMILY } from '@excalidraw/excalidraw';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@excalidraw/excalidraw', () => ({
  FONT_FAMILY: { Excalifont: 5, Nunito: 6 },
  convertToExcalidrawElements: (elements: Array<Record<string, unknown>>) =>
    elements.map((element) => ({
      width: String(element.text ?? '').length * 10,
      height: 24,
      lineHeight: 1.25,
      version: 1,
      ...element,
    })),
  newElementWith: (element: Record<string, unknown>, updates: Record<string, unknown>) => ({
    ...element,
    ...updates,
    version: Number(element.version ?? 1) + 1,
  }),
}));

import { HANDWRITING_FONT_FAMILY, migrateElementsToHandwriting } from './handwriting';

describe('migrateElementsToHandwriting', () => {
  it('将历史普通字体文字迁移为手绘字体并保留元素 ID', () => {
    const [text] = convertToExcalidrawElements(
      [
        {
          id: 'legacy-text',
          type: 'text',
          x: 120,
          y: 80,
          text: '旧画板文字 ABC',
          fontFamily: FONT_FAMILY.Nunito,
        },
      ],
      { regenerateIds: false },
    );
    expect(text).toBeDefined();

    const result = migrateElementsToHandwriting([text!]);

    expect(result.changed).toBe(true);
    expect(result.elements[0]).toMatchObject({
      id: 'legacy-text',
      type: 'text',
      fontFamily: HANDWRITING_FONT_FAMILY,
      text: '旧画板文字 ABC',
      x: 120,
      y: 80,
    });
  });

  it('已是手绘字体时不产生无意义的元素版本变化', () => {
    const [text] = convertToExcalidrawElements(
      [
        {
          type: 'text',
          x: 0,
          y: 0,
          text: '手绘文字',
          fontFamily: HANDWRITING_FONT_FAMILY,
        },
      ],
      { regenerateIds: false },
    );
    expect(text).toBeDefined();

    const result = migrateElementsToHandwriting([text!]);

    expect(result.changed).toBe(false);
    expect(result.elements[0]).toBe(text);
  });
});
