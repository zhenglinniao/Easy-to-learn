import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useOnlineStatus } from './useOnlineStatus';

const originalOnlineDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine');

const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
};

afterEach(() => {
  if (originalOnlineDescriptor)
    Object.defineProperty(navigator, 'onLine', originalOnlineDescriptor);
});

describe('useOnlineStatus', () => {
  it('reacts to browser online and offline transitions', () => {
    setOnline(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });
});
