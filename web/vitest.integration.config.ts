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
    },
  },
});
