import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AuthProvider } from '../features/auth';
import LegalPage from './LegalPage';

const renderPage = (kind: 'privacy' | 'terms') =>
  render(
    <AuthProvider client={null}>
      <MemoryRouter>
        <LegalPage kind={kind} />
      </MemoryRouter>
    </AuthProvider>,
  );

describe('LegalPage', () => {
  it('公开关键数据保留期限与用户选择', () => {
    renderPage('privacy');
    expect(screen.getByRole('heading', { name: '我们怎样处理你的学习数据' })).toBeInTheDocument();
    expect(screen.getByText(/账户删除有 7 天冷静期/)).toBeInTheDocument();
    expect(screen.getByText(/AI 运行元数据保留 90 天/)).toBeInTheDocument();
  });

  it('说明 AI 边界、配额和合理使用要求', () => {
    renderPage('terms');
    expect(
      screen.getByRole('heading', { name: '使用 Easy to learn 前请了解' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/不应作为医疗、法律、财务/)).toBeInTheDocument();
    expect(screen.getByText(/登录用户每天有 10 次有效 AI 请求，无请求间隔限制/)).toBeInTheDocument();
  });
});
