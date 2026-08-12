import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The UAT harnesses — NOT part of `pnpm test`.
 *
 * These make real Bedrock calls and write real rows to whatever DATABASE_URL points at, so
 * they live behind their own config and their own include pattern. The default config's
 * `src/**` never reaches them, which is the point: a verification harness that CI can pick
 * up is a verification harness that spends money on every push.
 *
 *   pnpm --filter @sprigly/app uat <file>
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['scripts/**/*.uat.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // One file at a time, in order: these turns are a CONVERSATION and a parallel run would
    // interleave writes to the same month.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
