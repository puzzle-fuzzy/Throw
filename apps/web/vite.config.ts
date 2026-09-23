/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 开发期：/rooms、/relay、/health、/ws 反代到本地 apps/api（默认 3000 端口，
// 可用环境变量 API_TARGET 覆盖），前端全用同源相对路径，生产由反代同域转发。
const apiTarget = process.env.API_TARGET ?? 'http://127.0.0.1:3000';
const wsTarget = apiTarget.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/rooms': apiTarget,
      '/relay': apiTarget,
      '/health': apiTarget,
      '/ws': { target: wsTarget, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
