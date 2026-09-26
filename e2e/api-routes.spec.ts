import { expect, test } from '@playwright/test'

/**
 * `/api/*` reached the way a person reaches it: by navigating.
 *
 * Paraglide's middleware redirects a *document* request for an unprefixed path
 * to its localized form, and until `routeStrategies` excluded `/api` it did that
 * to API routes too — `/api/auth/verify-email` became `/fr/api/auth/verify-email`,
 * a 404. Nobody could verify an address by clicking the link in their email.
 * Every earlier test fetched these URLs, and a fetch is never redirected, so all
 * of them passed. These navigate, with a locale cookie set, because that is the
 * request a mail client or a click actually makes.
 *
 * Skipped unless E2E_DATABASE is set: the verification endpoint reads the token
 * table.
 */
test.skip(!process.env.E2E_DATABASE, 'requires E2E_DATABASE')

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'lang', value: 'ht', url: baseURL as string }])
})

test('a verification link reaches the verifier and comes back in the email’s language', async ({
  page,
}) => {
  // An invalid token is enough: what is under test is that the request arrives
  // at Better Auth at all, and where it sends the reader afterwards.
  await page.goto('/api/auth/verify-email?token=not-a-real-token&callbackURL=%2Fht%2F')
  const landed = new URL(page.url())
  expect(landed.pathname).toBe('/ht/')
  expect(landed.searchParams.get('error')).toBe('INVALID_TOKEN')
})

test('a dossier link answers for itself instead of turning into a missing page', async ({
  page,
}) => {
  const response = await page.goto('/api/dossier/any-application/cv')
  // Refused because nobody is signed in — by the route, not by a 404 at a
  // localized URL that does not exist.
  expect(response?.status()).toBe(401)
  expect(new URL(page.url()).pathname).toBe('/api/dossier/any-application/cv')
})

test('a companion link is not rewritten into a localized path', async ({ page }) => {
  const response = await page.goto('/api/companion/no-such-article/fr')
  expect(response?.status()).toBe(404)
  expect(new URL(page.url()).pathname).toBe('/api/companion/no-such-article/fr')
})
