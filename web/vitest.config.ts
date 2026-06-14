import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', '.next', 'tests/e2e', 'tests/integration'],
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@shared': path.resolve(__dirname, '../shared'),
      // INFRA-03 (spec 0023): `server-only` es un guard de build de Next no resolvable en vitest.
      'server-only': path.resolve(__dirname, 'tests/server-only-stub.ts'),
    },
  },
});
