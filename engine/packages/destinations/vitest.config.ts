import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { env: { DATABASE_URL: 'postgresql://localhost:5432/test' } },
});
