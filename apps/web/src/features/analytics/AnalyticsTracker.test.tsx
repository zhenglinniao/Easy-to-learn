import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalyticsTracker } from './AnalyticsTracker';

beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('AnalyticsTracker', () => {
  it('按站内路由发送不包含页面内容的访问事件', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/canvas']}>
        <AnalyticsTracker />
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith('/api/analytics/visit', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
    });
  });

  it('尊重浏览器 Do Not Track 设置', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '1' });

    render(
      <MemoryRouter>
        <AnalyticsTracker />
      </MemoryRouter>,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
