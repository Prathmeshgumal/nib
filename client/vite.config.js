import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // Crepe drags in every CodeMirror grammar and all of KaTeX whether the
      // features are on or not; see the stubs for why.
      '@codemirror/language-data': path.resolve(
        import.meta.dirname,
        './src/lib/milkdown/stubs/languageData.js',
      ),
      // More specific first: a bare `katex` alias would otherwise rewrite
      // this path into stubs/katex.js/dist/katex.min.css.
      'katex/dist/katex.min.css': path.resolve(
        import.meta.dirname,
        './src/lib/milkdown/stubs/katex.css',
      ),
      katex: path.resolve(import.meta.dirname, './src/lib/milkdown/stubs/katex.js'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Bind-mounted source on Linux hosts doesn't always emit inotify events.
    watch: { usePolling: true },
    proxy: {
      '/api': {
        // The port `note --web` listens on.
        target: process.env.VITE_API_PROXY || 'http://127.0.0.1:4321',
        changeOrigin: true,
      },
    },
  },
});
