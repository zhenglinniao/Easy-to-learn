import { describe, expect, it } from 'vitest';

import { illustrationStatusLabel, updateMatchingIllustrationStatus } from './illustrationProgress';

describe('illustration progress', () => {
  it('updates only the completion notice belonging to the same concurrent request', () => {
    const current = { requestId: 'request-b', action: 'solve' };
    expect(updateMatchingIllustrationStatus(current, 'request-a', 'failed')).toBe(current);
    expect(updateMatchingIllustrationStatus(current, 'request-b', 'generated')).toEqual({
      ...current,
      illustrationStatus: 'generated',
    });
  });

  it('explains failure and cancellation without implying that text output was lost', () => {
    expect(illustrationStatusLabel('failed')).toContain('文字与矢量图解已保留');
    expect(illustrationStatusLabel('cancelled')).toContain('文字与矢量图解已保留');
  });
});
