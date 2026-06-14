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
    // Los tests de integración comparten una única base de datos local.
    // Ejecutar los archivos en serie evita interferencias entre suites
    // (seeds/cleanups concurrentes) que producen fallos no deterministas.
    fileParallelism: false,
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
