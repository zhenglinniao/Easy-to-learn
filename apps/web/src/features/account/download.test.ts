import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadJson } from './download';

const createObjectURL = vi.fn(() => 'blob:download');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('downloadJson', () => {
  it('keeps the Blob URL alive until the browser has consumed the click', () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    downloadJson('board.json', { title: '画板' });

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(document.body.querySelector('a')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });

  it('fails explicitly when the supplied value cannot produce JSON', () => {
    expect(() => downloadJson('empty.json', undefined)).toThrow('没有可导出的 JSON 数据');
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
