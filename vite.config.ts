import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: { target: 'es2020', sourcemap: true },
  server: { host: '0.0.0.0', port: 5173 },
})
