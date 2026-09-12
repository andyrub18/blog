import { paraglideVitePlugin } from '@inlang/paraglide-js'
import solidPlugin from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'
import { paraglideOptions } from './src/i18n/paraglide-options.ts'

const plugins = [paraglideVitePlugin(paraglideOptions), solidPlugin({ ssr: false })]

export default defineConfig({
  plugins,
  resolve: {
    // Solid ships separate server/browser builds; tests run against the browser one.
    conditions: ['browser', 'development'],
  },
  test: {
    projects: [
      {
        // Projects do not inherit the root config unless asked; without this
        // the unit project loses `resolve.conditions` and Solid resolves its
        // SERVER build, so every component render fails with "Client-only API
        // called on the server side".
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          exclude: [
            'src/**/*.db.test.ts',
            'e2e/**',
            'node_modules/**',
            'src/paraglide/**',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'db',
          // Node, not jsdom: these talk to a real Postgres in Docker.
          environment: 'node',
          globals: true,
          include: ['src/**/*.db.test.ts'],
          // Pulling the image and starting the container costs more than a
          // jsdom test ever will.
          testTimeout: 120_000,
          hookTimeout: 180_000,
          // One container, shared; parallel suites would race on the schema.
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/lib/**', 'src/i18n/**', 'src/components/**'],
      exclude: ['src/paraglide/**', '**/*.test.*'],
    },
  },
})
