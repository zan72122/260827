import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // Three's core is the one big eager chunk; the example loaders travel
        // with whatever lazily imports them.
        manualChunks: (id: string) =>
          id.includes('node_modules/three') && !id.includes('examples/jsm') ? 'three' : undefined,
      },
    },
  },
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
});
