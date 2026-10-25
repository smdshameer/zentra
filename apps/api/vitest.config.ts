import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    fileParallelism: false,
    setupFiles: ['./test/setup.ts'],
    alias: {
      '@zentra/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@zentra/validation': path.resolve(__dirname, '../../packages/validation/src/index.ts'),
    },
  },
});
