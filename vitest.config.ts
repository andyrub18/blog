import { paraglideVitePlugin } from '@inlang/paraglide-js'
import solidPlugin from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'
import { paraglideOptions } from './src/i18n/paraglide-options'

export default defineConfig({
  plugins: [paraglideVitePlugin(paraglideOptions), solidPlugin({ ssr: false })],
  resolve: {
    // Solid ships separate server/browser builds; tests run against the browser one.
    conditions: ['browser', 'development'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Playwright owns e2e; vitest must not try to run those files.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'src/paraglide/**'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/lib/**', 'src/i18n/**', 'src/components/**'],
      exclude: ['src/paraglide/**', '**/*.test.*'],
    },
  },
})
