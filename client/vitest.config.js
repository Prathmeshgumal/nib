import { defineConfig } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';

// The client has no test runner of its own; this is vite's config plus the
// jsdom environment, so imports resolve exactly as they do in the app.
export default defineConfig({
  // Components are tested now, not just plain modules, so JSX has to compile.
  plugins: [react()],
  // The same aliases the app builds with, or the tests prove nothing about
  // what ships.
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@codemirror/language-data': path.resolve(
        import.meta.dirname,
        'src/lib/milkdown/stubs/languageData.js',
      ),
      // More specific first: a bare `katex` alias would otherwise rewrite
      // this path into stubs/katex.js/dist/katex.min.css.
      'katex/dist/katex.min.css': path.resolve(
        import.meta.dirname,
        'src/lib/milkdown/stubs/katex.css',
      ),
      katex: path.resolve(import.meta.dirname, 'src/lib/milkdown/stubs/katex.js'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.js', 'src/**/*.test.jsx'],
    setupFiles: ['./src/test/setup.js'],
  },
});
