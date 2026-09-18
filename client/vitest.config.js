import { defineConfig } from 'vite';
import path from 'node:path';

// The client has no test runner of its own; this is vite's config plus the
// jsdom environment, so imports resolve exactly as they do in the app.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: { environment: 'jsdom', include: ['src/**/*.test.js'] },
});
