import {
  exportToBlob,
  getCommonBounds,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from '@excalidraw/excalidraw';
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
} from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import { MAX_INLINE_IMAGE_BYTES } from '@easy-to-learn/domain';

export const CANVAS_ADAPTER_VERSION = 1 as const;

const TUTOR_VISUAL_TYPES = new Set<ExcalidrawElement['type']>([
  'freedraw',
  'line',
  'arrow',
  'rectangle',
  'ellipse',
  'diamond',
  'image',
]);

export type ViewportTransform = Pick<
  AppState,
  'zoom' | 'offsetLeft' | 'offsetTop' | 'scrollX' | 'scrollY'
>;

export interface ClientPoint {
  clientX: number;
  clientY: number;
}

export interface ScenePoint {
  sceneX: number;
  sceneY: number;
}

export interface TutorMenuInteraction {
  activeToolType: string;
  pointerType: string;
  dragOccurred: boolean;
  boxSelectionOccurred: boolean;
  hitSelection: boolean;
}

export interface PreparedTutorSelection {
  elementIds: string[];
  text?: string;
  image?: {
    mimeType: 'image/png';
    blob: Blob;
    base64?: string;
  };
  selectionBounds: { x: number; y: number; width: number; height: number };
  contentHash: string;
}

export const isTutorInputElement = (
  element: ExcalidrawElement,
): element is NonDeletedExcalidrawElement =>
  !element.isDeleted && (element.type === 'text' || TUTOR_VISUAL_TYPES.has(element.type));

export const getTutorSelection = (
  elements: readonly ExcalidrawElement[],
  selectedElementIds: AppState['selectedElementIds'],
): readonly NonDeletedExcalidrawElement[] =>
  elements.filter(
    (element): element is NonDeletedExcalidrawElement =>
      Boolean(selectedElementIds[element.id]) && isTutorInputElement(element),
  );

export const extractTutorText = (elements: readonly ExcalidrawElement[]): string =>
  elements
    .filter(
      (element): element is ExcalidrawTextElement => !element.isDeleted && element.type === 'text',
    )
    .map((element) => element.text.trim())
    .filter(Boolean)
    .join('\n');

export const hasVisualTutorInput = (elements: readonly ExcalidrawElement[]): boolean =>
  elements.some((element) => !element.isDeleted && TUTOR_VISUAL_TYPES.has(element.type));

export const shouldOpenTutorMenu = (
  elements: readonly NonDeletedExcalidrawElement[],
  interaction: TutorMenuInteraction,
): boolean => {
  if (
    interaction.activeToolType !== 'selection' ||
    interaction.pointerType !== 'mouse' ||
    (interaction.dragOccurred && !interaction.boxSelectionOccurred) ||
    (!interaction.boxSelectionOccurred && !interaction.hitSelection)
  ) {
    return false;
  }
  return extractTutorText(elements).length > 0 || hasVisualTutorInput(elements);
};

export const clientPointToScene = (
  point: ClientPoint,
  transform: ViewportTransform,
): { x: number; y: number } => viewportCoordsToSceneCoords(point, transform);

export const scenePointToClient = (
  point: ScenePoint,
  transform: ViewportTransform,
): { x: number; y: number } => sceneCoordsToViewportCoords(point, transform);

export const exportTutorSelectionToPng = async (
  elements: readonly NonDeletedExcalidrawElement[],
  files: BinaryFiles,
): Promise<Blob> => {
  if (elements.length === 0) {
    throw new Error('无法导出空选区');
  }

  return exportToBlob({
    elements,
    files,
    mimeType: 'image/png',
    exportPadding: 20,
    appState: {
      exportBackground: true,
      exportWithDarkMode: false,
      viewBackgroundColor: '#ffffff',
      selectedElementIds: {},
      editingElement: null,
    },
  });
};

const POSITION_ONLY_KEYS = new Set([
  'x',
  'y',
  'updated',
  'version',
  'versionNonce',
  'seed',
  'index',
]);

const normalizeForContentHash = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeForContentHash);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !POSITION_ONLY_KEYS.has(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalizeForContentHash(child)]),
    );
  }
  return value;
};

const digestSelection = async (
  elements: readonly NonDeletedExcalidrawElement[],
): Promise<string> => {
  const normalized = [...elements]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(normalizeForContentHash);
  const bytes = new TextEncoder().encode(JSON.stringify(normalized));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

export const prepareTutorSelection = async (
  elements: readonly NonDeletedExcalidrawElement[],
  files: BinaryFiles,
): Promise<PreparedTutorSelection> => {
  if (elements.length === 0) throw new Error('无法准备空选区');
  const text = extractTutorText(elements);
  const [x1, y1, x2, y2] = getCommonBounds(elements);
  const visual = hasVisualTutorInput(elements)
    ? await exportTutorSelectionToPng(elements, files)
    : undefined;
  return {
    elementIds: elements.map(({ id }) => id),
    ...(text ? { text } : {}),
    ...(visual
      ? {
          image: {
            mimeType: 'image/png' as const,
            blob: visual,
            ...(visual.size <= MAX_INLINE_IMAGE_BYTES
              ? { base64: await blobToBase64(visual) }
              : {}),
          },
        }
      : {}),
    selectionBounds: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
    contentHash: await digestSelection(elements),
  };
};
