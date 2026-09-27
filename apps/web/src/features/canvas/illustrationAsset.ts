import type { IllustrationResponse } from '@easy-to-learn/domain';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

import { isSafeAssetUrl } from '../ai-tutor/assetUrl';

export type GeneratedIllustrationAsset = Extract<
  IllustrationResponse['data'],
  { status: 'generated' }
>['asset'];

const MAX_ILLUSTRATION_BYTES = 10 * 1024 * 1024;

export const blobToDataUrl = (blob: Blob, signal?: AbortSignal): Promise<string> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => reader.abort();
    reader.onload = () => {
      cleanup();
      resolve(String(reader.result));
    };
    reader.onerror = () => {
      cleanup();
      reject(reader.error);
    };
    reader.onabort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    reader.readAsDataURL(blob);
  });

export const addStepIllustrationFile = async (
  api: Pick<ExcalidrawImperativeAPI, 'addFiles'>,
  asset: GeneratedIllustrationAsset,
  signal?: AbortSignal,
  fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
): Promise<void> => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!isSafeAssetUrl(asset.downloadUrl)) {
    throw new Error('生成插画下载地址不安全，文字与矢量图解已保留。');
  }
  const response = await fetcher(asset.downloadUrl, signal ? { signal } : undefined);
  if (!response.ok) throw new Error('生成插画暂时无法下载，文字与矢量图解已保留。');

  const declaredLength = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ILLUSTRATION_BYTES) {
    throw new Error('生成插画文件校验失败，文字与矢量图解已保留。');
  }

  const blob = await response.blob();
  if (
    blob.type !== asset.mimeType ||
    blob.size === 0 ||
    blob.size > MAX_ILLUSTRATION_BYTES ||
    blob.size !== asset.byteSize
  ) {
    throw new Error('生成插画文件校验失败，文字与矢量图解已保留。');
  }
  const dataURL = await blobToDataUrl(blob, signal);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  api.addFiles([
    {
      id: asset.fileId,
      dataURL,
      mimeType: asset.mimeType,
      created: Date.now(),
      lastRetrieved: Date.now(),
    },
  ] as never);
};
