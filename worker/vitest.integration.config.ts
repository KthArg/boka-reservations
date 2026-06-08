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
    // Los tests de integración comparten una única base de datos local. Correr
    // los archivos en serie evita que el sendNotifications de una suite consuma
    // notificaciones pendientes sembradas por otra (fallos no deterministas).
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
});
