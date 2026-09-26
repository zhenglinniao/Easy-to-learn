import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatMetricValue } from './metric-format';
import { ProductMetrics } from './ProductMetrics';

afterEach(() => vi.unstubAllGlobals());

describe('ProductMetrics', () => {
  it('展示服务端返回的真实聚合指标', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            totalVisits: 1280,
            visitors30d: 430,
            registeredUsers: 86,
            generatedAt: '2026-09-26T00:00:00.000Z',
          },
        }),
      }),
    );

    render(<ProductMetrics />);

    expect(await screen.findByText('1,280')).toBeInTheDocument();
    expect(screen.getByText('430')).toBeInTheDocument();
    expect(screen.getByText('86')).toBeInTheDocument();
    expect(screen.queryByText('云端画板')).not.toBeInTheDocument();
  });

  it('接口不可用时明确显示未连接而不是伪造零值', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<ProductMetrics />);

    await waitFor(() => expect(screen.getAllByText('暂未连接')).toHaveLength(3));
  });

  it('大数使用中文紧凑格式', () => {
    expect(formatMetricValue(12_300)).toBe('1.2万');
  });
});
