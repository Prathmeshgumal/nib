import { defineConfig } from 'vite';
import path from 'node:path';

// The client has no test runner of its own; this is vite's config plus the
// jsdom environment, so imports resolve exactly as they do in the app.
export default defineConfig({
  // The same aliases the app builds with, or the tests prove nothing about
  // what ships.
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@codemirror/language-data': path.resolve(
        import.meta.dirname,
        'src/lib/milkdown/stubs/languageData.js',
      ),
      katex: path.resolve(import.meta.dirname, 'src/lib/milkdown/stubs/katex.js'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.js'],
    setupFiles: ['./src/test/setup.js'],
  },
});
