import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'web',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // 开发时把接口转发到 npm run dev:server 启动的后端
    proxy: { '/api': 'http://localhost:8080' },
  },
});
