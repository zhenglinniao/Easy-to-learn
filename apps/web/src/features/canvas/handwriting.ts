import { convertToExcalidrawElements, FONT_FAMILY, newElementWith } from '@excalidraw/excalidraw';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform';
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from '@excalidraw/excalidraw/element/types';

export const HANDWRITING_FONT_FAMILY = FONT_FAMILY.Excalifont;

export interface HandwritingMigration {
  changed: boolean;
  elements: readonly ExcalidrawElement[];
}

const convertTextElement = (element: ExcalidrawTextElement): ExcalidrawTextElement => {
  // 让 Excalidraw 使用目标字体重新测量文本，避免只换字形后选框尺寸仍沿用旧字体。
  const skeleton: Record<string, unknown> = {
    ...element,
    fontFamily: HANDWRITING_FONT_FAMILY,
  };
  delete skeleton.width;
  delete skeleton.height;
  delete skeleton.lineHeight;
  const [converted] = convertToExcalidrawElements(
    [skeleton as unknown as ExcalidrawElementSkeleton],
    { regenerateIds: false },
  );

  if (!converted || converted.type !== 'text') {
    return newElementWith(element, { fontFamily: HANDWRITING_FONT_FAMILY }, true);
  }

  const isBoundText = element.containerId !== null;
  return newElementWith(
    converted,
    {
      // 绑定在图形内的文字以原中心点为基准，字体变化后不会明显偏离容器。
      x: isBoundText ? element.x + (element.width - converted.width) / 2 : element.x,
      y: isBoundText ? element.y + (element.height - converted.height) / 2 : element.y,
    },
    true,
  );
};

/**
 * 将历史画板文字统一迁移为手绘字体。非文字元素保持原对象引用，避免无关版本变化。
 */
export const migrateElementsToHandwriting = (
  elements: readonly ExcalidrawElement[],
): HandwritingMigration => {
  let changed = false;
  const migrated = elements.map((element) => {
    if (element.type !== 'text' || element.fontFamily === HANDWRITING_FONT_FAMILY) {
      return element;
    }
    changed = true;
    return convertTextElement(element);
  });

  return { changed, elements: changed ? migrated : elements };
};
