import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RenderFallbackBoundary } from './RenderFallbackBoundary';

const ThrowingChild = () => {
  throw new Error('chunk unavailable');
};

describe('RenderFallbackBoundary', () => {
  it('只降级失败的子树并报告错误', () => {
    const onError = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <div>
        <span>画板仍可用</span>
        <RenderFallbackBoundary fallback={<span>公式暂以原文显示</span>} onError={onError}>
          <ThrowingChild />
        </RenderFallbackBoundary>
      </div>,
    );

    expect(screen.getByText('画板仍可用')).toBeInTheDocument();
    expect(screen.getByText('公式暂以原文显示')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledOnce();
  });
});
