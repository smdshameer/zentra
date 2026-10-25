import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@zentra/config': path.resolve(__dirname, '../../packages/config/src/index.ts'),
      '@zentra/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@zentra/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@zentra/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
      '@zentra/validation': path.resolve(__dirname, '../../packages/validation/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
