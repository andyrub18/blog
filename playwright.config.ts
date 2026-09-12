import { defineConfig, devices } from '@playwright/test'

const PORT = 3000
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  /**
   * Longer than Playwright's 30s default, because the suite runs against the
   * dev server: Vite compiles a route's client module the first time anything
   * asks for it, and on a cold start that can take most of half a minute. The
   * built app does no such thing — this is the price of testing what people
   * actually run locally.
   */
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Most Haitian readers arrive on a phone; treat mobile as a first-class target.
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      // The review flows are not responsive-specific, and running them twice would
      // double the sign-ins — enough to trip our own per-IP rate limit, which
      // buckets every local caller together when no proxy sets
      // `x-forwarded-for`. Correctness of the flow is covered on chromium.
      testIgnore: /(review|probation|governance)\.spec\.ts/,
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
