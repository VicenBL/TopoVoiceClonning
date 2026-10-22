import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'node20',
    outDir: 'dist-electron',
    emptyOutDir: false,
    lib: {
      entry: 'electron/preload.ts',
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    rolldownOptions: {
      external: ['electron'],
    },
  },
});
