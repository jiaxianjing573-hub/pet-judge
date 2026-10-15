import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = 'http://localhost:3212';
const proxyPaths = ['/api', '/douyin', '/resolve', '/download', '/app-config', '/ocr'];

export default defineConfig({
  root: 'app',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: Object.fromEntries(proxyPaths.map(p => [p, { target: backend, changeOrigin: true }]))
  }
});
