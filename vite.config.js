import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true
      },
      '/events': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0
      },
      '/health': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true
      }
    }
  },
  preview: {
    host: true,
    port: 4173
  },
  build: {
    target: 'es2018',
    assetsInlineLimit: 100000000
  }
});
