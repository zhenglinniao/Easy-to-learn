import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('App', () => {
  it('展示项目名称和当前工程节点', () => {
    render(<App />);

    expect(screen.getByRole('link', { name: 'Easy to learn 首页' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '让学习过程，留在思考发生的地方。' }),
    ).toBeInTheDocument();
    expect(screen.getByText('质量门禁已启用')).toBeInTheDocument();
  });
});
