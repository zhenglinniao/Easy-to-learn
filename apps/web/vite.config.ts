import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Web package runs with apps/web as Vite root; public VITE_* values live in the
  // repository-level .env files shared with Vercel and the server functions.
  envDir: '../..',
  plugins: [react()],
  build: {
    // 在 Sentry 私有上传流程完成前禁止生成生产 source map，避免部署时公开源码映射。
    sourcemap: false,
  },
});
