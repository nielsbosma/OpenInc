import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { setupFiles: ['../../packages/core/test/setup.ts'], testTimeout: 30_000 },
});
