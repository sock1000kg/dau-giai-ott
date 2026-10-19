import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/local-demo-schedule.test.ts', 'tests/e2e/local-demo.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 60_000,
  },
});
