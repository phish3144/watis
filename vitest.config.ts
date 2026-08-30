import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@platform': resolve(__dirname, 'src/platform'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts'],
    reporters: 'default',
  },
})
