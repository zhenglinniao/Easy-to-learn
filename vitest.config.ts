import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // Worker threads retain per-file isolation and browser-compatible globals,
    // while avoiding the process startup overhead of Vitest's default forks.
    pool: 'threads',
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
    },
  },
});
