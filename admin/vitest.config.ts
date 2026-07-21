import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Mirrors app/vitest.config.ts: the same `@/* -> ./src/*` alias the tsconfig declares, and
// the node environment (components are asserted through react-dom/server markup rather than
// a DOM, which is how the app package already tests its surfaces).
export default defineConfig({
  // tsconfig says jsx:"preserve" (Next compiles it), so vitest needs to be told how to
  // transform JSX itself. 'automatic' means no React import is required in test files.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
