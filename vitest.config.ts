import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // Worker threads retain per-file isolation and browser-compatible globals,
    // while avoiding the process startup overhead of Vitest's default forks.
    pool: 'threads',
    // Coverage instrumentation and React user-event can legitimately exceed
    // Vitest's 5 s default on loaded developer/CI machines. Aborting mid-input
    // leaves queued keyboard events that can contaminate the following test.
    testTimeout: 15_000,
    globals: true,
    include: ['apps/**/*.test.{ts,tsx}', 'packages/**/*.test.{ts,tsx}', 'api/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    server: {
      deps: {
        inline: ['@excalidraw/excalidraw', 'open-color'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['apps/**/src/**/*.{ts,tsx}', 'packages/**/src/**/*.{ts,tsx}', 'api/**/*.ts'],
      reportOnFailure: true,
      thresholds: {
        statements: 68,
        branches: 63,
        functions: 69,
        lines: 72,
      },
    },
  },
});
