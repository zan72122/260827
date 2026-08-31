import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2020', assetsInlineLimit: 0 },
  server: { host: '0.0.0.0', port: 5173 },
});
