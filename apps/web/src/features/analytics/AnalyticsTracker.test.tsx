import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalyticsTracker } from './AnalyticsTracker';

beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: null });
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: false });
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

  it('尊重 Global Privacy Control 并在服务失败后停止本会话重试', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);
    const first = render(
      <MemoryRouter initialEntries={['/first']}>
        <AnalyticsTracker />
      </MemoryRouter>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(sessionStorage.getItem('easy-to-learn-analytics-unavailable')).toBe('1'),
    );
    first.unmount();

    render(
      <MemoryRouter initialEntries={['/second']}>
        <AnalyticsTracker />
      </MemoryRouter>,
    );
    expect(fetchMock).toHaveBeenCalledOnce();

    Object.defineProperty(navigator, 'globalPrivacyControl', {
      configurable: true,
      value: true,
    });
    sessionStorage.clear();
    render(
      <MemoryRouter initialEntries={['/third']}>
        <AnalyticsTracker />
      </MemoryRouter>,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
