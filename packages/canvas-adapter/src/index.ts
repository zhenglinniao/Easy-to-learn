import {
  exportToBlob,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from '@excalidraw/excalidraw';
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
} from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';

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
