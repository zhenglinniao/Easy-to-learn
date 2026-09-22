import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('App', () => {
  it('展示官网价值主张与两条主要入口', async () => {
    render(<App />);

    expect(await screen.findByRole('link', { name: 'Easy to learn 首页' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /思考不必离开/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '游客直接使用' })).toHaveAttribute('href', '/canvas');
    expect(screen.getByRole('link', { name: '登录并云端保存' })).toBeInTheDocument();
  });

  it('保存并即时应用主题偏好', async () => {
    localStorage.clear();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: '切换到深色主题' }));

    expect(localStorage.getItem('easy-to-learn-theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: '切换到浅色主题' })).toBeInTheDocument();
  });
});
