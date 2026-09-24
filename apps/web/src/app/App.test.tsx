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
    expect(screen.getByRole('img', { name: '吉祥物小易，正在指向解题步骤' })).toBeInTheDocument();
    expect(screen.getByText('小易正在陪你拆解')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '从一道题，到真正想明白。' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '粘贴题图，先要一条提示。' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '把图画出来，让推理贴着图走。' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '今天没做完，明天从原处继续。' }),
    ).toBeInTheDocument();
    expect(screen.getByText('KID · zhenglinniao')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/zhenglinniao',
    );
    expect(screen.getByRole('link', { name: /个人博客/ })).toHaveAttribute(
      'href',
      'https://web.zlnblog.asia/',
    );
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
