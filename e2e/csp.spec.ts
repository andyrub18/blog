import { expect, type Page, test } from '@playwright/test'
import { ACCOUNTS, signIn, waitForInteractive } from './helpers'

/**
 * The Content-Security-Policy, against a production build (SECURITY.md P0 #6).
 *
 * The policy allows inline scripts only with the request's nonce, and a page
 * whose hydration script was missed would render perfectly and then never
 * answer a click — the failure this suite exists to catch. The dev server sends
 * no policy (its own scripts carry no nonce), so these tests only mean something
 * against `npm run build` output:
 *
 *   ALLOW_INSECURE_LOCAL=true NODE_ENV=production PORT=3100 node .output/server/index.mjs
 *   E2E_PRODUCTION=1 E2E_DATABASE=1 E2E_BASE_URL=http://localhost:3100 npx playwright test e2e/csp.spec.ts
 */
test.skip(!process.env.E2E_PRODUCTION, 'requires a production build (E2E_PRODUCTION=1)')

/** Record every policy violation the page reports, from before its first script runs. */
async function watchViolations(page: Page): Promise<() => Promise<Array<string>>> {
  await page.addInitScript(() => {
    const seen: Array<string> = []
    ;(window as unknown as { __csp: Array<string> }).__csp = seen
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.violatedDirective} ${event.blockedURI}`)
    })
  })
  const refused: Array<string> = []
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(message.text())) {
      refused.push(message.text())
    }
  })
  return async () => [
    ...(await page.evaluate(
      () => (window as unknown as { __csp?: Array<string> }).__csp ?? [],
    )),
    ...refused,
  ]
}

const PAGES = [
  '/fr/',
  '/fr/articles',
  '/fr/articles/leducation-comme-priorite',
  '/fr/articles/leducation-comme-priorite/versions',
  '/fr/articles/sitiyasyon-ekonomik-nan-peyi-a/discussion',
  '/fr/auth/login',
  '/fr/auth/register/reader',
]

for (const path of PAGES) {
  test(`${path} is served with the policy, hydrates, and breaks none of it`, async ({
    page,
  }) => {
    const violations = await watchViolations(page)
    const response = await page.goto(path)
    expect(response?.headers()['content-security-policy']).toMatch(
      /script-src 'self' 'nonce-/,
    )
    await waitForInteractive(page)
    expect(await violations()).toEqual([])
  })
}

test('a page still answers clicks under the policy', async ({ page }) => {
  const violations = await watchViolations(page)
  await page.goto('/fr/auth/login')
  await waitForInteractive(page)
  // Client-side validation: only a hydrated form can say this without a request.
  await page.getByRole('button', { name: /Se connecter/i }).click()
  await expect(page.getByText(/adresse courriel/i).first()).toBeVisible()
  // Client-side navigation, through the router.
  await page.getByRole('button', { name: 'Kreyòl' }).click()
  await expect(page).toHaveURL(/\/ht\/auth\/login/)
  expect(await violations()).toEqual([])
})

/**
 * Sign-in is a server function, and the editor loads TipTap with a dynamic
 * import and sets inline styles — the three things most likely to run into a
 * policy that is too tight.
 */
test('signing in and opening the editor work under the policy', async ({ page }) => {
  test.skip(!process.env.E2E_DATABASE, 'requires E2E_DATABASE and seeded accounts')
  const violations = await watchViolations(page)
  await signIn(page, ACCOUNTS.confirmed)
  await page.goto('/fr/write')
  await waitForInteractive(page)
  await page
    .getByRole('listitem')
    .filter({ hasText: /L'éducation comme priorité vérifiable/i })
    .getByRole('link', { name: /^Ouvrir$/i })
    .click()
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 30_000 })
  expect(await violations()).toEqual([])
})
