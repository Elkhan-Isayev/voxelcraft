import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  // three.js alone is ~600 kB unminified; one bundle is fine for a local game.
  build: { chunkSizeWarningLimit: 900 },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
