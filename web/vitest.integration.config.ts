import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['node_modules'],
    setupFiles: ['./tests/integration.setup.ts'],
    env: {
      TEST_DB: 'true',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
});
