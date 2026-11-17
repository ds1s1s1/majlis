// The Cinema app (React) builds into the renderer as one ES module + one stylesheet that
// app.js mounts into the existing page (so a game or watch session in the page survives).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root,
  base: './',
  plugins: [react(), tailwind()],
  build: {
    outDir: path.join(root, '../src/renderer/media'),
    emptyOutDir: true,
    target: 'chrome130',
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      input: path.join(root, 'src/main.tsx'),
      preserveEntrySignatures: 'exports-only',
      output: { format: 'es', entryFileNames: 'cinema.js', chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: 'cinema[extname]' },
    },
  },
});
