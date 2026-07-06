import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Mirror the tsconfig `@/* -> ./src/*` path alias so unit tests can import
// modules the same way app code does. Without this, importing a module that
// uses `@/lib/...` fails to resolve under vitest.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
});
