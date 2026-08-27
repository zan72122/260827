import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2018', chunkSizeWarningLimit: 1200 },
});
